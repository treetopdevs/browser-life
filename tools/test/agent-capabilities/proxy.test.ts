import { it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { Broker } from '../../agent-capabilities/broker.ts';
import { MemoryAudit } from '../../agent-capabilities/audit.ts';
import { FakeGitHub } from '../../agent-capabilities/fake.ts';
import { GitHubDraftProvider } from '../../agent-capabilities/github.ts';
import { Recovery } from '../../agent-capabilities/recovery.ts';
import { req, registration, cred } from './fixtures.ts';
import type { FakeFault } from '../../agent-capabilities/fake.ts';
import type { HttpRequest, Transport } from '../../agent-capabilities/github.ts';

function setup() {
  const sentinel = randomBytes(32).toString('hex'); const fake = new FakeGitHub(sentinel, req.owner, req.repository, req.expectedHeadSha);
  const provider = new GitHubDraftProvider(fake); const audit = new MemoryAudit(); let now = 0;
  const resolver = { resolve: async () => sentinel };
  const broker = new Broker(audit, resolver, provider, () => now, 20); const channel = broker.register(registration);
  const lease = broker.issue('task_alpha', req, cred, 'approval', 'request');
  const recovery = new Recovery(audit, resolver, provider, () => now, 20);
  return { sentinel, fake, provider, audit, broker, channel, lease, recovery, setNow: (v: number) => { now = v; } };
}
const readCredential = { handle: 'readonly_internal', owner: req.owner, repository: req.repository, expiresAt: 1_000_000,
  permissions: ['pull_requests:read'] as const };
it('creates a typed draft on fixed host with no redirects or retries', async () => {
  const s = setup(); const calls: HttpRequest[] = [];
  const transport: Transport = { send: async r => { calls.push(r); return s.fake.send(r); } };
  const adapter = new GitHubDraftProvider(transport);
  const result = await adapter.createDraft(req, s.sentinel, new AbortController().signal);
  expect(result.number).toBe(1); expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe('https://api.github.com/repos/test/repo/pulls');
  expect(calls[0].redirect).toBe('error'); expect(calls[0].retries).toBe(0);
  expect(JSON.parse(calls[0].body!)).toEqual({ title: req.title, body: req.body, head: req.head, base: req.base, draft: true });
});
it.each<FakeFault>(['redirect','error','oversize','accepted_timeout','before_submit'])('sanitizes %s and blocks retry/replacement', async fault => {
  const s = setup(); s.fake.fault = fault;
  const response = await s.channel.execute(s.lease.leaseId, req);
  expect(response).toEqual({ ok: false, code: 'OPERATION_UNCERTAIN' });
  expect(JSON.stringify([response, s.audit.events]).includes(s.sentinel)).toBe(false);
  expect((await s.channel.execute(s.lease.leaseId, req)).ok).toBe(false);
  expect(() => s.broker.issue('task_alpha', req, cred, 'second_approval', 'second_request')).toThrow('ATTEMPT_BLOCKED');
  expect(s.fake.writes).toBe(fault === 'accepted_timeout' ? 1 : 0);
});
it('recovery after cancellation/lease expiry does not restore the channel or authorize writes', async () => {
  const s = setup(); s.fake.fault = 'accepted_timeout'; await s.channel.execute(s.lease.leaseId, req);
  s.channel.close(); s.setNow(300_000);
  const grant = s.recovery.grant(s.lease.leaseId, 'task_alpha', 'fresh_recovery_approval', readCredential);
  const result = await s.recovery.reconcile(grant.grantId);
  expect(result.ok).toBe(true); if (result.ok) { expect(result.matches).toHaveLength(1); expect(result.replacementBlocked).toBe(true); }
  expect((await s.channel.execute(s.lease.leaseId, req)).ok).toBe(false);
  expect(await s.recovery.reconcile(grant.grantId)).toEqual({ ok: false, code: 'RECOVERY_DENIED' });
});
it('requires a fresh, scoped read-only grant and rejects it at expiry boundary', async () => {
  const s = setup(); await s.channel.execute(s.lease.leaseId, req);
  expect(() => s.recovery.grant(s.lease.leaseId, 'task_beta', 'approval', readCredential)).toThrow('RECOVERY_DENIED');
  expect(() => s.recovery.grant(s.lease.leaseId, 'task_alpha', 'approval', { ...readCredential, repository: 'wrong' })).toThrow('RECOVERY_DENIED');
  const grant = s.recovery.grant(s.lease.leaseId, 'task_alpha', 'approval', readCredential, 10); s.setNow(10);
  expect(await s.recovery.reconcile(grant.grantId)).toEqual({ ok: false, code: 'RECOVERY_DENIED' });
});
it('reads all pages and includes closed PRs while never following arbitrary links', async () => {
  const s = setup(); await s.channel.execute(s.lease.leaseId, req);
  s.fake.seedPulls(Array.from({ length: 101 }, (_, i) => ({ id: i + 1, number: i + 1,
    html_url: `https://github.com/test/repo/pull/${i + 1}`, state: i % 2 ? 'closed' : 'open', draft: true,
    head: { ref: req.head, repo: { full_name: 'test/repo' } }, base: { ref: req.base, repo: { full_name: 'test/repo' } } })));
  const grant = s.recovery.grant(s.lease.leaseId, 'task_alpha', 'approval', readCredential);
  const result = await s.recovery.reconcile(grant.grantId); expect(result.ok).toBe(true);
  if (result.ok) expect(result.matches).toHaveLength(101); expect(s.fake.reads).toBe(3);
});
it('empty reads during an in-flight write do not unblock replacement', async () => {
  const s = setup(); s.fake.fault = 'accepted_timeout'; const pending = s.channel.execute(s.lease.leaseId, req);
  await new Promise(r => setTimeout(r, 0)); s.fake.seedPulls([]);
  const grant = s.recovery.grant(s.lease.leaseId, 'task_alpha', 'approval', readCredential);
  expect(await s.recovery.reconcile(grant.grantId)).toEqual({ ok: true, matches: [], replacementBlocked: true });
  expect(() => s.broker.issue('task_alpha', req, cred, 'new_approval', 'new_request')).toThrow('ATTEMPT_BLOCKED'); await pending;
});
it('denies recovery before submission evidence and on audit failure without provider reads', async () => {
  const s = setup(); expect(() => s.recovery.grant(s.lease.leaseId, 'task_alpha', 'approval', readCredential)).toThrow('RECOVERY_DENIED');
  await s.channel.execute(s.lease.leaseId, req); const grant = s.recovery.grant(s.lease.leaseId, 'task_alpha', 'approval', readCredential);
  const prior = s.fake.reads; s.audit.append = () => { throw new Error(s.sentinel); };
  expect((await s.recovery.reconcile(grant.grantId)).ok).toBe(false); expect(s.fake.reads).toBe(prior);
});
it('rejects mismatched or credential-bearing provider result fields', async () => {
  const s = setup(); await s.channel.execute(s.lease.leaseId, req);
  s.fake.seedPulls([{ id: 1, number: 1, html_url: s.sentinel, head: { ref: 'wrong', repo: { full_name: 'test/repo' } }, base: { ref: req.base, repo: { full_name: 'test/repo' } } }]);
  const grant = s.recovery.grant(s.lease.leaseId, 'task_alpha', 'approval', readCredential);
  const result = await s.recovery.reconcile(grant.grantId); expect(result.ok).toBe(false);
  expect(JSON.stringify([result, s.audit.events]).includes(s.sentinel)).toBe(false);
});
it('correlates every read with distinct grant IDs while retaining original request and approval', async () => {
  const s = setup(); await s.channel.execute(s.lease.leaseId, req);
  const first = s.recovery.grant(s.lease.leaseId, 'task_alpha', 'recovery_approval', readCredential);
  const second = s.recovery.grant(s.lease.leaseId, 'task_alpha', 'recovery_approval', readCredential);
  await s.recovery.reconcile(first.grantId); await s.recovery.reconcile(second.grantId);
  const events = s.audit.events.filter(e => e.kind.startsWith('recovery_'));
  expect(new Set(events.map(e => e.grantId)).size).toBe(2);
  for (const e of events) { expect(e.requestId).toBe('request'); expect(e.approvalId).toBe('recovery_approval'); }
  for (const grant of [first, second]) expect(events.filter(e => e.grantId === grant.grantId).map(e => e.kind)).toEqual(['recovery_granted','recovery_dispatched','recovery_result']);
});
it('records definitive rejection as failed, sanitizes it and consumes the lease', async () => {
  const s = setup(); s.fake.fault = 'rejected';
  expect(await s.channel.execute(s.lease.leaseId, req)).toEqual({ ok: false, code: 'OPERATION_FAILED' });
  expect(s.broker.snapshot(s.lease.leaseId).status).toBe('failed'); expect(s.fake.writes).toBe(0);
  expect(JSON.stringify(s.audit.events).includes(s.sentinel)).toBe(false);
  expect((await s.channel.execute(s.lease.leaseId, req)).ok).toBe(false);
});
