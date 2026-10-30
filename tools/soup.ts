// Runs a BFF program soup (tools/soup/bff.ts, a byte-exact port of Google's
// cubff) and logs when self-replicators take over.
//
//   deno run -A tools/soup.ts --seed 1 [--out runs/soup/noheads/seed-1]
//     [--num-log2 17] [--lang noheads|heads] [--epochs 16384] [--every 64]
//     [--mutation 0.000244140625] [--transition 1] [--after 1024] [--save 2048]
//     [--load runs/soup/noheads/seed-1/soup-4096.bin] [--cpu]
//   deno run -A tools/soup.ts --seed 1 --grid 240x135 [--radius 2] [--frame 256]
//
// --grid makes a spatial soup (cubff --interaction_pattern with
// make_2d_pattern.py; the paper's grid is 240x135, radius 2): programs only
// meet neighbours, and frames/<epoch>.png draws the grid every --frame epochs
// (each program an 8x8 block of byte colours, as cubff --draw_to_2d).
//
// Runs on WebGPU (tools/soup/gpu.ts, byte-identical to the CPU port) unless
// --cpu is given.
//
// Writes log.csv (cubff's columns epoch,brotli_size,soup_size,higher_entropy,
// then distinct programs, the most common program's share, instructions per
// pair and wall seconds), soup-<epochs done>.bin snapshots every --save epochs
// and at the transition, and transition.json with the epoch and the most
// common program when higher-order entropy first exceeds --transition (bits
// per byte). transition.json also records copyScore: how much of a random
// partner the most common program overwrites with a copy of itself (near 1 for
// a self-replicator, near 0 for an inert but repetitive soup), because high
// entropy alone does not prove replication. The run stops at the first census
// at least --after epochs past the transition, or at --epochs (always measured).
// --load resumes from a snapshot (the epoch comes from its file name; all
// randomness is keyed on seed and epoch, so a resumed run equals a continuous
// one, and an earlier transition.json in --out is kept). higher_entropy matches cubff only with the C brotli CLI installed
// (brew install brotli); otherwise it falls back to a slightly different
// encoder and says so.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { copyScore, DEFAULT_MUTATION, type Grid, type Lang, MAX_NUM, show, Soup, TAPE } from "./soup/bff.ts";
import { drawGrid, encodePng } from "./soup/png.ts";
import { GpuSoup, soupDevice } from "./soup/gpu.ts";
import { brotliSizeC, census, stats } from "./soup/stats.ts";

const a = parseArgs(Deno.args, {
  boolean: ["cpu"],
  string: ["seed", "out", "num-log2", "lang", "epochs", "every", "mutation", "transition", "after", "save", "load", "grid", "radius", "frame"],
  default: { seed: "0", "num-log2": "17", lang: "noheads", epochs: "16384", every: "64", transition: "1", after: "1024", save: "2048", radius: "2", frame: "256" },
});
const seed = Number(a.seed);
const lang = a.lang as Lang;
if (lang !== "noheads" && lang !== "heads") throw new Error("--lang must be noheads or heads");
const log2 = Number(a["num-log2"]);
if (!Number.isInteger(log2) || log2 < 1 || 2 ** log2 > MAX_NUM) throw new Error("--num-log2 must be an integer in [1, 24]");
let grid: Grid | undefined;
if (a.grid) {
  const m = a.grid.match(/^(\d+)x(\d+)$/);
  if (!m) throw new Error("--grid expects WIDTHxHEIGHT, e.g. 240x135");
  grid = { width: Number(m[1]), height: Number(m[2]), radius: Number(a.radius) };
  if (!Number.isInteger(grid.radius) || grid.radius! < 1) throw new Error("--radius must be a positive integer");
}
const num = grid ? grid.width * grid.height : 2 ** log2;
if (num > MAX_NUM || num % 2 !== 0) throw new Error("the soup must have an even number of programs, at most 2^24");
const frame = Number(a.frame);
const mutation = a.mutation !== undefined ? Math.round(Number(a.mutation) * 2 ** 30) : DEFAULT_MUTATION;
const [maxEpochs, every, after, save] = [a.epochs, a.every, a.after, a.save].map(Number);
for (const [k, v] of Object.entries({ epochs: maxEpochs, every, after, save })) if (!Number.isInteger(v) || v < (k === "after" ? 0 : 1)) throw new Error(`--${k} must be a positive integer`);
const threshold = Number(a.transition);
if (String(a.transition).trim() === "" || !Number.isFinite(threshold)) throw new Error("--transition must be a number (write --transition=-1 for negatives)");
if (!Number.isInteger(frame) || frame < 1) throw new Error("--frame must be a positive integer");
const out = a.out ?? `runs/soup/${grid ? `grid-${grid.width}x${grid.height}-r${grid.radius}-` : ""}${lang}/seed-${seed}`;
await Deno.mkdir(out, { recursive: true });

if ((await brotliSizeC(new Uint8Array(16))) === null) console.warn("no brotli CLI: higher_entropy will not match cubff exactly");

const gpu = a.cpu ? null : await GpuSoup.create(await soupDevice(), { num, seed, lang, mutation, grid });
const soup = gpu ? gpu.cpu : new Soup({ num, seed, lang, mutation, grid });
if (a.load) {
  const m = a.load.match(/soup-(\d+)\.bin$/);
  if (!m) throw new Error("--load expects a soup-<epoch>.bin file");
  const bytes = await Deno.readFile(a.load);
  if (bytes.length !== num * TAPE) throw new Error("snapshot size does not match --num-log2");
  soup.programs.set(bytes);
  soup.epoch = Number(m[1]);
  gpu?.upload();
}
const logPath = `${out}/log.csv`;
const fresh = !a.load;
const transitionPath = `${out}/transition.json`;
let transitionAt: number | null = null;
if (fresh) await Deno.remove(transitionPath).catch(() => {});
else {
  try {
    const prev = JSON.parse(await Deno.readTextFile(transitionPath));
    if (prev.epoch <= soup.epoch) transitionAt = prev.epoch;
    else await Deno.remove(transitionPath); // recorded after this snapshot: not this run's history
  } catch { /* no earlier transition */ }
}
if (fresh) await Deno.writeTextFile(logPath, "epoch,brotli_size,soup_size,higher_entropy,distinct,top_share,ops_per_run,seconds\n");
await Deno.writeTextFile(`${out}/params.json`, JSON.stringify({ seed, lang, num, grid: grid ?? null, mutation, mutationProb: mutation / 2 ** 30, maxEpochs, threshold, every, after, save, loadedFrom: a.load ?? null, port: "cubff bff.inc.h + common_language.h" }, null, 2) + "\n");

const framed = (e: number) => grid !== undefined && e % frame === 0;
let lastFrame = -1;
const writeFrame = async () => {
  if (!grid || lastFrame === soup.epoch) return;
  lastFrame = soup.epoch;
  await Deno.mkdir(`${out}/frames`, { recursive: true });
  const { width, height, rgb } = drawGrid(soup.programs, grid);
  await Deno.writeFile(`${out}/frames/${String(soup.epoch).padStart(6, "0")}.png`, await encodePng(width, height, rgb));
};
if (grid && fresh) await writeFrame();
const snapshot = (tag = "") => Deno.writeFile(`${out}/soup-${soup.epoch}${tag}.bin`, soup.programs);
const t0 = performance.now();
let ops = 0;
while (soup.epoch < maxEpochs) {
  // Advance to the next epoch that needs a log line (cubff logs after epoch e
  // with e % every == 0, labelled e + 1), a snapshot, or the end.
  let t = soup.epoch + 1;
  while ((t - 1) % every !== 0 && t % save !== 0 && !framed(t) && t < maxEpochs) t++;
  if (gpu) { gpu.step(t - soup.epoch); ops += await gpu.read(); }
  else { while (soup.epoch < t) soup.step(); ops += soup.ops; soup.ops = 0; }
  if ((t - 1) % every === 0 || t === maxEpochs) {
    const st = await stats(soup.programs);
    const c = census(soup.programs);
    const secs = (performance.now() - t0) / 1000;
    const opsPerRun = ops / soup.runs;
    ops = 0; soup.runs = 0;
    await Deno.writeTextFile(logPath, `${soup.epoch},${st.brotli},${num},${st.higherEntropy.toFixed(6)},${c.distinct},${(c.topCount / num).toFixed(6)},${opsPerRun.toFixed(1)},${secs.toFixed(1)}\n`, { append: true });
    console.log(`epoch ${soup.epoch}  H+ ${st.higherEntropy.toFixed(3)}  distinct ${c.distinct}  top ${c.topCount}  ops/pair ${opsPerRun.toFixed(0)}  ${secs.toFixed(0)}s`);
    if (transitionAt === null && st.higherEntropy > threshold) {
      transitionAt = soup.epoch;
      await snapshot("-transition");
      const record = { epoch: soup.epoch, higherEntropy: st.higherEntropy, topCount: c.topCount, copyScore: copyScore(c.top, lang), top: show(c.top), topHex: Array.from(c.top, (b) => b.toString(16).padStart(2, "0")).join("") };
      await Deno.writeTextFile(transitionPath, JSON.stringify(record, null, 2) + "\n");
      console.log(`TRANSITION at epoch ${soup.epoch}; most common program (${c.topCount} copies, copyScore ${record.copyScore.toFixed(2)}):\n  ${record.top}`);
    }
    if (transitionAt !== null && soup.epoch - transitionAt >= after) break;
  }
  if (soup.epoch % save === 0) await snapshot();
  if (framed(soup.epoch)) await writeFrame();
}
await snapshot();
await writeFrame(); // the final state, unless that frame is already written
console.log(transitionAt === null ? `no transition by epoch ${soup.epoch}` : `done at epoch ${soup.epoch}; transition at ${transitionAt}`);
