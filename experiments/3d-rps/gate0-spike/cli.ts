// The pure parts of the Gate-0 command line: argument parsing and the spike's SHA-256 (rule draft 3.0, Code). No GPU, no Deno API.
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Rung } from "../readout-jobs.ts";
import { EXPLORATION_HEADER } from "../readout-exploration.ts";
import { EXPLORATION_2_HEADER } from "../readout-exploration-2.ts";

export class UsageError extends Error {}

export type Mode = "gate0" | "rehearsal" | "table" | "hash" | "exploration" | "exploration-2";

export interface Args {
  mode: Mode;
  out: string | null;
  rungs: Rung[];
  /**
   * `--plan-all`: plan every rung this process handles at once, whatever the state of the others (S0 and S1 side by side on two
   * machines), at the price of the lower rungs' jobs whenever a higher one gives GO. Off by default: rule draft 3.0 takes the rungs in
   * the order S0, S1, S2, V and stops at the first GO (decision O-8), so a wave is planned for one rung at a time.
   */
  planAll: boolean;
  /** `--machine-share=i/n`. */
  share: { i: number; n: number } | null;
  reverse: boolean;
  dense: boolean;
  dryRun: boolean;
  only: string | null;
  maxJobs: number | null;
  /** `--hash --write`: record the hash in experiments/3d-rps/gate0-spike.sha256. */
  write: boolean;
  /**
   * `--draft` (with `--table`): read runs/rps/rule-draft.md and label the output DRAFT, for a look before RULES.md is frozen. Without it
   * the readout applies the frozen rules and refuses unless RULES.md has its SHA-256 in FROZEN. Not available to `--gate0`: a registered
   * Gate-0 run starts only after the freeze (rule draft header, F12).
   */
  draft: boolean;
  /**
   * `--registered=<dir>` (with `--exploration` only): the registered pilot's job directory, read and never written. Amendment 1 reuses
   * its S0 G0.2 jobs and the table's rate-0 seed-401 cells.
   */
  registered: string | null;
}

const MODES: readonly Mode[] = ["gate0", "rehearsal", "table", "hash", "exploration", "exploration-2"];
const FLAGS = new Set(["reverse", "dense", "dry-run", "write", "plan-all", "draft", ...MODES]);
const VALUES = new Set(["out", "rung", "machine-share", "only", "max-jobs", "registered"]);
export const ALL_RUNGS: readonly Rung[] = ["S0", "S1", "S2", "V"];

export function parseArgs(argv: readonly string[]): Args {
  const flags = new Set<string>();
  const vals = new Map<string, string>();
  for (const t of argv) {
    if (!t.startsWith("--")) throw new UsageError(`unexpected argument ${t}`);
    const [k, v] = t.slice(2).split(/=(.*)/s);
    if (v === undefined) {
      if (k === "stop-after-go") throw new UsageError("--stop-after-go is the default now (rule draft 3.0 takes the rungs in the order S0, S1, S2, V and stops at the first GO); --plan-all plans every rung at once");
      if (!FLAGS.has(k)) throw new UsageError(VALUES.has(k) ? `--${k} needs a value (--${k}=...)` : `unknown option --${k}`);
      flags.add(k);
    } else {
      if (!VALUES.has(k)) throw new UsageError(FLAGS.has(k) ? `--${k} takes no value` : `unknown option --${k}`);
      vals.set(k, v);
    }
  }
  const modes = MODES.filter((m) => flags.has(m));
  if (modes.length !== 1) throw new UsageError(`exactly one of ${MODES.map((m) => `--${m}`).join(", ")} is required`);
  const mode = modes[0];
  const rungText = vals.get("rung") ?? "all";
  const rungs: Rung[] = rungText === "all" ? [...ALL_RUNGS] : rungText.split(",").map((x) => {
    if (!(ALL_RUNGS as readonly string[]).includes(x)) throw new UsageError(`--rung must be all or a comma-separated list of S0, S1, S2, V; got "${rungText}"`);
    return x as Rung;
  });
  let share: Args["share"] = null;
  const shareText = vals.get("machine-share");
  if (shareText !== undefined) {
    const m = /^(\d+)\/(\d+)$/.exec(shareText);
    if (!m || Number(m[1]) < 1 || Number(m[2]) < 1 || Number(m[1]) > Number(m[2])) throw new UsageError(`--machine-share must be i/n with 1 <= i <= n, got "${shareText}"`);
    share = { i: Number(m[1]), n: Number(m[2]) };
  }
  const maxText = vals.get("max-jobs");
  if (maxText !== undefined && !/^[1-9]\d*$/.test(maxText)) throw new UsageError(`--max-jobs must be a positive integer, got "${maxText}"`);
  const out = vals.get("out") ?? null;
  if ((mode === "gate0" || mode === "table") && out === null) throw new UsageError(`--${mode} needs --out=<job directory> (there is no default: a registered pilot must say where it writes)`);
  if (flags.has("draft") && mode !== "table") throw new UsageError(`--draft is for --table only: a registered Gate-0 run starts after the freeze, and --${mode} reads no rules`);
  const registered = vals.get("registered") ?? null;
  if (mode === "exploration") {
    // Amendment 1 runs S0 and V on S0 side by side, both in full: there is no rung to choose, no order to override and no dense job (A1.1, A1.2)
    if (out === null || registered === null) throw new UsageError("--exploration needs --out=<exploration job directory> and --registered=<the registered pilot's job directory>");
    for (const k of ["rung", "plan-all", "dense"]) if (flags.has(k) || vals.has(k)) throw new UsageError(`--${k} is not for --exploration: Amendment 1 runs S0 and V on S0 side by side, both in full, and G0.6 is not run`);
  } else if (registered !== null) throw new UsageError("--registered is for --exploration only");
  if (mode === "exploration-2") {
    // Amendment 2 runs its own jobs only (the horizon and both kill forms' confirmation at 256 x 256 x 4): no rung to choose and no dense job
    if (out === null) throw new UsageError("--exploration-2 needs --out=<Amendment 2 job directory>");
    for (const k of ["rung", "plan-all", "dense"]) if (flags.has(k) || vals.has(k)) throw new UsageError(`--${k} is not for --exploration-2: Amendment 2 runs the horizon and both kill forms at 256 x 256 x 4, and G0.6 is not run`);
  }
  return {
    mode,
    out,
    rungs,
    planAll: flags.has("plan-all"),
    share,
    reverse: flags.has("reverse"),
    dense: flags.has("dense"),
    dryRun: flags.has("dry-run"),
    only: vals.get("only") ?? null,
    maxJobs: maxText === undefined ? null : Number(maxText),
    write: flags.has("write"),
    draft: flags.has("draft"),
    registered,
  };
}

/**
 * The command line as gate0.ts reads it: an exploration request (`--exploration` or `--exploration-2` anywhere in `argv`) prints its
 * header through `say` before anything is parsed, so that every output of the exploration starts with it, an argument refusal included
 * (Amendments 1 and 2).
 */
export function parseCommandLine(argv: readonly string[], say: (line: string) => void): Args {
  if (argv.includes("--exploration")) say(EXPLORATION_HEADER);
  if (argv.includes("--exploration-2")) say(EXPLORATION_2_HEADER);
  return parseArgs(argv);
}

// ---- the spike's SHA-256 ----

const sha256 = (b: Uint8Array | string): string => createHash("sha256").update(b).digest("hex");

/**
 * The listing of rule draft 3.0, `git ls-files | LC_ALL=C sort | xargs shasum -a 256`: for each file path (relative to the spike
 * directory, forward slashes, sorted bytewise) a line `<sha256>  <path>`.
 */
export function spikeListing(files: readonly { path: string; bytes: Uint8Array }[]): string {
  const sorted = [...files].sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  return sorted.map((f) => `${sha256(f.bytes)}  ${f.path}\n`).join("");
}

/** The spike's SHA-256: the SHA-256 of the listing (`... | shasum -a 256`). */
export const spikeHash = (files: readonly { path: string; bytes: Uint8Array }[]): string => sha256(spikeListing(files));

/** The recipe of rule draft 3.0 as printed in the sidecar file and in the Gate-0 record. */
export const SPIKE_RECIPE = "(cd experiments/3d-rps/gate0-spike && git ls-files | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256)";
const LISTING_MARKER = "The listing that was hashed";

/**
 * The text of `experiments/3d-rps/gate0-spike.sha256`: the bare hash on the first line (so that `gate0.ts --hash` can compare), how it
 * was taken, and then the exact listing it is the SHA-256 of, one `<sha256 of the file>  <path>` line per file in the order of
 * `LC_ALL=C sort`. The listing beside the hash is what lets the committed files be checked against it: before the files are committed
 * `git ls-files` cannot see them, so the value is taken over exactly the files listed here.
 */
export function sidecarText(files: readonly { path: string; bytes: Uint8Array }[]): string {
  const listing = spikeListing(files);
  return [
    sha256(listing),
    "",
    "SHA-256 of the Gate-0 spike (rule draft 3.0, Code; D16): the SHA-256 of the sorted per-file listing printed by",
    `  ${SPIKE_RECIPE}`,
    `This value was taken on the working tree over exactly the ${files.length} files listed below (git ls-files -co --exclude-standard, the files not yet committed),`,
    "BEFORE the files were committed. The spike holds only what Gate 0 uses: no review scratch script, no out/ directory, no snapshot.",
    "After the commit, rerun the recipe above on the committed files, after the last change to the spike and before the first Gate-0 job:",
    "if the committed set is the listed one it gives this value, and that value goes in the Gate-0 record (rule draft 8.5) with the revision",
    "of the tree the spike patches (packages/sim-gpu/src/shaders3d.ts) and of packages/metrics/src/census-rps.ts. `gate0.ts --hash`",
    "reproduces the recipe on the working tree and compares it with the first line here.",
    "",
    `${LISTING_MARKER} (sorted with LC_ALL=C; \`<sha256 of the file>  <path>\`; the first line of this file is the SHA-256 of exactly these lines):`,
    listing.trimEnd(),
    "",
  ].join("\n");
}

/** Reads a sidecar file: the recorded hash (first line) and the listing lines (`<sha256>  <path>`) after the marker line. */
export function parseSidecar(text: string): { hash: string; listing: { sha256: string; path: string }[]; listingText: string } {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l.startsWith(LISTING_MARKER));
  const rows = at < 0 ? [] : lines.slice(at + 1).filter((l) => l.trim() !== "");
  const listing = rows.map((l) => {
    const m = /^([0-9a-f]{64})  (.+)$/.exec(l);
    if (!m) throw new Error(`gate0-spike.sha256: not a listing line: ${JSON.stringify(l)}`);
    return { sha256: m[1], path: m[2] };
  });
  return { hash: lines[0].trim(), listing, listingText: rows.length === 0 ? "" : `${rows.join("\n")}\n` };
}

/** The sidecar file's hash is the SHA-256 of its own listing (exported so that the test and the command check the same thing). */
export const sha256Hex = sha256;

/** Reads the listed files (paths relative to `dir`, as `git ls-files` prints them) for `spikeHash`. */
export function readSpikeFiles(dir: string, relPaths: readonly string[]): { path: string; bytes: Uint8Array }[] {
  return relPaths.map((p) => ({ path: p, bytes: new Uint8Array(fs.readFileSync(path.join(dir, p))) }));
}
