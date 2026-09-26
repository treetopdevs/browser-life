// Migration between tiles, end to end through runExperiment (see
// packages/schema/src/migration.ts and the "archipelago" preset):
//
//  - disabled-by-default parity: an existing preset's bundle is unaffected
//    (no migrations.tsv, migrationPeriod stays 0) by this feature existing;
//  - deterministic migrant selection, keyed on the *absolute* step: a run
//    split into segments reproduces the same physics+observer digest a
//    continuous run over the same steps does -- which is also exactly what
//    replay verification of a segment with an import checks, since segment
//    b's own start is a checkpoint containing an already-migrated state;
//  - the no-migration control actually removes the effect (a different final
//    digest) while still producing a valid, conserving run.
//
// Run from the repo root: deno run -A tests/deno/migration.ts
import { canonicalGenome, digestWords, stateHash, type WorldState } from "@bl/schema";
import { requestDevice } from "@bl/sim-gpu";
import { runExperiment, specConfig, type RunSpec, type Sink } from "@bl/runner";

// digestWords over cells/genome alone (no config, no step, no ledger) -- unlike
// stateHash/artifactDigest, which hash the config too, so two runs under
// different *conditions* (different WorldConfig, e.g. treatment vs
// no-migration) always get different stateHash/artifactDigest values even
// when their physics evolved identically. Comparing this instead answers "did
// the physical outcome actually differ", independent of config identity
// (review 7).
function physicalDigest(s: WorldState): string {
  const [a1, b1] = digestWords(s.cells);
  const [a2, b2] = digestWords(canonicalGenome(s.genome));
  return `${a1.toString(16)}:${b1.toString(16)}:${a2.toString(16)}:${b2.toString(16)}`;
}

class Mem implements Sink {
  files = new Map<string, string>();
  async writeText(p: string, t: string) {
    this.files.set(p, t);
  }
  async appendText(p: string, t: string) {
    this.files.set(p, (this.files.get(p) ?? "") + t);
  }
  async writeBytes() {}
}

let ok = true;
const check = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail && !cond ? `: ${detail}` : ""}`);
  ok &&= cond;
};

const host = { host: "test", adapter: "test" };
const base: RunSpec = { experiment: "mig", presetId: "archipelago", condition: "treatment", seed: 7, steps: 600, censusEvery: 100, deepEvery: 3, checkpointEvery: 0 };
const device = await requestDevice(navigator.gpu, specConfig(base));

// --- disabled-by-default parity -------------------------------------------
{
  const spec: RunSpec = { ...base, presetId: "spots", condition: "treatment", steps: 200 };
  const cfg = specConfig(spec);
  // Genuinely absent, not merely 0 -- see WorldConfig's doc on migrationPeriod: an
  // always-present field would change every existing config's canonical JSON and
  // therefore its stateHash/artifactDigest, migration-disabled or not.
  check("existing presets still have migration off by default", cfg.migrationPeriod === undefined && cfg.migrantCount === undefined);
  const sink = new Mem();
  await runExperiment(device, spec, sink, host, () => {});
  check("a migration-disabled run's bundle has no migrations.tsv", !sink.files.has("migrations.tsv"));
}

// --- migration-disabled off-grid continuation matches the parent's relative chunking (review 5/6) ---
// A first attempt at absolute-alignment chunking (see runner.ts's own comment
// on why it was reverted) changed *every* continuation's census/observation
// steps whenever its own start wasn't already a multiple of censusEvery --
// including migration-disabled ones, which had (and must keep) nothing to
// align for. This pins the parent's exact relative-chunking behavior: census
// points are `censusEvery` steps apart from *this call's own start*, not
// realigned to an absolute grid.
{
  const spec: RunSpec = { experiment: "offgrid", presetId: "spots", condition: "treatment", seed: 3, steps: 150, censusEvery: 100, deepEvery: 5, checkpointEvery: 0 };
  const firstSink = new Mem();
  const first = await runExperiment(device, spec, firstSink, host, () => {}, { keepFinal: true });
  const censusSteps = (sink: Mem) => sink.files.get("series.jsonl")!.trim().split("\n").map((l) => (JSON.parse(l) as { step: number }).step);
  check("a first, off-grid-length call censuses at [100, 150] (a short final chunk, not realigned)", JSON.stringify(censusSteps(firstSink)) === JSON.stringify([100, 150]), JSON.stringify(censusSteps(firstSink)));

  const secondSink = new Mem();
  await runExperiment(device, { ...spec, steps: 200 }, secondSink, host, () => {}, { start: first.final, observer: first.observer });
  check(
    "continuing from that off-grid step 150 censuses at [250, 350] -- 100 steps apart from its own start, exactly the parent's behavior",
    JSON.stringify(censusSteps(secondSink)) === JSON.stringify([250, 350]),
    JSON.stringify(censusSteps(secondSink)),
  );
}

// --- migration-enabled runs reject an off-grid start (review 5/6) ---
{
  const spec: RunSpec = { ...base, steps: 150 };
  const firstSink = new Mem();
  const first = await runExperiment(device, spec, firstSink, host, () => {}, { keepFinal: true });
  check("(fixture) the archipelago run's own off-grid-length first call still succeeds -- only a *continuation* start is checked", first.summary.steps === 150);
  let rejected: string | null = null;
  try {
    await runExperiment(device, { ...base, steps: 200 }, new Mem(), host, () => {}, { start: first.final, observer: first.observer });
  } catch (e) {
    rejected = (e as Error).message;
  }
  check("continuing a migration-enabled run from an off-grid step (150, not a multiple of censusEvery 100) is rejected", /must start on a multiple of censusEvery/.test(rejected ?? ""), rejected ?? "(not rejected)");
}

// --- deterministic migrant selection / replay of a segment with an import -
const wholeSink = new Mem();
const whole = await runExperiment(device, base, wholeSink, host, () => {}, { keepFinal: true });
check("migration actually happened over the continuous run", (wholeSink.files.get("migrations.tsv") ?? "").trim().split("\n").length > 1);
check("the continuous run conserves matter and energy exactly", whole.summary.conservationOk);

const aSink = new Mem();
const a = await runExperiment(device, { ...base, steps: 300 }, aSink, host, () => {}, { keepFinal: true });
const bSink = new Mem();
const b = await runExperiment(device, { ...base, steps: 300 }, bSink, host, () => {}, { keepFinal: true, start: a.final, observer: a.observer });

check(
  "segment b (continuing from a's migrated checkpoint) reproduces the continuous run's physics digest",
  stateHash(whole.final!) === stateHash(b.final!),
  `${stateHash(whole.final!)} vs ${stateHash(b.final!)}`,
);
check(
  "...and its artifact digest (physics + observer) -- the value replay verification actually compares",
  whole.summary.finalHash === b.summary.finalHash,
  `${whole.summary.finalHash} vs ${b.summary.finalHash}`,
);
check("segment a already recorded a migration on its own (mid-history, before the boundary at 300)", (aSink.files.get("migrations.tsv") ?? "").trim().split("\n").length > 1);

const stripHeader = (t: string | undefined) => (t ? t.slice(Math.max(0, t.indexOf("\n") + 1)) : "");
const stitchedMigrations = (wholeSink.files.get("migrations.tsv")?.split("\n")[0] ?? "") + "\n" + stripHeader(aSink.files.get("migrations.tsv")) + stripHeader(bSink.files.get("migrations.tsv"));
check("segments' migrations.tsv concatenate to the continuous run's", stitchedMigrations === wholeSink.files.get("migrations.tsv"));

// --- no-migration control ---------------------------------------------------
const ctlSink = new Mem();
const ctl = await runExperiment(device, { ...base, condition: "no-migration" }, ctlSink, host, () => {}, { keepFinal: true });
check("the no-migration control produces no migrations.tsv", !ctlSink.files.has("migrations.tsv"));
check("the no-migration control still conserves matter and energy exactly", ctl.summary.conservationOk);
check(
  "the no-migration control changes the physical outcome (cells/genome, not just config identity)",
  physicalDigest(ctl.final!) !== physicalDigest(whole.final!),
  `both ${physicalDigest(whole.final!)}`,
);

Deno.exit(ok ? 0 : 1);
