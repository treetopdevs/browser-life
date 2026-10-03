// Sandbox screen for docs/sandbox-ownership.md (exploratory, not registered). Existing machinery only.
//
//   deno run -A tools/own-screen.ts evolve --arms gradient-m3,own-lossy --seeds 1-3 --steps 500000 --checkpoint 50000 --out runs/ownership/screen1
//   deno run -A tools/own-screen.ts read   --out runs/ownership/screen1 [--top 4] [--reps 16] [--snapshots 100000,250000,500000]
//
// evolve: tools/run.ts per (arm, seed), seeds outer; skips a history whose final checkpoint exists,
//   removes an incomplete bundle first (run.ts appends). Bundles land in DIR/screen/<arm>/treatment/seed-<n>/.
// read: for every arm/seed/snapshot with a checkpoint and no cached assay, assays the top lineages
//   (>= 16 cells) with `tools/assay.ts retest` (assay seed0 = 4900001 + offset), caches under DIR/assays/,
//   then rewrites DIR/summary.tsv, DIR/summary.md, DIR/frames.png (the lowest seed at each snapshot) and
//   DIR/frames-seeds.png (every seed at the last snapshot). Rows are arms in both sheets.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { CH, G, M3_FOUNDERS, cellCount, decodeCheckpoint } from "@bl/schema";
import { cellBodies } from "@bl/sim-ref";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const CONTROL = "gradient-m3";
const KNOWN_ARMS = [CONTROL, "own-lossy", "own-match", "own-seasons", "own-genome-1", "own-genome-3", "own-genome-8", "own-injury-light", "own-injury-heavy", "own-injury-coarse", "own-shape", "own-shape-far", "own-cell", "own-cell-wall", "own-cell-injury", "own-cell-wall-injury"];
const KNOWN_SNAPS = [100_000, 250_000, 500_000, 1_000_000];
const a = parseArgs(Deno.args.slice(1), {
  string: ["arms", "seeds", "steps", "checkpoint", "out", "top", "reps", "snapshots"],
  default: { seeds: "1-3", top: "4", reps: "16", snapshots: "100000,250000,500000", checkpoint: "50000" },
});
const cmd = Deno.args[0];
const OUT = a.out ?? (() => { throw new Error("--out DIR required"); })();
const pad = (t: number) => `t${String(t).padStart(9, "0")}.blck`;
const bundle = (arm: string, seed: number) => `${OUT}/screen/${arm}/treatment/seed-${seed}`;
const exists = (p: string) => Deno.stat(p).then(() => true, () => false);
function seedList(s: string): number[] {
  return s.split(",").flatMap((part) => {
    const [lo, hi] = part.split("-").map(Number);
    return hi === undefined ? [lo] : Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
  });
}
async function sh(args: string[], quiet = true): Promise<{ ok: boolean; text: string }> {
  const r = await new Deno.Command(Deno.execPath(), { args, cwd: ROOT, stdout: "piped", stderr: "piped" }).output();
  const text = new TextDecoder().decode(r.stdout) + new TextDecoder().decode(r.stderr);
  if (!r.success && !quiet) console.error(text.split("\n").slice(-15).join("\n"));
  return { ok: r.success, text };
}

// ------------------------------------------------------------------------------------ evolve
async function evolve() {
  const arms = (a.arms ?? "").split(",").filter(Boolean), seeds = seedList(a.seeds), steps = Number(a.steps), ck = Number(a.checkpoint);
  if (!arms.length || !steps) throw new Error("evolve needs --arms and --steps");
  for (const seed of seeds)
    for (const arm of arms) {
      const dir = bundle(arm, seed);
      if (await exists(`${dir}/checkpoints/${pad(steps)}`)) { console.log(`skip ${arm} seed ${seed} (final checkpoint exists)`); continue; }
      if (await exists(dir)) await Deno.remove(dir, { recursive: true });
      const t0 = performance.now();
      const r = await sh(["run", "-A", "tools/run.ts", "--experiment", "screen", "--preset", arm, "--conditions", "treatment", "--seeds", String(seed), "--steps", String(steps), "--census", "1000", "--deep", "10", "--checkpoint", String(ck), "--out", `${OUT.startsWith("/") ? OUT : `${ROOT}/${OUT}`}`], false);
      const wall = (performance.now() - t0) / 1000;
      const m = r.text.match(/done: (\d+) st\/s/);
      if (!r.ok) { console.log(`FAIL ${arm} seed ${seed} after ${wall.toFixed(0)}s`); Deno.exit(1); }
      console.log(`${arm} seed ${seed}: ${wall.toFixed(0)}s wall, ${(steps / wall).toFixed(0)} steps/s wall${m ? `, ${m[1]} st/s in run` : ""}`);
    }
}

// ------------------------------------------------------------------------------------ read
interface Lin { key: string; hi: number; cells: number; hex: string }
interface Stats { B: number; P: number; C: number; A: number; bound48: number; lin16: number; domShare: number; domBirth: number; domMutant: boolean; occupied: number; lineages: Lin[] }
function worldStats(st: ReturnType<typeof decodeCheckpoint>["state"]): Stats {
  const n = cellCount(st.cfg);
  let A = 0, B = 0, C = 0, P = 0, bound48 = 0, occupied = 0;
  const by = new Map<string, Lin>();
  for (let i = 0; i < n; i++) {
    const a_ = st.cells[CH.A * n + i], b = st.cells[CH.B * n + i], c = st.cells[CH.C * n + i], p = st.cells[CH.P * n + i];
    A += a_; B += b; C += c; P += p;
    if (b + p >= 48) bound48++;
    const hi = st.genome[G.LIN_HI * n + i], lo = st.genome[G.LIN_LO * n + i];
    if ((hi | lo) === 0) continue;
    occupied++;
    const key = `${hi}:${lo}`;
    let v = by.get(key);
    if (!v) {
      let hex = "";
      for (let g = G.PARAM0; g < st.genome.length / n; g++) hex += st.genome[g * n + i].toString(16).padStart(8, "0");
      by.set(key, (v = { key, hi, cells: 0, hex }));
    }
    v.cells++;
  }
  const lineages = [...by.values()].sort((x, y) => y.cells - x.cells || (x.key < y.key ? -1 : 1));
  const dom = lineages[0];
  return { B, P, C, A, bound48, lin16: lineages.filter((l) => l.cells >= 16).length, domShare: dom ? dom.cells / occupied : 0, domBirth: dom ? (dom.hi === 0 ? 0 : dom.hi - 1) : 0, domMutant: !!dom && dom.hi > 0, occupied, lineages };
}
interface Cell { arm: string; seed: number; snap: number; assayed: number; surv: number; regen: number; light: number; reps: number; stats: Omit<Stats, "lineages"> }

async function assayOne(arms: string[], arm: string, seed: number, snap: number, snapIdx: number): Promise<Cell | null> {
  const ck = `${bundle(arm, seed)}/checkpoints/${pad(snap)}`;
  if (!(await exists(ck))) return null;
  const dir = `${OUT}/assays/${arm}-s${seed}-t${snap}`;
  const cache = `${dir}/result.json`;
  if (await exists(cache)) return JSON.parse(await Deno.readTextFile(cache));
  const ckState = decodeCheckpoint(await Deno.readFile(ck)).state;
  const stats = worldStats(ckState);
  // Genome semantics that the assay world must share with the evolving world (heritable shape).
  const world = ckState.cfg.shapeReach !== undefined ? { shapeReach: ckState.cfg.shapeReach } : undefined;
  // Declared cells (cellPeriod): an id is one body, so the top four ids would be four bodies. Sixteen
  // bodies at evenly spaced size ranks, four replicates each, sample the population of declared cells
  // with the same 64 tiles. Ranks are over the bodies the pass sees (cellBodies), not over ids' total
  // occupancy, which would admit ids that are only film or fragments.
  const cellArm = ckState.cfg.cellPeriod !== undefined;
  const top = cellArm ? 16 : Number(a.top), reps = cellArm ? 4 : Number(a.reps);
  let picks: Lin[];
  if (cellArm) {
    const byKey = new Map(stats.lineages.map((l) => [l.key, l]));
    const bodies = cellBodies(ckState).sort((x, y) => y.cells - x.cells || x.anchor - y.anchor);
    const ranked = bodies.length > top ? Array.from({ length: top }, (_, k) => bodies[Math.floor(((k + 0.5) * bodies.length) / top)]) : bodies;
    // `cells` in the plan is the body's size. Two sampled bodies may share an id only before the first pass.
    picks = ranked.map((b) => ({ ...byKey.get(`${b.hi}:${b.lo}`)!, cells: b.cells }));
  } else picks = stats.lineages.filter((l) => l.cells >= 16).slice(0, top);
  const armIdx = Math.max(0, arms.indexOf(arm));
  const offset = armIdx * 1000 + seed * 100 + snapIdx * 10; // < 9,999 for <= 10 arms, seeds <= 9, snapshots <= 9; batches add j < 10
  const seed0 = 4_900_001 + offset;
  await Deno.mkdir(dir, { recursive: true });
  let surv = 0, regen = 0, light = 0, nreps = 0, t = 0;
  if (picks.length) {
    await Deno.writeTextFile(`${dir}/plan.json`, JSON.stringify({ seed0, reps, ...(world ? { world } : {}), genomes: picks.map((l, r) => ({ label: `r${r}-${l.key}`, hex: l.hex, cells: l.cells })) }));
    const t0 = performance.now();
    const r = await sh(["run", "-A", "tools/assay.ts", "retest", "--out", `${dir.startsWith("/") ? dir : `${ROOT}/${dir}`}`, "--plan", `${dir.startsWith("/") ? dir : `${ROOT}/${dir}`}/plan.json`], false);
    if (!r.ok) throw new Error(`assay failed for ${arm} seed ${seed} t${snap}`);
    t = (performance.now() - t0) / 1000;
    for await (const f of Deno.readDir(dir)) {
      if (!/^r\d+\.json$/.test(f.name)) continue;
      for (const g of JSON.parse(await Deno.readTextFile(`${dir}/${f.name}`)).genomes) { surv += g.eval.survived; regen += g.eval.regenerated; light += g.eval.lightDependent; nreps += g.eval.reps; }
    }
    console.log(`assayed ${arm} s${seed} t${snap}: ${picks.length} lineages x ${reps} reps in ${t.toFixed(1)}s (${(t / picks.length).toFixed(2)}s/genome)`);
  }
  const { lineages: _l, ...rest } = stats;
  const cell: Cell = { arm, seed, snap, assayed: picks.length, surv, regen, light, reps: nreps, stats: rest };
  await Deno.writeTextFile(cache, JSON.stringify(cell));
  return cell;
}

const rate = (k: number, n: number) => (n ? k / n : NaN);
const f3 = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : "-");
const mean = (xs: number[]) => { const v = xs.filter(Number.isFinite); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN; };

// ---- PNG (pure TS) ----
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b: Uint8Array): number { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
async function encodePng(w: number, h: number, rgb: Uint8Array): Promise<Uint8Array> {
  const raw = new Uint8Array((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  const z = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
    dv.setUint32(0, data.length); for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8); dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length))); return out;
  };
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 2;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", z), chunk("IEND", new Uint8Array(0))];
  const res = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { res.set(p, o); o += p.length; }
  return res;
}
function hsv(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6) % 6, f = h * 6 - Math.floor(h * 6), p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i];
  return [r * 255, g * 255, b * 255];
}
function lowbias(x: number): number { x >>>= 0; x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; x = Math.imul(x, 0x846ca68b); x ^= x >>> 16; return x >>> 0; }

async function frames(file: string, arms: string[], cols: { seed: number; snap: number }[]) {
  const T = 256, gap = 4, W = cols.length * (T + gap) + gap, H = arms.length * (T + gap) + gap;
  const img = new Uint8Array(W * H * 3).fill(40);
  for (let r = 0; r < arms.length; r++)
    for (let c = 0; c < cols.length; c++) {
      const ck = `${bundle(arms[r], cols[c].seed)}/checkpoints/${pad(cols[c].snap)}`;
      if (!(await exists(ck))) continue;
      const st = decodeCheckpoint(await Deno.readFile(ck)).state;
      const n = cellCount(st.cfg), side = Math.round(Math.sqrt(n));
      const x0 = gap + c * (T + gap), y0 = gap + r * (T + gap);
      for (let y = 0; y < Math.min(T, side); y++)
        for (let x = 0; x < Math.min(T, side); x++) {
          const i = y * side + x, hi = st.genome[G.LIN_HI * n + i], lo = st.genome[G.LIN_LO * n + i];
          let px: [number, number, number] = [0, 0, 0];
          if ((hi | lo) !== 0) px = hsv((lowbias(lowbias(hi) ^ lo) % 3600) / 3600, 0.85, Math.min(1, 0.15 + (st.cells[CH.B * n + i] + st.cells[CH.P * n + i]) / 96));
          const o = ((y0 + y) * W + x0 + x) * 3; img[o] = px[0]; img[o + 1] = px[1]; img[o + 2] = px[2];
        }
    }
  await Deno.writeFile(`${OUT}/${file}`, await encodePng(W, H, img));
}

async function read() {
  const snaps = a.snapshots.split(",").map(Number);
  const found: string[] = [];
  try { for await (const e of Deno.readDir(`${OUT}/screen`)) if (e.isDirectory) found.push(e.name); } catch { /* none */ }
  const arms = [...KNOWN_ARMS.filter((x) => found.includes(x)), ...found.filter((x) => !KNOWN_ARMS.includes(x)).sort()];
  const allArms = [...KNOWN_ARMS, ...arms.filter((x) => !KNOWN_ARMS.includes(x))];
  const cells: Cell[] = [];
  for (const arm of arms) {
    const seeds: number[] = [];
    for await (const e of Deno.readDir(`${OUT}/screen/${arm}/treatment`)) { const m = e.name.match(/^seed-(\d+)$/); if (m) seeds.push(Number(m[1])); }
    for (const seed of seeds.sort((x, y) => x - y))
      for (const snap of snaps) {
        const k = KNOWN_SNAPS.indexOf(snap);
        const c = await assayOne(allArms, arm, seed, snap, k >= 0 ? k : (snap / 1000) % 10);
        if (c) cells.push(c);
      }
  }
  const fSum = (k: "survived" | "regenerated" | "lightDependent") => M3_FOUNDERS.reduce((s, f) => s + f.retest[k], 0), fReps = M3_FOUNDERS.reduce((s, f) => s + f.retest.reps, 0);
  const fReg = fSum("regenerated") / fReps;
  const ctl = (s: number, t: number) => cells.find((c) => c.arm === CONTROL && c.seed === s && c.snap === t);
  const bm = (c: Cell) => c.stats.B + c.stats.P;
  const waste = (c: Cell) => c.stats.C / (c.stats.A + c.stats.B + c.stats.C + c.stats.P);
  const ratio = (c: Cell) => { const k = ctl(c.seed, c.snap); return k && bm(k) ? bm(c) / bm(k) : NaN; };

  const tsv = ["arm\tseed\tsnapshot\tlineages_assayed\tregenerated\tsurvived\tlightDependent\tfounder_regenerated\ttotalB\ttotalP\ttotalC\ttotalA\tcells_BP_ge48\tlineages_ge16\tdom_share\tdom_birth\tdom_mutant"];
  for (const c of cells) tsv.push([c.arm, c.seed, c.snap, c.assayed, f3(rate(c.regen, c.reps)), f3(rate(c.surv, c.reps)), f3(rate(c.light, c.reps)), f3(fReg), c.stats.B, c.stats.P, c.stats.C, c.stats.A, c.stats.bound48, c.stats.lin16, f3(c.stats.domShare), c.stats.domBirth, c.stats.domMutant ? 1 : 0].join("\t"));
  await Deno.writeTextFile(`${OUT}/summary.tsv`, tsv.join("\n") + "\n");

  const md: string[] = [`# Ownership screen summary`, ``, `Founder baseline regenerated (12 M3 founders, 32 reps): ${f3(fReg)}. Regenerated = pooled over assayed lineages (top ${a.top}, >=16 cells, ${a.reps} reps).`];
  const snapsPresent = snaps.filter((t) => cells.some((c) => c.snap === t));
  const seedsAll = [...new Set(cells.map((c) => c.seed))].sort((x, y) => x - y);
  for (const t of snapsPresent) {
    md.push(``, `## Step ${t}`, ``, `| arm | ${seedsAll.map((s) => `regen s${s}`).join(" | ")} | mean | bound mass vs control | waste share | dominant is mutant | founders |`, `|---|${seedsAll.map(() => "---").join("|")}|---|---|---|---|---|`);
    for (const arm of arms) {
      const cs = cells.filter((c) => c.arm === arm && c.snap === t);
      if (!cs.length) continue;
      const rg = seedsAll.map((s) => { const c = cs.find((x) => x.seed === s); return c ? rate(c.regen, c.reps) : NaN; });
      md.push(`| ${arm} | ${rg.map(f3).join(" | ")} | ${f3(mean(rg))} | ${arm === CONTROL ? "1.000" : f3(mean(cs.map(ratio)))} | ${f3(mean(cs.map(waste)))} | ${cs.filter((c) => c.stats.domMutant).length}/${cs.length} | ${f3(fReg)} |`);
    }
  }
  md.push(``, `## Readout`, ``);
  const common = [...snapsPresent].reverse().find((t) => arms.every((arm) => cells.some((c) => c.arm === arm && c.snap === t)));
  if (common === undefined || arms.length < 2) md.push(`Not available: need the control plus at least one other arm at a common snapshot (arms present: ${arms.join(", ") || "none"}).`);
  else {
    md.push(`Latest snapshot present for all arms: ${common}. Rule: >= 2/3 of seeds with regen >= control + 0.2, bound mass >= 0.5 of control, dominant lineages mutants.`, ``);
    for (const arm of arms.filter((x) => x !== CONTROL)) {
      const cs = cells.filter((c) => c.arm === arm && c.snap === common);
      const above = cs.filter((c) => { const k = ctl(c.seed, common); return k && rate(c.regen, c.reps) - rate(k.regen, k.reps) >= 0.2; }).length;
      const need = Math.ceil((2 * cs.length) / 3), mr = mean(cs.map(ratio)), mut = cs.filter((c) => c.stats.domMutant).length;
      const verdict = !(mr >= 0.1) || mut === 0 ? "Dead end" : above >= need && mr >= 0.5 && mut >= need ? "Promising" : "Unclear";
      md.push(`- ${arm}: **${verdict}**. seeds above control+0.2: ${above}/${cs.length}; bound mass ratio ${f3(mr)}; dominant mutant ${mut}/${cs.length}.`);
    }
  }
  await Deno.writeTextFile(`${OUT}/summary.md`, md.slice(0, 60).join("\n") + "\n");
  await frames("frames.png", arms, snapsPresent.map((snap) => ({ seed: seedsAll[0] ?? 1, snap })));
  if (snapsPresent.length) await frames("frames-seeds.png", arms, seedsAll.map((seed) => ({ seed, snap: snapsPresent[snapsPresent.length - 1] })));
  console.log(`wrote summary.tsv, summary.md, frames.png, frames-seeds.png (${cells.length} cells, ${arms.length} arms)`);
}

if (cmd === "evolve") await evolve();
else if (cmd === "read") await read();
else { console.error("usage: own-screen.ts evolve|read ... (see header)"); Deno.exit(2); }
