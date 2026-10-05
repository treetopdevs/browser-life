// Sandbox one-off (docs/sandbox-ownership.md): genetic purity of bodies (census individuals) per arm, from checkpoints.
//   deno run -A tools/own-purity.ts > runs/ownership/purity.tsv
import { decodeCheckpoint } from "@bl/schema";
import { census, individuals } from "@bl/metrics";
const R = new URL("../runs/ownership", import.meta.url).pathname;
const sets: [string, string][] = [["screen2", "gradient-m3"], ["screen2", "own-lossy"], ["screen2", "own-match"], ["screen3", "own-genome-1"], ["screen3", "own-genome-3"], ["screen3", "own-genome-8"]];
console.log(["arm", "seed", "snap", "bodies", "cells_med", "pure_share", "purity_mean", "purity_p10", "cells_in_bodies"].join("\t"));
for (const [scr, arm] of sets)
  for (const seed of [1, 2, 3])
    for (const snap of [250000, 1000000]) {
      const st = decodeCheckpoint(await Deno.readFile(`${R}/${scr}/screen/${arm}/treatment/seed-${seed}/checkpoints/t${String(snap).padStart(9, "0")}.blck`)).state;
      const c = census({ cfg: st.cfg, step: snap, cells: st.cells, genomeHead: st.genome });
      const ind = individuals(c);
      const pur = ind.map((k) => k.purity).sort((x, y) => x - y), sz = ind.map((k) => k.cells).sort((x, y) => x - y);
      const q = (xs: number[], p: number) => xs.length ? xs[Math.min(xs.length - 1, Math.floor(p * xs.length))] : NaN;
      console.log([arm, seed, snap, ind.length, q(sz, 0.5), (pur.filter((p) => p === 1).length / ind.length).toFixed(3), (pur.reduce((s, p) => s + p, 0) / ind.length).toFixed(3), q(pur, 0.1).toFixed(3), sz.reduce((s, x) => s + x, 0)].join("\t"));
    }
