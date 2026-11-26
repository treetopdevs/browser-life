import { describe, expect, it } from 'vitest';
import { defaultSoftRoamConfig, KIND_LEAF, KIND_MOUTH, KIND_PLAIN, KIND_SHELL, planEntry, SOFT_U, type SoftRoamConfig, SoftRoamWorld } from '../src/softroam/kernel.ts';
import { foundSoftRoam } from '../src/softroam/view.ts';

/**
 * Soft Roam chunk 3 (CONTRACT-3.md): heal (braces hold a body together), steer (one aim per body), pack (mouths in touch open bigger
 * bodies; a standoff when both could), crowd (a seeing mouth avoids prey other hunters are at), the leaf pool, a season-scaled patch and
 * a winter cost. Small hand-built worlds where nothing moves unless a test says so, then runs with everything on.
 */

const U = SOFT_U;
const genesOf = (chase: number, drive = 0): number[] => [chase, drive, -512, 0, 0];
const SITTER = genesOf(0);
const CHASER = genesOf(512);
const P = KIND_PLAIN;
const M = KIND_MOUTH;

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

const restPlan = (w: SoftRoamWorld): number => w.addPlan(Array.from({ length: 16 }, (_, m) => planEntry(8, 0, m)));

type Priv = {
  tx: Int32Array;
  ty: Int32Array;
  bodyAimT: Int32Array;
  canAct(x: number, y: number): boolean;
  labelBodies(): void;
  markMouths(): void;
  rebuildLive(): void;
  _reverseScan: boolean;
};
const priv = (w: SoftRoamWorld): Priv => w as unknown as Priv;

function spawn(w: SoftRoamWorld, px: number, py: number, genes: readonly number[], store: number, plan: number, kind = P): number {
  const a = w as unknown as { allocate(): number; place(c: number, x: number, y: number, g: readonly number[], f: number, s: number, p: number): void; labelHi: number };
  const c = a.allocate();
  a.place(c, px, py, genes, 0, store, plan);
  w.reservoir -= store;
  w.heading[c] = 0;
  w.orient[c] = 0;
  w.mother[c] = -1;
  w.kind[c] = kind;
  w.body[c] = ++a.labelHi;
  w.bodySize[w.body[c]] = 1;
  w.bodyCount++;
  return c;
}
/** Make `c` the kept daughter of `m` at lattice place (gx, gy). */
function link(w: SoftRoamWorld, c: number, m: number, gx: number, gy: number): void {
  w.bodySize[w.body[c]]--;
  w.bodyCount--;
  w.mother[c] = m;
  w.body[c] = w.body[m];
  w.bodySize[w.body[m]]++;
  w.gx[c] = gx;
  w.gy[c] = gy;
}
/** A row of cells along +x from (x, y), each the daughter of the one before. */
function row(w: SoftRoamWorld, plan: number, x: number, y: number, kinds: readonly number[], genes: readonly number[] = SITTER, store = 150): number[] {
  const out: number[] = [];
  for (let i = 0; i < kinds.length; i++) {
    const c = spawn(w, x + i * U, y, genes, store, plan, kinds[i]);
    if (i > 0) link(w, c, out[i - 1], i, 0);
    out.push(c);
  }
  return out;
}
const kill = (w: SoftRoamWorld, c: number): void => { w.reservoir += w.store[c]; w.store[c] = 0; };

describe('soft roam chunk 3: config checks', () => {
  it('refuses keys without what they need', () => {
    const make = (o: Partial<SoftRoamConfig>) => () => new SoftRoamWorld(still(o));
    expect(make({ steer: true })).toThrow(/steer needs sight or fear/);
    expect(make({ kinds: undefined, drain: undefined, seal: undefined, pack: 2 })).toThrow(/pack needs kinds and drain/);
    expect(make({ pack: 0 })).toThrow(/Invalid pack/);
    expect(make({ pack: 17 })).toThrow(/Invalid pack/);
    expect(make({ crowd: 1 })).toThrow(/crowd needs sight/);
    expect(make({ sight: 4, crowd: 5 })).toThrow(/Invalid crowd/);
    expect(make({ leafPool: 0.5 })).toThrow(/leafPool needs leaf/);
    expect(make({ day: 400, leaf: 1, leafPool: 1.5 })).toThrow(/Invalid leafPool/);
    expect(make({ day: 400, leaf: 1, leafPoolMax: 10 })).toThrow(/leafPoolMax needs leafPool/);
    expect(make({ patchSeason: true, day: 400 })).toThrow(/patchSeason needs year/);
    expect(make({ winterCost: 0.5, day: 400 })).toThrow(/winterCost needs year/);
    expect(make({ heal: 1 as unknown as boolean })).toThrow(/heal is true or false/);
  });
});

describe('soft roam chunk 3: heal', () => {
  /** A line of three grown by plan (so the third cell is braced to the first, two lattice steps away), then the middle cell dies. */
  function line(heal: boolean) {
    const w = new SoftRoamWorld(still({ heal: heal || undefined, birthStore: 50 }));
    // Mode 0 keeps a daughter straight on in mode 1 and rests; mode 1 does the same into a resting mode.
    const plan = w.addPlan(Array.from({ length: 16 }, (_, m) => (m === 0 ? planEntry(0, 1, 15) : m === 1 ? planEntry(0, 15, 15) : planEntry(8, 0, m))));
    const a = w.found(8 * U, 8 * U, SITTER, 1, 400, plan);
    for (let t = 0; t < 4 && w.census().cells < 3; t++) w.stepOnce();
    expect(w.census().cells).toBe(3);
    const cells = [...Array(w.cap).keys()].filter((c) => w.alive[c]).sort((p, q) => w.cid[p] - w.cid[q]);
    const [, b, c] = cells;
    expect(cells[0]).toBe(a);
    // The tip is braced to the first cell.
    expect([0, 1, 2, 3].some((k) => w.braceTo[c * 4 + k] === a)).toBe(true);
    // Below the division threshold, so nothing divides on the death step.
    for (const k of [a, c]) { w.reservoir += w.store[k] - 60; w.store[k] = 60; }
    w.mode[c] = 15;
    const tipMode = w.mode[c];
    kill(w, b);
    w.stepOnce();
    return { w, a, c, tipMode };
  }

  it('a cell dying inside a braced body leaves one body, the cell beyond keeps its mode, and the mother rebuilds the hole', () => {
    const { w, a, c, tipMode } = line(true);
    expect(w.census().residual).toBe(0);
    expect(w.alive[c]).toBe(1);
    expect(w.body[c]).toBe(w.body[a]);
    expect(w.census().bodies).toBe(1);
    expect(w.census().splits).toBe(0);
    expect(w.mother[c]).toBe(-1);
    expect(w.mode[c]).toBe(tipMode);
    // The mother went back to the mode that made the lost daughter; given the matter she builds it again at lattice (1, 0).
    expect(w.mode[a]).toBe(0);
    w.reservoir -= 200 - w.store[a];
    w.store[a] = 200;
    w.stepOnce();
    const back = [...Array(w.cap).keys()].filter((k) => w.alive[k] && k !== a && k !== c);
    expect(back.length).toBe(1);
    expect([w.gx[back[0]], w.gy[back[0]]]).toEqual([1, 0]);
    expect(w.census().bodies).toBe(1);
    w.checkInvariants();
  });

  it('without heal the same death splits the body and the cell beyond restarts its plan', () => {
    const { w, a, c } = line(false);
    expect(w.body[c]).not.toBe(w.body[a]);
    expect(w.census().bodies).toBe(2);
    expect(w.census().splits).toBe(1);
    expect(w.mode[c]).toBe(0);
    w.checkInvariants();
  });

  it('a cell a brace kept in its body restarts when a later death makes it the head of its own piece', () => {
    const { w, a, c } = line(true);
    expect(w.mode[c]).toBe(15);
    // The first cell dies too: c is left alone, a body it did not head before, so it starts its plan again and grows.
    kill(w, a);
    w.stepOnce();
    expect(w.alive[c]).toBe(1);
    expect(w.mode[c]).toBe(0);
    w.reservoir -= 400 - w.store[c];
    w.store[c] = 400;
    w.advance(10);
    expect(w.census().cells).toBeGreaterThan(1);
    w.checkInvariants();
  });

  it('a piece that really parts (no brace across) has its head restart from mode 0', () => {
    const w = new SoftRoamWorld(still({ heal: true }));
    const plan = restPlan(w);
    const [a, b, c] = row(w, plan, 6 * U, 8 * U, [P, P, P]);
    w.mode[c] = 5;
    w.mode[b] = 7;
    kill(w, a);
    w.stepOnce();
    // b heads the piece left (b, c) and starts again; c keeps its mode and its mother.
    expect(w.mode[b]).toBe(0);
    expect(w.mode[c]).toBe(5);
    expect(w.mother[c]).toBe(b);
    w.checkInvariants();
  });
});

describe('soft roam chunk 3: steer', () => {
  /** A hunter row trailing west with its mouth at (4, 8) tiles, heading east, and one prey cell 5 tiles due south of the mouth. */
  function side(over: Partial<SoftRoamConfig>, n = 2, genes = CHASER) {
    const w = new SoftRoamWorld(still({ size: 32, sight: 8, ...over }));
    const plan = restPlan(w);
    const hunter = row(w, plan, 4 * U - (n - 1) * U, 8 * U, [...Array(n - 1).fill(P), M], genes);
    const prey = spawn(w, 4 * U, 13 * U, SITTER, 150, plan);
    return { w, hunter, mouth: hunter[n - 1], prey };
  }

  it('the body turns toward prey off to its side by the worked difference, at most 16 a step, with no turn draw', () => {
    const s = side({ steer: true });
    s.w._commandsOnly();
    // Prey due south (heading 256) of a body heading 0: turn-left 256, of which 16 is taken now.
    expect(s.w.heading[s.mouth]).toBe(16);
    expect(s.w.turnLeft[s.mouth]).toBe(240);
    expect(s.w.census().steering).toBe(1);
    // Every cell with a chase gene steers by the aim, the plain rear cell too (from where it is).
    expect(priv(s.w).ty[s.hunter[0]]).toBeGreaterThan(0);
    const off = side({});
    off.w._commandsOnly();
    expect(off.w.heading[off.mouth]).toBe(0);
    expect(priv(off.w).ty[off.hunter[0]]).toBe(0);
  });

  it('a heading turns all the way round to the prey over a few dozen steps', () => {
    const s = side({ steer: true });
    s.w.advance(30);
    const h = s.w.heading[s.mouth];
    // Turned from east to the southern half, toward the prey.
    expect(h).toBeGreaterThan(128);
    expect(h).toBeLessThan(448);
    expect(Math.hypot(s.w.dlt(s.w.x[s.mouth], s.w.x[s.prey]), s.w.dlt(s.w.y[s.mouth], s.w.y[s.prey]))).toBeLessThan(5 * U);
  });

  it('an 8-cell hunter with a drive gene reaches and eats prey to its side with steer, and drives past it without', () => {
    const run = (steer: boolean): { closest: number; drained: number } => {
      const s = side({ steer: steer || undefined }, 8, genesOf(256, 512));
      let closest = Infinity;
      for (let t = 0; t < 120; t++) {
        s.w.stepOnce();
        if (s.w.alive[s.prey]) closest = Math.min(closest, Math.hypot(s.w.dlt(s.w.x[s.mouth], s.w.x[s.prey]), s.w.dlt(s.w.y[s.mouth], s.w.y[s.prey])));
      }
      expect(s.w.census().residual).toBe(0);
      return { closest, drained: s.w.census().drained };
    };
    const withSteer = run(true);
    const without = run(false);
    expect(withSteer.closest).toBeLessThan(1.3 * U);
    expect(withSteer.drained).toBeGreaterThan(100);
    expect(without.closest).toBeGreaterThan(3 * U);
    expect(without.drained).toBe(0);
  });

  it('a prey body with fear turns away from the hunter', () => {
    const w = new SoftRoamWorld(still({ size: 32, fear: 6, steer: true }));
    const plan = restPlan(w);
    // A 4-cell hunter (it could act on the 2-cell prey) west of the prey, the prey heading north.
    row(w, plan, 2 * U, 8 * U, [P, P, P, M]);
    const prey = row(w, plan, 8 * U, 8 * U, [P, P], CHASER);
    for (const c of prey) w.heading[c] = 768;
    w._commandsOnly();
    // Away from the hunter is due east (heading 0): from 768 the short way is +256.
    expect(w.turnLeft[prey[0]]).toBe(240);
    expect(w.heading[prey[0]]).toBe(784);
    expect(w.census().fleeing).toBe(2);
  });

  it('one aim per body: the same aim whatever slots the cells sit in and whichever way buckets are scanned', () => {
    const aim = (rev: boolean): number[] => {
      const w = new SoftRoamWorld(still({ size: 32, sight: 8, steer: true }));
      if (rev) w._testSlotOrder([...Array(64).keys()].reverse());
      priv(w)._reverseScan = rev;
      const plan = restPlan(w);
      const h = row(w, plan, 4 * U, 8 * U, [P, M, P, M, M]);
      // Two prey cells at the same distance from the two outer mouths.
      const p1 = spawn(w, 5 * U, 12 * U, SITTER, 150, plan);
      const p2 = spawn(w, 8 * U, 4 * U, SITTER, 150, plan);
      w._commandsOnly();
      const t = priv(w).bodyAimT[w.body[h[0]]];
      return [w.cid[t], w.heading[h[0]], w.cid[p1], w.cid[p2]];
    };
    expect(aim(true)).toEqual(aim(false));
  });
});

describe('soft roam chunk 3: pack and the standoff', () => {
  /**
   * Hunter X: a plain cell at (3, 8) and three mouths in a column at x = 4 (rows 7, 8, 9). Prey Y: a column at x = 5 of `kinds` from row 7
   * down, so three of X's mouths touch Y's first three cells.
   */
  function wall(over: Partial<SoftRoamConfig>, kinds: readonly number[]) {
    const w = new SoftRoamWorld(still(over));
    const plan = restPlan(w);
    const xp = spawn(w, 3 * U, 8 * U, SITTER, 150, plan);
    const m8 = spawn(w, 4 * U, 8 * U, SITTER, 150, plan, M);
    link(w, m8, xp, 1, 0);
    const m7 = spawn(w, 4 * U, 7 * U, SITTER, 150, plan, M);
    link(w, m7, m8, 1, -1);
    const m9 = spawn(w, 4 * U, 9 * U, SITTER, 150, plan, M);
    link(w, m9, m8, 1, 1);
    const ys: number[] = [];
    for (let i = 0; i < kinds.length; i++) {
      const c = spawn(w, 5 * U, (7 + i) * U, SITTER, 150, plan, kinds[i]);
      if (i > 0) link(w, c, ys[i - 1], 0, i);
      ys.push(c);
    }
    return { w, ys, mouths: [m7, m8, m9] };
  }
  const drained = (over: Partial<SoftRoamConfig>, kinds: readonly number[]): number => {
    const { w } = wall(over, kinds);
    w.stepOnce();
    expect(w.census().residual).toBe(0);
    return w.census().drained;
  };

  it('three mouths in touch open a 6-cell body with pack 2, not with pack 1 nor without the key', () => {
    const six = [P, P, P, P, P, P];
    expect(drained({}, six)).toBe(0);
    expect(drained({ pack: 1 }, six)).toBe(0);
    expect(drained({ pack: 2 }, six)).toBeGreaterThan(0);
  });

  it('the touch count is distinct mouths, not pairs: one mouth with three chosen contacts on a 6-cell body does not open it with pack 2', () => {
    const w = new SoftRoamWorld(still({ pack: 2 }));
    const plan = restPlan(w);
    // X: a plain cell at (4, 7) and its mouth at (4, 8). Y: six cells in a U round the mouth, (3, 8) (3, 9) (4, 9) (5, 9) (5, 8) (6, 8):
    // the mouth is one D from (3, 8), (4, 9) and (5, 8), and further than 1.25 D from the rest.
    const xp = spawn(w, 4 * U, 7 * U, SITTER, 150, plan);
    const mouth = spawn(w, 4 * U, 8 * U, SITTER, 150, plan, M);
    link(w, mouth, xp, 0, 1);
    const at = [[3, 8], [3, 9], [4, 9], [5, 9], [5, 8], [6, 8]];
    const ys: number[] = [];
    for (let i = 0; i < at.length; i++) {
      const c = spawn(w, at[i][0] * U, at[i][1] * U, SITTER, 150, plan);
      if (i > 0) link(w, c, ys[i - 1], i, 0);
      ys.push(c);
    }
    const pairs = w._touchPairs().filter((p) => p.split(',').includes(String(w.cid[mouth])));
    expect(pairs.length).toBe(3);
    w.stepOnce();
    // One mouth: 2 * 1 < 6. Counting the three pairs would give 2 * 3 = 6 and feed.
    expect(w.census().drained).toBe(0);
  });

  it('two bodies that could each act on the other do neither (a standoff)', () => {
    // Y: three mouths touching X's three mouths, and a plain cell behind: 4 cells each, 3 mouths each, pack 2 both ways.
    const stand = drained({ pack: 2 }, [M, M, M]);
    expect(stand).toBe(0);
    // With Y's front cells plain, Y cannot act and X feeds.
    expect(drained({ pack: 2 }, [P, P, P])).toBeGreaterThan(0);
  });

  it('pack does not open armour quickly: three mouths on a shell column at crack 10000 crack nothing in 300 steps (each mouth is one hit a step)', () => {
    const { w } = wall({ pack: 2, crack: 10000 }, [KIND_SHELL, KIND_SHELL, KIND_SHELL, P, P, P]);
    w.advance(300);
    expect(w.census().cracked).toBe(0);
    expect(w.census().drained).toBe(0);
    // Hits are counting: the three shells in touch have taken one hit a step each.
    let hits = 0;
    for (let c = 0; c < w.cap; c++) if (w.alive[c] && w.kind[c] === KIND_SHELL) hits += w.hits[c];
    expect(hits).toBe(900);
  });

  it('in sight, the count is the mouths the body holds', () => {
    const { w, ys, mouths } = wall({ pack: 2, sight: 4 }, [P, P, P, P, P, P]);
    const p = priv(w);
    p.rebuildLive();
    p.labelBodies();
    p.markMouths();
    expect(p.canAct(mouths[1], ys[5])).toBe(true);
    w.kind[mouths[0]] = P;
    p.markMouths();
    expect(p.canAct(mouths[1], ys[5])).toBe(false);
  });
});

describe('soft roam chunk 3: crowd', () => {
  it('of two prey at the same distance, a seeing mouth avoids the one another body is already at', () => {
    const pick = (crowd: number | undefined, nearSouth: boolean | undefined): number => {
      const w = new SoftRoamWorld(still({ size: 32, sight: 8, crowd }));
      const plan = restPlan(w);
      const h = row(w, plan, 3 * U, 8 * U, [P, M], CHASER);
      spawn(w, 4 * U, 12 * U, SITTER, 150, plan);
      spawn(w, 4 * U, 4 * U, SITTER, 150, plan);
      // Another hunter's mouth beside one prey (a 3-cell body far to the east, its mouth 1 tile from the prey).
      if (nearSouth !== undefined) {
        const y = nearSouth ? 12 * U : 4 * U;
        row(w, plan, 5 * U, y, [M, P, P]);
      }
      w._commandsOnly();
      return Math.sign(priv(w).ty[h[1]]);
    };
    const plain = pick(undefined, undefined);
    expect(plain).not.toBe(0);
    // Put the other mouth by the prey chosen without crowd: with crowd the mouth turns to the other; without, it does not.
    const by = plain > 0;
    expect(pick(undefined, by)).toBe(plain);
    expect(pick(1, by)).toBe(-plain);
  });
});

describe('soft roam chunk 3: the leaf pool', () => {
  const leafWorld = (over: Partial<SoftRoamConfig>) => {
    const w = new SoftRoamWorld(still({ day: 400, leaf: 2, ...over }));
    const plan = restPlan(w);
    // Four plain cells paying (leakCell a step each), and a leaf alone in the light (at step 0 the band is brightest at column 8 of 16).
    for (const y of [2, 5, 11, 14]) spawn(w, 1 * U + 512, y * U + 512, SITTER, 100_000, plan);
    const leaf = spawn(w, 8 * U + 512, 8 * U + 512, SITTER, 20, plan, KIND_LEAF);
    return { w, leaf };
  };

  it('leaves draw only on the pool, which fills from a share of upkeep up to its cap', () => {
    const { w, leaf } = leafWorld({ leakCell: 1, leafPool: 1, leafPoolMax: 3 });
    // Room to earn: a leaf takes no more than 4 births' worth (400 here).
    w.reservoir -= 280;
    w.store[leaf] += 280;
    let poolMax = 0;
    for (let t = 0; t < 200; t++) {
      const r = w.reservoir;
      w.stepOnce();
      poolMax = Math.max(poolMax, w.leafPool);
      expect(w.leafPool).toBeLessThanOrEqual(3);
      // The reservoir only gains (upkeep it did not hand to the pool); a leaf never takes from it.
      expect(w.reservoir).toBeGreaterThanOrEqual(r);
      expect(w.census().residual).toBe(0);
    }
    // The leaf earned (it pays its own upkeep too, so its store is not the measure), and never more than reached the pool.
    expect(w.census().leafIncome).toBeGreaterThan(50);
    expect(w.alive[leaf]).toBe(1);
    w.checkInvariants();
  });

  it('with an empty pool a leaf earns nothing however full the reservoir', () => {
    const { w } = leafWorld({ leafPool: 1 });
    w.advance(100);
    expect(w.census().leafIncome).toBe(0);
    expect(w.leafPool).toBe(0);
  });

  it('with share 0.25, a quarter of what is paid goes to the pool, rounded down each step', () => {
    // Four payers at 1 a step (the leaf, made plain here, pays too: 5 a step): floor(5 / 4) = 1 a step to the pool.
    const { w, leaf } = leafWorld({ leakCell: 1, leafPool: 0.25, leafPoolMax: 1_000_000 });
    w.kind[leaf] = P;
    w.reservoir -= 10_000;
    w.store[leaf] += 10_000;
    w.advance(400);
    expect(w.leafPool).toBe(400);
    expect(w.census().residual).toBe(0);
  });
});

describe('soft roam chunk 3: seasons as forcing', () => {
  const seasonL = (t: number, year: number, winter: number): number => {
    const ph = Math.floor(((t % year) * 1024) / year);
    const tri = ph < 512 ? ph >> 1 : (1024 - ph) >> 1;
    const w = Math.round(winter * 256);
    return w + (((256 - w) * tri) >> 8);
  };

  it('a scheduled patch holds patchFood times the season light', () => {
    const year = 4000;
    const w = new SoftRoamWorld(still({ day: 400, year, winter: 0.25, patchSeason: true, patchFood: 1000, patchEvery: 500, kinds: undefined, drain: undefined, seal: undefined }));
    const drops: number[] = [];
    for (let t = 0; t < 4000; t++) {
      const r = w.reservoir;
      w.stepOnce();
      if (r !== w.reservoir) drops.push(t, r - w.reservoir);
    }
    expect(drops.length).toBe(14);
    for (let i = 0; i < drops.length; i += 2) expect(drops[i + 1], `step ${drops[i]}`).toBe(Math.max(1, Math.floor((1000 * seasonL(drops[i], year, 0.25)) / 256)));
    // Midsummer (step 2000) a full patch, deep winter about a quarter.
    expect(drops[drops.indexOf(2000) + 1]).toBe(1000);
    expect(drops[drops.indexOf(500) + 1]).toBeLessThan(700);
  });

  it('the winter cost is nothing at midsummer and largest in deepest winter', () => {
    const year = 4000;
    const pays = (from: number): number => {
      const w = new SoftRoamWorld(still({ day: 400, year, winter: 0, winterCost: 0.5 }));
      const c = spawn(w, 8 * U, 8 * U, SITTER, 10_000, restPlan(w));
      w.step = from;
      const s0 = w.store[c];
      for (let t = 0; t < 40; t++) w.stepOnce();
      expect(w.census().residual).toBe(0);
      return s0 - w.store[c];
    };
    expect(pays(2000 - 20)).toBeLessThanOrEqual(2);
    const deep = pays(0);
    // About half a matter a step: 0.5 * (256 - seasonL) / 256 with seasonL from 0 up to about 5 over the 40 steps.
    expect(deep).toBeGreaterThan(12);
    expect(deep).toBeLessThan(28);
  });
});

describe('soft roam chunk 3: everything on', () => {
  const ALL: Partial<SoftRoamConfig> = { heal: true, steer: true, pack: 2, crowd: 1, leafPool: 0.3, leafPoolMax: 2000, patchSeason: true, winterCost: 0.01 };
  for (const seed of [1, 2]) {
    it(`seed ${seed}: matter stays whole over 3000 steps on the seasons start with every chunk 3 key on`, () => {
      const w = foundSoftRoam({ seed, size: 64, start: 'seasons', overrides: ALL });
      for (let t = 0; t < 3000; t++) {
        w.stepOnce();
        if (t % 250 === 0) w.checkInvariants();
      }
      const c = w.census();
      expect(c.residual).toBe(0);
      expect(c.cells).toBeGreaterThan(0);
      w.checkInvariants();
    });
  }

  it('the history does not depend on the slots cells sit in or the scan order, with every key on', () => {
    const run = (rev: boolean): number => {
      const w = new SoftRoamWorld(still({ size: 24, matter: 200_000, maxCells: 512, sight: 6, fear: 3, steer: true, pack: 2, crowd: 2, heal: true, leakCell: 0.01, life: 400, grip: 64, birthStore: 40, startPatches: 6, patchEvery: 20, patchFood: 2000, turnMax: 1 / 32, planMut: 0.05, mut: 0.05,
        day: 100, year: 400, winter: 0.2, leaf: 1, leafPool: 0.5, leafPoolMax: 500, patchSeason: true, winterCost: 0.05, truce: true }));
      if (rev) w._testSlotOrder([...Array(512).keys()].reverse());
      priv(w)._reverseScan = rev;
      // A plain cell that keeps a mouth in front, a leaf to its right and a plain cell behind, then lets daughters go.
      const grow = w.addPlan(Array.from({ length: 16 }, (_, m) => (m === 0 ? planEntry(0, 1, 2, P) : m === 1 ? planEntry(0, 15, 15, M) : m === 2 ? planEntry(1, 15, 3, KIND_LEAF) : m === 3 ? planEntry(2, 15, 4, P) : m === 4 ? planEntry(7, 0, 4, P) : planEntry(8, 0, m))));
      for (let k = 0; k < 12; k++) w.found(((k * 7) % 24) * U + 300, ((k * 11) % 24) * U + 300, genesOf(256 - 64 * (k % 3), 128), 1 + (k % 3), 79, grow);
      let poolMoved = 0;
      let patchesSmall = 0;
      for (let t = 0; t < 800; t++) {
        const pool = w.leafPool;
        const r = w.reservoir;
        const p0 = w.census().patches;
        w.stepOnce();
        if (w.leafPool !== pool) poolMoved++;
        // A patch fell this step and the reservoir lost less than a full one (it also takes in some upkeep, never 1,000 a step).
        if (w.census().patches > p0 && r - w.reservoir < 1000) patchesSmall++;
      }
      const c = w.census();
      expect(c.residual).toBe(0);
      // Every mechanism did something: leaves were paid from the pool, patches came smaller than full, mouths fed and bodies steered.
      const seen = { leafIncome: c.leafIncome, poolMoved, patchesSmall, drained: c.drained, cells: c.cells, leaves: c.leaves, mouths: c.mouths };
      expect(c.leafIncome, JSON.stringify(seen)).toBeGreaterThan(0);
      expect(poolMoved, JSON.stringify(seen)).toBeGreaterThan(10);
      expect(patchesSmall, JSON.stringify(seen)).toBeGreaterThan(0);
      expect(c.drained, JSON.stringify(seen)).toBeGreaterThan(0);
      return w.digest();
    };
    expect(run(true)).toBe(run(false));
  });
});
