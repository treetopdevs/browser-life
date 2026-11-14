// Applies the M4b rule (m4b-rule.ts; docs/3d-rung1b-plan-2026-10-23.md, amendment of 2026-10-24) to the results of
// m4b-calibrate.ts: a table of every setting and a final line that is one of PICK, NEEDS NEUTRAL (with the exact
// command to run), NOT FINAL (grid incomplete), BLOCKED (a result that is not a valid result of its job), NONE
// QUALIFIES or NEUTRAL STAGE FAILED. Exit 0 for PICK, NONE QUALIFIES and NEUTRAL STAGE FAILED (final); 3 otherwise.
// Run: deno run -A --no-lock experiments/3d-slab/m4b-pick.ts [--out=runs/m4b-calibration] [--steps=<n>, smoke tests only]
import { decide, settingKey, STEPS, type Row } from "./m4b-rule.ts";

const arg = (k: string) => Deno.args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const OUT = arg("out") ?? "runs/m4b-calibration";
const steps = Number(arg("steps") ?? STEPS);
const files = new Map<string, unknown>();
for (const e of Deno.readDirSync(OUT)) {
  if (!e.name.endsWith(".json")) continue;
  const id = e.name.slice(0, -5);
  try { files.set(id, JSON.parse(Deno.readTextFileSync(`${OUT}/${e.name}`))); } catch (err) { files.set(id, `unparseable: ${err}`); }
}
const { decision, rows, qualifying } = decide(files, steps);
if (steps !== STEPS) console.log(`(smoke run: --steps=${steps}, not the fixed protocol's ${STEPS})`);
const pct = (n: number) => (100 * n / 524288).toFixed(1);
const cell = (r: Row, f: (i: number) => string) => r.seeds.map((_, i) => f(i)).join(" / ");
console.log(`results: ${files.size} files, ${rows.length} of 80 settings complete, ${qualifying.length} qualify`);
console.log("| N | mu | sigma | lightK | living % at 50k | light 7/0 | window / settled / ends (per seed) | qualifies |\n|---|---|---|---|---|---|---|---|");
for (const r of rows) {
  console.log(`| ${r.nutrient} | ${r.mu} | ${r.sigma} | ${r.lightK} | ${cell(r, (i) => r.seeds[i].extinctAt ? `0 (extinct @${r.seeds[i].extinctAt})` : pct(r.seeds[i].living))} | ${cell(r, (i) => r.seeds[i].lightLayerSum[0] ? (r.seeds[i].lightLayerSum[7] / r.seeds[i].lightLayerSum[0]).toFixed(3) : "-")} | ${cell(r, (i) => [r.verdicts[i].window, r.verdicts[i].settled, r.verdicts[i].ends].map((b) => (b ? "y" : "n")).join(""))} | ${r.qualifies ? "yes" : "no"} |`);
}
if (qualifying.length) console.log(`\nqualifying, in pick order: ${qualifying.map((r) => `${settingKey(r)} (median living ${r.medianLiving})`).join("; ")}`);
switch (decision.status) {
  case "blocked": console.log(`\nBLOCKED: ${decision.errors.length} problem(s); fix the cause and rerun the job:\n  ${decision.errors.join("\n  ")}`); Deno.exit(3); break;
  case "incomplete": console.log(`\nNOT FINAL: ${decision.missing.length} evolving runs missing`); Deno.exit(3); break;
  case "needs-neutral":
    console.log(`\nNEEDS NEUTRAL: ${settingKey(decision.candidate)}; run\n  deno run -A --no-lock experiments/3d-slab/m4b-calibrate.ts --out=${OUT} --condition=neutral --jobs=${decision.jobs.join(",")}`);
    Deno.exit(3); break;
  case "pick": console.log(`\nPICK: ${settingKey(decision.pick)} (nutrient ${decision.pick.nutrient}, mu ${decision.pick.mu}, sigma ${decision.pick.sigma}, lightK ${decision.pick.lightK}); neutral stage tried ${decision.tried.map(settingKey).join(", ")}`); break;
  case "none-qualifies": console.log("\nNONE QUALIFIES: stop and write it up (amendment of 2026-10-24)"); break;
  case "neutral-failed": console.log(`\nNEUTRAL STAGE FAILED: ${decision.tried.map(settingKey).join(", ")} each had a neutral seed below 1 % living or with an empty end; stop and write it up`); break;
}
