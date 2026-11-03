// Frozen protocol constants for the I07b destruction/reconstruction assay (PROTOCOL.md carries the same object as a
// fenced JSON block; a test compares them). Changing a value after the freeze commit needs a dated amendment file.
import { PROTOCOL as FIRST } from "../protocol.ts";

export const DESTRUCTION_VERSION = 1;

export const DPROTOCOL = {
  destructionVersion: DESTRUCTION_VERSION,
  /** Patch geometry and mass are the first rung's. */
  patch: FIRST.patch,
  replicates: 16,
  rounds: 8,
  objectsPerRound: 2,
  /** Disc radius of lesion-partial (torus Euclidean: dx^2 + dy^2 <= r^2), centred on a cell of a PRNG-chosen object. */
  lesionRadius: 22,
  /** Level tolerance: levelReturn iff 4 * cwAfter >= 3 * cwBefore (the copy-weighted construction does not fall more than 25 percent). */
  levelKeepNum: 3,
  levelKeepDen: 4,
  /** identityReturn threshold 1/2 (identityNum / identityDen). */
  identityNum: 1,
  identityDen: 2,
  /** identityReturn is defined only when the original had at least this many copies of the target key. */
  minCopies: 8,
  persistenceRounds: 3,
  /** postRegrowthMass floor for levelReturn: 3/4 of M. */
  occupancyFloorNum: 3,
  occupancyFloorDen: 4,
  /** highAssembly: construction DAG holds at least this many distinct non-monomer keys and copy-weighted >= 1/2 of the hier-12 reference. */
  highMinKeys: 2,
  highRefNum: 1,
  highRefDen: 2,
  /** Scramble organisation control: per readout, at least this many of the replicates must move to the worse (higher cost) side. */
  scrambleMin: 14,
  motifBox: FIRST.motif.box,
  pitch: { object: 8, crystal: 5, monomer: 1 },
  crystalSeedSide: 2,
  conns: [4, 8],
  /** Seed namespaces. `dev` is for tests and fixing implementation bugs; `score` is used only after the freeze commit. */
  seeds: {
    dev: { init: 0x0d1e5eed, damage: 0x0dd4a6e5, regrow: 0x0d7e60a1 },
    score: { init: 0x5c0e1a17, damage: 0x5c0dac61, regrow: 0x5c07e960 },
  },
  processes: [
    "builder-hier12", "template-hier12", "template-dup12", "fresh-random-dup12", "accretion-crystal", "inert-scatter",
    "stored-image-renderer", "wrong-store-builder",
  ],
  storeProcesses: ["builder-hier12", "stored-image-renderer", "wrong-store-builder"],
  recipeDependentTruth: ["builder-hier12", "stored-image-renderer"],
  baseProcesses: ["builder-hier12", "template-hier12", "template-dup12", "fresh-random-dup12", "accretion-crystal", "inert-scatter"],
  damage: ["lesion-partial", "lesion-total", "scramble"],
} as const;

export type DProtocol = typeof DPROTOCOL;
export type SeedNs = "dev" | "score";
export type ProcessId = (typeof DPROTOCOL.processes)[number];
export type Damage = (typeof DPROTOCOL.damage)[number];
