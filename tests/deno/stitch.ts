// A run split into segments and stitched back together (tools/stitch.ts) must
// yield the bundle a continuous run writes: every observation file byte for
// byte, and the same summary apart from timing.
import { requestDevice } from "@bl/sim-gpu";
import { BUNDLE_FILES, runExperiment, specConfig, stitchRun, type RunSpec, type Sink, type StitchSegment } from "@bl/runner";

class Mem implements Sink {
  files = new Map<string, string>();
  async writeText(p: string, t: string) { this.files.set(p, t); }
  async appendText(p: string, t: string) { this.files.set(p, (this.files.get(p) ?? "") + t); }
  async writeBytes() {}
}
// 1300 steps in segments of 500, 500 and 300: exercises a short final segment.
const base: RunSpec = { experiment: "stitch", presetId: "spots", condition: "treatment", seed: 5, steps: 1300, censusEvery: 100, deepEvery: 4, checkpointEvery: 0 };
const device = await requestDevice(navigator.gpu, specConfig(base));
const host = { host: "test", adapter: "test" };
const wholeSink = new Mem();
const whole = await runExperiment(device, base, wholeSink, host, () => {});

const segs: StitchSegment[] = [];
let prev: Awaited<ReturnType<typeof runExperiment>> | null = null;
for (const [index, [startStep, steps]] of [[0, 500], [500, 500], [1000, 300]].entries()) {
  const sink = new Mem();
  const r = await runExperiment(device, { ...base, steps }, sink, host, () => {}, { keepFinal: true, start: prev?.final, observer: prev?.observer });
  segs.push({ index, startStep, steps, digest: r.summary.finalHash, files: Object.fromEntries(sink.files) });
  prev = r;
}
// Out of order on purpose: stitchRun orders by index.
const stitched = stitchRun([segs[2], segs[0], segs[1]], base.steps);

let ok = true;
const check = (name: string, same: boolean, detail = "") => {
  ok &&= same;
  console.log(`${same ? "PASS" : "FAIL"} ${name}${same ? "" : `: ${detail}`}`);
};
for (const f of BUNDLE_FILES) {
  if (f === "manifest.json") continue;
  const x = wholeSink.files.get(f) ?? "", y = stitched[f];
  check(f, x === y, `${x.length} vs ${y.length} bytes`);
}
const m = JSON.parse(stitched["manifest.json"]), w = JSON.parse(wholeSink.files.get("manifest.json")!);
const untimed = (s: object) => JSON.stringify({ ...s, wallSeconds: 0, stepsPerSecond: 0 });
check("summary", untimed(m.summary) === untimed(whole.summary), `${untimed(m.summary)} vs ${untimed(whole.summary)}`);
check("spec", JSON.stringify(m.spec) === JSON.stringify(w.spec));
check("covers the whole history", m.startStep === 0 && m.segments.length === 3);

// Starting-distribution provenance: a fresh run records its preset identity and
// initial-state hash, a continuation only the identity, and the stitched
// manifest carries segment #0's (the whole run's) values.
const seg1 = JSON.parse(segs[1].files["manifest.json"]);
check("a fresh run records presetIdentity and initHash", typeof w.presetIdentity === "string" && typeof w.initHash === "string", JSON.stringify([w.presetIdentity, w.initHash]));
check("a continuation records presetIdentity but no initHash", seg1.presetIdentity === w.presetIdentity && !("initHash" in seg1), JSON.stringify(Object.keys(seg1)));
check("the stitched manifest keeps the run's presetIdentity and initHash", m.presetIdentity === w.presetIdentity && m.initHash === w.initHash, JSON.stringify([m.presetIdentity, m.initHash]));
const reManifest = (seg: StitchSegment, f: (m: Record<string, unknown>) => void): StitchSegment => {
  const mm = JSON.parse(seg.files["manifest.json"]);
  f(mm);
  return { ...seg, files: { ...seg.files, "manifest.json": JSON.stringify(mm) } };
};
const unverified = JSON.parse(stitchRun([segs[0], reManifest(segs[1], (x) => delete x.presetIdentity), segs[2]], base.steps)["manifest.json"]);
check("a segment without presetIdentity leaves the stitched identity unrecorded", !("presetIdentity" in unverified) && unverified.initHash === w.initHash, JSON.stringify(Object.keys(unverified)));

// Byte compatibility (review P2): an ordinary (non-metapopulation) run's
// manifest.json, and each of the stitched manifest's own per-segment
// records, must omit importedStartHash/netExchangeMatter entirely -- not
// carry them as always-null -- so this run's shape stays pinned to exactly
// what it was before metapopulation existed (`base` above has no
// `metapopulation` field at all).
check("an ordinary run's own manifest.json has no importedStartHash/netExchangeMatter keys at all", !("importedStartHash" in w) && !("netExchangeMatter" in w), JSON.stringify(Object.keys(w)));
check(
  "the stitched manifest's per-segment records likewise omit importedStartHash/netExchangeMatter for an ordinary run",
  m.segments.every((s: object) => !("importedStartHash" in s) && !("netExchangeMatter" in s)),
  JSON.stringify(m.segments.map(Object.keys)),
);

const expectThrow = (name: string, f: () => unknown) => {
  try {
    f();
    check(name, false, "accepted");
  } catch {
    check(name, true);
  }
};
expectThrow("rejects a missing segment", () => stitchRun([segs[0], segs[2]], base.steps));
expectThrow("rejects a digest other than the accepted one", () => stitchRun([segs[0], { ...segs[1], digest: "0000000000000000" }, segs[2]], base.steps));
expectThrow("rejects a short history", () => stitchRun(segs.slice(0, 2), base.steps));
expectThrow("rejects conflicting preset identities even when segment #0 recorded none", () =>
  stitchRun([reManifest(segs[0], (x) => delete x.presetIdentity), segs[1], reManifest(segs[2], (x) => (x.presetIdentity = "0000000000000000"))], base.steps));
expectThrow("rejects a segment whose preset identity differs from segment #0's", () => stitchRun([segs[0], { ...segs[1], files: { ...segs[1].files, "manifest.json": JSON.stringify({ ...JSON.parse(segs[1].files["manifest.json"]), presetIdentity: "0000000000000000" }) } }, segs[2]], base.steps));
const retail = (seg: StitchSegment, f: (row: Record<string, unknown>) => void): StitchSegment => {
  const rows = seg.files["series.jsonl"].trim().split("\n").map((l) => JSON.parse(l));
  f(rows[rows.length - 1]);
  return { ...seg, files: { ...seg.files, "series.jsonl": rows.map((r) => JSON.stringify(r) + "\n").join("") } };
};
expectThrow("rejects a final census that contradicts the summary", () => stitchRun([segs[0], retail(segs[1], (r) => (r.individuals = 987654)), segs[2]], base.steps));

// A conservation failure in one segment stays failed for the rest of the run.
const failedFirst = retail(segs[0], (r) => (r.conservationOk = false));
const fm = JSON.parse(failedFirst.files["manifest.json"]);
fm.summary.conservationOk = false;
failedFirst.files["manifest.json"] = JSON.stringify(fm);
const sticky = stitchRun([failedFirst, segs[1], segs[2]], base.steps);
const rows = sticky["series.jsonl"].trim().split("\n").map((l) => JSON.parse(l));
check(
  "a conservation failure is carried into later segments' rows and the summary",
  rows.slice(4).every((r) => r.conservationOk === false) && JSON.parse(sticky["manifest.json"]).summary.conservationOk === false,
);

// migrations.tsv (review 1): a segment's bundle carries it only when its run
// has migration configured (the "archipelago" preset), and stitchRun must
// concatenate it across segments the same way it does mutations.tsv/etc --
// tools/stitch.ts's `download` used to only ever fetch BUNDLE_FILES, so a
// coordinator export silently lost this file even though every segment had it.
const migBase: RunSpec = { experiment: "stitch-mig", presetId: "archipelago", condition: "treatment", seed: 11, steps: 400, censusEvery: 100, deepEvery: 2, checkpointEvery: 0 };
const migSegs: StitchSegment[] = [];
let migPrev: Awaited<ReturnType<typeof runExperiment>> | null = null;
for (const [index, [startStep, steps]] of [[0, 200], [200, 200]].entries()) {
  const sink = new Mem();
  const r = await runExperiment(device, { ...migBase, steps }, sink, host, () => {}, { keepFinal: true, start: migPrev?.final, observer: migPrev?.observer });
  migSegs.push({ index, startStep, steps, digest: r.summary.finalHash, files: Object.fromEntries(sink.files) });
  migPrev = r;
}
check("both migration-enabled segments recorded migrations.tsv (sanity check on the fixture)", migSegs.every((s) => typeof s.files["migrations.tsv"] === "string" && s.files["migrations.tsv"].trim().split("\n").length > 1));
const migStitched = stitchRun(migSegs, migBase.steps);
const migConcatenated = migSegs[0].files["migrations.tsv"] + migSegs[1].files["migrations.tsv"].slice(migSegs[1].files["migrations.tsv"].indexOf("\n") + 1);
check("stitchRun concatenates migrations.tsv across segments", migStitched["migrations.tsv"] === migConcatenated, `${migStitched["migrations.tsv"]?.length} vs ${migConcatenated.length} bytes`);

expectThrow(
  "stitchRun fails loudly when migrations.tsv is present on some segments but not others, instead of silently dropping it",
  () => stitchRun([migSegs[0], { ...migSegs[1], files: { ...migSegs[1].files, "migrations.tsv": undefined as unknown as string } }], migBase.steps),
);

// species.tsv: same all-or-nothing optional-file discipline as migrations.tsv above, but unlike
// migrations.tsv every segment (not just #0) writes its own baseline row at its own startStep
// (runner.ts, from whatever state it actually started from) -- this checks the merge drops that
// duplicate rather than doubling the boundary row.
const specBase: RunSpec = { ...migBase, experiment: "stitch-species", speciesCensus: true };
const specSegs: StitchSegment[] = [];
let specPrev: Awaited<ReturnType<typeof runExperiment>> | null = null;
for (const [index, [startStep, steps]] of [[0, 200], [200, 200]].entries()) {
  const sink = new Mem();
  const r = await runExperiment(device, { ...specBase, steps }, sink, host, () => {}, { keepFinal: true, start: specPrev?.final, observer: specPrev?.observer });
  specSegs.push({ index, startStep, steps, digest: r.summary.finalHash, files: Object.fromEntries(sink.files) });
  specPrev = r;
}
check("both segments recorded species.tsv (sanity check on the fixture)", specSegs.every((s) => typeof s.files["species.tsv"] === "string"));
const specStitched = stitchRun(specSegs, specBase.steps);
const specRowsAtBoundary = specStitched["species.tsv"].trim().split("\n").slice(1).filter((r) => Number(r.split("\t")[0]) === 200);
const tilesAtBoundary = specSegs[0].files["species.tsv"].trim().split("\n").slice(1).filter((r) => Number(r.split("\t")[0]) === 200).length;
check(
  "stitchRun drops segment #1's duplicate baseline row at the boundary step instead of doubling it",
  specRowsAtBoundary.length === tilesAtBoundary,
  `${specRowsAtBoundary.length} rows at step 200, expected ${tilesAtBoundary} (one set, not two)`,
);
expectThrow(
  "stitchRun fails loudly when species.tsv is present on some segments but not others, instead of silently dropping it",
  () => stitchRun([specSegs[0], { ...specSegs[1], files: { ...specSegs[1].files, "species.tsv": undefined as unknown as string } }], specBase.steps),
);

// exchanges.tsv (review P2): required whenever the spec has a metapopulation
// (not merely optional-if-present, like migrations.tsv), and its accounting
// -- row counts, import/export slot pairing, agreement with the manifest's
// own netExchangeMatter -- must hold, not just "present on every segment or
// none". Built from a real two-run ring (mirroring tests/deno/exchange.ts's
// own fixture) so the "good" case is a real accepted ledger, and "bad" cases
// are that same ledger minimally tampered with.
const xRingNamespaceFor = (seed: number) => (seed === 30 ? 1 : 2);
const xBase = (seed: number, steps: number): RunSpec => ({
  experiment: "stitch-x",
  presetId: "spots",
  condition: "treatment",
  seed,
  steps,
  censusEvery: 100,
  deepEvery: 2,
  checkpointEvery: 0,
  metapopulation: { salt: 99, migrantCount: 4, ringNamespace: xRingNamespaceFor(seed) },
});
const xTotalSteps = 200;

const aSink0x = new Mem();
const a0x = await runExperiment(device, xBase(30, 100), aSink0x, host, () => {}, { keepFinal: true });
const bSink0x = new Mem();
const b0x = await runExperiment(device, xBase(40, 100), bSink0x, host, () => {}, { keepFinal: true });
const aSink1x = new Mem();
const a1x = await runExperiment(device, xBase(30, 100), aSink1x, host, () => {}, {
  start: a0x.final,
  observer: a0x.observer,
  immigrant: b0x.final,
  keepFinal: true,
});

const xSegs: StitchSegment[] = [
  { index: 0, startStep: 0, steps: 100, digest: a0x.summary.finalHash, files: Object.fromEntries(aSink0x.files) },
  { index: 1, startStep: 100, steps: 100, digest: a1x.summary.finalHash, files: Object.fromEntries(aSink1x.files) },
];

let xStitched: Record<string, string> | null = null;
try {
  xStitched = stitchRun(xSegs, xTotalSteps);
  check("stitchRun accepts a consistent exchange ledger (good case)", true);
} catch (e) {
  check("stitchRun accepts a consistent exchange ledger (good case)", false, (e as Error).message);
}
const xMerged = (xStitched?.["exchanges.tsv"] ?? "").trim().split("\n");
check("...and merges exchanges.tsv across segments (header + segment 0's none + segment 1's 4 import + 4 export rows)", xMerged.length === 9, `${xMerged.length} lines`);

const tamperExchanges = (transform: (cols: string[]) => string[] | null) =>
  xSegs[1].files["exchanges.tsv"]
    .split("\n")
    .map((line, i) => {
      if (i === 0 || !line) return line;
      const out = transform(line.split("\t"));
      return out ? out.join("\t") : line;
    })
    .join("\n");
const withExchanges = (tsv: string | undefined) => [xSegs[0], { ...xSegs[1], files: { ...xSegs[1].files, "exchanges.tsv": tsv as unknown as string } }];

expectThrow(
  "stitchRun rejects a metapopulation run missing exchanges.tsv on a segment",
  () => stitchRun(withExchanges(undefined), xTotalSteps),
);
expectThrow(
  "stitchRun rejects an exchange ledger with a missing slot on one side (a dropped export row)",
  () =>
    stitchRun(
      withExchanges(
        xSegs[1].files["exchanges.tsv"]
          .split("\n")
          .filter((line, i) => !(i > 0 && line && line.split("\t")[1] === "export" && line.split("\t")[2] === "0"))
          .join("\n"),
      ),
      xTotalSteps,
    ),
);
expectThrow(
  "stitchRun rejects an exchange ledger whose import/export cells for the same slot don't match",
  () =>
    stitchRun(
      withExchanges(tamperExchanges((c) => (c[1] === "import" && c[2] === "0" ? [c[0], c[1], c[2], String(Number(c[3]) + 1), c[4], c[5], c[6]] : null))),
      xTotalSteps,
    ),
);
expectThrow(
  "stitchRun rejects an exchange ledger whose totals disagree with the manifest's netExchangeMatter",
  () =>
    stitchRun(
      withExchanges(tamperExchanges((c) => (c[1] === "export" && c[2] === "0" ? [c[0], c[1], c[2], c[3], String(Number(c[4]) + 1000), c[5], c[6]] : null))),
      xTotalSteps,
    ),
);
expectThrow(
  "stitchRun rejects exchanges.tsv present on a run without a metapopulation",
  () => stitchRun([{ ...segs[0], files: { ...segs[0].files, "exchanges.tsv": "step\tdirection\tslot\tcell\tmatter\tlineageHi\tlineageLo\n" } }, segs[1], segs[2]], base.steps),
);

// review P2 round 2: the previous check derived "did this boundary import"
// solely from the manifest's own self-reported importedStartHash, which is
// exactly the field a bad producer could tamper with. Expected import
// presence must instead come from the (trusted) spec: metapopulation
// present, condition != "no-migration", index >= 1.
const withSeg1 = (transform: (files: Record<string, string>) => Record<string, string>) => [xSegs[0], { ...xSegs[1], files: transform(xSegs[1].files) }];
const seg1HeaderOnlyExchanges = xSegs[1].files["exchanges.tsv"].split("\n")[0] + "\n";
expectThrow(
  "stitchRun rejects clearing importedStartHash + emptying the ledger on a boundary the spec says must have imported",
  () =>
    stitchRun(
      withSeg1((files) => ({
        ...files,
        "manifest.json": JSON.stringify({ ...JSON.parse(files["manifest.json"]), importedStartHash: null }),
        "exchanges.tsv": seg1HeaderOnlyExchanges,
      })),
      xTotalSteps,
    ),
);
expectThrow(
  "stitchRun rejects a non-importing boundary (segment #0) whose manifest sets a bogus netExchangeMatter",
  () =>
    stitchRun(
      [
        { ...xSegs[0], files: { ...xSegs[0].files, "manifest.json": JSON.stringify({ ...JSON.parse(xSegs[0].files["manifest.json"]), netExchangeMatter: 123 }) } },
        xSegs[1],
      ],
      xTotalSteps,
    ),
);
expectThrow(
  "stitchRun rejects import/export cells that agree with each other but not with the deterministic exchange position (a naive equal-to-each-other check used to accept this)",
  () => stitchRun(withExchanges(tamperExchanges((c) => [c[0], c[1], c[2], "999999999", c[4], c[5], c[6]])), xTotalSteps),
);
expectThrow(
  "stitchRun rejects a row with an unrecognised direction instead of silently dropping it from both tallies",
  () => stitchRun(withExchanges(xSegs[1].files["exchanges.tsv"] + "100\tsideways\t0\t5\t10\t0\t1\n"), xTotalSteps),
);

// review P2/P3 round 3: every row's matter must be a nonnegative integer
// (balanced corruption keeps the net at 0, so the totals check alone misses
// it), and an importing segment's importedStartHash must be a real hash.
for (const bad of ["-10", "0.5", ""]) {
  expectThrow(`stitchRun rejects balanced exchange rows with matter ${JSON.stringify(bad)}`, () =>
    stitchRun(
      withSeg1((files) => ({
        ...files,
        "manifest.json": JSON.stringify({ ...JSON.parse(files["manifest.json"]), netExchangeMatter: 0 }),
        "exchanges.tsv": tamperExchanges((c) => [c[0], c[1], c[2], c[3], bad, c[5], c[6]]),
      })),
      xTotalSteps,
    ),
  );
}
expectThrow("stitchRun rejects an empty importedStartHash on an importing boundary", () =>
  stitchRun(withSeg1((files) => ({ ...files, "manifest.json": JSON.stringify({ ...JSON.parse(files["manifest.json"]), importedStartHash: "" }) })), xTotalSteps),
);

Deno.exit(ok ? 0 : 1);
