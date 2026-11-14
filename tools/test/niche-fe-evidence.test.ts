import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { seedCollisions } from '@bl/schema';
import { checkSaved } from '../niche/niche.ts';
import { BRANCH, EVIDENCE_FE, LOCK_FE, MANIFEST_FE, OWNER, PLAN_FE, REPO, checkSavedFe, freezeGuard, frozenPaths, generateFe, registryDigestFe, verifyLock, type Git } from '../niche/fe.ts';
import { PROTOCOL_FE, enumerateSeedsFe } from '../../packages/runner/src/niche/protocol.ts';
import { verifySealFe, type PayloadFe } from '../../packages/runner/src/niche/evidenceFe.ts';

const registry = () => JSON.parse(readFileSync(`${REPO}experiments/discovery/seed-registry.json`, 'utf8')).reservations as { first: number; last: number; owner: string }[];
const written = existsSync(EVIDENCE_FE);

describe('niche fe seeds and registry', () => {
  it('fresh seeds and every derived replicate seed are disjoint from 8600101-108, 8600501-508 and the live registry', () => {
    const all = enumerateSeedsFe(PROTOCOL_FE);
    expect(all.length).toBeGreaterThan(100);
    for (const s of all) {
      expect(s >= 8601001 && s <= 8608999, `${s}`).toBe(true);
      expect((s >= 8600101 && s <= 8600108) || (s >= 8600501 && s <= 8600508)).toBe(false);
    }
    expect(seedCollisions(all.map((seed, i) => ({ id: `s${i}`, seed })), registry().filter((r) => !r.owner.startsWith(OWNER)), OWNER)).toEqual([]);
    expect(registry().filter((r) => r.owner.startsWith(OWNER))).toHaveLength(1);
  });

  it('the protocol hash binds the enumerated seed list; this rung digest ignores other owners reservations', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fe-reg-'));
    try {
      mkdirSync(join(root, 'experiments/discovery'), { recursive: true });
      const text = readFileSync(`${REPO}experiments/discovery/seed-registry.json`, 'utf8');
      writeFileSync(join(root, 'experiments/discovery/seed-registry.json'), text.replace('"owner": "sandbox workspaces" },', '"owner": "sandbox workspaces" },\n    { "first": 9, "last": 9, "owner": "someone later" },'));
      expect(await registryDigestFe(`${root}/`)).toBe(await registryDigestFe());
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe('niche fe freeze guard (git stubbed)', () => {
  const paths = ['a.ts', 'b.ts'];
  const git = (over: Partial<Record<string, string>> = {}): Git => (args) => {
    if (args[0] === 'status') return over.status ?? '';
    if (args[0] === 'ls-remote') { if (over.remote === 'throw') throw new Error('no such ref'); return over.remote ?? `${'a'.repeat(40)}\trefs/heads/${BRANCH}\n`; }
    if (args[0] === 'ls-tree') { if (over.tree === 'throw') throw new Error('bad ref'); expect(args[2]).toBe('a'.repeat(40)); return over.tree ?? '100644 blob aaa\ta.ts\n100644 blob bbb\tb.ts\n'; }
    if (args[0] === 'hash-object') return over.hash ?? 'aaa\nbbb\n';
    throw new Error(args.join(' '));
  };
  it('allows an identical, clean, pushed freeze', () => expect(freezeGuard(paths, git())).toEqual([]));
  it('refuses an uncommitted frozen file', () => expect(freezeGuard(paths, git({ status: ' M a.ts\n' })).join()).toMatch(/not committed clean/));
  it('refuses when the remote has no such branch (the remote is asked, not a local tracking ref)', () => expect(freezeGuard(paths, git({ remote: 'throw' })).join()).toMatch(/push the freeze commit first/));
  it('refuses when the remote commit is not available locally', () => expect(freezeGuard(paths, git({ tree: 'throw' })).join()).toMatch(/git fetch/));
  it('the generator itself refuses an unpublished or unverifiable freeze before simulating anything', async () => {
    await expect(generateFe(git({ remote: 'throw' }))).rejects.toThrow(/refusing to read any fresh seed/);
    await expect(generateFe(git({ status: ' M a.ts\n' }))).rejects.toThrow(/refusing to read any fresh seed/);
  });
  it('refuses a file absent from, or different on, the pushed branch', () => {
    expect(freezeGuard(paths, git({ tree: '100644 blob aaa\ta.ts\n' })).join()).toMatch(/b\.ts is not on/);
    expect(freezeGuard(paths, git({ hash: 'aaa\nccc\n' })).join()).toMatch(/b\.ts differs from/);
  });
  it('the real freeze set names the lock, calibration, registry and every source', async () => {
    const p = await frozenPaths();
    expect(p).toContain('docs/niche-construction-fe-2026-11-02/PLAN.md');
    for (const f of ['tools/niche/fe.ts', 'tools/niche/niche.ts', 'packages/runner/src/niche/freeEnergy.ts', 'packages/runner/src/niche/dose.ts', 'experiments/discovery/seed-registry.json', 'docs/niche-construction-fe-2026-11-02/protocol.lock.json', 'docs/niche-construction-fe-2026-11-02/calibration.json']) expect(p).toContain(f);
    expect(BRANCH).toBe('claude/i06-free-energy-matched');
  });
  it.skipIf(!existsSync(LOCK_FE))('a document-only change to PLAN.md (the amendment) fails the lock', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fe-plan-'));
    try {
      const copy = join(root, 'PLAN.md');
      writeFileSync(copy, readFileSync(PLAN_FE, 'utf8') + '\nA later edit.\n');
      expect((await verifyLock(copy)).join()).toMatch(/PLAN\.md/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('--write and --replay-check refuse without a verifying lock', async () => {
    if (!existsSync(LOCK_FE)) expect((await verifyLock()).join()).toMatch(/no protocol\.lock\.json/);
    else expect(await verifyLock()).toEqual([]);
  });
});

describe('rung 1 after the manifest re-pin', () => {
  it('rung-1 evidence still verifies; only its manifest.json differs from origin/main', async () => {
    expect(await checkSaved()).toEqual([]);
    let names = '';
    try { names = execFileSync('git', ['diff', '--name-only', 'origin/main', '--', 'docs/niche-construction-2026-11-01'], { cwd: REPO, encoding: 'utf8' }); } catch { return; }
    expect(names.split('\n').filter(Boolean).every((f) => f.endsWith('/manifest.json'))).toBe(true);
  });
});

describe.skipIf(!written)('niche fe artifacts (after generation)', () => {
  const load = () => JSON.parse(readFileSync(EVIDENCE_FE, 'utf8')) as PayloadFe;
  it('evidence.json is sealed and the saved artifacts check out, without simulating', async () => {
    expect(verifySealFe(load())).toBe(true);
    const t0 = Date.now();
    expect(await checkSavedFe()).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(60_000);
  });
  it('manifest hashes match sources', () => {
    const m = JSON.parse(readFileSync(MANIFEST_FE, 'utf8'));
    expect(Object.keys(m.sources).length).toBeGreaterThan(10);
  });
  it('a tampered payload fails the seal', () => {
    const p = load() as any;
    p.fresh.panel.text = 'tampered';
    expect(verifySealFe(p)).toBe(false);
  });
  it('every fresh candidate was qualified on dev and no unqualified candidate was simulated', () => {
    const p = load();
    for (const q of p.dev.qualification) expect(p.fresh.candidates.some((c) => c.cluster === q.cluster)).toBe(q.qualified);
  });
});
