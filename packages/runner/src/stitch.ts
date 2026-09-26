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
import { RULE_VERSION, SCHEMA_VERSION } from "@bl/schema";
import { runId, sameConfig, type RunSummary } from "./runner.ts";

/** Files one segment's runExperiment writes (checkpoints aside). */
export const BUNDLE_FILES = ["manifest.json", "series.jsonl", "lineages.tsv", "mutations.tsv", "heredity.tsv", "life.jsonl", "activity-final.json"] as const;
const TSV_FILES = ["lineages.tsv", "mutations.tsv", "heredity.tsv"] as const;
/** TSV files whose first column is the census step. */
const STEPPED_TSV = new Set(["lineages.tsv", "heredity.tsv"]);

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
  files: Record<string, string>;
}

/**
 * Stitches one run's segments (in any order) into bundle files covering
 * `totalSteps`. Throws if the segments do not form one contiguous, internally
 * consistent history, or if a segment's manifest reports an end digest other
 * than its accepted one.
 *
 * Trust: that the files are the accepted attempt's own uploads is established
 * by the caller (tools/stitch.ts checks each download's SHA-256 against the
 * coordinator's record for that attempt). Their *content* rests on the
 * producing island alone: verifiers replay the segment and compare the
 * physics+observer artifact digest, but never compare their own observation
 * files with the accepted uploads.
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

  let at = 0;
  segs.forEach((s, k) => {
    const m = manifests[k];
    const id = `segment #${s.index}`;
    if (s.index !== k) throw new Error(`${id}: expected segment #${k}`);
    if (s.startStep !== at) throw new Error(`${id}: starts at ${s.startStep}, previous segment ended at ${at}`);
    if (!m.summary) throw new Error(`${id}: manifest has no summary (run did not finish)`);
    if (m.ruleVersion !== RULE_VERSION || m.schemaVersion !== SCHEMA_VERSION) throw new Error(`${id}: rule/schema ${m.ruleVersion}/${m.schemaVersion}, expected ${RULE_VERSION}/${SCHEMA_VERSION}`);
    if (m.startStep !== s.startStep || m.spec.steps !== s.steps || m.summary.steps !== s.startStep + s.steps)
      throw new Error(`${id}: manifest covers ${m.startStep}+${m.spec.steps} (ending ${m.summary.steps}), coordinator says ${s.startStep}+${s.steps}`);
    // A consistency check, not an authentication: the manifest must describe
    // the artifact the coordinator accepted.
    if (m.summary.finalHash !== s.digest) throw new Error(`${id}: manifest digest ${m.summary.finalHash} is not the accepted digest ${s.digest}`);
    const { steps: __, ...spec } = m.spec;
    if (JSON.stringify(spec) !== JSON.stringify(refSpec) || runId(m.spec) !== runId(first.spec)) throw new Error(`${id}: spec differs from segment #0's`);
    if (!sameConfig(m.cfg, first.cfg)) throw new Error(`${id}: config differs from segment #0's`);
    if (m.checkpoints?.length) throw new Error(`${id}: carries intermediate checkpoints, which stitching does not support`);

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
  out["manifest.json"] = JSON.stringify(
    {
      ...last,
      spec: { ...last.spec, steps: totalSteps },
      host: { host: "archipelago", adapter: adapters.join(", ") },
      startStep: 0,
      startedAt: first.startedAt,
      finishedAt: last.finishedAt,
      checkpoints: [],
      summary,
      segments: segs.map((s, k) => ({
        index: s.index,
        startStep: s.startStep,
        steps: s.steps,
        digest: s.digest,
        files: s.fileDigests ?? null,
        adapter: manifests[k].host?.adapter ?? null,
        producedBy: s.producedBy ?? null,
        verifiedBy: s.verifiedBy ?? null,
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
