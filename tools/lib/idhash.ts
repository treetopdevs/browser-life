// Deterministic PRNG stream derivation for tools/nullcal.ts's null generators
// (docs/plan.md "Gate calibration"). Null data never enters the simulator, so
// it does not need the simulator's own 32-bit cellBase/draw hash PRNG -- each
// (Identity, metric) stream is instead seeded from a cryptographic hash of its
// own canonical identity: two specific streams collide on their derived seed
// with probability ~2^-128 (the full 128-bit space), so no collision guard is
// needed -- a collision anywhere only becomes likely (birthday bound) once
// the number of distinct streams approaches ~2^64, far beyond anything this
// tool ever generates.
import { createHash } from "node:crypto";
import type { Identity } from "./nullgen.ts";

/** Canonical identity string hashed for one PRNG stream: the trial identity plus which named draw within it (e.g. "K", "amp", "temporalMIWalk" -- see nullgen.ts's own generators for the metric names each uses). */
function canonicalKey(id: Identity, metric: string): string {
  return JSON.stringify({
    masterSeed: id.masterSeed,
    nullId: id.nullId,
    windowSteps: id.windowSteps,
    replicateIndex: id.replicateIndex,
    condition: id.condition,
    seedIndex: id.seedIndex,
    metric,
  });
}

/** sfc32 (Chris Doty-Humphrey, public domain): small, fast, 128-bit state, ample period for the draw counts here. Not cryptographic -- only the SHA-256-derived seed below needs to be well distributed, not the PRNG itself. */
function sfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/** One independent uniform-[0,1) PRNG stream for (id, metric), seeded from the leading 128 bits of SHA-256(canonicalKey(id, metric)). */
export function streamRng(id: Identity, metric: string): () => number {
  const digest = createHash("sha256").update(canonicalKey(id, metric)).digest();
  const w = (i: number) => digest.readUInt32BE(i * 4);
  return sfc32(w(0), w(1), w(2), w(3));
}
