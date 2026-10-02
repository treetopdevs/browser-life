// Planning power for the scaffolding registration draft (docs/scaffold-registration-v1.md, "Sample
// size"). Bootstraps the exploratory R3 assays' per-fragment outcomes (protocol v1's runs/scaffold/
// assays/r3 and the R3 replication's runs/scaffold/r3rep/assays) into simulated registrations of n
// histories per arm with R fragment replicates per set, and applies the draft's tests:
//   H1: six exact one-sided Mann–Whitney tests (scaf against rand, cont and the ancestor, at timings
//       a and b); H1's p is the largest (intersection–union).
//   H2: an exact one-sided sign test on whether each history's paired genome gain g is positive,
//       g = competence(Ge-on-Fa) − competence(Ga-on-Fa) on the same fragments. The Ga-on-Fa control
//       (the ancestor genome relabelled onto the ancestor's fragments) was measured by a Mac pilot on
//       both exploratory ancestor fragment sets (runs/scaffold/reg-pilot/gaonfa-{r3rep,v1}, same
//       sources and seeds as their ancestor-a sets); --control unmodified uses the ancestor set instead.
//   Holm over {H1, H2} at α; and S1 (g ≥ half the advantage over the ancestor, sign test), reported
//   unadjusted: the registered S1 sits in a four-test Holm family this tool does not simulate.
// Each simulated index draws observed records jointly: a scaf history (its a and b competences and
// its swap profile, with the ancestor fragments that profile was measured on), a rand and a cont
// history (a and b), and, independently, an ancestor world (its a fragments and b competence) for
// H1's ancestor comparison. R × 64 fragments are then drawn independently. Transferring a swap
// profile to an independently grown ancestor world assumes the genome's response on ancestral
// material does not depend on which ancestor world supplies it.
// Sensitivity: --adverse q gives a fraction q of simulated scaf histories a genome with no gain
// (g = 0, counted as non-positive), which the observed data cannot produce. The swap pair can use
// more replicates than the other sets (--swap-r). A planning estimate only, never a decision input.
//
//   deno run -A tools/scaffold-power.ts [--sets r3rep,v1] [--reps 400] [--seed 20261001] [--adverse 0,0.1]
//     [--control relabelled|unmodified] [--n 8,12,16] [--r 4] [--swap-r 4,8] [--out power.json]
//
// Limits: 6 or 12 observed histories per arm and two ancestor worlds; Monte Carlo error is
// reported per estimate.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { holm, mannWhitney } from "@bl/metrics";

const a = parseArgs(Deno.args, {
  string: ["sets", "reps", "seed", "out", "alpha", "adverse", "control", "n", "r", "swap-r"],
  default: { sets: "r3rep,v1", reps: "400", seed: "20261001", alpha: "0.01", adverse: "0", control: "relabelled", n: "8,12,16", r: "4", "swap-r": "4" },
});
const ROOTS: Record<string, string> = { r3rep: "runs/scaffold/r3rep/assays", v1: "runs/scaffold/assays/r3" };
const CONTROLS: Record<string, string> = { r3rep: "runs/scaffold/reg-pilot/gaonfa-r3rep", v1: "runs/scaffold/reg-pilot/gaonfa-v1" };
if (a.control !== "relabelled" && a.control !== "unmodified") throw new Error("--control must be relabelled or unmodified");
const reps = Number(a.reps), alpha = Number(a.alpha);
const list = (v: string) => v.split(",").map(Number);
const adverse = list(a.adverse), sizes = list(a.n), replicates = list(a.r), swapReplicates = list(a["swap-r"]);

type Set = Map<string, number>;
function load(root: string, name: string): Set {
  const [header, ...rows] = Deno.readTextFileSync(name ? `${root}/${name}/assay.tsv` : `${root}/assay.tsv`).trim().split("\n");
  const h = header.split("\t");
  const [rep, pond, ok] = ["replicate", "pond", "success"].map((c) => h.indexOf(c));
  const out: Set = new Map();
  for (const r of rows) {
    const c = r.split("\t");
    out.set(`${c[rep]}:${c[pond]}`, Number(c[ok]));
  }
  if (out.size !== 128) throw new Error(`${root}/${name}: expected 128 fragments, found ${out.size}`);
  return out;
}
const rate = (s: Set) => [...s.values()].reduce((x, y) => x + y, 0) / s.size;

interface ScafRecord { a: number; b: number; control: Set; swap: Set; keys: string[] }
interface Record2 { a: number; b: number }
interface AncRecord { a: Set; keys: string[]; b: number }
const scaf: ScafRecord[] = [], rand: Record2[] = [], cont: Record2[] = [], ancestors: AncRecord[] = [];
for (const name of a.sets.split(",")) {
  const root = ROOTS[name];
  if (!root) throw new Error(`unknown set ${name}`);
  const anc = load(root, "ancestor-a");
  ancestors.push({ a: anc, keys: [...anc.keys()].sort(), b: rate(load(root, "ancestor-b")) });
  const control = a.control === "relabelled" ? load(CONTROLS[name], "") : anc;
  for (let i = 0; i < 6; i++) {
    const r = (arm: string, t: string) => rate(load(root, `${arm}-i${i}-${t}`));
    scaf.push({ a: r("scaf", "a"), b: r("scaf", "b"), control, swap: load(root, `scaf-i${i}-swap-ea`), keys: [...anc.keys()].sort() });
    rand.push({ a: r("rand", "a"), b: r("rand", "b") });
    cont.push({ a: r("cont", "a"), b: r("cont", "b") });
  }
}

// mulberry32: a small seeded PRNG, so the estimates are reproducible.
let s = Number(a.seed) >>> 0;
const rnd = () => {
  s = (s + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
const binom = (p: number, F: number) => {
  let k = 0;
  for (let j = 0; j < F; j++) if (rnd() < p) k++;
  return k / F;
};
/** Exact one-sided sign-test p: P(X ≥ k) for X ~ Binomial(n, 1/2). */
function signP(k: number, n: number): number {
  let c = 1, tail = 0;
  for (let j = 0; j <= n; j++) {
    if (j >= k) tail += c;
    c = (c * (n - j)) / (j + 1);
  }
  return tail / 2 ** n;
}

function simulate(n: number, R: number, swapR: number, q: number) {
  const F = 64 * R, Fs = 64 * swapR;
  const tally = { H1: 0, H2: 0, both: 0, S1: 0, parts: [0, 0, 0, 0, 0, 0] };
  for (let r = 0; r < reps; r++) {
    const arm: Record<string, number[]> = { sa: [], sb: [], ra: [], rb: [], ca: [], cb: [], aa: [], ab: [] };
    let gPos = 0, dPos = 0;
    for (let j = 0; j < n; j++) {
      const h = pick(scaf), hr = pick(rand), hc = pick(cont), w = pick(ancestors);
      let ca = 0, ce = 0;
      for (let f = 0; f < Fs; f++) {
        const k = pick(h.keys);
        ca += h.control.get(k)!;
        ce += h.swap.get(k)!;
      }
      ca /= Fs;
      ce /= Fs;
      let wa = 0;
      for (let f = 0; f < F; f++) wa += w.a.get(pick(w.keys))!;
      wa /= F;
      if (rnd() < q) ce = ca; // adverse scenario: this history's genome has no gain
      const sa = binom(h.a, F);
      arm.sa.push(sa);
      arm.sb.push(binom(h.b, F));
      arm.ra.push(binom(hr.a, F));
      arm.rb.push(binom(hr.b, F));
      arm.ca.push(binom(hc.a, F));
      arm.cb.push(binom(hc.b, F));
      arm.aa.push(wa);
      arm.ab.push(binom(w.b, F));
      if (ce - ca > 0) gPos++;
      if (ce - ca - 0.5 * (sa - wa) > 0) dPos++;
    }
    const ps = (["a", "b"] as const).flatMap((t) => ["r", "c", "a"].map((o) => mannWhitney(arm["s" + t], arm[o + t], "exact").pGreater));
    ps.forEach((p, k) => (tally.parts[k] += p <= alpha ? 1 : 0));
    const p1 = Math.max(...ps); // intersection–union: H1 holds only if every comparison does
    const p2 = signP(gPos, n);
    const [h1, h2] = holm([p1, p2]);
    tally.H1 += h1 <= alpha ? 1 : 0;
    tally.H2 += h2 <= alpha ? 1 : 0;
    tally.both += h1 <= alpha && h2 <= alpha ? 1 : 0;
    tally.S1 += signP(dPos, n) <= alpha ? 1 : 0;
  }
  const f = (x: number) => Math.round((1000 * x) / reps) / 1000;
  const se = (x: number) => Math.round(1000 * Math.sqrt((x / reps) * (1 - x / reps) / reps)) / 1000;
  return { n, R, swapR, adverse: q, control: a.control, H1: f(tally.H1), H2: f(tally.H2), both: f(tally.both), bothSE: se(tally.both), S1Unadjusted: f(tally.S1), H1parts: tally.parts.map(f) };
}

const out = { sets: a.sets, reps, seed: Number(a.seed), alpha, designs: [] as ReturnType<typeof simulate>[] };
for (const q of adverse) {
  for (const swapR of swapReplicates) {
    for (const n of sizes) {
      for (const R of replicates) {
        const d = simulate(n, R, swapR, q);
        out.designs.push(d);
        console.log(`adverse ${q}  swap R ${swapR}  n ${String(n).padStart(2)}  R ${R}  H1 ${d.H1.toFixed(2)}  H2 ${d.H2.toFixed(2)}  both ${d.both.toFixed(2)} ± ${d.bothSE.toFixed(3)}  S1 (unadjusted) ${d.S1Unadjusted.toFixed(3)}  H1 parts [${d.H1parts.join(", ")}]`);
      }
    }
  }
}
if (a.out) Deno.writeTextFileSync(a.out, JSON.stringify(out, null, 1) + "\n");
