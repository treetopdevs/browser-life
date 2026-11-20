/**
 * Experiment runner for Phase A (Direction 3): Rung 1 (Cross-Feeding) & Rung 2 (Red Queen Lysis).
 *
 * Usage (Node 24+ or Deno):
 *   node experiments/oligomer/run.ts --rung 1 --steps 20000 --seeds 4 --size 32
 *   node experiments/oligomer/run.ts --rung 2 --steps 40000 --seeds 4 --size 32
 */

import {
  OP_CLEAVE,
  OP_IMPORT,
  OP_LIGATE,
  OP_LYSE,
  SPECIES,
  WALL_SPECIES,
  makeCatalyst,
  speciesByLabel,
} from '../../apps/lab/src/oligomer/chem.ts';
import { type OligomerConfig, OligomerWorld, defaultConfig } from '../../apps/lab/src/oligomer/model.ts';
import { type CensusRow, OligomerObserver } from '../../apps/lab/src/oligomer/observe.ts';

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      out[k] = v;
    }
  }
  return out;
}

function starterGenome(wallLabel: string, lyseTarget?: string): number[] {
  return [
    makeCatalyst(OP_CLEAVE, '0001', 2),
    makeCatalyst(OP_CLEAVE, '1110', 2),
    makeCatalyst(OP_LIGATE, wallLabel, 2),
    makeCatalyst(OP_IMPORT, '0001', 2),
    makeCatalyst(OP_IMPORT, '1110', 2),
    lyseTarget ? makeCatalyst(OP_LYSE, lyseTarget, 2) : 0,
  ];
}

interface ArmSummary {
  arm: string;
  seed: number;
  steps: number;
  ms: number;
  endLive: number;
  meanLiveLate: number;
  totalDivisions: number;
  totalDeathsStarve: number;
  totalDeathsLyse: number;
  meanWallD1Late: number;
  meanGenomeD1Late: number;
  maxDomWallLate: number;
  motifSwitchesLate: number;
  meanPrimaryLate: number;
  meanMixedLate: number;
  meanSecondaryLate: number;
  endWallShares: string;
  res0: number;
  res1: number;
  digest: string;
}

function runArm(
  arm: string,
  overrides: Partial<OligomerConfig>,
  steps: number,
  censusEvery: number,
  seedFounders: (w: OligomerWorld) => void,
): ArmSummary {
  const t0 = performance.now();
  const cfg = defaultConfig(overrides);
  const w = new OligomerWorld(cfg);
  seedFounders(w);
  const obs = new OligomerObserver(w);

  let totalDiv = 0;
  let totalStarve = 0;
  let totalLyse = 0;

  for (let t = 1; t <= steps; t++) {
    w.step(obs);
    if (t % censusEvery === 0 || t === steps) {
      const r = obs.sample(w);
      totalDiv += r.divisions;
      totalStarve += r.deathsStarve;
      totalLyse += r.deathsLyse;
    }
  }

  const lateFrom = Math.floor(steps * 0.5);
  const lateRows = obs.rows.filter((r) => r.step >= lateFrom);
  const avg = (fn: (r: CensusRow) => number) =>
    lateRows.length ? lateRows.reduce((s, r) => s + fn(r), 0) / lateRows.length : 0;
  const maxDom = lateRows.reduce((m, r) => Math.max(m, r.dominantWallShare), 0);
  const last = obs.rows[obs.rows.length - 1];

  const sharesStr = last.wallShares
    .map((sh, wi) => `${SPECIES[WALL_SPECIES[wi]].label}:${(sh * 100).toFixed(0)}%`)
    .join(' ');

  return {
    arm,
    seed: cfg.seed,
    steps,
    ms: Math.round(performance.now() - t0),
    endLive: last.live,
    meanLiveLate: avg((r) => r.live),
    totalDivisions: totalDiv,
    totalDeathsStarve: totalStarve,
    totalDeathsLyse: totalLyse,
    meanWallD1Late: avg((r) => r.wallHillD1),
    meanGenomeD1Late: avg((r) => r.genomeHillD1),
    maxDomWallLate: maxDom,
    motifSwitchesLate: obs.motifSwitches(lateFrom),
    meanPrimaryLate: avg((r) => r.primaryFrac),
    meanMixedLate: avg((r) => r.mixedFrac),
    meanSecondaryLate: avg((r) => r.secondaryFrac),
    endWallShares: sharesStr,
    res0: last.res0,
    res1: last.res1,
    digest: w.digest().toString(16).padStart(8, '0'),
  };
}

function seedUniform6(w: OligomerWorld, wallLabel = '0011'): void {
  const W = w.cfg.width;
  const H = w.cfg.height;
  const g = starterGenome(wallLabel);
  const wid = speciesByLabel(wallLabel);
  const coords = [
    [Math.floor(W * 0.25), Math.floor(H * 0.25)],
    [Math.floor(W * 0.75), Math.floor(H * 0.25)],
    [Math.floor(W * 0.5), Math.floor(H * 0.5)],
    [Math.floor(W * 0.25), Math.floor(H * 0.75)],
    [Math.floor(W * 0.75), Math.floor(H * 0.75)],
    [Math.floor(W * 0.5), Math.floor(H * 0.15)],
  ];
  coords.forEach(([x, y], idx) => {
    w.seedCompartment(x, y, wid, 20, g, idx + 1);
  });
}

function seedMixedWalls6(w: OligomerWorld): void {
  const W = w.cfg.width;
  const H = w.cfg.height;
  const coords = [
    [Math.floor(W * 0.2), Math.floor(H * 0.25)],
    [Math.floor(W * 0.5), Math.floor(H * 0.25)],
    [Math.floor(W * 0.8), Math.floor(H * 0.25)],
    [Math.floor(W * 0.2), Math.floor(H * 0.75)],
    [Math.floor(W * 0.5), Math.floor(H * 0.75)],
    [Math.floor(W * 0.8), Math.floor(H * 0.75)],
  ];
  WALL_SPECIES.forEach((wid, idx) => {
    const label = SPECIES[wid].label;
    const [x, y] = coords[idx];
    w.seedCompartment(x, y, wid, 20, starterGenome(label), idx + 1);
  });
}

function printSummary(s: ArmSummary): void {
  console.log(
    `${s.arm.padEnd(13)} s${s.seed} | live=${String(s.endLive).padStart(4)} (late ${s.meanLiveLate.toFixed(0).padStart(4)}) ` +
      `| div=${String(s.totalDivisions).padStart(6)} dSt=${String(s.totalDeathsStarve).padStart(5)} dLy=${String(s.totalDeathsLyse).padStart(5)} ` +
      `| wD1=${s.meanWallD1Late.toFixed(2)} gD1=${s.meanGenomeD1Late.toFixed(1).padStart(5)} sw=${String(s.motifSwitchesLate).padStart(2)} maxW=${(s.maxDomWallLate * 100).toFixed(0).padStart(3)}% ` +
      `| P/M/S=${(s.meanPrimaryLate * 100).toFixed(0)}/${(s.meanMixedLate * 100).toFixed(0)}/${(s.meanSecondaryLate * 100).toFixed(0)}% ` +
      `| res=${s.res0},${s.res1} | ${s.ms}ms`,
  );
  console.log(`              walls: ${s.endWallShares}`);
}

const args = parseArgs(process.argv.slice(2));
const rung = args.rung ?? '1';
const steps = Number(args.steps ?? (rung === 'smoke' ? 5000 : 20000));
const seeds = Number(args.seeds ?? (rung === 'smoke' ? 1 : 4));
const size = Number(args.size ?? 32);
const censusEvery = Number(args.census ?? Math.max(100, Math.floor(steps / 40)));

console.log(`=== Oligomer Phase A | rung=${rung} | size=${size}x${size} | steps=${steps} | seeds=${seeds} ===`);

if (rung === 'smoke') {
  for (const [name, ov] of [
    ['R1-TREAT', { width: size, height: size, seed: 1, enableLyse: false }],
    ['R2-LYSE', { width: size, height: size, seed: 1, enableLyse: true }],
  ] as [string, Partial<OligomerConfig>][]) {
    printSummary(runArm(name, ov, steps, censusEvery, (w) => seedUniform6(w, '0011')));
  }
} else if (rung === '1') {
  const arms: [string, Partial<OligomerConfig>][] = [
    ['TREAT', { width: size, height: size, enableLyse: false, flatTradeoff: false, neutralGenome: false }],
    ['FLAT', { width: size, height: size, enableLyse: false, flatTradeoff: true, neutralGenome: false }],
    ['NEUTRAL', { width: size, height: size, enableLyse: false, flatTradeoff: false, neutralGenome: true }],
  ];
  for (const [name, ov] of arms) {
    for (let seed = 1; seed <= seeds; seed++) {
      printSummary(runArm(name, { ...ov, seed }, steps, censusEvery, (w) => seedUniform6(w, '0011')));
    }
  }
} else if (rung === '2') {
  const arms: [string, Partial<OligomerConfig>, (w: OligomerWorld) => void][] = [
    ['LYSE', { width: size, height: size, enableLyse: true }, seedMixedWalls6],
    ['NO_LYSE', { width: size, height: size, enableLyse: false }, seedMixedWalls6],
    ['SINGLE_WALL', { width: size, height: size, enableLyse: true, singleWallOnly: true }, (w) => seedUniform6(w, '0011')],
    ['NEUTRAL_WALL', { width: size, height: size, enableLyse: true, neutralWallLyse: true }, seedMixedWalls6],
  ];
  for (const [name, ov, seeder] of arms) {
    for (let seed = 1; seed <= seeds; seed++) {
      printSummary(runArm(name, { ...ov, seed }, steps, censusEvery, seeder));
    }
  }
} else {
  console.error(`Unknown rung: ${rung}`);
  process.exit(1);
}
