/**
 * Reads the MOVING6 segment files and prints every reading the plan fixes
 * (docs/six-wall-moving-2026-11-22/PLAN.md): per-window readouts, the ledger of bodies with its validity, the
 * gate, the two-seed rule, and for four-seed settings the five endpoints and the outcome. Everything is
 * recomputed from the raw segment files on each call.
 *
 *   deno run -A --no-lock experiments/moving6/summarize.ts --runs runs/moving6 --json docs/six-wall-moving-2026-11-22/summary.json
 *
 * `--notrun "MIX37=the budget did not allow it"` records why a stage a setting was due was not run when the work
 * stopped (several: separate with `;`). It changes no reading: such a setting is "mixed / unclear" with that reason.
 *
 * `--confirm`: the reading a later confirmation would use (PLAN.md): the four-seed rule on unseen seeds 33 to 40
 * with `CONFIRM_RULE` (7 of 8, twice the new bodies), from a runs folder that holds those seeds. Nothing in
 * this line runs those seeds; the runner refuses them.
 *
 * Replayed control windows of the earlier screen are read from `<runs>/controls` and printed in their own table.
 */

import { argOf } from '../confirm/io.ts';
import { windowReadouts, type WindowReadouts } from '../b2check/readouts.ts';
import {
  type Arm,
  type ArmRuns,
  bodyReadouts,
  type BodyReadouts,
  endpoints,
  erosionReadouts,
  type ErosionReadouts,
  gatePasses,
  newBirths,
  type OutcomeReading,
  patternTurnover,
  phageLoad,
  type PhageLoad,
  type PhageReading,
  readPhage,
  type Row,
  type SeedFacts,
  stage2Outcome,
  T,
  turnoverAbove,
} from '../spot6/rule.ts';
import { PHAGE_VARIANTS } from '../spot6/settings.ts';
import { buildChains, type DeathKind, type Ledger, ledgerOf } from './ledger.ts';
import type { MovingSegmentFile } from './movelog.ts';
import { classifyMoving, CONFIRM_RULE, type MovingReading, type MovingSeed, neighbourRank, readDivision, settingOutcome, sizeKept, type SizeKept, STAGE3_RULE, stage3Outcome, type Stage3Reading, type Validity, validityOf } from './rule.ts';
import { ALLOWED_SEEDS, baseSettingOf, CENSUS, NEIGHBOURS, PRIMARY, settingOf, SETTINGS, UNSEEN_SEEDS, VARIANT_BASE } from './settings.ts';

const STAGE12_CAP = 80_000;
const STAGE3_STEPS = 100_000;
const LATE_STEPS = 200_000;
const WINDOW = 20_000;
const ARMS: readonly Arm[] = ['PHAGE', 'NO_PHAGE', 'NEUTRAL_PHAGE', 'SINGLE_WALL'];

export interface WindowSummary {
  from: number;
  to: number;
  /** The segment kept this line's move log (false: a stored window of the earlier screen, read through the earlier id-based note). */
  moveLog: boolean;
  readouts: WindowReadouts;
  size: SizeKept;
  reading: MovingReading;
  ledger: Ledger;
  validity: Validity;
  /** The same ledger with no parting at all (every merge a fusion, every later split a birth), and with a merge allowed 2,000 steps, and any time, before it counts as a fusion (described only). */
  ledger0: { division: number; notApart: number; relabel: number; piece: number; nothing: number; fade: number; fusion: number };
  ledger2000: { division: number; notApart: number; relabel: number; piece: number; nothing: number; fade: number; fusion: number };
  ledgerAny: { division: number; notApart: number; relabel: number; piece: number; nothing: number; fade: number; fusion: number };
  /** The earlier screen's counts on the same window. */
  old: BodyReadouts;
  erosion: ErosionReadouts | null;
  load: PhageLoad;
  phage: PhageReading;
  /** Types whose mean phage is at least a sixth of the "alive" bar. */
  phageTypes: number;
  d1: number;
  turnover: number | null;
  turnover5000: number | null;
  keepLead: number | null;
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
const confirm = Deno.args.includes('--confirm');
/** The seeds of the many-seed stage and its rule: seeds 1 to 4 and 3 of 4 here; 33 to 40 and 7 of 8 for a later confirmation. */
const SEEDS: readonly number[] = confirm ? UNSEEN_SEEDS : ALLOWED_SEEDS;
const RULE = confirm ? CONFIRM_RULE : STAGE3_RULE;
const notRun = new Map<string, string>();
for (const item of argOf('notrun', '').split(';')) {
  const at = item.indexOf('=');
  if (at > 0) notRun.set(item.slice(0, at).trim(), item.slice(at + 1).trim());
}

function meanOf(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}
function medianOf(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const k = s.length >> 1;
  return s.length % 2 === 1 ? s[k] : (s[k - 1] + s[k]) / 2;
}

function summarizeWindow(file: MovingSegmentFile): WindowSummary {
  if (!file.tracker || !file.bodylog) throw new Error('not a tracked segment');
  const tr = file.tracker;
  const move = file.movelog ?? null;
  const bound = file.meta.emergenceBound;
  const readouts = windowReadouts(tr, file.rows, file.meta.dt);
  const size = sizeKept(tr);
  const ledger = ledgerOf(tr, file.bodylog, move, file.meta.dt, file.meta.size);
  // The ledger's ends are censuses; the window's first frame has no census row, so its count comes from the tracker.
  const counts = [{ t: file.segment.from, drop: tr.census[0].drop }, ...file.rows.map((r) => ({ t: r.t, drop: r.drop }))];
  const other = (within: number) => {
    const l = ledgerOf(tr, file.bodylog!, move, file.meta.dt, file.meta.size, buildChains(tr, file.bodylog!, within));
    return { division: l.births.division, notApart: l.births['split not shown apart'], relabel: l.births.relabel, piece: l.births['returned piece'], nothing: l.births['from nothing'], fade: l.deaths.fade, fusion: l.deaths.fusion };
  };
  const phage = readPhage(file.rows, bound);
  const bar = (T.phageBoundTimes * bound) / 6;
  const midT = (file.segment.from + file.segment.to) / 2;
  const cen = tr.census;
  const halves = (pick: (c: (typeof cen)[number]) => number): [number | null, number | null] => [meanOf(cen.filter((c) => c.t <= midT).map(pick)), meanOf(cen.filter((c) => c.t > midT).map(pick))];
  let phageTypes = 0;
  for (let m = 0; m < 6; m++) if ((meanOf(file.rows.map((r) => r.phageBy[m])) ?? 0) >= bar && bar > 0) phageTypes++;
  return {
    from: file.segment.from,
    to: file.segment.to,
    moveLog: move !== null,
    readouts,
    size,
    reading: classifyMoving(readouts, size),
    ledger,
    validity: validityOf(ledger, counts),
    ledger0: other(0),
    ledger2000: other(2000),
    ledgerAny: other(Infinity),
    old: bodyReadouts(tr, file.meta.dt, file.bodylog),
    erosion: erosionReadouts(tr, file.bodylog),
    load: phageLoad(file.bodylog, file.rows[file.rows.length - 1]),
    phage,
    phageTypes,
    d1: meanOf(file.rows.map((r) => r.d1)) ?? 0,
    turnover: patternTurnover(file.rows),
    turnover5000: patternTurnover(file.rows, 5000),
    keepLead: meanOf(file.rows.map((r) => r.keepLead1000).filter((x): x is number => x !== null)),
    coverHalves: halves((c) => c.cover),
    lowCoverHalves: halves((c) => c.lowCover),
  };
}

async function loadRun(root: string, setting: string, arm: Arm, seed: number): Promise<RunSummary | null> {
  const dir = `${root}/${setting}/${arm}/seed-${seed}`;
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
    const file = JSON.parse(await Deno.readTextFile(`${dir}/${name}`)) as MovingSegmentFile;
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
    windows.push(summarizeWindow(file));
  }
  if (rows.length === 0) return null;
  return { setting, arm, seed, steps: at, rows, windows, bound };
}

/** The reading window of the gate and the two-seed stage: the first settled 20,000-step window up to step 80,000. */
function readingWindow(run: RunSummary): { window: WindowSummary | null; flag: 'settled' | 'not settled by 80,000' | 'extension due' | 'not run to 40,000' } {
  const cand = run.windows.filter((w) => w.from >= WINDOW && w.to <= STAGE12_CAP && w.to - w.from === WINDOW);
  if (cand.length === 0) return { window: null, flag: 'not run to 40,000' };
  const settled = cand.find((w) => w.reading.settled);
  if (settled) return { window: settled, flag: 'settled' };
  const last = cand[cand.length - 1];
  if (last.to >= STAGE12_CAP) return { window: last, flag: 'not settled by 80,000' };
  return { window: last, flag: 'extension due' };
}

const windowAt = (run: RunSummary, to: number): WindowSummary | null => run.windows.find((w) => w.from === to - WINDOW && w.to === to) ?? null;

const f = (x: number | null | undefined, d = 2) => (x === null || x === undefined ? 'n/a' : x.toFixed(d));
const pct = (x: number | null | undefined) => (x === null || x === undefined ? 'n/a' : `${(100 * x).toFixed(0)}%`);
const phageText = (p: PhageReading) => `${p.alive ? 'alive' : p.presentAtEnd ? 'not alive (above zero at the end)' : 'none at the end'}: ${f(p.mean, 0)} / ${f(p.meanSecondHalf, 0)} / ${f(p.meanLast, 0)} (bar ${f(T.phageBoundTimes * p.bound, 0)})`;
const birthsText = (l: Ledger) => `${l.births.division} / ${l.births['split not shown apart']} (${l.notApart.samePatch} same patch, ${l.notApart.notRead} not read) / ${l.births.relabel} / ${l.births['returned piece']} / ${l.births['from nothing']}`;
const deathsText = (l: Ledger) => `${l.deaths.fade} / ${l.deaths.fusion} / ${l.deaths['relabelled away']}`;
const validText = (v: Validity) => (v.ok ? 'valid' : `**not readable** (${v.failed.join('; ')})`);
/** Division on one window alone (described). A window whose ledger is not valid reads "not readable", with what its counts would have read. */
const divisionText = (w: WindowSummary) => {
  const d = readDivision([w.ledger]);
  const text = `${d.label}${d.failed.length ? ` (${d.failed.join('; ')})` : ''}`;
  return w.validity.ok ? text : `not readable (its counts alone would read: ${text})`;
};
/** The same for the JSON: the reading where the window may be read, and what its counts alone give. */
const divisionJson = (w: WindowSummary, readable = w.validity.ok) => {
  const counts = readDivision([w.ledger]).label;
  return { division: readable ? counts : w.validity.ok ? 'described only' : 'not readable', divisionFromCountsAlone: counts };
};
const variantText = (v: WindowSummary['ledger0']) => `${v.division} / ${v.notApart} / ${v.relabel} / ${v.piece} / ${v.nothing}; ${v.fade} / ${v.fusion}`;
const perKilo = (n: number, l: Ledger) => (l.bodyKiloSteps > 0 ? f(n / l.bodyKiloSteps, 4) : 'n/a');

// ---------------------------------------------------------------------------------------------------------
// Load everything
// ---------------------------------------------------------------------------------------------------------

const settingNames: string[] = SETTINGS.map((s) => s.name);
for (const v of PHAGE_VARIANTS) {
  const name = `${v.name}@${VARIANT_BASE}`;
  try {
    Deno.statSync(`${runsDir}/${name}`);
    settingNames.push(name);
  } catch {
    // not run
  }
}
const all = new Map<string, RunSummary>();
const key = (setting: string, arm: string, seed: number) => `${setting}/${arm}/${seed}`;
for (const setting of settingNames) {
  for (const arm of ARMS) {
    for (const seed of SEEDS) {
      const run = await loadRun(runsDir, setting, arm, seed);
      if (run) all.set(key(setting, arm, seed), run);
    }
  }
}
const get = (setting: string, arm: Arm, seed: number) => all.get(key(setting, arm, seed)) ?? null;
if (confirm && all.size === 0) {
  console.log(`No confirmation runs (seeds ${SEEDS[0]} to ${SEEDS[SEEDS.length - 1]}) under ${runsDir}: nothing to read. A confirmation writes to its own folder (PLAN.md); this line runs none.`);
  Deno.exit(1);
}

// ---------------------------------------------------------------------------------------------------------
// Per-window tables
// ---------------------------------------------------------------------------------------------------------

function readoutRow(label: string, w: WindowSummary): string {
  const r = w.readouts;
  return `| ${label} | ${w.from} to ${w.to} | ${f(r.count, 1)} (${r.countMin} to ${r.countMax}) | ${f(r.countFirstHalf, 1)} / ${f(r.countSecondHalf, 1)}${w.reading.settled ? '' : ' not settled'} | ${pct(r.surv100)} / ${pct(r.surv500)} / ${pct(r.surv1000)} | ${pct(w.size.share)} of ${w.size.kept} | ${f(r.disp1000, 1)} (${r.disp1000N}) | ${pct(r.keepUid1000)} | ${pct(r.keepMask1000)} (${pct(r.chance1000)}) | ${pct(r.solid)} | ${pct(r.isolated)} | ${f(r.moatMedian)} | ${f(r.peakMedian)} | ${f(r.areaMedian, 0)} | ${pct(w.coverHalves[0])} / ${pct(w.coverHalves[1])} | ${pct(w.lowCoverHalves[0])} / ${pct(w.lowCoverHalves[1])} | ${f(w.d1)} | ${phageText(w.phage)}; ${w.phageTypes} | ${w.reading.label} |`;
}
const READOUT_HEAD =
  '| Window | Count (min to max) | Halves | Kept id +100 / +500 / +1,000 | Size kept within a factor of 2, of those that kept their id +1,000 | Moved in 1,000 steps (tiles, n) | Tiles kept +1,000 (the earlier B2; no role here) | Tiles still wall +1,000 (chance) | Solid | Isolated | Moat | Peak wall median | Area | Tiles in objects, by half | Tiles with wall of 0.05 or more, by half | Mean D1 | Phage: mean over window / second half / last 2,000 steps (bar); types above a sixth of the bar | Reading |';
const READOUT_RULE = '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|';

function ledgerRow(label: string, w: WindowSummary): string {
  const l = w.ledger;
  const v = w.validity;
  const o = w.old;
  return `| ${label} | ${w.from} to ${w.to} | ${l.from} to ${l.to} | ${v.countAtStart} to ${v.countAtEnd} | ${l.bodiesAtStart} to ${l.bodiesAtEnd} | ${birthsText(l)} | ${deathsText(l)} | ${l.birthsTotal} - ${l.deathsTotal} = ${l.birthsTotal - l.deathsTotal} | ${v.net} (${f(v.netAllowed, 1)}) | ${pct(v.flickerShare)} | ${pct(v.unreadShare)} | ${validText(v)} | ${l.newFirstHalf.division + l.newFirstHalf.nothing} / ${l.newSecondHalf.division + l.newSecondHalf.nothing} | ${divisionText(w)} | ${l.continuations.relabelled} / ${l.continuations.parted} / ${l.continuations.returned} / ${l.continuations['handed on']} | ${variantText(w.ledger0)} | ${variantText(w.ledger2000)} | ${variantText(w.ledgerAny)} | ${newBirths(o)} (${o.newFirstHalf.fission + o.newSecondHalf.fission} by fission); ${o.lastingEnds - o.returnedEnds} | ${w.moveLog ? 'bodies' : 'ids (no move log)'} |`;
}
const LEDGER_HEAD =
  '| Window | Ledger stretch | Object count at its start and end | Bodies alive at its start and end | Births: division / split not shown apart / by relabelling / returned piece / from nothing | Deaths: fade / fusion / relabelled away | Births less deaths | Missed change in the object count (allowed) | Object-steps in flicker | Splits not readable | Ledger | New bodies the rule counts, first half / second half | Division read on this window alone (described) | Continuations: relabelled / parted / returned / handed on | Described only, no parting allowed (every merge a fusion): births as before; fade / fusion | Described only, a merge allowed 2,000 steps | Described only, a merge allowed any time | The earlier rule on this window: new bodies; lasting ends not returned | Apart read on |';
const LEDGER_RULE = '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|';

console.log('## Readouts per setting, arm, seed and tracked window\n');
console.log(`| Setting, arm, seed ${READOUT_HEAD}`);
console.log(`|---${READOUT_RULE}`);
for (const run of all.values()) for (const w of run.windows) console.log(`| ${run.setting} ${run.arm} ${run.seed} ${readoutRow('', w).slice(2)}`);

console.log('\n## The ledger of bodies per setting, arm, seed and tracked window\n');
console.log(`| Setting, arm, seed ${LEDGER_HEAD}`);
console.log(`|---${LEDGER_RULE}`);
for (const run of all.values()) for (const w of run.windows) console.log(`| ${run.setting} ${run.arm} ${run.seed} ${ledgerRow('', w).slice(2)}`);

console.log('\n## What became of bodies, by how they arose (PHAGE and NO_PHAGE windows)\n');
console.log('Each cell: faded / fused / relabelled away / still alive at the end of the ledger stretch.\n');
console.log('| Setting, arm, seed | Window | Present at the start | By division | Split not shown apart | By relabelling | Returned piece | From nothing |');
console.log('|---|---|---|---|---|---|---|---|');
const fateCell = (row: Record<DeathKind | 'alive', number> | undefined) => (row ? `${row.fade} / ${row.fusion} / ${row['relabelled away']} / ${row.alive}` : '0 / 0 / 0 / 0');
for (const run of all.values()) {
  if (run.arm !== 'PHAGE' && run.arm !== 'NO_PHAGE') continue;
  for (const w of run.windows) {
    const x = w.ledger.fates;
    console.log(`| ${run.setting} ${run.arm} ${run.seed} | ${w.from} to ${w.to} | ${fateCell(x['present at the start'])} | ${fateCell(x.division)} | ${fateCell(x['split not shown apart'])} | ${fateCell(x.relabel)} | ${fateCell(x['returned piece'])} | ${fateCell(x['from nothing'])} |`);
  }
}

console.log('\n## Described, no role in any rule: daughters, pattern changes, size and speed (PHAGE and NO_PHAGE windows)\n');
console.log('| Setting, arm, seed | Window | Bodies by division: n; tiles from the parent 1,000 steps after the split, median (n read); steps lived, median of those that ended (n), and still alive | Per body per 1,000 steps: births by division / splits not shown apart / births by relabelling / returned pieces / from nothing | Per body per 1,000 steps: deaths by fade / by fusion | Per body per 1,000 steps: whole-body relabellings | Area, median (tiles) | Moved in 1,000 steps, median (tiles) |');
console.log('|---|---|---|---|---|---|---|---|');
for (const run of all.values()) {
  if (run.arm !== 'PHAGE' && run.arm !== 'NO_PHAGE') continue;
  for (const w of run.windows) {
    const l = w.ledger;
    const div = l.newBodies.filter((b) => b.kind === 'division');
    const dist = div.map((b) => b.distance).filter((x): x is number => x !== null);
    const lived = div.map((b) => b.lived).filter((x): x is number => x !== null);
    console.log(`| ${run.setting} ${run.arm} ${run.seed} | ${w.from} to ${w.to} | ${div.length}; ${f(medianOf(dist), 1)} (${dist.length}); ${f(medianOf(lived), 0)} (${lived.length}), ${div.length - lived.length} | ${perKilo(l.births.division, l)} / ${perKilo(l.births['split not shown apart'], l)} / ${perKilo(l.births.relabel, l)} / ${perKilo(l.births['returned piece'], l)} / ${perKilo(l.births['from nothing'], l)} | ${perKilo(l.deaths.fade, l)} / ${perKilo(l.deaths.fusion, l)} | ${perKilo(l.continuations.relabelled, l)} | ${f(w.readouts.areaMedian, 0)} | ${f(w.readouts.disp1000, 1)} |`);
  }
}

console.log('\n## Erosion per PHAGE and NO_PHAGE window (the earlier readout; objects with at least 20 samples 50 steps apart)\n');
console.log('| Setting, arm, seed | Window | Bodies | Body-steps (thousands) | Recovered dips | Ends after a dip | Ends not after a dip | Per 1,000 body-steps: dips / ends after dip / other ends | Own phage per tile, median: usual / at a dip / before an end not after a dip / peak in the last 200 steps before an end |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const run of all.values()) {
  if (run.arm !== 'PHAGE' && run.arm !== 'NO_PHAGE') continue;
  for (const w of run.windows) {
    const e = w.erosion;
    if (!e || e.bodies === 0) continue;
    const k = e.bodyKiloSteps;
    console.log(`| ${run.setting} ${run.arm} ${run.seed} | ${w.from} to ${w.to} | ${e.bodies} | ${f(k, 0)} | ${e.recoveredDips} | ${e.endsAfterDip} | ${e.endsSudden} | ${f(e.recoveredDips / k, 4)} / ${f(e.endsAfterDip / k, 4)} / ${f(e.endsSudden / k, 4)} | ${f(e.phageUsual, 1)} / ${f(e.phageAtDip, 1)} / ${f(e.phageBeforeSuddenEnd, 1)} / ${f(e.phagePeakBeforeEnd, 1)} |`);
  }
}

console.log('\n## Phage load on objects per PHAGE window (the earlier readout; objects sampled every 50 steps)\n');
console.log('| Setting, seed | Window | Samples | With own phage of 1 unit per tile or more | 10 or more | Mean own phage per tile | Wall per tile, with 10 or more / with under 1 | Area, with 10 or more / with under 1 | Own-type phage on object tiles at the last census, as a share of all the dish\'s phage |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const run of all.values()) {
  if (run.arm !== 'PHAGE') continue;
  for (const w of run.windows) {
    const l = w.load;
    console.log(`| ${run.setting} ${run.seed} | ${w.from} to ${w.to} | ${l.samples} | ${pct(l.withPhage1)} | ${pct(l.withPhage10)} | ${f(l.meanPerTile, 1)} | ${f(l.wallLoaded, 3)} / ${f(l.wallClean, 3)} | ${f(l.areaLoaded, 1)} / ${f(l.areaClean, 1)} | ${pct(l.onFootprints)} |`);
  }
}

console.log('\n## Count by stretch of the run\n');
console.log('| Setting, arm, seed | Stretch | Mean count | Mean D1 | Mean phage |');
console.log('|---|---|---|---|---|');
for (const run of all.values()) {
  for (let a = 0; a < run.steps; a += a < 20_000 ? 10_000 : 20_000) {
    const b = Math.min(run.steps, a + (a < 20_000 ? 10_000 : 20_000));
    const w = run.rows.filter((r) => r.t > a && r.t <= b);
    console.log(`| ${run.setting} ${run.arm} ${run.seed} | ${a} to ${b} | ${f(meanOf(w.map((r) => r.drop)), 1)} | ${f(meanOf(w.map((r) => r.d1)))} | ${f(meanOf(w.map((r) => r.phage)), 0)} |`);
  }
}

// ---------------------------------------------------------------------------------------------------------
// The gate: NO_PHAGE, seeds 1 and 2
// ---------------------------------------------------------------------------------------------------------

const report: Record<string, unknown> = {};
/** The gate, the two-seed stage and the outcome table belong to the screen; a confirmation reading prints none of them. */
const say = (line: string) => {
  if (!confirm) console.log(line);
};
say('\n## The gate (NO_PHAGE, seeds 1 and 2)\n');
say('| Setting | Seed | Run to | Reading window | Flag | Reading | Bodies tests not met, with values | Ledger | Births in that window: division / split not shown apart / by relabelling / returned piece / from nothing | Deaths: fade / fusion / relabelled away | Gate |');
say('|---|---|---|---|---|---|---|---|---|---|---|');
const gate = new Map<string, boolean | null>();
const gateNote = new Map<string, string>();
for (const setting of settingNames) {
  if (setting !== baseSettingOf(setting)) continue;
  const seeds = [1, 2].map((s) => get(setting, 'NO_PHAGE', s));
  if (seeds.every((r) => r === null)) continue;
  const read = seeds.map((r) => (r ? readingWindow(r) : null));
  const complete = read.every((x) => x !== null && (x.flag === 'settled' || x.flag === 'not settled by 80,000'));
  const pass = complete ? gatePasses(read.map((x, k) => ({ seed: k + 1, label: x!.window!.reading.label, settled: x!.flag === 'settled' }))) : null;
  gate.set(setting, pass);
  gateNote.set(setting, read.map((x, k) => `seed ${k + 1}: ${x?.window ? `${x.window.reading.label}${x.window.reading.failed.length ? ` [${x.window.reading.failed.join('; ')}]` : ''}${x.flag === 'settled' ? '' : `, ${x.flag}`}` : 'not run'}`).join('; '));
  seeds.forEach((r, k) => {
    const x = read[k];
    if (!r || !x) {
      console.log(`| ${setting} | ${k + 1} | not run | | | | | | | | |`);
      return;
    }
    const w = x.window;
    console.log(`| ${setting} | ${k + 1} | ${r.steps} | ${w ? `${w.from} to ${w.to}` : ''} | ${x.flag} | ${w?.reading.label ?? ''} | ${w ? w.reading.failed.join('; ') || 'none' : ''} | ${w ? validText(w.validity) : ''} | ${w ? birthsText(w.ledger) : ''} | ${w ? deathsText(w.ledger) : ''} | ${k === 0 ? (pass === null ? 'incomplete' : pass ? '**passes**' : '**fails**') : ''} |`);
  });
}
report.gate = Object.fromEntries(gate);

// ---------------------------------------------------------------------------------------------------------
// The two-seed stage: PHAGE on seeds 1 and 2. Every seed is described, eligible or not.
// ---------------------------------------------------------------------------------------------------------

say('\n## The two-seed stage (PHAGE, seeds 1 and 2)\n');
say('| Setting | Seed | Run to | Reading window | Flag | Objects at its end | Reading | Bodies tests not met, with values | Phage: mean over window / second half / last 2,000 steps (bar) | Would be eligible | Ledger | Births: division / split not shown apart / by relabelling / returned piece / from nothing | Deaths: fade / fusion / relabelled away | Division on this window alone (described) | Pattern turnover PHAGE / NO_PHAGE over the same steps | Two-seed rule |');
say('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
const stage2 = new Map<string, OutcomeReading | null>();
const stage2Divisions = new Map<string, number>();
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
  // A "mixed / unclear" at this stage names every failed test with its value and threshold.
  const notes = rule && rule.outcome === 'mixed / unclear' ? read.map((x, k) => `seed ${k + 1}: ${[facts[k].dead ? 'no objects at the end' : '', ...x!.window!.reading.failed, facts[k].phageAlive ? '' : `phage not alive (${phageText(x!.window!.phage)})`].filter((s) => s).join('; ') || 'bodies with phage alive'}`) : rule?.notes ?? [];
  const shown = rule ? { ...rule, notes } : null;
  stage2.set(setting, shown);
  if (complete) stage2Divisions.set(setting, read.reduce((a, x) => a + x!.window!.ledger.births.division, 0));
  stage2Facts[setting] = shown ? { facts, ...shown, divisions: stage2Divisions.get(setting) } : 'incomplete';
  seeds.forEach((r, k) => {
    const x = read[k];
    if (!r || !x) {
      console.log(`| ${setting} | ${k + 1} | not run | | | | | | | | | | | | | |`);
      return;
    }
    const w = x.window;
    const end = w ? r.rows.find((row) => row.t === w.to)! : null;
    const np = get(baseSettingOf(setting), 'NO_PHAGE', k + 1);
    const npw = w && np ? np.windows.find((y) => y.from === w.from && y.to === w.to) ?? null : null;
    const eligible = w && end ? end.drop > 0 && w.reading.label === 'bodies' && x.flag === 'settled' && w.phage.alive : false;
    const verdict = k === 0 ? (shown === null ? 'incomplete' : shown.advance ? '**sent on to the four-seed stage**' : `**${shown.outcome}** (${shown.notes.join('; ')})`) : '';
    console.log(`| ${setting} | ${k + 1} | ${r.steps} | ${w ? `${w.from} to ${w.to}` : ''} | ${x.flag} | ${end ? end.drop : ''} | ${w?.reading.label ?? ''} | ${w ? w.reading.failed.join('; ') || 'none' : ''} | ${w ? phageText(w.phage) : ''} | ${eligible ? 'yes' : 'no: described only'} | ${w ? validText(w.validity) : ''} | ${w ? birthsText(w.ledger) : ''} | ${w ? deathsText(w.ledger) : ''} | ${w ? divisionText(w) : ''} | ${w ? f(w.turnover, 4) : ''} / ${npw ? f(npw.turnover, 4) : 'n/a'} | ${verdict} |`);
  });
}
report.stage2 = stage2Facts;
const sentOn = NEIGHBOURS.filter((n) => stage2.get(n)?.advance).map((n) => ({ name: n, divisions: stage2Divisions.get(n) ?? 0 }));
const rankedNeighbour = neighbourRank(sentOn);
report.neighbourRank = { sentOn, joins: rankedNeighbour };
if (sentOn.length > 0) console.log(`\nNeighbours sent on: ${sentOn.map((x) => `${x.name} (${x.divisions} divisions in its two PHAGE reading windows)`).join(', ')}. By the plan's rank ${rankedNeighbour} may join ${PRIMARY} at the four-seed stage, if the budget allows.`);

// ---------------------------------------------------------------------------------------------------------
// The four-seed stage. No outcome until every arm and seed has run to the end.
// ---------------------------------------------------------------------------------------------------------

const stage3 = new Map<string, Stage3Reading>();
const stage3Facts: Record<string, unknown> = {};
for (const setting of settingNames) {
  const started = SEEDS.some((s) => (get(setting, 'PHAGE', s)?.steps ?? 0) > STAGE12_CAP || get(setting, 'NEUTRAL_PHAGE', s) !== null);
  if (!started) continue;
  // A phage variant's four arms run under its own name; its no-phage arm is built with the variant's phage parameter too.
  const missing: string[] = [];
  for (const arm of ARMS) for (const s of SEEDS) if ((get(setting, arm, s)?.steps ?? 0) < STAGE3_STEPS) missing.push(`${arm} seed ${s}`);
  console.log(`\n## ${confirm ? 'Confirmation reading' : 'The four-seed stage'}: ${setting} (seeds ${SEEDS[0]} to ${SEEDS[SEEDS.length - 1]}, steps ${STAGE3_STEPS - WINDOW} to ${STAGE3_STEPS}; ${RULE.need} of ${RULE.n})\n`);
  if (missing.length > 0) {
    console.log(`Not complete: ${missing.join(', ')} not run to ${STAGE3_STEPS}. No outcome is read.`);
    continue;
  }
  const cut = (r: RunSummary) => r.rows.filter((row) => row.t <= STAGE3_STEPS);
  const lastRow = (arm: Arm, s: number) => cut(get(setting, arm, s)!)[STAGE3_STEPS / CENSUS - 1];
  const runs: ArmRuns = {};
  for (const arm of ARMS) for (const s of SEEDS) (runs[arm] ??= {})[s] = cut(get(setting, arm, s)!);
  const eps = endpoints(runs, SEEDS, STAGE3_STEPS);
  const d4 = eps.find((e) => e.id.startsWith('D4'))!;
  const seeds: MovingSeed[] = [];
  const founding: Ledger[] = [];
  const noPhage: Ledger[] = [];
  console.log('| Seed | Objects at step 100,000 | Reading | Bodies tests not met, with values | Phage: mean / second half / last 2,000 steps (bar); types | Kept id +1,000 | Size kept | Isolated | Moat | Eligible | Ledger: missed change (allowed), flicker, splits not readable | Births: division / split not shown apart / by relabelling / returned piece / from nothing | Deaths: fade / fusion / relabelled away | New bodies the rule counts (second half) | Division on this seed alone (described) | Pattern turnover PHAGE / NO_PHAGE (lag 1,000), above | Same at lag 5,000 | Leading type kept +1,000 PHAGE / NO_PHAGE | D4 | NO_PHAGE: objects at the end, reading; births; deaths | Pattern-blind arm: objects at the end, reading | One-wall arm: objects at the end, reading |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const s of SEEDS) {
    const p = get(setting, 'PHAGE', s)!;
    const n = get(setting, 'NO_PHAGE', s)!;
    const w = windowAt(p, STAGE3_STEPS)!;
    const wn = windowAt(n, STAGE3_STEPS)!;
    const end = lastRow('PHAGE', s);
    const win = turnoverAbove(w.turnover, wn.turnover, lastRow('NO_PHAGE', s).drop > 0);
    const seed: MovingSeed = { seed: s, dead: end.drop === 0, label: w.reading.label, settled: w.reading.settled, phageAlive: w.phage.alive, failed: w.reading.failed, phageNote: phageText(w.phage), ledger: w.ledger, validity: w.validity, turnoverWin: win, d4: d4.perSeed[s] === true };
    seeds.push(seed);
    noPhage.push(wn.ledger);
    const fw = p.windows.find((x) => x.from === 0);
    if (fw) founding.push(fw.ledger);
    const eligible = !seed.dead && seed.label === 'bodies' && seed.settled && seed.phageAlive;
    const other = (arm: Arm) => {
      const fwin = windowAt(get(setting, arm, s)!, STAGE3_STEPS);
      return `${lastRow(arm, s).drop}, ${fwin ? fwin.reading.label : 'n/a'}`;
    };
    const l = w.ledger;
    const v = w.validity;
    console.log(
      `| ${s} | ${end.drop} | ${w.reading.label}${w.reading.settled ? '' : ', not settled'} | ${w.reading.failed.join('; ') || 'none'} | ${phageText(w.phage)}; ${w.phageTypes} | ${pct(w.readouts.surv1000)} | ${pct(w.size.share)} | ${pct(w.readouts.isolated)} | ${f(w.readouts.moatMedian)} | ${eligible ? 'yes' : 'no: described only'} | ${validText(v)}: ${v.net} (${f(v.netAllowed, 1)}), ${pct(v.flickerShare)}, ${pct(v.unreadShare)} | ${birthsText(l)} | ${deathsText(l)} | ${l.births.division + l.births['from nothing']} (${l.newSecondHalf.division + l.newSecondHalf.nothing}) | ${divisionText(w)} | ${f(w.turnover, 4)} / ${f(wn.turnover, 4)}, ${win ? 'yes' : 'no'} | ${f(w.turnover5000, 4)} / ${f(wn.turnover5000, 4)} | ${pct(w.keepLead)} / ${pct(wn.keepLead)} | ${seed.d4 ? 'yes' : 'no'} | ${other('NO_PHAGE')}; ${birthsText(wn.ledger)}; ${deathsText(wn.ledger)} | ${other('NEUTRAL_PHAGE')} | ${other('SINGLE_WALL')} |`,
    );
  }
  const outcome = stage3Outcome(seeds, RULE);
  const foundingDivision = readDivision(founding);
  const allSeeds = readDivision(seeds.map((x) => x.ledger));
  const noPhageDivision = readDivision(noPhage);
  console.log(`\n| Endpoint (final 20% of the run) | Seeds ${SEEDS[0]} to ${SEEDS[SEEDS.length - 1]} | Wins |`);
  console.log('|---|---|---|');
  for (const e of eps) console.log(`| ${e.id} | ${SEEDS.map((s) => (e.perSeed[s] === null ? 'not run' : e.perSeed[s] ? 'yes' : 'no')).join(', ')} | ${e.wins} of ${e.of} |`);
  console.log(`\n- Eligible seeds (objects at the end, bodies, phage alive, settled window): ${outcome.eligible.length ? outcome.eligible.join(', ') : 'none'}. Of those, with a valid ledger: ${outcome.readable.length ? outcome.readable.join(', ') : 'none'}.`);
  const d = outcome.division;
  if (d) console.log(`- Division, settled windows of the readable seeds pooled: ${d.division} by division of ${d.newBodies} new bodies (${pct(d.share)}), ${d.secondHalf} in the second half, ${d.contributing} seeds with at least 5; set aside: ${d.notApart} splits not shown apart, ${d.relabel} bodies by relabelling, ${d.returnedPiece} returned pieces; ${d.deaths} body deaths against ${d.births} body births: **${d.label}**${d.failed.length ? ` (${d.failed.join('; ')})` : ''}.`);
  console.log(`- Described only, all four PHAGE seeds pooled whatever they read: ${allSeeds.division} by division of ${allSeeds.newBodies} new bodies (${pct(allSeeds.share)}); ${allSeeds.notApart} splits not shown apart, ${allSeeds.relabel} by relabelling, ${allSeeds.returnedPiece} returned pieces; ${allSeeds.deaths} deaths against ${allSeeds.births} births: ${allSeeds.label}.`);
  console.log(`- Described only, the same rule on the four NO_PHAGE windows pooled: ${noPhageDivision.division} by division of ${noPhageDivision.newBodies} new bodies (${pct(noPhageDivision.share)}); ${noPhageDivision.notApart} splits not shown apart, ${noPhageDivision.relabel} by relabelling, ${noPhageDivision.returnedPiece} returned pieces; ${noPhageDivision.deaths} deaths against ${noPhageDivision.births} births: ${noPhageDivision.label}${noPhageDivision.failed.length ? ` (${noPhageDivision.failed.join('; ')})` : ''}.`);
  console.log(`- Founding windows pooled (steps 500 to 9,000; decides nothing): ${foundingDivision.division} by division of ${foundingDivision.newBodies} new bodies.`);
  console.log(`- On eligible seeds: pattern turnover above NO_PHAGE on ${outcome.turnoverWins}, D4 on ${outcome.d4Wins}.`);
  console.log(`- ${confirm ? 'Confirmation rule' : 'Four-seed rule'} (${RULE.need} of ${RULE.n}, at least ${RULE.minBirths} new bodies): **${outcome.outcome}** (${outcome.notes.join('; ')}).`);
  stage3.set(setting, outcome);
  stage3Facts[setting] = { seeds: seeds.map(({ ledger, ...rest }) => ({ ...rest, births: ledger.births, deaths: ledger.deaths })), outcome, foundingDivision, noPhageDivision, allSeedsDivision: allSeeds, endpoints: eps };
}
report.stage3 = stage3Facts;
if (confirm) {
  // A confirmation reading is the many-seed rule alone: no gate, two-seed stage, late window, controls or screen outcome.
  if (stage3.size === 0) console.log(`\nNo setting under ${runsDir} has all four arms run to ${STAGE3_STEPS} steps on seeds ${SEEDS[0]} to ${SEEDS[SEEDS.length - 1]}: no confirmation reading.`);
  if (jsonOut) await Deno.writeTextFile(jsonOut, JSON.stringify({ confirmation: stage3Facts }, null, 1) + '\n');
  Deno.exit(stage3.size === 0 ? 1 : 0);
}

// ---------------------------------------------------------------------------------------------------------
// The late window (described; does not change an outcome)
// ---------------------------------------------------------------------------------------------------------

const late: Record<string, unknown> = {};
for (const setting of settingNames) {
  const runs = [1, 2].flatMap((s) => (['PHAGE', 'NO_PHAGE'] as const).map((arm) => ({ arm, s, run: get(setting, arm, s) })));
  const done = runs.filter((x) => x.run && x.run.steps >= LATE_STEPS);
  if (done.length === 0) continue;
  console.log(`\n## The late window: ${setting} (seeds 1 and 2, steps ${LATE_STEPS - WINDOW} to ${LATE_STEPS}; reported, changes no outcome)\n`);
  const lacking = runs.filter((x) => !x.run || x.run.steps < LATE_STEPS).map((x) => `${x.arm} seed ${x.s}`);
  if (lacking.length > 0) console.log(`Not complete: ${lacking.join(', ')} not run to ${LATE_STEPS}.\n`);
  console.log('| Arm | Seed | Objects at step 200,000 | Reading | Bodies tests not met, with values | Phage | Ledger | Births: division / split not shown apart / by relabelling / returned piece / from nothing | Deaths: fade / fusion / relabelled away | New bodies the rule counts (second half) | Division on this window alone | Pattern turnover (lag 1,000) |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
  const rowsOut: unknown[] = [];
  const readable: Ledger[] = [];
  for (const { arm, s, run } of done) {
    const w = windowAt(run!, LATE_STEPS)!;
    const l = w.ledger;
    const drop = run!.rows.find((r) => r.t === LATE_STEPS)!.drop;
    // The same conditions as an eligible, readable seed (phage alive asked of the PHAGE world only).
    const ok = drop > 0 && w.reading.label === 'bodies' && w.reading.settled && w.validity.ok && (arm !== 'PHAGE' || w.phage.alive);
    if (ok && arm === 'PHAGE') readable.push(l);
    console.log(`| ${arm} | ${s} | ${drop} | ${w.reading.label}${w.reading.settled ? '' : ', not settled'} | ${w.reading.failed.join('; ') || 'none'} | ${phageText(w.phage)} | ${validText(w.validity)} | ${birthsText(l)} | ${deathsText(l)} | ${l.births.division + l.births['from nothing']} (${l.newSecondHalf.division + l.newSecondHalf.nothing}) | ${ok ? '' : 'described only: '}${divisionText(w)} | ${f(w.turnover, 4)} |`);
    rowsOut.push({ arm, seed: s, reading: w.reading.label, settled: w.reading.settled, births: l.births, deaths: l.deaths, valid: w.validity.ok, readable: ok, ...divisionJson(w, ok), turnover: w.turnover });
  }
  const pooled = readable.length > 0 ? readDivision(readable) : null;
  console.log(`\n- PHAGE late windows that read bodies with phage alive, settled, with a valid ledger: ${readable.length} of 2.${pooled ? ` Pooled: ${pooled.division} by division of ${pooled.newBodies} new bodies, ${pooled.secondHalf} in the second half, ${pooled.deaths} deaths against ${pooled.births} births: ${pooled.label}${pooled.failed.length ? ` (${pooled.failed.join('; ')})` : ''}.` : ' Division late is not readable.'}`);
  late[setting] = { rows: rowsOut, pooled, lacking };
}
report.late = late;

// ---------------------------------------------------------------------------------------------------------
// Controls: stored windows of the earlier screen, replayed with the move log
// ---------------------------------------------------------------------------------------------------------

const controls: unknown[] = [];
try {
  const root = `${runsDir}/controls`;
  const found: { setting: string; arm: string; seed: number; path: string; from: number }[] = [];
  for (const st of Deno.readDirSync(root)) {
    if (!st.isDirectory) continue;
    for (const arm of Deno.readDirSync(`${root}/${st.name}`)) {
      for (const sd of Deno.readDirSync(`${root}/${st.name}/${arm.name}`)) {
        for (const e of Deno.readDirSync(`${root}/${st.name}/${arm.name}/${sd.name}`)) {
          if (e.name.startsWith('seg-') && e.name.endsWith('.json')) found.push({ setting: st.name, arm: arm.name, seed: Number(sd.name.split('-')[1]), path: `${root}/${st.name}/${arm.name}/${sd.name}/${e.name}`, from: Number(e.name.split('-')[1]) });
        }
      }
    }
  }
  found.sort((a, b) => a.setting.localeCompare(b.setting) || a.arm.localeCompare(b.arm) || a.seed - b.seed || a.from - b.from);
  if (found.length > 0) {
    console.log('\n## Controls: stored windows of the earlier screen, replayed with the move log\n');
    console.log(`| Setting, arm, seed ${READOUT_HEAD}`);
    console.log(`|---${READOUT_RULE}`);
    const ws: { tag: string; w: WindowSummary }[] = [];
    for (const x of found) {
      const file = JSON.parse(await Deno.readTextFile(x.path)) as MovingSegmentFile;
      for (const r of file.rows) if (r.res !== 0) throw new Error(`matter residual in ${x.path}`);
      const w = summarizeWindow(file);
      ws.push({ tag: `${x.setting} ${x.arm} ${x.seed}`, w });
      console.log(`| ${x.setting} ${x.arm} ${x.seed} ${readoutRow('', w).slice(2)}`);
    }
    console.log(`\n| Setting, arm, seed ${LEDGER_HEAD}`);
    console.log(`|---${LEDGER_RULE}`);
    for (const { tag, w } of ws) {
      console.log(`| ${tag} ${ledgerRow('', w).slice(2)}`);
      controls.push({ run: tag, from: w.from, to: w.to, reading: w.reading.label, checks: w.reading.checks, failed: w.reading.failed, sizeKept: w.size, births: w.ledger.births, deaths: w.ledger.deaths, validity: w.validity, ...divisionJson(w) });
    }
  }
} catch (e) {
  if (!(e instanceof Deno.errors.NotFound)) throw e;
}
report.controls = controls;

// ---------------------------------------------------------------------------------------------------------
// One outcome per setting
// ---------------------------------------------------------------------------------------------------------

say('\n## Outcome per setting\n');
say('| Setting | Rates and phage changes | Gate | Two-seed stage | Four-seed stage | Outcome | Why |');
say('|---|---|---|---|---|---|---|');
const outcomes: Record<string, unknown> = {};
for (const setting of settingNames) {
  const def = settingOf(setting);
  // A phage variant stands on its rate setting's gate: its no-phage world is that setting's.
  const g = gate.get(baseSettingOf(setting)) ?? null;
  const s2 = stage2.get(setting) ?? null;
  const s3 = stage3.get(setting) ?? null;
  const notRunWhy = notRun.get(setting) ?? (NEIGHBOURS.includes(setting) && s2?.advance && rankedNeighbour !== setting ? `the plan's rank sends ${rankedNeighbour} on, not this one` : undefined);
  const final = settingOutcome({ gate: g, gateNote: gateNote.get(baseSettingOf(setting)) ?? '', stage2: s2, stage3: s3, notRunWhy });
  outcomes[setting] = final ?? 'incomplete';
  const changes = { ...def.rates, ...def.phage };
  say(`| ${setting} | ${Object.entries(changes).map(([k, v]) => `${k} ${v}`).join(', ')} | ${g === null ? 'incomplete' : g ? 'passes' : 'fails'} | ${s2 === null ? 'not read' : s2.advance ? 'sent on' : s2.outcome} | ${s3 === null ? 'not read' : s3.outcome} | ${final ? `**${final.outcome}**` : 'incomplete'} | ${final ? final.notes.join('; ') : ''} |`);
}
report.outcomes = outcomes;

if (jsonOut) {
  const slim = (w: WindowSummary) => {
    const { newBodies, ...ledger } = w.ledger;
    const div = newBodies.filter((b) => b.kind === 'division');
    return { ...w, ledger: { ...ledger, divisionDistanceMedian: medianOf(div.map((b) => b.distance).filter((x): x is number => x !== null)), divisionLivedMedian: medianOf(div.map((b) => b.lived).filter((x): x is number => x !== null)) } };
  };
  const runsOut = [...all.values()].map((r) => ({ setting: r.setting, arm: r.arm, seed: r.seed, steps: r.steps, bound: r.bound, windows: r.windows.map(slim) }));
  await Deno.writeTextFile(jsonOut, JSON.stringify({ ...report, runs: runsOut }, null, 1) + '\n');
  console.log(`\nwrote ${jsonOut}`);
}
