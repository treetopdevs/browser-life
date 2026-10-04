import { randomUUID } from 'node:crypto';
import { Denied, check, task, request, scope, digest, attemptKey, providerObject, identity, OPERATION, ProviderRejected } from './contracts.ts';
import type { Task, CapabilityLease, CredentialRegistration, CredentialResolver, Provider, Result, Scope } from './contracts.ts';
import type { Audit, Event } from './audit.ts';

export interface Channel { execute(leaseId: unknown, request: unknown): Promise<Result>; close(): void }
interface Registration { task: Task; alive: boolean; channel: Channel }
interface InternalLease { view: CapabilityLease; credential: CredentialRegistration; controller: AbortController }
const NIL = digest(null);
export class Broker {
  #tasks = new Map<string, Registration>();
  #leases = new Map<string, InternalLease>();
  #blocked = new Set<string>();
  #healthy = true;
  readonly policyVersion = 'prototype_v1';
  constructor(private readonly audit: Audit, private readonly resolver: CredentialResolver,
    private readonly provider: Provider, private readonly now: () => number = Date.now, private readonly timeoutMs = 1000) {
    check(timeoutMs > 0 && timeoutMs <= 30_000);
    const committed = new Map<string, Event>();
    const terminal = new Set<string>();
    const issued = new Map<string, { event: Event; state: string }>();
    const matches = (a: Event, b: Event) => a.agentId === b.agentId && a.taskId === b.taskId &&
      a.workspaceId === b.workspaceId && digest(a.sourceRevision) === digest(b.sourceRevision) && a.approvalId === b.approvalId && a.requestId === b.requestId && a.policyVersion === b.policyVersion && a.scopeDigest === b.scopeDigest &&
      digest(a.scope) === digest(b.scope);
    for (const event of audit.events) {
      if (event.kind === 'broker_restarted') {
        for (const lease of issued.values()) if (lease.state === 'issued') lease.state = 'stale';
      }
      if (event.kind === 'lease_issued') {
        check(event.scope && digest(event.scope) === event.scopeDigest && !issued.has(event.leaseId), 'INVALID_JOURNAL');
        issued.set(event.leaseId, { event, state: 'issued' });
      }
      if (event.kind === 'lease_expired' || event.kind === 'lease_revoked') {
        const previous = issued.get(event.leaseId);
        check(previous && matches(previous.event, event) &&
          (previous.state === 'issued' || (event.kind === 'lease_revoked' && previous.state === 'dispatching')), 'INVALID_JOURNAL');
        if (previous.state === 'issued') previous.state = event.kind;
      }
      if (event.kind === 'dispatch_committed') {
        const previous = issued.get(event.leaseId);
        check(previous?.state === 'issued' && matches(previous.event, event) && !committed.has(event.leaseId), 'INVALID_JOURNAL');
        previous.state = 'dispatching';
        committed.set(event.leaseId, event); this.#blocked.add(attemptKey(event.scope!));
      }
      if (['operation_succeeded','operation_failed','operation_uncertain'].includes(event.kind)) {
        const start = committed.get(event.leaseId);
        check(start && !terminal.has(event.leaseId) && matches(start, event), 'INVALID_JOURNAL');
        terminal.add(event.leaseId); issued.get(event.leaseId)!.state = 'terminal';
      }
    }
    for (const [id, event] of committed) if (!terminal.has(id)) {
      this.audit.append({ ...this.evidence('operation_uncertain'), agentId: event.agentId, taskId: event.taskId,
        leaseId: id, requestId: event.requestId, workspaceId: event.workspaceId, sourceRevision: event.sourceRevision, approvalId: event.approvalId, scopeDigest: event.scopeDigest, scope: event.scope, reason: 'RESTART_UNMATCHED' }, this.now());
    }
    this.record('broker_restarted');
  }
  private evidence(kind: Event['kind'], lease?: InternalLease, reason = 'NONE') {
    const v = lease?.view;
    return { kind, agentId: v?.task.agentId ?? 'system', taskId: v?.task.taskId ?? 'system', leaseId: v?.leaseId ?? 'none',
      requestId: v?.requestId ?? 'none', workspaceId: v?.task.workspaceId ?? 'system', sourceRevision: v?.task.sourceRevision ?? null,
      approvalId: v?.approvalId ?? 'none', grantId: null as string | null, scopeDigest: v ? digest(v.scope) : NIL, scope: v?.scope ?? null,
      policyVersion: this.policyVersion, reason, providerId: null as number | null };
  }
  private record(kind: Event['kind'], lease?: InternalLease, reason = 'NONE', providerId: number | null = null): void {
    try { this.audit.append({ ...this.evidence(kind, lease, reason), providerId }, this.now()); }
    catch { this.#healthy = false; throw new Denied('AUDIT_UNAVAILABLE'); }
  }
  register(value: unknown): Channel {
    check(this.#healthy, 'AUDIT_UNAVAILABLE'); const t = task(value);
    check(!this.#tasks.has(t.taskId), 'TASK_EXISTS');
    this.audit.append({ ...this.evidence('task_registered'), agentId: t.agentId, taskId: t.taskId, workspaceId: t.workspaceId, sourceRevision: t.sourceRevision }, this.now());
    let reg: Registration;
    const channel: Channel = Object.freeze({ execute: (id: unknown, req: unknown) => this.execute(reg, id, req), close: () => this.end(t.taskId) });
    reg = { task: t, alive: true, channel }; this.#tasks.set(t.taskId, reg); return channel;
  }
  /** Trusted launcher API only; it is never exposed over the agent channel. */
  issue(taskId: string, raw: unknown, credential: CredentialRegistration, approvalId: string, requestId: string, ttlMs = 300_000): CapabilityLease {
    check(this.#healthy, 'AUDIT_UNAVAILABLE'); const reg = this.#tasks.get(taskId); check(reg?.alive, 'TASK_ENDED');
    const req = request(raw); const s = scope(req); const now = this.now();
    check(Number.isSafeInteger(ttlMs) && ttlMs > 0 && ttlMs <= 300_000, 'TTL_DENIED');
    check(credential.owner === req.owner && credential.repository === req.repository && credential.expiresAt > now, 'CREDENTIAL_SCOPE');
    check(credential.permissions.length === 2 && credential.permissions.includes('pull_requests:write') && credential.permissions.includes('contents:read'), 'CREDENTIAL_SCOPE');
    identity(credential.handle); identity(approvalId); identity(requestId);
    for (const l of this.#leases.values()) if (l.view.status === 'issued' && now >= Date.parse(l.view.expiresAt)) {
      this.record('lease_expired', l); l.view.status = 'expired';
    }
    check(!this.#blocked.has(attemptKey(s)), 'ATTEMPT_BLOCKED');
    check(![...this.#leases.values()].some(l => l.view.status === 'issued' && attemptKey(l.view.scope) === attemptKey(s)), 'ATTEMPT_BLOCKED');
    const view: CapabilityLease = { schemaVersion: 1, leaseId: randomUUID(), task: structuredClone(reg.task), operation: OPERATION, scope: s,
      issuedAt: new Date(now).toISOString(), expiresAt: new Date(Math.min(now + ttlMs, credential.expiresAt)).toISOString(),
      status: 'issued', policyVersion: this.policyVersion, approvalId, requestId };
    const lease = { view, credential: structuredClone(credential), controller: new AbortController() };
    this.record('lease_issued', lease); this.#leases.set(view.leaseId, lease); return structuredClone(view);
  }
  revoke(id: string, reason: 'OPERATOR' | 'TASK_ENDED' = 'OPERATOR'): void {
    const l = this.#leases.get(id); check(l, 'UNKNOWN_LEASE');
    try {
      if (l.view.status === 'issued' || l.view.status === 'dispatching') {
        this.record('lease_revoked', l, reason);
        if (l.view.status === 'issued') l.view.status = 'revoked';
      }
    } finally {
      l.view.revokedAt = new Date(this.now()).toISOString(); l.view.revocationReason = reason;
      l.controller.abort();
    }
  }
  end(id: string): void {
    const t = this.#tasks.get(id); check(t, 'UNKNOWN_TASK'); t.alive = false;
    for (const [id, l] of this.#leases) if (l.view.task.taskId === t.task.taskId) this.revoke(id, 'TASK_ENDED');
    this.audit.append({ ...this.evidence('task_ended'), agentId: t.task.agentId, taskId: t.task.taskId, workspaceId: t.task.workspaceId, sourceRevision: t.task.sourceRevision }, this.now());
  }
  private eligible(reg: Registration, l: InternalLease): void {
    check(this.#healthy, 'AUDIT_UNAVAILABLE'); check(reg.alive, 'TASK_ENDED');
    check(digest(reg.task) === digest(l.view.task), 'IDENTITY_DENIED');
    check(l.view.status === 'issued', 'LEASE_USED');
    if (this.now() >= Date.parse(l.view.expiresAt) || this.now() >= l.credential.expiresAt) {
      this.record('lease_expired', l); l.view.status = 'expired'; throw new Denied('LEASE_EXPIRED');
    }
  }
  private async bounded<T>(run: (signal: AbortSignal) => Promise<T>, controller: AbortController): Promise<T> {
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(this.timeoutMs)]);
    return await new Promise<T>((resolve, reject) => {
      const abort = () => reject(new Denied('PROVIDER_UNCERTAIN'));
      if (signal.aborted) { abort(); return; }
      signal.addEventListener('abort', abort, { once: true });
      Promise.resolve().then(() => run(signal)).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  }
  private async execute(reg: Registration, id: unknown, raw: unknown): Promise<Result> {
    let l: InternalLease | undefined;
    let committed = false;
    try {
      check(typeof id === 'string', 'UNKNOWN_LEASE'); l = this.#leases.get(id); check(l, 'UNKNOWN_LEASE');
      this.eligible(reg, l); const req = request(raw); check(digest(req) === l.view.scope.payloadDigest, 'SCOPE_DENIED');
      // Credentials resolve only after channel, task, payload, scope and lease authorization.
      const credential = await this.bounded(() => this.resolver.resolve(l!.credential.handle), l.controller);
      this.eligible(reg, l);
      const sha = await this.bounded(signal => this.provider.validateHead(l!.view.scope, credential, signal), l.controller);
      check(sha === req.expectedHeadSha, 'HEAD_CHANGED');
      this.eligible(reg, l);
      // Synchronous durable write is the linearization point. No await until lease consumption.
      this.record('dispatch_committed', l); l.view.status = 'dispatching'; committed = true;
      this.#blocked.add(attemptKey(l.view.scope));
      const result = await this.bounded(signal => this.provider.createDraft(req, credential, signal), l.controller);
      const pr = providerObject(result, l.view.scope);
      this.record('operation_succeeded', l, 'NONE', pr.id); l.view.status = 'succeeded';
      return { ok: true, pullRequest: pr };
    } catch (error) {
      if (committed && l) {
        const rejected = error instanceof ProviderRejected;
        l.view.status = rejected ? 'failed' : 'uncertain';
        try { this.record(rejected ? 'operation_failed' : 'operation_uncertain', l, rejected ? 'PROVIDER_REJECTED' : 'PROVIDER_UNCERTAIN'); }
        catch { l.view.status = 'uncertain'; /* dispatch remains durable */ }
        return { ok: false, code: l.view.status === 'failed' ? 'OPERATION_FAILED' : 'OPERATION_UNCERTAIN' };
      }
      const code = error instanceof Denied ? error.code : 'PROVIDER_UNAVAILABLE';
      try { this.audit.append({ ...this.evidence('request_denied', l, code),
        agentId: reg.task.agentId, taskId: reg.task.taskId, workspaceId: reg.task.workspaceId, sourceRevision: reg.task.sourceRevision }, this.now()); } catch { this.#healthy = false; return { ok: false, code: 'AUDIT_UNAVAILABLE' }; }
      return { ok: false, code };
    }
  }
  snapshot(id: string): CapabilityLease { const l = this.#leases.get(id); check(l, 'UNKNOWN_LEASE'); return structuredClone(l.view); }
  blocked(s: Scope): boolean { return this.#blocked.has(attemptKey(s)); }
}
