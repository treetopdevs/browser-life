import { describe, expect, it } from 'vitest';
import {
  ReefWorld,
  createStalkTestGenome,
  defaultReefConfig,
} from '../src/reef/model.ts';
import {
  observeBodies,
  observeDigest,
  observeMatter,
  observeNiches,
} from '../src/reef/observe.ts';

describe('Reef Rung 0: conservation, thermodynamics, shadows, symplastic bridge, determinism', () => {
  it('conserves exact integer matter (residual === 0) across all 4 regimes', () => {
    const regimes = [
      { name: 'FULL', overrides: {} },
      { name: 'NO_SHADOW', overrides: { shadows: false } },
      { name: 'NO_GRAVITY', overrides: { gravity: false } },
      { name: 'NO_BONDS', overrides: { bonds: false } },
    ];

    for (const r of regimes) {
      const world = new ReefWorld(
        defaultReefConfig({ gw: 24, gh: 16, seed: 42, ...r.overrides }),
      );
      world.seedDefaultFounders(12);
      expect(observeMatter(world).residual).toBe(0);

      for (let t = 0; t < 1000; t += 200) {
        world.stepN(200);
        const m = observeMatter(world);
        expect(m.residual, `${r.name} at step ${world.stepCount}`).toBe(0);
        for (let i = 0; i < world.nut.length; i++) {
          expect(world.nut[i]).toBeGreaterThanOrEqual(0);
          expect(world.det[i]).toBeGreaterThanOrEqual(0);
        }
        for (const c of world.cells) {
          expect(c.mass).toBeGreaterThanOrEqual(0);
          expect(c.nut).toBeGreaterThanOrEqual(0);
        }
      }
      expect(world.cells.length, `${r.name} stays alive`).toBeGreaterThan(0);
    }
  });

  it('extinguishes all life in a dark world (light = 0) while conserving all matter', () => {
    const world = new ReefWorld(
      defaultReefConfig({
        gw: 20,
        gh: 12,
        initDetSeabed: 0,
        lightIntensity: 0,
        seed: 7,
      }),
    );
    world.seedDefaultFounders(10);
    world.stepN(1500);
    expect(world.cells.length).toBe(0);
    expect(world.bonds.length).toBe(0);
    expect(observeMatter(world).residual).toBe(0);
  });

  it('casts real vertical shadows from pigmented canopy cells onto cells below', () => {
    const g = createStalkTestGenome();
    const makePair = (shadows: boolean) => {
      const w = new ReefWorld(
        defaultReefConfig({ gw: 16, gh: 16, shadows, gravity: false, waterAtten: 0, seed: 3 }), // no clear-water loss: only cell shadows can dim a cell
      );
      const top = w.seedCell(64, 24, g, 1, 16, 4, 8)!;
      const bot = w.seedCell(64, 80, g, 2, 16, 4, 8)!;
      top.pigment = 0.95;
      bot.pigment = 0.95;
      w.step();
      return { top, bot };
    };

    const full = makePair(true);
    const noShadow = makePair(false);

    expect(full.top.light).toBeGreaterThan(0.8);
    expect(full.bot.light).toBeLessThan(full.top.light * 0.65);
    expect(noShadow.bot.light).toBeCloseTo(1.0, 5);
  });

  it('symplastic bond transport lets a stratified stalk grow faster than unbonded cells', () => {
    const g = createStalkTestGenome();
    const runStratified = (bonded: boolean) => {
      const w = new ReefWorld(
        defaultReefConfig({
          gw: 16,
          gh: 6,
          initNutPerTile: 0,
          initDetSeabed: 0,
          kDiffNut: 0.002, // slow abiotic diffusion -> stratified column
          kMineralize: 0,
          waterAtten: 0.16, // bright surface, dim seabed
          bonds: bonded,
          mutation: false,
          seed: 11,
        }),
      );
      // Put all dissolved nutrients on the seabed row
      for (let tx = 0; tx < w.gw; tx++) {
        w.nut[(w.gh - 1) * w.gw + tx] = 200;
      }
      const x = 64;
      const floorY = w.height - w.config.cellRadius;
      const stepY = w.config.cellRadius * 2.02;
      const stalk: ReturnType<ReefWorld['seedCell']>[] = [];
      for (let k = 0; k < 6; k++) {
        const c = w.seedCell(x, floorY - k * stepY, g, 1, 16, 2, 6.0)!;
        c.anchor = k === 0 ? 1.0 : 0.0;
        c.armor = 0.65;
        stalk.push(c);
      }
      if (bonded) {
        for (let k = 0; k < stalk.length - 1; k++) {
          w.addBond(stalk[k]!, stalk[k + 1]!);
        }
      }
      w.stepN(400);
      let livingMass = 0;
      for (const c of w.cells) livingMass += c.mass + c.nut;
      return { livingMass, cells: w.cells.length, bodies: observeBodies(w) };
    };

    const bonded = runStratified(true);
    const unbonded = runStratified(false);
    expect(bonded.livingMass).toBeGreaterThan(unbonded.livingMass);
    expect(bonded.bodies.multicellBodies).toBeGreaterThan(0);
  });

  it('is bit-deterministic and observer-pure', () => {
    const cfg = defaultReefConfig({ gw: 24, gh: 14, seed: 99 });
    const a = new ReefWorld(cfg);
    const b = new ReefWorld(cfg);
    a.seedDefaultFounders(10);
    b.seedDefaultFounders(10);

    // Everything that can change the next step: every field of every cell (velocities, genome weights), the bonds'
    // endpoints and rest geometry, both matter fields, the id counters and the generator state (a private field, read here only).
    const snapshot = (w: ReefWorld): string =>
      JSON.stringify(
        {
          step: w.stepCount,
          rng: (w as unknown as { rng: { state: number } }).rng.state,
          nextCellId: w.nextCellId,
          nextLineageId: w.nextLineageId,
          cells: w.cells,
          bonds: w.bonds.map((bd) => ({ a: bd.a.id, b: bd.b.id, restLen: bd.restLen, phiA: bd.phiA, phiB: bd.phiB, age: bd.age })),
          nut: w.nut,
          det: w.det,
        },
        (_k, v) => (ArrayBuffer.isView(v) ? Array.from(v as unknown as ArrayLike<number>) : v),
      );
    expect(snapshot(a)).toBe(snapshot(b));

    // `a` is stepped one step at a time and observed along the way; `b` is advanced with stepN and never observed.
    // They must agree exactly after every block of 25 steps, not only at the end.
    for (let block = 0; block < 12; block++) {
      observeMatter(a);
      observeBodies(a);
      observeNiches(a);
      for (let k = 0; k < 25; k++) a.step();
      b.stepN(25);
      expect(snapshot(a), `step ${a.stepCount}`).toBe(snapshot(b));
    }
    expect(a.cells.length).toBeGreaterThan(0);
    expect(a.stepCount).toBe(300);
    expect(observeDigest(a)).toBe(observeDigest(b));
  });
});

describe('Reef Rung 2: mechanical contact grazing, armor defense, contractile swimming', () => {
  it('conserves exact integer matter and extinguishes in darkness with grazing + swimming ON', () => {
    const lit = new ReefWorld(
      defaultReefConfig({ gw: 24, gh: 16, grazing: true, swimming: true, seed: 21 }),
    );
    lit.seedDefaultFounders(16);
    lit.stepN(800);
    expect(observeMatter(lit).residual).toBe(0);
    expect(lit.cells.length).toBeGreaterThan(0);

    const dark = new ReefWorld(
      defaultReefConfig({
        gw: 20,
        gh: 12,
        initDetSeabed: 0,
        lightIntensity: 0,
        grazing: true,
        swimming: true,
        seed: 22,
      }),
    );
    dark.seedDefaultFounders(12);
    dark.stepN(1500);
    expect(dark.cells.length).toBe(0);
    expect(observeMatter(dark).residual).toBe(0);
  });

  it('grazes soft foreign prey faster than armored prey while conserving matter', () => {
    const runDuel = (preyArmor: number) => {
      const w = new ReefWorld(
        defaultReefConfig({
          gw: 16,
          gh: 12,
          gravity: false,
          grazing: true,
          swimming: false,
          mutation: false,
          seed: 5,
        }),
      );
      // Two genetically distinct genomes (distance > 72 on sampled loci)
      const gPred = new Int8Array(102).fill(80);
      const gPrey = new Int8Array(102).fill(-80);
      const pred = w.seedCell(64, 48, gPred, 1, 16, 2, 10.0)!;
      const prey = w.seedCell(69, 48, gPrey, 2, 20, 0, 10.0)!;
      pred.digest = 0.95;
      pred.armor = 0.05;
      prey.digest = 0.0;
      prey.armor = preyArmor;
      for (let t = 0; t < 120; t++) {
        // Keep them in contact and pin traits against GRN relaxation
        pred.digest = 0.95;
        pred.armor = 0.05;
        prey.digest = 0.0;
        prey.armor = preyArmor;
        pred.x = 64;
        pred.y = 48;
        prey.x = 69.5;
        prey.y = 48;
        w.step();
      }
      expect(observeMatter(w).residual).toBe(0);
      return { grazed: w.totalMassGrazed, predEarned: pred.grazeEarned };
    };

    const vsSoft = runDuel(0.05);
    const vsArmored = runDuel(0.92);
    expect(vsSoft.grazed).toBeGreaterThan(vsArmored.grazed);
    expect(vsSoft.predEarned).toBeGreaterThan(0);
  });

  it('propels contractile unanchored cells farther than non-contractile cells', () => {
    const runSwimmer = (contract: number) => {
      const w = new ReefWorld(
        defaultReefConfig({
          gw: 24,
          gh: 16,
          gravity: false,
          swimming: true,
          mutation: false,
          seed: 9,
        }),
      );
      const g = new Int8Array(102);
      const c = w.seedCell(96, 64, g, 1, 16, 0, 12.0)!;
      c.theta = 0; // pointing +x
      for (let t = 0; t < 60; t++) {
        c.pigment = 0.0;
        c.digest = 0.0;
        c.contract = contract;
        c.armor = 0.05;
        c.anchor = 0.0;
        c.divAngle = 0;
        w.step();
      }
      return c.x - 96;
    };

    const active = runSwimmer(0.95);
    const passive = runSwimmer(0.0);
    expect(active).toBeGreaterThan(passive + 10);
  });
});
