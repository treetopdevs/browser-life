/**
 * "Compare with the recorded run": does the live model reproduce a saved replay?
 *
 * The replay file is one of the recordings under docs/creative-prototypes/ (kept out of git; see
 * ARTIFACTS.md). The check rebuilds the card's world from tick 0 through the same loadModel(key) path and the
 * same arm and seed, steps it in slices, and compares:
 *  - the per-tick rows (population, cells, births, deaths, blocked births, cap flags) at every tick;
 *  - the census and environment at every recorded sample tick (every 20 ticks);
 *  - the frame projection (food bytes, cells, bodies, ledger) at every recorded frame;
 *  - at saved snapshot ticks, the full snapshot with the host runtime label set to a fixed string on both sides
 *    ("equal after ignoring the runtime label"), plus whether the recording hashes to its own stateSha256.
 * It fails closed: anything missing, truncated or mislabelled returns `invalid` or `partial`, never `identical`.
 */
import { makeWorld, type ModelModule, type WorldApi } from './models.ts';
import { encodeBase64 } from './render.ts';
import type { FoodModeId } from './screens.ts';

export type ReplayResult =
  | { readonly status: 'unavailable'; readonly reason: string }
  | { readonly status: 'invalid'; readonly reason: string }
  | { readonly status: 'partial'; readonly recordedTicks: number; readonly horizon: number; readonly compared: ComparedCounts; readonly integrity: Integrity }
  | { readonly status: 'identical'; readonly finalTick: number; readonly compared: ComparedCounts; readonly extinctionTick: number | null; readonly integrity: Integrity; readonly intact: boolean }
  | { readonly status: 'differs'; readonly firstTick: number; readonly field: string; readonly detail: string };

/** verified: every saved snapshot hashed to its stored digest. failed: one did not, or had none. unchecked: this origin has no crypto.subtle. */
export type Integrity = 'verified' | 'failed' | 'unchecked';

export interface ComparedCounts { readonly ticks: number; readonly samples: number; readonly frames: number; readonly snapshots: number }

export interface ReplayExpectation {
  readonly seed: number;
  readonly mode: FoodModeId;
  readonly horizon: number;
  readonly mod: ModelModule;
}

export interface Progress { readonly tick: number; readonly of: number }

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Number.isNaN(a) && Number.isNaN(b);
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every(k => k in b && deepEqual(a[k], b[k]));
  }
  return false;
}

/** The first path at which two plain values differ, for the message. */
export function firstDifference(a: unknown, b: unknown, path = ''): string | null {
  if (deepEqual(a, b)) return null;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}.length (${a.length} live, ${b.length} recorded)`;
    for (let i = 0; i < a.length; i++) { const d = firstDifference(a[i], b[i], `${path}[${i}]`); if (d) return d; }
  }
  if (isObj(a) && isObj(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = firstDifference(a[k], b[k], path ? `${path}.${k}` : k); if (d) return d; }
  }
  return path || 'value';
}

async function sha256Hex(text: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('');
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** Checks that need no stepping. Returns a reason or null. Used before and independently of the comparison. */
export function validateRecording(value: unknown, expected: ReplayExpectation): string | null {
  if (!isObj(value)) return 'the file is not a JSON object';
  const { run, samples, tickRows, frames, snapshots, rules } = value as Obj;
  if (!isObj(run)) return 'no run description';
  if (run.seed !== expected.seed) return `recorded seed ${String(run.seed)} is not ${expected.seed}`;
  if (run.mode !== expected.mode) return `recorded mode ${String(run.mode)} is not ${expected.mode}`;
  if (run.mutation !== true) return 'recorded run did not have mutation on';
  if (!num(run.finalTick)) return 'no final tick';
  if (!num(run.maxTick)) return 'no recorded horizon';
  if (run.finalTick > run.maxTick) return `final tick ${run.finalTick} is beyond the recorded horizon ${run.maxTick}`;
  if (run.finalTick > expected.horizon) return `final tick ${run.finalTick} is beyond the screen's horizon ${expected.horizon}`;
  // A shorter recording (for example a 3,000-tick run beside a 6,000-tick screen) is allowed but can only ever be "partial".
  if (run.maxTick > expected.horizon) return `recorded horizon ${run.maxTick} is longer than the screen's ${expected.horizon}`;
  const final = run.finalTick;
  const extinct = run.extinctionTick;
  if (extinct !== null && extinct !== undefined && extinct !== final) return `extinction tick ${String(extinct)} is not the final tick ${final}`;
  if (!isObj(rules) || !deepEqual(rules, expected.mod.RULES)) return 'the recorded rules differ from the model this page loaded';
  if (!Array.isArray(samples) || samples.length === 0) return 'no samples';
  if (!Array.isArray(tickRows) || tickRows.length === 0) return 'no per-tick rows';
  if (!Array.isArray(frames) || frames.length === 0) return 'no frames';
  if (!Array.isArray(snapshots) || snapshots.length === 0) return 'no saved snapshots';
  const sampleTicks: number[] = [];
  for (let t = 0; t <= final; t += 20) sampleTicks.push(t);
  if (extinct !== null && extinct !== undefined && final % 20 !== 0) sampleTicks.push(final);
  if (samples.length !== sampleTicks.length || !samples.every((s, i) => isObj(s) && s.tick === sampleTicks[i])) return 'samples are not at an exact 20-tick cadence from tick 0';
  if (frames.length !== sampleTicks.length || !frames.every((f, i) => isObj(f) && f.tick === sampleTicks[i])) return 'frames are not at the sample ticks';
  if (tickRows.length !== final || !tickRows.every((r, i) => isObj(r) && r.tick === i + 1)) return 'per-tick rows are not contiguous from tick 1 to the final tick';
  const seen = new Set<number>();
  for (const s of snapshots) {
    if (!isObj(s) || !num(s.tick) || s.tick > final || seen.has(s.tick) || !isObj(s.state) || !isObj(s.environment)) return 'a saved snapshot is malformed or duplicated';
    seen.add(s.tick);
  }
  if (!seen.has(0)) return 'no snapshot at tick 0';
  if (!seen.has(final)) return 'no snapshot at the final tick';
  const sampleSet = new Set(sampleTicks);
  for (const tick of seen) if (!sampleSet.has(tick)) return `a saved snapshot at tick ${tick} is not at a sample tick, so it could not be compared`;
  return null;
}

function censusKeys(world: WorldApi) {
  const census = world.census();
  return census;
}

function frameProjection(world: WorldApi): Obj {
  const cells: [number, number][] = [];
  for (const o of world.organisms) for (const c of o.cells) cells.push([c.tile, o.id]);
  cells.sort((a, b) => a[0] - b[0]);
  return {
    foodBase64: encodeBase64(world.food),
    cells,
    organisms: world.organisms.map(o => ({ id: o.id, family: o.family, genome: o.genome })),
    ledger: world.ledger,
  };
}

/** Compare a live world with one recorded frame. Returns the first differing field, or null. */
export function compareFrame(world: WorldApi, frame: unknown): string | null {
  if (!isObj(frame)) return 'frame';
  const live = frameProjection(world);
  for (const key of ['foodBase64', 'cells', 'organisms', 'ledger']) {
    if (!deepEqual(live[key], frame[key])) return `frame.${key === 'foodBase64' ? 'food' : key}`;
  }
  return null;
}

function tickRow(world: WorldApi, previous: ReturnType<WorldApi['census']>, census: ReturnType<WorldApi['census']>, maxOrganisms: number): Obj {
  return {
    tick: world.tick, population: census.population, cells: census.cells,
    births: census.births - previous.births, deaths: census.deaths - previous.deaths,
    blockedCap: census.blockedCapBirths - previous.blockedCapBirths, blockedSpace: census.blockedSpaceBirths - previous.blockedSpaceBirths,
    cap48: census.population === maxOrganisms, nearCap47: census.population >= maxOrganisms - 1,
  };
}

const FIXED = 'normalised';
async function compareSnapshot(world: WorldApi, record: Obj): Promise<{ field: string | null; integrity: Integrity }> {
  const recordedState = record.state as Obj;
  const normalisedRecorded = { ...recordedState, runtime: FIXED };
  const normalisedLive = { ...world.snapshot(), runtime: FIXED };
  const field = firstDifference(normalisedLive, normalisedRecorded, 'snapshot') ?? firstDifference(world.environment, record.environment, 'snapshot.environment');
  // The recording must also hash to its own stateSha256 once its original runtime label is in place.
  const own = await sha256Hex(JSON.stringify({ state: recordedState, environment: record.environment }));
  const integrity: Integrity = own === null ? 'unchecked' : typeof record.stateSha256 === 'string' && own === record.stateSha256 ? 'verified' : 'failed';
  return { field, integrity };
}

const yieldToBrowser = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/**
 * Replay the recording against a fresh world. `sliceTicks` bounds how long one task runs; between slices the
 * page gets control back and `onProgress` is called.
 */
export async function checkReplay(recording: unknown, expected: ReplayExpectation, options: { sliceTicks?: number; onProgress?: (p: Progress) => void; signal?: { aborted: boolean } } = {}): Promise<ReplayResult> {
  const invalid = validateRecording(recording, expected);
  if (invalid) return { status: 'invalid', reason: invalid };
  const rec = recording as Obj;
  const run = rec.run as Obj;
  const final = run.finalTick as number;
  const samples = rec.samples as Obj[];
  const frames = rec.frames as Obj[];
  const rows = rec.tickRows as Obj[];
  const snapshots = new Map((rec.snapshots as Obj[]).map(s => [s.tick as number, s]));
  const maxOrganisms = expected.mod.RULES.maxOrganisms!;
  const slice = options.sliceTicks ?? 100;

  const world = makeWorld(expected.mod, expected.seed, expected.mode);
  let previous = world.census();
  let integrity: Integrity = 'verified';
  const counts = { ticks: 0, samples: 0, frames: 0, snapshots: 0 };
  const differs = (tick: number, field: string, detail: string): ReplayResult => ({ status: 'differs', firstTick: tick, field, detail });

  const atSampleTick = async (tick: number): Promise<ReplayResult | null> => {
    const sample = samples.find(s => s.tick === tick)!;
    const census = censusKeys(world);
    const censusDiff = firstDifference(census, sample.census, 'census');
    if (censusDiff) return differs(tick, censusDiff, 'census at a recorded sample');
    const envDiff = firstDifference(world.environment, sample.environment, 'environment');
    if (envDiff) return differs(tick, envDiff, 'food environment at a recorded sample');
    counts.samples++;
    const frameDiff = compareFrame(world, frames.find(f => f.tick === tick));
    if (frameDiff) return differs(tick, frameDiff, 'frame at a recorded tick');
    counts.frames++;
    const snapshot = snapshots.get(tick);
    if (snapshot) {
      const result = await compareSnapshot(world, snapshot);
      if (result.field) return differs(tick, result.field, 'saved snapshot, ignoring only the runtime label');
      if (result.integrity === 'failed') integrity = 'failed';
      else if (result.integrity === 'unchecked' && integrity === 'verified') integrity = 'unchecked';
      counts.snapshots++;
    }
    return null;
  };

  const first = await atSampleTick(0);
  if (first) return first;
  for (let tick = 1; tick <= final;) {
    if (options.signal?.aborted) return { status: 'unavailable', reason: 'the check was cancelled' };
    const end = Math.min(final, tick + slice - 1);
    for (; tick <= end; tick++) {
      world.step(1);
      if (world.tick !== tick) return differs(tick, 'tick', `the live world stopped at tick ${world.tick} (extinction ${String(world.extinctionTick)})`);
      const census = world.census();
      const row = tickRow(world, previous, census, maxOrganisms);
      const recorded = rows[tick - 1]!;
      for (const key of Object.keys(row)) {
        if (!deepEqual(row[key], recorded[key])) return differs(tick, `tickRows.${key}`, `per-tick row (live ${String(row[key])}, recorded ${String(recorded[key])})`);
      }
      counts.ticks++;
      previous = census;
      if (tick % 20 === 0 || (world.extinctionTick === tick && tick === final)) {
        const result = await atSampleTick(tick);
        if (result) return result;
      }
    }
    options.onProgress?.({ tick: end, of: final });
    await yieldToBrowser();
  }
  if (counts.snapshots !== snapshots.size) return differs(final, 'snapshots', `compared ${counts.snapshots} of ${snapshots.size} saved snapshots`);
  const extinctionTick = (run.extinctionTick as number | null | undefined) ?? null;
  if (world.extinctionTick !== extinctionTick) return differs(final, 'extinctionTick', `live extinction ${String(world.extinctionTick)}, recorded ${String(extinctionTick)}`);
  if (final < expected.horizon && extinctionTick === null) return { status: 'partial', recordedTicks: final, horizon: expected.horizon, compared: counts, integrity };
  return { status: 'identical', finalTick: final, compared: counts, extinctionTick, integrity, intact: integrity === 'verified' };
}

function integrityNote(integrity: Integrity): string {
  return integrity === 'failed' ? ' Warning: the recording does not hash to its own stored digest.' : integrity === 'unchecked' ? ' The recording\u2019s own digest could not be checked on this page (it needs a secure origin such as localhost).' : '';
}

/** One-line summary for the page. */
export function describeResult(label: string, result: ReplayResult): string {
  const fmt = (n: number) => n.toLocaleString('en-US');
  switch (result.status) {
    case 'identical': {
      const ends = result.extinctionTick === null ? `all ${fmt(result.finalTick)} recorded ticks` : `all ${fmt(result.finalTick)} recorded ticks (the recorded run ends in extinction at tick ${fmt(result.extinctionTick)})`;
      return `${label}: identical at ${ends}. Compared ${fmt(result.compared.ticks)} per-tick rows, ${fmt(result.compared.samples)} census samples, ${fmt(result.compared.frames)} frames and ${fmt(result.compared.snapshots)} saved snapshots, equal after ignoring the runtime label.${integrityNote(result.integrity)}`;
    }
    case 'differs': return `${label}: first differs at tick ${fmt(result.firstTick)} in ${result.field} (${result.detail}).`;
    case 'partial': return `${label}: partial. The recording covers ${fmt(result.recordedTicks)} of ${fmt(result.horizon)} ticks and the live world matched all of them; the rest is not checked.${integrityNote(result.integrity)}`;
    case 'invalid': return `${label}: not compared. ${result.reason}.`;
    case 'unavailable': return `${label}: ${result.reason}.`;
  }
}

/** Fetch a recording. HEAD first, so absent files cost nothing; anything that is not JSON counts as absent. */
export async function recordedAvailable(url: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetcher(url, { method: 'HEAD' });
    return response.ok && (response.headers.get('content-type') ?? '').includes('json');
  } catch {
    return false;
  }
}

export async function fetchRecording(url: string, fetcher: typeof fetch = fetch): Promise<{ ok: true; data: unknown } | { ok: false; reason: string }> {
  try {
    const response = await fetcher(url);
    if (!response.ok) return { ok: false, reason: `the recording is not available here (HTTP ${response.status})` };
    if (!(response.headers.get('content-type') ?? '').includes('json')) return { ok: false, reason: 'the recording is not available here (not JSON)' };
    return { ok: true, data: await response.json() };
  } catch (error) {
    return { ok: false, reason: `the recording could not be read (${error instanceof Error ? error.message : 'network error'})` };
  }
}

export function replayUrl(file: string): string { return `/docs/creative-prototypes/${file}`; }
