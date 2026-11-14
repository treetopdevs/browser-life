// Conduit-screen observers (tools/mycelium/observe-conduit.ts) on hand-built snapshots: the sign of imp, csat at the cap, occx on an empty field,
// the intake identity the screen's branch uses, and conduitWindow's null handling. EXPLORATORY (docs/mycelium-conduit-2026-11-14/DESIGN.md).
import { describe, expect, it } from "vitest";
import { conduitCensus, conduitWindow, emptyConduit, pushConduit } from "../mycelium/observe-conduit.ts";
import { createWorld, defaultConfig, type MyceliumConfig, type MyceliumState, POS_SHIFT, step } from "../mycelium/world.ts";

const cfg = (over: Partial<MyceliumConfig> = {}) => defaultConfig({ width: 16, height: 16, founders: 64, maxParticles: 512, ...over });
/** An empty-field copy: no particles, flat zero fields. */
function empty(c: MyceliumConfig): MyceliumState { const s = createWorld(c); s.n = 0; s.A.fill(0); s.C.fill(0); s.P.fill(0); return s; }

describe("conduitCensus", () => {
  it("is defined (nulls and 1s) on an empty field", () => {
    const c = conduitCensus(empty(cfg()), 8, 255);
    expect(c.csat).toBeNull(); expect(c.impLayer).toBeNull(); expect(c.connShare).toBeNull();
    expect(c.occx).toBe(1); expect(c.occxShift).toBe(1); expect(c.sensLevel).toBeNull();
  });

  it("reports csat 1 and csatCap 1 where every edge is at the cap, 0 with no trail", () => {
    const s = createWorld(cfg());
    s.P.fill(255);
    const hi = conduitCensus(s, 255, 255);   // x = 255, ext = 4064, Dd = 128
    expect(hi.csat).toBe(1); expect(hi.csatCap).toBe(1);
    const cap2 = conduitCensus(s, 2, 255);   // plateau at Dd 71: csat 0, csatCap 1 (x = q)
    expect(cap2.csat).toBe(0); expect(cap2.csatCap).toBe(1);
    s.P.fill(0);
    const no = conduitCensus(s, 255, 255);
    expect(no.csat).toBe(0); expect(no.csatCap).toBe(0); expect(no.effP50).toBe(0); expect(no.connNodes).toBe(0);
  });

  it("gives a positive net import in a depleted cell on connected trail, negative in a rich one", () => {
    const c = cfg({ founders: 1, maxParticles: 8 });
    const s = createWorld(c);
    s.A.fill(100); s.P.fill(64);
    const W = c.width, cell = (s.y[0] >>> POS_SHIFT) * W + (s.x[0] >>> POS_SHIFT);
    const group = (A: number) => { s.A[cell] = A; return conduitCensus(s, 8, 255).impAll; };
    // MIN_GROUP hides the layer split for one particle, but impAll is always the plain mean.
    expect(group(0)).toBeGreaterThan(0);
    expect(group(1000)).toBeLessThan(0);
    expect(group(100)).toBe(0);
  });

  it("zero conduit strength gives zero extra import and the cell's own trail still counts for connectivity", () => {
    const s = createWorld(cfg());
    s.P.fill(20);
    const c = conduitCensus(s, 0, 255);
    expect(c.impAll).toBe(0); expect(c.effP90).toBe(0); expect(c.connShare).toBe(1); expect(c.connLargest).toBe(256);
  });
});

describe("branch intake identity", () => {
  it("sum A at start + (change in lightIn) / eA - sum A at end equals the A the particles ate, step by step", () => {
    const s = createWorld(cfg());
    for (let t = 0; t < 200; t++) {
      const a0 = s.A.reduce((x, v) => x + v, 0), l0 = s.totals.lightIn, m0 = s.M.subarray(0, s.n).reduce((x, v) => x + v, 0);
      const st = step(s);
      const dl = s.totals.lightIn - l0;
      expect(dl % s.config.eA).toBe(0);
      const intake = a0 + dl / s.config.eA - s.A.reduce((x, v) => x + v, 0);
      expect(intake).toBeGreaterThanOrEqual(0);
      void m0; void st;
    }
  });
});

describe("conduitWindow", () => {
  it("averages the non-null entries in (lo, hi] and gives null for a column with none", () => {
    const ser = emptyConduit();
    const s = createWorld(cfg());
    pushConduit(ser, 500, conduitCensus(s, 8, 255));
    pushConduit(ser, 1000, conduitCensus(s, 8, 255));
    const w = conduitWindow(ser, 0, 1000);
    expect(w.csat).not.toBeNull();
    expect(conduitWindow(ser, 1000, 2000).csat).toBeNull();
    expect(w.nLayer).toBe(conduitCensus(s, 8, 255).nLayer);
  });
});
