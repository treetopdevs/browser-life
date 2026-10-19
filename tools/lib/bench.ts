// The proposer bench, v0 (docs/naturalist-bench-v0-2026-10-18.md, section "Fixed before code"; that section is frozen and this
// file implements it). The brainstorm's test for shape 3: do the proposer's rule-based proposals (tools/lib/propose.ts) beat a
// random fork at producing a departure, scored by bell v1's pair scorer? Pure functions only: the plan (one rules proposal per
// source by a fixed rule, three count-matched random forks and three footprint-matched ones, the "dose" role; amendment 1), the manifest and its yes gate, the dry-run
// lines, and the readout (the paired sign test). tools/lib/bench-fs.ts does the I/O and tools/bench.ts is the CLI. Nothing here
// calls a model, touches a file or runs anything.
//
// A manifest file is { manifestSha256, status, approval?, body }. Its identity is the SHA-256 of the body's canonical JSON (the
// proposer's `canonical`: keys sorted at every depth); `approval.manifestSha256` binds one person's yes, for the whole batch, to
// that exact body. `status` and `approval` are outside the hash.
import { METRICS_VERSION, RULE_VERSION, SCHEMA_VERSION, cellCount, sha256HexJS, worldW, type WorldConfig } from "@bl/schema";
import { specConfig, type RunSpec, type ScheduledIntervention } from "@bl/runner";
import { mulberry32 } from "@bl/metrics";
import { BELL_VERSION, SIGNALS } from "./bell.ts";
import { BELL1_VERSION, EARLY_FROM, EARLY_TO, W_PAIR, voidReasons, type PairResult } from "./bell1.ts";
import { NOTEBOOK_VERSION } from "./notebook.ts";
import {
  PROPOSAL_VERSION,
  RULES_V0,
  canonical,
  canonicalOrder,
  isPersonName,
  randomBaseline,
  runArgv,
  specHash,
  validateProposal,
  validateProposalSpec,
  type ForkCheck,
  type Prediction,
  type Proposal,
  type ProposalBody,
  type ProposeResult,
  type SourceManifest,
} from "./propose.ts";

export const BENCH_VERSION = 0;
export const BENCH_NOTE = "docs/naturalist-bench-v0-2026-10-18.md";
/** The date the notes files are written with (tools/notebook.ts --date), so they are byte-reproducible. */
export const NOTES_DATE = "2026-10-18";

/** Which bundles are the sources: <base>/<experiment>/<presetId>/<condition>/seed-<n> for n = 1..pairs (the note, "Sources"). */
export interface Selection {
  experiment: string;
  presetId: string;
  condition: string;
}
export interface BenchConstants {
  /** Draws per baseline role, per proposal. */
  K: number;
  countSeeds: readonly number[];
  doseSeeds: readonly number[];
  /** Pairs (sources) the bars were set for; a manifest records its own `pairs`, and a comparison is called only at this count. */
  pairs: number;
  /** Rules beat a baseline at >= winsToBeat wins of `pairs`; a baseline beats the rules at >= winsToBeat losses. */
  winsToBeat: number;
  /** Bell v1 part B's Z*_pair (experiments/naturalist/bell-v1-twins.json, summary.zStarPair.value): descriptive only here. */
  zStarPair: number;
  /** H, the proposer's horizon after S. */
  horizon: number;
  /** Bell v1's pair-score windows (W_PAIR censuses, first census from anchor + earlyFrom to anchor + earlyTo). */
  wPair: number;
  earlyFrom: number;
  earlyTo: number;
  selection: Selection;
}
/** The note's values. Tests may pass others (a smaller `pairs`, another selection). */
export const BENCH_V0: Readonly<BenchConstants> = Object.freeze({
  K: 3,
  countSeeds: Object.freeze([1, 2, 3]),
  doseSeeds: Object.freeze([1, 2, 3]),
  pairs: 10,
  winsToBeat: 9,
  zStarPair: 5.702557876989047,
  horizon: RULES_V0.horizon,
  wPair: W_PAIR,
  earlyFrom: EARLY_FROM,
  earlyTo: EARLY_TO,
  selection: Object.freeze({ experiment: "replay-m4", presetId: "gradient-m3", condition: "treatment" }),
});

/** The versions a plan is made under; `run` refuses a manifest whose recorded versions are not this checkout's. */
export function currentVersions(): BenchVersions {
  return { rule: RULE_VERSION, schema: SCHEMA_VERSION, metrics: METRICS_VERSION, proposal: PROPOSAL_VERSION, notebook: NOTEBOOK_VERSION, bell: BELL_VERSION, bell1: BELL1_VERSION, bench: BENCH_VERSION };
}
export interface BenchVersions {
  rule: number;
  schema: number;
  metrics: number;
  proposal: number;
  notebook: number;
  bell: number;
  bell1: number;
  bench: number;
}

const enc = new TextEncoder();
const sha = (text: string): string => sha256HexJS(enc.encode(text));

// ---------------------------------------------------------------------------------------------
// Paths (POSIX joins by hand: the core stays free of node:path, and every recorded path is absolute).

const joinPath = (...parts: string[]) => parts.join("/").replace(/\/{2,}/g, "/");
export const sourceDirOf = (base: string, sel: Selection, seed: number) => joinPath(base, sel.experiment, sel.presetId, sel.condition, `seed-${seed}`);
/** tools/notebook.ts's notes file name for a bundle. */
export const notesNameOf = (sel: Selection, seed: number) => `${sel.experiment}-${sel.presetId}-${sel.condition}-seed-${seed}.notes.json`;
export const seedsOf = (pairs: number): number[] => Array.from({ length: pairs }, (_, i) => i + 1);
/** The one command that writes the notes files (the note, "The notes files"), expanded. */
export function notesCommand(base: string, notesDir: string, sel: Selection, pairs: number): string {
  return ["deno run -A tools/notebook.ts", ...seedsOf(pairs).map((s) => sourceDirOf(base, sel, s)), "--base", base, "--out", notesDir, "--date", NOTES_DATE].join(" ");
}

// ---------------------------------------------------------------------------------------------
// The footprint-matched ("dose") fork (the note, "dose-v0"; amendment 1: it matches footprint, timing and requested amount, not delivered matter).

/** The first 32 bits of SHA-256("dose-v0:<seed>:<the proposal's spec SHA-256>"): a stream no random-v0 draw shares (its input has no prefix). */
export const doseSeed = (seed: number, specSha256: string): number => parseInt(sha(`dose-v0:${seed}:${specSha256}`).slice(0, 8), 16) >>> 0;

/**
 * One draw per rules entry, in order: the entry's step and radius; a kind uniform over lesion, feed and drain (lesion only when A is
 * null); a feed of +A or a drain of -A; a centre uniform over the world's cells. Then tools/run.ts's merge order (`canonicalOrder`).
 */
export function drawDose(seed: number, specSha256: string, entries: readonly ScheduledIntervention[], cfg: WorldConfig, A: number | null): ScheduledIntervention[] {
  const W = worldW(cfg), cells = cellCount(cfg);
  const rnd = mulberry32(doseSeed(seed, specSha256));
  const int = (m: number) => Math.min(m - 1, Math.floor(rnd() * m));
  const kinds = A === null ? (["lesion"] as const) : (["lesion", "feed", "drain"] as const);
  const drawn: ScheduledIntervention[] = [];
  for (const e of entries) {
    // A proposal forks with lesions and feeds only (tools/lib/propose.ts refuses a sun), so its rules hold no sun.
    if (e.kind === "sun") throw new Error(`a dose fork draws from lesion and feed entries, not a sun (t=${e.step})`);
    const kind = kinds[int(kinds.length)];
    const cell = int(cells);
    const x = cell % W, y = Math.floor(cell / W);
    drawn.push(kind === "lesion" ? { step: e.step, kind: "lesion", x, y, r: e.r } : { step: e.step, kind: "feed", x, y, r: e.r, amount: kind === "feed" ? A! : -A! });
  }
  return canonicalOrder(drawn);
}

/** The dose fork's spec for a rules proposal and seed: its spec with the drawn entries, checked as a proposal's is. Throws on a failure. */
export function doseSpec(p: Proposal, seed: number, m?: SourceManifest): RunSpec {
  const b = p.body;
  if (b.generator !== "rules-v0") throw new Error(`a dose fork matches a rules proposal, not a ${b.generator} one`);
  const list = b.spec.interventions ?? [];
  if (!list.length) throw new Error(`proposal ${p.id} is a replay control; a dose fork has nothing to match`);
  const cfg = specConfig(b.spec);
  const spec: RunSpec = { ...b.spec, interventions: drawDose(seed, specHash(b.spec), list, cfg, b.constants.feedAmount) };
  const bad = validateProposalSpec(spec, b.fork.step, m);
  if (bad) throw new Error(`dose fork ${seed} of ${p.id}: ${bad}`);
  return spec;
}

// ---------------------------------------------------------------------------------------------
// The plan.

export type Role = "rules" | "count" | "dose";
export const ROLES: readonly Role[] = ["rules", "count", "dose"];

export interface BenchSource {
  seed: number;
  runId: string;
  /** The bundle's absolute real path, its manifest's SHA-256, and the notes file's absolute real path and SHA-256. */
  dir: string;
  manifestSha256: string;
  /** The SHA-256 of the bundle's series.jsonl and lineages.tsv, which the replay check and the scorer read (amendment 1, "Sources bound by content"). */
  seriesSha256: string;
  lineagesSha256: string;
  notesPath: string;
  notesSha256: string;
  /** The rules proposal picked for this source, its action and its ring. */
  proposalId: string;
  action: string;
  ring: { index: number; signal: string; side: string };
}

export interface BenchEntry {
  /** seed-<n>-rules, seed-<n>-count-<draw>, seed-<n>-dose-<draw>: the directory name under the run's --out. */
  id: string;
  role: Role;
  /** Index into body.sources. */
  source: number;
  /** The baseline's draw seed; null for the rules fork. */
  draw: number | null;
  /** The rules proposal a baseline is matched to; null for the rules fork. */
  matches: string | null;
  /** The entry's own proposal id (rules-v0 or random-v0); null for a dose fork, which is not a proposal. */
  proposalId: string | null;
  C: number;
  S: number;
  /** The fork's first entry step: where its departure is scored from, and how far it must replay its source. */
  anchor: number;
  replayThrough: number;
  steps: number;
  fork: ForkCheck;
  specSha256: string;
  spec: RunSpec;
  /** The tools/run.ts command from the repository root, without --out (`run` appends --out <out>/<id>). */
  argv: string[];
  /** The rules or random-v0 proposal body (absent for a dose fork). */
  proposal?: ProposalBody;
}

export interface BenchBody {
  bench: "proposer-bench";
  benchVersion: number;
  note: string;
  versions: BenchVersions;
  constants: BenchConstants;
  selection: Selection & { base: string; notesDir: string; seeds: number[]; rule: string };
  notesCommand: string;
  sources: BenchSource[];
  entries: BenchEntry[];
  totals: { forks: number; steps: number; byRole: Record<Role, { forks: number; steps: number }> };
}

export interface BenchApproval {
  by: string;
  at: string;
  manifestSha256: string;
}
export interface BenchManifest {
  manifestSha256: string;
  status: "planned" | "approved";
  approval?: BenchApproval;
  body: BenchBody;
}

/** One source's inputs to the plan, as tools/lib/bench-fs.ts loads them (the proposer's own result for its notes and bundle). */
export interface BenchInput {
  seed: number;
  src: { dir: string; manifest: SourceManifest; manifestSha256: string; seriesSha256: string; lineagesSha256: string };
  notesPath: string;
  notesSha256: string;
  result: ProposeResult;
}

/** The note's rule: the first proposal, in the proposer's output order, whose rule is not the replay control. Null when there is none. */
export function pickProposal(result: ProposeResult): Proposal | null {
  return result.proposals.find((p) => p.body.generator === "rules-v0" && p.body.rule.action !== "control") ?? null;
}

const SELECTION_RULE = "the bundles <base>/<experiment>/<presetId>/<condition>/seed-<n> for n = 1..pairs, in seed order, and no others; each one's notes file is <notesDir>/<experiment>-<presetId>-<condition>-seed-<n>.notes.json";

function entryOf(role: Role, source: number, seed: number, draw: number | null, rules: Proposal, spec: RunSpec, anchor: number, proposal?: Proposal): BenchEntry {
  const b = rules.body;
  return {
    id: role === "rules" ? `seed-${seed}-rules` : `seed-${seed}-${role}-${draw}`,
    role,
    source,
    draw,
    matches: role === "rules" ? null : rules.id,
    proposalId: proposal ? proposal.id : null,
    C: b.fork.step,
    S: b.interventionStep,
    anchor,
    replayThrough: anchor,
    steps: spec.steps,
    fork: { ...b.fork },
    specSha256: specHash(spec),
    spec,
    argv: runArgv(spec, { step: b.fork.step, dir: b.source.dir }),
    ...(proposal ? { proposal: proposal.body } : {}),
  };
}

export class BenchPlanError extends Error {}

/**
 * The bench body (the note, "Sources" and "The forks"): per source in seed order, the picked rules proposal, its count-matched
 * random forks (randomBaseline, unchanged) and its footprint-matched forks (dose-v0). Throws BenchPlanError naming the source when its
 * notes give no intervention proposal, when the inputs are not exactly the selection's seeds, or when any spec fails validation.
 */
export function planBench(where: { base: string; notesDir: string }, inputs: readonly BenchInput[], k: BenchConstants = BENCH_V0): BenchBody {
  const seeds = seedsOf(k.pairs);
  if (inputs.length !== seeds.length || inputs.some((x, i) => x.seed !== seeds[i])) throw new BenchPlanError(`the plan needs exactly the sources seed-1 to seed-${k.pairs}, in order (got ${inputs.map((x) => x.seed).join(", ") || "none"})`);
  if (k.countSeeds.length !== k.K || k.doseSeeds.length !== k.K) throw new BenchPlanError(`K is ${k.K} but there are ${k.countSeeds.length} count and ${k.doseSeeds.length} dose seeds`);
  const sources: BenchSource[] = [];
  const entries: BenchEntry[] = [];
  inputs.forEach((x, i) => {
    const want = sourceDirOf(where.base, k.selection, x.seed);
    const m = x.src.manifest;
    const runId = `${m.spec.experiment}/${m.spec.presetId}/${m.spec.condition}/seed-${m.spec.seed}`;
    if (x.src.dir !== want) throw new BenchPlanError(`seed-${x.seed}: the bundle is at ${x.src.dir}, not ${want}`);
    if (m.spec.experiment !== k.selection.experiment || m.spec.presetId !== k.selection.presetId || m.spec.condition !== k.selection.condition || m.spec.seed !== x.seed) throw new BenchPlanError(`seed-${x.seed}: the bundle's run is ${runId}, not the selection's`);
    if (x.notesPath !== joinPath(where.notesDir, notesNameOf(k.selection, x.seed))) throw new BenchPlanError(`seed-${x.seed}: the notes file is ${x.notesPath}, not ${joinPath(where.notesDir, notesNameOf(k.selection, x.seed))}`);
    const p = pickProposal(x.result);
    if (!p) throw new BenchPlanError(`${runId}: its notes give no feed, drain or lesion proposal (${x.result.proposals.length} proposal(s), ${x.result.skipped.length} skipped); no pair, so no plan`);
    const b = p.body;
    if (b.notes.path !== x.notesPath || b.notes.sha256 !== x.notesSha256 || b.source.dir !== x.src.dir || b.source.manifestSha256 !== x.src.manifestSha256) throw new BenchPlanError(`${runId}: the proposal was not made from this bundle and notes file`);
    const bad = validateProposal(b);
    if (bad) throw new BenchPlanError(`${runId}: the proposal does not validate: ${bad}`);
    if (b.spec.steps !== b.interventionStep - b.fork.step + k.horizon) throw new BenchPlanError(`${runId}: the proposal's horizon is not ${k.horizon}`);
    if (!/^[0-9a-f]{64}$/.test(x.src.seriesSha256) || !/^[0-9a-f]{64}$/.test(x.src.lineagesSha256)) throw new BenchPlanError(`${runId}: no SHA-256 of its series.jsonl and lineages.tsv`);
    sources.push({ seed: x.seed, runId, dir: x.src.dir, manifestSha256: x.src.manifestSha256, seriesSha256: x.src.seriesSha256, lineagesSha256: x.src.lineagesSha256, notesPath: x.notesPath, notesSha256: x.notesSha256, proposalId: p.id, action: b.rule.action, ring: { index: b.ring.index, signal: b.ring.signal, side: b.ring.side } });
    entries.push(entryOf("rules", i, x.seed, null, p, b.spec, b.interventionStep, p));
    for (const s of k.countSeeds) {
      const r = randomBaseline(p, s);
      if (!r) throw new BenchPlanError(`${runId}: no random fork for proposal ${p.id}`);
      const rv = validateProposalSpec(r.body.spec, r.body.fork.step, m);
      if (rv) throw new BenchPlanError(`${runId}: count fork ${s}: ${rv}`);
      entries.push(entryOf("count", i, x.seed, s, p, r.body.spec, r.body.replayThrough, r));
    }
    for (const s of k.doseSeeds) {
      let spec: RunSpec;
      try {
        spec = doseSpec(p, s, m);
      } catch (e) {
        throw new BenchPlanError(`${runId}: ${(e as Error).message}`);
      }
      entries.push(entryOf("dose", i, x.seed, s, p, spec, b.interventionStep));
    }
  });
  const ids = new Set(entries.map((e) => e.id));
  if (ids.size !== entries.length) throw new BenchPlanError("two entries share an id");
  const byRole = Object.fromEntries(ROLES.map((r) => [r, { forks: entries.filter((e) => e.role === r).length, steps: entries.filter((e) => e.role === r).reduce((n, e) => n + e.steps, 0) }])) as BenchBody["totals"]["byRole"];
  return {
    bench: "proposer-bench",
    benchVersion: BENCH_VERSION,
    note: BENCH_NOTE,
    versions: currentVersions(),
    constants: { ...k, countSeeds: [...k.countSeeds], doseSeeds: [...k.doseSeeds], selection: { ...k.selection } },
    selection: { ...k.selection, base: where.base, notesDir: where.notesDir, seeds, rule: SELECTION_RULE },
    notesCommand: notesCommand(where.base, where.notesDir, k.selection, k.pairs),
    sources,
    entries,
    totals: { forks: entries.length, steps: entries.reduce((n, e) => n + e.steps, 0), byRole },
  };
}

// ---------------------------------------------------------------------------------------------
// The manifest file and the yes gate.

export const manifestSha256 = (body: BenchBody): string => sha(canonical(body));
/** A planned manifest for a body. */
export const plannedManifest = (body: BenchBody): BenchManifest => ({ manifestSha256: manifestSha256(body), status: "planned", body });

/** The file's bytes: manifestSha256, status, approval (when present), body; two-space JSON and a final newline. */
export function serializeManifest(m: BenchManifest): string {
  return JSON.stringify({ manifestSha256: m.manifestSha256, status: m.status, ...(m.approval ? { approval: { by: m.approval.by, at: m.approval.at, manifestSha256: m.approval.manifestSha256 } } : {}), body: m.body }, null, 2) + "\n";
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** Parses a manifest file: its shape, and that its recorded manifestSha256 is its body's (else the body was edited). Throws. */
export function parseManifest(text: string): BenchManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`manifest: not JSON (${(e as Error).message})`);
  }
  if (!isObj(raw)) throw new Error("manifest: not a JSON object");
  const extra = Object.keys(raw).find((k) => !["manifestSha256", "status", "approval", "body"].includes(k));
  if (extra !== undefined) throw new Error(`manifest: unknown key ${JSON.stringify(extra)}`);
  if (raw.status !== "planned" && raw.status !== "approved") throw new Error(`manifest: status ${JSON.stringify(raw.status)} is not planned or approved`);
  if (!isObj(raw.body)) throw new Error("manifest: no body");
  const body = raw.body as unknown as BenchBody;
  if (body.bench !== "proposer-bench" || body.benchVersion !== BENCH_VERSION) throw new Error(`manifest: not a proposer-bench v${BENCH_VERSION} body`);
  let h: string;
  try {
    h = manifestSha256(body);
  } catch (e) {
    throw new Error(`manifest: body is not canonical JSON (${(e as Error).message})`);
  }
  if (raw.manifestSha256 !== h) throw new Error(`manifest: manifestSha256 ${JSON.stringify(raw.manifestSha256)} is not its body's (${h}); the body was edited`);
  let approval: BenchApproval | undefined;
  if (raw.approval !== undefined) {
    const a = raw.approval;
    if (!isObj(a) || typeof a.by !== "string" || typeof a.at !== "string" || typeof a.manifestSha256 !== "string" || Object.keys(a).length !== 3) throw new Error("manifest: approval is not {by, at, manifestSha256}");
    approval = { by: a.by, at: a.at, manifestSha256: a.manifestSha256 };
  }
  if (raw.status === "planned" && approval) throw new Error("manifest: a planned manifest carries an approval");
  return { manifestSha256: h, status: raw.status, ...(approval ? { approval } : {}), body };
}

/** Why the recorded versions are not this checkout's, or null (the note, "A version bump voids the plan"). */
export function versionRefusal(body: BenchBody): string | null {
  const now = currentVersions(), had = (body.versions ?? {}) as unknown as Record<string, unknown>;
  const diffs = (Object.keys(now) as (keyof BenchVersions)[]).filter((k) => had[k] !== now[k]).map((k) => `${k} ${JSON.stringify(had[k])} → ${now[k]}`);
  return diffs.length ? `the manifest was planned under other versions than this checkout's (${diffs.join(", ")}); a bench on new versions is a new plan` : null;
}

/**
 * Every check a body passes without reading a file (`dry-run`, `approve` and `run` all make it, before re-deriving the plan from its
 * files): the recorded versions, every entry's spec through the proposer's validators (validateProposalSpec), its spec hash, its
 * argv, its anchor and replay step, and its content (a rules or count entry's proposal body re-validates, a dose entry is its seed's
 * draw), and the totals. Returns the problems, each naming its entry. Never throws.
 */
export function bodyProblems(body: BenchBody): string[] {
  const out: string[] = [];
  try {
    const v = versionRefusal(body);
    if (v) out.push(v);
    if (!Array.isArray(body.entries) || !Array.isArray(body.sources)) return [...out, "the body has no entries or sources"];
    const k = body.constants;
    if (!(Number.isSafeInteger(k?.pairs) && k.pairs >= 1)) return [...out, `constants.pairs ${JSON.stringify(k?.pairs)} is not a positive integer`];
    if (body.sources.length !== k.pairs || body.sources.some((s, i) => s?.seed !== i + 1)) out.push(`the sources are not seed-1 to seed-${k.pairs}, one each, in order`);
    const perSource = 1 + k.countSeeds.length + k.doseSeeds.length;
    for (let i = 0; i < body.sources.length; i++) {
      const roles = body.entries.filter((e) => e?.source === i).map((e) => `${e.role}:${e.draw}`).sort();
      const want = ["rules:null", ...k.countSeeds.map((d) => `count:${d}`), ...k.doseSeeds.map((d) => `dose:${d}`)].sort();
      if (canonical(roles) !== canonical(want)) out.push(`source ${i} does not have exactly one rules fork and the count and dose draws ${canonical(k.countSeeds)} / ${canonical(k.doseSeeds)}`);
    }
    if (body.entries.length !== body.sources.length * perSource) out.push(`${body.entries.length} entries, not ${perSource} per source`);
    const rulesOf = new Map<number, BenchEntry>();
    for (const e of body.entries) if (e?.role === "rules") rulesOf.set(e.source, e);
    for (const e of body.entries) {
      const at = `entry ${JSON.stringify(e?.id)}`;
      try {
        const src = body.sources[e.source];
        if (!src) {
          out.push(`${at}: source ${e.source} is not one of the ${body.sources.length} sources`);
          continue;
        }
        const specBad = validateProposalSpec(e.spec, e.C);
        if (specBad) {
          out.push(`${at}: ${specBad}`);
          continue;
        }
        if (e.specSha256 !== specHash(e.spec)) out.push(`${at}: specSha256 is not its spec's`);
        if (e.steps !== e.spec.steps) out.push(`${at}: steps ${e.steps} is not its spec's ${e.spec.steps}`);
        if (canonical(e.argv) !== canonical(runArgv(e.spec, { step: e.C, dir: src.dir }))) out.push(`${at}: the stored argv is not the one its spec gives`);
        const first = e.spec.interventions?.[0]?.step;
        if (e.anchor !== first || e.replayThrough !== first) out.push(`${at}: anchor ${e.anchor} and replayThrough ${e.replayThrough} are not its first entry's step ${first}`);
        if (e.fork?.step !== e.C) out.push(`${at}: the fork check is not at C = ${e.C}`);
        if (e.role === "rules" || e.role === "count") {
          if (!e.proposal) {
            out.push(`${at}: no proposal body`);
            continue;
          }
          const pv = validateProposal(e.proposal);
          if (pv) out.push(`${at}: its proposal does not validate: ${pv}`);
          if (canonical(e.proposal.spec) !== canonical(e.spec)) out.push(`${at}: its spec is not its proposal's`);
          if (e.proposal.generator !== (e.role === "rules" ? "rules-v0" : "random-v0")) out.push(`${at}: its proposal's generator is ${e.proposal.generator}`);
          if (e.role === "rules" && (e.proposalId !== src.proposalId || e.matches !== null || e.draw !== null)) out.push(`${at}: its proposal id, matches or draw is not its source's rules proposal`);
        }
        if (e.role !== "rules") {
          const r = rulesOf.get(e.source);
          if (!r?.proposal) {
            out.push(`${at}: its source has no rules entry`);
            continue;
          }
          if (e.matches !== src.proposalId) out.push(`${at}: matches ${e.matches}, not its source's proposal ${src.proposalId}`);
          const rules: Proposal = { id: src.proposalId, status: "proposed", body: r.proposal };
          if (e.role === "count") {
            const again = typeof e.draw === "number" ? randomBaseline(rules, e.draw) : null;
            if (!again || canonical(again.body) !== canonical(e.proposal)) out.push(`${at}: its proposal is not the seed ${e.draw} random fork of ${src.proposalId}`);
          } else if (canonical(doseSpec(rules, e.draw!)) !== canonical(e.spec)) out.push(`${at}: its spec is not the seed ${e.draw} dose draw of ${src.proposalId}`);
        }
      } catch (err) {
        out.push(`${at}: malformed (${(err as Error).message})`);
      }
    }
    const steps = body.entries.reduce((n, e) => n + (e?.spec?.steps ?? 0), 0);
    if (body.totals?.forks !== body.entries.length || body.totals?.steps !== steps) out.push(`the totals are not the entries' (${body.entries.length} forks, ${steps} steps)`);
  } catch (e) {
    out.push(`the body is malformed (${(e as Error).message})`);
  }
  return out;
}

/**
 * Why a manifest's number of pairs is not the one the caller accepts, or null. The note's bench has ten; a smaller one is a test
 * fixture, accepted only when the caller names its size (`--pairs`), so the production gate never runs a bench of fewer pairs.
 */
export function pairsRefusal(body: BenchBody, pairs: number = BENCH_V0.pairs): string | null {
  const had = body?.constants?.pairs;
  return had === pairs ? null : `the manifest has ${JSON.stringify(had)} pairs, not ${pairs}${pairs === BENCH_V0.pairs ? " (a bench of fewer pairs is not the planned bench; it is never approved or run without naming its size)" : ""}`;
}

/** `approve`: the approved manifest for the whole batch, or a thrown refusal (not planned, another number of pairs, not a person's name, a body with problems). */
export function approveManifest(m: BenchManifest, by: string, at: string, pairs: number = BENCH_V0.pairs): BenchManifest {
  if (m.status !== "planned") throw new Error(`refused: the manifest's status is ${m.status}, not planned`);
  const pr = pairsRefusal(m.body, pairs);
  if (pr) throw new Error(`refused: ${pr}`);
  if (!isPersonName(by)) throw new Error(`refused: ${JSON.stringify(by)} is not a person's name (2 to 80 characters with a letter, no model, agent or bot word); only a person approves the bench`);
  if (!isIsoTime(at)) throw new Error(`refused: ${JSON.stringify(at)} is not an ISO 8601 UTC timestamp`);
  const bad = bodyProblems(m.body);
  if (bad.length) throw new Error(`refused: ${bad[0]}`);
  return { manifestSha256: m.manifestSha256, status: "approved", approval: { by: by.normalize("NFKC").trim(), at, manifestSha256: manifestSha256(m.body) }, body: m.body };
}

/** An ISO 8601 UTC timestamp as `approve` writes it (Date#toISOString), naming a real instant. */
export const isIsoTime = (s: string): boolean => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(s) && Number.isFinite(Date.parse(s));

/**
 * Why `run` (and `score`) must refuse this manifest before reading any file, or null. Never throws. This is a check of the record,
 * not of a person: a hand-written approval naming a person passes it, as the proposer's does (the note, amendment 1, "The yes gate").
 */
export function runRefusal(m: BenchManifest, pairs: number = BENCH_V0.pairs): string | null {
  try {
    if (m.status !== "approved") return `not approved: the status is ${m.status}; a person approves the whole bench first with tools/bench.ts approve <manifest> --by <name>`;
    if (!m.approval) return "not approved: the file has no approval";
    if (typeof m.approval.by !== "string" || !isPersonName(m.approval.by)) return "the approval names no person";
    if (typeof m.approval.at !== "string" || !isIsoTime(m.approval.at)) return `the approval's time ${JSON.stringify(m.approval.at)} is not an ISO 8601 UTC timestamp`;
    const now = manifestSha256(m.body);
    if (m.approval.manifestSha256 !== now) return `the body changed after it was approved (approved ${m.approval.manifestSha256}, now ${now})`;
    if (m.manifestSha256 !== now) return `the manifest's recorded manifestSha256 ${JSON.stringify(m.manifestSha256)} is not its body's (${now})`;
    const pr = pairsRefusal(m.body, pairs);
    if (pr) return pr;
    const bad = bodyProblems(m.body);
    return bad.length ? bad[0] : null;
  } catch (e) {
    return `the manifest is malformed (${(e as Error).message})`;
  }
}

// ---------------------------------------------------------------------------------------------
// dry-run.

export const shellQuote = (s: string) => (/^[A-Za-z0-9_./:,=+@%-]+$/.test(s) ? s : `'${s.replaceAll("'", `'\\''`)}'`);
/** The exact command for an entry (from the repository root): its stored argv plus --out <out>/<id>. */
export const entryCommand = (e: BenchEntry, out: string): string[] => [...e.argv, "--out", joinPath(out, e.id)];
/** The default --out of `run`: $HOME/browser-life-bench/<the first 16 hex digits of the manifest SHA-256>. */
export const defaultOut = (home: string, sha256: string) => joinPath(home, "browser-life-bench", sha256.slice(0, 16));

/** dry-run's lines: one per entry (its id, then its exact command), then the totals. */
export function dryRunLines(body: BenchBody, out: string): string[] {
  const lines = body.entries.map((e) => `${e.id}: ${entryCommand(e, out).map(shellQuote).join(" ")}`);
  const t = body.totals;
  lines.push(`total: ${t.forks} forks, ${t.steps} steps (${ROLES.map((r) => `${r} ${t.byRole[r].forks} forks / ${t.byRole[r].steps} steps`).join("; ")})`);
  return lines;
}

// ---------------------------------------------------------------------------------------------
// The readout (the note, "The test" and "Reading").

/** The median of three numbers. */
export function medianOf3(xs: readonly number[]): number {
  if (xs.length !== 3 || !xs.every(Number.isFinite)) throw new Error(`medianOf3 needs three finite numbers, got ${xs.length}`);
  return [...xs].sort((a, b) => a - b)[1];
}

/** P(X >= k) for X ~ Binomial(n, 1/2), exactly as a ratio of integers. */
export function signTestTail(k: number, n: number): number {
  if (!(Number.isInteger(k) && Number.isInteger(n) && n >= 0)) throw new Error("signTestTail: integers only");
  let sum = 0n, c = 1n;
  for (let i = 0; i <= n; i++) {
    if (i >= k) sum += c;
    c = (c * BigInt(n - i)) / BigInt(i + 1);
  }
  return Number(sum) / 2 ** n;
}

export interface PairOutcome {
  source: number;
  rules: number | null;
  baseline: (number | null)[];
  median: number | null;
  /** win: rules > median strictly; loss: rules < median strictly; tie: equal; void: a fork of the pair is void. */
  outcome: "win" | "loss" | "tie" | "void";
}
export interface Comparison {
  role: "count" | "dose";
  pairs: PairOutcome[];
  wins: number;
  losses: number;
  ties: number;
  voids: number;
  /** Called iff every pair counts and the bench has the bars' number of pairs. */
  called: boolean;
  notCalledReason: string | null;
  /** Rules beat the baseline (wins >= winsToBeat); null when not called. */
  rulesBeat: boolean | null;
  /** The baseline beats the rules (losses >= winsToBeat); null when not called. */
  baselineBeats: boolean | null;
  /**
   * P(W >= wins) for W ~ Binomial(pairs, 1/2): the tail if the rules fork and the draws of a pair were exchangeable. They are not
   * (the arms differ in kind mix, radius and timing), so this is a descriptive tail, not a p-value (amendment 1).
   */
  pWins: number;
}

/** The paired sign test for one baseline role. `rules[i]` is source i's rules D (null when void), `baseline[i]` its K draws. */
export function comparePairs(role: "count" | "dose", rules: readonly (number | null)[], baseline: readonly (readonly (number | null)[])[], k: Pick<BenchConstants, "pairs" | "winsToBeat" | "K">, benchPairs: number): Comparison {
  const pairs: PairOutcome[] = rules.map((r, i) => {
    const bs = baseline[i] ?? [];
    if (r === null || bs.length !== k.K || bs.some((x) => x === null)) return { source: i, rules: r, baseline: [...bs], median: null, outcome: "void" };
    const med = medianOf3(bs as number[]);
    return { source: i, rules: r, baseline: [...bs], median: med, outcome: r > med ? "win" : r < med ? "loss" : "tie" };
  });
  const count = (o: PairOutcome["outcome"]) => pairs.filter((p) => p.outcome === o).length;
  const wins = count("win"), losses = count("loss"), ties = count("tie"), voids = count("void");
  const notCalledReason = benchPairs !== k.pairs ? `the bench has ${benchPairs} pairs; the bars were set for ${k.pairs}` : voids ? `${voids} of ${pairs.length} pairs are void` : pairs.length !== k.pairs ? `${pairs.length} pairs, not ${k.pairs}` : null;
  const called = notCalledReason === null;
  return { role, pairs, wins, losses, ties, voids, called, notCalledReason, rulesBeat: called ? wins >= k.winsToBeat : null, baselineBeats: called ? losses >= k.winsToBeat : null, pWins: signTestTail(wins, pairs.length) };
}

/**
 * The reading (amendment 1, "Reading", which replaces the frozen table): what the two comparisons say together, in words that do not
 * claim more than the test can. "dose" is the role's key; what it matches is the footprint, timing and requested amount, not the
 * physical dose delivered.
 */
export const READINGS = Object.freeze({
  both: "rules beat both random baselines (exploratory)",
  countOnly: "rules beat v0's random forks; the footprint-matched comparison is inconclusive",
  countButFootprintBeats: "rules beat v0's random forks; a random action of the same footprint and timing beats the rules",
  mixed: "mixed: rules beat a random action of the same footprint and timing, but not v0's random forks",
  baselineBeats: "a random baseline beats the rules",
  noClear: "no clear advantage seen (the bench sees only a strong one)",
  notCalled: "not called",
} as const);
export type BenchReading = (typeof READINGS)[keyof typeof READINGS];
/** DESIGN.md's words for how sure a result is (SEEN_LABELS); an exploratory bench is never Confirmed. */
export type BenchChip = "Measured" | "Negative" | "Unclear";
type Called = Pick<Comparison, "called" | "rulesBeat" | "baselineBeats">;
/** The reading table (amendment 1). */
export function reading(count: Called, dose: Called): BenchReading {
  if (!count.called || !dose.called) return READINGS.notCalled;
  if (count.rulesBeat && dose.rulesBeat) return READINGS.both;
  if (count.rulesBeat) return dose.baselineBeats ? READINGS.countButFootprintBeats : READINGS.countOnly;
  if (dose.rulesBeat) return READINGS.mixed;
  if (count.baselineBeats || dose.baselineBeats) return READINGS.baselineBeats;
  return READINGS.noClear;
}
/** The chip a reading is shown with on the journal (amendment 1): Measured when the rules beat a baseline at the bar, Negative when only a baseline beats the rules, Unclear otherwise. */
export function chipOf(r: BenchReading): BenchChip {
  if (r === READINGS.both || r === READINGS.countOnly || r === READINGS.countButFootprintBeats) return "Measured";
  if (r === READINGS.baselineBeats) return "Negative";
  return "Unclear";
}

/**
 * Caveats fixed before any run (amendment 1) and written into every record, so the record says what its score cannot see.
 */
export const CAVEATS_V0: readonly string[] = Object.freeze([
  "the departure score is bell v1's pair scorer, whose own readout B did not meet its bar: at Z*_pair = 5.70 it heard a lesion removing over a third of the living cells, or a feed, on only 4 of 10 seeds (docs/naturalist-bell-v1-plan-2026-10-17.md, \"B: did not meet the exploratory bar\")",
  "acute lesions heal inside the scorer's 10-census windows (bell v1 readout B, point 2), so a baseline whose forks are mostly lesions and drains can score low for that reason alone; dByKind reports D per kind for this",
  "z is in units of the between-source spread at each census; the count forks' anchors (900 to 23,600 in the v0 plan) are earlier than the rules' (14,900 to 33,600), so the count comparison mixes times at which that unit may differ",
  "the dose role matches footprint, timing and requested amount, not delivered matter: a drain on empty nutrient removes nothing, a lesion conserves matter; delivered reports what each fork's log and its first census after the anchor show",
  "pWins is a Binomial(10, 1/2) tail under an exchangeability the arms do not satisfy; it is descriptive, not a p-value",
  "the dose role differs from the rules in kind and in placement: its centre is random, the rules' is fixed, and on gradient-m3 a disc's 77% of the world is not the same 77% wherever it sits, so a win over it (or a loss to it) cannot be laid on the choice of kind alone (amendment 2)",
]);

/** The applied feeds' logged matter, summed (a lesion moves none); null when the fork has no feed. */
export function appliedFeedMatter(applied: readonly { kind: string; matter?: number }[]): number | null {
  const feeds = applied.filter((a) => a.kind === "feed");
  return feeds.length ? feeds.reduce((n, a) => n + (a.matter ?? 0), 0) : null;
}

/** The scored series fields (every v0 signal read from the series record) must be finite numbers at every census (amendment 1). */
const SCORED_FIELDS = SIGNALS.filter((d) => d.source !== "lineages").map((d) => d.name);
export function scoredFieldProblem(rec: Record<string, unknown> & { step: number }): string | null {
  for (const f of SCORED_FIELDS) {
    const v = rec[f];
    if (typeof v !== "number" || !Number.isFinite(v)) return `step ${rec.step}: ${f} is ${JSON.stringify(v) ?? "missing"}, not a finite number`;
  }
  return null;
}

/**
 * A fork's void reasons (amendment 1, "Valid forks"): bell v1's, except that a fork whose pre-checks all pass (exit 0, its manifest,
 * its applied log exactly its schedule) and whose stream is clean but which never differs from its source after the anchor is
 * valid with D = 0: its action was applied and did nothing.
 */
export function benchVoidReasons(r: PairResult, anchor: number, pre: string | null): string[] {
  const reasons = voidReasons(r, anchor, { manifest: pre });
  if (pre === null && r.failed === null && r.diffAtOrBeforeS === null && r.firstDiffStep === null) return reasons.filter((x) => !x.startsWith("no difference from its base after"));
  return reasons;
}

/** One fork's score, as tools/lib/bench-fs.ts's scoreBench gives it. */
export interface ForkScore {
  id: string;
  role: Role;
  source: number;
  anchor: number;
  valid: boolean;
  voidReasons: string[];
  /** D_pair over all 13 signals (primary), and over bell v1 part A's 11 (reported). Null when void. */
  D: number | null;
  D11: number | null;
  signal: string | null;
  side: "high" | "low" | null;
  firstDiffStep: number | null;
  /** The entry's kinds, in order (for the "which kind did the rules choose" line). */
  kinds: string[];
  /** What the fork delivered (amendment 1; reported, not deciding): its applied feeds' logged matter, and at its first census after the anchor, its living cells and matter minus its source's. */
  delivered: { feedMatter: number | null; step: number; livingCellsDelta: number | null; matterDelta: number | null };
}
export interface PredictionOutcome {
  source: number;
  /** "main" or the alsoAnswers ring index. */
  ring: number;
  signal: string;
  statement: string;
  /** The rules fork's verdict; null when undecided (a void fork, a missing census), with the reason. */
  rules: boolean | null;
  reason: string | null;
  /** Specificity: the same prediction on the source's count and dose forks (null where undecided). */
  count: (boolean | null)[];
  dose: (boolean | null)[];
}
export interface BenchSummary {
  pairs: number;
  forks: { total: number; valid: number; void: { id: string; reasons: string[] }[] };
  count: Comparison;
  dose: Comparison;
  reading: BenchReading;
  chip: BenchChip;
  caveats: string[];
  /** The note's qualification when the rules chose one kind for most sources (the dose comparison is then that kind against a random one); null otherwise. */
  readingNote: string | null;
  /** "<role> beats the rules" lines, when a baseline beats the rules. */
  baselineBeats: string[];
  kinds: Record<string, number>;
  /** Per role and kind (the fork's kinds joined by "+"), valid forks and their median D (amendment 1; descriptive). */
  dByKind: Record<Role, Record<string, { n: number; medianD: number }>>;
  /** Per role, over valid forks, the medians of what was delivered (amendment 1; descriptive). */
  delivered: Record<Role, { n: number; medianFeedMatter: number | null; medianLivingCellsDelta: number | null; medianMatterDelta: number | null }>;
  /** Entry ids launched more than once (bench-run.jsonl), with their launch count: a re-run after a technical failure is reported, never hidden. */
  reruns: { id: string; launches: number }[];
  /** Forks per role with D > Z*_pair (descriptive; Z*_pair is out of its context here). */
  aboveZStarPair: Record<Role, { n: number; of: number }>;
  d11: { count: Comparison; dose: Comparison };
  predictions: { held: number; decided: number; of: number; specificity: { count: { held: number; decided: number }; dose: { held: number; decided: number } }; list: PredictionOutcome[] };
}

/** The bench's readout from its fork scores and prediction outcomes (the note, "The test", "Reading", "The predictions"). */
const medianOrNull = (xs: readonly (number | null)[]): number | null => {
  const v = xs.filter((x): x is number => x !== null).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

export function summarizeBench(body: Pick<BenchBody, "sources" | "constants">, forks: readonly ForkScore[], predictions: readonly PredictionOutcome[], k: BenchConstants = BENCH_V0, launches: ReadonlyMap<string, number> = new Map()): BenchSummary {
  const n = body.sources.length;
  const of = (role: Role, i: number) => forks.filter((f) => f.role === role && f.source === i);
  const dOf = (f: ForkScore | undefined, key: "D" | "D11") => (f && f.valid ? f[key] : null);
  const cmp = (role: "count" | "dose", key: "D" | "D11") =>
    comparePairs(role, body.sources.map((_, i) => (of("rules", i).length === 1 ? dOf(of("rules", i)[0], key) : null)), body.sources.map((_, i) => of(role, i).map((f) => dOf(f, key))), k, n);
  const count = cmp("count", "D"), dose = cmp("dose", "D");
  const baselineBeats = [count, dose].filter((c) => c.baselineBeats).map((c) => `the ${c.role === "dose" ? "footprint-matched (dose)" : "count-matched"} baseline beats the rules (${c.losses} losses of ${c.pairs.length})`);
  const kinds: Record<string, number> = {};
  for (const s of body.sources) kinds[s.action] = (kinds[s.action] ?? 0) + 1;
  const above = Object.fromEntries(ROLES.map((r) => {
    const fs = forks.filter((f) => f.role === r);
    return [r, { n: fs.filter((f) => f.valid && (f.D as number) > k.zStarPair).length, of: fs.length }];
  })) as BenchSummary["aboveZStarPair"];
  const tally = (xs: (boolean | null)[]) => ({ held: xs.filter((x) => x === true).length, decided: xs.filter((x) => x !== null).length });
  const main = tally(predictions.map((p) => p.rules));
  const valid = (r: Role) => forks.filter((f) => f.role === r && f.valid);
  const dByKind = Object.fromEntries(ROLES.map((r) => {
    const by: Record<string, number[]> = {};
    for (const f of valid(r)) (by[f.kinds.join("+")] ??= []).push(f.D as number);
    return [r, Object.fromEntries(Object.entries(by).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([kind, ds]) => [kind, { n: ds.length, medianD: medianOrNull(ds) as number }]))];
  })) as BenchSummary["dByKind"];
  const delivered = Object.fromEntries(ROLES.map((r) => {
    const fs = valid(r);
    return [r, { n: fs.length, medianFeedMatter: medianOrNull(fs.map((f) => f.delivered.feedMatter)), medianLivingCellsDelta: medianOrNull(fs.map((f) => f.delivered.livingCellsDelta)), medianMatterDelta: medianOrNull(fs.map((f) => f.delivered.matterDelta)) }];
  })) as BenchSummary["delivered"];
  const rd = reading(count, dose);
  return {
    pairs: n,
    forks: { total: forks.length, valid: forks.filter((f) => f.valid).length, void: forks.filter((f) => !f.valid).map((f) => ({ id: f.id, reasons: f.voidReasons })) },
    count,
    dose,
    reading: rd,
    chip: chipOf(rd),
    caveats: [...CAVEATS_V0],
    readingNote: dominantKindNote(kinds, n),
    baselineBeats,
    kinds,
    dByKind,
    delivered,
    reruns: [...launches].filter(([, c]) => c > 1).map(([id, launches]) => ({ id, launches })).sort((a, b) => (a.id < b.id ? -1 : 1)),
    aboveZStarPair: above,
    d11: { count: cmp("count", "D11"), dose: cmp("dose", "D11") },
    predictions: { held: main.held, decided: main.decided, of: predictions.length, specificity: { count: tally(predictions.flatMap((p) => p.count)), dose: tally(predictions.flatMap((p) => p.dose)) }, list: [...predictions] },
  };
}

/** "the rules chose <kind> for k of n sources: ..." when one kind holds a majority of the sources, else null (the note, "Reading"). */
export function dominantKindNote(kinds: Readonly<Record<string, number>>, n: number): string | null {
  const top = Object.entries(kinds).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  if (!top || top[1] * 2 <= n) return null;
  return `the rules chose ${top[0]} for ${top[1]} of ${n} sources, so the footprint-matched (dose) comparison is in effect a jar-disc ${top[0]} at the rules' centre against a random kind at a random centre with the same radius and timing (kind and placement both differ)`;
}

/** The predictions a rules entry states: its own, then each alsoAnswers ring's (decided by propose's predictionHolds). */
export function rulesPredictions(e: BenchEntry): { ring: number; signal: string; prediction: Prediction }[] {
  const p = e.proposal!;
  return [{ ring: p.ring.index, signal: p.ring.signal, prediction: p.prediction }, ...(p.alsoAnswers ?? []).map((x) => ({ ring: x.index, signal: x.signal, prediction: x.prediction }))];
}
