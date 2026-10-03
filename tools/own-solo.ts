// Sandbox read of existing single-founder histories (docs/sandbox-ownership.md; exploratory).
// For each bundle written with --lineage-obs (genomes.tsv), takes the most numerous lineages at the
// last census, assays them with test 5's lesion battery (tools/assay.ts retest) and tabulates
// regeneration by founder. No evolution runs; bundles are only read.
//
//   deno run -A tools/own-solo.ts --src /abs/runs/solo/gradient-m3/treatment --out runs/ownership/solo-existing [--top 4] [--reps 16]
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { M3_FOUNDERS } from "@bl/schema";

const a = parseArgs(Deno.args, { string: ["src", "out", "top", "reps"], default: { top: "4", reps: "16" } });
const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const SRC = a.src ?? (() => { throw new Error("--src DIR required"); })();
const OUT = (a.out ?? (() => { throw new Error("--out DIR required"); })()).replace(/^(?!\/)/, `${ROOT}/`);
const exists = (p: string) => Deno.stat(p).then(() => true, () => false);
const f3 = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : "-");

const dirs: string[] = [];
for await (const e of Deno.readDir(SRC)) if (e.isDirectory && /^seed-\d+$/.test(e.name)) dirs.push(e.name);
dirs.sort((x, y) => Number(x.slice(5)) - Number(y.slice(5)));
const rows: Record<string, string | number>[] = [];
const perFounder = new Map<number, number>();
for (const d of dirs) {
  const dir = `${SRC}/${d}`;
  const manifest = JSON.parse(await Deno.readTextFile(`${dir}/manifest.json`));
  const founder = manifest.spec?.soloFounder;
  if (founder === undefined || !manifest.summary || !(await exists(`${dir}/genomes.tsv`))) continue;
  const idx = perFounder.get(founder) ?? 0;
  perFounder.set(founder, idx + 1);
  // Last census of lineages.tsv.
  const lin = (await Deno.readTextFile(`${dir}/lineages.tsv`)).trimEnd().split("\n");
  const lastStep = lin.at(-1)!.split("\t")[0];
  const census: [string, number][] = [];
  for (let i = lin.length - 1; i > 0 && lin[i].startsWith(lastStep + "\t"); i--) { const f = lin[i].split("\t"); census.push([f[1], Number(f[2])]); }
  census.sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
  const cells = census.reduce((s, c) => s + c[1], 0);
  const picks = census.filter((c) => c[1] >= 16).slice(0, Number(a.top));
  const hex = new Map<string, string>();
  const want = new Set(picks.map((p) => p[0]));
  for (const l of (await Deno.readTextFile(`${dir}/genomes.tsv`)).split("\n")) { const f = l.split("\t"); if (want.has(f[0])) hex.set(f[0], f[2]); }
  // Mutation depth of the dominant lineage.
  const parent = new Map<string, string>();
  for (const l of (await Deno.readTextFile(`${dir}/mutations.tsv`)).split("\n").slice(1)) { if (!l) continue; const f = l.split("\t"); const c = `${f[0]}:${f[1]}`; if (!parent.has(c)) parent.set(c, `${f[2]}:${f[3]}`); }
  let depth = 0;
  for (let k: string | undefined = picks[0]?.[0]; k !== undefined && parent.has(k); k = parent.get(k)) depth++;
  const out = `${OUT}/assays/f${founder}-s${idx}`;
  let regen = 0, surv = 0, reps = 0;
  const genomes = picks.filter((p) => hex.has(p[0])).map((p, r) => ({ label: `r${r}-${p[0]}`, hex: hex.get(p[0])!, cells: p[1] }));
  if (genomes.length) {
    if (!(await exists(`${out}/r0.json`))) {
      await Deno.mkdir(out, { recursive: true });
      await Deno.writeTextFile(`${out}/plan.json`, JSON.stringify({ seed0: 4_950_001 + founder * 100 + idx * 10, reps: Number(a.reps), genomes }));
      const r = await new Deno.Command(Deno.execPath(), { args: ["run", "-A", "tools/assay.ts", "retest", "--out", out, "--plan", `${out}/plan.json`], cwd: ROOT, stdout: "piped", stderr: "piped" }).output();
      if (!r.success) { console.error(new TextDecoder().decode(r.stderr).split("\n").slice(-10).join("\n")); throw new Error(`assay failed for ${d}`); }
    }
    for await (const f of Deno.readDir(out)) {
      if (!/^r\d+\.json$/.test(f.name)) continue;
      for (const g of JSON.parse(await Deno.readTextFile(`${out}/${f.name}`)).genomes) { regen += g.eval.regenerated; surv += g.eval.survived; reps += g.eval.reps; }
    }
  }
  const p0 = genomes[0] ? parseInt(genomes[0].hex.slice(0, 8), 16) : 0;
  const F = M3_FOUNDERS[founder];
  const row = { founder, founder_mu: F.mu, founder_sigma: F.sigma, seed: d.slice(5), last_step: lastStep, cells, lineages: census.length, lineages_ge16: census.filter((c) => c[1] >= 16).length, assayed: genomes.length, regenerated: f3(regen / reps), survived: f3(surv / reps), dom_mu: p0 & 0xffff, dom_sigma: p0 >>> 16, dom_depth: depth };
  rows.push(row);
  console.log(Object.values(row).join("\t"));
}
const cols = Object.keys(rows[0] ?? {});
await Deno.mkdir(OUT, { recursive: true });
await Deno.writeTextFile(`${OUT}/solo.tsv`, [cols.join("\t"), ...rows.map((r) => cols.map((c) => r[c]).join("\t"))].join("\n") + "\n");
console.log(`wrote ${OUT}/solo.tsv (${rows.length} histories)`);
