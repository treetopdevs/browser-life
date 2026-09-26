// Regenerates apps/coordinator/test/fixtures/{small,stress}.blck (run from
// the repo root). v3: the artifact carries an observer section alongside
// the physics state; both fixtures' observers are small synthetic values
// (not a real ObserverState from packages/runner) chosen to exercise
// Coordinator.Checkpoint's canonicalization of the observer section.
import { defaultConfig, soupWorld, encodeCheckpoint, stateHash, artifactDigest, type WorldConfig } from "@bl/schema";
import { RefSim } from "@bl/sim-ref";

function build(steps: number, observer: unknown, cfgOverrides: Partial<WorldConfig> = {}) {
  const cfg = defaultConfig({ tileW: 24, tileH: 24, kernelRadius: 3, seed: 7, ...cfgOverrides });
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

// adhesion.blck: an adhesion-enabled config (WorldConfig.adhesion, both keys
// optional and normally absent -- see packages/schema/src/config.ts). Proves
// Coordinator.Checkpoint's generic canonical_json handles the two extra
// config keys identically to canonicalConfig/stateHash on the TS side, so a
// run that used the adhesion actuator digests and replay-verifies the same
// on the coordinator as it does in the browser/Deno runner.
const adhesion = build(12, { step: 12, adhesion: true }, { adhesion: true, kAdhesion: 300 });
await Deno.writeFile("apps/coordinator/test/fixtures/adhesion.blck", adhesion.bytes);
console.log(JSON.stringify(adhesion.info));

// migration.blck: a config with tilesX/tilesY > 1 *and* the optional
// migrationPeriod/migrantCount fields set (packages/schema/src/config.ts,
// packages/schema/src/presets.ts's "archipelago" preset shape) -- neither
// exercised by small/stress/unicode.blck above (all single-tile, no
// migration). Confirms Coordinator.Checkpoint's multi-tile `geometry/1` check
// and its canonical-JSON port agree with the TypeScript side once the config
// object carries these extra keys, not just the fixed set every other config
// in this codebase has always had.
const migration = build(
  20,
  { step: 20, settings: { censusEvery: 10, deepEvery: 5, activityThreshold: null } },
  { tilesX: 2, tilesY: 2, migrationPeriod: 20, migrantCount: 3 },
);
await Deno.writeFile("apps/coordinator/test/fixtures/migration.blck", migration.bytes);
console.log(JSON.stringify(migration.info));
