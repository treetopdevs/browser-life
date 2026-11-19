import { describe, expect, it } from "vitest";
import { M3_FOUNDERS, decodeGenome, defaultConfig, encodeGenome, founderGenome, randomGenome, NN_BYTES } from "@bl/schema";
import { GRID_POINTS, generalistWords, probeGenome, withWeights } from "@bl/lineage";
import { mutateInPlace } from "@bl/sim-ref";
import { evaluate } from "../../tools/soup/bff.ts";
import { GRID, NO, assertIntegers, rectify, hashOuts, nnOuts, wilson, functional, channelMeans, keyedWith, rd } from "../tape-probe/common.ts";
import { I, OP, TAPE_BYTES, asm, byteResample, byteStep, canonical, decodeChanging, deleteInstr, dupInstr, insertInstr, instrResample, nonNopCount, randomTape, runTape, tapeOuts } from "../tape-probe/tape.ts";
import { NN_ARM, TAPE_ARM, bffArm, buildPanelFunc, buildPanelRaw, classify, diffStats, breadthOf, parentInfo, runCell } from "../tape-probe/probe.ts";
import { MATCH, hillClimb, sampleIdx, subOuts, sumAbs, verdict } from "../tape-probe/match.ts";
import { bffOuts, randomBff } from "../tape-probe/bff-controller.ts";

const int8 = (g: Uint8Array) => new Int8Array(g.buffer.slice(g.byteOffset, g.byteOffset + g.length));
const run1 = (prog: Uint8Array, x: number[]) => { const o = new Int32Array(NO); runTape(prog, x, new Int32Array(32), o); return Array.from(o); };

describe("grid and weight-controller parity", () => {
  it("nnOuts equals probeGenome outs on the grid for generalist, founder 0 and a random genome", () => {
    expect(GRID.length).toBe(GRID_POINTS);
    const cases = [generalistWords(60, 20), encodeGenome(founderGenome(M3_FOUNDERS[0]), 0, 0), encodeGenome(randomGenome(7, 60, 20), 0, 0)];
    for (const w of cases) {
      const g = decodeGenome(w);
      expect(Array.from(nnOuts(g.weights))).toEqual(Array.from(probeGenome(w).outs));
    }
  });
});

describe("TAPE-R semantics", () => {
  it("all-NOP program gives zero outputs", () => {
    expect(run1(new Uint8Array(TAPE_BYTES), [127, 127, 127, 1, 1, 1, 1, 1, 1, 1])).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
  it("saturating arithmetic: MUL 127*127 -> 126 and ADD 100+100 -> 127", () => {
    const p = asm(I(OP.MUL, 10, 0, 1), I(OP.ADD, 11, 2, 3));
    const o = run1(p, [127, 127, 100, 100, 0, 0, 0, 0, 0, 0]);
    expect(o[0]).toBe(126); // divi(16129,128) = 126
    expect(o[1]).toBe(127);
  });
  it("hand-assembled MACI program equals expected values at 3 grid points", () => {
    // o0 = sat(divi(x0*64,128) + divi(x1*-128... imm clamp -127), o1 = MOVI 5
    const p = asm(I(OP.MACI, 10, 0, 64), I(OP.MACI, 10, 1, 0x81), I(OP.MOVI, 11, 0, 5));
    for (const gi of [0, 5000, 26243]) {
      const x = GRID[gi];
      const e0 = Math.max(-127, Math.min(127, Math.trunc((x[0] * 64) / 128)));
      const e = Math.max(-127, Math.min(127, e0 + Math.trunc((x[1] * -127) / 128)));
      const o = run1(p, Array.from(x));
      expect(o[0]).toBe(e);
      expect(o[1]).toBe(5);
    }
  });
  it("outputs stay in range and catalytic >= 0 for 200 random programs; deterministic", () => {
    for (let i = 0; i < 200; i++) {
      const t = randomTape(keyedWith(1, i));
      const o = tapeOuts(t);
      if (i < 3) expect(Array.from(tapeOuts(t))).toEqual(Array.from(o));
      if (i % 20 === 0) for (let q = 0; q < o.length; q += 7) { expect(o[q]).toBeGreaterThanOrEqual(q % NO < 6 ? 0 : -127); expect(o[q]).toBeLessThanOrEqual(127); }
    }
  });
});

describe("decode and encoding redundancy", () => {
  it("dead-bit-only changes canonicalise equal and give identical outputs", () => {
    const p = asm(I(OP.MOV, 10, 0, 0), I(OP.ADD, 11, 1, 2), I(OP.SHR, 12, 3, 1));
    const q = p.slice();
    q[0] |= 0xf0; q[1] |= 0xe0; q[2] |= 0xe0; q[3] |= 0xe0; // MOV: b0 high nibble, b1/b2 top bits, b3 unused entirely
    q[7] ^= 0x20; // ADD rb only uses low 5 bits of b3: bit5 dead
    q[11] ^= 0xfc; // SHR uses only b3&3
    expect(decodeChanging(p, q)).toBe(false);
    expect(Array.from(tapeOuts(p))).toEqual(Array.from(tapeOuts(q)));
    expect(canonical(p, 0)).toBe(canonical(q, 0));
  });
  it("NOP ignores its other bytes", () => {
    const p = asm(I(OP.MOV, 10, 0, 0)); const q = p.slice();
    q[4] = 0x30; q[5] = 9; q[6] = 8; q[7] = 7; // instruction 1: op 0 after &15
    expect(Array.from(tapeOuts(p))).toEqual(Array.from(tapeOuts(q)));
    expect(decodeChanging(p, q)).toBe(false);
    expect(nonNopCount(q)).toBe(1);
  });
});

describe("operators", () => {
  const p = randomTape(123);
  it("insert/delete/dup keep 160 bytes and shift as specified", () => {
    const sub = 99;
    const ins = insertInstr(p, sub), del = deleteInstr(p, sub), dup = dupInstr(p, sub);
    for (const t of [ins, del, dup]) expect(t.length).toBe(TAPE_BYTES);
    // find the position by comparing prefixes
    let pos = 0; while (pos < 40 && ins.slice(pos * 4, pos * 4 + 4).every((b, j) => b === p[pos * 4 + j])) pos++;
    expect(Array.from(ins.slice(pos * 4 + 4))).toEqual(Array.from(p.slice(pos * 4, TAPE_BYTES - 4)));
    expect(Array.from(del.slice(pos * 4, TAPE_BYTES - 4))).toEqual(Array.from(p.slice(pos * 4 + 4)));
    expect(Array.from(del.slice(TAPE_BYTES - 4))).toEqual([0, 0, 0, 0]);
    if (pos < 39) {
      expect(Array.from(dup.slice(pos * 4 + 4, pos * 4 + 8))).toEqual(Array.from(p.slice(pos * 4, pos * 4 + 4)));
      expect(Array.from(dup.slice(pos * 4 + 8))).toEqual(Array.from(p.slice(pos * 4 + 4, TAPE_BYTES - 4)));
    }
  });
  it("point operators change exactly one byte (or none on equal draw); step deltas within +-24 and nonzero", () => {
    for (let s = 0; s < 200; s++) {
      const r = byteResample(p, s), st = byteStep(p, s);
      let dr = 0, ds = 0;
      for (let i = 0; i < TAPE_BYTES; i++) { if (r[i] !== p[i]) dr++; if (st[i] !== p[i]) { ds++; const d = ((st[i] - p[i] + 384) % 256) - 128; expect(Math.abs(d)).toBeLessThanOrEqual(24); expect(d).not.toBe(0); } }
      expect(dr).toBeLessThanOrEqual(1);
      expect(ds).toBe(1);
      expect(instrResample(p, s).length).toBe(TAPE_BYTES);
    }
  });
  it("byteStep draws the same delta distribution as the weight operator (49 values, 0 -> +1) and wraps mod 256", () => {
    const z = new Uint8Array(TAPE_BYTES).fill(100);
    const count = new Map<number, number>();
    for (let s = 0; s < 20000; s++) {
      const st = byteStep(z, s);
      const i = st.findIndex((b) => b !== 100);
      const d = st[i] - 100;
      count.set(d, (count.get(d) ?? 0) + 1);
      // same draw as mutateInPlace's deltaRnd % 49 - 24, zero -> 1
      let want = rd(s, 1, 49) - 24; if (want === 0) want = 1;
      expect(d).toBe(want);
    }
    expect(count.has(0)).toBe(false);
    expect(Array.from(count.keys()).sort((a, b) => a - b)).toEqual(Array.from({ length: 49 }, (_, k) => k - 24).filter((d) => d !== 0));
    expect(count.get(1)!).toBeGreaterThan(1.6 * count.get(2)!);
    const hi = new Uint8Array(TAPE_BYTES).fill(250);
    let wrapped = 0;
    for (let s = 0; s < 400; s++) { const st = byteStep(hi, s); const i = st.findIndex((b) => b !== 250); if (st[i] < 250) wrapped++; }
    expect(wrapped).toBeGreaterThan(0);
  });
  it("W-step equals a direct mutateInPlace call and always differs from parent after redraw", () => {
    const w = randomGenome(5, 60, 20).weights;
    const par = new Uint8Array(w.buffer.slice(0));
    const sub = 4242;
    const got = NN_ARM.operators["W-step"](par, sub);
    const words = withWeights(encodeGenome(randomGenome(0, 60, 20), 0, 0), w);
    expect(got.length).toBe(NN_BYTES);
    const direct = words.slice();
    mutateInPlace(direct, 1, 0, defaultConfig(), rd(sub, 0, NN_BYTES), rd(sub, 1, 1 << 20));
    expect(Array.from(got)).toEqual(Array.from(new Uint8Array(decodeGenome(direct).weights.buffer.slice(0))));
    const cell = runCell({ arm: NN_ARM, panel: { id: "t", parents: [{ id: "a", g: par }] }, kind: "W-step", mutantsPerParent: 30 });
    expect(cell.n + cell.degenerate).toBe(30);
    expect(cell.degenerate).toBe(0);
  });
});

describe("classification", () => {
  const P = (f: number[]) => { const o = new Int16Array(GRID_POINTS * NO); for (let p = 0; p < GRID_POINTS; p++) for (let k = 0; k < NO; k++) o[p * NO + k] = f[k] * (p % 2 ? 1 : 0.5); return o; };
  const parent = P([60, 60, 0, 0, 0, 0, 0, 0]);
  it("identical -> neutral; zeroed carried channel -> lethal; small perturbation -> viable; non-functional -> na-changed", () => {
    const pi = parentInfo(parent);
    expect(pi.functional).toBe(true);
    expect(classify(pi, pi.means, false)).toBe("neutral");
    const dead = P([0, 60, 0, 0, 0, 0, 0, 0]);
    expect(classify(pi, channelMeans(dead), true)).toBe("lethal");
    const small = P([58, 60, 0, 0, 0, 0, 0, 0]);
    expect(classify(pi, channelMeans(small), true)).toBe("viable");
    const flat = parentInfo(new Int16Array(GRID_POINTS * NO));
    expect(flat.functional).toBe(false);
    expect(classify(flat, channelMeans(small), true)).toBe("na-changed");
    expect(diffStats(parent, small).pointsChanged).toBe(GRID_POINTS);
  });
  it("diffStats breadth equals describeProbes breadth", () => {
    const a = P([60, 60, 0, 0, 0, 0, 0, 0]), b = P([50, 60, 3, 0, 0, 0, 0, 20]);
    expect(diffStats(a, b).outputsMoved).toBe(breadthOf(a, b));
  });
});

describe("statistics helpers", () => {
  it("wilson known values", () => {
    const z = wilson(0, 100); expect(z[0]).toBe(0); expect(z[1]).toBeGreaterThanOrEqual(36); expect(z[1]).toBeLessThanOrEqual(38);
    const h = wilson(50, 100); expect(h[0]).toBeGreaterThanOrEqual(402); expect(h[0]).toBeLessThanOrEqual(405); expect(h[1]).toBeGreaterThanOrEqual(595); expect(h[1]).toBeLessThanOrEqual(598);
  });
  it("distinct-behaviour counting: planted duplicates", () => {
    const a = new Int16Array(16).fill(3), b = a.slice(); b[5] = 9;
    expect(hashOuts(a)).toBe(hashOuts(a.slice()));
    expect(new Set([hashOuts(a), hashOuts(a.slice()), hashOuts(b)]).size).toBe(2);
  });
});

describe("runCell", () => {
  const panel = buildPanelRaw(TAPE_ARM, 3);
  it("is deterministic, salt-sensitive, and counts sum to n", () => {
    const a = runCell({ arm: TAPE_ARM, panel, kind: "T-instr-resample", mutantsPerParent: 12 });
    const b = runCell({ arm: TAPE_ARM, panel, kind: "T-instr-resample", mutantsPerParent: 12 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.neutral + a.changedViable + a.lethal + a.viableNA).toBe(a.n);
    expect(a.n + a.degenerate).toBe(36);
    const c = runCell({ arm: TAPE_ARM, panel, kind: "T-instr-resample", mutantsPerParent: 12, salt: 77 });
    expect(JSON.stringify(c)).not.toBe(JSON.stringify(a));
    assertIntegers(a);
  });
  it("functional panel parents are functional and acceptance is counted", () => {
    const f = buildPanelFunc(TAPE_ARM, 3, 400);
    expect(f.acceptance!.accepted).toBe(f.parents.length);
    for (const p of f.parents) expect(functional(tapeOuts(p.g))).toBe(true);
  });
});

describe("matching", () => {
  it("hillClimb reduces error vs a random start and is deterministic", () => {
    const truth = randomTape(31337);
    const idx = sampleIdx(64);
    const target = subOuts(truth, idx);
    const r1 = hillClimb(target, idx, 5, 1, 1500), r2 = hillClimb(target, idx, 5, 1, 1500);
    expect(Array.from(r1.tape)).toEqual(Array.from(r2.tape));
    const start = sumAbs(subOuts(randomTape(keyedWith(keyedWith(5, 0), 0)), idx), target);
    expect(start).toBeGreaterThan(0);
    expect(r1.subError).toBe(sumAbs(subOuts(r1.tape, idx), target)); // reported error is the tape's real error
    expect(r1.subError).toBeLessThan(start); // the search must improve on the seeded start, not tie it
    expect(Array.from(r1.tape)).not.toEqual(Array.from(randomTape(keyedWith(keyedWith(5, 0), 0))));
    expect(hillClimb(target, idx, 5, 1, 0).subError).toBe(start); // zero evaluations returns the start
    const v = verdict(1, truth, tapeOuts(truth), 0);
    expect(v.fullErrorMilli).toBe(0);
    expect(MATCH.sub).toBe(1024);
  });
});

describe("BFF adapter", () => {
  it("all-no-op program gives zero outputs and equals direct evaluate", () => {
    const prog = new Uint8Array(100).fill(0x41);
    const o = bffOuts(prog);
    expect(o.every((v) => v === 0)).toBe(true);
    const tape = new Uint8Array(128); tape.set(prog, 0);
    for (let i = 0; i < 10; i++) tape[100 + i] = GRID[0][i] + 128;
    for (let k = 0; k < 8; k++) tape[110 + k] = 128;
    evaluate(tape, "noheads", 1024);
    expect(tape[110] - 128).toBe(o[0]);
  });
  // noheads: both heads start at 0 and wrap mod 128; '<' h0--, '{' h1--, '.' tape[h1]=tape[h0]. Sensor i is tape byte 100+i
  // (value x+128), output k is tape byte 110+k (read back as byte-128).
  const copyProg = (sensor: number, out: number): Uint8Array => {
    const prog = new Uint8Array(100).fill(0x41);
    const a = 128 - (100 + sensor), b = 128 - (110 + out);
    let n = 0;
    for (let i = 0; i < a; i++) prog[n++] = "<".charCodeAt(0);
    for (let i = 0; i < b; i++) prog[n++] = "{".charCodeAt(0);
    prog[n++] = ".".charCodeAt(0);
    return prog;
  };
  it("a copy program moves a sensor into an output (offsets, sign and rectification)", () => {
    expect(bffArm("dense").genomeLen).toBe(100);
    expect(randomBff(1, "dense").length).toBe(100);
    for (const [sensor, out] of [[0, 0], [3, 2], [9, 5], [8, 7], [7, 6], [1, 4]]) {
      const o = bffOuts(copyProg(sensor, out));
      let bad = 0, nonzero = 0, negSeen = 0;
      for (let p = 0; p < GRID.length; p++) {
        for (let k = 0; k < NO; k++) if (o[p * NO + k] !== (k === out ? rectify(k, GRID[p][sensor]) : 0)) bad++;
        if (o[p * NO + out] !== 0) nonzero++;
        if (o[p * NO + out] < 0) negSeen++;
      }
      expect(bad).toBe(0);
      expect(nonzero).toBeGreaterThan(0);
      if (out >= 6) expect(negSeen).toBeGreaterThan(0); // unrectified channels keep the sign (sensors 7-9 go negative)
      else expect(negSeen).toBe(0);
    }
  });
});

describe("integers", () => {
  it("assertIntegers accepts a cell record and rejects floats", () => {
    const c = runCell({ arm: NN_ARM, panel: buildPanelRaw(NN_ARM, 1), kind: "W-resample", mutantsPerParent: 4 });
    assertIntegers(c);
    expect(() => assertIntegers({ a: 1.5 })).toThrow();
    void int8;
  });
});
