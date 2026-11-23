/**
 * Droplet genes, heritable trait: read every ladder run in a directory and print the tables and the pass rule
 * of docs/droplet-genes-trait-2026-11-21/PLAN.md.
 *
 * Usage: deno run -A --no-lock experiments/dropgenes/summarize.ts <dir> --trait [--json]
 *          [--dist 0.25] [--margin 0.4] [--runaway <levels - 1.5>] [--seeds 25,26,27,28] [--calibration]
 *        deno run -A --no-lock experiments/dropgenes/summarize.ts <dir> --trait --confirm --seeds 25,26,27,28[,29,30,31,32]
 *
 * --confirm is the confirmation of PLAN.md and nothing else: it refuses a directory unless every requested seed
 * has all eight runs of the frozen setting (configuration, set-up, starts 0 and 3, 200,000 steps in every arm),
 * takes no threshold options, reads the seeds in blocks of four in the order given, applies "at least 3 of 4
 * seeds in each block" to every part and prints the reading from PLAN.md's outcome table. It also refuses a run
 * file whose own records disagree with the frozen setting or with each other (levels, response window, a run
 * that stopped short of its planned steps without having gone extinct, a held run with no level), and uses the
 * frozen runaway level 3.5 whatever a file says its ladder is.
 * With --seeds and without --confirm, a requested seed with no runs is listed with n/a verdicts and counts in
 * the denominators.
 *
 * A directory holds the runs of one setting: the four ladder arms (GATED_SEL, GATED_NEU, UNGATED_SEL,
 * UNGATED_NEU) from two start levels, over some seeds. File name: <tag>-K<genes>-cap<cap>-<ARM>-s<seed>.json
 * (experiments/dropgenes/sweep.ts); the arm, start level and seed are read from what the run recorded, and the
 * name is checked against it. Runs of one arm must share their planned steps; every run must share its
 * configuration apart from seed, gate and neutral twin. The directory must hold exactly two start levels.
 * Verdicts are given only when every arm has the same planned steps and a seed has all eight of its runs;
 * --calibration lifts the equal-steps requirement (calibration ran one arm shorter) and says so in the output.
 *
 * "Level" below is the copy-weighted mean ladder level of the copies inside compartments, averaged over the
 * censuses of the last tenth of the planned run. It is n/a when no census there had copies in compartments.
 *
 * Pass rule for one seed (PLAN.md fixes the numbers; the defaults here are the frozen ones):
 *   G, the gated world rests at a level set by selection between compartments. All four of:
 *     held        both gated selected runs (low start, high start) are held
 *     converged   their levels differ by at most --dist
 *     off neutral both of those levels are above the higher, or both below the lower, of the two gated neutral
 *                 runs' levels, by at least --margin (the neutral runs must both be held)
 *     response    the "between" term of the response check, mean over the windows that end in the second
 *                 half of the planned run (the level is at rest there), is negative in both gated selected
 *                 runs and below its value in both gated neutral runs
 *   U, the ungated world runs away: both ungated selected runs are not held, and the mean level of all copies
 *     at their last census with at least 50 copies is at least --runaway (default: halfway between the highest
 *     working level and the top level, levels - 1.5)
 *   T, the twin is valid: both ungated neutral runs are held (so ungating alone does not end the world)
 * Also shown: "ungated matches gated", both ungated selected runs held with a level within --dist of the gated
 * selected run from the same start (the gate then makes no difference to the resting level); and "ungated
 * response", the response condition of G read on the ungated arms (negative in both ungated selected runs and
 * below both ungated neutral runs).
 *
 * The "between" term used by a verdict needs every window that ends in the second half of the planned run
 * (every multiple of the window above steps / 2, up to steps) to be present with a finite value; otherwise it is n/a and the condition
 * is not met.
 */

interface Heredity {
  pairs: number;
  parentR: number | null;
  neighbourR: number | null;
  unrelatedPairs: number;
  parentRUnrelatedSet: number | null;
  unrelatedR: number | null;
  read?: number;
  gone?: number;
  fused?: number;
  pending?: number;
  leftOut?: number;
  merged?: number;
  parentTraitRead?: number | null;
  parentTraitGone?: number | null;
  splitTraitRead?: number | null;
  splitTraitGone?: number | null;
  lastTraitGone?: number | null;
}
interface Response {
  windows: number;
  windowsWithCov: number;
  negativeCov: number;
  meanN: number | null;
  meanCov: number | null;
  meanBetween: number | null;
  meanWithin: number | null;
  meanW: number | null;
  orphans: number;
}
interface Ladder {
  levels: number;
  mutLevel: number;
  mutLevelEffective: number;
  neutral: boolean;
  startLevel: number;
  lateLevelMean: number | null;
  lateLevelCensuses: number;
  lateTopShare: number | null;
  lateCompLevelMean: number | null;
  lateCompLevelSd: number | null;
  lateStrandedLevelMean: number | null;
  lateAllLevelMean: number | null;
  peakAllLevelMean: number | null;
  lastWithCopies: { step: number; copies: number; allLevelMean: number; topShare: number } | null;
  heredityLevel: Heredity;
  heredityLevelDelayed: Heredity;
  heredityLevelLastSeen: Heredity;
  heredityLevelSecondHalf?: Heredity;
  heredityLevelDelayedSecondHalf?: Heredity;
  heredityLevelLastSeenSecondHalf?: Heredity;
  response: Response;
  responseLate: Response;
  responseWindowSteps: number;
}
interface Summary {
  config: Record<string, unknown>;
  protocol: Record<string, unknown>;
  seed: number;
  steps: number;
  stepsRun: number;
  residual: string;
  extinctAt: number | null;
  lateMeanCompartments: number;
  lateCompleteShare: number;
  held: boolean;
  fissions: number;
  fusions: number;
  deaths: number;
  denovo: number;
  ladder?: Ladder;
}
interface RowResp { cov: number | null; between: number | null; within: number | null }
interface Run { name: string; s: Summary; l: Ladder; rows: { step: number; ladder?: { resp: RowResp | null } }[] }

/** Mean "between" and "within" terms and the count of negative covariances over the windows ending after `from`. */
function responseAfter(r: Run, from: number): { windows: number; negative: number; between: number | null; within: number | null } {
  const rs = r.rows.filter((x) => x.step > from && x.step <= r.s.steps).map((x) => x.ladder?.resp).filter((x): x is RowResp => x !== null && x !== undefined);
  const mean = (vs: (number | null)[]) => {
    const v = vs.filter((x): x is number => x !== null && Number.isFinite(x));
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const withCov = rs.filter((x) => x.cov !== null);
  return { windows: withCov.length, negative: withCov.filter((x) => (x.cov as number) < 0).length, between: mean(rs.map((x) => x.between)), within: mean(rs.map((x) => x.within)) };
}

/**
 * The "between" term a verdict uses: the mean over every window ending in the second half of the planned run.
 * Null unless each expected window end (every multiple of the window w above steps / 2, up to steps) has a row
 * with a finite term.
 */
function betweenSecondHalf(r: Run): number | null {
  const w = r.l.responseWindowSteps;
  if (!(w > 0) || r.s.steps % w !== 0) return null;
  const byStep = new Map(r.rows.map((x) => [x.step, x.ladder?.resp?.between ?? null]));
  let sum = 0;
  let n = 0;
  for (let step = (Math.floor(r.s.steps / 2 / w) + 1) * w; step <= r.s.steps; step += w) {
    const v = byStep.get(step);
    if (v === null || v === undefined || !Number.isFinite(v)) return null;
    sum += v;
    n++;
  }
  return n > 0 ? sum / n : null;
}

/** The frozen setting of PLAN.md (every configuration key apart from seed, gate and neutral twin), its set-up and horizon. */
const FROZEN_CONFIG: Record<string, unknown> = {
  width: 64, height: 64, initMatterPerTile: 1024, bulkB: 0.3, kappa: 0.06, mobility: 0.008, diffW: 0.03, noiseAmp: 1.5, diffF: 0.6, diffA: 0.44,
  kLight: 0.026, kSyn: 1, kDeg: 0.085, genes: 2, capPerTile: 16, kRep: 0.2, kDecT: 0.02, diffT: 0.1, gateLo: 0.03, gateHi: 0.125, geneSat: 2,
  mutPar: 0, ladderLevels: 5, mutLevel: 0.015625, kRepPar: 0.4,
};
const FROZEN_PROTOCOL: Record<string, unknown> = { census: 50, report: 2000, heredityDelay: 500, founders: 'grid', spacing: 16, seedPerGene: 2 };
const FROZEN_STARTS = [0, 3];
const FROZEN_STEPS = 200000;
/** U's level: "at least 3.5". Set directly in --confirm, not derived from what a run file says its ladder is. */
const FROZEN_RUNAWAY = 3.5;
const canon = (o: Record<string, unknown>) => JSON.stringify(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

const ARM_ORDER = ['GATED_SEL', 'GATED_NEU', 'UNGATED_SEL', 'UNGATED_NEU'];
const CELL_KEYS = new Set(['seed', 'gated', 'ladderNeutral']);

function opt(argv: string[], key: string, dflt: number): number {
  const i = argv.indexOf(`--${key}`);
  if (i < 0) return dflt;
  const v = Number(argv[i + 1]);
  if (!Number.isFinite(v)) throw new Error(`--${key} must be a number`);
  return v;
}

export async function traitSummary(dir: string, argv: string[]): Promise<void> {
  const asJson = argv.includes('--json');
  const calibration = argv.includes('--calibration');
  const confirm = argv.includes('--confirm');
  if (confirm) {
    if (calibration) throw new Error('--confirm and --calibration cannot be combined');
    for (const k of ['dist', 'margin', 'runaway']) if (argv.includes(`--${k}`)) throw new Error(`--confirm uses the frozen thresholds; --${k} is not allowed`);
  }
  const dist = opt(argv, 'dist', 0.25);
  const margin = opt(argv, 'margin', 0.4);
  /** Default: halfway between the highest working level and the top level, set once the runs are read. */
  let runaway = opt(argv, 'runaway', NaN);
  const seedsAt = argv.indexOf('--seeds');
  const seedList = seedsAt >= 0 ? argv[seedsAt + 1].split(',').map(Number) : null;
  if (seedList && (seedList.some((s) => !Number.isInteger(s)) || new Set(seedList).size !== seedList.length)) throw new Error('--seeds must be distinct whole numbers');
  const onlySeeds = seedList ? new Set(seedList) : null;
  if (confirm && (!seedList || seedList.length === 0 || seedList.length % 4 !== 0)) throw new Error('--confirm needs --seeds with one or more blocks of four seeds');
  // PLAN.md: the unseen seeds are 25 to 32 in two blocks of four. The selections read so far are block 1, block 2
  // and both in that order; calibration seeds or a mixture of the blocks are not the confirmation.
  const PREREGISTERED = ['25,26,27,28', '29,30,31,32', '25,26,27,28,29,30,31,32'];
  if (confirm && !PREREGISTERED.includes((seedList ?? []).join(','))) {
    throw new Error(`--confirm reads the preregistered seed blocks only: ${PREREGISTERED.map((x) => `--seeds ${x}`).join(', or ')}`);
  }

  const names: string[] = [];
  for await (const e of Deno.readDir(dir)) if (e.isFile && e.name.endsWith('.json')) names.push(e.name);
  names.sort();
  const runs = new Map<string, Run>(); // arm|start|seed
  let shared: string | null = null;
  let protocol: string | null = null;
  const stepsByArm = new Map<string, number>();
  for (const name of names) {
    const { summary, rows } = JSON.parse(await Deno.readTextFile(`${dir}/${name}`)) as { summary: Summary; rows: Run['rows'] };
    const m = /^(?:(.+)-)?K(\d+)-cap(\d+)-([A-Z_]+)-s(\d+)\.json$/.exec(name);
    if (!m) throw new Error(`Unexpected file name ${name}`);
    const c = summary.config;
    const l = summary.ladder;
    if (!l) throw new Error(`${name}: not a ladder run`);
    if (onlySeeds && !onlySeeds.has(summary.seed) && summary.seed === c.seed && c.seed === Number(m[5])) continue;
    const arm = `${c.gated ? 'GATED' : 'UNGATED'}_${c.ladderNeutral ? 'NEU' : 'SEL'}`;
    if (arm !== m[4] || c.genes !== Number(m[2]) || c.capPerTile !== Number(m[3]) || c.seed !== Number(m[5])) {
      throw new Error(`${name}: file name disagrees with the recorded configuration`);
    }
    // The seed a run is filed under below must be the one it ran with (and the one in its name).
    if (summary.seed !== c.seed) throw new Error(`${name}: the recorded seed (${summary.seed}) disagrees with the recorded configuration (${c.seed})`);
    if (summary.residual !== '0') throw new Error(`${name}: conservation residual ${summary.residual}`);
    const sh = JSON.stringify(Object.entries(c).filter(([k]) => !CELL_KEYS.has(k)).sort(([a], [b]) => a.localeCompare(b)));
    if (shared === null) shared = sh;
    else if (shared !== sh) throw new Error(`${name}: configuration differs from other runs in this directory`);
    const pr = summary.protocol ? canon(summary.protocol) : 'none';
    if (protocol === null) protocol = pr;
    else if (protocol !== pr) throw new Error(`${name}: set-up or observation protocol differs from other runs in this directory`);
    const st = stepsByArm.get(arm);
    if (st === undefined) stepsByArm.set(arm, summary.steps);
    else if (st !== summary.steps) throw new Error(`${name}: planned steps differ from other ${arm} runs in this directory`);
    const key = `${arm}|${l.startLevel}|${summary.seed}`;
    if (runs.has(key)) throw new Error(`${name}: ${arm}, start ${l.startLevel}, seed ${summary.seed} appears twice`);
    runs.set(key, { name, s: summary, l, rows });
  }
  if (runs.size === 0) throw new Error('no ladder runs found');

  const all = [...runs.values()];
  const starts = [...new Set(all.map((r) => r.l.startLevel))].sort((a, b) => a - b);
  const seeds = seedList ?? [...new Set(all.map((r) => r.s.seed))].sort((a, b) => a - b);
  const arms = ARM_ORDER.filter((a) => stepsByArm.has(a));
  // The two-start test needs two different starts: with one, "converged" would compare a run with itself.
  if (starts.length !== 2) throw new Error(`expected runs from exactly two start levels, found ${starts.length} (${starts.join(', ')})`);
  const sameSteps = new Set(stepsByArm.values()).size === 1;
  const verdictsAllowed = sameSteps || calibration;
  const first = all[0];
  if (!Number.isFinite(runaway)) runaway = first.l.levels - 1.5;
  const get = (arm: string, start: number, seed: number) => runs.get(`${arm}|${start}|${seed}`);
  if (confirm) {
    const cfg = Object.fromEntries(Object.entries(first.s.config).filter(([k]) => !CELL_KEYS.has(k)));
    if (canon(cfg) !== canon(FROZEN_CONFIG)) throw new Error('--confirm: the runs are not at the frozen setting of PLAN.md (configuration differs)');
    if (canon(first.s.protocol) !== canon(FROZEN_PROTOCOL)) throw new Error('--confirm: the runs do not use the frozen set-up and observation protocol');
    if (starts[0] !== FROZEN_STARTS[0] || starts[1] !== FROZEN_STARTS[1]) throw new Error(`--confirm: start levels must be ${FROZEN_STARTS.join(' and ')}, found ${starts.join(' and ')}`);
    for (const a of ARM_ORDER) if (stepsByArm.get(a) !== FROZEN_STEPS) throw new Error(`--confirm: ${a} must be planned at ${FROZEN_STEPS} steps, found ${stepsByArm.get(a) ?? 'no runs'}`);
    const missing: string[] = [];
    for (const seed of seeds) for (const a of ARM_ORDER) for (const st of starts) if (!get(a, st, seed)) missing.push(`${a} start ${st} seed ${seed}`);
    if (missing.length) throw new Error(`--confirm: ${missing.length} run(s) missing: ${missing.slice(0, 8).join('; ')}${missing.length > 8 ? '; ...' : ''}`);
    // Each file's own records must agree with the frozen setting and with each other.
    for (const r of all) {
      if (r.l.levels !== FROZEN_CONFIG.ladderLevels) throw new Error(`--confirm: ${r.name}: ladder section says ${r.l.levels} levels, the frozen setting has ${FROZEN_CONFIG.ladderLevels}`);
      if (r.l.responseWindowSteps !== FROZEN_PROTOCOL.report) throw new Error(`--confirm: ${r.name}: response window of ${r.l.responseWindowSteps} steps, the frozen protocol has ${FROZEN_PROTOCOL.report}`);
      if (typeof r.s.held !== 'boolean') throw new Error(`--confirm: ${r.name}: no held verdict recorded`);
      // The frozen held rule (PLAN.md): at least 10 compartments and at least half complete over the last tenth.
      const heldByFigures = r.s.lateMeanCompartments >= 10 && r.s.lateCompleteShare >= 0.5;
      if (r.s.held !== heldByFigures) throw new Error(`--confirm: ${r.name}: recorded held=${r.s.held} disagrees with its late figures (${r.s.lateMeanCompartments} compartments, complete share ${r.s.lateCompleteShare})`);
      // A run may stop before its planned steps only because the world ended (no compartments, no wall left).
      const ranAll = r.s.stepsRun === r.s.steps;
      const endedEarly = Number.isInteger(r.s.stepsRun) && r.s.stepsRun > 0 && r.s.stepsRun < r.s.steps && typeof r.s.extinctAt === 'number' && r.s.extinctAt <= r.s.stepsRun;
      if (!ranAll && !endedEarly) throw new Error(`--confirm: ${r.name}: ran ${r.s.stepsRun} of ${r.s.steps} steps without a recorded extinction`);
      if (r.s.held && !(typeof r.l.lateLevelMean === 'number' && Number.isFinite(r.l.lateLevelMean))) throw new Error(`--confirm: ${r.name}: held, but no late level recorded`);
    }
    runaway = FROZEN_RUNAWAY;
  }
  const f = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? 'n/a' : v.toFixed(d));
  /** The late level. A run that is not held has no level (PLAN.md); neither has one with no finite level recorded. */
  const levelOf = (r: Run | undefined): number | null =>
    r && r.s.held === true && typeof r.l.lateLevelMean === 'number' && Number.isFinite(r.l.lateLevelMean) ? r.l.lateLevelMean : null;
  /** The level column: n/a for a run that is not held, with the mean over its late censuses that had copies in compartments beside it. */
  const levelCell = (r: Run): string =>
    r.s.held === true ? f(levelOf(r), 3) : `n/a (not held${typeof r.l.lateLevelMean === 'number' && Number.isFinite(r.l.lateLevelMean) ? `; ${r.l.lateLevelMean.toFixed(3)} over the late censuses with copies in compartments` : ''})`;

  console.log(
    `Ladder runs in ${dir}: ${first.l.levels} levels, mutLevel ${first.l.mutLevel} (effective ${first.l.mutLevelEffective}), geneSat ${first.s.config.geneSat}, ` +
      `start levels ${starts.join(' and ')}, seeds ${seeds.join(', ')}. Planned steps: ${arms.map((a) => `${a} ${stepsByArm.get(a)}`).join(', ')}.\n`,
  );

  console.log('Late state per run (late = the last tenth of the planned run). Level = mean ladder level of copies inside compartments.\n');
  console.log('| arm | start | seed | held | ended at step | late compartments | late level | sd of level among compartments | late top-level share | late level of free templates | peak level of all copies | last census with 50+ copies: step, level |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const arm of arms) {
    for (const start of starts) {
      for (const seed of seeds) {
        const r = get(arm, start, seed);
        if (!r) continue;
        const lw = r.l.lastWithCopies;
        console.log(
          `| ${arm} | ${start} | ${seed} | ${r.s.held ? 'yes' : 'no'} | ${r.s.stepsRun < r.s.steps ? r.s.stepsRun : r.s.extinctAt ?? 'ran to the end'} | ${f(r.s.lateMeanCompartments, 1)} | ${levelCell(r)} | ` +
            `${f(r.l.lateCompLevelSd, 3)} | ${f(r.l.lateTopShare, 3)} | ${f(r.l.lateStrandedLevelMean, 3)} | ${f(r.l.peakAllLevelMean, 3)} | ${lw ? `${lw.step}, ${f(lw.allLevelMean, 3)}` : 'n/a'} |`,
        );
      }
    }
  }

  // Pass rule per seed.
  const lo = starts[0];
  const hi = starts[starts.length - 1];
  const verdicts: Record<string, unknown>[] = [];
  const yn = (v: boolean | null) => (v === null ? 'n/a' : v ? 'yes' : 'no');
  /** The "between" term over the windows ending in the second half of the planned run. */
  const between = (r: Run | undefined): number | null => (r ? betweenSecondHalf(r) : null);
  if (!sameSteps) {
    console.log(
      `\n${calibration ? 'CALIBRATION: the arms have different planned steps; verdicts below compare runs of different horizons.' : 'The arms have different planned steps, so no verdict is given (the rule is for one horizon). Pass --calibration to see them anyway.'}`,
    );
  }
  console.log(`\nPass rule per seed (distance at most ${dist}, margin at least ${margin}, runaway level at least ${runaway}). A level is n/a when that run was not held; n/a in a verdict means a run it needs is missing${verdictsAllowed ? '' : ' or the horizons differ'}. The "between" term is the mean over windows ending in the second half of the planned run.\n`);
  console.log('| seed | gated selected level: low start, high start | apart | gated neutral level: low start, high start | "between" term, gated selected: low, high | "between" term, gated neutral: low, high | held | converged | off neutral | response | G | ungated selected: held, last level (low; high) | U runs away | ungated matches gated | "between" term, ungated selected: low, high | "between" term, ungated neutral: low, high | ungated response | ungated neutral held (low, high) | T twin valid |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const seed of seeds) {
    const gs = [get('GATED_SEL', lo, seed), get('GATED_SEL', hi, seed)];
    const gn = [get('GATED_NEU', lo, seed), get('GATED_NEU', hi, seed)];
    const us = [get('UNGATED_SEL', lo, seed), get('UNGATED_SEL', hi, seed)];
    const un = [get('UNGATED_NEU', lo, seed), get('UNGATED_NEU', hi, seed)];
    const have = (rs: (Run | undefined)[]) => verdictsAllowed && rs.every((r) => r !== undefined);
    const g0 = levelOf(gs[0]);
    const g1 = levelOf(gs[1]);
    const n0 = levelOf(gn[0]);
    const n1 = levelOf(gn[1]);
    const held = have(gs) ? gs.every((r) => r?.s.held === true) : null;
    const apart = g0 !== null && g1 !== null ? Math.abs(g0 - g1) : null;
    const converged = held === null ? null : apart !== null && apart <= dist;
    let offNeutral: boolean | null = have(gs) && have(gn) ? false : null;
    if (offNeutral !== null && g0 !== null && g1 !== null && n0 !== null && n1 !== null) {
      const nLo = Math.min(n0, n1);
      const nHi = Math.max(n0, n1);
      offNeutral = (g0 >= nHi + margin && g1 >= nHi + margin) || (g0 <= nLo - margin && g1 <= nLo - margin);
    }
    const bs = gs.map(between);
    const bn = gn.map(between);
    let response: boolean | null = have(gs) && have(gn) ? false : null;
    if (response !== null && bs.every((v) => v !== null) && bn.every((v) => v !== null)) {
      const worstSel = Math.max(...(bs as number[]));
      response = worstSel < 0 && worstSel < Math.min(...(bn as number[]));
    }
    const G = [held, converged, offNeutral, response].some((v) => v === null) ? null : held === true && converged === true && offNeutral === true && response === true;
    // U reads the last census that still had at least 50 copies: the record must be one (count, a finite level, a step the run reached).
    const ranAway = (r: Run | undefined): boolean | null => {
      if (!r) return null;
      const lw = r.l.lastWithCopies;
      return r.s.held === false && lw !== null && lw !== undefined && lw.copies >= 50 && Number.isFinite(lw.allLevelMean) && lw.step <= r.s.stepsRun && lw.allLevelMean >= runaway;
    };
    const ra = us.map(ranAway);
    const U = !have(us) || ra.some((v) => v === null) ? null : ra.every((v) => v === true);
    let matches: boolean | null = have(us) && have(gs) ? true : null;
    if (matches !== null) {
      for (let i = 0; i < 2; i++) {
        const a = levelOf(us[i]);
        const b = levelOf(gs[i]);
        if (a === null || b === null || Math.abs(a - b) > dist) matches = false;
      }
    }
    const T = have(un) ? un.every((r) => r?.s.held === true) : null;
    const bus = us.map(between);
    const bun = un.map(between);
    let ungatedResponse: boolean | null = have(us) && have(un) ? false : null;
    if (ungatedResponse !== null && bus.every((v) => v !== null) && bun.every((v) => v !== null)) {
      const worst = Math.max(...(bus as number[]));
      ungatedResponse = worst < 0 && worst < Math.min(...(bun as number[]));
    }
    console.log(
      `| ${seed} | ${f(g0, 3)}, ${f(g1, 3)} | ${f(apart, 3)} | ${f(n0, 3)}, ${f(n1, 3)} | ${bs.map((v) => f(v, 4)).join(', ')} | ${bn.map((v) => f(v, 4)).join(', ')} | ` +
        `${yn(held)} | ${yn(converged)} | ${yn(offNeutral)} | ${yn(response)} | ${yn(G)} | ` +
        `${us.map((r) => (r ? `${r.s.held ? 'held' : 'not held'}, ${f(r.l.lastWithCopies?.allLevelMean, 3)}` : 'n/a')).join('; ')} | ${yn(U)} | ${yn(matches)} | ${bus.map((v) => f(v, 4)).join(', ')} | ${bun.map((v) => f(v, 4)).join(', ')} | ${yn(ungatedResponse)} | ${un.map((r) => (r ? (r.s.held ? 'yes' : 'no') : 'n/a')).join(', ')} | ${yn(T)} |`,
    );
    verdicts.push({ seed, gatedLow: g0, gatedHigh: g1, apart, neutralLow: n0, neutralHigh: n1, betweenSelected: bs, betweenNeutral: bn, held, converged, offNeutral, response, G, U, ungatedMatchesGated: matches, ungatedResponse, T });
  }
  const count = (k: string) => verdicts.filter((v) => v[k] === true).length;
  console.log(
    `\nSeeds where G passes: ${count('G')} of ${seeds.length}. Seeds where U (ungated runs away) passes: ${count('U')} of ${seeds.length}. ` +
      `Seeds where the ungated selected level matches the gated one: ${count('ungatedMatchesGated')} of ${seeds.length}. Seeds where T (ungated neutral held) passes: ${count('T')} of ${seeds.length}.`,
  );

  // The rule over seeds (PLAN.md): blocks of four in the order given, each part at least 3 of 4 in each block.
  let overall: Record<string, unknown> | null = null;
  if (confirm) {
    const parts = ['G', 'U', 'T', 'ungatedMatchesGated', 'ungatedResponse'];
    const blocks: Record<string, unknown>[][] = [];
    for (let i = 0; i < verdicts.length; i += 4) blocks.push(verdicts.slice(i, i + 4));
    const perBlock = blocks.map((b) => Object.fromEntries(parts.map((k) => [k, b.filter((v) => v[k] === true).length])));
    const passes = Object.fromEntries(parts.map((k) => [k, perBlock.every((c) => (c[k] as number) >= 3)]));
    console.log('\nBlocks of four seeds (a part passes a block on at least 3 of 4 seeds, and passes overall when it passes every block run)\n');
    console.log('| block | seeds | G | U runs away | T twin valid | ungated matches gated | ungated response |');
    console.log('|---|---|---|---|---|---|---|');
    blocks.forEach((b, i) => console.log(`| ${i + 1} | ${b.map((v) => v.seed).join(', ')} | ${parts.map((k) => `${perBlock[i][k]} of 4`).join(' | ')} |`));
    let reading: string;
    if (!passes.G) reading = 'Not confirmed: G fails. The per-seed table shows which of the four conditions failed.';
    else if (passes.U && passes.T) reading = 'Both halves of the question: the gated level is set between compartments, and without the gate it runs away.';
    else if (passes.U) reading = 'The gated half holds; the ungated comparison is confounded with dilution (T fails) and says nothing about the gate.';
    else if (passes.ungatedMatchesGated && passes.ungatedResponse) reading = 'The level is held by selection between compartments with or without the gate; at this setting the gate is not what sets it.';
    else if (passes.ungatedMatchesGated) reading = 'The gated half holds, and the ungated level matches the gated one; what holds it there without the gate is not shown (the ungated response condition is not met).';
    else reading = 'The gated half holds; the ungated world neither ran away nor matched the gated level.';
    const half = blocks.length === 1 ? 'Half the confirmation (one block of four seeds). ' : blocks.length === 2 ? '' : `${blocks.length} blocks. `;
    console.log(`\nParts: G ${passes.G ? 'passes' : 'fails'}, U ${passes.U ? 'passes' : 'fails'}, T ${passes.T ? 'passes' : 'fails'}, ungated matches gated ${passes.ungatedMatchesGated ? 'yes' : 'no'}, ungated response ${passes.ungatedResponse ? 'yes' : 'no'}.`);
    console.log(`\n**Reading: ${half}${reading}**`);
    overall = { blocks: blocks.map((b) => b.map((v) => v.seed)), perBlock, passes, reading: half + reading };
  }

  // Heredity of the mean level.
  const her = (h: Heredity) => `${f(h.parentR)}/${f(h.neighbourR)} (${h.pairs})`;
  const herU = (h: Heredity) => `${f(h.parentRUnrelatedSet)}/${f(h.unrelatedR)} (${h.unrelatedPairs})`;
  console.log('\nParent to daughter resemblance in mean level, over the splits of the second half of the planned run (whole run where a file has no second-half figures: marked *). Each cell: parent r / control r (daughters). "At the split" reads the daughter at the census that first shows the split (at most one census interval after it). "Delayed" reads only daughters that still exist and have not merged after the delay: it is conditioned on surviving. "Last seen" scores every daughter by the copies it had when last seen unmerged, gone ones included.\n');
  console.log('| arm | start | seed | at the split, vs nearest neighbour | at the split, vs unrelated | delayed, vs nearest neighbour | delayed, vs unrelated | delayed: read / gone / fused / pending | last seen, vs nearest neighbour | last seen, vs unrelated | last seen: read / dissolved / left out (of which merged) | mean parent level: daughters read, daughters gone | mean level at the split: read, gone | mean last level of the gone |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const arm of arms) {
    for (const start of starts) {
      for (const seed of seeds) {
        const r = get(arm, start, seed);
        if (!r) continue;
        const a = r.l.heredityLevelSecondHalf ?? r.l.heredityLevel;
        const d = r.l.heredityLevelDelayedSecondHalf ?? r.l.heredityLevelDelayed;
        const ls = r.l.heredityLevelLastSeenSecondHalf ?? r.l.heredityLevelLastSeen;
        console.log(
          `| ${arm} | ${start} | ${seed}${r.l.heredityLevelSecondHalf ? '' : ' *'} | ${her(a)} | ${herU(a)} | ${her(d)} | ${herU(d)} | ${d.read} / ${d.gone} / ${d.fused} / ${d.pending} | ${her(ls)} | ${herU(ls)} | ${ls.read} / ${ls.gone} / ${ls.leftOut} (${ls.merged ?? 'n/a'}) | ` +
            `${f(ls.parentTraitRead, 3)}, ${f(ls.parentTraitGone, 3)} | ${f(ls.splitTraitRead, 3)}, ${f(ls.splitTraitGone, 3)} | ${f(ls.lastTraitGone, 3)} |`,
        );
      }
    }
  }

  // Response check.
  console.log(`\nResponse check, one window per ${first.l.responseWindowSteps} steps: covariance between a compartment's mean level at the start of a window and the number of compartments descended from it at the end. "Between" is that covariance over the mean number of descendants (the change in mean level from which compartments left descendants); "within" is the rest of the change (inside lines of descent). Means over windows.\n`);
  console.log('| arm | start | seed | all windows: mean covariance | between | within | windows with negative covariance | second half of the run: between | within | negative | last tenth: between | within | negative | mean compartments at window start |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const arm of arms) {
    for (const start of starts) {
      for (const seed of seeds) {
        const r = get(arm, start, seed);
        if (!r) continue;
        const a = r.l.response;
        const b = r.l.responseLate;
        const h = responseAfter(r, r.s.steps / 2);
        // The verdicts use the mean only when every second-half window is present and finite; say so when it is not.
        const partial = h.between !== null && betweenSecondHalf(r) === null ? ' (partial: not every second-half window is present and finite, so not counted by the rule)' : '';
        console.log(
          `| ${arm} | ${start} | ${seed} | ${f(a.meanCov, 4)} | ${f(a.meanBetween, 4)} | ${f(a.meanWithin, 4)} | ${a.negativeCov} of ${a.windowsWithCov} | ` +
            `${f(h.between, 4)}${partial} | ${f(h.within, 4)} | ${h.negative} of ${h.windows} | ${f(b.meanBetween, 4)} | ${f(b.meanWithin, 4)} | ${b.negativeCov} of ${b.windowsWithCov} | ${f(a.meanN, 1)} |`,
        );
      }
    }
  }

  console.log('\nBookkeeping (tracker counts depend on the census interval; they are not rates)\n');
  console.log('| arm | start | seed | fissions | fusions | deaths | tracking misses | residual |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const arm of arms) {
    for (const start of starts) {
      for (const seed of seeds) {
        const r = get(arm, start, seed);
        if (r) console.log(`| ${arm} | ${start} | ${seed} | ${r.s.fissions} | ${r.s.fusions} | ${r.s.deaths} | ${r.s.denovo} | ${r.s.residual} |`);
      }
    }
  }

  if (asJson) {
    console.log(
      '\n' +
        JSON.stringify({
          rule: { dist, margin, runaway },
          verdicts,
          confirmation: overall,
          runs: all.map((r) => ({
            arm: `${r.s.config.gated ? 'GATED' : 'UNGATED'}_${r.s.config.ladderNeutral ? 'NEU' : 'SEL'}`, start: r.l.startLevel, seed: r.s.seed, held: r.s.held, steps: r.s.steps, stepsRun: r.s.stepsRun,
            extinctAt: r.s.extinctAt, lateMeanCompartments: r.s.lateMeanCompartments, lateCompleteShare: r.s.lateCompleteShare, ladder: r.l,
          })),
        }),
    );
  }
}
