/**
 * The frozen decision rule for the droplets-vs-Reef confirmation (see PREREGISTRATION.md).
 * Pure functions over per-census rows, so the verdict can be unit-tested and recomputed from run files.
 */

export const CONFIRM_SEEDS = [5, 6, 7, 8, 9, 10, 11, 12] as const;
export const REQUIRED_WINS = 7;
export const DROPLET_STEPS = 500_000;
export const DROPLET_CENSUS = 500;
export const REEF_STEPS = 200_000;
export const REEF_CENSUS = 1_000;

export interface DropletRow {
  t: number;
  drop: number;
  d1: number;
  dom: number;
  domShare: number;
  phage: number;
  res: number;
}

export interface ReefRow {
  t: number;
  cells: number;
  mc: number;
  meanSz: number;
  maxSz: number;
  ph: number;
  gr: number;
  arm: number;
  res: number;
}

export type Direction = 'climbing' | 'sitting' | 'falling';
export type DirectionHeadline = Direction | 'mixed';

export interface EndpointResult {
  id: string;
  wins: number;
  of: number;
  pass: boolean;
  perSeed: Record<number, boolean>;
}

export interface WorldVerdict {
  world: 'droplets' | 'reef';
  pass: boolean;
  endpoints: EndpointResult[];
  direction: Record<string, { headline: DirectionHeadline; perSeed: Record<number, Direction> }>;
}

export interface Decision {
  winner: 'droplets' | 'reef' | 'neither';
  reason: string;
}

type Window = readonly [number, number];
export const FINAL: Window = [0.8, 1];
export const EARLY_LATE: Window = [0.4, 0.6];

export function inWindow<T extends { t: number }>(rows: readonly T[], steps: number, w: Window): T[] {
  const lo = w[0] * steps;
  const hi = w[1] * steps;
  return rows.filter((r) => r.t > lo && r.t <= hi);
}

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) throw new Error('mean of an empty window');
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Changes of leader among censuses where the leader holds at least 25% (the pilot's sw25, inside one window). */
export function majorSweeps(rows: readonly DropletRow[]): number {
  let prev = -1;
  let n = 0;
  for (const r of rows) {
    if (r.dom >= 0 && r.domShare >= 0.25) {
      if (prev >= 0 && r.dom !== prev) n++;
      prev = r.dom;
    }
  }
  return n;
}

export function classify(early: number, late: number): Direction {
  if (early <= 0) return late > 0 ? 'climbing' : 'falling';
  const ratio = late / early;
  if (ratio >= 1.1) return 'climbing';
  if (ratio <= 0.9) return 'falling';
  return 'sitting';
}

export function headline(perSeed: Record<number, Direction>): DirectionHeadline {
  const counts: Record<Direction, number> = { climbing: 0, sitting: 0, falling: 0 };
  for (const d of Object.values(perSeed)) counts[d]++;
  for (const d of ['climbing', 'sitting', 'falling'] as const) if (counts[d] >= 5) return d;
  return 'mixed';
}

function endpoint(id: string, seeds: readonly number[], test: (seed: number) => boolean): EndpointResult {
  const perSeed: Record<number, boolean> = {};
  let wins = 0;
  for (const s of seeds) {
    const ok = test(s);
    perSeed[s] = ok;
    if (ok) wins++;
  }
  return { id, wins, of: seeds.length, pass: wins >= REQUIRED_WINS, perSeed };
}

function assertComplete<T extends { t: number; res: number }>(
  runs: Record<string, Record<number, readonly T[]>>,
  arms: readonly string[],
  steps: number,
  census: number,
): void {
  const expected = steps / census;
  for (const arm of arms) {
    for (const s of CONFIRM_SEEDS) {
      const rows = runs[arm]?.[s];
      if (!rows) throw new Error(`missing run ${arm} seed ${s}`);
      if (rows.length !== expected) throw new Error(`incomplete run ${arm} seed ${s}: ${rows.length}/${expected} censuses`);
      rows.forEach((r, i) => {
        if (r.t !== (i + 1) * census) throw new Error(`incomplete run ${arm} seed ${s}: census ${i} has t=${r.t}`);
      });
      const bad = rows.find((r) => r.res !== 0);
      if (bad) throw new Error(`INVALID: matter residual ${bad.res} in ${arm} seed ${s} at t=${bad.t}`);
    }
  }
}

export function judgeDroplets(runs: Record<string, Record<number, readonly DropletRow[]>>): WorldVerdict {
  assertComplete(runs, ['PHAGE', 'NO_PHAGE', 'SINGLE_WALL', 'NEUTRAL_PHAGE'], DROPLET_STEPS, DROPLET_CENSUS);
  const fin = (arm: string, s: number) => inWindow(runs[arm][s], DROPLET_STEPS, FINAL);
  const drop = (arm: string, s: number) => mean(fin(arm, s).map((r) => r.drop));
  const d1 = (arm: string, s: number) => mean(fin(arm, s).map((r) => r.d1));
  const seeds = CONFIRM_SEEDS;
  // A dead PHAGE world loses everything. A dead NO_PHAGE control voids the comparisons that need it.
  // NEUTRAL_PHAGE and SINGLE_WALL may collapse: their collapse is the effect D1, D2 and D4 measure.
  const alive = (arm: string, s: number) => runs[arm][s][runs[arm][s].length - 1].drop > 0;
  const phageAlive = (s: number) => alive('PHAGE', s);

  const endpoints = [
    endpoint('D1 droplets: PHAGE > NEUTRAL_PHAGE', seeds, (s) => phageAlive(s) && drop('PHAGE', s) > drop('NEUTRAL_PHAGE', s)),
    endpoint('D2 droplets: PHAGE > SINGLE_WALL', seeds, (s) => phageAlive(s) && drop('PHAGE', s) > drop('SINGLE_WALL', s)),
    endpoint('D3 leader sweeps: PHAGE > NO_PHAGE', seeds, (s) => phageAlive(s) && alive('NO_PHAGE', s) && majorSweeps(fin('PHAGE', s)) > majorSweeps(fin('NO_PHAGE', s))),
    endpoint('D4 diversity: PHAGE > NEUTRAL_PHAGE', seeds, (s) => phageAlive(s) && d1('PHAGE', s) > d1('NEUTRAL_PHAGE', s)),
    endpoint('D5 persistence: droplets >= half of NO_PHAGE, D1 >= 2, droplets and phage alive', seeds, (s) => {
      const rows = runs.PHAGE[s];
      return phageAlive(s) && alive('NO_PHAGE', s) && drop('PHAGE', s) >= 0.5 * drop('NO_PHAGE', s) && d1('PHAGE', s) >= 2 && rows[rows.length - 1].phage > 0;
    }),
  ];

  const trend = (field: 'd1' | 'drop') => {
    const perSeed: Record<number, Direction> = {};
    for (const s of seeds) {
      const early = mean(inWindow(runs.PHAGE[s], DROPLET_STEPS, EARLY_LATE).map((r) => r[field]));
      perSeed[s] = classify(early, mean(fin('PHAGE', s).map((r) => r[field])));
    }
    return { headline: headline(perSeed), perSeed };
  };

  return { world: 'droplets', pass: endpoints.every((e) => e.pass), endpoints, direction: { diversity: trend('d1'), droplets: trend('drop') } };
}

export function judgeReef(runs: Record<string, Record<number, readonly ReefRow[]>>): WorldVerdict {
  assertComplete(runs, ['GRAZE_FULL', 'SWIM_NO_GRAZE', 'GRAZE_NO_SWIM'], REEF_STEPS, REEF_CENSUS);
  const fin = (arm: string, s: number) => inWindow(runs[arm][s], REEF_STEPS, FINAL);
  const avg = (arm: string, s: number, f: 'arm' | 'meanSz') => mean(fin(arm, s).map((r) => r[f]));
  const seeds = CONFIRM_SEEDS;
  // A dead treatment or control tank voids the comparison, so it cannot hand the treatment a win.
  const alive = (arm: string, s: number) => runs[arm][s][runs[arm][s].length - 1].cells > 0;
  const bothAlive = (s: number) => alive('GRAZE_FULL', s) && alive('SWIM_NO_GRAZE', s);

  const endpoints = [
    endpoint('R1 armor: GRAZE_FULL > SWIM_NO_GRAZE', seeds, (s) => bothAlive(s) && avg('GRAZE_FULL', s, 'arm') > avg('SWIM_NO_GRAZE', s, 'arm')),
    endpoint('R2 body size: GRAZE_FULL > SWIM_NO_GRAZE', seeds, (s) => bothAlive(s) && avg('GRAZE_FULL', s, 'meanSz') > avg('SWIM_NO_GRAZE', s, 'meanSz')),
    endpoint('R3 coexistence: in >= 80% of final censuses, multicellular >= 50%, grazers >= 10%, phototrophs >= 10%', seeds, (s) => {
      if (!alive('GRAZE_FULL', s)) return false;
      const rows = fin('GRAZE_FULL', s);
      const together = rows.filter((r) => r.cells > 0 && r.mc >= 0.5 && r.gr >= 0.1 && r.ph >= 0.1).length;
      return together >= 0.8 * rows.length;
    }),
  ];

  const trend = (field: 'meanSz' | 'maxSz') => {
    const perSeed: Record<number, Direction> = {};
    for (const s of seeds) {
      const early = mean(inWindow(runs.GRAZE_FULL[s], REEF_STEPS, EARLY_LATE).map((r) => r[field]));
      perSeed[s] = classify(early, mean(fin('GRAZE_FULL', s).map((r) => r[field])));
    }
    return { headline: headline(perSeed), perSeed };
  };

  return { world: 'reef', pass: endpoints.every((e) => e.pass), endpoints, direction: { bodySize: trend('meanSz'), maxBody: trend('maxSz') } };
}

export function decide(droplets: WorldVerdict, reef: WorldVerdict): Decision {
  if (droplets.pass && !reef.pass) return { winner: 'droplets', reason: 'Only the droplets kept their separation on unseen seeds.' };
  if (reef.pass && !droplets.pass) return { winner: 'reef', reason: 'Only the Reef kept its separation on unseen seeds.' };
  if (!droplets.pass && !reef.pass) return { winner: 'neither', reason: 'Neither world kept its separation on unseen seeds.' };
  const dHolds = ['climbing', 'sitting'].includes(droplets.direction.diversity.headline);
  const rClimbs = reef.direction.bodySize.headline === 'climbing';
  if (rClimbs && !dHolds) return { winner: 'reef', reason: 'Both passed. Tie-break: Reef body size climbs and droplet diversity does not hold.' };
  return { winner: 'droplets', reason: dHolds && !rClimbs
    ? 'Both passed. Tie-break: droplet diversity holds and Reef body size does not climb.'
    : 'Both passed and the direction tie-break did not separate them. Default: droplets (bit-exact GPU kernel, scales to 256x256).' };
}
