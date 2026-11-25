import { describe, expect, it } from 'vitest';
import { defaultSoftRoamConfig, PLAN_REST, planEntry, roamHash, ROAM_GENES, SOFT_U, softRoamAngle, softRoamCos, softRoamSin, type SoftRoamConfig, SoftRoamWorld } from '../src/softroam/kernel.ts';
import { ROAM_PLANS, ROAM_TYPES } from '../src/roam/view.ts';

const cfgOf = (over: Partial<SoftRoamConfig> = {}): SoftRoamConfig => ({ ...defaultSoftRoamConfig(), size: 48, matter: 24_000, startPatches: 2, patchEvery: 100, maxCells: 2048, ...over });
/** No upkeep, no wear, no copy errors, no patches: only what a test puts in. */
const quiet = (over: Partial<SoftRoamConfig> = {}): SoftRoamConfig =>
  cfgOf({ matter: 700_000, startPatches: 0, patchEvery: 1_000_000, mut: 0, planMut: 0, leakSide: 0, leakCell: 0, moveCost: 0, life: undefined, compost: undefined, turnMax: 0, ...over });
const restPlan = Array.from({ length: 16 }, (_, m) => planEntry(PLAN_REST, 0, m));
const line12 = Array.from({ length: 16 }, (_, m) => (m < 11 ? planEntry(0, m + 1, 15) : planEntry(PLAN_REST, 0, m)));
const plate9 = ROAM_PLANS.plate.map((e, m) => (m === 8 ? planEntry(PLAN_REST, 0, 8) : e));
const U = SOFT_U;
const SITTER = [0, 0, -512, 0, 0];

/** Every cell holds just enough to live and nothing divides; the rest goes back to the reservoir. */
function lean(w: SoftRoamWorld): void {
  for (let c = 0; c < w.cap; c++) {
    if (!w.alive[c]) continue;
    w.reservoir += w.store[c] - 150;
    w.store[c] = 150;
  }
}

const live = (w: SoftRoamWorld): number[] => {
  const out: number[] = [];
  for (let c = 0; c < w.cap; c++) if (w.alive[c]) out.push(c);
  return out;
};

/** The whole state keyed by cid, so worlds that keep cells in different slots can be compared. */
function byCid(w: SoftRoamWorld): string {
  const rows: string[] = [];
  for (const c of live(w)) {
    const braces: number[] = [];
    for (let k = 0; k < 4; k++) if (w.braceTo[c * 4 + k] >= 0) braces.push(w.cid[w.braceTo[c * 4 + k]] * 4096 + w.braceRest[c * 4 + k]);
    braces.sort((a, b) => a - b);
    rows.push([w.cid[c], w.x[c], w.y[c], w.vx[c], w.vy[c], w.store[c], w.mode[c], w.pid[c], w.mother[c] >= 0 ? w.cid[w.mother[c]] : 0, w.gx[c], w.gy[c], w.heading[c], braces.join('+')].join(','));
  }
  rows.sort((a, b) => Number(a.split(',')[0]) - Number(b.split(',')[0]));
  return rows.join(';');
}

/** A busy world: the six planted plans, copy errors, hunger, wear, compost and patches. Founders are placed by hash. */
function busy(seed: number, over: Partial<SoftRoamConfig> = {}, founders = 18): SoftRoamWorld {
  const w = new SoftRoamWorld(cfgOf({ seed, mut: 0.05, planMut: 0.2, life: 500, compost: true, patchEvery: 60, startPatches: 3, ...over }));
  const names = ['line', 'plate', 'cross', 'block', 'speck', 'bush'] as const;
  const plans = names.map((n) => w.addPlan(ROAM_PLANS[n]));
  const types = [ROAM_TYPES.line, ROAM_TYPES.plate, ROAM_TYPES.cross, ROAM_TYPES.block, ROAM_TYPES.speck, ROAM_TYPES.bush];
  let placed = 0;
  for (let k = 0; placed < founders && k < 1000; k++) {
    const px = roamHash(seed, 0, k, 41) % (w.size * U);
    const py = roamHash(seed, 0, k, 42) % (w.size * U);
    const j = placed % names.length;
    if (w.found(px, py, types[j].genes, j + 1, undefined, plans[j]) >= 0) placed++;
  }
  expect(placed).toBe(founders);
  return w;
}

describe('soft roam: sine table and arithmetic helpers', () => {
  it('has a literal integer sine table that closes up and inverts', () => {
    expect(softRoamSin(0)).toBe(0);
    expect(softRoamSin(256)).toBe(16384);
    expect(softRoamSin(512)).toBe(0);
    expect(softRoamSin(768)).toBe(-16384);
    expect(softRoamCos(0)).toBe(16384);
    expect(softRoamCos(512)).toBe(-16384);
    for (let h = 0; h < 1024; h++) {
      const s = softRoamSin(h);
      const c = softRoamCos(h);
      expect(Math.abs(s * s + c * c - 16384 * 16384)).toBeLessThan(2 * 16384 * 2);
      expect(Math.abs(softRoamAngle(c, s) - h) <= 1 || Math.abs(softRoamAngle(c, s) - h) >= 1023).toBe(true);
    }
  });
});

describe('soft roam: matter, determinism and slot order', () => {
  it('conserves matter exactly at every step, with growth, death, wear, compost and patches all happening', () => {
    for (const seed of [3, 4]) {
      const w = busy(seed);
      expect(w.census().residual).toBe(0);
      for (let s = 0; s < 2500; s++) {
        w.stepOnce();
        expect(w.census().residual).toBe(0);
        if (s % 50 === 0) {
          w.checkInvariants();
          const a = w.census();
          expect(a.alarmBonds + a.alarmOverlap + a.alarmSpeed).toBe(0);
        }
      }
      w.checkInvariants();
      const c = w.census();
      expect(c.divisions).toBeGreaterThan(20);
      expect(c.releases).toBeGreaterThan(0);
      expect(c.cellDeaths).toBeGreaterThan(5);
      expect(c.worn).toBeGreaterThan(0);
      expect(c.composted).toBeGreaterThan(0);
      expect(c.patches).toBeGreaterThan(3);
      expect(c.flowed).toBeGreaterThan(0);
      expect(c.travel).toBeGreaterThan(0);
      expect(c.cells).toBeGreaterThan(0);
    }
  });

  it('a seed gives one history, and another seed a different one', () => {
    const run = (seed: number) => {
      const w = busy(seed, {}, 10);
      w.advance(600);
      return w.digest();
    };
    expect(run(5)).toBe(run(5));
    expect(run(5)).not.toBe(run(6));
  });

  it('does not depend on slot order or bucket order: the same founders give the same cid-keyed history', () => {
    // Re-seat the free slots of b in a shuffled order, and scan c's buckets backwards. Founders must go in after.
    const make = (prep: (w: SoftRoamWorld) => void): SoftRoamWorld => {
      const w = new SoftRoamWorld(cfgOf({ seed: 7, mut: 0.05, planMut: 0.2, life: 500, compost: true, patchEvery: 60, startPatches: 3 }));
      prep(w);
      const names = ['line', 'plate', 'cross', 'block', 'speck', 'bush'] as const;
      const plans = names.map((n) => w.addPlan(ROAM_PLANS[n]));
      const types = [ROAM_TYPES.line, ROAM_TYPES.plate, ROAM_TYPES.cross, ROAM_TYPES.block, ROAM_TYPES.speck, ROAM_TYPES.bush];
      let placed = 0;
      for (let k = 0; placed < 18 && k < 1000; k++) {
        const px = roamHash(7, 0, k, 41) % (w.size * U);
        const py = roamHash(7, 0, k, 42) % (w.size * U);
        const j = placed % names.length;
        if (w.found(px, py, types[j].genes, j + 1, undefined, plans[j]) >= 0) placed++;
      }
      return w;
    };
    const perm = Array.from({ length: 2048 }, (_, i) => i).sort((p, q) => roamHash(99, 0, p, 1) - roamHash(99, 0, q, 1));
    const w0 = make(() => {});
    const w1 = make((w) => w._testSlotOrder(perm));
    const w2 = make((w) => { w._reverseScan = true; });
    const w3 = make((w) => { w._testSlotOrder(perm.slice().reverse()); w._reverseScan = true; });
    expect(live(w0)[0]).not.toBe(live(w1)[0]);
    for (let s = 0; s < 700; s++) {
      for (const w of [w0, w1, w2, w3]) w.stepOnce();
      const d = w0.digest();
      expect(w1.digest()).toBe(d);
      expect(w2.digest()).toBe(d);
      expect(w3.digest()).toBe(d);
      if (s % 50 === 0) {
        const snap = byCid(w0);
        expect(byCid(w1)).toBe(snap);
        expect(byCid(w2)).toBe(snap);
        expect(byCid(w3)).toBe(snap);
      }
    }
    const cen = w0.census();
    expect(cen.divisions).toBeGreaterThan(10);
    expect(cen.cellDeaths).toBeGreaterThan(0);
    // The slots really did differ by the end.
    let differ = 0;
    for (const c of live(w1)) {
      const mate = live(w0).find((q) => w0.cid[q] === w1.cid[c]);
      if (mate !== undefined && mate !== c) differ++;
    }
    expect(differ).toBeGreaterThan(5);
  });
});

describe('soft roam: bodies are never declared and never fuse', () => {
  it('every mother link joins a cell to the cell that made it, and pressed founders stay separate bodies', () => {
    const w = busy(11, { size: 32, matter: 20_000 }, 14);
    const parentOf = new Map<number, number>();
    for (let s = 0; s < 1500; s++) {
      w.stepOnce();
      for (const slot of w.events.births) if (w.mother[slot] >= 0) parentOf.set(w.cid[slot], w.cid[w.mother[slot]]);
      for (const c of live(w)) {
        const m = w.mother[c];
        if (m < 0) continue;
        expect(parentOf.get(w.cid[c])).toBe(w.cid[m]);
        expect(w.body[m]).toBe(w.body[c]);
      }
      // Every body's cells are reachable through mother links alone: label count equals the number of roots.
      if (s % 100 === 0) {
        let roots = 0;
        for (const c of live(w)) if (w.mother[c] < 0) roots++;
        // Orphaned pieces are roots too; pieces never merge, so there are never more bodies than roots.
        expect(w.census().bodies).toBe(roots);
      }
    }
    expect(w.census().divisions).toBeGreaterThan(10);

    const p = new SoftRoamWorld(quiet());
    const plan = p.addPlan(restPlan);
    const a = p.found(20 * U, 20 * U, SITTER, 1, 150, plan);
    const b = p.found(20 * U + 800, 20 * U, SITTER, 2, 150, plan);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThanOrEqual(0);
    for (let s = 0; s < 300; s++) p.stepOnce();
    expect(p.census().bodies).toBe(2);
    expect(p.mother[a]).toBe(-1);
    expect(p.mother[b]).toBe(-1);
    const dx = Math.abs(p.x[b] - p.x[a]);
    expect(dx).toBeGreaterThan(U - 40);
    expect(dx).toBeLessThan(1.6 * U);
  });
});

/** Grow a body of `plan` from one founder, then jitter every cell and let it settle. */
function settle(plan: readonly number[], store: number, cfg: SoftRoamConfig = quiet()) {
  const w = new SoftRoamWorld(cfg);
  const p = w.addPlan(plan);
  const root = w.found(24 * U, 24 * U, SITTER, 1, store, p);
  expect(root).toBeGreaterThanOrEqual(0);
  w.advance(250);
  const cells = w.census().cells;
  for (const c of live(w)) {
    w.x[c] += (roamHash(1, 0, c, 1) % 501) - 250;
    w.y[c] += (roamHash(1, 0, c, 2) % 501) - 250;
  }
  const vmax = () => live(w).reduce((m, c) => Math.max(m, Math.hypot(w.vx[c], w.vy[c])), 0);
  const trace: number[] = [];
  let alarms = 0;
  for (let s = 1; s <= 600; s++) {
    w.stepOnce();
    if (s === 5 || s === 100 || s === 600) trace.push(vmax());
    if (s % 20 === 0) { const c = w.census(); alarms += c.alarmBonds + c.alarmOverlap + c.alarmSpeed; }
  }
  return { w, root, cells, trace, alarms };
}

/** Largest error of a body's pair distances against its plan lattice, and of its bonds against L. */
function shapeError(w: SoftRoamWorld, root: number): { pair: number; bond: number } {
  const cs = live(w).filter((c) => w.body[c] === w.body[root]);
  let pair = 0;
  let bond = 0;
  for (const a of cs) {
    if (w.mother[a] >= 0) bond = Math.max(bond, Math.abs(Math.hypot(w.dlt(w.x[w.mother[a]], w.x[a]), w.dlt(w.y[w.mother[a]], w.y[a])) - U));
    for (const b of cs) {
      if (a >= b) continue;
      const ideal = Math.hypot(w.gx[a] - w.gx[b], w.gy[a] - w.gy[b]) * U;
      pair = Math.max(pair, Math.abs(Math.hypot(w.dlt(w.x[b], w.x[a]), w.dlt(w.y[b], w.y[a])) - ideal));
    }
  }
  return { pair, bond };
}

describe('soft roam: stability', () => {
  const shapes: [string, readonly number[], number, number][] = [
    ['a 12-cell line', line12, 450_000, 12],
    ['a 3x3 plate', plate9, 12_000, 9],
    ['a bush', ROAM_PLANS.bush, 4_000, 0],
  ];
  for (const [name, plan, store, count] of shapes) {
    it(`${name} relaxes to its plan shape and stays there`, () => {
      const { w, root, cells, trace, alarms } = settle(plan, store);
      if (count > 0) expect(cells).toBe(count);
      else expect(cells).toBeGreaterThan(12);
      w.checkInvariants();
      const size = w.bodySize[w.body[root]];
      expect(size).toBe(w.census().cells);
      expect(alarms).toBe(0);
      const err = shapeError(w, root);
      expect(err.bond).toBeLessThan(0.06 * U);
      expect(err.pair).toBeLessThan(0.2 * U);
      // The jitter set it moving; the motion dies away and stays dead.
      expect(trace[0]).toBeGreaterThan(20);
      expect(trace[1]).toBeLessThan(trace[0] / 4);
      expect(trace[2]).toBeLessThan(2);
      expect(trace[2]).toBeLessThanOrEqual(trace[1]);
      // Still there a long time later.
      w.advance(400);
      const later = shapeError(w, root);
      expect(later.pair).toBeLessThan(0.2 * U);
      expect(live(w).reduce((m, c) => Math.max(m, Math.hypot(w.vx[c], w.vy[c])), 0)).toBeLessThan(2);
      const c = w.census();
      expect(c.alarmBonds + c.alarmOverlap + c.alarmSpeed).toBe(0);
    });
  }

  it('a body thrust into another does not pass through it', () => {
    const w = new SoftRoamWorld(quiet());
    const rest = w.addPlan(restPlan);
    const line = w.addPlan(line12);
    // A vertical wall of 12 cells (heading 256 is south), and a single cell driving east into its middle.
    const wallRoot = w.found(26 * U, 18 * U, SITTER, 1, 450_000, line);
    w.heading[wallRoot] = 256;
    w.orient[wallRoot] = 1;
    const mover = w.found(16 * U, 24 * U + 300, [0, 512, -512, 0, 0], 2, 150, rest);
    w.heading[mover] = 0;
    for (let s = 0; s < 120; s++) w.stepOnce();
    expect(live(w).length).toBe(13);
    let least = Infinity;
    for (let s = 0; s < 400; s++) {
      w.stepOnce();
      for (const c of live(w)) {
        if (c === mover) continue;
        least = Math.min(least, Math.hypot(w.dlt(w.x[c], w.x[mover]), w.dlt(w.y[c], w.y[mover])));
      }
      let wall = 0;
      for (const c of live(w)) if (c !== mover) wall += w.dlt(w.x[mover], w.x[c]);
      expect(wall / 12).toBeGreaterThan(0);
    }
    expect(least).toBeGreaterThan(0.75 * U);
    expect(w.x[mover]).toBeGreaterThan(20 * U);
  });

  for (const cells of [6, 8]) {
    it(`a ${cells}-cell line driven into a one-cell-thick wall is stopped by it, trailing cells and all`, () => {
      const w = new SoftRoamWorld(quiet({ matter: 1_000_000 }));
      const wallPlan = w.addPlan(line12);
      const linePlan = w.addPlan(Array.from({ length: 16 }, (_, m) => (m < cells - 1 ? planEntry(0, m + 1, 15) : planEntry(PLAN_REST, 0, m))));
      const wallRoot = w.found(26 * U, 18 * U, SITTER, 1, 450_000, wallPlan);
      w.heading[wallRoot] = 256;
      w.orient[wallRoot] = 1;
      const root = w.found(10 * U, 24 * U + 512, SITTER, 2, 40_000 * cells, linePlan);
      w.heading[root] = 0;
      w.orient[root] = 0;
      w.advance(200);
      expect(live(w).length).toBe(12 + cells);
      const wall = live(w).filter((c) => w.body[c] === w.body[wallRoot]);
      const ram = live(w).filter((c) => w.body[c] === w.body[root]);
      expect(wall.length).toBe(12);
      expect(ram.length).toBe(cells);
      for (const c of ram) w.genes[c * ROAM_GENES + 1] = 512;
      const start = w.x[root];
      let front = 0;
      for (let s = 0; s < 500; s++) {
        w.stepOnce();
        let wx = 0;
        for (const c of wall) wx += w.dlt(w.x[root], w.x[c]);
        front = Math.max(...ram.map((c) => w.dlt(w.x[root], w.x[c])));
        // The leading cell never gets past the middle of the wall.
        expect(front).toBeLessThan(wx / 12);
      }
      // It did drive: the line crossed the open ground and ended up pressed on the wall.
      expect(w.dlt(start, w.x[root])).toBeGreaterThan(5 * U);
      w.checkInvariants();
      expect(w.census().alarmBonds + w.census().alarmOverlap).toBe(0);
    }, 60_000);
  }

  it('a body broken by a mid-body death parts into pieces that drift apart, with no brace across', () => {
    const w = new SoftRoamWorld(quiet());
    const p = w.addPlan(line12);
    const root = w.found(14 * U, 24 * U, [0, 200, -512, 0, 0], 1, 450_000, p);
    w.heading[root] = 0;
    w.orient[root] = 0;
    w.advance(250);
    expect(w.census().cells).toBe(12);
    lean(w);
    // Kill the seventh cell from the root, matter going to the reservoir so the ledger holds.
    const order = live(w).sort((a, b) => w.cid[a] - w.cid[b]);
    const mid = order[6];
    const midCid = w.cid[mid];
    w.reservoir += w.store[mid];
    w.store[mid] = 0;
    w.stepOnce();
    expect(w.census().cells).toBe(11);
    expect(w.bodySizes().sort((a, b) => a - b).length).toBeGreaterThanOrEqual(2);
    expect(w.census().splits).toBeGreaterThanOrEqual(1);
    for (const c of live(w)) {
      for (let k = 0; k < 4; k++) {
        const q = w.braceTo[c * 4 + k];
        if (q >= 0) expect(w.body[q]).toBe(w.body[c]);
      }
    }
    // The downstream piece turns around and swims off.
    const front = live(w).filter((c) => w.cid[c] > midCid);
    const back = live(w).filter((c) => w.cid[c] < midCid);
    const gap = () => {
      const ref = w.x[back[0]];
      const mean = (cs: number[]) => cs.reduce((s, c) => s + w.dlt(ref, w.x[c]), 0) / cs.length;
      return mean(front) - mean(back);
    };
    const before = gap();
    const turned = new Set(front.map((c) => w.body[c]));
    expect(turned.size).toBe(1);
    expect(new Set(back.map((c) => w.body[c])).has(w.body[front[0]])).toBe(false);
    for (let s = 0; s < 40; s++) {
      for (const c of front) w.heading[c] = 0;
      for (const c of back) w.heading[c] = 512;
      w.stepOnce();
    }
    expect(gap()).toBeGreaterThan(before + 3 * U);
    w.checkInvariants();
  });

  it('no cell moves faster than the clamp, however hard it is pushed', () => {
    const w = busy(13, { size: 32, matter: 20_000, life: undefined }, 20);
    const cfg = w.cfg;
    const most = (cfg.vMax / 16) * cfg.substeps + 2;
    let seen = 0;
    for (let s = 0; s < 600; s++) {
      w.stepOnce();
      for (const c of live(w)) {
        if (w.bornStep[c] === w.step - 1) continue;
        seen = Math.max(seen, Math.hypot(w.dlt(w.prevX[c], w.x[c]), w.dlt(w.prevY[c], w.y[c])));
        expect(Math.hypot(w.vx[c], w.vy[c])).toBeLessThanOrEqual(cfg.vMax);
      }
    }
    expect(seen).toBeLessThanOrEqual(most);
    expect(seen).toBeGreaterThan(20);
    // A cell thrown a hundred tiles from its mother is pulled in no faster than the clamp, because the stretch is capped.
    const t = new SoftRoamWorld(quiet());
    const plan = t.addPlan(line12);
    const root = t.found(14 * U, 24 * U, SITTER, 1, 450_000, plan);
    t.advance(250);
    const far = live(t).sort((a, b) => t.cid[a] - t.cid[b])[11];
    t.x[far] = (t.x[far] + 20 * U) % (t.size * U);
    t.stepOnce();
    expect(Math.hypot(t.vx[far], t.vy[far])).toBeLessThanOrEqual(t.cfg.vMax);
    expect(Number.isFinite(t.x[far])).toBe(true);
    void root;
  });
});

describe('soft roam: motion', () => {
  const lone = (drive: number, over: Partial<SoftRoamConfig> = {}) => {
    const w = new SoftRoamWorld(quiet(over));
    const rest = w.addPlan(restPlan);
    const c = w.found(10 * U, 10 * U, [0, drive, -512, 0, 0], 1, 150, rest);
    w.heading[c] = 0;
    return { w, c };
  };

  it('a lone drive-gene cell covers about an eighth to a quarter tile per step at top thrust, with no wobble', () => {
    const { w, c } = lone(512);
    const steps: number[] = [];
    let last = w.x[c];
    for (let s = 0; s < 60; s++) {
      w.stepOnce();
      steps.push(w.x[c] - last);
      last = w.x[c];
    }
    for (const d of steps.slice(10)) {
      expect(d).toBeGreaterThanOrEqual(U / 8);
      expect(d).toBeLessThanOrEqual(U / 4);
    }
    expect(w.y[c]).toBe(10 * U);
  });

  it('small thrust does not stall: it still moves, smoothly', () => {
    for (const drive of [64, 16, 8]) {
      const { w, c } = lone(drive);
      w.advance(20);
      const xs: number[] = [];
      for (let s = 0; s < 40; s++) { w.stepOnce(); xs.push(w.x[c]); }
      for (let i = 4; i < xs.length; i++) expect(xs[i] - xs[i - 4]).toBeGreaterThan(0);
      for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeLessThanOrEqual(Math.ceil(drive / 512 * 260) + 2);
    }
  });

  it('the heading turns by a bounded amount and the thrust follows it round', () => {
    const { w, c } = lone(512, { turnMax: 1 });
    w.genes[c * ROAM_GENES + 2] = 512;
    let prev = w.heading[c];
    let turns = 0;
    for (let s = 0; s < 300; s++) {
      w.stepOnce();
      const d = (w.heading[c] - prev + 1536) % 1024 - 512;
      expect(Math.abs(d)).toBeLessThanOrEqual(16);
      if (d !== 0) turns++;
      prev = w.heading[c];
    }
    expect(turns).toBeGreaterThan(50);
  });

  it('a chaser near food curves toward it', () => {
    const w = new SoftRoamWorld(quiet({ scentDecayShift: 6 }));
    const rest = w.addPlan(restPlan);
    // 2000 units of food in a block 6 tiles east, put on the ground from the reservoir.
    for (let dx = 0; dx < 4; dx++) for (let dy = -2; dy < 2; dy++) { w.food[(24 + dy) * w.size + 30 + dx] += 100; w.reservoir -= 100; }
    const c = w.found(24 * U, 24 * U + 512, [512, 0, -512, 0, 0], 1, 150, rest);
    const startGap = 30 * U - w.x[c];
    w.advance(120);
    expect(w.census().residual).toBe(0);
    expect(30 * U - w.x[c]).toBeLessThan(startGap - U);
  });
});

describe('soft roam: growth by plan', () => {
  it('each planted plan grows the cell count Roam gives it, and no body grows past it', () => {
    for (const [plan, count] of [[ROAM_PLANS.line, 8], [ROAM_PLANS.plate, 9], [ROAM_PLANS.cross, 9], [ROAM_PLANS.block, 8]] as const) {
      const w = new SoftRoamWorld(quiet({ matter: 200_000 }));
      const root = w.found(24 * U, 24 * U, SITTER, 1, 60_000, w.addPlan(plan));
      expect(root).toBeGreaterThanOrEqual(0);
      let most = 0;
      for (let s = 0; s < 300; s++) {
        w.stepOnce();
        expect(w.census().residual).toBe(0);
        for (const sz of w.bodySizes()) most = Math.max(most, sz);
      }
      expect(w.bodySize[w.body[root]]).toBe(count);
      expect(most).toBe(count);
      expect(w.census().releases).toBeGreaterThan(0);
    }
  });

  it('a released daughter starts a new body in mode 0 with the plan and faces away from its mother', () => {
    const w = new SoftRoamWorld(quiet({ matter: 200_000 }));
    const plan = w.addPlan(ROAM_PLANS.line);
    w.found(24 * U, 24 * U, SITTER, 1, 60_000, plan);
    let seen = 0;
    for (let s = 0; s < 300 && seen === 0; s++) {
      const before = w.releases;
      w.stepOnce();
      if (w.releases > before) {
        for (const slot of w.events.births) {
          if (w.mother[slot] >= 0) continue;
          seen++;
          expect(w.mode[slot]).toBe(0);
          expect(w.pid[slot]).toBe(plan);
          expect(w.gx[slot]).toBe(0);
          expect(w.gy[slot]).toBe(0);
          expect(w.bodySize[w.body[slot]]).toBe(1);
          expect(w.since[slot]).toBe(w.step - 1);
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('a lost daughter is regrown and a cutting runs its plan again from mode 0', () => {
    const w = new SoftRoamWorld(quiet());
    const p = w.addPlan(line12);
    const root = w.found(14 * U, 24 * U, SITTER, 1, 450_000, p);
    w.heading[root] = 0;
    w.orient[root] = 0;
    w.advance(250);
    expect(w.census().cells).toBe(12);
    lean(w);
    const order = live(w).sort((a, b) => w.cid[a] - w.cid[b]);
    const tip = order[11];
    w.reservoir += w.store[tip];
    w.store[tip] = 0;
    w.stepOnce();
    expect(w.census().cells).toBe(11);
    w.advance(50);
    expect(w.census().cells).toBe(11);
    // The cell behind it went back to the mode that made it: fed, it regrows the tip.
    const behind = order[10];
    w.reservoir -= 450;
    w.store[behind] += 450;
    w.advance(30);
    expect(w.census().cells).toBe(12);
    lean(w);
    // Cut the line at the root's daughter: the rest starts its plan again from mode 0 as a body of its own.
    const again = live(w).sort((a, b) => w.cid[a] - w.cid[b]);
    const cut = again[1];
    const modeBefore = w.mode[again[2]];
    w.reservoir += w.store[cut];
    w.store[cut] = 0;
    w.stepOnce();
    const sizes = w.bodySizes().sort((a, b) => b - a);
    expect(sizes.length).toBe(2);
    expect(sizes[0] + sizes[1]).toBe(11);
    // The cutting restarts its plan from mode 0, and walks it again (its places are held, so it counts them done) once fed.
    const orphan = live(w).find((c) => w.cid[c] === w.cid[again[2]]) as number;
    expect(modeBefore).toBe(15);
    expect(w.mode[orphan]).toBe(0);
    expect(w.bodySize[w.body[orphan]]).toBe(10);
    for (const c of live(w)) if (w.body[c] === w.body[orphan]) { w.reservoir -= 450; w.store[c] += 450; }
    w.advance(80);
    expect(w.mode[orphan]).toBe(15);
    expect(w.bodySize[w.body[orphan]]).toBe(10);
    expect(w.census().cells).toBe(11);
    w.checkInvariants();
  });
});

describe('soft roam: arithmetic bounds', () => {
  it('works across the seam of a large torus without a long delta ever mattering', () => {
    const w = new SoftRoamWorld(quiet({ size: 256, matter: 700_000, maxCells: 512 }));
    const span = w.size * U;
    const rest = w.addPlan(restPlan);
    // Two cells pressed together across the seam repel along the short way round.
    const a = w.found(100, 5 * U, SITTER, 1, 150, rest);
    const b = w.found(span - 800, 5 * U, SITTER, 2, 150, rest);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThanOrEqual(0);
    // And a line grown across the seam stays a line.
    const line = w.addPlan(line12);
    const root = w.found(span - 3 * U, 128 * U, SITTER, 3, 450_000, line);
    w.heading[root] = 0;
    w.orient[root] = 0;
    for (let s = 0; s < 400; s++) {
      w.stepOnce();
      for (const c of live(w)) {
        expect(w.x[c]).toBeGreaterThanOrEqual(0);
        expect(w.x[c]).toBeLessThan(span);
        expect(Math.hypot(w.vx[c], w.vy[c])).toBeLessThanOrEqual(w.cfg.vMax);
      }
    }
    const gap = Math.hypot(w.dlt(w.x[a], w.x[b]), w.dlt(w.y[a], w.y[b]));
    expect(gap).toBeGreaterThan(U - 40);
    expect(gap).toBeLessThan(1.6 * U);
    expect(w.census().cells).toBe(14);
    const err = shapeError(w, root);
    expect(err.bond).toBeLessThan(0.06 * U);
    expect(err.pair).toBeLessThan(0.2 * U);
    // The line was founded just west of the seam and grew east: its cells now sit on both sides of it.
    const own = live(w).filter((c) => w.body[c] === w.body[root]);
    expect(own.some((c) => w.x[c] > span - 6 * U)).toBe(true);
    expect(own.some((c) => w.x[c] < 6 * U)).toBe(true);
    w.checkInvariants();
  });

  it('spreads food without losing any, and rejects broken settings', () => {
    const w = new SoftRoamWorld(quiet({ foodSpread: 0.5 }));
    w.food[24 * w.size + 24] = 8000;
    w.reservoir -= 8000;
    for (let s = 0; s < 30; s++) {
      w.stepOnce();
      expect(w.census().residual).toBe(0);
    }
    expect(w.food[24 * w.size + 24]).toBeLessThan(8000);
    expect(w.food[24 * w.size + 25]).toBeGreaterThan(0);
    expect(() => new SoftRoamWorld(quiet({ foodSpread: 2 }))).toThrow(/foodSpread/);
    expect(() => new SoftRoamWorld(quiet({ kBond: 1024, kRep: 1024, kBrace: 1024 }))).toThrow(/stiff/);
    expect(() => new SoftRoamWorld(quiet({ matter: 1 << 20 }))).toThrow(/matter/);
    const x = new SoftRoamWorld(quiet());
    expect(() => x.found(0, 0, SITTER, 1, 150, 0)).toThrow(/plan number/);
    const plan = x.addPlan(restPlan);
    expect(x.found(10 * U, 10 * U, SITTER, 1, 150, plan)).toBe(0);
    expect(x.found(10 * U + 500, 10 * U, SITTER, 1, 150, plan)).toBe(-1);
  });
});
