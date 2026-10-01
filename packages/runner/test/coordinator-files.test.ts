// The coordinator keeps two hand-written copies of this package's verified
// file list: Coordinator.Segment's @observation_files ++
// @optional_observation_files (what a verify attempt's file digests are
// compared on) and CoordinatorWeb.ApiController's @observation_files (which
// names a verify completion may report at all). A file missing from either is
// silently never compared, or refused at completion, so this fails as soon as
// either copy disagrees with stitch.ts.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { OBSERVATION_FILES, VERIFIED_FILES } from "../src/stitch.ts";

const SEGMENT_EX = "../../../apps/coordinator/lib/coordinator/segment.ex";
const API_CONTROLLER_EX = "../../../apps/coordinator/lib/coordinator_web/controllers/api_controller.ex";
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

/** The words of the `~w(...)` sigil bound to module attribute `@name` in Elixir `source`. */
function wordList(source: string, name: string): string[] {
  const m = source.match(new RegExp(`^\\s*@${name}\\s+~w\\(([^)]*)\\)`, "m"));
  if (!m) throw new Error(`no @${name} ~w(...) list`);
  return m[1].split(/\s+/).filter(Boolean);
}

const sorted = (xs: readonly string[]) => [...xs].sort();

/** Every way the two Elixir sources disagree with stitch.ts's lists (empty when in lockstep). */
function drift(segment: string, api: string): string[] {
  const required = wordList(segment, "observation_files");
  const optional = wordList(segment, "optional_observation_files");
  const allowed = wordList(api, "observation_files");
  const out: string[] = [];
  const check = (what: string, got: readonly string[], want: readonly string[]) => {
    if (JSON.stringify(sorted(got)) !== JSON.stringify(sorted(want))) out.push(`${what}: ${sorted(got).join(" ")} != ${sorted(want).join(" ")}`);
  };
  // manifest.json is never compared (timestamps, host): stitch.ts drops it
  // from OBSERVATION_FILES, and the Elixir lists never carry it.
  check("Segment @observation_files vs OBSERVATION_FILES", required, OBSERVATION_FILES);
  check("Segment @observation_files ++ @optional_observation_files vs VERIFIED_FILES", [...required, ...optional], VERIFIED_FILES);
  check("ApiController @observation_files vs Segment's union", allowed, [...required, ...optional]);
  for (const [what, xs] of [["Segment", [...required, ...optional]], ["ApiController", allowed]] as const)
    if (new Set(xs).size !== xs.length) out.push(`${what} lists a file twice`);
  return out;
}

describe("coordinator verified files", () => {
  const segment = read(SEGMENT_EX);
  const api = read(API_CONTROLLER_EX);

  it("stitch.ts's VERIFIED_FILES carries every optional log, and never manifest.json", () => {
    expect(VERIFIED_FILES).toContain("ponds.tsv");
    expect(VERIFIED_FILES).not.toContain("manifest.json");
  });

  it("segment.ex and api_controller.ex list exactly stitch.ts's verified files", () => {
    expect(drift(segment, api)).toEqual([]);
  });

  it("is caught when either Elixir list drifts (sanity check on the check itself)", () => {
    /** `source` with `@name`'s ~w(...) words replaced by `f(words)`. */
    const rewrite = (source: string, name: string, f: (words: string[]) => string[]) => {
      const out = source.replace(new RegExp(`^(\\s*@${name}\\s+~w\\()([^)]*)\\)`, "m"), (_, head: string, words: string) => `${head}${f(words.split(/\s+/).filter(Boolean)).join(" ")})`);
      expect(out).not.toBe(source);
      return out;
    };
    const noPonds = (ws: string[]) => ws.filter((w) => w !== "ponds.tsv");
    expect(drift(rewrite(segment, "optional_observation_files", noPonds), api)).not.toEqual([]);
    expect(drift(segment, rewrite(api, "observation_files", noPonds))).not.toEqual([]);
    expect(drift(segment, rewrite(api, "observation_files", (ws) => [...ws, "ponds.tsv"]))).not.toEqual([]);
    // Optional on the Elixir side only, required in stitch.ts (or the reverse), is drift too.
    const moved = rewrite(rewrite(segment, "optional_observation_files", noPonds), "observation_files", (ws) => [...ws, "ponds.tsv"]);
    expect(drift(moved, api)).not.toEqual([]);
  });
});
