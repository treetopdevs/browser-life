import { describe, it, expect } from 'vitest';
import { Broker } from '../../agent-capabilities/broker.ts';
import { MemoryAudit } from '../../agent-capabilities/audit.ts';
import { scope } from '../../agent-capabilities/contracts.ts';

import { setup, req, cred, registration } from './fixtures.ts';
describe('single operation authorization', () => {
  it('creates one approved draft and returns metadata without handles', async () => {
    const s = setup(); expect(JSON.stringify(s.lease)).not.toContain('internal');
    expect((await s.channel.execute(s.lease.leaseId, req)).ok).toBe(true);
    expect((await s.channel.execute(s.lease.leaseId, req)).ok).toBe(false); expect(s.writes()).toBe(1);
    expect(s.audit.events.map(e => e.kind)).toContain('dispatch_committed');
  });
  it.each(['owner','repository','head','base','expectedHeadSha','title','body','operation','draft','url','headers'])('rejects altered %s before resolution', async field => {
    const s = setup(); const altered = { ...req, [field]: 'unapproved' };
    expect((await s.channel.execute(s.lease.leaseId, altered)).ok).toBe(false);
    expect(s.resolves()).toBe(0); expect(s.writes()).toBe(0);
  });
  it.each(['agentId','taskId','workspaceId','sourceRevision'])('rejects foreign channel with changed %s', async field => {
    const s = setup(); const foreign = { ...registration, taskId: 'task_beta', [field]: field === 'sourceRevision'
      ? { ...registration.sourceRevision, tree: 'c'.repeat(40) } : 'other' };
    const channel = s.broker.register(foreign);
    expect((await channel.execute(s.lease.leaseId, req)).ok).toBe(false); expect(s.resolves()).toBe(0);
  });
  it('expires at exact boundary and bounds provider expiry', async () => {
    const s = setup(); s.setNow(300_000); expect(await s.channel.execute(s.lease.leaseId, req)).toEqual({ ok: false, code: 'LEASE_EXPIRED' });
    expect(s.resolves()).toBe(0); expect(s.broker.snapshot(s.lease.leaseId).status).toBe('expired');
  });
  it('denies cancelled or revoked tasks', async () => {
    for (const cancel of [true, false]) { const s = setup(); if (cancel) s.channel.close(); else s.broker.revoke(s.lease.leaseId);
      expect((await s.channel.execute(s.lease.leaseId, req)).ok).toBe(false); expect(s.resolves()).toBe(0); }
  });
  it('serializes concurrent uses', async () => {
    const s = setup(); const results = await Promise.all([s.channel.execute(s.lease.leaseId, req), s.channel.execute(s.lease.leaseId, req)]);
    expect(results.filter(r => r.ok)).toHaveLength(1); expect(s.writes()).toBe(1);
  });
  it('revocation wins while credential/head validation is pending', async () => {
    let release!: (sha: string) => void;
    const s = setup(undefined, { validateHead: () => new Promise(r => { release = r; }), createDraft: async () => { throw new Error('must not write'); } });
    const result = s.channel.execute(s.lease.leaseId, req);
    await new Promise(r => setTimeout(r, 0)); s.broker.revoke(s.lease.leaseId); release(req.expectedHeadSha);
    expect((await result).ok).toBe(false); expect(s.audit.events.some(e => e.kind === 'dispatch_committed')).toBe(false);
  });
  it('dispatch wins before revocation; accepted write stays uncertain', async () => {
    let writes = 0;
    const s = setup(undefined, { validateHead: async () => req.expectedHeadSha, createDraft: async () => { writes++; return await new Promise(() => {}); } });
    const result = s.channel.execute(s.lease.leaseId, req); await new Promise(r => setTimeout(r, 0));
    s.broker.revoke(s.lease.leaseId); expect(await result).toEqual({ ok: false, code: 'OPERATION_UNCERTAIN' });
    expect(writes).toBe(1); expect(s.broker.blocked(scope(req))).toBe(true);
    expect(s.audit.events.slice(-3).map(e => e.kind)).toEqual(['dispatch_committed','lease_revoked','operation_uncertain']);
  });
  it('denies changed head and never exposes provider exception strings', async () => {
    const s = setup(undefined, { validateHead: async () => 'b'.repeat(40), createDraft: async () => {} });
    expect(await s.channel.execute(s.lease.leaseId, req)).toEqual({ ok: false, code: 'HEAD_CHANGED' });
    const t = setup(undefined, { validateHead: async () => { throw new Error('synthetic_sensitive'); }, createDraft: async () => {} });
    expect(JSON.stringify(await t.channel.execute(t.lease.leaseId, req))).not.toContain('synthetic_sensitive');
    expect(JSON.stringify(t.audit.events)).not.toContain('synthetic_sensitive');
  });
  it('invalidates leases on restart and preserves dispatch blocks', async () => {
    const s = setup(); await s.channel.execute(s.lease.leaseId, req);
    const b = new Broker(s.audit, { resolve: async () => '' }, s.p, () => 0);
    const c = b.register(registration); expect((await c.execute(s.lease.leaseId, req)).ok).toBe(false);
    expect(() => b.issue(registration.taskId, req, cred, 'approval', 'replacement')).toThrow('ATTEMPT_BLOCKED');
  });
  it('fails closed on dispatch and completion journal failure', async () => {
    for (const kind of ['dispatch_committed','operation_succeeded']) {
      class Broken extends MemoryAudit { override append(...args: Parameters<MemoryAudit['append']>) {
        if (args[0].kind === kind) throw new Error('disk failure'); super.append(...args);
      } }
      const s = setup(new Broken()); expect((await s.channel.execute(s.lease.leaseId, req)).ok).toBe(false);
      expect(s.writes()).toBe(kind === 'dispatch_committed' ? 0 : 1);
      if (kind === 'operation_succeeded') expect(s.broker.snapshot(s.lease.leaseId).status).toBe('uncertain');
    }
  });
  it('continues revoking every task lease after a revocation audit failure', () => {
    class FailsFirstRevocation extends MemoryAudit {
      failed = false;
      override append(...args: Parameters<MemoryAudit['append']>) {
        if (args[0].kind === 'lease_revoked' && !this.failed) { this.failed = true; throw new Error('disk failure'); }
        super.append(...args);
      }
    }
    const audit = new FailsFirstRevocation(); const s = setup(audit);
    const second = s.broker.issue('task_alpha', { ...req, head: 'another' }, cred, 'approval_two', 'request_two');
    expect(() => s.broker.end('task_alpha')).toThrow('AUDIT_UNAVAILABLE');
    expect(s.broker.snapshot(s.lease.leaseId).revokedAt).toBeDefined();
    expect(s.broker.snapshot(second.leaseId).status).toBe('revoked');
    expect(audit.events.at(-1)?.kind).toBe('task_ended');
  });
  it('rejects TTL, credential scope, unknown fields and repeated pending leases', () => {
    const s = setup(); expect(() => s.broker.issue('task_alpha', req, cred, 'approval', 'second')).toThrow('ATTEMPT_BLOCKED');
    const other = { ...req, head: 'different' };
    expect(() => s.broker.issue('task_alpha', other, cred, 'approval', 'second', 300_001)).toThrow('TTL_DENIED');
    expect(() => s.broker.issue('task_alpha', other, { ...cred, owner: 'different' }, 'approval', 'second')).toThrow('CREDENTIAL_SCOPE');
  });
});
it('rechecks expiry after delayed credential resolution and head validation', async () => {
  let resolve!: (credential: string) => void; let now = 0; let writes = 0;
  const audit = new MemoryAudit();
  const broker = new Broker(audit, { resolve: () => new Promise(r => { resolve = r; }) }, {
    validateHead: async () => req.expectedHeadSha, createDraft: async () => { writes++; }
  }, () => now);
  const channel = broker.register(registration); const lease = broker.issue('task_alpha', req, cred, 'approval', 'request', 10);
  const pending = channel.execute(lease.leaseId, req); await new Promise(r => setTimeout(r, 0)); now = 10; resolve('synthetic');
  expect(await pending).toEqual({ ok: false, code: 'LEASE_EXPIRED' }); expect(writes).toBe(0);
});
it('allows a newly approved lease when an unused lease expires exactly at boundary', () => {
  const s = setup(); s.setNow(300_000);
  const replacement = s.broker.issue('task_alpha', req, cred, 'new_approval', 'new_request');
  expect(replacement.status).toBe('issued'); expect(s.broker.snapshot(s.lease.leaseId).status).toBe('expired');
  expect(s.audit.events.some(e => e.kind === 'lease_expired')).toBe(true);
});
it('attributes denials to authenticated actors with safe known lease context', async () => {
  const s = setup(); const foreign = s.broker.register({ ...registration, agentId: 'beta', taskId: 'task_beta', workspaceId: 'stage_beta', sourceRevision: { ...registration.sourceRevision, tree: 'c'.repeat(40) } });
  await foreign.execute(s.lease.leaseId, req);
  const event = s.audit.events.at(-1)!;
  expect(event.kind).toBe('request_denied'); expect(event.agentId).toBe('beta'); expect(event.taskId).toBe('task_beta');
  expect(event.workspaceId).toBe('stage_beta'); expect(event.sourceRevision?.tree).toBe('c'.repeat(40));
  expect(event.leaseId).toBe(s.lease.leaseId); expect(event.requestId).toBe('request');
});
