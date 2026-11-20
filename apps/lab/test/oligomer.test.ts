import { describe, expect, it } from 'vitest';
import {
  NUM_SPECIES,
  NUM_WALL_SPECIES,
  OP_CLEAVE,
  OP_IMPORT,
  OP_LIGATE,
  OP_LYSE,
  SPECIES,
  WALL_SPECIES,
  cleaveSpecies,
  decodeCatalyst,
  ligateSpecies,
  makeCatalyst,
  matchedSpecies,
  speciesByLabel,
  specificityScaleQ16,
} from '../src/oligomer/chem.ts';
import { OligomerWorld, defaultConfig } from '../src/oligomer/model.ts';
import { OligomerObserver } from '../src/oligomer/observe.ts';

function seedStarterWorld(overrides: Parameters<typeof defaultConfig>[0] = {}): OligomerWorld {
  const cfg = defaultConfig({ width: 16, height: 16, seed: 42, ...overrides });
  const w = new OligomerWorld(cfg);
  const g1 = [
    makeCatalyst(OP_CLEAVE, '0001', 2),
    makeCatalyst(OP_CLEAVE, '1110', 2),
    makeCatalyst(OP_LIGATE, '0011', 2),
    makeCatalyst(OP_IMPORT, '0001', 2),
    makeCatalyst(OP_IMPORT, '1110', 2),
    cfg.enableLyse ? makeCatalyst(OP_LYSE, '0110', 2) : 0,
  ];
  const g2 = [
    makeCatalyst(OP_CLEAVE, '0001', 2),
    makeCatalyst(OP_CLEAVE, '1110', 2),
    makeCatalyst(OP_LIGATE, '0110', 2),
    makeCatalyst(OP_IMPORT, '0001', 2),
    makeCatalyst(OP_IMPORT, '1110', 2),
    cfg.enableLyse ? makeCatalyst(OP_LYSE, '0011', 2) : 0,
  ];
  w.seedCompartment(4, 4, speciesByLabel('0011'), 20, g1, 1);
  w.seedCompartment(5, 4, speciesByLabel('0110'), 20, g2, 2);
  return w;
}

describe('oligomer chemistry (Rung 0)', () => {
  it('defines 30 species and 6 balanced wall tetramers with exact cleave/ligate roundtrip', () => {
    expect(SPECIES.length).toBe(NUM_SPECIES);
    expect(WALL_SPECIES.length).toBe(NUM_WALL_SPECIES);
    for (const wid of WALL_SPECIES) {
      expect(SPECIES[wid].len).toBe(4);
      expect(SPECIES[wid].n0).toBe(2);
      expect(SPECIES[wid].n1).toBe(2);
    }
    for (const sp of SPECIES) {
      for (let pos = 1; pos < sp.len; pos++) {
        const [l, r] = cleaveSpecies(sp.id, pos);
        expect(ligateSpecies(l, r)).toBe(sp.id);
        expect(SPECIES[l].n0 + SPECIES[r].n0).toBe(sp.n0);
        expect(SPECIES[l].n1 + SPECIES[r].n1).toBe(sp.n1);
      }
    }
  });

  it('enforces convex specificity tradeoff and lock-and-key matching', () => {
    const spec = decodeCatalyst(makeCatalyst(OP_CLEAVE, '0001', 2));
    expect(spec.wildcards).toBe(0);
    expect(matchedSpecies(spec)).toEqual([speciesByLabel('0001')]);
    expect(specificityScaleQ16(spec.wildcards, false)).toBe(65536);

    const broad = decodeCatalyst(makeCatalyst(OP_CLEAVE, '00*1', 2));
    expect(broad.wildcards).toBe(1);
    expect(matchedSpecies(broad).length).toBe(2);
    expect(specificityScaleQ16(broad.wildcards, false)).toBe(16384); // 1/4
    expect(specificityScaleQ16(broad.wildcards, true)).toBe(65536); // flat control
  });

  it('rejects non-dissipative thermodynamics (eLig <= eBond)', () => {
    expect(() => new OligomerWorld(defaultConfig({ eBond: 3, eLig: 3 }))).toThrow();
    expect(() => new OligomerWorld(defaultConfig({ eBond: 4, eLig: 3 }))).toThrow();
  });

  it('preserves exact monomer conservation (0 residual) with lysis, division, and diffusion', () => {
    const w = seedStarterWorld({ enableLyse: true });
    const obs = new OligomerObserver(w);
    for (let t = 0; t < 500; t++) {
      w.step(obs);
      if (t % 25 === 0) {
        const totals = w.monomerTotals();
        expect(totals.n0).toBe(w.initN0);
        expect(totals.n1).toBe(w.initN1);
      }
    }
    const row = obs.sample(w);
    expect(row.res0).toBe(0);
    expect(row.res1).toBe(0);
  });

  it('decays to monomers and 0 live compartments in the dark (light = 0) with monotonic free-energy bound', () => {
    const w = seedStarterWorld({ kLightQ16: 0, kHydExtQ16: 2048, kWallHydQ16: 2048 });
    const chemicalPotential = () => {
      let bonds = 0;
      let energy = 0;
      for (let i = 0; i < w.nTiles; i++) {
        const base = i * NUM_SPECIES;
        for (let s = 2; s < NUM_SPECIES; s++) {
          bonds += (w.ext[base + s] + w.int[base + s]) * SPECIES[s].bonds;
        }
        if (w.alive[i]) {
          energy += w.energy[i];
          const wBase = i * NUM_WALL_SPECIES;
          for (let wi = 0; wi < NUM_WALL_SPECIES; wi++) {
            bonds += w.wall[wBase + wi] * SPECIES[WALL_SPECIES[wi]].bonds;
          }
        }
      }
      return energy + w.cfg.eBond * bonds;
    };

    let prevPhi = chemicalPotential();
    for (let t = 0; t < 1500; t++) {
      w.step();
      const phi = chemicalPotential();
      expect(phi).toBeLessThanOrEqual(prevPhi);
      prevPhi = phi;
    }
    let live = 0;
    let totalEnergy = 0;
    let remainingOligomers = 0;
    for (let i = 0; i < w.nTiles; i++) {
      live += w.alive[i];
      totalEnergy += w.energy[i];
      const base = i * NUM_SPECIES;
      for (let s = 2; s < NUM_SPECIES; s++) {
        remainingOligomers += w.ext[base + s] + w.int[base + s];
      }
    }
    expect(live).toBe(0);
    expect(totalEnergy).toBe(0);
    expect(remainingOligomers).toBe(0);
    const totals = w.monomerTotals();
    expect(totals.n0).toBe(w.initN0);
    expect(totals.n1).toBe(w.initN1);
  });

  it('failed seeding leaves monomer totals unchanged', () => {
    const w = new OligomerWorld(defaultConfig({ width: 4, height: 4, initMonomersPerTile: 2 }));
    expect(() => w.seedCompartment(0, 0, speciesByLabel('0011'), 100, [], 1)).toThrow();
    const totals = w.monomerTotals();
    expect(totals.n0).toBe(w.initN0);
    expect(totals.n1).toBe(w.initN1);
  });

  it('is bit-deterministic and observer-pure (same digest with or without observer)', () => {
    const w1 = seedStarterWorld({ enableLyse: true, seed: 7 });
    const w2 = seedStarterWorld({ enableLyse: true, seed: 7 });
    const obs = new OligomerObserver(w2);
    for (let t = 0; t < 300; t++) {
      w1.step();
      w2.step(obs);
    }
    expect(w1.digest()).toBe(w2.digest());
  });
});
