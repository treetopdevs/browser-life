import { describe, expect, it } from "vitest";
import { FoundationLifeAudit, parseSavedLifeEvent } from "../lib/foundation-life.ts";

const audit = (initial = 1) => { const a = new FoundationLifeAudit(500, 100); a.seedInitialIndividuals(initial); return a; };
describe("saved life graph audit", () => {
  it("requires linked fission edges, retains all outcome denominators and censors survivors", () => {
    const a = audit();
    a.push({ step: 200, kind: "fission", parent: 1, children: [2, 3] });
    a.push({ step: 300, kind: "fission", parent: 2, children: [4] });
    a.push({ step: 300, kind: "death", id: 3 });
    const r = a.finish();
    expect(r.threeIdentityFissionChains).toBe(1);
    expect(r.chainWitnesses[0].chain.map((x) => x.id)).toEqual([1, 2, 4]);
    expect(r.outcomes.fission).toEqual({ introduced: 3, nextFission: 1, deathBeforeFission: 1, fusionBeforeFission: 0, rightCensored: 1, summedStepsToFission: 100 });
    expect(r.biologicalReproductionEstablished).toBe(false);
  });
  it("does not treat two unrelated fissions or budding attribution as a connected cycle", () => {
    const a = audit(2);
    a.push({ step: 200, kind: "fission", parent: 1, children: [3] });
    a.push({ step: 200, kind: "budding", parent: 3, child: 4 }); // invalid same-census parent in the real observer
    expect(() => a.finish()).toThrow("missing or ended");
    const b = audit(2);
    b.push({ step: 200, kind: "fission", parent: 1, children: [3] });
    b.push({ step: 300, kind: "budding", parent: 3, child: 4 });
    b.push({ step: 400, kind: "fission", parent: 4, children: [5] });
    expect(b.finish().threeIdentityFissionChains).toBe(0);
  });
  it("gives same-census fusion precedence and preserves a continuing main parent", () => {
    const a = audit(2);
    a.push({ step: 200, kind: "fission", parent: 1, children: [3] });
    a.push({ step: 200, kind: "fusion", parents: [1, 2], child: 3 });
    a.push({ step: 300, kind: "fission", parent: 1, children: [4] });
    const r = a.finish();
    expect(r.finalTrackedIndividuals).toBe(3);
    expect(r.outcomes.fission.fusionBeforeFission).toBe(1);
    expect(r.outcomes["unrecorded-initial"].fusionBeforeFission).toBe(2);
    expect(r.threeIdentityFissionChains).toBe(0);
  });
  it("breaks continuity across a fusion between the two fission edges", () => {
    const a = audit(2);
    a.push({ step: 200, kind: "fission", parent: 1, children: [3] });
    a.push({ step: 300, kind: "fusion", parents: [3, 2], child: 3 });
    a.push({ step: 400, kind: "fission", parent: 3, children: [4] });
    expect(a.finish().threeIdentityFissionChains).toBe(0);
  });
  it("requires the initial census and rejects malformed, duplicate, stale and unscheduled identities", () => {
    expect(() => new FoundationLifeAudit(500, 100).finish()).toThrow("initial census");
    expect(() => parseSavedLifeEvent({ step: 200, kind: "fission", parent: 1, children: [1] })).toThrow();
    const a = audit();
    a.push({ step: 200, kind: "death", id: 1 });
    a.push({ step: 300, kind: "fission", parent: 1, children: [2] });
    expect(() => a.finish()).toThrow("missing or ended");
    const b = audit();
    b.push({ step: 200, kind: "birth", id: 1 });
    expect(() => b.finish()).toThrow("reused");
    expect(() => audit().push({ step: 250, kind: "death", id: 1 })).toThrow("schedule");
    const c = audit(); c.push({ step: 300, kind: "death", id: 1 });
    expect(() => c.push({ step: 200, kind: "birth", id: 2 })).toThrow("schedule");
  });
  it("detects an intermediate birth/death cancellation hidden by the final count", () => {
    const a = audit();
    a.push({ step: 200, kind: "birth", id: 2 });
    expect(() => a.reconcileCensus(200, 1)).toThrow("event graph 2 != series 1");
    const b = audit();
    b.push({ step: 200, kind: "birth", id: 2 });
    b.reconcileCensus(200, 2);
    b.push({ step: 300, kind: "death", id: 2 });
    b.reconcileCensus(300, 1);
    b.reconcileCensus(400, 1); // event-free census still reconciles
    b.reconcileCensus(500, 1);
    expect(b.finish().finalTrackedIndividuals).toBe(1);
  });
  it("reconciles repeated same-census fusion absorption by live identity", () => {
    const a = audit(3);
    a.push({ step: 200, kind: "fusion", parents: [1, 3], child: 1 });
    a.push({ step: 200, kind: "fusion", parents: [2, 3], child: 2 });
    a.reconcileCensus(200, 2); // ID 3 is removed once, though named twice
    a.reconcileCensus(300, 2);
    a.reconcileCensus(400, 2);
    a.reconcileCensus(500, 2);
    expect(a.finish().finalTrackedIndividuals).toBe(2);
  });
});
