// The model seam (PLAN.md, section 4): a typed adapter interface for a future model proposer, with no implementation, no network
// import and nothing registered. Raw model output is routed through the host validator and is never repaired. Unrun in this slice.
import type { PredictionEnvelope } from "./envelope.ts";
import { validatePrediction, type Prediction, type Validation } from "./validate.ts";

export interface ModelContext {
  /** A stable label for the run (model name, prompt version); recorded in meta, never scored. */
  runLabel: string;
}
export interface ModelProposerAdapter {
  id: string;
  /** Returns the raw output: a JSON string or an object. It must be derived from the envelope only. */
  propose(env: PredictionEnvelope, ctx: ModelContext): Promise<unknown>;
}

/** Adapters registered for a run. Empty by design: this slice runs no model. */
export const REGISTERED_ADAPTERS: readonly ModelProposerAdapter[] = Object.freeze([]);

export interface Adapted {
  prediction: Prediction | null;
  validation: Validation;
}

/** Raw output (a JSON string or an object) through the validator. An invalid output yields no prediction and its errors. */
export function adaptModelOutput(raw: unknown, env: PredictionEnvelope): Adapted {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return { prediction: null, validation: { ok: false, errors: ["output is not JSON"] } };
    }
  }
  const validation = validatePrediction(value, env);
  return { prediction: validation.ok ? (value as Prediction) : null, validation };
}
