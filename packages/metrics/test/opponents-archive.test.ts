import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ORDER_MIN_EDGES, analyze, binOf, chooseScrambled, directional, directedCycle, findCycles, horizonOf, matrixFromCentres, naiveLaterWins, panelUnderOrder, permutationRank, permutations,
  runFixtures, selectSnapshots, strengthOrder, temporalLabel, viableBins, TEMPORAL_LABELS, type Elite, type LabelInput, type Mat,
} from '../src/archive-tournament/index.ts';
import { chainFixture } from '../src/archive-tournament/index.ts';
import { panelFromFirstRung, planOf, scheduleCounts, type ArchiveConfig, type ArchiveFixture } from '../src/archive-tournament/evidence.ts';
import { buildPanel, weaken } from '../src/opponents/panel.ts';
import { runJob, type Job } from '../src/opponents/arena.ts';
import { genomeHex } from '@bl/schema';

const root = new URL('../../../', import.meta.url).pathname;
const CONFIG: ArchiveConfig = JSON.parse(readFileSync(`${root}tools/opponents/archive-config.json`, 'utf8'));
const FIRST = JSON.parse(readFileSync(`${root}docs/historical-opponents-2026-11-01/evidence.json`, 'utf8'));
const FIRST_CONFIG = JSON.parse(readFileSync(`${root}tools/opponents/config.json`, 'utf8'));
const panel = panelFromFirstRung(FIRST);
const elite = (born: number, quality: number, cell: [number, number] = [0, 0]): Elite => ({ born, quality, cell, hex: `h${born}-${quality}-${cell.join('.')}` });

describe('snapshot selection', () => {
  it('snapshot selection is deterministic and respects bins', () => {
    // horizon 10, 5 bins of width 2; two equal-quality elites in bin 1 tie by cell then born; bin 3 is empty
    const es = [elite(0, 0.5), elite(1, 0.9, [3, 1]), elite(2, 0.8), elite(3, 0.8, [1, 5]), elite(3, 0.8, [1, 4]), elite(4, 0.1), elite(9, 0.3)];
    const a = selectSnapshots(es, 5, () => true), b = selectSnapshots([...es].reverse(), 5, () => true);
    expect(a).toEqual(b);
    expect(a.horizon).toBe(10);
    expect(a.bins.map((x) => x.status)).toEqual(['viable', 'viable', 'viable', 'empty', 'viable']);
    expect(a.bins[0].pick!.born).toBe(1);
    expect(a.bins[1].pick!.cell).toEqual([0, 0]); // three-way tie on quality .8 broken by cell, then born
    expect(selectSnapshots([elite(3, 0.8, [1, 5]), elite(3, 0.8, [1, 4])], 1, () => true).bins[0].pick!.cell).toEqual([1, 4]);
    expect(a.bins[3].pick).toBeNull();
  });
  it('a bin takes the best candidate that passes the screen and screens lazily', () => {
    const es = [elite(0, 0.9), elite(1, 0.5)];
    const seen: string[] = [];
    const s = selectSnapshots(es, 1, (e) => { seen.push(e.hex); return e.quality < 0.6; });
    expect(s.bins[0].pick!.quality).toBe(0.5);
    expect(s.bins[0].screened).toBe(2);
    expect(seen).toHaveLength(2);
  });
  it('source dropped when fewer than 4 bins viable', () => {
    const es = [elite(0, 1), elite(10, 1), elite(20, 1), elite(30, 1), elite(40, 1)];
    expect(viableBins(selectSnapshots(es, 5, () => true).bins)).toBe(5);
    expect(viableBins(selectSnapshots(es, 5, (e) => e.born < 30).bins)).toBe(3);
    expect(viableBins(selectSnapshots(es, 5, (e) => e.born < 30).bins) < CONFIG.minViableBins).toBe(true);
  });
  it('born binning uses batch index (regression on the real archive ranges)', () => {
    for (const [lo, hi] of [[8, 79], [5, 297], [5, 79]]) {
      const es = [lo, hi, Math.round((lo + hi) / 2)].map((b) => elite(b, 1));
      const h = horizonOf(es);
      expect(h).toBe(hi + 1);
      const spread = new Set(es.map((e) => binOf(e.born, h, 5)));
      expect(spread.size).toBeGreaterThanOrEqual(3); // an evaluation-index horizon (1280) would put every elite in bin 0
    }
    expect(binOf(79, 80, 5)).toBe(4);
    expect(binOf(0, 80, 5)).toBe(0);
  });
});

describe('time-shuffled null and directional statistic', () => {
  it('time-shuffled null: all K! permutations enumerated, identity counted once, min rank = 1/K!, eligibility mask moves with the snapshot', () => {
    for (const k of [3, 4, 5]) {
      const ps = permutations(k);
      expect(ps).toHaveLength([1, 2, 3, 4, 5].slice(0, k).reduce((a, b) => a * b, 1));
      expect(new Set(ps.map((p) => p.join(','))).size).toBe(ps.length);
      expect(ps[0]).toEqual([...Array(k).keys()]);
    }
    const aligned = matrixFromCentres(5, Object.fromEntries([...Array(5).keys()].flatMap((i) => [...Array(5).keys()].filter((j) => j > i).map((j) => [`${i}|${j}`, 0.2]))));
    const r = permutationRank(aligned.payoff);
    expect(r.rDir).toBe(1 / 120);
    expect(r.minRank).toBe(1 / 120);
    // an uninformative pair is excluded: the number of terms is the same for every permutation
    const holed = aligned.payoff.map((row) => [...row]) as Mat;
    holed[1][3] = null;
    const terms = new Set(permutations(5).map((p) => directional(holed, p).terms));
    expect([...terms]).toEqual([9]);
    expect(permutationRank(holed).perms).toBe(120);
  });
  it('directional statistic is high on a constructed transitive matrix and unaligned after scrambling', () => {
    const al = analyze(panelUnderOrder(panel, strengthOrder(panel)));
    expect(al.rank.rDir).toBeLessThanOrEqual(0.05);
    expect(al.naive.fraction).toBe(1);
    const sc = analyze(panelUnderOrder(panel, CONFIG.scrambled));
    expect(sc.rank.rDir!).toBeGreaterThan(0.2);
    expect(sc.rank.observed!).toBeLessThan(al.rank.observed!);
  });
  it('uninformative pairs are excluded and counted, never read as 0.5', () => {
    const base = matrixFromCentres(4, { '0|1': 0.2, '0|2': 0.2, '0|3': 0.2, '1|2': 0.2, '1|3': 0.2, '2|3': 0.2 });
    const holed: Mat = base.payoff.map((r) => [...r]);
    holed[0][3] = null;
    const a = analyze({ ...base, payoff: holed });
    expect(a.scheduled).toBe(6);
    expect(a.informative).toBe(5);
    expect(a.rank.terms).toBe(5);
    // the observed mean is over informative pairs only: reading the hole as 0.5 would lower it
    expect(a.rank.observed!).toBeGreaterThan(analyze({ ...base, payoff: base.payoff.map((r, i) => r.map((v, j) => (i === 0 && j === 3 ? 0.5 : v))) }).rank.observed!);
    const t = temporalLabel({ controlInvalid: false, insensitiveOrBiased: false, assayFailed: false, scheduled: 6, informative: 5, rDir: 0.04, rDirResid: 0.04, ordered: false, rDirMax: 0.05 });
    expect(t).toEqual({ label: 'partial-tournament', underlying: 'directional-rank' });
  });
});

describe('fixtures that fool the naive metric', () => {
  const fx = runFixtures({ rDirMax: CONFIG.rDirMax, scrambled: CONFIG.scrambled, panel });
  const byId = (id: string) => fx.find((f) => f.id === id)!;
  it('naive metric is fooled by the 3-cycle', () => {
    const f = byId('cycle-fools-naive');
    expect(f.naive.fraction).toBeCloseTo(2 / 3, 9);
    expect(f.cycleFlag).toBe('cycle');
    expect(f.minRank).toBeCloseTo(1 / 6, 9);
    expect(f.pass).toBe(true);
    expect(f.synthetic).toBe(true);
  });
  it('long-cycle fixture flags a cycle that findCycles misses', () => {
    const f = byId('long-cycle-fools-naive');
    expect(f.cycleFlag).toBe('cycle');
    expect(f.trianglesFound).toBe(0);
    expect(f.naive.fraction).toBeCloseTo(0.7, 9);
    expect(f.pass).toBe(true);
    // the general detector agrees with the triangle finder on triangles and finds the 4-cycle
    const tri = [[false, true, false], [false, false, true], [true, false, false]];
    expect(directedCycle(tri)).toHaveLength(3);
    expect(findCycles(tri)).toHaveLength(1);
    const four = [[0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1], [1, 0, 0, 0]].map((r) => r.map(Boolean));
    expect(findCycles(four)).toHaveLength(0);
    expect(directedCycle(four)).toHaveLength(4);
    expect(directedCycle([[false, true], [false, false]])).toBeNull();
  });
  it('vigour-only is directional-vigour-only, never directional-rank', () => {
    const f = byId('vigour-only');
    expect(f.rDir).toBe(1 / 120);
    expect(f.rDirResid).toBe(1);
    expect(f.label).toBe('directional-vigour-only');
    expect(f.pass).toBe(true);
  });
  it('strength-not-time classifies aligned directional and scrambled ordered-not-temporal (pure matrix); scrambled rank above 0.20', () => {
    expect(byId('strength-aligned').label).toMatch(/^directional-/);
    const s = byId('strength-scrambled');
    expect(s.label).toBe('ordered-not-temporal');
    expect(s.rDir!).toBeGreaterThan(0.2);
    expect(s.naive.fraction).toBeGreaterThanOrEqual(0.6); // the naive metric still reads partial improvement
    // the order the plan review rejected has rank 2/120
    const rejected = analyze(panelUnderOrder(panel, ['W', 'F3', 'F2', 'G', 'F1']));
    expect(rejected.rank.rDir).toBeLessThan(0.2);
    // the frozen order is what the freeze-time search picks
    expect(chooseScrambled(panel, CONFIG.rDirMax)!.order).toEqual(CONFIG.scrambled);
    expect(fx.filter((f) => f.id !== 'planted-chain').every((f) => f.pass)).toBe(true);
  });
  it('a planted chain with an uninformative pair cannot pass the gate', () => {
    const full = matrixFromCentres(4, Object.fromEntries(['0|1', '0|2', '0|3', '1|2', '1|3', '2|3'].map((k) => [k, 0.2])));
    expect(chainFixture(analyze(full), 0.05, ['p0', 'p1', 'p2', 'p3']).pass).toBe(true);
    const holed = { ...full, payoff: full.payoff.map((r) => [...r]) as Mat };
    holed.payoff[0][3] = null;
    expect(chainFixture(analyze(holed), 0.05, ['p0', 'p1', 'p2', 'p3']).pass).toBe(false);
  });
  it('the first rung panel is the one the fixture reads', () => {
    expect(panel.ids).toEqual(['G', 'F1', 'F2', 'F3', 'W']);
    expect(ORDER_MIN_EDGES).toBe(3);
    expect(naiveLaterWins(panelUnderOrder(panel, strengthOrder(panel)).payoff).pairs).toBe(10);
  });
});

describe('verdict table', () => {
  const ref = (i: LabelInput): string => {
    if (i.controlInvalid) return 'control-invalid';
    if (i.insensitiveOrBiased) return 'insensitive-or-biased';
    if (i.assayFailed) return 'assay-failed';
    const body = i.rDir !== null && i.rDir <= i.rDirMax ? (i.rDirResid !== null && i.rDirResid <= i.rDirMax ? 'directional-rank' : 'directional-vigour-only') : i.ordered ? 'ordered-not-temporal' : 'nothing-beyond-null';
    return i.informative < i.scheduled ? 'partial-tournament' : body;
  };
  it('verdict table precedence is exhaustive (every control/planted/eligibility/cycle combination)', () => {
    let n = 0;
    const bools = [false, true];
    for (const controlInvalid of bools) for (const insensitiveOrBiased of bools) for (const assayFailed of bools) for (const informative of [10, 9, 0])
      for (const rDir of [null, 0.01, 0.05, 0.0500001, 0.5]) for (const rDirResid of [null, 0.01, 0.2]) for (const ordered of bools) {
        const i: LabelInput = { controlInvalid, insensitiveOrBiased, assayFailed, scheduled: 10, informative, rDir, rDirResid, ordered, rDirMax: 0.05 };
        const out = temporalLabel(i);
        expect(out.label).toBe(ref(i));
        expect(TEMPORAL_LABELS).toContain(out.label);
        expect(out.underlying === null).toBe(out.label !== 'partial-tournament');
        n++;
      }
    expect(n).toBe(8 * 3 * 5 * 3 * 2);
  });
  it('the cycle flag is independent of the temporal label', () => {
    const a = analyze(matrixFromCentres(3, { '0|1': 0.2, '1|2': 0.2, '0|2': 0.8 }));
    expect(a.cycleFlag).toBe('cycle');
    expect(a.ordered).toBe(false);
  });
});

describe('config and schedule', () => {
  const src = (short: string): ArchiveFixture['sources'][number] => ({
    name: short, short, file: 'x', fileSha256: '', evaluated: 0, elites: 5, horizon: 5, resumeExact: null, status: 'kept', dropReason: null, compat: { ok: true, problems: [] }, screens: [],
    bins: [0, 1, 2, 3, 4].map((b) => ({ bin: b, lo: b, hi: b + 1, status: 'viable' as const, candidates: 1, screened: 1, snapshot: `${short}:${b}` })),
    snapshots: [0, 1, 2, 3, 4].map((b) => ({ id: `${short}:${b}`, bin: b, cell: [b, 0] as [number, number], born: b, quality: 1, hex: `${b}`, sharedWith: [] })),
  });
  const fx: ArchiveFixture = { kind: 'historical-opponents-archive-fixture', version: 1, transferConditions: [], screenSeeds: CONFIG.screen.seeds, sources: [src('a'), src('b'), src('c')] };
  it('schedule counts match config (200 contests per source pair family, solo, controls)', () => {
    const plan = planOf(CONFIG, fx);
    const pairJobs = plan.jobs.filter((j) => j.key.startsWith('c|a:') && !j.key.includes("'") && j.b !== null && !j.b.endsWith('w'));
    expect(pairJobs).toHaveLength(200); // 10 ordered pairs x 10 seeds x 2 positions
    expect(plan.jobs.filter((j) => j.key.startsWith("c|a:4|a:4'|")).length).toBe(20);
    expect(plan.jobs.filter((j) => j.key.startsWith('c|a:4|a:4w|')).length).toBe(20);
    expect(plan.jobs.filter((j) => j.key.startsWith('s|a:0|')).length).toBe(20);
    expect(scheduleCounts(plan.jobs)).toEqual({ jobs: 1360, contests: 860, solo: 480, depletion: 20 });
    expect(plan.starved).toEqual(['a:0', 'a:1']);
    expect(new Set(plan.jobs.map((j) => j.key)).size).toBe(plan.jobs.length);
  });
  it('seeds are disjoint from search 1..300, screen, first-rung and calibration seeds', () => {
    const scoring = [...CONFIG.seeds, ...CONFIG.reserveSeeds];
    const used = new Set<number>([...Array.from({ length: 300 }, (_, i) => i + 1), ...CONFIG.screen.seeds, ...FIRST_CONFIG.seeds, ...FIRST_CONFIG.rareSeeds, 1, 2, 3]);
    for (const t of [7001, 7002]) expect(used.has(t) || scoring.includes(t)).toBe(false); // test-only seeds
    for (const s of scoring) expect(used.has(s)).toBe(false);
    for (const s of CONFIG.screen.seeds) expect(CONFIG.seeds.includes(s) || CONFIG.reserveSeeds.includes(s) || s <= 300 || FIRST_CONFIG.seeds.includes(s)).toBe(false);
    expect(new Set(scoring).size).toBe(20);
    expect(CONFIG.seeds).toHaveLength(10);
    expect(CONFIG.searchSeeds).toEqual([1, 300]);
  });
  it('the arena matches the first rung and the effect target is the first rung\'s', () => {
    expect(CONFIG.arena).toEqual(FIRST_CONFIG.arena);
    expect(CONFIG.effectTarget).toBe(FIRST_CONFIG.effectTarget);
    expect(CONFIG.depletion).toEqual(FIRST_CONFIG.depletion.override);
    expect(CONFIG.weakenPercent).toBe(FIRST_CONFIG.weakenPercent);
  });
  it('no pooled rank or p across sources in the schema', async () => {
    const text = readFileSync(`${root}packages/metrics/src/archive-tournament/evidence.ts`, 'utf8') + readFileSync(`${root}packages/metrics/src/archive-tournament/index.ts`, 'utf8');
    expect(text).not.toMatch(/pooled[A-Z]|pooledRank|pooledP\b|pooledP"/);
  });
});

describe('small real arena runs (reusing runJob)', () => {
  const P = buildPanel(50);
  const arena = { tile: 32, radius: 3, steps: 60 };
  const job = (key: string, seed: number, hexA: string, hexB: string, pos: 1 | 2): Job => ({ key, seed, hexA, hexB, slotsA: pos === 1 ? [0, 1] : [2, 3], slotsB: pos === 1 ? [2, 3] : [0, 1] });
  it('twin snapshot swap is exact', () => {
    const g = genomeHex(P.genomes.F1);
    const r1 = runJob(job('a', 7001, g, g, 1), arena), r2 = runJob(job('b', 7001, g, g, 2), arena);
    expect([r1.b0A, r1.b0B]).toEqual([r2.b0B, r2.b0A]);
    r1.cp.forEach((c, k) => expect([c.bA, c.bB, c.cellsA, c.cellsB]).toEqual([r2.cp[k].bB, r2.cp[k].bA, r2.cp[k].cellsB, r2.cp[k].cellsA]));
  });
  it('planted-chain in-world mini (T=60, 2 seeds) orders by weakening', () => {
    const strong = genomeHex(P.genomes.G), weak = genomeHex(weaken(P.genomes.G, 80));
    for (const seed of [7001, 7002]) { // test-only seeds, disjoint from every scoring, screen and calibration seed
      const a = runJob(job('x', seed, strong, weak, 1), arena), b = runJob(job('y', seed, strong, weak, 2), arena);
      const share = (bA: number, bB: number) => bA / (bA + bB);
      const strongShare = (share(a.cp[3].bA, a.cp[3].bB) + share(b.cp[3].bA, b.cp[3].bB)) / 2;
      expect(strongShare).toBeGreaterThan(0.5);
    }
  });
});
