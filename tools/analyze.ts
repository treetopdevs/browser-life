// Ensemble analysis over run bundles written by tools/run.ts.
//
//   deno run -A tools/analyze.ts runs/<experiment>/<preset> [--out report]
//
// 1. Neutral threshold: the 95th percentile of lineage activity in the neutral
//    shadow runs (Bedau & Packard). Components above it count as adaptively
//    significant.
// 2. Per run: activity statistics recomputed with that threshold, time-averaged
//    ecology and held-out complexity observables, and a growth-vs-saturation
//    test on cumulative new activity.
// 3. Pre-registered primary endpoints (experiments/preregistration.md):
//    one-sided Mann–Whitney tests with Holm correction, growth verdict counts,
//    ecological closure.
// 4. Exploratory: two-sided comparison of every statistic with the treatment.
//
// Runs are pooled only if they form one ensemble: same rules, preset, horizon
// and observation schedule, with configurations differing from the treatment
// exactly by their condition.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { RULE_VERSION, SCHEMA_VERSION } from "@bl/schema";
import { ActivityTracker, growthVsSaturation, holm, mannWhitney, mean, quantile, sd } from "@bl/metrics";
import { sameConfig, specConfig } from "@bl/runner";

const a = parseArgs(Deno.args, { string: ["out", "q"], default: { q: "0.95" } });
const root = String(a._[0] ?? "");
if (!root) throw new Error("usage: analyze.ts runs/<experiment>/<preset>");
const outDir = a.out ?? `${root}/report`;

interface Run {
  condition: string;
  seed: number;
  dir: string;
  series: Record<string, any>[];
  lineages: Map<number, [string, number][]>;
  manifest: any;
}

async function loadRun(dir: string, condition: string, seed: number): Promise<Run | null> {
  try {
    const manifest = JSON.parse(await Deno.readTextFile(`${dir}/manifest.json`));
    if (!manifest.summary) return null;
    const series = (await Deno.readTextFile(`${dir}/series.jsonl`)).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const lineages = new Map<number, [string, number][]>();
    const lines = (await Deno.readTextFile(`${dir}/lineages.tsv`)).trim().split("\n").slice(1);
    for (const l of lines) {
      const [s, k, c] = l.split("\t");
      const step = Number(s);
      let arr = lineages.get(step);
      if (!arr) lineages.set(step, (arr = []));
      arr.push([k, Number(c)]);
    }
    return { condition, seed, dir, series, lineages, manifest };
  } catch {
    return null;
  }
}

const loaded: Run[] = [];
for await (const cond of Deno.readDir(root)) {
  if (!cond.isDirectory || cond.name === "report") continue;
  for await (const sd of Deno.readDir(`${root}/${cond.name}`)) {
    const m = /^seed-(\d+)$/.exec(sd.name);
    if (!m) continue;
    const r = await loadRun(`${root}/${cond.name}/${sd.name}`, cond.name, Number(m[1]));
    if (r) loaded.push(r);
  }
}
if (!loaded.length) throw new Error(`no completed runs under ${root}`);
// ---- ensemble compatibility ----
{
  const problems: string[] = [];
  const ref = loaded[0].manifest.spec;
  const shared = ["experiment", "presetId", "steps", "censusEvery", "deepEvery", "activityThreshold"] as const;
  for (const r of loaded) {
    const m = r.manifest;
    const id = `${r.condition}/seed-${r.seed}`;
    if (m.ruleVersion !== RULE_VERSION || m.schemaVersion !== SCHEMA_VERSION)
      problems.push(`${id}: rule/schema ${m.ruleVersion}/${m.schemaVersion}, analysis expects ${RULE_VERSION}/${SCHEMA_VERSION}`);
    if (m.spec.condition !== r.condition || m.spec.seed !== r.seed) problems.push(`${id}: manifest says ${m.spec.condition}/seed-${m.spec.seed}`);
    for (const k of shared) if ((m.spec[k] ?? null) !== (ref[k] ?? null)) problems.push(`${id}: ${k} ${m.spec[k]} differs from ${ref[k]}`);
    if (m.spec.overrides && Object.keys(m.spec.overrides).length) problems.push(`${id}: config overrides ${JSON.stringify(m.spec.overrides)}`);
    else {
      try {
        if (!sameConfig(m.cfg, specConfig(m.spec))) problems.push(`${id}: config differs from ${m.spec.presetId} under ${m.spec.condition}`);
      } catch (e) {
        problems.push(`${id}: ${(e as Error).message}`);
      }
    }
    if ((m.startStep ?? 0) !== 0 || m.summary.steps !== m.spec.steps) problems.push(`${id}: covers ${m.startStep ?? 0}+${m.summary.steps} of ${m.spec.steps} steps`);
    if (r.series.length !== Math.ceil(m.spec.steps / m.spec.censusEvery) || r.series.some((x, i) => x.step !== Math.min((i + 1) * m.spec.censusEvery, m.spec.steps))) problems.push(`${id}: census steps do not follow censusEvery=${m.spec.censusEvery}`);
  }
  if (problems.length) throw new Error(`runs under ${root} are not one ensemble:\n  ${problems.slice(0, 40).join("\n  ")}`);
}
// Pre-registered eligibility: only histories with exact conservation enter inference.
const invalid = loaded.filter((r) => !r.manifest.summary.conservationOk);
const runs = loaded.filter((r) => r.manifest.summary.conservationOk);
if (!runs.length) throw new Error("no run passed the conservation check");
const conditions = [...new Set(runs.map((r) => r.condition))].sort((x, y) => (x === "treatment" ? -1 : y === "treatment" ? 1 : x.localeCompare(y)));

// ---- neutral threshold ----
// Replays every census (from series.jsonl), including empty ones after an
// extinction, so extinct lineages leave the present set at the right time.
function activities(r: Run, threshold = Infinity): { tracker: ActivityTracker; snaps: ReturnType<ActivityTracker["update"]>[] } {
  const t = new ActivityTracker(threshold);
  const snaps = r.series.map((x) => t.update(x.step, r.lineages.get(x.step) ?? []));
  return { tracker: t, snaps };
}
const neutralRuns = runs.filter((r) => r.condition === "neutral");
const neutralActs = neutralRuns.flatMap((r) => activities(r).tracker.allActivities());
const q = Number(a.q);
// Without neutral runs the threshold is uncalibrated: activity endpoints are
// reported as unavailable rather than as zeros.
const calibrated = neutralActs.length > 0;
const threshold = calibrated ? quantile(neutralActs, q) : Infinity;

// ---- per-run statistics ----
type Stats = Record<string, number>;
const perRun = new Map<Run, Stats>();
const trends = new Map<Run, string>();
const timeAvg = (r: Run, f: (x: Record<string, any>) => number | undefined) => {
  const v = r.series.map(f).filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  const tail = v.slice(Math.floor(v.length / 2)); // second half: post-transient
  return tail.length ? mean(tail) : NaN;
};
for (const r of runs) {
  const { snaps } = activities(r, threshold);
  const last = snaps[snaps.length - 1];
  const t = snaps.map((s) => s.step);
  const cum = snaps.map((s) => s.cumulativeNew);
  const g = t.length > 5 ? growthVsSaturation(t, cum) : null;
  if (g && calibrated) trends.set(r, g.verdict);
  perRun.set(r, {
    cumulativeNewActivity: calibrated ? (last?.cumulativeNew ?? 0) : NaN,
    newActivityRate: calibrated && last ? (last.cumulativeNew / Math.max(1, last.step)) * 1e5 : NaN,
    meanSignificant: calibrated ? mean(snaps.map((s) => s.significant)) : NaN,
    individuals: timeAvg(r, (x) => x.individuals),
    lineages: timeAvg(r, (x) => x.lineages),
    lineageShannon: timeAvg(r, (x) => x.lineageShannon),
    bioticRecycling: timeAvg(r, (x) => x.bioticRecycling),
    rolesPresent: timeAvg(r, (x) => x.rolesPresent?.length),
    temporalMI: timeAvg(r, (x) => x.temporalMI),
    patternEntropy: timeAvg(r, (x) => x.patternEntropy),
    lineageCompression: timeAvg(r, (x) => x.lineageCompression),
    differentiation: timeAvg(r, (x) => x.morphology?.differentiation),
    compartmentalised: timeAvg(r, (x) => x.morphology?.compartmentalised),
    fissionsPer1e4: ((r.manifest.summary.fissions + 0) / Math.max(1, r.manifest.summary.steps)) * 1e4,
    buddingsPer1e4: ((r.manifest.summary.buddings ?? 0) / Math.max(1, r.manifest.summary.steps)) * 1e4,
    maxGeneration: r.manifest.summary.maxGeneration,
    growthSlope: calibrated && g ? g.lin.slope * 1e5 : NaN,
  });
}

// ---- comparisons ----
const keys = Object.keys(perRun.values().next().value!);
const HELD_OUT = new Set(["temporalMI", "patternEntropy", "lineageCompression", "differentiation", "compartmentalised", "rolesPresent"]);
const byCond = (c: string) => runs.filter((r) => r.condition === c).map((r) => perRun.get(r)!);
const treat = byCond("treatment");
const fmt = (v: number) => (Number.isFinite(v) ? (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(4)) : "—");

let md = `# Ensemble report: ${root}\n\n`;
md += `Generated ${new Date().toISOString()} from ${runs.length} eligible runs.\n\n`;
if (invalid.length) md += `**Excluded (conservation failed):** ${invalid.map((r) => `${r.condition}/seed-${r.seed}`).join(", ")}\n\n`;
md += calibrated
  ? `Neutral activity threshold (q=${q} of ${neutralActs.length} neutral lineage activities): **${fmt(threshold)}** cell-censuses.\n\n`
  : `**Activity endpoints unavailable:** no eligible neutral-shadow runs to calibrate the threshold (run the \`neutral\` condition).\n\n`;
md += `## Conditions\n\n| condition | runs | steps | conservation exact | extinct | trend of cumulative new activity |\n|---|---|---|---|---|---|\n`;
for (const c of conditions) {
  const rs = runs.filter((r) => r.condition === c);
  const verdicts = rs.map((r) => trends.get(r) ?? "n/a");
  const count = (v: string) => verdicts.filter((x) => x === v).length;
  md += `| ${c} | ${rs.length} | ${rs[0].manifest.summary.steps} | ${rs.filter((r) => r.manifest.summary.conservationOk).length}/${rs.length} | ${rs.filter((r) => r.manifest.summary.extinct).length} | growing ${count("growing")}, saturating ${count("saturating")}, flat ${count("flat")}, indeterminate ${count("indeterminate")} |\n`;
}
md += `\n## Statistics (mean ± sd over seeds; second half of each run)\n\n`;
md += `Held-out observables are marked †; none is used by any search or selection mechanism.\n\n`;
md += `| statistic | ${conditions.join(" | ")} |\n|---|${conditions.map(() => "---").join("|")}|\n`;
for (const k of keys) {
  md += `| ${k}${HELD_OUT.has(k) ? " †" : ""} | ${conditions
    .map((c) => {
      const v = byCond(c).map((s) => s[k]).filter(Number.isFinite);
      return v.length ? `${fmt(mean(v))} ± ${fmt(sd(v))}` : "—";
    })
    .join(" | ")} |\n`;
}
// ---- pre-registered primary endpoints ----
const ALPHA = 0.01;
md += `\n## Primary endpoints (pre-registered)\n\n`;
const oneSided = (k: string, a: Stats[], b: Stats[]) => {
  const x = a.map((s) => s[k]).filter(Number.isFinite);
  const y = b.map((s) => s[k]).filter(Number.isFinite);
  return x.length >= 2 && y.length >= 2 ? mannWhitney(x, y) : null;
};
{
  md += `**1. Adaptive activity** — cumulative new activity, treatment > control, one-sided Mann–Whitney, Holm across the two comparisons, α = ${ALPHA}.\n\n`;
  const ctl = ["neutral", "no-mutation"];
  const tests = ctl.map((c) => (calibrated ? oneSided("cumulativeNewActivity", treat, byCond(c)) : null));
  const avail = tests.filter((t): t is NonNullable<typeof t> => t !== null);
  const adj = holm(avail.map((t) => t.pGreater));
  md += `| comparison | n (treatment, control) | effect P(T > C) | one-sided p | Holm-adjusted p | supported |\n|---|---|---|---|---|---|\n`;
  let j = 0;
  ctl.forEach((c, i) => {
    const t = tests[i];
    if (!t) {
      md += `| treatment > ${c} | ${treat.length}, ${byCond(c).length} | — | — | — | unavailable${calibrated ? " (need ≥2 runs each)" : " (uncalibrated)"} |\n`;
      return;
    }
    const p = adj[j++];
    md += `| treatment > ${c} | ${treat.length}, ${byCond(c).length} | ${t.effect.toFixed(2)} | ${t.pGreater.toFixed(4)} | ${p.toFixed(4)} | ${p < ALPHA ? "yes" : "no"} |\n`;
  });
  if (avail.length < ctl.length) md += `\nThe Holm family is incomplete; the endpoint cannot be established from this ensemble.\n`;

  const verdicts = (c: string) => runs.filter((r) => r.condition === c).map((r) => trends.get(r));
  const tv = verdicts("treatment"), nv = verdicts("neutral");
  const growing = (v: (string | undefined)[]) => v.filter((x) => x === "growing").length;
  md += `\n**2. Unbounded-looking growth** — treatment growing in ${growing(tv)}/${tv.length} runs, neutral in ${growing(nv)}/${nv.length}. `;
  md += calibrated && tv.length && nv.length
    ? `Supported: ${growing(tv) * 2 > tv.length && growing(nv) * 2 < nv.length ? "yes" : "no"} (majority of treatment and a minority of neutral runs growing).\n`
    : `Unavailable (needs calibrated treatment and neutral runs).\n`;

  const rec = oneSided("bioticRecycling", treat, byCond("replenished"));
  md += `\n**3. Ecological closure** — biotic recycling, treatment > replenished: ${rec ? `effect ${rec.effect.toFixed(2)}, one-sided p = ${rec.pGreater.toFixed(4)}` : "unavailable"}. `;
  md += `Roles: see \`rolesPresent\`; coexistence duration is read from series.jsonl.\n`;
}

if (treat.length) {
  md += `\n## Exploratory: treatment vs controls (Mann–Whitney, two-sided, unadjusted; effect = P(treatment > control))\n\n`;
  md += `Not part of the pre-registered inference; with few seeds these p-values are indicative only.\n\n`;
  md += `| statistic | ${conditions.filter((c) => c !== "treatment").join(" | ")} |\n|---|${conditions.filter((c) => c !== "treatment").map(() => "---").join("|")}|\n`;
  for (const k of keys) {
    md += `| ${k} | ${conditions
      .filter((c) => c !== "treatment")
      .map((c) => {
        const x = treat.map((s) => s[k]).filter(Number.isFinite);
        const y = byCond(c).map((s) => s[k]).filter(Number.isFinite);
        if (x.length < 2 || y.length < 2) return "—";
        const t = mannWhitney(x, y);
        return `${t.effect.toFixed(2)} (p=${t.p.toFixed(3)})`;
      })
      .join(" | ")} |\n`;
  }
}

// ---- charts (SVG, one line per run) ----
function chart(title: string, f: (x: Record<string, any>) => number | undefined, file: string) {
  const W = 720, H = 260, P = 40;
  const colors = ["#1a7f55", "#c2410c", "#2563eb", "#9333ea", "#ca8a04", "#0891b2", "#be123c"];
  let xmax = 1, ymin = Infinity, ymax = -Infinity;
  const lines = runs.map((r) => {
    const pts = r.series.map((x) => [x.step, f(x)] as [number, number | undefined]).filter((p): p is [number, number] => Number.isFinite(p[1]));
    for (const [x, y] of pts) {
      xmax = Math.max(xmax, x);
      ymin = Math.min(ymin, y);
      ymax = Math.max(ymax, y);
    }
    return { r, pts };
  });
  if (!Number.isFinite(ymin)) return "";
  if (ymax === ymin) ymax = ymin + 1;
  const sx = (x: number) => P + (x / xmax) * (W - 2 * P);
  const sy = (y: number) => H - P - ((y - ymin) / (ymax - ymin)) * (H - 2 * P);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="system-ui" font-size="11"><rect width="100%" height="100%" fill="#fff"/>`;
  svg += `<text x="${P}" y="18" font-size="13" font-weight="600">${title}</text>`;
  svg += `<text x="${P}" y="${H - 10}" fill="#666">0</text><text x="${W - P}" y="${H - 10}" text-anchor="end" fill="#666">${xmax.toLocaleString()} steps</text>`;
  svg += `<text x="${P - 4}" y="${sy(ymax) + 4}" text-anchor="end" fill="#666">${fmt(ymax)}</text><text x="${P - 4}" y="${sy(ymin) + 4}" text-anchor="end" fill="#666">${fmt(ymin)}</text>`;
  for (const { r, pts } of lines) {
    const col = colors[conditions.indexOf(r.condition) % colors.length];
    svg += `<polyline fill="none" stroke="${col}" stroke-opacity="0.8" stroke-width="1.4" points="${pts.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(" ")}"/>`;
  }
  conditions.forEach((c, i) => {
    svg += `<rect x="${W - P - 150}" y="${28 + i * 14}" width="10" height="10" fill="${colors[i % colors.length]}"/><text x="${W - P - 135}" y="${37 + i * 14}">${c}</text>`;
  });
  svg += `</svg>`;
  Deno.writeTextFileSync(`${outDir}/${file}`, svg);
  return `![${title}](${file})\n\n`;
}
await Deno.mkdir(outDir, { recursive: true });
md += `\n## Time series\n\n`;
md += chart("Individuals", (x) => x.individuals, "individuals.svg");
md += chart("Lineages present", (x) => x.lineages, "lineages.svg");
md += chart("Biotic share of recycling", (x) => x.bioticRecycling, "recycling.svg");
md += chart("Temporal mutual information † (bits/block)", (x) => x.temporalMI, "temporal-mi.svg");
md += chart("Lineage-map compression ratio †", (x) => x.lineageCompression, "compression.svg");
md += chart("Bound mass (B+P)", (x) => x.pools.B + x.pools.P, "biomass.svg");

await Deno.writeTextFile(`${outDir}/report.md`, md);
await Deno.writeTextFile(
  `${outDir}/report.json`,
  JSON.stringify({ threshold, runs: runs.map((r) => ({ condition: r.condition, seed: r.seed, trend: trends.get(r), stats: perRun.get(r) })) }, null, 2),
);
console.log(md.split("## Time series")[0]);
console.log(`wrote ${outDir}/report.md`);
