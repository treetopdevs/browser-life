// GPU loop helper of the scaffolding tools (Deno, native WebGPU): one period of steps with the same
// per-census checks packages/runner/src/runner.ts applies (mutation ledger drained, matter and energy
// ledger against the run's baseline), and gzipped full checkpoints. The pond transform itself lives in
// tools/lib/ponds.ts and runs between periods.
import { decodeCheckpoint, encodeCheckpoint, type WorldState } from "@bl/schema";
import type { GpuSim, StatsSnapshot } from "@bl/sim-gpu";

/** What `GpuSim.readSnapshot` returns at a census. */
export type CensusSnapshot = Awaited<ReturnType<GpuSim["readSnapshot"]>>;

/**
 * Runs `steps` steps in chunks of `censusEvery` (at most 64 steps per submission). After each chunk it drains
 * the mutation ledger (throwing if events were dropped), reads the snapshot and stats, checks that matter equals
 * `check.startMatter` and the energy ledger equals `check.baseline`, and calls `onCensus`. Stops at the first
 * violation with `conservationOk` false. `events` counts the mutation events drained.
 */
export async function runPeriod(
  sim: GpuSim,
  device: GPUDevice,
  steps: number,
  censusEvery: number,
  check: { startMatter: bigint; baseline: bigint },
  onCensus?: (snap: CensusSnapshot, stats: StatsSnapshot) => Promise<void>,
): Promise<{ conservationOk: boolean; events: number }> {
  const cfg = sim.cfg;
  let events = 0;
  for (let s = 0; s < steps; ) {
    const chunk = Math.min(censusEvery, steps - s);
    for (let k = 0; k < chunk; k += 64) sim.run(Math.min(64, chunk - k));
    s += chunk;
    await device.queue.onSubmittedWorkDone();

    const ledger = await sim.drainLedger();
    if (ledger.dropped > 0) throw new Error(`event buffer overflow (${ledger.dropped} dropped); lower censusEvery`);
    events += ledger.events.length;

    // Nothing else is queued, so these readbacks all describe the same step.
    const [snap, stats] = await Promise.all([sim.readSnapshot(false), sim.readStats()]);
    if (snap.step !== stats.step) throw new Error("snapshot and stats disagree on the step");
    const matter = stats.A + stats.B + stats.C + stats.P;
    const energy = stats.A * BigInt(cfg.eA) + stats.B * BigInt(cfg.eB) + stats.C * BigInt(cfg.eC) + stats.P * BigInt(cfg.eP) + stats.E + stats.S;
    const residual = energy + stats.heatOut - stats.lightIn - check.baseline;
    if (matter !== check.startMatter || residual !== 0n) return { conservationOk: false, events };
    if (onCensus) await onCensus(snap, stats);
  }
  return { conservationOk: true, events };
}

async function pipeThrough(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** Writes a full checkpoint (state only, empty observer) gzipped to `path`. */
export async function saveCheckpoint(path: string, state: WorldState): Promise<void> {
  await Deno.writeFile(path, await pipeThrough(encodeCheckpoint(state), new CompressionStream("gzip")));
}

/** Reads a checkpoint written by `saveCheckpoint`. */
export async function loadCheckpoint(path: string): Promise<WorldState> {
  return decodeCheckpoint(await pipeThrough(await Deno.readFile(path), new DecompressionStream("gzip"))).state;
}
