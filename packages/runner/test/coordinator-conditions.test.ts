// The coordinator (apps/coordinator, which cannot import this package) keeps hand-written copies of the runner's
// conditions: config.exs's `:conditions` (what an experiment may name) and `:incompatible` (condition => presets it
// cannot be applied to), and Coordinator.Queue's `incompatible/3`, which adds two dynamic rules (a breeder condition
// needs a preset in `:pond_presets`; "no-migration" needs tile migration or a metapopulation) and its
// `@breed_condition_prefixes`, which gate the breeder's conditions to islands with "breed-v1". A pair the coordinator
// accepts but the runner refuses would fail on every island it is handed to; one it refuses but the runner accepts is
// work the archipelago cannot run. This fails as soon as either side moves without the other
// (docs/archipelago-breed-2026-10-18.md).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { POND_SCORES, validateConfig } from "@bl/schema";
import { CONDITIONS, specConfig, type RunSpec } from "@bl/runner";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const configExs = read("../../../apps/coordinator/config/config.exs");
const queueEx = read("../../../apps/coordinator/lib/coordinator/queue.ex");

/** The words of the `~w(...)` sigil that `key:` is bound to in config.exs (the sigil may span lines). */
function words(key: string): string[] {
  const m = configExs.match(new RegExp(`^\\s*${key}:\\s*~w\\(([^)]*)\\)`, "m"));
  if (!m) throw new Error(`no ${key}: ~w(...) in config.exs`);
  return m[1].split(/\s+/).filter(Boolean);
}

/** The body of the `%{...}` map that `key:` is bound to in config.exs (values may hold one level of braces or a sigil). */
function mapBody(key: string): string {
  const m = configExs.match(new RegExp(`^\\s*${key}:\\s*%\\{((?:[^{}]|\\{[^{}]*\\})*)\\}`, "m"));
  if (!m) throw new Error(`no ${key}: %{...} in config.exs`);
  return m[1];
}

/** config.exs's `:incompatible`: condition => the presets it is refused on. */
function incompatibleTable(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [, condition, presets] of mapBody("incompatible").matchAll(/"([a-z0-9+-]+)"\s*=>\s*~w\(([^)]*)\)/g)) out[condition] = presets.split(/\s+/).filter(Boolean);
  return out;
}

/** The presets config.exs's `:migration_period` names with a non-zero period. */
function migrating(): string[] {
  return [...mapBody("migration_period").matchAll(/"([a-z0-9-]+)"\s*=>\s*([\d_]+)/g)].filter(([, , v]) => Number(v.replace(/_/g, "")) > 0).map(([, p]) => p);
}

/** Queue's `@breed_condition_prefixes`. */
function breedPrefixes(): string[] {
  const m = queueEx.match(/^\s*@breed_condition_prefixes\s+~w\(([^)]*)\)/m);
  if (!m) throw new Error("no @breed_condition_prefixes ~w(...) in queue.ex");
  return m[1].split(/\s+/).filter(Boolean);
}

interface Facts {
  incompatible: Record<string, string[]>;
  pondPresets: string[];
  migrating: string[];
  prefixes: string[];
}

/** What Queue.validate/1 refuses for one (preset, condition) of a spec without a metapopulation: incompatible/3's rules. */
function coordinatorRefuses(f: Facts, preset: string, condition: string): boolean {
  if (condition === "no-migration") return !f.migrating.includes(preset);
  const breed = f.prefixes.some((p) => condition.startsWith(p));
  return (f.incompatible[condition] ?? []).includes(preset) || (breed && !f.pondPresets.includes(preset));
}

/** What the runner refuses for the same pair: specConfig throws, or validateConfig names an error. */
function runnerRefuses(preset: string, condition: string): boolean {
  const spec: RunSpec = { experiment: "sync", presetId: preset, condition, seed: 1, steps: 100, censusEvery: 100, deepEvery: 10, checkpointEvery: 0 };
  try {
    return validateConfig(specConfig(spec)).length > 0;
  } catch {
    return true;
  }
}

/** Every accepted (preset, condition) on which the two sides disagree, as "preset/condition: coordinator X, runner Y". */
function mismatches(f: Facts): string[] {
  const out: string[] = [];
  for (const preset of words("presets"))
    for (const condition of words("conditions")) {
      const c = coordinatorRefuses(f, preset, condition), r = runnerRefuses(preset, condition);
      if (c !== r) out.push(`${preset}/${condition}: coordinator ${c ? "refuses" : "accepts"}, runner ${r ? "refuses" : "accepts"}`);
    }
  return out;
}

const facts = (): Facts => ({ incompatible: incompatibleTable(), pondPresets: words("pond_presets"), migrating: migrating(), prefixes: breedPrefixes() });
const breederIds = POND_SCORES.flatMap((s) => [`pond-breed-${s}`, `pond-mass-${s}`, `pond-drift-${s}`]);

describe("coordinator conditions", () => {
  it("every condition config.exs accepts is a runner condition", () => {
    const known = CONDITIONS.map((c) => c.id);
    for (const id of words("conditions")) expect(known).toContain(id);
  });

  it("config.exs accepts all 21 breeder conditions (pond-breed/mass/drift x POND_SCORES), and not the hunt's arms", () => {
    expect(breederIds).toHaveLength(21);
    const accepted = words("conditions");
    for (const id of breederIds) expect(accepted).toContain(id);
    expect(accepted).not.toContain("pond-nat");
    expect(accepted).not.toContain("pond-shuf");
  });

  it("queue.ex's @breed_condition_prefixes match exactly the runner conditions that set pondScore", () => {
    const prefixes = breedPrefixes();
    const base = specConfig({ experiment: "sync", presetId: "ponds-small", condition: "treatment", seed: 1, steps: 0, censusEvery: 100, deepEvery: 10, checkpointEvery: 0 });
    const setsScore = (apply: (typeof CONDITIONS)[number]["apply"]) => {
      try {
        return apply(base).pondScore !== undefined;
      } catch {
        return false; // a control that needs what a pond preset lacks (uniform-light, fixed-env)
      }
    };
    const scored = CONDITIONS.filter((c) => setsScore(c.apply)).map((c) => c.id);
    expect(scored.sort()).toEqual([...breederIds].sort());
    expect(CONDITIONS.map((c) => c.id).filter((id) => prefixes.some((p) => id.startsWith(p))).sort()).toEqual(scored);
  });

  it("the coordinator refuses exactly what the runner refuses, on every accepted preset x condition", () => {
    expect(mismatches(facts())).toEqual([]);
  });

  it("...and that check catches a table that drifts", () => {
    const f = facts();
    // pond-cont on the breeder: the runner refuses it (arm cont with a pondScore), so dropping the row is caught.
    const loose = { ...f, incompatible: { ...f.incompatible, "pond-cont": f.incompatible["pond-cont"].filter((p) => p !== "breeder") } };
    expect(mismatches(loose)).toEqual(["breeder/pond-cont: coordinator accepts, runner refuses"]);
    // Without the prefix rule every breeder condition on a non-pond preset would be accepted.
    expect(mismatches({ ...f, prefixes: [] }).length).toBeGreaterThanOrEqual(21);
    // A pond preset forgotten in :pond_presets refuses work the runner can do.
    expect(mismatches({ ...f, pondPresets: f.pondPresets.filter((p) => p !== "breeder") })).toContain("breeder/pond-breed-drive: coordinator refuses, runner accepts");
  });
});
