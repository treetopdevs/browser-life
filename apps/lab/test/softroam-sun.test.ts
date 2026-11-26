import { describe, expect, it } from 'vitest';
import { defaultSoftRoamConfig, KIND_LEAF, KIND_MOUTH, KIND_PLAIN, planEntry, roamHash, SOFT_U, type SoftRoamConfig, SoftRoamWorld, softRoamLight } from '../src/softroam/kernel.ts';
import { foundSoftRoam } from '../src/softroam/view.ts';

/**
 * Soft Roam chunk 2, section B: the sun (day, year, winter, `softRoamLight`, `patchSun`) and the leaf cell (income through bare sides, shared
 * per tile, paid from the reservoir). Small hand-built worlds in which nothing moves unless a test says so, then long runs with everything on.
 *
 * In the worlds below size is 16 and `day` is 2^20 unless a test says otherwise, so for the first thousand steps the sun stands still:
 * tile column 8 is at noon (light 256), column 6 at 128, column 0 in the dark.
 */

const U = SOFT_U;
const P = KIND_PLAIN;
const L = KIND_LEAF;
const NOON = 8;
const HALF_LIGHT = 6;
const DARK = 0;

const base = (over: Partial<SoftRoamConfig> = {}): SoftRoamConfig => ({
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
  day: 1 << 20,
  leaf: 1,
  ...over,
});

const restPlan = (w: SoftRoamWorld): number => w.addPlan(Array.from({ length: 16 }, (_, m) => planEntry(8, 0, m)));

type Priv = { tx: Int32Array; ty: Int32Array; copyPlan(c: number, rate: number): number; step: number };
const priv = (w: SoftRoamWorld): Priv => w as unknown as Priv;

/** Put a cell anywhere, with no spacing rule (reaches the kernel's private allocate and place). A one-cell body of its own. */
function spawn(w: SoftRoamWorld, px: number, py: number, genes: readonly number[], store: number, plan: number, kind = P): number {
  const a = w as unknown as { allocate(): number; place(c: number, x: number, y: number, g: readonly number[], f: number, s: number, p: number): void; labelHi: number };
  const c = a.allocate();
  a.place(c, px, py, genes, 0, store, plan);
  w.kind[c] = kind;
  w.reservoir -= store;
  w.heading[c] = 0;
  w.orient[c] = 0;
  w.mother[c] = -1;
  w.body[c] = ++a.labelHi;
  w.bodySize[w.body[c]] = 1;
  w.bodyCount++;
  return c;
}

const SITTER = [0, 0, -512, 0, 0];
/** Drive 512 along the heading (heading 0 gives a full unit of thrust). */
const DRIVER = [0, 512, -512, 0, 0];
/** The centre of a tile in units. */
const mid = (tile: number): number => tile * U + U / 2;

/** One leaf alone on a tile column at its centre (row 8), with a rest plan. */
function lone(over: Partial<SoftRoamConfig>, column: number, store = 10, genes: readonly number[] = SITTER, kind = L): { w: SoftRoamWorld; c: number } {
  const w = new SoftRoamWorld(base(over));
  const plan = restPlan(w);
  const c = spawn(w, mid(column), mid(8), genes, store, plan, kind);
  return { w, c };
}

describe('soft roam sun: the light function', () => {
  it('sweeps a lit band round the world once a day (hand-worked, size 16, day 64)', () => {
    const cfg = { size: 16, day: 64 };
    // t = 0: phase 0; the band is centred on column 8 and is half the world wide (columns 5 to 11).
    expect([0, 4, 6, 8, 10, 12, 15].map((tx) => softRoamLight(cfg, tx, 0, 0))).toEqual([0, 0, 128, 256, 128, 0, 0]);
    // A quarter day later (16 steps) it has moved four columns east and the old noon is dark.
    expect([4, 8, 10, 12, 14].map((tx) => softRoamLight(cfg, tx, 0, 16))).toEqual([0, 0, 128, 256, 128]);
    // Half a day: noon on the far side of the torus, night where it was.
    expect(softRoamLight(cfg, 0, 3, 32)).toBe(256);
    expect(softRoamLight(cfg, 8, 3, 32)).toBe(0);
    // A day later everything is as it was; the row does not matter.
    for (let tx = 0; tx < 16; tx++) expect(softRoamLight(cfg, tx, 5, 64 + 7)).toBe(softRoamLight(cfg, tx, 0, 7));
    // Half the columns are in the dark at any moment.
    for (const t of [0, 5, 31, 50]) {
      let dark = 0;
      for (let tx = 0; tx < 16; tx++) if (softRoamLight(cfg, tx, 0, t) === 0) dark++;
      expect(dark).toBeGreaterThanOrEqual(7);
    }
  });

  it('dims in winter and peaks at midsummer', () => {
    const cfg = { size: 16, day: 64, year: 1024, winter: 0.25 };
    // Noon on column 8 whenever t is a whole number of days (64 divides 1024).
    expect(softRoamLight(cfg, 8, 0, 0)).toBe(64); // deepest winter: a quarter
    expect(softRoamLight(cfg, 8, 0, 256)).toBe(160); // spring: 64 + (192 * 128 >> 8) = 160, light = 256 * 160 >> 8
    expect(softRoamLight(cfg, 8, 0, 512)).toBe(256); // midsummer
    expect(softRoamLight(cfg, 8, 0, 768)).toBe(160);
    expect(softRoamLight(cfg, 8, 0, 1024)).toBe(64);
    // Winter 0 goes dark; winter 1 has no seasons; the default is a quarter.
    expect(softRoamLight({ ...cfg, winter: 0 }, 8, 0, 0)).toBe(0);
    expect(softRoamLight({ ...cfg, winter: 1 }, 8, 0, 0)).toBe(256);
    expect(softRoamLight({ size: 16, day: 64, year: 1024 }, 8, 0, 0)).toBe(64);
  });

  it('is 256 without a day, and never outside 0..256 or non-integer', () => {
    expect(softRoamLight({ size: 16 }, 3, 3, 12345)).toBe(256);
    expect(softRoamLight({ size: 16, year: undefined }, 0, 0, 0)).toBe(256);
    let max = 0;
    for (const cfg of [{ size: 16, day: 16 }, { size: 64, day: 1000, year: 7000, winter: 0.1 }, { size: 48, day: 333, year: 1 << 24, winter: 0 }]) {
      for (let t = 0; t < 4000; t += 7) {
        for (let tx = 0; tx < cfg.size; tx += 3) {
          const v = softRoamLight(cfg, tx, 0, t);
          expect(Number.isInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(256);
          if (v > max) max = v;
        }
      }
    }
    expect(max).toBe(256);
  });

  it('is right at the end of the longest year (year 2^24, t % year = year - 1)', () => {
    const cfg = { size: 16, day: 64, year: 1 << 24, winter: 0.25 };
    // Day phase 1008, year phase 1023: dp = (512 - 1008) & 1023 = 528, tri 248, dayL 240; season floor 64: 240 * 64 >> 8 = 60.
    expect(softRoamLight(cfg, 8, 0, (1 << 24) - 1)).toBe(60);
    // And a whole year later it is deepest winter again, at the start of a day.
    expect(softRoamLight(cfg, 8, 0, 1 << 24)).toBe(64);
  });

  it('agrees with a plain reference over many days, years, columns and steps', () => {
    const tri = (p: number): number => (p < 512 ? Math.floor(p / 2) : Math.floor((1024 - p) / 2));
    const ph = (t: number, period: number): number => Math.floor(((t % period) * 1024) / period);
    const ref = (c: { size: number; day: number; year?: number; winter?: number }, tx: number, t: number): number => {
      const dp = (Math.floor((tx * 1024) / c.size) - ph(t, c.day)) & 1023;
      const dayL = Math.min(256, Math.max(0, 2 * tri(dp) - 256));
      const w = Math.round((c.winter ?? 0.25) * 256);
      const season = c.year === undefined ? 256 : w + Math.floor(((256 - w) * tri(ph(t, c.year))) / 256);
      return Math.floor((dayL * season) / 256);
    };
    let n = 0;
    for (const day of [16, 17, 100, 999, 1 << 20]) {
      for (const year of [undefined, day, 3 * day + 1, 1 << 24]) {
        const cfg = { size: 40, day, year, winter: 0.3 };
        for (let i = 0; i < 400; i++) {
          const t = roamHash(7, i, day, 1) % (1 << 25);
          const tx = roamHash(8, i, day, 1) % 40;
          expect(softRoamLight(cfg, tx, 0, t)).toBe(ref(cfg, tx, t));
          n++;
        }
      }
    }
    expect(n).toBe(5 * 4 * 400);
  });

  it('is also a world method', () => {
    const w = new SoftRoamWorld(base({ day: 64, year: 1024 }));
    expect(w.light(8, 2, 0)).toBe(softRoamLight(w.cfg, 8, 2, 0));
    expect(w.light(8, 2)).toBe(64);
  });
});

describe('soft roam sun: config', () => {
  it('year and patchSun need day, winter needs year, leaf needs day and kinds', () => {
    const noDay = (over: Partial<SoftRoamConfig>): SoftRoamConfig => base({ day: undefined, leaf: undefined, ...over });
    expect(() => new SoftRoamWorld(noDay({ year: 1000 }))).toThrow(/day/);
    expect(() => new SoftRoamWorld(noDay({ patchSun: true }))).toThrow(/day/);
    expect(() => new SoftRoamWorld(noDay({ leaf: 1 }))).toThrow(/day/);
    expect(() => new SoftRoamWorld(base({ winter: 0.5 }))).toThrow(/year/);
    expect(() => new SoftRoamWorld(base({ kinds: undefined }))).toThrow(/kinds/);
    expect(() => new SoftRoamWorld(base({ day: 8 }))).toThrow();
    expect(() => new SoftRoamWorld(base({ day: 1 << 21 }))).toThrow();
    expect(() => new SoftRoamWorld(base({ day: 64, year: 32 }))).toThrow();
    expect(() => new SoftRoamWorld(base({ year: (1 << 24) + 1 }))).toThrow();
    expect(() => new SoftRoamWorld(base({ year: 1 << 22, winter: 1.5 }))).toThrow();
    expect(() => new SoftRoamWorld(base({ leaf: 5 }))).toThrow();
    expect(() => new SoftRoamWorld(base({ leaf: -1 }))).toThrow();
    expect(() => new SoftRoamWorld(base({ patchSun: 1 as unknown as boolean }))).toThrow();
    expect(() => new SoftRoamWorld(base({ year: 1 << 24, winter: 0, patchSun: true, leaf: 4 }))).not.toThrow();
    expect(() => new SoftRoamWorld(noDay({ patchSun: false }))).toThrow(/day/); // supplied at all, it needs day (the contract's key check)
  });

  it('no key is in the default config', () => {
    const d = defaultSoftRoamConfig() as unknown as Record<string, unknown>;
    for (const k of ['day', 'year', 'winter', 'patchSun', 'leaf']) expect(k in d).toBe(false);
  });
});

describe('soft roam leaves: income', () => {
  it('a leaf in full light earns `leaf` a step (leaf 1 is exact), and leaf 0.3 earns that on average over many seeds', () => {
    const { w, c } = lone({ leaf: 1 }, NOON, 10);
    expect(w.light(NOON, 8, 0)).toBe(256);
    w.advance(40);
    expect(w.store[c]).toBe(50);
    expect(w.census().leafIncome).toBe(40);
    let income = 0;
    const seeds = 40;
    const steps = 100;
    for (let seed = 1; seed <= seeds; seed++) {
      const t = lone({ leaf: 0.3, seed }, NOON, 10);
      t.w.advance(steps);
      expect(t.w.light(NOON, 8, steps - 1)).toBe(256);
      income += t.w.census().leafIncome;
    }
    const expected = 0.3 * seeds * steps;
    expect(Math.abs(income - expected)).toBeLessThan(0.06 * expected);
  });

  it('a leaf in the dark earns nothing', () => {
    const { w, c } = lone({ leaf: 4 }, DARK, 10);
    expect(w.light(DARK, 8, 0)).toBe(0);
    w.advance(100);
    expect(w.store[c]).toBe(10);
    expect(w.census().leafIncome).toBe(0);
  });

  it('a leaf buried in its body earns nothing, and bare sides earn in proportion', () => {
    const w = new SoftRoamWorld(base({ leaf: 4 }));
    const plan = restPlan(w);
    // A 3 by 3 block of leaves in columns 7 to 9, one cell a daughter of the one before it in snake order.
    const order: [number, number][] = [[0, 0], [1, 0], [2, 0], [2, 1], [1, 1], [0, 1], [0, 2], [1, 2], [2, 2]];
    const cells: number[] = [];
    for (let i = 0; i < order.length; i++) {
      const [gx, gy] = order[i];
      const c = spawn(w, mid(7 + gx), mid(7 + gy), SITTER, 10, plan, L);
      w.gx[c] = gx;
      w.gy[c] = gy;
      if (i > 0) {
        w.mother[c] = cells[i - 1];
        w.body[c] = w.body[cells[0]];
        w.bodySize[w.body[c]]++;
        w.bodyCount--;
      }
      cells.push(c);
    }
    const at = (gx: number, gy: number): number => cells[order.findIndex(([a, b]) => a === gx && b === gy)];
    w.advance(60);
    expect(w.bodySizes()).toEqual([9]);
    expect(w.store[at(1, 1)]).toBe(10); // four neighbours: exposed 0
    expect(w.store[at(1, 0)]).toBeGreaterThan(10); // three neighbours: one bare side
    expect(w.store[at(0, 0)]).toBeGreaterThan(w.store[at(1, 0)]); // two neighbours: two bare sides (corner)
    expect(w.census().residual).toBe(0);
  });

  it('two leaves on one tile each earn half what one alone does (leaf 1, light 128: a floor after rounding would give 0)', () => {
    expect(softRoamLight(base(), HALF_LIGHT, 0, 0)).toBe(128);
    const seeds = 400;
    let alone = 0;
    let paired = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      const a = lone({ leaf: 1, seed }, HALF_LIGHT, 10);
      a.w.stepOnce();
      alone += a.w.store[a.c] - 10;
      const w = new SoftRoamWorld(base({ leaf: 1, seed }));
      const plan = restPlan(w);
      const c1 = spawn(w, HALF_LIGHT * U + 440, mid(8), SITTER, 10, plan, L);
      const c2 = spawn(w, HALF_LIGHT * U + 584, mid(8), SITTER, 10, plan, L);
      w.stepOnce();
      expect(w.x[c1] >>> 10).toBe(HALF_LIGHT);
      expect(w.x[c2] >>> 10).toBe(HALF_LIGHT);
      paired += w.store[c1] - 10 + (w.store[c2] - 10);
    }
    // One leaf alone: 0.5 a step. Two on a tile: 0.25 each, 0.5 between them.
    expect(Math.abs(alone - 0.5 * seeds)).toBeLessThan(0.2 * 0.5 * seeds);
    expect(Math.abs(paired - 0.5 * seeds)).toBeLessThan(0.2 * 0.5 * seeds);
    expect(paired).toBeGreaterThan(0);
  });

  it('256 or 257 leaves on one tile share its light by at most 16 (the count does not wrap): no NaN, no unshared payout, residual 0', () => {
    for (const [column, count] of [[DARK, 256], [NOON, 256], [NOON, 257], [DARK, 512]] as const) {
      const w = new SoftRoamWorld(base({ leaf: 1, maxCells: 600, matter: 700_000 }));
      const plan = restPlan(w);
      for (let i = 0; i < count; i++) spawn(w, mid(column) + (i % 7) - 3, mid(8) + (i % 5) - 2, SITTER, 10, plan, L);
      (w as unknown as { rebuildLive(): void }).rebuildLive();
      (w as unknown as { leafStage(cap4: number): void }).leafStage(4 * defaultSoftRoamConfig().birthStore);
      const c = w.census();
      expect(Number.isFinite(c.reservoir)).toBe(true);
      expect(c.residual).toBe(0);
      // Sixteen leaves share a tile's light: one unit a step in all at leaf 1 and full light (a loose bound, never the full-light 256 each).
      expect(c.leafIncome).toBeLessThanOrEqual(column === DARK ? 0 : 40);
    }
  });

  it('a leaf at its store cap earns nothing, and one near it takes only what fits', () => {
    const cap = 4 * defaultSoftRoamConfig().birthStore;
    const full = lone({ leaf: 4 }, NOON, cap);
    full.w.advance(20);
    expect(full.w.store[full.c]).toBe(cap);
    expect(full.w.census().leafIncome).toBe(0);
    const near = lone({ leaf: 4 }, NOON, cap - 2);
    near.w.advance(20);
    expect(near.w.store[near.c]).toBe(cap);
    expect(near.w.census().leafIncome).toBe(2);
  });

  /** Two leaves in one column at noon (light 256), asking 4 each, against a reservoir holding exactly `reservoir`. */
  function squeezed(reservoir: number, order?: readonly number[], store = 10): { w: SoftRoamWorld; cells: number[] } {
    const w = new SoftRoamWorld(base({ leaf: 4, matter: 2 * store + reservoir, patchFood: 1 }));
    if (order) w._testSlotOrder(order);
    const plan = restPlan(w);
    const cells = [spawn(w, mid(NOON), mid(4), SITTER, store, plan, L), spawn(w, mid(NOON), mid(12), SITTER, store, plan, L)];
    expect(w.reservoir).toBe(reservoir);
    return { w, cells };
  }

  it('a short reservoir is shared in proportion and never overdrawn; the result does not depend on slot order', () => {
    // Two asks of 4 against 3: each gets floor(4 * 3 / 8) = 1, so 2 are paid and 1 stays (the contract's sentence says 3 in all; its formula says 2).
    const a = squeezed(3);
    a.w.stepOnce();
    const c = a.w.census();
    expect(c.leafIncome).toBe(2);
    expect(a.w.store[a.cells[0]]).toBe(11);
    expect(a.w.store[a.cells[1]]).toBe(11);
    expect(c.reservoir).toBe(1);
    expect(c.residual).toBe(0);
    // Whatever it is short by, the total paid never passes what the reservoir held.
    for (const r of [0, 1, 2, 3, 5, 7, 8, 9, 40]) {
      const s = squeezed(r);
      s.w.stepOnce();
      const paid = s.w.census().leafIncome;
      expect(paid).toBeLessThanOrEqual(r);
      expect(paid).toBeLessThanOrEqual(8);
      expect(s.w.census().reservoir).toBe(r - paid);
      expect(s.w.census().residual).toBe(0);
    }
    // Enough for both: each gets its ask in full.
    const rich = squeezed(8);
    rich.w.stepOnce();
    expect(rich.w.census().leafIncome).toBe(8);
    // An empty reservoir pays nothing.
    const dry = squeezed(0);
    dry.w.advance(5);
    expect(dry.w.census().leafIncome).toBe(0);
    // Slot order changes nothing: the same cids end with the same stores.
    const b = squeezed(3, [40, 7, 33, 2]);
    b.w.stepOnce();
    const byCid = (s: { w: SoftRoamWorld; cells: number[] }): number[] => s.cells.map((x) => s.w.store[x]);
    expect(byCid(b)).toEqual(byCid(a));
    expect(b.w.digest()).toBe(a.w.digest());
  });

  it('with leaf 0 leaves earn nothing but kind 3 stays legal in plans, and the census counts them', () => {
    const w = new SoftRoamWorld(base({ leaf: 0 }));
    expect(() => w.addPlan(Array.from({ length: 16 }, (_, m) => planEntry(8, 0, m, L)))).not.toThrow();
    const plan = restPlan(w);
    const c = spawn(w, mid(NOON), mid(8), SITTER, 10, plan, L);
    w.advance(50);
    expect(w.store[c]).toBe(10);
    expect(w.census().leaves).toBe(1);
    expect(w.census().leafIncome).toBe(0);
  });

  it('a leaf is fed on like a plain cell', () => {
    const run = (preyKind: number): number => {
      const w = new SoftRoamWorld(base({ leaf: 0, drain: 3, seal: 0 }));
      const plan = restPlan(w);
      const mouthBody = [spawn(w, mid(3), mid(8), SITTER, 150, plan), spawn(w, mid(3) + U, mid(8), SITTER, 150, plan)];
      // One body of three mouth-led cells against a lone prey cell of the given kind.
      w.mother[mouthBody[1]] = mouthBody[0];
      w.body[mouthBody[1]] = w.body[mouthBody[0]];
      w.bodySize[w.body[mouthBody[1]]]++;
      w.gx[mouthBody[1]] = 1;
      w.kind[mouthBody[1]] = KIND_MOUTH;
      const prey = spawn(w, mid(3) + 2 * U + 200, mid(8), SITTER, 150, plan, preyKind);
      w.advance(5);
      return w.drained + 1000 * (w.store[prey] < 150 ? 1 : 0);
    };
    expect(run(L)).toBe(run(P));
    expect(run(L)).toBeGreaterThan(1000);
  });
});

describe('soft roam leaves: no eating, no thrust', () => {
  it('a leaf never eats ground food, even as a one-cell body, while a plain cell does', () => {
    const grow = (kind: number): number => {
      const { w, c } = lone({ leaf: 0 }, NOON, 10, SITTER, kind);
      const tile = 8 * 16 + NOON;
      w.food[tile] = 60;
      w.reservoir -= 60;
      w.advance(10);
      return w.store[c];
    };
    expect(grow(P)).toBeGreaterThan(10);
    expect(grow(L)).toBe(10);
  });

  it('an unsealed leaf never thrusts and pays no move cost; a plain cell with the same genes does', () => {
    const plain = lone({ leaf: 1, moveCost: 1 }, NOON, 20, DRIVER, P);
    plain.w._commandsOnly();
    expect(priv(plain.w).tx[plain.c]).toBe(1024);
    expect(plain.w.store[plain.c]).toBe(19);
    const leaf = lone({ leaf: 1, moveCost: 1 }, NOON, 20, DRIVER, L);
    leaf.w._commandsOnly();
    expect(priv(leaf.w).tx[leaf.c]).toBe(0);
    expect(priv(leaf.w).ty[leaf.c]).toBe(0);
    expect(leaf.w.store[leaf.c]).toBe(20);
    // Over a run it keeps its place (no velocity but what springs give it, and it has none).
    leaf.w.advance(30);
    expect(leaf.w.x[leaf.c]).toBe(mid(NOON));
    expect(leaf.w.census().residual).toBe(0);
  });

  it('a leaf in a sealed body thrusts at full along the release direction and pays as any sealed cell does', () => {
    const cfg = { leaf: 1, moveCost: 1, drain: 3, seal: 100 };
    const plain = lone(cfg, NOON, 20, DRIVER, P);
    const leaf = lone(cfg, NOON, 20, DRIVER, L);
    plain.w._commandsOnly();
    leaf.w._commandsOnly();
    expect(priv(leaf.w).tx[leaf.c]).toBe(1024);
    expect(priv(leaf.w).tx[leaf.c]).toBe(priv(plain.w).tx[plain.c]);
    expect(priv(leaf.w).ty[leaf.c]).toBe(priv(plain.w).ty[plain.c]);
    expect(leaf.w.store[leaf.c]).toBe(19);
    expect(leaf.w.store[leaf.c]).toBe(plain.w.store[plain.c]);
    expect(leaf.w.reservoir).toBe(plain.w.reservoir);
    // Once the seal runs out it stops.
    const short = lone({ leaf: 1, moveCost: 0, drain: 3, seal: 5 }, NOON, 20, DRIVER, L);
    short.w._commandsOnly();
    expect(priv(short.w).tx[short.c]).toBe(1024);
    short.w.advance(8);
    short.w._commandsOnly();
    expect(short.w.census().leaves).toBe(1);
    expect(priv(short.w).tx[short.c]).toBe(0);
  });
});

describe('soft roam sun: plans and mutation', () => {
  const leafPlan = Array.from({ length: 16 }, (_, m) => planEntry(8, 0, m, L));

  it('kind 3 is refused without leaf and accepted with it (also with toughness off at the 0x3fff ceiling)', () => {
    const none = new SoftRoamWorld(base({ leaf: undefined, day: undefined }));
    expect(() => none.addPlan(leafPlan)).toThrow();
    const day = new SoftRoamWorld(base({ leaf: undefined }));
    expect(() => day.addPlan(leafPlan)).toThrow();
    const on = new SoftRoamWorld(base());
    const id = on.addPlan(leafPlan);
    expect(id).toBeGreaterThan(0);
    expect(() => on.addPlan(Array.from({ length: 16 }, (_, m) => planEntry(8, 0, m, 3, 1)))).toThrow(); // toughness bits stay out when toughness is off
  });

  it('the kind of a copy error is never 3 without leaf, and with leaf it always changes the kind', () => {
    const entries = Array.from({ length: 16 }, (_, m) => planEntry(8, 0, m, m % 3 === 0 ? P : m % 3 === 1 ? 1 : KIND_MOUTH));
    const seen = new Set<number>();
    for (const leaf of [undefined, 1]) {
      const w = new SoftRoamWorld(base({ leaf, drain: 3 }));
      const plan = w.addPlan(entries);
      const c = spawn(w, mid(NOON), mid(8), SITTER, 10, plan);
      let kindChanges = 0;
      let field3 = 0;
      for (let t = 0; t < 1500; t++) {
        priv(w).step = t;
        const id = priv(w).copyPlan(c, 65536 + 1);
        const was = w.plans[plan];
        const now = w.plans[id];
        expect(id).not.toBe(plan);
        const changed: number[] = [];
        for (let m = 0; m < 16; m++) if (was[m] !== now[m]) changed.push(m);
        expect(changed.length).toBe(1);
        const m = changed[0];
        for (let k = 0; k < 16; k++) {
          const kind = (now[k] >>> 12) & 3;
          if (leaf === undefined) expect(kind).toBeLessThanOrEqual(KIND_MOUTH);
          else seen.add(kind);
        }
        const field = roamHash(base().seed, t, w.cid[c], 32) % 4;
        if (field === 3) {
          field3++;
          expect((now[m] >>> 12) & 3).not.toBe((was[m] >>> 12) & 3);
          kindChanges++;
        }
      }
      expect(field3).toBeGreaterThan(200);
      expect(kindChanges).toBe(field3);
    }
    expect(seen.has(3)).toBe(true);
  });

  it('with no leaf key the kind of a copy error is drawn exactly as before', () => {
    const w = new SoftRoamWorld(base({ leaf: undefined, day: undefined }));
    const entries = Array.from({ length: 16 }, (_, m) => planEntry(8, 0, m, m % 3));
    const plan = w.addPlan(entries);
    const c = spawn(w, mid(NOON), mid(8), SITTER, 10, plan);
    for (let t = 0; t < 400; t++) {
      priv(w).step = t;
      const id = priv(w).copyPlan(c, 65536 + 1);
      const was = w.plans[plan];
      const now = w.plans[id];
      for (let m = 0; m < 16; m++) {
        if (was[m] === now[m]) continue;
        const field = roamHash(base().seed, t, w.cid[c], 32) % 4;
        if (field === 3) {
          const h = roamHash(base().seed, t, w.cid[c], 31);
          expect((now[m] >>> 12) & 3).toBe((((was[m] >>> 12) & 3) + 1 + (h % 2)) % 3);
        }
      }
    }
  });
});

describe('soft roam sun: patches follow the light', () => {
  const dark = (over: Partial<SoftRoamConfig> = {}): SoftRoamConfig => base({ leaf: undefined, day: 64, patchEvery: 20, patchFood: 50, patchRadius: 1, ...over });

  it('patchSun skips scheduled patches in the dark and the reservoir keeps the matter', () => {
    const steps = 2000;
    const scheduled = Math.floor((steps - 1) / 20);
    const free = new SoftRoamWorld(dark());
    free.advance(steps);
    expect(free.census().patches).toBe(scheduled);
    const sun = new SoftRoamWorld(dark({ patchSun: true }));
    sun.advance(steps);
    const c = sun.census();
    expect(c.patches + sun.patchesSkipped).toBe(scheduled);
    expect(sun.patchesSkipped).toBeGreaterThan(scheduled / 5);
    expect(c.patches).toBeGreaterThan(scheduled / 5);
    expect(c.reservoir).toBe(700_000 - 50 * c.patches);
    expect(c.residual).toBe(0);
    // The ones that did land fell where there was light: replaying the draws says so.
    let landed = 0;
    for (let t = 20; t < steps; t += 20) {
      const rnd = roamHash(sun.cfg.seed, t, 0, 1);
      const cx = rnd % 16;
      const cy = (rnd >>> 16) % 16;
      if ((roamHash(sun.cfg.seed, t, cy * 16 + cx, 65) & 255) < softRoamLight(sun.cfg, cx, cy, t)) landed++;
    }
    expect(landed).toBe(c.patches);
  });

  it('patchSun leaves the start patches alone', () => {
    const w = new SoftRoamWorld(dark({ patchSun: true, startPatches: 12 }));
    expect(w.census().patches).toBe(12);
    expect(w.patchesSkipped).toBe(0);
    const plain = new SoftRoamWorld(dark({ startPatches: 12 }));
    // The same start whether or not the sun gates later patches.
    expect(Array.from(w.food)).toEqual(Array.from(plain.food));
  });

  it('a year with no patchSun changes nothing about when patches fall', () => {
    const a = new SoftRoamWorld(dark());
    const b = new SoftRoamWorld(dark({ year: 640, winter: 0.5 }));
    a.advance(500);
    b.advance(500);
    expect(b.census().patches).toBe(a.census().patches);
    expect(Array.from(b.food)).toEqual(Array.from(a.food));
  });
});

describe('soft roam sun: the digest', () => {
  it('leaf income enters the digest only with leaf set, and a world without the keys digests as it always did', () => {
    const w = new SoftRoamWorld(base({ leaf: undefined, day: undefined }));
    w.advance(3);
    const d = w.digest();
    w.leafIncome = 12345;
    expect(w.digest()).toBe(d);
    const v = new SoftRoamWorld(base());
    v.advance(3);
    const e = v.digest();
    v.leafIncome = 12345;
    expect(v.digest()).not.toBe(e);
  });
});

describe('soft roam sun: long runs', () => {
  for (const seed of [1, 2]) {
    it(`residual 0 and every invariant over 3000 steps on seed ${seed} with everything on`, () => {
      const w = foundSoftRoam({
        seed,
        size: 64,
        start: 'garden',
        overrides: { day: 300, year: 1500, winter: 0.25, patchSun: true, leaf: 1, truce: true, jaws: true, sight: 5, fear: 4, releaseMin: 3, releaseGap: 20, planMut: 0.05 },
      });
      // A few leaf bushes besides the garden's founders: a leaf cell that grows leaf daughters, one a side.
      const bush = w.addPlan(Array.from({ length: 16 }, (_, m) => (m < 3 ? planEntry(m, m + 1, m + 1, L) : planEntry(8, 0, m, L))));
      let founded = 0;
      for (let k = 0; k < 40 && founded < 8; k++) {
        const c = w.found((roamHash(seed, 0, k, 77) % 64) * U, (roamHash(seed, 0, k, 78) % 64) * U, [0, 0, 0, 0, 0], 99, 2 * w.cfg.birthStore - 1, bush);
        if (c >= 0) { w.kind[c] = L; founded++; }
      }
      expect(founded).toBeGreaterThan(0);
      let seenLeaves = 0;
      for (let s = 0; s < 3000; s++) {
        w.stepOnce();
        if (s % 50 === 49) {
          const c = w.census();
          expect(c.residual).toBe(0);
          seenLeaves += c.leaves;
          w.checkInvariants();
        }
      }
      const c = w.census();
      expect(c.residual).toBe(0);
      expect(c.alarmBonds).toBe(0);
      expect(c.cells).toBeGreaterThan(0);
      expect(seenLeaves).toBeGreaterThan(0);
      expect(c.leafIncome).toBeGreaterThan(0);
      expect(w.patchesSkipped).toBeGreaterThan(0);
    });
  }
});
