import { describe, expect, it } from 'vitest';
import { defaultRoamConfig, G_ADULT, PLAN_MODES, PLAN_REST, planEntry, ROAM_GENES, type RoamConfig, RoamWorld } from '../src/roam/kernel.ts';
import { foundRoam, ROAM_PLANS, ROAM_TYPES, roamShapes } from '../src/roam/view.ts';

const small = (over: Partial<RoamConfig> = {}): RoamConfig => ({ ...defaultRoamConfig(), size: 48, matter: 24_000, startPatches: 2, patchEvery: 100, ...over });

/** Every bond joins two live cells, and no cell carries a bond to an empty tile. */
function bondsSound(w: RoamWorld): boolean {
  const s = w.size;
  for (let i = 0; i < w.n; i++) {
    const x = i % s;
    const e = i - x + ((x + 1) % s);
    const so = (i + s) % w.n;
    if (w.bondE[i] && !(w.alive[i] && w.alive[e])) return false;
    if (w.bondS[i] && !(w.alive[i] && w.alive[so])) return false;
    if (!w.alive[i] && (w.store[i] !== 0 || w.cid[i] !== 0)) return false;
  }
  return true;
}

describe('roam world', () => {
  it('conserves matter exactly at every step, keeps bonds sound, and never puts two cells on a tile', () => {
    const w = foundRoam({ seed: 3, size: 48, start: 'all', mut: 0.1, overrides: { matter: 24_000, startPatches: 2, patchEvery: 100 } });
    expect(w.census().residual).toBe(0);
    for (let s = 0; s < 3000; s++) {
      w.stepOnce();
      const c = w.census();
      expect(c.residual).toBe(0);
      if (s % 10 !== 0) continue;
      expect(bondsSound(w)).toBe(true);
      const ids = new Set<number>();
      for (let i = 0; i < w.n; i++) if (w.alive[i]) ids.add(w.cid[i]);
      expect(ids.size).toBe(c.cells);
    }
    const c = w.census();
    expect(c.divisions).toBeGreaterThan(0);
    expect(c.releases).toBeGreaterThan(0);
    expect(c.bodyDeaths).toBeGreaterThan(0);
    expect(c.cellMoves).toBeGreaterThan(0);
    expect(c.patches).toBeGreaterThan(2);
  });

  it('a seed gives one history, and another seed a different one', () => {
    const run = (seed: number) => {
      const w = foundRoam({ seed, size: 48, start: 'chasers', overrides: { matter: 24_000, startPatches: 2 } });
      w.advance(800);
      return w.digest();
    };
    expect(run(5)).toBe(run(5));
    expect(run(5)).not.toBe(run(6));
  });

  it('a body moves as one piece: its cells keep their places relative to each other', () => {
    const w = new RoamWorld(small({ startPatches: 0, mut: 0, leakSide: 0, leakCell: 0, moveCost: 0, patchFood: 24_000 }));
    // Wanderer genes with an adult size of 16: fed by hand, the founder grows into one bonded body.
    const genes = [0, 512, -512, 512, 0];
    const tile = 24 * 48 + 24;
    expect(w.found(tile, genes, 1)).toBe(true);
    for (let s = 0; s < 400; s++) {
      for (let i = 0; i < w.n; i++) if (w.alive[i] && w.reservoir > 0) { w.food[i]++; w.reservoir--; }
      w.stepOnce();
    }
    // The founder's body (cell 1 is in it) has reached 16 cells; it also let some single cells go.
    const groups = new Int32Array(w.n);
    const sizes = w.bodySizes(groups);
    let home = -1;
    for (let i = 0; i < w.n; i++) if (w.alive[i] && w.cid[i] === 1) home = groups[i];
    expect(sizes[home - 1]).toBe(16);
    const members = new Set<number>();
    for (let i = 0; i < w.n; i++) if (w.alive[i] && groups[i] === home) members.add(w.cid[i]);
    const shape = () => {
      const at = new Map<number, number>();
      for (let i = 0; i < w.n; i++) if (w.alive[i] && members.has(w.cid[i])) at.set(w.cid[i], i);
      const ids = [...at.keys()].sort((a, b) => a - b);
      const s = w.size;
      const x0 = at.get(ids[0])! % s;
      const y0 = Math.floor(at.get(ids[0])! / s);
      return { count: ids.length, anchor: at.get(ids[0])!, rel: ids.map((id) => `${(at.get(id)! % s - x0 + s) % s},${(Math.floor(at.get(id)! / s) - y0 + s) % s}`).join(' ') };
    };
    const before = shape();
    const moves = w.census().cellMoves;
    // No more food, and nothing leaks: the body keeps its 16 cells and only travels.
    w.advance(40);
    const after = shape();
    expect(after.count).toBe(16);
    expect(w.census().cellMoves).toBeGreaterThan(moves);
    expect(after.anchor).not.toBe(before.anchor);
    expect(after.rel).toBe(before.rel);
    expect(w.census().residual).toBe(0);
  });

  it('a body is blocked by another body and never overlaps it', () => {
    const w = new RoamWorld(small({ startPatches: 0, mut: 0, leakSide: 0, leakCell: 0, moveCost: 0, turnMax: 0 }));
    // A sitter directly east of a driver that heads east forever.
    const row = 10 * 48;
    expect(w.found(row + 20, [0, 512, -512, 0, 0], 1, 50)).toBe(true);
    expect(w.found(row + 23, [0, 0, -512, 0, 0], 3, 50)).toBe(true);
    w.heading[row + 20] = 0;
    w.advance(60);
    const c = w.census();
    expect(c.cells).toBe(2);
    expect(w.alive[row + 23]).toBe(1);
    expect(c.blocked).toBeGreaterThan(0);
  });

  it('a starving body shrinks a cell or two at a time, and what it held goes to the reservoir, not to the ground', () => {
    // No patch can drop: the patch rhythm is longer than the run.
    const w = new RoamWorld(small({ startPatches: 0, mut: 0, patchFood: 24_000, patchEvery: 1_000_000 }));
    expect(w.found(100, [0, 0, -512, 512, 0], 3)).toBe(true);
    for (let s = 0; s < 300; s++) {
      for (let i = 0; i < w.n; i++) if (w.alive[i] && w.reservoir > 0) { w.food[i]++; w.reservoir--; }
      w.stepOnce();
    }
    const grown = w.census();
    expect(grown.cells).toBeGreaterThan(4);
    const sizes = new Set<number>();
    let cells = grown.cells;
    let biggestDrop = 0;
    for (let s = 0; s < 40_000 && cells > 0; s++) {
      w.stepOnce();
      const c = w.census();
      expect(c.cells).toBeLessThanOrEqual(cells);
      // The ground is never given anything: its food only falls as the cells still on it eat.
      expect(c.food).toBeLessThanOrEqual(grown.food);
      biggestDrop = Math.max(biggestDrop, cells - c.cells);
      cells = c.cells;
      sizes.add(cells);
    }
    const end = w.census();
    expect(end.cells).toBe(0);
    expect(end.held).toBe(0);
    expect(end.residual).toBe(0);
    expect(end.patches).toBe(0);
    expect(sizes.size).toBeGreaterThan(3);
    expect(biggestDrop).toBeLessThanOrEqual(2);
    expect(end.reservoir).toBe(w.total - end.food);
    expect(end.reservoir).toBeGreaterThanOrEqual(w.total - grown.food);
  });

  it('a daughter is let go only once the body has reached the adult size its gene asks for', () => {
    for (const [gene, adult] of [[-512, 1], [0, 8], [512, 16]] as const) {
      const w = new RoamWorld(small({ startPatches: 0, mut: 0, patchFood: 24_000 }));
      const genes = [0, 0, -512, 0, 0];
      genes[G_ADULT] = gene;
      expect(w.found(200, genes, 3)).toBe(true);
      let biggest = 1;
      for (let s = 0; s < 600; s++) {
        for (let i = 0; i < w.n; i++) if (w.alive[i] && w.reservoir > 0) { w.food[i]++; w.reservoir--; }
        const before = w.census().releases;
        w.stepOnce();
        biggest = Math.max(biggest, ...w.bodySizes());
        // A daughter is let go only in a step by whose end her mother's body has its adult size.
        if (w.census().releases > before) expect(biggest).toBe(adult);
      }
      expect(biggest).toBe(adult);
      expect(w.census().releases).toBeGreaterThan(0);
    }
  });

  it('counts one-cell bodies, and counts a death as a newborn\'s only when the cell never divided', () => {
    // A lone cell with no food: one single, and its death is a newborn's.
    const lone = new RoamWorld(small({ startPatches: 0, mut: 0, patchEvery: 1_000_000 }));
    expect(lone.found(300, [0, 0, -512, -512, 0], 3, 40)).toBe(true);
    expect(lone.census().singles).toBe(1);
    lone.advance(2000);
    expect(lone.census()).toMatchObject({ cells: 0, bodyDeaths: 1, newbornDeaths: 1, singles: 0 });
    // A cell that divides once and lets the daughter go: two singles; the mother's death is not a newborn's.
    const pair = new RoamWorld(small({ startPatches: 0, mut: 0, patchEvery: 1_000_000 }));
    expect(pair.found(300, [0, 0, -512, -512, 0], 3, 2 * pair.cfg.birthStore)).toBe(true);
    pair.stepOnce();
    expect(pair.census()).toMatchObject({ cells: 2, bodies: 2, singles: 2, releases: 1 });
    expect(pair.grew[300]).toBe(1);
    pair.advance(4000);
    expect(pair.census()).toMatchObject({ cells: 0, bodyDeaths: 2, newbornDeaths: 1 });
    // A bonded pair is one body and no single.
    const body = new RoamWorld(small({ startPatches: 0, mut: 0, patchEvery: 1_000_000 }));
    expect(body.found(300, [0, 0, -512, 512, 0], 3, 2 * body.cfg.birthStore)).toBe(true);
    body.stepOnce();
    expect(body.census()).toMatchObject({ cells: 2, bodies: 1, singles: 0, releases: 0 });
    body.advance(6000);
    expect(body.census()).toMatchObject({ cells: 0, bodyDeaths: 1, newbornDeaths: 0 });
  });

  it('a copy error moves a gene by exactly one step, and with none every descendant matches its founder', () => {
    const exact = foundRoam({ seed: 2, size: 48, start: 'chasers', mut: 0, overrides: { matter: 24_000, startPatches: 2 } });
    exact.advance(1500);
    let cells = 0;
    for (let i = 0; i < exact.n; i++) {
      if (!exact.alive[i]) continue;
      cells++;
      for (let g = 0; g < ROAM_GENES; g++) expect(exact.genes[i * ROAM_GENES + g]).toBe(ROAM_TYPES.chaser.genes[g]);
    }
    expect(cells).toBeGreaterThan(48);
    // One division with every gene set to change: the daughter differs from her mother by one step in each gene.
    const w = new RoamWorld(small({ startPatches: 0, mut: 1, mutStep: 64, leakSide: 0, leakCell: 0 }));
    const mother = [100, -100, 0, 448, -448];
    expect(w.found(500, mother, 1, 2 * w.cfg.birthStore)).toBe(true);
    w.stepOnce();
    expect(w.census().cells).toBe(2);
    let daughters = 0;
    for (let i = 0; i < w.n; i++) {
      if (!w.alive[i] || w.cid[i] === 1) continue;
      daughters++;
      for (let g = 0; g < ROAM_GENES; g++) expect(Math.abs(w.genes[i * ROAM_GENES + g] - mother[g])).toBe(64);
    }
    expect(daughters).toBe(1);
    for (let g = 0; g < ROAM_GENES; g++) expect(w.genes[500 * ROAM_GENES + g]).toBe(mother[g]);
  });

  it('refuses settings it cannot run', () => {
    expect(() => new RoamWorld(small({ size: 4 }))).toThrow('Invalid size');
    expect(() => new RoamWorld(small({ moveMax: 0.75 }))).toThrow('Invalid moveMax');
    expect(() => new RoamWorld(small({ minStore: 0 }))).toThrow('Invalid minStore');
    expect(() => new RoamWorld(small({ patchFood: 30_000 }))).toThrow('Invalid patchFood');
    expect(() => foundRoam({ seed: 1, start: 'nobody' as never })).toThrow('Unknown start');
    expect(() => foundRoam({ seed: 1, founders: 1.5 })).toThrow('Invalid founders');
    const w = new RoamWorld(small());
    expect(() => w.found(0, [0, 0, 0, 0], 1)).toThrow('found needs 5 genes');
    expect(() => w.found(0, [0, 0, 0, 0, 900], 1)).toThrow('Invalid gene');
  });
});

describe('roam world, growth by plan', () => {
  const planned = (over: Partial<RoamConfig> = {}): RoamConfig => small({ plan: true, startPatches: 0, mut: 0, leakSide: 0, leakCell: 0, moveCost: 0, patchFood: 24_000, ...over });
  /** A world with one founder that never moves, fed by hand until `done` or 4,000 steps. */
  function grow(plan: readonly number[], done: (w: RoamWorld) => boolean, over: Partial<RoamConfig> = {}): RoamWorld {
    const w = new RoamWorld(planned(over));
    expect(w.found(24 * 48 + 24, [0, 0, -512, 0, 0], 1, undefined, w.addPlan(plan))).toBe(true);
    for (let s = 0; s < 4000 && !done(w); s++) {
      for (let i = 0; i < w.n; i++) if (w.alive[i] && w.reservoir > 0) { w.food[i]++; w.reservoir--; }
      w.stepOnce();
      expect(w.census().residual).toBe(0);
    }
    return w;
  }
  const outlines = (w: RoamWorld) => roamShapes(w, 999).shapes;

  it('growth by genes gives the histories it gave before plans were added', () => {
    const run = (seed: number, start: 'chasers' | 'all' | 'chasers-singles', mut: number) => {
      const w = foundRoam({ seed, size: 48, start, mut, overrides: { matter: 24_000, startPatches: 2 } });
      w.advance(1500);
      return w.digest();
    };
    expect(run(5, 'chasers', 0.02)).toBe(2930199800);
    expect(run(3, 'all', 0.1)).toBe(2753227683);
    expect(run(2, 'chasers-singles', 0)).toBe(866176488);
  });

  it('conserves matter exactly, keeps bonds sound, keeps one plan per body, and stays under the size limit', () => {
    const w = foundRoam({ seed: 3, size: 48, start: 'grown-all', mut: 0.1, overrides: { matter: 24_000, startPatches: 2, patchEvery: 100 } });
    expect(w.cfg.plan).toBe(true);
    expect(w.cfg.planMut).toBe(0.25);
    const bodyOf = new Int32Array(w.n);
    for (let s = 0; s < 3000; s++) {
      w.stepOnce();
      const c = w.census();
      expect(c.residual).toBe(0);
      if (s % 10 !== 0) continue;
      expect(bondsSound(w)).toBe(true);
      const sizes = w.bodySizes(bodyOf);
      expect(Math.max(...sizes)).toBeLessThanOrEqual(32);
      const planOfBody = new Map<number, number>();
      const ids = new Set<number>();
      for (let i = 0; i < w.n; i++) {
        if (!w.alive[i]) { expect(w.pid[i] | w.mode[i] | w.orient[i]).toBe(0); continue; }
        ids.add(w.cid[i]);
        expect(w.pid[i]).toBeGreaterThanOrEqual(1);
        expect(w.pid[i]).toBeLessThan(w.plans.length);
        const had = planOfBody.get(bodyOf[i]);
        if (had === undefined) planOfBody.set(bodyOf[i], w.pid[i]);
        else expect(w.pid[i]).toBe(had);
      }
      expect(ids.size).toBe(c.cells);
    }
    const c = w.census();
    expect(c.releases).toBeGreaterThan(0);
    expect(c.bodyDeaths).toBeGreaterThan(0);
    expect(c.cellMoves).toBeGreaterThan(0);
    expect(w.plans.length).toBeGreaterThan(7);
  });

  it('a seed gives one history, and another seed a different one', () => {
    const run = (seed: number) => {
      const w = foundRoam({ seed, size: 48, start: 'grown-four', mut: 0.1, overrides: { matter: 24_000, startPatches: 2 } });
      w.advance(800);
      return w.digest();
    };
    expect(run(5)).toBe(run(5));
    expect(run(5)).not.toBe(run(6));
  });

  it('each planted plan grows the outline it was written for, and no body grows past it', () => {
    const cases = [
      { plan: ROAM_PLANS.line, cells: 8, box: [1, 8] },
      { plan: ROAM_PLANS.plate, cells: 9, box: [3, 3] },
      { plan: ROAM_PLANS.block, cells: 8, box: [2, 4] },
      { plan: ROAM_PLANS.cross, cells: 9, box: [5, 5] },
    ];
    for (const want of cases) {
      const full = (w: RoamWorld) => outlines(w).some((o) => o.cells.length === want.cells);
      const w = grow(want.plan, full);
      const all = outlines(w);
      expect(Math.max(...all.map((o) => o.cells.length))).toBe(want.cells);
      const o = all.find((q) => q.cells.length === want.cells)!;
      expect([o.w, o.h].sort()).toEqual(want.box);
      if (want.box[0] === 5) for (const [x, y] of o.cells) expect(x === 2 || y === 2).toBe(true);
    }
  });

  it('a daughter that is let go starts a new body in mode 0, facing away from its mother, with her plan', () => {
    const w = grow(ROAM_PLANS.line, (q) => q.releases >= 1);
    expect(w.releases).toBe(1);
    expect(w.plans.length).toBe(2);
    const bodyOf = new Int32Array(w.n);
    const sizes = w.bodySizes(bodyOf);
    expect(sizes.slice().sort((a, b) => a - b)).toEqual([1, 8]);
    const seed = [...bodyOf.keys()].find((i) => w.alive[i] && sizes[bodyOf[i] - 1] === 1)!;
    expect(w.mode[seed]).toBe(0);
    expect(w.pid[seed]).toBe(1);
    expect(w.grew[seed]).toBe(0);
    // The tile behind it (against the way it faces) holds the cell that let it go, which is in the releasing mode 7.
    const s = w.size;
    const back = (w.orient[seed] + 2) & 3;
    const mother = (((Math.floor(seed / s) + [0, 1, 0, -1][back] + s) % s) * s) + ((seed % s) + [1, 0, -1, 0][back] + s) % s;
    expect(w.alive[mother]).toBe(1);
    expect(w.mode[mother]).toBe(7);
    expect(bodyOf[mother]).not.toBe(bodyOf[seed]);
  });

  it('a cell in a resting mode never divides, however long it is fed', () => {
    // One mode that keeps a daughter in front and then rests: two cells, and no more however long they are fed.
    const two = Array.from({ length: PLAN_MODES }, (_, m) => planEntry(PLAN_REST, 0, m));
    two[0] = planEntry(0, 15, 15);
    const w = grow(two, () => false);
    expect(w.census().cells).toBe(2);
    expect(w.divisions).toBe(1);
    expect(w.releases).toBe(0);
  });

  it('a body at the size limit lets go of a daughter its plan says to keep', () => {
    const w = grow(ROAM_PLANS.bush, (q) => q.releases >= 3, { maxBody: 12 });
    expect(w.releases).toBeGreaterThanOrEqual(3);
    expect(Math.max(...w.bodySizes())).toBe(12);
  });

  it('with no copy errors every body carries a planted plan; with them a new plan differs from its parent in one place of one mode', () => {
    const exact = foundRoam({ seed: 2, size: 48, start: 'grown-four', mut: 0, overrides: { matter: 24_000, startPatches: 2 } });
    exact.advance(1500);
    expect(exact.releases).toBeGreaterThan(20);
    expect(exact.plans.length).toBe(5);
    for (let i = 0; i < exact.n; i++) if (exact.alive[i]) for (let g = 0; g < ROAM_GENES; g++) expect(exact.genes[i * ROAM_GENES + g]).toBe(ROAM_TYPES.block.genes[g]);

    const w = foundRoam({ seed: 2, size: 48, start: 'grown-four', mut: 0, planMut: 1, overrides: { matter: 24_000, startPatches: 2 } });
    w.advance(1500);
    // Every let-go daughter got a new plan.
    expect(w.plans.length - 1).toBe(4 + w.releases);
    for (let id = 5; id < w.plans.length; id++) {
      const parent = w.planParent[id];
      expect(parent).toBeGreaterThanOrEqual(1);
      expect(parent).toBeLessThan(id);
      let fields = 0;
      for (let m = 0; m < PLAN_MODES; m++) {
        const a = w.plans[id][m];
        const b = w.plans[parent][m];
        expect(a & 15).toBeLessThanOrEqual(PLAN_REST);
        fields += Number((a & 15) !== (b & 15)) + Number(((a >>> 4) & 15) !== ((b >>> 4) & 15)) + Number((a >>> 8) !== (b >>> 8));
      }
      expect(fields).toBe(1);
    }
  });

  it('a cell whose tile is taken waits in its mode, and divides once the tile is free', () => {
    const w = new RoamWorld(planned());
    const line = w.addPlan(ROAM_PLANS.line);
    const rest = w.addPlan(Array.from({ length: PLAN_MODES }, (_, m) => planEntry(PLAN_REST, 0, m)));
    const s = w.size;
    const at = 24 * s + 24;
    expect(w.found(at, [0, 0, -512, 0, 0], 1, undefined, line)).toBe(true);
    // A second founder that only rests sits on the tile the first one faces.
    const d = w.orient[at];
    const ahead = (((Math.floor(at / s) + [0, 1, 0, -1][d] + s) % s) * s) + ((at % s) + [1, 0, -1, 0][d] + s) % s;
    expect(w.found(ahead, [0, 0, -512, 0, 0], 2, undefined, rest)).toBe(true);
    const feed = () => { if (w.reservoir >= 2) { w.food[at] += 2; w.reservoir -= 2; } };
    for (let k = 0; k < 60; k++) { feed(); w.stepOnce(); }
    // Well past two births' worth, and still one cell in mode 0.
    expect(w.store[at]).toBeGreaterThanOrEqual(2 * w.cfg.birthStore);
    expect(w.divisions).toBe(0);
    expect(w.mode[at]).toBe(0);
    expect(w.census().cells).toBe(2);
    // Take the blocker away (its matter back to the reservoir): the waiting cell divides on the next step.
    w.reservoir += w.store[ahead];
    w.alive[ahead] = 0; w.store[ahead] = 0; w.cid[ahead] = 0; w.pid[ahead] = 0; w.mode[ahead] = 0; w.orient[ahead] = 0; w.fam[ahead] = 0; w.heading[ahead] = 0;
    for (let g = 0; g < ROAM_GENES; g++) w.genes[ahead * ROAM_GENES + g] = 0;
    w.stepOnce();
    expect(w.census().residual).toBe(0);
    expect(w.divisions).toBe(1);
    expect(w.alive[ahead]).toBe(1);
    expect(w.mode[at]).toBe(15);
    expect(w.mode[ahead]).toBe(1);
    expect(w.pid[ahead]).toBe(line);
    expect(w.bodySizes()).toEqual([2]);
  });

  it('when two cells of a body want the same tile, each gets it about half the time', () => {
    // The founder keeps a daughter to its right and then one ahead. The right daughter first keeps one on her far
    // side, so that she and the front daughter are both ready, in the same step, for the tile between them.
    const plan = Array.from({ length: PLAN_MODES }, (_, m) => planEntry(PLAN_REST, 0, m));
    plan[0] = planEntry(1, 2, 1); // right daughter, in mode 2
    plan[1] = planEntry(0, 3, 15); // front daughter, in mode 3
    plan[2] = planEntry(1, 15, 6); // the right daughter: one to her right (away from the shared tile), then mode 6
    plan[6] = planEntry(3, 15, 15); // then one to her left: the shared tile
    plan[3] = planEntry(1, 15, 15); // the front daughter keeps one to her right: the shared tile
    let fromFront = 0;
    const runs = 200;
    for (let seed = 1; seed <= runs; seed++) {
      const w = new RoamWorld({ ...planned(), size: 16, matter: 6000, patchFood: 6000, seed });
      const at = 8 * 16 + 8;
      expect(w.found(at, [0, 0, -512, 0, 0], 1, undefined, w.addPlan(plan))).toBe(true);
      const face = w.orient[at];
      for (let k = 0; k < 2000 && w.census().cells < 5; k++) {
        for (let i = 0; i < w.n; i++) if (w.alive[i] && w.reservoir > 0) { w.food[i]++; w.reservoir--; }
        w.stepOnce();
      }
      expect(w.bodySizes()).toEqual([5]);
      // The fifth cell faces away from its mother: the front daughter's child faces to the founder's right.
      const fifth = [...w.cid.keys()].find((i) => w.cid[i] === 5)!;
      if (w.orient[fifth] === ((face + 1) & 3)) fromFront++;
      else expect(w.orient[fifth]).toBe(face);
    }
    expect(fromFront).toBeGreaterThan(runs * 0.4);
    expect(fromFront).toBeLessThan(runs * 0.6);
  });

  it('counts a body that reaches round the arena and its mirror image as one outline', () => {
    const w = new RoamWorld({ ...defaultRoamConfig(), size: 8, matter: 6000, patchFood: 6000, patchRadius: 2, startPatches: 0 });
    const at = (x: number, y: number) => (((y % 8) + 8) % 8) * 8 + (((x % 8) + 8) % 8);
    const cell = (x: number, y: number) => { const c = at(x, y); w.alive[c] = 1; w.store[c] = 100; w.reservoir -= 100; w.cid[c] = w.nextCid++; return c; };
    // A row all the way round, joined along seven of its eight seams, with three cells sticking out; then its
    // mirror image four rows down, with the row left unjoined at a different seam.
    const body = (y: number, flip: boolean, gap: number) => {
      const fx = (x: number) => (flip ? -x : x);
      for (let x = 0; x < 8; x++) cell(x, y);
      for (let x = 0; x < 8; x++) if (x !== gap) w.bondE[at(x, y)] = 1;
      cell(fx(7), y + 1); w.bondS[at(fx(7), y)] = 1;
      cell(fx(3), y - 1); w.bondS[at(fx(3), y - 1)] = 1;
      cell(fx(0), y - 1); w.bondS[at(fx(0), y - 1)] = 1;
    };
    body(0, false, 7);
    body(4, true, 2);
    expect(w.census().residual).toBe(0);
    expect(w.bodySizes()).toEqual([11, 11]);
    const got = roamShapes(w, 9);
    expect(got.outlines).toBe(1);
    expect(got.shapes[0].count).toBe(2);
    expect(got.shapes[0].cells.length).toBe(11);
  });

  it('with copy errors switched off by an override, plans do not change either', () => {
    const w = foundRoam({ seed: 2, size: 48, start: 'grown-four', overrides: { mut: 0, matter: 24_000, startPatches: 2 } });
    expect(w.cfg.planMut).toBe(0);
    w.advance(1500);
    expect(w.releases).toBeGreaterThan(20);
    expect(w.plans.length).toBe(5);
    expect(foundRoam({ seed: 2, size: 48, start: 'grown-four', overrides: { mut: 0, planMut: 0.5 } }).cfg.planMut).toBe(0.5);
  });

  it('refuses plans and settings it cannot run', () => {
    const w = new RoamWorld(planned());
    const rest = Array.from({ length: PLAN_MODES }, (_, m) => planEntry(PLAN_REST, 0, m));
    expect(() => w.found(0, [0, 0, 0, 0, 0], 1)).toThrow(/plan number/);
    expect(() => w.addPlan(rest.slice(1))).toThrow(/16 modes/);
    expect(() => w.addPlan(rest.map((e, m) => (m === 3 ? 9 : e)))).toThrow(/act/);
    expect(() => w.addPlan(rest, 5)).toThrow(/parent plan/);
    const id = w.addPlan(rest);
    expect(() => w.found(0, [0, 0, 0, 0, 0], 1, undefined, id + 1)).toThrow(/plan number/);
    expect(w.found(0, [0, 0, 0, 0, 0], 1, undefined, id)).toBe(true);
    const plain = new RoamWorld(small());
    expect(() => plain.addPlan(rest)).toThrow(/plan growth/);
    expect(() => plain.found(0, [0, 0, 0, 0, 0], 1, undefined, 1)).toThrow(/plan number/);
    expect(() => new RoamWorld(small({ maxBody: 8 }))).toThrow(/need plan/);
    expect(() => new RoamWorld(small({ planMut: 0.1 }))).toThrow(/need plan/);
    expect(() => new RoamWorld(planned({ maxBody: 0 }))).toThrow(/maxBody/);
    expect(() => new RoamWorld(planned({ planMut: 2 }))).toThrow(/planMut/);
  });
});

describe('roam world, feeding by touch', () => {
  const still = [0, 0, -512, 0, 0];
  /** An empty world with touch feeding, already `age` steps old, and a plan that only rests. */
  function touching(seal: number, age: number): { w: RoamWorld; rest: number } {
    const w = new RoamWorld(small({ plan: true, drain: 3, seal, startPatches: 0, mut: 0, leakSide: 0, leakCell: 0, moveCost: 0, patchFood: 24_000 }));
    const rest = w.addPlan(Array.from({ length: PLAN_MODES }, (_, m) => planEntry(PLAN_REST, 0, m)));
    w.advance(age);
    return { w, rest };
  }
  /** Lay a body of `cells` in a row eastward from `tile` by hand, each cell holding 150. */
  function put(w: RoamWorld, tile: number, cells: number, plan: number, since: number, heading = 0): void {
    for (let j = 0; j < cells; j++) {
      const c = tile + j;
      w.alive[c] = 1; w.store[c] = 150; w.reservoir -= 150; w.cid[c] = w.nextCid++; w.fam[c] = 2; w.pid[c] = plan; w.mode[c] = 15; w.grew[c] = 1;
      w.since[c] = since; w.heading[c] = heading;
      for (let g = 0; g < ROAM_GENES; g++) w.genes[c * ROAM_GENES + g] = still[g];
      if (j > 0) w.bondE[c - 1] = 1;
    }
  }
  const held = (w: RoamWorld, tile: number, cells: number) => { let sum = 0; for (let j = 0; j < cells; j++) sum += w.store[tile + j]; return sum; };

  it('conserves matter exactly with touch feeding on, and matter does change hands', () => {
    const w = foundRoam({ seed: 3, size: 48, start: 'grown-all', mut: 0.1, drain: 2, overrides: { matter: 24_000, startPatches: 2, patchEvery: 100 } });
    expect(w.cfg.drain).toBe(2);
    for (let s = 0; s < 3000; s++) {
      w.stepOnce();
      expect(w.census().residual).toBe(0);
      if (s % 10 === 0) expect(bondsSound(w)).toBe(true);
    }
    expect(w.census().drained).toBeGreaterThan(0);
  });

  it('a body takes from a touching body half its size, through each side, and not from one that is larger than half', () => {
    const { w, rest } = touching(0, 0);
    const s = w.size;
    const row = 20 * s + 10;
    put(w, row, 4, rest, 0);
    // Under the row: two cells (half of four) touching it along two sides. Above it: three cells along three sides.
    put(w, row + s, 2, rest, 0);
    put(w, row - s, 3, rest, 0);
    expect(w.census().residual).toBe(0);
    expect(w.bodySizes().sort()).toEqual([2, 3, 4]);
    w.stepOnce();
    expect(w.census().residual).toBe(0);
    // Two touching sides, 3 through each; the three-cell body neither gives nor takes.
    expect(w.census().drained).toBe(6);
    expect(held(w, row + s, 2)).toBe(300 - 6);
    expect(held(w, row, 4)).toBe(600 + 6);
    expect(held(w, row - s, 3)).toBe(450);
    w.advance(20);
    expect(w.census().drained).toBe(6 * 21);
    expect(held(w, row - s, 3)).toBe(450);
  });

  it('a new body neither loses nor takes by touch until its seal ends, and then does', () => {
    const { w, rest } = touching(40, 50);
    const s = w.size;
    const born = w.step;
    // An old row with a new single cell pressed against it from below (heading up, so it stays blocked there).
    const oldRow = 10 * s + 10;
    put(w, oldRow, 4, rest, 0);
    put(w, oldRow + s, 1, rest, born, 3);
    // A new row pressed down onto an old single cell.
    const newRow = 30 * s + 10;
    put(w, newRow, 4, rest, born, 1);
    put(w, newRow + s, 1, rest, 0);
    expect(w.census().residual).toBe(0);
    w.advance(40);
    // Forty steps of contact and nothing has moved either way; the blocked new bodies kept their headings.
    expect(w.census().drained).toBe(0);
    expect(w.alive[oldRow + s]).toBe(1);
    expect(w.heading[oldRow + s]).toBe(3);
    expect(w.alive[newRow + s]).toBe(1);
    expect(w.heading[newRow]).toBe(1);
    expect(w.blocked).toBeGreaterThan(0);
    w.stepOnce();
    // The seal is over: the old row takes from the single under it, and the row that was new takes from its single.
    expect(w.census().drained).toBe(6);
    expect(w.store[oldRow + s]).toBe(150 - 3);
    expect(w.store[newRow + s]).toBe(150 - 3);
    expect(w.census().residual).toBe(0);
  });

  it('a new body runs straight away from its parent at top speed while sealed', () => {
    const { w, rest } = touching(40, 50);
    const s = w.size;
    const at = 20 * s + 10;
    put(w, at, 1, rest, w.step, 0);
    w.advance(40);
    // Forty steps at a quarter of a tile a step, due east: about ten tiles, all in its own row.
    const now = [...w.cid.keys()].find((i) => w.alive[i])!;
    expect(Math.floor(now / s)).toBe(20);
    expect((now % s) - 10).toBeGreaterThanOrEqual(5);
    expect((now % s) - 10).toBeLessThanOrEqual(16);
    const here = now;
    w.advance(200);
    // After the seal it follows its genes, which here say stay.
    expect(w.alive[here]).toBe(1);
  });

  it('refuses a seal without drain, and a drain of nothing', () => {
    expect(() => new RoamWorld(small({ seal: 10 }))).toThrow(/seal needs drain/);
    expect(() => new RoamWorld(small({ drain: 0 }))).toThrow(/drain/);
    expect(() => new RoamWorld(small({ drain: 1.5 }))).toThrow(/drain/);
  });
});

describe('roam world, matter that travels through the body (flow)', () => {
  const still = [0, 0, -512, 0, 0];
  function quiet(over: Partial<RoamConfig> = {}): RoamWorld {
    return new RoamWorld(small({ plan: true, flow: 1 / 8, startPatches: 0, mut: 0, leakSide: 0, leakCell: 0, moveCost: 0, patchFood: 24_000, ...over }));
  }
  /** Lay cells in a row eastward from `tile`, each the daughter of the one before (facing east), with the given stores. */
  function line(w: RoamWorld, tile: number, stores: number[], plan: number, modes: number[], made: number[]): void {
    stores.forEach((st, j) => {
      const c = tile + j;
      w.alive[c] = 1; w.store[c] = st; w.reservoir -= st; w.cid[c] = w.nextCid++; w.fam[c] = 2; w.pid[c] = plan; w.grew[c] = 1;
      w.mode[c] = modes[j]; w.made[c] = made[j]; w.mom[c] = j > 0 ? 1 : 0; w.orient[c] = 0; w.heading[c] = 0;
      for (let g = 0; g < ROAM_GENES; g++) w.genes[c * ROAM_GENES + g] = still[g];
      if (j > 0) w.bondE[c - 1] = 1;
    });
  }
  const restAll = Array.from({ length: PLAN_MODES }, (_, m) => planEntry(PLAN_REST, 0, m));

  it('conserves matter exactly, keeps bonds sound, gives one history per seed, and bodies do break', () => {
    const make = () => foundRoam({ seed: 5, size: 48, start: 'grown-all', mut: 0.05, drain: 2, flow: 1 / 64, life: 2000, overrides: { matter: 24_000, startPatches: 2, patchEvery: 100 } });
    const a = make();
    const b = make();
    expect(a.cfg.flow).toBe(1 / 64);
    expect(a.cfg.life).toBe(2000);
    for (let s = 0; s < 4000; s++) {
      a.stepOnce();
      b.stepOnce();
      expect(a.census().residual).toBe(0);
      if (s % 20 === 0) expect(bondsSound(a)).toBe(true);
    }
    expect(a.digest()).toBe(b.digest());
    const c = a.census();
    expect(c.flowed).toBeGreaterThan(0);
    expect(c.splits).toBeGreaterThan(0);
    expect(c.worn).toBeGreaterThan(0);
  });

  it('moves the set share of the difference along a bond each step, from fuller to emptier', () => {
    const w = quiet();
    const rest = w.addPlan(restAll);
    const at = 20 * w.size + 10;
    line(w, at, [300, 100], rest, [0, 0], [0, 0]);
    w.stepOnce();
    expect(w.store[at]).toBe(275);
    expect(w.store[at + 1]).toBe(125);
    expect(w.census().flowed).toBe(25);
    expect(w.census().residual).toBe(0);
  });

  it('a starved link dies and the body breaks; its mother returns to the mode that made it, its daughter starts again', () => {
    const w = quiet({ flow: 1 / 65536 });
    const rest = w.addPlan(restAll);
    const at = 20 * w.size + 10;
    line(w, at, [150, 10, 150], rest, [9, 9, 9], [0, 5, 3]);
    w.stepOnce();
    expect(w.alive[at + 1]).toBe(0);
    expect(w.mode[at]).toBe(5);
    expect(w.mode[at + 2]).toBe(0);
    expect(w.bondE[at]).toBe(0);
    w.stepOnce();
    expect(w.census().splits).toBe(1);
    expect(w.census().bodies).toBe(2);
    expect(w.census().residual).toBe(0);
  });

  it('deaths in one body come out the same whatever order its cells are listed in', () => {
    type Inner = { liveFlow(k: number): void; labelBodies(): void; bodyStart: Int32Array; bodyLen: Int32Array; cells: Int32Array };
    const run = (stores: number[], leakSide: number, reverse: boolean) => {
      const w = quiet({ flow: 1 / 65536, leakSide, minStore: 16 });
      const rest = w.addPlan(restAll);
      const at = 20 * w.size + 10;
      line(w, at, stores, rest, stores.map(() => 9), stores.map(() => 5));
      const inner = w as unknown as Inner;
      inner.labelBodies();
      const k = w.label[at];
      if (reverse) inner.cells.subarray(inner.bodyStart[k], inner.bodyStart[k] + inner.bodyLen[k]).reverse();
      inner.liveFlow(k);
      expect(w.census().residual).toBe(0);
      return stores.map((_, j) => [w.alive[at + j], w.store[at + j], w.mode[at + j]]);
    };
    // A neighbour that dies this step still shields its side this step: the cell with 19 pays 3, keeps 16, lives (and, motherless, starts from 0).
    for (const reverse of [false, true]) expect(run([16, 19], 1, reverse)).toEqual([[0, 0, 0], [1, 16, 0]]);
    // Both ends die: the middle lost its mother (so starts from 0) and its daughter (made at 5); losing the mother wins.
    for (const reverse of [false, true]) expect(run([10, 150, 10], 0, reverse)).toEqual([[0, 0, 0], [1, 150, 0], [0, 0, 0]]);
  });

  it('a daughter kept behind her mother (the two back to back) is still known as the daughter when she dies', () => {
    const w = quiet({ flow: 1 / 65536 });
    const rest = w.addPlan(restAll);
    const at = 20 * w.size + 10;
    // Mother at `at`, facing east; her daughter at `at - 1`, kept behind her, faces west, made in mode 5.
    line(w, at - 1, [10, 150], rest, [9, 9], [5, 0]);
    w.orient[at - 1] = 2; w.mom[at - 1] = 1;
    w.orient[at] = 0; w.mom[at] = 0;
    w.stepOnce();
    expect(w.alive[at - 1]).toBe(0);
    expect(w.mode[at]).toBe(5);
    expect(w.census().residual).toBe(0);
  });

  it('with compost a dead cell leaves its store on its tile as food, and matter still adds up', () => {
    const w = quiet({ flow: 1 / 65536, compost: true });
    const rest = w.addPlan(restAll);
    const at = 20 * w.size + 10;
    line(w, at, [150, 10, 150], rest, [9, 9, 9], [0, 5, 3]);
    const before = w.food[at + 1];
    w.stepOnce();
    expect(w.alive[at + 1]).toBe(0);
    expect(w.food[at + 1]).toBe(before + 10);
    expect(w.census().composted).toBe(10);
    expect(w.census().residual).toBe(0);
    const big = foundRoam({ seed: 5, size: 48, start: 'grown-all', mut: 0.05, drain: 2, flow: 1 / 64, life: 2000, compost: true, overrides: { matter: 24_000, startPatches: 2, patchEvery: 100 } });
    expect(big.cfg.compost).toBe(true);
    for (let s = 0; s < 3000; s++) { big.stepOnce(); expect(big.census().residual).toBe(0); }
    expect(big.census().composted).toBeGreaterThan(0);
    expect(bondsSound(big)).toBe(true);
  });

  it('with flow a kept daughter can carry changed genes', () => {
    const w = foundRoam({ seed: 2, size: 48, start: 'grown-bushes', mut: 0.2, drain: 2, flow: 1 / 64, overrides: { matter: 24_000, startPatches: 4, patchEvery: 50 } });
    const first = w.genes.slice(0, ROAM_GENES);
    for (let i = 0; i < w.n; i++) if (w.alive[i]) { first.set(w.genes.subarray(i * ROAM_GENES, (i + 1) * ROAM_GENES)); break; }
    let changed = false;
    for (let s = 0; s < 2000 && !changed; s++) {
      w.stepOnce();
      if (w.census().releases > 0) break;
      for (let i = 0; i < w.n && !changed; i++) {
        if (!w.alive[i]) continue;
        for (let g = 0; g < ROAM_GENES; g++) if (w.genes[i * ROAM_GENES + g] !== first[g]) changed = true;
      }
    }
    expect(changed).toBe(true);
  });

  it('a mother regrows a lost daughter where her plan puts it', () => {
    const w = quiet({ flow: 1 / 65536 });
    // Mode 0: keep a daughter in front (she rests); then rest.
    const plan = w.addPlan(Array.from({ length: PLAN_MODES }, (_, m) => (m === 0 ? planEntry(0, 1, 1) : planEntry(PLAN_REST, 0, m))));
    const at = 20 * w.size + 10;
    line(w, at, [300, 10], plan, [1, 1], [0, 0]);
    w.stepOnce();
    // The daughter starved, her mother went back to mode 0, and divided into the same tile in the same step.
    expect(w.alive[at + 1]).toBe(1);
    expect(w.bondE[at]).toBe(1);
    expect(w.mode[at]).toBe(1);
    expect(w.store[at] + w.store[at + 1]).toBe(300);
    expect(w.census().residual).toBe(0);
  });

  it('with flow a kept daughter can carry a changed plan, so one body can hold two plans', () => {
    const w = foundRoam({ seed: 2, size: 48, start: 'grown-bushes', mut: 0, planMut: 1, drain: 2, flow: 1 / 64, overrides: { matter: 24_000, startPatches: 4, patchEvery: 50 } });
    const groups = new Int32Array(w.n);
    let mixed = false;
    for (let s = 0; s < 3000 && !mixed; s++) {
      w.stepOnce();
      w.bodySizes(groups);
      const pidOf = new Map<number, number>();
      for (let i = 0; i < w.n && !mixed; i++) {
        if (!w.alive[i]) continue;
        const p = pidOf.get(groups[i]);
        if (p === undefined) pidOf.set(groups[i], w.pid[i]);
        else if (p !== w.pid[i]) mixed = true;
      }
    }
    expect(mixed).toBe(true);
  });

  it('refuses flow without plans, wear without flow, and a flow of nothing or above an eighth', () => {
    expect(() => new RoamWorld(small({ flow: 1 / 64 }))).toThrow(/flow needs plan/);
    expect(() => new RoamWorld(small({ plan: true, life: 100 }))).toThrow(/life needs flow/);
    expect(() => new RoamWorld(small({ plan: true, flow: 0 }))).toThrow(/flow/);
    expect(() => new RoamWorld(small({ plan: true, flow: 0.2 }))).toThrow(/flow/);
    expect(() => new RoamWorld(small({ plan: true, flow: 1 / 64, life: 1 }))).toThrow(/life/);
    expect(() => new RoamWorld(small({ plan: true, compost: true }))).toThrow(/compost needs flow/);
  });
});
