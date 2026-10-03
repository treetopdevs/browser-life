// The archipelago's rules for the transition hunt's pond arms (docs/scaffold-transition-hunt-v1.md, "Code to build"),
// without a GPU: stitchRun and checkPondsFile on crafted nat and shuf segment bundles (the extended header, one row per
// pond per boundary in ascending pond index, the died/donor sentinels, boundary continuity across segments), the refusal
// of a branch run, the v1 arms left as they were, and the island's capabilities and its refusal of a branch spec.
// The row table's cell rules (a packet only where a donor is, the no-packet sentinels, weights against export masses,
// heat only from a dying pond) are also run on the rows applyCurrentCycle itself writes, and tools/stitch.ts's check of a
// cached export is run under Deno against a stub coordinator (the arm it passes is the stitched manifest's).
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CH, HUNT_POND_COLUMNS, METRICS_VERSION, POND_COLUMNS, RULE_VERSION, SCHEMA_VERSION, applyCurrentCycle, buildWorld, cellCount, defaultConfig, pondMatter, worldW, type WorldState } from "@bl/schema";
import {
  BUNDLE_FILES,
  ISLAND_CAPABILITIES,
  PONDS_FILE,
  checkPondsFile,
  pondColumns,
  pondTsvRows,
  runId,
  runIsland,
  specConfig,
  specRefusal,
  stitchRun,
  type RunSpec,
  type StitchSegment,
} from "@bl/runner";

const host = { host: "test", adapter: "test" };
const censusEvery = 100;
const natSpec: RunSpec = { experiment: "hunt", presetId: "ponds-small", condition: "pond-nat", seed: 4_900_001, steps: 1000, censusEvery, deepEvery: 10, checkpointEvery: 0 };
const shufSpec: RunSpec = { ...natSpec, condition: "pond-shuf" };
const scafSpec: RunSpec = { ...natSpec, condition: "treatment" };
const PERIOD = specConfig(natSpec).pondPeriod!;
const PONDS = 4; // ponds-small is 2 x 2
const branch = { source: "runs/scaffold/hunt1/ancestor", sourceHash: "0123456789abcdef", boundary: 3 };

const HUNT_HEADER = HUNT_POND_COLUMNS.join("\t") + "\n";
const V1_HEADER = POND_COLUMNS.join("\t") + "\n";

interface Kind {
  died: 0 | 1;
  donor: number;
  X: number;
  w: number;
  /** The pond's pre-cycle trait (100 unless given; 0 is an unoccupied pond, which must die). */
  trait?: number;
}
const survivor = (X = 0, w = X): Kind => ({ died: 0, donor: -2, X, w });
const recipient = (donor: number, X = 0, w = X): Kind => ({ died: 1, donor, X, w });
const orphan = (): Kind => ({ died: 1, donor: -1, X: 0, w: 0 });
const emptied = (k: Kind): Kind => ({ ...k, trait: 0 });

/** A row with a packet (donor >= 0): what the cells the stitch rules read hold; the rest is as `makeRow` leaves it. */
const PACKET = { landed: 64, reqMass: 4000, retMass: 4000, reqE: 100, retE: 100, truncated: 0, packetLineages: 1, domHi: 0, domLo: 7, domShare: 1 };

/** One pond's hunt row (the measurement columns other than the trait are placeholders), as `applyCurrentCycle` writes the kind: a packet and light with a donor, heat only from a dying pond. */
function huntCells(b: number, p: number, k: Kind): Record<string, string | number> {
  const cells: Record<string, string | number> = Object.fromEntries(HUNT_POND_COLUMNS.map((c) => [c, 0]));
  Object.assign(cells, { cycle: b, step: b * PERIOD, recipient: p, donor: k.donor, cx: -1, cy: -1, heat: k.died ? "12" : "0", light: "0", died: k.died, exportMass: k.X, weight: k.w, recipientTrait: k.trait ?? 100 });
  if (k.donor >= 0) Object.assign(cells, PACKET, { cx: 5 + p, cy: 6, light: "345" });
  return cells;
}
const huntLine = (b: number, p: number, k: Kind, edit: Record<string, string | number> = {}): string => {
  const cells = { ...huntCells(b, p, k), ...edit };
  return HUNT_POND_COLUMNS.map((c) => String(cells[c])).join("\t");
};
/** Boundary `b`'s rows for the ponds in `order` (ascending by default), each with its kind; `edits[p]` overrides cells of pond p's row. */
const boundary = (b: number, kinds: Kind[], order = kinds.map((_, p) => p), edits: Record<number, Record<string, string | number>> = {}) =>
  order.map((p) => huntLine(b, p, kinds[p], edits[p])).join("\n") + "\n";

// A boundary with exporters (ponds 0 and 2), one pond dying into pond 0, one into itself, one surviving without export.
const GOOD: Kind[] = [survivor(100), recipient(0), recipient(2, 50), survivor()];
// No export anywhere: every dying pond is refilled with A only.
const NO_EXPORT: Kind[] = [survivor(), orphan(), orphan(), survivor()];
const withKind = (kinds: Kind[], p: number, k: Kind) => kinds.map((x, i) => (i === p ? k : x));

/** A minimal, internally consistent segment bundle (as in ponds.test.ts), with `ponds` as its ponds.tsv, and extra manifest or spec fields. */
function segment(spec: RunSpec, index: number, startStep: number, steps: number, ponds: string | undefined, extra: { manifest?: object; spec?: object } = {}): StitchSegment {
  const end = startStep + steps;
  const rows: Record<string, unknown>[] = [];
  for (let s = startStep + censusEvery; s <= end; s += censusEvery)
    rows.push({ step: s, individuals: 1, lineages: 1, mutations: 0, fissions: 0, fusions: 0, buddings: 0, maxGeneration: 0, conservationOk: true });
  const digest = `digest-${index}`;
  const segmentSpec = { ...spec, ...extra.spec } as RunSpec;
  const manifest = {
    runId: runId(spec),
    spec: { ...segmentSpec, steps },
    cfg: specConfig(spec),
    init: "seed",
    schemaVersion: SCHEMA_VERSION,
    ruleVersion: RULE_VERSION,
    metricsVersion: METRICS_VERSION,
    host,
    startStep,
    startedAt: new Date(0).toISOString(),
    finishedAt: new Date(0).toISOString(),
    checkpoints: [],
    summary: { steps: end, wallSeconds: 1, stepsPerSecond: 1, finalHash: digest, mutations: 0, fissions: 0, fusions: 0, buddings: 0, maxGeneration: 0, finalIndividuals: 1, finalLineages: 1, extinct: false, conservationOk: true },
    ...extra.manifest,
  };
  const files: Record<string, string> = {
    "manifest.json": JSON.stringify(manifest),
    "series.jsonl": rows.map((r) => JSON.stringify(r) + "\n").join(""),
    "lineages.tsv": "step\tlineage\tcells\n",
    "mutations.tsv": "childHi\tchildLo\tparentHi\tparentLo\n",
    "heredity.tsv": "step\tmuA\tmuB\tsigmaA\tsigmaB\tmassA\tmassB\n",
    "life.jsonl": "",
    "activity-final.json": "{}",
    ...(ponds !== undefined ? { [PONDS_FILE]: ponds } : {}),
  };
  return { index, startStep, steps, digest, files };
}

/** A single nat segment (0, 1.5 periods] whose only boundary's rows are `text`. */
const one = (text: string, spec = natSpec) => [segment(spec, 0, 0, PERIOD * 1.5, HUNT_HEADER + text)];
const stitch = (text: string, spec = natSpec) => stitchRun(one(text, spec), PERIOD * 1.5);

describe("stitchRun joins the hunt's pond segments", () => {
  it.each([["nat", natSpec], ["shuf", shufSpec]])("a %s pair under one extended header, header-only segments included", (_, spec) => {
    expect(spec.condition).toMatch(/^pond-/);
    const segs = [
      segment(spec, 0, 0, PERIOD / 2, HUNT_HEADER),
      segment(spec, 1, PERIOD / 2, PERIOD * 1.5, HUNT_HEADER + boundary(1, GOOD) + boundary(2, NO_EXPORT)),
      segment(spec, 2, PERIOD * 2, PERIOD, HUNT_HEADER + boundary(3, GOOD)),
    ];
    const out = stitchRun(segs, PERIOD * 3);
    expect(out[PONDS_FILE]).toBe(HUNT_HEADER + boundary(1, GOOD) + boundary(2, NO_EXPORT) + boundary(3, GOOD));
    expect(JSON.parse(out["manifest.json"]).segments).toHaveLength(3);
  });

  it("takes every kind of row the hunt's table allows, at one boundary or another", () => {
    const quiet = [survivor(), survivor(), survivor(), survivor()]; // nobody died, nobody exports
    const allDie = [recipient(1, 4), recipient(1, 8), recipient(0), recipient(3, 6)]; // a shared donor, a dying donor, self-donation
    const mixed = [survivor(20), recipient(3, 10), recipient(0), survivor(30)]; // exporters of every kind, two recipients drawing one donor each
    for (const kinds of [quiet, allDie, mixed, NO_EXPORT, [orphan(), orphan(), orphan(), orphan()]]) expect(() => stitch(boundary(1, kinds))).not.toThrow();
  });

  it("checks continuity across segments: each boundary once, in the segment that ends on or after it", () => {
    const first = segment(natSpec, 0, 0, PERIOD, HUNT_HEADER + boundary(1, GOOD));
    // A row at the segment's own start step belongs to its predecessor.
    expect(() => stitchRun([first, segment(natSpec, 1, PERIOD, PERIOD, HUNT_HEADER + boundary(1, GOOD) + boundary(2, GOOD))], PERIOD * 2)).toThrow(/segment #1: ponds.tsv has a row at step 1000/);
    // A boundary missing from the second segment, and one repeated.
    expect(() => stitchRun([first, segment(natSpec, 1, PERIOD, PERIOD * 2, HUNT_HEADER + boundary(3, GOOD))], PERIOD * 3)).toThrow(/segment #1: ponds.tsv has 0 rows for the boundary at t=2000, expected 4/);
    expect(() => stitchRun([first, segment(natSpec, 1, PERIOD, PERIOD, HUNT_HEADER + boundary(2, GOOD) + boundary(2, GOOD))], PERIOD * 2)).toThrow(/segment #1: ponds.tsv has 8 rows for the boundary at t=2000/);
    // The second segment's header must be the first's.
    expect(() => stitchRun([first, segment(natSpec, 1, PERIOD, PERIOD, V1_HEADER)], PERIOD * 2)).toThrow(/segment #1: ponds.tsv header (carries|lacks) the hunt's columns/);
  });
});

describe("stitchRun refuses a nat or shuf ponds.tsv that breaks the hunt's rules", () => {
  const refuse = (text: string, why: RegExp, spec = natSpec) => expect(() => stitch(text, spec)).toThrow(why);

  it("a header that is not exactly the hunt's columns, or does not match the arm", () => {
    const rows = boundary(1, GOOD);
    // Built with the header swapped in directly: `one` always prepends the hunt's.
    const swap = (header: string, spec = natSpec) => stitchRun([segment(spec, 0, 0, PERIOD * 1.5, header + rows)], PERIOD * 1.5);
    expect(() => swap(V1_HEADER)).toThrow(/segment #0: ponds.tsv header lacks the hunt's columns \(died, exportMass, weight\), but the arm is nat/);
    expect(() => swap(HUNT_HEADER.replace("\tweight", ""))).toThrow(/header is not the hunt's columns/);
    expect(() => swap(HUNT_HEADER.replace("died\texportMass", "exportMass\tdied"))).toThrow(/header is not the hunt's columns/);
    expect(() => swap(HUNT_HEADER.replace("cycle\tstep", "step\tcycle"))).toThrow(/header is not the hunt's columns/);
    expect(() => swap(HUNT_HEADER, scafSpec)).toThrow(/carries the hunt's columns .* but the arm is scaf/);
    expect(() => swap(HUNT_HEADER, shufSpec)).not.toThrow();
  });

  it("one row per pond per boundary: a short, long or duplicated boundary", () => {
    refuse(boundary(1, GOOD).split("\n").slice(0, 3).join("\n") + "\n", /has 3 rows for the boundary at t=1000, expected 4/);
    refuse(boundary(1, GOOD) + boundary(1, GOOD), /has 8 rows for the boundary at t=1000, expected 4/);
    const dup = boundary(1, GOOD).split("\n");
    dup[3] = dup[0];
    refuse(dup.join("\n"), /has recipients \[0,1,2,0\] for the boundary at t=1000, expected each pond 0\.\.3 exactly once/);
    refuse("", /has 0 rows for the boundary at t=1000, expected 4/);
  });

  it("rows in ascending pond index, boundaries in ascending step", () => {
    refuse(boundary(1, GOOD, [1, 0, 2, 3]), /has recipients \[1,0,2,3\] for the boundary at t=1000, expected ascending pond index 0\.\.3/);
    refuse(boundary(1, GOOD, [3, 2, 1, 0]), /expected ascending pond index 0\.\.3/);
    const two = (a: string, b: string) => stitchRun([segment(natSpec, 0, 0, PERIOD * 2, HUNT_HEADER + a + b)], PERIOD * 2);
    expect(() => two(boundary(1, GOOD), boundary(2, GOOD))).not.toThrow();
    expect(() => two(boundary(2, GOOD), boundary(1, GOOD))).toThrow(/row at step 1000 after one at step 2000; boundaries come in ascending order/);
  });

  it("died 0 only with donor -2, and a dying pond never with -2", () => {
    const why = /pond 1 at the boundary t=1000 has died (\d) with donor (-?\d+); a survivor has donor -2 and a dying pond does not/;
    refuse(boundary(1, withKind(GOOD, 1, { died: 0, donor: 0, X: 0, w: 0 })), why);
    refuse(boundary(1, withKind(GOOD, 1, { died: 0, donor: -1, X: 0, w: 0 })), why);
    refuse(boundary(1, withKind(GOOD, 1, { died: 1, donor: -2, X: 0, w: 0 })), why);
    refuse(boundary(1, withKind(NO_EXPORT, 1, { died: 1, donor: -2, X: 0, w: 0 })), why);
  });

  it("donor -1 only when every row of the boundary has weight 0, and every dying pond then has it", () => {
    // Pond 1 has no packet though pond 0 weighs 100.
    refuse(boundary(1, withKind(GOOD, 1, orphan())), /pond 1 at the boundary t=1000 has donor -1 \(no packet\) though a pond at that boundary has weight/);
    // No export anywhere, yet pond 1 names donor 0, and then itself.
    refuse(boundary(1, withKind(NO_EXPORT, 1, recipient(0))), /pond 1 at the boundary t=1000 has donor 0, a pond with weight 0/);
    refuse(boundary(1, withKind(NO_EXPORT, 1, recipient(1))), /pond 1 at the boundary t=1000 has donor 1, a pond with weight 0/);
    // Exports on the other hand: a donor must be a pond with weight (a dying donor and the recipient itself are).
    refuse(boundary(1, withKind(GOOD, 1, recipient(3))), /pond 1 at the boundary t=1000 has donor 3, a pond with weight 0/);
    expect(() => stitch(boundary(1, withKind(GOOD, 1, recipient(2))))).not.toThrow();
    expect(() => stitch(boundary(1, [recipient(0, 7), recipient(0), survivor(), survivor()]))).not.toThrow(); // self-donation, and a dying donor
  });

  it("values that are not the integers the table needs", () => {
    const line = (p: number, edit: (cells: string[]) => void) => {
      const cells = huntLine(1, p, GOOD[p]).split("\t");
      edit(cells);
      return cells.join("\t");
    };
    const at = (name: string) => HUNT_POND_COLUMNS.indexOf(name as (typeof HUNT_POND_COLUMNS)[number]);
    const swapped = (p: number, name: string, value: string) => {
      const lines = boundary(1, GOOD).split("\n");
      lines[p] = line(p, (cells) => (cells[at(name)] = value));
      return lines.join("\n");
    };
    refuse(swapped(1, "died", "2"), /row at step 1000 with died 2, expected 0 or 1/);
    refuse(swapped(1, "died", "-1"), /with died "-1", not a nonnegative integer/);
    refuse(swapped(1, "died", ""), /with died "", not a nonnegative integer/);
    refuse(swapped(1, "donor", "4"), /with donor 4, not -2, -1 or a pond index in \[0, 4\)/);
    refuse(swapped(1, "donor", "-3"), /with donor -3, not -2, -1 or a pond index/);
    refuse(swapped(1, "donor", "x"), /with donor "x", not an integer/);
    refuse(swapped(0, "exportMass", "-5"), /with exportMass "-5", not a nonnegative integer/);
    refuse(swapped(0, "exportMass", "1.5"), /with exportMass "1.5", not a nonnegative integer/);
    refuse(swapped(0, "weight", " "), /with weight " ", not a nonnegative integer/);
    refuse(swapped(0, "weight", "1e3"), /with weight "1e3", not a nonnegative integer/);
    refuse(swapped(0, "recipientTrait", "-4"), /with recipientTrait "-4", not a nonnegative integer/);
    refuse(swapped(1, "landed", "1.5"), /with landed "1.5", not a nonnegative integer/);
    refuse(swapped(1, "cx", "x"), /with cx "x", not an integer/);
    refuse(swapped(1, "cy", ""), /with cy "", not an integer/);
  });

  // The cases below include the audit's probe scenarios: nat rows at one boundary of four ponds.
  it("an unoccupied pond always dies: recipientTrait 0 with died 0 is refused, with died 1 it is not", () => {
    refuse(boundary(1, withKind(GOOD, 3, emptied(survivor()))), /pond 3 at the boundary t=1000 has recipientTrait 0 but did not die/);
    refuse(boundary(1, withKind(GOOD, 1, emptied(survivor()))), /pond 1 at the boundary t=1000 has recipientTrait 0 but did not die/);
    expect(() => stitch(boundary(1, withKind(GOOD, 1, emptied(recipient(0)))))).not.toThrow();
    expect(() => stitch(boundary(1, withKind(GOOD, 3, emptied(recipient(2, 0)))))).not.toThrow();
    expect(() => stitch(boundary(1, withKind(NO_EXPORT, 0, emptied(orphan()))))).not.toThrow();
  });

  it("nat: weight is exportMass on every row; a weight on a pond that exports nothing, or a missing one, is refused", () => {
    const why = /pond (\d) at the boundary t=1000 has weight (\d+), not its exportMass (\d+) \(nat's donor weights are the export masses\)/;
    refuse(boundary(1, GOOD, undefined, { 1: { weight: 500 } }), why);
    refuse(boundary(1, GOOD, undefined, { 0: { weight: 99 } }), why);
    refuse(boundary(1, GOOD, undefined, { 2: { weight: 0 } }), why);
    refuse(boundary(1, GOOD, undefined, { 3: { exportMass: 7 } }), why);
    // Under checkPondsFile alone, with the arm.
    expect(() => checkPondsFile("export", HUNT_HEADER + boundary(1, GOOD, undefined, { 1: { weight: 500 } }), PERIOD, PONDS, 0, PERIOD, "nat")).toThrow(why);
  });

  it("shuf: the weights are a permutation of the export masses, on the exporting ponds", () => {
    // Ponds 0 and 2 export 100 and 50, and the dealing hands them 50 and 100.
    const dealt = [survivor(100, 50), recipient(2), recipient(2, 50, 100), survivor()];
    expect(() => stitch(boundary(1, dealt), shufSpec)).not.toThrow();
    // Without an arm (a cached export read from its header) both arms' common rules apply.
    expect(() => checkPondsFile("export", HUNT_HEADER + boundary(1, dealt), PERIOD, PONDS, 0, PERIOD)).not.toThrow();
    // That dealing is not nat's.
    refuse(boundary(1, dealt), /pond 0 at the boundary t=1000 has weight 50, not its exportMass 100/);
    // Weights that are not the masses, a weight where nothing exports, an exporter left without one.
    const exporting = /has weight (\d+) with exportMass (\d+); the weights go to exactly the exporting ponds/;
    refuse(boundary(1, dealt, undefined, { 0: { weight: 60 } }), /the weights \[60,100\] are not a permutation of the export masses \[50,100\]/, shufSpec);
    refuse(boundary(1, dealt, undefined, { 0: { weight: 100 } }), /the weights \[100,100\] are not a permutation of the export masses \[50,100\]/, shufSpec);
    refuse(boundary(1, dealt, undefined, { 3: { weight: 25 } }), /pond 3 at the boundary t=1000 has weight 25 with exportMass 0; the weights go to exactly the exporting ponds/, shufSpec);
    refuse(boundary(1, dealt, undefined, { 0: { weight: 0 } }), /pond 0 at the boundary t=1000 has weight 0 with exportMass 100; the weights go to exactly the exporting ponds/, shufSpec);
    refuse(boundary(1, dealt, undefined, { 1: { weight: 1 } }), exporting, shufSpec);
    // One exporter has one dealing, its own mass.
    expect(() => stitch(boundary(1, [survivor(80), survivor(), survivor(), survivor()]), shufSpec)).not.toThrow();
    refuse(boundary(1, [survivor(80, 90), survivor(), survivor(), survivor()]), /weight 90, not its exportMass 80/);
    refuse(boundary(1, [survivor(80, 90), survivor(), survivor(), survivor()]), /weights \[90\] are not a permutation of the export masses \[80\]/, shufSpec);
  });

  it("a donor index means a packet landed: landed >= 1 and a centre (cx, cy) >= 0", () => {
    const why = /pond 1 at the boundary t=1000 has donor 0 but landed (\d+) at \((-?\d+), (-?\d+)\); a donor's packet lands with a centre in its tile/;
    refuse(boundary(1, GOOD, undefined, { 1: { landed: 0 } }), why);
    refuse(boundary(1, GOOD, undefined, { 1: { cx: -1 } }), why);
    refuse(boundary(1, GOOD, undefined, { 1: { cy: -1 } }), why);
    refuse(boundary(1, GOOD, undefined, { 1: { landed: 0, cx: -1, cy: -1 } }), why); // a recipient with a donor but no packet
    for (const [cx, cy] of [[0, 0], [63, 63]]) expect(() => stitch(boundary(1, GOOD, undefined, { 1: { cx, cy } }))).not.toThrow();
  });

  it("donor -1 and -2 are v1's no-packet row: cx = cy = -1, every other packet column and light 0", () => {
    const packetColumns = ["landed", "reqMass", "retMass", "reqE", "retE", "truncated", "packetLineages", "domHi", "domLo", "domShare"];
    // A survivor (donor -2) and an orphan (donor -1) alike.
    for (const [kinds, p] of [[GOOD, 3], [NO_EXPORT, 0], [NO_EXPORT, 1]] as const) {
      const refuseAt = (edit: Record<string, string | number>, why: RegExp) => refuse(boundary(1, [...kinds], undefined, { [p]: edit }), why);
      refuseAt({ cx: 3 }, /has donor -[12] \(no packet\) but cx 3, cy -1/);
      refuseAt({ cy: 4 }, /has donor -[12] \(no packet\) but cx -1, cy 4/);
      refuseAt({ cx: 0, cy: 0 }, /no packet means cx = cy = -1/);
      for (const col of packetColumns) refuseAt({ [col]: 5 }, new RegExp(`has donor -[12] \\(no packet\\) but cx -1, cy -1, ${col} 5`));
      refuseAt({ domShare: "0.5" }, /domShare 0\.5/);
      refuseAt({ light: "5" }, /cy -1, light 5/);
      refuseAt({ light: "0.0" }, /light 0\.0/);
    }
    // A survivor with heat, light and a packet at once: refused (the packet first).
    refuse(boundary(1, GOOD, undefined, { 3: { heat: "999", light: "5", landed: 64, cx: 3, cy: 4 } }), /pond 3 at the boundary t=1000 has donor -2 \(no packet\) but cx 3, cy 4/);
  });

  it("only a dying pond books heat: a survivor's heat must be 0 (a dying pond's may be 0 or not)", () => {
    refuse(boundary(1, GOOD, undefined, { 3: { heat: "999" } }), /pond 3 at the boundary t=1000 survived but books heat 999; only a dying pond's heat is booked/);
    refuse(boundary(1, GOOD, undefined, { 0: { heat: "1" } }), /pond 0 at the boundary t=1000 survived but books heat 1/);
    for (const heat of ["0", "12", "123456789012345678901234567890"]) expect(() => stitch(boundary(1, GOOD, undefined, { 1: { heat } }))).not.toThrow();
  });

  it("the same rules for shuf, and under checkPondsFile alone (a cached export, with or without the arm)", () => {
    const bad = boundary(1, withKind(GOOD, 1, orphan()));
    refuse(bad, /donor -1 \(no packet\)/, shufSpec);
    const text = HUNT_HEADER + boundary(1, GOOD) + boundary(2, NO_EXPORT);
    for (const arm of [undefined, "nat", "shuf"] as const) {
      expect(() => checkPondsFile("export", text, PERIOD, PONDS, 0, PERIOD * 2, arm)).not.toThrow();
      expect(() => checkPondsFile("export", HUNT_HEADER + bad, PERIOD, PONDS, 0, PERIOD, arm)).toThrow(/^export: ponds.tsv pond 1 at the boundary t=1000 has donor -1/);
    }
    // The hunt's header is recognised without an arm, and refused on a v1 arm.
    expect(() => checkPondsFile("export", text, PERIOD, PONDS, 0, PERIOD * 2, "rand")).toThrow(/carries the hunt's columns/);
    expect(() => checkPondsFile("export", HUNT_HEADER + boundary(1, GOOD, [1, 0, 2, 3]), PERIOD, PONDS, 0, PERIOD)).toThrow(/ascending pond index/);
    expect(() => checkPondsFile("export", text, undefined, PONDS, 0, PERIOD * 2, "nat")).toThrow(/pondPeriod undefined is not a positive integer/);
  });
});

/** A crafted 2 x 2 pond world (mutation off): `plants` are [pond, x, y, B] cells; a cell more than 28 from the tile centre exports. */
function crafted(plants: [number, number, number, number][], seed = 7): WorldState {
  const s = buildWorld(defaultConfig({ tileW: 64, tileH: 64, tilesX: 2, tilesY: 2, seed, mutRate: 0 }), { nutrient: 32, founders: [] });
  const n = cellCount(s.cfg);
  for (const [pond, x, y, B] of plants) {
    const i = (Math.floor(pond / 2) * 64 + y) * worldW(s.cfg) + (pond % 2) * 64 + x;
    s.cells[CH.B * n + i] = B;
    s.cells[CH.E * n + i] = 5;
  }
  return s;
}

describe("the rows applyCurrentCycle writes pass the stitch rules", () => {
  // Ponds 0 and 1 export (zone cells), pond 2 is occupied in its interior only, pond 3 is empty.
  const garden = () => crafted([[0, 2, 10, 120], [0, 60, 40, 90], [0, 30, 30, 500], [1, 0, 0, 60], [1, 20, 20, 300], [2, 32, 32, 200]]);
  // No pond exports: Σw = 0, so every dying pond is refilled with A only.
  const interior = () => crafted([[0, 30, 30, 500], [1, 32, 32, 300], [2, 31, 33, 200]]);

  /** Boundaries 1..`last` of one arm and death rate over `world`, as a ponds.tsv; the counts say which kinds of row it holds. */
  function history(world: () => WorldState, arm: "nat" | "shuf", death: number, last: number) {
    let text = HUNT_HEADER;
    const seen = { survived: 0, packet: 0, orphan: 0, selfDonor: 0, truncated: 0 };
    for (let b = 1; b <= last; b++) {
      const pre = { ...world(), step: b * PERIOD };
      const { rows } = applyCurrentCycle(pre, b, arm, 8, death, 28, pondMatter(pre));
      text += pondTsvRows(rows, pondColumns(arm));
      for (const r of rows) {
        if (r.donor === -2) seen.survived++;
        else if (r.donor === -1) seen.orphan++;
        else {
          seen.packet++;
          if (r.donor === r.recipient) seen.selfDonor++;
          if (r.truncated) seen.truncated++;
        }
      }
    }
    return { text, seen };
  }

  it.each(["nat", "shuf"] as const)("%s: survivors, packets, self-donation and no-export boundaries, whole files, with the arm and without", (arm) => {
    const spec = arm === "nat" ? natSpec : shufSpec;
    for (const [world, death] of [[garden, 32768], [garden, 65536], [garden, 1], [interior, 32768], [interior, 65536]] as const) {
      const { text, seen } = history(world, arm, death, 24);
      expect(() => checkPondsFile("real", text, PERIOD, PONDS, 0, PERIOD * 24, arm)).not.toThrow();
      expect(() => checkPondsFile("real", text, PERIOD, PONDS, 0, PERIOD * 24)).not.toThrow();
      expect(() => stitchRun([segment(spec, 0, 0, PERIOD * 24, text)], PERIOD * 24)).not.toThrow();
      if (world === interior) expect([seen.packet, seen.orphan > 0]).toEqual([0, true]);
    }
    // Between them the runs hold every kind of row the table has.
    const half = history(garden, arm, 32768, 24).seen;
    expect(half.survived).toBeGreaterThan(0);
    expect(half.packet).toBeGreaterThan(0);
    expect(half.selfDonor).toBeGreaterThan(0);
    // The empty pond dies every boundary, with or without a donor.
    expect(history(garden, arm, 1, 24).seen.packet).toBeGreaterThan(0);
  });
});

describe("a cached export is checked with the run's own arm (tools/stitch.ts)", () => {
  it("checkPondsFile: nat or shuf rows under a v1 header are refused once the arm is given; without an arm, a v1 header means a v1 run", () => {
    // The audit's probe: rows with died, exportMass and weight values under v1's header, as a nat run's file.
    const v1Rows = [0, 1, 2, 3].map((p) => huntLine(1, p, survivor()).split("\t").slice(0, POND_COLUMNS.length).join("\t")).join("\n") + "\n";
    expect(() => checkPondsFile("export", V1_HEADER + v1Rows, PERIOD, PONDS, 0, PERIOD)).not.toThrow(); // the call tools/stitch.ts made, without the arm
    for (const arm of ["nat", "shuf"] as const) expect(() => checkPondsFile("export", V1_HEADER + v1Rows, PERIOD, PONDS, 0, PERIOD, arm)).toThrow(/ponds.tsv header lacks the hunt's columns \(died, exportMass, weight\), but the arm is (nat|shuf)/);
    // And the other way: the hunt's header under the preset's arm (scaf) is the mismatch the manifest's arm avoids.
    expect(() => checkPondsFile("export", HUNT_HEADER + boundary(1, GOOD), PERIOD, PONDS, 0, PERIOD, "scaf")).toThrow(/carries the hunt's columns .* but the arm is scaf/);
    expect(() => checkPondsFile("export", HUNT_HEADER + boundary(1, GOOD), PERIOD, PONDS, 0, PERIOD, "nat")).not.toThrow();
  });

  // Runs tools/stitch.ts under Deno against a stub coordinator whose experiments each list one finished run, with an export of it
  // already on disk: the run's ponds.tsv is rechecked before the export is kept, and one that fails is moved aside.
  const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
  const run = promisify(execFile);
  const cases: Record<string, { arm: string | undefined; file: string }> = {
    // nat run, the hunt's file: kept (the preset's arm is not nat, so passing it would refuse the hunt's header)
    "nat-ok": { arm: "nat", file: HUNT_HEADER + boundary(1, GOOD) },
    // nat run whose file carries v1's header: refused with the manifest's arm
    "nat-v1-header": { arm: "nat", file: V1_HEADER + [0, 1, 2, 3].map((p) => huntLine(1, p, survivor()).split("\t").slice(0, POND_COLUMNS.length).join("\t")).join("\n") + "\n" },
    // nat run whose rows break the row table: refused
    "nat-bad-rows": { arm: "nat", file: HUNT_HEADER + boundary(1, withKind(GOOD, 3, emptied(survivor()))) },
    // a v1 run: kept as before
    "scaf-v1": { arm: "scaf", file: V1_HEADER + [3, 1, 0, 2].map((p) => huntLine(1, p, survivor()).split("\t").slice(0, POND_COLUMNS.length).join("\t")).join("\n") + "\n" },
    // a manifest that records no arm (an export older than the arm): the file's own header decides
    "no-arm-hunt": { arm: undefined, file: HUNT_HEADER + boundary(1, GOOD) },
  };

  it("keeps an export that follows the manifest's arm and moves one that does not aside", async () => {
    const out = mkdtempSync(join(tmpdir(), "hunt-stitch-"));
    const digest = "d".repeat(64);
    const files = Object.fromEntries([...BUNDLE_FILES, PONDS_FILE].map((f) => [f, "0".repeat(64)]));
    const listed = { digest, files, verifiedBy: null, observationsVerified: null };
    for (const [name, c] of Object.entries(cases)) {
      const dir = join(out, name, "ponds-small", name, "seed-1");
      mkdirSync(dir, { recursive: true });
      for (const f of BUNDLE_FILES) writeFileSync(join(dir, f), f === "manifest.json" ? "" : "x");
      writeFileSync(join(dir, PONDS_FILE), c.file);
      writeFileSync(join(dir, "manifest.json"), JSON.stringify({ metricsVersion: METRICS_VERSION, ...(c.arm ? { cfg: { pondArm: c.arm } } : {}), segments: [listed] }));
    }
    const server: Server = createServer((req, res) => {
      const name = decodeURIComponent((req.url ?? "").replace("/api/experiments/", ""));
      if (!(name in cases)) return void res.writeHead(404).end("no such experiment");
      const segment = { id: "s0", run: `${name}/ponds-small/${name}/seed-1`, index: 0, last: true, startStep: 0, steps: PERIOD, status: "done", ...listed, producedBy: "isl" };
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ spec: { steps: PERIOD, presetId: "ponds-small" }, segments: [segment] }));
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const port = (server.address() as { port: number }).port;
    const stitch = async (name: string): Promise<{ code: number; stdout: string; stderr: string }> => {
      try {
        const r = await run("deno", ["run", "-A", "tools/stitch.ts", "--experiment", name, "--coordinator", `http://127.0.0.1:${port}`, "--out", out, "--allow-unverified"], { cwd: ROOT });
        return { code: 0, ...r };
      } catch (e) {
        const x = e as { code: number; stdout: string; stderr: string };
        return { code: x.code, stdout: x.stdout, stderr: x.stderr };
      }
    };
    try {
      const got = Object.fromEntries(await Promise.all(Object.keys(cases).map(async (name) => [name, await stitch(name)])));
      const moved = (name: string) => readdirSync(join(out, name, "ponds-small", name)).filter((d) => d.startsWith("seed-1.stale-"));
      for (const name of ["nat-ok", "scaf-v1", "no-arm-hunt"]) {
        expect(got[name].code, got[name].stderr).toBe(0);
        expect(got[name].stdout).toContain("0 written, 1 already present, 0 skipped");
        expect(moved(name)).toEqual([]);
      }
      // The refused exports are moved aside before the (stubbed-out) download of a replacement fails.
      expect(got["nat-v1-header"].stderr).toMatch(/export fails the ponds.tsv check \(.*ponds.tsv header lacks the hunt's columns \(died, exportMass, weight\), but the arm is nat\)/);
      expect(got["nat-bad-rows"].stderr).toMatch(/export fails the ponds.tsv check \(.*pond 3 at the boundary t=1000 has recipientTrait 0 but did not die/);
      for (const name of ["nat-v1-header", "nat-bad-rows"]) expect(moved(name)).toHaveLength(1);
    } finally {
      await new Promise((done) => server.close(done));
      rmSync(out, { recursive: true, force: true });
    }
  }, 120_000);
});

describe("stitchRun refuses a branch run", () => {
  it("a manifest that records a branch (the first segment of a branch run)", () => {
    const seg = segment(natSpec, 0, 0, PERIOD, HUNT_HEADER + boundary(1, GOOD), { manifest: { branch: { ...branch, postHash: "fedcba9876543210" } } });
    expect(() => stitchRun([seg], PERIOD)).toThrow(/segment #0: manifest records a branch run \(.*"boundary":3.*\); branches are not distributed, so they cannot be stitched/);
  });

  it("a spec that names a branch, in any segment, even where the manifest does not (a continuation of a branch run)", () => {
    const first = segment(natSpec, 0, 0, PERIOD, HUNT_HEADER + boundary(1, GOOD));
    const second = segment(natSpec, 1, PERIOD, PERIOD, HUNT_HEADER + boundary(2, GOOD), { spec: { branch } });
    expect(() => stitchRun([first, second], PERIOD * 2)).toThrow(/segment #1: manifest records a branch run/);
    const onlyFirst = segment(natSpec, 0, 0, PERIOD, HUNT_HEADER + boundary(1, GOOD), { spec: { branch } });
    expect(() => stitchRun([onlyFirst], PERIOD)).toThrow(/segment #0: manifest records a branch run/);
  });

  it("is not triggered by an ordinary run", () => {
    expect(() => stitchRun([segment(natSpec, 0, 0, PERIOD, HUNT_HEADER + boundary(1, GOOD))], PERIOD)).not.toThrow();
  });
});

describe("the v1 arms are stitched as before", () => {
  /** A v1 boundary's rows: only the structural columns matter. */
  const v1 = (b: number, order = [0, 1, 2, 3]) =>
    order
      .map((p) => {
        const cells: Record<string, string | number> = Object.fromEntries(POND_COLUMNS.map((c) => [c, 0]));
        Object.assign(cells, { cycle: b, step: b * PERIOD, recipient: p, donor: -1, cx: -1, cy: -1, heat: "0", light: "0" });
        return POND_COLUMNS.map((c) => String(cells[c])).join("\t");
      })
      .join("\n") + "\n";

  it.each(["treatment", "pond-rand", "pond-cont"])("%s: the v1 header, free recipient order within a boundary, no died or donor rules", (condition) => {
    const spec = { ...natSpec, condition };
    const text = V1_HEADER + v1(1, [3, 1, 0, 2]);
    expect(stitchRun([segment(spec, 0, 0, PERIOD, text)], PERIOD)[PONDS_FILE]).toBe(text);
    // Donor -1 beside survivors-that-never-were: nothing of the hunt's table applies.
    expect(() => checkPondsFile("export", text, PERIOD, PONDS, 0, PERIOD, specConfig(spec).pondArm)).not.toThrow();
    expect(() => checkPondsFile("export", text, PERIOD, PONDS, 0, PERIOD)).not.toThrow();
  });

  it("a v1 header on a v1 run is not checked for the hunt's columns", () => {
    const short = "cycle\tstep\trecipient\n1\t1000\t0\n1\t1000\t1\n1\t1000\t2\n1\t1000\t3\n";
    expect(() => checkPondsFile("export", short, PERIOD, PONDS, 0, PERIOD, "scaf")).not.toThrow();
    expect(() => checkPondsFile("export", short, PERIOD, PONDS, 0, PERIOD)).not.toThrow();
  });
});

describe("the island: ponds-v2 and no branches", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("advertises ponds-v1 and ponds-v2", () => {
    expect([...ISLAND_CAPABILITIES]).toEqual(["ponds-v1", "ponds-v2"]);
  });

  it("specRefusal: null for an ordinary spec (hunt arms included), a message for a branch spec", () => {
    expect(specRefusal(natSpec)).toBeNull();
    expect(specRefusal(scafSpec)).toBeNull();
    expect(specRefusal({ ...natSpec, overrides: { mutRate: 0 } })).toBeNull();
    expect(specRefusal({ ...natSpec, branch } as RunSpec)).toMatch(/branch run.*not distributed/);
  });

  it("refuses a task whose spec has a branch before fetching anything, and runs on no state", async () => {
    const paths: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      const path = new URL(url).pathname;
      paths.push(path);
      const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } });
      if (path === "/api/islands") return json({ id: "isl", token: "tok" });
      if (path === "/api/next")
        return json({
          kind: "run",
          lease: "L",
          segment: { id: "seg-1", run: "hunt/ponds-small/pond-nat/seed-1", index: 1, startStep: 1000, steps: 1000 },
          spec: { ...natSpec, branch },
          startFrom: "seg-0",
          startHash: "0123456789abcdef",
        });
      throw new Error(`unexpected ${path}`);
    });
    await expect(runIsland({} as GPUDevice, { coordinator: "http://coord", host, maxTasks: 1 })).rejects.toThrow(/refusing hunt\/ponds-small\/pond-nat\/seed-1 #1: .*branch.*not distributed/);
    // No predecessor fetch, heartbeat, rejection or completion: the task is left to its lease.
    expect(paths).toEqual(["/api/islands", "/api/next"]);
  });
});
