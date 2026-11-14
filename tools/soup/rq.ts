// Red Queen scoring (docs/soup-redqueen-2026-11-01.md): players, panel scores,
// the pooled within-lineage order test (Part A) and the paired sign-flip test
// (Part C). Pure functions; the CLI is tools/soup-rq.ts.
import { type Outcome, rng, spearman } from "./evo.ts";
import { fnv } from "./hall.ts";

export interface Player { id: string; forms: string[] } // type id + exact forms
/** A player's key: its type id and a hash of its exact forms (doc: Players and races). */
export const playerKey = (p: Player) => `${p.id}.${fnv(p.forms.join(",")).toString(16).padStart(8, "0")}`;

export type FailedMode = "as-is" | "win" | "loss";
export const MODES: FailedMode[] = ["as-is", "win", "loss"];

/** One player's results against its panel: outcome per opponent from the player's side ("win", "loss", "other", "failed"). */
export type Side = "win" | "loss" | "other" | "failed";
export function sideOf(o: Outcome, playerIsA: boolean): Side {
  if (o === "failed") return "failed";
  if (o === "a") return playerIsA ? "win" : "loss";
  if (o === "b") return playerIsA ? "loss" : "win";
  return "other";
}

/** net = (wins - losses) / opponents, with failed races counted as the mode says (doc: Score against the panel). */
export function net(sides: Side[], mode: FailedMode = "as-is", opponents = 6): number {
  if (sides.length !== opponents) throw new Error(`expected ${opponents} opponents, got ${sides.length}`);
  let s = 0;
  for (const x of sides) {
    if (x === "win" || (x === "failed" && mode === "win")) s++;
    else if (x === "loss" || (x === "failed" && mode === "loss")) s--;
  }
  return s / opponents;
}

/** Spearman of order against score, 0 when every score is equal (doc: Part A). */
export function orderRho(scores: number[]): number {
  if (scores.length < 2 || scores.every((s) => s === scores[0])) return 0;
  return spearman(scores.map((_, i) => i), scores);
}

/** T = sum of per-lineage rho, and its two-sided p from 200,000 within-lineage shuffles (generator seed 1). */
export function pooledOrderTest(lineages: number[][], N = 200_000, seed = 1): { T: number; rhos: number[]; p: number } {
  const rhos = lineages.map(orderRho);
  const T = rhos.reduce((s, x) => s + x, 0);
  const eps = 1e-12 * Math.max(1, Math.abs(T));
  const r = rng(seed);
  const work = lineages.map((l) => l.slice());
  let hits = 0;
  for (let s = 0; s < N; s++) {
    let t = 0;
    for (const w of work) {
      for (let i = w.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [w[i], w[j]] = [w[j], w[i]]; }
      t += orderRho(w);
    }
    if (Math.abs(t) >= Math.abs(T) - eps) hits++;
  }
  return { T, rhos, p: (hits + 1) / (N + 1) };
}

/** Exact two-sided sign-flip test on mean d over all 2^n sign patterns (doc: C1). */
export function signFlip(d: number[]): { mean: number; p: number; nonzero: number } {
  const n = d.length;
  if (n > 20) throw new Error("too many pairs for an exact sign-flip test");
  const mean = d.reduce((s, x) => s + x, 0) / n;
  const eps = 1e-12 * Math.max(1, Math.abs(mean));
  let hits = 0;
  for (let m = 0; m < 2 ** n; m++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += (m >> i) & 1 ? -d[i] : d[i];
    if (Math.abs(s / n) >= Math.abs(mean) - eps) hits++;
  }
  return { mean, p: hits / 2 ** n, nonzero: d.filter((x) => x !== 0).length };
}

export type AVerdict = "LATER MORE GENERAL" | "LATER LESS GENERAL" | "NOT SHOWN";
export const aVerdict = (T: number, p: number): AVerdict => p < 0.05 ? (T > 0 ? "LATER MORE GENERAL" : "LATER LESS GENERAL") : "NOT SHOWN";

export type CVerdict = "HISTORY MAKES MORE GENERAL" | "HISTORY MAKES LESS GENERAL" | "NO DIFFERENCE SHOWN" | "INSUFFICIENT EVIDENCE";
export function cVerdict(r: { mean: number; p: number; nonzero: number }): CVerdict {
  if (r.nonzero < 6) return "INSUFFICIENT EVIDENCE";
  return r.p < 0.05 ? (r.mean > 0 ? "HISTORY MAKES MORE GENERAL" : "HISTORY MAKES LESS GENERAL") : "NO DIFFERENCE SHOWN";
}

/** The failed-race bound: one verdict if all three modes agree, else INSUFFICIENT (failed races). */
export function bounded<V extends string>(byMode: Record<FailedMode, V>): V | "INSUFFICIENT (failed races)" {
  return byMode["as-is"] === byMode.win && byMode.win === byMode.loss ? byMode["as-is"] : "INSUFFICIENT (failed races)";
}

/** Run 1's sustained-leader series (a change at index i when leaders[i] and leaders[i+1] agree), one entry per snapshot. */
export function sustainedSeries(leaders: (string | null)[]): (string | null)[] {
  const out: (string | null)[] = [];
  let current: string | null = null;
  for (let i = 0; i < leaders.length; i++) {
    const l = leaders[i];
    if (l !== null) {
      if (current === null) current = l;
      else if (l !== current && i + 1 < leaders.length && leaders[i + 1] === l) current = l;
    }
    out.push(current);
  }
  return out;
}
