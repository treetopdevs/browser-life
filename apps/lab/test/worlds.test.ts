// The world catalogue (apps/lab/src/worlds.ts) must cover every preset and say nothing it cannot back: every
// preset has a note and one family, every trait is read off the preset's own config, and no label, detail or note
// leaks a config key, a file path or a code name into what a visitor reads.
import { describe, expect, it } from "vitest";
import { PRESETS, defaultConfig } from "@bl/schema";
import { FAMILIES, FIRST_WORLDS, REGISTERED, START_HERE, WORLD_NOTES, byId, familyOf, worldDiff, worldStatus, worldTraits, type Lever } from "../src/worlds.ts";

const ids = PRESETS.map((p) => p.id);
const preset = (id: string) => {
  const p = byId(id);
  if (!p) throw new Error(`no preset ${id}`);
  return p;
};
/** Code names a visitor should never meet: camelCase config keys, file paths, rule-version and milestone labels, raw ids. */
const jargon = /\b[a-z]+[A-Z][A-Za-z]+\b|packages\/|tools\/|docs\/|RULE_VERSION|\bcfg\b|\bM3\b|\bM4\b|gradient-m3|spots-m3|own-[a-z]|wild-storm|pondArm|pondScore/;
const labelsOf = (lever: Lever, id: string) => worldTraits(preset(id)).filter((t) => t.lever === lever);

describe("coverage", () => {
  it("every preset has a note, and every note names a preset", () => {
    for (const id of ids) expect(WORLD_NOTES[id], `note for ${id}`).toBeDefined();
    for (const id of Object.keys(WORLD_NOTES)) expect(ids, `preset for note ${id}`).toContain(id);
  });

  it("every preset sits in exactly one family, in the preset list's order within a family's siblings", () => {
    const seen = new Map<string, number>();
    for (const f of FAMILIES) for (const id of f.ids) seen.set(id, (seen.get(id) ?? 0) + 1);
    for (const id of ids) expect(seen.get(id), `family for ${id}`).toBe(1);
    for (const id of seen.keys()) expect(ids).toContain(id);
  });

  it("Start here names existing worlds, each once, and every base is another existing world", () => {
    const picks = START_HERE.map((s) => s.id);
    expect(new Set(picks).size).toBe(picks.length);
    for (const id of picks) expect(ids).toContain(id);
    for (const [id, note] of Object.entries(WORLD_NOTES)) {
      if (note.base === undefined) continue;
      expect(ids, `base of ${id}`).toContain(note.base);
      expect(note.base).not.toBe(id);
    }
  });

  it("the first worlds are the pinned prefix of the preset list, and the registered ones are among them", () => {
    expect(ids.slice(0, FIRST_WORLDS.size)).toEqual([...FIRST_WORLDS]);
    for (const id of REGISTERED) expect(FIRST_WORLDS.has(id), id).toBe(true);
    // Registered means a frozen protocol ran it: the M4 ensemble's two presets and the pond registration's.
    expect([...REGISTERED].sort()).toEqual(["gradient-m3", "ponds", "spots-m3"]);
    for (const id of REGISTERED) expect(["confirmed", "negative", "measured"]).toContain(WORLD_NOTES[id].seen.state);
    expect(worldStatus("ponds")).toBe("registered");
    expect(worldStatus("seasons")).toBe("base");
    expect(worldStatus("planet")).toBe("sandbox");
  });
});

describe("traits", () => {
  it("gives every preset one light, one size and one founders trait", () => {
    for (const id of ids) {
      expect(labelsOf("light", id), `light of ${id}`).toHaveLength(1);
      expect(labelsOf("size", id), `size of ${id}`).toHaveLength(1);
      expect(labelsOf("founders", id), `founders of ${id}`).toHaveLength(1);
    }
  });

  it("names no config key, file path or code name in a trait, a note or a family", () => {
    for (const id of ids) for (const t of worldTraits(preset(id))) expect(`${t.label} ${t.detail ?? ""}`, `${id}: ${t.label}`).not.toMatch(jargon);
    for (const [id, note] of Object.entries(WORLD_NOTES)) expect(`${note.asks} ${note.look} ${note.seen.text}`, id).not.toMatch(jargon);
    for (const f of FAMILIES) expect(`${f.name} ${f.lever} ${f.why} ${f.seen}`, f.id).not.toMatch(jargon);
    for (const s of START_HERE) expect(s.why).not.toMatch(jargon);
  });

  it("reads the light off the config: even, a gradient toward the bottom, a checkerboard, or a sun that moves", () => {
    expect(labelsOf("light", "spots")[0].label).toBe("Even light everywhere");
    expect(labelsOf("light", "gradient")[0].label).toBe("Brighter toward the bottom");
    expect(labelsOf("light", "seasons")[0].label).toBe("A checkerboard of light");
    expect(labelsOf("light", "planet")[0].label).toBe("A moving sun, one lap every 16,000 steps");
    expect(labelsOf("light", "planet-wander")[0].label).toBe("A sun that wanders east, then west, turning back every 32,768 steps");
    expect(labelsOf("light", "wild-storm")[0].label).toBe("A sun that wanders east, then west, turning back every 32,768 steps");
    expect(labelsOf("season", "seasons")[0]).toMatchObject({ label: "A season every 4,000 steps" });
    expect(labelsOf("season", "spots")).toHaveLength(0);
  });

  it("recovers the wound rate the preset was built with", () => {
    expect(labelsOf("wounds", "own-injury-light")[0].label).toContain("once per 13,000 steps");
    expect(labelsOf("wounds", "own-injury-heavy")[0].label).toContain("once per 3,250 steps");
    expect(labelsOf("wounds", "own-injury-coarse")[0].detail).toContain("radius 8");
    expect(labelsOf("wounds", "wild-storm-w01")[0].label).toContain("once per 130,000 steps");
    expect(labelsOf("wounds", "wild-storm-w10")[0].label).toContain("once per 1,300 steps");
    expect(labelsOf("wounds", "gradient-m3")).toHaveLength(0);
  });

  it("states the mutation rate against the base rules, the pond cycle's donor rule, and the islands' trade", () => {
    expect(labelsOf("mutation", "breeder")[0].label).toBe("Mutation ×10");
    expect(labelsOf("mutation", "wild-storm-m10")[0].label).toBe("Mutation ×10");
    expect(labelsOf("mutation", "spots")).toHaveLength(0);
    expect(labelsOf("cycle", "ponds")[0]).toMatchObject({ label: "Ponds cleared and reseeded every 10,000 steps", detail: expect.stringContaining("heaviest quarter") });
    expect(labelsOf("cycle", "breeder")[0].detail).toContain("movement, the seed packet's mass and body size together");
    expect(labelsOf("size", "ponds")[0].label).toBe("64 ponds of 64 × 64");
    expect(labelsOf("migration", "archipelago")[0].label).toBe("Islands trade 4 cells every 200 steps");
    expect(labelsOf("size", "archipelago")[0].label).toBe("4 islands of 64 × 64");
    expect(labelsOf("size", "large")[0].label).toBe("512 × 512 cells");
    expect(labelsOf("founders", "gradient-m3")[0].label).toBe("The 12 searched founders");
    expect(labelsOf("founders", "wild-storm-large")[0]).toMatchObject({ label: "24 discs of the 12 searched founders", detail: expect.stringContaining("2 discs each") });
  });

  it("reads the rule changes: lossy taking with its kin test, heritable shape, declared cells, a readable signal", () => {
    expect(labelsOf("rules", "own-lossy")[0]).toMatchObject({ label: "Taking a stranger's matter is lossy unless kin by lineage", detail: expect.stringContaining("share a lineage") });
    expect(labelsOf("rules", "own-match")[0]).toMatchObject({ label: "Taking a stranger's matter is lossy unless kin by growth settings", detail: expect.stringContaining("centre is within 8 and its width within 2") });
    expect(labelsOf("rules", "own-genome-3")[0].label).toContain("within 3 words");
    expect(labelsOf("rules", "own-genome-1")[0].label).toContain("within 1 word");
    expect(labelsOf("rules", "own-shape-far")[0].label).toBe("Body shape is heritable out to radius 13");
    expect(labelsOf("rules", "own-shape")[0].label).toBe("Body shape is heritable within the usual kernel");
    expect(labelsOf("rules", "own-cell").map((t) => t.label)).toEqual(["Declared cells"]);
    expect(labelsOf("rules", "own-cell-wall").map((t) => t.label)).toEqual(["Taking a stranger's matter is lossy unless kin by lineage", "Declared cells"]);
    expect(labelsOf("signal", "planet-sensing")[0].detail).toContain("signal lasts far longer");
    expect(labelsOf("rules", "gradient-m3")).toHaveLength(0);
    expect(labelsOf("medium", "gradient-m3-waste")[0].label).toBe("Waste already in the water");
  });

  it("would notice a changed base mutation rate", () => {
    expect(defaultConfig().mutRate).toBe(429_497);
  });
});

describe("differences", () => {
  it("says what a variant adds and nothing more", () => {
    const only = (world: string, base: string) => worldDiff(preset(world), preset(base));
    expect(only("gradient-m3", "gradient").added.map((t) => t.lever)).toEqual(["founders"]);
    expect(only("gradient-m3", "gradient").removed).toEqual([]);
    expect(only("own-lossy", "gradient-m3").added.map((t) => t.label)).toEqual(["Taking a stranger's matter is lossy unless kin by lineage"]);
    expect(only("wild-storm-w01", "wild-storm").added.map((t) => t.lever)).toEqual(["wounds"]);
    expect(only("wild-storm-large", "wild-storm").added.map((t) => t.lever)).toEqual(["light", "size", "founders"]);
    expect(only("planet", "gradient").added.map((t) => t.lever)).toEqual(["light"]);
    expect(only("planet-followers", "planet").added.map((t) => t.lever)).toEqual(["light", "founders"]);
    expect(only("spots", "spots")).toEqual({ added: [], changed: [], removed: [] });
  });

  it("tells a changed number from a new trait: a dimmer gradient keeps its label", () => {
    const d = worldDiff(preset("own-seasons"), preset("gradient-m3"));
    expect(d.added.map((t) => t.lever)).toEqual(["season"]);
    expect(d.changed.map((c) => [c.trait.lever, c.trait.label, c.from.label])).toEqual([["light", "Brighter toward the bottom", "Brighter toward the bottom"]]);
    expect(d.changed[0].trait.detail).not.toBe(d.changed[0].from.detail);
  });

  it("reports a lever the base has and the variant lacks as removed", () => {
    const d = worldDiff(preset("gradient-m3"), preset("own-seasons"));
    expect(d.removed.map((t) => t.lever)).toEqual(["season"]);
  });

  it("gives every world with a base at least one difference from it", () => {
    for (const [id, note] of Object.entries(WORLD_NOTES)) {
      if (!note.base) continue;
      const d = worldDiff(preset(id), preset(note.base));
      expect(d.added.length + d.changed.length + d.removed.length, `${id} against ${note.base}`).toBeGreaterThan(0);
    }
  });

  it("places every world's base in a family too", () => {
    for (const note of Object.values(WORLD_NOTES)) if (note.base) expect(familyOf(note.base)).toBeDefined();
  });
});
