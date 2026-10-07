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
import { MutationEdges, genomesOf, lineageAncestry, parseKey, probeLineage, type GenomeSource } from "@bl/lineage";
import { LabExecution, PondWaitingError, huntArmError } from "./execution.ts";
import { jumpTarget, prunableAuto, replayPlan } from "./checkpoints.ts";
import { createLabSession } from "./session.ts";
import type { CensusMsg, FromWorker, Keep, RunManifest, SessionCommand, ToWorker } from "./protocol.ts";
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

/**
 * Automatic checkpoints, so "jump to step" has somewhere to restore from: one each time a world gets
 * AUTO_EVERY steps past its last checkpoint, keeping the newest AUTO_KEEP automatic ones per run.
 */
const AUTO_EVERY = 20_000;
const AUTO_KEEP = 6;

const post = (m: FromWorker, transfer: Transferable[] = []) => (self as DedicatedWorkerGlobalScope).postMessage(m, transfer);

const session = createLabSession();

function publishSession() {
  const view = session.view();
  session.consume();
  post({ type: "session", view });
}

const sessionCommand = (request: ToWorker["type"]): SessionCommand | null => {
  if (request === "load") return "plant";
  if (request === "save" || request === "restore" || request === "jump" || request === "deleteCheckpoint" || request === "export" || request === "import") return request;
  return null;
};

interface World {
  gen: number;
  sim: GpuSim;
  renderer: Renderer;
  manifest: RunManifest;
  /** Ledger baseline: content + heat - light, invariant under exact rules. */
  baseline: bigint;
  startMatter: bigint;
  /** Bumped whenever a feed moves the baselines, so a stats readback begun before it is discarded. */
  accounting: number;
  execution: LabExecution;
  lineage: LabLineage;
  /** Step of the newest checkpoint saved or restored for this world. */
  lastCheckpoint: number;
}

/** What the lineage inspector knows about a world beyond its live state. */
interface LabLineage {
  /** The step from which the execution's mutation edges are complete. */
  edgesFrom: number;
  /** Genomes known exactly besides the live world's: the start world's, and the state it was loaded from. */
  known: GenomeSource[];
  /** The lineage drawn highlighted, as [hi, lo]. */
  highlight: [number, number] | null;
}

/** A world's genealogy as `adopt` receives it. */
interface AdoptLineage {
  edges: MutationEdges;
  dropped: number;
  edgesFrom: number;
  known: GenomeSource[];
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
let autoQueued = false;
/** Breeder mode (ToWorker "breeder"): a setting of the lab, not of a world, so it carries over to every world adopted. */
let breeder = false;
/** The step of a pond cycle being applied with donors given in breeder mode, for its display message. */
let handCycle = -1;

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
async function adopt(state: WorldState, manifest: RunManifest, observer: ObserverState | undefined, lineage: AdoptLineage) {
  if (!device || !ctx) throw new Error("GPU not initialised");
  // Every world enters here (a new preset, an import, a restore or jump); the hunt's pond arms are refused before any GPU allocation.
  const huntError = huntArmError(state.cfg);
  if (huntError) throw new Error(huntError);
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
      lineage: { edges: lineage.edges, dropped: lineage.dropped },
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
      onPondCycle: (cycle, step) => {
        session.noteWaiting(null);
        publishSession();
        post({ type: "ponds", step, cycle: cycle.b, arm: sim.cfg.pondArm!, donors: cycle.donors, hand: step === handCycle });
      },
      onPondAwait: (s) => {
        const w = world;
        if (w && w.execution === execution) {
          session.noteWaiting({ cycle: s.cycle, step: s.step });
          publishSession();
          post({ type: "pondAwait", world: w.gen, step: s.step, cycle: s.cycle, arm: sim.cfg.pondArm!, score: sim.cfg.pondScore ?? null, suggested: s.suggested, terms: s.terms });
        }
      },
      onDisplayError: (message) => post({ type: "error", message: `census display: ${message}` }),
      // A jump's replay re-applied a logged intervention: it re-enters this run's log, and a feed moves
      // the baselines exactly as it did when it was first made.
      onReplayed: (iv, result) => {
        const w = world;
        if (!w || w.sim !== sim) return;
        if (result) bookFeed(w, result.matter, result.energy);
        w.manifest.interventions.push(iv);
      },
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
    accounting: 0,
    execution,
    lineage: { edgesFrom: lineage.edgesFrom, known: lineage.known, highlight: null },
    lastCheckpoint: state.step,
  };
  old?.renderer.destroy();
  old?.sim.destroy();
  execution.setHandPicks(breeder);
  // Steps requested for the previous world do not carry over.
  pendingSteps = 0;
  playing = false;
  rect = Renderer.fullView(sim);
  rateStep = sim.step;
  rateAt = performance.now();
  session.adopt({ runId: manifest.runId, presetId: manifest.presetId, seed: manifest.seed, step: sim.step, ruleVersion: manifest.ruleVersion });
  post({ type: "loaded", manifest, step: sim.step });
  session.noteShelf(await listCheckpoints());
  publishSession();
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

async function load(presetId: string, seed: number, overrides = {}, keep?: Keep) {
  if (!(await gateReplace("plant", keep))) return;
  const preset = PRESETS.find((p) => p.id === presetId);
  if (!preset) throw new Error(`unknown preset "${presetId}"`);
  const cfg = presetConfig(preset, seed, overrides);
  const huntError = huntArmError(cfg);
  if (huntError) throw new Error(huntError);
  const state = initWorld(cfg, preset.init);
  const manifest = { ...newManifest(preset.id, seed, state, preset.init, DEFAULT_SETTINGS), startHash: stateHash(state), edgesFrom: 0 };
  await adopt(state, manifest, undefined, { edges: new MutationEdges(), dropped: 0, edgesFrom: 0, known: [{ source: "start world", genomes: genomesOf(state, cfg) }] });
}

/** The founders' genomes of a run built here, rebuilt from its preset and accepted only at its recorded start hash. */
function startGenomes(m: RunManifest): GenomeSource | null {
  if (!m.startHash || m.presetId === "imported") return null;
  try {
    const s = initWorld(m.cfg, m.init);
    return stateHash(s) === m.startHash ? { source: "start world", genomes: genomesOf(s, s.cfg) } : null;
  } catch {
    return null;
  }
}

/** A checkpoint's own copy of the run's mutation edges up to it: a save writes only new files, so a failed one cannot damage another checkpoint's genealogy. */
const edgesFile = (checkpoint: string) => `${checkpoint}.edges`;

/** A world loaded from a file outside any run's history: its genealogy starts here. */
function freshLineage(state: WorldState, source: string): AdoptLineage {
  return { edges: new MutationEdges(), dropped: 0, edgesFrom: state.step, known: [{ source, genomes: genomesOf(state, state.cfg) }] };
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
    w.renderer.draw(mode, rect, canvas!.width, canvas!.height, 256, w.lineage.highlight);
    await device!.queue.onSubmittedWorkDone();
  } catch (e) {
    playing = false;
    if (w.execution.failure) pendingSteps = 0;
    // A rejected request (e.g. past the step limit) is dropped rather than retried every frame.
    else if (!settled) pendingSteps = Math.max(0, pendingSteps - requestedPending);
    post({ type: "error", message: w.execution.failure ?? (e instanceof Error ? e.message : String(e)) });
  }
  // A cycle waiting for donors holds a pre-cycle state, which no checkpoint may carry: the save follows the pick.
  if (settled && !autoQueued && !w.execution.failure && !w.execution.awaiting && w.sim.step - w.lastCheckpoint >= AUTO_EVERY) {
    autoQueued = true;
    exclusive(() => autoSave(w))
      .catch((e) => {
        if (!current(w)) return;
        if (session.noteStep(w.sim.step)) publishSession();
        post({ type: "error", message: `automatic checkpoint: ${e instanceof Error ? e.message : e}` });
      })
      .finally(() => (autoQueued = false));
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
  if (current(w) && session.noteStep(w.sim.step)) publishSession();
}

const current = (w: World) => world === w && w.gen === generation;

async function sendStats(w: World) {
  statsBusy = true;
  try {
    // The baselines and the feed total belong to the snapshot: a feed that lands while the readback is
    // awaited moves them, and totals from before it must not be judged against baselines from after it.
    const accounting = w.accounting, fed = w.execution.fed;
    const s = await w.sim.readStats();
    if (!current(w) || w.accounting !== accounting) return;
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
      fed: String(fed.matter),
      feeds: fed.feeds,
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
    ...(g.rings ? { rings: g.rings } : {}),
  });
}

/** Writes a checkpoint of the settled world, the run's mutation edges and its manifest. */
async function saveCheckpoint(w: World, auto: boolean) {
  const { state, observer, advanced, edges, dropped } = await w.execution.checkpoint();
  const m = w.manifest;
  const bytes = encodeCheckpoint(state, observer);
  // Unique even after a restore trims the manifest's checkpoint list.
  const file = `${m.runId}-t${state.step}-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}.blck`;
  await writeFile(file, bytes);
  await writeFile(edgesFile(file), new Uint8Array(w.execution.edges.words().buffer));
  m.checkpoints.push({ step: state.step, file, hash: stateHash(state), interventions: m.interventions.length, edges, dropped, edgesFrom: w.lineage.edgesFrom, ...(auto ? { auto } : {}) });
  await writeFile(`${m.runId}.run.json`, new TextEncoder().encode(JSON.stringify(m)));
  await recordCheckpoint({ file, runId: m.runId, step: state.step, bytes: bytes.byteLength, savedAt: new Date().toISOString(), ...(auto ? { auto } : {}) });
  w.lastCheckpoint = state.step;
  return { file, step: state.step, bytes: bytes.byteLength, advanced };
}

/**
 * True, with a refusal of `request`, when a pond cycle is waiting for donors: the world then holds a pre-cycle
 * state that no checkpoint may carry, so saving, exporting, a lineage reading and a jump all wait for the pick. A
 * refusal, not a failure: the world is untouched.
 */
function waitingForDonors(w: World, request: ToWorker["type"], what: string): boolean {
  const waiting = w.execution.awaiting;
  if (!waiting) return false;
  const message = `Pond cycle ${waiting.cycle} is waiting for its donors: choose them, then ${what}`;
  const command = sessionCommand(request);
  if (command) session.noteRefusal(command, message);
  publishSession();
  post({ type: "refused", request, message });
  return true;
}

/** Records a manual Checkpoint in the Lab session and publishes the account. */
async function accountManual(w: World, file: string) {
  session.noteManual(file);
  session.noteStep(w.sim.step);
  session.noteShelf(await listCheckpoints());
  publishSession();
}

/**
 * Plant, restore, or import. False leaves the Lab world in place: either uncovered work was not
 * acknowledged, or the save that would have covered it was refused.
 */
async function gateReplace(command: "plant" | "restore" | "import", keep?: Keep): Promise<boolean> {
  const gate = session.replace(command, keep);
  if (gate === "held") {
    publishSession();
    return false;
  }
  if (gate !== "save-then") return true;
  const w = world;
  if (!w || waitingForDonors(w, command === "plant" ? "load" : command, command)) return false;
  const saved = await saveCheckpoint(w, false);
  await accountManual(w, saved.file);
  return true;
}

async function save() {
  const w = world;
  if (!w || waitingForDonors(w, "save", "save")) return;
  const saved = await saveCheckpoint(w, false);
  const settled = saved.advanced ? `The world advanced ${saved.advanced} steps to its census at t=${saved.step} first. ` : "";
  post({ type: "notice", message: `${settled}Saved ${saved.file} (${(saved.bytes / 1e6).toFixed(1)} MB)` });
  await accountManual(w, saved.file);
}

/** An automatic checkpoint, then the run's oldest automatic ones beyond AUTO_KEEP are removed. */
async function autoSave(w: World) {
  if (!current(w) || w.execution.failure) return;
  await saveCheckpoint(w, true);
  const m = w.manifest;
  // Only this run's own: a fork's manifest also lists its parent's checkpoints, which the parent still uses.
  for (const c of prunableAuto(m, AUTO_KEEP)) {
    await forgetCheckpoint(c.file);
    m.checkpoints.splice(m.checkpoints.indexOf(c), 1);
  }
  await writeFile(`${m.runId}.run.json`, new TextEncoder().encode(JSON.stringify(m)));
  session.noteStep(w.sim.step);
  session.noteShelf(await listCheckpoints());
  publishSession();
}

/** A branch's id: derived from the original so it stays traceable, but never collides with it. */
function forkRunId(runId: string): string {
  return `${runId}-b${Date.now().toString(36)}`;
}

async function restore(file: string, keep?: Keep) {
  if (!(await gateReplace("restore", keep))) return;
  const meta = (await listCheckpoints()).find((c) => c.file === file);
  if (!meta) throw new Error(`unknown checkpoint ${file}`);
  const { state, observer } = decodeArtifact(await readFile(file));
  let m: RunManifest;
  let lineage: AdoptLineage;
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
    lineage = await restoredLineage(saved, ck, state);
  } catch {
    // No confirmed, intact prior manifest to safely continue: always fork,
    // never reuse the old run's id (a missing/corrupt manifest is not "the
    // same run, resumed", it's a fresh branch from this checkpoint).
    m = importedManifest(state, forkRunId(meta.runId), observer.settings);
    lineage = freshLineage(state, "restored state");
  }
  await adopt(state, m, observer, lineage);
  post({ type: "notice", message: `Restored ${file} at step ${state.step}` });
}

function importedManifest(state: WorldState, runId: string, settings: ObserverSettings): RunManifest {
  return { ...newManifest("imported", state.cfg.seed, state, { kind: "generalist", founders: 0, nutrient: 0, biomass: 0 }, settings), runId, edgesFrom: state.step };
}

/**
 * A restored checkpoint's genealogy: its own edges file, the founders when the start world can be rebuilt,
 * and the restored state's genomes. Missing or inconsistent edges start the genealogy at the checkpoint.
 */
async function restoredLineage(saved: RunManifest, ck: RunManifest["checkpoints"][number], state: WorldState): Promise<AdoptLineage> {
  const known: GenomeSource[] = [];
  const start = startGenomes(saved);
  if (start) known.push(start);
  known.push({ source: "restored state", genomes: genomesOf(state, state.cfg) });
  if (ck.edges !== undefined) {
    try {
      const bytes = await readFile(edgesFile(ck.file));
      const edges = new MutationEdges(new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4));
      if (edges.length === ck.edges && edges.countBefore(state.step) === edges.length) return { edges, dropped: ck.dropped ?? 0, edgesFrom: ck.edgesFrom ?? saved.edgesFrom ?? 0, known };
    } catch {
      // Fall through: the genealogy starts at this checkpoint.
    }
  }
  return { edges: new MutationEdges(), dropped: 0, edgesFrom: state.step, known };
}

/** Files of the checkpoints that still exist (a parent run may have pruned one that a fork's manifest lists). */
async function filesOnDisk(): Promise<Set<string>> {
  return new Set((await listCheckpoints()).map((c) => c.file));
}

let lineageTicket = 0;

/**
 * One lineage at the next census (where every living lineage's edge has been drained). The ancestry is read
 * here, inside the exclusive section; the controller probes, the slow part, run after it in slices, so frames
 * and other requests are not held up. A newer request or a new world cancels them.
 */
async function inspectLineage(key: string, ticket: number) {
  const w = world;
  if (!w || ticket !== lineageTicket || waitingForDonors(w, "lineage", "inspect the lineage")) return;
  parseKey(key);
  const { state, advanced } = await w.execution.checkpoint();
  if (session.noteStep(w.sim.step)) publishSession();
  if (advanced) post({ type: "notice", message: `Advanced ${advanced} steps to the census at t=${state.step}` });
  const c = census({ cfg: state.cfg, step: state.step, cells: state.cells, genomeHead: state.genome });
  const ancestry = lineageAncestry({
    subject: key,
    cfg: state.cfg,
    edges: w.execution.edges,
    known: [...w.lineage.known, { source: "live world", genomes: genomesOf(state, state.cfg) }],
    census: { step: state.step, rows: c.lineages.map((l) => [l.key, l.cells] as const) },
    edgesFrom: w.lineage.edgesFrom,
    dropped: w.execution.dropped,
  });
  const onDisk = await filesOnDisk();
  const checkpoints = w.manifest.checkpoints.filter((k) => onDisk.has(k.file)).map((k) => k.step);
  if (ticket !== lineageTicket) return;
  void probeLineage(ancestry, { cancelled: () => ticket !== lineageTicket || !current(w) })
    .then((done) => done && ticket === lineageTicket && current(w) && post({ type: "lineage", view: ancestry.view, checkpoints }))
    .catch((e) => current(w) && post({ type: "error", message: `lineage: ${e instanceof Error ? e.message : e}` }));
}

/**
 * Keeps the present (a checkpoint), restores the latest checkpoint of this run at or before `step` and
 * queues the steps up to it; replay is deterministic, so the world reached is the one that was there.
 * Interventions logged after that checkpoint and before `step` (lesions and feeds) are queued in the
 * execution (`queueReplay`) and re-applied at their steps on the way, by every path that advances the
 * world. A jump made while an earlier jump is still replaying counts what that one had not yet re-applied.
 */
async function jump(step: number, key: string | null) {
  const w = world;
  if (!w || waitingForDonors(w, "jump", "jump")) return;
  if (!Number.isSafeInteger(step) || step < 0) throw new Error(`cannot jump to step ${step}`);
  const target = jumpTarget(w.manifest.checkpoints, await filesOnDisk(), step);
  if (!target) throw new Error(`no checkpoint of this run at or before step ${step}`);
  const present = await saveCheckpoint(w, false);
  session.noteManual(present.file);
  session.noteShelf(await listCheckpoints());
  // Everything this run logged that the target checkpoint has not seen and that happened before `step`, and a
  // pick at `step` itself: the pond cycle is part of arriving at its boundary, as it is in a world that chooses
  // its own donors, so the world reached there is the one that was bred. The history this log covers ends at
  // the present or, while an earlier jump is still replaying, at that jump's destination; pond cycles up to
  // there take their logged picks or the rule's donors and none waits, and beyond it a boundary is a new choice.
  const history = [...w.manifest.interventions, ...w.execution.pendingReplay];
  const known = Math.max(present.step, w.execution.replayHorizon - 1);
  const plan = replayPlan(history, target.interventions, step, known);
  await restore(target.file);
  const now = world!;
  now.execution.queueReplay(plan.missed.filter((iv) => iv.step >= now.sim.step), plan.until);
  // Entries logged at the restored step itself are due at once: apply them before any probe, lineage
  // request or display reads this world. Later ones are applied by the traversal as it reaches them,
  // and it never returns with an entry due at the step it stopped on.
  await now.execution.advanceFrame(0);
  pendingSteps = step - now.sim.step;
  now.lineage.highlight = key ? parseKey(key) : null;
  post({ type: "highlight", key });
  const left = plan.dropped ? `; ${plan.dropped} later logged intervention${plan.dropped === 1 ? " stays" : "s stay"} with the saved present` : "";
  session.noteKeptPresent(present.file, present.step);
  publishSession();
  post({ type: "notice", message: `Saved the present (t=${present.step}); restored t=${target.step} and advancing to t=${step}${left}` });
}

async function exportRun() {
  const w = world;
  if (!w || waitingForDonors(w, "export", "export")) return;
  const { state, observer, advanced } = await w.execution.checkpoint();
  if (advanced) post({ type: "notice", message: `Advanced ${advanced} steps to the census at t=${state.step}` });
  if (session.noteStep(w.sim.step)) publishSession();
  const bytes = encodeCheckpoint(state, observer);
  post({ type: "exported", bytes: bytes.buffer as ArrayBuffer, name: `${w.manifest.runId}-t${state.step}.blck` }, [bytes.buffer as ArrayBuffer]);
}

/** Same-device replay check; execution owns the twin's cadence and cleanup. */
async function verify(steps: number) {
  const w = world;
  if (!w || !device) return;
  if (waitingForDonors(w, "verify", "verify")) return;
  session.beginCheck();
  publishSession();
  const { from, liveHash: a, twinHash: b } = await w.execution.verify(steps, (state) => GpuSim.create(device!, state));
  session.noteReplay({ ok: a === b, from, to: from + steps, live: a, twin: b });
  session.noteStep(w.sim.step);
  publishSession();
  post({ type: "verify", ok: a === b, detail: `${steps} steps from t=${from}: ${a}${a === b ? " = " : " ≠ "}${b}`, from, steps, live: a, twin: b });
}

async function lesion(x: number, y: number, r: number) {
  const w = world;
  if (!w) return;
  const W = worldW(w.sim.cfg);
  const H = cellCount(w.sim.cfg) / W;
  const cx = ((Math.floor(x) % W) + W) % W;
  const cy = ((Math.floor(y) % H) + H) % H;
  // A failed world (a census or a replay that could not complete) takes no further intervention.
  if (w.execution.failure) throw new Error(w.execution.failure);
  // The pick is part of its boundary and is replayed before anything else logged at that step: a lesion made
  // first, on the pre-cycle world, would come back in the wrong order.
  if (waitingForDonors(w, "lesion", "make the lesion")) return;
  const step = w.sim.step;
  const eff = w.sim.lesion(cx, cy, r);
  w.manifest.interventions.push({ step, kind: "lesion", x: cx, y: cy, r: eff });
  session.noteHand(step);
  publishSession();
  forkReplay(w);
}

/** A manual intervention during a jump's replay forks the history: what was still queued no longer applies. */
function forkReplay(w: World) {
  const dropped = w.execution.dropReplay();
  if (dropped) post({ type: "notice", message: `Intervened during a replay: ${dropped} logged intervention${dropped === 1 ? "" : "s"} from t=${w.sim.step} on will not be re-applied` });
}

/** Books a feed's result into the world's conservation baselines (the observer total is the execution's). */
function bookFeed(w: World, matter: number, energy: bigint) {
  w.startMatter += BigInt(matter);
  w.baseline += energy;
  w.accounting++;
}

/**
 * Feed or drain nutrient in a disc: the one intervention that changes the world's total matter. It is
 * logged with the exact amount it moved, and the ledger's baselines move with it (matter by that amount,
 * energy by its chemical energy), so the conservation check stays exact between feeds while the panel
 * shows how much this run was fed.
 */
async function feed(x: number, y: number, r: number, amount: number) {
  const w = world;
  if (!w) return;
  const W = worldW(w.sim.cfg);
  const H = cellCount(w.sim.cfg) / W;
  const cx = ((Math.floor(x) % W) + W) % W;
  const cy = ((Math.floor(y) % H) + H) % H;
  if (w.execution.failure) throw new Error(w.execution.failure);
  const step = w.sim.step, asked = Math.trunc(amount);
  const res = await w.sim.feed(cx, cy, r, asked);
  if (!current(w)) return;
  bookFeed(w, res.matter, res.energy);
  w.execution.recordFeed(res.matter);
  w.manifest.interventions.push({ step, kind: "feed", x: cx, y: cy, r: res.radius, amount: asked, matter: res.matter });
  session.noteHand(step);
  publishSession();
  // Only a feed that happened forks a replay in progress: a refused one changes nothing.
  forkReplay(w);
}

/**
 * Applies the waiting pond cycle with the donors a person chose (or, for null, the rule's own) and logs them as
 * a pick, so a replay of this history takes the same donors without asking.
 */
async function resolvePick(w: World, donors: number[] | null) {
  if (w.execution.failure) throw new Error(w.execution.failure);
  const waiting = w.execution.awaiting;
  if (!waiting) throw new Error("no pond cycle is waiting for donors");
  // The display says "by hand" only for a person's own picks, not for the rule's donors applied on request.
  handCycle = donors === null ? -1 : waiting.step;
  try {
    const done = await w.execution.resolvePond(donors);
    w.manifest.interventions.push({ step: done.step, kind: "pick", cycle: done.cycle, donors: done.donors });
    forkReplay(w);
  } finally {
    handCycle = -1;
  }
}

async function pick(gen: number, step: number, donors: number[] | null) {
  const w = world;
  // A repeated or late message is for a cycle already applied, or for a world since replaced (another world can
  // wait at the same step): it is dropped, not an error.
  if (!w || w.gen !== gen || w.execution.awaiting?.step !== step) return;
  await resolvePick(w, donors);
}

/** Breeder mode on or off, for this world and those adopted later. Leaving it lets the rule choose for a cycle that is waiting. */
async function setBreeder(on: boolean) {
  breeder = on;
  const w = world;
  if (!w || w.execution.failure) return;
  if (!on && w.execution.awaiting) await resolvePick(w, null);
  w.execution.setHandPicks(on);
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  const fail = (e: unknown) => {
    // A request refused because a pond cycle waits for donors (for instance a save that settled onto the boundary) is no failure.
    if (world) session.noteStep(world.sim.step);
    if (e instanceof PondWaitingError && !world?.execution.failure) {
      const command = sessionCommand(m.type);
      if (command) session.noteRefusal(command, e.message);
      if (m.type === "verify") session.cancelCheck();
      publishSession();
      return post({ type: "refused", request: m.type, message: e.message });
    }
    if (m.type === "verify") session.cancelCheck();
    const command = sessionCommand(m.type);
    if (command) session.noteFailure(e instanceof Error ? e.message : String(e));
    if (command || m.type === "verify") publishSession();
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
    case "highlight":
      try {
        if (world) world.lineage.highlight = m.key ? parseKey(m.key) : null;
      } catch (e) {
        fail(e);
      }
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
  // A newer lineage request supersedes older ones from the moment it arrives, even while they are probing.
  const lineageRequest = m.type === "lineage" ? ++lineageTicket : 0;
  // Everything else is serialized.
  exclusive(async () => {
    switch (m.type) {
      case "load":
        return load(m.presetId, m.seed, m.overrides, m.keep);
      case "lesion":
        return lesion(m.x, m.y, m.r);
      case "feed":
        return feed(m.x, m.y, m.r, m.amount);
      case "probe":
        return probe(m.x, m.y);
      case "breeder":
        return setBreeder(m.on);
      case "pick":
        return pick(m.world, m.step, m.donors);
      case "save":
        return save();
      case "listCheckpoints":
        session.noteShelf(await listCheckpoints());
        return publishSession();
      case "restore":
        return restore(m.file, m.keep);
      case "deleteCheckpoint":
        await forgetCheckpoint(m.file);
        session.noteShelf(await listCheckpoints());
        return publishSession();
      case "export":
        return exportRun();
      case "import": {
        if (!(await gateReplace("import", m.keep))) return;
        const { state, observer } = decodeArtifact(new Uint8Array(m.bytes));
        await adopt(state, importedManifest(state, m.name.replace(/\.blck$/, ""), observer.settings), observer, freshLineage(state, "imported state"));
        return post({ type: "notice", message: `Imported ${m.name} at step ${state.step}` });
      }
      case "verify":
        return verify(m.steps);
      case "lineage":
        return inspectLineage(m.key, lineageRequest);
      case "jump":
        return jump(m.step, m.key);
    }
  }).catch(fail);
};
