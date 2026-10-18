// Every test that starts deno passes --no-lock first ("run", "--no-lock", "-A", ... or "eval", "--no-lock", ...), so a
// test run never rewrites deno.lock (packages/runner/test/hunt-stitch.test.ts once did, adding a package.json dependency
// the lock had not caught up with). A launcher or coordinator a test starts that runs deno itself gets a PATH shim adding
// the flag (tests/deno/lib/no_lock_deno.ts). What is checked: an argv array whose deno subcommand (run, eval, test, check, cache)
// is followed by a deno flag or a script path rather than --no-lock, and a shell string that starts deno without it.
// An argv inside an assertion (`toEqual(["deno", "run", "-A", ...])`) pins what a tool records, not what a test runs,
// and is left alone; so is a tool's own `run` subcommand (`tool(["run", "--root", R])`), whose flags are not deno's.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const ROOTS = ["tools/test", "apps/lab/test", "experiments/test", "tests/deno", "tests/e2e", ...readdirSync(join(REPO, "packages")).map((p) => `packages/${p}/test`)];
const SELF = "tools/test/deno-no-lock.test.ts";

const files = (dir: string): string[] => {
  let entries: string[];
  try { entries = readdirSync(join(REPO, dir)); } catch { return []; }
  return entries.flatMap((name) => {
    const rel = `${dir}/${name}`;
    if (statSync(join(REPO, rel)).isDirectory()) return files(rel);
    return /\.(ts|mts|js|mjs|sh)$/.test(name) && rel !== SELF ? [rel] : [];
  });
};

/** Flags only deno takes (permissions, checking, locking), so a tool's own `run` subcommand is not mistaken for deno
 * (--config is left out: `caddy run --config` is not deno). */
const DENO_FLAG = String.raw`-A|-[RWNESIP](?:=[^"]*)?|--(?:allow|deny)-[a-z-]+(?:=[^"]*)?|--unstable[a-z-]*|-q|--quiet|--no-check|--check(?:=[^"]*)?|--reload(?:=[^"]*)?|-r|--frozen(?:=[^"]*)?|--lock(?:=[^"]*)?|--import-map(?:=[^"]*)?|--node-modules-dir(?:=[^"]*)?|--cached-only|--no-prompt|--no-config|--no-remote|--no-npm|--env-file(?:=[^"]*)?|--v8-flags=[^"]*|--seed(?:=[^"]*)?|--location(?:=[^"]*)?|--inspect[a-z-]*(?:=[^"]*)?|--watch[a-z-]*(?:=[^"]*)?`;
const SUB = "run|test|check|cache";
const ARGV = [
  // ["run", "-A", ...], ["run", "--allow-read", ...], ["run", "tools/x.ts", ...], [..."test", "-A"...]
  new RegExp(String.raw`"(?:${SUB})"\s*,\s*"(?:${DENO_FLAG}|[^"\s]+\.(?:ts|mts|js|mjs))"`, "g"),
  // ["eval", code]: eval is deno's whatever follows
  /"eval"\s*,(?!\s*"--no-lock")/g,
];
/** A shell string starting deno: `deno run -A ...` passed to a shell (exec/execSync, sh -c, a .sh helper). Each command
 * of the string (split at `&&`, `||`, `|`, `;`, `$(`) is checked on its own, so one command's --no-lock covers no other. */
const SHELL_ARG = /(?:\b(?:execSync|exec)\(|"-c"\s*,)\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
const STARTS_DENO = new RegExp(String.raw`(?:^|[\s(])deno\s+(?:${SUB}|eval)\b`);
const unlocked = (command: string) => command.split(/&&|\|\||[|;]|\$\(/).some((c) => STARTS_DENO.test(c) && !/--no-lock\b/.test(c));
/** An argv array the test only compares against: `toEqual(["deno", "run", "-A", ...])` and its kin. */
const ASSERTED = /(?:toEqual|toStrictEqual|toMatchObject|toContain|toBe)\(\s*\[\s*(?:"deno"\s*,\s*)?$/;

const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;
const violations = (text: string, shell = false): number[] => {
  const found = new Set<number>();
  for (const re of ARGV) {
    for (const m of text.matchAll(re)) {
      if (!ASSERTED.test(text.slice(Math.max(0, m.index - 120), m.index))) found.add(lineOf(text, m.index));
    }
  }
  if (shell) {
    text.split("\n").forEach((line, i) => {
      if (unlocked(line.replace(/(?:^|\s)#.*$/, ""))) found.add(i + 1);
    });
  } else {
    for (const m of text.matchAll(SHELL_ARG)) if (unlocked(m[2])) found.add(lineOf(text, m.index));
  }
  return [...found].sort((a, b) => a - b);
};

describe("tests that start deno pass --no-lock", () => {
  it("the check finds what it should and passes what it should", () => {
    // started without it
    expect(violations(`run("deno", ["run", "-A", "tools/stitch.ts"])`)).toEqual([1]);
    expect(violations(`spawnSync("deno", ["run", "--allow-all", "tools/stitch.ts"])`)).toEqual([1]);
    expect(violations(`spawnSync("deno", ["run", "tools/stitch.ts"])`)).toEqual([1]);
    expect(violations(`spawnSync("deno", ["test", "-A", "x_test.ts"])`)).toEqual([1]);
    expect(violations(`spawnSync("deno", ["check", "tools/run.ts"])`)).toEqual([1]);
    expect(violations(`runBounded(["deno", "run", "-A", "tools/run.ts"], opts)`)).toEqual([1]);
    expect(violations(`execFileSync("deno", [\n  "eval",\n  "code"])`)).toEqual([2]);
    expect(violations("execSync(`deno run -A tools/run.ts --out ${o}`)")).toEqual([1]);
    expect(violations(`spawnSync("sh", ["-c", "cd x && deno run -A tools/run.ts"])`)).toEqual([1]);
    expect(violations(`#!/bin/sh\nset -e\ndeno run -A tools/run.ts "$@"\n`, true)).toEqual([3]);
    expect(violations(`execSync("deno run -A x.ts && deno run --no-lock -A y.ts")`)).toEqual([1]);
    expect(violations(`execSync("deno run --no-lock -A x.ts; deno run -A y.ts")`)).toEqual([1]);
    expect(violations(`#!/bin/sh\nout=$(deno run -A a.ts) || deno run --no-lock b.ts\n`, true)).toEqual([2]);
    // started with it
    expect(violations(`run("deno", ["run", "--no-lock", "-A", "tools/stitch.ts"])`)).toEqual([]);
    expect(violations(`execFileSync("deno", [\n  "eval",\n  "--no-lock",\n  "code"])`)).toEqual([]);
    expect(violations("execSync(`deno run --no-lock -A tools/run.ts`)")).toEqual([]);
    expect(violations(`execSync("cd x && deno run --no-lock -A a.ts && deno eval --no-lock 1")`)).toEqual([]);
    expect(violations(`#!/bin/sh\ndeno run --no-lock -A tools/run.ts\n# deno run -A in a comment\n`, true)).toEqual([]);
    // not deno: assertions on recorded argv, a tool's own run subcommand, a command line a test only reads
    expect(violations(`expect(argv).toEqual(["deno", "run", "-A", "tools/run.ts"])`)).toEqual([]);
    expect(violations(`expect(w.slice(0, 5), c.id).toEqual(["deno", "run", "-A", "tools/x.ts", "export"])`)).toEqual([]);
    expect(violations(`tool(["run", "--root", R])`)).toEqual([]);
    expect(violations(`propose(["run", file, "--out", "rel-forks", "--print"])`)).toEqual([]);
    expect(violations(`expect(s.cmd).toBe("deno run -A tools/run.ts --out runs/x")`)).toEqual([]);
    expect(violations(`spawn("caddy", ["run", "--config", file, "--adapter", "caddyfile"])`)).toEqual([]);
  });

  it("no test file starts deno without it", () => {
    const all = ROOTS.flatMap(files);
    expect(all.length).toBeGreaterThan(50);
    const found = all.flatMap((f) => violations(readFileSync(join(REPO, f), "utf8"), f.endsWith(".sh")).map((line) => `${f}:${line}`));
    expect(found).toEqual([]);
  });
});
