import { describe, expect, it } from 'vitest';
import { defaultSoftRoamConfig, PLAN_REST, planEntry, roamHash, ROAM_GENE_MAX, ROAM_GENES, SOFT_U, softRoamAngle, softRoamCos, softRoamSin, type SoftRoamConfig, SoftRoamWorld } from '../src/softroam/kernel.ts';
import { ROAM_PLANS, ROAM_TYPES } from '../src/roam/view.ts';

/**
 * Independent property tests for the soft roam kernel (written against the kernel's header, not its author's tests).
 * Where a test describes a property the kernel does not have, it is marked it.fails with the reproduction in its body.
 */

const U = SOFT_U;
const cfgOf = (over: Partial<SoftRoamConfig> = {}): SoftRoamConfig => ({ ...defaultSoftRoamConfig(), size: 32, matter: 30_000, startPatches: 3, patchEvery: 40, maxCells: 400, ...over });
/** No upkeep, no wear, no copy errors, no patches, no turning, no repulsion: only what a test puts in. */
const quiet = (over: Partial<SoftRoamConfig> = {}): SoftRoamConfig =>
  cfgOf({ size: 16, matter: 700_000, startPatches: 0, patchEvery: 1_000_000, mut: 0, planMut: 0, leakSide: 0, leakCell: 0, moveCost: 0, life: undefined, compost: undefined, turnMax: 0, ...over });
const SITTER = [0, 0, -512, 0, 0];
const NAMES = ['line', 'plate', 'cross', 'block', 'speck', 'bush'] as const;
const TYPES = [ROAM_TYPES.line, ROAM_TYPES.plate, ROAM_TYPES.cross, ROAM_TYPES.block, ROAM_TYPES.speck, ROAM_TYPES.bush];

const live = (w: SoftRoamWorld): number[] => {
  const out: number[] = [];
  for (let c = 0; c < w.cap; c++) if (w.alive[c]) out.push(c);
  return out;
};

/** Founders by hash, cycling through the six planted plans. */
function seedWorld(cfg: SoftRoamConfig, founders: number, store?: number): SoftRoamWorld {
  const w = new SoftRoamWorld(cfg);
  const plans = NAMES.map((n) => w.addPlan(ROAM_PLANS[n]));
  let placed = 0;
  for (let k = 0; placed < founders && k < 20000; k++) {
    const px = roamHash(cfg.seed, 0, k, 41) % (w.size * U);
    const py = roamHash(cfg.seed, 0, k, 42) % (w.size * U);
    const j = placed % NAMES.length;
    if (w.found(px, py, TYPES[j].genes, j + 1, store, plans[j]) >= 0) placed++;
  }
  expect(placed).toBe(founders);
  return w;
}

/** Test only: put a cell anywhere, with no spacing rule (reaches the kernel's private allocate and place). */
function spawn(w: SoftRoamWorld, px: number, py: number, genes: readonly number[], store: number, plan: number, heading = 0): number {
  const a = w as unknown as { allocate(): number; place(c: number, x: number, y: number, g: readonly number[], f: number, s: number, p: number): void; labelHi: number };
  const c = a.allocate();
  a.place(c, px, py, genes, 1, store, plan);
  w.reservoir -= store;
  w.heading[c] = heading;
  w.orient[c] = 0;
  w.mother[c] = -1;
  w.body[c] = ++a.labelHi;
  w.bodySize[w.body[c]] = 1;
  w.bodyCount++;
  return c;
}

/** Components of the mother-link graph, found afresh and independently. Returns slot -> component number. */
function freshLabels(w: SoftRoamWorld): Map<number, number> {
  const parent = new Map<number, number>();
  for (const c of live(w)) parent.set(c, c);
  const find = (a: number): number => {
    let r = a;
    while (parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  for (const c of live(w)) {
    const m = w.mother[c];
    if (m >= 0) parent.set(find(c), find(m));
  }
  const out = new Map<number, number>();
  for (const c of live(w)) out.set(c, find(c));
  return out;
}

function expectCleanBodies(w: SoftRoamWorld): void {
  const fresh = freshLabels(w);
  // The kernel's labels are the same partition as the fresh walk.
  const toKernel = new Map<number, number>();
  const toFresh = new Map<number, number>();
  for (const c of live(w)) {
    const f = fresh.get(c)!;
    const k = w.body[c];
    if (toKernel.has(f) && toKernel.get(f) !== k) throw new Error(`component of slot ${c} carries two kernel labels`);
    if (toFresh.has(k) && toFresh.get(k) !== f) throw new Error(`kernel label ${k} spans two components (fused bodies) at slot ${c}`);
    toKernel.set(f, k);
    toFresh.set(k, f);
    const m = w.mother[c];
    if (m >= 0) {
      if (!w.alive[m]) throw new Error(`slot ${c}: mother ${m} is not alive`);
      if (fresh.get(m) !== f) throw new Error(`slot ${c}: mother in another component`);
    }
    for (let k2 = 0; k2 < 4; k2++) {
      const p = w.braceTo[c * 4 + k2];
      if (p < 0) continue;
      if (!w.alive[p]) throw new Error(`slot ${c}: brace to dead slot`);
      if (fresh.get(p) !== f) throw new Error(`slot ${c}: brace joins two bodies`);
    }
  }
}

describe('soft roam props: sine table mirror symmetry', () => {
  it('sin(512 - h) = sin(h) and cos(512 - h) = -cos(h) exactly', () => {
    for (let h = 0; h < 1024; h++) {
      expect(softRoamSin((512 - h) & 1023)).toBe(softRoamSin(h));
      expect(softRoamCos((512 - h) & 1023)).toBe(0 - softRoamCos(h));
      expect(softRoamSin((h + 512) & 1023)).toBe(0 - softRoamSin(h));
    }
  });
});

describe('soft roam props: conservation under abuse', () => {
  const abuse: [string, Partial<SoftRoamConfig>][] = [
    ['compost on, tight minStore, short life', { life: 200, compost: true, minStore: 100, birthStore: 100, foodSpread: 0.5 }],
    ['compost off, tiny margins, spread on', { life: 200, compost: false, minStore: 99, birthStore: 100, foodSpread: 1 }],
    ['births mostly refused: maxCells nearly full', { life: 200, compost: true, maxCells: 70, minStore: 90, birthStore: 100, foodSpread: 0.25, patchEvery: 15 }],
  ];
  for (const [label, over] of abuse) {
    it(`residual 0 and invariants after every one of 3000 steps on seeds 1..4 (${label})`, () => {
      for (const seed of [1, 2, 3, 4]) {
        const w = seedWorld(cfgOf({ seed, mut: 0.1, planMut: 0.3, matter: 40_000, bite: 4, ...over }), 24, 199);
        // Crowded start: a clump of extra cells, packed far inside the usual spacing.
        const plan = w.addPlan(ROAM_PLANS.plate);
        for (let k = 0; k < 20; k++) spawn(w, 5 * U + (roamHash(seed, 0, k, 7) % 1200), 5 * U + (roamHash(seed, 0, k, 8) % 1200), ROAM_TYPES.plate.genes, 150, plan, roamHash(seed, 0, k, 9) & 1023);
        let peak = 0;
        for (let s = 0; s < 3000; s++) {
          w.stepOnce();
          w.checkInvariants();
          const c = w.census();
          if (c.residual !== 0) throw new Error(`residual ${c.residual} at step ${s} seed ${seed}`);
          if (c.cells > peak) peak = c.cells;
        }
        expect(peak).toBeGreaterThan(20);
        expect(w.census().divisions).toBeGreaterThan(10);
        expect(w.census().cellDeaths).toBeGreaterThan(10);
      }
    }, 240_000);
  }
});

describe('soft roam props: determinism', () => {
  it('two runs agree at every step, and advance(n) equals n times stepOnce', () => {
    for (const seed of [1, 9]) {
      const mk = () => seedWorld(cfgOf({ seed, mut: 0.05, planMut: 0.2, life: 400, foodSpread: 0.3 }), 16);
      const a = mk();
      const b = mk();
      const c = mk();
      for (let s = 0; s < 400; s++) {
        a.stepOnce();
        b.stepOnce();
        expect(b.digest()).toBe(a.digest());
      }
      c.advance(400);
      expect(c.digest()).toBe(a.digest());
      expect(c.census()).toEqual(a.census());
      // And the same history is not an accident of a flat digest: a one-cell change in the start changes it.
      const d = mk();
      d.food[0] += 1;
      d.reservoir -= 1;
      d.advance(400);
      expect(d.digest()).not.toBe(a.digest());
    }
  });

  it('slot permutations leave the cid-keyed digest alone, over 6 random permutations and 3 seeds', () => {
    for (const seed of [2, 4, 6]) {
      const mk = (perm: number[] | null, rev: boolean) => {
        const w = new SoftRoamWorld(cfgOf({ seed, mut: 0.05, planMut: 0.2, life: 300, compost: true, foodSpread: 0.2, maxCells: 300 }));
        if (perm) w._testSlotOrder(perm);
        w._reverseScan = rev;
        const plans = NAMES.map((n) => w.addPlan(ROAM_PLANS[n]));
        let placed = 0;
        for (let k = 0; placed < 20 && k < 5000; k++) {
          const px = roamHash(seed, 0, k, 41) % (w.size * U);
          const py = roamHash(seed, 0, k, 42) % (w.size * U);
          if (w.found(px, py, TYPES[placed % 6].genes, 1 + (placed % 6), undefined, plans[placed % 6]) >= 0) placed++;
        }
        return w;
      };
      const base = mk(null, false);
      const others = [1, 2, 3, 4, 5, 6].map((k) => mk(Array.from({ length: 300 }, (_, i) => i).sort((p, q) => roamHash(seed * 100 + k, 0, p, 1) - roamHash(seed * 100 + k, 0, q, 1)), k % 2 === 0));
      for (let s = 0; s < 500; s++) {
        base.stepOnce();
        const d = base.digest();
        for (const o of others) {
          o.stepOnce();
          if (o.digest() !== d) throw new Error(`seed ${seed} step ${s}: permuted world differs`);
        }
      }
    }
  });
});

describe('soft roam props: order advantage', () => {
  /** Two mothers two tiles apart, facing each other: both want the one spot between them. */
  function duel(seed: number, westFirst: boolean, slotsReversed: boolean): { westWins: boolean; lowCidWins: boolean } {
    const w = new SoftRoamWorld(quiet({ seed, kRep: 0 }));
    if (slotsReversed) w._testSlotOrder(Array.from({ length: w.cap }, (_, i) => w.cap - 1 - i));
    const plan = w.addPlan(Array.from({ length: 16 }, (_, m) => (m === 0 ? planEntry(0, 1, 1) : planEntry(PLAN_REST, 0, m))));
    const mk = (xu: number, heading: number, orient: number): number => {
      const c = w.found(xu, 8 * U + 500, SITTER, 1, 200, plan);
      expect(c).toBeGreaterThanOrEqual(0);
      w.heading[c] = heading;
      w.orient[c] = orient;
      return c;
    };
    let west: number;
    let east: number;
    if (westFirst) { west = mk(4 * U + 100, 0, 0); east = mk(6 * U + 100, 512, 2); }
    else { east = mk(6 * U + 100, 512, 2); west = mk(4 * U + 100, 0, 0); }
    w.stepOnce();
    expect(w.events.births.length).toBe(1);
    const mother = w.mother[w.events.births[0]];
    expect(w.census().residual).toBe(0);
    const lowCid = w.cid[west] < w.cid[east] ? west : east;
    return { westWins: mother === west, lowCidWins: mother === lowCid };
  }

  it('neither side nor either cid wins a contested birth target over 400 seeds (binomial 4.5 sigma), whatever the slots', () => {
    let west = 0;
    let low = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const r = duel(seed, seed % 2 === 0, seed % 3 === 0);
      if (r.westWins) west++;
      if (r.lowCidWins) low++;
    }
    expect(Math.abs(west - 200)).toBeLessThan(45);
    expect(Math.abs(low - 200)).toBeLessThan(45);
  });

  it('the winner of a contested birth does not depend on the slots the mothers sit in', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const a = duel(seed, true, false);
      const b = duel(seed, true, true);
      expect(b).toEqual(a);
    }
  });

  it('a crowded tile is shared the same whichever cell is asked first, and nobody is favoured by cid', () => {
    for (const food of [1, 3, 5, 8]) {
      const got: number[][] = [];
      for (const rev of [false, true]) {
        const w = new SoftRoamWorld(quiet({ kRep: 0, bite: 2, seed: 5 }));
        if (rev) w._testSlotOrder(Array.from({ length: w.cap }, (_, i) => w.cap - 1 - i));
        const plan = w.addPlan(Array.from({ length: 16 }, (_, m) => planEntry(PLAN_REST, 0, m)));
        const a = w.found(3 * U + 112, 3 * U + 512, SITTER, 1, 150, plan);
        const b = w.found(3 * U + 912, 3 * U + 512, SITTER, 1, 150, plan);
        const t = 3 * w.size + 3;
        w.food[t] = food;
        w.reservoir -= food;
        w.stepOnce();
        got.push([w.store[a] - 150, w.store[b] - 150, w.food[t]]);
        expect(w.census().residual).toBe(0);
      }
      expect(got[0]).toEqual(got[1]);
      expect(got[0][0]).toBe(got[0][1]);
    }
  });

  const mirrorRun = (drive: number, reverseOrder: boolean): void => {
    for (const seed of [1, 2, 3]) {
      const size = 20;
      const span = size * U;
      const mk = (mirror: boolean, reverse: boolean): { w: SoftRoamWorld; slots: number[] } => {
        const w = new SoftRoamWorld(quiet({ seed, size, startPatches: 0, kRep: 256, kBond: 96, keep: 192 }));
        const plan = w.addPlan(Array.from({ length: 16 }, (_, m) => planEntry(PLAN_REST, 0, m)));
        const specs: { x: number; y: number; h: number }[] = [];
        for (let k = 0; k < 30; k++) {
          specs.push({ x: 4 * U + (roamHash(seed, 0, k, 1) % (6 * U)) + 77, y: 4 * U + (roamHash(seed, 0, k, 2) % (6 * U)) + 33, h: roamHash(seed, 0, k, 3) & 1023 });
        }
        // Accept founders greedily in index order whatever the founding order, so both worlds hold the same set.
        const keep: number[] = [];
        for (let i = 0; i < specs.length; i++) {
          if (keep.every((j) => Math.hypot(specs[i].x - specs[j].x, specs[i].y - specs[j].y) >= 740)) keep.push(i);
        }
        const slots = new Array<number>(specs.length).fill(-1);
        const order = keep.slice();
        if (reverse) order.reverse();
        for (const i of order) {
          const s = specs[i];
          const px = mirror ? (span - s.x) % span : s.x;
          const h = mirror ? (512 - s.h) & 1023 : s.h;
          const c = w.found(px, s.y, [0, drive, -512, 0, 0], 1, 150, plan);
          if (c < 0) continue;
          w.heading[c] = h;
          slots[i] = c;
        }
        return { w, slots };
      };
      const a = mk(false, false);
      const b = mk(true, reverseOrder);
      // Same founders accepted in both (spacing is symmetric); drop any unaccepted pair.
      const pairs = a.slots.map((s, i) => [s, b.slots[i]]).filter(([p, q]) => p >= 0 && q >= 0);
      expect(pairs.length).toBeGreaterThan(5);
      expect(pairs.length).toBe(a.slots.filter((q) => q >= 0).length);
      let touching = 0;
      for (let i = 0; i < pairs.length; i++) for (let j = i + 1; j < pairs.length; j++) {
        const [p, q] = [pairs[i][0], pairs[j][0]];
        if (Math.hypot(a.w.dlt(a.w.x[p], a.w.x[q]), a.w.dlt(a.w.y[p], a.w.y[q])) < U) touching++;
      }
      expect(touching).toBeGreaterThan(2);
      for (let s = 0; s < 150; s++) {
        a.w.stepOnce();
        b.w.stepOnce();
        for (const [p, q] of pairs) {
          if (!a.w.alive[p] || !b.w.alive[q]) throw new Error(`liveness differs at step ${s}`);
          const mx = (span - a.w.x[p]) % span;
          if (b.w.x[q] !== mx || b.w.y[q] !== a.w.y[p] || b.w.vx[q] !== -a.w.vx[p] || b.w.vy[q] !== a.w.vy[p]) {
            throw new Error(`seed ${seed} step ${s}: mirror broken: ${a.w.x[p]},${a.w.y[p]} vs ${b.w.x[q]},${b.w.y[q]}`);
          }
        }
      }
      expect(a.w.census().travel).toBeGreaterThan(0);
    }
  };

  it('a mirror-image world (x -> -x, headings mirrored, same founding order) mirrors exactly: thrust, pressing and springs', () => mirrorRun(512, false));
  it('pressing alone (no thrust) mirrors exactly even with the founding order, hence every cid, reversed', () => mirrorRun(0, true));
  it('a mirror-image world with the founding order (hence cids) reversed mirrors exactly, thrust included', () => mirrorRun(512, true));

  it('a head-on shove is not won by the lower cid: displacement of two equal bodies is equal and opposite', () => {
    // Positive when the cell with the lower cid went further.
    let lowAdvantage = 0;
    let moved = 0;
    const N = 60;
    for (let seed = 1; seed <= N; seed++) {
      const w = new SoftRoamWorld(quiet({ seed, size: 16, kRep: 256 }));
      const plan = w.addPlan(Array.from({ length: 16 }, (_, m) => planEntry(PLAN_REST, 0, m)));
      const first = seed % 2 === 0;
      const mk = (xu: number, h: number) => { const c = w.found(xu, 8 * U + 3, [0, 512, -512, 0, 0], 1, 150, plan); w.heading[c] = h; return c; };
      let west: number;
      let east: number;
      if (first) { west = mk(5 * U + 11, 0); east = mk(6 * U + 11, 512); } else { east = mk(6 * U + 11, 512); west = mk(5 * U + 11, 0); }
      expect(w.cid[west] < w.cid[east]).toBe(first);
      w.advance(60);
      const dW = w.x[west] - 5 * U - 11;
      const dE = 6 * U + 11 - w.x[east];
      expect(Math.abs(dW - dE)).toBeLessThanOrEqual(2);
      lowAdvantage += (first ? 1 : -1) * (dW - dE);
      moved += Math.abs(dW) + Math.abs(dE);
    }
    // No drift toward either cid across seeds, and the bodies did move (the test is not a pair of stuck cells).
    expect(Math.abs(lowAdvantage)).toBeLessThanOrEqual(N);
    expect(moved).toBeGreaterThan(0);
  });
});

describe('soft roam props: arithmetic bounds', () => {
  it('size 256 with a chain across the seam, maximum store and maximum genes stays exact', () => {
    const w = new SoftRoamWorld(cfgOf({ size: 256, matter: 1_000_000, startPatches: 6, maxCells: 600, life: 800, compost: true, mut: 0.2, planMut: 0.3, foodSpread: 1, patchFood: 30_000, patchRadius: 20, flow: 1 / 8, bite: 1024, birthStore: 256 }));
    const span = w.span;
    const plans = NAMES.map((n) => w.addPlan(ROAM_PLANS[n]));
    // Every sign combination of chase, drive and turn at the extreme, across both seams.
    let k = 0;
    for (const chase of [-512, 512]) for (const drive of [-512, 512]) for (const turn of [-512, 512]) {
      const px = k % 2 === 0 ? span - 200 - 40 * k : 120 + 40 * k;
      const py = k % 3 === 0 ? span - 150 - 30 * k : 90 + 30 * k;
      w.found(px, py + 3 * U * k, [chase, drive, turn, 512, -512], 1 + k, undefined, plans[k % 6]);
      k++;
    }
    // One cell with all the store the reservoir has left to give.
    const big = w.found(128 * U, 128 * U, [512, 512, 512, 512, 512], 99, 790_000, plans[0]);
    expect(big).toBeGreaterThanOrEqual(0);
    for (let s = 0; s < 600; s++) {
      w.stepOnce();
      if (s % 3 === 0) w.checkInvariants();
      for (const c of live(w)) {
        const d = Math.hypot(w.dlt(w.prevX[c], w.x[c]), w.dlt(w.prevY[c], w.y[c]));
        if (w.bornStep[c] !== s && d > w.cfg.substeps * (w.cfg.vMax / 16 + 1)) throw new Error(`cell ${c} moved ${d} at step ${s}`);
      }
    }
    expect(w.census().residual).toBe(0);
  }, 120_000);

  it('flow is a share out of 1024 as the contract says: 1/1024 is the smallest, smaller or above 1/8 is refused, and every product stays below 2^31', () => {
    expect(() => new SoftRoamWorld(quiet({ flow: 1 / 65536 }))).toThrow(/flow/);
    expect(() => new SoftRoamWorld(quiet({ flow: 0 }))).toThrow(/flow/);
    expect(() => new SoftRoamWorld(quiet({ flow: 1 / 8 + 1 / 512 }))).toThrow(/flow/);
    expect(() => new SoftRoamWorld(quiet({ flow: 1 / 1024 }))).not.toThrow();
    // The widest product: a difference under 2^20 times the largest share, 128.
    expect(((1 << 20) - 1) * 128).toBeLessThan(2 ** 31);
    // A pair 1500 apart in store at flow 1/1024 moves floor(1500 / 1024) = 1.
    const w = new SoftRoamWorld(quiet({ size: 16, flow: 1 / 1024, maxCells: 20, seed: 3, matter: 1_000_000 }));
    const plan = w.addPlan(Array.from({ length: 16 }, (_, m) => (m === 0 ? planEntry(0, 1, 1) : planEntry(PLAN_REST, 0, m))));
    const c = w.found(8 * U, 8 * U, SITTER, 1, 5000, plan);
    w.heading[c] = 0;
    w.stepOnce();
    const d = w.events.births[0];
    // The daughter keeps 20 (above minStore, so she lives), the mother holds 1500 more than the rest.
    w.store[c] += w.store[d] - 20 + 1500;
    w.reservoir -= 1500;
    w.store[d] = 20;
    const diff = w.store[c] - w.store[d];
    w.stepOnce();
    expect(w.census().residual).toBe(0);
    expect(w.store[d]).toBe(20 + Math.floor(diff / 1024));
  });

  it('a bonded pair whose stores differ by almost the whole reservoir (flow 1/8) moves exactly the flow share and conserves', () => {
    const w = new SoftRoamWorld(quiet({ size: 16, flow: 1 / 8, maxCells: 20, seed: 3, matter: 1_000_000 }));
    const plan = w.addPlan(Array.from({ length: 16 }, (_, m) => (m === 0 ? planEntry(0, 1, 1) : planEntry(PLAN_REST, 0, m))));
    const c = w.found(8 * U, 8 * U, SITTER, 1, 900_000, plan);
    expect(c).toBeGreaterThanOrEqual(0);
    w.heading[c] = 0;
    w.stepOnce();
    const d = w.events.births[0];
    w.store[c] += w.store[d] - 1;
    w.store[d] = 1;
    const diff = w.store[c] - w.store[d];
    expect(diff).toBeGreaterThan(2 ** 18);
    w.stepOnce();
    expect(w.census().residual).toBe(0);
    // The daughter received exactly floor(diff / 8) (nothing else is paid or eaten in this world).
    expect(w.store[d]).toBe(1 + Math.floor(diff / 8));
  });

  it('the scent slope product (east - west) * 1024 * gain stays below 2^31 at the widest legal settings (decay shift 8, gain 16, a food cliff)', () => {
    const w = new SoftRoamWorld(quiet({ size: 16, scentDecayShift: 8, scentGain: 16, scentIters: 1, matter: 1_000_000 }));
    // A cliff of maximal food on half the world; run the relaxation to its steady state.
    for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) { w.food[y * 16 + x] = 1023; w.reservoir -= 1023; }
    for (let s = 0; s < 3000; s++) w.stepOnce();
    // Scent is under 2^18 at the widest decay (256 times the food cap). East and west are convex mixes of tile values, so the kernel's
    // intermediates are: tile value * weight 1024 (summed over two tiles), (east - west) * gain, and, only when that is below east + west + 1, times 1024.
    let hi = 0;
    for (let i = 0; i < 256; i++) hi = Math.max(hi, w.scent[i]);
    expect(hi).toBeGreaterThan(2 ** 16);
    expect(hi).toBeLessThan(2 ** 18);
    const worst = Math.max(hi * 2048, (2 * hi + 1) * 1024, hi * 16);
    expect(worst).toBeLessThan(2 ** 31);
  });
});

describe('soft roam props: never fuse, clean breaks', () => {
  it('under 2000 steps of random deaths every brace and mother link stays inside one body, and labels match a fresh walk', () => {
    // Seeds 5 and 9 (seed 1 gave exactly 3 splits after the payment rule changed to the contract's: the histories are lotteries, the bars are not).
    for (const seed of [5, 9]) {
      const w = seedWorld(cfgOf({ seed, size: 32, matter: 40_000, mut: 0.05, planMut: 0.3, life: 80, compost: true, patchEvery: 25, maxCells: 500 }), 20, 199);
      let splitsSeen = 0;
      for (let s = 0; s < 2000; s++) {
        w.stepOnce();
        // Random kills on top of wear: a cell chosen by hash dies by setting its store low (matter returned to the reservoir).
        if (s % 7 === 0) {
          for (const c of live(w)) if (roamHash(seed, s, w.cid[c], 77) % 40 === 0) { w.reservoir += w.store[c]; w.store[c] = 0; }
        }
        expectCleanBodies(w);
        splitsSeen = w.census().splits;
        if (s % 100 === 0) {
          w.checkInvariants();
          expect(w.census().bodies).toBe(new Set(freshLabels(w).values()).size);
        }
      }
      expect(w.census().divisions).toBeGreaterThan(40);
      expect(splitsSeen).toBeGreaterThan(3);
      expect(w.census().releases).toBeGreaterThan(0);
    }
  }, 120_000);

  it('a body chain with a cell killed in the middle parts into exactly two bodies, and the piece regrows without ever rejoining', () => {
    const w = new SoftRoamWorld(quiet({ size: 24, seed: 4, maxCells: 100, flow: 1 / 1024 }));
    const line = w.addPlan(Array.from({ length: 16 }, (_, m) => (m < 9 ? planEntry(0, m + 1, 15) : planEntry(PLAN_REST, 0, m))));
    w.found(4 * U, 12 * U, SITTER, 1, 100_000, line);
    w.heading[live(w)[0]] = 0;
    for (let s = 0; s < 400; s++) w.stepOnce();
    expect(w.census().bodies).toBe(1);
    expect(w.census().cells).toBeGreaterThan(5);
    const before = w.census().cells;
    expect(before).toBe(10);
    const cells = live(w).sort((a, b) => w.cid[a] - w.cid[b]);
    const mid = cells[3];
    const behindCid = w.cid[cells[2]];
    const orphanCid = w.cid[cells[4]];
    // Flow cannot be switched off (the smallest share is 1/1024), so level the stores first: nothing flows into the cell that is killed.
    for (const c of cells) { w.reservoir += w.store[c] - 250; w.store[c] = 250; }
    w.reservoir += w.store[mid];
    w.store[mid] = 0;
    w.stepOnce();
    expect(w.census().bodies).toBe(2);
    expectCleanBodies(w);
    // The cell behind the gap grows its daughter again in the same step, and the cell count is back.
    const regrown = w.events.births.filter((b) => w.mother[b] >= 0 && w.cid[w.mother[b]] === behindCid);
    expect(regrown.length).toBe(1);
    expect(w.census().cells).toBe(before);
    const slotOf = (cid: number) => live(w).find((c) => w.cid[c] === cid) as number;
    expect(w.body[regrown[0]]).toBe(w.body[slotOf(behindCid)]);
    expect(w.body[regrown[0]]).not.toBe(w.body[slotOf(orphanCid)]);
    for (let s = 0; s < 400; s++) {
      w.stepOnce();
      expectCleanBodies(w);
      expect(w.body[slotOf(behindCid)]).not.toBe(w.body[slotOf(orphanCid)]);
    }
    expect(w.census().cells).toBeGreaterThanOrEqual(before);
    expect(w.census().bodies).toBeGreaterThanOrEqual(2);
  });
});

describe('soft roam props: stability under abuse', () => {
  it('300 single cells packed into a 6x6 tile square spread, no cell exceeds the per-step displacement bound, and the alarms return to 0', () => {
    const cfg = cfgOf({ size: 48, matter: 700_000, startPatches: 0, patchEvery: 1_000_000, mut: 0, planMut: 0, leakSide: 0, leakCell: 0, moveCost: 0, life: undefined, compost: undefined, turnMax: 0, maxCells: 400, seed: 11 });
    const w = new SoftRoamWorld(cfg);
    const plan = w.addPlan(Array.from({ length: 16 }, (_, m) => planEntry(PLAN_REST, 0, m)));
    for (let k = 0; k < 300; k++) spawn(w, 20 * U + (roamHash(11, 0, k, 1) % (6 * U)), 20 * U + (roamHash(11, 0, k, 2) % (6 * U)), SITTER, 150, plan, roamHash(11, 0, k, 3) & 1023);
    const bound = cfg.substeps * (cfg.vMax / 16 + 1);
    let maxMove = 0;
    let lastAlarm = -1;
    const x0 = live(w).map((c) => [w.x[c], w.y[c]]);
    for (let s = 0; s < 1500; s++) {
      w.stepOnce();
      for (const c of live(w)) {
        const d = Math.hypot(w.dlt(w.prevX[c], w.x[c]), w.dlt(w.prevY[c], w.y[c]));
        if (d > maxMove) maxMove = d;
        if (d > bound) throw new Error(`cell ${c} moved ${d} > ${bound} at step ${s}`);
      }
      const a = w.census();
      if (a.alarmBonds + a.alarmOverlap + a.alarmSpeed > 0) lastAlarm = s;
      if (s % 100 === 0) w.checkInvariants();
    }
    const end = w.census();
    expect(end.alarmBonds + end.alarmOverlap + end.alarmSpeed).toBe(0);
    expect(lastAlarm).toBeLessThan(1400);
    expect(end.cells).toBe(300);
    expect(end.residual).toBe(0);
    // They spread: the packed square is much bigger now.
    let spread = 0;
    const cs = live(w);
    for (let i = 0; i < cs.length; i++) spread = Math.max(spread, Math.hypot(w.dlt(20 * U + 3 * U, w.x[cs[i]]), w.dlt(20 * U + 3 * U, w.y[cs[i]])));
    expect(spread).toBeGreaterThan(5 * U);
    expect(x0.length).toBe(300);
    expect(maxMove).toBeGreaterThan(0);
  }, 120_000);

  it('the same pile with its cells all the same place (exactly coincident) still comes apart and conserves', () => {
    const cfg = cfgOf({ size: 24, matter: 200_000, startPatches: 0, patchEvery: 1_000_000, mut: 0, planMut: 0, leakSide: 0, leakCell: 0, moveCost: 0, life: undefined, turnMax: 0, maxCells: 64, seed: 2 });
    const w = new SoftRoamWorld(cfg);
    const plan = w.addPlan(Array.from({ length: 16 }, (_, m) => planEntry(PLAN_REST, 0, m)));
    for (let k = 0; k < 12; k++) spawn(w, 12 * U + 500, 12 * U + 500, SITTER, 150, plan);
    for (let s = 0; s < 800; s++) {
      w.stepOnce();
      if (s % 20 === 0) w.checkInvariants();
    }
    let minD = Infinity;
    const cs = live(w);
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) minD = Math.min(minD, Math.hypot(w.dlt(w.x[cs[i]], w.x[cs[j]]), w.dlt(w.y[cs[i]], w.y[cs[j]])));
    expect(minD).toBeGreaterThan(0.7 * U);
    expect(w.census().residual).toBe(0);
  });
});

describe('soft roam props: capacity', () => {
  it('at maxCells the world neither throws nor loses matter, and refused births wait', () => {
    for (const cap of [1, 7, 24, 60]) {
      const w = seedWorld(cfgOf({ seed: 3 + cap, size: 24, matter: 60_000, maxCells: cap, mut: 0.05, planMut: 0.2, life: 600, compost: true, patchEvery: 20, bite: 8 }), Math.min(cap, 6), 199);
      let atCap = 0;
      for (let s = 0; s < 1500; s++) {
        w.stepOnce();
        const c = w.census();
        if (c.residual !== 0) throw new Error(`cap ${cap} step ${s}: residual ${c.residual}`);
        if (c.cells > cap) throw new Error('over capacity');
        if (c.cells === cap) atCap++;
        if (s % 40 === 0) w.checkInvariants();
      }
      w.checkInvariants();
      if (cap <= 24) expect(atCap).toBeGreaterThan(50);
      if (cap >= 7) expect(w.census().divisions).toBeGreaterThan(0);
    }
  }, 120_000);

  it('a full world with every cell ready to divide keeps its store, and founding in it returns -1', () => {
    const w = new SoftRoamWorld(quiet({ size: 16, maxCells: 5, kRep: 256 }));
    const plan = w.addPlan(Array.from({ length: 16 }, (_, m) => planEntry(m === 0 ? 0 : PLAN_REST, 1, m === 0 ? 1 : m)));
    for (let k = 0; k < 5; k++) expect(w.found((2 + 2 * k) * U, 8 * U, SITTER, 1, 400, plan)).toBeGreaterThanOrEqual(0);
    expect(w.found(14 * U, 2 * U, SITTER, 1, 400, plan)).toBe(-1);
    const before = w.census();
    w.stepOnce();
    const after = w.census();
    expect(after.cells).toBe(5);
    expect(after.divisions).toBe(0);
    expect(after.held).toBe(before.held);
    expect(after.residual).toBe(0);
    expect(ROAM_GENES).toBe(5);
  });
});

describe('soft roam props: fix round 1', () => {
  const drive = [0, 512, -512, 0, 0];
  const one = (over: Partial<SoftRoamConfig> = {}) => quiet({ size: 16, seed: 1, kRep: 0, keep: 0, substeps: 1, ...over });

  it('with more than 32 cells pressed on, the thrust does not depend on the order the buckets are scanned', () => {
    const run = (rev: boolean) => {
      const w = new SoftRoamWorld(one({ maxCells: 64, kBond: 96 }));
      const plan = w.addPlan(Array.from({ length: 16 }, (_, m) => planEntry(PLAN_REST, 0, m)));
      w._reverseScan = rev;
      const mover = spawn(w, 8704, 8704, drive, 150, plan, 0);
      for (let k = 0; k < 32; k++) spawn(w, 8504, 8704, SITTER, 150, plan, 0);
      spawn(w, 8904, 8704, SITTER, 150, plan, 0);
      w.stepOnce();
      expect(w.census().residual).toBe(0);
      return [w.vx[mover], w.vy[mover], w.x[mover], w.y[mover]];
    };
    expect(run(true)).toEqual(run(false));
  });

  it('the thrust of a cell pressed on from two sides does not depend on which blocker has the lower cid', () => {
    const run = (aFirst: boolean) => {
      const w = new SoftRoamWorld(one());
      const plan = w.addPlan(Array.from({ length: 16 }, (_, m) => planEntry(PLAN_REST, 0, m)));
      const mover = w.found(8 * U, 8 * U, drive, 1, 150, plan);
      w.heading[mover] = 0;
      const mk = (dx: number, dy: number) => { const b = w.found(8 * U + dx, 8 * U + dy, SITTER, 2, 150, plan); expect(b).toBeGreaterThanOrEqual(0); return b; };
      if (aFirst) { mk(800, 500); mk(700, -600); } else { mk(700, -600); mk(800, 500); }
      w.stepOnce();
      return [w.x[mover], w.y[mover], w.vx[mover], w.vy[mover]];
    };
    expect(run(false)).toEqual(run(true));
  });

  it('thrust is never left pointing into a cell of another body, even when two blockers lie more than 90 degrees apart', () => {
    const w = new SoftRoamWorld(one());
    const plan = w.addPlan(Array.from({ length: 16 }, (_, m) => planEntry(PLAN_REST, 0, m)));
    const mover = w.found(8 * U, 8 * U, drive, 1, 150, plan);
    w.heading[mover] = 128; // south-east
    // n1 = east, n2 = 120 degrees from it.
    w.found(8 * U + 900, 8 * U, SITTER, 2, 150, plan);
    w.found(8 * U - 450, 8 * U + 779, SITTER, 3, 150, plan);
    w.stepOnce();
    // One substep, no springs, no damping: the velocity is the thrust. Neither blocker is pressed into.
    expect(w.vx[mover] * 900 + w.vy[mover] * 0).toBeLessThanOrEqual(900);
    expect(w.vx[mover] * -450 + w.vy[mover] * 779).toBeLessThanOrEqual(900);
  });

  it('a stretched bond that is nearly level pulls along its own direction, not at 45 degrees', () => {
    const w = new SoftRoamWorld(one({ kBond: 96 }));
    const plan = w.addPlan(Array.from({ length: 16 }, (_, m) => (m === 0 ? planEntry(0, 1, 1) : planEntry(PLAN_REST, 0, m))));
    const m = w.found(4 * U, 8 * U, SITTER, 1, 150 + 400, plan);
    w.heading[m] = 0;
    w.stepOnce();
    expect(w.events.births.length).toBe(1);
    const d = w.events.births[0];
    w.x[d] = w.x[m] + 4 * U + 1;
    w.y[d] = w.y[m] + 1;
    w.vx[d] = 0; w.vy[d] = 0; w.vx[m] = 0; w.vy[m] = 0;
    w.carryX.fill(0); w.carryY.fill(0);
    w.stepOnce();
    expect(Math.abs(w.vx[d])).toBeGreaterThan(50);
    expect(Math.abs(w.vy[d])).toBeLessThanOrEqual(2);
  });

  it('the scent slope is a relative slope of 1/gain per tile at full thrust, as Roam reads it', () => {
    const w = new SoftRoamWorld(one({ scentGain: 4 }));
    const plan = w.addPlan(Array.from({ length: 16 }, (_, m) => planEntry(PLAN_REST, 0, m)));
    for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) w.scent[j * 16 + i] = 1000 + 125 * (i - 8);
    const c = w.found(8 * U + 512, 8 * U + 512, [512, 0, -512, 0, 0], 1, 150, plan);
    w.stepOnce();
    // Roam: ((se - sw) * 1024 * gain) / (se + sw + 1) = 250 * 4096 / 2001 = 511 of 1024, so about 119 of the 240 thrust.
    expect(w.vx[c]).toBeGreaterThanOrEqual(117);
    expect(w.vx[c]).toBeLessThanOrEqual(121);
  });

  it('overlap runs of different pairs never merge, however large the cids', () => {
    const w = new SoftRoamWorld(one({ maxCells: 16 }));
    const plan = w.addPlan(Array.from({ length: 16 }, (_, m) => planEntry(PLAN_REST, 0, m)));
    const nc = w as unknown as { nextCid: number };
    const at = (cid: number, x: number, y: number) => { nc.nextCid = cid; return spawn(w, x, y, SITTER, 150, plan, 0); };
    // Pairs (1, 2^26 + 5) and (2, 5) map to one key under cid * 2^26 + cid.
    const x1 = at(1, 3 * U, 3 * U);
    at(2 ** 26 + 5, 3 * U + 500, 3 * U);
    const y2 = at(2, 10 * U, 10 * U);
    at(5, 10 * U + 500, 10 * U);
    // Park the second pair far away for 30 steps, then bring it together while the first pair separates.
    const home = [w.x[y2], w.y[y2]];
    w.x[y2] = 13 * U;
    for (let s = 0; s < 30; s++) w.stepOnce();
    w.x[x1] = 6 * U;
    w.x[y2] = home[0];
    w.y[y2] = home[1];
    for (let s = 0; s < 30; s++) w.stepOnce();
    expect(w.census().alarmOverlap).toBe(0);
  });

  it('a cell whose lattice place its body already holds moves on to its next mode even when the world is full', () => {
    const w = new SoftRoamWorld(one({ maxCells: 2, kBond: 96 }));
    const plan = w.addPlan(Array.from({ length: 16 }, (_, m) => (m === 0 ? planEntry(0, 1, 1) : m === 1 ? planEntry(0, 1, 2) : planEntry(PLAN_REST, 0, m))));
    const m = w.found(8 * U, 8 * U, SITTER, 1, 2400, plan);
    w.heading[m] = 0;
    w.orient[m] = 0;
    w.stepOnce();
    expect(w.census().cells).toBe(2);
    expect(w.mode[m]).toBe(1);
    w.stepOnce();
    expect(w.mode[m]).toBe(2);
    expect(w.census().cells).toBe(2);
  });
});

describe('soft roam props: fix round 2', () => {
  const drive = [0, 512, -512, 0, 0];
  const one = (over: Partial<SoftRoamConfig> = {}) => quiet({ size: 16, seed: 1, kRep: 0, keep: 0, substeps: 1, ...over });
  const rest = () => Array.from({ length: 16 }, (_, m) => planEntry(PLAN_REST, 0, m));
  const CH_COST = 2;
  const CH_TURN = 3;
  const CH_TURNAMT = 4;
  const CH_UPKEEP = 7;

  it('a chaser at the centre of a symmetric scent peak feels no slope, and one unit off the centre feels almost none (not the full opposite slope)', () => {
    for (const off of [0, -1, 1]) {
      const w = new SoftRoamWorld(one({ scentGain: 8 }));
      const plan = w.addPlan(rest());
      for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) w.scent[j * 16 + i] = 1000 - 100 * (Math.abs(i - 8) + Math.abs(j - 8));
      const c = w.found(8 * U + 512 + off, 8 * U + 512 + off, [512, 0, -512, 0, 0], 1, 150, plan);
      w.stepOnce();
      expect(Math.abs(w.vx[c])).toBeLessThanOrEqual(2);
      expect(Math.abs(w.vy[c])).toBeLessThanOrEqual(2);
    }
  });

  it('the matter a thrust costs is paid by the contract rule: floor(n / 65536) plus one when hash % 65536 is below n % 65536', () => {
    let paid = 0;
    let free = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const w = new SoftRoamWorld(one({ seed, moveCost: 0.5 }));
      const plan = w.addPlan(rest());
      const c = w.found(8 * U, 8 * U, drive, 1, 150, plan);
      w.heading[c] = 0;
      const before = w.store[c];
      w.stepOnce();
      // Full thrust: n = 0.5 * 65536.
      const pay = (roamHash(seed, 0, 1, CH_COST) & 0xffff) < 32768 ? 1 : 0;
      expect(before - w.store[c]).toBe(pay);
      expect(w.census().residual).toBe(0);
      if (pay) paid++; else free++;
    }
    expect(paid).toBeGreaterThan(10);
    expect(free).toBeGreaterThan(10);
    // The case a reviewer found: seed 1, draw 54017 above half, so no charge and a store of 1 survives.
    const w = new SoftRoamWorld(one({ seed: 1, moveCost: 0.5, minStore: 1 }));
    const plan = w.addPlan(rest());
    const c = w.found(8 * U, 8 * U, drive, 1, 1, plan);
    w.heading[c] = 0;
    w.stepOnce();
    expect(w.census().cells).toBe(1);
  });

  it('upkeep is paid by the same rule: floor(n / 65536) plus one when hash % 65536 is below n % 65536', () => {
    let paid = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const w = new SoftRoamWorld(one({ seed, leakCell: 0.5 }));
      const plan = w.addPlan(rest());
      const c = w.found(8 * U, 8 * U, SITTER, 1, 150, plan);
      const before = w.store[c];
      w.stepOnce();
      const pay = (roamHash(seed, 0, 1, CH_UPKEEP) & 0xffff) < 32768 ? 1 : 0;
      expect(before - w.store[c]).toBe(pay);
      paid += pay;
    }
    expect(paid).toBeGreaterThan(10);
    expect(paid).toBeLessThan(50);
  });

  it('a contact the cap would have dropped still stops the thrust: 40 side contacts nearer than a blocker dead ahead, whichever has the lower cid', () => {
    const run = (frontFirst: boolean) => {
      const w = new SoftRoamWorld(one({ maxCells: 64 }));
      const plan = w.addPlan(rest());
      const mover = spawn(w, 8 * U, 8 * U, drive, 150, plan, 0);
      const front = () => spawn(w, 8 * U + 900, 8 * U, SITTER, 150, plan, 0);
      if (frontFirst) front();
      for (let k = 0; k < 40; k++) spawn(w, 8 * U - 3 * k, 8 * U - 800, SITTER, 150, plan, 0);
      if (!frontFirst) front();
      w.stepOnce();
      return [w.vx[mover], w.vy[mover], w.x[mover], w.y[mover]];
    };
    for (const v of [run(true), run(false)]) {
      expect(Math.abs(v[0])).toBeLessThanOrEqual(2);
      expect(Math.abs(v[2] - 8 * U)).toBeLessThanOrEqual(1);
    }
    expect(run(true)).toEqual(run(false));
  });

  it('a contact normal is a unit vector even for a cell one or two units away: thrust east past a cell at (1, 1) slides to about (120, -120)', () => {
    for (const k of [1, 2]) {
      const w = new SoftRoamWorld(one());
      const plan = w.addPlan(rest());
      const mover = spawn(w, 8 * U, 8 * U, drive, 150, plan, 0);
      spawn(w, 8 * U + k, 8 * U + k, SITTER, 150, plan, 0);
      w.stepOnce();
      expect(w.vx[mover]).toBeGreaterThanOrEqual(116);
      expect(w.vx[mover]).toBeLessThanOrEqual(124);
      expect(w.vy[mover]).toBeGreaterThanOrEqual(-124);
      expect(w.vy[mover]).toBeLessThanOrEqual(-116);
    }
  });

  it('a sum of springs far past the clamp (60 coincident neighbours) keeps its direction, is clamped to vMax, and conserves', () => {
    const w = new SoftRoamWorld(one({ maxCells: 100, kRep: 1024, keep: 255, vMax: 1024 }));
    const plan = w.addPlan(rest());
    const target = spawn(w, 8 * U, 8 * U, SITTER, 150, plan, 0);
    for (let k = 0; k < 60; k++) spawn(w, 8 * U - 600, 8 * U, SITTER, 150, plan, 0);
    const near = (c: number) => Math.hypot(w.vx[c], w.vy[c]);
    w.stepOnce();
    // Pushed east by sixty repulsions, clamped, not wrapped to some other direction by a 32-bit overflow.
    expect(w.vx[target]).toBeGreaterThan(900);
    expect(Math.abs(w.vy[target])).toBeLessThanOrEqual(2);
    expect(near(target)).toBeLessThanOrEqual(1024);
    expect(w.census().residual).toBe(0);
  });

  it('founders 65536 units apart on a size 256 torus are both placed (their squared distance is not read in 32 bits)', () => {
    const w = new SoftRoamWorld(quiet({ size: 256, maxCells: 20, matter: 1_000_000 }));
    const plan = w.addPlan(rest());
    expect(w.found(0, 0, SITTER, 1, 150, plan)).toBeGreaterThanOrEqual(0);
    expect(w.found(65536, 0, SITTER, 1, 150, plan)).toBeGreaterThanOrEqual(0);
    expect(w.found(0, 65536, SITTER, 1, 150, plan)).toBeGreaterThanOrEqual(0);
    expect(w.found(300, 300, SITTER, 1, 150, plan)).toBe(-1);
    expect(w.found(65536 + 500, 0, SITTER, 1, 150, plan)).toBe(-1);
  });

  it('the pending turn is never clipped: a body at -1000 that draws another turn keeps all of it, less the 16 it turns', () => {
    const MAX = ROAM_GENE_MAX;
    const w = new SoftRoamWorld(one({ seed: 1, turnMax: 1, size: 16 }));
    const plan = w.addPlan(rest());
    const c = w.found(8 * U, 8 * U, [0, 0, MAX, 0, 0], 1, 150, plan);
    w.turnLeft[c] = -1000;
    let tl = -1000;
    let past = false;
    for (let t = 0; t < 60; t++) {
      // The contract: a drawn event (always, at turnMax 1 and the top turn gene) adds [-256, 256]; the heading takes at most 16.
      if ((roamHash(1, t, 1, CH_TURN) & 0xffff) < 65536) tl += (roamHash(1, t, 1, CH_TURNAMT) % 513) - 256;
      const stp = Math.max(-16, Math.min(16, tl));
      tl -= stp;
      if (tl < -1023 || tl > 1023) past = true;
      w.stepOnce();
      expect(w.turnLeft[c]).toBe(tl);
    }
    expect(past).toBe(true);
  });

  it('a cell id is never reused: after cid 2^32 - 1 no more cells are founded or born, and the invariants hold', () => {
    const w = new SoftRoamWorld(quiet({ size: 16, maxCells: 20, matter: 1_000_000, kBond: 96 }));
    const grow = w.addPlan(Array.from({ length: 16 }, (_, m) => (m === 0 ? planEntry(0, 1, 1) : planEntry(PLAN_REST, 0, m))));
    const sit = w.addPlan(rest());
    (w as unknown as { nextCid: number }).nextCid = 0xffffffff;
    const a = w.found(4 * U, 4 * U, SITTER, 1, 150, sit);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(w.cid[a]).toBe(0xffffffff);
    expect(w.found(10 * U, 10 * U, SITTER, 1, 150, sit)).toBe(-1);
    w.checkInvariants();
    // A cell that wants to divide at the last id: the daughter waits, nothing wraps.
    const w2 = new SoftRoamWorld(quiet({ size: 16, maxCells: 20, matter: 1_000_000, kBond: 96 }));
    const g2 = w2.addPlan(Array.from({ length: 16 }, (_, m) => (m === 0 ? planEntry(0, 1, 1) : planEntry(PLAN_REST, 0, m))));
    (w2 as unknown as { nextCid: number }).nextCid = 0xffffffff;
    w2.found(4 * U, 4 * U, SITTER, 1, 2000, g2);
    for (let s = 0; s < 20; s++) w2.stepOnce();
    expect(w2.census().cells).toBe(1);
    w2.checkInvariants();
    expect(grow).toBeGreaterThan(0);
  });

  it('the heading of a vector is the nearest of the 1024, not the first past it', () => {
    expect(softRoamAngle(1023, 44)).toBe(7);
    // Within half a heading of the true direction (plus a twentieth for the table's rounding to Q14), over 4000 vectors.
    let worst = 0;
    for (let k = 0; k < 4000; k++) {
      const x = (roamHash(5, 0, k, 1) % 2047) - 1023;
      const y = (roamHash(5, 0, k, 2) % 2047) - 1023;
      if (x === 0 && y === 0) continue;
      const exact = ((Math.atan2(y, x) * 1024) / (2 * Math.PI) + 1024) % 1024;
      const off = Math.abs(softRoamAngle(x, y) - exact);
      worst = Math.max(worst, Math.min(off, 1024 - off));
    }
    expect(worst).toBeLessThanOrEqual(0.55);
  });

  it('death events come in cid order whatever slots the cells sit in', () => {
    const run = (order: number[]) => {
      const w = new SoftRoamWorld(quiet({ size: 16, maxCells: 20 }));
      w._testSlotOrder(order);
      const plan = w.addPlan(rest());
      const a = w.found(4000, 4000, SITTER, 1, 150, plan);
      const b = w.found(8000, 4000, SITTER, 1, 150, plan);
      for (const c of [a, b]) { w.reservoir += w.store[c]; w.store[c] = 0; }
      w.stepOnce();
      return w.events.deaths.map((d) => d.x);
    };
    expect(run([0, 1])).toEqual([4000, 8000]);
    expect(run([1, 0])).toEqual([4000, 8000]);
  });

  it('travel counts a founder\'s first step', () => {
    const w = new SoftRoamWorld(one({ substeps: 4 }));
    const plan = w.addPlan(rest());
    const c = w.found(8 * U, 8 * U, drive, 1, 150, plan);
    w.heading[c] = 0;
    w.stepOnce();
    const moved = Math.floor(Math.hypot(w.dlt(w.prevX[c], w.x[c]), w.dlt(w.prevY[c], w.y[c])));
    expect(moved).toBeGreaterThan(10);
    expect(w.census().travel).toBe(moved);
  });

  it('two fast bodies head-on cannot pass through each other: vMax above 2048 is refused, and at 2048 they stay on their own sides', () => {
    expect(() => new SoftRoamWorld(quiet({ vMax: 4096, thrustMax: 1024, kRep: 128 }))).toThrow(/vMax/);
    for (const kRep of [128, 256]) {
      const w = new SoftRoamWorld(quiet({ size: 16, seed: 1, vMax: 2048, thrustMax: 1024, kRep, substeps: 4, keep: 192 }));
      const plan = w.addPlan(rest());
      const a = spawn(w, 10240, 8192, drive, 150, plan, 0);
      const b = spawn(w, 11265, 8192, drive, 150, plan, 512);
      w.vx[a] = 2048;
      w.vx[b] = -2048;
      for (let s = 0; s < 6; s++) {
        w.stepOnce();
        expect(w.dlt(w.x[a], w.x[b])).toBeGreaterThan(0);
      }
    }
  });

  it('a cell pressed deep into another body is let out even when a far cell of its own body touches a third body lightly', () => {
    // Body 1 is a cell A in a deep overlap with B (body 2) and a daughter of A whose far side lightly touches C (body 3),
    // the pocket in which the old rule held A still forever.
    const w = new SoftRoamWorld(quiet({ size: 16, seed: 1, kRep: 256, keep: 192, substeps: 4, maxCells: 20 }));
    const plan = w.addPlan(Array.from({ length: 16 }, (_, m) => (m === 0 ? planEntry(0, 1, 1) : planEntry(PLAN_REST, 0, m))));
    const rp = w.addPlan(rest());
    const A = w.found(8 * U, 8 * U, drive, 1, 600, plan);
    w.heading[A] = 0;
    w.stepOnce();
    expect(w.census().cells).toBe(2);
    const B = spawn(w, w.x[A] + 500, w.y[A] - 500, SITTER, 150, rp, 0);
    const C = spawn(w, w.x[A] + 1000 + 800, w.y[A] + 400, SITTER, 150, rp, 0);
    for (let s = 0; s < 120; s++) w.stepOnce();
    expect(w.census().alarmOverlap).toBe(0);
    expect(w.census().residual).toBe(0);
    expect(w.alive[B] && w.alive[C]).toBeTruthy();
  });
});
