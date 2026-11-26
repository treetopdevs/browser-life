// Frozen protocol constants (PROTOCOL.md carries the same object as a fenced JSON block; a test compares them).
// Changing any value after the freeze commit needs a dated amendment file, never an edit.
import { ASSEMBLY_VERSION } from "./version.ts";

export const PROTOCOL = {
  assemblyVersion: ASSEMBLY_VERSION,
  patch: { w: 64, h: 64, mass: 240 },
  replicates: 16,
  tau: 1,
  tauGrid: [1, 2, 4],
  connPrimary: 4,
  connGrid: [4, 8],
  objMaxN: 40,
  exactMaxN: 10,
  exactNodeBudget: 2000000,
  boundNodeCap: 20000,
  beamW: 8,
  maxCand: 10,
  totalNodeLimit: 100000000,
  motif: { box: 7, pitch: 8, candidates: 256, floorA10: 6, randomFieldN: 6, dupN: 10, dupCopies: 6, dupMotifs: 4, hiCopies: 24, matchedN: 12, matchedCopies: 20 },
  seeds: { motif: 0x1a0c5eed, place: 0x91ace5, scatter: 0x5ca77e5, crystal: 0xc4157a1 },
  persistenceLags: [1, 2, 4],
  strides: [1, 2, 4, 8],
  segmentationFactor: 2,
  clips: { presets: ["spots", "gradient", "seasons"], seed: 1, side: 32, frames: 96, stride: 4, channel: "B", shift: 5, cap: 15 },
  movieFixtures: ["life-block", "life-blinker", "life-pulsar", "life-glider", "life-gliders-dup", "life-soup-early", "random-bits", "random-static", "blobs-diffuse"],
} as const;

export type Protocol = typeof PROTOCOL;
