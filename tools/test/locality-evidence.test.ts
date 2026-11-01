import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RULE, verdictFromPayload, type Payload } from '@bl/lineage';
import { EVIDENCE, MANIFEST, REPO, canonical, checkSaved, sha256, sourceFiles, verifySeal } from '../locality/matrix.ts';

const saved = (): Payload => JSON.parse(readFileSync(EVIDENCE, 'utf8'));
const hasDeno = (() => { try { execFileSync('deno', ['--version'], { stdio: 'pipe' }); return true; } catch { return false; } })();

describe('controller locality evidence', () => {
  it('evidence seal and manifest verify', () => {
    expect(checkSaved()).toEqual([]);
    const p = saved();
    expect(verifySeal(p)).toBe(true);
    expect(p.statements[0]).toMatch(/CPU only/);
    expect(p.statements.join(' ')).toMatch(/Exploratory/);
    expect(JSON.stringify(p)).not.toMatch(/generatedAt|darwin|linux|"platform"/);
    expect(p.grid.points).toBe(26244);
  });

  it('a tampered payload, manifest or source is rejected', () => {
    const dir = mkdtempSync(join(tmpdir(), 'loc-'));
    const ev = join(dir, 'evidence.json'), mf = join(dir, 'manifest.json');
    const p = saved();
    p.rows[0].breadth += 1;
    writeFileSync(ev, JSON.stringify(p, null, 1) + '\n');
    copyFileSync(MANIFEST, mf);
    const problems = checkSaved(ev, mf);
    expect(problems.some((x) => x.includes('integritySha256'))).toBe(true);
    expect(problems.some((x) => x.includes('payloadFileSha256'))).toBe(true);
    const root = join(dir, 'root') + '/';
    for (const f of sourceFiles()) { mkdirSync(dirname(root + f), { recursive: true }); copyFileSync(REPO + f, root + f); }
    writeFileSync(root + 'packages/lineage/src/locality/scenarios.ts', readFileSync(REPO + 'packages/lineage/src/locality/scenarios.ts', 'utf8') + '\n// edit\n');
    expect(checkSaved(EVIDENCE, MANIFEST, root).some((x) => x.includes('changed since'))).toBe(true);
    // a row dropped from the schema is reported
    const q = saved();
    delete (q.rows[1] as unknown as Record<string, unknown>).breadth;
    const { integritySha256: _s, ...rest } = q; void _s;
    q.integritySha256 = sha256(canonical(rest));
    writeFileSync(ev, JSON.stringify(q, null, 1) + '\n');
    expect(checkSaved(ev, mf).some((x) => x.includes('lacks breadth'))).toBe(true);
  });

  it('a tampered payload that is resealed is still caught by recomputation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'loc-reseal-'));
    const ev = join(dir, 'evidence.json'), mf = join(dir, 'manifest.json');
    copyFileSync(MANIFEST, mf);
    const resealed = (edit: (p: Payload) => void): string[] => {
      const p = saved();
      edit(p);
      const { integritySha256: _s, ...rest } = p; void _s;
      p.integritySha256 = sha256(canonical(rest));
      writeFileSync(ev, JSON.stringify(p, null, 1) + '\n');
      return checkSaved(ev, mf);
    };
    expect(resealed((p) => { p.readouts[1].overall.improving += 1; }).some((x) => x.includes('readout does not follow'))).toBe(true);
    expect(resealed((p) => { p.rows[3].realisedL1 += 1; }).some((x) => x.includes('realisedL1'))).toBe(true);
    expect(resealed((p) => { p.rows[3].requestedL1 += 1; }).some((x) => x.includes('requestedL1'))).toBe(true);
    expect(resealed((p) => { const r = p.rows.find((x) => x.cls === 'genuine')!; r.cls = 'unchanged'; }).some((x) => x.includes('cls'))).toBe(true);
    expect(resealed((p) => { const g = p.genomes[1].id; p.strata[g][Object.keys(p.strata[g])[0]].population += 50; }).some((x) => x.includes('counts do not follow'))).toBe(true);
    expect(resealed((p) => { p.nullBreadth[p.genomes[1].id].median2 += 2; }).some((x) => x.includes('median2'))).toBe(true);
    expect(resealed((p) => { p.genomes[1].tau[0] += 1; }).some((x) => x.includes('tau does not follow'))).toBe(true);
    expect(resealed((p) => { const r = p.rows.find((x) => x.assay)!; r.assay!.dev[0] += 1; }).some((x) => x.includes('assay dev'))).toBe(true);
    expect(resealed((p) => { p.rows[5].breadth += 1; }).some((x) => x.includes('breadth does not follow'))).toBe(true);
    expect(resealed((p) => { p.candidates[0].chosen = !p.candidates[0].chosen; }).some((x) => x.includes('selection rule'))).toBe(true);
    expect(resealed((p) => { (p.protocol as { rule: { minImproving: number } }).rule.minImproving = 1; }).some((x) => x.includes('protocol differs'))).toBe(true);
    expect(resealed((p) => { p.fixtures[0].passes = !p.fixtures[0].passes; }).some((x) => x.includes('passes does not follow'))).toBe(true);
    expect(resealed((p) => { p.sensitivity.passes = !p.sensitivity.passes; }).some((x) => x.includes('sensitivity.passes'))).toBe(true);
    expect(resealed((p) => { p.genomes[1].qualification.pass = !p.genomes[1].qualification.pass; }).some((x) => x.includes('qualification'))).toBe(true);
  });

  it('fixture rows show the naive metric disagreeing with the functional one', () => {
    const fx = saved().fixtures;
    const perm = fx.find((f) => f.id === 'generalist-hidden-permutation')!;
    expect(perm.naive.bytesChanged).toBeGreaterThanOrEqual(8);
    expect(perm.functional.changedOutputs).toBe(0);
    expect(perm.physical).toEqual({ dev: [0, 0, 0], identical: true });
    const dead = fx.find((f) => f.id === 'generalist-dead-hidden-edit')!;
    expect(dead.naive.bytesChanged).toBe(1);
    expect(dead.functional.changedOutputs).toBe(0);
    const clamp = fx.find((f) => f.id === 'generalist-clamp-edit')!;
    expect(clamp.naive.bytesChanged).toBe(0);
    const shuffle = fx.find((f) => f.id === 'generalist-shuffled-sensor-labels')!;
    expect(shuffle.functional.changedOutputs).toBeGreaterThan(0);
    expect(shuffle.physical.identical).toBe(false);
    expect(fx.filter((f) => f.neutral).every((f) => f.passes)).toBe(true);
  });

  it('decision rule is computed from rows and states its thresholds', () => {
    const p = saved();
    expect(canonical(verdictFromPayload(p))).toBe(canonical(p.verdict));
    expect(p.verdict.rule).toEqual(JSON.parse(JSON.stringify(RULE)));
    expect(p.verdict.inputs.every((i) => i.genome !== 'generalist')).toBe(true);
    expect(p.genomes.find((g) => g.id === 'generalist')!.votes).toBe(false);
    for (const g of p.genomes.filter((x) => x.votes)) expect(g.qualification.pass).toBe(true);
    expect(p.candidates.some((c) => !c.qualification.pass)).toBe(true);
    expect(p.sensitivity.passes).toBe(true);
  });

  it('fixtures never enter a rate: rows carry only generated neighbourhood edits', () => {
    const p = saved();
    expect(p.rows.every((r) => /^(single6|single24|multi2|multi4|multi2x24|multi4x24):\d+$/.test(r.id))).toBe(true);
  });

  it.skipIf(!hasDeno)('--check runs as a subprocess', () => {
    const out = execFileSync('deno', ['run', '-A', '--no-lock', 'tools/locality/matrix.ts', '--check'], { cwd: REPO, encoding: 'utf8' });
    expect(out).toContain('--check ok');
  }, 120_000);

  // The replay runs under Deno (about a minute of CPU); the same function under vitest's node transform is an order of magnitude slower.
  it.skipIf(!hasDeno)('replay reproduces byte for byte (--replay-check subprocess)', () => {
    const out = execFileSync('deno', ['run', '-A', '--no-lock', 'tools/locality/matrix.ts', '--replay-check'], { cwd: REPO, encoding: 'utf8' });
    expect(out).toContain('--replay-check ok');
  }, 600_000);
});
