import { it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileAudit } from '../../agent-capabilities/audit.ts';
import { Broker } from '../../agent-capabilities/broker.ts';
import { setup, req, registration, cred } from './fixtures.ts';

it('fsync-backed journal survives reopening and unmatched dispatch blocks replacement', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'capability-journal-')); const path = join(dir, 'journal.jsonl');
  try {
    const audit = new FileAudit(path); const s = setup(audit);
    await s.channel.execute(s.lease.leaseId, req); audit.close();
    const data = readFileSync(path, 'utf8').trimEnd().split('\n');
    // Simulate termination after durable dispatch, before any completion write.
    writeFileSync(path, data.filter(l => JSON.parse(l).kind !== 'operation_succeeded').join('\n') + '\n');
    const reopened = new FileAudit(path); const b = new Broker(reopened, { resolve: async () => '' }, s.p, () => 1);
    b.register(registration); expect(() => b.issue('task_alpha', req, cred, 'approval', 'replacement')).toThrow('ATTEMPT_BLOCKED');
    expect(reopened.events.some(e => e.reason === 'RESTART_UNMATCHED')).toBe(true); reopened.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
it('refuses truncated, unknown-field and permissive journal files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'capability-journal-')); const path = join(dir, 'journal.jsonl');
  try {
    for (const content of ['{', '{}\n', '{"credential":"should-not-parse"}\n']) {
      writeFileSync(path, content, { mode: 0o600 }); expect(() => new FileAudit(path)).toThrow('INVALID_JOURNAL');
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
it('refuses concurrent journal writers and semantically inconsistent completion', () => {
  const dir = mkdtempSync(join(tmpdir(), 'capability-journal-')); const path = join(dir, 'journal.jsonl');
  try {
    const audit = new FileAudit(path); expect(() => new FileAudit(path)).toThrow();
    const s = setup(audit); const issued = audit.events.find(e => e.kind === 'lease_issued')!;
    audit.append({ ...issued, kind: 'operation_succeeded' }, 1);
    expect(() => new Broker(audit, { resolve: async () => '' }, s.p)).toThrow('INVALID_JOURNAL'); audit.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
it('rejects orphan dispatch and actor/request/policy changes in completion evidence', async () => {
  const s = setup(); await s.channel.execute(s.lease.leaseId, req);
  const events = s.audit.events;
  const { MemoryAudit } = await import('../../agent-capabilities/audit.ts');
  class EvidenceAudit extends MemoryAudit { constructor(records: typeof events) { super(); this.records = structuredClone(records) as typeof this.records; } }
  const orphan = events.filter(e => e.kind === 'dispatch_committed');
  expect(() => new Broker(new EvidenceAudit(orphan), { resolve: async () => '' }, s.p)).toThrow('INVALID_JOURNAL');
  for (const field of ['agentId','requestId','policyVersion']) {
    const tampered = events.map(e => e.kind === 'operation_succeeded' ? { ...e, [field]: 'changed' } : e);
    expect(() => new Broker(new EvidenceAudit(tampered), { resolve: async () => '' }, s.p)).toThrow('INVALID_JOURNAL');
  }
});
it('refuses journal paths inside checkout metadata or nonprivate host state', async () => {
  const { mkdirSync, chmodSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'capability-path-'));
  try {
    mkdirSync(join(dir, '.jj')); expect(() => new FileAudit(join(dir, 'journal.jsonl'))).toThrow('UNSAFE_JOURNAL');
    rmSync(join(dir, '.jj'), { recursive: true }); chmodSync(dir, 0o755);
    expect(() => new FileAudit(join(dir, 'journal.jsonl'))).toThrow('UNSAFE_JOURNAL');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
it('closed journal instances cannot append to a subsequently reused file descriptor', () => {
  const dir = mkdtempSync(join(tmpdir(), 'capability-closed-')); const path = join(dir, 'journal.jsonl');
  try {
    const original = new FileAudit(path); const s = setup(original); const evidence = s.audit.events.at(-1)!; original.close(); original.close();
    const next = new FileAudit(path); expect(() => original.append(evidence, 1)).toThrow('AUDIT_UNAVAILABLE'); next.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
