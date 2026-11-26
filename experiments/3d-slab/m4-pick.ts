// Applies the M4 pick rule (docs/3d-rung1b-plan-2026-10-23.md §6) to the results of m4-calibrate.ts.
// Run: deno run -A --no-lock experiments/3d-slab/m4-pick.ts --out=<dir>
const OUT = Deno.args.find((a) => a.startsWith("--out="))?.slice(6) ?? "runs/m4-calibration";
type R = { mu: number; sigma: number; lightK: number; seed: number; livingFrac: number; living: number; lightRatio: number | null; extinctAt: number | null };
const rs: R[] = [];
for (const e of Deno.readDirSync(OUT)) if (e.name.endsWith(".json")) rs.push(JSON.parse(Deno.readTextFileSync(`${OUT}/${e.name}`)));
const groups = new Map<string, R[]>();
for (const r of rs) { const k = `${r.mu}/${r.sigma}/${r.lightK}`; groups.set(k, [...(groups.get(k) ?? []), r]); }
const rows = [...groups.values()].map((g) => {
  const { mu, sigma, lightK } = g[0];
  const complete = g.length === 3;
  const ok = (r: R) => r.livingFrac >= 0.01 && r.livingFrac <= 0.5 && r.lightRatio !== null && r.lightRatio >= 0.05 && r.lightRatio <= 0.8;
  const liv = g.map((r) => r.living).sort((a, b) => a - b);
  return { mu, sigma, lightK, complete, qualifies: complete && g.every(ok), medianLiving: complete ? liv[1] : null, seeds: g.sort((a, b) => a.seed - b.seed) };
});
rows.sort((a, b) => b.lightK - a.lightK || b.sigma - a.sigma || a.mu - b.mu);
console.log(`results: ${rs.length} of 180 runs, ${rows.filter((r) => r.complete).length} of 60 settings complete`);
console.log("| mu | sigma | lightK | living % (seeds 101/102/103) | light 7/0 (seeds) | qualifies |\n|---|---|---|---|---|---|");
for (const r of rows) console.log(`| ${r.mu} | ${r.sigma} | ${r.lightK} | ${r.seeds.map((s) => s.extinctAt ? `0 (extinct @${s.extinctAt})` : (100 * s.livingFrac).toFixed(1)).join(" / ")} | ${r.seeds.map((s) => s.lightRatio?.toFixed(3) ?? "-").join(" / ")} | ${r.complete ? (r.qualifies ? "yes" : "no") : "incomplete"} |`);
const q = rows.filter((r) => r.qualifies).sort((a, b) => b.medianLiving! - a.medianLiving! || b.lightK - a.lightK || b.sigma - a.sigma || a.mu - b.mu);
if (rows.filter((r) => r.complete).length < 60) console.log("\nPICK: not final (grid incomplete)");
else if (!q.length) console.log("\nPICK: none qualifies -> stop and write it up (plan §6 M4)");
else console.log(`\nPICK: mu ${q[0].mu}, sigma ${q[0].sigma}, lightK ${q[0].lightK} (median living ${q[0].medianLiving}); ${q.length} settings qualified`);
