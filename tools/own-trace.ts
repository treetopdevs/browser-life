// Sandbox trace for docs/sandbox-ownership.md (exploratory, not registered). Reads checkpoints and
// mutations.tsv of own-screen bundles; no GPU, no replay.
//
//   deno run -A tools/own-trace.ts --out runs/ownership/screen2 [--arms gradient-m3,own-match] [--seeds 1-3]
//     [--snapshots 250000,500000,750000,1000000] [--tol 8] [--detail own-match:1:1000000]
//
// Per (arm, seed, snapshot): which founders the living cells descend from, how many growth-parameter
// (mu, sigma) classes coexist, how often neighbouring occupied cells of different lineage are
// non-kin under the growth test (|dmu| <= tol, |dsigma| <= tol >> 2), and how many genome words
// differ between such neighbours (the scale a whole-genome kin tolerance has to sit on).
// Writes DIR/trace.tsv and prints it; --detail prints the assayed lineages of one snapshot.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { G, GENOME_CHANNELS, cellCount, decodeCheckpoint, worldW } from "@bl/schema";

const a = parseArgs(Deno.args, { string: ["out", "arms", "seeds", "snapshots", "tol", "detail"], default: { arms: "gradient-m3,own-match", seeds: "1-3", snapshots: "250000,500000,750000,1000000", tol: "8" } });
const OUT = a.out ?? (() => { throw new Error("--out DIR required"); })();
const TOL = Number(a.tol), TOLS = TOL >>> 2;
const pad = (t: number) => `t${String(t).padStart(9, "0")}.blck`;
const bundle = (arm: string, seed: number) => `${OUT}/screen/${arm}/treatment/seed-${seed}`;
const seeds = a.seeds.split(",").flatMap((p) => { const [lo, hi] = p.split("-").map(Number); return hi === undefined ? [lo] : Array.from({ length: hi - lo + 1 }, (_, k) => lo + k); });
const exists = (p: string) => Deno.stat(p).then(() => true, () => false);

async function parents(dir: string): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  const text = await Deno.readTextFile(`${dir}/mutations.tsv`);
  let first = true;
  for (const l of text.split("\n")) {
    if (first) { first = false; continue; }
    if (!l) continue;
    const f = l.split("\t");
    const c = `${f[0]}:${f[1]}`;
    if (!m.has(c)) m.set(c, `${f[2]}:${f[3]}`);
  }
  return m;
}
function rooter(parent: Map<string, string>) {
  const memo = new Map<string, { root: string; depth: number }>();
  return (key: string) => {
    const path: string[] = [];
    let k = key, hit = memo.get(k);
    while (!hit) {
      const p = parent.get(k);
      if (p === undefined) { hit = { root: k, depth: 0 }; memo.set(k, hit); break; }
      path.push(k); k = p; hit = memo.get(k);
    }
    let d = hit.depth;
    for (let i = path.length - 1; i >= 0; i--) memo.set(path[i], { root: hit.root, depth: ++d });
    return memo.get(key)!;
  };
}
const q = (xs: number[], p: number) => xs.length ? xs[Math.min(xs.length - 1, Math.floor(p * xs.length))] : NaN;
const f3 = (x: number) => Number.isFinite(x) ? x.toFixed(3) : "na";

interface Row { [k: string]: string | number }
const rows: Row[] = [];
for (const arm of a.arms.split(","))
  for (const seed of seeds) {
    const dir = bundle(arm, seed);
    if (!(await exists(`${dir}/mutations.tsv`))) continue;
    const rootOf = rooter(await parents(dir));
    for (const snap of a.snapshots.split(",").map(Number)) {
      const path = `${dir}/checkpoints/${pad(snap)}`;
      if (!(await exists(path))) continue;
      const st = decodeCheckpoint(await Deno.readFile(path)).state;
      const cfg = st.cfg, n = cellCount(cfg), W = worldW(cfg), H = n / W, gen = st.genome;
      const occ = (i: number) => (gen[G.LIN_HI * n + i] | gen[G.LIN_LO * n + i]) !== 0;
      const keyOf = (i: number) => `${gen[G.LIN_HI * n + i]}:${gen[G.LIN_LO * n + i]}`;
      const nb = (x: number, y: number, dx: number, dy: number) => {
        const tx = Math.floor(x / cfg.tileW), ty = Math.floor(y / cfg.tileH);
        return (ty * cfg.tileH + (y - ty * cfg.tileH + dy + cfg.tileH) % cfg.tileH) * W + tx * cfg.tileW + (x - tx * cfg.tileW + dx + cfg.tileW) % cfg.tileW;
      };
      const wordDist = (i: number, j: number) => { let d = 0; for (let g = G.PARAM0; g < GENOME_CHANNELS; g++) if (gen[g * n + i] !== gen[g * n + j]) d++; return d; };
      // The run's own kin test when it has a genome one; otherwise the growth test at --tol.
      const genomeKin = cfg.takeoverKin === "genome", gTol = cfg.takeoverTol ?? 0;
      const kin = (i: number, j: number) => {
        if (genomeKin) return wordDist(i, j) <= gTol;
        const pi = gen[G.PARAM0 * n + i], pj = gen[G.PARAM0 * n + j];
        return Math.abs((pi & 0xffff) - (pj & 0xffff)) <= TOL && Math.abs((pi >>> 16) - (pj >>> 16)) <= TOLS;
      };
      const byteDist = (i: number, j: number) => {
        let d = 0;
        for (let g = G.PARAM0; g < GENOME_CHANNELS; g++) { let x = gen[g * n + i] ^ gen[g * n + j]; while (x) { if (x & 0xff) d++; x >>>= 8; } }
        return d;
      };
      let occupied = 0;
      const rootCells = new Map<string, number>(), classCells = new Map<number, number>(), linCells = new Map<string, number>(), linDepth: number[] = [];
      const border = new Uint8Array(n); // 1 = has a non-kin occupied neighbour
      let diffPairs = 0, nonKinPairs = 0, borderCells = 0, mixedCells = 0, crossRootPairs = 0;
      const dSame: number[] = [], dCross: number[] = [], bSame: number[] = [];
      const linBorder = new Map<string, number>();
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          if (!occ(i)) continue;
          occupied++;
          const k = keyOf(i), r = rootOf(k);
          rootCells.set(r.root, (rootCells.get(r.root) ?? 0) + 1);
          if (!linCells.has(k)) linDepth.push(r.depth);
          linCells.set(k, (linCells.get(k) ?? 0) + 1);
          const p0 = gen[G.PARAM0 * n + i];
          classCells.set(p0, (classCells.get(p0) ?? 0) + 1);
          let anyNonKin = false, anyDiff = false;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue;
              const j = nb(x, y, dx, dy);
              if (!occ(j)) continue;
              if (gen[G.LIN_HI * n + j] === gen[G.LIN_HI * n + i] && gen[G.LIN_LO * n + j] === gen[G.LIN_LO * n + i]) continue;
              anyDiff = true; diffPairs++;
              const cross = rootOf(keyOf(j)).root !== r.root;
              if (cross) crossRootPairs++;
              if (!kin(i, j)) { nonKinPairs++; anyNonKin = true; }
              if (j > i) { const d = wordDist(i, j); (cross ? dCross : dSame).push(d); if (!cross) bSame.push(byteDist(i, j)); }
            }
          if (anyDiff) mixedCells++;
          if (anyNonKin) { borderCells++; border[i] = 1; linBorder.set(k, (linBorder.get(k) ?? 0) + 1); }
        }
      // Probability that two random occupied cells are non-kin under the growth test.
      const cls = [...classCells.entries()];
      let nk = 0;
      for (const [pa, ca] of cls) for (const [pb, cb] of cls) if (!(Math.abs((pa & 0xffff) - (pb & 0xffff)) <= TOL && Math.abs((pa >>> 16) - (pb >>> 16)) <= TOLS)) nk += ca * cb;
      const roots = [...rootCells.entries()].sort((x, y) => y[1] - x[1]);
      const topCls = cls.sort((x, y) => y[1] - x[1]).slice(0, 4).map(([p, c]) => `${p & 0xffff}/${p >>> 16}:${(c / occupied).toFixed(2)}`).join(" ");
      dSame.sort((x, y) => x - y); dCross.sort((x, y) => x - y); bSame.sort((x, y) => x - y); linDepth.sort((x, y) => x - y);
      rows.push({
        arm, seed, snapshot: snap, kin_test: genomeKin ? `genome<=${gTol}` : `growth<=${TOL}`, occupied, lineages: linCells.size,
        roots: roots.map(([r, c]) => `f${r.split(":")[1]}:${(c / occupied).toFixed(2)}`).filter((s) => !s.endsWith(":0.00")).join(" "),
        growth_classes: classCells.size, top_classes: topCls,
        p_nonkin_global: genomeKin ? "na" : f3(nk / (occupied * occupied)),
        mixed_cells: f3(mixedCells / occupied), border_cells: f3(borderCells / occupied),
        nonkin_of_diff_pairs: f3(nonKinPairs / diffPairs), cross_root_of_diff_pairs: f3(crossRootPairs / diffPairs),
        depth_med: q(linDepth, 0.5), depth_p90: q(linDepth, 0.9),
        wd_same_med: q(dSame, 0.5), wd_same_p90: q(dSame, 0.9), wd_same_max: dSame.at(-1) ?? "na",
        bd_same_med: q(bSame, 0.5), bd_same_p90: q(bSame, 0.9),
        wd_cross_med: q(dCross, 0.5), wd_cross_min: dCross[0] ?? "na",
      });
      if (a.detail === `${arm}:${seed}:${snap}`) {
        const dirA = `${OUT}/assays/${arm}-s${seed}-t${snap}`;
        if (await exists(`${dirA}/r0.json`)) {
          const r0 = JSON.parse(await Deno.readTextFile(`${dirA}/r0.json`));
          console.log(`# assayed lineages of ${arm} seed ${seed} at ${snap}: key cells root depth mu/sigma regenerated border_share`);
          for (const g of r0.genomes) {
            const key = g.label.replace(/^r\d+-/, ""), r = rootOf(key), p0 = parseInt(g.hex.slice(0, 8), 16);
            console.log([key, linCells.get(key), `f${r.root.split(":")[1]}`, r.depth, `${p0 & 0xffff}/${p0 >>> 16}`, `${g.eval.regenerated}/${g.eval.reps}`, f3((linBorder.get(key) ?? 0) / (linCells.get(key) ?? 1))].join("\t"));
          }
        }
      }
    }
  }
const cols = Object.keys(rows[0] ?? {});
const tsv = [cols.join("\t"), ...rows.map((r) => cols.map((c) => r[c]).join("\t"))].join("\n") + "\n";
await Deno.writeTextFile(`${OUT}/trace.tsv`, tsv);
console.log(tsv);
