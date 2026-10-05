// Exploratory secondary readouts over the imported renewal-v1 evidence (PRD
// S3): threshold sensitivity of the primary endpoint and the dependence of
// late-window synthesis on stored and imported free energy. EXPLORATORY: these
// were computed after the renewal outcome was known; they never replace or
// rescue the primary endpoint, and nothing here decides anything.
//
//   deno run -A tools/discovery-renewal-secondary.ts --imported <runs/discovery/renewal-v1-imported> --renewal-root <construction runs/construction/renewal-v1>
//
// It reuses the pinned production readout (pure, no imports) with other
// thresholds, and reads the per-site accounting the renewal observer saved.
import { join } from "node:path";
import { readCase, type CensusLine, type Thresholds } from "../vendor/construction-renewal-v1/tools/lib/construction-renewal-readout.ts";
import { canonicalJSON } from "@bl/schema";
import { verifyImport } from "./lib/discovery-import.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
const arg = (k: string) => {
  const i = Deno.args.indexOf(k);
  if (i < 0) throw new Error(`missing ${k}`);
  return Deno.args[i + 1];
};
const importedDir = arg("--imported"), renewalRoot = arg("--renewal-root");
const rec = JSON.parse(await Deno.readTextFile(join(importedDir, "imported.json")));
const errs = await verifyImport(rec, renewalRoot);
if (errs.length) throw new Error(`the imported evidence does not validate: ${errs.join("; ")}`);
const protocol = JSON.parse(await Deno.readTextFile(join(renewalRoot, "source", "experiments/construction/renewal-v1/protocol.json")));
const base: Thresholds = { ...protocol.endpoints, censusEvery: protocol.censusEvery };

const V = [32, 64, 96, 128, 192], QMIN = [32, 128, 512], RMIN = [0, -64];
const main = rec.cases.filter((c: Any) => c.kind === "main");
const grid: Any[] = [];
const energy: Any[] = [];
for (const c of main) {
  const lines: Any[] = (await Deno.readTextFile(join(renewalRoot, "cases", c.id, `attempt-${c.attempt}`, "census.jsonl"))).trimEnd().split("\n").map((l) => JSON.parse(l));
  const info = { id: c.id, phase: c.phase, kind: "main" as const, arm: c.arm, seed: c.seed, reservoir: c.reservoir, spread: c.spread, horizon: c.horizon, sourceSites: [16 * 32 + 16] };
  for (const v of V) for (const q of QMIN) for (const r of RMIN) {
    const ro = readCase(info, lines as CensusLine[], { ...base, V: v, Qmin: q, Rmin: r }, "0");
    grid.push({ case: c.id, V: v, Qmin: q, Rmin: r, status: ro.status, renew: ro.status === "complete" ? ro.renew : null, qualifying: ro.status === "complete" ? ro.qualifyingSites!.length : null });
  }
  // Late-window free-energy accounting at every site active in the window (Q > 0).
  const a = lines.find((l) => l.step === 9000), b = lines.find((l) => l.step === 10000);
  const d = (k: string, i: number) => b.cumulative[k][i] - a.cumulative[k][i];
  let photo = 0, grow = 0, resp = 0, decomp = 0, eDrop = 0, eImport = 0, sites = 0;
  for (let i = 0; i < b.cells.B.length; i++) {
    if (d("photo", i) + d("grow", i) === 0) continue;
    sites++;
    photo += d("photo", i);
    grow += d("grow", i);
    resp += d("resp", i);
    decomp += d("decomp", i);
    eDrop += a.cells.E[i] - b.cells.E[i];
    eImport += d("boundEIn", i) - d("boundEOut", i);
  }
  energy.push({ case: c.id, activeSites: sites, photo, grow, growPerMilleOfSynthesis: photo + grow ? Math.round((1000 * grow) / (photo + grow)) : null, tenGrow: 10 * grow, fundedBy: { storedEDrop: eDrop, netBoundEImport: eImport, respiration8: 8 * resp, decomposition2: 2 * decomp } });
}
const summary = V.flatMap((v) => QMIN.flatMap((q) => RMIN.map((r) => {
  const rows = grid.filter((g) => g.V === v && g.Qmin === q && g.Rmin === r);
  return { V: v, Qmin: q, Rmin: r, renewCases: rows.filter((g) => g.renew).map((g) => g.case), incomplete: rows.filter((g) => g.status !== "complete").length };
})));
const out = {
  status: "EXPLORATORY: computed after the renewal outcome was known; never replaces or rescues the primary endpoint (V 128, Qmin 128, R >= 0)",
  importDigest: rec.importDigest,
  thresholdSensitivity: summary,
  freeEnergyDependence: energy,
};
await Deno.writeTextFile(join(importedDir, "secondary-exploratory.json"), canonicalJSON(out) + "\n");
const md = [
  "# Renewal v1, exploratory secondary readouts",
  "",
  `${out.status}. Import \`${rec.importDigest}\`.`,
  "",
  "## Threshold sensitivity (24 main pilot cases)",
  "",
  "| V | Qmin | Rmin | Cases with RENEW true |",
  "|---:|---:|---:|---|",
  ...summary.map((s) => `| ${s.V} | ${s.Qmin} | ${s.Rmin} | ${s.renewCases.length ? s.renewCases.join(", ") : "none"}${s.incomplete ? ` (${s.incomplete} incomplete)` : ""} |`),
  "",
  "## Free-energy dependence of late-window synthesis (steps 9000-10000, sites with any synthesis)",
  "",
  "| Case | Active sites | PHOTO | GROW | GROW ‰ of synthesis | 10·GROW | Stored E drop | Net bound E import | 8·RESP | 2·DECOMP |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ...energy.map((e) => `| ${e.case} | ${e.activeSites} | ${e.photo} | ${e.grow} | ${e.growPerMilleOfSynthesis ?? ""} | ${e.tenGrow} | ${e.fundedBy.storedEDrop} | ${e.fundedBy.netBoundEImport} | ${e.fundedBy.respiration8} | ${e.fundedBy.decomposition2} |`),
  "",
  "What is measured, and what is not: the PHOTO and GROW counts and the free-energy terms above. GROW is paid from free energy, and the integrated inequality 10·ΣGROW <= stored-E drop + net E import + 8·ΣRESP + 2·ΣDECOMP holds per site (renewal observer tests), so these columns bound the free energy available to GROW. They do not attribute the chemical energy behind RESP or DECOMP to light, imports or stored matter: energy-origin attribution is untested here (DESIGN, fixed-energy-budget rule).",
  "",
].join("\n");
await Deno.writeTextFile(join(importedDir, "SECONDARY-EXPLORATORY.md"), md);
console.log(md.split("\n").slice(0, 40).join("\n"));
