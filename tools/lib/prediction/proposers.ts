// Deterministic baseline proposers (PLAN.md, section 4). A proposer takes only an envelope and returns a prediction (never
// outcomes, never another case's task). Constants are frozen in protocol.json and passed in; nothing here reads a file or a clock.
import { RULES, type Prediction as RulesPrediction } from "../propose.ts";
import { PREDICTION_VERSION, taskKey, type CensusPoint, type Direction3, type PredictionEnvelope } from "./envelope.ts";
import { donorAllowed, type Split } from "./splits.ts";
import type { Prediction, Probs } from "./validate.ts";

export interface Proposer {
  id: string;
  /** baseline: a rule a model has to beat; control: a deliberately uninformed run; oracle: knows the mechanism, a dev diagnostic only. */
  role: "baseline" | "control" | "oracle";
  propose(env: PredictionEnvelope): Prediction;
}

export interface ProposerParams {
  fixedRule: { lead: number };
  numericTrend: { window: number; minRelPerMille: number; lead: number; mid: number; low: number };
  v0Rules: { lead: number };
  mechanismRule: { lead: number; lowDoseQuanta: number; scarceNutrient: number };
}

export function predictionOf(env: PredictionEnvelope, probs: Probs | null, reason: string): Prediction {
  const base = { version: PREDICTION_VERSION, caseId: env.caseId, envelopeHash: env.envelopeHash, task: env.task, reason };
  return probs ? { ...base, probs, abstain: false } : { ...base, abstain: true };
}

/** `lead` per-mille on `dir`, the rest split evenly between the other two (the first, in order up/down/none, takes any odd remainder). */
export function leadProbs(dir: Direction3, lead: number): Probs {
  const rest = 1000 - lead;
  const half = Math.floor(rest / 2);
  const out: Probs = { up: 0, down: 0, none: 0 };
  const others = (["up", "down", "none"] as const).filter((c) => c !== dir);
  out[dir] = lead;
  out[others[0]] = rest - half;
  out[others[1]] = half;
  return out;
}

/** Largest-remainder rounding of non-negative weights to per-mille summing to exactly 1000. */
export function toPerMille(w: Record<Direction3, number>): Probs {
  const tot = w.up + w.down + w.none;
  if (!(tot > 0)) throw new Error("weights must have a positive sum");
  const cls = ["up", "down", "none"] as const;
  const raw = cls.map((c) => (w[c] * 1000) / tot);
  const fl = raw.map(Math.floor);
  let left = 1000 - fl.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, f: r - fl[i] })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (const o of order) {
    if (left <= 0) break;
    fl[o.i]++;
    left--;
  }
  return { up: fl[0], down: fl[1], none: fl[2] };
}

export const fixedRule = (k: ProposerParams["fixedRule"]): Proposer => ({
  id: "fixedRule",
  role: "baseline",
  propose(env) {
    const kind = env.task.op.kind;
    const dir: Direction3 = kind === "feed" ? "up" : kind === "lesion" || kind === "drain" ? "down" : "none";
    return predictionOf(env, leadProbs(dir, k.lead), `fixed rule: ${kind} -> ${dir}`);
  },
});

/** The census-only trend: slope of the primary readout over the last `window` samples, extrapolated over the horizon, as a share of the current level. Ignores frames and the task. */
export function trendDirection(census: readonly CensusPoint[], horizon: number, k: ProposerParams["numericTrend"]): Direction3 {
  if (census.length < k.window + 1) return "none";
  const last = census[census.length - 1], first = census[census.length - 1 - k.window];
  const span = last.step - first.step;
  if (span <= 0) return "none";
  // change over the horizon, per-mille of the current level, in integer arithmetic.
  const delta = (last.mass - first.mass) * horizon * 1000;
  const bar = k.minRelPerMille * Math.max(last.mass, 1) * span;
  return delta >= bar ? "up" : delta <= -bar ? "down" : "none";
}
function trendProbs(dir: Direction3, k: ProposerParams["numericTrend"]): Probs {
  if (dir === "none") return { up: k.low, down: k.low, none: 1000 - 2 * k.low };
  const other: Direction3 = dir === "up" ? "down" : "up";
  const out: Probs = { up: 0, down: 0, none: k.mid };
  out[dir] = k.lead;
  out[other] = 1000 - k.lead - k.mid;
  return out;
}
export const numericTrend = (k: ProposerParams["numericTrend"]): Proposer => ({
  id: "numericTrend",
  role: "baseline",
  propose(env) {
    const d = trendDirection(env.census, env.task.horizon, k);
    return predictionOf(env, trendProbs(d, k), `census trend -> ${d}`);
  },
});

/**
 * The shuffled-evidence control: the numeric-trend rule run on a donor family's census. The donor is assigned by the frozen
 * derangement; a donor from the same family, the same history (a later window of it) or another split is refused (throws), so a
 * control can never be handed the case's own future.
 */
export function shuffledEvidence(
  k: ProposerParams["numericTrend"],
  donors: Readonly<Record<string, string>>,
  envelopeOf: (familyId: string) => PredictionEnvelope | undefined,
  splitOf: (familyId: string) => Split | undefined,
): Proposer {
  return {
    id: "shuffledEvidence",
    role: "control",
    propose(env) {
      const donorFamily = donors[env.familyId];
      const donor = donorFamily === undefined ? undefined : envelopeOf(donorFamily);
      if (!donor) throw new Error(`no donor envelope for family ${env.familyId}`);
      const ok = donorAllowed(env, donor, splitOf);
      if (!ok.ok) throw new Error(`donor refused for ${env.caseId}: ${ok.reason}`);
      const d = trendDirection(donor.census, env.task.horizon, k);
      return predictionOf(env, trendProbs(d, k), `donor census trend -> ${d}`);
    },
  };
}

export const priorMajority = (devPrior: Probs): Proposer => ({
  id: "priorMajority",
  role: "baseline",
  propose: (env) => predictionOf(env, { ...devPrior }, "dev-split class frequencies"),
});
export const alwaysNone = (): Proposer => ({ id: "alwaysNone", role: "baseline", propose: (env) => predictionOf(env, { up: 0, down: 0, none: 1000 }, "always none") });
export const abstainAll = (): Proposer => ({ id: "abstainAll", role: "baseline", propose: (env) => predictionOf(env, null, "abstains on every case") });

/** The v0 rule proposer's directional/replay prediction mapped into the schema: 600 on the stated direction, the remainder on none (explicit, versioned). */
export const RULES_MAP_VERSION = 1;
export function fromRulesProposal(env: PredictionEnvelope, pred: RulesPrediction, lead: number): Prediction {
  const probs: Probs = pred.kind === "directional" && pred.direction ? { up: 0, down: 0, none: 1000 - lead, [pred.direction]: lead } as Probs : { up: 0, down: 0, none: 1000 };
  return predictionOf(env, probs, `rules-v0 (map v${RULES_MAP_VERSION}): ${pred.kind}${pred.direction ? " " + pred.direction : ""}`);
}
export const v0Rules = (k: ProposerParams["v0Rules"]): Proposer => ({
  id: "v0Rules",
  role: "baseline",
  propose(env) {
    // The v0 rule table (tools/lib/propose.ts RULES): feed and drain rows from the nutrient-held signals, lesion from the standing-body signals, control otherwise.
    const kind = env.task.op.kind;
    const row = kind === "feed" ? RULES.livingCells.low : kind === "drain" ? RULES.livingCells.high : kind === "lesion" ? RULES.lineages.high : RULES.lineages.low;
    const pred: RulesPrediction = row.action === "control" ? { kind: "replay", statement: "replays" } : { kind: "directional", statement: `${row.action}`, direction: row.direction };
    return fromRulesProposal(env, pred, k.lead);
  },
});

/** Positive control, a dev diagnostic only: knows the fixture mechanisms (lesion centre occupancy from the frames, dose against the nutrient in the field). Never a baseline to beat. */
export const mechanismRule = (k: ProposerParams["mechanismRule"]): Proposer => ({
  id: "mechanismRule",
  role: "oracle",
  propose(env) {
    const op = env.task.op;
    const last = env.frames[env.frames.length - 1];
    const cen = env.census[env.census.length - 1];
    const block = (x: number, y: number): number => {
      const w = env.config.tileW * env.config.tilesX;
      const bs = Math.floor(w / last.side);
      return last.mass[Math.floor(y / bs) * last.side + Math.floor(x / bs)];
    };
    let dir: Direction3 = "none";
    if (op.kind === "lesion") dir = block(op.x!, op.y!) > 0 ? "down" : "none";
    else if (op.kind === "feed") dir = (op.r! * op.r! * 3 * op.amount!) >= k.lowDoseQuanta ? "up" : "none";
    else if (op.kind === "drain") dir = cen.freeNutrient >= k.scarceNutrient ? "down" : "none";
    return predictionOf(env, leadProbs(dir, k.lead), `mechanism: ${op.kind} -> ${dir}`);
  },
});

export const caseKey = (env: PredictionEnvelope): string => taskKey(env.task);
