// The model picker's prompt, schema and bookkeeping (wild sandbox; used by tools/picker-claude.ts). Pure, no Deno API, so
// vitest covers it. The model sees what a person at the file picker sees (`PickRequestJson`, the sheet, the album) and its own
// notebook: never the arm's donors, scores or ranks, which the request does not carry.
import type { PickRequestJson } from "./pickers.ts";

/** What the model answers: one sentence on the whole sheet, and per pick what is new about it. */
export interface ModelAnswer {
  seen: string;
  picks: { pond: number; new: string }[];
}

/** JSON schema for `claude --json-schema`. */
export const SCHEMA = {
  type: "object",
  properties: {
    seen: { type: "string", description: "One sentence on what the whole sheet looks like." },
    picks: {
      type: "array",
      items: {
        type: "object",
        properties: { pond: { type: "integer" }, new: { type: "string", description: "One sentence: what is new about this pond." } },
        required: ["pond", "new"],
      },
    },
  },
  required: ["seen", "picks"],
} as const;

export const SYSTEM_PROMPT =
  "You help choose which ponds of a simulated pond world should seed the next generation. " +
  "You are shown a contact sheet of the ponds as an image, plus a record of what earlier choices looked like. " +
  "Look at the images with the Read tool, then answer in the requested JSON and nothing else.";

/** The ponds a model may name: those able to found a pond, or every occupied one when none is. */
export function poolOf(req: Pick<PickRequestJson, "occupied" | "eligible">): number[] {
  return req.eligible.length ? [...req.eligible] : [...req.occupied];
}

/** How many ponds a model must name: the arm's own donor count, or the whole pool when it is smaller. */
export function wantCount(req: Pick<PickRequestJson, "occupied" | "eligible" | "donors">): number {
  return Math.min(req.donors.max, poolOf(req).length);
}

/** The prompt of one call: the brief, the cycle's facts, the notebook. Never the arm's own suggestion. */
export function buildPrompt(req: PickRequestJson, notebook: string): string {
  const pool = poolOf(req);
  const n = wantCount(req);
  const lines = [
    `You are looking at cycle ${req.cycle} (step ${req.step}) of a simulated pond world: ${req.ponds} ponds in a ${req.grid.x} x ${req.grid.y} grid, shown on one contact sheet.`,
    `Read ${req.sheet} (the sheet: every pond with its index in the top-left corner; brighter means more bound mass; white labels mark ponds able to found a pond, grey ones cannot).`,
    req.album ? `Read ${req.album} first: what this run has already picked, one row per earlier cycle, newest at the bottom.` : "There is no album yet: this is the first cycle.",
    "",
    req.eligible.length
      ? `Eligible ponds (an expected packet mass of at least ${req.foundingMass}, white labels): ${req.eligible.join(", ")}. Occupied but not eligible: ${req.occupied.filter((p) => !req.eligible.includes(p)).join(", ") || "none"}.`
      : `No pond is eligible this cycle (none reaches an expected packet mass of ${req.foundingMass}); choose from the occupied ponds: ${req.occupied.join(", ")}.`,
    `Choose exactly ${n} distinct ponds from ${pool.join(", ")}: the ones that look most unlike anything your notebook and the album show. Give one sentence each on what is new about it.`,
    "In `seen`, say in one sentence what the whole sheet looks like.",
    "",
    "Your notebook so far:",
    notebook.trim() ? notebook.trim() : "(empty: this is your first cycle)",
  ];
  return lines.join("\n");
}

/** Arguments of one lean `claude -p` call; run with cwd = the pick directory and no stdin. */
export function claudeArgs(model: string, prompt: string, maxBudgetUsd: number): string[] {
  return [
    "-p", prompt,
    "--model", model,
    "--restricted", "--permission-mode", "default", "--tools", "Read",
    "--strict-mcp-config", "--setting-sources", "",
    "--system-prompt", SYSTEM_PROMPT,
    "--no-session-persistence",
    "--output-format", "json",
    "--json-schema", JSON.stringify(SCHEMA),
    "--max-budget-usd", String(maxBudgetUsd),
  ];
}

/** What a call returned, parsed. */
export interface ClaudeResult extends ModelAnswer {
  costUsd: number;
  ms: number;
}

/**
 * The answer in `claude -p --output-format json`'s stdout: a single result object (this CLI version) or an array of
 * messages (the older form), of which the one with `type: "result"` counts. Fails on `is_error`; the answer is
 * `structured_output`, else the `result` text parsed as JSON.
 */
export function parseClaudeResult(stdout: string): ClaudeResult {
  let v: unknown;
  try {
    v = JSON.parse(stdout);
  } catch {
    throw new Error(`claude printed no JSON: ${stdout.slice(0, 120)}`);
  }
  const r = (Array.isArray(v) ? v.find((m) => (m as { type?: unknown } | null)?.type === "result") : v) as Record<string, unknown> | undefined;
  if (!r || typeof r !== "object") throw new Error("claude's output has no result message");
  if (r.is_error === true) throw new Error(`claude reported an error: ${String(r.result ?? r.subtype ?? "").slice(0, 200)}`);
  let answer: unknown = r.structured_output;
  if (answer === undefined || answer === null) {
    try {
      answer = JSON.parse(String(r.result));
    } catch {
      throw new Error(`claude's result is not the JSON answer: ${String(r.result).slice(0, 120)}`);
    }
  }
  const a = answer as Partial<ModelAnswer> | null;
  if (!a || typeof a.seen !== "string" || !Array.isArray(a.picks)) throw new Error("claude's answer has no seen and picks");
  const picks = a.picks.map((p) => ({ pond: (p as { pond: number }).pond, new: (p as { new: string }).new }));
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  return { seen: a.seen, picks, costUsd: num(r.total_cost_usd ?? r.cost_usd), ms: num(r.duration_ms) };
}

/** Why `answer` is not acceptable for `req`, or null: integer distinct ponds of the pool, exactly `wantCount` of them, each with a reason. */
export function validateModelAnswer(answer: ModelAnswer, req: Pick<PickRequestJson, "occupied" | "eligible" | "donors">): string | null {
  const pool = poolOf(req);
  const n = wantCount(req);
  const ponds = answer.picks.map((p) => p.pond);
  if (!ponds.every((p) => Number.isInteger(p))) return "a pick is not an integer pond index";
  if (new Set(ponds).size !== ponds.length) return `picks repeat a pond: ${ponds.join(", ")}`;
  const outside = ponds.filter((p) => !pool.includes(p));
  if (outside.length) return `pond ${outside.join(", ")} is not in the pool (${pool.join(", ")})`;
  if (ponds.length !== n) return `${ponds.length} picks, exactly ${n} wanted`;
  if (answer.picks.some((p) => typeof p.new !== "string" || !p.new.trim())) return "a pick has no sentence on what is new";
  if (!answer.seen.trim()) return "no sentence on what the sheet looks like";
  return null;
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** One notebook entry: the cycle, what the sheet looked like, and a line per pick. Ends with a newline. */
export function notebookBlock(cycle: number, step: number, answer: ModelAnswer): string {
  return [`## Cycle ${cycle} (t=${step.toLocaleString("en-US")})`, `Seen: ${oneLine(answer.seen)}`, ...answer.picks.map((p) => `- pond ${p.pond}: ${oneLine(p.new)}`)].join("\n") + "\n";
}

/** The pending block of a notebook entry the run has not yet committed (see tools/picker-claude.ts). */
export interface Pending {
  nonce: string;
  cycle: number;
  /** The donors the block describes, in the answer's order. */
  donors: number[];
  /** The request's `applied`: the file in the pick directory that will hold what the run applied at this boundary. */
  applied: string;
  block: string;
}

/** What the run applied at a boundary (the dir picker's b<NNN>-applied.json), as far as the notebook needs it. */
export interface Committed {
  cycle: number;
  donors: readonly number[];
}

/**
 * The notebook after the call for `cycle`. A pending block is promoted only when the run applied exactly its donors
 * at its cycle (`committed`). Otherwise it is dropped: one of this or a later cycle is stale (a recovery asking
 * again), and one of an earlier cycle with no matching commitment describes a choice the run never applied (a
 * crash before the commit, then a recovery that replayed other donors there).
 */
export function settleNotebook(notebook: string, pending: Pending | undefined, cycle: number, committed?: Committed): string {
  if (!pending || pending.cycle >= cycle) return notebook;
  if (!committed || committed.cycle !== pending.cycle || !Array.isArray(pending.donors) || committed.donors.join() !== pending.donors.join()) return notebook;
  return (notebook.trim() ? notebook.trimEnd() + "\n\n" : "") + pending.block;
}

/** The number of call attempts in a call log (lines with `status: "started"`). */
export function callAttempts(logText: string): number {
  return logText.split("\n").filter((l) => {
    try {
      return (JSON.parse(l) as { status?: unknown }).status === "started";
    } catch {
      return false;
    }
  }).length;
}

/** Why another call must not start, or null: the log already holds `max` attempts. Counts attempts, not successes. */
export function callBudgetError(logText: string, max: number): string | null {
  const n = callAttempts(logText);
  return n >= max ? `the call log holds ${n} attempts, the limit is ${max}` : null;
}
