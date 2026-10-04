// The breeder's readout (wild sandbox; WorldConfig.pondScore). Exploratory, not registered.
//
// Breed with tools/run.ts on a pond preset and the conditions pond-breed-<score> (the ponds with the largest
// score seed the next cycle), pond-mass-<score> (control: the most massive ponds do; the score is only recorded)
// and pond-drift-<score> (control: random donors), with --pre-cycle for the frames:
//
//   deno run -A tools/run.ts --experiment breed1 --preset ponds --conditions pond-breed-drive,pond-mass-drive \
//     --seeds 1 --steps 600000 --census 1000 --checkpoint 0 --pre-cycle 1,10,20,40,60 --out runs/wild
//
//   deno run -A tools/breed.ts read   --dir runs/wild/breed1/ponds [--conditions a,b] [--seed 1] [--out DIR] [--every 5] [--boundaries 20,60]
//   deno run -A tools/breed.ts motion --dir runs/wild/breed1/ponds --boundary 10 [--steps 32] [--window 4] [--conditions a,b] [--seed 1] [--out DIR]
//
// A picked run (tools/run.ts --picker) is read by its directory name: --conditions treatment-by-rule,treatment-by-random.
//
// read: for every condition under DIR (or those named) with a seed-<n> bundle, streams ponds.tsv into
//   OUT/trajectory.tsv (one row per condition and cycle; OUT defaults to DIR/report-seed-<n>) and prints every
//   `--every`-th cycle. scorePerMass is the sum of scores over the sum of bound mass; for score "drive" that is
//   the mass-weighted motility term, printed as cells per 1,000 steps (x 1000 / 64). When a condition has a
//   combined score, every row also gets each term's median over the occupied ponds and drive's mass-weighted
//   mean (blank where a run does not record the term), and that condition prints its terms ("body" as cells,
//   / 256); one-term runs alone keep the report they always had. Then writes OUT/frames.png
//   from the bundles' pre-cycle checkpoints (checkpoints/b<NNN>-pre.blck, the world just before a boundary's
//   grind): columns are the boundaries every condition has (or those of them named by `--boundaries`), and each
//   condition gets two rows, lineages (hue by
//   lineage id, brightness by bound mass) and movement (grey where a living cell's motility term, `motilityReader`,
//   is 0, orange to white as |dx| + |dy| grows to 16/64 cell per step).
// motion: does the mass actually travel? From each condition's pre-cycle checkpoint at `--boundary`, steps the
//   world `--steps` more steps on the GPU with no pond cycle, and for every occupied pond finds the shift of its
//   bound-mass pattern (`tileShift`, within `--window` cells; keep steps short, since a lattice of bodies matches
//   again one period on). Beside it, the shift the controllers command: the mass-weighted mean motility vector
//   of the snapshot times the steps. Writes OUT/motion-b<NNN>.tsv (one row per condition and pond) and prints
//   each condition's medians, as cells per 1,000 steps.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { CH, G, POND_TERMS, cellCount, decodeCheckpoint, lowbias32, motilityReader, pondScoreTerms, worldH, worldW, type WorldState } from "@bl/schema";
import { GpuSim, requestDevice } from "@bl/sim-gpu";
import { cycleSummaries, tileShift, type CycleSummary } from "./lib/breed-stats.ts";
import { hsv } from "./lib/pond-sheet.ts";
import { encodePng } from "./lib/png.ts";
import { readTsv } from "./lib/scaffold-stats.ts";

const USAGE = "usage: tools/breed.ts read|motion --dir DIR [--conditions a,b] [--seed 1] [--out DIR] (read: [--every 5] [--boundaries a,b]; motion: --boundary B [--steps 32] [--window 4])";
const a = parseArgs(Deno.args.slice(1), { string: ["dir", "conditions", "seed", "out", "every", "boundary", "boundaries", "steps", "window"], default: { seed: "1", every: "5", steps: "32", window: "4" } });
const cmd = Deno.args[0];
if (cmd !== "read" && cmd !== "motion") throw new Error(USAGE);
const DIR = a.dir ?? (() => { throw new Error("--dir DIR required (a preset's directory of a tools/run.ts experiment)"); })();
const seed = Number(a.seed);
const OUT = a.out ?? `${DIR}/report-seed-${seed}`;
const exists = (p: string) => Deno.stat(p).then(() => true, () => false);
const bundle = (condition: string) => `${DIR}/${condition}/seed-${seed}`;
const preFile = (condition: string, b: number) => `${bundle(condition)}/checkpoints/b${String(b).padStart(3, "0")}-pre.blck`;
const loadPre = async (condition: string, b: number): Promise<WorldState> => decodeCheckpoint(await Deno.readFile(preFile(condition, b))).state;

let conditions = (a.conditions ?? "").split(",").filter(Boolean);
if (!conditions.length) {
  for await (const e of Deno.readDir(DIR)) if (e.isDirectory && (await exists(`${DIR}/${e.name}/seed-${seed}/ponds.tsv`))) conditions.push(e.name);
  conditions.sort();
}
if (!conditions.length) throw new Error(`no condition under ${DIR} has a seed-${seed} bundle with ponds.tsv`);
await Deno.mkdir(OUT, { recursive: true });

const median = (xs: number[]): number => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

// ------------------------------------------------------------------------------------ read
async function read() {
  const every = Number(a.every);
  const COLUMNS = ["cycle", "step", "ponds", "occupied", "scoring", "scoreMedian", "scoreMean", "scoreMax", "scorePerMass", "massMedian", "donorScoreMean", "donors", "individualsMean"] as const satisfies readonly (keyof CycleSummary)[];
  const scores: (string | undefined)[] = [];
  for (const condition of conditions) scores.push(JSON.parse(await Deno.readTextFile(`${bundle(condition)}/manifest.json`)).cfg?.pondScore);
  // One-term runs keep the report they always had. With a combined score among the conditions, every row also gets
  // one median per term (blank where its run does not record the term) and drive's mass-weighted mean.
  const combined = scores.some((score) => score !== undefined && pondScoreTerms(score).length > 1);
  const lines = [["condition", ...COLUMNS, ...(combined ? [...POND_TERMS.map((t) => `${t}Median`), "drivePerMass"] : [])].join("\t")];
  for (const [k, condition] of conditions.entries()) {
    const score = scores[k];
    const terms = score === undefined ? [] : pondScoreTerms(score);
    const one = terms.length <= 1;
    console.log(
      one
        ? `\n${condition} (score ${score ?? "?"})\ncycle\toccupied\tscoring\tscore/mass${score === "drive" ? "\tcells/1000 steps" : ""}\tscore median\tscore max\tmass median\tindividuals`
        : `\n${condition} (score ${score})\ncycle\toccupied\tscoring\tscore median\tmass median\tindividuals${terms.map((t) => (t === "drive" ? "\tcells/1000 steps" : t === "body" ? "\tbody (cells)" : `\t${t} median`)).join("")}`,
    );
    for await (const c of cycleSummaries(readTsv(`${bundle(condition)}/ponds.tsv`), terms.length === 1 ? terms[0] : undefined)) {
      lines.push([condition, ...COLUMNS.map((key) => String(c[key])), ...(combined ? [...POND_TERMS.map((t) => (c.terms[t] ? String(c.terms[t]!.median) : "")), c.terms.drive ? String(c.terms.drive.perMass) : ""] : [])].join("\t"));
      if (c.cycle !== 1 && c.cycle % every !== 0) continue;
      console.log(
        (one
          ? [c.cycle, c.occupied, c.scoring, c.scorePerMass.toFixed(3), ...(score === "drive" ? [((c.scorePerMass * 1000) / 64).toFixed(1)] : []), c.scoreMedian, c.scoreMax, c.massMedian, c.individualsMean.toFixed(1)]
          : [c.cycle, c.occupied, c.scoring, c.scoreMedian, c.massMedian, c.individualsMean.toFixed(1), ...terms.map((t) => (t === "drive" ? ((c.terms.drive!.perMass * 1000) / 64).toFixed(1) : t === "body" ? (c.terms.body!.median / 256).toFixed(1) : String(c.terms[t]!.median)))]
        ).join("\t"),
      );
    }
  }
  await Deno.writeTextFile(`${OUT}/trajectory.tsv`, lines.join("\n") + "\n");

  const preCycle = async (condition: string): Promise<number[]> => {
    const out: number[] = [];
    const dir = `${bundle(condition)}/checkpoints`;
    if (await exists(dir)) for await (const e of Deno.readDir(dir)) { const m = e.name.match(/^b(\d+)-pre\.blck$/); if (m) out.push(Number(m[1])); }
    return out.sort((x, y) => x - y);
  };
  const have = await Promise.all(conditions.map(preCycle));
  const wanted = a.boundaries === undefined ? null : a.boundaries.split(",").map(Number);
  if (wanted?.some((b) => !Number.isInteger(b) || b < 1)) throw new Error("--boundaries takes boundary numbers, e.g. 20,60");
  const boundaries = have[0].filter((b) => have.every((h) => h.includes(b)) && (wanted === null || wanted.includes(b)));
  if (!boundaries.length) {
    console.log(`\nwrote ${OUT}/trajectory.tsv; no pre-cycle checkpoint is common to every condition, so no frames (run with --pre-cycle)`);
    return;
  }
  const first = await loadPre(conditions[0], boundaries[0]);
  const TW = worldW(first.cfg), TH = worldH(first.cfg), gap = 6;
  const W = boundaries.length * (TW + gap) + gap, H = conditions.length * 2 * (TH + gap) + gap;
  const img = new Uint8Array(W * H * 3).fill(32);
  for (let r = 0; r < conditions.length; r++)
    for (let c = 0; c < boundaries.length; c++) {
      const st = await loadPre(conditions[r], boundaries[c]);
      if (worldW(st.cfg) !== TW || worldH(st.cfg) !== TH) throw new Error(`${conditions[r]}: world size differs from ${conditions[0]}'s`);
      const n = cellCount(st.cfg), x0 = gap + c * (TW + gap), yL = gap + 2 * r * (TH + gap), yM = yL + TH + gap;
      const motility = motilityReader(st);
      for (let y = 0; y < TH; y++)
        for (let x = 0; x < TW; x++) {
          const i = y * TW + x, hi = st.genome[G.LIN_HI * n + i], lo = st.genome[G.LIN_LO * n + i];
          const m = st.cells[CH.B * n + i] + st.cells[CH.P * n + i];
          // Pond borders (tiles) as a faint grid on empty cells.
          let lin: [number, number, number] = x % st.cfg.tileW === 0 || y % st.cfg.tileH === 0 ? [18, 18, 18] : [0, 0, 0];
          let mov = lin;
          if ((hi | lo) !== 0 && m > 0) {
            const v = Math.min(1, 0.15 + m / 96);
            lin = hsv((lowbias32(lowbias32(hi) ^ lo) % 3600) / 3600, 0.85, v);
            const [dx, dy] = motility(i);
            const d = Math.min(1, (Math.abs(dx) + Math.abs(dy)) / 16);
            mov = d === 0 ? [Math.round(70 * v), Math.round(75 * v), Math.round(90 * v)] : hsv(0.08 + 0.08 * d, 1 - 0.8 * d, Math.min(1, 0.55 + 0.45 * d));
          }
          img.set(lin, ((yL + y) * W + x0 + x) * 3);
          img.set(mov, ((yM + y) * W + x0 + x) * 3);
        }
    }
  await Deno.writeFile(`${OUT}/frames.png`, await encodePng(W, H, img));
  console.log(`\nwrote ${OUT}/trajectory.tsv and ${OUT}/frames.png (${conditions.length} conditions x boundaries ${boundaries.join(", ")}; rows per condition: lineages, movement)`);
}

// ------------------------------------------------------------------------------------ motion
async function motion() {
  const b = Number(a.boundary), steps = Number(a.steps), window = Number(a.window);
  if (!Number.isInteger(b) || b < 1) throw new Error("motion needs --boundary B, a boundary with a pre-cycle checkpoint");
  if (!Number.isInteger(steps) || steps < 1) throw new Error("--steps must be a positive integer");
  const rows = [["condition", "pond", "mass", "dx", "dy", "corr", "corr0", "commandDx", "commandDy", "meanAbsDrive"].join("\t")];
  console.log(`boundary ${b}, ${steps} steps on; speeds in cells per 1,000 steps\ncondition\toccupied\tmoved >= 0.5 cell\tmeasured (median)\tcommanded net (median)\tcommanded |drive| (median)\tcorr at shift / at rest (median)`);
  for (const condition of conditions) {
    if (!(await exists(preFile(condition, b)))) throw new Error(`${condition}: no pre-cycle checkpoint for boundary ${b} (run with --pre-cycle ${b})`);
    const pre = await loadPre(condition, b);
    const cfg = pre.cfg, n = cellCount(cfg), W = worldW(cfg), side = cfg.tileW;
    const motility = motilityReader(pre);
    if (cfg.tileH !== side) throw new Error("motion needs square tiles");
    const device = await requestDevice(navigator.gpu, cfg);
    const sim = await GpuSim.create(device, pre);
    let after: Uint32Array;
    try {
      // Plain physics: GpuSim knows nothing of the pond keys, so no cycle fires at this boundary.
      for (let s = 0; s < steps; s += 64) sim.run(Math.min(64, steps - s));
      await device.queue.onSubmittedWorkDone();
      after = await sim.readCells();
    } finally {
      sim.destroy();
      device.destroy();
    }
    const speeds: number[] = [], commanded: number[] = [], abs: number[] = [], corrs: number[] = [], corr0s: number[] = [];
    let occupied = 0, moved = 0;
    for (let p = 0; p < cfg.tilesX * cfg.tilesY; p++) {
      const tx = p % cfg.tilesX, ty = (p - tx) / cfg.tilesX;
      const m0 = new Float64Array(side * side), m1 = new Float64Array(side * side);
      let mass = 0, sx = 0, sy = 0, sAbs = 0;
      for (let y = 0; y < side; y++)
        for (let x = 0; x < side; x++) {
          const i = (ty * side + y) * W + tx * side + x;
          const m = pre.cells[CH.B * n + i] + pre.cells[CH.P * n + i];
          m0[y * side + x] = m;
          m1[y * side + x] = after[CH.B * n + i] + after[CH.P * n + i];
          if (m === 0) continue;
          const [dx, dy] = motility(i);
          mass += m; sx += m * dx; sy += m * dy; sAbs += m * (Math.abs(dx) + Math.abs(dy));
        }
      const shift = mass > 0 ? tileShift(m0, m1, side, window) : null;
      if (!shift) continue;
      occupied++;
      // Commanded shift over `steps`: the mass-weighted mean motility vector (1/64 cell per step) times the steps.
      const cx = ((sx / mass) * steps) / 64, cy = ((sy / mass) * steps) / 64;
      const perK = 1000 / steps;
      if (Math.hypot(shift.dx, shift.dy) >= 0.5) moved++;
      speeds.push(Math.hypot(shift.dx, shift.dy) * perK);
      commanded.push(Math.hypot(cx, cy) * perK);
      abs.push(((sAbs / mass) * 1000) / 64);
      corrs.push(shift.corr);
      corr0s.push(shift.corr0);
      rows.push([condition, p, mass, shift.dx.toFixed(3), shift.dy.toFixed(3), shift.corr.toFixed(4), shift.corr0.toFixed(4), cx.toFixed(3), cy.toFixed(3), (sAbs / mass).toFixed(3)].join("\t"));
    }
    console.log([condition, occupied, moved, median(speeds).toFixed(1), median(commanded).toFixed(1), median(abs).toFixed(1), `${median(corrs).toFixed(3)} / ${median(corr0s).toFixed(3)}`].join("\t"));
  }
  const file = `${OUT}/motion-b${String(b).padStart(3, "0")}.tsv`;
  await Deno.writeTextFile(file, rows.join("\n") + "\n");
  console.log(`\nwrote ${file} (dx, dy, commandDx, commandDy in cells over ${steps} steps; meanAbsDrive in 1/64 cell per step)`);
}

await (cmd === "read" ? read() : motion());
