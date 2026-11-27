import { describe, expect, it } from 'vitest';
import { defaultSoftRoamConfig, KIND_MOUTH, KIND_PLAIN, KIND_SHELL, planEntry, SOFT_U, type SoftRoamConfig, SoftRoamWorld } from '../src/softroam/kernel.ts';
import { foundSoftRoam, paintSoftRoam, SoftPaintMemory } from '../src/softroam/view.ts';

/**
 * Soft Roam chunk 4 (CONTRACT-4.md): `pace` (a fed body slows down; never while it has an aim), `shellThrust` (armour is heavy) and the
 * bodies start's founder drive spread; and `ateFromGround`, what the picture reads to draw grazing.
 */

const U = SOFT_U;
const P = KIND_PLAIN;
const genesOf = (chase: number, drive: number): number[] => [chase, drive, -512, 0, 0];

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
type Priv = { tx: Int32Array; ty: Int32Array; labelHi: number; allocate(): number; place(c: number, x: number, y: number, g: readonly number[], f: number, s: number, p: number): void };
const priv = (w: SoftRoamWorld): Priv => w as unknown as Priv;

function spawn(w: SoftRoamWorld, px: number, py: number, genes: readonly number[], store: number, plan: number, kind = P): number {
  const a = priv(w);
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
function link(w: SoftRoamWorld, c: number, m: number, gx: number, gy: number): void {
  w.bodySize[w.body[c]]--;
  w.bodyCount--;
  w.mother[c] = m;
  w.body[c] = w.body[m];
  w.bodySize[w.body[m]]++;
  w.gx[c] = gx;
  w.gy[c] = gy;
}

describe('soft roam chunk 4: config checks', () => {
  it('refuses shares outside 0 to 1 and armour without kinds', () => {
    const make = (o: Partial<SoftRoamConfig>) => () => new SoftRoamWorld(still(o));
    expect(make({ pace: 1.5 })).toThrow(/Invalid pace/);
    expect(make({ pace: -0.1 })).toThrow(/Invalid pace/);
    expect(make({ shellThrust: 2 })).toThrow(/Invalid shellThrust/);
    expect(make({ kinds: undefined, drain: undefined, seal: undefined, shellThrust: 0.5 })).toThrow(/shellThrust needs kinds/);
    expect(make({ pace: 0, shellThrust: 0 })).not.toThrow();
  });
  it('the bodies start refuses a drive spread below 1 or above 8', () => {
    expect(() => foundSoftRoam({ seed: 1, size: 32, start: 'bodies', driveSpread: 0.5 })).toThrow(/Invalid driveSpread/);
    expect(() => foundSoftRoam({ seed: 1, size: 32, start: 'bodies', driveSpread: 9 })).toThrow(/Invalid driveSpread/);
  });
});

describe('soft roam chunk 4: pace', () => {
  /** The thrust (x) a lone plain cell heading east with drive 256 asks for, with this store. Drive 256 is u = 512 along the heading. */
  const thrust = (store: number, over: Partial<SoftRoamConfig>): number => {
    const w = new SoftRoamWorld(still({ birthStore: 100, ...over }));
    const c = spawn(w, 8 * U, 8 * U, genesOf(0, 256), store, restPlan(w));
    w._commandsOnly();
    expect(priv(w).ty[c]).toBe(0);
    return priv(w).tx[c];
  };
  it('a hungry body thrusts in full, a body ready to divide at pace, and in proportion between', () => {
    expect(thrust(1, {})).toBe(512);
    expect(thrust(1, { pace: 0.25 })).toBe(512);
    // Ready to divide (2 birthStore = 200, and beyond): a quarter.
    expect(thrust(200, { pace: 0.25 })).toBe(128);
    expect(thrust(400, { pace: 0.25 })).toBe(128);
    // Half way from minStore 1 to 200 (mean 100: q = floor(99 * 256 / 199) = 127): 256 - floor(192 * 127 / 256) = 161 of 256.
    expect(thrust(100, { pace: 0.25 })).toBe(Math.trunc((512 * 161) / 256));
    // Pace 1 is no slowing; pace 0 stops a full body.
    expect(thrust(200, { pace: 1 })).toBe(512);
    expect(thrust(200, { pace: 0 })).toBe(0);
  });
  it('a body goes by its mean store: a hungry cell and a full one in one body get the same share, from their mean', () => {
    const w = new SoftRoamWorld(still({ birthStore: 100, pace: 0.25 }));
    const plan = restPlan(w);
    // Stores 1 and 399: mean 200, ready to divide, so both thrust at a quarter (by its own store the first would go in full).
    const a = spawn(w, 6 * U, 8 * U, genesOf(0, 256), 1, plan);
    const b = spawn(w, 7 * U, 8 * U, genesOf(0, 256), 399, plan);
    link(w, b, a, 1, 0);
    const lone = spawn(w, 6 * U, 12 * U, genesOf(0, 256), 1, plan);
    w._commandsOnly();
    expect([priv(w).tx[a], priv(w).tx[b], priv(w).tx[lone]]).toEqual([128, 128, 512]);
  });
  it('a full body with an aim (steer) keeps its whole thrust; the same body with nothing in sight slows', () => {
    const run = (prey: boolean): number => {
      const w = new SoftRoamWorld(still({ size: 32, birthStore: 100, sight: 8, steer: true, pace: 0.25 }));
      const plan = restPlan(w);
      const p = spawn(w, 8 * U, 8 * U, genesOf(256, 256), 400, plan);
      const m = spawn(w, 9 * U, 8 * U, genesOf(256, 256), 400, plan, KIND_MOUTH);
      link(w, m, p, 1, 0);
      if (prey) spawn(w, 13 * U, 8 * U, genesOf(0, 0), 20, plan);
      w._commandsOnly();
      return priv(w).tx[p];
    };
    // The prey is due east: the aim adds 2 x 256 east to the drive's 512 east.
    expect(run(true)).toBe(1024);
    expect(run(false)).toBe(128);
  });
});

describe('soft roam chunk 4: shellThrust', () => {
  it('a shell cell thrusts at the share, a plain cell in the same body in full', () => {
    const w = new SoftRoamWorld(still({ shellThrust: 0.5 }));
    const plan = restPlan(w);
    const p = spawn(w, 6 * U, 8 * U, genesOf(0, 256), 50, plan);
    const s = spawn(w, 7 * U, 8 * U, genesOf(0, 256), 50, plan, KIND_SHELL);
    link(w, s, p, 1, 0);
    w._commandsOnly();
    expect([priv(w).tx[p], priv(w).tx[s]]).toEqual([512, 256]);
  });
});

describe('soft roam chunk 4: whole worlds', () => {
  it('pace 1 and shellThrust 1 make the same history as leaving them out', () => {
    const digest = (over: Partial<SoftRoamConfig>): number => {
      const w = foundSoftRoam({ seed: 2, size: 48, start: 'seasons', overrides: over });
      w.advance(400);
      return w.digest();
    };
    expect(digest({ pace: 1, shellThrust: 1 })).toBe(digest({}));
    expect(digest({ pace: 0.25, shellThrust: 0.5 })).not.toBe(digest({}));
  });
  it('the history does not depend on slots or scan order with both keys on, and matter balances', () => {
    const run = (rev: boolean): number => {
      const w = new SoftRoamWorld(still({ size: 24, matter: 200_000, maxCells: 512, sight: 6, fear: 3, steer: true, heal: true, leakCell: 0.01, birthStore: 40, startPatches: 6, patchEvery: 20, patchFood: 2000, turnMax: 1 / 32, planMut: 0.05, mut: 0.05, moveCost: 1 / 32, pace: 0.25, shellThrust: 0.5 }));
      if (rev) w._testSlotOrder([...Array(512).keys()].reverse());
      (w as unknown as { _reverseScan: boolean })._reverseScan = rev;
      const grow = w.addPlan(Array.from({ length: 16 }, (_, m) => (m === 0 ? planEntry(0, 1, 2, P) : m === 1 ? planEntry(0, 15, 15, KIND_MOUTH) : m === 2 ? planEntry(1, 15, 3, KIND_SHELL) : m === 3 ? planEntry(2, 15, 4, P) : m === 4 ? planEntry(7, 0, 4, P) : planEntry(8, 0, m))));
      for (let k = 0; k < 12; k++) w.found(((k * 7) % 24) * U + 300, ((k * 11) % 24) * U + 300, genesOf(256 - 64 * (k % 3), 64 + 64 * (k % 4)), 1 + (k % 3), 79, grow);
      for (let t = 0; t < 600; t++) w.stepOnce();
      expect(w.census().residual).toBe(0);
      expect(w.census().cells).toBeGreaterThan(0);
      w.checkInvariants();
      return w.digest();
    };
    expect(run(true)).toBe(run(false));
  });
  it('the bodies start spreads its founders\' drives, and a spread of 1 keeps the types\' own', () => {
    const drives = (spread?: number): number[] => {
      const w = foundSoftRoam({ seed: 3, size: 64, start: 'bodies', driveSpread: spread });
      const out: number[] = [];
      for (let c = 0; c < w.cap; c++) if (w.alive[c]) out.push(w.genes[c * 5 + 1]);
      return out;
    };
    expect(new Set(drives(1))).toEqual(new Set([64, 96]));
    const spread = drives();
    expect(new Set(spread).size).toBeGreaterThan(5);
    expect(Math.min(...spread)).toBeGreaterThanOrEqual(32);
    expect(Math.max(...spread)).toBeLessThanOrEqual(192);
  });
});

type Got = { gotCell: Uint32Array; place(c: number, x: number, y: number, g: readonly number[], f: number, s: number, p: number): void };
describe('soft roam chunk 4: what the picture reads', () => {
  it('ateFromGround is not in the digest, falls to 0 on a bare tile and is cleared when a slot is reused', () => {
    const w = new SoftRoamWorld(still({ bite: 3, kinds: undefined, drain: undefined, seal: undefined }));
    const plan = restPlan(w);
    const c = spawn(w, 4 * U + 500, 4 * U + 500, genesOf(0, 0), 20, plan);
    w.food[4 * w.size + 4] += 3;
    w.reservoir -= 3;
    w.stepOnce();
    expect(w.ateFromGround(c)).toBe(3);
    const d = w.digest();
    const g = (w as unknown as Got).gotCell;
    g[c] = 77;
    expect(w.digest()).toBe(d);
    g[c] = 3;
    // The tile is bare now: the next step reads 0.
    w.stepOnce();
    expect(w.ateFromGround(c)).toBe(0);
    // A slot that is reused shows nothing for its new cell.
    g[c] = 5;
    (w as unknown as Got).place(c, w.x[c], w.y[c], genesOf(0, 0), 0, w.store[c], plan);
    expect(w.ateFromGround(c)).toBe(0);
  });
  it('a grazing cell paints differently from the same world with its grazing taken out', () => {
    const w = new SoftRoamWorld(still({ size: 16, bite: 3 }));
    const plan = restPlan(w);
    const c = spawn(w, 8 * U + 500, 8 * U + 500, genesOf(0, 0), 20, plan);
    w.food[8 * w.size + 8] += 30;
    w.reservoir -= 30;
    w.stepOnce();
    expect(w.ateFromGround(c)).toBeGreaterThan(0);
    const paint = (): Uint8Array => { const o = new Uint8Array(16 * 6 * 16 * 6 * 4); paintSoftRoam(w, 'garden', 6, 0.5, o, new SoftPaintMemory()); return o; };
    const on = paint();
    const g = (w as unknown as Got).gotCell;
    const was = g[c];
    g[c] = 0;
    const off = paint();
    g[c] = was;
    expect(paint()).toEqual(on);
    expect(off).not.toEqual(on);
  });

  it('ateFromGround is what a cell took from its tile, 0 when it took nothing, and not part of the digest', () => {
    const w = new SoftRoamWorld(still({ bite: 3, kinds: undefined, drain: undefined, seal: undefined }));
    const plan = restPlan(w);
    const fed = spawn(w, 4 * U + 500, 4 * U + 500, genesOf(0, 0), 20, plan);
    const bare = spawn(w, 10 * U + 500, 10 * U + 500, genesOf(0, 0), 20, plan);
    w.food[4 * w.size + 4] += 50;
    w.reservoir -= 50;
    const before = w.store[fed];
    w.stepOnce();
    expect(w.ateFromGround(fed)).toBe(3);
    expect(w.store[fed] - before).toBeGreaterThanOrEqual(0);
    expect(w.ateFromGround(bare)).toBe(0);
    expect(w.census().residual).toBe(0);
  });
});
