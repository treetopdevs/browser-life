// Cells sandbox (docs/sandbox-cells.md): body geometry and kernel ring weights per arm, from checkpoints.
//
//   deno run -A tools/own-shape.ts --out runs/cells/screen5 [--arms gradient-m3,own-shape] [--seeds 1-3] [--snapshots 250000,500000,1000000]
//
// Writes DIR/shape.tsv (overwritten per invocation), one row per (arm, seed, snapshot):
//   bodies            census individuals (components of B+P >= 48 with mass >= 256)
//   cells_p10/med/p90 body size in cells; size_spread = p90 / p10
//   elong_med/p90     body elongation, sqrt of the ratio of the principal second moments (1 = round)
//   bound_in_bodies   share of all bound mass that sits in bodies
//   ring_share        share of occupied cells whose genome's ring weights are not the neutral (64, 64, 0)
//   body_ring_share   share of bodies whose dominant lineage has non-neutral ring weights
//   w0/w1/w2          mean ring weights over occupied cells
//   off0/off1/off2    mean absolute distance of each ring weight from neutral over occupied cells
//   ring_types        distinct ring-weight triples each holding >= 1% of occupied cells
//   top_rings         the three commonest triples with their shares
//   body_types        ring-weight triples each dominant in >= 10% of bodies
//   type_sizes        for the three commonest among bodies: triple:bodies:median cells
//   cells_large       share of body cells in bodies of >= 39 cells (the "large" threshold of the readout)
//   cells_long        share of body cells in bodies with elongation >= 2
//   max_cells         the largest body
// cells_large and cells_long weight by cells, not by body: a few labyrinths or stripes can hold
// much of the living area and leave every per-body median where it was. Added after screen 5's read.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { CH, G, SHAPE_BASE, cellCount, decodeCheckpoint, worldW } from "@bl/schema";

const a = parseArgs(Deno.args, { string: ["out", "arms", "seeds", "snapshots"], default: { seeds: "1-3", snapshots: "250000,500000,1000000" } });
const OUT = a.out ?? (() => { throw new Error("--out DIR required"); })();
const pad = (t: number) => `t${String(t).padStart(9, "0")}.blck`;
const exists = (p: string) => Deno.stat(p).then(() => true, () => false);
const seeds = a.seeds.split(",").flatMap((part) => { const [lo, hi] = part.split("-").map(Number); return hi === undefined ? [lo] : Array.from({ length: hi - lo + 1 }, (_, k) => lo + k); });
const snaps = a.snapshots.split(",").map(Number);
let arms = (a.arms ?? "").split(",").filter(Boolean);
if (!arms.length) for await (const e of Deno.readDir(`${OUT}/screen`)) if (e.isDirectory) arms.push(e.name);
arms = arms.sort();
const q = (xs: number[], p: number) => (xs.length ? xs[Math.min(xs.length - 1, Math.floor(p * xs.length))] : NaN);
const f = (x: number, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : "-");
const s8 = (b: number) => ((b & 0xff) > 127 ? (b & 0xff) - 256 : b & 0xff);

const rows = [["arm", "seed", "snap", "bodies", "cells_p10", "cells_med", "cells_p90", "size_spread", "elong_med", "elong_p90", "bound_in_bodies", "occupied", "ring_share", "body_ring_share", "w0", "w1", "w2", "off0", "off1", "off2", "ring_types", "top_rings", "body_types", "type_sizes", "cells_large", "cells_long", "max_cells"].join("\t")];
for (const arm of arms)
  for (const seed of seeds)
    for (const snap of snaps) {
      const ck = `${OUT}/screen/${arm}/treatment/seed-${seed}/checkpoints/${pad(snap)}`;
      if (!(await exists(ck))) continue;
      const st = decodeCheckpoint(await Deno.readFile(ck)).state;
      const cfg = st.cfg, n = cellCount(cfg), W = worldW(cfg), { tileW, tileH } = cfg;
      const far = cfg.shapeReach !== undefined && cfg.shapeReach > cfg.kernelRadius;
      const mass = (i: number) => st.cells[CH.B * n + i] + st.cells[CH.P * n + i];
      const weights = (i: number): [number, number, number] => {
        const b = cfg.shapeReach === undefined ? 0 : st.genome[G.PARAM1 * n + i] >>> 8;
        return [Math.max(SHAPE_BASE + s8(b), 0), Math.max(SHAPE_BASE + s8(b >>> 8), 0), far ? Math.max(s8(b >>> 16), 0) : 0];
      };
      const neutral = (w: number[]) => w[0] === SHAPE_BASE && w[1] === SHAPE_BASE && w[2] === 0;
      // Ring weights over occupied cells.
      let occupied = 0, ringed = 0, bound = 0;
      const wsum = [0, 0, 0], osum = [0, 0, 0], base = [SHAPE_BASE, SHAPE_BASE, 0];
      const byType = new Map<string, number[]>();
      const types = new Map<string, number>();
      for (let i = 0; i < n; i++) {
        bound += mass(i);
        if ((st.genome[G.LIN_HI * n + i] | st.genome[G.LIN_LO * n + i]) === 0) continue;
        occupied++;
        const w = weights(i);
        if (!neutral(w)) ringed++;
        for (let k = 0; k < 3; k++) { wsum[k] += w[k]; osum[k] += Math.abs(w[k] - base[k]); }
        const key = w.join("/");
        types.set(key, (types.get(key) ?? 0) + 1);
      }
      const top = [...types.entries()].sort((x, y) => y[1] - x[1]);
      // Bodies: the census's components (4-connected, B+P >= 48, mass >= 256), with unwrapped offsets for moments.
      const label = new Int8Array(n);
      const queue = new Int32Array(n), ox = new Int32Array(n), oy = new Int32Array(n);
      const sizes: number[] = [], elong: number[] = [];
      let inBodies = 0, bodyRinged = 0, bodyCells = 0, largeCells = 0, longCells = 0, maxCells = 0;
      for (let start = 0; start < n; start++) {
        if (label[start] || mass(start) < 48) continue;
        let head = 0, tail = 0;
        queue[tail++] = start; label[start] = 1; ox[start] = 0; oy[start] = 0;
        const tx = Math.floor((start % W) / tileW), ty = Math.floor(Math.floor(start / W) / tileH);
        let m = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
        const lins = new Map<string, [number, number]>();
        while (head < tail) {
          const i = queue[head++], x = i % W, y = Math.floor(i / W), mi = mass(i);
          m += mi; sx += ox[i]; sy += oy[i]; sxx += ox[i] * ox[i]; syy += oy[i] * oy[i]; sxy += ox[i] * oy[i];
          const hi = st.genome[G.LIN_HI * n + i], lo = st.genome[G.LIN_LO * n + i];
          if (hi | lo) { const key = `${hi}:${lo}`; const v = lins.get(key); if (v) v[0]++; else lins.set(key, [1, i]); }
          const lx = x - tx * tileW, ly = y - ty * tileH;
          for (let d = 0; d < 4; d++) {
            const dx = d === 0 ? 1 : d === 1 ? -1 : 0, dy = d === 2 ? 1 : d === 3 ? -1 : 0;
            const j = (ty * tileH + ((ly + dy + tileH) % tileH)) * W + tx * tileW + ((lx + dx + tileW) % tileW);
            if (label[j] || mass(j) < 48) continue;
            label[j] = 1; ox[j] = ox[i] + dx; oy[j] = oy[i] + dy; queue[tail++] = j;
          }
        }
        if (m < 256) continue;
        const c = tail;
        sizes.push(c);
        inBodies += m;
        const vx = sxx / c - (sx / c) ** 2 + 1 / 12, vy = syy / c - (sy / c) ** 2 + 1 / 12, vxy = sxy / c - (sx / c) * (sy / c);
        const tr = vx + vy, det = vx * vy - vxy * vxy, disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
        const e = Math.sqrt((tr / 2 + disc) / Math.max(tr / 2 - disc, 1e-9));
        elong.push(e);
        bodyCells += c; if (c >= 39) largeCells += c; if (e >= 2) longCells += c; if (c > maxCells) maxCells = c;
        let dom = -1, domN = 0;
        for (const [, [cnt, i]] of lins) if (cnt > domN) [domN, dom] = [cnt, i];
        if (dom >= 0) {
          const w = weights(dom), key = w.join("/");
          if (!neutral(w)) bodyRinged++;
          const v = byType.get(key);
          if (v) v.push(c); else byType.set(key, [c]);
        }
      }
      sizes.sort((x, y) => x - y); elong.sort((x, y) => x - y);
      const bt = [...byType.entries()].sort((x, y) => y[1].length - x[1].length);
      rows.push([arm, seed, snap, sizes.length, q(sizes, 0.1), q(sizes, 0.5), q(sizes, 0.9), f(q(sizes, 0.9) / q(sizes, 0.1), 2), f(q(elong, 0.5), 2), f(q(elong, 0.9), 2), f(inBodies / bound), occupied, f(ringed / occupied), f(bodyRinged / sizes.length),
        f(wsum[0] / occupied, 1), f(wsum[1] / occupied, 1), f(wsum[2] / occupied, 1), f(osum[0] / occupied, 1), f(osum[1] / occupied, 1), f(osum[2] / occupied, 1),
        top.filter(([, c]) => c >= 0.01 * occupied).length, top.slice(0, 3).map(([k, c]) => `${k}:${(c / occupied).toFixed(2)}`).join(";"),
        bt.filter(([, v]) => v.length >= 0.1 * sizes.length).length, bt.slice(0, 3).map(([k, v]) => `${k}:${v.length}:${q(v.sort((x, y) => x - y), 0.5)}`).join(";"),
        f(largeCells / bodyCells), f(longCells / bodyCells), maxCells].join("\t"));
    }
await Deno.writeTextFile(`${OUT}/shape.tsv`, rows.join("\n") + "\n");
console.log(rows.join("\n"));
