// Planning-only joint-power rationale for the 2026-09-29 M4 growth contract.
// Endpoint-1 power comes from the already-reported 2026-09-28 per-run values
// (experiments/m4/<preset>.json), run through the production evaluateEndpoint;
// endpoint-2 power is the parent validation's one-sided 95% lower bound under
// its declared synthetic alternative. Never reads a fresh ensemble.
//   deno run --no-lock -A tools/m4-growth-joint-power.ts <out.json>
import { evaluateEndpoint, PRIMARY_ENDPOINTS, type RunView } from "../experiments/endpoints.ts";

const PRESETS = ["gradient-m3", "spots-m3"] as const;
const CONDITIONS = ["treatment", "neutral", "no-mutation"] as const;
const PARENT_REPORT = "experiments/m4/growth-precision-v1/parent-validation-v4-report.json";
const SEED = 20261002, NS = [20, 32, 64, 128], INNER = 2000, OUTER = 1000, OUTER_INNER = 200;

/** mulberry32: a fixed, documented planning RNG (not a scientific seed stream). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Pools = Record<(typeof CONDITIONS)[number], number[]>;
const draw = (u: () => number, pool: number[], n: number) => Array.from({ length: n }, () => pool[Math.floor(u() * pool.length)]);

function supported(u: () => number, pools: Pools, n: number): boolean {
  const views: RunView[] = CONDITIONS.flatMap((condition) =>
    draw(u, pools[condition], n).map((v, seed) => ({ condition, seed, stats: { cumulativeNewActivity: v }, series: [] }))
  );
  const r = evaluateEndpoint(PRIMARY_ENDPOINTS[0], views);
  return r.kind === "test" && r.complete && r.rows.every((row) => row.supported);
}
const power = (u: () => number, pools: Pools, n: number, b: number) => {
  let k = 0;
  for (let i = 0; i < b; i++) k += Number(supported(u, pools, n));
  return k / b;
};
const quantile = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.floor(q * (xs.length - 1))];

if (import.meta.main) {
  const out = Deno.args[0];
  if (!out) throw new Error("usage: m4-growth-joint-power.ts <out.json>");
  const parent = JSON.parse(await Deno.readTextFile(PARENT_REPORT));
  const u = rng(SEED);
  const presets = [];
  for (const preset of PRESETS) {
    const data = JSON.parse(await Deno.readTextFile(`experiments/m4/${preset}.json`));
    const pools = Object.fromEntries(CONDITIONS.map((c) => [c,
      data.runs.filter((r: { condition: string }) => r.condition === c).map((r: { stats: { cumulativeNewActivity: number } }) => r.stats.cumulativeNewActivity),
    ])) as Pools;
    const t = pools.treatment, nn = pools.neutral;
    const auc = t.reduce((s, x) => s + nn.reduce((a, y) => a + (x > y ? 1 : x === y ? 0.5 : 0), 0), 0) / (t.length * nn.length);
    // Conditional power: the observed values taken as the population.
    const conditional = Object.fromEntries(NS.map((n) => [n, power(u, pools, n, INNER)]));
    // Assurance: also resample the observed sample itself, so the small 2026-09-28
    // ensembles' uncertainty about the population enters the planning figure.
    const assurance: Record<number, { mean: number; p05: number; p10: number }> = {};
    for (const n of [64, 128]) {
      const worlds: number[] = [];
      for (let w = 0; w < OUTER; w++) {
        const world = Object.fromEntries(CONDITIONS.map((c) => [c, draw(u, pools[c], pools[c].length)])) as Pools;
        worlds.push(power(u, world, n, OUTER_INNER));
      }
      assurance[n] = { mean: worlds.reduce((a, b) => a + b, 0) / worlds.length, p05: quantile(worlds, 0.05), p10: quantile(worlds, 0.1) };
    }
    const alt = parent.results.find((r: { scenario: string; preset: string }) => r.scenario === "meanAlternative" && r.preset === preset);
    const e2 = alt.lower95 as number;
    const frechet = (p1: number) => Math.max(0, p1 + e2 - 1);
    presets.push({
      preset, runsPerCondition: Object.fromEntries(CONDITIONS.map((c) => [c, pools[c].length])),
      treatmentOverNeutralAuc: auc, endpoint1ConditionalPower: conditional, endpoint1Assurance: assurance,
      endpoint2PowerLower95Synthetic: e2, endpoint2SyntheticObserved: `${alt.supported}/${alt.n}`,
      jointLowerBoundAt64: {
        conditional: frechet(conditional[64]), assurance: frechet(assurance[64].mean), pessimistic05: frechet(assurance[64].p05),
      },
    });
  }
  const report = {
    format: "m4-growth-joint-power/v1", date: "2026-10-02", seed: SEED, inner: INNER, outer: OUTER, outerInner: OUTER_INNER,
    sources: { endpoint1: "experiments/m4/{gradient-m3,spots-m3}.json (2026-09-28, already reported)", endpoint2: PARENT_REPORT },
    method: "Endpoint-1 support = production evaluateEndpoint(PRIMARY_ENDPOINTS[0]) on n runs per condition drawn with replacement from the 2026-09-28 per-run values, conditions drawn independently. Joint lower bound = max(0, P(E1) + P(E2) - 1) (Frechet; no independence assumed).",
    presets,
  };
  await Deno.writeTextFile(out, JSON.stringify(report, null, 2) + "\n", { createNew: true });
  console.log(JSON.stringify(presets.map((p) => ({ preset: p.preset, auc: p.treatmentOverNeutralAuc, conditional: p.endpoint1ConditionalPower, assurance: p.endpoint1Assurance, joint: p.jointLowerBoundAt64 }))));
}
