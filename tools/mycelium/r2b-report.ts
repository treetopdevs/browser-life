// Mycelium rung R2b: plain-text reports of the calibration and the confirmation (PROTOCOL.md section 9). Pure string builders, so vitest
// can import them; tools/mycelium/r2b-analyze.ts prints and writes what they return.
import { type Calibration, type Decision, type HalfValues, type MatchingRecord, regimeFisher } from "./r2b-decide.ts";
import { type AnyArm, R2B, READOUT_IDS, type ReadoutId } from "./r2b-protocol.ts";
import type { RunValues } from "./observe-r2b.ts";

const f = (v: number | null | undefined, d = 4): string => (v === null || v === undefined || !Number.isFinite(v) ? "-" : Math.abs(v) >= 1000 ? v.toFixed(0) : v.toPrecision(d));
const pf = (v: number | null): string => (v === null ? "-" : v < 0.0001 ? v.toExponential(1) : v.toFixed(4));

function valueTable(values: Record<string, Record<number, RunValues>>, arms: readonly string[], ids: readonly ReadoutId[]): string[] {
  const out: string[] = [];
  for (const arm of arms) {
    if (!values[arm]) continue;
    out.push(`\n${arm} (per seed: n and sum P are window means, descriptive)`);
    out.push(["seed", ...ids, "n", "sumP", "d", "births", "refused", "minN", "MIinval", "meanM", "meanE", "genos", "guard"].map((h) => h.padStart(9)).join(" "));
    for (const s of Object.keys(values[arm]).map(Number).sort((a, b) => a - b)) {
      const v = values[arm][s];
      out.push([String(s), ...ids.map((id) => f(v[id], 4)), f(v.meanN, 5), f(v.meanSumP, 5), f(v.d, 3), String(v.births), String(v.refusedInW), f(v.minN, 4), f(v.moranInvalidFraction, 2), f(v.meanM, 4), f(v.meanE, 4), f(v.genotypes, 4), v.guardTripped ? "TRIPPED" : v.capTouched ? "cap" : "ok"].map((x) => x.padStart(9)).join(" "));
    }
  }
  return out;
}

/** The per-seed first-half (50k, 75k] and second-half (75k, 100k] value of every readout the agreement summarises (inherit seeds). */
function halfTable(h: HalfValues): string[] {
  const out: string[] = ["\nPer-seed half-window values, inherit (first half (50k, 75k] / second half (75k, 100k]); the Spearman above summarises these:"];
  for (const id of READOUT_IDS) out.push(`  ${id.padEnd(5)} ${(h[id] ?? []).map((x) => `${x.seed}: ${f(x.first, 3)} / ${f(x.second, 3)}`).join("  ")}`);
  return out;
}

export function calibrationReport(c: Calibration, matching: MatchingRecord | null): string {
  const L: string[] = [];
  L.push(`R2b calibration: plan ${c.plan}, dev seeds ${c.devSeeds[0]}-${c.devSeeds.at(-1)} (${c.devSeeds.length}), verdict ${c.verdict}`);
  for (const r of c.reasons) L.push(`  reason: ${r}`);
  const cl = c.regime.classifier;
  L.push(`\nRegime classifier (dev inherit): cut ${f(cl.cut)} (log10 TM + 0.01), tau ${f(cl.tau)}, classes ${cl.nLow} low / ${cl.nHigh} high, between-class share ${f(cl.share, 3)}, gap ${f(cl.gap, 3)} against within-class SD ${f(cl.withinSd, 3)}, ${cl.adequate ? "adequate" : "NOT adequate: REG is dropped and the trail-on fallback is not used"}`);
  L.push(`  log10 values: ${cl.x.map((v) => f(v, 3)).join(" ")}`);
  const fa = c.regime.fisherByArm;
  if (fa.inherit) for (const arm of Object.keys(fa).filter((a) => a !== "inherit")) L.push(`  regime proportion (REG >= 0.5) inherit ${fa.inherit.on}/${fa.inherit.on + fa.inherit.off} vs ${arm} ${fa[arm].on}/${fa[arm].on + fa[arm].off}: Fisher p ${pf(regimeFisher(fa.inherit, fa[arm]))} (description only)`);
  L.push(`\nDeposit target: T ${f(c.target.T)} (${c.target.source}; median over all dev inherit seeds ${f(c.target.medianAll)})${c.target.reason ? `; ${c.target.reason}` : ""}`);
  if (c.target.source === "trail-on") L.push(`  FALLBACK: the null is matched to the trail-on seeds, so it deposits ${f(c.physarum.targetToAll, 3)} times the median over all dev inherit seeds (TM, MI and REG then differ from it partly by construction for the trail-off seeds)`);
  L.push(`Physarum at the protocol length (dev, W): median d ${f(c.physarum.devD)}, ${f(c.physarum.devRatio, 3)} times T (gate: within ${R2B.MATCH_GATE * 100}%)`);
  if (matching) {
    L.push(`Matching: v0 ${matching.v0}, accepted v ${matching.v}, converged ${matching.converged}, achieved d_phys/T ${f(matching.ratio)}${matching.limited ? ", LIMITED" : ""}`);
    for (const r of matching.rounds) L.push(`  round ${r.round}: v ${r.v}, d_phys ${f(r.dPhys)}, per seed ${r.perSeed.map((x) => f(x, 3)).join(" ")}`);
  }
  L.push("\nPositive controls against inherit (control vs inherit, ONE Holm over every usable control x readout test, alpha 0.05, |delta| >= 0.33):");
  for (const k of c.controls) {
    L.push(`  ${k.control}: ${k.usable ? "usable" : `UNUSABLE (guard ${k.guardTripped.join(", ")})`}${k.capTouched ? ", touches the cap" : ""}`);
    for (const t of k.tests) L.push(`    ${t.readout.padEnd(5)} ${t.dropped ? `dropped: ${t.dropped}` : `p ${pf(t.p)} adj ${pf(t.adjusted)} delta ${f(t.delta, 3)} (${t.method}) ${t.separated ? "SEPARATES" : ""}`}`);
  }
  L.push(`\nKept readouts: ${c.kept.length ? c.kept.join(", ") : "none"} (a PASS needs TM or REG, and MI)`);
  L.push(`  MI: measurable (every heavy census of the window valid) in ${c.miMeasurable} of ${c.devSeeds.length} dev inherit seeds (need ${R2B.MI_MIN_SEEDS}); median invalid-census fraction ${f(c.miInvalidMedian, 3)}`);
  for (const [id, why] of Object.entries(c.dropped)) L.push(`  dropped ${id}: ${why}`);
  L.push("\nDev contrasts (informational; inherit vs other, effect sizes with 95% bootstrap intervals):");
  for (const d of c.devContrasts) L.push(`  vs ${d.vs.padEnd(8)} ${d.readout.padEnd(5)} p ${pf(d.p)} delta ${f(d.delta, 3)} [${f(d.deltaCI[0], 3)}, ${f(d.deltaCI[1], 3)}] HL ${f(d.hl)} [${f(d.hlCI[0])}, ${f(d.hlCI[1])}]`);
  L.push("\nHorizon diagnostic (reported, gates nothing): Spearman between first-half and second-half window values across the inherit seeds");
  for (const id of READOUT_IDS) L.push(`  ${id.padEnd(5)} ${f(c.halfAgreement[id], 3)}`);
  L.push(...halfTable(c.halfValues));
  L.push("\nHalf-window drift (second half against first, relative to the window mean) of TM, n and sum P, per seed:");
  for (const arm of Object.keys(c.drift)) {
    L.push(`  ${arm}`);
    for (const s of Object.keys(c.drift[arm]).map(Number).sort((a, b) => a - b)) { const d = c.drift[arm][s]; L.push(`    ${s}: TM ${f(d.TM, 3)} n ${f(d.n, 3)} sumP ${f(d.sumP, 3)}`); }
  }
  L.push(...valueTable(c.values, ["inherit", "blocked", "physarum", "pc-light", "pc-upkeep", "pc-blind"] as AnyArm[], READOUT_IDS));
  return L.join("\n") + "\n";
}

export function confirmReport(d: Decision, cal: { plan?: string; tau: number | null; v: number | null }, seeds: readonly number[]): string {
  const L: string[] = [];
  L.push(`R2b confirmation: ${seeds.length} seeds per arm (${seeds[0]}-${seeds.at(-1)}), physarumDeposit v ${cal.v}, tau ${f(cal.tau)}`);
  L.push(`LABEL: ${d.label}${d.subcases.length ? ` (sub-case ${d.subcases.join(", ")})` : ""}${d.label === "PASS" ? ` (pair ${d.pair.join(" + ")})` : ""}`);
  for (const r of d.reasons) L.push(`  reason: ${r}`);
  L.push(`Kept readouts: ${d.kept.join(", ") || "none"}`);
  const nd = d.nullDeposit;
  L.push(`The matched null: target T ${f(nd.T)}${nd.fallback ? " (trail-on FALLBACK: the null deposits more than a typical inherit seed)" : ""}; confirmation window: physarum median d ${f(nd.physarumD)} = ${f(nd.ratio, 3)} x T, inherit median d ${f(nd.inheritD)}`);
  L.push(`MI: seeds with a measurable MI per arm ${Object.entries(d.miSeeds).map(([a, v]) => `${a} ${v}`).join(", ")} (need ${R2B.MI_MIN_SEEDS}); invalid-census fraction (median seed) ${Object.entries(d.miInvalid).map(([a, v]) => `${a} ${f(v, 3)}`).join(", ")}`);
  L.push("\nIntersection family (the decision): per readout p = max(p vs blocked, p vs physarum), one Holm over the readouts eligible for both contrasts");
  for (const t of d.intersection) L.push(`  ${t.readout.padEnd(5)} p ${pf(t.p)} (blocked ${pf(t.pBlocked)}, physarum ${pf(t.pPhysarum)}) adj ${pf(t.adjusted)} ${t.separates ? "SEPARATES FROM BOTH" : ""}`);
  for (const vs of ["blocked", "physarum"] as const) {
    L.push(`\ninherit vs ${vs} (Holm within this contrast, descriptive; separating readouts: ${(vs === "blocked" ? d.sepBlocked : d.sepPhysarum).join(", ") || "none"})`);
    for (const t of d.tests[vs]) L.push(`  ${t.readout.padEnd(5)} p ${pf(t.p)} adj ${pf(t.adjusted)} (${t.method}) delta ${f(t.delta, 3)} [${f(t.deltaCI[0], 3)}, ${f(t.deltaCI[1], 3)}] HL ${f(t.hl)} [${f(t.hlCI[0])}, ${f(t.hlCI[1])}] ${t.separates ? "SEPARATES" : ""}${t.exposed ? " (exposed)" : ""}`);
    L.push(`  ratios inherit/${vs}: ${d.ratios[vs].map((r) => `${r.measure} ${f(r.ratio, 3)}${r.flagged ? " FLAG" : ""}`).join(", ")}`);
  }
  L.push(`\nBoth: ${d.both.join(", ") || "none"}`);
  for (const [id, o] of Object.entries(d.ordering)) L.push(`  ${id}: inherit is ${o} the two other arms`);
  L.push("\nCorrelations between kept readouts (Spearman: pooled confirmation values, then within each arm; flagged when any is above 0.8 in absolute value, nothing is changed by it):");
  for (const c of d.correlations) L.push(`  ${c.a}-${c.b}: pooled ${f(c.rho, 3)}; within ${Object.entries(c.within).map(([a, v]) => `${a} ${f(v, 3)}`).join(", ")}${c.flagged ? " FLAG" : ""}`);
  L.push("\nHorizon diagnostic: Spearman between first-half and second-half window values across the inherit seeds");
  for (const id of READOUT_IDS) L.push(`  ${id.padEnd(5)} ${f(d.halfAgreement[id], 3)}`);
  L.push(...halfTable(d.halfValues));
  if (Object.keys(d.regime).length) {
    L.push("\nRegime proportion (REG >= 0.5), exact Fisher test of inherit against each other arm (description only):");
    for (const arm of Object.keys(d.regime)) L.push(`  ${arm}: ${d.regime[arm].on}/${d.regime[arm].on + d.regime[arm].off}${arm in d.regimeFisher ? `, Fisher p ${pf(d.regimeFisher[arm])}` : ""}`);
  }
  L.push("\nHalf-window drift (second half against first, relative to the window mean) of TM, n and sum P, per seed:");
  for (const arm of Object.keys(d.drift)) {
    L.push(`  ${arm}`);
    for (const s of Object.keys(d.drift[arm]).map(Number).sort((a, b) => a - b)) { const x = d.drift[arm][s]; L.push(`    ${s}: TM ${f(x.TM, 3)} n ${f(x.n, 3)} sumP ${f(x.sumP, 3)}`); }
  }
  L.push(...valueTable(d.values, ["inherit", "blocked", "physarum"], READOUT_IDS));
  return L.join("\n") + "\n";
}
