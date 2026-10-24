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
// Run:  PATH=~/.nvm/versions/node/v24.2.0/bin:$PATH node experiments/3d-rps/companion-build.ts [--write]
//       without --write it only reports whether the page's block and values are what this Node would write (exit 1 if not).
// Needs node:module.stripTypeScriptTypes (Node 22.13+ or 23.2+; experimental, it prints one warning). It throws, and never skips,
// on a Node that lacks it.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { dirname, resolve } from "node:path";
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

/** The page as this Node would write it. */
export function buildPage(html: string): string {
  const withCopy = spliceBlock(html, COPY_BEGIN, COPY_END, buildLatticeCopy());
  return spliceBlock(withCopy, CHECK_BEGIN, CHECK_END, renderSelfCheck(selfCheckValues()));
}

function main(argv: string[]): number {
  const write = argv.includes("--write");
  const html = readFileSync(PAGE_PATH, "utf8");
  const next = buildPage(html);
  if (next === html) {
    console.log("companion page: the lattice copy and the self-check values are what this Node writes");
    return 0;
  }
  if (!write) {
    console.log("companion page: the copy or the values differ from what this Node writes (a layout difference between Nodes is possible; the test compares hashes). Run with --write to rewrite them.");
    return 1;
  }
  writeFileSync(PAGE_PATH, next);
  console.log(`companion page: rewrote the lattice copy (${buildLatticeCopy().split("\n").length - 1} lines) and the self-check values`);
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
