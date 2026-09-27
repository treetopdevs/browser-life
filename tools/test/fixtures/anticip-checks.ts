// Deno-only fixture, spawned by tools/test/anticip.test.ts. tools/anticip.ts
// has a top-level `jsr:` import that vitest/node can't resolve, so this
// exercises the tool's own exported `phaseA`/`branch`/`AnticipParams` for
// real (not a hand-reimplementation) from inside a `deno run` subprocess, the
// same way the CLI e2e test already spawns `deno run -A tools/anticip.ts`.
// Three checks, printed as one JSON line:
//   - determinism: `phaseA` called twice with the same seed/mutRate produces
//     byte-identical state, guarding anticip.ts's own baseCfg/phaseA
//     composition (not just RefSim's).
//   - checkpoint round trip: `encodeCheckpoint` then `decodeCheckpoint` on a
//     real Phase-A end state reproduces the same physics state exactly.
//   - branch/checkpoint equivalence: `branch()` clones the Phase-A state
//     directly into a new RefSim rather than routing through
//     encodeCheckpoint/decodeCheckpoint (see tools/anticip.ts's own comment
//     on `branch`); this proves that shortcut is state-equivalent to the
//     checkpoint round trip it stands in for, by branching from each and
//     comparing the two branches' full post-step state -- `stateHash` (every
//     persistent field: config, step, cells, canonical genome, ledger) plus
//     the raw cells/genome arrays directly -- not just their reported
//     totals, which could stay accidentally equal while other state (e.g.
//     genome, step, ledger) silently diverged.
import { branch, phaseA, type AnticipParams } from "../../anticip.ts";
import { canonicalGenome, decodeCheckpoint, encodeCheckpoint, stateHash } from "@bl/schema";

function arraysEqual(a: Uint32Array, b: Uint32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const params: AnticipParams = { tile: 32, founders: 3, kernelRadius: 3, period: 20, periodsA: 2 };

const s1 = phaseA(params, 5, 0);
const s2 = phaseA(params, 5, 0);
const determinism = stateHash(s1) === stateHash(s2) && arraysEqual(s1.cells, s2.cells) && arraysEqual(canonicalGenome(s1.genome), canonicalGenome(s2.genome));

const bytes = encodeCheckpoint(s1);
const { state: decoded } = decodeCheckpoint(bytes);
const roundTrip =
  stateHash(decoded) === stateHash(s1) &&
  decoded.step === s1.step &&
  arraysEqual(decoded.cells, s1.cells) &&
  arraysEqual(decoded.genome, canonicalGenome(s1.genome));

const branchFromMemory = branch(s1, 15, 10);
const branchFromCheckpoint = branch(decoded, 15, 10);
// Full-state equivalence, not just matching totals: `stateHash` covers every
// persistent field (config, step, cells, canonical genome, ledger), and the
// raw cells/genome arrays are compared directly on top of that as a
// non-hash-based cross-check.
const branchMatchesCheckpoint =
  branchFromMemory.resp === branchFromCheckpoint.resp &&
  branchFromMemory.energy === branchFromCheckpoint.energy &&
  branchFromMemory.lightMean === branchFromCheckpoint.lightMean &&
  stateHash(branchFromMemory.state) === stateHash(branchFromCheckpoint.state) &&
  arraysEqual(branchFromMemory.state.cells, branchFromCheckpoint.state.cells) &&
  arraysEqual(canonicalGenome(branchFromMemory.state.genome), canonicalGenome(branchFromCheckpoint.state.genome));

console.log(
  JSON.stringify({ determinism, roundTrip, branchMatchesCheckpoint, hash1: stateHash(s1), hash2: stateHash(s2), decodedHash: stateHash(decoded) }),
);
