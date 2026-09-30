// Ecological-scaffolding sandbox driver (docs/scaffold-protocol-v1.md): one history of ponds under the
// group life cycle. Tiles are ponds; every `period` steps each pond is ground back to nutrient and
// reseeded by a k x k packet from a donor pond (arm scaf: donors are the fittest ponds; rand: random
// ponds), or, for arm cont, only measured. Physics is RULE_VERSION 1, unchanged: the cycle is a
// host-side transform between periods (tools/lib/ponds.ts) and the GPU loop is tools/lib/pond-gpu.ts.
//
//   deno run -A tools/scaffold.ts evolve \
//     --arm scaf|rand|cont --k 5 --period 3000 --cycles 15 --side 8 --seed 4810001 \
//     --out runs/scaffold/<name> \
//     [--init clone|founders] [--mut-off] [--census 100] [--ckpt-every 50] [--frames] \
//     [--resume] [--allow-any-seed]
//
// Writes <out>/{meta.json, ponds.tsv, lineages.tsv, progress.tsv, ckpt/, frames/, done.json}; the formats
// are fixed in the build contract. --resume continues from the latest post-cycle checkpoint in <out>/ckpt
// (pre-cycle for cont), or from ckpt/init.blck.gz when the run crashed before its first one, truncates the
// rows past that boundary, and (with the same flags and --cycles) reproduces ponds.tsv, lineages.tsv and the
// final checkpoint byte for byte. ckpt/status.json records, before each checkpoint, its boundary and whether
// the history had ended there, so a crash after an extinction checkpoint but before done.json resumes as an
// ended history (done.json restored, nothing advanced). Seeds must lie in 4,800,001-4,849,999 unless
// --allow-any-seed (smoke tests).
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { CH, G, M3_FOUNDERS, RULE_VERSION, cellCount, founderGenome, stateHash, totalsOf, worldW, type WorldConfig, type WorldState } from "@bl/schema";
import { DEFAULT_CENSUS, census, individuals } from "@bl/metrics";
import { GpuSim, requestDevice } from "@bl/sim-gpu";
import { encodePng } from "./lib/png.ts";
import { loadCheckpoint, runPeriod, saveCheckpoint } from "./lib/pond-gpu.ts";
import {
  POND_COLUMNS,
  applyPondCycle,
  assertConserved,
  cloneWorld,
  contRows,
  foundersWorld,
  ledgerEnergy,
  pondConfig,
  pondMatter,
  type PondArm,
  type PondRow,
} from "./lib/ponds.ts";

const SEED_MIN = 4_800_001;
const SEED_MAX = 4_849_999;
const PROTOCOL_PATH = new URL("../docs/scaffold-protocol-v1.md", import.meta.url);
const LINEAGE_HEADER = "boundary\tstep\tpond\thi\tlo\tmass\n";
const PROGRESS_HEADER = "boundary\tstep\twallSeconds\tstepsPerSec\n";
/** Frames are at most this many pixels on a side. */
const FRAME_MAX = 512;
/** At most about this many frames per history: a longer run writes every ceil(C / FRAME_COUNT)-th boundary. */
const FRAME_COUNT = 50;
/** B, P, C at this per-cell value saturate a frame channel (log scale). */
const FRAME_SATURATION = 1024;

const sha256Hex = async (bytes: Uint8Array | string): Promise<string> => {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", data as BufferSource))].map((b) => b.toString(16).padStart(2, "0")).join("");
};

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await Deno.stat(path);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
};

const append = (path: string, text: string) => Deno.writeTextFile(path, text, { append: true });

/** Writes `state` to `path` via a temporary file, so a crash never leaves a torn checkpoint under its real name. */
async function saveAtomic(path: string, state: WorldState): Promise<void> {
  await saveCheckpoint(`${path}.tmp`, state);
  await Deno.rename(`${path}.tmp`, path);
}

/**
 * ckpt/status.json: the lifecycle state of the checkpoint about to be saved (its boundary, and whether the
 * history ended at it). It is written before that checkpoint, atomically, so after a crash a status is either
 * level with the checkpoints or ahead of them (then it names a boundary no checkpoint holds and resume ignores it),
 * never behind them.
 */
interface CkptStatus {
  boundary: number;
  ended: boolean;
  endedAt?: number;
}

async function writeStatus(path: string, status: CkptStatus): Promise<void> {
  await Deno.writeTextFile(`${path}.tmp`, JSON.stringify(status) + "\n");
  await Deno.rename(`${path}.tmp`, path);
}

async function readStatus(path: string): Promise<CkptStatus | null> {
  try {
    return JSON.parse(await Deno.readTextFile(path));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null;
    throw e;
  }
}

/**
 * Truncates the tab-separated table at `path` to the rows whose first field is <= `keep` (rows are in
 * ascending order of it; the header line is kept), dropping a torn last line too. Streams in 1 MiB chunks.
 */
async function truncateAfter(path: string, keep: number): Promise<void> {
  const f = await Deno.open(path, { read: true, write: true });
  try {
    const buf = new Uint8Array(1 << 20);
    let offset = 0;
    let lineStart = 0;
    let lineNo = 0;
    let field = 0;
    let inFirst = true;
    let cut = -1;
    scan: for (;;) {
      const n = await f.read(buf);
      if (n === null) break;
      for (let i = 0; i < n; i++) {
        const c = buf[i];
        if (c === 0x0a) {
          lineNo++;
          lineStart = offset + i + 1;
          field = 0;
          inFirst = true;
        } else if (inFirst && c === 0x09) {
          inFirst = false;
          if (lineNo > 0 && field > keep) {
            cut = lineStart;
            break scan;
          }
        } else if (inFirst && c >= 0x30 && c <= 0x39) field = field * 10 + (c - 0x30);
      }
      offset += n;
    }
    if (cut < 0 && lineStart < offset) cut = lineStart; // torn last line
    if (cut >= 0) await f.truncate(cut);
  } finally {
    f.close();
  }
}

/** Per pond, the trait mass (B+P over cells with B+P >= 48) of each lineage: `boundary step pond hi lo mass` rows. */
function lineageRows(state: WorldState, b: number): string {
  const cfg = state.cfg;
  const n = cellCount(cfg);
  const W = worldW(cfg);
  const perPond = Array.from({ length: cfg.tilesX * cfg.tilesY }, () => new Map<string, { hi: number; lo: number; mass: number }>());
  for (let i = 0; i < n; i++) {
    const m = state.cells[CH.B * n + i] + state.cells[CH.P * n + i];
    if (m < DEFAULT_CENSUS.threshold) continue;
    const hi = state.genome[G.LIN_HI * n + i], lo = state.genome[G.LIN_LO * n + i];
    if ((hi | lo) === 0) continue;
    const x = i % W;
    const pond = perPond[Math.floor(Math.floor(i / W) / cfg.tileH) * cfg.tilesX + Math.floor(x / cfg.tileW)];
    const key = `${hi}:${lo}`;
    const e = pond.get(key);
    if (e) e.mass += m;
    else pond.set(key, { hi, lo, mass: m });
  }
  const out: string[] = [];
  perPond.forEach((lin, p) => {
    for (const e of [...lin.values()].sort((a, c) => a.hi - c.hi || a.lo - c.lo)) out.push(`${b}\t${state.step}\t${p}\t${e.hi}\t${e.lo}\t${e.mass}`);
  });
  return out.length ? out.join("\n") + "\n" : "";
}

/** The M3 census's individuals per pond, and the distinct dominant lineages among them. */
function pondCensus(state: WorldState): { individuals: number[]; lineages: number[] } {
  const cfg = state.cfg;
  const c = census({ cfg, step: state.step, cells: state.cells, genomeHead: state.genome });
  const R = cfg.tilesX * cfg.tilesY;
  const count = new Array<number>(R).fill(0);
  const seen = Array.from({ length: R }, () => new Set<string>());
  for (const k of individuals(c)) {
    count[k.tile]++;
    seen[k.tile].add(k.lineage);
  }
  return { individuals: count, lineages: seen.map((s) => s.size) };
}

/** A pre-cycle frame: B green, P blue, C red on a log scale, light grey pond borders; block-averaged to <= 512 px. */
async function frame(state: WorldState): Promise<Uint8Array> {
  const cfg = state.cfg;
  const n = cellCount(cfg);
  const W = worldW(cfg), H = cfg.tilesY * cfg.tileH;
  let f = 1;
  while (Math.max(W, H) / f > FRAME_MAX) f *= 2;
  const w = Math.ceil(W / f), h = Math.ceil(H / f);
  const tile = Math.max(1, Math.floor(cfg.tileW / f)), tileV = Math.max(1, Math.floor(cfg.tileH / f));
  const rgb = new Uint8Array(w * h * 3);
  const top = Math.log1p(FRAME_SATURATION);
  const level = (sum: number) => Math.min(255, Math.round((255 * Math.log1p(sum / (f * f))) / top));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3;
      if (x % tile === 0 || y % tileV === 0) {
        rgb[o] = rgb[o + 1] = rgb[o + 2] = 160;
        continue;
      }
      let sc = 0, sb = 0, sp = 0;
      for (let dy = 0; dy < f; dy++)
        for (let dx = 0; dx < f; dx++) {
          const i = (y * f + dy) * W + x * f + dx;
          sc += state.cells[CH.C * n + i];
          sb += state.cells[CH.B * n + i];
          sp += state.cells[CH.P * n + i];
        }
      rgb[o] = level(sc);
      rgb[o + 1] = level(sb);
      rgb[o + 2] = level(sp);
    }
  }
  return await encodePng(w, h, rgb);
}

const rowText = (r: PondRow): string => POND_COLUMNS.map((c) => String(r[c])).join("\t");

function int(name: string, v: string | undefined, lo: number, hi = Number.MAX_SAFE_INTEGER): number {
  if (v === undefined) throw new Error(`--${name} is required`);
  const x = Number(v);
  if (!Number.isInteger(x) || x < lo || x > hi) throw new Error(`--${name} must be an integer in ${lo}..${hi}, got ${JSON.stringify(v)}`);
  return x;
}

async function evolve(argv: string[]): Promise<void> {
  const a = parseArgs(argv, {
    string: ["arm", "k", "period", "cycles", "side", "seed", "out", "init", "census", "ckpt-every"],
    boolean: ["mut-off", "frames", "resume", "allow-any-seed"],
    default: { init: "clone", census: "100", "ckpt-every": "50" },
  });
  if (!a.out) throw new Error("--out is required");
  const out = a.out;
  if (a.arm !== "scaf" && a.arm !== "rand" && a.arm !== "cont") throw new Error("--arm must be scaf, rand or cont");
  const arm: PondArm = a.arm;
  if (a.init !== "clone" && a.init !== "founders") throw new Error("--init must be clone or founders");
  const init: "clone" | "founders" = a.init;
  const k = arm === "cont" && a.k === undefined ? 0 : int("k", a.k, 1, 64);
  const period = int("period", a.period, 1);
  const C = int("cycles", a.cycles, 1);
  const side = int("side", a.side, 1);
  const seed = int("seed", a.seed, 0, 0xffffffff);
  const censusEvery = int("census", a.census, 1);
  const ckptEvery = int("ckpt-every", a["ckpt-every"], 1);
  if (!a["allow-any-seed"] && (seed < SEED_MIN || seed > SEED_MAX)) throw new Error(`--seed ${seed} is outside ${SEED_MIN}-${SEED_MAX} (--allow-any-seed is for smoke tests only)`);

  const cfg0 = pondConfig(side, seed, a["mut-off"] ? 0 : undefined);
  const protocolSha256 = await sha256Hex(await Deno.readFile(PROTOCOL_PATH));
  const ckptDir = `${out}/ckpt`;
  const ckptPath = (b: number, kind: "pre" | "post") => `${ckptDir}/b${b}-${kind}.blck.gz`;
  const statusPath = `${ckptDir}/status.json`;

  // Boundary schedules (contract): posts at floor(C/3), floor(2C/3), C and every --ckpt-every; a pre at C.
  const third = new Set([Math.floor(C / 3), Math.floor((2 * C) / 3), C].filter((b) => b >= 1));
  const keepCkpt = (b: number) => third.has(b) || b % ckptEvery === 0;
  const keepLineages = (b: number) => cfg0.mutRate === 0 || b === 1 || third.has(b);
  const frameEvery = Math.ceil(C / FRAME_COUNT);
  const keepFrame = (b: number) => b === C || b === 1 || b % frameEvery === 0;

  let state: WorldState;
  let meta: Record<string, unknown>;
  let b0 = 0;
  let wallBefore = 0;
  const conserved = { startMatter: 0n, baseline: 0n };
  let Mr: number[];
  /** Set when --resume finds the history already ended at its latest checkpoint. */
  let resumedEnded: { endedAt: number; wall: number } | undefined;

  if (a.resume) {
    meta = JSON.parse(await Deno.readTextFile(`${out}/meta.json`));
    for (const [key, want] of Object.entries({ arm, k, period, side, seed, mutRate: cfg0.mutRate, init, censusEvery, protocolSha256 }))
      if (meta[key] !== want) throw new Error(`--resume: ${key} is ${JSON.stringify(want)} but ${out}/meta.json has ${JSON.stringify(meta[key])}`);
    if (await fileExists(`${out}/done.json`)) {
      const done = JSON.parse(await Deno.readTextFile(`${out}/done.json`));
      if (done.ended) {
        console.log(`history ended at cycle ${done.endedAt}; nothing to resume`);
        return;
      }
    }
    const want = arm === "cont" ? "pre" : "post";
    for await (const e of Deno.readDir(ckptDir)) {
      const m = /^b(\d+)-(pre|post)\.blck\.gz$/.exec(e.name);
      if (m && m[2] === want && Number(m[1]) <= C) b0 = Math.max(b0, Number(m[1]));
    }
    // A crash before the first boundary checkpoint restarts from the initial state.
    if (b0 === 0 && !(await fileExists(`${ckptDir}/init.blck.gz`))) throw new Error(`--resume: no ${want}-cycle checkpoint at or before cycle ${C} and no init.blck.gz in ${ckptDir}`);
    state = await loadCheckpoint(b0 === 0 ? `${ckptDir}/init.blck.gz` : ckptPath(b0, want));
    if (state.step !== b0 * period) throw new Error(`checkpoint ${b0 === 0 ? "init" : `b${b0}`} is at step ${state.step}, expected ${b0 * period}`);
    // A status for this very checkpoint says whether the history ended there (the crash came before done.json).
    const status = b0 > 0 ? await readStatus(statusPath) : null;
    const endedHere = status !== null && status.boundary === b0 && status.ended;
    if (endedHere && (status.endedAt !== b0 || arm === "cont")) throw new Error(`${statusPath} says the history ended at cycle ${status.endedAt} but its checkpoint is b${b0}`);
    if (endedHere && !(await fileExists(ckptPath(b0, "pre")))) throw new Error(`--resume: the history ended at cycle ${b0} but ${ckptPath(b0, "pre")} is missing`);
    conserved.startMatter = BigInt(meta.startMatter as string);
    conserved.baseline = BigInt(meta.baseline as string);
    Mr = meta.Mr as number[];
    assertConserved(state, conserved.startMatter, conserved.baseline);
    await truncateAfter(`${out}/ponds.tsv`, b0);
    await truncateAfter(`${out}/lineages.tsv`, b0);
    await truncateAfter(`${out}/progress.tsv`, b0);
    const rows = (await Deno.readTextFile(`${out}/progress.tsv`)).trim().split("\n");
    wallBefore = rows.length > 1 ? Number(rows[rows.length - 1].split("\t")[2]) : 0;
    // A pre-cycle checkpoint belongs to the final boundary only (cont keeps its own schedule); an ended history keeps its terminal one.
    if (arm !== "cont" && !endedHere) for await (const e of Deno.readDir(ckptDir)) if (/-pre\.blck\.gz$/.test(e.name) && e.name !== `b${C}-pre.blck.gz`) await Deno.remove(`${ckptDir}/${e.name}`);
    try {
      await Deno.remove(`${out}/done.json`);
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
    meta = { ...meta, cycles: C };
    await Deno.writeTextFile(`${out}/meta.json`, JSON.stringify(meta, null, 2) + "\n");
    if (endedHere) resumedEnded = { endedAt: b0, wall: wallBefore };
    else if (status !== null) await Deno.remove(statusPath); // ahead of the checkpoints, or level with a history that did not end
  } else {
    if (await fileExists(`${out}/meta.json`)) throw new Error(`${out} already holds a run; pass --resume or choose a new --out`);
    let plantingToFounder: number[] | undefined;
    if (init === "clone") state = cloneWorld(cfg0, founderGenome(M3_FOUNDERS[2]));
    else {
      const w = foundersWorld(cfg0);
      state = w.state;
      plantingToFounder = w.plantingToFounder;
    }
    conserved.startMatter = totalsOf(state.cfg, state.cells).matter;
    conserved.baseline = ledgerEnergy(state);
    Mr = pondMatter(state);
    meta = {
      tool: "scaffold",
      protocolSha256,
      ruleVersion: RULE_VERSION,
      arm,
      k,
      period,
      cycles: C,
      side,
      seed,
      mutRate: state.cfg.mutRate,
      init,
      ...(plantingToFounder ? { plantingToFounder } : {}),
      Mr,
      startMatter: conserved.startMatter.toString(),
      baseline: conserved.baseline.toString(),
      censusEvery,
      config: state.cfg as WorldConfig,
      configSha256: await sha256Hex(JSON.stringify(state.cfg)),
    };
    // meta.json goes last: it is what makes the directory a run, so a crash before it leaves nothing --resume would trust.
    await Deno.mkdir(ckptDir, { recursive: true });
    await saveAtomic(`${ckptDir}/init.blck.gz`, state);
    await Deno.writeTextFile(`${out}/ponds.tsv`, POND_COLUMNS.join("\t") + "\n");
    await Deno.writeTextFile(`${out}/lineages.tsv`, LINEAGE_HEADER);
    await Deno.writeTextFile(`${out}/progress.tsv`, PROGRESS_HEADER);
    await Deno.writeTextFile(`${out}/meta.json`, JSON.stringify(meta, null, 2) + "\n");
  }
  if (resumedEnded) {
    const summary = { ok: true, conservationOk: true, cycles: resumedEnded.endedAt, ended: true, endedAt: resumedEnded.endedAt, wallSeconds: Math.round(resumedEnded.wall * 100) / 100 };
    await Deno.writeTextFile(`${out}/done.json`, JSON.stringify(summary, null, 2) + "\n");
    console.log(`history ended at cycle ${resumedEnded.endedAt}; done.json restored, nothing to advance`);
    return;
  }
  if (a.frames) await Deno.mkdir(`${out}/frames`, { recursive: true });

  const device = await requestDevice(navigator.gpu, state.cfg);
  const sim = await GpuSim.create(device, state);
  const t0 = performance.now();
  const wall = () => wallBefore + (performance.now() - t0) / 1000;
  let conservationOk = true;
  let ended = false;
  let endedAt: number | undefined;
  let error: string | undefined;
  let done = b0;

  for (let b = b0 + 1; b <= C && conservationOk && !ended; b++) {
    const p0 = performance.now();
    const res = await runPeriod(sim, device, period, censusEvery, conserved);
    const periodSeconds = (performance.now() - p0) / 1000;
    if (!res.conservationOk) {
      conservationOk = false;
      error = `matter or energy ledger violated during period ${b}`;
      break;
    }
    const pre = await sim.readState();
    try {
      if (pre.step !== b * period) throw new Error(`boundary ${b} is at step ${pre.step}, expected ${b * period}`);
      assertConserved(pre, conserved.startMatter, conserved.baseline);
    } catch (e) {
      conservationOk = false;
      error = (e as Error).message;
      break;
    }

    if (keepLineages(b)) await append(`${out}/lineages.tsv`, lineageRows(pre, b));
    if (a.frames && keepFrame(b)) await Deno.writeFile(`${out}/frames/b${b}.png`, await frame(pre));
    let rows: PondRow[];
    let post: WorldState | undefined;
    if (arm === "cont") rows = contRows(pre, b, pondCensus);
    else {
      try {
        if (b === C) await saveAtomic(ckptPath(b, "pre"), pre);
        const cyc = applyPondCycle(pre, b, arm, k, Mr, pondCensus);
        assertConserved(cyc.state, conserved.startMatter, conserved.baseline);
        rows = cyc.rows;
        post = cyc.state;
        if (cyc.ended) {
          ended = true;
          endedAt = b;
          if (b !== C) await saveAtomic(ckptPath(b, "pre"), pre);
        }
      } catch (e) {
        conservationOk = false;
        error = (e as Error).message;
        break;
      }
    }
    await append(`${out}/ponds.tsv`, rows.map(rowText).join("\n") + "\n");
    await append(`${out}/progress.tsv`, `${b}\t${pre.step}\t${wall().toFixed(2)}\t${(period / periodSeconds).toFixed(1)}\n`);
    if (post) {
      sim.upload(post);
      if (keepCkpt(b) || ended) {
        await writeStatus(statusPath, { boundary: b, ended, ...(endedAt !== undefined ? { endedAt } : {}) });
        await saveAtomic(ckptPath(b, "post"), post);
      }
    } else if (keepCkpt(b)) {
      await writeStatus(statusPath, { boundary: b, ended: false });
      await saveAtomic(ckptPath(b, "pre"), pre);
    }
    done = b;
    const last = post ?? pre;
    console.log(`cycle ${b}/${C} step ${pre.step} ${(period / periodSeconds).toFixed(0)} st/s hash ${stateHash(last)}${ended ? " (no pond survived: history ended)" : ""}`);
  }

  const seconds = wall();
  const summary = { ok: conservationOk && done === (ended ? endedAt : C), conservationOk, cycles: done, ended, ...(endedAt !== undefined ? { endedAt } : {}), wallSeconds: Math.round(seconds * 100) / 100, ...(error ? { error } : {}) };
  await Deno.writeTextFile(`${out}/done.json`, JSON.stringify(summary, null, 2) + "\n");
  console.log(`done: ${JSON.stringify(summary)}`);
  sim.destroy();
  if (!summary.ok) Deno.exit(1);
}

if (import.meta.main) {
  const [cmd, ...rest] = Deno.args;
  if (cmd === "evolve") await evolve(rest);
  else {
    console.error("usage: deno run -A tools/scaffold.ts evolve --arm scaf|rand|cont --k K --period N --cycles C --side S --seed SEED --out DIR [options]; see the file header");
    Deno.exit(2);
  }
}
