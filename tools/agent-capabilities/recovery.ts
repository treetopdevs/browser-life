import { randomUUID } from 'node:crypto';
import { check, digest, identity, providerObject } from './contracts.ts';
import type { CredentialResolver, ProviderObject, Scope } from './contracts.ts';
import type { Audit, Event } from './audit.ts';
import type { RecoveryProvider } from './github.ts';

export interface ReadCredential {
  handle: string; owner: string; repository: string; expiresAt: number; permissions: readonly ['pull_requests:read'];
}
export interface RecoveryGrant { grantId: string; leaseId: string; taskId: string; approvalId: string; expiresAt: string }
interface InternalGrant { view: RecoveryGrant; dispatch: Event; credential: ReadCredential; used: boolean }
export type RecoveryResult = { ok: true; matches: ProviderObject[]; replacementBlocked: true } | { ok: false; code: 'RECOVERY_DENIED' | 'RECOVERY_UNCERTAIN' };
/** Trusted service API only. No method is exposed on an agent channel. Recovery never renews a task or authorizes writes. */
export class Recovery {
  #grants = new Map<string, InternalGrant>();
  constructor(private readonly audit: Audit, private readonly resolver: CredentialResolver,
    private readonly provider: RecoveryProvider, private readonly now: () => number = Date.now, private readonly timeoutMs = 1000) {
    check(timeoutMs > 0 && timeoutMs <= 30_000);
  }
  private record(kind: Event['kind'], g: InternalGrant, reason = 'NONE', providerId: number | null = null): void {
    const d = g.dispatch;
    this.audit.append({ kind, agentId: d.agentId, taskId: d.taskId, leaseId: d.leaseId, requestId: d.requestId, approvalId: g.view.approvalId, grantId: g.view.grantId,
      workspaceId: d.workspaceId, sourceRevision: d.sourceRevision,
      scopeDigest: d.scopeDigest, scope: d.scope, policyVersion: d.policyVersion, reason, providerId }, this.now());
  }
  grant(leaseId: string, taskId: string, approvalId: string, credential: ReadCredential, ttlMs = 300_000): RecoveryGrant {
    identity(taskId); identity(approvalId); identity(credential.handle);
    check(Number.isSafeInteger(ttlMs) && ttlMs > 0 && ttlMs <= 300_000, 'RECOVERY_DENIED');
    const dispatch = this.audit.events.find(e => e.kind === 'dispatch_committed' && e.leaseId === leaseId && e.taskId === taskId);
    check(dispatch?.scope && digest(dispatch.scope) === dispatch.scopeDigest, 'RECOVERY_DENIED');
    check(credential.owner === dispatch.scope.owner && credential.repository === dispatch.scope.repository &&
      credential.expiresAt > this.now() && credential.permissions.length === 1 && credential.permissions[0] === 'pull_requests:read', 'RECOVERY_DENIED');
    const view: RecoveryGrant = { grantId: randomUUID(), leaseId, taskId, approvalId,
      expiresAt: new Date(Math.min(this.now() + ttlMs, credential.expiresAt)).toISOString() };
    const g = { view, dispatch, credential: structuredClone(credential), used: false };
    this.record('recovery_granted', g); this.#grants.set(view.grantId, g); return structuredClone(view);
  }
  async reconcile(grantId: string): Promise<RecoveryResult> {
    const g = this.#grants.get(grantId);
    if (!g || g.used || this.now() >= Date.parse(g.view.expiresAt)) return { ok: false, code: 'RECOVERY_DENIED' };
    g.used = true;
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      this.record('recovery_dispatched', g);
      const work = async () => {
        const credential = await this.resolver.resolve(g.credential.handle);
        const matches: ProviderObject[] = []; const seen = new Set<number>();
        for (let page = 1; page <= 100; page++) {
          check(!controller.signal.aborted && this.now() < Date.parse(g.view.expiresAt) && this.now() < g.credential.expiresAt, 'RECOVERY_DENIED');
          const result = await this.provider.list(g.dispatch.scope as Scope, page, credential, controller.signal);
          check(Array.isArray(result.items) && result.items.length <= 100 && typeof result.more === 'boolean', 'INVALID_PROVIDER_RESULT');
          for (const raw of result.items) {
            const pr = providerObject(raw, g.dispatch.scope!); check(!seen.has(pr.id), 'INVALID_PROVIDER_RESULT');
            seen.add(pr.id); matches.push(pr);
          }
          if (!result.more) return matches;
        }
        throw new Error('RECOVERY_LIMIT');
      };
      const matches = await Promise.race([work(), new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(new Error('RECOVERY_TIMEOUT')), { once: true });
      })]);
      check(this.now() < Date.parse(g.view.expiresAt), 'RECOVERY_DENIED');
      this.record('recovery_result', g, matches.length ? 'RECOVERY_MATCHED' : 'RECOVERY_EMPTY', matches[0]?.id ?? null);
      return { ok: true, matches, replacementBlocked: true };
    } catch {
      controller.abort(); try { this.record('recovery_result', g, 'RECOVERY_UNCERTAIN'); } catch { /* no authority to unblock */ }
      return { ok: false, code: 'RECOVERY_UNCERTAIN' };
    } finally { clearTimeout(timer); }
  }
}
