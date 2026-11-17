import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import config from "../vite.config";

const lab = join(dirname(fileURLToPath(import.meta.url)), "..");
// Bumped deliberately when a page is added to or dropped from vite.config.ts.
const DECLARED_INPUTS = 43;

it("every rollup input html has an icon link whose href is served", () => {
  const input = config.build?.rollupOptions?.input as Record<string, string>;
  const files = Object.values(input);
  expect(files.length).toBe(DECLARED_INPUTS);
  const bad: string[] = [];
  for (const file of files) {
    const html = readFileSync(file, "utf8");
    const tag = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).find((t) => /\brel=["']?icon["']?(?=[\s>/"])/i.test(t));
    const href = tag?.match(/\bhref=["']([^"']+)["']/i)?.[1];
    if (!href || !href.startsWith("/") || !existsSync(join(lab, "public", href.split(/[?#]/)[0]))) bad.push(relative(lab, file));
  }
  expect(bad).toEqual([]);
});
