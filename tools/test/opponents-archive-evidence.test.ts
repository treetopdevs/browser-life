import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ARCHIVE, CONFIG, EVIDENCE, MANIFEST, REPO, checkFixture, checkSaved, freezeCheck, freezeCommit, frozenFiles, generatePayload, mini, sampled, serialize, sourceFiles } from '../opponents/archive.ts';
import { checkSaved as firstRungCheck } from '../opponents/assay.ts';
import { recompute, sealPayload, verifySeal, STATEMENTS, type ArchiveFixture, type Payload } from '../../packages/metrics/src/archive-tournament/evidence.ts';

const node = (args: string[], env: NodeJS.ProcessEnv = {}) => execFileSync(process.execPath, ['--no-warnings', 'tools/opponents/archive.ts', ...args], { cwd: REPO, encoding: 'utf8', env: { ...process.env, VITEST: '', ...env }, maxBuffer: 1 << 28 });
const fixture = (): ArchiveFixture => JSON.parse(readFileSync(ARCHIVE, 'utf8'));
const hasEvidence = existsSync(EVIDENCE) && existsSync(MANIFEST);
const RUNS = process.env.RUNS ?? '/Users/nicholas/develop/browser-life/runs';

describe('archive fixture', () => {
  it('the frozen fixture is internally consistent and every snapshot passed the viability screen', () => {
    const { problems } = checkFixture(fixture(), CONFIG, null);
    expect(problems).toEqual([]);
    const fx = fixture();
    expect(fx.sources.map((s) => s.short)).toEqual(CONFIG.sources.map((s) => s.short));
    for (const s of fx.sources) expect(s.snapshots.length).toBeGreaterThanOrEqual(CONFIG.minViableBins);
    expect(fx.sources.some((s) => s.snapshots.some((x) => x.sharedWith.length > 0))).toBe(true); // shared genomes are flagged, not hidden
    expect(fx.transferConditions.some((t) => t.includes('exact:false'))).toBe(true);
  });
  it.skipIf(!existsSync(`${RUNS}/bootstrap-m3/archive.json`))('archive fixture hexes decode and match source file SHA-256 and recomputed selection when RUNS is present', () => {
    expect(checkFixture(fixture(), CONFIG, RUNS)).toEqual({ problems: [], note: null });
  });
  it('a viable flag that contradicts its recorded counts is rejected', () => {
    const fx = fixture();
    fx.sources[0].screens[0].b300 = [0, 0, 0];
    expect(checkFixture(fx, CONFIG, null).problems.some((p) => p.includes('contradicts'))).toBe(true);
    const fy = fixture();
    fy.sources[0].screens[0].b0 = [1, 2];
    expect(checkFixture(fy, CONFIG, null).problems.some((p) => p.includes('malformed'))).toBe(true);
  });
  it('a changed source hash or selection is rejected when RUNS is present', () => {
    if (!existsSync(`${RUNS}/bootstrap-m3/archive.json`)) return;
    const fx = fixture();
    fx.sources[0].fileSha256 = '0'.repeat(64);
    expect(checkFixture(fx, CONFIG, RUNS).problems.some((p) => p.includes('SHA-256'))).toBe(true);
    const fy = fixture();
    fy.sources[0].bins[2].snapshot = null;
    expect(checkFixture(fy, CONFIG, RUNS).problems.some((p) => p.includes('selection differs'))).toBe(true);
  });
});

describe('first rung is untouched', () => {
  it('first rung --check still passes with the new library present', () => {
    expect(firstRungCheck()).toEqual([]);
    const out = execFileSync(process.execPath, ['--no-warnings', 'tools/opponents/assay.ts', '--check'], { cwd: REPO, encoding: 'utf8', env: { ...process.env, VITEST: '' } });
    expect(out).toContain('--check ok');
  });
});

describe('mini regeneration', () => {
  it('mini payload recomputes, seals, and carries the required statements', async () => {
    const { cfg, fx } = mini();
    const p = await generatePayload(cfg, fx, '', 1);
    expect(verifySeal(p)).toBe(true);
    expect(recompute(p, fx)).toEqual([]);
    expect(p.statements).toEqual(STATEMENTS);
    for (const s of ['CPU only', 'no GPU evidence', 'not the M3 environment', 'archive time is search time']) expect(p.statements.some((x) => x.includes(s))).toBe(true);
    expect(JSON.stringify(p)).not.toMatch(/generatedAt|darwin|linux/);
    expect(Object.keys(p.summary)).not.toContain('pooled');
    // two seeds at 60 steps cannot validate the planted chain (K=3 floor is 1/6): the mini only checks that the machinery runs
    expect(typeof p.summary.global.assayOk).toBe('boolean');
    expect(p.summary.chain.fixture.id).toBe('planted-chain');
    expect(p.summary.sources[0].twin.labelInvariance).toBe(true);
    expect(p.summary.starved!.inventories).toHaveLength(4); // 60 steps is too short to reach the floor; the 300-step starved arena is checked below
    // the verdict is recomputed from the raw runs, so an edited run record is caught by the seal and by recompute
    const t = JSON.parse(JSON.stringify(p)) as Payload;
    t.runs[0].cp[3][0] += 1;
    expect(verifySeal(t)).toBe(false);
    expect(recompute(sealPayload(t), fx).length).toBeGreaterThan(0);
  }, 900000);
  it('worker count does not change output; mini regeneration equals itself', () => {
    const a = node(['--mini', '--print', '--jobs', '1']), b = node(['--mini', '--print', '--jobs', '3']), c = node(['--mini', '--print', '--jobs', '3']);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(a.length).toBeGreaterThan(1000);
  }, 300000);
  it('the replay sample is deterministic', () => {
    expect(sampled('c|a|b|bal|P1|1001', 25)).toBe(sampled('c|a|b|bal|P1|1001', 25));
    const n = Array.from({ length: 1000 }, (_, i) => sampled(`k${i}`, 25)).filter(Boolean).length;
    expect(n).toBeGreaterThan(150);
    expect(n).toBeLessThan(350);
  });
});

describe('freeze-check', () => {
  const sh = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' });
  const setup = (withOutcome: boolean) => {
    const dir = mkdtempSync(join(tmpdir(), 'frz-')) + '/';
    sh(dir, 'init', '-q', '-b', 'main');
    sh(dir, 'config', 'user.email', 't@t'); sh(dir, 'config', 'user.name', 't');
    const put = (f: string, t: string) => { mkdirSync(dirname(dir + f), { recursive: true }); writeFileSync(dir + f, t); };
    put('tools/opponents/archive-config.json', '{}\n');
    put('lib.ts', 'export const x = 1;\n');
    if (withOutcome) put('docs/historical-opponents-archive-2026-11-02/evidence.json', '{}\n');
    sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', 'freeze');
    return { dir, files: ['tools/opponents/archive-config.json', 'lib.ts'], put };
  };
  it('freeze-check passes on a clean freeze and fails when an inventoried code file changes', () => {
    const { dir, files, put } = setup(false);
    expect(freezeCheck(dir, files, undefined, dir + 'none.json').problems).toEqual([]);
    put('later.txt', 'outcome later\n');
    sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', 'outcomes after');
    expect(freezeCheck(dir, files, undefined, dir + 'none.json').problems).toEqual([]);
    put('lib.ts', 'export const x = 2;\n'); // one mutated library line after the freeze
    const r = freezeCheck(dir, files, undefined, dir + 'none.json');
    expect(r.problems.some((p) => p.includes('lib.ts changed after the freeze'))).toBe(true);
    sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', 'sneaky change'); // committing it does not launder it
    expect(freezeCheck(dir, files, undefined, dir + 'none.json').problems.some((p) => p.includes('lib.ts changed after the freeze'))).toBe(true);
  });
  it('freeze-check fails when an outcome file is in the freeze commit, and when no freeze exists', () => {
    const { dir, files } = setup(true);
    expect(freezeCheck(dir, files, undefined, dir + 'none.json').problems.some((p) => p.includes('outcome file'))).toBe(true);
    const empty = mkdtempSync(join(tmpdir(), 'frz-')) + '/';
    sh(empty, 'init', '-q', '-b', 'main'); sh(empty, 'config', 'user.email', 't@t'); sh(empty, 'config', 'user.name', 't');
    writeFileSync(empty + 'a', '1'); sh(empty, 'add', '-A'); sh(empty, 'commit', '-q', '-m', 'x');
    expect(freezeCheck(empty, [], undefined, empty + 'none.json').problems[0]).toContain('no freeze commit');
  });
  it('freeze-check passes on the real branch', () => {
    if (!freezeCommit(REPO)) return; // before the freeze commit exists
    expect(freezeCheck().problems).toEqual([]);
    expect(frozenFiles().length).toBeGreaterThan(8);
  });
});

describe.skipIf(!hasEvidence)('saved evidence', () => {
  const saved = (): Payload => JSON.parse(readFileSync(EVIDENCE, 'utf8'));
  it('evidence seal and manifest verify', () => {
    expect(checkSaved()).toEqual([]);
    expect(verifySeal(saved())).toBe(true);
    expect(JSON.stringify(saved())).not.toMatch(/generatedAt|platform|darwin|linux/);
  });
  it('verdict in evidence equals the verdict recomputed from stored gates and raw runs', () => {
    const p = saved();
    expect(recompute(p, fixture())).toEqual([]);
    expect(Object.keys(p.verdict)).toEqual(Object.keys(p.verdict).filter((k) => CONFIG.sources.some((s) => s.short === k)));
  });
  it('tampered payload, manifest, archive fixture or source is rejected; a resealed inconsistent payload is rejected', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arc-'));
    const ev = join(dir, 'evidence.json'), mf = join(dir, 'manifest.json'), ar = join(dir, 'archive.json');
    const p = saved();
    p.runs[0].cp[3][0] += 1;
    writeFileSync(ev, serialize(p));
    copyFileSync(MANIFEST, mf); copyFileSync(ARCHIVE, ar);
    expect(checkSaved({ evidencePath: ev, manifestPath: mf, archivePath: ar }).some((x) => x.includes('integritySha256'))).toBe(true);
    // resealed but inconsistent: the summary no longer follows from the runs
    writeFileSync(ev, serialize(sealPayload(p)));
    const m = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    m.payloadFileSha256 = sha(readFileSync(ev, 'utf8')); m.integritySha256 = sealPayload(p).integritySha256;
    writeFileSync(mf, JSON.stringify(m));
    expect(checkSaved({ evidencePath: ev, manifestPath: mf, archivePath: ar }).some((x) => x.includes('summary differs') || x.includes('differs'))).toBe(true);
    // edited archive fixture
    const fx = fixture(); fx.sources[0].snapshots[0].quality += 0.1;
    writeFileSync(ar, serialize(fx));
    expect(checkSaved({ evidencePath: EVIDENCE, manifestPath: MANIFEST, archivePath: ar }).some((x) => x.includes('archive.json changed'))).toBe(true);
    // a source tree with one changed file
    const root = join(dir, 'root') + '/';
    for (const f of [...sourceFiles(), 'docs/historical-opponents-2026-11-01/evidence.json']) { mkdirSync(dirname(root + f), { recursive: true }); copyFileSync(REPO + f, root + f); }
    expect(checkSaved({ root, runsDir: null })).toEqual([]);
    writeFileSync(root + 'packages/metrics/src/archive-tournament/index.ts', readFileSync(root + 'packages/metrics/src/archive-tournament/index.ts', 'utf8') + '\n// edit\n');
    expect(checkSaved({ root, runsDir: null }).some((x) => x.includes('changed since the evidence was written'))).toBe(true);
  });
});
import { sha256 as sha } from '../../packages/metrics/src/archive-tournament/evidence.ts';
