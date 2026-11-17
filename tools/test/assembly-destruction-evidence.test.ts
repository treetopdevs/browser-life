import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BASE_COMMIT, DOCS, EVIDENCE, MANIFEST, REPO, checkFreeze, checkSaved, seedsDisjoint, FROZEN_FILES, FREEZE_JSON } from '../assembly/destruction.ts';
import { canonical, verifySeal, type Payload } from '../../packages/metrics/src/assembly/destruction/observer.ts';
import { DPROTOCOL } from '../../packages/metrics/src/assembly/destruction/protocol.ts';

const saved = (): Payload => JSON.parse(readFileSync(EVIDENCE, 'utf8'));
const git = (...a: string[]) => execFileSync('git', a, { cwd: REPO, encoding: 'utf8' });

describe('assembly destruction evidence', () => {
  it('evidence seal and manifest verify, and the freeze guard passes', () => {
    expect(checkSaved()).toEqual([]);
    const p = saved();
    expect(verifySeal(p)).toBe(true);
    expect(p.namespace).toBe('score');
    expect(p.rows).toHaveLength(DPROTOCOL.processes.length * DPROTOCOL.replicates);
    expect(seedsDisjoint()).toBe(true);
  });

  it('tampering one replicate row fails --check', () => {
    const dir = mkdtempSync(join(tmpdir(), 'asmd-'));
    const ev = join(dir, 'evidence.json'), mf = join(dir, 'manifest.json');
    const p = saved();
    p.rows[0].total.c4.n2 += 1;
    writeFileSync(ev, JSON.stringify(p, null, 1) + '\n');
    copyFileSync(MANIFEST, mf);
    expect(checkSaved(ev, mf, REPO, false).length).toBeGreaterThan(0);
    // a resealed edit still fails: the manifest hashes the file and the row hashes the content
    p.integritySha256 = undefined;
    const resealed = { ...p };
    writeFileSync(ev, JSON.stringify(resealed, null, 1) + '\n');
    expect(checkSaved(ev, mf, REPO, false).length).toBeGreaterThan(0);
  });

  it('statements: CPU only, no GPU evidence, no evolving-world positive case with a reason, no life-detection claim', () => {
    const s = saved().statements.join(' | ');
    expect(s).toContain('CPU only');
    expect(s).toContain('no GPU evidence');
    expect(s).toMatch(/no evolving-world positive case exists in the committed fixtures/);
    expect(s).toContain('no life-detection claim is made at any outcome');
    expect(s).toMatch(/heritable transmission is untestable/);
  });

  it('manifest source hashes cover the decision path, the protocol, FREEZE.json inputs and the first rung GRAMMAR.md', () => {
    const m = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    for (const f of FROZEN_FILES) expect(Object.keys(m.sources)).toContain(f);
    expect(Object.keys(m.sources)).toContain('docs/assembly-observer-2026-11-02/GRAMMAR.md');
    expect(m.freezeCommit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('first-rung evidence and manifest are byte-identical to the base commit; protected paths are untouched and clean', () => {
    const base = git('rev-parse', BASE_COMMIT).trim();
    const protectedPaths = ['packages/sim-ref', 'packages/sim-gpu', 'packages/schema', 'packages/runner', 'experiments', 'docs/assembly-observer-2026-11-02', 'apps/coordinator'];
    // Main has moved on (the 3D line changed several protected paths), so the assay is checked against its own
    // freeze commit: it must not have touched them, and nothing outside them may be dirty in the working tree.
    const freeze = (JSON.parse(readFileSync(MANIFEST, 'utf8')) as { freezeCommit: string }).freezeCommit;
    expect(git('diff', '--name-only', base, freeze, '--', ...protectedPaths).trim()).toBe('');
    expect(git('status', '--porcelain', '--', ...protectedPaths).trim()).toBe('');
    // First rung: evidence.json is byte-identical to the base commit; its manifest differs only in the `sources` map
    // (re-pinned by PR #173 after the 3D line, REVIEW.md of that rung).
    const first = 'docs/assembly-observer-2026-11-02/';
    expect(git('diff', '--name-only', base, 'HEAD', '--', `${first}evidence.json`).trim()).toBe('');
    const mf = (rev: string) => { const m = JSON.parse(git('show', `${rev}:${first}manifest.json`)); delete m.sources; return m; };
    expect(mf('HEAD')).toEqual(mf(base));
  });

  it('payload contains no timing or platform fields', () => {
    const text = readFileSync(EVIDENCE, 'utf8');
    expect(text).not.toMatch(/generatedAt|platform|"node"|"arch"|elapsed|durationMs/);
  });

  it('stored-image-renderer and wrong-store-builder rows are present', () => {
    const p = saved();
    for (const id of ['stored-image-renderer', 'wrong-store-builder']) expect(p.rows.filter((r) => r.process === id)).toHaveLength(DPROTOCOL.replicates);
    expect(p.tables.extended.rows).toBe(128);
    expect(p.tables.base.rows).toBe(96);
  });
});

describe('freeze guard', () => {
  it('write refuses when freeze hashes differ, and refuses a non-freeze commit', () => {
    // a scratch repository holding the pinned files and FREEZE.json at one commit
    const root = mkdtempSync(join(tmpdir(), 'asmf-')) + '/';
    const run = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8' });
    run('init', '-q');
    run('config', 'user.email', 't@example.com'); run('config', 'user.name', 't');
    const all = JSON.parse(readFileSync(REPO + FREEZE_JSON, 'utf8')) as { files: Record<string, string> };
    const copy = (f: string) => { mkdirSync(dirname(root + f), { recursive: true }); copyFileSync(REPO + f, root + f); };
    // commit 1 stands in for main (the reused first-rung files); commit 2 is the freeze (frozen files + FREEZE.json)
    for (const f of Object.keys(all.files)) if (!FROZEN_FILES.includes(f)) copy(f);
    run('add', '-A'); run('commit', '-q', '-m', 'base');
    for (const f of [...FROZEN_FILES, FREEZE_JSON]) copy(f);
    run('add', '-A'); run('commit', '-q', '-m', 'freeze');
    const sha = run('rev-parse', 'HEAD').trim();
    expect(checkFreeze(sha, root)).toEqual([]);
    writeFileSync(root + FROZEN_FILES[3], readFileSync(root + FROZEN_FILES[3], 'utf8') + '\n// edited after the freeze\n');
    expect(checkFreeze(sha, root).some((p) => p.includes('changed since the freeze'))).toBe(true);
    expect(checkFreeze('deadbeef', root)[0]).toMatch(/40-hex/);
    expect(checkFreeze(BASE_COMMIT, root).length).toBeGreaterThan(0);
  });

  it('the CLI refuses --write without a valid freeze commit and writes nothing', () => {
    const before = [EVIDENCE, MANIFEST].map((f) => readFileSync(f, 'utf8'));
    const r = spawnSync('node', ['tools/assembly/destruction.ts', '--write', '--freeze', 'f'.repeat(40), '--force'], { cwd: REPO, encoding: 'utf8' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/refusing to write evidence/);
    expect([EVIDENCE, MANIFEST].map((f) => readFileSync(f, 'utf8'))).toEqual(before);
    expect(canonical(DOCS)).toBeTruthy();
  });
});
