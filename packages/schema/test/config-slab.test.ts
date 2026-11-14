import { describe, expect, it } from "vitest";
import { SLAB_EXCLUDED_KEYS, canonicalConfig, cellCount, defaultConfig, digestWords, genomeChannels, isSlab, validateConfig, type WorldConfig } from "@bl/schema";

const slab = (o: Partial<WorldConfig> = {}) => defaultConfig({ kernelRadius: 3, tileD: 8, lightK: 1024, lightMode: "uniform", ...o });

describe("slab config", () => {
  it("keeps tileD and lightK out of defaultConfig, and the canonical bytes as they were", () => {
    const c = defaultConfig();
    expect("tileD" in c).toBe(false);
    expect("lightK" in c).toBe(false);
    const cc = new TextEncoder().encode(canonicalConfig(c));
    const w = new Uint32Array(Math.ceil(cc.length / 4));
    new Uint8Array(w.buffer).set(cc);
    expect(digestWords(w).map((x) => x.toString(16)).join(",")).toBe("3459f056,65cdb756");
  });
  it("sizes cells and genomes", () => {
    expect(cellCount(defaultConfig())).toBe(65536);
    expect(cellCount(slab())).toBe(524288);
    expect([genomeChannels(defaultConfig()), genomeChannels(slab())]).toEqual([44, 49]);
    expect([isSlab(defaultConfig()), isSlab(slab())]).toEqual([false, true]);
  });
  it("accepts the baseline and the allowed variants", () => {
    for (const o of [{}, { lightMode: "gradient" }, { seasonPeriod: 100, seasonAmp: 10 }, { neutral: true }, { motility: false }, { signalGain: 64 }, { tileD: 4 }, { tileD: 32 }, { lightK: 1 }, { lightK: 65536 }] as Partial<WorldConfig>[])
      expect(validateConfig(slab(o)), JSON.stringify(o)).toEqual([]);
  });
  const excluded: Record<string, unknown> = {
    migrationPeriod: 4, migrantCount: 2, ringNamespace: 1, pondPeriod: 100, pondK: 4, pondArm: "scaf", pondDeath: 1, pondExport: 1, pondScore: "mass", takeover: true,
    takeoverKin: "genome", takeoverTol: 1, cellPeriod: 10, cellMutProb: 1, shapeReach: 5, injuryPeriod: 10, injuryRadius: 2, injuryProb: 1, adhesion: true, kAdhesion: 5,
    genes: "ladder", kGene: 1, geneFlip: 1, wanderPeriod: 10, wanderAmp: 1, dayPeriod: 10,
  };
  it("covers all 26 excluded keys", () => {
    expect(Object.keys(excluded).sort()).toEqual([...SLAB_EXCLUDED_KEYS].sort());
    expect(SLAB_EXCLUDED_KEYS.length).toBe(26);
  });
  // Grouped options need their whole group, so the only error left is the slab-specific one.
  const groups: Record<string, Partial<WorldConfig>> = {
    migrationPeriod: { migrationPeriod: 4, migrantCount: 2 }, migrantCount: { migrationPeriod: 4, migrantCount: 2 },
    pondPeriod: { pondPeriod: 100, pondK: 4, pondArm: "scaf" }, pondK: { pondPeriod: 100, pondK: 4, pondArm: "scaf" },
    pondArm: { pondPeriod: 100, pondK: 4, pondArm: "scaf" }, pondDeath: { pondPeriod: 100, pondK: 4, pondArm: "nat", pondDeath: 1, pondExport: 1 },
    pondExport: { pondPeriod: 100, pondK: 4, pondArm: "nat", pondDeath: 1, pondExport: 1 }, pondScore: { pondPeriod: 100, pondK: 4, pondArm: "scaf", pondScore: "mass" },
    cellPeriod: { cellPeriod: 10, cellMutProb: 1 }, cellMutProb: { cellPeriod: 10, cellMutProb: 1 },
    injuryPeriod: { injuryPeriod: 10, injuryRadius: 2, injuryProb: 1 }, injuryRadius: { injuryPeriod: 10, injuryRadius: 2, injuryProb: 1 },
    injuryProb: { injuryPeriod: 10, injuryRadius: 2, injuryProb: 1 },
    genes: { genes: "ladder", kGene: 1, geneFlip: 1 }, kGene: { genes: "ladder", kGene: 1, geneFlip: 1 }, geneFlip: { genes: "ladder", kGene: 1, geneFlip: 1 },
    wanderPeriod: { wanderPeriod: 10, wanderAmp: 1 }, wanderAmp: { wanderPeriod: 10, wanderAmp: 1 },
  };
  it.each(Object.entries(excluded))("rejects %s on a slab with the slab-specific error", (key, value) => {
    const o = { [key]: value, ...(groups[key] ?? {}) } as Partial<WorldConfig>;
    // The 2D config alone must not already fail for another reason, or the slab diagnostic is not what is being tested.
    const base = validateConfig(defaultConfig({ kernelRadius: 3, ...o }));
    expect(base.filter((e) => e.includes("slab")), key).toEqual([]);
    const errs = validateConfig(slab(o));
    expect(errs, key).toContain(`${key} is not defined for a slab (tileD set)`);
  });
  it("rejects bad values", () => {
    const bad: Partial<WorldConfig>[] = [
      ...[0, 3, 6, 36, 8.5, "8"].map((v) => ({ tileD: v as number })),
      ...[0, 65537, 1.5].map((v) => ({ lightK: v })),
      { tileD: undefined }, { lightK: undefined }, { tilesX: 2 }, { tilesY: 2 }, { kernelRadius: 9 }, { kernelRadius: 4 }, { lightMode: "patches" }, { lightMode: "sweep" },
    ];
    for (const o of bad) expect(validateConfig(slab(o)), JSON.stringify(o)).not.toEqual([]);
    expect(validateConfig(slab({ tileW: 1024, tileH: 1024, tileD: 32 })).join(";")).toContain("2^24");
  });
  it("a lone slab key is refused on a 2D config", () => {
    expect(validateConfig(defaultConfig({ tileD: 8 }))).not.toEqual([]);
    expect(validateConfig(defaultConfig({ lightK: 8 }))).not.toEqual([]);
  });
  it("still validates 2D pond, injury and shape configs", () => {
    expect(validateConfig(defaultConfig({ tileW: 64, tileH: 64, tilesX: 2, tilesY: 2, pondPeriod: 100, pondK: 4, pondArm: "scaf" }))).toEqual([]);
    expect(validateConfig(defaultConfig({ injuryPeriod: 10, injuryRadius: 2, injuryProb: 100 }))).toEqual([]);
    expect(validateConfig(defaultConfig({ shapeReach: 9 }))).toEqual([]);
  });
});
