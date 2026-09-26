// Cross-browser (metapopulation) migration end to end through runExperiment
// (see packages/schema/src/exchange.ts): two independent seed chains, one
// importing a boundary from the other, checked for deterministic replay,
// matter closure and the no-migration control -- the TS-side analogue of
// tests/deno/migration.ts, for the cross-run mechanism instead of tiles.
//
// Run from the repo root: deno run -A tests/deno/exchange.ts
import { canonicalGenome, digestWords, stateHash, validateState, type WorldState } from "@bl/schema";
import { requestDevice } from "@bl/sim-gpu";
import { runExperiment, specConfig, type RunSpec, type Sink } from "@bl/runner";

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
// Seed 10 is ring position 1, seed 20 is ring position 2 (the coordinator's
// own 1-based `task_metapopulation/2` assignment -- see queue.ex) -- *not*
// the same ringNamespace for both, which would silently defeat the whole
// point of review P1's fix (two runs' founders/mutations would then collide
// on id again, the exact bug this feature closes; see exchange.test.ts's own
// "lineage id collisions across runs" cases for the unit-level version of
// this same check).
const ringNamespaceFor = (seed: number) => (seed === 10 ? 1 : 2);
const specFor = (seed: number, steps: number): RunSpec => ({
  experiment: "xrun",
  presetId: "spots",
  condition: "treatment",
  seed,
  steps,
  censusEvery: 100,
  deepEvery: 2,
  checkpointEvery: 0,
  metapopulation: { salt: 1234, migrantCount: 4, ringNamespace: ringNamespaceFor(seed) },
});
const device = await requestDevice(navigator.gpu, specConfig(specFor(10, 100)));

// --- segment 0 of two independent seeds, no import yet (segment 0 never has a cross-run predecessor) ---
const aSink0 = new Mem();
const a0 = await runExperiment(device, specFor(10, 100), aSink0, host, () => {}, { keepFinal: true });
// exchanges.tsv is written whenever spec.metapopulation is set (like migrations.tsv:
// present whenever the mechanism is *configured*, not only when it triggers this
// particular segment) -- every segment of a metapopulation run has it, header-only
// or not, so stitchRun's all-or-nothing check across a run's segments holds.
check("segment 0 has an (empty, header-only) exchanges.tsv: never imports, but the run is still a metapopulation run", (aSink0.files.get("exchanges.tsv") ?? "").trim().split("\n").length === 1);

const bSink0 = new Mem();
const b0 = await runExperiment(device, specFor(20, 100), bSink0, host, () => {}, { keepFinal: true });

// --- segment 1: run A imports from run B's segment 0, and vice versa (a 2-run ring) ---
const aSink1 = new Mem();
const a1 = await runExperiment(device, specFor(10, 200), aSink1, host, () => {}, {
  start: a0.final,
  observer: a0.observer,
  immigrant: b0.final,
  keepFinal: true,
});
check("segment 1 (with an import) recorded exchanges.tsv", (aSink1.files.get("exchanges.tsv") ?? "").trim().split("\n").length > 1);
// review P1: distinct ringNamespaces (per seed's ring position -- see
// ringNamespaceFor above) keep every founder/mutation id unique across the
// two runs, so the post-import state has no lineage carrying two different
// genomes under one id -- the exact "lineage N:M has differing genome words"
// collision the review found with two soup states and no namespace at all.
check("run A's post-import state has no lineage id collision (review P1's fix, exercised end to end)", validateState(a1.final!).length === 0, JSON.stringify(validateState(a1.final!)));

// --- replay verification of a segment with an import: an independent recomputation from the same two inputs must match bit for bit ---
const aSink1Replay = new Mem();
const a1Replay = await runExperiment(device, specFor(10, 200), aSink1Replay, host, () => {}, {
  start: a0.final,
  observer: a0.observer,
  immigrant: b0.final,
  keepFinal: true,
});
check(
  "an independent recomputation of the same import reproduces the same physics digest",
  stateHash(a1.final!) === stateHash(a1Replay.final!),
  `${stateHash(a1.final!)} vs ${stateHash(a1Replay.final!)}`,
);
check(
  "...and the same artifact digest (physics + observer) -- what replay verification actually compares",
  a1.summary.finalHash === a1Replay.summary.finalHash,
  `${a1.summary.finalHash} vs ${a1Replay.summary.finalHash}`,
);
check("exchanges.tsv is identical across both independent computations", aSink1.files.get("exchanges.tsv") === aSink1Replay.files.get("exchanges.tsv"));

// --- matter closure across the ring: sum of both runs' matter is conserved by the mutual exchange ---
const bSink1 = new Mem();
const b1 = await runExperiment(device, specFor(20, 200), bSink1, host, () => {}, {
  start: b0.final,
  observer: b0.observer,
  immigrant: a0.final,
  keepFinal: true,
});
check("run A's segment 1 conserves matter and energy from its own (post-import) start", a1.summary.conservationOk);
check("run B's segment 1 conserves matter and energy from its own (post-import) start", b1.summary.conservationOk);

// --- no-migration: same shape, no exchange, physically different outcome ---
// The coordinator never wires import_from for a "no-migration" run within a
// metapopulation experiment (Coordinator.Queue's own control at that level),
// but *does* still hand its tasks spec.metapopulation (see task/4): the
// control is exempt from the exchange itself, not from "belonging" to the
// metapopulation, which is what specConfig's own meaningfulness check needs
// to see to accept "no-migration" here at all. In practice this run never
// receives an `immigrant` (the coordinator only supplies one when
// `import_from` is set), reproduced here by simply never passing one.
const ctlSpec: RunSpec = { ...specFor(10, 100), condition: "no-migration" };
const ctlSink = new Mem();
const ctl = await runExperiment(device, ctlSpec, ctlSink, host, () => {}, { keepFinal: true });
check(
  "the no-migration control still gets an (empty) exchanges.tsv -- it belongs to the metapopulation, it just never imports",
  (ctlSink.files.get("exchanges.tsv") ?? "").trim().split("\n").length === 1,
);
check(
  "the no-migration control's segment 0 matches the metapopulation run's own segment 0 (neither has an import yet)",
  physicalDigest(ctl.final!) === physicalDigest(a0.final!),
  "segment 0 never imports regardless of condition, so treatment and no-migration should still agree here",
);

const ctlSink1 = new Mem();
const ctl1 = await runExperiment(device, { ...specFor(10, 200), condition: "no-migration" }, ctlSink1, host, () => {}, {
  start: ctl.final,
  observer: ctl.observer,
  keepFinal: true,
});
check(
  "the no-migration control's segment 1 (no import) differs physically from the metapopulation run's (which imported)",
  physicalDigest(ctl1.final!) !== physicalDigest(a1.final!),
  `both ${physicalDigest(ctl1.final!)}`,
);

// --- specConfig validation (review 1): no-migration needs tile migration or a metapopulation ---
{
  let threw: string | null = null;
  try {
    specConfig({ ...specFor(10, 100), condition: "no-migration", metapopulation: undefined });
  } catch (e) {
    threw = (e as Error).message;
  }
  check("no-migration without tile migration or a metapopulation is rejected", /no-migration control needs/.test(threw ?? ""), threw ?? "(did not throw)");
}

Deno.exit(ok ? 0 : 1);
