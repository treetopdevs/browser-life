// Section 7 decision rules of the conduit screen (docs/mycelium-conduit-2026-11-14/DESIGN.md), kept free of GPU and Deno imports so the
// labels have unit tests (tools/test/mycelium-conduit-labels.test.ts). tools/mycelium/conduit-screen.ts re-exports everything here.

// deno-lint-ignore no-explicit-any
type Row = any;

export interface BranchSide { nStart: number[]; births: number; deaths: number; intake: number; ledgerBad: number; first: { births: number; deaths: number; intake: number; n: number }; nEnd: number }
export interface Branch { steps: number; on: BranchSide; off: BranchSide }

/** Branch deltas, per particle-step: births and intake, on minus off (the conduit's effect over the 200 steps). */
export function branchRates(b: Branch | null): { bOn: number; bOff: number; iOn: number; iOff: number; rel: number | null } | null {
  if (!b) return null;
  const den = (s: BranchSide) => s.nStart.reduce((t, x) => t + x, 0);
  const bOn = b.on.births / Math.max(1, den(b.on)), bOff = b.off.births / Math.max(1, den(b.off));
  return { bOn, bOff, iOn: b.on.intake / Math.max(1, den(b.on)), iOff: b.off.intake / Math.max(1, den(b.off)), rel: bOn > 0 ? (bOn - bOff) / bOn : null };
}

/** Per-seed predicates of DESIGN.md section 7 for an inherit run, paired with its blocked run (same slot) and the physarum anchor's acute. */
export function seedPredicates(inh: Row, blk: Row | undefined, anchorAcute: number | null) {
  const K = (inh.late.runValues.TM ?? 0) >= 0.1;
  const br = branchRates(inh.branch);
  const a = !!br && br.bOn > 0 && br.rel !== null && br.rel >= 0.05 && !inh.branch.on.ledgerBad && !inh.branch.off.ledgerBad && inh.branch.on.nEnd > 0 && inh.branch.off.nEnd > 0;
  // (b): both groups present in at least half of the late-window heavy censuses, and the window means ordered.
  const cs = inh.conduitSeries, late = cs.step.map((s: number, i: number) => (s > inh.steps / 2 ? i : -1)).filter((i: number) => i >= 0);
  const both = late.filter((i: number) => cs.cols.impLayer[i] !== null && cs.cols.impNon[i] !== null).length;
  const cl = inh.late.conduit;
  const b = late.length > 0 && both * 2 >= late.length && cl.impLayer !== null && cl.impNon !== null && cl.impLayer > 0 && cl.impLayer > cl.impNon;
  const bl = blk?.late;
  const hi = (inh.late.conduit.occx - inh.late.conduit.occxShift) - (bl ? bl.conduit.occx - bl.conduit.occxShift : 0) > 0.25;
  // A missing measurement fails (DESIGN section 7), on either side: a blocked partner without the readout is not a zero (fixed 15 Nov 2026,
  // after the screen; the recorded labels are unchanged because every strength was PURGED on K alone).
  const sensOk = (x: number | null, y: number | null | undefined) => x !== null && y !== null && y !== undefined && x >= 0.005 && x >= 2 * y;
  const hii = bl ? sensOk(cl.sensLevel, bl.conduit.sensLevel) || sensOk(cl.sensNut, bl.conduit.sensNut) : false;
  const hiii = bl && anchorAcute !== null ? inh.late.r4.acute - bl.r4.acute > anchorAcute / 2 : false;
  const H = !!bl && (hi || hii || hiii);
  const G = !!bl && inh.late.r4.speed >= 0.05 && inh.late.r4.speed >= 0.5 * bl.r4.speed;
  const d = cl.csat !== null && cl.csatCap !== null && cl.csat <= 0.5 && cl.csatCap <= 0.5;
  return { K, a, b, d, H, G, c: H && G, hCases: { occx: hi, sens: hii, acute: hiii } };
}

/** Counts for one strength's inherit cohort (DESIGN.md section 7); the counts a..d and nHnoG are over the kept seeds. */
export interface StrengthCounts { complete: boolean; nTot: number; nK: number; na: number; nb: number; nc: number; nd: number; nHnoG: number; e: boolean; fOk: boolean }

/** The section 7 label for one strength, in the order the rules are applied: incomplete, purged, tie, used, sponge, presence only. */
export function strengthLabel(c: StrengthCounts): string {
  const { complete, nTot, nK, na, nb, nc, nd, nHnoG, e, fOk } = c;
  const need = Math.ceil(0.75 * nTot);
  if (!complete) return "INCOMPLETE (no label: cohort or controls missing)";
  if (nK <= Math.floor(nTot / 4)) return "PURGED";
  if (nK * 2 === nTot) return "INCONCLUSIVE (extend to 8 seeds)";
  if (na >= need && nb >= need && nc >= need && nd >= need && e && fOk) return "KEPT-AND-USED";
  if (na >= need && nb >= need && nd >= need && e && fOk && nHnoG >= need) return "KEPT-STATIC-SPONGE";
  const why = [na < need && "(a)", nb < need && "(b)", nc < need && "(c)", nd < need && "(d)", !e && "(e)", !fOk && "(f)"].filter(Boolean).join(", ");
  return `KEPT-BY-PRESENCE-ONLY (failing: ${why})`;
}

/** Condition (e), the dose order over strengths, from the median late TM of each strength's inherit runs (c128 is the post hoc form). */
export function doseOrdered(s: string, m: (strength: string) => number): boolean {
  return s === "c2" ? true : s === "c8" ? m("c8") >= m("c2") : s === "c32" ? m("c32") >= 0.8 * m("c8") : m("c128") >= 0.8 * m("c32");
}

/** Condition (f): uniform diffusion alone keeps trail in at most one seed at every bracket value. */
export function diffusionControlHolds(control: { kept: number }[]): boolean {
  return control.every((c) => c.kept <= 1);
}
