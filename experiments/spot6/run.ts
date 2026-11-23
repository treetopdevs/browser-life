/**
 * SPOT6 runner: one arm of the confirmation, at one pre-listed rate setting, on the frozen droplet kernel's
 * GPU form (docs/six-wall-spot-2026-11-22/PLAN.md). The kernel is not edited: a setting is config overrides.
 *
 *   deno run -A --no-lock experiments/spot6/run.ts --setting SPOT --arm NO_PHAGE --seed 1 --out runs/spot6 \
 *     --steps 40000 --track 0-10000,20000-40000 --snap 30000,31000,32000
 *
 * The segment loop is copied from experiments/b2check/run.ts, which is a top-level script and refuses the
 * NEUTRAL_PHAGE arm, so it cannot be imported. What differs: all four arms are built the way
 * experiments/confirm/run-droplets.ts builds them, with the setting's overrides added; only seeds 1 to 4 are
 * accepted; each census row also stores the six wall shares, phage by type and a place readout; tracked
 * segments also keep a body log (bodylog.ts); the object count is checked against the confirmation's function
 * at untracked censuses too. The tracker, the segment cutter and the freeze check are imported.
 *
 * A run is cut into segments. Each finished segment writes `seg-<a>-<b>.json` and `state-<b>.bin`, so a stopped
 * job resumes from its last finished segment, and a run can be extended by asking for more steps.
 */

import { DropletKernelRef, observeFindDroplets, observeMotifStats, observeTotalMatter } from '../../apps/lab/src/oligomer/droplets-kernel.ts';
import { DropletGpuSim } from '../../apps/lab/src/oligomer/droplets-gpu.ts';
import { seedPhageArena } from '../../apps/lab/src/oligomer/droplet-worlds.ts';
import { argOf, assertFrozen, exists } from '../confirm/io.ts';
import { labelObjects, LOW_THRESH, MOTIFS, ObjectTracker } from '../b2check/observe.ts';
import { buildSegments, type Segment } from '../b2check/segments.ts';
import { BodyLog } from './bodylog.ts';
import type { Row, SegmentFile } from './rule.ts';
import { buildSpec, CENSUS, emergenceBound } from './settings.ts';

const BODY_STRIDE = 10;

const setting = argOf('setting');
const arm = argOf('arm');
const seed = Number(argOf('seed'));
const out = argOf('out');
const steps = Number(argOf('steps'));
const dt = Number(argOf('dt', '10'));
const track = argOf('track', '').split(',').filter((s) => s.length > 0).map((s) => s.split('-').map(Number) as [number, number]);
const snaps = new Set(argOf('snap', '').split(',').filter((s) => s.length > 0).map(Number));
// The tracker reads objects again 100, 500 and 1,000 steps later, so a frame must fall on each of those.
if (!Number.isInteger(seed) || !Number.isInteger(steps) || steps % CENSUS !== 0 || !Number.isInteger(dt) || dt <= 0 || 100 % dt !== 0) throw new Error('bad --seed, --steps or --dt (dt must divide 100)');
// The body log keeps 20 frames of history and takes a series sample every 50 steps; both assume a 10-step stride,
// so any other stride would record a different cadence than the log reports. Every recorded run used 10.
if (dt !== BODY_STRIDE) throw new Error(`--dt ${dt}: the body log is built for a ${BODY_STRIDE}-step stride, so only ${BODY_STRIDE} is accepted`);
for (const t of snaps) if (t % CENSUS !== 0) throw new Error(`--snap ${t} is not a multiple of ${CENSUS}`);

const frozen = await assertFrozen('droplets');
const spec = buildSpec(setting, arm, seed); // throws on a seed outside 1 to 4
const N = spec.size * spec.size;
const dir = `${out}/${setting}/${arm}/seed-${seed}`;
await Deno.mkdir(dir, { recursive: true });
const meta = { check: 'spot6', setting, arm, seed, size: spec.size, dt, census: CENSUS, cfg: spec.cfg, emergenceBound: emergenceBound(spec.cfg), frozen };
const segments = buildSegments(steps, track, CENSUS);

const adapter = await navigator.gpu.requestAdapter();
if (!adapter) throw new Error('No WebGPU adapter available');
const device = await adapter.requestDevice();
let gpuError: string | null = null;
device.addEventListener?.('uncapturederror', (e) => {
  gpuError = (e as GPUUncapturedErrorEvent).error.message;
});

const segPath = (s: Segment) => `${dir}/seg-${s.from}-${s.to}.json`;
const statePath = (t: number) => `${dir}/state-${t}.bin`;

async function writeAtomic(path: string, data: Uint8Array | string): Promise<void> {
  const tmp = `${path}.tmp-${Deno.pid}`;
  if (typeof data === 'string') await Deno.writeTextFile(tmp, data);
  else await Deno.writeFile(tmp, data);
  await Deno.rename(tmp, path);
}

/** A CPU reference holding the state at step `t`: the seeded world at 0, a saved state otherwise. */
async function refAt(t: number): Promise<DropletKernelRef> {
  const ref = new DropletKernelRef(spec.cfg);
  if (t === 0) {
    seedPhageArena(ref, spec.size, spec.single, 'mixed');
    return ref;
  }
  const bytes = await Deno.readFile(statePath(t));
  const packed = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  if (packed.length !== 14 * N) throw new Error(`bad state file ${statePath(t)}`);
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

for (const seg of segments) {
  if (await exists(segPath(seg))) {
    const have = JSON.parse(await Deno.readTextFile(segPath(seg))) as SegmentFile;
    if (JSON.stringify(have.meta) !== JSON.stringify(meta)) throw new Error(`segment header mismatch: ${segPath(seg)}`);
    // A finished segment is reused only if it is the same segment (same ends, tracked or not) and holds every snapshot asked for.
    if (JSON.stringify(have.segment) !== JSON.stringify(seg)) throw new Error(`segment ${segPath(seg)} was run as ${JSON.stringify(have.segment)}, now asked for ${JSON.stringify(seg)}: use a new --out`);
    for (const t of snaps) {
      if (t > seg.from && t <= seg.to && !(await exists(`${dir}/snap-${t}.bin`))) throw new Error(`snapshot ${t} was not saved when ${segPath(seg)} ran: use a new --out`);
    }
    if (await exists(statePath(seg.to))) continue;
  }
  const t0 = performance.now();
  const ref = await refAt(seg.from);
  const gpu = new DropletGpuSim(device, spec.cfg);
  gpu.uploadFromRef(ref);
  const tracker = seg.tracked ? new ObjectTracker(spec.size, spec.size, { sampleEvery: CENSUS }) : null;
  const bodylog = seg.tracked ? new BodyLog(spec.size, spec.size) : null;
  const rows: Row[] = [];
  if (tracker && bodylog) bodylog.observe(seg.from, tracker.observe(seg.from, ref.W, ref.P), ref.W, ref.P);
  const leads = new Map<number, Int8Array>([[seg.from, leadMap(ref.W)]]);
  const stride = seg.tracked ? dt : CENSUS;
  for (let t = seg.from; t < seg.to;) {
    gpu.step(stride);
    t += stride;
    const snap = await gpu.readback();
    if (gpuError) throw new Error(`WebGPU error in ${setting} ${arm} seed ${seed}: ${gpuError}`);
    if (snap.step !== t) throw new Error(`step counter ${snap.step} != ${t}`);
    const labelled = tracker ? tracker.observe(t, snap.W, snap.P) : null;
    if (labelled && bodylog) bodylog.observe(t, labelled, snap.W, snap.P);
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
      await writeAtomic(statePath(t), new Uint8Array(packed.buffer));
    }
  }
  gpu.destroy();
  const file: SegmentFile = { meta, segment: seg, rows, tracker: tracker ? tracker.finish() : null, bodylog: bodylog ? bodylog.finish() : null };
  await writeAtomic(segPath(seg), JSON.stringify(file));
  const last = rows[rows.length - 1];
  console.log(`${setting} ${arm} s${seed} ${seg.from}-${seg.to}${seg.tracked ? ' tracked' : ''} done in ${((performance.now() - t0) / 1000).toFixed(0)}s, drop ${last.drop}, phage ${last.phage}, d1 ${last.d1.toFixed(2)}`);
}
device.destroy();
