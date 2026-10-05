// Renewal readout: endpoint boundaries, selection order and confirmation rules
// on synthetic census records. No world is stepped.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type CaseInfo,
  type CaseReadout,
  type CensusLine,
  confirmationDecision,
  readCase,
  selectHabitat,
  type Thresholds,
} from "../lib/construction-renewal-readout.ts";

const TH: Thresholds = {
  V: 128,
  Qmin: 128,
  Rmin: 0,
  censusEvery: 100,
  mainWindow: { from: 9000, to: 10000 },
  controlWindow: { from: 2000, to: 3000 },
  censusesPerWindow: 11,
};
const N = 6; // cells; site 0 is the source

interface SiteSpec {
  /** B at census step t. */
  B: (t: number) => number;
  /** Cumulative PHOTO+GROW at step t (all counted as photo). */
  Q: (t: number) => number;
  /** Cumulative reaction change of B at step t. */
  R: (t: number) => number;
}
const zero: SiteSpec = { B: () => 0, Q: () => 0, R: () => 0 };
const live = (B = 200, rateQ = 0.2, rateR = 0): SiteSpec => ({ B: () => B, Q: (t) => Math.floor(rateQ * t), R: (t) => Math.floor(rateR * t) });

function lines(sites: SiteSpec[], horizon = 10000, build = "5"): CensusLine[] {
  const out: CensusLine[] = [];
  for (let t = 0; t <= horizon; t += 100) {
    const cells = Array.from({ length: N }, (_, i) => sites[i] ?? zero);
    out.push({
      step: t,
      cells: { B: cells.map((s) => s.B(t)) },
      cumulative: {
        photo: cells.map((s) => s.Q(t)),
        grow: cells.map(() => 0),
        reactB: cells.map((s) => s.R(t)),
        boundBIn: cells.map(() => 0),
        boundBOut: cells.map(() => 0),
      },
      totals: { A: "1000", B: String(cells.reduce((a, s) => a + s.B(t), 0)) },
      flux: { build },
      lightIn: "0",
      activeBArea: "0",
    });
  }
  return out;
}

const main = (id = "pilot-builder-A4-s1", extra: Partial<CaseInfo> = {}): CaseInfo => ({
  id,
  phase: "pilot",
  kind: "main",
  arm: "builder",
  seed: 1,
  reservoir: 4,
  spread: 1,
  horizon: 10000,
  sourceSites: [0],
  ...extra,
});

const renew = (sites: SiteSpec[]) => {
  const r = readCase(main(), lines(sites), TH, "1024");
  if (r.status !== "complete") throw new Error(r.reason);
  return r;
};

describe("maintained() and RENEW", () => {
  it("passes exactly at the thresholds: B = 128 at all 11 censuses, Q = 128, R = 0", () => {
    const edge: SiteSpec = { B: () => 128, Q: (t) => (t >= 10000 ? 128 : 0), R: () => 0 };
    const r = renew([edge, edge]);
    expect(r.renew).toBe(true);
    expect(r.qualifyingSites).toEqual([1]);
    expect(r.sourceMaintenance).toMatchObject({ minB: 128, Q: 128, R: 0, maintained: true });
  });

  it("fails one quantum below each threshold", () => {
    const ok: SiteSpec = { B: () => 128, Q: (t) => (t >= 10000 ? 128 : 0), R: () => 0 };
    expect(renew([ok, { ...ok, B: (t) => (t === 9500 ? 127 : 128) }]).renew).toBe(false);
    expect(renew([ok, { ...ok, Q: (t) => (t >= 10000 ? 127 : 0) }]).renew).toBe(false);
    expect(renew([ok, { ...ok, R: (t) => (t >= 10000 ? -1 : 0) }]).renew).toBe(false);
    // Q before the window does not count.
    expect(renew([ok, { ...ok, Q: (t) => (t >= 9000 ? 128 : 0) }]).renew).toBe(false);
  });

  it("a missing census makes the case incomplete, not negative", () => {
    const l = lines([live(), live()]).filter((x) => x.step !== 9400);
    const r = readCase(main(), l, TH, "1024");
    expect(r.status).toBe("incomplete");
    const truncated = lines([live(), live()]).filter((x) => x.step <= 9900);
    expect(readCase(main(), truncated, TH, "1024").status).toBe("incomplete");
    const dup = lines([live(), live()]);
    dup.push(dup[50]);
    expect(readCase(main(), dup, TH, "1024").status).toBe("incomplete");
  });

  it("different sites qualifying at different censuses do not qualify", () => {
    const early: SiteSpec = { ...live(), B: (t) => (t <= 9500 ? 200 : 0) };
    const lateSite: SiteSpec = { ...live(), B: (t) => (t > 9500 ? 200 : 0) };
    const r = renew([live(), early, lateSite]);
    expect(r.renew).toBe(false);
    expect(r.qualifyingSites).toEqual([]);
  });

  it("a passive imported deposit (Q = 0) never qualifies, nor does polymer-free static biomass", () => {
    expect(renew([live(), { B: () => 5000, Q: () => 0, R: () => 0 }]).renew).toBe(false);
  });

  it("an active site with negative reaction balance does not qualify", () => {
    expect(renew([live(), live(300, 1, -0.01)]).renew).toBe(false);
  });

  it("source loss defeats RENEW even when a new site is maintained", () => {
    const r = renew([{ ...live(), B: (t) => (t >= 9800 ? 50 : 300) }, live()]);
    expect(r.renew).toBe(false);
    expect(r.qualifyingSites).toEqual([1]);
  });

  it("records every qualifying site, not only the best", () => {
    const r = renew([live(), live(), zero, live(500), zero, live(130)]);
    expect(r.renew).toBe(true);
    expect(r.qualifyingSites).toEqual([1, 3, 5]);
  });

  it("extinction: RENEW false and zero final active B, costs retained", () => {
    const dying: SiteSpec = { B: (t) => (t < 5000 ? 900 : 0), Q: (t) => Math.min(t, 5000), R: (t) => -Math.min(t, 5000) };
    const r = readCase(main(), lines([dying], 10000, "321"), TH, "1024");
    expect(r.status).toBe("complete");
    if (r.status !== "complete") return;
    expect(r.extinct).toBe(true);
    expect(r.renew).toBe(false);
    expect(r.secondary.finalActiveB).toBe(0);
    expect(r.secondary.buildExpenditureB).toBe("321");
  });
});

describe("control readouts", () => {
  it("capacity/division: both sites need B >= 128 at all censuses 2000..3000 and Q >= 128; R is reported only", () => {
    const info: CaseInfo = { ...main("control-capacity-A4"), phase: "controls", kind: "capacity", spread: 0, horizon: 3000, sourceSites: [0, 3] };
    const sites = [live(300, 0.2, -0.5), zero, zero, live(200, 0.2, 0)];
    const r = readCase(info, lines(sites, 3000), TH, "1024");
    expect(r.status === "complete" && r.bothSitesPersist).toBe(true);
    if (r.status === "complete") expect(r.controlSites![0]).toMatchObject({ status: "ok", R: -500 });
    const failing = [live(), zero, zero, { ...live(), B: (t: number) => (t === 2500 ? 100 : 200) }];
    const f = readCase(info, lines(failing, 3000), TH, "1024");
    expect(f.status === "complete" && f.bothSitesPersist).toBe(false);
  });

  it("small-founder probe: any one same site, the initial site included", () => {
    const info: CaseInfo = { ...main("control-small-B64-A4-s1"), phase: "controls", kind: "small-founder" };
    const onlySource = readCase(info, lines([live()]), TH, "1024");
    expect(onlySource.status === "complete" && onlySource.anySiteMaintained).toBe(true);
    if (onlySource.status === "complete") expect(onlySource.maintainedSites).toEqual([0]);
    const none = readCase(info, lines([live(100)]), TH, "1024");
    expect(none.status === "complete" && none.anySiteMaintained).toBe(false);
  });
});

const ORDER = [{ reservoir: 4, spread: 1 }, { reservoir: 4, spread: 2 }, { reservoir: 16, spread: 1 }, { reservoir: 16, spread: 2 }];
function pilotSet(renewing: string[], incomplete: string[] = []) {
  const all: { info: CaseInfo; readout: CaseReadout }[] = [];
  for (let k = 0; k < 16; k++) {
    const info: CaseInfo = { ...main(`control-${k}`), phase: "controls", kind: "small-founder" };
    all.push({ info, readout: { id: info.id, status: "complete", kind: "small-founder", extinct: false, anySiteMaintained: false, secondary: {} as never } });
  }
  for (const reservoir of [4, 16]) {
    for (const spread of [0, 1, 2]) {
      for (const arm of ["builder", "matched", "selected", "ablation"]) {
        const id = `pilot-${arm}-A${reservoir}-s${spread}`;
        const info = main(id, { arm, reservoir, spread });
        all.push({
          info,
          readout: incomplete.includes(id)
            ? { id, status: "incomplete", reason: "test" }
            : { id, status: "complete", kind: "main", extinct: false, renew: renewing.includes(id), secondary: {} as never },
        });
      }
    }
  }
  return all;
}

describe("candidate selection", () => {
  it("selects the first eligible habitat in the frozen order, never by outcome size", () => {
    const s = selectHabitat(pilotSet(["pilot-selected-A16-s1", "pilot-matched-A4-s2"]), ORDER, [1, 2], 40);
    expect(s).toEqual({ status: "selected", habitat: { reservoir: 4, spread: 2 }, eligible: [{ reservoir: 4, spread: 2 }, { reservoir: 16, spread: 1 }] });
  });

  it("does not need construction specificity: any one arm renewing makes a habitat eligible", () => {
    const s = selectHabitat(pilotSet(["pilot-ablation-A16-s2"]), ORDER, [1, 2], 40);
    expect(s.status === "selected" && s.habitat).toEqual({ reservoir: 16, spread: 2 });
  });

  it("spread 0 cannot qualify; with nothing else eligible the study closes negative", () => {
    expect(selectHabitat(pilotSet(["pilot-builder-A4-s0", "pilot-builder-A16-s0"]), ORDER, [1, 2], 40)).toEqual({ status: "none-eligible", eligible: [] });
  });

  it("refuses to select while any of the 40 cases is incomplete or missing", () => {
    expect(selectHabitat(pilotSet(["pilot-builder-A4-s1"], ["pilot-matched-A16-s2"]), ORDER, [1, 2], 40).status).toBe("incomplete");
    expect(selectHabitat(pilotSet(["pilot-builder-A4-s1"]).slice(1), ORDER, [1, 2], 40).status).toBe("incomplete");
  });
});

const ARMS = ["builder", "matched", "selected", "ablation"];
const SEEDS = [7311001, 7311002, 7311003, 7311004, 7311005];
function confRows(renewing: (arm: string, seedIndex: number) => boolean, build: (arm: string, seedIndex: number) => string = () => "50") {
  return ARMS.flatMap((arm) =>
    SEEDS.map((seed, k) => ({
      arm,
      seed,
      readout: { id: `${arm}-${seed}`, status: "complete" as const, kind: "main" as const, extinct: false, renew: renewing(arm, k), secondary: { buildExpenditureB: build(arm, k) } as never },
    }))
  );
}

describe("confirmation decisions", () => {
  it("4 of 5 confirms, 3 of 5 does not", () => {
    const four = confirmationDecision(confRows((a, k) => a === "selected" && k !== 2), ARMS, SEEDS, 4);
    expect(four.status === "complete" && four.confirmed).toBe(true);
    if (four.status === "complete") {
      expect(four.confirmedArms).toEqual(["selected"]);
      expect(four.counts).toEqual({ builder: 0, matched: 0, selected: 4, ablation: 0 });
      expect(four.constructionSpecific).toBe(false);
    }
    const three = confirmationDecision(confRows((a, k) => a === "selected" && k < 3), ARMS, SEEDS, 4);
    expect(three.status === "complete" && three.confirmed).toBe(false);
  });

  it("different arms winning different blocks do not confirm", () => {
    const d = confirmationDecision(confRows((a, k) => ARMS[k % 4] === a), ARMS, SEEDS, 4);
    expect(d.status === "complete" && d.confirmed).toBe(false);
  });

  it("construction-specific needs builder-only renewal and paid BUILD by builder and ablation in 4 of 5 blocks", () => {
    const only = confirmationDecision(confRows((a) => a === "builder"), ARMS, SEEDS, 4);
    expect(only.status === "complete" && only.constructionSpecific).toBe(true);
    const unpaid = confirmationDecision(confRows((a) => a === "builder", (a, k) => (a === "ablation" && k < 2 ? "0" : "50")), ARMS, SEEDS, 4);
    expect(unpaid.status === "complete" && unpaid.constructionSpecific).toBe(false);
    if (unpaid.status === "complete") expect(unpaid.specificBlocks.length).toBe(3);
    const shared = confirmationDecision(confRows((a, k) => a === "builder" || (a === "matched" && k < 2)), ARMS, SEEDS, 4);
    expect(shared.status === "complete" && shared.confirmed && !shared.constructionSpecific).toBe(true);
  });

  it("an incomplete case leaves the confirmation incomplete, never false", () => {
    const rows = confRows((a) => a === "builder");
    rows[3] = { ...rows[3], readout: { id: "x", status: "incomplete", reason: "crash" } as never };
    expect(confirmationDecision(rows, ARMS, SEEDS, 4).status).toBe("incomplete");
    expect(confirmationDecision(rows.slice(1), ARMS, SEEDS, 4).status).toBe("incomplete");
  });
});

describe("audit independence", () => {
  it("the verifier does not import the production readout", () => {
    const src = readFileSync("tools/construction-renewal-verify.ts", "utf8");
    const imports = src.split("\n").filter((l) => /^\s*(import|export)\b.*\bfrom\s/.test(l) || /\bimport\(/.test(l));
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.join("\n")).not.toMatch(/construction-renewal-readout/);
  });
});
