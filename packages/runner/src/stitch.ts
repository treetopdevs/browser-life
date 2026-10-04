// Joins the per-segment bundles an archipelago run produces (one bundle per
// coordinator segment, each written by runExperiment continuing from its
// predecessor's artifact) into the single-history bundle tools/run.ts writes,
// so tools/analyze.ts can read coordinator experiments.
//
// Every observation file is append-only per census, and each segment's
// observer is restored from its predecessor's, so a run's files are the
// concatenation of its segments' (tests/deno/stitch.ts checks this against a
// continuous run byte for byte). The manifest is the last segment's, widened
// to cover the whole history.
import { HUNT_POND_COLUMNS, MATTER_MAX, METRICS_VERSION, RULE_VERSION, SCHEMA_VERSION, breedPondColumns, exchangePositions, type PondArm, type PondScore } from "@bl/schema";
import { runId, sameConfig, type RunSummary } from "./runner.ts";

/** Files one segment's runExperiment writes (checkpoints aside). */
export const BUNDLE_FILES = ["manifest.json", "series.jsonl", "lineages.tsv", "mutations.tsv", "heredity.tsv", "life.jsonl", "activity-final.json"] as const;
const TSV_FILES = ["lineages.tsv", "mutations.tsv", "heredity.tsv"] as const;
/** TSV files whose first column is the census step. */
const STEPPED_TSV = new Set(["lineages.tsv", "heredity.tsv"]);
/**
 * Migration events (see packages/schema/src/migration.ts), written only when
 * a run has migration configured — deliberately *not* in `BUNDLE_FILES`:
 * requiring it on every segment would put a "migrations.tsv" (even an
 * empty one) into every non-migration run's bundle too, which is exactly the
 * kind of bundle-shape change from before this feature existed that the
 * archipelago's other controls are careful to avoid. Exported so
 * tools/stitch.ts can download and require it the same way this module does
 * (see its own doc below) instead of only ever fetching `BUNDLE_FILES`.
 */
export const MIGRATIONS_FILE = "migrations.tsv";
/**
 * Cross-run exchange events (see packages/schema/src/exchange.ts), written
 * only for a metapopulation run — same "not in BUNDLE_FILES, all-or-nothing,
 * exported for tools/stitch.ts to fetch and require" discipline as
 * `MIGRATIONS_FILE`.
 */
export const EXCHANGES_FILE = "exchanges.tsv";
/**
 * Per-tile species census (see packages/metrics/src/biogeography.ts's
 * `tileSpeciesCensus`), written only when a run opts into
 * `RunSpec.speciesCensus` — same "not in `BUNDLE_FILES`, all-or-nothing,
 * exported for tools/stitch.ts to fetch and require" discipline as
 * `MIGRATIONS_FILE`.
 */
export const SPECIES_FILE = "species.tsv";
/**
 * Pond-cycle rows (see packages/schema/src/ponds.ts and
 * `WorldConfig.pondPeriod`), written in every pond run -- header only when a
 * segment crosses no boundary -- and never otherwise: not in `BUNDLE_FILES`,
 * for the reason `MIGRATIONS_FILE` is not. Whether a run must carry it comes
 * from its config (the pond keys), not from which segments happen to have it,
 * as `EXCHANGES_FILE`'s does from the spec.
 */
export const PONDS_FILE = "ponds.tsv";

/**
 * `BUNDLE_FILES` minus `manifest.json` — the files a verify attempt's own
 * digests (see `observationDigests` below) are compared against on the
 * coordinator (`Coordinator.Segment.complete_verify/5`'s `@observation_files`,
 * which this must match). `manifest.json` carries timestamps and host info
 * that a verifying island's own replay can never reproduce, so it's excluded.
 */
export const OBSERVATION_FILES = BUNDLE_FILES.filter((f): f is Exclude<(typeof BUNDLE_FILES)[number], "manifest.json"> => f !== "manifest.json");

/**
 * Every file a verify attempt reports a digest for when it has it:
 * `OBSERVATION_FILES` plus the optional `MIGRATIONS_FILE`, `EXCHANGES_FILE`,
 * `SPECIES_FILE` and `PONDS_FILE` (present only for, respectively, a
 * migration-enabled run, a metapopulation run, a run with `speciesCensus` on
 * and a pond run). The coordinator's `@verified_files` must match. Without
 * these optional logs here, a migrating, metapopulation, census-enabled or
 * pond run could be marked `observationsVerified` while one of them was never
 * compared.
 */
export const VERIFIED_FILES: readonly string[] = [...OBSERVATION_FILES, MIGRATIONS_FILE, EXCHANGES_FILE, SPECIES_FILE, PONDS_FILE];

/**
 * SHA-256 (lowercase hex) of each `VERIFIED_FILES` entry present in
 * `files`, exactly as its bytes would be uploaded (UTF-8 of the text) — what
 * a verify attempt reports for the coordinator to compare against the
 * accepted run attempt's own recorded file digests. `crypto.subtle` rather
 * than a platform stream: works the same in browsers and Deno.
 */
export async function observationDigests(files: Map<string, string> | Record<string, string>): Promise<Record<string, string>> {
  const get = (name: string) => (files instanceof Map ? files.get(name) : files[name]);
  const out: Record<string, string> = {};
  for (const name of VERIFIED_FILES) {
    const text = get(name);
    if (text === undefined) continue;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text) as BufferSource);
    out[name] = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return out;
}

export interface StitchSegment {
  index: number;
  startStep: number;
  steps: number;
  /** The coordinator's accepted artifact digest for this segment. */
  digest: string;
  /** SHA-256 of each bundle file, as recorded by the coordinator for the accepted attempt (provenance only; the caller checks downloads against it). */
  fileDigests?: Record<string, string> | null;
  producedBy?: string | null;
  verifiedBy?: string | null;
  /** The coordinator's `observationsVerified` for this segment (see `Coordinator.Queue`'s `{:experiment, name}` handler): `true`/`false` only when a verify attempt matching the current accepted digest also reported its own observation-file digests; `null`/absent otherwise (not verified, or verified by an older island that never reports them). */
  observationsVerified?: boolean | null;
  files: Record<string, string>;
}

/** The columns only the hunt's arms write (`HUNT_POND_COLUMNS` beyond v1's). */
const HUNT_ONLY_COLUMNS = ["died", "exportMass", "weight"] as const;

/** The columns only a run with `pondScore` writes (`BREED_POND_COLUMNS` beyond v1's). */
const SCORE_ONLY_COLUMNS = ["score", "donorScore"] as const;

/** The packet columns, beyond `cx` and `cy`, that a row without a packet holds at "0" (`makeRow`'s zeroes). */
const NO_PACKET_COLUMNS = ["landed", "reqMass", "retMass", "reqE", "retE", "truncated", "packetLineages", "domHi", "domLo", "domShare"] as const;

/** One nat/shuf row's fields the stitch rules read. */
interface HuntRow {
  died: number;
  donor: number;
  exportMass: number;
  weight: number;
  recipientTrait: number;
  landed: number;
  cx: number;
  cy: number;
  /** The raw cells of `NO_PACKET_COLUMNS`, in that order. */
  packet: string[];
  heat: string;
  light: string;
}

/**
 * The ponds.tsv rules for one stretch of a run, throwing with `id` as the prefix: a header with the step, cycle and
 * recipient columns; rows only in (startStep, end], on the pond boundaries (every `period` steps, cycle = step / period);
 * and at every boundary in that range exactly one row per pond, each recipient index 0..ponds-1 once. `stitchRun` applies
 * it to every segment, and tools/stitch.ts to a cached export over (0, steps], so an export written before a rule
 * existed cannot be kept.
 *
 * The hunt's arms nat and shuf (`arm`, or, where the caller has none, a header carrying their `died`, `exportMass` or
 * `weight` column) write `HUNT_POND_COLUMNS` exactly, and every boundary's rows must then also come in ascending pond
 * index (boundaries in ascending step) and satisfy `checkHuntBoundary`. `arm` of any other value (including none, with
 * a v1 header) leaves the v1 rules, and a v1 file's bytes, as they were.
 *
 * A run with `pondScore` (`score`; the breeder and its controls) writes `breedPondColumns(score)` exactly
 * (`BREED_POND_COLUMNS`, plus one column per term under a combined score), and every row's `score`, `donorScore` and
 * term values must be nonnegative integers below 2^53. Where the caller knows the arm, a file carrying the score
 * columns without a score in the config is refused, as a hunt header on another arm is.
 */
export function checkPondsFile(id: string, text: string, period: number | undefined, ponds: number, startStep: number, end: number, arm?: PondArm, score?: PondScore): void {
  const [header, ...rows] = lines(text);
  const names = (header ?? "").split("\t");
  const col = names.indexOf("step");
  const cycleCol = names.indexOf("cycle");
  const recipientCol = names.indexOf("recipient");
  if (col < 0 || cycleCol < 0 || recipientCol < 0)
    throw new Error(`${id}: ${PONDS_FILE} has no ${col < 0 ? "step" : cycleCol < 0 ? "cycle" : "recipient"} column in its header`);
  const huntArm = arm === "nat" || arm === "shuf";
  const huntHeader = HUNT_ONLY_COLUMNS.some((c) => names.includes(c));
  if (arm !== undefined && huntArm !== huntHeader)
    throw new Error(`${id}: ${PONDS_FILE} header ${huntHeader ? "carries" : "lacks"} the hunt's columns (${HUNT_ONLY_COLUMNS.join(", ")}), but the arm is ${arm}`);
  const hunt = huntArm || huntHeader;
  if (hunt && names.join("\t") !== HUNT_POND_COLUMNS.join("\t"))
    throw new Error(`${id}: ${PONDS_FILE} header is not the hunt's columns (${HUNT_POND_COLUMNS.join(", ")})`);
  const scoreHeader = SCORE_ONLY_COLUMNS.some((c) => names.includes(c));
  const breedColumns = score === undefined ? null : breedPondColumns(score);
  if (breedColumns !== null && names.join("\t") !== breedColumns.join("\t"))
    throw new Error(`${id}: ${PONDS_FILE} header is not the breeder's columns (${breedColumns.join(", ")}), but the run has pondScore ${score}`);
  if (score === undefined && arm !== undefined && scoreHeader)
    throw new Error(`${id}: ${PONDS_FILE} header carries the breeder's columns (${SCORE_ONLY_COLUMNS.join(", ")}), but the run has no pondScore`);
  const scoreCols = breedColumns === null ? [] : breedColumns.slice(breedColumns.indexOf("score")).map((c) => [c, names.indexOf(c)] as const);
  if (period === undefined || !Number.isSafeInteger(period) || period <= 0) throw new Error(`${id}: pondPeriod ${period} is not a positive integer`);
  const perBoundary = new Map<number, number[]>();
  const huntRows = new Map<number, HuntRow[]>();
  let lastStep = -Infinity;
  for (const row of rows) {
    const cells = row.split("\t");
    const step = Number(cells[col]);
    if (!(step > startStep && step <= end)) throw new Error(`${id}: ${PONDS_FILE} has a row at step ${step}, outside (${startStep}, ${end}]`);
    if (step % period !== 0 || Number(cells[cycleCol]) !== step / period)
      throw new Error(`${id}: ${PONDS_FILE} has a row at step ${step} with cycle ${cells[cycleCol]}, not on the pond boundaries (every ${period})`);
    // Digits only: Number("") and Number(" ") are 0, which would read a blank cell as pond 0.
    const recipientCell = cells[recipientCol] ?? "";
    const recipient = /^-?\d+$/.test(recipientCell) ? Number(recipientCell) : NaN;
    if (!Number.isInteger(recipient) || recipient < 0 || recipient >= ponds)
      throw new Error(`${id}: ${PONDS_FILE} has a row at step ${step} with recipient "${recipientCell}", not a pond index in [0, ${ponds})`);
    (perBoundary.get(step) ?? perBoundary.set(step, []).get(step)!).push(recipient);
    // Digits only and exactly representable, as huntRow reads its integers: a reader takes these with Number().
    for (const [name, at] of scoreCols)
      if (!/^\d+$/.test(cells[at] ?? "") || !Number.isSafeInteger(Number(cells[at])))
        throw new Error(`${id}: ${PONDS_FILE} has a row at step ${step} with ${name} "${cells[at] ?? ""}", not a nonnegative integer below 2^53`);
    if (hunt) {
      if (step < lastStep) throw new Error(`${id}: ${PONDS_FILE} has a row at step ${step} after one at step ${lastStep}; boundaries come in ascending order`);
      lastStep = step;
      (huntRows.get(step) ?? huntRows.set(step, []).get(step)!).push(huntRow(id, step, cells, names, ponds));
    }
  }
  for (let b = (Math.floor(startStep / period) + 1) * period; b <= end; b += period) {
    const recipients = perBoundary.get(b) ?? [];
    if (recipients.length !== ponds) throw new Error(`${id}: ${PONDS_FILE} has ${recipients.length} rows for the boundary at t=${b}, expected ${ponds} (one per pond)`);
    // The right count is not enough: a duplicated recipient hides a missing pond.
    if (new Set(recipients).size !== ponds)
      throw new Error(`${id}: ${PONDS_FILE} has recipients [${recipients.join(",")}] for the boundary at t=${b}, expected each pond 0..${ponds - 1} exactly once`);
    if (hunt) checkHuntBoundary(id, b, recipients, huntRows.get(b)!, arm);
  }
}

/** A nat/shuf row's structural fields (`HuntRow`), each a decimal integer (digits only, as the recipient is read; `donor`, `cx` and `cy` may be negative), `heat` and `light` as their cells. */
function huntRow(id: string, step: number, cells: string[], names: string[], ponds: number): HuntRow {
  const read = (name: string, signed: boolean): number => {
    const cell = cells[names.indexOf(name)] ?? "";
    const v = (signed ? /^-?\d+$/ : /^\d+$/).test(cell) ? Number(cell) : NaN;
    if (!Number.isSafeInteger(v)) throw new Error(`${id}: ${PONDS_FILE} has a row at step ${step} with ${name} "${cell}", not ${signed ? "an integer" : "a nonnegative integer"}`);
    return v;
  };
  const died = read("died", false);
  if (died !== 0 && died !== 1) throw new Error(`${id}: ${PONDS_FILE} has a row at step ${step} with died ${died}, expected 0 or 1`);
  const donor = read("donor", true);
  if (donor < -2 || donor >= ponds) throw new Error(`${id}: ${PONDS_FILE} has a row at step ${step} with donor ${donor}, not -2, -1 or a pond index in [0, ${ponds})`);
  const cell = (name: string) => cells[names.indexOf(name)] ?? "";
  return {
    died,
    donor,
    exportMass: read("exportMass", false),
    weight: read("weight", false),
    recipientTrait: read("recipientTrait", false),
    landed: read("landed", false),
    cx: read("cx", true),
    cy: read("cy", true),
    packet: NO_PACKET_COLUMNS.map(cell),
    heat: cell("heat"),
    light: cell("light"),
  };
}

/**
 * One nat/shuf boundary's rows (`rows[p]` is pond p's; `recipients` is the file order of the boundary, which must be
 * ascending pond index) against the hunt's row table. Per boundary, the weights: nat's `weight` is each pond's
 * `exportMass`; shuf's is the same multiset of masses dealt to the same exporting ponds (weight > 0 exactly where
 * exportMass > 0, the sorted values equal), which is also what nat's satisfies, so `arm` of neither (a cached export
 * checked from its header alone) is held to that. Per row: an unoccupied pond (`recipientTrait` 0) died; a survivor
 * (`died` 0) has donor -2 and a dying pond (`died` 1) has a donor index or -1, and -1 only when no pond at that
 * boundary has weight (no export anywhere, Σw = 0); a donor is a pond with weight, so with Σw = 0 every dying pond has
 * -1. A donor index means a packet landed (`landed` >= 1, centre cx, cy >= 0); donor -1 or -2 is v1's no-packet row
 * (cx = cy = -1, every other packet column and `light` "0"); and a survivor books no `heat`.
 */
function checkHuntBoundary(id: string, b: number, recipients: number[], rows: HuntRow[], arm?: PondArm): void {
  if (recipients.some((r, p) => r !== p))
    throw new Error(`${id}: ${PONDS_FILE} has recipients [${recipients.join(",")}] for the boundary at t=${b}, expected ascending pond index 0..${recipients.length - 1}`);
  const pondAt = (p: number) => `${id}: ${PONDS_FILE} pond ${p} at the boundary t=${b}`;
  if (arm === "nat") {
    const p = rows.findIndex((r) => r.weight !== r.exportMass);
    if (p >= 0) throw new Error(`${pondAt(p)} has weight ${rows[p].weight}, not its exportMass ${rows[p].exportMass} (nat's donor weights are the export masses)`);
  } else {
    const p = rows.findIndex((r) => r.weight > 0 !== r.exportMass > 0);
    if (p >= 0) throw new Error(`${pondAt(p)} has weight ${rows[p].weight} with exportMass ${rows[p].exportMass}; the weights go to exactly the exporting ponds`);
    const mass = rows.map((r) => r.exportMass).sort((x, y) => x - y);
    const dealt = rows.map((r) => r.weight).sort((x, y) => x - y);
    if (mass.some((m, j) => m !== dealt[j]))
      throw new Error(`${id}: ${PONDS_FILE} at the boundary t=${b}: the weights [${dealt.filter((w) => w > 0).join(",")}] are not a permutation of the export masses [${mass.filter((m) => m > 0).join(",")}]`);
  }
  const noExport = rows.every((r) => r.weight === 0);
  rows.forEach((r, p) => {
    const at = pondAt(p);
    if (r.died === 0 ? r.donor !== -2 : r.donor === -2) throw new Error(`${at} has died ${r.died} with donor ${r.donor}; a survivor has donor -2 and a dying pond does not`);
    if (r.recipientTrait === 0 && r.died === 0) throw new Error(`${at} has recipientTrait 0 but did not die (an unoccupied pond always dies)`);
    if (r.donor === -1 && !noExport) throw new Error(`${at} has donor -1 (no packet) though a pond at that boundary has weight`);
    if (r.died === 1 && r.donor >= 0 && rows[r.donor].weight === 0) throw new Error(`${at} has donor ${r.donor}, a pond with weight 0`);
    if (r.donor >= 0) {
      if (r.landed < 1 || r.cx < 0 || r.cy < 0) throw new Error(`${at} has donor ${r.donor} but landed ${r.landed} at (${r.cx}, ${r.cy}); a donor's packet lands with a centre in its tile`);
    } else {
      const stray = r.packet.findIndex((c) => c !== "0");
      if (r.cx !== -1 || r.cy !== -1 || stray >= 0 || r.light !== "0")
        throw new Error(`${at} has donor ${r.donor} (no packet) but cx ${r.cx}, cy ${r.cy}, ${stray >= 0 ? `${NO_PACKET_COLUMNS[stray]} ${r.packet[stray]}` : `light ${r.light}`}; no packet means cx = cy = -1 and every other packet column and light 0`);
    }
    if (r.died === 0 && r.heat !== "0") throw new Error(`${at} survived but books heat ${r.heat}; only a dying pond's heat is booked`);
  });
}

/**
 * Stitches one run's segments (in any order) into bundle files covering
 * `totalSteps`. Throws if the segments do not form one contiguous, internally
 * consistent history, or if a segment's manifest reports an end digest other
 * than its accepted one.
 *
 * Trust: that the files are the accepted attempt's own uploads is established
 * by the caller (tools/stitch.ts checks each download's SHA-256 against the
 * coordinator's record for that attempt). Their *content* still rests on the
 * producing island alone in the sense that stitching itself never re-derives
 * it — but a verify attempt may separately have reported its own regenerated
 * observation-file digests, compared server-side against the accepted
 * upload's (`observationsVerified` above, carried into each segment's record
 * and summarised in the manifest's own `observationsVerified` below).
 * The checks here only catch files inconsistent with their own manifest.
 */
export function stitchRun(segments: StitchSegment[], totalSteps: number): Record<string, string> {
  if (!segments.length) throw new Error("no segments");
  const segs = [...segments].sort((a, b) => a.index - b.index);
  const manifests = segs.map((s) => {
    for (const f of BUNDLE_FILES) if (typeof s.files[f] !== "string") throw new Error(`segment #${s.index}: missing ${f}`);
    return JSON.parse(s.files["manifest.json"]);
  });
  const first = manifests[0];
  const last = manifests[manifests.length - 1];
  const { steps: _, ...refSpec } = first.spec;
  const censusEvery: number = first.spec.censusEvery;
  // Every segment that records a preset identity must record the same one.
  const refIdentity: string | undefined = manifests.find((m) => m.presetIdentity !== undefined)?.presetIdentity;
  // Every segment's config equals segment #0's (checked below), so this holds for the whole run.
  const pondRun = first.cfg?.pondPeriod !== undefined;

  let at = 0;
  segs.forEach((s, k) => {
    const m = manifests[k];
    const id = `segment #${s.index}`;
    if (s.index !== k) throw new Error(`${id}: expected segment #${k}`);
    if (s.startStep !== at) throw new Error(`${id}: starts at ${s.startStep}, previous segment ended at ${at}`);
    if (!m.summary) throw new Error(`${id}: manifest has no summary (run did not finish)`);
    // A picked run's donors are in its picks.jsonl, not in any segment file (PICKS_FILE is deliberately in no file list), so its segments cannot be chained.
    if (m.spec.picked !== undefined) throw new Error(`${id}: picked runs cannot be stitched: their donors are not in the segment files`);
    // A branch run (RunSpec.branch) starts from a decoded source checkpoint that no segment chain carries: not distributed.
    if (m.branch !== undefined || m.spec.branch !== undefined) throw new Error(`${id}: manifest records a branch run (${JSON.stringify(m.branch ?? m.spec.branch)}); branches are not distributed, so they cannot be stitched`);
    if (m.ruleVersion !== RULE_VERSION || m.schemaVersion !== SCHEMA_VERSION) throw new Error(`${id}: rule/schema ${m.ruleVersion}/${m.schemaVersion}, expected ${RULE_VERSION}/${SCHEMA_VERSION}`);
    // A missing field predates METRICS_VERSION and is version 1 — differing
    // metric definitions (e.g. compressionRatio's compressor) must never pool.
    if ((m.metricsVersion ?? 1) !== METRICS_VERSION) throw new Error(`${id}: metrics version ${m.metricsVersion ?? 1}, expected ${METRICS_VERSION}`);
    if (m.startStep !== s.startStep || m.spec.steps !== s.steps || m.summary.steps !== s.startStep + s.steps)
      throw new Error(`${id}: manifest covers ${m.startStep}+${m.spec.steps} (ending ${m.summary.steps}), coordinator says ${s.startStep}+${s.steps}`);
    // A consistency check, not an authentication: the manifest must describe
    // the artifact the coordinator accepted.
    if (m.summary.finalHash !== s.digest) throw new Error(`${id}: manifest digest ${m.summary.finalHash} is not the accepted digest ${s.digest}`);
    const { steps: __, ...spec } = m.spec;
    if (JSON.stringify(spec) !== JSON.stringify(refSpec) || runId(m.spec) !== runId(first.spec)) throw new Error(`${id}: spec differs from segment #0's`);
    if (!sameConfig(m.cfg, first.cfg)) throw new Error(`${id}: config differs from segment #0's`);
    if (m.presetIdentity !== undefined && m.presetIdentity !== refIdentity)
      throw new Error(`${id}: preset identity ${m.presetIdentity} differs from the run's ${refIdentity}`);
    if (m.checkpoints?.length) throw new Error(`${id}: carries intermediate checkpoints, which stitching does not support`);
    // Likewise RunSpec.preCycleCheckpoints: the stitched manifest would list files it does not carry.
    if (m.preCycleCheckpoints !== undefined || m.spec.preCycleCheckpoints !== undefined) throw new Error(`${id}: carries pre-cycle checkpoints, which stitching does not support`);

    // Census grid: every censusEvery steps from the segment start, ending at its end.
    const series = lines(s.files["series.jsonl"]).map((l) => JSON.parse(l));
    const end = s.startStep + s.steps;
    const expected = Math.ceil(s.steps / censusEvery);
    if (series.length !== expected || series.some((x, i) => x.step !== Math.min(s.startStep + (i + 1) * censusEvery, end)))
      throw new Error(`${id}: series.jsonl does not hold the censuses ${s.startStep + censusEvery}..${end} every ${censusEvery}`);
    const tail = series[series.length - 1];
    const ends: [string, unknown, unknown][] = [
      ...(["mutations", "fissions", "fusions", "buddings", "maxGeneration", "conservationOk"] as const).map((k): [string, unknown, unknown] => [k, tail[k], m.summary[k]]),
      ["individuals", tail.individuals, m.summary.finalIndividuals],
      ["lineages", tail.lineages, m.summary.finalLineages],
    ];
    for (const [key, have, want] of ends) if (have !== want) throw new Error(`${id}: series.jsonl ends with ${key}=${have}, manifest says ${want}`);
    for (const l of lines(s.files["life.jsonl"])) JSON.parse(l);
    JSON.parse(s.files["activity-final.json"]);
    for (const f of STEPPED_TSV)
      for (const row of lines(s.files[f]).slice(1)) {
        const step = Number(row.split("\t", 1)[0]);
        if (!(step > s.startStep && step <= end)) throw new Error(`${id}: ${f} has a row at step ${step}, outside (${s.startStep}, ${end}]`);
      }
    // migrations.tsv is optional (only written when a run has migration configured —
    // see runner.ts): checked when present, but its absence from every segment (the
    // common, migration-disabled case) isn't an error, unlike the always-written files above.
    if (typeof s.files[MIGRATIONS_FILE] === "string")
      for (const row of lines(s.files[MIGRATIONS_FILE]).slice(1)) {
        const step = Number(row.split("\t", 1)[0]);
        if (!(step > s.startStep && step <= end)) throw new Error(`${id}: ${MIGRATIONS_FILE} has a row at step ${step}, outside (${s.startStep}, ${end}]`);
      }
    // species.tsv is optional (only written when a run has speciesCensus configured —
    // see runner.ts): checked when present, absent from every segment otherwise. Unlike
    // migrations.tsv, every segment (not just #0) writes its own baseline row at exactly its
    // own startStep (runner.ts writes one before its step loop, from whatever state it
    // actually started from) — the bound is [startStep, end], not (startStep, end], and the
    // merge below drops the boundary duplicate this produces.
    if (typeof s.files[SPECIES_FILE] === "string")
      for (const row of lines(s.files[SPECIES_FILE]).slice(1)) {
        const step = Number(row.split("\t", 1)[0]);
        if (!(step >= s.startStep && step <= end)) throw new Error(`${id}: ${SPECIES_FILE} has a row at step ${step}, outside [${s.startStep}, ${end}]`);
      }
    // ponds.tsv: required (a header-only file included) in every segment of a
    // pond run, from its config, and refused in any other run. Rows fall in
    // (startStep, end] like migrations.tsv's (a segment never cycles at its own
    // start step), but the step is read from the `step` column by header: the
    // first column is the cycle index. Every boundary in that range has
    // exactly one row per pond (every arm, the no-donor path included), each
    // recipient index 0..ponds-1 once, with cycle = step / pondPeriod, like
    // series.jsonl's census grid. The hunt's arms (nat, shuf) write the longer
    // header and add the ascending-order and died/donor rules of `checkPondsFile`.
    if (pondRun) {
      if (typeof s.files[PONDS_FILE] !== "string") throw new Error(`${id}: pond run but missing ${PONDS_FILE}`);
      checkPondsFile(id, s.files[PONDS_FILE], first.cfg.pondPeriod, first.cfg.tilesX * first.cfg.tilesY, s.startStep, end, first.cfg.pondArm, first.cfg.pondScore);
    } else if (typeof s.files[PONDS_FILE] === "string") {
      throw new Error(`${id}: ${PONDS_FILE} present on a run without the pond cycle`);
    }
    // exchanges.tsv: required (not merely permitted) whenever the spec has a
    // metapopulation -- review P2 found the previous version let every
    // segment silently omit it even when manifests declare imports, which
    // would hide exactly the kind of exporter bug review 1 already found for
    // migrations.tsv (an exporter that only ever fetched BUNDLE_FILES). Rows
    // land exactly at this segment's own start step (a metapopulation
    // boundary happens once, before any physics steps).
    if (refSpec.metapopulation) {
      if (typeof s.files[EXCHANGES_FILE] !== "string") throw new Error(`${id}: metapopulation run but missing ${EXCHANGES_FILE}`);
      const rows = lines(s.files[EXCHANGES_FILE]).slice(1);
      const cols = (r: string) => r.split("\t");
      for (const row of rows) {
        const c = cols(row);
        const step = Number(c[0]);
        if (step !== s.startStep) throw new Error(`${id}: ${EXCHANGES_FILE} has a row at step ${step}, expected exactly ${s.startStep}`);
        // review P2 round 2: a row with any other direction used to be
        // silently excluded from *both* the import and export tallies below
        // (Array.filter just skips it), instead of being caught as bad data.
        if (c[1] !== "import" && c[1] !== "export") throw new Error(`${id}: ${EXCHANGES_FILE} has a row with an unrecognised direction ${JSON.stringify(c[1])}`);
      }

      // Whether this boundary is expected to have imported comes from the
      // (trusted) spec -- metapopulation present (this branch), condition
      // other than "no-migration" (Coordinator.Queue never wires import_from
      // for that condition), and index >= 1 (segment #0 never has a
      // cross-run predecessor) -- never from the manifest's own self-reported
      // importedStartHash/netExchangeMatter, which review P2 round 2 found a
      // bad producer could clear or fabricate independently of what actually
      // happened (clearing importedStartHash on a segment that really did
      // import, or setting a bogus netExchangeMatter on one that didn't,
      // both used to pass).
      const expectImport = refSpec.condition !== "no-migration" && s.index >= 1;
      if (expectImport !== (m.importedStartHash != null))
        throw new Error(
          `${id}: importedStartHash is ${m.importedStartHash != null ? "set" : "absent"}, but this boundary ${expectImport ? "is" : "is not"} expected to have imported (metapopulation, condition ${JSON.stringify(refSpec.condition)}, index ${s.index})`,
        );
      if (expectImport && !(typeof m.importedStartHash === "string" && /^[0-9a-f]{16}$/.test(m.importedStartHash)))
        throw new Error(`${id}: importedStartHash ${JSON.stringify(m.importedStartHash)} is not a state hash (16 lowercase hex digits)`);
      if (expectImport !== (m.netExchangeMatter != null))
        throw new Error(`${id}: netExchangeMatter is ${m.netExchangeMatter != null ? "set" : "absent"}, but this boundary ${expectImport ? "is" : "is not"} expected to have imported`);

      if (expectImport) {
        // Accounting: an importing segment's boundary has exactly
        // `migrantCount` import rows and `migrantCount` export rows, one pair
        // per slot, each side's cell equal to the *deterministic* exchange
        // position for that slot -- not merely equal to each other (review P2
        // round 2: replacing every import/export cell with the same wrong
        // value, e.g. 999999999, used to pass the old equal-to-each-other
        // check). Comparing against the canonical `exchangePositions` output
        // also gives bounds and per-boundary uniqueness for free, since that
        // function never returns an out-of-range or repeated cell -- a
        // duplicated or out-of-range slot value here can only ever match at
        // most one of the `migrantCount` canonical slots, so some other slot
        // is left uncovered and caught by the "missing slot" check below.
        // Totals must agree with the manifest's own netExchangeMatter.
        const migrantCount: number = refSpec.metapopulation.migrantCount;
        const positions = exchangePositions(m.cfg, refSpec.metapopulation.salt, s.startStep, migrantCount);
        const imports = rows.filter((r) => cols(r)[1] === "import");
        const exports = rows.filter((r) => cols(r)[1] === "export");
        if (imports.length !== migrantCount) throw new Error(`${id}: ${EXCHANGES_FILE} has ${imports.length} import row(s), expected migrantCount ${migrantCount}`);
        if (exports.length !== migrantCount) throw new Error(`${id}: ${EXCHANGES_FILE} has ${exports.length} export row(s), expected migrantCount ${migrantCount}`);
        const bySlot = (rs: string[]) => new Map(rs.map((r) => [Number(cols(r)[2]), cols(r)]));
        const importBySlot = bySlot(imports);
        const exportBySlot = bySlot(exports);
        for (let slot = 0; slot < migrantCount; slot++) {
          const im = importBySlot.get(slot);
          const ex = exportBySlot.get(slot);
          if (!im || !ex) throw new Error(`${id}: ${EXCHANGES_FILE} missing slot ${slot} on the import or export side`);
          const expectedCell = positions[slot];
          if (Number(im[3]) !== expectedCell) throw new Error(`${id}: ${EXCHANGES_FILE} slot ${slot} import cell ${im[3]} does not match the deterministic exchange position ${expectedCell}`);
          if (Number(ex[3]) !== expectedCell) throw new Error(`${id}: ${EXCHANGES_FILE} slot ${slot} export cell ${ex[3]} does not match the deterministic exchange position ${expectedCell}`);
        }
        // Each row's matter must be a real per-cell amount (a nonnegative
        // integer within the world bound), not just balance in aggregate.
        for (const r of [...imports, ...exports]) {
          const v = cols(r)[4];
          if (!/^\d+$/.test(v ?? "") || Number(v) > MATTER_MAX) throw new Error(`${id}: ${EXCHANGES_FILE} has an invalid matter value ${JSON.stringify(v)}`);
        }
        const sumMatter = (rs: string[]) => rs.reduce((a, r) => a + Number(cols(r)[4]), 0);
        const net = sumMatter(imports) - sumMatter(exports);
        if (net !== m.netExchangeMatter) throw new Error(`${id}: ${EXCHANGES_FILE} totals (imports - exports = ${net}) disagree with manifest netExchangeMatter ${m.netExchangeMatter}`);
      } else if (rows.length) {
        throw new Error(`${id}: ${EXCHANGES_FILE} has ${rows.length} row(s) but this boundary is not expected to have imported`);
      }
    } else if (typeof s.files[EXCHANGES_FILE] === "string") {
      throw new Error(`${id}: ${EXCHANGES_FILE} present on a run without a metapopulation`);
    }
    // Continuity: `importedStartHash` (non-null only when this segment applied
    // an import — see runner.ts) legitimately makes this segment's physics
    // start differ from its own predecessor's end state (`startHash`, enforced
    // by the coordinator at schedule time, not checked again here). A jump is
    // only ever legitimate when *recorded* this way; segment #0 never has a
    // cross-run predecessor (see Coordinator.Queue's ring wiring), so it can
    // never legitimately carry one -- enforced above, as part of
    // `expectImport` (index 0 is never expected to import), for every
    // metapopulation run; a non-metapopulation run never sets the field at
    // all (see runner.ts), so there is nothing left to check here.
    at = end;
  });
  if (at !== totalSteps) throw new Error(`segments cover ${at} of ${totalSteps} steps`);

  const out: Record<string, string> = {};
  // conservationOk is sticky within a run but each segment starts afresh: once
  // a segment has failed, later segments' rows carry the failure, as the
  // continuous run's would.
  let failed = false;
  out["series.jsonl"] = segs
    .map((s, k) => {
      const text = failed
        ? lines(s.files["series.jsonl"]).map((l) => JSON.stringify({ ...JSON.parse(l), conservationOk: false }) + "\n").join("")
        : s.files["series.jsonl"];
      failed ||= manifests[k].summary.conservationOk !== true;
      return text;
    })
    .join("");
  out["life.jsonl"] = segs.map((s) => s.files["life.jsonl"]).join("");
  for (const f of TSV_FILES) {
    const header = lines(segs[0].files[f])[0];
    for (const s of segs) if (lines(s.files[f])[0] !== header) throw new Error(`segment #${s.index}: ${f} header differs`);
    out[f] = header + "\n" + segs.map((s) => s.files[f].slice(s.files[f].indexOf("\n") + 1)).join("");
  }
  out["activity-final.json"] = segs[segs.length - 1].files["activity-final.json"];
  // Migration configuration doesn't change mid-run, so this is all-or-nothing:
  // every segment carries migrations.tsv, or none do. Some-but-not-all means a
  // caller silently failed to fetch it for part of the run (the bug this
  // guards -- tools/stitch.ts's `download` used to only ever request
  // `BUNDLE_FILES`) rather than a legitimately migration-disabled run, so this
  // fails loudly instead of quietly exporting a truncated migration log.
  const migratingSegs = segs.filter((s) => typeof s.files[MIGRATIONS_FILE] === "string");
  if (migratingSegs.length > 0 && migratingSegs.length < segs.length) {
    const missing = segs.filter((s) => typeof s.files[MIGRATIONS_FILE] !== "string").map((s) => s.index);
    throw new Error(`${MIGRATIONS_FILE} is missing on segment(s) ${missing.join(", ")} but present on others; migration is configured for the whole run or not at all`);
  }
  if (migratingSegs.length === segs.length) {
    const header = lines(segs[0].files[MIGRATIONS_FILE])[0];
    for (const s of segs) if (lines(s.files[MIGRATIONS_FILE])[0] !== header) throw new Error(`segment #${s.index}: ${MIGRATIONS_FILE} header differs`);
    out[MIGRATIONS_FILE] = header + "\n" + segs.map((s) => s.files[MIGRATIONS_FILE].slice(s.files[MIGRATIONS_FILE].indexOf("\n") + 1)).join("");
  }
  // species.tsv: same all-or-nothing discipline as migrations.tsv above. Every segment after
  // the first repeats its own boundary as a fresh baseline row (written unconditionally at
  // actualInit.step by runner.ts) — the same step segment k-1's own final census row already
  // covers, so it's dropped here rather than duplicated in the stitched file.
  const speciesSegs = segs.filter((s) => typeof s.files[SPECIES_FILE] === "string");
  if (speciesSegs.length > 0 && speciesSegs.length < segs.length) {
    const missing = segs.filter((s) => typeof s.files[SPECIES_FILE] !== "string").map((s) => s.index);
    throw new Error(`${SPECIES_FILE} is missing on segment(s) ${missing.join(", ")} but present on others; the species census is configured for the whole run or not at all`);
  }
  if (speciesSegs.length === segs.length) {
    const header = lines(segs[0].files[SPECIES_FILE])[0];
    for (const s of segs) if (lines(s.files[SPECIES_FILE])[0] !== header) throw new Error(`segment #${s.index}: ${SPECIES_FILE} header differs`);
    const rows = segs.flatMap((s, k) => {
      const dataRows = lines(s.files[SPECIES_FILE]).slice(1);
      return k === 0 ? dataRows : dataRows.filter((row) => Number(row.split("\t", 1)[0]) !== s.startStep);
    });
    out[SPECIES_FILE] = header + "\n" + rows.map((row) => row + "\n").join("");
  }
  // Required from the config, not inferred from presence: the per-segment loop
  // above already threw if any segment of a pond run were missing it, or if a
  // run without the pond cycle had one.
  if (pondRun) {
    const header = lines(segs[0].files[PONDS_FILE])[0];
    for (const s of segs) if (lines(s.files[PONDS_FILE])[0] !== header) throw new Error(`segment #${s.index}: ${PONDS_FILE} header differs`);
    out[PONDS_FILE] = header + "\n" + segs.map((s) => s.files[PONDS_FILE].slice(s.files[PONDS_FILE].indexOf("\n") + 1)).join("");
  }
  // Required from the spec, not inferred from presence (review P2): the
  // per-segment loop above already threw if any segment of a metapopulation
  // run were missing EXCHANGES_FILE, or if a non-metapopulation run had one,
  // so every segment is guaranteed to agree by the time we get here.
  if (refSpec.metapopulation) {
    const header = lines(segs[0].files[EXCHANGES_FILE])[0];
    for (const s of segs) if (lines(s.files[EXCHANGES_FILE])[0] !== header) throw new Error(`segment #${s.index}: ${EXCHANGES_FILE} header differs`);
    out[EXCHANGES_FILE] = header + "\n" + segs.map((s) => s.files[EXCHANGES_FILE].slice(s.files[EXCHANGES_FILE].indexOf("\n") + 1)).join("");
  }

  const wall = manifests.reduce((a, m) => a + m.summary.wallSeconds, 0);
  const summary: RunSummary = {
    ...last.summary,
    steps: totalSteps,
    wallSeconds: wall,
    stepsPerSecond: totalSteps / wall,
    // Each segment checks conservation against its own start; exact equality
    // chains, so the whole history conserves iff every segment did.
    conservationOk: manifests.every((m) => m.summary.conservationOk === true),
  };
  const adapters = [...new Set(manifests.map((m) => m.host?.adapter).filter(Boolean))];
  // false if ANY segment mismatched (regardless of how many others were never
  // checked — a single known-bad segment is enough to distrust the whole
  // export), true only if EVERY segment was checked and matched, null
  // otherwise (some checked and matched, but not all — e.g. an ordinary
  // sampled-verification run — or none checked at all). `[null, true]` must
  // not read as `true`: that would overstate coverage a caller might rely on
  // to skip re-checking observation files by hand.
  const observationResults = segs.map((s) => s.observationsVerified ?? null);
  const observationsVerified = observationResults.some((v) => v === false) ? false : observationResults.every((v) => v === true) ? true : null;
  // Coverage, exposed explicitly rather than folded into the tri-state above:
  // how many of the run's segments actually had an observation comparison
  // made (true or false), out of how many total.
  const observationsChecked = { checked: observationResults.filter((v) => v !== null).length, total: observationResults.length };
  // Starting-distribution provenance comes from segment #0 (continuations
  // carry no initHash). The preset identity is kept only when every segment
  // recorded it: segments from older workers without it leave it unverified.
  const { initHash: _initHash, presetIdentity: _presetIdentity, ...lastRest } = last;
  const provenance = {
    ...(manifests.every((m) => m.presetIdentity !== undefined) ? { presetIdentity: first.presetIdentity } : {}),
    ...(first.initHash !== undefined ? { initHash: first.initHash } : {}),
  };
  out["manifest.json"] = JSON.stringify(
    {
      ...lastRest,
      ...provenance,
      spec: { ...last.spec, steps: totalSteps },
      host: { host: "archipelago", adapter: adapters.join(", ") },
      startStep: 0,
      startedAt: first.startedAt,
      finishedAt: last.finishedAt,
      checkpoints: [],
      summary,
      observationsVerified,
      observationsChecked,
      segments: segs.map((s, k) => ({
        index: s.index,
        startStep: s.startStep,
        steps: s.steps,
        digest: s.digest,
        files: s.fileDigests ?? null,
        adapter: manifests[k].host?.adapter ?? null,
        producedBy: s.producedBy ?? null,
        verifiedBy: s.verifiedBy ?? null,
        observationsVerified: s.observationsVerified ?? null,
        // Present (non-null only when this segment applied a metapopulation
        // import -- see runner.ts) *only* when the run itself has a
        // metapopulation: an ordinary run's stitched segment record omits
        // both keys entirely rather than carrying them as always-null, so it
        // stays byte-identical to its pre-metapopulation shape (review P2).
        // When present: the recorded jump from the coordinator's own
        // startHash to this segment's actual physics start, and the net
        // matter the boundary moved -- for an external archipelago checker,
        // not used by stitching itself.
        ...(refSpec.metapopulation
          ? {
              importedStartHash: manifests[k].importedStartHash ?? null,
              netExchangeMatter: manifests[k].netExchangeMatter ?? null,
            }
          : {}),
      })),
    },
    null,
    2,
  );
  return out;
}

function lines(text: string): string[] {
  return text.split("\n").filter(Boolean);
}
