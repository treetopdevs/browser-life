import { describe, expect, it } from 'vitest';
import { defaultSoftRoamConfig, KIND_MOUTH, KIND_PLAIN, KIND_SHELL, planEntry, roamHash, SOFT_U, type SoftRoamConfig, SoftRoamWorld } from '../src/softroam/kernel.ts';
import { foundSoftRoam } from '../src/softroam/view.ts';

/**
 * Soft Roam chunk 2, section A: one `canAct` predicate (touch feeding, hits, grip, sight, fear), truce, jaws, sight, fear, and the release
 * cap (`releaseMin`, `releaseGap`). Small hand-built worlds with nothing moving unless a test says so, then long runs with everything on.
 */

const U = SOFT_U;
/** Genes are [chase, drive, turn, adult, shape]; none of these turns. */
const genesOf = (chase: number): number[] => [chase, 0, -512, 0, 0];
const SITTER = genesOf(0);
const CHASER = genesOf(512);
const P = KIND_PLAIN;
const M = KIND_MOUTH;
const S = KIND_SHELL;

/** No upkeep, no wear, no copy errors, no patches, no turning; kinds, drain and crack off; flow so small that it moves nothing. */
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
/** Every mode releases a new body at lattice direction `act` (4 is straight on, 6 is straight back), and stays in mode 0. */
const releasePlan = (w: SoftRoamWorld, act = 4): number => w.addPlan(Array.from({ length: 16 }, () => planEntry(act, 0, 0)));

type Priv = {
  pairHash(a: number, b: number, ch: number): number;
  pairHash2(a: number, b: number, ch: number): number;
  tx: Int32Array;
  ty: Int32Array;
};
const priv = (w: SoftRoamWorld): Priv => w as unknown as Priv;

/** Put a cell anywhere, with no spacing rule (reaches the kernel's private allocate and place); family 0 unless told. */
function spawn(w: SoftRoamWorld, px: number, py: number, genes: readonly number[], store: number, plan: number, fam = 0, heading = 0): number {
  const a = w as unknown as { allocate(): number; place(c: number, x: number, y: number, g: readonly number[], f: number, s: number, p: number): void; labelHi: number };
  const c = a.allocate();
  a.place(c, px, py, genes, fam, store, plan);
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
function chain(w: SoftRoamWorld, plan: number, x: number, y: number, dx: number, dy: number, kinds: readonly number[], store = 150, genes: readonly number[] = SITTER, fam = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i < kinds.length; i++) {
    const c = spawn(w, x + i * dx, y + i * dy, genes, store, plan, fam);
    w.kind[c] = kinds[i];
    w.gx[c] = i;
    if (i > 0) { w.mother[c] = out[i - 1]; w.body[c] = w.body[out[0]]; w.bodySize[w.body[c]]++; w.bodyCount--; }
    out.push(c);
  }
  return out;
}

const dist = (w: SoftRoamWorld, a: number, b: number): number => Math.hypot(w.dlt(w.x[a], w.x[b]), w.dlt(w.y[a], w.y[b]));

interface Arena { w: SoftRoamWorld; hunter: number[]; mouth: number; prey: number[] }
interface ArenaOpts {
  /** Cells of the hunter (the last is a mouth) and kinds of the prey body (a column going south from its first cell). */
  hunterN?: number;
  preyKinds?: number[];
  /** Where the prey's first cell sits relative to the mouth, in units. */
  at?: readonly [number, number];
  hunterGenes?: readonly number[];
  preyGenes?: readonly number[];
  hunterFam?: number;
  preyFam?: number;
}
/** A hunter whose mouth sits at (4, 8) tiles with its body trailing west, and a prey body 5 tiles to the east. */
function arena(over: Partial<SoftRoamConfig>, o: ArenaOpts = {}): Arena {
  const w = new SoftRoamWorld(still(over));
  const plan = restPlan(w);
  const n = o.hunterN ?? 2;
  const hunter = chain(w, plan, 4 * U - (n - 1) * U, 8 * U, U, 0, [...Array(n - 1).fill(P), M], 150, o.hunterGenes ?? CHASER, o.hunterFam ?? 0);
  const [ax, ay] = o.at ?? [5 * U, 0];
  const prey = chain(w, plan, 4 * U + ax, 8 * U + ay, 0, U, o.preyKinds ?? [P], 150, o.preyGenes ?? SITTER, o.preyFam ?? 0);
  return { w, hunter, mouth: hunter[n - 1], prey };
}

const hunts = (over: Partial<SoftRoamConfig>, o: ArenaOpts = {}): number => {
  const a = arena({ sight: 6, ...over }, o);
  a.w._commandsOnly();
  return a.w.census().hunting;
};

describe('soft roam hunting: sight', () => {
  it('a two-cell hunter 5 tiles from one prey cell closes the distance with sight, and does not without', () => {
    const run = (over: Partial<SoftRoamConfig>): { d: number; w: SoftRoamWorld } => {
      const a = arena(over);
      expect(dist(a.w, a.mouth, a.prey[0])).toBe(5 * U);
      a.w.advance(40);
      expect(a.w.census().residual).toBe(0);
      return { d: dist(a.w, a.mouth, a.prey[0]), w: a.w };
    };
    const without = run({});
    const withSight = run({ sight: 6 });
    // No scent anywhere, so without sight nothing steers the mouth.
    expect(without.d).toBe(5 * U);
    expect(withSight.d).toBeLessThan(5 * U - 2000);
  });

  it('counts the steering: one hunting cell, one target, nobody fleeing', () => {
    const a = arena({ sight: 6 });
    a.w._commandsOnly();
    const c = a.w.census();
    expect([c.hunting, c.targets, c.fleeing]).toEqual([1, 1, 0]);
    // The directed term is the size of the gene along the unit vector to the target: due east here.
    expect([priv(a.w).tx[a.mouth], priv(a.w).ty[a.mouth]]).toEqual([1024, 0]);
    // The plain rear cell of the hunter has a chase gene but is not a mouth: it does not sight, and the scent is empty.
    expect(priv(a.w).tx[a.hunter[0]]).toBe(0);
  });

  it('a negative chase gene also closes: the sign does not flip it', () => {
    const run = (over: Partial<SoftRoamConfig>): number => {
      const a = arena(over, { hunterGenes: genesOf(-512) });
      a.w.advance(40);
      return dist(a.w, a.mouth, a.prey[0]);
    };
    expect(run({})).toBe(5 * U);
    expect(run({ sight: 6 })).toBeLessThan(5 * U - 2000);
    const a = arena({ sight: 6 }, { hunterGenes: genesOf(-512) });
    a.w._commandsOnly();
    expect(priv(a.w).tx[a.mouth]).toBe(1024);
  });

  it('chase 0 does nothing and is not counted', () => {
    const a = arena({ sight: 6 }, { hunterGenes: genesOf(0) });
    a.w._commandsOnly();
    expect(a.w.census().hunting).toBe(0);
    expect(a.w.census().targets).toBe(0);
    a.w.advance(40);
    expect(dist(a.w, a.mouth, a.prey[0])).toBe(5 * U);
  });

  it('ignores prey it could not eat: too large, sealed, same family under truce, any cell of a body that holds a mouth under jaws, a shell without crack', () => {
    expect(hunts({}, {})).toBe(1);
    // Too large: a hunter of two against a body of two; four against two is fine.
    expect(hunts({}, { preyKinds: [P, P] })).toBe(0);
    expect(hunts({}, { hunterN: 4, preyKinds: [P, P] })).toBe(1);
    expect(hunts({}, { hunterN: 4, preyKinds: [P, P, P] })).toBe(0);
    // Sealed: the hunter's body is old, the prey's is new (or the other way round).
    for (const [hunterSince, preySince, expected] of [[0, 0, 1], [0, 500, 0], [500, 0, 0]] as const) {
      const a = arena({ sight: 6, seal: 100 });
      a.w.step = 500;
      for (const c of a.hunter) a.w.since[c] = hunterSince;
      for (const c of a.prey) a.w.since[c] = preySince;
      a.w._commandsOnly();
      expect(a.w.census().hunting).toBe(expected);
    }
    // Truce: the same family is left alone, other families and family 0 are not.
    expect(hunts({ truce: true }, { hunterFam: 7, preyFam: 7 })).toBe(0);
    expect(hunts({}, { hunterFam: 7, preyFam: 7 })).toBe(1);
    expect(hunts({ truce: true }, { hunterFam: 7, preyFam: 8 })).toBe(1);
    expect(hunts({ truce: true }, { hunterFam: 0, preyFam: 0 })).toBe(1);
    // Jaws: a lone mouth is prey without jaws and not with them; so is any cell of a body that holds one.
    expect(hunts({}, { preyKinds: [M] })).toBe(1);
    expect(hunts({ jaws: true }, { preyKinds: [M] })).toBe(0);
    expect(hunts({ jaws: true }, { hunterN: 4, preyKinds: [P, M] })).toBe(0);
    expect(hunts({}, { hunterN: 4, preyKinds: [P, M] })).toBe(1);
    expect(hunts({ jaws: true }, { hunterN: 4, preyKinds: [P, P] })).toBe(1);
    // A shell is prey only when crack makes it hittable.
    expect(hunts({}, { preyKinds: [S] })).toBe(0);
    expect(hunts({ crack: 5 }, { preyKinds: [S] })).toBe(1);
  });

  it('looks as far as sight tiles on each axis and no further, wrapping round the torus', () => {
    expect(hunts({ sight: 4 }, { at: [4 * U, 0] })).toBe(1);
    expect(hunts({ sight: 4 }, { at: [4 * U + 1, 0] })).toBe(0);
    expect(hunts({ sight: 4 }, { at: [0, 4 * U] })).toBe(1);
    expect(hunts({ sight: 4 }, { at: [0, -4 * U - 1] })).toBe(0);
    // The range is a box: a corner at four tiles on both axes is inside.
    expect(hunts({ sight: 4 }, { at: [4 * U, 4 * U] })).toBe(1);
    // Across the seam of the torus: the prey at 15.5 tiles is 4.5 tiles west of the mouth at 4, over the edge of a 16-tile world.
    expect(hunts({ sight: 5 }, { at: [11 * U + 512, 0] })).toBe(1);
    expect(hunts({ sight: 4 }, { at: [11 * U + 512, 0] })).toBe(0);
    // 8 tiles on a world of 16 tiles takes the whole torus in one window: no cell is counted twice (one target, however it wraps).
    const a = arena({ sight: 8 }, { at: [8 * U, 0] });
    a.w._commandsOnly();
    expect([a.w.census().hunting, a.w.census().targets]).toEqual([1, 1]);
  });

  it('rejects prey outside the sight square before anything is squared, also when the scan window takes the whole torus', () => {
    // On a 17-tile world the scan window (19 tiles) wraps the whole torus, so the prey's tile is visited and only the range guard rejects it: 8.5 tiles on each axis.
    const a = arena({ sight: 8, size: 17 }, { at: [8 * U + 512, 8 * U + 512] });
    expect(Math.abs(a.w.dlt(a.w.x[a.mouth], a.w.x[a.prey[0]]))).toBe(8 * U + 512);
    a.w._commandsOnly();
    expect(a.w.census().hunting).toBe(0);
    // One axis inside and one outside is rejected as well; both inside is found.
    const o = arena({ sight: 8, size: 17 }, { at: [8 * U + 512, 0] });
    o.w._commandsOnly();
    expect(o.w.census().hunting).toBe(0);
    const b = arena({ sight: 8, size: 17 }, { at: [8 * U, -8 * U] });
    b.w._commandsOnly();
    expect(b.w.census().hunting).toBe(1);
    // A big world: prey half a world away is never near the window.
    const big = arena({ sight: 8, size: 256 }, { at: [128 * U, 128 * U] });
    big.w._commandsOnly();
    expect(big.w.census().hunting).toBe(0);
  });

  it('does not count a mouth that stays put: the gene pull and the sight pull cancel exactly', () => {
    // Drive -512 along heading 0 (east) and chase 512 toward prey 5 tiles east cancel; the mouth steers nowhere.
    const a = arena({ sight: 6 }, { hunterGenes: [512, -512, -512, 0, 0] });
    a.w._commandsOnly();
    expect(priv(a.w).tx[a.mouth]).toBe(0);
    expect(priv(a.w).ty[a.mouth]).toBe(0);
    expect([a.w.census().hunting, a.w.census().targets]).toEqual([0, 0]);
  });

  it('cells that share a centre give no direction: no steering, no count, no push due east', () => {
    const a = arena({ sight: 6, fear: 6 }, { at: [0, 0], preyGenes: CHASER });
    expect(dist(a.w, a.mouth, a.prey[0])).toBe(0);
    a.w._commandsOnly();
    expect([priv(a.w).tx[a.mouth], priv(a.w).ty[a.mouth]]).toEqual([0, 0]);
    expect([priv(a.w).tx[a.prey[0]], priv(a.w).ty[a.prey[0]]]).toEqual([0, 0]);
    const c = a.w.census();
    expect([c.hunting, c.targets, c.fleeing]).toEqual([0, 0, 0]);
  });

  it('counts only steering that is applied: with thrustMax 0 nothing is hunting, targeted or fleeing', () => {
    const a = arena({ sight: 6, fear: 6, thrustMax: 0 }, { preyGenes: CHASER });
    a.w._commandsOnly();
    const c = a.w.census();
    expect([c.hunting, c.targets, c.fleeing]).toEqual([0, 0, 0]);
    const b = arena({ sight: 6, fear: 6 }, { preyGenes: CHASER });
    b.w._commandsOnly();
    expect([b.w.census().hunting, b.w.census().targets, b.w.census().fleeing]).toEqual([1, 1, 1]);
  });

  it('counts distinct targets exactly when the target marker generation passes 2^32', () => {
    const w = new SoftRoamWorld(still({ sight: 6 }));
    const plan = restPlan(w);
    chain(w, plan, 3 * U, 8 * U, U, 0, [P, M], 150, CHASER);
    chain(w, plan, 3 * U, 10 * U, U, 0, [P, M], 150, CHASER);
    chain(w, plan, 9 * U, 9 * U, 0, U, [P], 150, SITTER);
    const t = w as unknown as { tgtGen: number };
    for (const gen of [0, 4294967294, 4294967295, 4294967296, 4294967297]) {
      t.tgtGen = gen;
      w._commandsOnly();
      expect([w.census().hunting, w.census().targets]).toEqual([2, 1]);
    }
  });

  it('chooses the nearer of two prey, and a prey it can act on over a nearer one it cannot', () => {
    const w = new SoftRoamWorld(still({ sight: 6 }));
    const plan = restPlan(w);
    const h = chain(w, plan, 3 * U, 8 * U, U, 0, [P, M], 150, CHASER);
    const near = spawn(w, 4 * U - 2 * U, 8 * U + 3 * U, SITTER, 150, plan);
    const far = spawn(w, 4 * U + 5 * U, 8 * U, SITTER, 150, plan);
    w._commandsOnly();
    // Nearer is the one to the south-west (distance about 3.6 tiles), against 5 tiles east.
    expect(priv(w).tx[h[1]]).toBeLessThan(0);
    expect(priv(w).ty[h[1]]).toBeGreaterThan(0);
    // Make the nearer one a shell (no crack): it is not prey, so the far one is the target.
    w.kind[near] = S;
    w._commandsOnly();
    expect([priv(w).tx[h[1]], priv(w).ty[h[1]]]).toEqual([1024, 0]);
    expect(far).toBeGreaterThanOrEqual(0);
  });

  it('with no target the scent path is used unchanged', () => {
    const run = (sight?: number): number[] => {
      const w = new SoftRoamWorld(still({ sight, size: 32 }));
      const plan = restPlan(w);
      chain(w, plan, 3 * U, 8 * U, U, 0, [P, M], 150, CHASER);
      w.food[8 * w.size + 14] += 3000;
      w.reservoir -= 3000;
      w.advance(30);
      return [w.digest(), w.x[1]];
    };
    const a = run(6);
    expect(a).toEqual(run(undefined));
    // The scent did steer the mouth (it moved toward the food), so this is not a world where nothing happens.
    expect(a[1]).toBeGreaterThan(4 * U + 100);
  });
});

describe('soft roam hunting: fear', () => {
  it('prey with fear opens the distance, with a positive chase gene and with a negative one', () => {
    for (const chase of [512, -512]) {
      const run = (over: Partial<SoftRoamConfig>): number => {
        const a = arena(over, { hunterGenes: SITTER, preyGenes: genesOf(chase) });
        a.w.advance(40);
        expect(a.w.census().residual).toBe(0);
        return dist(a.w, a.mouth, a.prey[0]);
      };
      expect(run({})).toBe(5 * U);
      expect(run({ fear: 6 })).toBeGreaterThan(5 * U + 800);
    }
  });

  it('steers directly away from the mouth, counts as fleeing, and a mouth or a chase-0 cell does not flee', () => {
    const a = arena({ fear: 6 }, { hunterGenes: SITTER, preyGenes: CHASER });
    a.w._commandsOnly();
    const c = a.w.census();
    expect([c.hunting, c.targets, c.fleeing]).toEqual([0, 0, 1]);
    // The prey is due east of the mouth: away is due east.
    expect([priv(a.w).tx[a.prey[0]], priv(a.w).ty[a.prey[0]]]).toEqual([1024, 0]);
    const b = arena({ fear: 6 }, { hunterGenes: SITTER, preyGenes: CHASER, at: [0, -5 * U] });
    b.w._commandsOnly();
    expect([priv(b.w).tx[b.prey[0]], priv(b.w).ty[b.prey[0]]]).toEqual([0, -1024]);
    // Chase 0: not counted, not steering.
    const z = arena({ fear: 6 }, { hunterGenes: SITTER, preyGenes: SITTER });
    z.w._commandsOnly();
    expect(z.w.census().fleeing).toBe(0);
    // A mouth does not run fear, even with a chase gene and a bigger hunter near.
    const m = arena({ fear: 6 }, { hunterN: 4, hunterGenes: SITTER, preyGenes: CHASER, preyKinds: [M] });
    m.w._commandsOnly();
    expect(m.w.census().fleeing).toBe(0);
  });

  it('is not afraid of a mouth that could not act: the same family under truce, a bigger body, a sealed one, or out of range', () => {
    const flees = (over: Partial<SoftRoamConfig>, o: ArenaOpts = {}): number => {
      const a = arena({ fear: 6, ...over }, { hunterGenes: SITTER, preyGenes: CHASER, ...o });
      a.w._commandsOnly();
      return a.w.census().fleeing;
    };
    expect(flees({})).toBe(1);
    expect(flees({ truce: true }, { hunterFam: 3, preyFam: 3 })).toBe(0);
    expect(flees({ truce: true }, { hunterFam: 3, preyFam: 4 })).toBe(1);
    expect(flees({}, { preyKinds: [P, P] })).toBe(0);
    // A sealed mouth cannot act, so the prey it is next to does not run (the prey itself is unsealed here).
    const sealedMouth = (seal: number): number => {
      const a = arena({ fear: 6, seal }, { hunterGenes: SITTER, preyGenes: CHASER });
      a.w.step = 500;
      for (const c of a.hunter) a.w.since[c] = seal > 0 ? 499 : 0;
      for (const c of a.prey) a.w.since[c] = 0;
      a.w._commandsOnly();
      return a.w.census().fleeing;
    };
    expect(sealedMouth(100)).toBe(0);
    expect(sealedMouth(0)).toBe(1);
    expect(flees({ fear: 4 }, { at: [5 * U, 0] })).toBe(0);
    expect(flees({ fear: 5 }, { at: [5 * U, 0] })).toBe(1);
    // Jaws: a plain cell in a body that holds a mouth (a four-cell hunter against a plain and a mouth) is not afraid, and is without jaws.
    expect(flees({}, { hunterN: 4, preyKinds: [P, M] })).toBe(1);
    expect(flees({ jaws: true }, { hunterN: 4, preyKinds: [P, M] })).toBe(0);
    // A shell flees as a plain cell does (and is prey only with crack).
    expect(flees({ crack: 5 }, { preyKinds: [S] })).toBe(1);
    expect(flees({}, { preyKinds: [S] })).toBe(0);
  });

  it('a sealed prey does not flee', () => {
    const a = arena({ fear: 6, seal: 100 }, { hunterGenes: SITTER, preyGenes: CHASER });
    a.w.step = 500;
    for (const c of a.hunter) a.w.since[c] = 0;
    for (const c of a.prey) a.w.since[c] = 500;
    a.w._commandsOnly();
    expect(a.w.census().fleeing).toBe(0);
  });
});

describe('soft roam hunting: the choice of target does not depend on slots, scan order or evaluation order', () => {
  const perm = Array.from({ length: 64 }, (_, i) => i).sort((p, q) => roamHash(5, 0, p, 1) - roamHash(5, 0, q, 1));
  const variants: [readonly number[] | null, boolean][] = [[null, false], [perm, false], [null, true], [perm.slice().reverse(), true]];

  /** The thrust of every live cell, by serial. */
  const thrusts = (w: SoftRoamWorld): string => {
    const out: string[] = [];
    for (let c = 0; c < w.cap; c++) if (w.alive[c]) out.push(`${w.cid[c]}:${priv(w).tx[c]},${priv(w).ty[c]}`);
    return out.sort().join(' ');
  };

  it('sight: four equidistant prey round one mouth, picked by the pair draws, the same in every layout and not always the same one', () => {
    const build = (order: readonly number[] | null, reverse: boolean): SoftRoamWorld => {
      const w = new SoftRoamWorld(still({ sight: 6 }));
      if (order) w._testSlotOrder(order);
      w._reverseScan = reverse;
      const plan = restPlan(w);
      chain(w, plan, 7 * U, 8 * U, U, 0, [P, M], 150, CHASER);
      const cx = 8 * U;
      for (const [dx, dy] of [[4, 0], [-4, 0], [0, 4], [0, -4]]) spawn(w, cx + dx * U, 8 * U + dy * U, SITTER, 150, plan);
      return w;
    };
    const worlds = variants.map(([o, r]) => build(o, r));
    const dirs = new Set<string>();
    for (let s = 0; s < 40; s++) {
      for (const w of worlds) { w.step = s; w._commandsOnly(); }
      const ts = worlds.map(thrusts);
      for (const t of ts) expect(t).toBe(ts[0]);
      dirs.add(`${priv(worlds[0]).tx[1]},${priv(worlds[0]).ty[1]}`);
      expect(worlds.map((w) => w.census().hunting)).toEqual([1, 1, 1, 1]);
    }
    expect(dirs.size).toBeGreaterThanOrEqual(3);
  });

  it('fear: four equidistant mouths round one prey cell, picked the same way', () => {
    const build = (order: readonly number[] | null, reverse: boolean): SoftRoamWorld => {
      const w = new SoftRoamWorld(still({ fear: 6 }));
      if (order) w._testSlotOrder(order);
      w._reverseScan = reverse;
      const plan = restPlan(w);
      spawn(w, 8 * U, 8 * U, CHASER, 150, plan);
      // Each hunter's mouth is 4 tiles away; the body trails behind it, away from the prey.
      chain(w, plan, 12 * U, 8 * U, U, 0, [M, P], 150, SITTER);
      chain(w, plan, 4 * U, 8 * U, -U, 0, [M, P], 150, SITTER);
      chain(w, plan, 8 * U, 12 * U, 0, U, [M, P], 150, SITTER);
      chain(w, plan, 8 * U, 4 * U, 0, -U, [M, P], 150, SITTER);
      return w;
    };
    const worlds = variants.map(([o, r]) => build(o, r));
    const dirs = new Set<string>();
    for (let s = 0; s < 40; s++) {
      for (const w of worlds) { w.step = s; w._commandsOnly(); }
      const ts = worlds.map(thrusts);
      for (const t of ts) expect(t).toBe(ts[0]);
      dirs.add(`${priv(worlds[0]).tx[0]},${priv(worlds[0]).ty[0]}`);
      expect(worlds.map((w) => w.census().fleeing)).toEqual([1, 1, 1, 1]);
    }
    expect(dirs.size).toBeGreaterThanOrEqual(3);
  });

  it('two equidistant candidates whose first pair draws collide are told apart by the second draw, then not by the cid', () => {
    // cids 6068 and 57348 against 56617 give the same pair-hash key (imul(6068, K) ^ 56617 === imul(56617, K) ^ 57348), so they collide on every channel of it.
    const w = new SoftRoamWorld(still({ sight: 6 }));
    const plan = restPlan(w);
    const h = chain(w, plan, 7 * U, 8 * U, U, 0, [P, M], 150, CHASER);
    const east = spawn(w, 12 * U, 8 * U, SITTER, 150, plan);
    const west = spawn(w, 4 * U, 8 * U, SITTER, 150, plan);
    w.cid[h[1]] = 56617;
    w.cid[west] = 6068;
    w.cid[east] = 57348;
    let eastWins = 0;
    let westWins = 0;
    for (let s = 0; s < 300; s++) {
      w.step = s;
      const k = priv(w);
      // The first draw ties at every step; the second does not (it is built from the two cids another way).
      expect(k.pairHash(h[1], east, 60)).toBe(k.pairHash(h[1], west, 60));
      const a = k.pairHash2(h[1], east, 61);
      const b = k.pairHash2(h[1], west, 61);
      expect(a).not.toBe(b);
      w._commandsOnly();
      const wentEast = k.tx[h[1]] > 0;
      expect(wentEast).toBe(a < b);
      if (wentEast) eastWins++; else westWins++;
    }
    // Not the lower cid every time.
    expect(Math.min(eastWins, westWins)).toBeGreaterThan(90);
  });

  it('with every draw tied the lower cid decides, as the last resort', () => {
    const w = new SoftRoamWorld(still({ sight: 6 }));
    const plan = restPlan(w);
    const h = chain(w, plan, 7 * U, 8 * U, U, 0, [P, M], 150, CHASER);
    const east = spawn(w, 12 * U, 8 * U, SITTER, 150, plan);
    const west = spawn(w, 4 * U, 8 * U, SITTER, 150, plan);
    const k = priv(w);
    k.pairHash = () => 5;
    k.pairHash2 = () => 9;
    w.cid[west] = 40;
    w.cid[east] = 30;
    w._commandsOnly();
    expect(k.tx[h[1]]).toBeGreaterThan(0);
    w.cid[west] = 20;
    w._commandsOnly();
    expect(k.tx[h[1]]).toBeLessThan(0);
  });
});

describe('soft roam hunting: truce and jaws change what pairs do, not which pairs are chosen', () => {
  it('the contacts picked are the same set with truce and jaws on as off', () => {
    const build = (over: Partial<SoftRoamConfig>): SoftRoamWorld => {
      const w = new SoftRoamWorld(still({ size: 16, ...over }));
      const plan = restPlan(w);
      const c = 8 * U;
      // A centre cell, six cells round it (some its family, some not) and a hunter with a mouth beside it: more candidates than places.
      spawn(w, c, c, SITTER, 150, plan, 3);
      for (let k = 0; k < 6; k++) {
        const a = (k * 2 * Math.PI) / 6;
        spawn(w, c + Math.round(1100 * Math.cos(a)), c + Math.round(1100 * Math.sin(a)), SITTER, 150, plan, k % 2 === 0 ? 3 : 4);
      }
      chain(w, plan, c - 2200 - 3 * U, c, U, 0, [P, P, P, M], 150, SITTER, 3);
      chain(w, plan, c + 2200, c, U, 0, [M, P], 150, SITTER, 4);
      return w;
    };
    const off = build({});
    const on = build({ truce: true, jaws: true });
    let any = 0;
    for (let s = 0; s < 12; s++, off.step++, on.step++) {
      const a = off._touchPairs();
      expect(on._touchPairs()).toEqual(a);
      any += a.length;
    }
    expect(any).toBeGreaterThan(30);
  });

  it('a contact that canAct refuses still uses up one of the four places', () => {
    // A prey cell with six eligible neighbours keeps four; under truce a refused neighbour is among the four, so truce does not give the prey more feeders.
    const build = (over: Partial<SoftRoamConfig>): SoftRoamWorld => {
      const w = new SoftRoamWorld(still(over));
      const plan = restPlan(w);
      const c = 8 * U + 512;
      spawn(w, c, c, SITTER, 150, plan, 3);
      for (let k = 0; k < 6; k++) {
        const a = (k * 2 * Math.PI) / 6;
        spawn(w, c + Math.round(1100 * Math.cos(a)), c + Math.round(1100 * Math.sin(a)), SITTER, 150, plan, 3);
      }
      return w;
    };
    const off = build({});
    const on = build({ truce: true });
    for (let s = 0; s < 8; s++, off.step++, on.step++) {
      const pairs = on._touchPairs();
      expect(pairs).toEqual(off._touchPairs());
      expect(pairs.filter((p) => p.startsWith('1,')).length).toBe(4);
    }
  });
});

describe('soft roam hunting: truce and jaws stop feeding, hits and grip exactly', () => {
  /** A hunter of n cells with its mouth at (6, 8) tiles and a prey body 1100 units east of it (touching), both old enough. */
  const duel = (n: number, over: Partial<SoftRoamConfig>, preyKinds: number[], hunterFam = 0, preyFam = 0): { w: SoftRoamWorld; mouth: number; prey: number[] } => {
    const w = new SoftRoamWorld(still(over));
    const plan = restPlan(w);
    const h = chain(w, plan, 6 * U - (n - 1) * U, 8 * U, U, 0, [...Array(n - 1).fill(P), M], 150, SITTER, hunterFam);
    const prey = chain(w, plan, 6 * U + 1100, 8 * U, 0, U, preyKinds, 150, SITTER, preyFam);
    return { w, mouth: h[n - 1], prey };
  };

  it('feeding: the same family under truce takes nothing, another family does, and a body holding a mouth takes nothing under jaws', () => {
    for (const [over, hf, pf, preyKinds, takes] of [
      [{}, 5, 5, [P], true],
      [{ truce: true }, 5, 5, [P], false],
      [{ truce: true }, 5, 6, [P], true],
      [{ truce: true }, 0, 0, [P], true],
      [{}, 0, 0, [M], true],
      [{ jaws: true }, 0, 0, [M], false],
      [{ jaws: true }, 0, 0, [P], true],
      [{ truce: true, jaws: true }, 5, 6, [P], true],
      [{ truce: true, jaws: true }, 5, 6, [M], false],
    ] as [Partial<SoftRoamConfig>, number, number, number[], boolean][]) {
      const { w, mouth, prey } = duel(3, over, preyKinds, hf, pf);
      w.advance(5);
      expect(w.drained).toBe(takes ? 15 : 0);
      expect(w.store[prey[0]]).toBe(takes ? 135 : 150);
      expect(w.store[mouth]).toBe(takes ? 165 : 150);
      expect(w.events.feeds.length).toBe(takes ? 1 : 0);
      expect(w.census().residual).toBe(0);
    }
  });

  it('hits: a shell takes one hit a step from a mouth, none under truce or when its body holds a mouth under jaws', () => {
    const hitsAfter = (over: Partial<SoftRoamConfig>, preyKinds: number[], hf = 0, pf = 0, n = 3): number => {
      const { w, prey } = duel(n, { crack: 50, ...over }, preyKinds, hf, pf);
      w.advance(4);
      return w.hits[prey[0]];
    };
    expect(hitsAfter({}, [S])).toBe(4);
    expect(hitsAfter({ truce: true }, [S], 9, 9)).toBe(0);
    expect(hitsAfter({ truce: true }, [S], 9, 8)).toBe(4);
    // The shell is the first cell of a two-cell prey body whose second cell is a mouth: a hunter of four is twice its size.
    expect(hitsAfter({}, [S, M], 0, 0, 4)).toBe(4);
    expect(hitsAfter({ jaws: true }, [S, M], 0, 0, 4)).toBe(0);
    expect(hitsAfter({ jaws: true }, [S, P], 0, 0, 4)).toBe(4);
  });

  it('grip: a mouth pulls toward prey it could act on, and not toward same-family prey under truce or a body with a mouth under jaws', () => {
    const after = (over: Partial<SoftRoamConfig>, preyKinds: number[], hf = 0, pf = 0): number[] => {
      const { w, mouth, prey } = duel(3, over, preyKinds, hf, pf);
      w.advance(1);
      return [w.x[mouth], w.y[mouth], w.x[prey[0]], w.y[prey[0]], w.vx[prey[0]]];
    };
    const g = { grip: 128 };
    // With grip the pair moves differently from the same world without grip (the gap of 1100 units is pulled toward 1024) ...
    expect(after(g, [P])).not.toEqual(after({}, [P]));
    // ... and a pair canAct refuses is moved exactly as if grip were off.
    expect(after({ ...g, truce: true }, [P], 4, 4)).toEqual(after({ truce: true }, [P], 4, 4));
    expect(after({ ...g, jaws: true }, [M])).toEqual(after({ jaws: true }, [M]));
    // Another family under truce is still pulled.
    expect(after({ ...g, truce: true }, [P], 4, 5)).toEqual(after(g, [P]));
  });

  it('a six-cell hunter cannot drain the plain rear cell of a three-cell hunter under jaws, and can without', () => {
    for (const jaws of [false, true]) {
      const w = new SoftRoamWorld(still({ jaws }));
      const plan = restPlan(w);
      const big = chain(w, plan, 1 * U, 8 * U, U, 0, [P, P, P, P, P, M], 150, SITTER);
      // The three-cell hunter's rear cell touches the big one's mouth; its own mouth is two cells further on.
      const small = chain(w, plan, 6 * U + 1100, 8 * U, U, 0, [P, P, M], 150, SITTER);
      w.advance(3);
      expect(w.store[small[0]]).toBe(jaws ? 150 : 141);
      expect(w.store[big[5]]).toBe(jaws ? 150 : 159);
      expect(w.census().residual).toBe(0);
    }
  });
});

describe('soft roam hunting: the census counts concentration, not spacing', () => {
  it('two mouths sighting one prey are two hunting and one target; two prey are two targets', () => {
    const w = new SoftRoamWorld(still({ sight: 6 }));
    const plan = restPlan(w);
    chain(w, plan, 3 * U, 8 * U, U, 0, [P, M], 150, CHASER);
    chain(w, plan, 12 * U, 8 * U, -U, 0, [P, M], 150, CHASER);
    spawn(w, 8 * U, 8 * U + 200, SITTER, 150, plan);
    w._commandsOnly();
    expect([w.census().hunting, w.census().targets]).toEqual([2, 1]);
    spawn(w, 5 * U + 500, 11 * U, SITTER, 150, plan);
    w._commandsOnly();
    // The second prey is nearer to the west mouth (3.4 tiles against 4.1) and farther from the east one: two targets.
    expect(w.census().hunting).toBe(2);
    expect(w.census().targets).toBe(2);
  });
});

describe('soft roam hunting: config', () => {
  it('sight and fear need kinds and drain and a whole number of tiles from 1 to 8', () => {
    const base = still();
    expect(() => new SoftRoamWorld({ ...base, sight: 5 })).not.toThrow();
    expect(() => new SoftRoamWorld({ ...base, fear: 8 })).not.toThrow();
    expect(() => new SoftRoamWorld({ ...base, kinds: false, sight: 5 })).toThrow(/kinds and drain/);
    expect(() => new SoftRoamWorld({ ...base, kinds: false, fear: 5 })).toThrow(/kinds and drain/);
    expect(() => new SoftRoamWorld({ ...base, drain: undefined, seal: undefined, sight: 5 })).toThrow(/kinds and drain/);
    expect(() => new SoftRoamWorld({ ...base, drain: undefined, seal: undefined, fear: 5 })).toThrow(/kinds and drain/);
    for (const bad of [0, 9, 1.5, -1, Number.NaN]) {
      expect(() => new SoftRoamWorld({ ...base, sight: bad })).toThrow(/Invalid sight/);
      expect(() => new SoftRoamWorld({ ...base, fear: bad })).toThrow(/Invalid fear/);
    }
  });

  it('releaseMin and releaseGap are whole numbers of at least 1', () => {
    const base = still();
    expect(() => new SoftRoamWorld({ ...base, releaseMin: 1, releaseGap: 1 })).not.toThrow();
    for (const bad of [0, -3, 1.5, Number.NaN]) {
      expect(() => new SoftRoamWorld({ ...base, releaseMin: bad })).toThrow(/Invalid releaseMin/);
      expect(() => new SoftRoamWorld({ ...base, releaseGap: bad })).toThrow(/Invalid releaseGap/);
    }
  });

  it('truce and jaws are true or false', () => {
    const base = still();
    expect(() => new SoftRoamWorld({ ...base, truce: true, jaws: false })).not.toThrow();
    expect(() => new SoftRoamWorld({ ...base, truce: 1 as unknown as boolean })).toThrow(/true or false/);
  });

  it('with every new key absent (or undefined) the old path runs: the same history as the plain config', () => {
    const run = (extra: Partial<SoftRoamConfig>): number => {
      const w = foundSoftRoam({ seed: 3, size: 32, start: 'garden', overrides: extra });
      w.advance(300);
      return w.digest();
    };
    expect(run({ truce: undefined, jaws: undefined, sight: undefined, fear: undefined, releaseMin: undefined, releaseGap: undefined })).toBe(run({}));
  });
});

describe('soft roam hunting: release cap', () => {
  /** A world big enough to park daughters in, and a body of n cells along +x whose last cell (the tip) releases straight on every step. */
  const world = (over: Partial<SoftRoamConfig>): { w: SoftRoamWorld; rest: number; rel: number; relBack: number } => {
    parked = 0;
    const w = new SoftRoamWorld(still({ size: 64, maxCells: 256, ...over }));
    return { w, rest: restPlan(w), rel: releasePlan(w, 4), relBack: releasePlan(w, 6) };
  };
  const body = (w: SoftRoamWorld, n: number, plan: number, tipPlan = plan): number[] => {
    const cells = chain(w, plan, 4 * U, 8 * U, U, 0, Array(n).fill(P), 400, SITTER);
    w.pid[cells[n - 1]] = tipPlan;
    return cells;
  };
  let parked = 0;
  /** Keep the cells ready (top up their stores from the reservoir) and move every new released daughter to its own far corner with a plan that never divides. */
  const tidy = (w: SoftRoamWorld, keepReady: readonly number[], rest: number, parkNew = true): void => {
    for (const c of keepReady) {
      if (!w.alive[c] || w.store[c] >= 400) continue;
      const need = 400 - w.store[c];
      w.store[c] += need;
      w.reservoir -= need;
    }
    if (!parkNew) return;
    for (const d of w.events.births) {
      if (w.mother[d] >= 0) continue;
      const k = parked++;
      w.x[d] = (2 + 3 * (k % 20)) * U + 512;
      w.y[d] = (20 + 3 * Math.floor(k / 20)) * U + 512;
      w.prevX[d] = w.x[d];
      w.prevY[d] = w.y[d];
      w.pid[d] = rest;
    }
  };
  /** Steps at which releases happened, with how many, from step `from`, `steps` long. */
  const releaseLog = (w: SoftRoamWorld, keepReady: readonly number[], rest: number, steps: number, each?: (t: number) => void): Map<number, number> => {
    const log = new Map<number, number>();
    for (let i = 0; i < steps; i++) {
      const t = w.step;
      each?.(t);
      const before = w.releases;
      w.stepOnce();
      if (w.releases > before) log.set(t, w.releases - before);
      tidy(w, keepReady, rest);
    }
    return log;
  };

  it('releaseMin holds releases exactly: a body of fewer cells never releases, one of that many releases every step', () => {
    for (let n = 1; n <= 6; n++) {
      const { w, rest, rel } = world({ releaseMin: 4 });
      const cells = body(w, n, rest, rel);
      const log = releaseLog(w, cells, rest, 30);
      const total = [...log.values()].reduce((s, v) => s + v, 0);
      expect(total).toBe(n >= 4 ? 30 : 0);
      expect(w.releasesHeld).toBe(n >= 4 ? 0 : 30);
      expect(w.census().residual).toBe(0);
    }
  });

  it('releaseMin counts the body as the division stage starts, so a cell that grows the body this step does not unlock a release', () => {
    const { w, rest } = world({ releaseMin: 5 });
    const plan = w.addPlan(Array.from({ length: 16 }, (_, m) => planEntry(m === 0 ? 0 : 8, 0, 8)));
    // Four cells; the tip keeps a daughter straight on (making five) while the first cell wants to release backwards.
    const cells = chain(w, rest, 4 * U, 8 * U, U, 0, [P, P, P, P], 400, SITTER);
    w.pid[cells[3]] = plan;
    w.pid[cells[0]] = releasePlan(w, 6);
    w.advance(1);
    expect(w.bodySizes().sort()).toEqual([5]);
    expect(w.releases).toBe(0);
    expect(w.releasesHeld).toBe(1);
  });

  it('releaseMin alone does not forbid two cells of one body releasing in a step; releaseGap does', () => {
    for (const [over, releases, held] of [[{}, 2, 0], [{ releaseMin: 3 }, 2, 0], [{ releaseGap: 5 }, 1, 1], [{ releaseMin: 3, releaseGap: 5 }, 1, 1]] as [Partial<SoftRoamConfig>, number, number][]) {
      const { w, rest, rel, relBack } = world(over);
      // The tip releases straight on (east), the first cell releases straight back (west): two free places.
      const cells = body(w, 4, rest, rel);
      w.pid[cells[0]] = relBack;
      w.advance(1);
      expect(w.releases).toBe(releases);
      expect(w.releasesHeld).toBe(held);
      expect(w.census().residual).toBe(0);
    }
  });

  it('releaseGap holds releases exactly: at step t the next is at t + releaseGap, counted over a run against the bound', () => {
    for (const gap of [1, 2, 7, 25]) {
      const { w, rest, rel } = world({ releaseGap: gap });
      const cells = body(w, 3, rest, rel);
      const log = releaseLog(w, cells, rest, 100);
      const expected = new Map<number, number>();
      for (let t = 0; t < 100; t += gap) expected.set(t, 1);
      expect(log).toEqual(expected);
      // Ready every step; held on every step that was not a release.
      expect(w.releasesHeld).toBe(100 - expected.size);
      expect(w.census().residual).toBe(0);
    }
  });

  it('a tip that releases at step 100 and dies at 101 does not let its body release again before 100 + releaseGap', () => {
    const gap = 40;
    const run = (over: Partial<SoftRoamConfig>): Map<number, number> => {
      const { w, rest, rel } = world(over);
      const cells = body(w, 4, rel);
      expect(cells.length).toBe(4);
      w.step = 100;
      return releaseLog(w, cells, rest, 60, (t) => {
        // After the release at step 100 the tip is starved: it dies in the next step.
        if (t === 101) { w.reservoir += w.store[cells[3]]; w.store[cells[3]] = 0; }
      });
    };
    const held = run({ releaseGap: gap });
    expect([...held.keys()]).toEqual([100, 140]);
    // The same world with no cap releases again at once from the new tip, so the wait above is the cap's doing.
    expect(run({}).has(101)).toBe(true);
  });

  it('both fragments of a body that splits keep the cooldown', () => {
    const gap = 50;
    const run = (over: Partial<SoftRoamConfig>): { log: Map<number, number>; splits: number } => {
      const { w, rest, rel } = world(over);
      const cells = body(w, 6, rel);
      w.step = 100;
      const log = releaseLog(w, cells, rest, 70, (t) => {
        if (t === 101) { w.reservoir += w.store[cells[2]]; w.store[cells[2]] = 0; }
      });
      return { log, splits: w.splits };
    };
    const capped = run({ releaseGap: gap });
    expect(capped.splits).toBe(1);
    // One release at step 100 by the whole body; at 150 both fragments (each with a free tip) release.
    expect(capped.log).toEqual(new Map([[100, 1], [150, 2]]));
    const free = run({});
    expect(free.splits).toBe(1);
    expect(free.log.get(101)).toBe(2);
  });

  it('two ready cells of one body cannot both release at the last step before 2^32 (the record does not wrap to 0)', () => {
    const { w, rest, rel, relBack } = world({ releaseGap: 5 });
    const cells = body(w, 4, rest, rel);
    w.pid[cells[0]] = relBack;
    w.step = 4294967295;
    w.stepOnce();
    expect(w.releases).toBe(1);
    expect(w.releasesHeld).toBe(1);
    expect(w.relRec[cells[3]]).toBe(4294967296);
    expect(w.census().residual).toBe(0);
  });

  it('a released daughter has no cooldown: it can release at once, and the record is its own afterwards', () => {
    const { w, rel } = world({ releaseGap: 1000 });
    const c = spawn(w, 8 * U, 8 * U, SITTER, 4000, rel);
    w.advance(1);
    expect(w.releases).toBe(1);
    const d = w.events.births[0];
    expect(w.relRec[c]).toBe(1);
    expect(w.relRec[d]).toBe(0);
    w.advance(1);
    expect(w.releases).toBe(2);
    expect(w.relRec[d]).toBe(2);
    // Its mother's place was taken by that daughter, so her attempt is blocked, not held: nothing is counted for her.
    expect(w.releasesHeld).toBe(0);
    expect(w.census().residual).toBe(0);
  });

  it('checkInvariants notices a broken release record', () => {
    const { w, rest, rel } = world({ releaseGap: 20 });
    const cells = body(w, 3, rest, rel);
    w.advance(5);
    w.checkInvariants();
    const keep = w.relRec[cells[0]];
    w.relRec[cells[0]] = 9999;
    expect(() => w.checkInvariants()).toThrow(/release record/);
    w.relRec[cells[0]] = keep + 1;
    expect(() => w.checkInvariants()).toThrow(/release record/);
    w.relRec[cells[0]] = keep;
    w.checkInvariants();
    const off = world({});
    body(off.w, 3, off.rest, off.rel);
    off.w.relRec[0] = 3;
    expect(() => off.w.checkInvariants()).toThrow(/release record/);
  });

  it('a kept daughter copies her mother\'s record', () => {
    const { w, rest } = world({ releaseGap: 10 });
    const keeper = w.addPlan(Array.from({ length: 16 }, (_, m) => planEntry(m === 0 ? 0 : 8, 0, 8)));
    const cells = chain(w, rest, 4 * U, 8 * U, U, 0, [P], 400, SITTER);
    w.pid[cells[0]] = keeper;
    w.relRec[cells[0]] = 77;
    w.advance(1);
    const d = w.events.births[0];
    expect(w.mother[d]).toBe(cells[0]);
    expect(w.relRec[d]).toBe(77);
  });

  it('a release held by releaseMin and also blocked by blockedAt adds nothing to releasesHeld, and counts once the place is free', () => {
    const { w, rest, rel } = world({ releaseMin: 5 });
    const cells = body(w, 3, rest, rel);
    const tip = cells[2];
    const blocker = spawn(w, w.x[tip] + U, w.y[tip], SITTER, 150, rest);
    w.advance(3);
    expect(w.releases).toBe(0);
    expect(w.releasesHeld).toBe(0);
    w.x[blocker] += 6 * U;
    w.advance(1);
    expect(w.releasesHeld).toBe(1);
    expect(w.releases).toBe(0);
  });

  it('a release that waits for a free slot is not counted as held either', () => {
    const { w, rest, rel } = world({ releaseMin: 5, maxCells: 3 });
    const cells = body(w, 3, rest, rel);
    expect(cells.length).toBe(3);
    w.advance(2);
    expect(w.releasesHeld).toBe(0);
    expect(w.releases).toBe(0);
  });

  it('the cap changes nothing it should not: a body that is big enough and old enough releases as it does without the keys', () => {
    const a = world({});
    const b = world({ releaseMin: 3, releaseGap: 1 });
    const ca = body(a.w, 3, a.rest, a.rel);
    const cb = body(b.w, 3, b.rest, b.rel);
    const la = releaseLog(a.w, ca, a.rest, 20);
    const lb = releaseLog(b.w, cb, b.rest, 20);
    expect(lb).toEqual(la);
  });

  it('the new state enters the digest only when its key is set', () => {
    const a = world({});
    const b = world({});
    const ca = body(a.w, 3, a.rest, a.rel);
    body(b.w, 3, b.rest, b.rel);
    a.w.advance(5);
    b.w.advance(5);
    const before = a.w.digest();
    expect(b.w.digest()).toBe(before);
    // Poking the record changes nothing the digest reads when releaseGap is off.
    a.w.relRec[ca[0]] = 12345;
    expect(a.w.digest()).toBe(before);
    const c = world({ releaseGap: 5 });
    const cc = body(c.w, 3, c.rest, c.rel);
    c.w.advance(1);
    const d1 = c.w.digest();
    c.w.relRec[cc[0]] = 9999;
    expect(c.w.digest()).not.toBe(d1);
    // A record that differs only above 32 bits (a release at step 2^32 against none) is a live cooldown and must not hash alike.
    c.w.relRec[cc[0]] = 0;
    const lo = c.w.digest();
    c.w.relRec[cc[0]] = 2 ** 32;
    expect(c.w.digest()).not.toBe(lo);
  });
});

describe('soft roam hunting: long runs', () => {
  for (const seed of [1, 2]) {
    it(`residual 0 and every invariant over 3000 steps on seed ${seed} with everything on`, () => {
      const w = foundSoftRoam({ seed, size: 64, start: 'garden', overrides: { truce: true, jaws: true, sight: 5, fear: 4, releaseMin: 3, releaseGap: 20 } });
      let hunting = 0;
      let fleeing = 0;
      for (let s = 0; s < 3000; s++) {
        w.stepOnce();
        if (s % 50 === 49) {
          const c = w.census();
          expect(c.residual).toBe(0);
          hunting += c.hunting;
          fleeing += c.fleeing;
          w.checkInvariants();
        }
      }
      const c = w.census();
      expect(c.residual).toBe(0);
      expect(c.alarmBonds).toBe(0);
      expect(c.cells).toBeGreaterThan(0);
      expect(hunting + fleeing + c.releasesHeld).toBeGreaterThan(0);
    });
  }
});
