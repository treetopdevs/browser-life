// The transitive local source closure of an entry file: every repo file reachable through relative imports and `@bl/*` aliases.
// meta.json's source hash covers all of it, so a change to the simulator, schema, metrics or a helper the harness runs changes the hash.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { sha256Text } from "../propose.ts";

const SPEC = /(?:^|\n)\s*(?:import|export)\s[^"'`;]*?from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;

/** Resolves an import specifier from `fromFile` to a repo file, or null for an external/builtin module. */
export function resolveLocal(root: string, fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("./") || spec.startsWith("../")) base = resolve(dirname(fromFile), spec);
  else if (spec.startsWith("@bl/")) base = join(root, "packages", spec.slice(4), "src/index.ts");
  else return null;
  for (const c of [base, base + ".ts", join(base, "index.ts")]) if (existsSync(c) && /\.(ts|js|mjs)$/.test(c)) return c;
  throw new Error(`cannot resolve ${JSON.stringify(spec)} from ${relative(root, fromFile)}`);
}

/** Repo-relative paths of the closure, sorted. */
export function sourceClosure(root: string, entries: readonly string[]): string[] {
  const seen = new Set<string>();
  const stack = entries.map((e) => resolve(root, e));
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(SPEC)) {
      const spec = m[1] ?? m[2] ?? m[3];
      const r = spec ? resolveLocal(root, f, spec) : null;
      if (r && !seen.has(r)) stack.push(r);
    }
  }
  return [...seen].map((f) => relative(root, f)).sort();
}

/** Resolver configuration and dependency identities that decide what a specifier means: hashed alongside the sources. */
export const RESOLVER_CONFIG_FILES = ["deno.json", "package.json", "tsconfig.json"] as const;

/** Bare (non-local) specifiers the closure imports, e.g. `node:fs` or `fflate`: recorded so a silently skipped external is still named. */
export function externalSpecifiers(root: string, files: readonly string[]): string[] {
  const out = new Set<string>();
  for (const f of files) {
    for (const m of readFileSync(join(root, f), "utf8").matchAll(SPEC)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (spec && !spec.startsWith("./") && !spec.startsWith("../") && !spec.startsWith("@bl/")) out.add(spec);
    }
  }
  return [...out].sort();
}

/**
 * The hash covers the closure's files, the resolver configuration (deno.json import map and npm pins, package.json, tsconfig.json
 * paths) and the sorted list of external specifiers, so changing what `@bl/*` or `fflate` resolves to changes the hash.
 */
export function sourceClosureHash(root: string, entries: readonly string[]): { sha256: string; files: string[]; config: string[]; externals: string[] } {
  const files = sourceClosure(root, entries);
  const config = RESOLVER_CONFIG_FILES.filter((c) => existsSync(join(root, c)));
  const externals = externalSpecifiers(root, files);
  const parts = [...files, ...config].map((f) => `${f}\n${sha256Text(readFileSync(join(root, f), "utf8"))}`);
  return { sha256: sha256Text([...parts, `externals\n${externals.join(",")}`].join("\n")), files, config, externals };
}
