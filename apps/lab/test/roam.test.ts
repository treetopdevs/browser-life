import { describe, expect, it } from 'vitest';
import { defaultRoamConfig, G_ADULT, ROAM_GENES, type RoamConfig, RoamWorld } from '../src/roam/kernel.ts';
import { foundRoam, ROAM_TYPES } from '../src/roam/view.ts';

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
      if (s % 10 !== 0) continue;
      const c = w.census();
      expect(c.residual).toBe(0);
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
      for (let s = 0; s < 600; s++) {
        for (let i = 0; i < w.n; i++) if (w.alive[i] && w.reservoir > 0) { w.food[i]++; w.reservoir--; }
        w.stepOnce();
      }
      expect(Math.max(...w.bodySizes())).toBe(adult);
      expect(w.census().releases > 0).toBe(true);
    }
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
    const w = new RoamWorld(small());
    expect(() => w.found(0, [0, 0, 0, 0], 1)).toThrow('found needs 5 genes');
    expect(() => w.found(0, [0, 0, 0, 0, 900], 1)).toThrow('Invalid gene');
  });
});
