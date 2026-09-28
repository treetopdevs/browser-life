import { describe, expect, it } from "vitest";
import {
  CELL_CHANNELS, CH, FLUX_COUNT, G, GENOME_CHANNELS, MATTER_MAX, allocState, cellCount, cloneState,
  defaultConfig, encodeGenome, generalistGenome, stateHash, validateState, type WorldState,
} from "@bl/schema";
import { RefSim } from "@bl/sim-ref";
import {
  exciseCellPacket, extractCellPacket, genomeOnlyArm, matchedGenomeOnlyInocula,
  restoreCellPacket, toroidalMapping, transplantCellPacket,
  type CellPacket, type LineageRelabel, type ToroidalPlacement,
} from "../lib/foundation-transplant.ts";

const cfg = () => ({ ...defaultConfig(), tileW: 8, tileH: 8, tilesX: 1, tilesY: 1,
  kernelRadius: 2, seed: 101, mutRate: 0 });
const word = (state: WorldState, ch: number, i: number) => state.cells[ch * cellCount(state.cfg) + i];
const genome = (state: WorldState, g: number, i: number) => state.genome[g * cellCount(state.cfg) + i];
const setWord = (state: WorldState, ch: number, i: number, value: number) => { state.cells[ch * cellCount(state.cfg) + i] = value; };
const setGenome = (state: WorldState, g: number, i: number, value: number) => { state.genome[g * cellCount(state.cfg) + i] = value; };

function source(): WorldState {
  const state = allocState(cfg());
  const words = encodeGenome(generalistGenome(state.cfg.defaultMu, state.cfg.defaultSigma), 0, 3);
  state.step = 4;
  state.lightIn = 91n; state.heatOut = 17n; state.flux = Array.from({ length: FLUX_COUNT }, (_, i) => BigInt(i + 1));
  for (let i = 0; i < cellCount(state.cfg); i++) {
    setWord(state, CH.A, i, 12);
    setWord(state, CH.MOT, i, 128 | (128 << 8));
  }
  for (const i of [0, 7]) {
    setWord(state, CH.B, i, i === 0 ? 70 : 80);
    setWord(state, CH.P, i, 6);
    setWord(state, CH.C, i, 3);
    setWord(state, CH.E, i, 41);
    setWord(state, CH.S, i, 2);
    setWord(state, CH.MOT, i, i === 0 ? 0xabcd : 0x1234);
    for (let g = 0; g < GENOME_CHANNELS; g++) setGenome(state, g, i, words[g]);
  }
  expect(validateState(state)).toEqual([]);
  return state;
}

function garden() {
  const state = allocState({ ...cfg(), seed: 202 });
  state.step = 4;
  for (let i = 0; i < cellCount(state.cfg); i++) {
    setWord(state, CH.A, i, 9);
    setWord(state, CH.MOT, i, 128 | (128 << 8));
  }
  setWord(state, CH.E, 6, 5);
  // Stale empty-site genome words are legal in a state, but must be exported and fully replaced.
  setGenome(state, G.PARAM0, 6, 987);
  return state;
}
const place: ToroidalPlacement = { sourceTileX: 0, sourceTileY: 0, destinationTileX: 0, destinationTileY: 0, shiftX: 7, shiftY: 0 };
const relabel: LineageRelabel[] = [{ from: { hi: 0, lo: 3 }, to: { hi: 0, lo: 8 } }];
const packet = () => extractCellPacket(source(), [7, 0]);

describe("foundation transplant primitives", () => {
  it("roundtrips exact 7-channel and 44-word source state, MOT and cumulative ledgers", () => {
    const original = source();
    const beforeHash = stateHash(original);
    const p = extractCellPacket(original, [7, 0]);
    expect(p.cells.map((r) => r.sourceIndex)).toEqual([0, 7]);
    expect(p.cells[0].cells).toHaveLength(CELL_CHANNELS);
    expect(p.cells[0].genome).toHaveLength(GENOME_CHANNELS);
    expect(p.cells[0].cells[CH.MOT]).toBe(0xabcd);
    expect(p.inventory.B).toBe("150");
    const excised = exciseCellPacket(original, p);
    expect(word(excised, CH.MOT, 0)).toBe(0);
    expect(genome(excised, G.PARAM0, 0)).toBe(0);
    expect(excised.lightIn).toBe(original.lightIn);
    expect(excised.heatOut).toBe(original.heatOut);
    expect(excised.flux).toEqual(original.flux);
    const restored = restoreCellPacket(excised, p);
    expect(stateHash(restored)).toBe(beforeHash);
    expect(restored.cells).toEqual(original.cells);
    expect(restored.genome).toEqual(original.genome);
  });

  it("rejects mixed, stale, duplicate and altered packets instead of treating them as inocula", () => {
    const p = packet();
    const mixed = structuredClone(p);
    mixed.cells[1].genome[G.LIN_LO] = 4;
    expect(() => transplantCellPacket(garden(), mixed, place, relabel)).toThrow(/mixed lineage/);
    const stale = structuredClone(p);
    stale.cells[0].genome[G.LIN_LO] = 0;
    expect(() => transplantCellPacket(garden(), stale, place, relabel)).toThrow(/unlabelled/);
    const duplicate = structuredClone(p);
    duplicate.cells[1].sourceIndex = duplicate.cells[0].sourceIndex;
    expect(() => transplantCellPacket(garden(), duplicate, place, relabel)).toThrow(/duplicate, unordered/);
    const changed = structuredClone(p);
    changed.cells[0].cells[CH.B]++;
    expect(() => transplantCellPacket(garden(), changed, place, relabel)).toThrow(/inventory/);
    const changedMot = structuredClone(p);
    changedMot.cells[0].cells[CH.MOT]++;
    expect(() => transplantCellPacket(garden(), changedMot, place, relabel)).toThrow(/SHA-256/);
    const wrongRemainder = exciseCellPacket(source(), p);
    setWord(wrongRemainder, CH.A, 1, 13);
    expect(() => restoreCellPacket(wrongRemainder, p)).toThrow(/did not reproduce source state hash/);
  });

  it("maps toroidally, exports overwritten chemistry, and conserves every resource exactly", () => {
    const p = packet();
    const initial = garden();
    const mapping = toroidalMapping(p, initial.cfg, place);
    expect(mapping).toEqual([{ sourceIndex: 0, destinationIndex: 7 }, { sourceIndex: 7, destinationIndex: 6 }]);
    expect(toroidalMapping(p, initial.cfg, { ...place, shiftX: Number.MAX_SAFE_INTEGER })).toEqual(mapping);
    const { state, audit } = transplantCellPacket(initial, p, place, relabel);
    expect(audit.mapping).toEqual(mapping);
    expect(audit.exported.A).toBe("18");
    expect(audit.exported.E).toBe("5");
    expect(audit.imported.B).toBe("150");
    expect(audit.ledgerUnchanged).toBe(true);
    expect(audit.exportedCells[1].genome[G.PARAM0]).toBe(987);
    expect(genome(state, G.PARAM0, 6)).not.toBe(987);
    expect(genome(state, G.LIN_LO, 6)).toBe(8);
    expect(word(initial, CH.B, 6)).toBe(0);
    for (const key of ["A", "B", "C", "P", "E", "S", "matter", "energy"] as const)
      expect(BigInt(audit.after[key])).toBe(BigInt(audit.before[key]) + BigInt(audit.imported[key]) - BigInt(audit.exported[key]));
  });

  it("requires vacant destinations, mutation off, an injective complete map and past unused IDs", () => {
    const p = packet();
    const crowded = garden();
    setWord(crowded, CH.P, 6, 1);
    expect(() => transplantCellPacket(crowded, p, place, relabel)).toThrow(/collision/);
    const mutating = garden(); mutating.cfg.mutRate = 1;
    expect(() => transplantCellPacket(mutating, p, place, relabel)).toThrow(/mutation disabled/);
    const differentEnergy = garden(); differentEnergy.cfg.eB++;
    expect(() => transplantCellPacket(differentEnergy, p, place, relabel)).toThrow(/energy coefficients differ/);
    expect(() => transplantCellPacket(garden(), p, place, [])).toThrow(/explicit injective/);
    expect(() => transplantCellPacket(garden(), p, place, [{ from: { hi: 0, lo: 3 }, to: { hi: 5, lo: 8 } }])).toThrow(/future/);
    expect(() => transplantCellPacket(garden(), p, place, [...relabel, ...relabel])).toThrow(/noninjective/);
    const used = garden(); setGenome(used, G.LIN_LO, 20, 8);
    expect(() => transplantCellPacket(used, p, place, relabel)).toThrow(/already exists/);
    const nearMatterLimit = garden();
    setWord(nearMatterLimit, CH.A, 20, MATTER_MAX - 9 * cellCount(nearMatterLimit.cfg));
    expect(validateState(nearMatterLimit)).toEqual([]);
    expect(() => transplantCellPacket(nearMatterLimit, p, place, relabel)).toThrow(/total matter/);
    expect(() => toroidalMapping(p, garden().cfg, { ...place, sourceTileX: 1 })).toThrow(/placement/);
  });

  it("labels only genome-only arms with one identical resource/morphology template as matched", () => {
    const p = packet();
    const wordsA = new Array<number>(GENOME_CHANNELS).fill(0);
    const wordsB = [...wordsA]; wordsB[G.PARAM0] = 77;
    const a = genomeOnlyArm(p, wordsA), b = genomeOnlyArm(p, wordsB);
    expect(matchedGenomeOnlyInocula(a, b)).toBe(true);
    expect(matchedGenomeOnlyInocula(p, a)).toBe(false);
    expect(() => restoreCellPacket(exciseCellPacket(source(), p), a)).toThrow(/intact/);
    const different = extractCellPacket(source(), [0]);
    const c = genomeOnlyArm(different, wordsB);
    expect(matchedGenomeOnlyInocula(a, c)).toBe(false);
    expect(transplantCellPacket(garden(), a, place, relabel).audit.imported).toEqual(transplantCellPacket(garden(), b, place, relabel).audit.imported);
  });

  it("a bijective lineage relabel leaves RefSim cell dynamics and ledgers unchanged with mutation off", () => {
    const base = source();
    const n = cellCount(base.cfg);
    const secondGenotype = generalistGenome(base.cfg.defaultMu + 24, base.cfg.defaultSigma + 5);
    secondGenotype.motGain = 19;
    secondGenotype.weights[0] = 31;
    const second = encodeGenome(secondGenotype, 0, 4);
    expect(second[G.PARAM0]).not.toBe(genome(base, G.PARAM0, 0));
    // Adjacent to lineage 0:3 at both x=0 and x=7 across the toroidal seam.
    setWord(base, CH.B, 1, 75);
    setWord(base, CH.E, 1, 30);
    for (let g = 0; g < GENOME_CHANNELS; g++) setGenome(base, g, 1, second[g]);
    expect(validateState(base)).toEqual([]);
    const renamed = cloneState(base);
    for (let i = 0; i < n; i++) {
      const lo = genome(renamed, G.LIN_LO, i);
      if (lo === 3) setGenome(renamed, G.LIN_LO, i, 13);
      if (lo === 4) setGenome(renamed, G.LIN_LO, i, 14);
    }
    expect(validateState(renamed)).toEqual([]);
    const a = new RefSim(base), b = new RefSim(renamed);
    for (let k = 0; k < 30; k++) { a.step(); b.step(); }
    expect(b.state.cells).toEqual(a.state.cells);
    expect(b.state.lightIn).toBe(a.state.lightIn);
    expect(b.state.heatOut).toBe(a.state.heatOut);
    expect(b.state.flux).toEqual(a.state.flux);
    // Numeric IDs can differ; equality relations and every genotype word remain the same.
    for (let g = 2; g < GENOME_CHANNELS; g++)
      for (let i = 0; i < n; i++) expect(genome(b.state, g, i)).toBe(genome(a.state, g, i));
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const aid = `${genome(a.state, G.LIN_HI, i)}:${genome(a.state, G.LIN_LO, i)}`;
        const ajd = `${genome(a.state, G.LIN_HI, j)}:${genome(a.state, G.LIN_LO, j)}`;
        const bid = `${genome(b.state, G.LIN_HI, i)}:${genome(b.state, G.LIN_LO, i)}`;
        const bjd = `${genome(b.state, G.LIN_HI, j)}:${genome(b.state, G.LIN_LO, j)}`;
        expect(aid === ajd).toBe(bid === bjd);
      }
  });
});
