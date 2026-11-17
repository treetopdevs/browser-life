import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalKey } from '../src/assembly/grammar.ts';
import { segment } from '../src/assembly/segment.ts';
import { BLOCK_2X3, COMPOSITE_12, I3, SQUARE_4X4 } from '../src/assembly/fixtures.ts';
import { DPROTOCOL } from '../src/assembly/destruction/protocol.ts';
import { lesionPartial, lesionTotal, occupiedOf, paint, scramble, worldCells, type Obj } from '../src/assembly/destruction/damage.ts';
import { HIER_PROGRAM, WRONG_PROGRAM, regrow, runProgram, storeFor } from '../src/assembly/destruction/regrow.ts';
import { KIND_OF, original, runProcess } from '../src/assembly/destruction/processes.ts';
import { Measurer, identityReturn, levelReturn, persistent, identityAtLeastHalf } from '../src/assembly/destruction/readouts.ts';
import { accuracy, c1, c2, c3, deriveTables, processLabel, scrambleGate, validateRows, type ConnArm, type Row } from '../src/assembly/destruction/verdict.ts';
import { buildPayload } from '../src/assembly/destruction/observer.ts';
import type { Damage, ProcessId } from '../src/assembly/destruction/protocol.ts';

const W = DPROTOCOL.patch.w, M = DPROTOCOL.patch.mass;
const DOCS = new URL('../../../docs/assembly-destruction-2026-11-02/', import.meta.url);
const SRC = new URL('../src/assembly/destruction/', import.meta.url);

describe('damage operators', () => {
  it('lesion-partial removes exactly the cells in the disc and records the removed mass', () => {
    for (const kind of ['hier', 'dup12', 'crystal', 'scatter'] as const) {
      const o = original(kind, 3, 'dev');
      const d = lesionPartial(o.objs, 12345, 3);
      expect(d.removedMass).toBeGreaterThan(0);
      expect(M - d.removedMass).toBe(occupiedOf(d.frame));
      expect(d.sweptMass).toBe(d.fragments.length);
      // every removed cell lay inside the disc, every surviving cell outside it: find the centre by brute force over cells of the original
      const gone: number[] = [];
      for (let i = 0; i < o.frame.length; i++) if (o.frame[i] && !d.frame[i]) gone.push(i);
      expect(gone.length).toBe(d.removedMass);
      const r = DPROTOCOL.lesionRadius;
      const t = (a: number, b: number) => { const x = Math.abs(a - b); return Math.min(x, W - x); };
      const inside = (c: number, p: number) => t(c % W, p % W) ** 2 + t(Math.floor(c / W), Math.floor(p / W)) ** 2 <= r * r;
      const centre = Array.from({ length: o.frame.length }, (_, p) => p).find((p) => o.frame[p] && gone.every((g) => inside(g, p)) && [...o.frame.keys()].every((c) => !o.frame[c] || !d.frame[c] === inside(c, p)));
      expect(centre).toBeDefined();
      for (const ob of d.intact) for (const [x, y] of worldCells(ob)) expect(inside(y * W + x, centre!)).toBe(false);
    }
  });

  it('lesion-total leaves zero copies of the target key', () => {
    const o = original('hier', 1, 'dev');
    const d = lesionTotal(o.objs, (x) => canonicalKey(x.cells) === o.targetKey);
    expect(new Measurer().copiesOf(d.frame, 4, o.targetKey)).toBe(0);
    expect(d.removedMass).toBe(M);
  });

  it('scramble keeps occupied mass at 240', () => {
    expect(occupiedOf(scramble(M, 99, 0))).toBe(M);
  });

  it('originals have exactly 240 occupied cells for every kind and replicate', () => {
    for (const kind of ['hier', 'dup12', 'crystal', 'scatter'] as const) for (let r = 0; r < 16; r++) expect(occupiedOf(original(kind, r, 'dev').frame)).toBe(M);
  });
});

describe('regrowth', () => {
  const dmg: Damage[] = ['lesion-partial', 'lesion-total'];
  it('regrown objects never overlap occupied cells and never touch under 8-connectivity', () => {
    for (const p of DPROTOCOL.processes) for (const d of dmg) for (let rep = 0; rep < 4; rep++) {
      const run = runProcess(p, rep, 'dev', d);
      const g = run.regrown!;
      const f = g.roundFrames[g.roundFrames.length - 1];
      expect(occupiedOf(paint(g.objs))).toBe(occupiedOf(f)); // paint throws on overlap
      expect(segment(f, W, W, { conn: 8, tau: 1 }).length).toBe(g.objs.length);
    }
  });

  it('mass accounting: occupied after = M - removed - swept + regrown, for every process, damage and replicate', () => {
    for (const p of DPROTOCOL.processes) for (const d of dmg) for (let rep = 0; rep < 16; rep++) {
      const run = runProcess(p, rep, 'dev', d);
      const g = run.regrown!, dm = run.damaged!;
      const final = occupiedOf(g.roundFrames[g.roundFrames.length - 1]);
      expect(final).toBe(M - dm.removedMass - dm.sweptMass + g.regrownMass);
      expect(g.roundFrames).toHaveLength(DPROTOCOL.rounds);
    }
  });

  it('a program store builds the class its steps describe; the wrong program builds a different class; the ablated store builds nothing', () => {
    expect(HIER_PROGRAM!.kind === 'program' && runProgram(HIER_PROGRAM!.unit, HIER_PROGRAM!.steps)).toEqual(COMPOSITE_12);
    expect(runProgram(I3, [[1, 0]])).toEqual(BLOCK_2X3);
    const wrong = WRONG_PROGRAM!.kind === 'program' ? runProgram(WRONG_PROGRAM!.unit, WRONG_PROGRAM!.steps) : [];
    expect(wrong).toHaveLength(12);
    expect(canonicalKey(wrong)).not.toBe(canonicalKey(COMPOSITE_12));
    expect(storeFor('builder-hier12', true, COMPOSITE_12)).toBeNull();
    const r = regrow('builder-hier12', null, 1, []);
    expect(r.objectsAdded).toBe(0);
    expect(r.regrownMass).toBe(0);
  });

  it('template processes build nothing without survivors and copy a survivor otherwise', () => {
    expect(regrow('template-hier12', null, 1, []).objectsAdded).toBe(0);
    const one: Obj[] = [{ cells: SQUARE_4X4, at: [0, 0] }];
    const r = regrow('template-dup12', null, 1, one);
    expect(r.objectsAdded).toBeGreaterThan(0);
    for (const o of r.objs) expect(canonicalKey(o.cells)).toBe(canonicalKey(SQUARE_4X4));
  });

  it('regrow() takes no pre-damage patch and no reference key (source scan)', () => {
    const src = readFileSync(new URL('regrow.ts', SRC), 'utf8');
    expect(src).not.toMatch(/targetKey|original\(|from "\.\/processes/);
    expect(regrow.length).toBe(4);
  });

  it('translation across both torus seams does not change the copy count', () => {
    const m = new Measurer();
    const at = (x: number, y: number): Obj => ({ cells: COMPOSITE_12, at: [x, y] });
    const a = paint([at(10, 10), at(30, 30)]);
    const b = paint([at(W - 2, W - 2), at(30, 30)]); // straddles both seams
    const key = canonicalKey(COMPOSITE_12);
    expect(m.copiesOf(a, 4, key)).toBe(2);
    expect(m.copiesOf(b, 4, key)).toBe(2);
  });

  it('process outputs are pure functions of (process, replicate, namespace); no clock or Math.random in the sources', () => {
    const run = () => { const r = runProcess('fresh-random-dup12', 5, 'dev', 'lesion-total'); return [r.regrown!.roundFrames.map((f) => Array.from(f).join('')).join('|'), r.regrown!.regrownMass]; };
    expect(run()).toEqual(run());
    for (const f of readdirSync(SRC)) if (f.endsWith('.ts')) expect(readFileSync(new URL(f, SRC), 'utf8'), f).not.toMatch(/Math\.random|Date\.now|performance\.now|new Date/);
  });
});

describe('readout definitions', () => {
  it('identityReturn: copy-count recovery, survival-only is 0, undefined when n0 < 8 or nothing was lost', () => {
    expect(identityReturn(20, 10, 15)).toEqual({ num: 5, den: 10 });
    expect(identityReturn(20, 10, 10)).toEqual({ num: 0, den: 10 });
    expect(identityReturn(20, 10, 40)).toEqual({ num: 1, den: 1 });
    expect(identityReturn(20, 10, 3)).toEqual({ num: 0, den: 10 });
    expect(identityReturn(7, 0, 7)).toBeNull();
    expect(identityReturn(20, 20, 20)).toBeNull();
    expect(identityAtLeastHalf({ num: 1, den: 2 })).toBe(true);
    expect(identityAtLeastHalf({ num: 4, den: 10 })).toBe(false);
    expect(identityAtLeastHalf(null)).toBe(false);
  });

  it('persistence needs ceil(n0/2) at each of the last 3 rounds', () => {
    expect(persistent([0, 0, 0, 0, 0, 10, 10, 10], 20)).toBe(true);
    expect(persistent([20, 20, 20, 20, 20, 10, 9, 10], 20)).toBe(false);
    expect(persistent([10, 10], 20)).toBe(false);
  });

  it('levelReturn is undefined on a zero baseline or an empty regrowth, never true', () => {
    expect(levelReturn(0, 50, 240)).toBeNull();
    expect(levelReturn(76, 0, 0)).toBeNull();
    expect(levelReturn(76, 76, 179)).toBeNull();
    expect(levelReturn(76, 57, 180)).toBe(true);
    expect(levelReturn(76, 56, 180)).toBe(false);
  });
});

// hand-made per-replicate rows: verdict arithmetic on constructed inputs only
const arm = (o: Partial<ConnArm> = {}): ConnArm => ({ n1: 0, n2: 0, roundCounts: [0, 0, 0, 0, 0, o.n2 ?? 0, o.n2 ?? 0, o.n2 ?? 0], identity: { num: 0, den: 20 }, persistence: false, cw: 0, level: null, high: false, ...o });
const full = { removedMass: 240, sweptMass: 0, regrownMass: 0, occupiedAfterDamage: 0, occupiedFinal: 0, residual: 240 };
function row(process: ProcessId, o: { total?: Partial<ConnArm>; partial?: Partial<ConnArm>; nostoreId?: number | null; rep?: number; final?: number; dag?: number } = {}): Row {
  const t = arm(o.total), p = arm(o.partial);
  const fin = o.final ?? 0;
  return {
    process, replicate: o.rep ?? 0, kind: KIND_OF[process], targetKey: 'k', objectSize: 12, n0: { c4: 20, c8: 20, d4: 20 },
    original: { cw: 76, sharedBound: 4, reuseRatio: { num: 4, den: 11 }, objects: 20 },
    partial: { ...full, occupiedFinal: 240, residual: 0, regrownMass: 240, c4: p, c8: p, d4: p },
    total: { ...full, occupiedFinal: fin, residual: 240 - fin, regrownMass: fin, c4: t, c8: t, d4: t },
    nostore: (DPROTOCOL.storeProcesses as readonly string[]).includes(process) ? { identity: o.nostoreId === null ? null : { num: o.nostoreId ?? 0, den: 20 }, n2: o.nostoreId ?? 0 } : null,
    scramble: { targetCopies: 0, sharedBound: 9, reuseRatio: { num: 1, den: 1 }, dagKeys: 3, objects: 100 },
  };
}
const pos = { identity: { num: 16, den: 20 }, persistence: true, n2: 16, high: true, level: true as boolean | null };
const reps = (f: (i: number) => Row) => Array.from({ length: 16 }, (_, i) => f(i));

describe('verdict arithmetic on constructed rows', () => {
  it('C1 needs identity, persistence and a zero-identity ablation arm; no store arm is false', () => {
    expect(c1(row('builder-hier12', { total: pos }))).toBe(true);
    expect(c1(row('builder-hier12', { total: { ...pos, persistence: false } }))).toBe(false);
    expect(c1(row('builder-hier12', { total: pos, nostoreId: 8 }))).toBe(false);
    expect(c1(row('builder-hier12', { total: pos, nostoreId: null }))).toBe(false);
    expect(c1(row('accretion-crystal', { total: pos }))).toBe(false);
  });

  it('C2 counts only a true partial levelReturn; C3 is within one object of M', () => {
    expect(c2(row('template-hier12', { partial: { level: true } }))).toBe(true);
    expect(c2(row('template-hier12', { partial: { level: null } }))).toBe(false);
    expect(c3(row('template-hier12', { final: 228 }))).toBe(true);
    expect(c3(row('template-hier12', { final: 227 }))).toBe(false);
  });

  it('labels follow the stated precedence', () => {
    expect(processLabel(reps((i) => row('builder-hier12', { rep: i, total: pos })))).toBe('reconstructs');
    expect(processLabel(reps((i) => row('builder-hier12', { rep: i, total: { ...pos, high: false } })))).toBe('absent');
    expect(processLabel(reps((i) => row('template-dup12', { rep: i, partial: { identity: { num: 1, den: 1 } }, total: { identity: { num: 0, den: 20 } } })))).toBe('reappears-by-templating-only');
    expect(processLabel(reps((i) => row('fresh-random-dup12', { rep: i, partial: { identity: { num: 0, den: 8 }, level: true } })))).toBe('level-only');
    // one replicate off breaks "every replicate"
    expect(processLabel(reps((i) => row('fresh-random-dup12', { rep: i, partial: { identity: { num: 0, den: 8 }, level: i !== 3 } })))).toBe('absent');
    expect(processLabel([])).toBe('absent');
  });

  it('accuracy is exact integer counts against the truth label', () => {
    const rows = [
      ...reps((i) => row('builder-hier12', { rep: i, total: pos, partial: { level: true } })),
      ...reps((i) => row('template-hier12', { rep: i, partial: { level: true } })),
    ];
    const a = accuracy(rows);
    expect(a.c1).toEqual({ correct: 32, total: 32 });
    expect(a.c2).toEqual({ correct: 16, total: 32 });
  });

  it('a label that differs between 4- and 8-connectivity is published as segmentation-dominated', () => {
    const rows: Row[] = [];
    for (const p of DPROTOCOL.processes) for (let i = 0; i < 16; i++) {
      const r = row(p, { rep: i, total: pos });
      if (p === 'builder-hier12') r.total.c8 = arm({ identity: { num: 0, den: 20 } });
      rows.push(r);
    }
    const t = deriveTables(rows).processes.find((x) => x.process === 'builder-hier12')!;
    expect(t.label).toBe('reconstructs');
    expect(t.labelC8).not.toBe('reconstructs');
    expect(t.segmentationDominated).toBe(true);
  });

  it('scramble criterion: 14 of 16 worse-side replicates passes, 13 does not; undefined counts as moved', () => {
    const mk = (nWorse: number) => reps((i) => {
      const r = row('builder-hier12', { rep: i });
      if (i >= nWorse) r.scramble = { ...r.scramble, sharedBound: 3, reuseRatio: { num: 1, den: 11 }, dagKeys: 3 };
      return r;
    });
    expect(scrambleGate('hier', mk(14))).toMatchObject({ sharedBoundWorse: 14, reuseRatioWorse: 14, pass: true });
    expect(scrambleGate('hier', mk(13))).toMatchObject({ sharedBoundWorse: 13, pass: false });
    const und = reps((i) => { const r = row('builder-hier12', { rep: i }); r.scramble = { ...r.scramble, sharedBound: null, reuseRatio: null, dagKeys: 0 }; return r; });
    expect(scrambleGate('hier', und).pass).toBe(true);
    // equal is not worse
    const tie = reps((i) => { const r = row('builder-hier12', { rep: i }); r.scramble = { ...r.scramble, sharedBound: 4, reuseRatio: { num: 4, den: 11 } }; return r; });
    expect(scrambleGate('hier', tie).pass).toBe(false);
  });

  it('a failing scramble kind marks only that kind measurement-limited', () => {
    const rows: Row[] = [];
    for (const p of DPROTOCOL.processes) for (let i = 0; i < 16; i++) {
      const r = row(p, { rep: i, total: pos });
      if (KIND_OF[p] === 'crystal') r.scramble = { ...r.scramble, sharedBound: 4, reuseRatio: r.original.reuseRatio, dagKeys: 3 };
      rows.push(r);
    }
    const t = deriveTables(rows).processes;
    expect(t.find((x) => x.process === 'accretion-crystal')!.measurementLimited).toBe(true);
    expect(t.find((x) => x.process === 'builder-hier12')!.measurementLimited).toBe(false);
  });

  it('missing rows, undefined denominators and a broken mass identity reject the run', () => {
    const rows: Row[] = [];
    for (const p of DPROTOCOL.processes) for (let i = 0; i < 16; i++) rows.push(row(p, { rep: i, total: pos, final: 192 }));
    expect(validateRows(rows).filter((x) => x.includes('mass identity') === false)).toEqual([]);
    expect(validateRows(rows.slice(1)).some((x) => x.includes('incomplete'))).toBe(true);
    const und = rows.map((r) => ({ ...r }));
    und[0].total = { ...und[0].total, c4: { ...und[0].total.c4, identity: null } };
    expect(validateRows(und).some((x) => x.includes('undefined'))).toBe(true);
    const broken = rows.map((r) => ({ ...r }));
    broken[1].total = { ...broken[1].total, regrownMass: 1 };
    expect(validateRows(broken).some((x) => x.includes('mass identity'))).toBe(true);
    const zero = rows.map((r) => ({ ...r }));
    zero[2].total = { ...zero[2].total, c4: { ...zero[2].total.c4, identity: { num: 1, den: 0 } } };
    expect(validateRows(zero).some((x) => x.includes('identityReturn'))).toBe(true);
    const noC8 = rows.map((r) => ({ ...r }));
    noC8[3].partial = { ...noC8[3].partial, c8: { ...noC8[3].partial.c8, roundCounts: [] } };
    expect(validateRows(noC8).some((x) => x.includes('round counts missing'))).toBe(true);
    expect(validateRows([...rows, { ...rows[0], process: 'unknown' as ProcessId }]).some((x) => x.includes('unknown process'))).toBe(true);
    const lie = rows.map((r) => ({ ...r }));
    lie[4].total = { ...lie[4].total, c4: { ...lie[4].total.c4, persistence: false } };
    expect(validateRows(lie).some((x) => x.includes('persistence inconsistent'))).toBe(true);
  });
});

describe('protocol and namespaces', () => {
  it('dev and score seeds are disjoint', () => {
    const dev = new Set(Object.values(DPROTOCOL.seeds.dev));
    for (const s of Object.values(DPROTOCOL.seeds.score)) expect(dev.has(s)).toBe(false);
  });

  it('protocol constants equal the fenced JSON block in PROTOCOL.md', () => {
    const md = readFileSync(new URL('PROTOCOL.md', DOCS), 'utf8');
    const blocks = [...md.matchAll(/```json\n([\s\S]*?)\n```/g)];
    expect(JSON.parse(blocks[blocks.length - 1][1])).toEqual(JSON.parse(JSON.stringify(DPROTOCOL)));
  });

  it('every replicate set has the same truth labels as the protocol, and stored-image and wrong-store rows exist (dev run)', () => {
    const p = buildPayload({ ns: 'dev', replicates: 2 });
    for (const proc of ['stored-image-renderer', 'wrong-store-builder']) expect(p.rows.filter((r) => r.process === proc)).toHaveLength(2);
    expect(p.rows.every((r) => r.n0.c4 === r.n0.c8 && r.n0.d4 >= r.n0.c4)).toBe(true);
    expect(p.namespace).toBe('dev');
  });
});
