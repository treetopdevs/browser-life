import { it, expect } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

it('runs two staged subprocesses with maximum escaped payload over actual inherited pipes', () => {
  const root = mkdtempSync(join(tmpdir(), 'capability-harness-')); const runtime = join(root, 'runtime');
  try {
    execFileSync(resolve('node_modules/.bin/tsc'), ['-p','tools/agent-capabilities/tsconfig.build.json','--outDir',runtime], { stdio: 'pipe' });
    const code = `const {runHarness}=await import(${JSON.stringify(pathToFileURL(join(runtime,'harness.js')).href)}); await runHarness(${JSON.stringify(root)}, '\\0'.repeat(16384));`;
    execFileSync(process.execPath, ['--input-type=module','-e',code], { env: {}, stdio: 'pipe', timeout: 10_000 });
    const evidence = JSON.parse(readFileSync(join(root, 'evidence.json'), 'utf8'));
    expect(evidence).toMatchObject({ fakeWrites: 1, grantedSucceeded: true, otherDenied: true, sentinelAbsent: true, isolation: 'unverified' });
    for (const name of ['alpha','beta']) {
      const agent = JSON.parse(readFileSync(join(root, name, 'result.json'), 'utf8'));
      expect(Object.keys(agent.env).every(key => key === '__CF_USER_TEXT_ENCODING')).toBe(true); expect(agent.argv).toHaveLength(2);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
it('runtime digest detects added, removed, renamed and modified files', async () => {
  const { writeFileSync, renameSync } = await import('node:fs');
  const { runtimeDigest } = await import('../../agent-capabilities/harness.ts');
  const root = mkdtempSync(join(tmpdir(), 'capability-runtime-'));
  try {
    writeFileSync(join(root, 'a.js'), 'reviewed'); const original = runtimeDigest(root);
    writeFileSync(join(root, 'b.js'), 'reviewed'); expect(runtimeDigest(root)).not.toBe(original);
    rmSync(join(root, 'b.js')); expect(runtimeDigest(root)).toBe(original);
    renameSync(join(root, 'a.js'), join(root, 'b.js')); expect(runtimeDigest(root)).not.toBe(original);
    renameSync(join(root, 'b.js'), join(root, 'a.js')); writeFileSync(join(root, 'a.js'), 'modified'); expect(runtimeDigest(root)).not.toBe(original);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
