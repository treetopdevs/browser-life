/**
 * Rung 2 controlled evolution runner for The Reef:
 * Mechanical contact grazing (resisted by armor) + contractile swimming/steering.
 *
 * Usage:
 *   deno run -A experiments/reef/run-rung2.ts --steps 20000 --seeds 4 --gw 40 --gh 20
 */

import {
  ReefWorld,
  defaultReefConfig,
  type ReefConfig,
} from '../../apps/lab/src/reef/model.ts';
import {
  observeBodies,
  observeMatter,
  observeNiches,
} from '../../apps/lab/src/reef/observe.ts';

interface ArmDef {
  name: string;
  overrides: Partial<ReefConfig>;
}

const ARMS: ArmDef[] = [
  { name: 'GRAZE_FULL', overrides: { shadows: true, gravity: true, bonds: true, grazing: true, swimming: true } },
  { name: 'SWIM_NO_GRAZE', overrides: { shadows: true, gravity: true, bonds: true, grazing: false, swimming: true } },
  { name: 'GRAZE_NO_SWIM', overrides: { shadows: true, gravity: true, bonds: true, grazing: true, swimming: false } },
];

/** A whole number >= 1. A value that is given but invalid stops the run; only an absent option takes the default. */
function parseArg(name: string, fallback: number): number {
  const idx = Deno.args.indexOf(`--${name}`);
  if (idx < 0) return fallback;
  const v = idx + 1 < Deno.args.length ? Number(Deno.args[idx + 1]) : NaN;
  if (!Number.isSafeInteger(v) || v < 1) throw new Error(`--${name} must be a positive whole number, got ${Deno.args[idx + 1] ?? '(nothing)'}`);
  return v;
}

const steps = parseArg('steps', 20000);
const seeds = parseArg('seeds', 4);
const gw = parseArg('gw', 40);
const gh = parseArg('gh', 20);
const censusEvery = parseArg('census', 1000);

console.log(
  `# Reef Rung 2 Pilot: ${gw}x${gh}, ${steps} steps, ${seeds} seeds/arm, census every ${censusEvery}\n`,
);
console.log(
  '| Arm | Seed | Cells | MC% | MeanSz | MaxSz | Span | CanH90 | Ph% | Gr% | Mix% | Arm | Dig | Con | r(P,D) | r(A,C) | Grazed | Res |',
);
console.log(
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
);

const t0 = performance.now();

for (const arm of ARMS) {
  for (let s = 1; s <= seeds; s++) {
    const world = new ReefWorld(
      defaultReefConfig({
        gw,
        gh,
        seed: s,
        ...arm.overrides,
      }),
    );
    world.seedDefaultFounders(24);

    let samples = 0;
    let sumCells = 0, sumMc = 0, sumMeanSz = 0, sumMaxSz = 0, sumSpan = 0, sumCanH = 0;
    let sumPh = 0, sumGr = 0, sumMix = 0;
    let sumArm = 0, sumDig = 0, sumCon = 0, sumRPD = 0, sumRAC = 0;
    let maxAbsRes = 0;

    // Census every `censusEvery` steps, with a last (shorter) leg so the run always ends at `steps`.
    // When censusEvery divides steps this is the same schedule as before.
    for (let t = 0; t < steps;) {
      const leg = Math.min(censusEvery, steps - t);
      world.stepN(leg);
      t += leg;
      const m = observeMatter(world);
      if (Math.abs(m.residual) > maxAbsRes) maxAbsRes = Math.abs(m.residual);
      if (t >= steps / 2) {
        const b = observeBodies(world);
        const n = observeNiches(world);
        samples++;
        sumCells += n.cells;
        sumMc += b.multicellCellShare;
        sumMeanSz += b.meanBodySize;
        sumMaxSz += b.maxBodySize;
        sumSpan += b.maxVerticalSpan;
        sumCanH += b.canopyHeight90;
        sumPh += n.phototrophShare;
        sumGr += n.grazerShare;
        sumMix += n.mixotrophShare;
        sumArm += n.meanArmor;
        sumDig += n.meanDigest;
        sumCon += n.meanContract;
        sumRPD += n.corrPigDig;
        sumRAC += n.corrArmCon;
      }
    }

    const inv = 1 / Math.max(1, samples);
    const fmt = (v: number, d = 2) => v.toFixed(d);
    const fmtS = (v: number) => (v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2));
    console.log(
      `| ${arm.name} | ${s} | ${fmt(sumCells * inv, 0)} | ${fmt(sumMc * inv * 100, 1)}% | ${fmt(sumMeanSz * inv, 2)} | ${fmt(sumMaxSz * inv, 0)} | ${fmt(sumSpan * inv, 1)} | ${fmt(sumCanH * inv, 1)} | ${fmt(sumPh * inv * 100, 0)}% | ${fmt(sumGr * inv * 100, 0)}% | ${fmt(sumMix * inv * 100, 0)}% | ${fmt(sumArm * inv)} | ${fmt(sumDig * inv)} | ${fmt(sumCon * inv)} | ${fmtS(sumRPD * inv)} | ${fmtS(sumRAC * inv)} | ${world.totalMassGrazed} | ${maxAbsRes} |`,
    );
  }
}

const elapsed = (performance.now() - t0) / 1000;
console.log(`\nDone in ${elapsed.toFixed(1)}s.`);
