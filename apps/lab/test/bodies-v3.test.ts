import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BodiesWorld, FOUNDER_GENOME, RULES, RULES_V1, RULES_V2, V3_KNOBS, census, hashState, hashStateFull, validateWorld } from '../src/bodies/model.ts';
import type { Genome, Rules, WorldOptions } from '../src/bodies/model.ts';
import { PatchTracker, kinPatches, kinStats, realMatch, seamStats } from '../src/bodies/observe.ts';
import { buildWorld, defaultOptions, parseArgs, runV3 } from '../../../experiments/bodies/v3.ts';

const SHAPE = [16, 60, 0, 0] as unknown as Genome;
const N = RULES.N;
const at = (x: number, y: number) => y * 96 + x;

/** Hand-built world: no founders, no supply, no upkeep, no food, no orphan rooting, so every effect is the one under test. */
function blank(rules: Partial<Rules> = {}, extra: Partial<WorldOptions> = {}): BodiesWorld {
  const w = new BodiesWorld({ seed: 1, founders: 1, positions: [], upkeep: false, rules: { SUPPLY: 0, ORPH16: 0, ORPHP: 0, ...rules }, ...extra });
  w.food.fill(0); w.initialMatter = w.matterTotal();
  return w;
}
function put(w: BodiesWorld, x: number, y: number, o: { store?: number; d?: number; kin?: number; tol?: number; g1?: number } = {}): number {
  const i = at(x, y);
  w.cell[i] = 1; w.store[i] = o.store ?? 0; w.d[i] = o.d ?? 255; w.kin[i] = o.kin ?? 0; w.kinTol[i] = o.tol ?? w.R.TAG_TOL;
  w.g0[i] = 16; w.g1[i] = o.g1 ?? 60; w.g2[i] = 0; w.g3[i] = 0;
  w.initialMatter = w.matterTotal();
  return i;
}

/** Contact start: three founders close enough to meet within a few hundred steps, with different marks. */
const CROWD: readonly (readonly [number, number])[] = [[40, 48], [54, 48], [47, 60]];
const crowd = (extra: Partial<WorldOptions> = {}, seed = 3) => new BodiesWorld({ seed, founders: 3, positions: CROWD, founderTags: [0, 100, 200], genome: FOUNDER_GENOME, mutRate: 0, tagMutRate: 2000, ...extra });
const STATE_ARRAYS = ['cell', 'food', 'store', 'd', 'g0', 'g1', 'g2', 'g3', 'tag'] as const;
const COUNTERS = ['t', 'supplied', 'burned', 'lostOverflow', 'lostWound', 'births', 'mutations', 'rootings', 'foraged', 'moved', 'rootsCreated', 'rootsEnded', 'rootLifeSum', 'nextTag'] as const;

describe('v3 with every knob at its default is exactly v1 / v2', () => {
  // hashes recorded from the untouched v2 model before rules v3 existed: 3 founders, seed 7, 1000 steps, injure(24,24,5), 1000 more steps
  const PINS: [1 | 2, number, boolean, number][] = [
    [2, 0, false, 420386212], [2, 3, false, 227576062], [2, 3, true, 3793411581], [2, 24, false, 4281492828], [1, 3, false, 836628414], [1, 3, true, 3216805905],
  ];
  it('matches the recorded v1 and v2 state hashes (mutation off/on, gene-blind, wound), with the v3 options present but zero', () => {
    for (const [version, mutRate, blind, pin] of PINS) {
      const w = new BodiesWorld({ seed: 7, founders: 3, genome: FOUNDER_GENOME, mutRate, blind, version, tagMutRate: 0, tagBlind: false, founderTags: [0, 0, 0] });
      w.step(1000); w.injure(24, 24, 5); w.step(1000);
      expect(hashState(w), `v${version} mut ${mutRate} blind ${blind}`).toBe(pin);
      expect(validateWorld(w)).toEqual([]);
    }
  });
  it('the existing single-founder pins are unchanged', () => {
    const f = new BodiesWorld({ seed: 1, founders: 1, genome: FOUNDER_GENOME, mutRate: 0, upkeep: false, version: 1 }); f.step(300); expect(hashState(f)).toBe(1878328071);
    const l = new BodiesWorld({ seed: 1, founders: 1, genome: SHAPE, mutRate: 0 }); l.step(300); expect(hashState(l)).toBe(501260932);
  });
  it('mark mutation alone (all gates off) moves marks but not the physics or the v2 hash', () => {
    const plain = crowd({ tagMutRate: 0 }), mut = crowd({ tagMutRate: 5000 });
    plain.step(800); mut.step(800);
    for (const k of STATE_ARRAYS) expect([...mut[k]], k).toEqual([...plain[k]]);
    for (const k of COUNTERS) expect(mut[k], k).toBe(plain[k]);
    expect(mut.hashState()).toBe(plain.hashState());
    expect(mut.tagMutations).toBeGreaterThan(5); expect(plain.tagMutations).toBe(0);
    expect(hashStateFull(mut)).not.toBe(hashStateFull(plain));
    expect(new Set(plain.kin.filter((_, i) => plain.cell[i])).size).toBe(3);
  });
  it('tagBlind with every gate, the seam cost and the raid on is physically the gates-off world', () => {
    const all: Partial<Rules> = { GATE_SHARE: 1, GATE_GROW: 1, GATE_SIGNAL: 1, SEAM_COST: 2, RAID: 3, TAG_TOL: 4 };
    const off = crowd({ tagMutRate: 3000 }), blind = crowd({ tagMutRate: 3000, tagBlind: true, rules: all }), live = crowd({ tagMutRate: 3000, rules: all });
    off.step(1500); blind.step(1500); live.step(1500);
    for (const k of STATE_ARRAYS) expect([...blind[k]], k).toEqual([...off[k]]);
    for (const k of COUNTERS) expect(blind[k], k).toBe(off[k]);
    expect(blind.hashState()).toBe(off.hashState());
    expect(blind.blockedGrow + blind.blockedBud + blind.raided + blind.seamBurned).toBe(0);
    expect([...blind.kin]).toEqual([...off.kin]);          // marks still mutate and are inherited identically
    expect(blind.tagMutations).toBeGreaterThan(5);
    expect(live.hashState()).not.toBe(off.hashState());    // and the same knobs without tagBlind really change the physics
  });
});

describe('v3 determinism', () => {
  it('same options give the same full hash, chunking does not matter, another seed differs', () => {
    const rules: Partial<Rules> = { GATE_SHARE: 1, GATE_GROW: 1, GATE_SIGNAL: 1, SEAM_COST: 1, RAID: 2, TAG_TOL_GENE: 1 };
    const a = crowd({ rules }), b = crowd({ rules }), c = crowd({ rules }, 4), d = crowd({ rules });
    a.step(700); b.step(700); c.step(700); for (let k = 0; k < 7; k++) d.step(100);
    expect(hashStateFull(a)).toBe(hashStateFull(b)); expect(hashStateFull(d)).toBe(hashStateFull(a)); expect(hashStateFull(c)).not.toBe(hashStateFull(a));
  });
});

describe('the match rule and founders', () => {
  it('is circular: 250 and 5 are 11 apart; 0 and 128 are the maximum 128 apart', () => {
    const w = blank({ TAG_TOL: 11 }); const a = put(w, 5, 5, { kin: 250 }), b = put(w, 6, 5, { kin: 5 });
    expect(w.pairMatches(a, b)).toBe(true); expect(realMatch(w, a, b)).toBe(true);
    const c = put(w, 7, 5, { kin: 0 }), d = put(w, 8, 5, { kin: 128 });
    expect(w.pairMatches(c, d)).toBe(false);
    const w2 = blank({ TAG_TOL: 128 }); const e = put(w2, 7, 5, { kin: 0 }), f = put(w2, 8, 5, { kin: 128 });
    expect(w2.pairMatches(e, f)).toBe(true);
    const w3 = blank({ TAG_TOL: 0 }); expect(w3.pairMatches(put(w3, 1, 1, { kin: 7 }), put(w3, 2, 1, { kin: 8 }))).toBe(false);
    const blind = blank({ TAG_TOL: 0 }, { tagBlind: true }); expect(blind.pairMatches(put(blind, 1, 1, { kin: 7 }), put(blind, 2, 1, { kin: 200 }))).toBe(true);
    expect(realMatch(blind, at(1, 1), at(2, 1))).toBe(false);
  });
  it('with TAG_TOL_GENE the pair uses the lower tolerance; a gene-blind world reads the constant', () => {
    const w = blank({ TAG_TOL_GENE: 1, TAG_TOL: 20 }); const a = put(w, 1, 1, { kin: 0, tol: 30 }), b = put(w, 2, 1, { kin: 25, tol: 10 });
    expect(w.pairMatches(a, b)).toBe(false); expect(w.pairMatches(b, a)).toBe(false);   // min(30,10) = 10 < 25, and symmetric
    w.kinTol[b] = 25; expect(w.pairMatches(a, b)).toBe(true);        // min(30,25) = 25 >= 25
    const gb = blank({ TAG_TOL_GENE: 1, TAG_TOL: 20 }, { blind: true }); expect(gb.pairMatches(put(gb, 1, 1, { kin: 0, tol: 1 }), put(gb, 2, 1, { kin: 19, tol: 1 }))).toBe(true);
  });
  it('founders carry the chosen marks and the constant tolerance; daughters copy the mark; with mark mutation off nothing changes it', () => {
    const w = new BodiesWorld({ seed: 1, founders: 1, genome: SHAPE, mutRate: 0, founderTags: [77] });
    expect(w.kin[at(48, 48)]).toBe(77); expect(w.kinTol[at(48, 48)]).toBe(16);
    w.step(300);
    expect(w.births).toBeGreaterThan(50);
    for (let i = 0; i < N; i++) if (w.cell[i]) { expect(w.kin[i]).toBe(77); expect(w.kinTol[i]).toBe(16); } else { expect(w.kin[i]).toBe(0); expect(w.gen[i]).toBe(0); }
    expect(w.tagMutations).toBe(0); expect(kinStats(w).genMax).toBeGreaterThan(3);
    const two = new BodiesWorld({ seed: 1, founders: 2, positions: [[10, 10], [60, 60]], founderTags: [5, 250] });
    expect([two.kin[at(10, 10)], two.kin[at(60, 60)]]).toEqual([5, 250]);
  });
  it('mark mutation draws on its own stream: every birth mutates at 65536, never touches the genes or the lineage tag; budless lone body with TAG_MUT_BUD never mutates', () => {
    const w = new BodiesWorld({ seed: 2, founders: 1, genome: SHAPE, mutRate: 0, founderTags: [77], tagMutRate: 65536 }); w.step(300);
    expect(w.tagMutations).toBe(w.births); expect(w.births).toBeGreaterThan(50);
    expect(w.mutations).toBe(0); expect(w.nextTag).toBe(1); expect(census(w).genomeVariants).toBe(1);
    for (let i = 0; i < N; i++) if (w.cell[i]) expect(w.kin[i] % 8).toBe(77 % 8);   // moves in steps of TAG_STEP = 8
    const bud = new BodiesWorld({ seed: 2, founders: 1, genome: SHAPE, mutRate: 0, founderTags: [77], tagMutRate: 65536, rules: { TAG_MUT_BUD: 1 } }); bud.step(300);
    expect(bud.births).toBeGreaterThan(50); expect(bud.tagMutations).toBe(0);
    const founderBud = new BodiesWorld({ seed: 2, founders: 1, genome: [16, 60, 255, 0], mutRate: 0, upkeep: false, founderTags: [77], tagMutRate: 65536, rules: { TAG_MUT_BUD: 1 } }); founderBud.step(300);
    expect(founderBud.tagMutations).toBeGreaterThan(0); expect(founderBud.tagMutations).toBeLessThan(founderBud.births);
    const tg = new BodiesWorld({ seed: 2, founders: 1, genome: SHAPE, mutRate: 0, tagMutRate: 65536, rules: { TAG_TOL_GENE: 1 } }); tg.step(400);
    expect(new Set(tg.kinTol.filter((_, i) => tg.cell[i])).size).toBeGreaterThan(1);   // the tolerance mutates and is inherited as a gene
  });
});

describe('each gate does something on a hand-built case with explicit values', () => {
  const pairShare = (rules: Partial<Rules>, kinB: number, extra: Partial<WorldOptions> = {}) => {
    const w = blank(rules, extra); const a = put(w, 10, 10, { store: 10, d: 0, kin: 0 }), b = put(w, 11, 10, { store: 0, d: 2, kin: kinB });
    w.step(1); return { w, a, b };
  };
  it('gateShare: transport only between matching neighbours', () => {
    let r = pairShare({}, 100); expect([r.w.store[r.a], r.w.store[r.b]]).toEqual([5, 5]);                        // no gate: halves the gap of 10
    r = pairShare({ GATE_SHARE: 1 }, 100); expect([r.w.store[r.a], r.w.store[r.b]]).toEqual([10, 0]);            // mismatch (100 > 16): nothing moves
    r = pairShare({ GATE_SHARE: 1 }, 10); expect([r.w.store[r.a], r.w.store[r.b]]).toEqual([5, 5]);              // match (10 <= 16): shares
    r = pairShare({ GATE_SHARE: 1 }, 100, { tagBlind: true }); expect([r.w.store[r.a], r.w.store[r.b]]).toEqual([5, 5]);
    r = pairShare({ GATE_SHARE: 1, TAG_TOL: 100 }, 100); expect([r.w.store[r.a], r.w.store[r.b]]).toEqual([5, 5]); // the tolerance matters
    expect(r.w.residual()).toBe(0);
  });
  it('raid: the poorer cell takes min(RAID, half the gap) from a richer non-matching neighbour even when sharing is gated', () => {
    let r = pairShare({ GATE_SHARE: 1, RAID: 3 }, 100); expect([r.w.store[r.a], r.w.store[r.b]]).toEqual([7, 3]); expect(r.w.raided).toBe(3);   // a is richer: b (the poorer) takes 3 from a
    r = pairShare({ GATE_SHARE: 1, RAID: 9 }, 100); expect([r.w.store[r.a], r.w.store[r.b]]).toEqual([5, 5]); expect(r.w.raided).toBe(5);      // capped at half the gap
    r = pairShare({ GATE_SHARE: 1, RAID: 3 }, 10); expect([r.w.store[r.a], r.w.store[r.b]]).toEqual([5, 5]); expect(r.w.raided).toBe(0);       // matching: ordinary sharing, no raid
    r = pairShare({ RAID: 3 }, 100, { tagBlind: true }); expect(r.w.raided).toBe(0);
    const w = blank({ GATE_SHARE: 1, RAID: 3 }); const a = put(w, 10, 10, { store: 5, d: 0, kin: 0 }), b = put(w, 11, 10, { store: 4, d: 2, kin: 100 });
    w.step(1); expect([w.store[a], w.store[b]]).toEqual([5, 4]); expect(w.raided).toBe(0);                                                     // gap 1: half is 0, nothing to take
    expect(w.residual()).toBe(0);
  });
  it('gateGrow: a tile that touches a non-matching cell stays empty; with matching marks (or no gate, or tagBlind) it fills', () => {
    const run = (rules: Partial<Rules>, kinB: number, extra: Partial<WorldOptions> = {}, bx = 12, by = 10) => {
      const w = blank(rules, extra);
      put(w, 10, 10, { store: 20, d: 0, kin: 0, g1: 255 }); put(w, bx, by, { store: 20, d: 0, kin: kinB, g1: 255 });
      w.food[at(11, 10)] = 3; w.initialMatter = w.matterTotal();
      w.step(40); return w;
    };
    let w = run({}, 100); expect(w.cell[at(11, 10)]).toBe(1); expect(w.births).toBe(1); expect(w.residual()).toBe(0);
    w = run({ GATE_GROW: 1 }, 100); expect(w.cell[at(11, 10)]).toBe(0); expect(w.births).toBe(0); expect(w.blockedGrow).toBeGreaterThan(30);   // blocked on every step it was eligible
    w = run({ GATE_GROW: 1 }, 10); expect(w.cell[at(11, 10)]).toBe(1); expect(w.blockedGrow).toBe(0);
    w = run({ GATE_GROW: 1 }, 100, { tagBlind: true }); expect(w.cell[at(11, 10)]).toBe(1);
    w = run({ GATE_GROW: 1 }, 100, {}, 12, 11); expect(w.cell[at(11, 10)]).toBe(0); expect(w.blockedGrow).toBeGreaterThan(30);   // a diagonal neighbour of the tile blocks it too
    w = run({ GATE_GROW: 1 }, 100, {}, 13, 10); expect(w.cell[at(11, 10)]).toBe(1);                                             // two tiles away: not a neighbour of the tile
    expect(w.residual()).toBe(0);
  });
  it('gateGrow also checks bud landings: on a lattice where every empty tile touches a cell of the other mark, buds are blocked', () => {
    const lattice = (rules: Partial<Rules>) => {
      const w = blank(rules);
      for (let y = 0; y < 96; y += 3) for (let x = 0; x < 96; x += 3) { const i = put(w, x, y, { store: 20, d: 0, kin: ((x / 3 + y / 3) & 1) ? 100 : 0 }); w.g2[i] = 255; }
      for (let i = 0; i < N; i++) if (!w.cell[i]) w.food[i] = 3;
      w.initialMatter = w.matterTotal(); w.step(60); return w;
    };
    const off = lattice({}), on = lattice({ GATE_GROW: 1 });
    expect(off.blockedBud + off.blockedGrow).toBe(0); expect(off.births).toBeGreaterThan(50);
    expect(on.blockedBud).toBeGreaterThan(0); expect(on.blockedGrow).toBeGreaterThan(0); expect(on.births).toBeLessThan(off.births);
    expect(off.residual()).toBe(0); expect(on.residual()).toBe(0);
  });
  it('gateSignal: d crosses only matching neighbours; with a tolerance the signal chains through cells that do not match the root', () => {
    const rowD = (rules: Partial<Rules>, kins: number[], steps: number, extra: Partial<WorldOptions> = {}) => {
      const w = blank(rules, extra); kins.forEach((k, j) => put(w, 10 + j, 10, { store: 5, d: j === 0 ? 0 : 255, kin: k }));
      w.step(steps); return kins.map((_, j) => w.d[at(10 + j, 10)]);
    };
    expect(rowD({}, [0, 100], 1)).toEqual([0, 2]);                                   // no gate
    expect(rowD({ GATE_SIGNAL: 1 }, [0, 100], 1)).toEqual([0, 255]);                 // mismatch: the second cell hears nothing
    expect(rowD({ GATE_SIGNAL: 1 }, [0, 10], 1)).toEqual([0, 2]);                    // match
    expect(rowD({ GATE_SIGNAL: 1 }, [0, 100], 1, { tagBlind: true })).toEqual([0, 2]);
    expect(rowD({ GATE_SIGNAL: 1 }, [0, 10, 20], 2)).toEqual([0, 2, 4]);             // 20 does not match 0 (distance 20 > 16) but matches 10: the signal chains
    expect(rowD({ GATE_SIGNAL: 1 }, [0, 100, 100], 4)).toEqual([0, 255, 255]);       // matching cells behind a mismatch stay orphans (d = 255)
  });
  it('the basin observer follows only matching neighbours while GATE_SIGNAL is on', () => {
    const lay = (rules: Partial<Rules>) => {
      const w = blank(rules); put(w, 10, 10, { d: 0, kin: 0 }); put(w, 11, 10, { d: 2, kin: 100 }); put(w, 12, 10, { d: 4, kin: 100 });
      return census(w).domains;
    };
    expect(lay({}).n).toBe(1); expect(lay({}).unrooted).toBe(0);
    const g = lay({ GATE_SIGNAL: 1 }); expect(g.n).toBe(1); expect(g.unrooted).toBe(2);      // the two foreign-mark cells reach no root through matching cells
  });
  it('seamCost: a cell on a seam burns 1 + SEAM_COST at its upkeep tick, never more than it holds, and is still alive', () => {
    const run = (rules: Partial<Rules>, kinB: number, storeA = 10, extra: Partial<WorldOptions> = {}) => {
      const w = blank({ UPK: 8, ...rules }, { upkeep: true, ...extra });
      const a = put(w, 8, 0, { store: storeA, d: 0, kin: 0 }), b = put(w, 9, 0, { store: storeA, d: 2, kin: kinB });   // tile 8 ticks at t = 0, tile 9 does not
      w.step(1); return { w, a, b };
    };
    let r = run({ SEAM_COST: 2 }, 100); expect([r.w.store[r.a], r.w.store[r.b]]).toEqual([7, 10]); expect(r.w.burned).toBe(3); expect(r.w.seamBurned).toBe(2);
    r = run({ SEAM_COST: 2 }, 10); expect([r.w.store[r.a], r.w.store[r.b]]).toEqual([9, 10]); expect(r.w.seamBurned).toBe(0);
    r = run({ SEAM_COST: 2 }, 100, 10, { tagBlind: true }); expect(r.w.store[r.a]).toBe(9);
    r = run({ SEAM_COST: 5 }, 100, 2); expect([r.w.store[r.a], r.w.cell[r.a]]).toEqual([0, 1]); expect(r.w.burned).toBe(2); expect(r.w.seamBurned).toBe(1);
    r = run({}, 100); expect(r.w.store[r.a]).toBe(9);
    expect(r.w.residual()).toBe(0);
    // an isolated cell has no seam
    const w = blank({ SEAM_COST: 2, UPK: 8 }, { upkeep: true }); const i = put(w, 8, 0, { store: 10, d: 0 }); w.step(1); expect(w.store[i]).toBe(9);
  });
});

describe('the ledger stays exact with each knob on (2000 steps, three founders meeting, mark mutation on)', () => {
  const configs: [string, Partial<Rules>, (w: BodiesWorld) => boolean][] = [
    ['GATE_SHARE', { GATE_SHARE: 1 }, () => true],
    ['GATE_GROW', { GATE_GROW: 1 }, (w) => w.blockedGrow + w.blockedBud > 0],
    ['GATE_SIGNAL', { GATE_SIGNAL: 1 }, () => true],
    ['SEAM_COST 2', { SEAM_COST: 2 }, (w) => w.seamBurned > 0],
    ['RAID 3', { RAID: 3 }, (w) => w.raided > 0],
    ['RAID 3 + GATE_SHARE', { RAID: 3, GATE_SHARE: 1 }, (w) => w.raided > 0],
    ['all gates + seam + raid', { GATE_SHARE: 1, GATE_GROW: 1, GATE_SIGNAL: 1, SEAM_COST: 2, RAID: 3 }, (w) => w.blockedGrow + w.blockedBud > 0],
    ['TAG_TOL_GENE + TAG_MUT_BUD + gates', { TAG_TOL_GENE: 1, TAG_MUT_BUD: 1, GATE_SHARE: 1, GATE_SIGNAL: 1, SEAM_COST: 1, RAID: 1 }, () => true],
  ];
  for (const [name, rules, fired] of configs) {
    it(name, () => {
      const w = crowd({ rules, mutRate: 3 });
      for (let k = 0; k < 8; k++) { w.step(250); if (k === 4) w.injure(47, 54, 4); expect(w.residual(), `${name} at t=${w.t}`).toBe(0); }
      expect(validateWorld(w)).toEqual([]);
      if (!rules.TAG_MUT_BUD) expect(w.tagMutations).toBeGreaterThan(0);   // with TAG_MUT_BUD only bud births mutate, and the three founders rarely bud
      expect(fired(w), `${name}: the knob should have fired (blockedGrow ${w.blockedGrow} blockedBud ${w.blockedBud} raided ${w.raided} seamBurned ${w.seamBurned})`).toBe(true);
      for (let i = 0; i < N; i++) { expect(w.food[i]).toBeLessThanOrEqual(w.R.FMAX); expect(w.store[i]).toBeLessThanOrEqual(w.R.CAP); }
    });
  }
});

describe('override bounds', () => {
  const mk = (rules: Partial<Rules>, extra: Partial<WorldOptions> = {}) => () => new BodiesWorld({ seed: 1, rules, ...extra });
  it('rejects values that would leave the Uint8 stores or the 0/1 switches', () => {
    expect(mk({ GATE_SHARE: 2 })).toThrow(/GATE_/); expect(mk({ GATE_GROW: 2 })).toThrow(/GATE_/); expect(mk({ GATE_SIGNAL: 2 })).toThrow(/GATE_/);
    expect(mk({ TAG_TOL_GENE: 2 })).toThrow(/TAG_TOL_GENE/); expect(mk({ TAG_MUT_BUD: 2 })).toThrow(/TAG_MUT_BUD/);
    expect(mk({ TAG_TOL: 256 })).toThrow(/TAG_TOL/); expect(mk({ TAG_STEP: 129 })).toThrow(/TAG_STEP/);
    expect(mk({ SEAM_COST: 24 })).toThrow(/SEAM_COST/); expect(mk({ RAID: 25 })).toThrow(/RAID/);
    expect(mk({ RAID: -1 })).toThrow(/non-negative/); expect(mk({ SEAM_COST: 1.5 })).toThrow(/integer/); expect(mk({ NOPE: 1 } as unknown as Partial<Rules>)).toThrow(/unknown rule/);
    expect(mk({ SEAM_COST: 23, RAID: 24, TAG_TOL: 255, TAG_STEP: 128, GATE_SHARE: 1 })).not.toThrow();
    expect(mk({ CAP: 255, SEAM_COST: 254, RAID: 255 })).not.toThrow();
  });
  it('rejects bad mark options', () => {
    expect(mk({}, { tagMutRate: 65537 })).toThrow(/tagMutRate/); expect(mk({}, { tagMutRate: -1 })).toThrow(/tagMutRate/); expect(mk({}, { tagMutRate: 0.5 })).toThrow(/tagMutRate/);
    expect(mk({}, { tagMutRate: 65536 })).not.toThrow();
    expect(mk({}, { positions: [[1, 1], [2, 2]], founderTags: [1] })).toThrow(/founderTags/);
    expect(mk({}, { positions: [[1, 1]], founderTags: [256] })).toThrow(/mark/);
    expect(() => new BodiesWorld({ seed: 1 }).setTagMutation(70000)).toThrow(/tagMutRate/);
  });
  it('the v1 base keeps the v3 knobs off', () => {
    for (const v of [1, 2] as const) {
      const R = new BodiesWorld({ seed: 1, version: v }).R;
      expect([R.GATE_SHARE, R.GATE_GROW, R.GATE_SIGNAL, R.SEAM_COST, R.RAID, R.TAG_TOL_GENE, R.TAG_MUT_BUD]).toEqual([0, 0, 0, 0, 0, 0, 0]);
    }
  });
});

describe('GATE_GROW judges the newborn\'s FINAL mark and scans in an unbiased order', () => {
  it('with mark mutation on (steps above the tolerance, growth and buds) a GATE_GROW world never grows a seam, and the ledger stays exact', () => {
    const lone = new BodiesWorld({ seed: 5, founders: 1, genome: SHAPE, upkeep: true, tagMutRate: 4000, rules: { GATE_GROW: 1, TAG_TOL: 16, TAG_STEP: 32 } }); lone.step(1500);
    expect(lone.blockedGrow).toBeGreaterThan(0); expect(seamStats(lone).pairs).toBeGreaterThan(100); expect(seamStats(lone).seamPairs).toBe(0); expect(lone.residual()).toBe(0);
    const lax = new BodiesWorld({ seed: 5, founders: 1, genome: SHAPE, upkeep: true, tagMutRate: 4000, rules: { TAG_TOL: 16, TAG_STEP: 32 } }); lax.step(1500);
    expect(seamStats(lax).seamPairs).toBeGreaterThan(0);                  // control: without the gate the same mutations do make a seam
    const bud = new BodiesWorld({ seed: 2, founders: 1, genome: [16, 60, 200, 0], upkeep: false, tagMutRate: 65536, rules: { GATE_GROW: 1, TAG_MUT_BUD: 1, TAG_STEP: 64, TAG_TOL: 16 } }); bud.step(500);
    expect(bud.tagMutations).toBeGreaterThan(20); expect(bud.blockedBud).toBeGreaterThan(0); expect(seamStats(bud).seamPairs).toBe(0); expect(bud.residual()).toBe(0);
  });
  it('a gap between two facing equal blocks is shared between the two sides, not won by the one that comes first in raster order (both orientations)', () => {
    for (const ns of [true, false]) {
      let first = 0, second = 0;
      for (let seed = 1; seed <= 24; seed++) {
        const w = blank({ GATE_GROW: 1, FORAGE: 0, FLOW: 0 }, { seed });
        for (let u = 0; u < 20; u++) for (let v = 0; v < 6; v++) {
          const a = ns ? [30 + u, 20 + v] : [20 + v, 30 + u], b = ns ? [30 + u, 28 + v] : [28 + v, 30 + u];
          put(w, a[0], a[1], { kin: 0, store: 24, d: 0, g1: 255 }); put(w, b[0], b[1], { kin: 128, store: 24, d: 0, g1: 255 });
        }
        w.food.fill(10); w.initialMatter = w.matterTotal(); w.step(40);
        for (let u = 0; u < 24; u++) for (const g of [26, 27]) { const i = ns ? at(28 + u, g) : at(g, 28 + u); if (w.cell[i]) { if (w.kin[i] === 0) first++; else second++; } }
        expect(seamStats(w).seamPairs).toBe(0);
      }
      expect(first).toBeGreaterThan(100); expect(second).toBeGreaterThan(100);
      expect(Math.abs(first - second) / (first + second)).toBeLessThan(0.2);
    }
  });
});

describe('the dynamics stay free of identities: marks are compared pairwise, observers never feed back', () => {
  const src = readFileSync(new URL('../src/bodies/model.ts', import.meta.url), 'utf8');
  const dyn = src.slice(src.indexOf('private birth('), src.indexOf('cellCount()'));
  it('the model imports nothing (so it cannot call an observer) and never reads the generation counter', () => {
    expect(src).not.toMatch(/^import /m);
    expect(dyn.match(/\.gen\b[^;]*/g)).toEqual(['.gen[tile] = this.gen[par] + 1', '.gen[i] = 0']);
    expect(dyn).not.toMatch(/basinLabels|kinPatches|census\(|PatchTracker/);
    const stepSrc = src.slice(src.indexOf('private stepOnce('), src.indexOf('private markRoot('));
    expect(stepSrc).not.toMatch(/\.gen\b|basinLabels|kinPatches/);
  });
  it('every read of kin or kinTol is a pairwise comparison or a copy/clear', () => {
    const stepSrc = src.slice(src.indexOf('private stepOnce('), src.indexOf('private markRoot('));
    expect(stepSrc).not.toMatch(/\.kin/);                                  // the step loop only calls pairMatches / hasSeam / touchesForeign
    expect((stepSrc.match(/pairMatches\(/g) ?? []).length).toBe(3);
    expect(stepSrc).toMatch(/hasSeam\(i\)/); expect(stepSrc).toMatch(/touchesForeign\(/);
    expect(dyn).toMatch(/let k = this\.kin\[par\], tl = this\.kinTol\[par\]/);   // a newborn starts from a copy of its parent's mark (and may then mutate)
    expect(Object.keys(new BodiesWorld({ seed: 1 })).filter((k) => /^(id|ids|body|bodies|organism|member|members|component|label|patch)/i.test(k))).toEqual([]);
  });
});

describe('observers on hand-built layouts', () => {
  const squares = () => {
    const w = blank();
    for (let y = 10; y < 13; y++) for (let x = 10; x < 13; x++) put(w, x, y, { d: 2, kin: 0 });
    for (let y = 10; y < 13; y++) for (let x = 13; x < 16; x++) put(w, x, y, { d: 2, kin: 100 });
    w.d[at(11, 11)] = 0; w.d[at(14, 11)] = 0;
    return w;
  };
  it('two touching squares with different marks: one component, two patches, a seam of 3 of 27 pairs on the basin border', () => {
    const w = squares();
    expect(census(w).comps).toBe(1); expect(census(w).domains.sizes).toEqual([9, 9]);
    const p = kinPatches(w); expect(p.sizes).toEqual([9, 9]);
    const s = seamStats(w);
    expect(s.pairs).toBe(27); expect(s.seamPairs).toBe(3); expect(s.seamPermille).toBe(Math.floor(3000 / 27));
    expect(s.seamCells).toBe(6); expect(s.seamCellsPermille).toBe(Math.floor(6000 / 18));
    expect(s.basinBorderPairs).toBe(3); expect(s.seamOnBasinBorderPermille).toBe(1000);
    const k = kinStats(w); expect(k.distinct).toBe(2); expect(k.dominantSharePermille).toBe(500); expect(k.hist16[0]).toBe(9); expect(k.hist16[6]).toBe(9); expect(k.tolMeanX10).toBe(160);
    for (const x of [10, 11, 12, 13, 14, 15]) w.kin[at(x, 11)] = 0;   // same marks everywhere: one patch, no seam
    for (let i = 0; i < N; i++) if (w.cell[i]) w.kin[i] = 0;
    expect(kinPatches(w).sizes).toEqual([18]); expect(seamStats(w).seamPairs).toBe(0);
  });
  it('a tolerance joins patches by chaining: marks 0, 10, 20 at tolerance 16 are one patch although 0 and 20 do not match', () => {
    const w = blank();
    for (let j = 0; j < 3; j++) for (let y = 10; y < 12; y++) for (let x = 10 + 2 * j; x < 12 + 2 * j; x++) put(w, x, y, { kin: 10 * j });
    expect(kinPatches(w).sizes).toEqual([12]);
    expect(seamStats(w).seamPairs).toBe(0);
    expect(realMatch(w, at(10, 10), at(15, 10))).toBe(false);
  });
  it('patch turnover by overlap: a patch that vanishes dies, a new one is born, a surviving one ages', () => {
    const w = blank(); const sq = (x0: number, y0: number, kin: number) => { for (let y = y0; y < y0 + 3; y++) for (let x = x0; x < x0 + 3; x++) put(w, x, y, { kin }); };
    const wipe = (x0: number, y0: number) => { for (let y = y0; y < y0 + 3; y++) for (let x = x0; x < x0 + 3; x++) { w.cell[at(x, y)] = 0; w.kin[at(x, y)] = 0; w.store[at(x, y)] = 0; } };
    sq(10, 10, 0); sq(20, 10, 100);
    const tr = new PatchTracker(4);
    const a = tr.sample(w); expect(a.births).toBeNull(); expect(a.deaths).toBeNull(); expect([a.n, a.nBig, a.sizesTop8]).toEqual([2, 2, [9, 9]]);
    w.t = 100; wipe(20, 10); sq(30, 10, 200);
    const b = tr.sample(w); expect([b.births, b.deaths]).toEqual([1, 1]); expect([b.ageMax, b.ageMedian]).toEqual([100, 0]); expect([b.deadCount, b.deadLifeMean]).toEqual([1, 0]);
    w.t = 150;
    const c = tr.sample(w); expect([c.births, c.deaths]).toEqual([0, 0]); expect([c.ageMax, c.ageMedian]).toEqual([150, 50]); expect(c.deadCount).toBe(1);
    // a patch below minSize is dust: not counted as born
    put(w, 50, 50, { kin: 77 }); w.t = 200; const d = tr.sample(w); expect([d.n, d.nBig, d.births, d.deaths]).toEqual([3, 2, 0, 0]);
    // a merge is not a death: join the two surviving squares with a bridge of matching marks
    for (let x = 13; x < 30; x++) for (let y = 11; y < 12; y++) if (!w.cell[at(x, y)]) put(w, x, y, { kin: 0 });
    for (let y = 10; y < 13; y++) for (let x = 30; x < 33; x++) w.kin[at(x, y)] = 0;
    // (the square at x=30 had mark 200 and is recoloured to 0 in place: that is a clade replaced, so it dies, and its 9 tiles are counted as replaced)
    w.t = 250; const e = tr.sample(w); expect(e.nBig).toBe(1); expect(e.births).toBe(0); expect(e.deaths).toBe(1); expect(e.replacedTiles).toBe(9);
  });
  it('a merge of two same-mark patches kills nobody', () => {
    const w = blank(); const sq = (x0: number, y0: number) => { for (let y = y0; y < y0 + 3; y++) for (let x = x0; x < x0 + 3; x++) put(w, x, y, { kin: 7 }); };
    sq(10, 10); sq(20, 10); const tr = new PatchTracker(4); tr.sample(w);
    for (let x = 13; x < 20; x++) put(w, x, 11, { kin: 7 });
    w.t = 100; const r = tr.sample(w); expect(r.nBig).toBe(1); expect([r.births, r.deaths, r.replacedTiles]).toEqual([0, 0, 0]);
  });
  it('a clade replaced in place is a death plus a birth, not a patch that lives on (marks replaced on the same tiles, a foreign block over a vanished patch, a half retaken)', () => {
    const rect = (w: BodiesWorld, x0: number, y0: number, nx: number, ny: number, kin: number) => { for (let x = x0; x < x0 + nx; x++) for (let y = y0; y < y0 + ny; y++) put(w, x, y, { kin }); };
    let w = blank(); let tr = new PatchTracker(10); rect(w, 10, 10, 10, 10, 0); tr.sample(w);
    rect(w, 10, 10, 10, 10, 100); w.t = 200; let r = tr.sample(w);
    expect([r.births, r.deaths, r.replacedTiles, r.ageMax]).toEqual([1, 1, 100, 0]);
    w = blank(); tr = new PatchTracker(10); rect(w, 10, 10, 10, 10, 0); tr.sample(w);
    w.cell.fill(0); w.kin.fill(0); rect(w, 9, 9, 12, 12, 100); w.t = 200; r = tr.sample(w);
    expect([r.births, r.deaths]).toEqual([1, 1]);
    w = blank(); tr = new PatchTracker(10); rect(w, 10, 10, 10, 10, 0); tr.sample(w);
    rect(w, 10, 10, 5, 10, 100); w.t = 200; r = tr.sample(w);
    expect([r.births, r.deaths, r.replacedTiles, r.nBig]).toEqual([1, 0, 50, 2]);   // the retaken half is new; the untouched half carries the old patch on
    expect(r.ageMax).toBe(200);
  });
});

describe('the v3 harness', () => {
  it('rejects unknown flags, bad values and impossible combinations; maps the shortcuts onto rules', () => {
    expect(() => parseArgs(['--typo', '1'])).toThrow(/unknown flag/); expect(() => parseArgs(['--scenario', 'nope'])).toThrow(/scenario/);
    expect(() => parseArgs(['--steps', 'x'])).toThrow(/integer/); expect(() => parseArgs(['--gates', 'share,wat'])).toThrow(/gates/);
    expect(() => parseArgs(['--rules-override', '{bad'])).toThrow(/JSON/); expect(() => parseArgs(['--steps'])).toThrow(/needs a value/); expect(() => parseArgs(['stray'])).toThrow(/unexpected/);
    expect(() => parseArgs(['--tag-mut-rate', '70000'])).toThrow(/tag-mut-rate/); expect(() => parseArgs(['--tags', '1,300'])).toThrow(/tags/);
    const o = parseArgs(['--scenario', 'wound-in-crowd', '--seed', '4', '--steps', '900', '--mut', 'on', '--tag-mut-rate', '300', '--tag-blind', '--gates', 'share,grow', '--seam-cost', '2', '--raid', '1', '--tol', '9', '--tag-step', '3',
      '--tol-gene', '--tag-mut-bud', '--rules-override', '{"UPK":6,"GATE_SIGNAL":1}', '--tags', 'same', '--wound-at', '500']);
    expect(o).toMatchObject({ scenario: 'wound-in-crowd', seed: 4, steps: 900, mut: true, tagMutRate: 300, tagBlind: true, woundAt: 500 });
    expect(o.rules).toEqual({ UPK: 6, GATE_SIGNAL: 1, GATE_SHARE: 1, GATE_GROW: 1, SEAM_COST: 2, RAID: 1, TAG_TOL: 9, TAG_STEP: 3, TAG_TOL_GENE: 1, TAG_MUT_BUD: 1 });
    // flags that would silently do nothing are errors
    expect(() => parseArgs(['--scenario', 'pair', '--founders', '4'])).toThrow(/founders/); expect(() => parseArgs(['--gap', '3'])).toThrow(/gap/);
    expect(() => parseArgs(['--wound-at', '100'])).toThrow(/wound/); expect(() => parseArgs(['--mut-rate', '9'])).toThrow(/--mut on/);
    expect(() => parseArgs(['--gene-blind'])).toThrow(/--mut on/); expect(() => parseArgs(['--tol-gene'])).toThrow(/tag-mut-rate/);
    expect(() => parseArgs(['--tag-step', '4'])).toThrow(/tag-mut-rate/); expect(() => parseArgs(['--rules-override', '{"TAG_MUT_BUD":1}'])).toThrow(/tag-mut-rate/);
    expect(() => parseArgs(['--tag-blind'])).toThrow(/gate/); expect(() => parseArgs(['--no-frames', '--frames', '0'])).toThrow(/no-frames/);
    expect(() => parseArgs(['--scenario', 'pair', '--gap', '11', '--mut', 'on'])).not.toThrow();   // pair + mut passes the parser; buildWorld rejects it below
    expect(() => buildWorld({ ...defaultOptions(), scenario: 'pair', tagMutRate: 5 })).toThrow(/no mutation/);
    expect(() => buildWorld({ ...defaultOptions(), rules: { BOGUS: 1 } })).toThrow(/unknown rule/);
    expect(() => buildWorld({ ...defaultOptions(), tags: [1, 2] })).toThrow(/--tags/);
    expect(() => buildWorld({ ...defaultOptions(), scenario: 'wound-in-crowd', steps: 100, woundAt: 100 })).toThrow(/wound-at/);
  });
  it('pair: two founders with different marks, deterministic, ledger exact, gates keep the seam at zero', () => {
    const base = { ...defaultOptions(), scenario: 'pair' as const, steps: 600, noFrames: true, quiet: true, sampleEvery: 100 };
    const a = runV3(base), b = runV3(base), g = runV3({ ...base, rules: { GATE_SHARE: 1, GATE_GROW: 1, GATE_SIGNAL: 1 } });
    expect({ ...a, timingMs: 0 }).toEqual({ ...b, timingMs: 0 });
    expect(a.meta.founderMarks).toEqual([64, 192]); expect(a.final.residual).toBe(0); expect(a.final.validate).toEqual([]); expect(a.series).toHaveLength(7);
    expect(a.series[0].patches.nBig).toBe(0); expect(a.final.kin.distinct).toBe(2); expect(a.final.patches.nBig).toBe(2);
    expect(g.final.residual).toBe(0); expect(g.final.seams.seamPermille).toBe(0); expect(g.final.counters.blockedGrow).toBeGreaterThan(0);
  });
  it('crowd with all-same marks has no seam and one patch per component; wound-in-crowd wounds a basin, spares its root, tracks it', () => {
    const same = runV3({ ...defaultOptions(), steps: 400, tags: 'same', noFrames: true, quiet: true, rules: { GATE_SHARE: 1, GATE_GROW: 1, GATE_SIGNAL: 1 } });
    expect(same.final.seams.seamPairs).toBe(0); expect(same.final.counters.blockedGrow + same.final.counters.blockedBud).toBe(0); expect(same.final.residual).toBe(0);
    const o = { ...defaultOptions(), scenario: 'wound-in-crowd' as const, founders: 1, genome: SHAPE, steps: 1700, woundAt: 1500, woundWatch: 150, woundEvery: 50, noFrames: true, quiet: true, sampleEvery: 100 };
    const r = runV3(o);
    expect(r.wound).toMatchObject({ t: 1500, rootSpared: true, rootsInDisk: 0 }); expect((r.wound as { killed: number }).killed).toBeGreaterThan(20);
    expect(r.woundTrack.map((x) => x.sinceWound)).toEqual([0, 50, 100, 150]);
    expect(r.woundTrack[0].diskLivePermille).toBeLessThan(1000); expect(r.woundTrack[0].rootAlive).toBe(true); expect(r.woundTrack.at(-1)!.diskLive).toBeGreaterThan(r.woundTrack[0].diskLive);
    expect(r.final.residual).toBe(0); expect(runV3(o).final.stateHashFull).toBe(r.final.stateHashFull);
  });
  it('keeps the v3 knobs out of the default rule objects, and merges them with defaults that are off', () => {
    for (const k of Object.keys(V3_KNOBS)) { expect(k in RULES_V1).toBe(false); expect(k in RULES_V2).toBe(false); }
    const w = new BodiesWorld({ seed: 1 }); expect(w.R.GATE_GROW).toBe(0); expect(w.R.TAG_TOL).toBe(16);
  });
  it('draws the scan multiplier uniformly over the units mod N (no rounding-up weight on 5 mod 6)', () => {
    const w = new BodiesWorld({ seed: 7, founders: 1 }) as unknown as { t: number; scanPerm(c: number): [number, number] };
    const cnt = [0, 0]; let n = 0;
    for (let t = 0; t < 6000; t++) { w.t = t; const [a] = w.scanPerm(18); expect(a % 2).toBe(1); expect(a % 3).not.toBe(0); cnt[a % 6 === 1 ? 0 : 1]++; n++; }
    // 1 mod 6 and 5 mod 6 are equally many units; the old round-up rule gave a 1:2 split (about 33 percent on 1 mod 6).
    expect(Math.abs(cnt[0] / n - 0.5)).toBeLessThan(0.03);
  });
  it('writes a readout and a three-panel frame', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bodies-v3-'));
    const r = runV3({ ...defaultOptions(), scenario: 'pair', steps: 120, sampleEvery: 60, frames: [0, 'end'], out: dir, quiet: true });
    expect(r.frames).toEqual(['frame-t00000.png', 'frame-t00120.png']);
    const png = readFileSync(join(dir, 'frame-t00120.png')); expect([...png.subarray(0, 4)]).toEqual([137, 80, 78, 71]);
    expect(png.readUInt32BE(16)).toBe((96 * 3 + 8) * 5); expect(png.readUInt32BE(20)).toBe(96 * 5); expect(existsSync(join(dir, 'frame-t00000.png'))).toBe(true);
  });
});
