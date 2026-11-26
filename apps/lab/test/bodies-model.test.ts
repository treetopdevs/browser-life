import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as model from '../src/bodies/model.ts';
import { BodiesWorld, FOUNDER_GENOME, GENE_RANGES, RULES, census, hashState, soloWorld, validateWorld } from '../src/bodies/model.ts';

// v1 tests (the original rule, kept reachable with version: 1) use eco1/fed1; v2 tests (the default) use eco/lone.
const eco1 = (seed: number, mut = 3) => new BodiesWorld({ seed, founders: 3, genome: FOUNDER_GENOME, mutRate: mut, version: 1 });
const fed = (genome = [16, 60, 0, 0] as const) => soloWorld([...genome] as unknown as model.Genome, 1, { version: 1 });
const eco = (seed: number, mut = 3, extra: Partial<model.WorldOptions> = {}) => new BodiesWorld({ seed, founders: 3, genome: FOUNDER_GENOME, mutRate: mut, ...extra });
const SHAPE = [16, 60, 0, 0] as unknown as model.Genome;
const lone = (seed = 1, extra: Partial<model.WorldOptions> = {}) => new BodiesWorld({ seed, founders: 1, genome: SHAPE, mutRate: 0, ...extra });

describe('v1 determinism', () => {
  it('same seed same hash, different seed differs, chunking does not matter', () => {
    const a = eco1(5), b = eco1(5), c = eco1(6), d = eco1(5);
    a.step(400); b.step(400); c.step(400);
    for (let i = 0; i < 4; i++) d.step(100);
    expect(a.hashState()).toBe(b.hashState());
    expect(a.hashState()).not.toBe(c.hashState());
    expect(d.hashState()).toBe(a.hashState());
  });
  it('pins a local regression hash (seed 1, 300 steps, fed single founder)', () => {
    const w = soloWorld([...FOUNDER_GENOME] as unknown as model.Genome, 1, { version: 1 }); w.step(300);
    expect(hashState(w)).toBe(PINNED_HASH);
  });
});
const PINNED_HASH = 1878328071; // v1, fed; also checked bit for bit against the 20000-step upkeep-on v1 stateHashes in readouts.json

describe('v1 integer bounds and conservation', () => {
  it('keeps every field in range over 1500 steps with mutation', () => {
    const w = eco1(2); w.step(1500);
    for (let i = 0; i < RULES.N; i++) {
      expect(w.food[i]).toBeLessThanOrEqual(64); expect(w.store[i]).toBeLessThanOrEqual(24); expect(w.d[i]).toBeLessThanOrEqual(255);
      if (w.cell[i]) { expect(w.g0[i]).toBeGreaterThanOrEqual(6); expect(w.g0[i]).toBeLessThanOrEqual(60); expect(w.g1[i]).toBeGreaterThanOrEqual(8); expect(w.g3[i]).toBeLessThanOrEqual(255); }
    }
    expect(w.food).toBeInstanceOf(Uint8Array); expect(w.tag).toBeInstanceOf(Uint16Array);
    expect(validateWorld(w)).toEqual([]);
  });
  it('conserves matter exactly with a wound in the middle', () => {
    const w = eco1(3);
    for (let k = 0; k < 15; k++) {
      w.step(100); if (k === 7) expect(w.injure(24, 24, 5) + w.injure(72, 30, 5)).toBeGreaterThanOrEqual(0);
      expect(w.residual()).toBe(0);
    }
    expect(w.lostWound).toBeGreaterThan(0);
  });
});

describe('v1 growth and regrowth (fed single founder)', () => {
  it('grows to a stable disk', () => {
    const w = fed(); w.step(100);
    expect(w.cellCount()).toBeGreaterThanOrEqual(120); expect(w.cellCount()).toBeLessThanOrEqual(260);
    expect(census(w).largestSharePermille).toBe(1000);
    w.step(50); const n150 = w.cellCount(); w.step(150);
    expect(Math.abs(w.cellCount() - n150)).toBeLessThanOrEqual(6);
  });
  it('regrows after a wound that spares the root', () => {
    for (const seed of [1, 2, 3]) {
      const w = soloWorld([16, 60, 0, 0], seed, { version: 1 }); w.step(200);
      const before = w.cellCount(); const killed = w.injure(54, 48, 4);
      expect(killed).toBeGreaterThanOrEqual(20); expect(killed).toBeLessThanOrEqual(60);
      w.step(150); expect(w.cellCount() * 100).toBeGreaterThanOrEqual(before * 95); expect(w.residual()).toBe(0);
    }
  });
  it('organiser-killed case conserves matter and ends with a root', () => {
    const w = fed(); w.step(200); w.injure(48, 48, 4); w.step(300);
    expect(w.residual()).toBe(0); expect(census(w).roots).toBeGreaterThanOrEqual(1);
  });
});

describe('v1 heredity and mutation', () => {
  it('mutation off keeps one genome; on makes variants inside ranges', () => {
    const off = eco1(4, 0); off.step(3000);
    expect(census(off).genomeVariants).toBe(1); expect(off.mutations).toBe(0);
    for (let i = 0; i < RULES.N; i++) if (off.cell[i]) expect([off.g0[i], off.g1[i], off.g2[i], off.g3[i]]).toEqual(FOUNDER_GENOME);
    const on = eco1(4); on.step(3000);
    expect(census(on).genomeVariants).toBeGreaterThan(1);
    for (let i = 0; i < RULES.N; i++) if (on.cell[i]) {
      [on.g0, on.g1, on.g2, on.g3].forEach((g, f) => { expect(g[i]).toBeGreaterThanOrEqual(GENE_RANGES[f][0]); expect(g[i]).toBeLessThanOrEqual(GENE_RANGES[f][1]); });
    }
  });
  it('the toggle is live', () => {
    const w = eco1(7); w.step(500); expect(w.nextTag).toBeGreaterThan(1);
    w.setMutation(false); const tag = w.nextTag; w.step(500); expect(w.nextTag).toBe(tag);
    w.setMutation(true); w.step(500); expect(w.nextTag).toBeGreaterThan(tag);
  });
});

describe('v1 inheritance', () => {
  it('a mutant parent with mutation off passes its own genome to every descendant and bud', () => {
    const mut: model.Genome = [30, 120, 40, 8];
    const w = new BodiesWorld({ seed: 3, founders: 1, genome: FOUNDER_GENOME, mutRate: 0, upkeep: false, version: 1 });
    const root = 48 * 96 + 48; [w.g0[root], w.g1[root], w.g2[root], w.g3[root]] = mut;
    w.step(150);
    expect(w.cellCount()).toBeGreaterThan(50); expect(w.births).toBeGreaterThan(50);
    expect(census(w).genomeVariants).toBe(1);
    for (let i = 0; i < RULES.N; i++) if (w.cell[i]) expect([w.g0[i], w.g1[i], w.g2[i], w.g3[i]]).toEqual(mut);
  });
  it('with mutation on, the mutant lineage is passed on and then varied from the mutant, not the founder', () => {
    const mut: model.Genome = [40, 200, 0, 0];
    const w = new BodiesWorld({ seed: 5, founders: 1, genome: FOUNDER_GENOME, mutRate: 0, upkeep: false, version: 1 });
    const root = 48 * 96 + 48; [w.g0[root], w.g1[root], w.g2[root], w.g3[root]] = mut;
    w.setMutation(true); w.step(300);
    expect(w.mutations).toBeGreaterThan(5);
    // every genome is within a few one-step moves of the mutant (grow 200 vs founder 60 is 9 steps away)
    for (let i = 0; i < RULES.N; i++) if (w.cell[i]) expect(w.g1[i]).toBeGreaterThan(120);
  });
});

describe('no body identity', () => {
  it('the world has no id or membership field and only census labels components', () => {
    const keys = Object.keys(eco1(1));
    expect(keys.filter((k) => /^(id|ids|body|bodies|organism|member|members|component|label)/i.test(k))).toEqual([]);
    const src = readFileSync(new URL('../src/bodies/model.ts', import.meta.url), 'utf8');
    expect((src.match(/const stack = new Int32Array/g) ?? []).length).toBe(1);
    expect(src.indexOf('const stack')).toBeGreaterThan(src.indexOf('export function census'));
    // the dynamics (birth .. injure) never read the lineage tag except to copy it to a newborn, and never call census
    const dyn = src.slice(src.indexOf('private birth('), src.indexOf('cellCount()'));
    expect(dyn).not.toMatch(/census\(/);
    const tagUses = dyn.split('\n').flatMap((l) => (l.match(/[\w.]*\btag\b[^;]*/g) ?? []));
    expect(tagUses.length).toBeGreaterThan(0);
    for (const u of tagUses) expect(u).toMatch(/^(tg = this\.tag\[par\]|this\.tag\[tile\] = tg|this\.tag\[i\] = 0)$|^tag\[par\],?$|tag\[par\]|tag\[tile\] = tg|tag\[i\] = 0/);
  });
});

describe('census on hand-built layouts', () => {
  const blank = () => new BodiesWorld({ seed: 1, founders: 1, positions: [] });
  const put = (w: BodiesWorld, x: number, y: number) => { w.cell[y * 96 + x] = 1; w.g0[y * 96 + x] = 16; w.g1[y * 96 + x] = 60; };
  it('two squares, a ring, a single cell', () => {
    const w = blank();
    for (let y = 10; y < 13; y++) for (let x = 10; x < 13; x++) put(w, x, y);
    for (let y = 10; y < 13; y++) for (let x = 20; x < 23; x++) put(w, x, y);
    for (let y = 40; y < 43; y++) for (let x = 40; x < 43; x++) if (!(x === 41 && y === 41)) put(w, x, y);
    put(w, 70, 70);
    const c = census(w);
    expect(c.sizes).toEqual([9, 9, 8, 1]); expect(c.comps).toBe(4); expect(c.largest).toBe(9); expect(c.singletons).toBe(1);
    expect(c.cells).toBe(27); expect(c.interiorPermille).toBe(Math.floor(2 * 1000 / 27));
    // edges: two 3x3 squares 12 each, ring 16 (outer 12 + inner 4), single 4
    expect(c.edgesPerCellPermille).toBe(Math.floor(44 * 1000 / 27));
  });
});

describe('v2 (foraging + transport), the default rule', () => {
  it('defaults to v2 and keeps v1 reachable', () => {
    expect(RULES.version).toBe(2); expect(eco(1).R.version).toBe(2); expect(eco1(1).R.version).toBe(1);
    expect(eco1(1).R.FORAGE).toBe(0); expect(eco1(1).R.FLOW).toBe(0); expect(eco1(1).R.ORPH16).toBe(0);
  });
  it('is deterministic, chunking-independent and pinned', () => {
    const a = eco(5), b = eco(5), c = eco(6), d = eco(5);
    a.step(400); b.step(400); c.step(400); for (let i = 0; i < 4; i++) d.step(100);
    expect(a.hashState()).toBe(b.hashState()); expect(a.hashState()).not.toBe(c.hashState()); expect(d.hashState()).toBe(a.hashState());
    const w = lone(1); w.step(300); expect(hashState(w)).toBe(PINNED_V2_HASH);
  });
  it('conserves matter exactly with foraging, transport, mutation and a wound; fields stay in range', () => {
    const w = eco(3);
    for (let k = 0; k < 15; k++) { w.step(100); if (k === 7) w.injure(24, 24, 5); expect(w.residual()).toBe(0); }
    expect(w.foraged).toBeGreaterThan(0); expect(w.moved).toBeGreaterThan(0); expect(w.lostWound).toBeGreaterThan(0);
    expect(validateWorld(w)).toEqual([]);
    for (let i = 0; i < RULES.N; i++) {
      expect(w.food[i]).toBeLessThanOrEqual(64); expect(w.store[i]).toBeLessThanOrEqual(24);
      if (w.cell[i]) { expect(w.g0[i]).toBeGreaterThanOrEqual(6); expect(w.g0[i]).toBeLessThanOrEqual(60); expect(w.g1[i]).toBeGreaterThanOrEqual(8); }
      else expect(w.store[i]).toBe(0);
    }
  });
  it('transport and forage only move matter between food and store (no creation)', () => {
    const w = lone(2); w.step(600);
    const before = w.matterTotal(); const supplied = w.supplied, burned = w.burned, over = w.lostOverflow;
    w.step(50);
    expect(w.matterTotal() - before).toBe((w.supplied - supplied) - (w.burned - burned) - (w.lostOverflow - over));
  });
  it('a lone body persists under upkeep as one compact single-root disk', () => {
    for (const seed of [1, 2]) {
      const w = lone(seed); w.step(2500);
      const c = census(w);
      expect(c.cells).toBeGreaterThanOrEqual(120); expect(c.cells).toBeLessThanOrEqual(220);
      expect(c.comps).toBe(1); expect(c.roots).toBe(1); expect(c.domains.n).toBe(1); expect(c.rootAge.max).toBeGreaterThan(2000);
      expect(w.residual()).toBe(0);
    }
  });
  it('without transport the same lone body does not hold (ablation)', () => {
    const w = lone(1, { rules: { FLOW: 0 } }); w.step(2000);
    const c = census(w); expect(c.cells > 220 || c.cells < 120).toBe(true);
  });
  it('size is gene-limited when small: a lone body with dmax 8 stays at the 49-cell disk', () => {
    const w = new BodiesWorld({ seed: 1, founders: 1, genome: [8, 60, 0, 0], mutRate: 0 }); w.step(1500);
    expect(w.cellCount()).toBe(49);
  });
  it('the neutral arm is gene-blind: dynamics equal mutation off, genes and tags differ', () => {
    const off = eco(4, 0), neu = eco(4, 3, { blind: true }), on = eco(4);
    off.step(1500); neu.step(1500); on.step(1500);
    for (const k of ['cell', 'food', 'store', 'd'] as const) expect([...neu[k]], k).toEqual([...off[k]]);
    for (const k of ['t', 'supplied', 'burned', 'lostOverflow', 'lostWound', 'births', 'rootings', 'foraged', 'moved', 'rootsCreated', 'rootsEnded', 'rootLifeSum'] as const) expect(neu[k], k).toBe(off[k]);
    expect(neu.mutations).toBeGreaterThan(0); expect(census(neu).genomeVariants).toBeGreaterThan(1); expect(census(off).genomeVariants).toBe(1);
    expect(neu.hashState()).not.toBe(off.hashState());
    expect([...on.cell]).not.toEqual([...off.cell]);   // the ON arm does read its genes: dynamics diverge from OFF
  });
  it('heredity under v2: genomes are copied to every descendant; with mutation on the lineage varies from the mutant', () => {
    const mut: model.Genome = [14, 120, 0, 8];
    const w = new BodiesWorld({ seed: 3, founders: 1, genome: FOUNDER_GENOME, mutRate: 0 });
    const root = 48 * 96 + 48; [w.g0[root], w.g1[root], w.g2[root], w.g3[root]] = mut; w.step(600);
    expect(w.cellCount()).toBeGreaterThan(30);
    for (let i = 0; i < RULES.N; i++) if (w.cell[i]) expect([w.g0[i], w.g1[i], w.g2[i], w.g3[i]]).toEqual(mut);
    const m = new BodiesWorld({ seed: 5, founders: 1, genome: [14, 200, 0, 0], mutRate: 24 }); m.step(3000);
    expect(m.mutations).toBeGreaterThan(3);
    for (let i = 0; i < RULES.N; i++) if (m.cell[i]) expect(m.g1[i]).toBeGreaterThan(120);
  });
  it('observer bookkeeping (rootSince, domains) is never read by the dynamics', () => {
    const src = readFileSync(new URL('../src/bodies/model.ts', import.meta.url), 'utf8');
    const dyn = src.slice(src.indexOf('private stepOnce('), src.indexOf('private markRoot('));
    expect(dyn).not.toMatch(/rootSince|rootsCreated|rootLifeSum|census\(|basins\(/);
  });
  it('root-basin domains: one body is one domain; shareWithinFactor2 counts sizes in [ref/2, 2ref]', () => {
    const w = lone(1); w.step(1200);
    const c = census(w); expect(c.domains.n).toBe(1); expect(c.domains.sizes[0]).toBe(c.cells); expect(c.domains.unrooted).toBe(0);
    expect(model.shareWithinFactor2({ allSizes: [100, 40, 10], cells: 150 }, 80)).toBe(Math.floor(140 * 1000 / 150));
  });
  it('root basins on a hand-built layout: touching roots, a tie, a lone root and unrooted cells', () => {
    const w = new BodiesWorld({ seed: 1, founders: 1, positions: [] });
    const put = (x: number, y: number, dv: number) => { w.cell[y * 96 + x] = 1; w.d[y * 96 + x] = dv; w.g0[y * 96 + x] = 16; w.g1[y * 96 + x] = 60; };
    // one row x=10..18, roots at both ends, d rises by 2 per step; the middle cell (d 8) ties and drains to the first lower neighbour in scan order (east)
    [0, 2, 4, 6, 8, 6, 4, 2, 0].forEach((dv, k) => put(10 + k, 10, dv));
    put(40, 40, 0);                         // a lone root: a basin of one
    put(60, 60, 255); put(61, 60, 255);     // two cells with no root and no lower neighbour: unrooted
    const c = census(w);
    expect(c.domains.n).toBe(3); expect(c.domains.sizes).toEqual([5, 4, 1]); expect(c.domains.unrooted).toBe(2);
    expect(c.domains.q).toEqual([1, 4, 4]); expect(c.comps).toBe(3);
  });
});
describe('rule overrides, wounds and wound placement', () => {
  it('a wound uses the world rules: with C 4 the ledger stays exact', () => {
    const w = new BodiesWorld({ seed: 2, founders: 1, genome: SHAPE, mutRate: 0, rules: { C: 4 } });
    w.step(300); expect(w.residual()).toBe(0); expect(w.injure(48, 48, 5)).toBeGreaterThan(10); expect(w.lostWound).toBeGreaterThan(0); expect(w.residual()).toBe(0);
    w.step(100); expect(w.residual()).toBe(0);
  });
  it('rejects overrides that would break storage bounds or the geometry', () => {
    const mk = (rules: Partial<model.Rules>) => () => new BodiesWorld({ seed: 1, rules });
    expect(mk({ CAP: 256 })).toThrow(/CAP/); expect(mk({ CAP: 300, FOUNDER_STORE: 255 })).toThrow();
    expect(mk({ FOUNDER_STORE: 30 })).toThrow(/FOUNDER_STORE/); expect(mk({ FMAX: 256 })).toThrow(/FMAX/); expect(mk({ INIT_FOOD: 65 })).toThrow(/INIT_FOOD/);
    expect(mk({ W: 64 })).toThrow(/fixed/); expect(mk({ UPK: 0 })).toThrow(/UPK/); expect(mk({ UPK: 1.5 })).toThrow(/integer/);
    expect(mk({ NOPE: 1 } as unknown as Partial<model.Rules>)).toThrow(/unknown rule/);
    expect(mk({ CAP: 255, FOUNDER_STORE: 255 })).not.toThrow(); expect(mk({ UPK: 6 })).not.toThrow();
  });
  it('a root-spared wound is placed from the roots that are alive now', async () => {
    const { placeWound } = await import('../../../experiments/bodies/run.ts');
    // the case from review: founder bud-off copy, seed 12; the sole root has moved away from the founder spot
    const w = new BodiesWorld({ seed: 12, founders: 1, genome: [16, 60, 0, 0], mutRate: 0 }); w.step(2000);
    const roots = [...w.d].map((v, i) => (w.cell[i] && v === 0 ? i : -1)).filter((i) => i >= 0);
    const pl = placeWound(w, 'spared', 8);
    expect(pl.cls).toBe('root-spared'); expect(pl.rootsInDisk).toBe(0); expect(pl.rootsBefore).toBe(roots.length);
    const before = roots.length; expect(w.injure(pl.cx, pl.cy, 4)).toBeGreaterThan(0);
    expect([...w.d].filter((v, i) => w.cell[i] && v === 0).length).toBe(before);
    const k = placeWound(w, 'killed', 8); expect(k.cls).toBe('root-killed'); expect(k.rootsInDisk).toBeGreaterThanOrEqual(1);
  });
});
const PINNED_V2_HASH = 501260932; // v2, lone shape genome, seed 1, 300 steps, upkeep on
