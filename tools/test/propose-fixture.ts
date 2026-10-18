// Synthetic inputs for the proposer's tests (tools/lib/propose.ts): a source manifest as tools/run.ts writes one (with or without
// checkpoint entries; its initHash and presetIdentity the real ones for its preset and seed), a .notes.json as tools/notebook.ts
// writes one (only the fields the proposer reads, plus a few it ignores), a tiny series, and a checkpoint artifact.
import { PRESETS, RULE_VERSION, SCHEMA_VERSION, METRICS_VERSION, encodeCheckpoint, initWorld, presetIdentity, stateHash, type WorldState } from "@bl/schema";
import { observerSettings, restoreObservers, serializeObservers, specConfig, type RunSpec } from "@bl/runner";
import { SIGNALS } from "../lib/bell.ts";
import type { NotesFile, SourceManifest } from "../lib/propose.ts";

export interface SourceOpts {
  experiment?: string;
  presetId?: string;
  condition?: string;
  seed?: number;
  steps?: number;
  censusEvery?: number;
  checkpointEvery?: number;
  /** Extra spec keys (e.g. soloFounder, interventions) to test refusals. */
  extraSpec?: Record<string, unknown>;
  extraManifest?: Record<string, unknown>;
}

/** A finished run's manifest, with a real initHash; checkpoints listed every `checkpointEvery` (their files are not written here). */
export function sourceManifest(o: SourceOpts = {}): SourceManifest {
  const spec = {
    experiment: o.experiment ?? "replay-x",
    presetId: o.presetId ?? "archipelago",
    condition: o.condition ?? "neutral",
    seed: o.seed ?? 1,
    steps: o.steps ?? 50_000,
    censusEvery: o.censusEvery ?? 100,
    deepEvery: 10,
    checkpointEvery: o.checkpointEvery ?? 0,
    lineageObs: true,
    ...(o.extraSpec ?? {}),
  } as RunSpec & Record<string, unknown>;
  const preset = PRESETS.find((p) => p.id === spec.presetId)!;
  const cfg = specConfig(spec);
  const checkpoints = [];
  if (spec.checkpointEvery > 0) for (let t = spec.checkpointEvery; t <= spec.steps; t += spec.checkpointEvery) checkpoints.push({ step: t, file: `checkpoints/t${String(t).padStart(9, "0")}.blck`, hash: `${t.toString(16).padStart(16, "0")}` });
  return {
    runId: `${spec.experiment}/${spec.presetId}/${spec.condition}/seed-${spec.seed}`,
    spec,
    cfg,
    init: preset.init,
    presetIdentity: presetIdentity(preset),
    initHash: stateHash(initWorld(cfg, preset.init)),
    schemaVersion: SCHEMA_VERSION,
    ruleVersion: RULE_VERSION,
    metricsVersion: METRICS_VERSION,
    startStep: 0,
    checkpoints,
    summary: { steps: spec.steps },
    ...(o.extraManifest ?? {}),
  } as SourceManifest;
}

export interface RingOpts {
  signal: string;
  side: "high" | "low";
  /** The receipt window's first census; its end is startStep + 49 · cadence. */
  startStep: number;
  value?: number;
  median?: number;
  minAbsZ?: number;
  spread?: number;
  label?: string;
}

/** A .notes.json for `m`, its rings filed one per entry in the given order; `sizes` are the three files' byte sizes it lists. */
export function notesJson(m: SourceManifest, rings: RingOpts[], o: { falseAlarm?: NotesFile["run"]["falseAlarm"]; zStar?: number; sizes?: { manifest: number; series: number; lineages: number }; mutate?: (n: Record<string, unknown>) => void } = {}): string {
  const cadence = m.spec.censusEvery, zStar = o.zStar ?? 7;
  const sizes = o.sizes ?? { manifest: 1000, series: 2000, lineages: 3000 };
  const id = `${m.spec.experiment}/${m.spec.presetId}/${m.spec.condition}/seed-${m.spec.seed}`;
  const note = (r: RingOpts) => {
    const minAbsZ = r.minAbsZ ?? zStar + 0.5;
    const endStep = r.startStep + 49 * cadence;
    return {
      signal: r.signal,
      label: r.label ?? `Label of ${r.signal}`,
      side: r.side,
      D: minAbsZ,
      receipt: { signal: r.signal, side: r.side, Z: zStar + 1e-12, W: 50, startStep: r.startStep, endStep, minAbsZ, value: r.value ?? 1234, median: r.median ?? 1000 },
      stretches: [{ side: r.side, startStep: r.startStep, endStep: endStep + 10 * cadence, startIdx: r.startStep / cadence - 1, endIdx: endStep / cadence + 9, censuses: 60, minAbsZ, maxAbsZ: minAbsZ + 3, ongoing: false }],
      sentence: "ignored",
      spread: r.spread ?? 12.5,
      picture: [],
    };
  };
  const n: Record<string, unknown> = {
    notebookVersion: 0,
    bellVersion: 0,
    notePath: "docs/naturalist-bell-v0-2026-10-17.md",
    meta: {
      generated: "2026-10-18",
      recordPath: "experiments/naturalist/bell-v0.json",
      recordSha256: "5f90e11f986165bb14b4f1a7d28aed5f58a9575313d8200cb317c4d693fb220c",
      base: "runs",
      sources: [
        { path: `runs/${id}/manifest.json`, bytes: sizes.manifest },
        { path: `runs/${id}/series.jsonl`, bytes: sizes.series },
        { path: `runs/${id}/lineages.tsv`, bytes: sizes.lineages },
      ],
      envelopeSources: [],
    },
    firstPage: {},
    run: {
      id,
      experiment: m.spec.experiment,
      preset: m.spec.presetId,
      condition: m.spec.condition,
      seed: m.spec.seed,
      steps: m.spec.steps,
      censusEvery: cadence,
      censuses: m.spec.steps / cadence,
      presetIdentity: m.presetIdentity,
      inCorpus: false,
      calibration: false,
      leftOut: false,
      falseAlarm: o.falseAlarm ?? null,
      envelopeSize: 40,
      envelopeIds: [],
      zStar,
      W: 50,
      burnInStep: 10_000,
      D: 9,
      recordD: null,
    },
    rings: rings.length,
    entries: rings.map((r) => ({ startStep: r.startStep, notes: [note(r)] })),
    quiet: [],
    timeline: [],
  };
  o.mutate?.(n);
  return JSON.stringify(n, null, 1);
}

/** A series.jsonl of `censuses` records from step `cadence`, each with every bell signal; `bump` changes a record's livingCells. */
export function seriesText(censuses: number, cadence = 100, bump: (step: number) => number = () => 0): string {
  const lines: string[] = [];
  for (let i = 1; i <= censuses; i++) {
    const step = i * cadence;
    const rec: Record<string, unknown> = { step, individuals: 50, meanMass: 900 + (i % 7), livingCells: 1000 + (i % 13) + bump(step), lineages: 1 };
    for (const s of SIGNALS) if (!(s.name in rec) && s.source === "series") rec[s.name] = s.kind === "rate" ? i * 3 : 1 + (i % 5) / 10;
    lines.push(JSON.stringify(rec));
  }
  return lines.join("\n") + "\n";
}

/** A lineages.tsv agreeing with `seriesText` (one lineage holding every living cell). */
export function lineagesText(series: string): string {
  const rows = ["step\tlineage\tcells"];
  for (const l of series.split("\n")) {
    if (!l) continue;
    const r = JSON.parse(l);
    rows.push(`${r.step}\t0:1\t${r.livingCells}`);
  }
  return rows.join("\n") + "\n";
}

/** A decodable checkpoint artifact of `spec`'s start world moved to step `step` (fresh observers), and its stateHash. */
export function checkpointArtifact(spec: RunSpec, step: number): { bytes: Uint8Array; hash: string; state: WorldState } {
  const preset = PRESETS.find((p) => p.id === spec.presetId)!;
  const cfg = specConfig(spec);
  const state = { ...initWorld(cfg, preset.init), step };
  const settings = observerSettings(spec);
  const observer = serializeObservers(restoreObservers(undefined, settings, cfg), step, settings);
  return { bytes: encodeCheckpoint(state, observer), hash: stateHash(state), state };
}
