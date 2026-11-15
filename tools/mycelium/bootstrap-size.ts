// Sizing step S0, rules R1 to R4 applied to finished S1 and S2 runs (docs/mycelium-bootstrap-2026-11-14/DESIGN.md section 7). Pure: no Deno, no file system.
// R5 and R6 (the F and O pilots, S3 and S4) are pure rules in observe-bootstrap.ts; their inputs come from the pilot runs and are not assembled here.
import { aliveAndWindow, chooseV, colWindow, DEF_THETAS, freeCeiling, freeStrengths, gRising, settleT0, thetaR6 } from "./observe-bootstrap.ts";
import type { RunFile } from "./bootstrap-analyze.ts";
import { armsOf, PATTERNS, PROVISIONAL, S2_VALUES, type Sizing } from "./bootstrap-arms.ts";
import { histMedian, matchCpubFromHists, meanEffFromHist, ownerGFromX } from "./observe-owner.ts";
import { ownerGStrengths } from "./observe-bootstrap.ts";

/** The steps a sizing arm is defined to run (arm lengths do not depend on the sizing values); null for an arm the tables do not know. */
const pilotSteps = (r: RunFile): number | null => armsOf(r.series, PROVISIONAL).find((a) => a.id === r.armId)?.steps ?? null;

const med = (a: readonly number[]): number | null => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

export interface SizeResult { lines: string[]; sizing: Record<string, unknown> }

/** Seeds each sizing arm is run with (DESIGN 7: S0.1 and S0.4 use 4, S0.2 and S0.3 use 2). A rule is applied only when every arm it reads is complete. */
export const S_SEEDS = { S1: 4, S2: 2, S3: 2, S4: 4 } as const;

export function sizeFromS(allRows: readonly RunFile[]): SizeResult {
  // A pilot run with a shorter --steps has a different late window: it is not a measurement and never marks a sizing field measured.
  const short = allRows.filter((r) => !r.smoke && /^S/.test(r.series) && (pilotSteps(r) ?? 0) > r.steps);
  const rows = allRows.filter((r) => !r.smoke && !short.includes(r));
  const L: string[] = [];
  if (short.length) L.push(`${short.length} shortened pilot run(s) left out (run with fewer steps than the arm defines): ${short.slice(0, 6).map((r) => r.id).join(", ")}${short.length > 6 ? ", ..." : ""}`);
  const out: Record<string, unknown> = { measured: [] as string[], note: "R1 to R6 from the S runs present; gOwner and gCpub need the owner-edge readouts (step 3c) and are never measured here; the S3 'moved once if median eff is outside 9 to 53' step is not applied" };
  const measured = out.measured as string[];
  // R1 on S1 (keyless, U and G).
  const s1 = rows.filter((r) => r.series === "S1");
  let t0: number | null = null;
  if (s1.length) {
    const res: { light: string; t0: number; failed: boolean; seeds: number }[] = [];
    for (const light of ["U", "G"]) {
      const rs = s1.filter((r) => r.armId === `base0-${light}`);
      const ns = rs.map((r) => Array.from({ length: 400 }, (_, k) => r.snaps.find((s) => s.step === k + 1)?.n ?? NaN));
      if (ns.length && ns.every((a) => a.every(Number.isFinite))) { const x = settleT0(ns); res.push({ light, t0: x.t0, failed: x.failed, seeds: ns.length }); }
    }
    L.push(`R1 settle: ${res.map((x) => `${x.light} t0 ${x.t0}${x.failed ? " (FAILED, none by 400)" : ""} (${x.seeds} seeds)`).join("; ") || "no usable S1 runs"}`);
    // t0 is the larger of two lights over 4 seeds each; one light, or fewer seeds, is not a measurement.
    if (res.length === 2 && res.every((x) => x.seeds >= S_SEEDS.S1)) { t0 = Math.max(...res.map((x) => x.t0)); out.t0 = t0; measured.push("t0"); L.push(`t0 = ${t0} (the larger of the two lights)`); }
    else if (res.length) L.push(`t0 NOT measured: R1 needs both lights with ${S_SEEDS.S1} seeds each (have ${res.map((x) => `${x.light} ${x.seeds}`).join(", ")})`);
  } else L.push("R1: no S1 runs");
  // R2 on S2: share of laid cells at A >= 8 at step 10, median over seeds, per pattern and v.
  const s2 = rows.filter((r) => r.series === "S2");
  let v: number | null = null;
  if (s2.length) {
    const shares: Record<string, Record<number, number>> = {};
    for (const r of s2) {
      const m = /^(\w+)-v(\d+)$/.exec(r.armId);
      if (!m || !r.roadSeries) continue;
      const k = r.roadSeries.step.indexOf(10);
      if (k < 0 || r.roadSeries.cols.laidA8[k] === null) continue;
      (shares[m[1]] ??= {})[Number(m[2])] ??= NaN;
    }
    for (const p of Object.keys(shares)) for (const vv of Object.keys(shares[p]).map(Number)) {
      const xs = s2.filter((r) => r.armId === `${p}-v${vv}` && r.roadSeries && r.roadSeries.step.indexOf(10) >= 0).map((r) => r.roadSeries!.cols.laidA8[r.roadSeries!.step.indexOf(10)]).filter((x): x is number => x !== null);
      shares[p][vv] = med(xs) ?? NaN;
    }
    // v is the minimum over ALL five patterns (the carpet binds): every pattern at every value, each with at least 2 seeds read at step 10.
    const seedsAt = (p: string, vv: number) => s2.filter((r) => r.armId === `${p}-v${vv}` && r.roadSeries && r.roadSeries.step.indexOf(10) >= 0 && r.roadSeries.cols.laidA8[r.roadSeries.step.indexOf(10)] !== null).length;
    const lacking = PATTERNS.flatMap((p) => S2_VALUES.filter((vv) => seedsAt(p, vv) < S_SEEDS.S2).map((vv) => `${p}-v${vv}`));
    if (lacking.length) L.push(`R2 NOT applied: S2 is incomplete (need ${S_SEEDS.S2} seeds for every pattern at every v; short: ${lacking.slice(0, 8).join(", ")}${lacking.length > 8 ? ", ..." : ""}); v, g_R, t_alive and the diffA twin are not measured`);
    else {
    const cv = chooseV(shares);
    v = cv.v; out.v = v; out.gR = gRising(v); measured.push("v", "gR");
    L.push(`R2 laid cells at A >= 8 at step 10 (median over seeds): ${Object.entries(shares).map(([p, b]) => `${p} ${Object.entries(b).map(([vv, x]) => `v${vv} ${x.toFixed(2)}`).join(" ")}`).join("; ")}`);
    L.push(`v = ${v}${cv.fallback ? " (FALLBACK: no value passed for some pattern, desert share to be printed next to every PAY)" : ""}; per pattern ${JSON.stringify(cv.perPattern)}; g_R = ${gRising(v)}`);
    // R3 on rows at the chosen v.
    const rr = s2.filter((r) => r.armId === `rows-v${v}` && r.roadSeries);
    if (rr.length >= S_SEEDS.S2) {
      const steps = rr[0].roadSeries!.step;
      const xm = steps.map((st, k) => ({ step: st, xMed: med(rr.map((r) => r.roadSeries!.cols.xMed[k]).filter((x): x is number => x !== null)) ?? 0 }));
      const tAlive: Record<number, number> = {};
      const T0 = t0 ?? 400;
      for (const q of [1, 2, 3] as const) {
        const w = aliveAndWindow(xm, q, T0);
        tAlive[q] = w.tAlive ?? 0;
        L.push(`R3 q=${q}: t_alive ${w.tAlive ?? "none"}, PW ${w.pw ? `(${w.pw[0]},${w.pw[1]}]` : "none"}, length ${w.len}${w.unreadable ? ", UNREADABLE" : ""}`);
      }
      out.tAlive = tAlive; measured.push("tAlive");
      const w2 = aliveAndWindow(xm, 2, T0);
      if (w2.pw) {
        const dd = med(rr.map((r) => colWindow(r.roadSeries!, w2.pw![0], w2.pw![1]).meanDd2).filter((x): x is number => x !== null));
        if (dd !== null) { out.diffA = Math.max(0, Math.min(128, Math.round(dd))); measured.push("diffA"); L.push(`diffA-matched twin: mean over all directed edges and over PW of the plateau-P2 rate on the keyless prelaid road = ${dd.toFixed(2)} -> diffA ${out.diffA}`); }
      }
      L.push(`median laid-edge x_e by read: ${xm.map((x) => `${x.step}:${x.xMed}`).join(" ")}`);
    } else L.push(`R3: no rows-v${v} S2 runs with a road series`);
    }
  } else L.push("R2: no S2 runs");
  // R5 on S3: FREE-ONLY(16) and the treated T(16, mid) run, inherit.
  const f16 = rows.filter((r) => r.series === "S3" && r.armId === "free16" && r.heredity === "inherit");
  if (f16.length >= S_SEEDS.S3) {
    const p50 = med(f16.map((r) => r.late.conduit.pcP50).filter((x): x is number => x != null)), xm = med(f16.map((r) => r.late.boot.xMedOcc).filter((x): x is number => x != null));
    const F = freeCeiling(p50), fg = freeStrengths(xm);
    out.Fstar = F; out.Fg = { lo: fg.lo, mid: fg.mid, hi: fg.hi }; measured.push("Fstar", "Fg");
    L.push(`R5: FREE-ONLY(16) p50 trail per occupied cell ${p50 === null ? "-" : p50.toFixed(1)} -> F* = ${F}; median x_e between occupied cells ${xm === null ? "-" : xm.toFixed(1)} -> Fg lo/mid/hi ${fg.lo}/${fg.mid}/${fg.hi}${fg.noBiteLikely ? " (NO-BITE-LIKELY)" : ""}`);
  } else L.push(`R5: ${f16.length ? `only ${f16.length} S3 free16 runs (need ${S_SEEDS.S3}); not measured` : "no S3 free16 runs"}`);
  const t16 = rows.filter((r) => r.series === "S3" && r.armId === "T-16-mid" && r.heredity === "inherit");
  if (t16.length >= S_SEEDS.S3) {
    const me = med(t16.map((r) => r.late.boot.meanEdge).filter((x): x is number => x != null));
    if (me !== null) { out.diffAF = Math.max(0, Math.min(128, Math.round(me))); measured.push("diffAF"); L.push(`diffA matched to the treated F pilot's mean conduction over all directed edges: ${me.toFixed(2)} -> diffAF ${out.diffAF}`); }
  }
  // R6 on S4: the passive toll gid runs.
  const p4 = rows.filter((r) => r.series === "S4" && r.armId === "pass-toll-gid" && r.heredity === "inherit");
  if (p4.length >= S_SEEDS.S4) {
    const shares: Record<number, number> = {};
    for (const th of DEF_THETAS) { const m = med(p4.map((r) => r.late.boot[`def${th}`]).filter((x): x is number => x != null)); if (m !== null) shares[th] = m; }
    const r6 = thetaR6(shares);
    const owned = med(p4.map((r) => r.late.boot.ownedOccupied).filter((x): x is number => x != null));
    L.push(`R6: median defended-particle share by theta: ${Object.entries(shares).map(([k, v]) => `${k}:${v.toFixed(3)}`).join(" ")}; lo/mid/hi ${r6.lo ?? "-"}/${r6.mid ?? "-"}/${r6.hi ?? "-"} (${r6.distinct.length} distinct); owned share of occupied cells ${owned === null ? "-" : owned.toFixed(2)}`);
    if (r6.distinct.length) {
      const d = [...r6.distinct].sort((a, b) => a - b);
      out.theta = { lo: d[0], mid: d[Math.floor((d.length - 1) / 2)], hi: d[d.length - 1] }; measured.push("theta");
      if (d.length < 3) L.push(`fewer than three distinct theta values (${d.join(", ")}): the arms that exist run; lo/mid/hi collapse onto them`);
    }
    if (owned !== null && owned < 0.5) { out.ownerStopRule = true; L.push("STOP RULE (S0.4): under 50 percent of occupied cells owned in the toll substrate: O is INCOMPLETE (not run)"); }
  } else L.push(`R6: ${p4.length ? `only ${p4.length} S4 pass-toll-gid runs (need ${S_SEEDS.S4}); not measured` : "no S4 pass-toll-gid runs"}`);
  L.push(`measured: ${measured.join(", ") || "nothing"}. Not measurable here: gOwner, gCpub (owner-edge readouts, step 3c).`);
  return { lines: L, sizing: out };
}

// ---- owner addendum (docs/mycelium-bootstrap-owner-2026-11-15/DESIGN.md section 2): O1, O2, O3 from the S5 runs ---------------------

/** Seeds of each S5 arm. A rule is applied only when both arms are complete at their defined length and carry the late edge histograms. */
export const S5_SEEDS = 4;

export interface OwnerSizeResult { lines: string[]; sizing: Record<string, unknown> | null; measured: string[] }

/** A sizing run is territorial when at least this share of its directed edges (late window) joins two cells of one owner: the state the owner conduit has edges in. */
export const TERRITORY_MIN = 0.25;

export function sizeOwner(allRows: readonly RunFile[], sz: Sizing, series: "S5" | "S5L" = "S5L"): OwnerSizeResult {
  const L: string[] = [];
  const ok = (r: RunFile) => r.series === series && r.heredity === "inherit" && !r.smoke && r.steps === pilotSteps(r) && !!r.ownerHist && r.ownerHist.censuses > 0 && !r.ledgerBadChecks;
  const pass = allRows.filter((r) => ok(r) && r.armId === "pass").sort((a, b) => a.slot - b.slot), E = allRows.filter((r) => ok(r) && r.armId === "E").sort((a, b) => a.slot - b.slot);
  if (pass.length !== S5_SEEDS || E.length !== S5_SEEDS) return { lines: [`owner sizing: needs ${S5_SEEDS} finished ${series} runs per arm with edge histograms (pass ${pass.length}, E ${E.length}); nothing sized`], sizing: null, measured: [] };
  if (E.some((r) => r.config.ownerDefend !== sz.theta.mid)) return { lines: [`owner sizing: the ${series} E runs were not made at theta mid ${sz.theta.mid}; nothing sized`], sizing: null, measured: [] };
  const De = E[0].config.diffA;
  const xs = (rs: RunFile[]) => rs.map((r) => histMedian(r.ownerHist!.own));
  const same = (rs: RunFile[]) => rs.map((r) => r.ownerHist!.own.reduce((t, v) => t + v, 0) / r.ownerHist!.edges);
  const f2 = (v: number | null) => (v === null ? "-" : v.toFixed(3));
  // SIZING.md deviation 2: the gated world settles in one of two states. O1 and O3 read the territorial runs (same-owner share at least TERRITORY_MIN);
  // with fewer than two of them the rule falls back to every run, flagged.
  const terr = E.filter((r) => r.ownerHist!.own.reduce((t, v) => t + v, 0) / r.ownerHist!.edges >= TERRITORY_MIN);
  const fallback = terr.length < 2, Eu = fallback ? E : terr;
  const all1 = ownerGFromX(xs(E));
  const o1 = ownerGFromX(xs(Eu)), o2 = ownerGFromX(xs(pass));
  const g = ownerGStrengths(o1.g);
  L.push(`O1 (E worlds, theta ${sz.theta.mid}, pilot ${series}): per-run median same-owner x ${xs(E).join(", ")} (same-owner share of directed edges ${same(E).map(f2).join(", ")}); territorial runs ${terr.length} of ${E.length}${fallback ? " (fewer than 2: every run is used, FLAGGED)" : ""}`);
  L.push(`O1: median x over ${fallback ? "all" : "the territorial"} runs ${o1.x ?? "-"} -> gOwner lo/mid/hi ${g.lo}/${g.mid}/${g.hi}${o1.noBiteLikely ? " (NO-BITE-LIKELY: no same-owner edge)" : ""}; the median over every run (${all1.x ?? "-"}) would give ${all1.g}`);
  L.push(`O2 (passive worlds): per-run median same-owner x ${xs(pass).join(", ")} (same-owner share ${same(pass).map(f2).join(", ")}); median ${o2.x ?? "-"} -> gPassive ${o2.g}${o2.noBiteLikely ? " (NO-BITE-LIKELY)" : ""}`);
  const m = matchCpubFromHists(Eu.map((r) => r.ownerHist!), g.mid, De);
  L.push(`O3 (the same runs as O1): mean owner extra rate at g ${g.mid} per run ${Eu.map((r) => meanEffFromHist(r.ownerHist!.own, r.ownerHist!.edges, g.mid, De).toFixed(3)).join(", ")} (base diffA ${De} subtracted)`);
  L.push(`O3: median ratio public/owner by g': ${m.perG.map((p) => `${p.g}:${f2(p.ratio)}`).join(" ")} -> gCpub ${m.g} (ratio ${f2(m.ratio)})${m.void ? " VOID: no grid value within 10 percent; the C-pub control fails (g)" : ""}`);
  const xAtMed = o1.x === null ? null : Math.min(De + ((Math.round(o1.x) * g.mid) >> 4), 128) - De;
  L.push(`extra rate at the median x and gOwner.mid: ${xAtMed ?? "-"} of headroom ${128 - De} (band 9 to 53)`);
  return {
    lines: L, measured: ["gOwner", "gPassive", "gCpub"],
    sizing: { gOwner: g, gPassive: o2.g, gCpub: m.g, ...(m.void ? { cpubVoid: true } : {}), ownerSizing: { pilot: series, territorialRuns: terr.length, fallbackAllRuns: fallback, xAllRuns: all1.x, gAllRuns: all1.g, xE: o1.x, xPassive: o2.x, cpubRatio: m.ratio, noBiteLikely: o1.noBiteLikely, note: "docs/mycelium-bootstrap-owner-2026-11-15/DESIGN.md section 2" } },
  };
}
