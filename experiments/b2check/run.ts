/**
 * Runner for the B2 compartment check. Uses the frozen droplet kernel untouched (its GPU form, which matches
 * the CPU reference bit for bit; `gpu-check.ts` re-checks that on this machine) and follows the objects the
 * confirmation counted as droplets.
 *
 * A run is cut into segments. Each finished segment writes `seg-<a>-<b>.json` and `state-<b>.bin`, so a
 * stopped job resumes from its last finished segment. Tracked segments read the world back every `--dt` steps.
 *
 *   deno run -A --no-lock experiments/b2check/run.ts --world PHAGE --seed 13 --out runs/b2check \
 *     --steps 80000 --track 0-10000,60000-80000 --snap 70000,71000,72000
 *
 * Worlds: PHAGE, NO_PHAGE, SINGLE_WALL (the confirmation's arms at 128 x 128), ONE64_B2 and ONE64_SPOT
 * (one wall type, no phage, 64 x 64, at the B2 default rates and at the sandbox line's spot rates).
 */

import { defaultDropletKernelConfig, DropletKernelRef, type DropletKernelConfig, observeFindDroplets, observeMotifStats, observeTotalMatter } from '../../apps/lab/src/oligomer/droplets-kernel.ts';
import { DropletGpuSim } from '../../apps/lab/src/oligomer/droplets-gpu.ts';
import { PHAGE_RUN_DEFAULTS, phageArms, seedPhageArena } from '../../apps/lab/src/oligomer/droplet-worlds.ts';
import { argOf, assertFrozen, exists } from '../confirm/io.ts';
import { ObjectTracker, type TrackerResult } from './observe.ts';
import { buildSegments, type Segment } from './segments.ts';

const CENSUS = 500;
const NO_PHAGE_ONE_WALL = { kInfect: 0, mutPhage: 0, mutMotif: 0 } as const;
/** The sandbox line's self-replicating-spot rates (docs/droplet-genes-2026-11-21/PLAN.md in that worktree). */
const SPOT_RATES = { kDeg: 0.085, diffW: 0.015, diffF: 0.30 } as const;

export interface WorldSpec {
  readonly size: number;
  readonly cfg: DropletKernelConfig;
  readonly single: boolean;
}

function worldSpec(world: string, seed: number): WorldSpec {
  if (world === 'ONE64_B2' || world === 'ONE64_SPOT') {
    const rates = world === 'ONE64_SPOT' ? SPOT_RATES : {};
    return { size: 64, single: true, cfg: defaultDropletKernelConfig({ width: 64, height: 64, seed, ...NO_PHAGE_ONE_WALL, ...rates }) };
  }
  const arm = phageArms(PHAGE_RUN_DEFAULTS).find((a) => a.name === world);
  if (!arm || arm.name === 'NEUTRAL_PHAGE') throw new Error(`unknown world: ${world}`);
  // Exactly the confirmation runner's construction (experiments/confirm/run-droplets.ts).
  return { size: 128, single: arm.single, cfg: defaultDropletKernelConfig({ width: 128, height: 128, seed, ...arm.ov }) };
}

interface Row {
  t: number;
  drop: number;
  d1: number;
  dom: number;
  domShare: number;
  phage: number;
  res: number;
}

interface SegmentFile {
  meta: unknown;
  segment: Segment;
  rows: Row[];
  tracker: TrackerResult | null;
}

const world = argOf('world');
const seed = Number(argOf('seed'));
const out = argOf('out');
const steps = Number(argOf('steps'));
const dt = Number(argOf('dt', '10'));
const track = argOf('track', '').split(',').filter((s) => s.length > 0).map((s) => s.split('-').map(Number) as [number, number]);
const snaps = new Set(argOf('snap', '').split(',').filter((s) => s.length > 0).map(Number));
// The tracker reads objects again 100, 500 and 1,000 steps later, so a frame must fall on each of those.
if (!Number.isInteger(seed) || !Number.isInteger(steps) || steps % CENSUS !== 0 || !Number.isInteger(dt) || dt <= 0 || 100 % dt !== 0) throw new Error('bad --seed, --steps or --dt (dt must divide 100)');
for (const t of snaps) {
  if (t % CENSUS !== 0) throw new Error(`--snap ${t} is not a multiple of ${CENSUS}`);
  // Snapshots are written after a step is taken, so step 0 and steps past the end are never saved.
  if (!(t > 0 && t <= steps)) throw new Error(`--snap ${t} must be after step 0 and no later than --steps ${steps}`);
}

const frozen = await assertFrozen('droplets');
const spec = worldSpec(world, seed);
const N = spec.size * spec.size;
const dir = `${out}/${world}/seed-${seed}`;
await Deno.mkdir(dir, { recursive: true });
const meta = { check: 'b2check', world, seed, size: spec.size, dt, census: CENSUS, cfg: spec.cfg, frozen };
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
    if (seg.to === steps || (await exists(statePath(seg.to)))) continue;
  }
  const t0 = performance.now();
  const ref = await refAt(seg.from);
  const gpu = new DropletGpuSim(device, spec.cfg);
  gpu.uploadFromRef(ref);
  const tracker = seg.tracked ? new ObjectTracker(spec.size, spec.size, { sampleEvery: CENSUS }) : null;
  const rows: Row[] = [];
  if (tracker) tracker.observe(seg.from, ref.W, ref.P);
  const stride = seg.tracked ? dt : CENSUS;
  for (let t = seg.from; t < seg.to;) {
    gpu.step(stride);
    t += stride;
    const snap = await gpu.readback();
    if (gpuError) throw new Error(`WebGPU error in ${world} seed ${seed}: ${gpuError}`);
    if (snap.step !== t) throw new Error(`step counter ${snap.step} != ${t}`);
    const labelled = tracker ? tracker.observe(t, snap.W, snap.P) : null;
    if (t % CENSUS === 0) {
      const st = observeMotifStats(snap.W, snap.P);
      const drop = observeFindDroplets(snap.W, spec.size, spec.size, 0.20).length;
      if (labelled && labelled.objects.length !== drop) throw new Error(`object count ${labelled.objects.length} != confirmation count ${drop} at t=${t}`);
      const res = Number(observeTotalMatter(snap.A, snap.F, snap.W, snap.P) - initTotal);
      if (res !== 0) throw new Error(`matter residual ${res} at t=${t}`);
      rows.push({ t, drop, d1: st.hillD1, dom: st.dominant, domShare: st.dominantShare, phage: Number(st.phageTotals.reduce((a, b) => a + b, 0)), res });
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
  const file: SegmentFile = { meta, segment: seg, rows, tracker: tracker ? tracker.finish() : null };
  await writeAtomic(segPath(seg), JSON.stringify(file));
  console.log(`${world} s${seed} ${seg.from}-${seg.to}${seg.tracked ? ' tracked' : ''} done in ${((performance.now() - t0) / 1000).toFixed(0)}s, drop ${rows[rows.length - 1].drop}`);
}
device.destroy();
