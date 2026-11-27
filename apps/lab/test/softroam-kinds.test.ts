import { describe, expect, it } from 'vitest';
import { defaultSoftRoamConfig, KIND_MOUTH, KIND_PLAIN, KIND_SHELL, PLAN_REST, planEntry, roamHash, SOFT_U, type SoftRoamConfig, SoftRoamWorld } from '../src/softroam/kernel.ts';
import { ROAM_PLANS, ROAM_TYPES } from '../src/roam/view.ts';
import { defaultRoamConfig, RoamWorld } from '../src/roam/kernel.ts';
import { foundSoftRoam, SoftPaintMemory } from '../src/softroam/view.ts';

/**
 * Soft Roam milestone 2: kinds' eating, touch (drain, hits, crack, toughness, seal), grip, and the longer scent.
 * Small hand-built worlds with nothing moving unless a test says so, then long runs with everything on.
 */

const U = SOFT_U;
const SITTER = [0, 0, -512, 0, 0];
const CHASER = [512, 0, -512, 0, 0];

/** No upkeep, no wear, no copy errors, no patches, no turning; kinds, drain and crack on; flow so small that it moves nothing. */
const still = (over: Partial<SoftRoamConfig> = {}): SoftRoamConfig => ({
  ...defaultSoftRoamConfig(),
  size: 16,
  matter: 700_000,
  maxCells: 64,
  startPatches: 0,
  patchEvery: 1_000_000,
  mut: 0,
  planMut: 0,
  leakSide: 0,
  leakCell: 0,
  moveCost: 0,
  life: undefined,
  compost: undefined,
  turnMax: 0,
  minStore: 1,
  flow: 1 / 1024,
  kinds: true,
  drain: 3,
  seal: 0,
  ...over,
});

const restPlan = (w: SoftRoamWorld): number => w.addPlan(Array.from({ length: 16 }, (_, m) => planEntry(PLAN_REST, 0, m)));

/** Put a cell anywhere, with no spacing rule (reaches the kernel's private allocate and place). */
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

/** A body of `kinds.length` cells in a row from (x, y) along (dx, dy) per cell, each the daughter of the one before. Returns the slots. */
function chain(w: SoftRoamWorld, plan: number, x: number, y: number, dx: number, dy: number, kinds: readonly number[], store = 150, genes: readonly number[] = SITTER, heading = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i < kinds.length; i++) {
    const c = spawn(w, x + i * dx, y + i * dy, genes, store, plan, heading);
    w.kind[c] = kinds[i];
    w.gx[c] = i;
    if (i > 0) { w.mother[c] = out[i - 1]; w.body[c] = w.body[out[0]]; w.bodySize[w.body[c]]++; w.bodyCount--; }
    out.push(c);
  }
  return out;
}

const P = KIND_PLAIN;
const M = KIND_MOUTH;
const S = KIND_SHELL;
/** A hunter of n cells whose mouth (the last cell) sits at (mx, my), the body trailing to the west. */
const hunter = (w: SoftRoamWorld, plan: number, n: number, mx: number, my: number, store = 150): number[] =>
  chain(w, plan, mx - (n - 1) * U, my, U, 0, [...Array(n - 1).fill(P), M], store);

describe('soft roam kinds: eating', () => {
  const ground = (w: SoftRoamWorld, c: number, food = 100): void => {
    w.food[(w.y[c] >>> 10) * w.size + (w.x[c] >>> 10)] += food;
    w.reservoir -= food;
  };

  it('only plain cells and one-cell bodies eat: a mouth or shell in a larger body eats nothing, a lone one does', () => {
    const w = new SoftRoamWorld(still({ bite: 3, shellBite: undefined }));
    const plan = restPlan(w);
    const lonePlain = spawn(w, 2 * U + 512, 2 * U + 512, SITTER, 150, plan);
    const loneMouth = spawn(w, 6 * U + 512, 2 * U + 512, SITTER, 150, plan);
    w.kind[loneMouth] = M;
    const loneShell = spawn(w, 10 * U + 512, 2 * U + 512, SITTER, 150, plan);
    w.kind[loneShell] = S;
    const body = chain(w, plan, 2 * U + 512, 8 * U + 512, 2 * U, 0, [P, M, S, P]);
    for (const c of [lonePlain, loneMouth, loneShell, ...body]) ground(w, c);
    const before = [lonePlain, loneMouth, loneShell, ...body].map((c) => w.store[c]);
    w.stepOnce();
    const gain = [lonePlain, loneMouth, loneShell, ...body].map((c, i) => w.store[c] - before[i]);
    // Full bite for the lone cells whatever their kind, and for the plain cells of a body; none for its mouth and shell.
    expect(gain.slice(0, 3)).toEqual([3, 3, 3]);
    expect(gain.slice(3)).toEqual([3, 0, 0, 3]);
    expect(w.census().residual).toBe(0);
  });

  it('a one-cell shell eats shellBite of the bite on average over many seeds, by a hash that rounds a fraction up or down', () => {
    let total = 0;
    const seen = new Set<number>();
    const N = 400;
    for (let seed = 1; seed <= N; seed++) {
      const w = new SoftRoamWorld(still({ seed, bite: 3, shellBite: 0.5 }));
      const plan = restPlan(w);
      const c = spawn(w, 4 * U + 512, 4 * U + 512, SITTER, 150, plan);
      w.kind[c] = S;
      w.food[4 * w.size + 4] = 50;
      w.reservoir -= 50;
      w.stepOnce();
      const ate = w.store[c] - 150;
      seen.add(ate);
      total += ate;
      expect(w.census().residual).toBe(0);
    }
    expect([...seen].sort()).toEqual([1, 2]);
    expect(total / N).toBeGreaterThan(1.4);
    expect(total / N).toBeLessThan(1.6);
  });

  it('a shell pays Roam\'s side upkeep: floor(leakSide * (1 + tough) * shellLeak) a side, exactly', () => {
    // leakSide 1/2: a plain lone cell pays 4 sides = 2 exactly. A shell at shellLeak 1/4: tough 1 pays 1 exactly, tough 3 pays 2, tough 0 pays 0 or 1 (half each).
    const pay = (kind: number, tough: number, seed = 1, shellLeak?: number): number => {
      const w = new SoftRoamWorld(still({ seed, leakSide: 0.5, shellLeak }));
      const plan = restPlan(w);
      const c = spawn(w, 4 * U + 512, 4 * U + 512, SITTER, 150, plan);
      w.kind[c] = kind;
      w.tough[c] = tough;
      w.stepOnce();
      expect(w.census().residual).toBe(0);
      return 150 - w.store[c];
    };
    expect(pay(P, 0)).toBe(2);
    expect(pay(S, 1)).toBe(1);
    expect(pay(S, 3)).toBe(2);
    expect(pay(S, 2, 1, 0.5)).toBe(3);
    let sum = 0;
    for (let seed = 1; seed <= 200; seed++) sum += pay(S, 0, seed);
    expect(sum / 200).toBeGreaterThan(0.35);
    expect(sum / 200).toBeLessThan(0.65);
  });
});

describe('soft roam kinds: touch', () => {
  /** A hunter of n cells and a prey body of m cells (its first cell at touching range of the mouth), both old enough. */
  const duel = (n: number, m: number, over: Partial<SoftRoamConfig> = {}, preyKinds?: number[]): { w: SoftRoamWorld; h: number[]; p: number[] } => {
    const w = new SoftRoamWorld(still(over));
    const plan = restPlan(w);
    const h = hunter(w, plan, n, 6 * U, 8 * U);
    const p = chain(w, plan, 6 * U + 1100, 8 * U, 0, U, preyKinds ?? Array(m).fill(P));
    return { w, h, p };
  };

  it('a hunter twice the prey\'s size drains it, and one less than twice does not', () => {
    for (const [n, m, drains] of [[2, 1, true], [3, 2, false], [4, 2, true], [1, 1, false], [5, 3, false], [6, 3, true], [2, 2, false]] as const) {
      const { w, h, p } = duel(n, m);
      const mouth = h[h.length - 1];
      const before = w.store[p[0]];
      w.stepOnce();
      if (drains) {
        expect(w.drained).toBe(3);
        expect(w.store[p[0]]).toBe(before - 3);
        expect(w.store[mouth]).toBe(150 + 3);
        expect(w.lastDrainStep[mouth]).toBe(0);
        expect(w.lastDrainStep[p[0]]).toBe(0);
      } else {
        expect(w.drained).toBe(0);
        expect(w.store[p[0]]).toBe(before);
      }
      expect(w.census().residual).toBe(0);
    }
  });

  it('only a mouth takes: plain cells in a large body do not, and a mouth may be prey', () => {
    const w = new SoftRoamWorld(still());
    const plan = restPlan(w);
    chain(w, plan, 2 * U, 4 * U, U, 0, [P, P, P, P]);
    const prey = spawn(w, 2 * U + 3 * U + 1100, 4 * U, SITTER, 150, plan);
    w.stepOnce();
    expect(w.drained).toBe(0);
    const v = new SoftRoamWorld(still());
    const plan2 = restPlan(v);
    const h = hunter(v, plan2, 4, 6 * U, 8 * U);
    const q = spawn(v, 6 * U + 1100, 8 * U, SITTER, 150, plan2);
    v.kind[q] = M;
    v.stepOnce();
    expect(v.drained).toBe(3);
    expect(v.store[q]).toBe(147);
    expect(v.store[h[3]]).toBe(153);
    expect(prey).toBeGreaterThanOrEqual(0);
  });

  it('without kinds any cell of a body twice the size takes (Roam\'s rule)', () => {
    const w = new SoftRoamWorld(still({ kinds: false }));
    const plan = restPlan(w);
    const h = chain(w, plan, 5 * U, 8 * U, U, 0, [P, P]);
    const q = spawn(w, 6 * U + 1100, 8 * U, SITTER, 150, plan);
    w.stepOnce();
    expect(w.drained).toBe(3);
    expect(w.store[q]).toBe(147);
    expect(h.length).toBe(2);
  });

  it('no cid advantage: two equal mouths on one prey take equal amounts, and a short store is split floor-equal, whichever is older', () => {
    for (const swap of [false, true]) {
      for (const [preyStore, expectEach, expectLeft] of [[150, 3, 144], [5, 2, 1], [2, 1, 0], [1, 0, 1]] as const) {
        const w = new SoftRoamWorld(still());
        const plan = restPlan(w);
        const mk = (left: boolean): number => (left ? hunter(w, plan, 2, 6 * U, 8 * U)[1] : chain(w, plan, 6 * U + 2 * 1100, 8 * U, U, 0, [M, P])[0]);
        // The cells sit in the world in either order, so the mouths' cids go either way round.
        const mouths = swap ? [mk(false), mk(true)] : [mk(true), mk(false)];
        const prey = spawn(w, 6 * U + 1100, 8 * U, SITTER, preyStore, plan);
        const before = mouths.map((c) => w.store[c]);
        w.stepOnce();
        expect(w.store[prey]).toBe(expectLeft);
        expect(mouths.map((c, i) => w.store[c] - before[i])).toEqual([expectEach, expectEach]);
        expect(w.drained).toBe(2 * expectEach);
        expect(w.census().residual).toBe(0);
      }
    }
  });

  it('three mouths share a store of 5 as floor(5 / 3) = 1 each', () => {
    const w = new SoftRoamWorld(still());
    const plan = restPlan(w);
    const cx = 8 * U;
    const prey = spawn(w, cx, cx, SITTER, 5, plan);
    const a = chain(w, plan, cx - 1100 - U, cx, U, 0, [P, M]);
    const b = chain(w, plan, cx + 1100, cx, U, 0, [M, P]);
    const c = chain(w, plan, cx, cx - 1100 - U, 0, U, [P, M]);
    const mouths = [a[1], b[0], c[1]];
    w.stepOnce();
    expect(mouths.map((m) => w.store[m] - 150)).toEqual([1, 1, 1]);
    expect(w.store[prey]).toBe(2);
  });

  it('bodies within seal steps of release neither take nor lose', () => {
    const run = (hunterAge: number, preyAge: number): { drained: number; prey: number } => {
      const w = new SoftRoamWorld(still({ seal: 100 }));
      w.step = 500;
      const plan = restPlan(w);
      // Sealed bodies dash along their heading, so each is aimed at the other and the pair stays in touch.
      const h = chain(w, plan, 5 * U, 8 * U, U, 0, [P, M], 150, SITTER, 0);
      const p = spawn(w, 6 * U + 1100, 8 * U, SITTER, 150, plan, 512);
      for (const c of h) w.since[c] = 500 - hunterAge;
      w.since[p] = 500 - preyAge;
      w.stepOnce();
      return { drained: w.drained, prey: w.store[p] };
    };
    expect(run(400, 400)).toEqual({ drained: 3, prey: 147 });
    expect(run(400, 0).drained).toBe(0);
    expect(run(400, 99).drained).toBe(0);
    expect(run(0, 400).drained).toBe(0);
    expect(run(99, 400).drained).toBe(0);
    expect(run(400, 100).drained).toBe(3);
    expect(run(100, 400).drained).toBe(3);
  });

  it('a shell is not drained; with crack it takes one hit a step from a mouth and cracks at exactly crack hits, edible from the step after', () => {
    const { w, h, p } = duel(2, 1, { crack: 5 }, [S]);
    const mouth = h[1];
    const shell = p[0];
    const seen: string[] = [];
    for (let s = 1; s <= 7; s++) {
      w.stepOnce();
      seen.push(`${s}:${w.kind[shell]}:${w.hits[shell]}:${w.drained}:${w.cracked}`);
    }
    // Hits 1 to 4 keep the shell; the fifth step cracks it (kind 0, hits reset) and drains nothing; from the sixth it is fed on, 3 a step.
    expect(seen).toEqual(['1:1:1:0:0', '2:1:2:0:0', '3:1:3:0:0', '4:1:4:0:0', '5:0:0:0:1', '6:0:0:3:1', '7:0:0:6:1']);
    expect(w.lastHitStep[shell]).toBe(4);
    expect(w.store[mouth]).toBe(150 + 6);
    expect(w.census().residual).toBe(0);
  });

  it('a crack leaves an event at the shell, and without crack a shell is never hit or drained', () => {
    const { w, p } = duel(2, 1, { crack: 2 }, [S]);
    w.stepOnce();
    expect(w.events.cracks.length).toBe(0);
    w.stepOnce();
    expect(w.events.cracks).toEqual([{ x: w.x[p[0]], y: w.y[p[0]] }]);
    w.stepOnce();
    expect(w.events.cracks.length).toBe(0);
    const v = duel(2, 1, {}, [S]);
    v.w.advance(30);
    expect(v.w.drained).toBe(0);
    expect(v.w.hits[v.p[0]]).toBe(0);
    expect(v.w.kind[v.p[0]]).toBe(S);
  });

  it('toughness multiplies the hits to crack by 2^level, and two mouths on one shell are two hits a step', () => {
    for (const tough of [0, 1, 2, 3]) {
      const { w, p } = duel(2, 1, { crack: 3, toughness: true }, [S]);
      w.tough[p[0]] = tough;
      let at = 0;
      for (let s = 1; s <= 40 && at === 0; s++) { w.stepOnce(); if (w.kind[p[0]] === P) at = s; }
      expect(at).toBe(3 << tough);
    }
    const w = new SoftRoamWorld(still({ crack: 5 }));
    const plan = restPlan(w);
    const shell = spawn(w, 8 * U, 8 * U, SITTER, 150, plan);
    w.kind[shell] = S;
    chain(w, plan, 8 * U - 1100 - U, 8 * U, U, 0, [P, M]);
    chain(w, plan, 8 * U + 1100, 8 * U, U, 0, [M, P]);
    w.stepOnce();
    expect(w.hits[shell]).toBe(2);
    w.stepOnce();
    expect(w.hits[shell]).toBe(4);
    w.stepOnce();
    expect(w.kind[shell]).toBe(P);
    expect(w.cracked).toBe(1);
  });

  it('a body that is not twice as large does not hit a shell either', () => {
    const { w, p } = duel(3, 2, { crack: 2 }, [S, P]);
    w.advance(20);
    expect(w.kind[p[0]]).toBe(S);
    expect(w.hits[p[0]]).toBe(0);
  });

  it('touch reaches 1.25 D and no further', () => {
    for (const [gap, hit] of [[1280, true], [1281, false], [1100, true], [1500, false]] as const) {
      const w = new SoftRoamWorld(still());
      const plan = restPlan(w);
      hunter(w, plan, 2, 6 * U, 8 * U);
      spawn(w, 6 * U + gap, 8 * U, SITTER, 150, plan);
      w.stepOnce();
      expect(w.drained > 0).toBe(hit);
    }
  });

  it('keeps at most four contacts a cell, the same four whatever slots the cells sit in, and a fresh pick each step', () => {
    const build = (order: readonly number[] | null, reverse: boolean): SoftRoamWorld => {
      const w = new SoftRoamWorld(still({ maxCells: 64 }));
      if (order) w._testSlotOrder(order);
      w._reverseScan = reverse;
      const plan = restPlan(w);
      const c = 8 * U + 512;
      spawn(w, c, c, SITTER, 150, plan);
      // Six single cells around it at 1100 units: all within touch of it, and of their two neighbours on the ring.
      for (let k = 0; k < 6; k++) {
        const a = (k * 2 * Math.PI) / 6;
        spawn(w, c + Math.round(1100 * Math.cos(a)), c + Math.round(1100 * Math.sin(a)), SITTER, 150, plan);
      }
      return w;
    };
    const perm = Array.from({ length: 64 }, (_, i) => i).sort((p, q) => roamHash(5, 0, p, 1) - roamHash(5, 0, q, 1));
    const worlds = [build(null, false), build(perm, false), build(null, true), build(perm.slice().reverse(), true)];
    const picks = new Set<string>();
    for (let s = 0; s < 12; s++) {
      const sets = worlds.map((w) => w._touchPairs());
      for (const set of sets) expect(set).toEqual(sets[0]);
      const count = new Map<number, number>();
      for (const pair of sets[0]) for (const id of pair.split(',')) count.set(Number(id), (count.get(Number(id)) ?? 0) + 1);
      for (const k of count.values()) expect(k).toBeLessThanOrEqual(4);
      // The centre (cid 1) has six candidates and keeps four.
      expect(count.get(1)).toBe(4);
      picks.add(sets[0].filter((p) => p.startsWith('1,')).join(';'));
      for (const w of worlds) w.step++;
    }
    expect(picks.size).toBeGreaterThan(3);
  });
});

describe('soft roam kinds: contacts are mutual', () => {
  it('in a packed patch where most cells have six candidates, a pair is kept only when each keeps the other: no cell holds more than four', () => {
    // 37 cells on a triangular lattice at 1100 units: each interior cell has six neighbours within touch, and no body is large enough to matter.
    const build = (order: readonly number[] | null): SoftRoamWorld => {
      const w = new SoftRoamWorld(still({ maxCells: 64, size: 16 }));
      if (order) w._testSlotOrder(order);
      const plan = restPlan(w);
      const c = 8 * U;
      for (let r = -3; r <= 3; r++) {
        for (let q = -3; q <= 3; q++) {
          if (Math.abs(r + q) > 3) continue;
          spawn(w, c + 1100 * q + Math.round(550 * r), c + Math.round(952.6 * r), SITTER, 150, plan);
        }
      }
      return w;
    };
    const w = build(null);
    expect(w.census().cells).toBe(37);
    let sawFour = 0;
    for (let s = 0; s < 20; s++, w.step++) {
      const pairs = w._touchPairs();
      const count = new Map<number, number>();
      for (const pr of pairs) for (const id of pr.split(',')) count.set(Number(id), (count.get(Number(id)) ?? 0) + 1);
      for (const k of count.values()) {
        expect(k).toBeLessThanOrEqual(4);
        if (k === 4) sawFour++;
      }
    }
    expect(sawFour).toBeGreaterThan(100);
  });
});

describe('soft roam kinds: touch ties', () => {
  it('two mouths whose pair draws with a prey collide are not ranked by age: each wins about half the contested places', () => {
    // cids 6068 and 57348 against 56617 give the same pair-hash input (imul(6068, K) ^ 56617 === imul(56617, K) ^ 57348).
    const K = 0x9e3779b1;
    expect((Math.imul(6068, K) ^ 56617) >>> 0).toBe((Math.imul(56617, K) ^ 57348) >>> 0);
    const w = new SoftRoamWorld({ ...defaultSoftRoamConfig(), size: 16, matter: 700_000, maxCells: 64, startPatches: 0, patchEvery: 1_000_000, kinds: true, drain: 1, seal: 0, mut: 0, planMut: 0 });
    const plan = w.addPlan(Array.from({ length: 16 }, (_, m) => planEntry(PLAN_REST, 0, m)));
    const c = 8 * U + 512;
    const prey = spawn(w, c, c, SITTER, 150, plan);
    const ring: number[] = [];
    // Five single cells round the prey at 1100 units (36 degree spacing puts neighbours beyond touch of each other).
    for (let k = 0; k < 5; k++) {
      const a = (k * 2 * Math.PI) / 5;
      ring.push(spawn(w, c + Math.round(1100 * Math.cos(a)), c + Math.round(1100 * Math.sin(a)), SITTER, 150, plan));
    }
    w.cid[prey] = 56617;
    w.cid[ring[0]] = 6068;
    w.cid[ring[1]] = 57348;
    w.cid[ring[2]] = 100;
    w.cid[ring[3]] = 200;
    w.cid[ring[4]] = 300;
    let low = 0;
    let high = 0;
    for (let s = 0; s < 400; s++, w.step++) {
      const pairs = w._touchPairs();
      const lowIn = pairs.some((p) => p === '6068,56617');
      const highIn = pairs.some((p) => p === '56617,57348');
      if (lowIn && !highIn) low++;
      if (highIn && !lowIn) high++;
    }
    expect(low + high).toBeGreaterThan(30);
    expect(Math.min(low, high) / (low + high)).toBeGreaterThan(0.25);
  });
});

describe('soft roam kinds: the picture shows what touch did', () => {
  const seenPairs = (mem: SoftPaintMemory): string[] => mem.threads.filter((t) => t.seen).map((t) => `${t.mc},${t.pc}`).sort();
  const fedPairs = (w: SoftRoamWorld): string[] => [...new Set(w.events.feeds.map((f) => `${f.mc},${f.pc}`))].sort();

  it('draws exactly the pairs that fed: two mouths on different prey are two threads, not four', () => {
    const w = new SoftRoamWorld(still());
    const plan = restPlan(w);
    // Two hunters (mouth last, tail west) with a prey each, one pair above the other: each mouth is 1400 units from the other's prey.
    const a = hunter(w, plan, 2, 4 * U, 4 * U);
    const pa = spawn(w, 4 * U + 1100, 4 * U, SITTER, 150, plan);
    const b = hunter(w, plan, 2, 4 * U, 4 * U + 1400);
    const pb = spawn(w, 4 * U + 1100, 4 * U + 1400, SITTER, 150, plan);
    expect(Math.hypot(w.dlt(w.x[a[1]], w.x[pb]), w.dlt(w.y[a[1]], w.y[pb]))).toBeGreaterThan(1280);
    expect(Math.hypot(w.dlt(w.x[b[1]], w.x[pa]), w.dlt(w.y[b[1]], w.y[pa]))).toBeGreaterThan(1280);
    const mem = new SoftPaintMemory();
    mem.observe(w);
    w.stepOnce();
    mem.observe(w);
    expect(fedPairs(w)).toEqual([`${w.cid[a[1]]},${w.cid[pa]}`, `${w.cid[b[1]]},${w.cid[pb]}`].sort());
    expect(seenPairs(mem)).toEqual(fedPairs(w));
    expect(mem.feedT[a[1]] + mem.feedT[b[1]]).toBe(2);
  });

  it('draws a thread when the mouth and its prey are two tile buckets apart', () => {
    const w = new SoftRoamWorld(still());
    const plan = restPlan(w);
    const h = chain(w, plan, 1000, 8 * U + 100, 0, 1100, [P, M]);
    // The mouth is the second cell: put the hunter's body clear and the prey 1078 away, in the tile two over.
    w.x[h[0]] = 1000; w.y[h[0]] = 8 * U + 100; w.x[h[1]] = 1000; w.y[h[1]] = 9 * U + 200;
    const prey = spawn(w, 1000 + 1078, 9 * U + 200, SITTER, 150, plan);
    expect(w.x[prey] >>> 10).toBe(2);
    expect(w.x[h[1]] >>> 10).toBe(0);
    const mem = new SoftPaintMemory();
    mem.observe(w);
    w.stepOnce();
    mem.observe(w);
    expect(fedPairs(w)).toEqual([`${w.cid[h[1]]},${w.cid[prey]}`]);
    expect(seenPairs(mem)).toEqual(fedPairs(w));
    expect(mem.preyT[prey]).toBe(1);
  });

  it('draws feeding without kinds too (any cell of the larger body feeds), and a thread for every real feeding over a long run', () => {
    const w = new SoftRoamWorld(still({ kinds: false }));
    const plan = restPlan(w);
    const h = chain(w, plan, 6 * U, 8 * U, U, 0, [P, P]);
    const prey = spawn(w, 6 * U + 2 * U + 100, 8 * U, SITTER, 150, plan);
    const mem = new SoftPaintMemory();
    mem.observe(w);
    w.stepOnce();
    mem.observe(w);
    expect(w.drained).toBeGreaterThan(0);
    expect(seenPairs(mem).length).toBeGreaterThan(0);
    expect(seenPairs(mem)).toEqual(fedPairs(w));
    expect(mem.preyT[prey]).toBe(1);
    void h;
    // A garden run: after every step the threads in view are exactly the pairs the kernel fed.
    const g = foundSoftRoam({ seed: 1, start: 'garden' });
    const gm = new SoftPaintMemory();
    gm.observe(g);
    let fed = 0;
    for (let k = 0; k < 1500; k++) {
      g.stepOnce();
      gm.observe(g);
      const want = fedPairs(g).filter((q) => { const [m, pr] = q.split(',').map(Number); let ok = false; for (let c = 0; c < g.cap; c++) if (g.alive[c] && g.cid[c] === m) for (let d = 0; d < g.cap; d++) if (g.alive[d] && g.cid[d] === pr) ok = true; return ok; });
      expect(seenPairs(gm)).toEqual(want);
      fed += want.length;
    }
    expect(fed).toBeGreaterThan(200);
  }, 60_000);

  it('a shell cracked on the very first step flashes and leaves a ring', () => {
    const w = new SoftRoamWorld(still({ crack: 1, seal: 0 }));
    const plan = restPlan(w);
    const h = hunter(w, plan, 2, 6 * U, 8 * U);
    const shell = chain(w, plan, 6 * U + 1100, 8 * U, 0, U, [S])[0];
    const mem = new SoftPaintMemory();
    mem.observe(w);
    w.stepOnce();
    expect(w.events.cracks.length).toBe(1);
    mem.observe(w);
    expect(mem.rings.length).toBe(1);
    expect(mem.lvCur[shell * 7]).toBeGreaterThan(0.3);
    void h;
  });
});

describe('soft roam kinds: grip', () => {
  /** A hunter (a mouth and one more cell) chasing a single cell that runs along +x; returns the steps the two spent within touch, and the labels seen. */
  const chase = (grip: number | undefined, seed = 1, steps = 400): { touching: number; merged: boolean; gap: number } => {
    const w = new SoftRoamWorld(still({ seed, grip, drain: 1, crack: 2, vMax: 1024 }));
    const plan = restPlan(w);
    // The hunter drives a little harder than the prey runs, so a held contact decides how long it stays on.
    const h = chain(w, plan, 4 * U, 8 * U, U, 0, [P, M], 400, [0, 160, -512, 0, 0], 0);
    const p = spawn(w, 5 * U + 1200, 8 * U, [0, 220, -512, 0, 0], 3000, plan, 0);
    let touching = 0;
    let merged = false;
    for (let s = 0; s < steps; s++) {
      w.stepOnce();
      // The hunter and prey must be told apart however close they get: labels come from mother links alone.
      if (!w.alive[p]) break;
      if (w.body[h[0]] === w.body[p] || w.body[h[1]] === w.body[p] || w.mother[p] !== -1) merged = true;
      const dx = w.dlt(w.x[h[1]], w.x[p]);
      const dy = w.dlt(w.y[h[1]], w.y[p]);
      if (dx * dx + dy * dy <= 1280 * 1280) touching++;
      w.checkInvariants();
    }
    const dx = w.dlt(w.x[h[1]], w.x[p]);
    return { touching, merged, gap: Math.abs(dx) };
  };

  it('a hunter stays on a fleeing prey longer with grip than without, and bodies never merge', () => {
    const without = chase(undefined);
    const weak = chase(24);
    const strong = chase(96);
    expect(without.merged).toBe(false);
    expect(weak.merged).toBe(false);
    expect(strong.merged).toBe(false);
    expect(weak.touching).toBeGreaterThan(without.touching + 20);
    expect(strong.touching).toBeGreaterThanOrEqual(weak.touching);
    expect(strong.gap).toBeLessThanOrEqual(1280);
  });

  it('grip with 0 changes nothing, and conserves momentum and matter', () => {
    const a = chase(undefined, 3, 100);
    const b = chase(0, 3, 100);
    expect(b).toEqual(a);
    const w = new SoftRoamWorld(still({ grip: 200, drain: 1, substeps: 1, keep: 0 }));
    const plan = restPlan(w);
    const h = chain(w, plan, 4 * U, 8 * U, U, 0, [P, M]);
    const p = spawn(w, 5 * U + 1250, 8 * U, SITTER, 150, plan);
    w.stepOnce();
    // Pulled together, each cell by the same amount and opposite ways: the hunter's two cells and the prey gain no net momentum.
    expect(w.vx[h[0]] + w.vx[h[1]] + w.vx[p]).toBe(0);
    expect(w.vx[h[1]]).toBeGreaterThan(0);
    expect(w.vx[p]).toBeLessThan(0);
    expect(w.census().residual).toBe(0);
  });

  it('is refused without kinds and drain', () => {
    expect(() => new SoftRoamWorld(still({ grip: 10, kinds: false }))).toThrow();
    // seal is cleared so the seal guard ('seal needs drain') cannot fire first: only the grip guard can refuse this.
    expect(() => new SoftRoamWorld({ ...still({ grip: 10 }), seal: undefined, drain: undefined, crack: undefined })).toThrow(/grip needs kinds and drain/);
    expect(() => new SoftRoamWorld(still({ grip: 10, kinds: false }))).toThrow(/grip needs kinds and drain/);
  });
});

/** The whole kinds ecology: planted bodies, half of them hunters (the first kept daughter is a mouth) or armoured (every released daughter a shell). */
function ecology(seed: number, over: Partial<SoftRoamConfig> = {}, prep?: (w: SoftRoamWorld) => void): SoftRoamWorld {
  const w = new SoftRoamWorld({
    ...defaultSoftRoamConfig(),
    size: 40,
    seed,
    matter: 60_000,
    maxCells: 1024,
    startPatches: 6,
    patchEvery: 30,
    mut: 0.03,
    planMut: 0.3,
    life: 1500,
    compost: true,
    kinds: true,
    drain: 2,
    seal: 30,
    crack: 12,
    toughness: true,
    shellBite: 0.5,
    shellLeak: 0.25,
    grip: 48,
    ...over,
  });
  prep?.(w);
  const names = ['bush', 'plate', 'speck', 'block', 'line'] as const;
  const types = [ROAM_TYPES.bush, ROAM_TYPES.plate, ROAM_TYPES.speck, ROAM_TYPES.block, ROAM_TYPES.line];
  const plain = names.map((n) => w.addPlan(ROAM_PLANS[n]));
  const variant = names.map((n, j) => {
    const plan = ROAM_PLANS[n];
    if ((plan[0] & 15) >= 4) return w.addPlan(plan.map((e) => ((e & 15) >= 4 && (e & 15) < PLAN_REST ? e | (S << 12) : e)), plain[j]);
    return w.addPlan(plan.map((e, m) => (m === 0 ? e | (M << 12) : e)), plain[j]);
  });
  let placed = 0;
  for (let k = 0; placed < 30 && k < 2000; k++) {
    const px = roamHash(seed, 0, k, 41) % (w.size * U);
    const py = roamHash(seed, 0, k, 42) % (w.size * U);
    const j = placed % names.length;
    const pl = Math.floor(placed / names.length) % 2 === 1 ? variant[j] : plain[j];
    if (w.found(px, py, types[j].genes, j + 1, undefined, pl) >= 0) placed++;
  }
  expect(placed).toBe(30);
  return w;
}

describe('soft roam kinds: the whole ecology', () => {
  it('keeps the ledger exact for 3000 steps on two seeds with kinds, drain, crack, toughness, shellBite and grip all on', () => {
    for (const seed of [11, 12]) {
      const w = ecology(seed);
      let maxShells = 0;
      let maxMouths = 0;
      for (let s = 0; s < 3000; s++) {
        w.stepOnce();
        const c = w.census();
        expect(c.residual).toBe(0);
        maxShells = Math.max(maxShells, c.shells);
        maxMouths = Math.max(maxMouths, c.mouths);
        if (s % 250 === 0) w.checkInvariants();
      }
      w.checkInvariants();
      const c = w.census();
      // Every counter the rules touch moved (seeds and dials were chosen so that bumping alone cracks shells: crack 12, a dense world).
      expect(c.drained).toBeGreaterThan(10_000);
      expect(c.cracked).toBeGreaterThan(10);
      expect(c.shells).toBeGreaterThan(0);
      expect(c.mouths).toBeGreaterThan(0);
      expect(maxShells).toBeGreaterThan(10);
      expect(maxMouths).toBeGreaterThan(10);
      expect(c.divisions).toBeGreaterThan(500);
      expect(c.alarmBonds + c.alarmOverlap + c.alarmSpeed).toBe(0);
    }
  }, 120_000);

  it('does not depend on slot order or bucket order with touch, drain, crack and grip on: the same history keyed by cid', () => {
    const perm = Array.from({ length: 1024 }, (_, i) => i).sort((p, q) => roamHash(99, 0, p, 1) - roamHash(99, 0, q, 1));
    const worlds = [
      ecology(21),
      ecology(21, {}, (w) => w._testSlotOrder(perm)),
      ecology(21, {}, (w) => { w._reverseScan = true; }),
      ecology(21, {}, (w) => { w._testSlotOrder(perm.slice().reverse()); w._reverseScan = true; }),
    ];
    expect(worlds[0].x[0] === worlds[1].x[0] && worlds[0].y[0] === worlds[1].y[0]).toBe(false);
    // The digest leaves the event lists out, so their order (the picture's, listed by serial) is compared too, as serials and units.
    const events = (w: SoftRoamWorld): string => {
      const e = w.events;
      return JSON.stringify([e.feeds.map((f) => [f.mc, f.pc]), e.hits.map((h) => h.c), e.cracks.map((q) => [q.x, q.y]), e.deaths.map((q) => [q.x, q.y, q.kind, q.store]), e.patches.map((q) => [q.x, q.y])]);
    };
    let multiFeeds = 0;
    for (let s = 0; s < 800; s++) {
      for (const w of worlds) w.stepOnce();
      const d = worlds[0].digest();
      const ev = events(worlds[0]);
      for (let k = 1; k < worlds.length; k++) {
        if (worlds[k].digest() !== d) throw new Error(`world ${k} differs at step ${s + 1}`);
        if (events(worlds[k]) !== ev) throw new Error(`world ${k} lists its events differently at step ${s + 1}`);
      }
      if (worlds[0].events.feeds.length > 1) multiFeeds++;
    }
    // The comparison only bites where a step lists several of a kind.
    expect(multiFeeds).toBeGreaterThan(20);
    const c = worlds[0].census();
    expect(c.drained).toBeGreaterThan(1000);
    expect(c.cracked).toBeGreaterThan(0);
    expect(c.mouths).toBeGreaterThan(0);
  }, 120_000);
});

describe('soft roam kinds: scent reach', () => {
  const LONE = (over: Partial<SoftRoamConfig> = {}): SoftRoamWorld => new SoftRoamWorld(still({ size: 64, kinds: false, drain: undefined, seal: undefined, flow: 1 / 64, ...over }));
  /** A patch of 4000 on the disc of radius 4 about tile (cx, 32), put on the ground from the reservoir as `patchFood` does. */
  const patchAt = (w: SoftRoamWorld, cx: number): void => {
    const tiles: number[] = [];
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (dx * dx + dy * dy <= 16) tiles.push((32 + dy) * w.size + cx + dx);
    const each = Math.floor(4000 / tiles.length);
    for (const t of tiles) w.food[t] += each;
    w.food[32 * w.size + cx] += 4000 - each * tiles.length;
    w.reservoir -= 4000;
  };

  it('a chaser 12 tiles from a lone patch feels a slope toward it (about 16 tiles of reach, as Roam), and still one 16 tiles out', () => {
    const run = (dist: number): { vx: number; vy: number } => {
      const w = LONE();
      patchAt(w, 32);
      w.advance(1200);
      expect(w.census().residual).toBe(0);
      const plan = restPlan(w);
      const c = spawn(w, (32 + dist) * U + 512, 32 * U + 512, CHASER, 150, plan);
      w.stepOnce();
      return { vx: w.vx[c], vy: w.vy[c] };
    };
    const near = run(12);
    // Full thrust is 240 a substep; the read at 12 tiles is about 0.7 of full (Roam's -0.69), so the chaser is pushed hard toward the patch (-x).
    expect(near.vx).toBeLessThan(-100);
    expect(Math.abs(near.vy)).toBeLessThanOrEqual(2);
    const far = run(16);
    expect(far.vx).toBeLessThan(-80);
  });

  it('with scent passes 0 there is no scent at all, from construction on, and a chaser feels no slope', () => {
    const cfg = { ...defaultSoftRoamConfig(), size: 32, matter: 700_000, maxCells: 64, startPatches: 3, patchEvery: 1_000_000, mut: 0, planMut: 0, scentIters: 0 };
    const w = new SoftRoamWorld(cfg);
    expect(w.scent.every((v) => v === 0)).toBe(true);
    const plan = restPlan(w);
    spawn(w, 16 * U, 16 * U, CHASER, 150, plan);
    for (let s = 0; s < 250; s++) w.stepOnce();
    expect(w.scent.every((v) => v === 0)).toBe(true);
    // The same world with the field cleared by hand moves a cell exactly the same way.
    const a = new SoftRoamWorld(cfg);
    const b = new SoftRoamWorld(cfg);
    b.scent.fill(0);
    spawn(a, 16 * U, 16 * U, CHASER, 150, restPlan(a));
    spawn(b, 16 * U, 16 * U, CHASER, 150, restPlan(b));
    for (let s = 0; s < 20; s++) { a.stepOnce(); b.stepOnce(); }
    expect(a.digest()).toBe(b.digest());
  });

  it('a symmetric peak gives no slope: a chaser on a lone patch\'s centre is not pushed at all', () => {
    const w = LONE();
    patchAt(w, 32);
    w.advance(1200);
    // A real peak: the centre is higher than every neighbour on the row, and the field is mirrored about it.
    const row = 32 * w.size + 32;
    expect(w.scent[row]).toBeGreaterThan(w.scent[row + 1]);
    expect(w.scent[row + 1]).toBe(w.scent[row - 1]);
    const plan = restPlan(w);
    const c = spawn(w, 32 * U + 512, 32 * U + 512, CHASER, 150, plan);
    w.stepOnce();
    expect(w.vx[c]).toBe(0);
    expect(w.vy[c]).toBe(0);
  });

  it('midway between two equal patches (a saddle: lower than both sides along x, a ridge along y) the chaser is not pushed either way', () => {
    const w = LONE();
    patchAt(w, 20);
    patchAt(w, 44);
    w.advance(1200);
    const row = 32 * w.size + 32;
    // Lower than both sides along x, mirrored; and the column through it is mirrored in y.
    expect(w.scent[row + 1]).toBeGreaterThan(w.scent[row]);
    expect(w.scent[row - 1]).toBe(w.scent[row + 1]);
    expect(w.scent[row + w.size]).toBe(w.scent[row - w.size]);
    const plan = restPlan(w);
    const c = spawn(w, 32 * U + 512, 32 * U + 512, CHASER, 150, plan);
    w.stepOnce();
    expect(w.vx[c]).toBe(0);
    expect(w.vy[c]).toBe(0);
  });

  it('keeps every scent value inside 20 bits and the dials work: more passes catch up faster, more decay reaches less far', () => {
    const at = (iters: number, shift: number, steps: number, dist: number): number => {
      const w = LONE({ scentIters: iters, scentDecayShift: shift });
      patchAt(w, 32);
      w.advance(steps);
      for (let i = 0; i < w.n; i++) expect(w.scent[i]).toBeLessThan(2 ** 20);
      return w.scent[32 * w.size + 32 + dist];
    };
    expect(at(8, 11, 200, 8)).toBeGreaterThan(at(2, 11, 200, 8));
    expect(at(4, 9, 1500, 16) / at(4, 9, 1500, 2)).toBeLessThan(at(4, 11, 1500, 16) / at(4, 11, 1500, 2));
  });

  it('the 20-bit cut is what holds the field there: all the matter of a legal world on one patch, the widest dials, reaches it and stops', () => {
    const w = new SoftRoamWorld({ ...defaultSoftRoamConfig(), size: 8, matter: 1_048_575, maxCells: 16, startPatches: 0, patchEvery: 1_000_000, patchFood: 1_048_575, patchRadius: 3, scentIters: 16, scentDecayShift: 12, mut: 0, planMut: 0 });
    w.food.fill(0);
    // Every unit of matter on the tiles of one radius-3 patch, from the reservoir as `patchFood` does it.
    const each = Math.floor(1_048_575 / 29);
    let put = 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (dx * dx + dy * dy <= 9) { w.food[((4 + dy) & 7) * 8 + ((4 + dx) & 7)] += each; put += each; }
    w.food[4 * 8 + 4] += 1_048_575 - put;
    w.reservoir -= 1_048_575;
    w.advance(200);
    let top = 0;
    for (let i = 0; i < w.n; i++) top = Math.max(top, w.scent[i]);
    expect(top).toBe(2 ** 20 - 1);
    expect(w.census().residual).toBe(0);
  });
});

describe('soft roam kinds: fix round 2', () => {
  it('a tie on both pair draws is settled afresh each step, not by the lower cid for ever', () => {
    // Pairs (249057, 390224) and (390224, 17584017) collide on both symmetric draws at every seed and step.
    const w = new SoftRoamWorld(still());
    const plan = restPlan(w);
    const prey = spawn(w, 4 * U, 4 * U, SITTER, 150, plan);
    const a = spawn(w, 8 * U, 4 * U, SITTER, 150, plan);
    const b = spawn(w, 8 * U, 8 * U, SITTER, 150, plan);
    w.cid[a] = 249057;
    w.cid[prey] = 390224;
    w.cid[b] = 17584017;
    const k = w as unknown as { pairHash(a: number, b: number, ch: number): number; ranksAhead(a: number, b: number, h: number, p: number, hp: number): boolean };
    let aWins = 0;
    for (let s = 0; s < 200; s++) {
      w.step = s;
      const ha = k.pairHash(prey, a, 50);
      expect(k.pairHash(prey, b, 50)).toBe(ha);
      if (k.ranksAhead(prey, a, ha, b, ha)) aWins++;
    }
    expect(aWins).toBeGreaterThan(60);
    expect(aWins).toBeLessThan(140);
  });

  it('the feeding events are listed in cid order whichever slots the cells sit in', () => {
    const run = (perm: readonly number[]): string[] => {
      const w = new SoftRoamWorld(still());
      w._testSlotOrder(perm);
      const plan = restPlan(w);
      const mouths = [hunter(w, plan, 2, 6 * U, 8 * U)[1], chain(w, plan, 6 * U + 2 * 1100, 8 * U, U, 0, [M, P])[0]];
      spawn(w, 6 * U + 1100, 8 * U, SITTER, 150, plan);
      w.stepOnce();
      expect(w.events.feeds.length).toBe(2);
      expect(mouths.length).toBe(2);
      return w.events.feeds.map((f) => `${f.mc},${f.pc}`);
    };
    const fwd = Array.from({ length: 16 }, (_, i) => i);
    const a = run(fwd);
    const b = run(fwd.slice().reverse());
    expect(b).toEqual(a);
    expect(a).toEqual(a.slice().sort((x, y) => Number(x.split(',')[0]) - Number(y.split(',')[0]) || Number(x.split(',')[1]) - Number(y.split(',')[1])));
  });

  it('the hits are listed in cid order whichever slots the cells sit in', () => {
    const run = (perm: readonly number[]): number[] => {
      const w = new SoftRoamWorld(still({ crack: 50 }));
      w._testSlotOrder(perm);
      const plan = restPlan(w);
      // Three shells, each with a mouth beside it, created so that their slots run opposite to their serials.
      const shells: number[] = [];
      for (let k = 0; k < 3; k++) {
        const h = hunter(w, plan, 2, 3 * U + k * 4 * U, 8 * U);
        const sh = spawn(w, 3 * U + k * 4 * U + 1100, 8 * U, SITTER, 150, plan);
        w.kind[sh] = S;
        expect(h.length).toBe(2);
        shells.push(sh);
      }
      const base = 1000;
      shells.forEach((sh, k) => { w.cid[sh] = base + (k === 1 ? 0 : k === 0 ? 2 : 1); });
      w.stepOnce();
      return w.events.hits.map((e) => e.c);
    };
    const fwd = Array.from({ length: 16 }, (_, i) => i);
    const a = run(fwd);
    const b = run(fwd.slice().reverse());
    expect(a).toEqual([1000, 1001, 1002]);
    expect(b).toEqual(a);
  });

  it('a weak lone source (32 food on one tile) still gives a chaser 12 tiles away the full slope toward it, as Roam does', () => {
    const w = new SoftRoamWorld(still({ size: 64, kinds: false, drain: undefined, seal: undefined, flow: 1 / 64 }));
    w.food[32 * w.size + 32] += 32;
    w.reservoir -= 32;
    w.advance(1200);
    const g = (w as unknown as { scentSlope(px: number, py: number, gain: number): Int32Array }).scentSlope((32 + 12) * U + 512, 32 * U + 512, 8);
    // Full slope: 1/8 per tile at gain 8 is already 1024, and Roam reads 1024 here too.
    expect(g[0]).toBe(-1024);
    expect(g[1]).toBe(0);
    const plan = restPlan(w);
    const c = spawn(w, (32 + 12) * U + 512, 32 * U + 512, CHASER, 150, plan);
    w.stepOnce();
    // Pushed toward the source at the full chase thrust (the chase gene is 512 of 512), straight along the row.
    expect(w.vx[c]).toBeLessThan(-200);
    expect(w.vy[c]).toBe(0);
  });

  it('a feed that kills the prey still pulses both mouths in the picture', () => {
    const w = new SoftRoamWorld(still({ drain: 1 }));
    const plan = restPlan(w);
    const left = hunter(w, plan, 2, 6 * U, 8 * U);
    const right = chain(w, plan, 6 * U + 2 * 1100, 8 * U, U, 0, [M, P]);
    const prey = spawn(w, 6 * U + 1100, 8 * U, SITTER, 2, plan);
    const mem = new SoftPaintMemory();
    mem.observe(w);
    w.stepOnce();
    expect(w.events.feeds.length).toBe(2);
    expect(w.alive[prey]).toBe(0);
    mem.observe(w);
    expect(mem.feedT[left[1]]).toBe(1);
    expect(mem.feedT[right[0]]).toBe(1);
  });
});

describe('soft roam kinds: close-out fixes', () => {
  /** The held-out world's private pieces, reached the way the other tests reach them. */
  type Priv = { pairHash(a: number, b: number, ch: number): number; pairTie(a: number, b: number): number; ranksAhead(a: number, b: number, h: number, p: number, hp: number): boolean; sealedCell(c: number): boolean; tx: Int32Array; ty: Int32Array };

  it('a tie on both pair draws is settled by a fresh coin each step, not by the lower cid', () => {
    // Both symmetric pair draws are forced to tie, as they do for two pairs whose keys collide on both (a 2^-32 chance a step, found at seed
    // 2572920988, step 70000, cids 6068 and 57348 against 56617).
    const w = new SoftRoamWorld(still());
    const plan = restPlan(w);
    const prey = spawn(w, 4 * U, 4 * U, SITTER, 150, plan);
    const a = spawn(w, 8 * U, 4 * U, SITTER, 150, plan);
    const b = spawn(w, 8 * U, 8 * U, SITTER, 150, plan);
    w.cid[prey] = 56617;
    w.cid[a] = 6068;
    w.cid[b] = 57348;
    const k = w as unknown as Priv;
    k.pairHash = () => 77;
    k.pairTie = () => 99;
    let aWins = 0;
    for (let s = 0; s < 400; s++) {
      w.step = 70000 + s;
      const ab = k.ranksAhead(prey, a, 77, b, 77);
      const ba = k.ranksAhead(prey, b, 77, a, 77);
      // A strict order: exactly one of the two comes first.
      expect(ab).not.toBe(ba);
      if (ab) aWins++;
    }
    expect(aWins).toBeGreaterThan(140);
    expect(aWins).toBeLessThan(260);
  });

  it('the real draws do collide for those cids at that seed and step (so the case above is not a made-up one)', () => {
    const w = new SoftRoamWorld(still({ seed: 2572920988 }));
    const plan = restPlan(w);
    const prey = spawn(w, 4 * U, 4 * U, SITTER, 150, plan);
    const a = spawn(w, 8 * U, 4 * U, SITTER, 150, plan);
    const b = spawn(w, 8 * U, 8 * U, SITTER, 150, plan);
    w.cid[prey] = 56617;
    w.cid[a] = 6068;
    w.cid[b] = 57348;
    const k = w as unknown as Priv;
    w.step = 70000;
    expect(k.pairHash(prey, a, 50)).toBe(k.pairHash(prey, b, 50));
    expect(k.pairTie(prey, a)).toBe(k.pairTie(prey, b));
    // The next step the second draw already differs.
    w.step = 70001;
    expect(k.pairTie(prey, a)).not.toBe(k.pairTie(prey, b));
  });

  it('a daughter released by division is sealed for exactly `seal` steps, dashing all of them, also across the 2^32 step counter', () => {
    for (const start of [500, 4294967295]) {
      const w = new SoftRoamWorld(still({ seal: 100 }));
      const plan = w.addPlan(Array.from({ length: 16 }, (_, m) => planEntry(m === 0 ? 4 : PLAN_REST, 0, PLAN_REST)));
      const mother = spawn(w, 8 * U + 512, 8 * U + 512, SITTER, 300, plan);
      w.step = start;
      w.stepOnce();
      expect(w.releases).toBe(1);
      expect(w.events.births.length).toBe(1);
      const d = w.events.births[0];
      expect(d).not.toBe(mother);
      expect(w.mother[d]).toBe(-1);
      // First exists at the next step, sealed from then.
      expect(w.since[d]).toBe((start + 1) % 2 ** 32);
      const k = w as unknown as Priv;
      for (let age = 0; age < 105; age++) {
        const sealed = age < 100;
        w.stepOnce();
        expect(w.alive[d]).toBe(1);
        // The dash: a full thrust along the release direction while sealed, none after (the cell has no drive or chase of its own).
        expect(k.tx[d] !== 0 || k.ty[d] !== 0).toBe(sealed);
      }
    }
  });

  it('a lone source of 5 food still gives a chaser 12 tiles away the slope toward it that Roam reads', () => {
    const w = new SoftRoamWorld(still({ size: 64, kinds: false, drain: undefined, seal: undefined, flow: 1 / 64 }));
    w.food[32 * w.size + 32] += 5;
    w.reservoir -= 5;
    w.advance(1200);
    const r = new RoamWorld({ ...defaultRoamConfig(), size: 64, matter: 700_000, startPatches: 0, patchEvery: 1_000_000 });
    r.food[32 * 64 + 32] += 5;
    r.reservoir -= 5;
    r.advance(1200);
    const at = 32 * 64 + 44;
    const se = r.scent[at + 1];
    const sw = r.scent[at - 1];
    const roamSlope = Math.max(-1024, Math.min(1024, Math.trunc(((se - sw) * 1024 * 8) / (se + sw + 1))));
    // Roam does keep a gradient here (1 against 0), the full slope at the default gain.
    expect(roamSlope).toBe(-1024);
    const g = (w as unknown as { scentSlope(px: number, py: number, gain: number): Int32Array }).scentSlope(44 * U + 512, 32 * U + 512, 8);
    expect(g[0]).toBe(roamSlope);
    expect(g[1]).toBe(0);
    const plan = restPlan(w);
    const c = spawn(w, 44 * U + 512, 32 * U + 512, CHASER, 150, plan);
    w.stepOnce();
    expect(w.vx[c]).toBeLessThan(-100);
  });
});
