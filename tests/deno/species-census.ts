// RunSpec.speciesCensus, end to end through runExperiment (see
// packages/runner/src/runner.ts and packages/metrics/src/biogeography.ts's
// tileSpeciesCensus):
//
//  - byte-identity: absent, explicit `undefined`, or explicit `false` never
//    writes species.tsv and never changes any other file's bytes, including
//    manifest.json's own serialized spec -- the field costs nothing to a run
//    that doesn't opt in. Checked against BASELINE_DIGEST, a hash pinned once
//    (below) over every text and binary file a frozen-clock run produces --
//    like packages/sim-ref/test/golden-hashes.test.ts's pinned hashes, not a
//    same-invocation comparison: an unconditional regression that changed
//    every disabled variant identically (and so would pass a check that only
//    compared them to each other) still changes this digest and gets caught.
//    If a real, intended change to the runner's own output shape ever changes
//    this digest, recompute and update the pin deliberately.
//  - positive: `speciesCensus: true` writes species.tsv with one row per
//    tile per census (plus the step-0 baseline), and its step-0 numbers match
//    calling tileSpeciesCensus directly on the same initial state.
//
// Run from the repo root: deno run -A tests/deno/species-census.ts
import { archipelagoWorld, founderGenome, M3_FOUNDERS } from "@bl/schema";
import { requestDevice } from "@bl/sim-gpu";
import { runExperiment, specConfig, type RunSpec, type Sink } from "@bl/runner";
import { tileSpeciesCensus } from "@bl/metrics";

class Mem implements Sink {
  files = new Map<string, string>();
  bytes = new Map<string, Uint8Array>();
  async writeText(p: string, t: string) {
    this.files.set(p, t);
  }
  async appendText(p: string, t: string) {
    this.files.set(p, (this.files.get(p) ?? "") + t);
  }
  async writeBytes(p: string, b: Uint8Array) {
    this.bytes.set(p, b);
  }
}

/** SHA-256 over every text and binary file a run wrote, sorted by path -- true byte identity, not just the JSON-level checks below. Requires a frozen clock (see `withFrozenClock`): otherwise manifest.json's own timestamps/wall-clock fields would make every run's digest unique. */
async function bundleDigest(m: Mem): Promise<string> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const name of [...m.files.keys()].sort()) parts.push(enc.encode(`\0T:${name}\0`), enc.encode(m.files.get(name)!));
  for (const name of [...m.bytes.keys()].sort()) parts.push(enc.encode(`\0B:${name}\0`), m.bytes.get(name)!);
  const buf = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let off = 0;
  for (const p of parts) { buf.set(p, off); off += p.length; }
  const digest = await crypto.subtle.digest("SHA-256", buf as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Freezes `Date`/`performance.now` for the duration of `fn` so a run's own timestamps/wall-clock fields are deterministic -- real byte identity, not "identical modulo clock noise stripped after the fact". Restores both afterward regardless of how `fn` returns. */
async function withFrozenClock<T>(fn: () => Promise<T>): Promise<T> {
  const realToISOString = Date.prototype.toISOString;
  const realNow = performance.now.bind(performance);
  Date.prototype.toISOString = () => "2024-01-01T00:00:00.000Z";
  performance.now = () => 0;
  try {
    return await fn();
  } finally {
    Date.prototype.toISOString = realToISOString;
    performance.now = realNow;
  }
}

let ok = true;
const check = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail && !cond ? `: ${detail}` : ""}`);
  ok &&= cond;
};

const host = { host: "test", adapter: "test" };
// checkpointEvery > 0 so the byte-identity check below also exercises writeBytes (checkpoint
// .blck files), not just the text files.
const base: RunSpec = { experiment: "spc", presetId: "archipelago", condition: "no-migration", seed: 11, steps: 60, censusEvery: 20, deepEvery: 3, checkpointEvery: 20 };
const device = await requestDevice(navigator.gpu, specConfig(base));
const anchors = M3_FOUNDERS.map(founderGenome);
// tools/biogeo-sweep.ts's own real-run path: an archipelago run's start state is always the
// M3-founder archipelagoWorld, passed explicitly via opts.start (the "archipelago" preset's own
// init.kind is "generalist" -- runExperiment falls back to that only when no start is given).
const start = () => archipelagoWorld(specConfig(base), anchors);

// Pinned once, over a frozen-clock run of `base` with speciesCensus absent -- see the module doc
// above and packages/sim-ref/test/golden-hashes.test.ts for the same "checked-in digest, not a
// same-invocation comparison" idiom.
const BASELINE_DIGEST = "cb3b32304e6275a7546c19579e148e63d3927cb9e187140ccaee24eced8ac681";

// --- byte-identity: absent, explicit undefined, and explicit false, all against the pinned baseline ---------
{
  const withoutField = new Mem();
  await withFrozenClock(() => runExperiment(device, base, withoutField, host, () => {}, { start: start() }));
  const explicitUndefined = new Mem();
  await withFrozenClock(() => runExperiment(device, { ...base, speciesCensus: undefined }, explicitUndefined, host, () => {}, { start: start() }));
  const explicitFalse = new Mem();
  await withFrozenClock(() => runExperiment(device, { ...base, speciesCensus: false }, explicitFalse, host, () => {}, { start: start() }));

  check("a run without speciesCensus writes no species.tsv", !withoutField.files.has("species.tsv") && !withoutField.bytes.has("species.tsv"));
  check("a run with speciesCensus: undefined also writes no species.tsv", !explicitUndefined.files.has("species.tsv") && !explicitUndefined.bytes.has("species.tsv"));
  check("a run with speciesCensus: false also writes no species.tsv", !explicitFalse.files.has("species.tsv") && !explicitFalse.bytes.has("species.tsv"));

  const [digestWithout, digestUndefined, digestFalse] = await Promise.all([bundleDigest(withoutField), bundleDigest(explicitUndefined), bundleDigest(explicitFalse)]);
  check("absent and explicit-undefined produce byte-identical bundles (every text file and checkpoint)", digestWithout === digestUndefined, `${digestWithout} != ${digestUndefined}`);
  check(
    "explicit-false produces a byte-identical bundle too, including manifest.json's own serialized spec (not just \"no species.tsv\")",
    digestWithout === digestFalse,
    `${digestWithout} != ${digestFalse}`,
  );
  check(
    "that bundle matches the pinned pre-change baseline digest, not just itself -- a regression affecting every invocation equally would still be caught",
    digestWithout === BASELINE_DIGEST,
    `got ${digestWithout}, pinned ${BASELINE_DIGEST} (if this is an intended runner output change, recompute and update BASELINE_DIGEST deliberately)`,
  );
}

// --- positive: species.tsv shape and step-0 cross-check ---------------------
{
  const spec: RunSpec = { ...base, speciesCensus: true };
  const sink = new Mem();
  await runExperiment(device, spec, sink, host, () => {}, { start: start() });
  const text = sink.files.get("species.tsv");
  check("speciesCensus: true writes species.tsv", text !== undefined);

  const lines = (text ?? "").trim().split("\n");
  check("species.tsv has a header row naming its columns", lines[0] === "step\ttile\tgeneticRichness\tlivingCells\tfounderPresenceMask");
  const rows = lines.slice(1).map((l) => l.split("\t").map(Number));
  const cfg = specConfig(spec);
  const tiles = cfg.tilesX * cfg.tilesY;
  const expectedCensuses = 1 + Math.floor(spec.steps / spec.censusEvery); // baseline (step 0) + one per census
  check(`species.tsv has ${expectedCensuses} census(es) x ${tiles} tile(s) = ${expectedCensuses * tiles} rows`, rows.length === expectedCensuses * tiles, `got ${rows.length} rows`);

  // Cross-check the runner's own step-0 numbers against tileSpeciesCensus called directly on the
  // same initial archipelagoWorld state -- not just "didn't crash".
  const initState = start();
  const expected = tileSpeciesCensus({ step: initState.step, cfg: initState.cfg, genome: initState.genome }, anchors);
  const step0Rows = rows.filter((r) => r[0] === 0).sort((a, b) => a[1] - b[1]);
  check(
    "species.tsv's step-0 row matches tileSpeciesCensus called directly on the same initial state",
    step0Rows.length === expected.length && step0Rows.every((r, i) => r[1] === expected[i].tile && r[2] === expected[i].geneticRichness && r[3] === expected[i].livingCells && r[4] === expected[i].founderPresenceMask),
    JSON.stringify({ step0Rows, expected }),
  );
}

Deno.exit(ok ? 0 : 1);
