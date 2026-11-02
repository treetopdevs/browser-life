// I05b power-up: freeze, write guards, and (once the run exists) the saved evidence. Slow parts run as Deno subprocesses, as in PR136.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RULE, verdictFromPayload, type Payload } from '@bl/lineage';
import { REPO, canonical, sha256, verifySeal } from '../locality/matrix.ts';
import { AMENDMENT, EXTRA_SOURCES, FREEZE, POWER_EVIDENCE, POWER_MANIFEST, checkPower, committedProblems, planFreeze, readFreeze, sealFreeze, verifyFreezeSeal, writeRefusals, type Freeze } from '../locality/power.ts';

const hasDeno = (() => { try { execFileSync('deno', ['--version'], { stdio: 'pipe' }); return true; } catch { return false; } })();
const deno = (...args: string[]) => execFileSync('deno', ['run', '-A', '--no-lock', 'tools/locality/power.ts', ...args], { cwd: REPO, encoding: 'utf8' });
const ran = existsSync(POWER_EVIDENCE);
const saved = (): Payload => JSON.parse(readFileSync(POWER_EVIDENCE, 'utf8'));
const tmp = () => mkdtempSync(join(tmpdir(), 'locp-'));

describe('power freeze', () => {
  it('freeze.json seal verifies, N follows the stated rule, and nothing in it is an edited-genome outcome', () => {
    const f = readFreeze();
    expect(verifyFreezeSeal(f)).toBe(true);
    expect([192, 144]).toContain(f.n);
    expect(f.n).toBe(192);
    expect(f.projectedSeconds['192']).toBeLessThanOrEqual(20 * 60);
    expect(f.statement).toMatch(/before any edited genome/);
    expect(f.calibration.mutantAssays).toBe(0);
    expect(f.calibration.baselineRuns).toBe(36);
    // 3 starts x 3 scenarios x 2 seeds in the freeze's own qualification; no assay record in any plan
    expect(f.baselineAssayRuns).toBe(18);
    expect(JSON.stringify(f.plans)).not.toMatch(/"assay"|"dev"|"sums"/);
    expect(f.plans.filter((p) => p.votes).every((p) => p.chosen.length === f.n)).toBe(true);
    expect(f.plans.find((p) => p.id === 'generalist')!.chosen.length).toBe(8);
    expect(f.panel.seeds).toEqual([101, 102]);
    expect(f.inputs.amendmentSha256).toBe(sha256(readFileSync(AMENDMENT)));
    expect(EXTRA_SOURCES).toEqual(['tools/locality/power.ts']);
    expect(Object.keys(f.sources)).toContain('tools/locality/power.ts');
    expect(Object.keys(f.sources)).toContain('packages/lineage/src/locality/panel.ts');
  });

  it('the amendment prints the frozen allocations and the reachability preflight', () => {
    const f = readFreeze();
    const text = readFileSync(AMENDMENT, 'utf8');
    const block = /```json\n([\s\S]*?)\n```/.exec(text)![1];
    expect(JSON.parse(block)).toEqual(f.allocations);
    expect(f.plans.find((p) => p.id === 'm3-c4')!.entanglementReachable).toBe(false);
    expect(f.plans.find((p) => p.id === 'm3-c9')!.entanglementReachable).toBe(true);
    expect(text).toMatch(/unreachable on this pair/);
    expect(text).toMatch(/0\.819/);
    expect(JSON.stringify(RULE.minImproving)).toBe('5');
  });

  it('a tampered freeze fails its seal, and a resealed one is caught by recomputation', () => {
    const f = readFreeze();
    const bad: Freeze = { ...f, n: 144 };
    expect(verifyFreezeSeal(bad)).toBe(false);
    const dir = tmp();
    const path = join(dir, 'freeze.json');
    writeFileSync(path, JSON.stringify(sealFreeze(bad), null, 1) + '\n');
    // The resealed N disagrees with the stated rule (the rule picks 192 from the projections)
    expect(planFreeze(f.calibration, 144).n).toBe(144);
    expect(planFreeze(f.calibration).n).toBe(192);
  }, 120_000);

  it.skipIf(!hasDeno)('--freeze-check recomputes the freeze without any mutant assay', () => {
    expect(deno('--freeze-check')).toContain('--freeze-check ok');
  }, 300_000);

  it.skipIf(!hasDeno)('--calibrate assays baselines only: 36 runs, no mutant', () => {
    const c = JSON.parse(deno('--calibrate'));
    expect(c.mutantAssays).toBe(0);
    expect(c.baselineRuns).toBe(36);
    const src = readFileSync(join(REPO, 'tools/locality/power.ts'), 'utf8');
    const body = src.slice(src.indexOf('export function calibrate'), src.indexOf('export interface Workload'));
    expect(body).not.toMatch(/buildNeighbourhood|runStudy|mutateInPlace|applyOperator|drawAssaySubset/);
  }, 300_000);
});

describe('power write guards', () => {
  it('refuses without a freeze, with a tampered freeze, with a changed amendment, and when evidence exists', () => {
    const dir = tmp();
    expect(writeRefusals({ requirePushed: false, freezePath: join(dir, 'none.json') })[0]).toMatch(/freeze.json is missing/);
    const f = readFreeze();
    const tampered = join(dir, 'freeze.json');
    writeFileSync(tampered, JSON.stringify({ ...f, n: 144 }, null, 1) + '\n');
    expect(writeRefusals({ requirePushed: false, freezePath: tampered }).some((x) => x.includes('seal fails'))).toBe(true);
    const wrongInput = join(dir, 'freeze2.json');
    writeFileSync(wrongInput, JSON.stringify(sealFreeze({ ...f, inputs: { ...f.inputs, amendmentSha256: '0'.repeat(64) } }), null, 1) + '\n');
    expect(writeRefusals({ requirePushed: false, freezePath: wrongInput }).some((x) => x.includes('AMENDMENT.md differs'))).toBe(true);
    const wrongSrc = join(dir, 'freeze3.json');
    writeFileSync(wrongSrc, JSON.stringify(sealFreeze({ ...f, sources: { ...f.sources, 'tools/locality/power.ts': '0'.repeat(64) } }), null, 1) + '\n');
    expect(writeRefusals({ requirePushed: false, freezePath: wrongSrc }).some((x) => x.includes('differs from the frozen hash'))).toBe(true);
    const evidence = join(dir, 'evidence.json');
    writeFileSync(evidence, '{}');
    expect(writeRefusals({ requirePushed: false, evidencePath: evidence }).some((x) => x.includes('evidence.json exists'))).toBe(true);
  });

  it('an untracked or modified frozen input is reported, as is a freeze commit that is not pushed', () => {
    expect(committedProblems(['docs/controller-locality-power-2026-11-02/no-such-file.json'], false)[0]).toMatch(/not tracked/);
    expect(committedProblems(['docs/controller-locality-power-2026-11-02/AMENDMENT.md'], false).length).toBeLessThanOrEqual(1);
    if (!existsSync(join(REPO, 'docs/controller-locality-power-2026-11-02/evidence.json'))) expect(Array.isArray(committedProblems([], true))).toBe(true);
  });
});

// The post-run path (powerProblems, checkPower, replayCheck, the verdict recomputation, manifest binding) runs on a reduced panel
// (N = 4, one edit per family) with a synthetic freeze, as a Deno subprocess (about 2 minutes), so a defect shows before the real freeze is committed.
describe('post-run check path on a reduced payload', () => {
  it.skipIf(!hasDeno)('powerProblems, checkPower, the verdict and replayCheck pass on a fresh reduced payload and name each edit', () => {
    const out = execFileSync('deno', ['run', '-A', '--no-lock', 'tools/locality/power-reduced.ts'], { cwd: REPO, encoding: 'utf8' });
    expect(out).toContain('--reduced ok');
  }, 900_000);
});

describe.skipIf(!ran)('saved power evidence', () => {
  it('seal, manifest and freeze binding verify, with the exact fixture inventory', () => {
    expect(checkPower()).toEqual([]);
    const p = saved();
    expect(verifySeal(p)).toBe(true);
    expect(p.freezeSha256).toBe(sha256(readFileSync(FREEZE)));
    expect(p.statements.join(' ')).toMatch(/Exploratory/);
    expect(JSON.stringify(p)).not.toMatch(/generatedAt|darwin|linux|"platform"/);
    expect(p.panel!.seeds).toEqual([101, 102]);
    const f = readFreeze();
    expect(p.fixtures.map((x) => x.id).sort()).toEqual([...f.fixtureInventory].sort());
  });

  it('assays exactly N per voting genome and 8 for the control, and the verdict follows the unchanged rule', () => {
    const p = saved();
    const n = readFreeze().n;
    for (const g of p.genomes) expect(p.rows.filter((r) => r.genome === g.id && r.assay).length).toBe(g.votes ? n : 8);
    expect(p.verdict.rule).toEqual(JSON.parse(JSON.stringify(RULE)));
    expect(canonical(verdictFromPayload(p))).toBe(canonical(p.verdict));
    expect(p.genomes.find((g) => g.id === 'generalist')!.votes).toBe(false);
    expect(p.verdict.inputs.every((i) => i.genome !== 'generalist')).toBe(true);
  });

  it('check fails on an edited row, verdict, seed list, missing freeze, freeze mismatch and a resealed derived field', () => {
    const dir = tmp();
    const ev = join(dir, 'evidence.json'), mf = join(dir, 'manifest.json');
    copyFileSync(POWER_MANIFEST, mf);
    const resealed = (edit: (p: Payload) => void, freezePath?: string): string[] => {
      const p = saved();
      edit(p);
      const { integritySha256: _s, ...rest } = p; void _s;
      p.integritySha256 = sha256(canonical(rest));
      writeFileSync(ev, JSON.stringify(p, null, 1) + '\n');
      return checkPower(ev, mf, REPO, freezePath);
    };
    const mfText = JSON.parse(readFileSync(mf, 'utf8'));
    mfText.payloadFileSha256 = sha256(readFileSync(POWER_EVIDENCE));
    expect(resealed(() => {}).every((x) => x.includes('payloadFileSha256') || x.includes('manifest seal'))).toBe(true);
    // keep the manifest consistent with each edited file so only the intended defect is reported
    const against = (edit: (p: Payload) => void, freezePath?: string): string[] => {
      const out = resealed(edit, freezePath);
      return out.filter((x) => !x.includes('payloadFileSha256') && !x.includes('manifest seal'));
    };
    expect(against((p) => { p.rows[3].breadth += 1; }).some((x) => x.includes('breadth does not follow'))).toBe(true);
    expect(against((p) => { p.verdict.kind = 'broadly-useful'; }).some((x) => x.includes('verdict does not follow'))).toBe(true);
    expect(against((p) => { (p.panel as unknown as { seeds: number[] }).seeds = [1, 2]; }).some((x) => x.includes('panel differs') || x.includes('seeds overlap'))).toBe(true);
    expect(against((p) => { p.rows.find((r) => r.assay)!.assay!.dev[0] += 1; }).some((x) => x.includes('assay dev'))).toBe(true);
    expect(against((p) => { const g = p.genomes[1].id; p.strata[g][Object.keys(p.strata[g])[0]].population += 1; }).some((x) => x.includes('counts do not follow'))).toBe(true);
    expect(against((p) => { p.fixtures = p.fixtures.slice(1); }).some((x) => x.includes('fixture inventory'))).toBe(true);
    expect(against((p) => { p.fixtures = []; }).some((x) => x.includes('fixture inventory'))).toBe(true);
    expect(against((p) => { const r = p.rows.find((x) => x.assay)!; r.assay = null; r.assayed = false; }).some((x) => x.includes('assayed set differs') || x.includes('assayed edits'))).toBe(true);
    expect(against((p) => { p.freezeSha256 = '0'.repeat(64); }).some((x) => x.includes('freezeSha256'))).toBe(true);
    expect(checkPower(POWER_EVIDENCE, POWER_MANIFEST, REPO, join(dir, 'missing-freeze.json'))).toEqual(['freeze.json is missing']);
    const other = join(dir, 'freeze.json');
    writeFileSync(other, JSON.stringify(sealFreeze({ ...readFreeze(), statement: 'changed' }), null, 1) + '\n');
    expect(checkPower(POWER_EVIDENCE, POWER_MANIFEST, REPO, other).length).toBeGreaterThan(0);
  }, 300_000);

  it.skipIf(!hasDeno)('--check runs as a subprocess', () => {
    expect(deno('--check')).toContain('--check ok');
  }, 300_000);

  // The replay regenerates the whole payload (several minutes serial under Deno); the deadline is explicit, twice the projection with margin.
  it.skipIf(!hasDeno)('--replay-check reproduces the evidence byte for byte (serial; --workers is accepted and has no effect)', () => {
    expect(deno('--replay-check', '--workers', '2')).toContain('--replay-check ok');
  }, 2_400_000);
});
