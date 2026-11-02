import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lifeGlider, lifeGlidersDup, randomBits, type Movie } from "../src/predictability/index.ts";
import { baseFixtures } from "../src/predictability/fixtures.ts";
import { lazyFixtures } from "../src/assembly/lazy.ts";
import { observeVariants } from "../src/assembly/observer.ts";
import { ConstructionService } from "../src/assembly/construct.ts";
import { StreamObserver, observeMovie } from "../src/assembly/stream.ts";
import { patchReadouts } from "../src/assembly/readouts.ts";

const run = (m: Movie, conn: 4 | 8, lags = [1, 2, 4]) => {
  const o = new StreamObserver(m.w, m.h, { conn, tau: 1 }, lags);
  for (const f of m.frames) o.push(f);
  return o.finish(new ConstructionService());
};

describe("streaming sampler", () => {
  it("streams one frame at a time: a retained frame would read back empty", () => {
    const m = lifeGlider();
    let produced = 0, released = 0, live = 0, maxLive = 0;
    const obs = new StreamObserver(m.w, m.h, { conn: 4, tau: 1 }, [1, 2, 4]);
    // Every frame is a fresh copy whose buffer is detached as soon as the consumer asks for the next one. Anything the
    // observer kept a reference to would be empty afterwards, so retention changes the result (checked below).
    function* detaching(): Generator<Uint8Array> {
      for (let k = 0; k < 2_000; k++) {
        const f = Uint8Array.from(m.frames[k % m.frames.length]);
        produced++; live++; if (live > maxLive) maxLive = live;
        yield f;
        structuredClone(f.buffer, { transfer: [f.buffer] });
        expect(f.length).toBe(0);
        released++; live--;
      }
    }
    for (const f of detaching()) { obs.push(f); expect(obs.retainedFrames()).toBe(0); expect(obs.ringLength()).toBeLessThanOrEqual(4); }
    expect(produced).toBe(2_000);
    expect(released).toBe(2_000);
    expect(maxLive).toBe(1);
    expect(obs.ringLength()).toBe(4);
    // the carried state does not grow with the number of frames: the tally holds only the glider's distinct shapes
    const streamed = obs.finish(new ConstructionService());
    expect(streamed.classesT).toBeLessThan(10);
    // same answer as a run that never detaches anything (cycled glider frames)
    const plain = new StreamObserver(m.w, m.h, { conn: 4, tau: 1 }, [1, 2, 4]);
    for (let k = 0; k < 2_000; k++) plain.push(m.frames[k % m.frames.length]);
    expect(streamed).toEqual(plain.finish(new ConstructionService()));
  });

  it("the evidence driver streams: lazy fixtures equal the I14 movies byte for byte, and detaching frames changes nothing", () => {
    const base = baseFixtures().movies;
    const lazy = lazyFixtures();
    expect(lazy.map((l) => l.id)).toEqual(base.map((b) => b.id));
    for (let i = 0; i < base.length; i++) {
      const bm = base[i], lm = lazy[i];
      expect([lm.w, lm.h, lm.q, lm.frameCount]).toEqual([bm.w, bm.h, bm.q, bm.frames.length]);
      let k = 0;
      for (const f of lm.frames()) { expect(Buffer.compare(Buffer.from(f), Buffer.from(bm.frames[k]))).toBe(0); k++; }
      expect(k).toBe(bm.frames.length);
    }
    const g = lazy[3];
    function* detaching(): Generator<Uint8Array> {
      for (const f of g.frames()) { const c = Uint8Array.from(f); yield c; structuredClone(c.buffer, { transfer: [c.buffer] }); }
    }
    const variants = [{ conn: 4 as const, tau: 1 }, { conn: 8 as const, tau: 1 }];
    const a = observeVariants(detaching(), g.w, g.h, variants, new ConstructionService());
    const b = observeVariants(g.frames(), g.w, g.h, variants, new ConstructionService());
    expect(a).toEqual(b);
    // the driver itself never asks for a materialised movie
    const src = readFileSync(new URL("../src/assembly/observer.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/import[^;]*(baseFixtures|movieBytes)/);
  });

  it("an exhausted solver is reported, not silently scored", () => {
    // eight cells in a row: exact cost is 3
    const o = new StreamObserver(16, 4, { conn: 4, tau: 1 }, [1]);
    const fr = new Uint8Array(64); fr.fill(1, 16, 24);
    o.push(fr);
    const ok = o.finish(new ConstructionService());
    expect(ok.construction.reuseRatio).toEqual({ num: 3, den: 7 });
    expect(ok.construction.inexactObjects).toBe(0);
    const spent = o.finish(new ConstructionService(0));
    expect(spent.construction.reuseRatio).toBeNull();
    expect(spent.construction.inexactObjects).toBe(1);
    expect(spent.construction.scoredObjects).toBe(0);
  });

  it("equals the non-streaming reference on a small movie", () => {
    const m = lifeGlidersDup();
    const streamed = run(m, 4);
    // reference: per-frame patch readouts folded by hand
    const svc = new ConstructionService();
    let objects = 0, copyExcess = 0, maxCopies = 0;
    const keys = new Set<string>();
    for (const f of m.frames) {
      const r = patchReadouts(f, m.w, m.h, { conn: 4, tau: 1 }, svc);
      objects += r.objects; copyExcess += r.copies.T.copyExcess; maxCopies = Math.max(maxCopies, r.copies.T.maxCopies);
      for (const c of r.classes) keys.add(`${c.n}`);
    }
    expect(streamed.objectsPerFrame).toEqual({ num: objects, den: m.frames.length });
    expect(streamed.copyExcess).toBe(copyExcess);
    expect(streamed.maxCopies).toBe(maxCopies);
  });

  it("persistence and temporal sampling: exact rationals", () => {
    const g = lifeGlider();
    // 4-connectivity: the monomer class recurs, the other class is new each frame -> 1/2 at lag 1; a full period back at lag 4 -> 1
    expect(run(g, 4).persistence["1"]).toEqual({ num: 95, den: 190 });
    expect(run(g, 4).persistence["4"]).toEqual({ num: 184, den: 184 });
    // 8-connectivity: one 5-cell class per frame, no phase repeats under translation until a full period
    expect(run(g, 8).persistence["1"]).toEqual({ num: 0, den: 95 });
    expect(run(g, 8).persistence["4"]).toEqual({ num: 92, den: 92 });
    // lag is a frame lag, distinct from sampling stride: stride 4 makes every consecutive sampled pair a full period apart
    const strided = observeMovie(g.frames, g.w, g.h, { conn: 8, tau: 1 }, [1, 4], [1], new ConstructionService());
    expect(strided["4"].persistence["1"]).toEqual({ num: 23, den: 23 });
    expect(strided["1"].persistence["1"]).toEqual({ num: 0, den: 95 });
    // random bits are recorded, not gated
    const bits = run(randomBits(), 8, [1]);
    expect(bits.persistence["1"]!.den).toBeGreaterThan(0);
  });

  it("past/future independence: results for earlier pairs do not change when later frames change", () => {
    const m = lifeGlider();
    const a = new StreamObserver(m.w, m.h, { conn: 4, tau: 1 }, [1, 2, 4]);
    const b = new StreamObserver(m.w, m.h, { conn: 4, tau: 1 }, [1, 2, 4]);
    const K = 40;
    for (let k = 0; k < K; k++) { a.push(m.frames[k]); b.push(m.frames[k]); }
    const snap = JSON.stringify(a.finish(new ConstructionService()).persistence);
    expect(JSON.stringify(b.finish(new ConstructionService()).persistence)).toBe(snap);
    // change the future of one copy only
    for (let k = K; k < 60; k++) a.push(m.frames[k]);
    for (let k = K; k < 60; k++) b.push(new Uint8Array(m.w * m.h));
    const after = JSON.stringify(a.finish(new ConstructionService()).persistence);
    expect(after).not.toBe(JSON.stringify(b.finish(new ConstructionService()).persistence));
    // a fresh observer fed only the first K frames reproduces the pre-change snapshot: nothing past K leaked backwards
    const c = new StreamObserver(m.w, m.h, { conn: 4, tau: 1 }, [1, 2, 4]);
    for (let k = 0; k < K; k++) c.push(m.frames[k]);
    expect(JSON.stringify(c.finish(new ConstructionService()).persistence)).toBe(snap);
  });
});
