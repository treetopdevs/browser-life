import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join, parse, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { Broker } from './broker.ts';
import { FileAudit } from './audit.ts';
import { GitHubDraftProvider } from './github.ts';
import { FakeGitHub } from './fake.ts';
import { bindPipes } from './ipc.ts';
import { hostDirectory } from './host-path.ts';
import { check, OPERATION } from './contracts.ts';
import type { Channel, } from './broker.ts';

function files(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(e => {
    const path = join(root, e.name); check(!e.isSymbolicLink()); return e.isDirectory() ? files(path) : [path];
  });
}
export function runtimeDigest(root: string): string {
  const manifest = files(root).sort().map(path => [relative(root, path), createHash('sha256').update(readFileSync(path)).digest('hex')]);
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
}
export async function runHarness(stateRoot: string, approvedBody = 'No external operations'): Promise<{ fakeWrites: number; grantedSucceeded: boolean; otherDenied: boolean; sentinelAbsent: boolean; runtimeDigest: string; isolation: 'unverified' }> {
  const root = resolve(stateRoot); check(root !== parse(root).root && existsSync(root)); hostDirectory(root);
  const runtime = dirname(fileURLToPath(import.meta.url)); hostDirectory(dirname(runtime));
  const initialDigest = runtimeDigest(runtime);
  const sentinel = randomBytes(32).toString('hex');
  const req = { operation: OPERATION, owner: 'test', repository: 'repo', base: 'main', head: 'reviewed',
    expectedHeadSha: 'a'.repeat(40), title: 'Synthetic approved draft', body: approvedBody, draft: true as const };
  const fake = new FakeGitHub(sentinel, req.owner, req.repository, req.expectedHeadSha);
  const audit = new FileAudit(join(root, 'journal.jsonl'));
  const broker = new Broker(audit, { resolve: async handle => { check(handle === 'fake_internal'); return sentinel; } }, new GitHubDraftProvider(fake));
  const makeTask = (name: string) => ({ agentId: name, taskId: `task_${name}`, workspaceId: `staged_${name}`,
    sourceRevision: { changeId: 'synthetic_change', commit: 'a'.repeat(40), tree: 'b'.repeat(40) } });
  const a = broker.register(makeTask('alpha')); const b = broker.register(makeTask('beta'));
  const lease = broker.issue('task_alpha', req, { handle: 'fake_internal', owner: req.owner, repository: req.repository,
    expiresAt: Date.now() + 300_000, permissions: ['pull_requests:write', 'contents:read'] }, 'synthetic_approval', 'synthetic_request');
  const captured: Buffer[] = [];
  const run = async (name: string, channel: Channel) => {
    const stage = join(root, name); mkdirSync(stage, { mode: 0o700 });
    const child = spawn(process.execPath, [join(runtime, 'agent.js')], { cwd: stage, env: {}, stdio: ['pipe','pipe','pipe'] });
    child.stderr.on('data', data => captured.push(Buffer.from(data)));
    const unbind = bindPipes(channel, child.stdout, child.stdin);
    const timeout = setTimeout(() => child.kill(), 5000);
    child.stdin.write(JSON.stringify({ leaseId: lease.leaseId, request: req }) + '\n');
    try {
      await new Promise<void>((resolve, reject) => {
        child.on('error', () => reject(new Error('HARNESS_CHILD_FAILED')));
        child.on('close', code => code === 0 ? resolve() : reject(new Error('HARNESS_CHILD_FAILED')));
      });
      return JSON.parse(readFileSync(join(stage, 'result.json'), 'utf8')).results as { ok: boolean }[];
    } finally { clearTimeout(timeout); unbind(); }
  };
  try {
    const [alpha, beta] = await Promise.all([run('alpha', a), run('beta', b)]);
    check(runtimeDigest(runtime) === initialDigest);
    const sentinelAbsent = [...files(root).map(p => readFileSync(p)), ...captured].every(buffer => !buffer.includes(sentinel));
    check(sentinelAbsent && fake.writes === 1 && alpha[0].ok && !alpha[1].ok && beta.every(r => !r.ok));
    const result = { fakeWrites: fake.writes, grantedSucceeded: alpha[0].ok, otherDenied: beta.every(r => !r.ok), sentinelAbsent, runtimeDigest: initialDigest, isolation: 'unverified' as const };
    writeFileSync(join(root, 'evidence.json'), JSON.stringify(result, null, 2), { mode: 0o600 }); return result;
  } finally { audit.close(); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runHarness(process.argv[2] ?? '').then(result => process.stdout.write(JSON.stringify(result) + '\n')).catch(() => {
    process.stderr.write('HARNESS_FAILED\n'); process.exitCode = 1;
  });
}
