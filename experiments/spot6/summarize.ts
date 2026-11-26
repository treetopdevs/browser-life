/**
 * Reads the SPOT6 segment files and prints every reading the plan fixes (docs/six-wall-spot-2026-11-22/PLAN.md):
 * per-window readouts, the clean-arm gate, the stage 2 rule, and for stage 3 settings the five endpoints and
 * the outcome. Everything is recomputed from the raw segment files on each call.
 *
 *   deno run -A --no-lock experiments/spot6/summarize.ts --runs runs/spot6 --json docs/six-wall-spot-2026-11-22/summary.json
 */

import { argOf } from '../confirm/io.ts';
import { windowReadouts, type WindowReadouts } from '../b2check/readouts.ts';
import { classifyWindow, type Reading } from '../b2check/verdict.ts';
import {
  type Arm,
  type ArmRuns,
  bodyReadouts,
  type BodyReadouts,
  endpoints,
  erosionReadouts,
  type ErosionReadouts,
  gatePasses,
  type OutcomeReading,
  patternTurnover,
  phageLoad,
  type PhageLoad,
  type PhageReading,
  readDivision,
  readPhage,
  type Row,
  type SeedFacts,
  type SegmentFile,
  settingOutcome,
  stage2Outcome,
  type Stage3Seed,
  stage3Outcome,
  T,
  turnoverAbove,
} from './rule.ts';
import { ALLOWED_SEEDS, baseSettingOf, CENSUS, PHAGE_VARIANTS, settingOf, SETTINGS } from './settings.ts';

const STAGE12_CAP = 80_000;
const STAGE3_STEPS = 100_000;
const WINDOW = 20_000;
const ARMS: readonly Arm[] = ['PHAGE', 'NO_PHAGE', 'NEUTRAL_PHAGE', 'SINGLE_WALL'];

export interface WindowSummary {
  from: number;
  to: number;
  readouts: WindowReadouts;
  reading: Reading;
  body: BodyReadouts;
  erosion: ErosionReadouts | null;
  load: PhageLoad;
  phage: PhageReading;
  /** Types whose mean phage is at least a sixth of the "alive" bar. */
  phageTypes: number;
  d1: number;
  /** Pattern turnover of the wall shares at lags of 1,000 steps (the one the rule uses) and 5,000 steps. */
  turnover: number | null;
  turnover5000: number | null;
  keepLead: number | null;
  /** Share of tiles inside objects, and with total wall of 0.05 or more, by half of the window. */
  coverHalves: [number | null, number | null];
  lowCoverHalves: [number | null, number | null];
}

interface RunSummary {
  setting: string;
  arm: Arm;
  seed: number;
  steps: number;
  rows: Row[];
  windows: WindowSummary[];
  bound: number;
}

const runsDir = argOf('runs');
const jsonOut = argOf('json', '');

function meanOf(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

async function loadRun(setting: string, arm: Arm, seed: number): Promise<RunSummary | null> {
  const dir = `${runsDir}/${setting}/${arm}/seed-${seed}`;
  let names: string[];
  try {
    names = [...Deno.readDirSync(dir)].map((e) => e.name).filter((n) => n.startsWith('seg-') && n.endsWith('.json'));
  } catch {
    return null;
  }
  names.sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1]));
  const rows: Row[] = [];
  const windows: WindowSummary[] = [];
  let at = 0;
  let bound = 0;
  let cfg = '';
  for (const name of names) {
    const file = JSON.parse(await Deno.readTextFile(`${dir}/${name}`)) as SegmentFile;
    if (file.meta.setting !== setting || file.meta.arm !== arm || file.meta.seed !== seed) throw new Error(`header of ${dir}/${name} names another run`);
    if (cfg && cfg !== JSON.stringify(file.meta.cfg)) throw new Error(`config changed between segments in ${dir}`);
    cfg = JSON.stringify(file.meta.cfg);
    bound = file.meta.emergenceBound;
    // Segments must join end to end: a gap means a segment file is missing.
    if (file.segment.from !== at) break;
    for (const r of file.rows) {
      if (r.res !== 0) throw new Error(`matter residual in ${dir}/${name} at t=${r.t}`);
      if (r.t !== at + CENSUS) throw new Error(`census missing in ${dir}/${name} before t=${r.t}`);
      at = r.t;
      rows.push(r);
    }
    if (at !== file.segment.to) throw new Error(`segment ${dir}/${name} is short`);
    if (!file.tracker) continue;
    if (!file.bodylog) throw new Error(`tracked segment without a body log: ${dir}/${name}`);
    const readouts = windowReadouts(file.tracker, file.rows, file.meta.dt);
    const phage = readPhage(file.rows, bound);
    const bar = (T.phageBoundTimes * bound) / 6;
    const midT = (file.segment.from + file.segment.to) / 2;
    const cen = file.tracker.census;
    const halves = (pick: (c: (typeof cen)[number]) => number): [number | null, number | null] => [meanOf(cen.filter((c) => c.t <= midT).map(pick)), meanOf(cen.filter((c) => c.t > midT).map(pick))];
    let phageTypes = 0;
    for (let m = 0; m < 6; m++) if ((meanOf(file.rows.map((r) => r.phageBy[m])) ?? 0) >= bar && bar > 0) phageTypes++;
    windows.push({
      from: file.segment.from,
      to: file.segment.to,
      readouts,
      reading: classifyWindow(readouts),
      body: bodyReadouts(file.tracker, file.meta.dt, file.bodylog),
      erosion: erosionReadouts(file.tracker, file.bodylog),
      load: phageLoad(file.bodylog, file.rows[file.rows.length - 1]),
      phage,
      phageTypes,
      d1: meanOf(file.rows.map((r) => r.d1)) ?? 0,
      turnover: patternTurnover(file.rows),
      turnover5000: patternTurnover(file.rows, 5000),
      keepLead: meanOf(file.rows.map((r) => r.keepLead1000).filter((x): x is number => x !== null)),
      coverHalves: halves((c) => c.cover),
      lowCoverHalves: halves((c) => c.lowCover),
    });
  }
  if (rows.length === 0) return null;
  return { setting, arm, seed, steps: at, rows, windows, bound };
}

/** The stage 1 and stage 2 reading window of a run: the first settled 20,000-step window up to step 80,000. */
function readingWindow(run: RunSummary): { window: WindowSummary | null; flag: 'settled' | 'not settled by 80,000' | 'extension due' | 'not run to 40,000' } {
  const cand = run.windows.filter((w) => w.from >= WINDOW && w.to <= STAGE12_CAP && w.to - w.from === WINDOW);
  if (cand.length === 0) return { window: null, flag: 'not run to 40,000' };
  const settled = cand.find((w) => w.reading.settled);
  if (settled) return { window: settled, flag: 'settled' };
  const last = cand[cand.length - 1];
  if (last.to >= STAGE12_CAP) return { window: last, flag: 'not settled by 80,000' };
  return { window: last, flag: 'extension due' };
}

const finalWindow = (run: RunSummary): WindowSummary | null => run.windows.find((w) => w.from === STAGE3_STEPS - WINDOW && w.to === STAGE3_STEPS) ?? null;

const f = (x: number | null | undefined, d = 2) => (x === null || x === undefined ? 'n/a' : x.toFixed(d));
const pct = (x: number | null | undefined) => (x === null || x === undefined ? 'n/a' : `${(100 * x).toFixed(0)}%`);
const kinds = (k: { fission: number; switch: number; denovo: number }) => `${k.fission} / ${k.denovo} / ${k.switch}`;

// ---------------------------------------------------------------------------------------------------------
// Load everything
// ---------------------------------------------------------------------------------------------------------

const settingNames: string[] = SETTINGS.map((s) => s.name);
for (const e of Deno.readDirSync(runsDir)) {
  if (e.isDirectory && PHAGE_VARIANTS.some((v) => e.name.startsWith(`${v.name}@`))) settingNames.push(e.name);
}
const all = new Map<string, RunSummary>();
const key = (setting: string, arm: string, seed: number) => `${setting}/${arm}/${seed}`;
for (const setting of settingNames) {
  for (const arm of ARMS) {
    for (const seed of ALLOWED_SEEDS) {
      const run = await loadRun(setting, arm, seed);
      if (run) all.set(key(setting, arm, seed), run);
    }
  }
}
const get = (setting: string, arm: Arm, seed: number) => all.get(key(setting, arm, seed)) ?? null;

// ---------------------------------------------------------------------------------------------------------
// Per-window tables
// ---------------------------------------------------------------------------------------------------------

const newKinds = (b: BodyReadouts, half: 'first' | 'second' | 'both') => {
  const one = (h: { fission: number; denovo: number }) => `${h.fission} / ${h.denovo}`;
  if (half === 'first') return one(b.newFirstHalf);
  if (half === 'second') return one(b.newSecondHalf);
  return one({ fission: b.newFirstHalf.fission + b.newSecondHalf.fission, denovo: b.newFirstHalf.denovo + b.newSecondHalf.denovo });
};
const allKinds = (b: BodyReadouts) => kinds({ fission: b.lastingFirstHalf.fission + b.lastingSecondHalf.fission, denovo: b.lastingFirstHalf.denovo + b.lastingSecondHalf.denovo, switch: b.lastingFirstHalf.switch + b.lastingSecondHalf.switch });
const phageText = (p: PhageReading) => `${p.alive ? 'alive' : p.presentAtEnd ? 'not alive (above zero at the end)' : 'none at the end'}: ${f(p.mean, 0)} / ${f(p.meanSecondHalf, 0)} / ${f(p.meanLast, 0)} (bar ${f(T.phageBoundTimes * p.bound, 0)})`;

console.log('## Readouts per setting, arm, seed and tracked window\n');
console.log('| Setting | Arm | Seed | Window | Count (min to max) | Halves | Kept id +100 / +500 / +1,000 | Moved in 1,000 steps (tiles, n) | Tiles kept +1,000 | Tiles still wall +1,000 (chance) | Solid | Isolated | Moat | Peak wall median | Area | Tiles in objects, by half | Tiles with wall of 0.05 or more, by half | Mean D1 | Phage: mean over window / second half / last 2,000 steps (bar); types above a sixth of the bar | Reading |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const run of all.values()) {
  for (const w of run.windows) {
    const r = w.readouts;
    console.log(
      `| ${run.setting} | ${run.arm} | ${run.seed} | ${w.from} to ${w.to} | ${f(r.count, 1)} (${r.countMin} to ${r.countMax}) | ${f(r.countFirstHalf, 1)} / ${f(r.countSecondHalf, 1)}${w.reading.settled ? '' : ' not settled'} | ${pct(r.surv100)} / ${pct(r.surv500)} / ${pct(r.surv1000)} | ${f(r.disp1000, 1)} (${r.disp1000N}) | ${pct(r.keepUid1000)} | ${pct(r.keepMask1000)} (${pct(r.chance1000)}) | ${pct(r.solid)} | ${pct(r.isolated)} | ${f(r.moatMedian)} | ${f(r.peakMedian)} | ${f(r.areaMedian, 0)} | ${pct(w.coverHalves[0])} / ${pct(w.coverHalves[1])} | ${pct(w.lowCoverHalves[0])} / ${pct(w.lowCoverHalves[1])} | ${f(w.d1)} | ${phageText(w.phage)}; ${w.phageTypes} | ${w.reading.label} |`,
    );
  }
}

console.log('\n## Births, ends and turnover per setting, arm, seed and tracked window\n');
console.log('| Setting | Arm | Seed | Window | Object-steps (thousands) | New bodies, first half: fission / from nothing | Second half | Lasting births not counted: switch / severed / returned / rejoined / one object at the window start / not apart at 0.05 | Lasting ends of bodies (fade or absorbed), of which returned; ends of pieces | Lasting switch ends | Per body per 1,000 steps: new bodies / ends not returned / switches | Pattern turnover of shares, lag 1,000 / 5,000 | Tiles keeping their leading type +1,000 | Every lasting birth by the tracker\'s kind: fission / from nothing / switch | All births: fission / from nothing / switch | All ends: fade / absorbed / switch |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const run of all.values()) {
  for (const w of run.windows) {
    const b = w.body;
    const r = w.readouts;
    console.log(
      `| ${run.setting} | ${run.arm} | ${run.seed} | ${w.from} to ${w.to} | ${f(b.objectKiloSteps, 0)} | ${newKinds(b, 'first')} | ${newKinds(b, 'second')} | ${b.notNew.switch} / ${b.notNew.severed} / ${b.notNew.returned} / ${b.notNew.rejoined} / ${b.notNew.preexisting} / ${b.notNew.joined} | ${b.lastingEnds}, ${b.returnedEnds}; ${b.pieceEnds} | ${b.lastingSwitchEnds} | ${f(b.birthRate, 4)} / ${f(b.endRate, 4)} / ${f(b.switchRate, 4)} | ${f(w.turnover, 4)} / ${f(w.turnover5000, 4)} | ${pct(w.keepLead)} | ${allKinds(b)} | ${kinds(r.births)} | ${r.ends.fade} / ${r.ends.absorbed} / ${r.ends.switch} |`,
    );
  }
}

console.log('\n## Erosion per PHAGE and NO_PHAGE window (objects with at least 20 samples 50 steps apart)\n');
console.log('| Setting | Arm | Seed | Window | Bodies | Body-steps (thousands) | Recovered dips | Ends after a dip | Ends not after a dip | Per 1,000 body-steps: dips / ends after dip / other ends | Own phage per tile, median: usual / at a dip / before an end not after a dip / peak in the last 200 steps before an end |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
for (const run of all.values()) {
  if (run.arm !== 'PHAGE' && run.arm !== 'NO_PHAGE') continue;
  for (const w of run.windows) {
    const e = w.erosion;
    if (!e || e.bodies === 0) continue;
    const k = e.bodyKiloSteps;
    console.log(
      `| ${run.setting} | ${run.arm} | ${run.seed} | ${w.from} to ${w.to} | ${e.bodies} | ${f(k, 0)} | ${e.recoveredDips} | ${e.endsAfterDip} | ${e.endsSudden} | ${f(e.recoveredDips / k, 4)} / ${f(e.endsAfterDip / k, 4)} / ${f(e.endsSudden / k, 4)} | ${f(e.phageUsual, 1)} / ${f(e.phageAtDip, 1)} / ${f(e.phageBeforeSuddenEnd, 1)} / ${f(e.phagePeakBeforeEnd, 1)} |`,
    );
  }
}

console.log('\n## Phage load on bodies per PHAGE window (objects sampled every 50 steps)\n');
console.log('| Setting | Seed | Window | Samples | With own phage of 1 unit per tile or more | 10 or more | Mean own phage per tile | Wall per tile, with 10 or more / with under 1 | Area, with 10 or more / with under 1 | Own-type phage on object tiles at the last census, as a share of all the dish\'s phage |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const run of all.values()) {
  if (run.arm !== 'PHAGE') continue;
  for (const w of run.windows) {
    const l = w.load;
    console.log(`| ${run.setting} | ${run.seed} | ${w.from} to ${w.to} | ${l.samples} | ${pct(l.withPhage1)} | ${pct(l.withPhage10)} | ${f(l.meanPerTile, 1)} | ${f(l.wallLoaded, 3)} / ${f(l.wallClean, 3)} | ${f(l.areaLoaded, 1)} / ${f(l.areaClean, 1)} | ${pct(l.onFootprints)} |`);
  }
}

console.log('\n## Count by stretch of the run\n');
console.log('| Setting | Arm | Seed | Stretch | Mean count | Mean D1 | Mean phage |');
console.log('|---|---|---|---|---|---|---|');
for (const run of all.values()) {
  for (let a = 0; a < run.steps; a += a < 20_000 ? 10_000 : 20_000) {
    const b = Math.min(run.steps, a + (a < 20_000 ? 10_000 : 20_000));
    const w = run.rows.filter((r) => r.t > a && r.t <= b);
    console.log(`| ${run.setting} | ${run.arm} | ${run.seed} | ${a} to ${b} | ${f(meanOf(w.map((r) => r.drop)), 1)} | ${f(meanOf(w.map((r) => r.d1)))} | ${f(meanOf(w.map((r) => r.phage)), 0)} |`);
  }
}

// ---------------------------------------------------------------------------------------------------------
// Stage 1: the clean-arm gate
// ---------------------------------------------------------------------------------------------------------

const report: Record<string, unknown> = {};
console.log('\n## Stage 1: clean-arm gate (NO_PHAGE, seeds 1 and 2)\n');
console.log('| Setting | Seed | Run to | Reading window | Flag | Reading | Bodies criteria not met | New bodies in that window: fission / from nothing | Gate |');
console.log('|---|---|---|---|---|---|---|---|---|');
const gate = new Map<string, boolean | null>();
const gateNote = new Map<string, string>();
for (const setting of settingNames) {
  const seeds = [1, 2].map((s) => get(setting, 'NO_PHAGE', s));
  if (seeds.every((r) => r === null)) continue;
  const read = seeds.map((r) => (r ? readingWindow(r) : null));
  const complete = read.every((x) => x !== null && (x.flag === 'settled' || x.flag === 'not settled by 80,000'));
  const pass = complete ? gatePasses(read.map((x, k) => ({ seed: k + 1, label: x!.window!.reading.label, settled: x!.flag === 'settled' }))) : null;
  gate.set(setting, pass);
  gateNote.set(setting, read.map((x, k) => `seed ${k + 1}: ${x?.window ? `${x.window.reading.label}${x.flag === 'settled' ? '' : `, ${x.flag}`}` : 'not run'}`).join('; '));
  seeds.forEach((r, k) => {
    const x = read[k];
    if (!r || !x) {
      console.log(`| ${setting} | ${k + 1} | not run | | | | | | |`);
      return;
    }
    const w = x.window;
    const bad = w ? (['B1', 'B2', 'B3'] as const).filter((c) => w.reading.checks[c] !== true).join(' ') || 'none' : '';
    console.log(`| ${setting} | ${k + 1} | ${r.steps} | ${w ? `${w.from} to ${w.to}` : ''} | ${x.flag} | ${w?.reading.label ?? ''} | ${bad} | ${w ? newKinds(w.body, 'both') : ''} | ${k === 0 ? (pass === null ? 'incomplete' : pass ? '**passes**' : '**fails**') : ''} |`);
  });
}
report.gate = Object.fromEntries(gate);

// ---------------------------------------------------------------------------------------------------------
// Stage 2: PHAGE on seeds 1 and 2
// ---------------------------------------------------------------------------------------------------------

console.log('\n## Stage 2: PHAGE, seeds 1 and 2\n');
console.log('| Setting | Seed | Run to | Reading window | Flag | Objects at its end | Reading | Phage: mean over window / second half / last 2,000 steps (bar) | New bodies in that window: fission / from nothing | Stage 2 rule |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
const stage2 = new Map<string, OutcomeReading | null>();
const stage2Fissions = new Map<string, number>();
const stage2Facts: Record<string, unknown> = {};
for (const setting of settingNames) {
  const seeds = [1, 2].map((s) => get(setting, 'PHAGE', s));
  if (seeds.every((r) => r === null)) continue;
  const read = seeds.map((r) => (r ? readingWindow(r) : null));
  const complete = read.every((x) => x !== null && (x.flag === 'settled' || x.flag === 'not settled by 80,000'));
  const facts: SeedFacts[] = [];
  if (complete) {
    read.forEach((x, k) => {
      const w = x!.window!;
      const end = seeds[k]!.rows.find((r) => r.t === w.to)!;
      facts.push({ seed: k + 1, dead: end.drop === 0, label: w.reading.label, settled: x!.flag === 'settled', phageAlive: w.phage.alive });
    });
  }
  const rule = complete ? stage2Outcome(facts) : null;
  stage2.set(setting, rule);
  if (complete) stage2Fissions.set(setting, read.reduce((a, x) => a + x!.window!.body.newFirstHalf.fission + x!.window!.body.newSecondHalf.fission, 0));
  stage2Facts[setting] = rule ? { facts, ...rule, newFissions: stage2Fissions.get(setting) } : 'incomplete';
  seeds.forEach((r, k) => {
    const x = read[k];
    if (!r || !x) {
      console.log(`| ${setting} | ${k + 1} | not run | | | | | | | |`);
      return;
    }
    const w = x.window;
    const end = w ? r.rows.find((row) => row.t === w.to)! : null;
    const verdict = k === 0 ? (rule === null ? 'incomplete' : rule.advance ? '**advance to stage 3**' : `**${rule.outcome}** (${rule.notes.join('; ')})`) : '';
    console.log(`| ${setting} | ${k + 1} | ${r.steps} | ${w ? `${w.from} to ${w.to}` : ''} | ${x.flag} | ${end ? end.drop : ''} | ${w?.reading.label ?? ''} | ${w ? phageText(w.phage) : ''} | ${w ? newKinds(w.body, 'both') : ''} | ${verdict} |`);
  });
}
report.stage2 = stage2Facts;

// ---------------------------------------------------------------------------------------------------------
// Stage 3: four seeds, all four arms. No outcome until every arm and seed has run to the end.
// ---------------------------------------------------------------------------------------------------------

const stage3 = new Map<string, OutcomeReading>();
const stage3Facts: Record<string, unknown> = {};
for (const setting of settingNames) {
  const started = ALLOWED_SEEDS.some((s) => (get(setting, 'PHAGE', s)?.steps ?? 0) > STAGE12_CAP || get(setting, 'NEUTRAL_PHAGE', s) !== null);
  if (!started) continue;
  const missing: string[] = [];
  for (const arm of ARMS) for (const s of ALLOWED_SEEDS) if ((get(setting, arm, s)?.steps ?? 0) < STAGE3_STEPS) missing.push(`${arm} seed ${s}`);
  console.log(`\n## Stage 3: ${setting} (seeds 1 to 4, steps ${STAGE3_STEPS - WINDOW} to ${STAGE3_STEPS})\n`);
  if (missing.length > 0) {
    console.log(`Not complete: ${missing.join(', ')} not run to ${STAGE3_STEPS}. No outcome is read.`);
    continue;
  }
  const cut = (r: RunSummary) => r.rows.filter((row) => row.t <= STAGE3_STEPS);
  const lastRow = (arm: Arm, s: number) => cut(get(setting, arm, s)!)[STAGE3_STEPS / CENSUS - 1];
  const runs: ArmRuns = {};
  for (const arm of ARMS) for (const s of ALLOWED_SEEDS) (runs[arm] ??= {})[s] = cut(get(setting, arm, s)!);
  const eps = endpoints(runs, ALLOWED_SEEDS, STAGE3_STEPS);
  const d4 = eps.find((e) => e.id.startsWith('D4'))!;
  const seeds: Stage3Seed[] = [];
  const founding: BodyReadouts[] = [];
  console.log('| Seed | Objects at step 100,000 | Reading | Settled | Phage: mean / second half / last 2,000 steps (bar); types | Kept id +1,000 | Tiles kept +1,000 | Isolated | Moat | New bodies, settled window: fission / from nothing (second half) | Not counted: switch / severed / returned / rejoined / one object at the window start / not apart at 0.05 | Lasting ends not returned | Founding window, new bodies: fission / from nothing | Per body per 1,000 steps: new bodies / ends / switches | Pattern turnover PHAGE / NO_PHAGE (lag 1,000), above | Same at lag 5,000 | Leading type kept +1,000 PHAGE / NO_PHAGE | NO_PHAGE: objects at the end, reading | Pattern-blind arm: objects at the end, reading | One-wall arm: objects at the end, reading |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const s of ALLOWED_SEEDS) {
    const p = get(setting, 'PHAGE', s)!;
    const n = get(setting, 'NO_PHAGE', s)!;
    const w = finalWindow(p)!;
    const wn = finalWindow(n)!;
    const end = lastRow('PHAGE', s);
    const win = turnoverAbove(w.turnover, wn.turnover, lastRow('NO_PHAGE', s).drop > 0);
    seeds.push({ seed: s, dead: end.drop === 0, label: w.reading.label, settled: w.reading.settled, phageAlive: w.phage.alive, body: w.body, turnoverWin: win, d4: d4.perSeed[s] === true });
    const fw = p.windows.find((x) => x.from === 0);
    if (fw) founding.push(fw.body);
    const other = (arm: Arm) => {
      const fwin = finalWindow(get(setting, arm, s)!);
      return `${lastRow(arm, s).drop}, ${fwin ? fwin.reading.label : 'n/a'}`;
    };
    console.log(
      `| ${s} | ${end.drop} | ${w.reading.label} | ${w.reading.settled ? 'yes' : 'no'} | ${phageText(w.phage)}; ${w.phageTypes} | ${pct(w.readouts.surv1000)} | ${pct(w.readouts.keepUid1000)} | ${pct(w.readouts.isolated)} | ${f(w.readouts.moatMedian)} | ${newKinds(w.body, 'both')} (${newKinds(w.body, 'second')}) | ${w.body.notNew.switch} / ${w.body.notNew.severed} / ${w.body.notNew.returned} / ${w.body.notNew.rejoined} / ${w.body.notNew.preexisting} / ${w.body.notNew.joined} | ${w.body.lastingEnds - w.body.returnedEnds} | ${fw ? newKinds(fw.body, 'both') : 'n/a'} | ${f(w.body.birthRate, 4)} / ${f(w.body.endRate, 4)} / ${f(w.body.switchRate, 4)} | ${f(w.turnover, 4)} / ${f(wn.turnover, 4)}, ${win ? 'yes' : 'no'} | ${f(w.turnover5000, 4)} / ${f(wn.turnover5000, 4)} | ${pct(w.keepLead)} / ${pct(wn.keepLead)} | ${other('NO_PHAGE')} | ${other('NEUTRAL_PHAGE')} | ${other('SINGLE_WALL')} |`,
    );
  }
  const outcome = stage3Outcome(seeds);
  const foundingDivision = readDivision(founding);
  const allSeeds = readDivision(seeds.map((x) => x.body));
  console.log('\n| Endpoint (final 20% of the run) | Seeds 1 to 4 | Wins |');
  console.log('|---|---|---|');
  for (const e of eps) console.log(`| ${e.id} | ${ALLOWED_SEEDS.map((s) => (e.perSeed[s] === null ? 'not run' : e.perSeed[s] ? 'yes' : 'no')).join(', ')} | ${e.wins} of ${e.of} |`);
  console.log(`\n- Eligible seeds (objects at the end, bodies, phage alive, settled window): ${outcome.eligible.length ? outcome.eligible.join(', ') : 'none'}.`);
  const d = outcome.division;
  if (d) console.log(`- Division, settled windows of the eligible seeds pooled: ${d.fission} by fission of ${d.lasting} lasting births of new bodies, ${d.secondHalf} in the second half, ${d.ends} lasting ends, ${d.contributing} seeds with at least ${T.divisionPerSeed} births: **${d.label}**${d.failed.length ? ` (${d.failed.join('; ')})` : ''}.`);
  console.log(`- For reference, all four seeds pooled whatever they read: ${allSeeds.fission} by fission of ${allSeeds.lasting} lasting births of new bodies, ${allSeeds.ends} lasting ends.`);
  console.log(`- Founding windows pooled (steps 0 to 10,000; decides nothing): ${foundingDivision.fission} by fission of ${foundingDivision.lasting} lasting births of new bodies.`);
  console.log(`- On eligible seeds: pattern turnover above NO_PHAGE on ${outcome.turnoverWins}, D4 on ${outcome.d4Wins}.`);
  console.log(`- Stage 3 rule: **${outcome.outcome}** (${outcome.notes.join('; ')}).`);
  stage3.set(setting, outcome);
  stage3Facts[setting] = { seeds: seeds.map(({ body: _body, ...rest }) => rest), outcome, foundingDivision, endpoints: eps };
}
report.stage3 = stage3Facts;

// ---------------------------------------------------------------------------------------------------------
// One outcome per setting
// ---------------------------------------------------------------------------------------------------------

console.log('\n## Outcome per setting\n');
console.log('| Setting | Rates and phage changes | Clean-arm gate | Stage 2 | Stage 3 | Outcome | Why |');
console.log('|---|---|---|---|---|---|---|');
const outcomes: Record<string, unknown> = {};
for (const setting of settingNames) {
  if (!gate.has(baseSettingOf(setting)) && !stage2.has(setting)) continue;
  const def = settingOf(setting);
  // A phage variant stands on its rate setting's clean-arm gate: its NO_PHAGE world is that setting's.
  const g = gate.get(baseSettingOf(setting)) ?? null;
  const s2 = stage2.get(setting) ?? null;
  const s3 = stage3.get(setting) ?? null;
  const final = settingOutcome({ reference: setting === 'B2', gate: g, gateNote: gateNote.get(baseSettingOf(setting)) ?? '', stage2: s2, stage3: s3 });
  outcomes[setting] = final ?? 'incomplete';
  const changes = { ...def.rates, ...def.phage };
  console.log(`| ${setting} | ${Object.keys(changes).length ? Object.entries(changes).map(([k, v]) => `${k} ${v}`).join(', ') : 'none (the confirmation\'s)'} | ${g === null ? 'incomplete' : g ? 'passes' : 'fails'} | ${s2 === null ? 'not read' : s2.advance ? 'advance' : s2.outcome} | ${s3 === null ? 'not read' : s3.outcome} | ${final ? `**${final.outcome}**` : 'incomplete'} | ${final ? final.notes.join('; ') : ''} |`);
}
report.outcomes = outcomes;

if (jsonOut) {
  const runsOut = [...all.values()].map((r) => ({ setting: r.setting, arm: r.arm, seed: r.seed, steps: r.steps, bound: r.bound, windows: r.windows }));
  await Deno.writeTextFile(jsonOut, JSON.stringify({ ...report, runs: runsOut }, null, 1) + '\n');
  console.log(`\nwrote ${jsonOut}`);
}
