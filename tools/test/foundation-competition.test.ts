import { describe, expect, it } from "vitest";
import { CH, G, allocState, cellCount, stateHash, totalsOf } from "@bl/schema";
import { specConfig, type RunSpec } from "@bl/runner";
import { type TimeCatalog } from "../lib/foundation-extract.ts";
import {
  DISC_CENTERS, TEMPLATE_SEED, assertReciprocalPhysicalMatch, competitionSpec,
  conditionChemicalPool, interfaceOpportunity, rankCatalogSelection, relativeGrowthContrast,
  standardTemplate, standardizedPool, startCompetition,
} from "../lib/foundation-competition.ts";

const source: RunSpec = { experiment: "m4", presetId: "gradient-m3", condition: "treatment",
  seed: 1, steps: 1_000_000, censusEvery: 100, deepEvery: 10, checkpointEvery: 0 };
const ruleSha = "a".repeat(64);

describe("foundation genotype-only competition preparation", () => {
  it("hash-ranks all frozen selections, including valid empty and nine-selection epochs", () => {
    const catalog = { step: 100_000, components: Array.from({ length: 7 }, (_, i) => ({
      idx: i + 20, selected: i < 6, reasons: [], cellIndices: [i + 1],
    })) } as unknown as TimeCatalog;
    const first = rankCatalogSelection("world-1", "early", ruleSha, catalog);
    expect(first).toHaveLength(6);
    expect(first.map((r) => r.rank)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(first.map((r) => r.idx).sort((a, b) => a - b)).toEqual([20, 21, 22, 23, 24, 25]);
    expect(rankCatalogSelection("world-1", "early", ruleSha, catalog)).toEqual(first);
    catalog.components[0].selected = false;
    expect(rankCatalogSelection("world-1", "early", ruleSha, catalog)).toHaveLength(5);
    for (const c of catalog.components) c.selected = false;
    expect(rankCatalogSelection("world-1", "early", ruleSha, catalog)).toEqual([]);
    for (const c of catalog.components) c.selected = true;
    catalog.components.push({ ...catalog.components[0], idx: 30 }, { ...catalog.components[0], idx: 31 });
    expect(rankCatalogSelection("world-1", "early", ruleSha, catalog)).toHaveLength(9);
    catalog.components[0].reasons = ["mixed-lineage"];
    expect(() => rankCatalogSelection("world-1", "early", ruleSha, catalog)).toThrow(/invalid/);
  });

  it("exports bound biomass, polymer and bound-site E while retaining extracellular A/C/S/E exactly", () => {
    const cfg = specConfig(competitionSpec(source, 630_010_001));
    const original = allocState(cfg), n = cellCount(cfg);
    original.step = 100_000;
    for (let i = 0; i < n; i++) original.cells[CH.A * n + i] = 2;
    original.cells[CH.B * n + 10] = 5;
    original.cells[CH.P * n + 10] = 3;
    original.cells[CH.E * n + 10] = 17;
    original.cells[CH.E * n + 11] = 7;
    original.cells[CH.C * n + 10] = 4;
    original.cells[CH.S * n + 11] = 9;
    original.lightIn = 30n;
    original.heatOut = 20n;
    const { state, audit } = conditionChemicalPool(original, cfg);
    expect(state.step).toBe(0);
    expect(state.cells[CH.E * n + 10]).toBe(0);
    expect(state.cells[CH.E * n + 11]).toBe(7);
    expect(state.cells[CH.C * n + 10]).toBe(4);
    expect(state.cells[CH.S * n + 11]).toBe(9);
    expect(audit.exported).toMatchObject({ A: "0", B: "5", C: "0", P: "3", E: "17", S: "0", matter: "8" });
    expect(audit.removedBoundSiteE).toBe("17");
    expect(audit.retainedExtracellularE).toBe("7");
    expect(state.lightIn).toBe(0n);
    expect(state.heatOut).toBe(0n);
    expect(totalsOf(state.cfg, state.cells).matter + BigInt(audit.exported.matter)).toBe(
      totalsOf(original.cfg, original.cells).matter);
  });

  it("uses a fixed disc template and gives swapped genotypes identical physical starts and seed", () => {
    const template = standardTemplate(source);
    expect(template.sourceConfig.seed).toBe(TEMPLATE_SEED);
    const words = template.cells[0].genome;
    const early = [...words], late = [...words];
    late[G.W0] = (late[G.W0] ^ 0x00000001) >>> 0;
    const cfg = specConfig(competitionSpec(source, 630_010_001));
    const pool = standardizedPool(cfg);
    const left = startCompetition(pool, template, early, late, "left");
    const right = startCompetition(pool, template, early, late, "right");
    assertReciprocalPhysicalMatch(left, right);
    expect(left.initial.earlyB).toBe(left.initial.lateB);
    expect(left.initial).toEqual(right.initial);
    expect(stateHash(left.state)).not.toBe(stateHash(right.state));
    expect(DISC_CENTERS).toEqual({ left: [108, 128], right: [148, 128] });
    expect(left.audits.every((a) => a.ledgerUnchanged)).toBe(true);
    const damaged = { ...right, state: { ...right.state, cells: right.state.cells.slice() } };
    damaged.state.cells[0]++;
    expect(() => assertReciprocalPhysicalMatch(left, damaged)).toThrow(/physical initial/);
  });

  it("records toroidal contact opportunity and keeps extinction distinct from a finite contrast", () => {
    const state = standardizedPool(specConfig(competitionSpec(source, 630_010_001)));
    const n = cellCount(state.cfg);
    const at = (x: number, y: number) => y * 256 + x;
    state.cells[CH.B * n + at(0, 0)] = 10;
    state.genome[G.LIN_LO * n + at(0, 0)] = 1;
    state.cells[CH.B * n + at(255, 0)] = 10;
    state.genome[G.LIN_LO * n + at(255, 0)] = 2;
    expect(interfaceOpportunity(state)).toMatchObject({ minChebyshevDistance: 1,
      adjacent: true, kernelHalosOverlap: true });
    state.cells[CH.B * n + at(255, 0)] = 0;
    expect(interfaceOpportunity(state).minChebyshevDistance).toBeNull();
    expect(relativeGrowthContrast(10n, 10n, 20n, 40n)).toMatchObject({ survival: "both",
      logRelativeGrowth: Math.log(2) });
    expect(relativeGrowthContrast(10n, 10n, 0n, 40n)).toEqual({ survival: "late-only", logRelativeGrowth: null });
  });
});
