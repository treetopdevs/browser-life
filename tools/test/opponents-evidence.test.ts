import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CALIBRATION, CONFIG, EVIDENCE, MANIFEST, REPO, checkSaved, sourceFiles } from '../opponents/assay.ts';
import { canonical, recompute, sealPayload, sha256, verifySeal, type Payload } from '../../packages/metrics/src/opponents/evidence.ts';

const saved = (): Payload => JSON.parse(readFileSync(EVIDENCE, 'utf8'));
const node = (args: string[], env: NodeJS.ProcessEnv = {}) => execFileSync(process.execPath, ['--no-warnings', 'tools/opponents/assay.ts', ...args], { cwd: REPO, encoding: 'utf8', env: { ...process.env, VITEST: '', ...env }, maxBuffer: 1 << 28 });

describe('opponents evidence', () => {
  it('evidence seal and manifest verify', () => {
    expect(checkSaved()).toEqual([]);
    const p = saved();
    expect(verifySeal(p)).toBe(true);
    for (const s of ['CPU only', 'no GPU evidence', 'not the M3 environment']) expect(p.statements.some((x) => x.includes(s))).toBe(true);
    expect(JSON.stringify(p)).not.toMatch(/generatedAt|platform|darwin|linux/);
    expect(['assay-sensitive', 'label-or-position-biased', 'insensitive', 'extinction-limited', 'control-invalid']).toContain(p.verdict);
  });

  it('evidence records seeds, panel hex, distances, calibration constants, excluded counts, and the naive comparison', () => {
    const p = saved();
    expect(p.config.seeds).toHaveLength(10);
    expect(Object.keys(p.panel.hex)).toEqual(expect.arrayContaining(['G', 'F1', 'F2', 'F3', 'W', "G'"]));
    expect(p.panel.hex["G'"]).toBe(p.panel.hex.G);
    expect(Object.keys(p.panel.distances)).toHaveLength(10);
    expect(p.constants.floorDiv).toBe(16);
    const cal = JSON.parse(readFileSync(CALIBRATION, 'utf8'));
    expect(cal.effectTarget).toBe(p.config.effectTarget);
    expect(cal.selected.tile).toBe(p.config.arena.tile);
    expect(cal.attempts.length).toBeLessThanOrEqual(36);
    for (const s of Object.values(p.summary.balanced)) { expect(s[3]).toHaveProperty('excluded'); expect(s[3]).toHaveProperty('naiveMean'); }
    expect(p.summary.twin!.naiveDecisiveRate).not.toBeUndefined();
    expect(p.fixtures.rpsSynthetic.synthetic).toBe(true);
  });

  it('verdict in evidence equals the verdict recomputed from the stored gates and raw runs', () => {
    const p = saved();
    expect(recompute(p)).toEqual([]);
    expect(p.gates.verdict).toBe(p.verdict);
  });

  it('a tampered payload, manifest or source is rejected', () => {
    const dir = mkdtempSync(join(tmpdir(), 'opp-'));
    const ev = join(dir, 'evidence.json'), mf = join(dir, 'manifest.json');
    const p = saved();
    p.runs[0].cp[3][0] += 1;
    writeFileSync(ev, JSON.stringify(p, null, 1) + '\n');
    copyFileSync(MANIFEST, mf);
    expect(checkSaved(ev, mf).some((x) => x.includes('integritySha256'))).toBe(true);
    // a manifest hash edited
    const m = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    m.payloadFileSha256 = '0'.repeat(64);
    writeFileSync(mf, JSON.stringify(m));
    expect(checkSaved(EVIDENCE, mf).some((x) => x.includes('payloadFileSha256'))).toBe(true);
    // a source tree with one changed file, and an upstream input (the generalist genome source)
    const root = join(dir, 'root') + '/';
    for (const f of sourceFiles()) { mkdirSync(dirname(root + f), { recursive: true }); copyFileSync(REPO + f, root + f); }
    expect(checkSaved(EVIDENCE, MANIFEST, root)).toEqual([]);
    expect(sourceFiles()).toContain('packages/schema/src/genome.ts');
    writeFileSync(root + 'packages/schema/src/genome.ts', readFileSync(REPO + 'packages/schema/src/genome.ts', 'utf8') + '\n// edit\n');
    expect(checkSaved(EVIDENCE, MANIFEST, root).some((x) => x.includes('genome.ts changed since'))).toBe(true);
    copyFileSync(REPO + 'packages/schema/src/genome.ts', root + 'packages/schema/src/genome.ts');
    writeFileSync(root + 'packages/metrics/src/opponents/extra.ts', 'export const x = 1;\n');
    expect(checkSaved(EVIDENCE, MANIFEST, root).some((x) => x.includes('extra.ts is not in the manifest'))).toBe(true);
  });

  it('a correctly resealed but internally inconsistent payload is rejected', () => {
    const dir = mkdtempSync(join(tmpdir(), 'opp-'));
    const ev = join(dir, 'evidence.json'), mf = join(dir, 'manifest.json');
    const p = saved();
    // edit a summary number and the verdict, recompute the seal, and rewrite the manifest hashes to match
    p.summary.matrix.cycles = [['G', 'F1', 'F2']];
    p.verdict = p.verdict === 'assay-sensitive' ? 'insensitive' : 'assay-sensitive';
    const resealed = sealPayload(p);
    const text = JSON.stringify(resealed, null, 1) + '\n';
    writeFileSync(ev, text);
    const m = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    m.payloadFileSha256 = sha256(text);
    m.integritySha256 = resealed.integritySha256;
    m.verdict = resealed.verdict;
    writeFileSync(mf, JSON.stringify(m));
    const problems = checkSaved(ev, mf);
    expect(problems.some((x) => x.includes('stored summary differs') || x.includes('stored verdict'))).toBe(true);
    expect(canonical(p)).not.toBe(canonical(saved()));
  });

  /** Edit the payload, reseal it, and rewrite the manifest hashes (and optionally manifest fields) so only deep checks can notice. */
  function resealed(edit: (p: Payload) => void, editManifest?: (m: Record<string, any>) => void): string[] {
    const dir = mkdtempSync(join(tmpdir(), 'opp-'));
    const ev = join(dir, 'evidence.json'), mf = join(dir, 'manifest.json');
    const p = saved();
    edit(p);
    const r = sealPayload(p);
    const text = JSON.stringify(r, null, 1) + '\n';
    writeFileSync(ev, text);
    const m = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    m.payloadFileSha256 = sha256(text);
    m.integritySha256 = r.integritySha256;
    m.verdict = r.verdict;
    editManifest?.(m);
    writeFileSync(mf, JSON.stringify(m));
    return checkSaved(ev, mf);
  }

  it('resealed payloads with impossible records or altered frozen metadata are rejected', () => {
    expect(resealed(() => {})).toEqual([]);
    // impossible raw record: a negative cell count
    expect(resealed((p) => { p.runs[0].cp[3][2] = -42; }).some((x) => x.includes('invalid run record'))).toBe(true);
    // an extra checkpoint tuple
    expect(resealed((p) => { p.runs[0].cp.push([1, 1, 1, 1]); }).some((x) => x.includes('invalid run record'))).toBe(true);
    // inventories that are possible in isolation but not what the frozen world holds
    const ci = (p: Payload) => p.runs.findIndex((r) => r.key === 'c|G|F1|rA|R1|101');
    expect(resealed((p) => { p.runs[ci(p)].b0 = [1, 1]; }).some((x) => x.includes('step-zero'))).toBe(true);
    expect(resealed((p) => { p.runs[ci(p)].e0 = [0, 0]; }).some((x) => x.includes('step-zero'))).toBe(true);
    expect(resealed((p) => { p.runs[0].cp[3][0] = 1; p.runs[0].cp[3][2] = 512; }).some((x) => x.includes('fewer biomass units'))).toBe(true);
    expect(resealed((p) => { p.runs[0].cp[3][0] = 2 ** 27; }).some((x) => x.includes('matter bound'))).toBe(true);
    expect(resealed((p) => { const s = p.runs.find((r) => r.key[0] === 's')!; s.e0[1] = 5; }).some((x) => x.includes('energy on a second label'))).toBe(true);
    // the weakened genome replaced by the generalist's
    expect(resealed((p) => { p.panel.hex.W = p.panel.hex.G; }).some((x) => x.includes('payload panel'))).toBe(true);
    // schedule count changed, in the payload and in the manifest
    expect(resealed((p) => { p.schedule.contests = 1; }, (m) => { m.schedule.contests = 1; }).some((x) => x.includes('schedule'))).toBe(true);
    // final checkpoint relabelled
    const relabel = (p: Payload) => { p.constants.checkpoints[3] = 30000; };
    expect(resealed(relabel, (m) => { m.constants.checkpoints[3] = 30000; }).some((x) => x.includes('constants'))).toBe(true);
    // a threshold constant edited
    expect(resealed((p) => { p.constants.floorDiv = 8; }, (m) => { m.constants.floorDiv = 8; }).some((x) => x.includes('constants'))).toBe(true);
  });

  it('frozen config file matches the saved payload and the calibration file exists', () => {
    expect(canonical(saved().config)).toBe(canonical(CONFIG));
    expect(existsSync(CALIBRATION)).toBe(true);
  });

  it('the CLI check runs as a subprocess', () => {
    expect(node(['--check'])).toContain('--check ok');
  }, 120_000);

  it('workers resolve @bl/* without vitest aliases', () => {
    const out = node(['--mini', '--print', '--jobs', '2']);
    const p = JSON.parse(out) as Payload;
    expect(p.runs.length).toBeGreaterThan(10);
    expect(verifySeal(p)).toBe(true);
  }, 240_000);

  it('worker count does not change output; mini regeneration equals itself', () => {
    const a = node(['--mini', '--print', '--jobs', '1']);
    const b = node(['--mini', '--print', '--jobs', '3']);
    expect(a).toBe(b);
    expect(node(['--mini', '--print', '--jobs', '2'])).toBe(a);
  }, 600_000);
});
