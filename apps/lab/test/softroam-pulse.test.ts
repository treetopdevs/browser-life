import { describe, expect, it } from 'vitest';
import { foundSoftRoam, PULSE_SPREAD, softPulseDraw, softRoamConfig } from '../src/softroam/view.ts';
import { defaultSoftRoamConfig, KIND_LEAF, KIND_MOUTH, KIND_PLAIN, planEntry, PULSE_IN, PULSE_ONE, PULSE_W, softPulseStill, SOFT_U, type SoftRoamConfig, SoftRoamWorld } from '../src/softroam/kernel.ts';

/**
 * Soft Roam inner pulse (2026-11-26): a small heritable network in every cell and two signals along the bonds, whose outputs hold back the
 * cell's thrust and change the rest length of its springs. Small hand-built worlds first, then a run with everything on.
 */

const U = SOFT_U;
const genesOf = (chase: number, drive = 0): number[] => [chase, drive, -512, 0, 0];
const SITTER = genesOf(0);
const P = KIND_PLAIN;
const M = KIND_MOUTH;
/** Rows of a network. */
const A = 0, B = 1, GO = 2, FLEX = 3;
/** Inputs. */
const ONE = 0, OWN_A = 1, OWN_B = 2, MUM_A = 3, KIDS_A = 5, FULL = 7, STRETCH = 8, AIM = 9;
const net = (set: Array<[row: number, input: number, weight: number]>, base = softPulseStill()): number[] => {
  const w = [...base];
  for (const [r, i, v] of set) w[r * PULSE_IN + i] = v;
  return w;
};

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
  pulse: true,
  pulseMut: 0,
  ...over,
});
const restPlan = (w: SoftRoamWorld): number => w.addPlan(Array.from({ length: 16 }, (_, m) => planEntry(8, 0, m)));

type Priv = { _reverseScan: boolean; allocate(): number; place(c: number, x: number, y: number, g: readonly number[], f: number, s: number, p: number): void; labelHi: number };
const priv = (w: SoftRoamWorld): Priv => w as unknown as Priv;

/** A cell put straight into the world as a one-cell body, with a network. */
function spawn(w: SoftRoamWorld, px: number, py: number, genes: readonly number[], store: number, plan: number, weights: readonly number[] = softPulseStill(), kind = P): number {
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
  if (w.cfg.pulse === true) w.setPulse(c, weights);
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
/** A chain of n cells one bond apart along x, each the daughter of the one before; every cell gets `weights(i)`. */
function chain(w: SoftRoamWorld, n: number, weights: (i: number) => readonly number[], genes: readonly number[] = SITTER): number[] {
  const plan = restPlan(w);
  const cells: number[] = [];
  for (let i = 0; i < n; i++) {
    const c = spawn(w, (4 + i) * U, 8 * U, genes, 150, plan, weights(i));
    if (i > 0) link(w, c, cells[i - 1], i, 0);
    cells.push(c);
  }
  return cells;
}

describe('soft roam inner pulse: the keys', () => {
  it('refuses its numbers without pulse, a pulse that is not true, and a flex past a half', () => {
    const base = { ...still(), pulse: undefined, pulseMut: undefined };
    for (const k of ['pulseThrust', 'pulseFlex', 'pulseMut'] as const) expect(() => new SoftRoamWorld({ ...base, [k]: 0.1 })).toThrow(`${k} needs pulse`);
    expect(() => new SoftRoamWorld({ ...base, pulse: false as unknown as true })).toThrow('pulse is true or absent');
    expect(() => new SoftRoamWorld(still({ pulseFlex: 0.6 }))).toThrow('Invalid pulseFlex');
    expect(() => new SoftRoamWorld(still({ pulseThrust: 1.5 }))).toThrow('Invalid pulseThrust');
    const flat = new SoftRoamWorld(base);
    expect(flat.pulseW.length).toBe(0);
    expect(flat.census().pulseGo).toBe(256);
    const c = flat.found(8 * U, 8 * U, SITTER, 1, 150, restPlan(flat));
    expect(() => flat.setPulse(c, softPulseStill())).toThrow('setPulse needs pulse');
  });

  it('takes a network only for a one-cell founder, whole weights from -127 to 127', () => {
    const w = new SoftRoamWorld(still());
    const [a, b] = chain(w, 2, () => softPulseStill());
    expect(() => w.setPulse(b, softPulseStill())).toThrow('one-cell founder');
    expect(() => w.setPulse(a, softPulseStill())).toThrow('one-cell founder');
    const c = w.found(12 * U, 12 * U, SITTER, 1, 150, restPlan(w));
    expect(Array.from(w.pulseW.subarray(c * PULSE_W, (c + 1) * PULSE_W))).toEqual(softPulseStill());
    expect(() => w.setPulse(c, [1, 2])).toThrow(`needs ${PULSE_W} weights`);
    expect(() => w.setPulse(c, net([[A, ONE, 128]]))).toThrow('Invalid weight');
    expect(() => w.setPulse(c, net([[A, ONE, 0.5]]))).toThrow('Invalid weight');
    w.setPulse(c, net([[A, ONE, -127]]));
    expect(w.pulseW[c * PULSE_W]).toBe(-127);
  });
});

describe('soft roam inner pulse: signals', () => {
  it('a signal goes down one bond a step from the mother, and up one bond a step from the daughters', () => {
    // Down: the root's A is set by the constant input; every other cell's next A is its mother's A.
    const down = new SoftRoamWorld(still());
    const cd = chain(down, 4, (i) => (i === 0 ? net([[A, ONE, PULSE_ONE]]) : net([[A, MUM_A, PULSE_ONE]])));
    const seen: number[][] = [];
    for (let t = 0; t < 5; t++) { down.stepOnce(); seen.push(cd.map((c) => down.sigA[c])); }
    expect(seen).toEqual([[127, 0, 0, 0], [127, 127, 0, 0], [127, 127, 127, 0], [127, 127, 127, 127], [127, 127, 127, 127]]);
    // Up: the tip's A is set; every other cell's next A is the mean of its daughters'.
    const up = new SoftRoamWorld(still());
    const cu = chain(up, 4, (i) => (i === 3 ? net([[A, ONE, -PULSE_ONE]]) : net([[A, KIDS_A, PULSE_ONE]])));
    const seenUp: number[][] = [];
    for (let t = 0; t < 4; t++) { up.stepOnce(); seenUp.push(cu.map((c) => up.sigA[c])); }
    expect(seenUp).toEqual([[0, 0, 0, -127], [0, 0, -127, -127], [0, -127, -127, -127], [-127, -127, -127, -127]]);
    expect(down.census().pulsing).toBe(0);
  });

  it('a mother reads the truncated mean of her daughters, whatever their slots', () => {
    const mean = (rev: boolean): number => {
      const w = new SoftRoamWorld(still());
      if (rev) w._testSlotOrder([...Array(64).keys()].reverse());
      const plan = restPlan(w);
      const m = spawn(w, 8 * U, 8 * U, SITTER, 150, plan, net([[B, KIDS_A, PULSE_ONE]]));
      const vals = [100, -30, 7];
      vals.forEach((v, k) => {
        // Each daughter holds its A at v: v * 64 / 127 would not be whole, so it is set from its own A and started there.
        const d = spawn(w, (8 + [1, 0, -1][k]) * U, (8 + [0, 1, 0][k]) * U, SITTER, 150, plan, net([[A, OWN_A, PULSE_ONE]]));
        link(w, d, m, [1, 0, -1][k], [0, 1, 0][k]);
        w.sigA[d] = v;
      });
      w.stepOnce();
      return w.sigB[m];
    };
    expect(mean(false)).toBe(Math.trunc((100 - 30 + 7) / 3));
    expect(mean(true)).toBe(mean(false));
  });

  it('reads how full the cell is, the stretch of its bond and its body\'s aim', () => {
    const w = new SoftRoamWorld(still({ birthStore: 100, minStore: 20 }));
    const plan = restPlan(w);
    // A = fullness, B = stretch.
    const read = net([[A, FULL, PULSE_ONE], [B, STRETCH, PULSE_ONE]]);
    const stores = [20, 110, 200, 5000];
    const cells = stores.map((s, k) => spawn(w, (2 + 3 * k) * U, 3 * U, SITTER, s, plan, read));
    // A daughter held 1.25 bonds from her mother, and one at 0.5.
    const m = spawn(w, 4 * U, 10 * U, SITTER, 150, plan, read);
    const far = spawn(w, 4 * U + 1280, 10 * U, SITTER, 150, plan, read);
    link(w, far, m, 1, 0);
    const near = spawn(w, 4 * U, 10 * U + 512, SITTER, 150, plan, read);
    link(w, near, m, 0, 1);
    w.stepOnce();
    expect(cells.map((c) => w.sigA[c])).toEqual([-127, Math.floor((90 * 254) / 180) - 127, 127, 127]);
    expect(w.sigB[m]).toBe(0);
    expect(w.sigB[far]).toBe(Math.trunc((256 * 254) / 1024));
    expect(w.sigB[near]).toBe(Math.trunc((-512 * 254) / 1024));
    expect(cells.map((c) => w.sigB[c])).toEqual([0, 0, 0, 0]);
  });

  it('with steer, the aim input is 127 for a hunter with prey in sight and -127 for prey that sees it', () => {
    const w = new SoftRoamWorld(still({ kinds: true, drain: 3, seal: 0, sight: 6, fear: 3, steer: true }));
    const plan = restPlan(w);
    const read = net([[A, AIM, PULSE_ONE]]);
    const h0 = spawn(w, 4 * U, 8 * U, genesOf(256), 150, plan, read, M);
    const h1 = spawn(w, 3 * U, 8 * U, genesOf(256), 150, plan, read, M);
    link(w, h1, h0, -1, 0);
    const prey = spawn(w, 6 * U + 512, 8 * U, genesOf(256), 150, plan, read, P);
    const alone = spawn(w, 12 * U, 0, genesOf(256), 150, plan, read, P);
    w.stepOnce();
    expect(w.sigA[h0]).toBe(127);
    expect(w.sigA[h1]).toBe(127);
    expect(w.sigA[prey]).toBe(-127);
    expect(w.sigA[alone]).toBe(0);
  });

  it('a hand-built two-signal rotation beats with no clock, and stays still when nothing starts it', () => {
    // A and B turn into each other by an eighth of a turn a step with a gain a little over one; the bound keeps it from growing.
    const turn: Array<[number, number, number]> = [[A, OWN_A, 48], [A, OWN_B, -48], [B, OWN_A, 48], [B, OWN_B, 48]];
    const w = new SoftRoamWorld(still());
    const plan = restPlan(w);
    const kicked = spawn(w, 4 * U, 4 * U, SITTER, 150, plan, net([...turn, [A, ONE, 8]]));
    const quiet = spawn(w, 12 * U, 12 * U, SITTER, 150, plan, net(turn));
    const series: number[] = [];
    for (let t = 0; t < 200; t++) { w.stepOnce(); series.push(w.sigA[kicked]); expect(w.sigA[quiet]).toBe(0); }
    const late = series.slice(100);
    expect(Math.max(...late)).toBeGreaterThan(90);
    expect(Math.min(...late)).toBeLessThan(-90);
    // Sign changes: about two a turn of eight steps.
    let flips = 0;
    for (let t = 1; t < late.length; t++) if ((late[t] > 0) !== (late[t - 1] > 0)) flips++;
    expect(flips).toBeGreaterThanOrEqual(20);
    expect(flips).toBeLessThanOrEqual(30);
    expect(w.census().pulsing).toBe(1);
  });
});

describe('soft roam inner pulse: what the outputs do', () => {
  const DRIVER = genesOf(0, 512);
  const thrustOf = (weights: readonly number[], over: Partial<SoftRoamConfig> = {}): { tx: number; ty: number; store: number; moved: number } => {
    const w = new SoftRoamWorld(still({ moveCost: 0.5, ...over }));
    const c = spawn(w, 8 * U, 8 * U, DRIVER, 1000, restPlan(w), weights);
    w.heading[c] = 100;
    const t = w as unknown as { tx: Int32Array; ty: Int32Array };
    w.stepOnce();
    return { tx: t.tx[c], ty: t.ty[c], store: w.store[c], moved: Math.hypot(w.dlt(8 * U, w.x[c]), w.dlt(8 * U, w.y[c])) };
  };

  it('go holds the thrust back and never adds to it, and a slower cell pays less', () => {
    const off = thrustOf(softPulseStill(), { pulse: undefined, pulseMut: undefined });
    const full = thrustOf(softPulseStill());
    expect(full).toEqual(off);
    const over = thrustOf(net([[GO, ONE, 127]]));
    expect(over).toEqual(off);
    const none = thrustOf(net([[GO, ONE, -PULSE_ONE]]), { pulseThrust: 1 });
    expect([none.tx, none.ty, none.moved]).toEqual([0, 0, 0]);
    expect(none.store).toBe(1000);
    // Go 0 at the default share (a half): the thrust is 256 - floor(128 * 127 / 254) = 192 256ths, component by component.
    const half = thrustOf(net([[GO, ONE, 0]]));
    expect(half.tx).toBe(Math.trunc((off.tx * 192) / 256));
    expect(half.ty).toBe(Math.trunc((off.ty * 192) / 256));
    expect(1000 - half.store).toBeLessThanOrEqual(1000 - off.store);
    expect(half.moved).toBeLessThan(off.moved);
    const zero = thrustOf(net([[GO, ONE, -PULSE_ONE]]), { pulseThrust: 0 });
    expect(zero).toEqual(off);
  });

  it('flex sets the length two bonded cells settle at, by both ends together', () => {
    const settle = (fa: number, fb: number, pulseFlex?: number): number => {
      const w = new SoftRoamWorld(still(pulseFlex === undefined ? {} : { pulseFlex }));
      const [a, b] = chain(w, 2, (i) => net([[FLEX, ONE, i === 0 ? fa : fb]]));
      for (let t = 0; t < 300; t++) w.stepOnce();
      expect(w.alarms()).toEqual({ bonds: 0, overlap: 0, speed: 0 });
      return Math.hypot(w.dlt(w.x[a], w.x[b]), w.dlt(w.y[a], w.y[b]));
    };
    expect(settle(0, 0)).toBeCloseTo(1024, -1);
    // Both ends fully long at the default quarter: 1024 + 1024 / 4. Both short at a half: 512. One long, one short: no change.
    expect(settle(PULSE_ONE, PULSE_ONE)).toBeCloseTo(1280, -1);
    expect(settle(-PULSE_ONE, -PULSE_ONE, 0.5)).toBeCloseTo(512, -1);
    expect(settle(PULSE_ONE, -PULSE_ONE, 0.5)).toBeCloseTo(1024, -1);
    expect(settle(PULSE_ONE, 0, 0.5)).toBeCloseTo(1280, -1);
    expect(settle(-PULSE_ONE, -PULSE_ONE, 0)).toBeCloseTo(1024, -1);
  });

  it('a body whose flex follows a beat squeezes and stretches, and its middle stays where it was', () => {
    const turn: Array<[number, number, number]> = [[A, OWN_A, 48], [A, OWN_B, -48], [B, OWN_A, 48], [B, OWN_B, 48], [A, ONE, 8], [FLEX, OWN_A, PULSE_ONE]];
    const w = new SoftRoamWorld(still({ pulseFlex: 0.5 }));
    const cells = chain(w, 4, () => net(turn));
    const mid = (): number => cells.reduce((s, c) => s + w.dlt(8 * U, w.x[c]), 0) / 4;
    const at = mid();
    let lo = Infinity, hi = -Infinity;
    for (let t = 0; t < 300; t++) {
      w.stepOnce();
      if (t < 100) continue;
      const len = Math.abs(w.dlt(w.x[cells[0]], w.x[cells[3]]));
      lo = Math.min(lo, len); hi = Math.max(hi, len);
      expect(w.alarms().bonds).toBe(0);
    }
    expect(hi - lo).toBeGreaterThan(300);
    // Springs push both ends alike: whatever the rounding leaves over 300 steps is a small part of a tile.
    expect(Math.abs(mid() - at)).toBeLessThan(64);
    w.checkInvariants();
    expect(w.census().residual).toBe(0);
  });
});

describe('soft roam inner pulse: heredity', () => {
  const grower = (w: SoftRoamWorld): number => w.addPlan(Array.from({ length: 16 }, (_, m) => (m === 0 ? planEntry(0, 15, 15) : planEntry(8, 0, m))));
  const birth = (pulseMut: number): { mother: number[]; daughter: number[]; sig: number[] } => {
    const w = new SoftRoamWorld(still({ pulseMut }));
    const weights = softPulseDraw(7, 3, 100);
    const a = w.found(8 * U, 8 * U, SITTER, 1, 400, grower(w));
    // The mother holds her signals (each set from itself), so the daughter's can be compared a step later.
    w.setPulse(a, net([[A, OWN_A, PULSE_ONE], [B, OWN_B, PULSE_ONE]], weights.map((v, i) => (i < 2 * PULSE_IN ? 0 : v))));
    w.sigA[a] = 55; w.sigB[a] = -21;
    let d = -1;
    for (let t = 0; t < 30 && d < 0; t++) { w.stepOnce(); for (let c = 0; c < w.cap; c++) if (w.alive[c] && c !== a) d = c; }
    expect(d).toBeGreaterThanOrEqual(0);
    return { mother: Array.from(w.pulseW.subarray(a * PULSE_W, (a + 1) * PULSE_W)), daughter: Array.from(w.pulseW.subarray(d * PULSE_W, (d + 1) * PULSE_W)), sig: [w.sigA[d], w.sigB[d]] };
  };

  it('a daughter gets her mother\'s network and signals; with a copy error exactly one weight moves by 16', () => {
    const exact = birth(0);
    expect(exact.daughter).toEqual(exact.mother);
    expect(exact.sig).toEqual([55, -21]);
    const moved = birth(1);
    const diff = moved.daughter.map((v, i) => v - moved.mother[i]).filter((v) => v !== 0);
    expect(diff.length).toBeLessThanOrEqual(1);
    // (A weight already at the bound that is pushed further does not move.)
    if (diff.length === 1) expect(Math.abs(diff[0])).toBeLessThanOrEqual(16);
    const many = [1, 2, 3, 4, 5].map((seed) => {
      const w = new SoftRoamWorld(still({ pulseMut: 1, seed }));
      const a = w.found(8 * U, 8 * U, SITTER, 1, 400, grower(w));
      for (let t = 0; t < 30; t++) w.stepOnce();
      let n = 0;
      for (let c = 0; c < w.cap; c++) if (w.alive[c] && c !== a) for (let i = 0; i < PULSE_W; i++) if (w.pulseW[c * PULSE_W + i] !== softPulseStill()[i]) { n++; expect(Math.abs(w.pulseW[c * PULSE_W + i] - softPulseStill()[i])).toBe(16); }
      return n;
    });
    expect(many.every((n) => n === 1)).toBe(true);
  });

  it('a slot used again starts with the still network and no signal', () => {
    const w = new SoftRoamWorld(still({ life: 5, maxCells: 1 }));
    const plan = restPlan(w);
    const c = w.found(8 * U, 8 * U, SITTER, 1, 150, plan);
    w.setPulse(c, softPulseDraw(1, 1, 127));
    w.sigA[c] = 99;
    for (let t = 0; t < 40 && w.alive[c]; t++) w.stepOnce();
    expect(w.alive[c]).toBe(0);
    const again = w.found(4 * U, 4 * U, SITTER, 1, 150, plan);
    expect(again).toBe(c);
    expect(Array.from(w.pulseW.subarray(c * PULSE_W, (c + 1) * PULSE_W))).toEqual(softPulseStill());
    expect([w.sigA[c], w.sigB[c], w.pulseGo[c], w.pulseFlex[c]]).toEqual([0, 0, 127, 0]);
    expect(w.census().pulsing).toBe(0);
  });
});

describe('soft roam inner pulse: whole worlds', () => {
  it('with still networks and no copy errors the world moves exactly as without the pulse', () => {
    const run = (pulse: boolean): { x: number[]; y: number[]; store: number[]; cells: number; residual: number } => {
      const w = foundSoftRoam({ seed: 5, size: 48, start: 'bodies', ...(pulse ? { pulse: true, pulseSpread: 0, pulseMut: 0 } : {}) });
      for (let t = 0; t < 500; t++) w.stepOnce();
      const cs = w.census();
      return { x: Array.from(w.x), y: Array.from(w.y), store: Array.from(w.store), cells: cs.cells, residual: cs.residual };
    };
    const off = run(false);
    expect(off.cells).toBeGreaterThan(15);
    expect(run(true)).toEqual(off);
  });

  it('a start gives each founder its own network, the same for the same seed, and leaves a world without the pulse alone', () => {
    const w = foundSoftRoam({ seed: 3, size: 64, start: 'bodies', pulse: true });
    expect(w.cfg.pulse).toBe(true);
    const nets = new Set<string>();
    let k = 0;
    for (let c = 0; c < w.cap; c++) {
      if (!w.alive[c]) continue;
      const got = Array.from(w.pulseW.subarray(c * PULSE_W, (c + 1) * PULSE_W));
      nets.add(got.join());
      got.forEach((v, i) => { expect(Math.abs(v - (i === 2 * PULSE_IN ? PULSE_ONE : 0))).toBeLessThanOrEqual(PULSE_SPREAD); });
      k++;
    }
    expect(nets.size).toBe(k);
    expect(nets.has(softPulseDraw(3, 0, PULSE_SPREAD).join())).toBe(true);
    expect(softRoamConfig({ seed: 3, size: 64, start: 'bodies' }).pulse).toBeUndefined();
    expect(softRoamConfig({ seed: 3, size: 64, start: 'bodies', pulseFlex: 0.1 }).pulseFlex).toBeUndefined();
    expect(softRoamConfig({ seed: 3, size: 64, start: 'deep', pulse: true, pulseFlex: 0.1, pulseThrust: 1, pulseMut: 0 })).toMatchObject({ pulse: true, depth: 3, pulseFlex: 0.1, pulseThrust: 1, pulseMut: 0 });
    expect(() => foundSoftRoam({ seed: 3, size: 64, start: 'bodies', pulse: true, pulseSpread: 200 })).toThrow('Invalid pulseSpread');
  });

  it('keeps matter exactly, raises no alarm at full flex, and has one history whatever the slot and scan order', () => {
    const run = (rev: boolean): { digest: number; cells: number; pulsing: number; go: number } => {
      const w = new SoftRoamWorld(still({ size: 24, matter: 200_000, maxCells: 512, kinds: true, drain: 3, seal: 0, sight: 6, fear: 3, steer: true, pack: 2, crowd: 2, heal: true, pace: 0.25, shellThrust: 0.5, leakCell: 0.01, life: 400, grip: 64, birthStore: 40, startPatches: 6, patchEvery: 20, patchFood: 2000, turnMax: 1 / 32, planMut: 0.05, mut: 0.05,
        day: 100, year: 400, winter: 0.2, leaf: 1, leafPool: 0.5, leafPoolMax: 500, patchSeason: true, winterCost: 0.05, truce: true, compost: true, depth: 3, depthGap: 20, depthDive: 1, pulseFlex: 0.5, pulseThrust: 1, pulseMut: 0.5 }));
      if (rev) w._testSlotOrder([...Array(512).keys()].reverse());
      priv(w)._reverseScan = rev;
      const grow = w.addPlan(Array.from({ length: 16 }, (_, m) => (m === 0 ? planEntry(0, 1, 2, P) : m === 1 ? planEntry(0, 15, 15, M) : m === 2 ? planEntry(1, 15, 3, KIND_LEAF) : m === 3 ? planEntry(2, 15, 4, P) : m === 4 ? planEntry(7, 0, 4, P) : planEntry(8, 0, m))));
      for (let k = 0; k < 12; k++) {
        const c = w.found(((k * 7) % 24) * U + 300, ((k * 11) % 24) * U + 300, genesOf(256 - 64 * (k % 3), 128), 1 + (k % 3), 300, grow);
        w.setLevel(c, k % 3);
        w.setPulse(c, softPulseDraw(9, k, 100));
      }
      let pulsing = 0;
      for (let t = 0; t < 600; t++) {
        w.stepOnce();
        if (t % 50 === 0) { w.checkInvariants(); expect(w.alarms(), `step ${t}`).toEqual({ bonds: 0, overlap: 0, speed: 0 }); pulsing += w.census().pulsing; }
      }
      w.checkInvariants();
      const cs = w.census();
      expect(cs.residual).toBe(0);
      return { digest: w.digest(), cells: cs.cells, pulsing, go: cs.pulseGo };
    };
    const a = run(false);
    expect(run(true)).toEqual(a);
    expect(a.cells).toBeGreaterThan(12);
    expect(a.pulsing).toBeGreaterThan(0);
    expect(a.go).toBeLessThan(256);
  });
});
