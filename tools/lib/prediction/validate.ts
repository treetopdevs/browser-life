// The host validator (PLAN.md, section 3). A prediction is accepted only if it is exactly the schema, restates the envelope's one
// frozen task verbatim, and its task converts to operations the existing runner validator accepts. Invalid proposals are counted
// and scored as non-answers; nothing is ever repaired. The sham ({kind:"none"}) is an explicit branch that maps to NO scheduled
// operation (the existing replay control omits the schedule), never to a radius-0 lesion or a zero feed.
import { cellCount, worldW } from "@bl/schema";
import { interventionsError, validateInterventions, type ScheduledIntervention } from "@bl/runner";
import { canonical } from "../propose.ts";
import { CLASSES, ENVELOPE_VERSION, PREDICTION_VERSION, envelopeIntact, type Direction3, type PredictionEnvelope, type Task } from "./envelope.ts";

export interface Probs {
  up: number;
  down: number;
  none: number;
}
export interface Prediction {
  version: number;
  caseId: string;
  envelopeHash: string;
  task: Task;
  probs?: Probs;
  abstain: boolean;
  reason?: string;
}
export interface Validation {
  ok: boolean;
  errors: string[];
}

const PRED_KEYS = ["version", "caseId", "envelopeHash", "task", "probs", "abstain", "reason"];
/**
 * True when `v` is plain JSON data all the way down: plain records and arrays whose every property is an own, enumerable data
 * property (no getters, setters, symbols or hidden non-enumerable fields), so JSON.stringify sees exactly what the validator saw.
 */
function plainData(v: unknown, depth = 0): boolean {
  if (v === null || typeof v === "string" || typeof v === "boolean") return true;
  if (typeof v === "number") return Number.isFinite(v);
  if (depth > 8 || typeof v !== "object") return false;
  const isArr = Array.isArray(v);
  if (!isArr) {
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) return false;
  }
  if (Object.getOwnPropertySymbols(v).length) return false;
  for (const k of Reflect.ownKeys(v)) {
    if (isArr && k === "length") continue;
    const d = Object.getOwnPropertyDescriptor(v, k)!;
    if (!d.enumerable || !("value" in d) || !plainData(d.value, depth + 1)) return false;
  }
  return true;
}
const FORBIDDEN = ["__proto__", "constructor", "prototype"];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** A JSON-compatible record: a plain object (Object.prototype or null prototype), so every field it has is its own and survives JSON.stringify. */
const isPlain = (v: unknown): v is Record<string, unknown> => {
  if (!isObj(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/** The scheduled operations a task asks for: null for the sham, else the list `validateInterventions` takes. Errors name the task, never repair it. */
export function taskSchedule(env: PredictionEnvelope): { schedule: ScheduledIntervention[] | null; errors: string[] } {
  const t = env.task, op = t.op, cfg = env.config, errors: string[] = [];
  const W = worldW(cfg), H = cellCount(cfg) / W;
  const entry = env.menu.ops.find((m) => m.kind === op.kind);
  if (!entry) return { schedule: null, errors: [`operation ${JSON.stringify(op.kind)} is not on the menu`] };
  if (!Number.isSafeInteger(t.delta) || t.delta < env.menu.deltaMin || t.delta > env.menu.deltaMax) errors.push(`delta ${t.delta} is outside the menu's ${env.menu.deltaMin}..${env.menu.deltaMax}`);
  if (!Number.isSafeInteger(t.horizon) || t.horizon < t.delta) errors.push(`horizon ${t.horizon} must be at least delta ${t.delta}`);
  if (op.kind === "none") {
    for (const k of Object.keys(op)) if (k !== "kind") errors.push(`a sham has no key ${JSON.stringify(k)}`);
    return { schedule: null, errors };
  }
  const want = op.kind === "lesion" ? ["kind", "x", "y", "r"] : ["kind", "x", "y", "r", "amount"];
  for (const k of Object.keys(op)) if (!want.includes(k)) errors.push(`a ${op.kind} has no key ${JSON.stringify(k)}`);
  for (const k of want) if (!Object.hasOwn(op, k)) errors.push(`a ${op.kind} needs the key ${JSON.stringify(k)}`);
  if (errors.length) return { schedule: null, errors };
  const { x, y, r } = op as { x: number; y: number; r: number };
  if (!Number.isSafeInteger(r) || r < (entry.rMin ?? 1) || r > (entry.rMax ?? 0)) errors.push(`radius ${r} is outside the menu's ${entry.rMin}..${entry.rMax}`);
  if (!Number.isSafeInteger(x) || x < 0 || x >= W) errors.push(`x ${x} is outside the world`);
  if (!Number.isSafeInteger(y) || y < 0 || y >= H) errors.push(`y ${y} is outside the world`);
  let entryOut: ScheduledIntervention;
  const step = t.forkStep + t.delta;
  if (op.kind === "lesion") entryOut = { step, kind: "lesion", x, y, r };
  else {
    const a = op.amount as number;
    if (!Number.isSafeInteger(a) || a < (entry.amountMin ?? 1) || a > (entry.amountMax ?? 0)) errors.push(`amount ${a} is outside the menu's ${entry.amountMin}..${entry.amountMax}`);
    entryOut = { step, kind: "feed", x, y, r, amount: op.kind === "drain" ? -a : a };
  }
  if (errors.length) return { schedule: null, errors };
  const schedule = [entryOut];
  const bad = validateInterventions(schedule);
  if (bad.length) return { schedule: null, errors: bad };
  const world = interventionsError({ interventions: schedule }, cfg, t.forkStep);
  if (world) return { schedule: null, errors: [world] };
  return { schedule, errors: [] };
}

/** An envelope must itself be sound: right version, intact hash, a task its own menu allows. Builders assert this; the validator trusts only a sound one. */
export function validateEnvelope(env: PredictionEnvelope): Validation {
  const errors: string[] = [];
  if (env.version !== ENVELOPE_VERSION) errors.push(`envelope version ${env.version}`);
  if (!envelopeIntact(env)) errors.push("envelope hash does not match its content");
  errors.push(...taskSchedule(env).errors);
  return { ok: errors.length === 0, errors };
}

export function validatePrediction(input: unknown, env: PredictionEnvelope): Validation {
  const errors: string[] = [];
  if (!isPlain(input)) return { ok: false, errors: ["a prediction must be a plain JSON object (no inherited fields)"] };
  // Every field must be an own, enumerable data property (nothing hidden from JSON.stringify), and the prediction is then judged
  // on its serialized snapshot, not on live objects.
  if (!plainData(input)) return { ok: false, errors: ["a prediction must be plain data: own enumerable data properties only (no getters, hidden or inherited fields, symbols)"] };
  const p = JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
  for (const k of Object.keys(p)) {
    if (FORBIDDEN.includes(k)) errors.push(`forbidden key ${JSON.stringify(k)}`);
    else if (!PRED_KEYS.includes(k)) errors.push(`unknown key ${JSON.stringify(k)}`);
  }
  if (errors.length) return { ok: false, errors };
  // Required fields must be the object's own: an inherited field would validate but serialize as absent.
  for (const k of ["version", "caseId", "envelopeHash", "task", "abstain"]) if (!Object.hasOwn(p, k)) errors.push(`missing own field ${JSON.stringify(k)}`);
  if (errors.length) return { ok: false, errors };
  let stable = false;
  try {
    stable = canonical(input) === canonical(p);
  } catch {
    stable = false;
  }
  if (!stable) return { ok: false, errors: ["the prediction does not survive JSON serialization unchanged"] };
  if (p.version !== PREDICTION_VERSION) errors.push(`version must be ${PREDICTION_VERSION}`);
  if (p.caseId !== env.caseId) errors.push(`caseId ${JSON.stringify(p.caseId)} is not ${JSON.stringify(env.caseId)}`);
  if (p.envelopeHash !== env.envelopeHash) errors.push("envelopeHash does not match the envelope");
  if (!isPlain(p.task)) errors.push("task is missing or not a plain object");
  else {
    let same = false;
    try {
      same = canonical(p.task) === canonical(env.task);
    } catch {
      same = false;
    }
    if (!same) errors.push("task does not restate the envelope's task verbatim (the question is fixed by the host)");
  }
  if (typeof p.abstain !== "boolean") errors.push("abstain must be a boolean");
  if (p.reason !== undefined && typeof p.reason !== "string") errors.push("reason must be a string");
  if (p.abstain === true) {
    if (Object.hasOwn(p, "probs")) errors.push("an abstention carries no probs");
  } else if (p.abstain === false) {
    if (!isPlain(p.probs)) errors.push("probs are required unless abstaining, as a plain object");
    else {
      const pr = p.probs;
      for (const k of Object.keys(pr)) if (!(CLASSES as readonly string[]).includes(k)) errors.push(`probs has unknown key ${JSON.stringify(k)}`);
      let sum = 0;
      for (const c of CLASSES) {
        const v = Object.hasOwn(pr, c) ? pr[c] : undefined;
        if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 1000) errors.push(`probs.${c} must be an integer in 0..1000 (per-mille)`);
        else sum += v as number;
      }
      if (errors.length === 0 && sum !== 1000) errors.push(`probs must sum to exactly 1000, got ${sum}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/** argmax of the stated probs, tie order none > down > up (derived, never submitted). */
export function argmax(p: Probs): Direction3 {
  let best: Direction3 = "none";
  for (const c of ["none", "down", "up"] as const) if (p[c] > p[best]) best = c;
  return best;
}

export interface FileCheck {
  /** caseId -> prediction-or-null (null: invalid, or no valid line). */
  byCase: Map<string, { prediction: Prediction | null; errors: string[] }>;
  invalid: number;
  missing: string[];
  extra: string[];
  duplicates: string[];
  notObject: number;
  /** Envelopes that fail validateEnvelope (version, recomputed hash, task on its own menu): their cases cannot be answered validly. */
  badEnvelopes: string[];
}

/** File-level validation: exactly one line per case. Extras, duplicates and missing cases are counted; a duplicated case scores as invalid. */
export function validatePredictionFile(lines: string[], envelopes: readonly PredictionEnvelope[]): FileCheck {
  const byEnv = new Map(envelopes.map((e) => [e.caseId, e]));
  const out: FileCheck = { byCase: new Map(), invalid: 0, missing: [], extra: [], duplicates: [], notObject: 0, badEnvelopes: [] };
  const unsound = new Map<string, string[]>();
  for (const e of envelopes) {
    const v = validateEnvelope(e);
    if (!v.ok) {
      unsound.set(e.caseId, v.errors);
      out.badEnvelopes.push(e.caseId);
    }
  }
  const seen = new Set<string>();
  for (const line of lines) {
    if (line.trim() === "") continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      out.notObject++;
      out.invalid++;
      continue;
    }
    if (!isPlain(raw)) {
      out.notObject++;
      out.invalid++;
      continue;
    }
    const id = typeof raw.caseId === "string" ? raw.caseId : "";
    const env = byEnv.get(id);
    if (!env) {
      out.extra.push(id);
      out.invalid++;
      continue;
    }
    if (seen.has(id)) {
      out.duplicates.push(id);
      out.byCase.set(id, { prediction: null, errors: ["duplicate line for this case"] });
      out.invalid++;
      continue;
    }
    seen.add(id);
    const v = unsound.has(id) ? { ok: false, errors: ["the envelope is unsound: " + unsound.get(id)!.join("; ")] } : validatePrediction(raw, env);
    if (!v.ok) out.invalid++;
    out.byCase.set(id, { prediction: v.ok ? (raw as unknown as Prediction) : null, errors: v.errors });
  }
  for (const e of envelopes) if (!seen.has(e.caseId)) out.missing.push(e.caseId);
  return out;
}
