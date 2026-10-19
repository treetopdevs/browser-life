// The proposer's suggestion beside a Field note (docs/naturalist-lab-suggestions-v0-2026-10-18.md). Pure, no DOM: one note in, the
// run spec the experiment proposer's fixed rules give for it, the offline commands that would run it, and the words the panel shows.
// Every rule is the proposer's, by import from tools/lib/propose.ts (the 26-row table, the jar disc, the dose, the prediction, the
// validators, the argv); nothing of it is copied here. The panel loads this module lazily (it brings @bl/runner with it), and nothing
// here applies anything: the model's `tryHere` does that, on a person's click only.
import { PRESETS, presetIdentity, type WorldConfig } from "@bl/schema";
import { specConfig, type RunSpec, type ScheduledIntervention } from "@bl/runner";
import { FORK_EXPERIMENT, HYPOTHESIS, RULES_V0, buildForkSpec, feedAmount, interventionWords, jarShare, predictionFor, ruleFor, rulesInterventions, runArgv, specHash, validateProposalSpec, type Action, type Prediction, type RuleRow, type SourceManifest } from "../../../tools/lib/propose.ts";
import { fmtValue, fmtZ, group, textOf } from "../../../tools/lib/notebook.ts";
import type { EnvelopeHeader, LiveRing } from "./naturalist-score.ts";
import { noteKey } from "./naturalist.ts";

/** The world a note was filed on: what a suggestion needs of it (and the generation and run id it belongs to). */
export interface SuggestWorld {
  gen: number;
  runId: string;
  presetId: string;
  seed: number;
  cfg: WorldConfig;
  neutral: boolean;
}

/** One tools/run.ts command: the spec, its argv as the proposer builds it (no --out), the --out it is shown with, and the line. */
export interface RunCommand {
  spec: RunSpec;
  argv: string[];
  out: string;
  /** The bundle directory tools/run.ts writes under --out: <out>/<experiment>/<preset>/<condition>/seed-<n>. */
  bundle: string;
  line: string;
}

export interface Suggestion {
  /** The note's key (noteKey): generation, run id, signal, side, receipt end step. */
  key: string;
  gen: number;
  runId: string;
  signal: string;
  side: "high" | "low";
  label: string;
  row: RuleRow;
  action: Action;
  /** S: the receipt's last census, the first at which the bell could have rung. */
  S: number;
  /** The rule's interventions at S (the jar disc; one entry on a one-tile world; none for a replay control). */
  entries: ScheduledIntervention[];
  /** What, where, when and how much, in words: facts of the spec. */
  facts: string;
  /** The dose in the proposer's words (`interventionWords`), or null for a replay control. */
  dose: string | null;
  /** The button's words, naming the dose; null when there is nothing to apply (a replay control). */
  tryLabel: string | null;
  hypothesis: string;
  /** The lab's reason: cites only the note's receipt, the panel's threshold, S and the dose numbers. */
  reason: string;
  prediction: Prediction;
  source: RunCommand;
  fork: RunCommand;
  /**
   * The proposer's path: a source as long as the bell corpus's runs (tools/notebook.ts reads no other length), then notebook →
   * propose → approve → run on its bundle.
   */
  proposerSource: RunCommand;
  proposerCommands: string[];
  notesFile: string;
  /** Whether the offline proposer would file this note at all (it rings at bell v0's Z*, over thirteen signals). */
  proposerCaveat: string;
  /** What has and has not been checked about running this world offline. */
  caveats: string[];
  /** The first validator that refuses the source or the fork, or null. */
  refused: string | null;
  /** The fork spec's SHA-256 (the proposer's specHash): two notes with one run say so. */
  specHash: string;
}

/**
 * Bell v0's calibrated Z* per preset, the threshold tools/notebook.ts rings at (experiments/naturalist/bell-v0.json,
 * summary.secondary.perPreset[preset].zStar; apps/lab/test/naturalist-suggest.test.ts checks these against the record). Only the
 * caveat below reads them.
 */
export const NOTEBOOK_ZSTAR: Readonly<Record<string, number>> = Object.freeze({ "gradient-m3": 7.0429124518134785, "spots-m3": 11.4665 });
/**
 * The bell corpus's run length for both presets (experiments/naturalist/bell-v0.json, corpus[].steps; tested): tools/notebook.ts
 * holds a bundle to the corpus's steps and cadence (checkGroupIdentity), so the proposer's path needs a source this long.
 */
export const NOTEBOOK_STEPS = 1_000_000;

/** What has been compared of each preset's lab world with a run bundle (docs/naturalist-field-notes-v0-2026-10-18.md). */
const PARITY: Readonly<Record<string, string>> = {
  "gradient-m3":
    "One lab world of this preset (seed 1, to step 16,000, on Chrome) was compared with its tools/run.ts bundle and matched it census for census on every field the naturalist reads. This world has not been compared.",
  "spots-m3": "No lab world of this preset has been compared with a tools/run.ts bundle, so whether the offline run replays this world census for census is not checked.",
};

const NUMBER_WORDS: Record<number, string> = { 2: "two", 3: "three", 4: "four", 5: "five", 6: "six" };
const presetName = (id: string) => PRESETS.find((p) => p.id === id)?.name ?? id;

/**
 * The source the commands replay: the proposer's own replay-control spec for this world (experiment naturalist-fork, the world's
 * preset, condition and seed, S + H steps, census every 100, deep census every 10, no checkpoints, no threshold, no overrides), as a
 * minimal SourceManifest, so `buildForkSpec(m, 0, S, H, …)` and `validateProposalSpec(…, 0, m)` run on it unchanged.
 */
export function labSource(world: SuggestWorld, S: number, steps = S + RULES_V0.horizon): SourceManifest {
  const preset = PRESETS.find((p) => p.id === world.presetId);
  if (!preset) throw new Error(`unknown preset ${world.presetId}`);
  const spec: RunSpec = { experiment: FORK_EXPERIMENT, presetId: world.presetId, condition: world.neutral ? "neutral" : "treatment", seed: world.seed, steps, censusEvery: 100, deepEvery: 10, checkpointEvery: 0 };
  return { spec: spec as SourceManifest["spec"], cfg: specConfig(spec), presetIdentity: presetIdentity(preset) };
}

const bundleOf = (out: string, s: RunSpec) => `${out}/${s.experiment}/${s.presetId}/${s.condition}/seed-${s.seed}`;
const command = (spec: RunSpec, out: string): RunCommand => {
  const argv = runArgv(spec, { step: 0, dir: "" });
  return { spec, argv, out, bundle: bundleOf(out, spec), line: [...argv, "--out", out].join(" ") };
};

const ACTION_WORD: Record<Action, string> = { feed: "Feed", drain: "Drain", lesion: "Wound", control: "Replay control" };

/** The threshold as the panel words it, against the median. */
function beyond(h: EnvelopeHeader, side: "high" | "low"): string {
  const dir = side === "high" ? "above" : "below";
  return h.threshold.strict ? `more than Z* = ${h.threshold.Z} spreads ${dir} the neutral median` : `at least ${NUMBER_WORDS[h.threshold.Z] ?? group(h.threshold.Z)} spreads ${dir} the neutral median`;
}

/** The proposer's suggestion for one filed note. Never throws for a note: a spec the validators refuse is a suggestion saying why. */
export function suggestFor(ring: LiveRing, world: SuggestWorld, h: EnvelopeHeader): Suggestion {
  const rc = ring.receipt;
  const S = rc.endStep;
  const label = textOf(ring.signal).label;
  const row = ruleFor(ring.signal, ring.side);
  const m = labSource(world, S);
  const cfg = m.cfg;
  const A = feedAmount(world.presetId);
  let refused: string | null = null;
  let entries: ScheduledIntervention[] = [];
  try {
    entries = rulesInterventions(row, cfg, S, A);
  } catch (e) {
    refused = (e as Error).message;
  }
  const sourceSpec = buildForkSpec(m, 0, S, RULES_V0.horizon, []);
  const forkSpec = buildForkSpec(m, 0, S, RULES_V0.horizon, entries);
  refused ??= validateProposalSpec(sourceSpec, 0, m) ?? validateProposalSpec(forkSpec, 0, m);
  const cond = sourceSpec.condition;
  const base = `naturalist-lab/${world.presetId}-${cond}-seed-${world.seed}-t${S}`;
  const source = command(sourceSpec, `${base}/source`);
  const fork = command(forkSpec, row.action === "control" ? `${base}/replay` : `${base}/fork-${row.action}`);
  const long = labSource(world, S, NOTEBOOK_STEPS);
  const proposerSource = command(long.spec, `${base}/long-source`);
  refused ??= validateProposalSpec(long.spec, 0, long);
  const notesDir = `${base}/notes`;
  const notesFile = `${FORK_EXPERIMENT}-${world.presetId}-${cond}-seed-${world.seed}.notes.json`;
  const proposals = `${base}/proposals`;
  const proposerCommands = [
    `deno run -A tools/notebook.ts ${proposerSource.bundle} --out ${notesDir}`,
    `deno run -A tools/propose.ts propose ${proposerSource.bundle} --notes ${notesDir}/${notesFile} --out ${proposals}`,
    `deno run -A tools/propose.ts approve ${proposals}/<id>.proposal.json --by "<your name>"`,
    `deno run -A tools/propose.ts run ${proposals}/<id>.proposal.json --out ${base}/forks`,
  ];

  // The proposer forks with a lesion or a feed (never a sun), so the first entry has a place.
  const e0 = entries[0];
  const e = e0 && e0.kind !== "sun" ? e0 : undefined;
  const share = jarShare(cfg);
  const tiles = cfg.tilesX * cfg.tilesY;
  const place = e ? `${tiles === 1 ? `centred at (${e.x}, ${e.y})` : `centred on each of the world's ${tiles} tiles`}, radius ${e.r}, about ${share}% of the world's cells` : "";
  const when = `at step ${group(S)}, the receipt's last census`;
  const facts =
    row.action === "control"
      ? `Replay control: no intervention. A second run of this world from step 0 to step ${group(sourceSpec.steps)}, checked against the first.`
      : row.action === "lesion"
        ? `Wound ${when}: a disc ${place}.`
        : `${ACTION_WORD[row.action]} ${when}: ${row.action === "feed" ? `${A} quanta of nutrient added to` : `up to ${A} quanta of nutrient removed from`} every cell of a disc ${place}.`;
  const dose = row.action === "control" ? null : interventionWords(row.action, cfg, A);
  const tryLabel =
    row.action === "control" || !e ? null : row.action === "lesion" ? `Try it here: wound radius ${e.r} at (${e.x}, ${e.y})` : `Try it here: ${row.action} ${row.action === "feed" ? "" : "up to "}${A} quanta per cell, radius ${e.r}, at (${e.x}, ${e.y})`;

  const dir = ring.side === "high" ? "above" : "below";
  const opener = world.neutral ? "This world is neutral, like the baseline's runs, so this note is a false alarm by definition. " : "";
  const receipt = `The note's receipt: ${label.toLowerCase()} was ${fmtValue(ring.signal, rc.value)} at step ${group(rc.startStep)}, against a neutral median there of ${fmtValue(ring.signal, rc.median)}, and every census from step ${group(rc.startStep)} to step ${group(rc.endStep)} was ${beyond(h, ring.side)}, the weakest ${fmtZ(rc.minAbsZ)} spreads ${dir} it.`;
  const why =
    row.action === "control"
      ? ` The proposer's rule for ${label.toLowerCase()} ${ring.side} is the replay control: no intervention in its vocabulary probes this departure without a place to aim at, and nothing records where it is concentrated. So the suggestion is a run alone, replaying this world from step 0, which tests only that the receipt replays.`
      : ` The proposer's rule for ${label.toLowerCase()} ${ring.side} is ${row.action === "lesion" ? "a wound" : `a ${row.action}`}, on the hypothesis that ${HYPOTHESIS[row.action]}. So the fork replays this world from step 0 to step ${group(S)}, the receipt's last census, and then ${dose}.`;

  const z = NOTEBOOK_ZSTAR[world.presetId];
  const name = presetName(world.presetId);
  const proposerCaveat =
    h.rule === "bell-v1-A"
      ? `This path may not file this note. tools/notebook.ts rings at bell v0's calibrated Z* for ${name}, ${fmtZ(z)}, strictly, over all thirteen signals; this panel rings at bell v1 part A's rule, at least four spreads, over its ${group(h.signals.length)} signals. ${ring.D > z ? `When this suggestion was made, ${label.toLowerCase()} ${ring.side} had a window of ${group(h.W)} censuses whose weakest |z| was ${fmtZ(ring.D)}, beyond ${fmtZ(z)}, but the notebook's first window beyond it may begin elsewhere, so its proposal, if any, may not be this one.` : `When this suggestion was made, no window of ${group(h.W)} censuses of ${label.toLowerCase()} ${ring.side} had gone beyond ${fmtZ(z)} (the strongest's weakest |z| was ${fmtZ(ring.D)}), so unless it goes further later, the notebook may file no note for it, and propose then makes no proposal for it (it may make others, for rings it does file).`}`
      : `For ${name} the notebook rings at this panel's own rule and baseline (bell v0's Z* = ${h.threshold.Z}, over all thirteen signals), so it files this note if the offline run replays this world.`;
  const caveats = [
    PARITY[world.presetId] ?? "No lab world of this preset has been compared with a tools/run.ts bundle.",
    "The lab takes a deep census at every 5th census and these commands at every 10th; neither enters the signals the naturalist reads.",
    `S is the receipt's last census, where the stretch first stayed beyond the panel's threshold for ${group(h.W)} censuses, not where it went furthest: a departure that deepens later is forked before its strongest stretch.`,
    `The jar disc covers about ${share}% of the world's cells, so this probe is coarse${row.action === "lesion" ? " (a wound this size is close to a wipe of the whole jar)" : ""}, and a prediction that holds is weak evidence on its own.`,
  ];

  return {
    key: noteKey(world.gen, world.runId, ring),
    gen: world.gen,
    runId: world.runId,
    signal: ring.signal,
    side: ring.side,
    label,
    row,
    action: row.action,
    S,
    entries,
    facts,
    dose,
    tryLabel,
    hypothesis: HYPOTHESIS[row.action],
    reason: opener + receipt + why,
    prediction: predictionFor({ signal: ring.signal, label, spread: ring.spread }, row, forkSpec, 0, RULES_V0),
    source,
    fork,
    proposerSource,
    proposerCommands,
    notesFile,
    proposerCaveat,
    caveats,
    refused,
    specHash: specHash(forkSpec),
  };
}
