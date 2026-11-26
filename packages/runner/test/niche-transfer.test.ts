import { describe, expect, it } from "vitest";
import { CH, cellCount, totalsOf, validateState } from "@bl/schema";
import { candidateOf, PROTOCOL, type Protocol } from "../src/niche/protocol.ts";
import { buildArms, footprintCells, outsideRegion, runHistory, startWorld } from "../src/niche/arms.ts";
import { runBlock } from "../src/niche/assay.ts";
import { fixtureProtocol, runGuards, uniformBudget } from "../src/niche/fixtures.ts";
import { NicheInvalid, assertAudit, cloneState, commonCells, convertPolymer, fundReserve, openAudit, relabelLiving, residuals } from "../src/niche/transfer.ts";

const cand = candidateOf(0);
const seed = PROTOCOL.devSeeds[0];
let cached: ReturnType<typeof runHistory> | null = null;
const history = () => (cached ??= runHistory(cand, "builder", seed));
const short: Protocol = { ...PROTOCOL, T1: 6, T2: 6, census: 1 };

describe("niche transfer ledger", () => {
  it("relabel keeps every channel total and records living count", () => {
    const h = history();
    const s = cloneState(h.state), a = { ...h.audit };
    const rec = relabelLiving(s, a);
    for (const k of ["A", "B", "C", "P", "E", "S", "matter", "energy"] as const) expect(rec.after[k]).toBe(rec.before[k]);
    expect(rec.before.living).toBeGreaterThan(0);
    expect(rec.after.living).toBe(0);
    expect(rec.detail.cells).toBe(rec.before.living);
    expect(rec.residual).toBe("0");
  });

  it("P-to-C conversion books heatAnalytic and residual is zero", () => {
    const h = history();
    const s = cloneState(h.state), a = { ...h.audit };
    const P = totalsOf(s.cfg, s.cells).P;
    expect(P).toBeGreaterThan(0n);
    const rec = convertPolymer(s, a);
    expect(a.heatAnalytic).toBe(BigInt(s.cfg.eP - s.cfg.eC) * P);
    expect(totalsOf(s.cfg, s.cells).P).toBe(0n);
    expect(rec.residual).toBe("0");
    expect(rec.matterResidual).toBe("0");
  });

  it("reserve debit funds eB*B_r + E_r and arm totals equal at step 0", () => {
    const p = fixtureProtocol();
    const b = runHistory(cand, "builder", seed, p), n = runHistory(cand, "nonbuilder", seed, p);
    const cfg = b.state.cfg;
    expect(b.audit.reserveB).toBe(p.reserve.B);
    expect(b.audit.reserveE).toBe(p.reserve.E);
    const t = totalsOf(cfg, b.state.cells);
    expect(t.energy + BigInt(cfg.eB) * BigInt(p.reserve.B) + BigInt(p.reserve.E)).toBe(b.audit.energyStart);
    expect(t.matter + BigInt(p.reserve.B)).toBe(b.audit.matterStart);
    expect(n.audit.energyStart).toBe(b.audit.energyStart);
    expect(n.audit.matterStart).toBe(b.audit.matterStart);
  });

  it("cumulative invariant ledger+reserve+heatAnalytic is 0n across both stages", () => {
    const h = history();
    expect(residuals(h.state, h.audit)).toEqual({ energy: 0n, matter: 0n });
    const r = runBlock(0, seed, short);
    expect(r.valid, r.invalidReason ?? "").toBe(true);
    for (const recs of Object.values(r.transfers)) for (const x of recs) expect([x.residual, x.matterResidual]).toEqual(["0", "0"]);
    // the ablation arm carries analytic heat and still closes
    expect(r.transfers.ab.some((x) => x.op === "polymer-to-waste")).toBe(true);
  });

  it("underfunded reserve => invalid-or-incomplete, not a thrown crash", () => {
    const s = startWorld(cand, "builder", seed, short);
    expect(() => fundReserve(s, openAudit(s), 10 ** 7, 1, outsideRegion(short))).toThrow(NicheInvalid);
    const r = runBlock(0, seed, { ...short, reserve: { B: 10 ** 7, E: 1 } });
    expect(r.valid).toBe(false);
    expect(r.invalidReason).toMatch(/underfunded/);
  });

  it("pool-cap refusal and validateState on every transferred state", () => {
    const guards = runGuards();
    expect(guards.find((g) => g.id === "pool-cap")?.ok).toBe(true);
    const built = buildArms(cand, seed, short, 1);
    for (const x of built.arms) expect(validateState(x.state)).toEqual([]);
  });

  it("placement refuses occupied cell and reports it", () => {
    const g = runGuards().find((x) => x.id === "overwrite-attempt")!;
    expect(g.ok).toBe(true);
    expect(g.detail).toMatch(/occupied/);
  });

  it("placement set is the intersection across arms", () => {
    const p = fixtureProtocol();
    const mk = () => {
      const s = startWorld(cand, "builder", seed, p);
      return s;
    };
    const a = mk(), b = mk();
    const fp = footprintCells(p);
    const n = cellCount(a.cfg);
    a.cells[CH.B * n + fp[0]] = 3;
    b.cells[CH.P * n + fp[1]] = 3;
    const common = commonCells([a, b], fp, 0);
    expect(common).not.toContain(fp[0]);
    expect(common).not.toContain(fp[1]);
    expect(common.length).toBe(fp.length - 2);
  });

  it("fewer than Nmin common cells => invalid-or-incomplete", () => {
    const r = runBlock(0, seed, { ...short, nMin: 400 });
    expect(r.valid).toBe(false);
    expect(r.invalidReason).toMatch(/common placeable cells/);
  });

  it("openAudit on a state that already carries light and heat ledgers is exact", () => {
    const h = history();
    expect(h.state.lightIn).toBeGreaterThan(0n);
    expect(h.state.heatOut).toBeGreaterThan(0n);
    expect(residuals(h.state, openAudit(h.state))).toEqual({ energy: 0n, matter: 0n });
  });

  it("nonzero residual throws", () => {
    const h = history();
    const s = cloneState(h.state);
    s.cells[CH.E * cellCount(s.cfg) + 0] += 1;
    expect(() => assertAudit(s, h.audit, "test")).toThrow(/nonzero residual/);
    void uniformBudget;
  });
});
