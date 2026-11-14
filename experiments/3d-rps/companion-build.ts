// Build step of the companion page, docs/3d-cyclic-rps-companion.html (plan M5a, D15).
//
// The page runs the lattice of experiments/3d-rps/rmf-lattice.ts live in a canvas. A page cannot import a .ts file, so it holds a
// TYPE-STRIPPED COPY of the module between two marker lines, and this file is the build step that makes the copy. The test
// (experiments/test/rps-companion.test.ts) uses the same functions to show that the page cannot drift from the module.
//
// THE BUILD STEP, in order:
//   1. Read rmf-lattice.ts.
//   2. Delete the `export ` that starts a line (the copy lives inside a function scope, where `export` is a syntax error). The
//      module has 42 such declarations and no other export form (`export { }`, `export default`): any other form makes this throw.
//   3. Canonical JavaScript = node:module `stripTypeScriptTypes(text, { mode: "transform" })`: every type is erased, every comment is
//      dropped, and the code is printed again from its syntax tree (4-space indents, one statement per line, redundant parentheses
//      gone). The module is written to be erasable (no enums, namespaces or parameter properties), so nothing else changes.
//   4. The result goes into the page verbatim, between the line "// BEGIN rmf-lattice copy ..." and the line "// END rmf-lattice copy".
//   5. Seed 900, L 20, M 3e-4 is run through the module (first frame, then 20,000 reaction steps), and the two hashes go into the page
//      between "// BEGIN self-check values" and "// END self-check values": the page recomputes them with its own copy when it loads.
//
// THE HASH, which is what "the page equals the module" means: SHA-256 of canonicalJs(withoutExports(text)), computed at the time of
// the test for BOTH the module and the page's block. Both sides go through the same printer, so the hash ignores comments, layout,
// parentheses and types, and moves with every other token. Nothing about the printer's layout is pinned: a later Node that prints
// differently still gives equal hashes for equal code. (`--check` below is the stricter text comparison and may say "stale"
// under a different Node although the hashes are equal.)
//
// THE RESULTS (section 4 and the pictures). Seven more blocks sit between "<!-- BEGIN result <name> -->" and "<!-- END result <name> -->"
// lines: the status chips at the top (summary), one slot per result that exists (lattice-pext, gate0, exploration-1, exploration-2),
// the pictures, and the inline results-data JSON. They are written from committed files only, never typed by hand:
//   * the lattice slot from the 44 rmf-cell/1 JSONs in experiments/3d-rps/results/lattice/ (the chart and its table) and from
//     results/lattice-readout.md (M_c, the pair estimates and the outcome row, parsed: the readout itself imports @bl/metrics, which
//     plain Node cannot resolve, so the test recomputes them with evaluateLattice and compares);
//   * the Gate-0 slot from GATE0-RECORD.md, the two exploration slots from GATE0-EXPLORATION.md and GATE0-EXPLORATION-2.md;
//   * the pictures from docs/3d-cyclic-rps-media/, inlined as data URIs (each file under MEDIA_CAPS, the page under PAGE_BUDGET). The
//     media there are copies of runs/rps/snapshots/ (gitignored), downscaled or re-quantized where needed. The 256 x 256 x 4 animation
//     (anim-256-V-r64-s401.gif and its poster) is optional: without it the slot says "being rendered".
// Each result slot names its source file, the file's SHA-256 and its date.
//
// Run:  PATH=~/.nvm/versions/node/v24.2.0/bin:$PATH node experiments/3d-rps/companion-build.ts [--write]
//       without --write it only reports whether the page's blocks and values are what this Node would write (exit 1 if not).
// REBUILD WITH THE 256 x 256 x 4 ANIMATION once runs/rps/snapshots/anim-256-V-r64-s401.gif and its poster exist (one line, from the root):
//   cp runs/rps/snapshots/anim-256-V-r64-s401.gif docs/3d-cyclic-rps-media/ && pngquant --force --quality 80-100 --output docs/3d-cyclic-rps-media/anim-256-V-r64-s401-poster.png runs/rps/snapshots/anim-256-V-r64-s401-poster.png && PATH=~/.nvm/versions/node/v24.2.0/bin:$PATH node experiments/3d-rps/companion-build.ts --write
// (the build refuses a GIF over MEDIA_CAPS.gif bytes; shrink it first, for example by keeping every other frame with ffmpeg).
// Needs node:module.stripTypeScriptTypes (Node 22.13+ or 23.2+; experimental, it prints one warning). It throws, and never skips,
// on a Node that lacks it.

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createLattice, gridHash, runSteps, stateHash } from "./rmf-lattice.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
export const LATTICE_PATH = resolve(HERE, "rmf-lattice.ts");
export const PAGE_PATH = resolve(HERE, "../../docs/3d-cyclic-rps-companion.html");

export const COPY_BEGIN = "// BEGIN rmf-lattice copy";
export const COPY_END = "// END rmf-lattice copy";
export const CHECK_BEGIN = "// BEGIN self-check values";
export const CHECK_END = "// END self-check values";

type Strip = (code: string, options: { mode: "strip" | "transform" }) => string;

/** node:module's type stripper; throws (a skipped check would pass vacuously) on a Node that does not have it. */
export function stripper(): Strip {
  const f = (nodeModule as unknown as { stripTypeScriptTypes?: Strip }).stripTypeScriptTypes;
  if (typeof f !== "function") {
    throw new Error("node:module.stripTypeScriptTypes is missing: the companion page's build step and test need Node 22.13+ or 23.2+ (this repo: PATH=~/.nvm/versions/node/v24.2.0/bin:$PATH)");
  }
  return f;
}

/** Step 2. */
export function withoutExports(source: string): string {
  const out = source.replace(/^export /gm, "");
  if (/^[ \t]*export\b/m.test(out)) throw new Error("the module has an export form the build step does not handle (`export { ... }`, `export default ...`)");
  return out;
}

/** Step 3: canonical JavaScript of a piece of code (TypeScript or JavaScript), ending in one newline. */
export function canonicalJs(code: string): string {
  return stripper()(code, { mode: "transform" }).replace(/\r\n/g, "\n").replace(/\s+$/, "") + "\n";
}

/** Steps 2 and 3 for the module: the text that goes between the page's markers. */
export function buildLatticeCopy(source: string = readFileSync(LATTICE_PATH, "utf8")): string {
  return canonicalJs(withoutExports(source));
}

/** The hash the test compares (see the header): of the module's text or of the page's block, each through the same two steps. */
export function codeHash(text: string): string {
  return createHash("sha256").update(canonicalJs(withoutExports(text))).digest("hex");
}

// ---------------------------------------------------------------------------------------------------------------------
// The page: markers
// ---------------------------------------------------------------------------------------------------------------------

function bounds(html: string, begin: string, end: string): { start: number; stop: number } {
  const b = html.indexOf(begin);
  if (b < 0) throw new Error(`marker not found: ${begin}`);
  if (html.indexOf(begin, b + 1) >= 0) throw new Error(`marker found twice: ${begin}`);
  const start = html.indexOf("\n", b) + 1;
  const e = html.indexOf(end, start);
  if (start === 0 || e < 0) throw new Error(`marker not found after ${begin}: ${end}`);
  if (html.indexOf(end, e + 1) >= 0) throw new Error(`marker found twice: ${end}`);
  return { start, stop: html.lastIndexOf("\n", e) + 1 };
}

/** The lines strictly between a BEGIN line and an END line (the BEGIN line may carry a note after the marker text). */
export function extractBlock(html: string, begin: string, end: string): string {
  const { start, stop } = bounds(html, begin, end);
  return html.slice(start, stop);
}

export function spliceBlock(html: string, begin: string, end: string, body: string): string {
  const { start, stop } = bounds(html, begin, end);
  return html.slice(0, start) + body + html.slice(stop);
}

// ---------------------------------------------------------------------------------------------------------------------
// The self-check values (step 5)
// ---------------------------------------------------------------------------------------------------------------------

export interface SelfCheck {
  seed: number;
  L: number;
  M: number;
  steps: number;
  firstFrame: string;
  afterSteps: string;
}

/** Run the module: the first frame of seed 900 at L 20, M 3e-4, and the state after 20,000 reaction steps. */
export function selfCheckValues(): SelfCheck {
  const seed = 900;
  const L = 20;
  const M = 3e-4;
  const steps = 20_000;
  const st = createLattice({ L, M, seed });
  const firstFrame = gridHash(st);
  runSteps(st, steps);
  return { seed, L, M, steps, firstFrame, afterSteps: stateHash(st) };
}

/** The line the page holds between the self-check markers. */
export function renderSelfCheck(v: SelfCheck): string {
  return `const SELF_CHECK = { seed: ${v.seed}, L: ${v.L}, M: ${v.M.toExponential()}, steps: ${v.steps}, firstFrame: "${v.firstFrame}", afterSteps: "${v.afterSteps}" };\n`;
}

// ---------------------------------------------------------------------------------------------------------------------
// The results: sources
// ---------------------------------------------------------------------------------------------------------------------

const REPO = resolve(HERE, "../..");
export const LATTICE_DIR = resolve(HERE, "results/lattice");
export const READOUT_PATH = resolve(HERE, "results/lattice-readout.md");
export const GATE0_PATH = resolve(HERE, "GATE0-RECORD.md");
export const EXP1_PATH = resolve(HERE, "GATE0-EXPLORATION.md");
export const EXP2_PATH = resolve(HERE, "GATE0-EXPLORATION-2.md");
export const MEDIA_DIR = resolve(REPO, "docs/3d-cyclic-rps-media");

/** Bytes on disk per media file, and of the whole page (media are inlined as base64, 4/3 of their size). */
export const MEDIA_CAPS = { gif: 2_200_000, png: 400_000 } as const;
export const PAGE_BUDGET = 6_300_000;
export const ANIM_256 = "anim-256-V-r64-s401.gif";
export const ANIM_256_POSTER = "anim-256-V-r64-s401-poster.png";
export const REBUILD_256 =
  "cp runs/rps/snapshots/anim-256-V-r64-s401.gif docs/3d-cyclic-rps-media/ && pngquant --force --quality 80-100 --output docs/3d-cyclic-rps-media/anim-256-V-r64-s401-poster.png runs/rps/snapshots/anim-256-V-r64-s401-poster.png && PATH=~/.nvm/versions/node/v24.2.0/bin:$PATH node experiments/3d-rps/companion-build.ts --write";

const repoPath = (p: string): string => relative(REPO, p).split("\\").join("/");
const sha256 = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const need = <T>(m: T | null | undefined, what: string): T => {
  if (m === null || m === undefined) throw new Error(`companion build: ${what} not found in its source`);
  return m;
};

/** The `### <title>` section of a record (to the next heading of level 2 or 3). */
function mdSection(md: string, titleStart: string): string {
  const at = md.indexOf(`\n### ${titleStart}`);
  if (at < 0) throw new Error(`companion build: section "### ${titleStart}" not found`);
  const rest = md.slice(at + 1);
  const next = rest.slice(4).search(/\n#{2,3} /);
  return next < 0 ? rest : rest.slice(0, next + 4);
}

/** The first markdown table in `text`, as rows of header -> cell. */
function mdTable(text: string): Record<string, string>[] {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith("|"));
  if (start < 0) throw new Error("companion build: a table was expected");
  const rows: string[][] = [];
  for (let i = start; i < lines.length && lines[i].startsWith("|"); i++) rows.push(lines[i].slice(1, -1).split("|").map((c) => c.trim()));
  const [head, , ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, j) => [h, r[j] ?? ""])));
}

const recordDate = (md: string): string => need(/^# .*\((\d{4}-\d{2}-\d{2})\)$/m.exec(md), "the record's date")[1];

// ---- Q1: the lattice ----

export interface LatticeCellFile {
  file: string;
  L: number;
  M: number;
  iM: number;
  k: number;
  R: number;
  se: number;
  finishedAt: string;
}

/** The rmf-cell/1 files of the registered sweep, sorted by L then M. */
export function readLatticeCells(dir: string = LATTICE_DIR): LatticeCellFile[] {
  const files = readdirSync(dir).filter((f) => /^L\d+-iM\d+\.json$/.test(f));
  return files
    .map((f) => {
      const j = JSON.parse(readFileSync(resolve(dir, f), "utf8"));
      if (j.format !== "rmf-cell/1") throw new Error(`companion build: ${f} is not rmf-cell/1`);
      const c: LatticeCellFile = { file: f, L: j.L, M: j.M, iM: j.iM, k: j.k, R: j.R, se: j.se, finishedAt: j.finishedAt };
      for (const [key, v] of Object.entries(c)) if (key !== "file" && key !== "finishedAt" && typeof v !== "number") throw new Error(`companion build: ${f}: ${key} is not a number`);
      return c;
    })
    .sort((a, b) => a.L - b.L || a.M - b.M);
}

export interface LatticeReadout {
  status: string;
  outcome: string;
  row: number;
  V: number;
  /** M_c as the readout prints it, and its value. */
  McText: string;
  Mc: number;
  McOverPaper: string;
  pairs: { L1: number; L2: number; valid: boolean; estimate: number | null }[];
  r3Delta: string;
}

/** The numbers of results/lattice-readout.md that the page shows. */
export function parseLatticeReadout(md: string): LatticeReadout {
  const st = need(/^status: (\w+); outcome (LAT-[A-Z]+)$/m.exec(md), "the lattice status line");
  const mc = need(/^V = (\d+) valid pairs; M_c = ([0-9.]+e[-+]?\d+); estimates [^;]+; M_c \/ 4\.5e-4 = ([0-9.]+)$/m.exec(md), "the M_c line");
  const row = need(/^\*\*row (\d): (LAT-[A-Z]+)\*\*$/m.exec(md), "the outcome row");
  const r3 = need(/^R3: P_ext\(60, 2e-3\) - P_ext\(60, 1e-5\) = ([0-9.]+) \(needs 0\.20\): yes$/m.exec(md), "the R3 line");
  if (row[2] !== st[2]) throw new Error(`companion build: the readout's status (${st[2]}) and outcome row (${row[2]}) differ`);
  const pairs = [...mdSection(md, "Main grid").matchAll(/^\| (\d+), (\d+) \| [^|]* \| (yes|no) \| ([0-9.e+-]+|-) \|$/gm)].map((m) => ({
    L1: Number(m[1]),
    L2: Number(m[2]),
    valid: m[3] === "yes",
    estimate: m[4] === "-" ? null : Number(m[4]),
  }));
  if (pairs.length === 0) throw new Error("companion build: the readout's pair table was not found");
  return { status: st[1], outcome: st[2], row: Number(row[1]), V: Number(mc[1]), McText: mc[2], Mc: Number(mc[2]), McOverPaper: mc[3], pairs, r3Delta: r3[1] };
}

// ---- Gate 0 and the two amendments ----

export interface Gate0Record {
  date: string;
  verdict: string;
  rungs: { rung: string; verdict: string; row: number; levels: number; gSpread: number[]; bMeter: number }[];
  jobs: number;
}

export function parseGate0Record(md: string): Gate0Record {
  const verdict = need(/^- \*\*Verdict: ([A-Z0-9-]+)\*\*/m.exec(md), "the Gate-0 verdict")[1];
  const final = need(/^### Verdict\n\n\*\*([A-Z0-9-]+)\*\*$/m.exec(md), "the readout's verdict")[1];
  if (final !== verdict) throw new Error(`companion build: the record's verdict ${verdict} is not the readout's ${final}`);
  const rungs = [...md.matchAll(/^### Rung (S\d): (.+?) \(row (\d)\)$/gm)].map((m) => {
    const sec = mdSection(md, `Rung ${m[1]}:`);
    const lv = need(/^B_meter = (\d+); G_spread = \[([\d, ]*)\]; levels = (\d+)/m.exec(sec), `the levels of rung ${m[1]}`);
    return { rung: m[1], verdict: m[2], row: Number(m[3]), bMeter: Number(lv[1]), gSpread: lv[2].split(",").map(Number), levels: Number(lv[3]) };
  });
  const jobs = mdTable(mdSection(md, "Gate-0 jobs")).length;
  return { date: recordDate(md), verdict, rungs, jobs };
}

export interface ScreenRow {
  spread: number;
  rate: number;
  classes: string[];
  dc: number;
  works: string;
}

export interface Exploration1Record {
  date: string;
  labels: { rung: string; kill: string; label: string; row: number }[];
  screens: { rung: string; rows: ScreenRow[]; kappaW: number; vCal: number }[];
  horizon: { spread: number; shape: string; classes: string[]; firstLoss: string[]; tCtl: string; h0: string };
  /** S0's mobility levels as the registered G0.2 gave them (the exploration screened three of them). */
  gSpread: number[];
}

export function parseExploration1(md: string): Exploration1Record {
  const labels = [...mdSection(md, "Labels").matchAll(/^- Rung (S0|V) \((.+?)\): \*\*(EXPLORATION-[A-Z0-9-]+) \(row (\d)\)\*\*$/gm)].map((m) => ({
    rung: m[1],
    kill: m[2],
    label: m[3],
    row: Number(m[4]),
  }));
  if (labels.length !== 2) throw new Error("companion build: Amendment 1 should have two labels");
  const screens = ["S0", "V"].map((rung) => {
    const sec = mdSection(md, `Rung ${rung} (`);
    const kw = need(/^kappa_w = (\d+); v_cal = (\d+)$/m.exec(sec), `kappa_w of rung ${rung}`);
    const rows = mdTable(sec).map((r) => ({ spread: Number(r.spread), rate: Number(r.rate), classes: r.classes.split(" "), dc: Number(r.DC), works: r.works }));
    return { rung, rows, kappaW: Number(kw[1]), vCal: Number(kw[2]) };
  });
  const h = need(
    /^G0\.4 horizon \(shared; spread (\d+), rate 0, shape (\S+)\): classes ([A-Z ]+); first sustained loss \(run step\) ([0-9inf, ]+); T_ctl (\w+); h0 (\w+)/m.exec(md),
    "the Amendment 1 horizon line",
  );
  const horizon = { spread: Number(h[1]), shape: h[2], classes: h[3].trim().split(" "), firstLoss: h[4].split(", "), tCtl: h[5], h0: h[6] };
  const gSpread = need(/^B_meter = \d+; G_spread = \[([\d, ]*)\]/m.exec(md), "S0's G_spread in Amendment 1")[1].split(",").map(Number);
  return { date: recordDate(md), labels, screens, horizon, gSpread };
}

export interface Exploration2Record {
  date: string;
  labels: { kill: string; rung: string; label: string }[];
  horizon: { seed: number; cls: string; firstLoss: string }[];
  tCtl: string;
  h0: string;
  confirm: { kill: string; seed: number; cls: string; chiFw: string; steps: number }[];
  persists: { kill: string; classes: string[]; dc: number; persists: string }[];
}

export function parseExploration2(md: string): Exploration2Record {
  const labels = [...mdSection(md, "Labels").matchAll(/^- (Removal|Vacancy) kill \(rung (S0|V)[^)]*\): \*\*(EXPLORATION-2-[A-Z0-9-]+)\*\*$/gm)].map((m) => ({
    kill: m[1].toLowerCase(),
    rung: m[2],
    label: m[3],
  }));
  if (labels.length !== 2) throw new Error("companion build: Amendment 2 should have two labels");
  const hsec = mdSection(md, "Horizon");
  const horizon = mdTable(hsec).map((r) => ({ seed: Number(r.seed), cls: r.class, firstLoss: r["first sustained loss (run step)"] }));
  const th = need(/^T_ctl (\w+); h0 (\w+)$/m.exec(hsec), "the Amendment 2 horizon line");
  const persists = ["Removal", "Vacancy"].map((K) => {
    const r = mdTable(mdSection(md, `${K} kill`))[0];
    return { kill: K.toLowerCase(), classes: r.classes.split(" "), dc: Number(r.DC), persists: r["persists (DC in at least 2 of 3)"] };
  });
  const confirm = mdTable(mdSection(md, "Amendment 2 jobs"))
    .filter((r) => r.stage === "g0.confirm")
    .map((r) => ({ kill: r.kill, seed: Number(r.seed), cls: r.class, chiFw: r.chi_fw, steps: Number(r.steps) }))
    .sort((a, b) => (a.kill < b.kill ? -1 : a.kill > b.kill ? 1 : a.seed - b.seed));
  return { date: recordDate(md), labels, horizon, tCtl: th[1], h0: th[2], confirm, persists };
}

// ---------------------------------------------------------------------------------------------------------------------
// The results: HTML
// ---------------------------------------------------------------------------------------------------------------------

export const RESULT_BLOCKS = ["summary", "lattice-pext", "gate0", "exploration-1", "exploration-2", "pictures", "data"] as const;
export type ResultBlock = (typeof RESULT_BLOCKS)[number];
export const resultBegin = (b: ResultBlock): string => `<!-- BEGIN result ${b} -->`;
export const resultEnd = (b: ResultBlock): string => `<!-- END result ${b} -->`;

const NUM_WORD = ["no", "one", "two", "three", "four", "five", "six"];
const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const int = (n: number): string => n.toLocaleString("en-US");
const stepText = (s: string): string => (s === "inf" ? "none" : int(Number(s)));
/** 3.03e-4 -> 3.03 × 10<sup>−4</sup> */
const sci = (text: string): string => {
  const [m, e] = text.split("e");
  return `${m} × 10<sup>${Number(e) < 0 ? "−" : ""}${Math.abs(Number(e))}</sup>`;
};

interface Source {
  path: string;
  sha256: string;
  date: string;
}
const sourceOf = (path: string, text: string, date: string): Source => ({ path: repoPath(path), sha256: sha256(text), date });
const prov = (s: Source): string => `<p class="prov">From <code>${esc(s.path)}</code> · sha256 <code title="${s.sha256}">${s.sha256.slice(0, 16)}…</code> · ${s.date}</p>`;

const SERIES = [
  { L: 20, color: "var(--sp1)", mark: "circle" },
  { L: 30, color: "var(--sp2)", mark: "square" },
  { L: 40, color: "var(--sp3)", mark: "triangle" },
  { L: 60, color: "var(--field-ink)", mark: "diamond" },
] as const;

function marker(kind: string, x: number, y: number, color: string): string {
  const f = (n: number) => n.toFixed(1);
  const style = `style="fill: ${color}"`;
  if (kind === "circle") return `<circle cx="${f(x)}" cy="${f(y)}" r="4" ${style}/>`;
  if (kind === "square") return `<rect x="${f(x - 3.6)}" y="${f(y - 3.6)}" width="7.2" height="7.2" ${style}/>`;
  if (kind === "triangle") return `<path d="M${f(x)} ${f(y - 4.8)}L${f(x + 4.6)} ${f(y + 3.4)}L${f(x - 4.6)} ${f(y + 3.4)}Z" ${style}/>`;
  return `<path d="M${f(x)} ${f(y - 5)}L${f(x + 5)} ${f(y)}L${f(x)} ${f(y + 5)}L${f(x - 5)} ${f(y)}Z" ${style}/>`;
}

/** The P_ext(M) chart: one curve per L, error bars of one add-one standard error, the pass band, the paper's M_c and the crossing. */
export function latticeChart(cells: readonly LatticeCellFile[], rd: LatticeReadout): string {
  const W = 640, H = 400, x0 = 58, x1 = 624, y0 = 34, y1 = 336;
  const lo = -5.12, hi = -2.6;
  const X = (m: number) => x0 + ((Math.log10(m) - lo) / (hi - lo)) * (x1 - x0);
  const Y = (p: number) => y1 - p * (y1 - y0);
  const f = (n: number) => n.toFixed(1);
  const out: string[] = [];
  out.push(`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="pext-title pext-desc">`);
  out.push(`<title id="pext-title">Extinction probability against mobility, for four lattice sizes</title>`);
  out.push(
    `<desc id="pext-desc">For each lattice side L of 20, 30, 40 and 60, the share of 600 runs that lost two of the three kinds, at 11 mobilities from 1e-5 to 2e-3 on a log scale. The curves cross at M_c = ${rd.McText}, inside the shaded registered pass band of 3e-4 to 6e-4; the paper's value is 4.5e-4. The numbers are in the table below the chart.</desc>`,
  );
  out.push(`<rect class="bg" x="0" y="0" width="${W}" height="${H}" rx="10"/>`);
  // the registered pass band, the paper's M_c, the crossing
  out.push(`<rect class="band" x="${f(X(3e-4))}" y="${y0}" width="${f(X(6e-4) - X(3e-4))}" height="${y1 - y0}"/>`);
  out.push(`<text class="lab band-lab" x="${f((X(3e-4) + X(6e-4)) / 2)}" y="${y0 - 8}" text-anchor="middle">registered pass band</text>`);
  for (const v of [0, 0.25, 0.5, 0.75, 1]) {
    out.push(`<line class="grid" x1="${x0}" x2="${x1}" y1="${f(Y(v))}" y2="${f(Y(v))}"/>`);
    out.push(`<text class="lab" x="${x0 - 8}" y="${f(Y(v) + 4)}" text-anchor="end">${v === 0 ? "0" : v === 1 ? "1" : String(v).slice(1)}</text>`);
  }
  for (const m of [...new Set(cells.map((c) => c.M))]) out.push(`<line class="tick" x1="${f(X(m))}" x2="${f(X(m))}" y1="${y1}" y2="${y1 + 5}"/>`);
  for (const [m, t] of [[1e-5, "10⁻⁵"], [1e-4, "10⁻⁴"], [1e-3, "10⁻³"]] as const) {
    out.push(`<line class="tick major" x1="${f(X(m))}" x2="${f(X(m))}" y1="${y1}" y2="${y1 + 9}"/>`);
    out.push(`<text class="lab" x="${f(X(m))}" y="${y1 + 24}" text-anchor="middle">${t}</text>`);
  }
  out.push(`<text class="lab" x="${f((x0 + x1) / 2)}" y="${H - 10}" text-anchor="middle">mobility M (log scale)</text>`);
  out.push(`<text class="lab" x="16" y="${f((y0 + y1) / 2)}" text-anchor="middle" transform="rotate(-90 16 ${f((y0 + y1) / 2)})">P_ext: runs that lost two kinds</text>`);
  out.push(`<line class="paper" x1="${f(X(4.5e-4))}" x2="${f(X(4.5e-4))}" y1="${y0}" y2="${y1}"/>`);
  out.push(`<text class="lab" x="${f(X(4.5e-4) + 4)}" y="${y1 - 8}">paper 4.5e-4</text>`);
  out.push(`<line class="mc" x1="${f(X(rd.Mc))}" x2="${f(X(rd.Mc))}" y1="${y0}" y2="${y1}"/>`);
  out.push(`<text class="lab mc-lab" x="${f(X(rd.Mc) - 6)}" y="${y0 + 22}" text-anchor="end">M_c ${rd.McText}</text>`);
  for (const p of rd.pairs) if (p.estimate !== null) out.push(`<line class="est" x1="${f(X(p.estimate))}" x2="${f(X(p.estimate))}" y1="${y0}" y2="${y0 + 8}"><title>pair ${p.L1}, ${p.L2}: ${p.estimate.toExponential(2)}</title></line>`);
  // the curves
  SERIES.forEach((s, i) => {
    const pts = cells.filter((c) => c.L === s.L);
    const dx = (i - 1.5) * 3;
    const line = pts.map((c, j) => `${j === 0 ? "M" : "L"}${f(X(c.M) + dx)} ${f(Y(c.k / c.R))}`).join("");
    out.push(`<g class="series" aria-hidden="true">`);
    out.push(`<path class="curve" d="${line}" style="stroke: ${s.color}"/>`);
    for (const c of pts) {
      const x = X(c.M) + dx, p = c.k / c.R;
      out.push(`<line class="err" x1="${f(x)}" x2="${f(x)}" y1="${f(Y(Math.min(1, p + c.se)))}" y2="${f(Y(Math.max(0, p - c.se)))}" style="stroke: ${s.color}"/>`);
      out.push(marker(s.mark, x, Y(p), s.color));
    }
    out.push(`</g>`);
  });
  // legend
  SERIES.forEach((s, i) => {
    const lx = x0 + 14, ly = y0 + 18 + i * 20;
    out.push(`<line class="curve" x1="${lx - 8}" x2="${lx + 8}" y1="${ly}" y2="${ly}" style="stroke: ${s.color}"/>${marker(s.mark, lx, ly, s.color)}`);
    out.push(`<text class="lab ink" x="${lx + 14}" y="${ly + 4}">L = ${s.L}</text>`);
  });
  out.push(`</svg>`);
  return out.join("\n");
}

function latticeTable(cells: readonly LatticeCellFile[]): string {
  const Ls = SERIES.map((s) => s.L);
  const Ms = [...new Set(cells.map((c) => c.M))].sort((a, b) => a - b);
  const head = `<tr><th scope="col"><i>M</i></th>${Ls.map((L) => `<th scope="col"><i>L</i> = ${L}</th>`).join("")}</tr>`;
  const body = Ms.map((m) => {
    const tds = Ls.map((L) => {
      const c = need(cells.find((x) => x.L === L && x.M === m), `lattice cell L ${L}, M ${m}`);
      return `<td>${c.k}/${c.R} = ${(c.k / c.R).toFixed(3)} ± ${c.se.toFixed(3)}</td>`;
    }).join("");
    return `<tr><th scope="row">${m.toExponential(2)}</th>${tds}</tr>`;
  }).join("\n");
  return `<div class="tablewrap"><table class="nums"><thead>${head}</thead><tbody>\n${body}\n</tbody></table></div>`;
}

function slotHead(title: string, where: string, status: string): string {
  return `<header><div><h4>${title}</h4><p class="where">${where}</p></div><span class="stat" data-role="status">${status}</span></header>`;
}

function latticeSlot(cells: readonly LatticeCellFile[], rd: LatticeReadout, src: Source): string {
  const est = rd.pairs.filter((p) => p.estimate !== null).map((p) => `${p.L1}/${p.L2} ${(p.estimate as number).toExponential(2)}`).join(", ");
  return `<article class="slot wide" id="slot-lattice-pext" data-slot="lattice-pext" data-state="filled" data-kind="registered">
  ${slotHead("Extinction probability against mobility", "Q1 · M3a · registered", `Registered · ${rd.outcome}`)}
  <p class="plain"><b>In plain words.</b> We ran the simple grid model 600 times at each of 11 mixing speeds and four grid sizes, and counted how often two of the three kinds died out. Slow mixing: the three live together, and more so on bigger grids. Fast mixing: they collapse, and more so on bigger grids. The curves for different sizes cross at about one mixing speed, the threshold. Ours is ${sci(rd.McText)}, inside the registered pass band (3 to 6 × 10<sup>−4</sup>) though near its lower edge, and ${rd.McOverPaper} of the paper's 4.5 × 10<sup>−4</sup>. So the model behaves as the paper says, to within the factor the plan allowed for.</p>
  <figure class="frame res chartbox" data-role="frame">
    ${prov(src)}
<div class="tablewrap chartscroll">
${latticeChart(cells, rd)}
</div>
    <figcaption>Points are <i>P</i><sub>ext</sub> = <i>k</i> / 600 at the 11 registered values of <i>M</i> (curves nudged sideways by a few pixels so the bars do not overlap); bars are ± one add-one standard error (rule 2.2). The shaded band is the registered pass band [3, 6] × 10<sup>−4</sup>. The solid line is <i>M</i><sub>c</sub>, the median of the ${rd.V} pair crossings (the short marks at the top: ${est}); the dashed line is the paper's value.</figcaption>
  </figure>
  <dl>
    <dt>Outcome</dt><dd><b>${rd.outcome}</b> (row ${rd.row} of rule 2.6): ${rd.V} of 6 pairs have a supported crossing, <i>M</i><sub>c</sub> = ${sci(rd.McText)} is in [3, 6] × 10<sup>−4</sup>, and R3 holds (<i>P</i><sub>ext</sub>(60, 2 × 10<sup>−3</sup>) − <i>P</i><sub>ext</sub>(60, 10<sup>−5</sup>) = ${rd.r3Delta}, needs 0.20). Registered and final.</dd>
    <dt>What it allows</dt><dd>Row 1 of rule 2.6 lets the visuals and the wording of rule 4.5 say "like the lattice reference". It says nothing about the kernel: the slab has no swap rate, so it has no <i>M</i><sub>c</sub> to compare.</dd>
    <dt>Read by</dt><dd>Rule 2.2 to 2.7, <code>readout-lattice.ts</code>; the chart is drawn from the ${cells.length} <code>rmf-cell/1</code> JSONs in <code>experiments/3d-rps/results/lattice/</code>.</dd>
  </dl>
  <details class="run"><summary>The numbers: <i>k</i> / <i>R</i> = <i>P</i><sub>ext</sub> ± add-one SE</summary>
${latticeTable(cells)}
  </details>
</article>`;
}

function gate0Slot(g: Gate0Record, src: Source): string {
  const rows = g.rungs
    .map((r) => `<tr><th scope="row">${r.rung}</th><td>${r.levels}</td><td>${r.gSpread.join(", ")}</td><td>${esc(r.verdict)}</td></tr>`)
    .join("\n");
  return `<article class="slot wide" id="slot-gate0" data-slot="gate0" data-state="filled" data-kind="registered">
  ${slotHead("Gate 0: which substrate can host a kill?", "Pilot · before M0 · registered", `Registered · ${g.verdict}`)}
  <p class="plain"><b>In plain words.</b> Before building the kill into the real simulation, a pilot asked whether its mixing knob gives enough different mixing speeds to look for a threshold. The rules asked for at least 5. Every substrate tried gave fewer, so the pilot stopped there, before any kill was switched on. No kill was tested by the registered pilot.</p>
  <div class="frame res" data-role="frame">
    ${prov(src)}
    <div class="tablewrap"><table class="nums"><thead><tr><th scope="col">rung</th><th scope="col">levels (needs 5)</th><th scope="col">spreads that count (<code>G_spread</code>)</th><th scope="col">verdict</th></tr></thead><tbody>
${rows}
</tbody></table></div>
  </div>
  <dl>
    <dt>Outcome</dt><dd><b>${g.verdict}</b> (rule 3.0): every substrate rung ended at verdict row 1, <code>levels &lt; 5</code>. Rung V (the vacancy kill) needs a substrate rung that passes row 1, so it did not run. Registered and final; ${g.jobs} pilot jobs.</dd>
    <dt>What follows</dt><dd>The registered kernel stages below (meter, calibration, sweep, snapshots, deep volume, longer cycles, mutation arms) cannot start. What ran next is the two explorations, under dated amendments.</dd>
    <dt>Read by</dt><dd>Rule 3.0, <code>readout-gate0.ts</code>.</dd>
  </dl>
</article>`;
}

function screenMatrix(s: Exploration1Record["screens"][number]): string {
  const rates = [...new Set(s.rows.map((r) => r.rate))].filter((r) => r !== 0);
  const spreads = [...new Set(s.rows.map((r) => r.spread))];
  const head = `<tr><th scope="col">spread</th>${rates.map((r) => `<th scope="col">rate ${r}</th>`).join("")}</tr>`;
  const body = spreads
    .map((sp) => {
      const tds = rates.map((rate) => {
        const r = need(s.rows.find((x) => x.spread === sp && x.rate === rate), `screen cell ${s.rung} ${sp} ${rate}`);
        const t = `${r.dc}/${r.classes.length}`;
        return r.works === "yes" ? `<td class="works"><b>${t}</b></td>` : `<td>${t}</td>`;
      });
      return `<tr><th scope="row">${sp}</th>${tds.join("")}</tr>`;
    })
    .join("\n");
  return `<div class="tablewrap"><table class="nums"><thead>${head}</thead><tbody>\n${body}\n</tbody></table></div>`;
}

function exploration1Slot(e: Exploration1Record, src: Source): string {
  const lab = (rung: string) => need(e.labels.find((l) => l.rung === rung), `label of ${rung}`);
  const works = (rung: string) => {
    const s = need(e.screens.find((x) => x.rung === rung), `screen of ${rung}`);
    const byRate = new Map<number, number[]>();
    for (const r of s.rows) if (r.works === "yes") byRate.set(r.rate, [...(byRate.get(r.rate) ?? []), r.spread]);
    return [...byRate].map(([rate, sps]) => `rate ${rate} at ${sps.length === 3 ? "all three spreads" : `spreads ${sps.join(" and ")}`}`).join("; ");
  };
  const losses = e.horizon.firstLoss.filter((x) => x !== "inf").map(stepText);
  const spreads = [...new Set(e.screens.flatMap((s) => s.rows.map((r) => r.spread)))].sort((a, b) => a - b);
  const skipped = e.gSpread.filter((g) => !spreads.includes(g));
  if (skipped.length !== 1) throw new Error("companion build: Amendment 1 should have left exactly one of S0's levels out");
  return `<article class="slot wide" id="slot-exploration-1" data-slot="exploration-1" data-state="exploration" data-kind="exploration">
  ${slotHead("Amendment 1: the kill at 128 × 128 × 4", "Exploration · after GATE-0-STOP · not a result", "Exploration · no horizon")}
  <p class="plain"><b>In plain words.</b> The pilot stopped, so we tried both kinds of kill anyway, as an exploration, at ${NUM_WORD[spreads.length]} of the ${NUM_WORD[e.gSpread.length]} mixing speeds the slab has (spreads ${spreads.join(", ").replace(/, (\d+)$/, " and $1")}; ${skipped.join(" and ")} was not screened). In short 20,000-step screens both kills did what a kill should: at the right rate the three kinds kept chasing each other round (class DC, a dynamic film with a cyclic signature) where the kill-free controls only churned. But a fair long test needs controls that keep all three kinds for long, and in this small world even the kill-free controls lost a kind by chance, at run steps ${losses.join(" and ")}. So no long test could tell a kill from luck, and none ran.</p>
  <div class="frame res" data-role="frame">
    ${prov(src)}
    <p class="tcap">Removal kill (rung S0): runs of class DC out of 3 seeds, by spread and kill rate; bold where the kill "works" (rule 3.0, row 2)</p>
${screenMatrix(need(e.screens.find((s) => s.rung === "S0"), "screen S0"))}
    <p class="tcap">Vacancy kill (rung V on S0), the same</p>
${screenMatrix(need(e.screens.find((s) => s.rung === "V"), "screen V"))}
  </div>
  <dl>
    <dt>Labels</dt><dd>Removal kill: <b>${lab("S0").label}</b> (row ${lab("S0").row}). Vacancy kill: <b>${lab("V").label}</b> (row ${lab("V").row}). Exploration labels under Amendment 1, never GO; nothing here passes Gate 0, and a label licenses nothing.</dd>
    <dt>Row 2, the kill's effect</dt><dd>Passed by both. Removal: ${works("S0")}. Vacancy: ${works("V")}.</dd>
    <dt>Row 3, the horizon</dt><dd>Failed by both. The shared rate-0 controls (spread ${e.horizon.spread}, ${e.horizon.shape.replace(/x/g, " × ")}, seeds 401 to 403) had their first sustained loss at run steps ${e.horizon.firstLoss.map(stepText).join(", ")}: <code>T_ctl</code> = ${stepText(e.horizon.tCtl)}, a quarter of it is under 50,000, so <code>h0</code> is ${e.horizon.h0}. The confirmation did not run.</dd>
  </dl>
</article>`;
}

function exploration2Slot(e: Exploration2Record, src: Source): string {
  const lab = (kill: string) => need(e.labels.find((l) => l.kill === kill), `label of ${kill}`).label;
  const per = (kill: string) => need(e.persists.find((p) => p.kill === kill), `confirmation of ${kill}`);
  const v = per("vacancy");
  const vDc = e.confirm.filter((c) => c.kill === "vacancy" && c.cls === "DC");
  const rows = e.confirm
    .map((c) => `<tr><th scope="row">${c.kill}</th><td>${c.seed}</td><td>${c.cls}</td><td>${int(c.steps)}</td><td>${c.cls === "DC" ? c.chiFw : "–"}</td></tr>`)
    .join("\n");
  const hrows = e.horizon.map((h) => `<tr><th scope="row">${h.seed}</th><td>${h.cls}</td><td>${h.firstLoss === "inf" ? "none" : int(Number(h.firstLoss))}</td></tr>`).join("\n");
  return `<article class="slot wide" id="slot-exploration-2" data-slot="exploration-2" data-state="exploration" data-kind="exploration">
  ${slotHead("Amendment 2: persistence at 256 × 256 × 4", "Exploration · after Amendment 1 · not a result", "Exploration · vacancy kill persists")}
  <p class="plain"><b>In plain words.</b> Chance losses slow down in a bigger world, so we made it four times larger and tried again. Now the kill-free controls kept all three kinds for the whole ${int(Number(e.h0))} steps, which allowed the long test. With the removal kill a kind died out on every seed. With the vacancy kill the three kinds kept chasing each other to the end on ${v.dc} of ${v.classes.length} seeds. "Persists" means only that: ${v.dc} of ${v.classes.length} seeds over ${int(Number(e.h0))} steps, at one world size and one kill rate.</p>
  <div class="frame res" data-role="frame">
    ${prov(src)}
    <p class="tcap">Horizon controls: spread 8, rate 0</p>
    <div class="tablewrap"><table class="nums"><thead><tr><th scope="col">seed</th><th scope="col">class</th><th scope="col">first sustained loss (run step)</th></tr></thead><tbody>
${hrows}
</tbody></table></div>
    <p class="tcap">Confirmation: spread 8, rate 64, up to ${int(Number(e.h0))} run steps (job steps include the 6,000-step burn-in)</p>
    <div class="tablewrap"><table class="nums"><thead><tr><th scope="col">kill</th><th scope="col">seed</th><th scope="col">class</th><th scope="col">job steps</th><th scope="col"><code>chi_fw</code> (DC only)</th></tr></thead><tbody>
${rows}
</tbody></table></div>
  </div>
  <dl>
    <dt>Labels</dt><dd>Removal kill: <b>${lab("removal")}</b> (${per("removal").dc} of 3 DC). Vacancy kill: <b>${lab("vacancy")}</b> (${v.dc} of 3 DC, <code>chi_fw</code> ${vDc.map((c) => c.chiFw).join(" and ")}). Exploration labels under Amendment 2, never GO; nothing here passes Gate 0, and a label licenses nothing.</dd>
    <dt>Horizon</dt><dd>All three controls kept every label: <code>T_ctl</code> ${e.tCtl === "inf" ? "infinite" : e.tCtl}, <code>h0</code> = ${int(Number(e.h0))}.</dd>
    <dt>What it would take</dt><dd>Building the vacancy kill into the kernel at this shape, and any cliff test along mobility, needs a further dated amendment and the user's go (A2.6). The slab still has only four mixing levels.</dd>
  </dl>
</article>`;
}

function summaryChips(rd: LatticeReadout, g: Gate0Record, e1: Exploration1Record, e2: Exploration2Record): string {
  const vac = need(e2.persists.find((p) => p.kill === "vacancy"), "vacancy persistence");
  const sameLabel = e1.labels.every((l) => l.label === e1.labels[0].label);
  return `<ul class="chips">
  <li class="chip reg">Lattice: ${rd.outcome} · registered</li>
  <li class="chip reg">Gate 0 pilot: ${g.verdict} · registered</li>
  <li class="chip expl">Amendment 1: ${sameLabel ? `${e1.labels[0].label} for both kills` : e1.labels.map((l) => l.label).join(", ")} · exploration</li>
  <li class="chip expl">Amendment 2: vacancy kill persists, ${vac.dc} of ${vac.classes.length} seeds · exploration</li>
  <li class="chip">Kernel cliff and mutation runs: not run</li>
</ul>
`;
}

// ---- the pictures ----

export interface Media {
  name: string;
  mime: "image/png" | "image/gif";
  bytes: Uint8Array;
  width: number;
  height: number;
}

/** A media file of the page: checked for its kind and its cap; null if it is absent. */
export function readMedia(dir: string, name: string): Media | null {
  const p = resolve(dir, name);
  if (!existsSync(p)) return null;
  const bytes = new Uint8Array(readFileSync(p));
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isGif = bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38;
  if (name.endsWith(".png") !== isPng || name.endsWith(".gif") !== isGif) throw new Error(`companion build: ${name} is not the image its name says`);
  const cap = isGif ? MEDIA_CAPS.gif : MEDIA_CAPS.png;
  if (bytes.length > cap) throw new Error(`companion build: ${name} is ${bytes.length} bytes, over its cap of ${cap}; shrink it first (a GIF: keep every other frame with ffmpeg; a PNG: pngquant)`);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = isPng ? dv.getUint32(16) : dv.getUint16(6, true);
  const height = isPng ? dv.getUint32(20) : dv.getUint16(8, true);
  return { name, mime: isPng ? "image/png" : "image/gif", bytes, width, height };
}

const dataUri = (m: Media): string => `data:${m.mime};base64,${Buffer.from(m.bytes).toString("base64")}`;
const img = (m: Media, alt: string): string => `<img src="${dataUri(m)}" width="${m.width}" height="${m.height}" alt="${esc(alt)}" loading="lazy" decoding="async">`;
/** What every picture's caption says about spirals: what the frames show and what their spacing cannot rule out (plain words). */
export const NO_SPIRALS = "No spirals were seen";
/**
 * An animation with its pause button. The page's script (wireAnimations) shows the GIF or the poster and swaps them on a click; under
 * prefers-reduced-motion it starts on the poster. Without the script the button stays hidden and CSS shows the poster to a reader who
 * asked for reduced motion.
 */
function animFigure(key: string, gif: Media, poster: Media, alt: string, caption: string): string {
  return `<figure class="pic" data-anim="${key}" data-playing="true">
    <div class="animbox">
      <img data-role="anim-gif" src="${dataUri(gif)}" width="${gif.width}" height="${gif.height}" alt="${esc(alt)}" loading="lazy" decoding="async">
      <img data-role="anim-poster" src="${dataUri(poster)}" width="${poster.width}" height="${poster.height}" alt="${esc(`Still sheet of the same run: ${alt}`)}" loading="lazy" decoding="async" hidden>
    </div>
    <button class="btn animbtn" type="button" data-role="anim-toggle" hidden>Pause animation</button>
    <figcaption>${caption}</figcaption>
  </figure>`;
}

function pictures(dir: string): string {
  const sheet = need(readMedia(dir, "cycling-sheet.png"), `${repoPath(resolve(dir, "cycling-sheet.png"))}`);
  const gif = need(readMedia(dir, "anim-V-sp8-r64.gif"), "anim-V-sp8-r64.gif");
  const poster = need(readMedia(dir, "anim-V-sp8-r64-poster.png"), "anim-V-sp8-r64-poster.png");
  const g256 = readMedia(dir, ANIM_256);
  const p256 = g256 ? need(readMedia(dir, ANIM_256_POSTER), `${ANIM_256_POSTER} (an animation needs its poster for the pause button)`) : null;
  const slot256 =
    g256 && p256
      ? animFigure(
          "256-V-r64-s401",
          g256,
          p256,
          "Animation of layer 0 under the vacancy kill at rate 64 and spread 8 in the 256 by 256 by 4 world, seed 401: left the kinds, right the cells that changed since the previous frame.",
          `<b>The bigger world.</b> The vacancy kill at rate 64, spread 8, seed 401, in the 256 × 256 × 4 world of Amendment 2 (layer 0), run steps 0 to 200,000, one frame every 2,000 steps. Left the kinds; right the cells that changed since the previous frame. Large patches take over from one another round the ring. ${NO_SPIRALS}. That is a look, not a test: one frame every 2,000 run steps at 256 × 256 × 4 cannot rule out a slow rotation between frames. Paused, it shows the still sheet of the same run. A re-run of the exploration job <code>g2-confirm-V-sp8-r64-s401</code>.`,
        )
      : `<figure class="pic pending" data-role="anim-256">
    <div class="frame">Being rendered: the 256 × 256 × 4 animation (a re-run of <code>g2-confirm-V-sp8-r64-s401</code>) is not in <code>docs/3d-cyclic-rps-media/</code> yet. The next build picks it up.</div>
    <figcaption><b>The bigger world.</b> To add it once it exists: <code>${esc(REBUILD_256)}</code></figcaption>
  </figure>`;
  return `<div class="pics">
  <figure class="pic">
    ${img(sheet, "Three rows of six square panels of layer 0 of the 128 by 128 by 4 slab, coloured by kind: a control with no kill, the removal kill at rate 64, and the vacancy kill at rate 256, from the founding to run step 20,000.")}
    <figcaption><b>Three runs side by side</b> (layer 0 of 4, 128 × 128 cells, orange, blue and yellow the three kinds, black empty). Top: no kill, the kinds drift as noise and rough patches. Middle: the removal kill at rate 64, spread 8; the patches grow large. Bottom: the vacancy kill at rate 256, spread 6; sharp fronts with emptied cells (black specks) behind them. ${NO_SPIRALS}. That is a look, not a test: five snapshots between run steps 0 and 20,000 cannot rule out a slow rotation between them. Re-runs of <code>g0-scan-S0-sp8-r0-s401</code> (the registered pilot), <code>g0-table-S0-sp8-r64-s401</code> and <code>g0-table-V-sp6-r256-s401</code> (Amendment 1).</figcaption>
  </figure>
  ${animFigure(
    "V-sp8-r64",
    gif,
    poster,
    "Animation of layer 0 under the vacancy kill at rate 64 and spread 8, seed 401: left the kinds, right the cells that changed since the previous frame. Whole-layer takeovers follow each other in rock-paper-scissors order.",
    `<b>Takeovers in rock-paper-scissors order.</b> The vacancy kill at rate 64, spread 8, seed 401 (128 × 128 × 4, layer 0), run steps 0 to 20,000, one frame every 200 steps. Left the kinds; right the cells that changed since the previous frame. One kind floods the layer, then the kind that eats it floods in behind, and so on round the ring. ${NO_SPIRALS}. That is a look, not a test: one frame every 200 run steps at 128 × 128 × 4 cannot rule out a slow rotation between frames. Paused, it shows the still sheet of the same run. A re-run of <code>g0-table-V-sp8-r64-s401</code> (Amendment 1).`,
  )}
  ${slot256}
</div>
`;
}

// ---- the results-data block ----

function resultsData(entries: Record<string, unknown>): string {
  const slots: Record<string, unknown> = {};
  for (const k of ["lattice-pext", "gate0", "exploration-1", "exploration-2", "meter", "calibration", "sweep", "snapshots", "deep", "cycles", "mutation"]) slots[k] = entries[k] ?? null;
  const json = JSON.stringify(
    {
      format: "rps-companion-results/2",
      contract:
        "Written by experiments/3d-rps/companion-build.ts. A slot is null until a source file fills it. A filled slot is { kind: registered | exploration, label, file, sha256, date: YYYY-MM-DD, data } and its article shows file, hash and date. An exploration is never a registered result.",
      slots,
    },
    null,
    1,
  ).replace(/</g, "\\u003c");
  return `<script type="application/json" id="results-data">\n${json}\n</script>\n`;
}

export interface ResultsInput {
  mediaDir?: string;
}

/** The bodies of the result blocks, from the committed sources. */
export function buildResults(opts: ResultsInput = {}): Record<ResultBlock, string> {
  const mediaDir = opts.mediaDir ?? MEDIA_DIR;
  const cells = readLatticeCells();
  const readoutText = readFileSync(READOUT_PATH, "utf8");
  const rd = parseLatticeReadout(readoutText);
  const latDate = cells.map((c) => c.finishedAt.slice(0, 10)).sort().at(-1) as string;
  const gText = readFileSync(GATE0_PATH, "utf8");
  const e1Text = readFileSync(EXP1_PATH, "utf8");
  const e2Text = readFileSync(EXP2_PATH, "utf8");
  const g = parseGate0Record(gText);
  const e1 = parseExploration1(e1Text);
  const e2 = parseExploration2(e2Text);
  const src = {
    lat: sourceOf(READOUT_PATH, readoutText, latDate),
    g: sourceOf(GATE0_PATH, gText, g.date),
    e1: sourceOf(EXP1_PATH, e1Text, e1.date),
    e2: sourceOf(EXP2_PATH, e2Text, e2.date),
  };
  const entry = (kind: string, label: string, s: Source, data: unknown) => ({ kind, label, file: s.path, sha256: s.sha256, date: s.date, data });
  const data = resultsData({
    "lattice-pext": entry("registered", rd.outcome, src.lat, { Mc: rd.McText, V: rd.V, pairs: rd.pairs, cells: cells.map(({ L, M, k, R }) => ({ L, M, k, R })) }),
    gate0: entry("registered", g.verdict, src.g, { rungs: g.rungs }),
    "exploration-1": entry("exploration", e1.labels.map((l) => `${l.rung} ${l.label}`).join("; "), src.e1, { labels: e1.labels, horizon: e1.horizon }),
    "exploration-2": entry("exploration", e2.labels.map((l) => `${l.kill} ${l.label}`).join("; "), src.e2, { labels: e2.labels, persists: e2.persists, confirm: e2.confirm }),
  });
  return {
    summary: summaryChips(rd, g, e1, e2),
    "lattice-pext": latticeSlot(cells, rd, src.lat) + "\n",
    gate0: gate0Slot(g, src.g) + "\n",
    "exploration-1": exploration1Slot(e1, src.e1) + "\n",
    "exploration-2": exploration2Slot(e2, src.e2) + "\n",
    pictures: pictures(mediaDir),
    data,
  };
}

/** The page as this Node would write it. */
export function buildPage(html: string, opts: ResultsInput = {}): string {
  let out = spliceBlock(html, COPY_BEGIN, COPY_END, buildLatticeCopy());
  out = spliceBlock(out, CHECK_BEGIN, CHECK_END, renderSelfCheck(selfCheckValues()));
  const blocks = buildResults(opts);
  for (const b of RESULT_BLOCKS) out = spliceBlock(out, resultBegin(b), resultEnd(b), blocks[b]);
  const size = Buffer.byteLength(out, "utf8");
  if (size > PAGE_BUDGET) throw new Error(`companion build: the page would be ${size} bytes, over the budget of ${PAGE_BUDGET}`);
  return out;
}

function main(argv: string[]): number {
  const write = argv.includes("--write");
  const html = readFileSync(PAGE_PATH, "utf8");
  const next = buildPage(html);
  const size = `${(Buffer.byteLength(next, "utf8") / 1e6).toFixed(2)} MB`;
  const has256 = existsSync(resolve(MEDIA_DIR, ANIM_256)) ? "with" : "without (being rendered)";
  if (next === html) {
    console.log(`companion page: the lattice copy, the self-check values and the result blocks are what this Node writes (${size}, ${has256} the 256 animation)`);
    return 0;
  }
  if (!write) {
    console.log("companion page: the copy, the values or the result blocks differ from what this Node writes (a layout difference between Nodes is possible; the test compares hashes). Run with --write to rewrite them.");
    return 1;
  }
  writeFileSync(PAGE_PATH, next);
  console.log(`companion page: rewrote the lattice copy (${buildLatticeCopy().split("\n").length - 1} lines), the self-check values and the result blocks (${size}, ${has256} the 256 animation)`);
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
