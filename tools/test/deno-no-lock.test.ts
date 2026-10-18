// Every test that starts deno passes --no-lock first ("run", "--no-lock", "-A", ... or "eval", "--no-lock", ...), so a
// test run never rewrites deno.lock (packages/runner/test/hunt-stitch.test.ts once did, adding a package.json dependency
// the lock had not caught up with). A launcher or coordinator a test starts that runs deno itself gets a PATH shim adding
// the flag (tests/deno/lib/no_lock_deno.ts). What is checked: an argv array whose deno subcommand (run, eval, test, check, cache)
// is followed by a deno flag or a script path rather than --no-lock, a shell string that starts deno without it, and a
// file that starts a coordinator (`"mix"` and `"phx.server"` in its code: the discovery validator runs deno from PATH)
// without putting a noLockDenoBin directory first on that PATH (`x = await noLockDenoBin(...)` and ``PATH: `${x}:``
// at least once per `"phx.server"`). Servers are counted in the raw text, so a commented-out start still counts; the shim
// evidence is read with comments blanked (a `//` or `/*` inside a string, template or regex is no comment). A `/` the
// blanker misreads (a regex after `)` or `}`, a division after `++` or a string) can at worst blank real evidence, so a
// shimmed file is flagged, or keep a commented-out PATH on that same line as evidence.
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

/** A word after which a `/` starts a regex literal, not a division. */
const BEFORE_REGEX = /(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/;
/**
 * `//` and `/* *\/` comments blanked (newlines kept, so lines still count), read token by token: a comment marker
 * inside a string, a template (and the code in its `${}`) or a regex literal is not a comment, so
 * `"status // up"; new Deno.Command("mix", ...)` keeps its command. A `/` after a value (a word, a number, `)`, `]`,
 * `}`) is a division; anywhere else it starts a regex literal.
 */
const uncommented = (text: string): string => {
  let out = "";
  let i = 0;
  /** The `{` still open in each `${}` we are inside, innermost last. */
  const braces: number[] = [];
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  /** From just inside a template to just past its closing backtick, or just past a `${`. */
  const template = () => {
    while (i < text.length) {
      const c = text[i];
      if (c === "\\") { out += text.slice(i, i + 2); i += 2; continue; }
      if (c === "`") { out += c; i++; return; }
      if (c === "$" && text[i + 1] === "{") { out += "${"; i += 2; braces.push(0); return; }
      out += c;
      i++;
    }
  };
  const previous = () => {
    let k = out.length - 1;
    while (k >= 0 && /\s/.test(out[k])) k--;
    return out.slice(Math.max(0, k - 12), k + 1);
  };
  while (i < text.length) {
    const c = text[i];
    const d = text[i + 1];
    if (c === "/" && d === "/") {
      const end = text.indexOf("\n", i);
      const stop = end < 0 ? text.length : end;
      out += blank(text.slice(i, stop));
      i = stop;
    } else if (c === "/" && d === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? text.length : end + 2;
      out += blank(text.slice(i, stop));
      i = stop;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c && text[j] !== "\n") j += text[j] === "\\" ? 2 : 1;
      j = Math.min(j + 1, text.length);
      out += text.slice(i, j);
      i = j;
    } else if (c === "`") {
      out += c;
      i++;
      template();
    } else if (c === "}" && braces.length > 0 && braces[braces.length - 1] === 0) {
      braces.pop();
      out += c;
      i++;
      template();
    } else if (c === "/" && (!/[\w$)\]}]$/.test(previous()) || BEFORE_REGEX.test(previous()))) {
      let j = i + 1;
      let inClass = false;
      while (j < text.length && text[j] !== "\n") {
        if (text[j] === "\\") { j += 2; continue; }
        if (text[j] === "[") inClass = true;
        else if (text[j] === "]") inClass = false;
        else if (text[j] === "/" && !inClass) break;
        j++;
      }
      j = Math.min(j + 1, text.length);
      out += text.slice(i, j);
      i = j;
    } else {
      if (braces.length > 0 && c === "{") braces[braces.length - 1]++;
      else if (braces.length > 0 && c === "}") braces[braces.length - 1]--;
      out += c;
      i++;
    }
  }
  return out;
};
/** A coordinator started, in any argument order: `"mix"` in the code and each `"phx.server"` literal
 * (`new Deno.Command("mix", { cwd, args: ["phx.server"] })`, `spawn("mix", ["phx.server"])`, `["mix", "phx.server"]`). */
const MIX = /(["'])mix\1/;
const PHX_SERVER = /(["'])phx\.server\1/g;
const SHIM_IMPORT = /import\s*\{[^}]*\bnoLockDenoBin\b[^}]*\}\s*from\s*["'][^"']*no_lock_deno\.ts["']/;
const SHIM_DIR = /\b([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?noLockDenoBin\(/g;
/** The `"phx.server"` lines of a file whose coordinators do not all get the shim first on PATH: servers found in the
 * raw `text` (no blanker misread can hide one), the shim's import, directories and PATH entries in comment-free `code`. */
const unshimmed = (text: string, code: string): number[] => {
  const servers = MIX.test(text) ? [...text.matchAll(PHX_SERVER)] : [];
  if (servers.length === 0) return [];
  const dirs = SHIM_IMPORT.test(code) ? [...new Set([...code.matchAll(SHIM_DIR)].map((m) => m[1]))] : [];
  const onPath = dirs.reduce((n, d) => n + [...code.matchAll(new RegExp(String.raw`\bPATH\s*:\s*\`\$\{${d.replace(/\$/g, "\\$")}\}:`, "g"))].length, 0);
  return onPath >= servers.length ? [] : servers.map((m) => lineOf(text, m.index));
};

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
    for (const line of unshimmed(text, uncommented(text))) found.add(line);
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
    // a coordinator started: the shim's directory goes first on its PATH
    const imp = `import { noLockDenoBin } from "./lib/no_lock_deno.ts";\n`;
    const make = "const bin = await noLockDenoBin(`${tmp}/bin`);\n";
    const env = "env: { PATH: `${bin}:${Deno.env.get(\"PATH\")}` },";
    const server = (opts = "") => `new Deno.Command("mix", {\n  args: ["phx.server"],\n  cwd: dir,${opts}\n})`;
    expect(violations(`const x = 1;\n${server()}`)).toEqual([3]); // the "phx.server" line
    expect(violations(`spawn("mix", ["phx.server"])`)).toEqual([1]);
    expect(violations(`new Deno.Command("mix", { cwd, args: ["phx.server"] })`)).toEqual([1]);
    expect(violations(`runBounded(["mix", "phx.server"], opts)`)).toEqual([1]);
    expect(violations(`${imp}${server()}`)).toEqual([3]);
    expect(violations(`${imp}${make}${server()}`)).toEqual([4]); // shim made, not on PATH
    expect(violations(`${imp}// ${make}${server(env)}`)).toEqual([4]); // the call commented out
    expect(violations(`${imp}/* ${make}*/${server(env)}`)).toEqual([4]);
    expect(violations(`${imp}${make}${server(env)}\n${server()}`)).toEqual([4, 8]); // two servers, one PATH
    expect(violations(`${make}${server(env)}`)).toEqual([3]); // not the shared helper
    expect(violations(`${imp}${make}${server(env)}`)).toEqual([]);
    expect(violations(`${imp}let bin = "";\nbin = await noLockDenoBin(d);\nfetch("http://x"); ${server(env)}`)).toEqual([]);
    expect(violations(`new Deno.Command("mix", { args: ["test", "test/x_test.exs"] })`)).toEqual([]);
    // a comment marker in a string, a template or a regex literal is not a comment: the command after it still counts
    const start = `new Deno.Command("mix", { args: ["phx.server"] }).spawn();`;
    expect(violations(`const note = "status // available"; ${start}`)).toEqual([1]);
    expect(violations(`const note = 'status // available'; ${start}`)).toEqual([1]);
    expect(violations("const note = `status // ${up ? `a//b` : \"c\"} available`; " + start)).toEqual([1]);
    expect(violations(`const a = "/*";\n${start}\nconst b = "*/";`)).toEqual([2]);
    expect(violations(`const re = /[/]{2}/; ${start}`)).toEqual([1]);
    expect(violations(`const re = /a\\/\\/b/g; ${start}`)).toEqual([1]);
    expect(violations(`let a = 4;\nconst n = a++ / 2; const note = "status /// available"; ${start}`)).toEqual([2]);
    expect(violations(`if (ok) /[/*]/.test(input);\n${start}`)).toEqual([2]);
    // a commented-out start still counts (servers are read in the raw text); comments are no shim evidence
    expect(violations(`const half = n / 2; // ${start}`)).toEqual([1]);
    const shimmed = 'new Deno.Command("mix", { args: ["phx.server"], env: { PATH: `${bin}:${p}` } });';
    expect(violations(`${imp}${make}const half = n / 2; // ${shimmed}\n${shimmed}`)).toEqual([3, 4]);
    expect(violations(`${imp}${make}${shimmed}\n${shimmed}`)).toEqual([]);
    // a regex literal holding `//` or `/*` keeps the evidence after it
    expect(violations(`${imp}const re = /[//]/; ${make}${server(env)}`)).toEqual([]);
    expect(violations(`${imp}const re = /[/*]/; ${make}${server(env)}\nconst b = "*/";`)).toEqual([]);
    expect(violations(`${imp}return /x/.test(s); // ${make}${server(env)}`)).toEqual([4]); // the regex, then a real comment
    // one directory assigned twice is one directory: its single PATH covers one server
    const again = "bin = await noLockDenoBin(`${tmp}/bin2`);\n";
    expect(violations(`${imp}${make}${server(env)}\n${again}${server()}`)).toEqual([4, 9]);
  });

  it("no test file starts deno without it", () => {
    const all = ROOTS.flatMap(files);
    expect(all.length).toBeGreaterThan(50);
    const found = all.flatMap((f) => violations(readFileSync(join(REPO, f), "utf8"), f.endsWith(".sh")).map((line) => `${f}:${line}`));
    expect(found).toEqual([]);
  });
});
