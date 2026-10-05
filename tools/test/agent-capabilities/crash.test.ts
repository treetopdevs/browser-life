import { it, expect } from 'vitest';
import { mkdtempSync, rmSync, unlinkSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { FileAudit } from '../../agent-capabilities/audit.ts';
import { Broker } from '../../agent-capabilities/broker.ts';
import { Recovery } from '../../agent-capabilities/recovery.ts';
import { req, registration, cred } from './fixtures.ts';

it.each(['before_submission', 'after_acceptance', 'during_completion'])('blocks unmatched dispatch after real process crash: %s', async mode => {
  const root = mkdtempSync(join(tmpdir(), 'capability-crash-')); const runtime = join(root, 'runtime'); const journal = join(root, 'journal.jsonl');
  try {
    execFileSync(resolve('node_modules/.bin/tsc'), ['-p','tools/agent-capabilities/tsconfig.build.json','--outDir',runtime], { stdio: 'pipe' });
    const url = (name: string) => JSON.stringify(pathToFileURL(join(runtime, name + '.js')).href);
    const script = `import {Broker} from ${url('broker')}; import {FileAudit} from ${url('audit')};
      import {randomBytes} from 'node:crypto'; import {writeFileSync} from 'node:fs';
      const mode=${JSON.stringify(mode)}, token=randomBytes(32).toString('hex');
      class CrashAudit extends FileAudit { append(e,n) { if(mode==='during_completion' && e.kind==='operation_succeeded') process.exit(77); super.append(e,n); } }
      const audit=new CrashAudit(${JSON.stringify(journal)});
      const provider={validateHead:async()=>${JSON.stringify(req.expectedHeadSha)},createDraft:async()=>{
        if(mode==='before_submission')process.exit(77);
        const pr={id:1,number:1,url:'https://github.com/test/repo/pull/1'};
        writeFileSync(${JSON.stringify(join(root,'accepted.json'))},JSON.stringify(pr),{mode:0o600});
        if(mode==='after_acceptance')process.exit(77);return pr;
      }};
      const b=new Broker(audit,{resolve:async()=>token},provider,()=>0);
      const c=b.register(${JSON.stringify(registration)}); const l=b.issue('task_alpha',${JSON.stringify(req)},${JSON.stringify(cred)},'approval','request');
      await c.execute(l.leaseId,${JSON.stringify(req)}); process.exit(78);`;
    const worker = join(root, 'worker.mjs'); writeFileSync(worker, script, { mode: 0o600 });
    const child = spawnSync(process.execPath, [worker], { env: {}, stdio: 'pipe', timeout: 10_000 });
    expect(child.status).toBe(77);
    expect(existsSync(join(root, 'accepted.json'))).toBe(mode !== 'before_submission');
    // Simulated operator repair: the child is confirmed stopped; clear only its temporary fixture lock.
    unlinkSync(journal + '.lock'); const audit = new FileAudit(journal);
    const provider = { validateHead: async () => req.expectedHeadSha, createDraft: async () => { throw new Error('must not retry'); } };
    const broker = new Broker(audit, { resolve: async () => 'synthetic' }, provider, () => 1);
    broker.register(registration); expect(() => broker.issue('task_alpha', req, cred, 'new_approval','replacement')).toThrow('ATTEMPT_BLOCKED');
    expect(audit.events.some(e => e.reason === 'RESTART_UNMATCHED')).toBe(true);
    const dispatch = audit.events.find(e => e.kind === 'dispatch_committed')!;
    const recovery = new Recovery(audit, { resolve: async () => 'synthetic' }, {
      list: async () => ({ items: existsSync(join(root, 'accepted.json')) ? [JSON.parse(readFileSync(join(root,'accepted.json'),'utf8'))] : [], more: false })
    }, () => 1);
    const grant = recovery.grant(dispatch.leaseId, 'task_alpha', 'recovery_approval', { ...cred, permissions: ['pull_requests:read'] });
    const result = await recovery.reconcile(grant.grantId); expect(result.ok).toBe(true);
    if (result.ok) { expect(result.matches).toHaveLength(mode === 'before_submission' ? 0 : 1); expect(result.replacementBlocked).toBe(true); }
    audit.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
