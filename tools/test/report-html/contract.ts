// Shared page-contract assertions for every track renderer's test file
// (tools/test/report-html/{nullcal,individuality,anticipation,biogeography}.test.ts).
// Not itself a `*.test.ts` file -- vitest's `include` glob only picks up
// `tools/test/**/*.test.ts`, so this module is a plain helper imported by
// those test files (and by contract.test.ts, which tests the helper itself).
//
// `assertPageContract` re-checks, mechanically, the structural page-design rules that apply to every page
// regardless of track: fragment-only (no doctype/html/head/body, starts with
// <title> then <style>), exactly one DATA STATUS chip with the right label,
// the expected figure count numbered in order, no external resource besides
// fonts.googleapis.com, every CSS token used inside an <svg> is declared in
// the bare `:root` block, no literal hex colour anywhere inside an <svg>,
// every SVG shape has an explicit `fill`, and both required dark blocks are
// present with `color-scheme: dark`.
//
// It deliberately does NOT check per-fixture data fidelity (design contract
// test (h): "every plotted number/label in the numbers table matches the
// fixture's own values byte-for-byte") -- that depends on each track's own
// fixture and belongs in that track's own test file.
import { expect } from "vitest";

import type { DataStatus } from "../../lib/report-html/page.ts";

export interface PageContractOptions {
  status: DataStatus;
  /** Expected number of `<figure>` elements, numbered 1..figureCount in
   * document order. */
  figureCount: number;
}

const SVG_BLOCK_RE = /<svg[\s\S]*?<\/svg>/g;
const SELF_STYLED_SHAPE_RE = /<(circle|rect|ellipse|polygon|path)\b[^>]*>/g;

export function assertPageContract(html: string, opts: PageContractOptions): void {
  assertFragmentShape(html);
  assertStatusChip(html, opts.status);
  assertKeyNumbers(html);
  assertFigureCount(html, opts.figureCount);
  assertOnlyAllowedExternalUrls(html);
  assertSvgTokensDefined(html);
  assertNoLiteralHexInSvg(html);
  assertEverySvgShapeHasExplicitFill(html);
  assertBothDarkBlocksPresent(html);
}

/** Every page must render the mechanical "Key numbers" `<dl>` (see
 * tools/lib/report-html/page.ts's `keyNumbersList`/`header`) and must NOT
 * still carry the old free-form ".finding" paragraph container the
 * architecture rewrite replaced it with -- a renderer that still builds a
 * `.finding` div is a renderer that regressed back to interpretive prose. */
function assertKeyNumbers(html: string): void {
  expect(html, 'missing the header\'s "Key numbers" <dl> (class="key-numbers")').toMatch(
    /<dl class="key-numbers">/,
  );
  expect(html, 'must not contain the old free-form finding container (class="finding")').not.toMatch(
    /class="finding"/,
  );
}

function assertFragmentShape(html: string): void {
  expect(html.startsWith("<title>"), "page must start with <title>").toBe(true);
  const titleEnd = html.indexOf("</title>");
  expect(titleEnd, "must contain a closing </title>").toBeGreaterThan(-1);
  const afterTitle = html.slice(titleEnd + "</title>".length).trimStart();
  expect(afterTitle.startsWith("<style>"), "<style> must immediately follow <title>").toBe(true);
  expect(html.slice(0, 8192), "<title> must be within the first 8KB").toContain("<title>");
  for (const forbidden of [/<!doctype/i, /<html[\s>]/i, /<head[\s>]/i, /<body[\s>]/i]) {
    expect(html, `must not contain a document-level tag matching ${forbidden}`).not.toMatch(forbidden);
  }
}

function assertStatusChip(html: string, status: DataStatus): void {
  const cls = `status-chip status-${status.toLowerCase()}`;
  const count = html.split(`class="${cls}"`).length - 1;
  expect(count, `exactly one status chip with class "${cls}"`).toBe(1);
  const noteMatch = html.match(/<span class="status-chip-note">([^<]*)<\/span>/);
  expect(noteMatch, "status chip must include a non-empty note").not.toBeNull();
  expect((noteMatch?.[1] ?? "").trim().length, "status chip note must be non-empty").toBeGreaterThan(0);
}

function assertFigureCount(html: string, expected: number): void {
  const tagCount = (html.match(/<figure\b/g) ?? []).length;
  expect(tagCount, `expected ${expected} <figure> elements`).toBe(expected);
  const numbers = [...html.matchAll(/<strong>Figure (\d+)\.<\/strong>/g)].map((m) => Number(m[1]));
  expect(numbers, "figures must be numbered 1..n in document order").toEqual(
    Array.from({ length: expected }, (_, i) => i + 1),
  );
}

function assertOnlyAllowedExternalUrls(html: string): void {
  // Strip SVG namespace declarations first (e.g. xmlns="http://www.w3.org/2000/svg",
  // xmlns:xlink="http://www.w3.org/1999/xlink") -- these are namespace URIs,
  // not network resources the page loads, so they don't count as "external
  // URLs" under this rule.
  const stripped = html.replace(/\sxmlns(:[\w-]+)?="[^"]*"/g, "");
  const urls = stripped.match(/https?:\/\/[^\s"')]+/g) ?? [];
  for (const u of urls) {
    expect(u.startsWith("https://fonts.googleapis.com/"), `external URL not allowed: ${u}`).toBe(true);
  }
}

/** Matches the bare `:root { ... }` block only -- the negative lookahead
 * excludes `:root:not(...) { ... }` and `:root[data-theme="dark"] { ... }`,
 * both of which start with the literal text ":root" too. */
const BARE_ROOT_RE = /:root(?!:|\[)\s*\{([^}]*)\}/;

function bareRootTokens(html: string): Set<string> {
  const block = html.match(BARE_ROOT_RE)?.[1] ?? "";
  const names = new Set<string>();
  for (const m of block.matchAll(/--([\w-]+)\s*:/g)) names.add(m[1]);
  return names;
}

function assertSvgTokensDefined(html: string): void {
  const rootTokens = bareRootTokens(html);
  expect(rootTokens.size, "bare :root block must declare at least one token").toBeGreaterThan(0);
  const svgBlocks = html.match(SVG_BLOCK_RE) ?? [];
  const used = new Set<string>();
  for (const block of svgBlocks) {
    for (const m of block.matchAll(/var\(--([\w-]+)\)/g)) used.add(m[1]);
  }
  for (const token of used) {
    expect(rootTokens.has(token), `SVG references var(--${token}) with no matching --${token}: in the bare :root block`).toBe(true);
  }
}

function assertNoLiteralHexInSvg(html: string): void {
  const svgBlocks = html.match(SVG_BLOCK_RE) ?? [];
  for (const block of svgBlocks) {
    expect(block, "no literal hex colour inside <svg>").not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  }
}

function assertEverySvgShapeHasExplicitFill(html: string): void {
  const svgBlocks = html.match(SVG_BLOCK_RE) ?? [];
  for (const block of svgBlocks) {
    for (const tag of block.match(SELF_STYLED_SHAPE_RE) ?? []) {
      expect(tag, `every SVG shape needs an explicit fill: ${tag}`).toMatch(/\bfill=/);
    }
  }
}

function assertBothDarkBlocksPresent(html: string): void {
  expect(html, "missing @media (prefers-color-scheme: dark) block").toContain(
    "@media (prefers-color-scheme: dark)",
  );
  expect(html, 'missing :root:not([data-theme="light"]) block with color-scheme: dark').toMatch(
    /:root:not\(\[data-theme="light"\]\)\s*\{[^}]*color-scheme:\s*dark/,
  );
  expect(html, 'missing :root[data-theme="dark"] block with color-scheme: dark').toMatch(
    /:root\[data-theme="dark"\]\s*\{[^}]*color-scheme:\s*dark/,
  );
}
