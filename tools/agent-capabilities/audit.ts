import { randomUUID } from 'node:crypto';
import { openSync, closeSync, writeSync, fsyncSync, readFileSync, fstatSync, constants, unlinkSync } from 'node:fs';
import { hostDirectory } from './host-path.ts';
import { dirname } from 'node:path';
import { check, object, identity, OPERATION, SAFE_CODES } from './contracts.ts';
import type { Scope, Task } from './contracts.ts';

export const EVENTS = ['task_registered', 'lease_issued', 'request_denied', 'lease_revoked', 'lease_expired',
  'dispatch_committed', 'operation_succeeded', 'operation_failed', 'operation_uncertain', 'task_ended',
  'broker_restarted', 'recovery_granted', 'recovery_dispatched', 'recovery_result'] as const;
export interface Event {
  schemaVersion: 1; eventId: string; sequence: number; time: string; kind: typeof EVENTS[number];
  agentId: string; taskId: string; workspaceId: string; sourceRevision: Task['sourceRevision'] | null; approvalId: string; grantId: string | null; leaseId: string; requestId: string; operation: typeof OPERATION;
  scopeDigest: string; policyVersion: string; reason: string; providerId: number | null; scope: Scope | null;
}
export type Evidence = Omit<Event, 'schemaVersion' | 'eventId' | 'sequence' | 'time' | 'operation'>;
export interface Audit { readonly events: readonly Event[]; append(evidence: Evidence, now: number): void }
export function validateEvent(value: unknown, sequence: number): Event {
  const o = object(value, ['schemaVersion','eventId','sequence','time','kind','agentId','taskId','workspaceId','sourceRevision','approvalId','grantId','leaseId','requestId','operation','scopeDigest','policyVersion','reason','providerId','scope']);
  check(o.schemaVersion === 1 && o.sequence === sequence && o.operation === OPERATION, 'INVALID_JOURNAL');
  check(typeof o.eventId === 'string' && /^[a-f0-9-]{36}$/.test(o.eventId), 'INVALID_JOURNAL');
  check(typeof o.time === 'string' && Number.isFinite(Date.parse(o.time)), 'INVALID_JOURNAL');
  check(EVENTS.includes(o.kind as Event['kind']), 'INVALID_JOURNAL');
  for (const k of ['agentId','taskId','workspaceId','approvalId','leaseId','requestId','policyVersion','reason']) identity(o[k]);
  check(o.grantId === null || typeof o.grantId === 'string', 'INVALID_JOURNAL');
  if (o.grantId !== null) identity(o.grantId);
  if (o.sourceRevision !== null) {
    const r = object(o.sourceRevision, ['changeId','commit','tree']); identity(r.changeId);
    for (const k of ['commit','tree']) check(typeof r[k] === 'string' && /^[a-f0-9]{40,64}$/.test(r[k] as string), 'INVALID_JOURNAL');
  }
  check(typeof o.scopeDigest === 'string' && /^[a-f0-9]{64}$/.test(o.scopeDigest), 'INVALID_JOURNAL');
  check(SAFE_CODES.has(o.reason as string), 'INVALID_JOURNAL');
  check(o.providerId === null || (Number.isSafeInteger(o.providerId) && (o.providerId as number) > 0), 'INVALID_JOURNAL');
  if (o.scope !== null) {
    const s = object(o.scope, ['owner','repository','base','head','expectedHeadSha','payloadDigest','draft']);
    identity(s.owner); identity(s.repository);
    for (const k of ['base','head']) check(typeof s[k] === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9/_-]{0,199}$/.test(s[k] as string));
    check(typeof s.expectedHeadSha === 'string' && /^[a-f0-9]{40}$/.test(s.expectedHeadSha));
    check(typeof s.payloadDigest === 'string' && /^[a-f0-9]{64}$/.test(s.payloadDigest) && s.draft === true);
  }
  return structuredClone(o) as unknown as Event;
}
export class MemoryAudit implements Audit {
  protected records: Event[] = [];
  get events(): readonly Event[] { return structuredClone(this.records); }
  append(evidence: Evidence, now: number): void {
    this.records.push(validateEvent({ ...evidence, schemaVersion: 1, eventId: randomUUID(), sequence: this.records.length + 1,
      time: new Date(now).toISOString(), operation: OPERATION }, this.records.length + 1));
  }
}
/** Trusted host path only. Never use a checkout, cache or temporary directory in live mode. */
export class FileAudit extends MemoryAudit {
  private fd: number;
  private lock: string;
  private poisoned = false;
  constructor(path: string) {
    super();
    hostDirectory(dirname(path));
    this.lock = path + '.lock';
    const lockFd = openSync(this.lock, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    closeSync(lockFd);
    try { this.fd = openSync(path, constants.O_CREAT | constants.O_APPEND | constants.O_RDWR | constants.O_NOFOLLOW, 0o600); }
    catch { unlinkSync(this.lock); throw new Error('INVALID_JOURNAL'); }
    try {
      const directory = openSync(dirname(path), constants.O_RDONLY);
      try { fsyncSync(directory); } finally { closeSync(directory); }
      const stat = fstatSync(this.fd);
      check(stat.isFile() && stat.nlink === 1 && (stat.mode & 0o077) === 0 && stat.uid === process.getuid?.(), 'UNSAFE_JOURNAL');
      const data = readFileSync(this.fd, 'utf8');
      check(data === '' || data.endsWith('\n'), 'TRUNCATED_JOURNAL');
      this.records = data === '' ? [] : data.trimEnd().split('\n').map((line, i) => validateEvent(JSON.parse(line), i + 1));
      fsyncSync(this.fd);
    } catch { closeSync(this.fd); unlinkSync(this.lock); throw new Error('INVALID_JOURNAL'); }
  }
  override append(evidence: Evidence, now: number): void {
    check(!this.poisoned, 'AUDIT_UNAVAILABLE');
    const event = validateEvent({ ...evidence, schemaVersion: 1, eventId: randomUUID(), sequence: this.records.length + 1,
      time: new Date(now).toISOString(), operation: OPERATION }, this.records.length + 1);
    try {
      const bytes = Buffer.from(JSON.stringify(event) + '\n');
      let offset = 0;
      while (offset < bytes.length) offset += writeSync(this.fd, bytes, offset);
      fsyncSync(this.fd); this.records.push(event);
    } catch { this.poisoned = true; throw new Error('AUDIT_UNAVAILABLE'); }
  }
  close(): void {
    if (this.fd < 0) return;
    this.poisoned = true; closeSync(this.fd); this.fd = -1; unlinkSync(this.lock);
  }
}
