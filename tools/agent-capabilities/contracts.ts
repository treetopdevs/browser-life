import { createHash } from 'node:crypto';

export const OPERATION = 'github.createDraftPullRequest' as const;
export type Operation = typeof OPERATION;
export type Status = 'issued' | 'dispatching' | 'succeeded' | 'failed' | 'uncertain' | 'expired' | 'revoked';
export const SAFE_CODES = new Set(['NONE', 'INVALID_REQUEST', 'UNKNOWN_OPERATION', 'UNKNOWN_LEASE', 'UNKNOWN_TASK',
  'TASK_EXISTS', 'TASK_ENDED', 'TTL_DENIED', 'CREDENTIAL_SCOPE', 'ATTEMPT_BLOCKED', 'IDENTITY_DENIED',
  'LEASE_USED', 'LEASE_EXPIRED', 'HEAD_CHANGED', 'SCOPE_DENIED', 'PROVIDER_UNCERTAIN', 'PROVIDER_UNAVAILABLE',
  'INVALID_PROVIDER_RESULT', 'AUDIT_UNAVAILABLE', 'INVALID_JOURNAL', 'UNSAFE_JOURNAL', 'TRUNCATED_JOURNAL',
  'OPERATOR', 'RESTART_UNMATCHED', 'RECOVERY_DENIED', 'RECOVERY_MATCHED', 'RECOVERY_EMPTY', 'RECOVERY_UNCERTAIN', 'PROVIDER_REJECTED']);
export class Denied extends Error {
  readonly code: string;
  constructor(code: string) {
    const safe = SAFE_CODES.has(code) ? code : 'PROVIDER_UNAVAILABLE';
    super(safe); this.code = safe;
  }
}
/** Only trusted adapter use: definitive provider rejection, without raw provider text. */
export class ProviderRejected extends Denied { constructor() { super('PROVIDER_REJECTED'); } }
export function check(ok: unknown, code = 'INVALID_REQUEST'): asserts ok { if (!ok) throw new Denied(code); }
export function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value));
  const obj = value as Record<string, unknown>;
  check(Object.keys(obj).length === keys.length && keys.every(k => Object.hasOwn(obj, k)));
  return obj;
}
export function identity(value: unknown): string {
  check(typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value)); return value;
}
export function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export interface Task {
  agentId: string; taskId: string; workspaceId: string;
  sourceRevision: { changeId: string; commit: string; tree: string };
}
export function task(value: unknown): Task {
  const o = object(value, ['agentId', 'taskId', 'workspaceId', 'sourceRevision']);
  const r = object(o.sourceRevision, ['changeId', 'commit', 'tree']);
  check(typeof r.commit === 'string' && /^[a-f0-9]{40,64}$/.test(r.commit));
  check(typeof r.tree === 'string' && /^[a-f0-9]{40,64}$/.test(r.tree));
  return { agentId: identity(o.agentId), taskId: identity(o.taskId), workspaceId: identity(o.workspaceId),
    sourceRevision: { changeId: identity(r.changeId), commit: r.commit, tree: r.tree } };
}
export interface DraftRequest {
  operation: Operation; owner: string; repository: string; base: string; head: string;
  expectedHeadSha: string; title: string; body: string; draft: true;
}
function branch(value: unknown): string {
  check(typeof value === 'string' && value.length <= 200 && /^[a-zA-Z0-9][a-zA-Z0-9/_-]*$/.test(value));
  check(!value.endsWith('/') && !value.includes('//')); return value;
}
export function request(value: unknown): DraftRequest {
  const o = object(value, ['operation', 'owner', 'repository', 'base', 'head', 'expectedHeadSha', 'title', 'body', 'draft']);
  check(o.operation === OPERATION, 'UNKNOWN_OPERATION');
  check(o.draft === true);
  check(typeof o.expectedHeadSha === 'string' && /^[a-f0-9]{40}$/.test(o.expectedHeadSha));
  check(typeof o.title === 'string' && o.title.trim().length > 0 && o.title.length <= 256);
  check(typeof o.body === 'string' && o.body.length <= 16_384);
  const result: DraftRequest = { operation: OPERATION, owner: identity(o.owner), repository: identity(o.repository),
    base: branch(o.base), head: branch(o.head), expectedHeadSha: o.expectedHeadSha, title: o.title, body: o.body, draft: true };
  check(result.head !== result.base); return result;
}
export interface Scope {
  owner: string; repository: string; base: string; head: string; expectedHeadSha: string;
  payloadDigest: string; draft: true;
}
export function scope(req: DraftRequest): Scope {
  return { owner: req.owner, repository: req.repository, base: req.base, head: req.head,
    expectedHeadSha: req.expectedHeadSha, payloadDigest: digest(req), draft: true };
}
export function attemptKey(s: Scope): string { return digest([s.owner.toLowerCase(), s.repository.toLowerCase(), s.base, s.head]); }
export interface CapabilityLease {
  schemaVersion: 1; leaseId: string; task: Task; operation: Operation; scope: Scope;
  issuedAt: string; expiresAt: string; status: Status; policyVersion: string;
  requestId: string; approvalId: string; revokedAt?: string; revocationReason?: 'OPERATOR' | 'TASK_ENDED';
}
export interface CredentialRegistration {
  handle: string; owner: string; repository: string; expiresAt: number;
  permissions: readonly ['pull_requests:write', 'contents:read'];
}
export interface CredentialResolver { resolve(handle: string): Promise<string> }
export interface ProviderObject { id: number; number: number; url: string }
export interface Provider {
  validateHead(scope: Scope, credential: string, signal: AbortSignal): Promise<string>;
  createDraft(req: DraftRequest, credential: string, signal: AbortSignal): Promise<unknown>;
}
export function providerObject(value: unknown, s: Scope): ProviderObject {
  const o = object(value, ['id', 'number', 'url']);
  check(Number.isSafeInteger(o.id) && (o.id as number) > 0, 'INVALID_PROVIDER_RESULT');
  check(Number.isSafeInteger(o.number) && (o.number as number) > 0, 'INVALID_PROVIDER_RESULT');
  check(o.url === `https://github.com/${s.owner}/${s.repository}/pull/${o.number}`, 'INVALID_PROVIDER_RESULT');
  return { id: o.id as number, number: o.number as number, url: o.url as string };
}
export type Result = { ok: true; pullRequest: ProviderObject } | { ok: false; code: string };
