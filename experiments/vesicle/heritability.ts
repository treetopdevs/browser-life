// Heritability yardstick from the pinch logs (--pinch-log): mother's cell trait just before her pinch vs each
// daughter's trait just before the daughter's OWN next pinch (matched life stage). Streams the log once.
// Trait: the cell mean of the functional heritable byte (m_gMean for free/gate arms, m_wMean for the wall arm).
// heritability = OLS slope of daughter on mother. baseline = same statistic with each daughter paired to an
// UNRELATED cell instead: the divided cell whose own pinch step is nearest to the mother's pinch step (ties: earlier
// step; within one step the scan takes the higher id below and the lower id above) that is not the mother, a daughter, the mother's parent or her siblings. STRICT baseline (the
// reported one) also requires a different founder root (follow parents up the pinch log), so it shares no ancestor
// at all; the LENIENT baseline allows cousins. Pairs with no strict match are dropped from every statistic.
// Both pinches (mother's and daughter's) must fall at or before --window STEP (default: whole log), so a run that
// collapses can be read before it does. Daughters with no own pinch inside the window are excluded and counted.
// Usage: node experiments/vesicle/heritability.ts --window 200000 --json out.json "arm|trait|dirOfSeedDirs" ...
//   e.g. "free copying, mut 0.01|g|runs/vesicle/s0/free-mut0.01" (seed dirs s1..sN inside, each with s<N>.pinch.tsv)
import { createReadStream, readdirSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';

interface Pinch { step: number; id: number; parent: number; trait: number }
interface Stat { pairs: number; slope: number; corr: number; n: number }

async function readRun(file: string, trait: 'g' | 'w') {
  const pinches = new Map<number, Pinch>(), parentOf = new Map<number, number>(), ends = new Map<number, string>();
  const pinchRows: { step: number; id: number; d1: number; d2: number; t: number }[] = [];
  let header: string[] = [];
  const col = trait === 'g' ? 'm_gMean' : 'm_wMean';
  for await (const line of createInterface({ input: createReadStream(file) })) {
    const f = line.split('\t');
    if (f[0] === 'ev') { header = f; continue; }
    const ix = header.indexOf(col);
    if (f[0] === 'pinch') {
      const step = +f[1], id = +f[2], d1 = +f[3], d2 = +f[4];
      pinchRows.push({ step, id, d1, d2, t: +f[ix] });
      parentOf.set(d1, id); parentOf.set(d2, id);
    } else if (f[0] === 'end') ends.set(+f[2], f[5]);
  }
  for (const r of pinchRows) pinches.set(r.id, { step: r.step, id: r.id, parent: parentOf.get(r.id) ?? 0, trait: r.t });
  return { pinchRows, pinches, parentOf, ends };
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const median = (a: number[]) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y), n = s.length; return n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2; };
function ols(xs: number[], ys: number[]): { slope: number; corr: number } {
  const mx = mean(xs), my = mean(ys); let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return { slope: sxx > 0 ? sxy / sxx : NaN, corr: sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN };
}

export interface RunPairs { mother: number[]; daughter: number[]; unrel: number[]; strict: number[]; gen: number[]; excluded: number; excludedDied: number; mothers: number; noMatch: number }
function pairsFor(run: Awaited<ReturnType<typeof readRun>>, W: number): RunPairs {
  const { pinchRows, pinches, parentOf, ends } = run;
  const inWin = [...pinches.values()].filter((p) => p.step <= W).sort((a, b) => a.step - b.step || a.id - b.id);
  const steps = inWin.map((p) => p.step);
  const out: RunPairs = { mother: [], daughter: [], unrel: [], strict: [], gen: [], excluded: 0, excludedDied: 0, mothers: 0, noMatch: 0 };
  for (const p of inWin) { const b = parentOf.get(p.id); if (b !== undefined) { const m = pinches.get(b); if (m) out.gen.push(p.step - m.step); } }
  const rootOf = (id: number) => { let c = id; for (let g = 0; g < 10000; g++) { const q = parentOf.get(c); if (q === undefined) return c; c = q; } return c; };
  const children = new Map<number, number[]>();
  for (const r of pinchRows) children.set(r.id, [r.d1, r.d2]);
  const lowerBound = (x: number) => { let lo = 0, hi = steps.length; while (lo < hi) { const m = (lo + hi) >> 1; if (steps[m] < x) lo = m + 1; else hi = m; } return lo; };
  for (const r of pinchRows) {
    if (r.step > W) continue;
    out.mothers++;
    const M = pinches.get(r.id)!, par = parentOf.get(r.id), sib = par !== undefined ? (children.get(par) ?? []) : [];
    const banned = new Set<number>([r.id, r.d1, r.d2, ...(par !== undefined ? [par] : []), ...sib]);
    for (const d of [r.d1, r.d2]) {
      const D = pinches.get(d);
      if (!D || D.step > W) { out.excluded++; if (ends.has(d) && (ends.get(d) !== undefined)) out.excludedDied++; continue; }
      // nearest divided cell in step to the mother's pinch that is not close kin (lenient) / has a different founder root (strict)
      const near = (ok: (c: Pinch) => boolean): Pinch | undefined => {
        let lo = lowerBound(M.step) - 1, hi = lo + 1;
        while (lo >= 0 || hi < inWin.length) {
          const dl = lo >= 0 ? M.step - steps[lo] : Infinity, dh = hi < inWin.length ? steps[hi] - M.step : Infinity;
          const i = dl <= dh ? lo-- : hi++, c = inWin[i]; // ties go to the earlier step
          if (!banned.has(c.id) && ok(c)) return c;
        }
        return undefined;
      };
      const pick = near(() => true), strict = near((c) => rootOf(c.id) !== rootOf(r.id));
      if (!pick || !strict) { out.excluded++; out.noMatch++; continue; }
      out.mother.push(M.trait); out.daughter.push(D.trait); out.unrel.push(pick.trait); out.strict.push(strict.trait);
    }
  }
  return out;
}

function stat(x: number[], y: number[]): Stat { const o = ols(x, y); return { pairs: x.length, n: x.length, ...o }; }

async function main() {
  const args = process.argv.slice(2), val = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
  const W = val('window') ? Number(val('window')) : Infinity, jsonOut = val('json');
  const specs = args.filter((a, i) => a.includes('|') && args[i - 1] !== '--json');
  const result = [];
  for (const spec of specs) {
    const [arm, trait, dir] = spec.split('|');
    const seeds = readdirSync(dir).filter((d) => /^s\d+$/.test(d)).sort();
    const perSeed = [], all: RunPairs = { mother: [], daughter: [], unrel: [], strict: [], gen: [], excluded: 0, excludedDied: 0, mothers: 0, noMatch: 0 };
    for (const s of seeds) {
      const run = await readRun(join(dir, s, `${s}.pinch.tsv`), trait as 'g' | 'w'), p = pairsFor(run, W);
      const h = stat(p.mother, p.daughter), b = 0, bs = ols(p.strict, p.daughter), bl = ols(p.unrel, p.daughter);
      perSeed.push({ seed: +s.slice(1), pairs: p.mother.length, mothers: p.mothers, excluded: p.excluded, excludedDied: p.excludedDied, heritability: h.slope, corr: h.corr, baselineLenient: bl.slope, baseline: undefined as number | undefined, generationSteps: median(p.gen) });
      // baseline: slope of daughter on the unrelated cell's trait (mother's slot taken by the unrelated cell)
      perSeed[perSeed.length - 1].baseline = bs.slope; void b;
      for (const k of ['mother', 'daughter', 'unrel', 'strict', 'gen'] as const) all[k].push(...p[k]);
      all.excluded += p.excluded; all.excludedDied += p.excludedDied; all.mothers += p.mothers; all.noMatch += p.noMatch;
    }
    const h = ols(all.mother, all.daughter), b = ols(all.strict, all.daughter), bl = ols(all.unrel, all.daughter);
    result.push({ arm, window: Number.isFinite(W) ? W : 'whole log', seeds: seeds.length, pairs: all.mother.length, mothers: all.mothers, excluded: all.excluded, excludedDied: all.excludedDied,
      heritability: h.slope, corr: h.corr, noMatch: all.noMatch, baseline: b.slope, baselineCorr: b.corr, excess: h.slope - b.slope, baselineLenient: bl.slope, excessLenient: h.slope - bl.slope, generationSteps: median(all.gen), perSeed, perSeedExcess: perSeed.map((p) => p.heritability - (p.baseline as number)) });
  }
  for (const r of result) console.log(JSON.stringify({ ...r, perSeed: undefined }));
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(result, null, 1));
}
await main();
