// Source closure of the discovery case runner (DESIGN section 4: "Pin the
// source closure, not only Git HEAD, because dirty jj workspaces are common").
//
// The closure is the runtime import graph of packages/runner/src/discovery.ts,
// resolved through deno.json's import map, plus deno.json and deno.lock
// themselves. `import type` lines are erased at runtime and are not followed.
// Its digest is SHA-256 over the canonical JSON list of [path, sha256] pairs,
// sorted by repository-relative path, so it depends only on bytes.
//
// Uses node: APIs only, so Deno (tools) and Node (the Vite config that builds
// the browser worker page) compute the same value.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { pinClosureFiles } from "./discovery-pin.ts";

export const CLOSURE_ENTRY = "packages/runner/src/discovery.ts";
const EXTRA = ["deno.json", "deno.lock"];

const IMPORT_RE = /^\s*(?:import|export)\s+(?!type\s)(?:[^;'"]*?\sfrom\s+)?["']([^"']+)["']/gm;

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Repository-relative paths of the closure, sorted. */
export function closureFiles(repoRoot: string): string[] {
  const map = (JSON.parse(readFileSync(join(repoRoot, "deno.json"), "utf8")) as { imports: Record<string, string> }).imports;
  const seen = new Set<string>();
  const stack = [resolve(repoRoot, CLOSURE_ENTRY)];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(IMPORT_RE)) {
      const spec = m[1];
      let target: string | null = null;
      if (spec.startsWith(".")) target = resolve(dirname(file), spec);
      else if (map[spec] && map[spec].startsWith(".")) target = resolve(repoRoot, map[spec]);
      // Bare npm/jsr specifiers are pinned by deno.lock, which is in the closure.
      if (target) stack.push(target);
    }
  }
  // The vendored construction pin (D5) and the scripts that run it are part of every build's closure.
  return [...new Set([...[...seen].map((f) => relative(repoRoot, f)), ...EXTRA, ...pinClosureFiles(repoRoot)].map((p) => p.split("\\").join("/")))].sort();
}

export function closureDigest(repoRoot: string): { digest: string; files: { path: string; sha256: string }[] } {
  const files = closureFiles(repoRoot).map((path) => ({ path, sha256: sha256(readFileSync(join(repoRoot, path))) }));
  // Canonical JSON of an array of objects with sorted keys (path, sha256).
  const text = JSON.stringify(files.map((f) => ({ path: f.path, sha256: f.sha256 })));
  return { digest: sha256(new TextEncoder().encode(text)), files };
}
