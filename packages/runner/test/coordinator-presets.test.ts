// The coordinator (apps/coordinator, a separate app that cannot import
// packages/schema) keeps hand-written copies of a few preset facts in
// config.exs: each preset's world size (`:world_size`, which refuses a
// scheduled lesion or feed centred outside the world at experiment creation),
// the pond presets and their periods (`:pond_presets`, `:pond_period`) and the
// migration periods (`:migration_period`), each used to refuse at creation
// what the runner would otherwise throw on, on every island. This fails as
// soon as any copy disagrees with packages/schema's PRESETS.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PRESETS, defaultConfig, worldH, worldW } from "@bl/schema";

const CONFIG_EXS = "../../../apps/coordinator/config/config.exs";
const source = readFileSync(fileURLToPath(new URL(CONFIG_EXS, import.meta.url)), "utf8");

/** The words of the `~w(...)` sigil that `key:` is bound to in config.exs. */
function words(key: string): string[] {
  const m = source.match(new RegExp(`^\\s*${key}:\\s*~w\\(([^)]*)\\)`, "m"));
  if (!m) throw new Error(`no ${key}: ~w(...) in config.exs`);
  return m[1].split(/\s+/).filter(Boolean);
}

/**
 * The `"preset" => value` pairs of the `%{...}` map that `key:` is bound to in config.exs, values parsed by `parse`.
 * The map's body runs from its opening brace to the first `}` that closes it: a value may itself be a one-level
 * tuple (`{256, 256}`), nothing deeper.
 */
function map<T>(key: string, parse: (raw: string) => T): Record<string, T> {
  const m = source.match(new RegExp(`^\\s*${key}:\\s*%\\{((?:[^{}]|\\{[^{}]*\\})*)\\}`, "m"));
  if (!m) throw new Error(`no ${key}: %{...} in config.exs`);
  const out: Record<string, T> = {};
  for (const [, preset, raw] of m[1].matchAll(/"([a-z0-9-]+)"\s*=>\s*(\{[^{}]*\}|[^,\n]+)/g)) out[preset] = parse(raw.trim());
  return out;
}

const int = (raw: string) => Number(raw.replace(/_/g, ""));
const pair = (raw: string): [number, number] => {
  const m = raw.match(/^\{\s*([\d_]+)\s*,\s*([\d_]+)\s*\}$/);
  if (!m) throw new Error(`not a {w, h} tuple: ${raw}`);
  return [int(m[1]), int(m[2])];
};
const cfgOf = (id: string) => {
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`config.exs names a preset packages/schema does not have: ${id}`);
  return { ...defaultConfig(), ...preset.cfg };
};

describe("coordinator preset facts", () => {
  const presets = words("presets");

  it("every preset the coordinator accepts exists in packages/schema", () => {
    for (const id of presets) expect(PRESETS.map((p) => p.id)).toContain(id);
  });

  it(":world_size is each accepted preset's tileW * tilesX by tileH * tilesY, and names no other preset", () => {
    const sizes = map("world_size", pair);
    expect(Object.keys(sizes).sort()).toEqual([...presets].sort());
    for (const [id, [w, h]] of Object.entries(sizes)) {
      const cfg = cfgOf(id);
      expect([id, w, h]).toEqual([id, worldW(cfg), worldH(cfg)]);
    }
  });

  it(":pond_presets and :pond_period are exactly the accepted presets with a pond cycle, at their pondPeriod", () => {
    const withPonds = presets.filter((id) => cfgOf(id).pondPeriod !== undefined).sort();
    expect([...words("pond_presets")].sort()).toEqual(withPonds);
    const periods = map("pond_period", int);
    expect(Object.keys(periods).sort()).toEqual(withPonds);
    for (const id of withPonds) expect([id, periods[id]]).toEqual([id, cfgOf(id).pondPeriod]);
  });

  it(":migration_period is exactly the accepted presets with tile migration, at their migrationPeriod", () => {
    const migrating = presets.filter((id) => (cfgOf(id).migrationPeriod ?? 0) > 0).sort();
    const periods = map("migration_period", int);
    expect(Object.keys(periods).sort()).toEqual(migrating);
    for (const id of migrating) expect([id, periods[id]]).toEqual([id, cfgOf(id).migrationPeriod]);
  });
});
