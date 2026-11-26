// Audit scratch: pure fuzz of decide() against an independent reference, aimed at the extension branch (p1 in {1,2}, 5-of-6 boundary, ties).
import { decide, InputError, rat, type SeedStats } from "../../tools/lib/slab-readout.ts";
function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const R = rng(12345);
const ri = (n: number) => Math.floor(R() * n);
type D = [bigint, bigint] | null; // numerator/denominator (positive den), unreduced
const mkStats = (d: D): SeedStats => ({ D: d ? rat(d[0], d[1]) : undefined }) as unknown as SeedStats;
function ref(neu: D[], evo: D[], have: boolean[]): string {
  const bar = (idx: number[]) => {
    const ds = idx.map((i) => neu[i]);
    if (ds.some((x) => x === null)) return null;
    const dd = ds as [bigint, bigint][];
    const Q = dd.reduce((a, d) => a * d[1], 1n);
    const Ns = dd.map((d) => d[0] * (Q / d[1]));
    const sum = Ns.reduce((a, b) => a + b, 0n);
    const mx = Ns.reduce((a, b) => (b > a ? b : a)), mn = Ns.reduce((a, b) => (b < a ? b : a));
    const n = BigInt(idx.length);
    return { num: sum + n * (mx - mn), den: n * Q };
  };
  const pass = (idx: number[], b: { num: bigint; den: bigint }) => idx.filter((i) => evo[i] !== null && evo[i]![0] * b.den > b.num * evo[i]![1]).length;
  const b1 = bar([0, 1, 2]);
  if (!b1) return "pause: control undefined";
  const p1 = pass([0, 1, 2], b1);
  if (p1 === 3) return "go";
  if (p1 === 0) return "pause";
  if (!have.every(Boolean)) return "extend: waiting for seeds";
  const all = [0, 1, 2, 3, 4, 5];
  const b2 = bar(all);
  if (!b2) return "pause: control undefined";
  return pass(all, b2) >= 5 ? "go" : "pause";
}
const tally: Record<string, number> = {};
let bad = 0, ties = 0;
const q = [6n, 12n, 15n, 60n, 7n][0];
for (let it = 0; it < 60000; it++) {
  const den = [3n, 6n, 12n, 60n, 7n, 1n][ri(6)];
  const width = ri(3) === 0 ? 2 : 5;
  const gen = (undefP: number): D => (R() < undefP ? null : [BigInt(ri(2 * width + 1) - width) * (den < 12n ? 1n : 1n), den * BigInt(1 + ri(2))]);
  const uP = ri(4) === 0 ? 0.08 : 0;
  const neu: D[] = Array.from({ length: 6 }, () => gen(uP));
  const shift = BigInt(ri(4)); const evo: D[] = Array.from({ length: 6 }, () => { const g = gen(ri(5) === 0 ? 0.1 : 0); return g ? [g[0] + shift * g[1] / (g[1] > 0n ? 1n : 1n) / 2n, g[1]] as [bigint, bigint] : g; });
  const ext = ri(6) !== 0;
  const have = Array.from({ length: 6 }, (_, i) => (ext ? true : i < 3 ? true : false));
  // build maps: evo/neutral map present seeds only
  const mapOf = (ds: D[], extPresent: boolean) => new Map(ds.map((d, i) => [i + 1, mkStats(d)] as const).filter(([s]) => s <= 3 || extPresent));
  let got: string;
  try { got = decide({ evolving: mapOf(evo, ext), neutral: mapOf(neu, ext) }).verdict; } catch (e) { got = e instanceof InputError ? "INPUT" : `THROW ${e}`; }
  const want = ref(neu, evo, have);
  tally[want] = (tally[want] ?? 0) + 1;
  if (got !== want) { bad++; if (bad < 6) console.log("MISMATCH", JSON.stringify({ neu: neu.map((d) => d && `${d[0]}/${d[1]}`), evo: evo.map((d) => d && `${d[0]}/${d[1]}`), ext, got, want })); }
}
console.log("cases=60000 mismatches=" + bad, tally);
void q; void ties;
