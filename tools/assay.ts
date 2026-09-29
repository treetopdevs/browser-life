// GPU assays of the foundations review (docs/plan.md, "M4 pivot: foundations review", with its
// "Operational definitions"). Every subcommand writes one JSON file per unit of work into --out,
// skips units already written, and takes --part k/N to split the units across lanes.
//
//   deno run -A tools/assay.ts mutants   --out DIR [--founders 0-11] [--scales 24,8,4] [--per 200]   (test 2 screen)
//   deno run -A tools/assay.ts confirm   --out DIR --candidates FILE                                  (test 2 confirmation)
//   deno run -A tools/assay.ts timeshift --out DIR [--root runs/replay-m4/gradient-m3/treatment] [--histories 1-10] (test 4)
//   deno run -A tools/assay.ts garden    --out DIR --plan FILE                                        (tests 1 and 3)
//   deno run -A tools/assay.ts retest    --out DIR --plan FILE                                        (test 5)
//
// Seeds come from the review's reserved ranges (4,000,001-4,599,999), as the definitions fix them.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import {
  CELL_CHANNELS,
  G,
  GENOME_CHANNELS,
  M3_FOUNDERS,
  NN_BYTES,
  RND,
  ROLE_WORDS,
  buildWorld,
  cellBase,
  cellCount,
  decodeCheckpoint,
  decodeGenome,
  defaultConfig,
  draw,
  encodeGenome,
  founderGenome,
  worldW,
  type Founder,
  type Genome,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";
import { mutateInPlace } from "@bl/sim-ref";
import { GpuSim, requestDevice } from "@bl/sim-gpu";
import { DEFAULT_CENSUS, Tracker, census, classify, tileDistance2 } from "@bl/metrics";
import { DEFAULT_EVAL, evaluateBatch, type EvalConfig } from "@bl/search";

const a = parseArgs(Deno.args, {
  string: ["out", "part", "founders", "scales", "per", "candidates", "root", "histories", "plan", "steps", "times", "seed0"],
  default: { part: "0/1", founders: "0-11", scales: "24,8,4", per: "200", root: "runs/replay-m4/gradient-m3/treatment", histories: "1-10", steps: "50000", times: "100000,900000", seed0: "4300001" },
});
const cmd = String(a._[0] ?? "");
if (!a.out) throw new Error("--out is required");
const OUT = a.out;
await Deno.mkdir(OUT, { recursive: true });
const [partK, partN] = a.part.split("/").map(Number);
if (!(partN >= 1 && partK >= 0 && partK < partN)) throw new Error("--part must be k/N with 0 <= k < N");

function range(s: string): number[] {
  return s.split(",").flatMap((p) => {
    const [lo, hi] = p.split("-").map(Number);
    return hi === undefined ? [lo] : Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  });
}
const exists = async (p: string) => {
  try {
    await Deno.stat(p);
    return true;
  } catch {
    return false;
  }
};
/** Runs `work` for the units of this part not yet written; `name` is the unit's output file. */
async function forUnits<T>(units: T[], name: (u: T) => string, work: (u: T) => Promise<unknown>) {
  const mine = units.filter((_, i) => i % partN === partK);
  let done = 0;
  for (const u of mine) {
    const f = `${OUT}/${name(u)}.json`;
    if (await exists(f)) {
      done++;
      continue;
    }
    const t0 = performance.now();
    const res = await work(u);
    await Deno.writeTextFile(`${f}.tmp`, JSON.stringify(res));
    await Deno.rename(`${f}.tmp`, f);
    done++;
    console.log(`${name(u)} (${done}/${mine.length}, ${((performance.now() - t0) / 1000).toFixed(1)}s)`);
  }
}

export const hexWords = (w: Uint32Array) => Array.from(w.subarray(G.PARAM0), (x) => x.toString(16).padStart(8, "0")).join("");
/** A genome from `genomes.tsv`'s words column (PARAM0 onwards, 8 hex digits each). */
export function genomeFromHex(hex: string): Genome {
  const w = new Uint32Array(GENOME_CHANNELS);
  for (let g = G.PARAM0; g < GENOME_CHANNELS; g++) w[g] = parseInt(hex.slice((g - G.PARAM0) * 8, (g - G.PARAM0 + 1) * 8), 16) >>> 0;
  return decodeGenome(w);
}

/** Test 2's mutant m of founder f at step size s, drawn by the rule's own mutation operator. */
export function mutant(f: number, s: number, m: number) {
  const words = encodeGenome(founderGenome(M3_FOUNDERS[f]), 0, 0);
  const before = words.slice();
  const base = cellBase(4_100_000, s, 200 * f + m);
  const which = draw(base, RND.MUT_WHICH), deltaRnd = draw(base, RND.MUT_DELTA);
  mutateInPlace(words, 1, 0, { ...defaultConfig(), mutStep: s }, which, deltaRnd);
  const slot = which % (NN_BYTES + 3);
  const delta = (deltaRnd % (2 * s + 1)) - s || 1;
  return { genome: decodeGenome(words), unchanged: words.every((w, i) => w === before[i]), slot, delta, hex: hexWords(words) };
}

const device = await requestDevice(navigator.gpu, defaultConfig({ tileW: 512, tileH: 512 }));
const ec: EvalConfig = { ...DEFAULT_EVAL, roles: true, perRep: true };



// ---------------------------------------------------------------------------------------------
// Common garden (tests 1 and 3): genomes grown in the evaluator's world, mutation off, with the
// tracker's life history per tile and each lineage's catalytic fluxes over the last 1,000 steps.

interface GardenPlan {
  seed0: number;
  /** Replicate tiles per planting. */
  reps: number;
  growSteps: number;
  /** Each planting fills `reps` tiles; one genome is a monoculture, two are co-cultured side by side. */
  plantings: { id: string; hex: string[] }[];
}

async function garden() {
  const plan: GardenPlan = JSON.parse(await Deno.readTextFile(a.plan!));
  const tilesPer = DEFAULT_EVAL.side * DEFAULT_EVAL.side;
  const perBatch = Math.floor(tilesPer / plan.reps);
  const units = Array.from({ length: Math.ceil(plan.plantings.length / perBatch) }, (_, j) => ({ j, ps: plan.plantings.slice(j * perBatch, (j + 1) * perBatch) }));
  await forUnits(units, (u) => `g${u.j}`, async ({ j, ps }) => gardenBatch(ps, plan, plan.seed0 + j));
}

async function gardenBatch(ps: GardenPlan["plantings"], plan: GardenPlan, seed: number) {
  const T = DEFAULT_EVAL.tile, side = DEFAULT_EVAL.side;
  const cfg = defaultConfig({ ...DEFAULT_EVAL.world, tileW: T, tileH: T, tilesX: side, tilesY: side, seed, mutRate: 0 });
  const n = cellCount(cfg), W = worldW(cfg);
  const founders: Founder[] = [];
  const owner: { planting: number; slot: number; tile: number }[] = []; // by founder index (lineage lo - 1)
  ps.forEach((p, k) => {
    for (let r = 0; r < plan.reps; r++) {
      const t = k * plan.reps + r;
      p.hex.forEach((h, slot) => {
        const x = p.hex.length === 1 ? T / 2 : Math.round(((slot + 1) * T) / 3);
        founders.push({ x: (t % side) * T + x, y: Math.floor(t / side) * T + T / 2, radius: Math.floor(T / 6), genome: genomeFromHex(h), biomass: DEFAULT_EVAL.biomass, energy: 2 * DEFAULT_EVAL.biomass });
        owner.push({ planting: k, slot, tile: t });
      });
    }
  });
  const sim = await GpuSim.create(device, buildWorld(cfg, { nutrient: DEFAULT_EVAL.nutrient, founders }));
  const opt = { threshold: 48, minMass: 128 };
  const tracker = new Tracker(opt);
  const tiles = side * side;
  const reproMass: number[][] = Array.from({ length: tiles }, () => []);
  const fissions = new Float64Array(tiles), buddings = new Float64Array(tiles);
  const intervals: number[][] = Array.from({ length: tiles }, () => []);
  const censored: number[][] = Array.from({ length: tiles }, () => []);
  const memP = new Float64Array(tiles), memM = new Float64Array(tiles);
  // Individual-steps at risk per tile: each tracked individual contributes 100 steps per census.
  const exposure = new Float64Array(tiles), reproEvents = new Float64Array(tiles);
  const flux = new Map<string, number[]>(); // `${tile}:${slot}` -> photo, grow, decomp, resp, cells
  const lastRepro = new Map<number, number>(); // individual id -> step of its birth by fission or last fission
  let prevMass = new Map<number, number>();
  try {
    for (let s = 0; s < plan.growSteps; s += 100) {
      for (let k = 0; k < 100; k += 64) sim.run(Math.min(64, 100 - k));
      await device.queue.onSubmittedWorkDone();
      const snap = await sim.readSnapshot(s + 100 > plan.growSteps - 1000);
      const c = census({ cfg, step: snap.step, cells: snap.cells, genomeHead: snap.genomeHead });
      const events = tracker.update(c);
      // Reproduction = a tracker fission, or a budding: a birth within 24 cells of a living individual
      // of the same lineage in the same tile (the runner's attribution, packages/runner/src/observe.ts).
      const reproduce = (parent: number, children: number[], kind: "fission" | "budding") => {
        const par = tracker.alive.get(parent);
        if (!par) return;
        (kind === "fission" ? fissions : buddings)[par.tile]++;
        for (const id of children) lastRepro.set(id, snap.step);
        // One reproduction event per parent per census, however many offspring it produced.
        if (lastRepro.get(parent) === snap.step) return;
        reproEvents[par.tile]++;
        const pm = prevMass.get(parent);
        if (pm !== undefined) reproMass[par.tile].push(pm);
        const since = lastRepro.get(parent);
        if (since !== undefined) intervals[par.tile].push(snap.step - since);
        lastRepro.set(parent, snap.step);
      };
      for (const e of events) {
        if (e.kind === "fission") reproduce(e.parent, e.children, "fission");
        else if (e.kind === "birth") {
          const b = tracker.alive.get(e.id);
          let parent: number | null = null, best = 24 * 24;
          if (b && b.lineage)
            for (const o of tracker.alive.values()) {
              if (o.id === b.id || o.lineage !== b.lineage || o.born === snap.step) continue;
              const d = tileDistance2(o, b, cfg.tileW, cfg.tileH);
              if (d < best) [best, parent] = [d, o.id];
            }
          if (parent !== null) reproduce(parent, [e.id], "budding");
          else lastRepro.set(e.id, snap.step);
        }
      }
      for (const e of events) if (e.kind === "death") lastRepro.delete(e.id);
      for (const ind of tracker.alive.values()) exposure[ind.tile] += 100;
      prevMass = new Map();
      for (const k of c.components) {
        const id = tracker.idOf(k.idx);
        if (id !== undefined) prevMass.set(id, k.mass);
      }
      if (snap.step > plan.growSteps - 3000)
        for (const k of c.components) {
          if (k.mass < opt.minMass) continue;
          memP[k.tile] += k.mass - k.biomass;
          memM[k.tile] += k.mass;
        }
      if (snap.roles) {
        for (let i = 0; i < n; i++) {
          const lo = snap.genomeHead[G.LIN_LO * n + i], hi = snap.genomeHead[G.LIN_HI * n + i];
          if (hi !== 0 || lo === 0) continue; // founder lineages only (mutation is off)
          const o = owner[lo - 1];
          if (!o) continue;
          const key = `${o.tile}:${o.slot}`;
          let f = flux.get(key);
          if (!f) flux.set(key, (f = [0, 0, 0, 0, 0]));
          const ra = snap.roles[i * ROLE_WORDS], rb = snap.roles[i * ROLE_WORDS + 1];
          f[0] += ra & 0xffff;
          f[1] += ra >>> 16;
          f[2] += rb & 0xffff;
          f[3] += rb >>> 16;
          f[4]++;
        }
      }
    }
    for (const [id, since] of lastRepro) {
      if (!tracker.alive.has(id)) continue;
      const ind = tracker.alive.get(id);
      if (ind) censored[ind.tile].push(plan.growSteps - since);
    }
    const massEnd = new Float64Array(tiles);
    const indEnd = new Float64Array(tiles);
    for (const ind of tracker.alive.values()) {
      massEnd[ind.tile] += ind.mass;
      indEnd[ind.tile]++;
    }
    void W;
    return {
      seed,
      plantings: ps.map((p, k) => ({
        id: p.id,
        tiles: Array.from({ length: plan.reps }, (_, r) => {
          const t = k * plan.reps + r;
          return {
            tile: t,
            reproductions: reproEvents[t],
            exposure: exposure[t],
            fissions: fissions[t],
            buddings: buddings[t],
            reproMass: reproMass[t],
            intervals: intervals[t],
            censored: censored[t],
            membrane: memM[t] > 0 ? memP[t] / memM[t] : null,
            mass: massEnd[t],
            individuals: indEnd[t],
            lineages: p.hex.map((_, slot) => {
              const f = flux.get(`${t}:${slot}`) ?? [0, 0, 0, 0, 0];
              return { slot, photo: f[0], grow: f[1], decomp: f[2], resp: f[3], cellCensuses: f[4], role: classify(f[0], f[1], f[2]) };
            }),
          };
        }),
      })),
    };
  } finally {
    sim.destroy();
  }
}

// ---------------------------------------------------------------------------------------------
// Time-shift competition (test 4).

const POSITIONS: [number, number][] = [[64, 64], [192, 64], [64, 192], [192, 192]];
const TIMES = a.times.split(",").map(Number); // early, late (the definitions fix 10^5 and 9 x 10^5)

interface Implant {
  lineage: string;
  totalCells: number;
  componentCells: number;
  boundMass: number;
  /** Offsets from the centroid cell, and each cell's channels and genome words. */
  cells: { dx: number; dy: number; ch: number[]; g: number[] }[];
}

/**
 * The five most abundant lineages that have an individual of their own and at least 64 cells, and their
 * implants: each lineage's 64 cells nearest the centroid of its heaviest individual (a census component
 * of mass >= 256 whose dominant lineage it is), whether or not they belong to it. Individuals are about
 * 16-36 cells, so an implant takes in the individual and the lineage's cells around it.
 */
export function implantsOf(st: WorldState): Implant[] {
  const cfg = st.cfg, n = cellCount(cfg), W = worldW(cfg), H = n / W;
  if (cfg.tilesX !== 1 || cfg.tilesY !== 1) throw new Error("time-shift assays expect a single-tile world");
  const c = census({ cfg, step: st.step, cells: st.cells, genomeHead: st.genome.subarray(0, 4 * n) }, DEFAULT_CENSUS);
  const key = (i: number) => `${st.genome[G.LIN_HI * n + i]}:${st.genome[G.LIN_LO * n + i]}`;
  const heaviest = new Map<string, (typeof c.components)[number]>();
  for (const k of c.components) {
    if (k.mass < DEFAULT_CENSUS.minMass || !k.lineage) continue;
    const h = heaviest.get(k.lineage);
    if (!h || k.mass > h.mass) heaviest.set(k.lineage, k);
  }
  const cellsOf = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    if ((st.genome[G.LIN_HI * n + i] | st.genome[G.LIN_LO * n + i]) === 0) continue;
    const k = key(i);
    const arr = cellsOf.get(k);
    if (arr) arr.push(i);
    else cellsOf.set(k, [i]);
  }
  const out: Implant[] = [];
  for (const lin of c.lineages.slice().sort((x, y) => y.cells - x.cells || (x.key < y.key ? -1 : 1))) {
    if (out.length === 5) break;
    const comp = heaviest.get(lin.key);
    const own = cellsOf.get(lin.key) ?? [];
    if (!comp || own.length < 64) continue;
    // Cells are ranked by torus distance to the exact centroid; offsets are taken from the centroid
    // rounded to a cell, which is the anchor placed on the implant position.
    const d = (i: number) => {
      const dx = Math.abs((i % W) - comp.cx), dy = Math.abs(Math.floor(i / W) - comp.cy);
      return Math.min(dx, W - dx) ** 2 + Math.min(dy, H - dy) ** 2;
    };
    const cx = Math.round(comp.cx) % W, cy = Math.round(comp.cy) % H;
    const chosen = own.slice().sort((p, q) => d(p) - d(q) || p - q).slice(0, 64);
    const wrap = (v: number, s: number) => ((v % s) + s + s / 2) % s - s / 2;
    out.push({
      lineage: lin.key,
      totalCells: lin.cells,
      componentCells: comp.cells,
      boundMass: chosen.reduce((m, i) => m + st.cells[1 * n + i] + st.cells[3 * n + i], 0),
      cells: chosen.map((i) => ({
        dx: wrap((i % W) - cx, W),
        dy: wrap(Math.floor(i / W) - cy, H),
        ch: Array.from({ length: CELL_CHANNELS }, (_, k) => st.cells[k * n + i]),
        g: Array.from({ length: GENOME_CHANNELS }, (_, k) => st.genome[k * n + i]),
      })),
    });
  }
  return out;
}

/** `st` with `imp` written centred on (px, py), relabelled to (hi, lo); config `cfg`. */
export function implanted(st: WorldState, imp: Implant, px: number, py: number, hi: number, lo: number, cfg: WorldConfig): WorldState {
  const n = cellCount(st.cfg), W = worldW(st.cfg), H = n / W;
  const cells = st.cells.slice(), genome = st.genome.slice();
  for (const c of imp.cells) {
    const i = (((py + c.dy) % H) + H) % H * W + ((((px + c.dx) % W) + W) % W);
    for (let k = 0; k < CELL_CHANNELS; k++) cells[k * n + i] = c.ch[k];
    for (let k = 0; k < GENOME_CHANNELS; k++) genome[k * n + i] = c.g[k];
    genome[G.LIN_HI * n + i] = hi;
    genome[G.LIN_LO * n + i] = lo;
  }
  return { ...st, cfg, cells, genome, flux: st.flux.slice() };
}

async function timeshift() {
  const steps = Number(a.steps);
  const hs = range(a.histories);
  const cache = new Map<number, { states: WorldState[]; implants: Implant[][]; lo: number }>();
  const load = async (h: number) => {
    let v = cache.get(h);
    if (v) return v;
    const states = await Promise.all(TIMES.map(async (t) => decodeCheckpoint(await Deno.readFile(`${a.root}/seed-${h}/checkpoints/t${String(t).padStart(9, "0")}.blck`)).state));
    const present = new Set<string>();
    for (const st of states) {
      const n = cellCount(st.cfg);
      for (let i = 0; i < n; i++) present.add(`${st.genome[G.LIN_HI * n + i]}:${st.genome[G.LIN_LO * n + i]}`);
    }
    let lo = 65535;
    while (present.has(`1:${lo}`)) lo--;
    v = { states, implants: states.map(implantsOf), lo };
    cache.set(h, v);
    return v;
  };
  const units = hs.flatMap((h) => [0, 1].flatMap((o) => [0, 1].flatMap((e) => [0, 1, 2, 3, 4].flatMap((r) => [0, 1, 2, 3].map((p) => ({ h, o, e, r, p }))))));
  await forUnits(units, (u) => `h${u.h}-o${u.o}-e${u.e}-r${u.r}-p${u.p}`, async ({ h, o, e, r, p }) => {
    const { states, implants, lo } = await load(h);
    const imp = implants[o][r];
    // History index = the replay's seed minus 1, whatever --histories selects. Treatment: seed0
    // 4,300,001; the neutral control: 4,300,801 (--root .../neutral --histories 1-5).
    const seed = Number(a.seed0) + 80 * (h - 1) + 40 * o + 20 * e + 4 * r + p;
    const base = { h, o: TIMES[o], e: TIMES[e], rank: r, position: POSITIONS[p], seed };
    if (!imp) return { ...base, missing: true };
    const cfg: WorldConfig = { ...states[e].cfg, mutRate: 0, seed };
    const st = implanted(states[e], imp, POSITIONS[p][0], POSITIONS[p][1], 1, lo, cfg);
    const sim = await GpuSim.create(device, st);
    const n = cellCount(cfg);
    const counts: [number, number][] = [];
    const count = async () => {
      const g = await sim.readGenomeChannels(0, 2);
      let k = 0;
      for (let i = 0; i < n; i++) if (g[i] === 1 && g[n + i] === lo) k++;
      return k;
    };
    try {
      const start = await count();
      for (let s = 0; s < steps; s += 1000) {
        for (let k = 0; k < 1000; k += 64) sim.run(Math.min(64, 1000 - k));
        if ((s + 1000) % 10_000 === 0) counts.push([s + 1000, await count()]);
      }
      await device.queue.onSubmittedWorkDone();
      const end = await count();
      return { ...base, lineage: imp.lineage, totalCells: imp.totalCells, componentCells: imp.componentCells, boundMass: imp.boundMass, assayId: `1:${lo}`, nStart: start, nEnd: end, fitness: Math.log((end + 1) / (start + 1)), counts };
    } finally {
      sim.destroy();
    }
  });
}

// Dispatch last, so every declaration above is initialised.
if (cmd === "mutants") {
  const scales = a.scales.split(",").map(Number);
  const per = Number(a.per);
  const batches = Math.ceil(per / 16);
  if (batches > 13) throw new Error("at most 13 batches (208 mutants) per founder and step size: the seed formula reserves 13");
  const units = range(a.founders).flatMap((f) => scales.flatMap((s, si) => Array.from({ length: batches }, (_, b) => ({ f, s, si, b }))));
  await forUnits(units, (u) => `f${u.f}-s${u.s}-b${u.b}`, async ({ f, s, si, b }) => {
    const seed = 4_100_001 + 13 * (3 * f + si) + b;
    const ms = Array.from({ length: Math.min(16, per - 16 * b) }, (_, k) => ({ m: 16 * b + k, ...mutant(f, s, 16 * b + k) }));
    const mev = await evaluateBatch(device, ms.map((x) => x.genome), { ...ec, seed });
    const pev = await evaluateBatch(device, ms.map(() => founderGenome(M3_FOUNDERS[f])), { ...ec, seed });
    return { f, s, b, seed, mutants: ms.map((x, k) => ({ m: x.m, unchanged: x.unchanged, slot: x.slot, delta: x.delta, hex: x.hex, eval: mev[k] })), parent: pev };
  });
} else if (cmd === "confirm") {
  // Candidates: [{f, s, m}] in a fixed order; pairs share a batch (32 replicates each), seeds from 4,150,001.
  const cands: { f: number; s: number; m: number }[] = JSON.parse(await Deno.readTextFile(a.candidates!));
  const e32: EvalConfig = { ...ec, reps: 32 };
  const units = Array.from({ length: Math.ceil(cands.length / 2) }, (_, j) => ({ j, cs: cands.slice(2 * j, 2 * j + 2) }));
  await forUnits(units, (u) => `c${u.j}`, async ({ j, cs }) => {
    const seed = 4_150_001 + j;
    const mev = await evaluateBatch(device, cs.map((c) => mutant(c.f, c.s, c.m).genome), { ...e32, seed });
    const pev = await evaluateBatch(device, cs.map((c) => founderGenome(M3_FOUNDERS[c.f])), { ...e32, seed });
    return { j, seed, candidates: cs.map((c, k) => ({ ...c, eval: mev[k], parent: pev[k] })) };
  });
} else if (cmd === "retest") {
  // Plan: {seed0, genomes: [{label, hex}]}; 2 genomes per batch at 32 replicates (the M3 retest).
  const plan: { seed0: number; genomes: { label: string; hex: string }[] } = JSON.parse(await Deno.readTextFile(a.plan!));
  const units = Array.from({ length: Math.ceil(plan.genomes.length / 2) }, (_, j) => ({ j, gs: plan.genomes.slice(2 * j, 2 * j + 2) }));
  await forUnits(units, (u) => `r${u.j}`, async ({ j, gs }) => {
    const seed = plan.seed0 + j;
    const ev = await evaluateBatch(device, gs.map((g) => genomeFromHex(g.hex)), { ...ec, reps: 32, seed });
    return { j, seed, genomes: gs.map((g, k) => ({ ...g, eval: ev[k] })) };
  });
} else if (cmd === "garden") {
  await garden();
} else if (cmd === "timeshift") {
  await timeshift();
} else throw new Error(`unknown subcommand '${cmd}'`);
