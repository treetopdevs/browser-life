/**
 * MOVING6 runner: one arm of the confirmation, at one rate setting of this line, on the frozen droplet
 * kernel's GPU form (docs/six-wall-moving-2026-11-22/PLAN.md). The kernel is not edited.
 *
 *   deno run -A --no-lock experiments/moving6/run.ts --setting MIX25 --arm PHAGE --seed 1 --out runs/moving6 \
 *     --steps 40000 --track 0-10000,20000-40000 --snap 30000,31000,32000
 *
 * Replay of one stored tracked window of the earlier screen, to log more from the same world:
 *
 *   deno run -A --no-lock experiments/moving6/run.ts --replay <stored runs/spot6> --setting MIX50 --arm PHAGE --seed 1 \
 *     --window 80000-100000 --out runs/moving6/controls
 *
 * This file is a copy of experiments/spot6/run.ts, which is a top-level script bound to the earlier screen's
 * list of settings and cannot be imported. What differs:
 * - setting names resolve through this line's list (settings.ts): `MIX25`, `MIX12`, `MIX37` and the two phage
 *   variants at `MIX25`; seeds 1 to 4 only;
 * - tracked segments also keep a move log (movelog.ts);
 * - a segment file written by the earlier runner is accepted as this run's own if its header is the same in
 *   everything but the `check` name, so the stored `MIX25` runs are continued, not re-run;
 * - `--replay`: runs one stored tracked window again from its stored start state (or from the seeded world at
 *   step 0), with the earlier screen's own construction of the world, and stops unless the census rows, the
 *   tracker output, the body log and the end state are equal to the stored ones value for value. It reads the
 *   stored folder and writes only under `--out`.
 * The tracker, body log, segment cutter and freeze check are imported unchanged. The per-census stops are the
 * earlier runner's: matter residual 0, and object count equal to `observeFindDroplets`.
 */

import { DropletKernelRef, observeFindDroplets, observeMotifStats, observeTotalMatter } from '../../apps/lab/src/oligomer/droplets-kernel.ts';
import { DropletGpuSim } from '../../apps/lab/src/oligomer/droplets-gpu.ts';
import { seedPhageArena } from '../../apps/lab/src/oligomer/droplet-worlds.ts';
import { argOf, assertFrozen, exists } from '../confirm/io.ts';
import { labelObjects, LOW_THRESH, MOTIFS, ObjectTracker } from '../b2check/observe.ts';
import { buildSegments, type Segment } from '../b2check/segments.ts';
import { BodyLog } from '../spot6/bodylog.ts';
import type { Row } from '../spot6/rule.ts';
import { buildSpec as storedSpec } from '../spot6/settings.ts';
import { MoveLog, type MovingSegmentFile } from './movelog.ts';
import { buildSpec, CENSUS, emergenceBound } from './settings.ts';

const setting = argOf('setting');
const arm = argOf('arm');
const seed = Number(argOf('seed'));
const out = argOf('out');
const replay = argOf('replay', '');
const dt = Number(argOf('dt', '10'));
if (!Number.isInteger(seed) || !Number.isInteger(dt) || dt <= 0 || 100 % dt !== 0) throw new Error('bad --seed or --dt (dt must divide 100)');

const frozen = await assertFrozen('droplets');
// A replay builds the world exactly as the earlier screen did; a new run only at this line's settings. Both refuse a seed outside 1 to 4.
const spec = replay ? storedSpec(setting, arm, seed) : buildSpec(setting, arm, seed);
const N = spec.size * spec.size;
const dir = `${out}/${setting}/${arm}/seed-${seed}`;
await Deno.mkdir(dir, { recursive: true });
const meta = { check: 'moving6', setting, arm, seed, size: spec.size, dt, census: CENSUS, cfg: spec.cfg, emergenceBound: emergenceBound(spec.cfg), frozen };
/** The header without the `check` name: a segment of the earlier screen is the same run if this is equal. */
const sameRun = (m: Record<string, unknown>) => JSON.stringify({ ...m, check: '' }) === JSON.stringify({ ...meta, check: '' });

const adapter = await navigator.gpu.requestAdapter();
if (!adapter) throw new Error('No WebGPU adapter available');
const device = await adapter.requestDevice();
let gpuError: string | null = null;
device.addEventListener?.('uncapturederror', (e) => {
  gpuError = (e as GPUUncapturedErrorEvent).error.message;
});

const segName = (s: Segment) => `seg-${s.from}-${s.to}.json`;
const stateName = (t: number) => `state-${t}.bin`;

async function writeAtomic(path: string, data: Uint8Array | string): Promise<void> {
  const tmp = `${path}.tmp-${Deno.pid}`;
  if (typeof data === 'string') await Deno.writeTextFile(tmp, data);
  else await Deno.writeFile(tmp, data);
  await Deno.rename(tmp, path);
}

/** A CPU reference holding the state at step `t`: the seeded world at 0, a saved state from `from` otherwise. */
async function refAt(t: number, from: string): Promise<DropletKernelRef> {
  const ref = new DropletKernelRef(spec.cfg);
  if (t === 0) {
    seedPhageArena(ref, spec.size, spec.single, 'mixed');
    return ref;
  }
  const bytes = await Deno.readFile(`${from}/${stateName(t)}`);
  const packed = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  if (packed.length !== 14 * N) throw new Error(`bad state file ${from}/${stateName(t)}`);
  ref.A.set(packed.subarray(0, N));
  ref.F.set(packed.subarray(N, 2 * N));
  ref.W.set(packed.subarray(2 * N, 8 * N));
  ref.P.set(packed.subarray(8 * N, 14 * N));
  ref.stepCount = t;
  return ref;
}

/** Per tile: the wall type with most wall, or -1 where total wall is under 0.05 of a tile. */
function leadMap(W: Uint32Array): Int8Array {
  const lead = new Int8Array(N).fill(-1);
  for (let i = 0; i < N; i++) {
    let tot = 0;
    let best = 0;
    let bestM = 0;
    for (let m = 0; m < MOTIFS; m++) {
      const w = W[i * MOTIFS + m];
      tot += w;
      if (w > best) {
        best = w;
        bestM = m;
      }
    }
    if (tot >= LOW_THRESH) lead[i] = bestM;
  }
  return lead;
}

const initTotal = new DropletKernelRef(spec.cfg).initTotalMatter;

/** Runs one segment from `ref` and returns its file and its end state. Snapshots asked for are written to `dir`. */
async function runSegment(seg: Segment, ref: DropletKernelRef, snaps: ReadonlySet<number>): Promise<{ file: MovingSegmentFile; state: Uint8Array }> {
  const gpu = new DropletGpuSim(device, spec.cfg);
  gpu.uploadFromRef(ref);
  const tracker = seg.tracked ? new ObjectTracker(spec.size, spec.size, { sampleEvery: CENSUS }) : null;
  const bodylog = seg.tracked ? new BodyLog(spec.size, spec.size) : null;
  const movelog = seg.tracked ? new MoveLog(spec.size, spec.size) : null;
  const rows: Row[] = [];
  if (tracker && bodylog && movelog) {
    const first = tracker.observe(seg.from, ref.W, ref.P);
    bodylog.observe(seg.from, first, ref.W, ref.P);
    movelog.observe(seg.from, first, ref.W);
  }
  const leads = new Map<number, Int8Array>([[seg.from, leadMap(ref.W)]]);
  const stride = seg.tracked ? dt : CENSUS;
  let state: Uint8Array | null = null;
  for (let t = seg.from; t < seg.to;) {
    gpu.step(stride);
    t += stride;
    const snap = await gpu.readback();
    if (gpuError) throw new Error(`WebGPU error in ${setting} ${arm} seed ${seed}: ${gpuError}`);
    if (snap.step !== t) throw new Error(`step counter ${snap.step} != ${t}`);
    const labelled = tracker ? tracker.observe(t, snap.W, snap.P) : null;
    if (labelled && bodylog && movelog) {
      bodylog.observe(t, labelled, snap.W, snap.P);
      movelog.observe(t, labelled, snap.W);
    }
    if (t % CENSUS === 0) {
      const st = observeMotifStats(snap.W, snap.P);
      const drop = observeFindDroplets(snap.W, spec.size, spec.size, 0.20).length;
      // The observer's count against the confirmation's own function, at every census, tracked or not.
      const mine = (labelled ?? labelObjects(snap.W, spec.size, spec.size)).objects.length;
      if (mine !== drop) throw new Error(`object count ${mine} != confirmation count ${drop} at t=${t}`);
      const res = Number(observeTotalMatter(snap.A, snap.F, snap.W, snap.P) - initTotal);
      if (res !== 0) throw new Error(`matter residual ${res} at t=${t}`);
      const lead = leadMap(snap.W);
      const before = leads.get(t - 1000);
      let keepLead1000: number | null = null;
      if (before) {
        let walled = 0;
        let same = 0;
        for (let i = 0; i < N; i++) {
          if (before[i] < 0) continue;
          walled++;
          if (lead[i] === before[i]) same++;
        }
        keepLead1000 = walled > 0 ? same / walled : null;
      }
      leads.set(t, lead);
      leads.delete(t - 1000);
      rows.push({ t, drop, d1: st.hillD1, dom: st.dominant, domShare: st.dominantShare, phage: Number(st.phageTotals.reduce((a, b) => a + b, 0)), res, shares: st.shares, phageBy: st.phageTotals, keepLead1000 });
      if (snaps.has(t)) await writeAtomic(`${dir}/snap-${t}.bin`, new Uint8Array(snap.W.buffer.slice(snap.W.byteOffset, snap.W.byteOffset + snap.W.byteLength)));
    }
    if (t === seg.to) {
      const packed = new Uint32Array(14 * N);
      packed.set(snap.A, 0);
      packed.set(snap.F, N);
      packed.set(snap.W, 2 * N);
      packed.set(snap.P, 8 * N);
      state = new Uint8Array(packed.buffer);
    }
  }
  gpu.destroy();
  if (!state) throw new Error(`segment ${seg.from}-${seg.to} did not reach its end`);
  return { file: { meta, segment: seg, rows, tracker: tracker ? tracker.finish() : null, bodylog: bodylog ? bodylog.finish() : null, movelog: movelog ? movelog.finish() : null }, state };
}

const report = (seg: Segment, file: MovingSegmentFile, t0: number, note = '') => {
  const last = file.rows[file.rows.length - 1];
  console.log(`${setting} ${arm} s${seed} ${seg.from}-${seg.to}${seg.tracked ? ' tracked' : ''}${note} done in ${((performance.now() - t0) / 1000).toFixed(0)}s, drop ${last.drop}, phage ${last.phage}, d1 ${last.d1.toFixed(2)}`);
};

if (replay) {
  // One stored tracked window, again, with the move log. Equal to the stored window value for value, or stop.
  const [a, b] = argOf('window').split('-').map(Number);
  if (!Number.isInteger(a) || !Number.isInteger(b) || a % CENSUS !== 0 || b % CENSUS !== 0 || b <= a) throw new Error('bad --window');
  const from = `${replay}/${setting}/${arm}/seed-${seed}`;
  const seg: Segment = { from: a, to: b, tracked: true };
  const stored = JSON.parse(await Deno.readTextFile(`${from}/${segName(seg)}`)) as MovingSegmentFile;
  if (!sameRun(stored.meta as unknown as Record<string, unknown>)) throw new Error(`the stored segment ${from}/${segName(seg)} is not this world (header differs)`);
  if (JSON.stringify(stored.segment) !== JSON.stringify(seg)) throw new Error(`the stored segment ${from}/${segName(seg)} is not a tracked window`);
  const t0 = performance.now();
  const { file, state } = await runSegment(seg, await refAt(a, from), new Set());
  for (const key of ['rows', 'tracker', 'bodylog'] as const) {
    if (JSON.stringify(file[key]) !== JSON.stringify(stored[key])) throw new Error(`replay of ${from}/${segName(seg)} differs from the stored window in ${key}`);
  }
  const storedState = await Deno.readFile(`${from}/${stateName(b)}`);
  if (storedState.length !== state.length || storedState.some((v, k) => v !== state[k])) throw new Error(`replay of ${from}/${segName(seg)} ends in a different state`);
  await writeAtomic(`${dir}/${stateName(b)}`, state);
  await writeAtomic(`${dir}/${segName(seg)}`, JSON.stringify(file));
  report(seg, file, t0, ` replay, equal to the stored window (${file.rows.length} census rows, ${file.tracker!.records.length} tracker records, ${file.bodylog!.births.length} birth notes, end state)`);
} else {
  const steps = Number(argOf('steps'));
  const track = argOf('track', '').split(',').filter((s) => s.length > 0).map((s) => s.split('-').map(Number) as [number, number]);
  const snaps = new Set(argOf('snap', '').split(',').filter((s) => s.length > 0).map(Number));
  // The tracker reads objects again 100, 500 and 1,000 steps later, so a frame must fall on each of those.
  if (!Number.isInteger(steps) || steps % CENSUS !== 0) throw new Error('bad --steps');
  for (const t of snaps) if (t % CENSUS !== 0) throw new Error(`--snap ${t} is not a multiple of ${CENSUS}`);
  for (const seg of buildSegments(steps, track, CENSUS)) {
    const path = `${dir}/${segName(seg)}`;
    if (await exists(path)) {
      const have = JSON.parse(await Deno.readTextFile(path)) as MovingSegmentFile;
      if (!sameRun(have.meta as unknown as Record<string, unknown>)) throw new Error(`segment header mismatch: ${path}`);
      // A finished segment is reused only if it is the same segment (same ends, tracked or not) and holds every snapshot asked for.
      if (JSON.stringify(have.segment) !== JSON.stringify(seg)) throw new Error(`segment ${path} was run as ${JSON.stringify(have.segment)}, now asked for ${JSON.stringify(seg)}: use a new --out`);
      for (const t of snaps) {
        if (t > seg.from && t <= seg.to && !(await exists(`${dir}/snap-${t}.bin`))) throw new Error(`snapshot ${t} was not saved when ${path} ran: use a new --out`);
      }
      if (await exists(`${dir}/${stateName(seg.to)}`)) continue;
    }
    const t0 = performance.now();
    const { file, state } = await runSegment(seg, await refAt(seg.from, dir), snaps);
    await writeAtomic(`${dir}/${stateName(seg.to)}`, state);
    await writeAtomic(path, JSON.stringify(file));
    report(seg, file, t0);
  }
}
device.destroy();
