/// <reference lib="webworker" />
// Owns the WebGPU device, the fixed-step loop, rendering, censuses and storage.
//
// Concurrency model: message handlers can interleave at every await, so all
// state-changing and persistence operations run one at a time through
// `exclusive()`, which also pauses the frame loop. Each world gets a
// generation number; asynchronous readbacks started for one world are
// discarded if another world has been adopted before they resolve.

import {
  CH,
  G,
  PRESETS,
  RULE_VERSION,
  cellCount,
  decodeGenome,
  encodeCheckpoint,
  initWorld,
  presetConfig,
  stateHash,
  totalsOf,
  worldW,
  type WorldState,
} from "@bl/schema";
import { GpuSim, Renderer, requestDevice, type GpuViewMode, type ViewRect } from "@bl/sim-gpu";
import { census, individuals, lineageRGB } from "@bl/metrics";
import { decodeArtifact, pondContinuationError, type ObserverSettings, type ObserverState } from "@bl/runner";
import { LabExecution } from "./execution.ts";
import type { CensusMsg, FromWorker, RunManifest, ToWorker } from "./protocol.ts";
import { forgetCheckpoint, listCheckpoints, readFile, recordCheckpoint, writeFile } from "./opfs.ts";

/**
 * The interactive lab's observation settings (fixed; there is no per-run
 * spec here). Persisted observations happen exactly every `censusEvery`
 * simulation steps from the world's start, like the headless runner, so
 * identical physics yields identical observer state however the lab was
 * played, paused or saved. `deepEvery` only affects runner series records.
 * The threshold is uncalibrated (`null` = Infinity) in the lab.
 */
const DEFAULT_SETTINGS: ObserverSettings = { censusEvery: 100, deepEvery: 5, activityThreshold: null };

const post = (m: FromWorker, transfer: Transferable[] = []) => (self as DedicatedWorkerGlobalScope).postMessage(m, transfer);

interface World {
  gen: number;
  sim: GpuSim;
  renderer: Renderer;
  manifest: RunManifest;
  /** Ledger baseline: content + heat - light, invariant under exact rules. */
  baseline: bigint;
  startMatter: bigint;
  execution: LabExecution;
}

let device: GPUDevice | null = null;
let adapterDesc = "";
let canvas: OffscreenCanvas | null = null;
let ctx: GPUCanvasContext | null = null;
let format: GPUTextureFormat = "bgra8unorm";
let world: World | null = null;
let generation = 0;

let playing = false;
let stepsPerFrame = 4;
let pendingSteps = 0;
let mode: GpuViewMode = "composite";
let rect: ViewRect = { x: 0, y: 0, w: 256, h: 256 };
let inflight: Promise<unknown> | null = null;
let busy = 0;

let lastStatsAt = 0;
let lastCensusAt = 0;
let statsBusy = false;
let censusBusy = false;
let rateStep = 0;
let rateAt = performance.now();
let stepsPerSec = 0;
let frames = 0;
let fps = 0;

// ---- exclusive operation queue ----
let tail: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = async () => {
    busy++;
    try {
      await inflight;
      return await fn();
    } finally {
      busy--;
    }
  };
  const p = tail.then(run, run);
  tail = p.catch(() => undefined);
  return p;
}

const raf: (cb: () => void) => void =
  typeof (self as unknown as { requestAnimationFrame?: unknown }).requestAnimationFrame === "function"
    ? (cb) => (self as unknown as { requestAnimationFrame(cb: () => void): void }).requestAnimationFrame(cb)
    : (cb) => setTimeout(cb, 16);

async function init(c: OffscreenCanvas, w: number, h: number) {
  if (!navigator.gpu) throw new Error("WebGPU is not available in this browser (or in workers).");
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("No WebGPU adapter found.");
  const info = adapter.info;
  adapterDesc = [info?.vendor, info?.architecture, info?.description].filter(Boolean).join(" ") || "unknown GPU";
  device = await requestDevice(navigator.gpu);
  device.lost.then((l) => post({ type: "error", message: `GPU device lost: ${l.message}. Reload to recover from the last checkpoint.` }));
  device.addEventListener("uncapturederror", (e) => post({ type: "error", message: (e as GPUUncapturedErrorEvent).error.message }));
  canvas = c;
  canvas.width = w;
  canvas.height = h;
  ctx = canvas.getContext("webgpu") as GPUCanvasContext;
  format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: "opaque" });
  post({ type: "ready", adapter: adapterDesc });
  raf(frame);
}

/**
 * Builds the replacement first; the current world survives if that fails.
 * `observer` rehydrates the tracker/activity/counters from a restored or
 * imported checkpoint; omitted for a fresh `load()`, which starts clean.
 */
async function adopt(state: WorldState, manifest: RunManifest, observer?: ObserverState) {
  if (!device || !ctx) throw new Error("GPU not initialised");
  // The runner's continuation guard: a pond world's observer must say its
  // last cycle is floor(step / pondPeriod). A pre-cycle state at a boundary
  // would otherwise skip that cycle, since a history never cycles at its start.
  const pondError = pondContinuationError(state.cfg, observer, state.step);
  if (pondError) throw new Error(pondError);
  const sim = await GpuSim.create(device, state);
  let renderer: Renderer;
  let execution: LabExecution;
  try {
    execution = new LabExecution(sim, manifest.settings, {
      observer,
      start: state,
      waitForIdle: () => device!.queue.onSubmittedWorkDone(),
      isCurrent: () => world?.execution === execution,
      onObservation: (c, dropped) => {
        if (dropped > 0) post({ type: "notice", message: `${dropped} mutation events dropped (event buffer full); lineage history is incomplete` });
        const now = performance.now();
        if (now - lastCensusAt > 500) {
          lastCensusAt = now;
          postCensus(world!, c);
        }
      },
      // Every cycle, unthrottled: one per pondPeriod steps.
      onPondCycle: (cycle, step) => post({ type: "ponds", step, cycle: cycle.b, arm: sim.cfg.pondArm!, donors: cycle.donors }),
      onDisplayError: (message) => post({ type: "error", message: `census display: ${message}` }),
    });
    renderer = new Renderer(device, ctx, format, sim);
  } catch (e) {
    sim.destroy();
    throw e;
  }
  const t = totalsOf(state.cfg, state.cells);
  const old = world;
  world = {
    gen: ++generation,
    sim,
    renderer,
    manifest,
    baseline: t.energy + state.heatOut - state.lightIn,
    startMatter: t.matter,
    execution,
  };
  old?.renderer.destroy();
  old?.sim.destroy();
  // Steps requested for the previous world do not carry over.
  pendingSteps = 0;
  playing = false;
  rect = Renderer.fullView(sim);
  rateStep = sim.step;
  rateAt = performance.now();
  post({ type: "loaded", manifest, step: sim.step });
}

function newManifest(presetId: string, seed: number, state: WorldState, init: RunManifest["init"], settings: ObserverSettings): RunManifest {
  return {
    runId: `${presetId}-s${seed}-${Date.now().toString(36)}`,
    presetId,
    seed,
    cfg: state.cfg,
    init,
    ruleVersion: RULE_VERSION,
    createdAt: new Date().toISOString(),
    adapter: adapterDesc,
    userAgent: navigator.userAgent,
    interventions: [],
    checkpoints: [],
    settings,
  };
}

async function load(presetId: string, seed: number, overrides = {}) {
  const preset = PRESETS.find((p) => p.id === presetId);
  if (!preset) throw new Error(`unknown preset "${presetId}"`);
  const cfg = presetConfig(preset, seed, overrides);
  const state = initWorld(cfg, preset.init);
  await adopt(state, newManifest(preset.id, seed, state, preset.init, DEFAULT_SETTINGS));
}

function frame() {
  frames++;
  const w = world;
  if (w && !busy && !inflight) {
    // The same in-flight promise guards both frame advancement and rendering;
    // exclusive operations wait for its census/migration before touching state.
    inflight = drawFrame(w).finally(() => (inflight = null));
  }
  raf(frame);
}

async function drawFrame(w: World) {
  const requestedPending = pendingSteps;
  let settled = false;
  try {
    if (!w.execution.failure) {
      const consumed = await w.execution.advanceFrame(requestedPending + (playing ? stepsPerFrame : 0));
      // Step requests arriving during readback belong to the next frame.
      pendingSteps -= Math.min(requestedPending, consumed);
    }
    settled = true;
    w.renderer.draw(mode, rect, canvas!.width, canvas!.height);
    await device!.queue.onSubmittedWorkDone();
  } catch (e) {
    playing = false;
    if (w.execution.failure) pendingSteps = 0;
    // A rejected request (e.g. past the step limit) is dropped rather than retried every frame.
    else if (!settled) pendingSteps = Math.max(0, pendingSteps - requestedPending);
    post({ type: "error", message: w.execution.failure ?? (e instanceof Error ? e.message : String(e)) });
  }
  const now = performance.now();
  if (now - rateAt > 1000) {
    stepsPerSec = ((w.sim.step - rateStep) * 1000) / (now - rateAt);
    fps = (frames * 1000) / (now - rateAt);
    rateStep = w.sim.step;
    rateAt = now;
    frames = 0;
  }
  if (now - lastStatsAt > 400 && !statsBusy) {
    lastStatsAt = now;
    void sendStats(w);
  }
  if (now - lastCensusAt > (playing ? 1200 : 600) && !censusBusy) {
    lastCensusAt = now;
    void sendCensus(w);
  }
}

const current = (w: World) => world === w && w.gen === generation;

async function sendStats(w: World) {
  statsBusy = true;
  try {
    const s = await w.sim.readStats();
    if (!current(w)) return;
    const cfg = w.sim.cfg;
    const energy = s.A * BigInt(cfg.eA) + s.B * BigInt(cfg.eB) + s.C * BigInt(cfg.eC) + s.P * BigInt(cfg.eP) + s.E + s.S;
    const residual = energy + s.heatOut - s.lightIn - w.baseline;
    const matter = s.A + s.B + s.C + s.P;
    post({
      type: "stats",
      step: s.step,
      stepsPerSec,
      fps,
      A: Number(s.A),
      B: Number(s.B),
      C: Number(s.C),
      P: Number(s.P),
      E: Number(s.E),
      S: Number(s.S),
      matter: Number(matter),
      living: s.living,
      dense: s.dense,
      lightIn: Number(s.lightIn),
      heatOut: Number(s.heatOut),
      residual: residual.toString(),
      matterDelta: (matter - w.startMatter).toString(),
    });
  } catch (e) {
    if (current(w)) post({ type: "error", message: `stats: ${e instanceof Error ? e.message : e}` });
  } finally {
    statsBusy = false;
  }
}

function postCensus(w: World, c: ReturnType<typeof census>) {
  const ind = individuals(c);
  const total = c.lineages.reduce((a, l) => a + l.mass, 0) || 1;
  // Totals include events carried over from restored segments.
  const msg: CensusMsg = {
    type: "census",
    step: c.step,
    individuals: ind.length,
    meanMass: ind.reduce((a, k) => a + k.mass, 0) / Math.max(1, ind.length),
    lineageCount: c.lineages.length,
    top: c.lineages.slice(0, 6).map((l) => {
      const [hi, lo] = l.key.split(":").map(Number);
      return { key: l.key, share: l.mass / total, color: lineageRGB(hi, lo) };
    }),
    ...w.execution.counts(),
  };
  post(msg);
}

/** Display-only census of the current step (while paused or between boundaries); observers are untouched. */
async function sendCensus(w: World) {
  censusBusy = true;
  try {
    const snap = await w.sim.readSnapshot(false);
    if (!current(w)) return;
    postCensus(w, census({ cfg: w.sim.cfg, step: snap.step, cells: snap.cells, genomeHead: snap.genomeHead }));
  } catch (e) {
    if (current(w)) post({ type: "error", message: `census: ${e instanceof Error ? e.message : e}` });
  } finally {
    censusBusy = false;
  }
}

async function probe(x: number, y: number) {
  const w = world;
  if (!w) return;
  const W = worldW(w.sim.cfg);
  const H = cellCount(w.sim.cfg) / W;
  const cx = ((Math.floor(x) % W) + W) % W;
  const cy = ((Math.floor(y) % H) + H) % H;
  const p = await w.sim.probe(cy * W + cx);
  if (!current(w)) return;
  const names = Object.keys(CH) as (keyof typeof CH)[];
  const cellsRec: Record<string, number> = {};
  for (const k of names) cellsRec[k] = p.cells[CH[k]];
  const g = decodeGenome(p.genome);
  const hi = p.genome[G.LIN_HI], lo = p.genome[G.LIN_LO];
  post({
    type: "probe",
    x: cx,
    y: cy,
    step: p.step,
    cells: cellsRec,
    lineage: hi | lo ? `${hi}:${lo}` : "",
    mu: g.mu,
    sigma: g.sigma,
    motGain: g.motGain,
    weights: Array.from(g.weights),
  });
}

async function save() {
  const w = world;
  if (!w) return;
  const { state, observer, advanced } = await w.execution.checkpoint();
  if (advanced) post({ type: "notice", message: `Advanced ${advanced} steps to the census at t=${state.step}` });
  const m = w.manifest;
  const bytes = encodeCheckpoint(state, observer);
  // Unique even after a restore trims the manifest's checkpoint list.
  const file = `${m.runId}-t${state.step}-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}.blck`;
  await writeFile(file, bytes);
  m.checkpoints.push({ step: state.step, file, hash: stateHash(state), interventions: m.interventions.length });
  await writeFile(`${m.runId}.run.json`, new TextEncoder().encode(JSON.stringify(m)));
  await recordCheckpoint({ file, runId: m.runId, step: state.step, bytes: bytes.byteLength, savedAt: new Date().toISOString() });
  post({ type: "notice", message: `Saved ${file} (${(bytes.byteLength / 1e6).toFixed(1)} MB)` });
  post({ type: "checkpoints", list: await listCheckpoints() });
}

/** A branch's id: derived from the original so it stays traceable, but never collides with it. */
function forkRunId(runId: string): string {
  return `${runId}-b${Date.now().toString(36)}`;
}

async function restore(file: string) {
  const meta = (await listCheckpoints()).find((c) => c.file === file);
  if (!meta) throw new Error(`unknown checkpoint ${file}`);
  const { state, observer } = decodeArtifact(await readFile(file));
  let m: RunManifest;
  try {
    const saved: RunManifest = JSON.parse(new TextDecoder().decode(await readFile(`${meta.runId}.run.json`)));
    const ck = saved.checkpoints.find((c) => c.file === file);
    if (!ck) throw new Error("checkpoint missing from manifest");
    // Continuing exactly where the run left off keeps its id; restoring to
    // an earlier point forks, so a later save never overwrites this
    // manifest's later checkpoints (and their provenance) again.
    const last = saved.checkpoints[saved.checkpoints.length - 1] === ck;
    m = {
      ...saved,
      runId: last ? saved.runId : forkRunId(saved.runId),
      // Keep exactly the interventions the checkpoint already contains.
      interventions: saved.interventions.slice(0, ck.interventions),
      checkpoints: saved.checkpoints.slice(0, saved.checkpoints.indexOf(ck) + 1),
    };
  } catch {
    // No confirmed, intact prior manifest to safely continue: always fork,
    // never reuse the old run's id (a missing/corrupt manifest is not "the
    // same run, resumed", it's a fresh branch from this checkpoint).
    m = importedManifest(state, forkRunId(meta.runId), observer.settings);
  }
  await adopt(state, m, observer);
  post({ type: "notice", message: `Restored ${file} at step ${state.step}` });
}

function importedManifest(state: WorldState, runId: string, settings: ObserverSettings): RunManifest {
  return { ...newManifest("imported", state.cfg.seed, state, { kind: "generalist", founders: 0, nutrient: 0, biomass: 0 }, settings), runId };
}

async function exportRun() {
  const w = world;
  if (!w) return;
  const { state, observer, advanced } = await w.execution.checkpoint();
  if (advanced) post({ type: "notice", message: `Advanced ${advanced} steps to the census at t=${state.step}` });
  const bytes = encodeCheckpoint(state, observer);
  post({ type: "exported", bytes: bytes.buffer as ArrayBuffer, name: `${w.manifest.runId}-t${state.step}.blck` }, [bytes.buffer as ArrayBuffer]);
}

/** Same-device replay check; execution owns the twin's cadence and cleanup. */
async function verify(steps: number) {
  const w = world;
  if (!w || !device) return;
  const { from, liveHash: a, twinHash: b } = await w.execution.verify(steps, (state) => GpuSim.create(device!, state));
  post({ type: "verify", ok: a === b, detail: `${steps} steps from t=${from}: ${a}${a === b ? " = " : " ≠ "}${b}` });
}

async function lesion(x: number, y: number, r: number) {
  const w = world;
  if (!w) return;
  const W = worldW(w.sim.cfg);
  const H = cellCount(w.sim.cfg) / W;
  const cx = ((Math.floor(x) % W) + W) % W;
  const cy = ((Math.floor(y) % H) + H) % H;
  const step = w.sim.step;
  const eff = w.sim.lesion(cx, cy, r);
  w.manifest.interventions.push({ step, kind: "lesion", x: cx, y: cy, r: eff });
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  const fail = (e: unknown) => {
    if (world?.execution.failure) { playing = false; pendingSteps = 0; }
    post({ type: "error", message: world?.execution.failure ?? (e instanceof Error ? e.message : String(e)) });
  };
  switch (m.type) {
    // Immediate, non-exclusive controls.
    case "play":
      playing = m.playing;
      return;
    case "speed":
      stepsPerFrame = Math.max(1, Math.min(512, Math.round(m.stepsPerFrame)));
      return;
    case "step":
      pendingSteps += Math.max(0, Math.floor(m.count));
      return;
    case "view":
      mode = m.mode;
      rect = m.rect;
      return;
    case "resize":
      if (canvas) {
        canvas.width = Math.max(1, m.width);
        canvas.height = Math.max(1, m.height);
      }
      return;
    case "init":
      init(m.canvas, m.width, m.height).catch(fail);
      return;
  }
  // Everything else is serialized.
  exclusive(async () => {
    switch (m.type) {
      case "load":
        return load(m.presetId, m.seed, m.overrides);
      case "lesion":
        return lesion(m.x, m.y, m.r);
      case "probe":
        return probe(m.x, m.y);
      case "save":
        return save();
      case "listCheckpoints":
        return post({ type: "checkpoints", list: await listCheckpoints() });
      case "restore":
        return restore(m.file);
      case "deleteCheckpoint":
        await forgetCheckpoint(m.file);
        return post({ type: "checkpoints", list: await listCheckpoints() });
      case "export":
        return exportRun();
      case "import": {
        const { state, observer } = decodeArtifact(new Uint8Array(m.bytes));
        await adopt(state, importedManifest(state, m.name.replace(/\.blck$/, ""), observer.settings), observer);
        return post({ type: "notice", message: `Imported ${m.name} at step ${state.step}` });
      }
      case "verify":
        return verify(m.steps);
    }
  }).catch(fail);
};
