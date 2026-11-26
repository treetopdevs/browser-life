/**
 * Post-hoc, outcome-exposed supplement (see docs/assembly-observer-2026-11-02/amendment-1-exact12.md): re-score the
 * random-dup-12 motifs with the EXACT solver (12 cells is within its reach) to measure how far the beam bound that selected
 * them is from exact. Not part of evidence.json and not a verdict. node tools/assembly/exact12-check.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { exactConstruction } from "../../packages/metrics/src/assembly/exact.ts";
import { keyCells } from "../../packages/metrics/src/assembly/grammar.ts";
import type { Payload } from "../../packages/metrics/src/assembly/observer.ts";

const dir = new URL("../../docs/assembly-observer-2026-11-02/", import.meta.url).pathname;
const p = JSON.parse(readFileSync(`${dir}evidence.json`, "utf8")) as Payload;
const rows: { replicate: number; bound: number; exact: number | null; nodes: number }[] = [];
for (const cls of ["random-dup-12", "hier-12"]) {
  for (const r of p.calibration.find((c) => c.id === cls)!.replicates) {
    const m = r.meta.motifs[0];
    const e = exactConstruction(keyCells(m.key), { conn: 4, group: "T", budget: 50_000_000 });
    rows.push({ replicate: r.replicate, bound: m.a, exact: e.exact ? e.cost : null, nodes: e.nodes, ...{ cls } } as never);
  }
}
const out = rows as unknown as { cls: string; replicate: number; bound: number; exact: number | null }[];
const summarise = (cls: string) => { const v = out.filter((x) => x.cls === cls); return { cls, bound: v.map((x) => x.bound), exact: v.map((x) => x.exact) }; };
const res = { note: "outcome-exposed supplement; not part of the sealed evidence", random_dup_12: summarise("random-dup-12"), hier_12: summarise("hier-12") };
writeFileSync(`${dir}amendment-1-exact12.json`, JSON.stringify(res, null, 1) + "\n");
console.log(JSON.stringify(res));
