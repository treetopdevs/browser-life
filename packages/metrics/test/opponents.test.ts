import { describe, expect, it } from 'vitest';
import { CH, G, genomeDistance, genomeFromHex, genomeHex, lowbias32, stateHash, w2, OUT } from '@bl/schema';
import { RefSim } from '@bl/sim-ref';
import {
  ARMS, MASKS, evaluateGates, panelPairs, runFixtures, schedule, summarize, twinOf, validateRuns, type AssayConfig, type JobSpec, type RunRec,
} from '../src/opponents/evidence.ts';
import {
  assertNonOverlap, buildContestWorld, checkpointSteps, readLabels, runJob, slotCentres, PLANT, type ArenaParams, type Job,
} from '../src/opponents/arena.ts';
import { buildPanel, farthestPoints, generalist, weaken } from '../src/opponents/panel.ts';
import {
  EDGE_MIN_BLOCKS, atFloor, blockPayoff, breadth, classify, decideVerdict, edgesFromPayoffs, findCycles, hasNoThreeCycle, shareA, sharePpm, signFlipP, summarizeInvasion,
  summarizePair, tInterval, vigourExpected, vigourResidual, minP, type Gates, type BlockPayoff, type Verdict,
} from '../src/opponents/payoff.ts';

const P: ArenaParams = { tile: 32, radius: 3, steps: 40 };
const panel = buildPanel(50);
const job = (seed: number, a: string, b: string | null, sa: number[], sb: number[]): Job => ({ key: 'k', seed, hexA: panel.hex[a as 'G'], hexB: b ? panel.hex[b as 'G'] : null, slotsA: sa, slotsB: sb });
const blocks = (vals: (number | null)[]): BlockPayoff[] => vals.map((v, i) => ({ seed: i, payoff: v, naive: v ?? 0.5, shares: [v] }));

describe('arena and inoculum', () => {
  it('inoculum is identical across contests: same slot, same step-zero inventory', () => {
    const inv = (j: Job) => { const s = buildContestWorld(j, P); const n = 32 * 32; let b = 0, e = 0; for (let i = 0; i < n; i++) { b += s.cells[CH.B * n + i]; e += s.cells[CH.E * n + i]; } return [b, e]; };
    const slot0 = (j: Job) => { const s = buildContestWorld(j, P); const n = 1024; const c = slotCentres(32, 7)[0]; return s.cells[CH.B * n + c.y * 32 + c.x]; };
    const a = job(7, 'G', 'F1', [0, 1], [2, 3]);
    const b = job(7, 'G', 'W', [0, 1], [2, 3]);
    const solo = job(7, 'F2', null, [0, 1], []);
    expect(inv(a)).toEqual(inv(b));
    expect(slot0(a)).toBe(slot0(b));
    expect(slot0(a)).toBe(slot0(solo));
    // swapped ratio 1:3 conserves the totals of the 3-slot union
    const r1 = inv(job(7, 'G', 'F1', [0], [1, 2, 3])), r2 = inv(job(7, 'G', 'F1', [1, 2, 3], [0]));
    expect(r1).toEqual(r2);
  });

  it('step-zero inventory of a slot is equal across contests and solo arenas; reciprocal arenas have equal resource fields', () => {
    const n = 1024;
    const ca = slotCentres(32, 9);
    const sA = buildContestWorld(job(9, 'G', 'F1', [0, 1], [2, 3]), P);
    const sB = buildContestWorld(job(9, 'F1', 'G', [0, 1], [2, 3]), P);
    const sSolo = buildContestWorld(job(9, 'G', null, [2], []), P);
    const at = (s: typeof sA, slot: number) => s.cells[CH.B * n + ca[slot].y * 32 + ca[slot].x];
    expect(at(sA, 2)).toBe(at(sSolo, 2));
    expect(at(sA, 0)).toBe(at(sB, 0));
    const field = (s: typeof sA, ch: number) => Array.from(s.cells.subarray(ch * n, (ch + 1) * n)).join(',');
    expect(field(sA, CH.A)).toBe(field(sB, CH.A));
    expect(field(sA, CH.A)).toBe(field(sSolo, CH.A));
    // emptied slots hold no biomass, energy or lineage
    for (let i = 0; i < n; i++) {
      const lin = sSolo.genome[G.LIN_LO * n + i];
      if (sSolo.cells[CH.B * n + i] === 0) expect(sSolo.genome[G.LIN_HI * n + i] | lin).toBe(0);
    }
  });

  it('jitter is reproducible and differs per slot and axis (one-argument lowbias32)', () => {
    expect(slotCentres(32, 5)).toEqual(slotCentres(32, 5));
    const seen = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) for (const c of slotCentres(32, seed)) seen.add(`${c.x},${c.y}`);
    expect(seen.size).toBeGreaterThan(25);
    expect(slotCentres(32, 1)).not.toEqual(slotCentres(32, 2));
    expect(lowbias32.length).toBe(1);
    const c = slotCentres(32, 3);
    for (let s = 0; s < 4; s++) expect(Math.abs(c[s].x - [8, 24, 24, 8][s])).toBeLessThanOrEqual(2);
    assertNonOverlap(32, 3);
    expect(() => assertNonOverlap(32, 7)).toThrow();
  });

  it('reciprocal positions swap slot sets: relabelling reproduces the same world', () => {
    const g = job(4, 'G', 'F1', ARMS.bal.P1.A.slice(), ARMS.bal.P1.B.slice());
    const h = job(4, 'F1', 'G', ARMS.bal.P2.A.slice(), ARMS.bal.P2.B.slice());
    expect(stateHash(buildContestWorld(g, P))).toBe(stateHash(buildContestWorld(h, P)));
  });

  it('mutation off: no new lineage ids; labels sum to total biomass', () => {
    const j = job(3, 'G', 'F1', [0, 1], [2, 3]);
    const sim = new RefSim(buildContestWorld(j, P));
    for (const step of checkpointSteps(80)) {
      sim.run(step - sim.state.step);
      const r = readLabels(sim.state, j); // throws on a foreign lineage or an unlabelled biomass unit
      let total = 0; const n = 1024;
      for (let i = 0; i < n; i++) total += sim.state.cells[CH.B * n + i];
      expect(r.bA + r.bB).toBe(total);
    }
    expect(sim.state.cfg.mutRate).toBe(0);
  });

  it('readouts do not change physics', () => {
    const j = job(2, 'G', 'W', [0, 1], [2, 3]);
    const hashes: string[] = [];
    runJob(j, { ...P, steps: 40 }, (sim) => { hashes.push(stateHash(sim.state)); });
    const twin = new RefSim(buildContestWorld(j, { ...P, steps: 40 }));
    const plain: string[] = [];
    for (const t of checkpointSteps(40)) { twin.run(t - twin.state.step); plain.push(stateHash(twin.state)); }
    expect(hashes).toEqual(plain);
  });

  it('twin genomes under two labels are distinguishable by lineage only', () => {
    const j = job(2, 'G', 'G', [0, 1], [2, 3]);
    const s = buildContestWorld(j, P);
    const n = 1024;
    const words = new Map<number, string>();
    for (let i = 0; i < n; i++) {
      const lo = s.genome[G.LIN_LO * n + i];
      if (!lo) continue;
      const w = Array.from({ length: 40 }, (_, k) => s.genome[(G.W0 + k) * n + i]).join(',') + `|${s.genome[G.PARAM0 * n + i]}`;
      words.set(lo, w);
    }
    expect(words.size).toBe(4);
    expect(new Set(words.values()).size).toBe(1);
    expect(readLabels(s, j).bA).toBeGreaterThan(0);
    expect(twinOf('G')).toBe("G'");
  });

  it('twin: label swap gives exact count identity', () => {
    const a = runJob({ ...job(5, 'G', 'G', [0, 1], [2, 3]), key: 'a' }, P);
    const b = runJob({ ...job(5, 'G', 'G', [2, 3], [0, 1]), key: 'b' }, P);
    expect([a.b0A, a.b0B]).toEqual([b.b0B, b.b0A]);
    a.cp.forEach((c, k) => { expect([c.bA, c.bB, c.cellsA, c.cellsB]).toEqual([b.cp[k].bB, b.cp[k].bA, b.cp[k].cellsB, b.cp[k].cellsA]); });
  });
});

describe('panel', () => {
  it('weakened variant differs from parent only in the stated weight', () => {
    const g = generalist(), w = weaken(g, 50);
    const diff: number[] = [];
    g.weights.forEach((v, i) => { if (v !== w.weights[i]) diff.push(i); });
    expect(diff).toEqual([w2(1, OUT.PHOTO)]);
    expect(w.weights[diff[0]]).toBe(55);
    expect(w.mu).toBe(g.mu); expect(w.sigma).toBe(g.sigma);
    expect(genomeDistance(g, w)).toBe(1);
    expect(genomeFromHex(genomeHex(w)).weights).toEqual(w.weights);
  });
  it('farthest-point pick is deterministic and distinct', () => {
    const a = buildPanel(50), b = buildPanel(50);
    expect(a.founderIndices).toEqual(b.founderIndices);
    expect(new Set(a.founderIndices).size).toBe(3);
    for (const [k, d] of Object.entries(a.distances)) if (!k.includes('W') || !k.includes('G')) expect(d, k).toBeGreaterThan(10);
    expect(farthestPoints(generalist(), [generalist(), weaken(generalist(), 90)], 2)).toHaveLength(2);
  });
});

describe('share arithmetic and classes', () => {
  it('share arithmetic is integer and exact; 0/0 is both-floor, never 0.5', () => {
    expect(shareA(1000, 1000, 0, 0)).toBeNull();
    expect(classify(1000, 1000, 0, 0)).toBe('both-floor');
    expect(shareA(1000, 1000, 600, 200)).toBe(0.75);
    expect(sharePpm(1, 2)).toBe(333333);
    expect(sharePpm(0, 0)).toBeNull();
  });
  it('flooring never creates 0.4999995: gates use counts, ppm is display only', () => {
    const s1 = shareA(1, 1, 3, 3)!, s2 = shareA(1, 1, 3, 3)!;
    expect((s1 + s2) / 2).toBe(0.5);
    expect(sharePpm(1000001, 1000000 + 1000002 - 1000001 + 1)).toBeLessThan(500000 + 1);
  });
  it('run classes at the floor: contested / decisive / both-floor at the threshold edges', () => {
    expect(atFloor(62, 1000)).toBe(true);
    expect(atFloor(63, 1000)).toBe(false);
    expect(classify(1000, 1000, 62, 62)).toBe('both-floor');
    expect(classify(1000, 1000, 62, 63)).toBe('decisive');
    expect(classify(1000, 1000, 63, 63)).toBe('contested');
    expect(shareA(1000, 1000, 62, 63)).toBeCloseTo(62 / 125);
  });
  it('complete-block eligibility drops the whole block when one position is both-floor', () => {
    const live = { b0A: 1000, b0B: 1000, bA: 500, bB: 500 }, dead = { b0A: 1000, b0B: 1000, bA: 1, bB: 1 };
    const b = blockPayoff(1, [live, dead]);
    expect(b.payoff).toBeNull();
    expect(b.naive).toBe(0.5 * (0.5 + 0.5));
    expect(blockPayoff(2, [live, live]).payoff).toBe(0.5);
  });
});

describe('inference and aggregation', () => {
  it('sign-flip p values: n=6 min 0.031, n=10 min 0.002; edges refused when n < 9', () => {
    expect(signFlipP([1, 1, 1, 1, 1, 1])).toBeCloseTo(2 / 64);
    expect(minP(6)).toBeCloseTo(0.03125);
    expect(signFlipP(Array(10).fill(0.3))).toBeCloseTo(2 / 1024);
    expect(signFlipP([])).toBeNull();
    const eight = summarizePair(blocks(Array(8).fill(0.9)), 0.8);
    expect(eight.allSameSide).toBe(true);
    expect(eight.edge).toBeNull();
    expect(summarizePair(blocks(Array(9).fill(0.9)), 0.8).edge).toBe('A>B');
    expect(summarizePair(blocks(Array(10).fill(0.1))).edge).toBe('B>A');
    expect(EDGE_MIN_BLOCKS).toBe(9);
  });
  it('payoff interval from known blocks', () => {
    const t = tInterval([0.4, 0.5, 0.6])!;
    expect(t.mean).toBeCloseTo(0.5);
    expect(t.df).toBe(2);
    expect(t.hi - t.mean).toBeCloseTo(4.303 * 0.1 / Math.sqrt(3), 6);
    expect(tInterval([0.5])).toBeNull();
  });
  it('vigour-only fixture has zero residual', () => {
    const e = vigourExpected(300, 100);
    expect(e).toBe(0.75);
    expect(vigourResidual(0.75, e)).toBe(0);
    expect(vigourExpected(0, 0)).toBeNull();
    expect(runFixtures().vigourOnly.pass).toBe(true);
  });
  it('cycle detector finds the constructed cycle only', () => {
    const f = runFixtures();
    expect(f.rpsSynthetic.cycles).toEqual([['A', 'B', 'C']]);
    expect(f.transitive.cycles).toEqual([]);
    expect(f.straddle.edge).toBeNull();
    expect(f.pass).toBe(true);
    const e = edgesFromPayoffs([[null, 0.8, 0.2], [0.2, null, 0.8], [0.8, 0.2, null]]);
    expect(findCycles(e)).toEqual([[0, 1, 2]]);
    expect(findCycles(edgesFromPayoffs([[null, 0.52, 0.5], [0.48, null, 0.5], [0.5, 0.5, null]]))).toEqual([]);
  });
  it('asymmetric exclusion fixtures behave as stated', () => {
    expect(runFixtures().asymmetricExclusion).toMatchObject({ complete: 7, excluded: 3, status: 'uninformative', pass: true });
  });
  it('breadth is separate from mean payoff', () => {
    // X beats two weak opponents narrowly, Y beats one strong opponent hard; equal mean payoff, different breadth
    const e = [[false, true, true, false], [false, false, false, false], [false, false, false, false], [false, false, false, false]];
    expect(breadth(e)).toEqual([2, 0, 0, 0]);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean([0.6, 0.6, 0.5])).toBeCloseTo(mean([0.9, 0.5, 0.3]));
  });
  it('invasion from rare labels: invades, fails, unclear, uninformative', () => {
    expect(summarizeInvasion([0.1, 0.2, 0.05, 0.1, 0.3, 0.1]).class).toBe('invades');
    expect(summarizeInvasion([-0.1, -0.2, -0.05, -0.1, -0.3, -0.1]).class).toBe('fails');
    expect(summarizeInvasion([0.1, -0.2, 0.05, 0.1, 0.3, 0.1]).class).toBe('unclear');
    expect(summarizeInvasion([0.1, null, null, 0.1, 0.3, 0.1]).class).toBe('uninformative');
  });
  it('rare arms: neutral expectation is the measured initial share', () => {
    // a rare label that holds exactly its initial share has excess 0 even though that share is far from 0.5
    const cfg: AssayConfig = { arena: P, depletion: null, weakenPercent: 50, ids: ['G', 'W'], seeds: [1, 2], rareSeeds: [1, 2], rarePositions: 1, twinG: true, effectTarget: 1 };
    const runs: RunRec[] = schedule(cfg).map((j) => {
      const solo = j.key[0] === 's';
      const b0: [number, number] = solo ? [1000, 0] : [Math.round(1000 * j.slotsA.length), Math.round(1000 * j.slotsB.length)];
      return { key: j.key, b0, e0: [0, 0], cp: [0, 1, 2, 3].map(() => [b0[0], b0[1], 1, 1] as [number, number, number, number]) };
    });
    const s = summarize(cfg, runs, [10, 20, 30, 40]);
    expect(s.invasion['G|W']!.rareA.excess.every((v) => v === 0)).toBe(true);
    expect(s.invasion['G|W']!.rareA.class).not.toBe('invades');
  });
});

describe('schedule, verdict', () => {
  it('schedule counts match the plan', () => {
    const cfg: AssayConfig = JSON.parse(require('node:fs').readFileSync('tools/opponents/config.json', 'utf8'));
    const jobs = schedule(cfg);
    expect(panelPairs(cfg.ids)).toHaveLength(10);
    expect(jobs.filter((j) => j.key.startsWith('c|') && j.key.includes('|bal|'))).toHaveLength(11 * 10 * 2);
    expect(jobs.filter((j) => j.key.startsWith('s|'))).toHaveLength(5 * (2 * 10 + 4 * 6));
    expect(jobs.filter((j) => j.depletion)).toHaveLength(20);
    expect(new Set(jobs.map((j) => j.key)).size).toBe(jobs.length);
    expect(Object.keys(MASKS)).toHaveLength(6);
  });
  it('verdict decision table: hand-derived counts over all 128 gate combinations', () => {
    // Independent of decideVerdict: only valid (invalid=false) combinations with G4 and G5 true reach a verdict about the assay,
    // 2^4 = 16 of them over G1a, G1b, G2, G3. Of these, G1a and G1b both true leaves 4; G2 false leaves 2 (insensitive);
    // G2 true and G3 false is 1 (extinction-limited); all true is 1 (assay-sensitive). Biased: 16 - 4 = 12. The other 112 are control-invalid.
    const bools = [false, true];
    const counts: Record<string, number> = {};
    for (const G1a of bools) for (const G1b of bools) for (const G2 of bools) for (const G3 of bools) for (const G4 of bools) for (const G5 of bools) for (const invalid of bools) {
      const v = decideVerdict({ G1a, G1b, G2, G3, G4, G5, invalid });
      counts[v] = (counts[v] ?? 0) + 1;
    }
    expect(counts).toEqual({ 'control-invalid': 112, 'label-or-position-biased': 12, insensitive: 2, 'extinction-limited': 1, 'assay-sensitive': 1 });
    const ok: Gates = { G1a: true, G1b: true, G2: true, G3: true, G4: true, G5: true, invalid: false };
    // precedence rows written out by hand
    expect(decideVerdict({ ...ok, invalid: true })).toBe('control-invalid');
    expect(decideVerdict({ ...ok, G1a: false, G2: false, G3: false, G5: false })).toBe('control-invalid');
    expect(decideVerdict({ ...ok, G1a: false, G2: false, G3: false })).toBe('label-or-position-biased');
    expect(decideVerdict({ ...ok, G2: false, G3: false })).toBe('insensitive');
  });
  it('verdict follows gates', () => {
    const ok: Gates = { G1a: true, G1b: true, G2: true, G3: true, G4: true, G5: true, invalid: false };
    expect(decideVerdict(ok)).toBe('assay-sensitive');
    expect(decideVerdict({ ...ok, G1b: false, G2: false })).toBe('label-or-position-biased');
    expect(decideVerdict({ ...ok, G2: false, G3: false })).toBe('insensitive');
    expect(decideVerdict({ ...ok, G3: false })).toBe('extinction-limited');
    expect(decideVerdict({ ...ok, G4: false, G1a: false })).toBe('control-invalid');
  });
  it('depletion arena is both-floor and the naive reading says tie (classifier path)', () => {
    const f = runFixtures().bothFloorClassifier;
    expect(f.cls).toBe('both-floor');
    expect(f.share).toBeNull();
    expect(f.naiveShare).toBe(0.5);  });
});


// ---- gates from raw records: synthetic run sets with hand-written expectations -----------------------------------------------------

describe('evaluateGates from synthetic raw records', () => {
  const CP = [10, 20, 30, 40];
  const base = (over: Partial<AssayConfig> = {}): AssayConfig => ({
    arena: { tile: 32, radius: 3, steps: 40 }, depletion: null, weakenPercent: 50, ids: ['G', 'W'],
    seeds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], rareSeeds: [1, 2, 3, 4, 5, 6], rarePositions: 1, twinG: true, effectTarget: 0.075, ...over,
  });
  type Final = (j: JobSpec) => [number, number] | null;
  /** Four equal checkpoints per run. `final` returns the counts of both labels at every checkpoint, or null for "hold the step-zero counts". */
  function synth(cfg: AssayConfig, final: Final): RunRec[] {
    return schedule(cfg).map((j) => {
      const solo = j.b === null;
      const b0: [number, number] = solo ? [1000 * j.slotsA.length, 0] : [1000 * j.slotsA.length, 1000 * j.slotsB.length];
      const f = final(j) ?? [b0[0], b0[1]];
      const c = (x: number): number => (x > 0 ? 5 : 0);
      return { key: j.key, b0, e0: [0, 0], cp: CP.map(() => [f[0], f[1], c(f[0]), c(f[1])] as [number, number, number, number]) };
    });
  }
  const run = (cfg: AssayConfig, final: Final, invalid = false) => {
    const runs = synth(cfg, final);
    expect(validateRuns(cfg, runs, CP)).toEqual([]);
    const sm = summarize(cfg, runs, CP);
    return evaluateGates(cfg, sm, runFixtures(), invalid);
  };
  const seedOf = (j: JobSpec) => j.seed;
  const posOf = (j: JobSpec) => j.key.split('|').at(-2)!;
  /** G beats W with share 0.7; the twin pair is perfectly symmetric (counts swap between the reciprocal positions). */
  const clean: Final = (j) => {
    if (j.b === null) return null;
    if (j.a === 'G' && j.b === "G'") return [1000 * j.slotsA.length, 1000 * j.slotsB.length];
    if (j.key.includes('|bal|')) return [1400, 600];
    return null;
  };
  const allTrue = { G1a: true, G1b: true, G2: true, G3: true, G4: true, G5: true, invalid: false };

  it('a clean synthetic set passes every gate and is assay-sensitive', () => {
    const g = run(base(), clean);
    expect(g.gates).toEqual(allTrue);
    expect(g.verdict).toBe('assay-sensitive');
    expect(g.detail).toMatchObject({ floorFails: [], uninformativePairs: [], depletionInWorld: false });
  });

  it('a twin whose first position always gains is label-or-position-biased (G1b only)', () => {
    // G in the P1 slot set holds 0.7 of the twin contest, and by exact label swap 0.3 in P2: +0.2 in every seed
    const g = run(base(), (j) => {
      if (j.a === 'G' && j.b === "G'" && j.key.includes('|bal|')) return posOf(j) === 'P1' ? [1400, 600] : [600, 1400];
      return clean(j);
    });
    expect(g.gates).toEqual({ ...allTrue, G1b: false });
    expect(g.verdict).toBe('label-or-position-biased');
  });

  it('a twin position effect of mixed sign but too large fails the size clause (sign-flip p alone would pass)', () => {
    // +0.1 on even seeds, -0.1 on odd: the sum is zero (p = 1) but the mean size 0.1 is not below the 0.075 target
    const g = run(base(), (j) => {
      if (j.a === 'G' && j.b === "G'" && j.key.includes('|bal|')) {
        const up = seedOf(j) % 2 === 0;
        const a = posOf(j) === 'P1' ? (up ? 1200 : 800) : (up ? 800 : 1200);
        return [a, 2000 - a];
      }
      return clean(j);
    });
    expect(g.gates).toEqual({ ...allTrue, G1b: false });
    expect(g.verdict).toBe('label-or-position-biased');
  });

  it('label invariance fails when the reciprocal worlds do not swap exactly (G1a)', () => {
    const g = run(base(), (j) => (j.a === 'G' && j.b === "G'" && j.key.includes('|bal|P2|') && seedOf(j) === 3 ? [1001, 999] : clean(j)));
    expect(g.gates.G1a).toBe(false);
    expect(g.verdict).toBe('label-or-position-biased');
  });

  it('a consistent +0.01 twin position effect fails G1b through the sign-flip p alone', () => {
    // size 0.01 is far below the 0.075 target; ten seeds all on one side give p = 2/1024
    const g = run(base(), (j) => {
      if (j.a === 'G' && j.b === "G'" && j.key.includes('|bal|')) return posOf(j) === 'P1' ? [1020, 980] : [980, 1020];
      return clean(j);
    });
    expect(g.gates).toEqual({ ...allTrue, G1b: false });
  });

  it('G2 accepts W at exactly 0.40 and refuses 0.41', () => {
    const at = (gShare: number): Final => (j) => (j.key.includes('|bal|') && j.b === 'W' ? [Math.round(2000 * gShare), 2000 - Math.round(2000 * gShare)] : clean(j));
    expect(run(base(), at(0.6)).gates.G2).toBe(true);
    expect(run(base(), at(0.59)).gates.G2).toBe(false);
  });

  it('a W that does not lose fails G2 and the assay is insensitive', () => {
    const g = run(base(), (j) => (j.key.includes('|bal|') && j.b === 'W' ? [1000, 1000] : clean(j)));
    expect(g.gates).toEqual({ ...allTrue, G2: false });
    expect(g.verdict).toBe('insensitive');
  });

  it('a W that loses only to the 0.45 level fails the mean clause of G2', () => {
    const g = run(base(), (j) => (j.key.includes('|bal|') && j.b === 'W' ? [1100, 900] : clean(j)));
    expect(g.gates.G2).toBe(false);
    expect(g.verdict).toBe('insensitive');
  });

  it('a W that is dead when growing alone fails G2 even if it loses every block', () => {
    const g = run(base(), (j) => (j.b === null && j.a === 'W' && j.key.includes('|m01|') ? [10, 0] : clean(j)));
    expect(g.gates.G2).toBe(false);
    expect(g.verdict).toBe('insensitive');
  });

  it('a pair with three both-floor blocks is unreadable: G3 and G2 fail, insensitive by precedence', () => {
    const g = run(base(), (j) => (j.b === 'W' && j.key.includes('|bal|P1|') && seedOf(j) <= 3 ? [10, 10] : clean(j)));
    expect(g.gates.G3).toBe(false);
    expect(g.gates.G2).toBe(false);
    expect(g.detail.uninformativePairs).toEqual(['G|W']);
    expect(g.verdict).toBe('insensitive');
  });

  it('a rare arm whose both-floor runs sit in different blocks fails G3 even under the 20% run fraction (extinction-limited)', () => {
    // two positions, 6 seeds, so 12 runs per arm: two both-floor runs are 17% of runs but leave only 4 of 6 complete blocks
    const cfg = base({ rarePositions: 2 });
    const g = run(cfg, (j) => (j.b === 'W' && j.key.includes('|rA|') && ((seedOf(j) === 1 && posOf(j) === 'R1') || (seedOf(j) === 2 && posOf(j) === 'R2')) ? [10, 10] : clean(j)));
    expect(g.detail.floorFails).toEqual([]);
    expect(g.detail.uninformativePairs).toEqual(['G|W/rA']);
    expect(g.gates).toEqual({ ...allTrue, G3: false });
    expect(g.verdict).toBe('extinction-limited');
    // one such run leaves 5 of 6 complete blocks: still readable
    const one = run(cfg, (j) => (j.b === 'W' && j.key.includes('|rA|') && seedOf(j) === 1 && posOf(j) === 'R1' ? [10, 10] : clean(j)));
    expect(one.gates.G3).toBe(true);
  });

  it('too many both-floor runs in one arm fail G3 through the run fraction', () => {
    // rare arm, one position: 6 runs, two both-floor is 33% > 20%
    const g = run(base(), (j) => (j.b === 'W' && j.key.includes('|rB|') && seedOf(j) <= 2 ? [10, 10] : clean(j)));
    expect(g.detail.floorFails).toEqual(['G|W/rB']);
    expect(g.gates.G3).toBe(false);
    expect(g.verdict).toBe('extinction-limited');
  });

  it('an in-world depletion arena that does not reach the floor invalidates the control; one that does passes G4', () => {
    const cfg = base({ depletion: { override: { kBDecay: 600 }, pair: ['G', 'W'] } });
    const alive = run(cfg, (j) => (j.key.startsWith('d|') ? [900, 900] : clean(j)));
    expect(alive.gates).toEqual({ ...allTrue, G4: false });
    expect(alive.verdict).toBe('control-invalid');
    const dead = run(cfg, (j) => (j.key.startsWith('d|') ? [10, 10] : clean(j)));
    expect(dead.gates).toEqual(allTrue);
    expect(dead.detail.depletionInWorld).toBe(true);
    // one side alive in one run is still not a depleted arena
    const one = run(cfg, (j) => (j.key.startsWith('d|') ? (seedOf(j) === 4 && posOf(j) === 'P1' ? [900, 10] : [10, 10]) : clean(j)));
    expect(one.gates.G4).toBe(false);
  });

  it('failed fixtures and the invalid flag give control-invalid', () => {
    const cfg = base();
    const sm = summarize(cfg, synth(cfg, clean), CP);
    const bad = evaluateGates(cfg, sm, { ...runFixtures(), pass: false });
    expect(bad.gates).toEqual({ ...allTrue, G5: false });
    expect(bad.verdict).toBe('control-invalid');
    expect(evaluateGates(cfg, sm, runFixtures(), true).verdict).toBe('control-invalid');
    const noClassifier = evaluateGates(cfg, sm, { ...runFixtures(), bothFloorClassifier: { ...runFixtures().bothFloorClassifier, pass: false } });
    expect(noClassifier.gates.G4).toBe(false);
  });

  it('twin-adjusted invasion subtracts the arrangement penalty; the raw class is marked uninterpretable', () => {
    // every rare label loses 0.16 of its share, in the twin pair and in G|W alike: raw "fails", adjusted excess is zero
    const cfg = base();
    const runs = synth(cfg, (j) => {
      if (j.b === null || j.key.includes('|bal|')) return clean(j);
      const [x, y] = [1000 * j.slotsA.length, 1000 * j.slotsB.length];
      const rareIsA = j.key.includes('|rA|');
      const total = x + y, initRare = (rareIsA ? x : y) / total, targetRare = initRare - 0.16;
      const rare = Math.round(total * targetRare), other = total - rare;
      return rareIsA ? [rare, other] : [other, rare];
    });
    const sm = summarize(cfg, runs, CP);
    const inv = sm.invasion['G|W']!;
    expect(inv.interpretable).toBe(false);
    expect(inv.baseline).toBe('twin');
    expect(inv.rareA.class).toBe('fails');
    expect(sm.invasion["G|G'"]!.rareA.class).toBe('fails');
    expect(sm.invasion["G|G'"]!.adjusted).toBeNull();
    expect(inv.adjusted!.rareA.excess.every((v) => Math.abs(v) < 1e-9)).toBe(true);
    expect(inv.adjusted!.rareA.class).toBe('unclear');
  });

  it('adjusted invasion shows a real invasion beyond the twin baseline', () => {
    const cfg = base();
    const runs = synth(cfg, (j) => {
      if (j.b === null || j.key.includes('|bal|')) return clean(j);
      const total = 1000 * (j.slotsA.length + j.slotsB.length), rareIsA = j.key.includes('|rA|');
      const initRare = 1000 * (rareIsA ? j.slotsA.length : j.slotsB.length) / total;
      const gain = j.b === "G'" ? -0.16 : -0.05;
      const rare = Math.round(total * (initRare + gain));
      return rareIsA ? [rare, total - rare] : [total - rare, rare];
    });
    const inv = summarize(cfg, runs, CP).invasion['G|W']!;
    expect(inv.rareA.class).toBe('fails');
    expect(inv.adjusted!.rareA.class).toBe('invades');
  });
});

describe('raw record validation', () => {
  const cfg: AssayConfig = { arena: { tile: 32, radius: 3, steps: 40 }, depletion: null, weakenPercent: 50, ids: ['G', 'W'], seeds: [1, 2], rareSeeds: [1, 2], rarePositions: 0, twinG: false, effectTarget: 0.1 };
  const CP = [10, 20, 30, 40];
  const good = (): RunRec[] => schedule(cfg).map((j) => {
    const b0: [number, number] = j.b === null ? [2000, 0] : [2000, 2000];
    return { key: j.key, b0, e0: [0, 0], cp: CP.map(() => [b0[0], b0[1], b0[0] ? 5 : 0, b0[1] ? 5 : 0] as [number, number, number, number]) };
  });
  it('accepts a consistent set', () => { expect(validateRuns(cfg, good(), CP)).toEqual([]); });
  it('rejects impossible records', () => {
    const edit = (f: (r: RunRec[]) => void): string[] => { const r = good(); f(r); return validateRuns(cfg, r, CP); };
    expect(edit((r) => { r[0].cp[3][2] = -42; })).not.toEqual([]);
    expect(edit((r) => { r[0].cp[3][0] = 1.5; })).not.toEqual([]);
    expect(edit((r) => { r[0].cp[3][0] = Number.NaN; })).not.toEqual([]);
    expect(edit((r) => { r[0].cp.push([1, 1, 1, 1]); })).not.toEqual([]);
    expect(edit((r) => { r[0].cp.pop(); })).not.toEqual([]);
    expect(edit((r) => { (r[0].cp[0] as number[]).push(7); })).not.toEqual([]);
    expect(edit((r) => { const c = r.find((x) => x.key[0] === 'c')!; c.b0 = [2000, 0]; })).not.toEqual([]);
    expect(edit((r) => { r[0].cp[1][2] = 2000; r[0].cp[1][3] = 2000; })).not.toEqual([]);
    expect(edit((r) => { r[0].cp[1][2] = 0; })).not.toEqual([]);
    expect(edit((r) => { const s = r.find((x) => x.key[0] === 's')!; s.cp[0][1] = 5; s.cp[0][3] = 1; })).not.toEqual([]);
    expect(edit((r) => { (r[0] as unknown as { b0: number[] }).b0 = [1]; })).not.toEqual([]);
  });
});

describe('cycle detector scope', () => {
  it('a four-cycle has no three-cycle and the field says only that', () => {
    const e = [[false, true, false, false], [false, false, true, false], [false, false, false, true], [true, false, false, false]];
    expect(findCycles(e)).toEqual([]);
    expect(hasNoThreeCycle(e)).toBe(true);
  });
});
