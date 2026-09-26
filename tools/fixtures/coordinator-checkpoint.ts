// Regenerates apps/coordinator/test/fixtures/{small,stress}.blck (run from
// the repo root). v3: the artifact carries an observer section alongside
// the physics state; both fixtures' observers are small synthetic values
// (not a real ObserverState from packages/runner) chosen to exercise
// Coordinator.Checkpoint's canonicalization of the observer section.
import { defaultConfig, soupWorld, encodeCheckpoint, stateHash, artifactDigest } from "@bl/schema";
import { RefSim } from "@bl/sim-ref";

function build(steps: number, observer: unknown) {
  const cfg = defaultConfig({ tileW: 24, tileH: 24, kernelRadius: 3, seed: 7 });
  const sim = new RefSim(soupWorld(cfg, 2, 32, 64));
  sim.run(steps);
  return {
    bytes: encodeCheckpoint(sim.state, observer),
    info: { step: sim.state.step, seed: cfg.seed, hash: stateHash(sim.state), digest: artifactDigest(sim.state, observer) },
  };
}

// small.blck: out-of-order keys, nesting, an array — exercises basic
// recursive key-sorted canonicalization.
const small = build(12, {
  step: 12,
  settings: { censusEvery: 100, deepEvery: 10, activityThreshold: null },
  tags: ["b", "a"],
  meta: { z: 1, a: 2 },
});
await Deno.writeFile("apps/coordinator/test/fixtures/small.blck", small.bytes);
console.log(JSON.stringify(small.info));

// stress.blck: a float whose shortest decimal digits format very
// differently under JS's Number::toString than under Erlang's own
// `float_to_binary(_, [:short])` (JS keeps "0.00001" plain; Erlang's short
// format already switches to "1.0e-5"), *and* array-index-like string keys
// ("2", "10") — a JS object always enumerates those in ascending numeric
// order first regardless of insertion order, which a naive lexicographic
// key sort gets wrong ("10" would sort before "2"). Both must be ported
// exactly for `Coordinator.Checkpoint.artifact_digest/1` to agree with
// `artifactDigest` bit for bit; see `Coordinator.CheckpointTest`.
const stress = build(5, {
  cx: 0.00001,
  "2": "b",
  "10": "a",
  nested: { "5": 1, "1": 2, z: 3 },
  list: [3, 1, 2],
  big: 1e21,
  neg: -0.0001,
});
await Deno.writeFile("apps/coordinator/test/fixtures/stress.blck", stress.bytes);
console.log(JSON.stringify(stress.info));

// unicode.blck: non-ASCII keys, where JS sorts by UTF-16 code units
// ("\u{10000}" is a surrogate pair and sorts before "", unlike UTF-8
// byte order), plus strings needing JSON escapes.
const unicode = build(3, {
  "\u{10000}": 1,
  "": 2,
  "é": 3,
  a: { "\u{1F600}": "x", "￿": "y" },
  s: "tab\tnl\nctl\u0001quote\"back\\   é \u{1F600}",
});
await Deno.writeFile("apps/coordinator/test/fixtures/unicode.blck", unicode.bytes);
console.log(JSON.stringify(unicode.info));
