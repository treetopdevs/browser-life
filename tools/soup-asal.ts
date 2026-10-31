// Scores the CLIP observer calibration fixed in docs/soup-asal-calibration-2026-10-31.md.
//
//   deno run -A tools/soup-asal.ts [--dir runs/observe]   (reads g1-none, g1-brg, g2-none, g2-brg .json from clip_embed.py)
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { novelty, oeScore, pearson, quantile } from "./observe/asal.ts";
import { rng } from "./soup/evo.ts";

const a = parseArgs(Deno.args, { string: ["dir"], default: { dir: "runs/observe" } });
interface Run { meta: Record<string, unknown>; steps: number[]; es: number[][] }
async function load(name: string): Promise<Run> {
  const j = JSON.parse(await Deno.readTextFile(`${a.dir}/${name}.json`));
  const rows = (j.frames as { frame: string; embedding: number[] }[]).map((f) => ({ step: Number(f.frame.replace(/\.png$/, "")), e: f.embedding }))
    .sort((x, y) => x.step - y.step);
  return { meta: j.meta, steps: rows.map((r) => r.step), es: rows.map((r) => r.e) };
}

const inW = (s: number) => s >= 16896 && s <= 19200;
const inB1 = (s: number) => s >= 4096 && s <= 16768;
const inN2 = (s: number) => s >= 4096;
const inBlip = (s: number) => s >= 38400 && s <= 40448;

function primary(g1: Run, g2: Run) {
  const n1 = novelty(g1.es), n2 = novelty(g2.es);
  const pick = (r: Run, n: (number | null)[], f: (s: number) => boolean) => r.steps.map((s, i) => [s, n[i]] as const).filter(([s, v]) => f(s) && v !== null) as [number, number][];
  const W = pick(g1, n1, inW), B1 = pick(g1, n1, inB1), N2 = pick(g2, n2, inN2);
  const maxOf = (xs: [number, number][]) => xs.reduce((m, [s, v]) => (v > m[1] ? [s, v] : m), [NaN, -Infinity] as [number, number]);
  const [wStep, wMax] = maxOf(W), [b1Step, b1Max] = maxOf(B1), [n2Step, n2Max] = maxOf(N2);
  const theta = Math.max(b1Max, n2Max);
  const first = W.find(([, v]) => v > theta)?.[0] ?? null;
  // Blip: seed 2 novelty inside [38400, 40448] vs the 99th percentile of its other frames >= 4096.
  const blip = pick(g2, n2, inBlip), rest = N2.filter(([s]) => !inBlip(s)).map(([, v]) => v);
  const q99 = quantile(rest, 0.99);
  const [blipStep, blipMax] = maxOf(blip);
  return { seesTakeover: wMax > theta, wMax, wStep, b1Max, b1Step, n2Max, n2Step, theta, firstAbove: first, blip: { max: blipMax, step: blipStep, q99, seen: blipMax > q99 }, n1, n2 };
}

const g1 = await load("g1-none"), g2 = await load("g2-none"), g1c = await load("g1-brg"), g2c = await load("g2-brg");
for (const [x, y] of [[g1, g1c], [g2, g2c]]) if (x.steps.join() !== y.steps.join()) throw new Error("recoloured frames differ");
const orig = primary(g1, g2), recol = primary(g1c, g2c);
const flat = (xs: (number | null)[]) => xs.filter((v): v is number => v !== null);
const corr = { g1: pearson(flat(orig.n1), flat(recol.n1)), g2: pearson(flat(orig.n2), flat(recol.n2)) };

// C2: order control on seed 1 from step 4,096.
const idx = g1.steps.map((s, i) => [s, i] as const).filter(([s]) => s >= 4096).map(([, i]) => i);
const sub = idx.map((i) => g1.es[i]), subSteps = idx.map((i) => g1.steps[i]);
const trueOE = oeScore(sub, () => true);
const wMean = (es: number[][], steps: number[]) => { const n = novelty(es); const v = steps.map((s, i) => [s, n[i]] as const).filter(([s, x]) => inW(s) && x !== null).map(([, x]) => x as number); return v.reduce((p, q) => p + q, 0) / v.length; };
const trueW = wMean(sub, subSteps);
const shuf = [];
for (let k = 1; k <= 20; k++) {
  const r = rng(k), ord = sub.map((_, i) => i);
  for (let i = ord.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [ord[i], ord[j]] = [ord[j], ord[i]]; }
  const es = ord.map((i) => sub[i]), st = ord.map((i) => subSteps[i]);
  shuf.push({ oe: oeScore(es, () => true), wMean: wMean(es, st) });
}
const oeRank = shuf.filter((s) => s.oe <= trueOE).length; // shuffles at least as open-ended as true order
// ASAL OE per run (frames >= 4096), descriptive.
const oe = { g1: oeScore(g1.es, (t) => g1.steps[t] >= 4096), g2: oeScore(g2.es, (t) => g2.steps[t] >= 4096) };

const verdict = orig.seesTakeover && recol.seesTakeover ? "PASS" : orig.seesTakeover ? "PARTIAL" : "FAIL";
const strip = ({ n1: _a, n2: _b, ...r }: typeof orig) => r;
const record = {
  verdict, meta: g1.meta, original: strip(orig), recoloured: strip(recol), noveltyCorrelation: corr,
  order: { trueOE, shuffledOE: shuf.map((s) => s.oe), shufflesAtLeastAsOpenEnded: oeRank, trueWMean: trueW, shuffledWMean: shuf.map((s) => s.wMean) },
  asalOE: oe,
  series: { g1: g1.steps.map((s, i) => [s, orig.n1[i], recol.n1[i]]), g2: g2.steps.map((s, i) => [s, orig.n2[i], recol.n2[i]]) },
};
await Deno.writeTextFile(`${a.dir}/calibration.json`, JSON.stringify(record));
const { series: _s, ...brief } = record;
console.log(JSON.stringify(brief, (k, v) => (typeof v === "number" ? Math.round(v * 1e5) / 1e5 : v), 1));

