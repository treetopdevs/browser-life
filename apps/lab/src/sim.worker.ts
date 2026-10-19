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
  FeedRefusedError,
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
  type PondScore,
  type WorldState,
} from "@bl/schema";
import { GpuSim, Renderer, requestDevice, type GpuViewMode, type ViewRect } from "@bl/sim-gpu";
import { census, firstsContext, firstsRules, individuals, lineageRGB, nextUp } from "@bl/metrics";
import { decodeArtifact, pondContinuationError, type ObserverSettings, type ObserverState, type PressureEntry } from "@bl/runner";
import { MutationEdges, genomesOf, lineageAncestry, parseKey, probeLineage, type GenomeSource } from "@bl/lineage";
import { LabExecution, PondWaitingError, PressureRefusedError, SunRefusedError, huntArmError } from "./execution.ts";
import { isLineageKey } from "./pond-play.ts";
import { dialWords } from "./rank-labels.ts";
import { jumpTarget, prunableAuto, replayPlan } from "./checkpoints.ts";
import { createLabSession } from "./session.ts";
import type { CensusMsg, CheckpointMeta, FamiliesMsg, FirstsMsg, FromWorker, Keep, PressureMsg, RunManifest, SessionCommand, ToWorker } from "./protocol.ts";
import { RewindStore, buildSessionFile, exportRefusal, interventionFacts, sessionFileName, type RewindRecord } from "./session-file.ts";
import { feedCensus, logRefusal, openFirstsLog, rewindRecord, type FirstsLog } from "./firsts-log.ts";
import { NATURALIST_PRESETS, firstIntervention, naturalistReads } from "./naturalist-series.ts";
import { StorageError, dropRewind, forgetCheckpoint, listCheckpoints, missingFile, pruneCheckpoints, readFile, readManifest, readRewind, recordCheckpoint, storageProblem, storeFull, writeFile, writeManifest, writeRewind } from "./opfs.ts";

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
  /** The log of firsts of this world's history (a world adopted later has its own, never this one). */
  log: FirstsLog;
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
/**
 * What each checkpoint file this page saved held of the log of firsts, so a restore or a jump can bring it back: a cache of the
 * `.rewind` sidecars beside them, which a restore on another page (a reload, another tab) reads instead.
 */
const rewind = new RewindStore();

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
/**
 * The lineage kept (ToWorker "keep"): a setting of the lab like breeder mode, so a restore or a jump keeps it. A new plant or an
 * imported file clears it: the lineage belonged to the world it was kept in.
 */
let keepKey: string | null = null;
/** The step of a pond cycle being applied with donors given in breeder mode, for its display message. */
let handCycle = -1;
/**
 * Why this browser keeps no checkpoints here (private browsing, for one), or null when it does. Found once, before
 * "ready": without storage the world still runs, downloads and opens files; saving, restoring and jumping refuse.
 */
let storageOff: string | null = null;

let lastStatsAt = 0;
let lastCensusAt = 0;
/** The frame loop's last session publish. Step-only updates wait for this; a change in what would be lost does not. */
let lastSessionAt = 0;
let sessionStepDue = false;
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
  // Asked alongside the GPU, so the page knows before the first world whether Save can keep anything.
  const storage = storageProblem();
  if (!navigator.gpu) throw new Error("WebGPU is not available in this browser (or in workers).");
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("No WebGPU adapter found.");
  const info = adapter.info;
  adapterDesc = [info?.vendor, info?.architecture, info?.description].filter(Boolean).join(" ") || "unknown GPU";
  device = await requestDevice(navigator.gpu);
  device.lost.then((l) => post({ type: "error", message: `GPU device lost: ${l.message}. Reload to recover from the last checkpoint.`, failed: true }));
  device.addEventListener("uncapturederror", (e) => post({ type: "error", message: (e as GPUUncapturedErrorEvent).error.message }));
  canvas = c;
  canvas.width = w;
  canvas.height = h;
  ctx = canvas.getContext("webgpu") as GPUCanvasContext;
  format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: "opaque" });
  storageOff = await storage;
  post({ type: "ready", adapter: adapterDesc, storage: storageOff });
  raf(frame);
}

/**
 * Builds the replacement first; the current world survives if that fails.
 * `observer` rehydrates the tracker/activity/counters from a restored or
 * imported checkpoint; omitted for a fresh `load()`, which starts clean.
 * `record`: what the world held of the log of firsts when that checkpoint was saved (this page's memory or the checkpoint's
 * `.rewind` sidecar); without one (a plant, an import, a checkpoint saved before sidecars were kept or whose sidecar is torn)
 * the log starts afresh at the first census it sees.
 * `carryNotes`: a jump's notes on picks the replay will log again.
 * `keep`: the lineage kept for the new world (a plant or an import keeps none; a restore or jump keeps the lab's),
 * committed to the lab setting only once the world is adopted, so a replacement that fails leaves Keep as it was.
 */
async function adopt(state: WorldState, manifest: RunManifest, observer: ObserverState | undefined, lineage: AdoptLineage, record?: RewindRecord, carryNotes?: Iterable<[number, boolean]>, keep: string | null = keepKey) {
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
  const log = openFirstsLog(state, manifest.settings.censusEvery, { edgesFrom: lineage.edgesFrom, edges: lineage.edges.length, dropped: lineage.dropped }, record, carryNotes);
  try {
    execution = new LabExecution(sim, manifest.settings, {
      observer,
      start: state,
      lineage: { edges: lineage.edges, dropped: lineage.dropped },
      // The pressures the history so far was governed by: the manifest is the sliced one on a restore.
      pressures: pressuresOf(manifest),
      keep,
      waitForIdle: () => device!.queue.onSubmittedWorkDone(),
      isCurrent: () => world?.execution === execution,
      onObservation: (c, dropped, firsts, families) => {
        // Every observed census feeds the log (the family tree, then the detector with the wounds since the last census and the
        // tree's view), before the display throttle below: a first is the census's, not the screen's.
        const fired = feedCensus(log, { census: c, dropped, firsts, families, cfg: sim.cfg, interventions: manifest.interventions }, (message) => post({ type: "notice", message }));
        const w = world;
        const mine = !!w && w.execution === execution;
        if (fired && mine) postFirsts(w);
        if (dropped > 0) post({ type: "notice", message: `${dropped} mutation events dropped (event buffer full); lineage history is incomplete` });
        const now = performance.now();
        if (now - lastCensusAt > 500) {
          lastCensusAt = now;
          postCensus(world!, c);
          if (mine && !fired) postFirsts(w);
        } else if (mine && !playing) {
          // Paused (a Step or +100): no later census will carry this one's numbers to an open card, so post them now.
          postFirsts(w);
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
          post({ type: "pondAwait", world: w.gen, step: s.step, cycle: s.cycle, arm: sim.cfg.pondArm!, score: sim.cfg.pondScore ?? null, suggested: s.suggested, terms: s.terms, ruleScore: s.ruleScore, kept: s.kept, revision: s.revision });
        }
      },
      // The naturalist's census, every one, for the worlds it may hold a baseline for (Field notes).
      onSeries: (series, dropped) => {
        const w = world;
        if (!w || w.execution !== execution || !NATURALIST_PRESETS.has(w.manifest.presetId)) return;
        const { rec, rows } = series();
        const touched = firstIntervention(w.manifest.interventions);
        if (naturalistReads(rec.step, touched)) post({ type: "naturalist", world: w.gen, runId: w.manifest.runId, step: rec.step, rec, rows, touched, dropped });
      },
      onDisplayError: (message) => post({ type: "error", message: `census display: ${message}` }),
      // A sun began in a replay, or one ended: the Light view draws the light the physics uses, and the page shows the sun.
      onLight: (light) => {
        const w = world;
        if (!w || w.sim !== sim) return;
        w.renderer.setLight(light);
        postSun(w);
      },
      // A jump's replay re-applied a logged intervention: it re-enters this run's log, and a feed moves
      // the baselines exactly as it did when it was first made.
      onReplayed: (iv, result) => {
        const w = world;
        if (!w || w.sim !== sim) return;
        if (result) bookFeed(w, result.matter, result.energy);
        w.manifest.interventions.push(iv);
        // The naturalist marks its notes at once, as for a change made live: a replay can re-apply a wound after the last census and stop before the next.
        postTouched(w, iv.step);
        // A replayed pressure moves the dial the page shows.
        if (iv.kind === "pressure") postPressure(w);
        postFirsts(w);
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
    log,
  };
  keepKey = keep;
  old?.renderer.destroy();
  old?.sim.destroy();
  // A checkpoint saved during a sun: the simulation and the view run under it from the first step (the execution installs
  // it only once it is the current world's; its traversal would install it before stepping anyway).
  renderer.setLight(execution.light);
  await execution.installSun();
  execution.setHandPicks(breeder);
  // Steps requested for the previous world do not carry over.
  pendingSteps = 0;
  playing = false;
  rect = Renderer.fullView(sim);
  rateStep = sim.step;
  rateAt = performance.now();
  session.adopt({ runId: manifest.runId, presetId: manifest.presetId, seed: manifest.seed, step: sim.step, ruleVersion: manifest.ruleVersion });
  post({ type: "loaded", manifest, step: sim.step, world: world.gen });
  postPressure(world);
  postSun(world);
  post({ type: "keep", world: world.gen, key: keepKey });
  postFirsts(world);
  // The world is adopted whatever storage says: a shelf it would not list stays empty until a later listing.
  await refreshShelf();
  publishSession();
}

/**
 * The world's step and the pond cycles run in the history this page holds: every boundary after the step the log
 * begins at (0, or where a file was opened) up to the world's step, less one that waits for its donors; and the
 * cycles before that, whose picks are not in the log.
 */
function factsAt(w: World): { step: number; cycles: number; cyclesBefore: number } {
  const step = w.sim.step, period = w.sim.cfg.pondPeriod, from = w.manifest.edgesFrom ?? 0;
  if (period === undefined) return { step, cycles: 0, cyclesBefore: 0 };
  const before = Math.floor(from / period);
  return { step, cycles: Math.max(0, Math.floor(step / period) - before - (w.execution.awaiting?.step === step ? 1 : 0)), cyclesBefore: before };
}

/** The log of firsts, the card's numbers and the rules, in full, for the world on screen. */
function postFirsts(w: World | null) {
  if (!w || !current(w)) return;
  const { detector, tree, notes, stopped, treeStopped } = w.log;
  // Display only, and called from the census callback: a failure here is reported, never thrown into the census path.
  try {
    const m: FirstsMsg = {
      type: "firsts",
      world: w.gen,
      fromStart: detector.watchedFrom === w.manifest.settings.censusEvery,
      entries: detector.entries().map((e) => ({ ...e })),
      summary: detector.summary(),
      facts: interventionFacts(w.manifest.interventions, notes, session.view().replay, factsAt(w), tree.summary()),
      rules: firstsRules(firstsContext(w.sim.cfg, w.manifest.settings.censusEvery).geneBits),
      nextUp: nextUp(detector),
      stopped,
      refusal: logRefusal(w.log),
    };
    // The tree is posted right after, for the same census: one message, one moment, so a page never shows one without the other.
    const f: FamiliesMsg = {
      type: "families",
      world: w.gen,
      step: tree.lastStep,
      families: tree.families(),
      events: tree.events().map((e) => ({ ...e })),
      summary: tree.summary(),
      fromStart: tree.watchedFrom === w.manifest.settings.censusEvery,
      stopped: stopped ?? treeStopped,
    };
    w.log.postedStep = w.sim.step;
    post(m);
    post(f);
  } catch (e) {
    post({ type: "notice", message: `The log of firsts could not be shown (${e instanceof Error ? e.message : e}).` });
  }
}

/** A wound, feed or drain just logged on a world the naturalist may read: said at once, so a paused page marks its notes. */
function postTouched(w: World, step: number) {
  if (current(w) && NATURALIST_PRESETS.has(w.manifest.presetId)) post({ type: "naturalistTouched", world: w.gen, runId: w.manifest.runId, step });
}

/** The pressures of a manifest's log, in log order. */
function pressuresOf(m: RunManifest): PressureEntry[] {
  const out: PressureEntry[] = [];
  for (const iv of m.interventions) if (iv.kind === "pressure") out.push({ step: iv.step, cycle: iv.cycle, score: iv.score });
  return out;
}

/** The pressure dial of the world on screen, as the execution holds it. Display only. */
function postPressure(w: World | null) {
  if (!w || !current(w)) return;
  const cfg = w.sim.cfg, p = w.execution.pressure;
  const msg: PressureMsg = {
    type: "pressure",
    world: w.gen,
    base: cfg.pondScore ?? null,
    current: p.current ?? null,
    fromCycle: p.fromCycle,
    changes: p.changes,
    unavailable: cfg.pondArm === "breed" ? null : `This world’s rule doesn’t breed for a score (its arm is ${cfg.pondArm ?? "none"}), so there is no pressure to set.`,
  };
  post(msg);
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
  // The lineage kept belonged to the world being replaced, so the new one keeps none.
  await adopt(state, manifest, undefined, { edges: new MutationEdges(), dropped: 0, edgesFrom: 0, known: [{ source: "start world", genomes: genomesOf(state, cfg) }] }, undefined, undefined, null);
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
    // Paused, a Step, +100 or a jump's advance may end between censuses or after replayed interventions: the card's
    // facts (the world's step, the log) are posted once the frame has applied them.
    if (!playing && w.sim.step !== w.log.postedStep) postFirsts(w);
    w.renderer.draw(mode, rect, canvas!.width, canvas!.height, 256, w.lineage.highlight);
    await device!.queue.onSubmittedWorkDone();
  } catch (e) {
    playing = false;
    if (w.execution.failure) pendingSteps = 0;
    // A rejected request (e.g. past the step limit) is dropped rather than retried every frame.
    else if (!settled) pendingSteps = Math.max(0, pendingSteps - requestedPending);
    post({ type: "error", message: w.execution.failure ?? (e instanceof Error ? e.message : String(e)), failed: w.execution.failure !== null });
  }
  // A cycle waiting for donors holds a pre-cycle state, which no checkpoint may carry: the save follows the pick.
  if (settled && !storageOff && !autoQueued && !w.execution.failure && !w.execution.awaiting && w.sim.step - w.lastCheckpoint >= AUTO_EVERY) {
    autoQueued = true;
    exclusive(() => autoSave(w))
      .catch((e) => {
        if (!current(w)) return;
        if (session.noteStep(w.sim.step)) publishSession();
        // Storage, not the world: it plays on, and the next try waits a full interval rather than a frame.
        if (e instanceof StorageError && !w.execution.failure) {
          w.lastCheckpoint = w.sim.step;
          return post({ type: "notice", message: `No automatic copy this time. ${e.message}` });
        }
        // A save that settles the world can fail it: then it is the world's failure, said as one.
        if (w.execution.failure) {
          playing = false;
          pendingSteps = 0;
        }
        post({ type: "error", message: `automatic checkpoint: ${w.execution.failure ?? (e instanceof Error ? e.message : e)}`, failed: w.execution.failure !== null });
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
  if (current(w)) publishFrameStep(now);
}

/** What a replace would lose, apart from the step number written into the sentence. */
function lossShape(view: ReturnType<typeof session.view>): string {
  if (!view.loss || !view.world) return `none:${view.hand}`;
  const which = view.world.step <= view.loss.coveredStep ? "hand" : "after";
  return `${which}:${view.hand}:${view.loss.coveredStep}`;
}

/**
 * The loss sentence names the step, and a playing world advances every frame. Publish at once when what would
 * be lost changes, and otherwise on the same cadence as the stats, so the painted step catches up after a pause.
 */
function publishFrameStep(now: number) {
  const step = world?.sim.step;
  if (step === undefined) return;
  const before = session.view();
  const stepped = session.noteStep(step);
  if (!stepped && !sessionStepDue) return;
  const shapeChanged = lossShape(before) !== lossShape(session.view());
  if (stepped) sessionStepDue = true;
  if (!shapeChanged && now - lastSessionAt <= 400) return;
  sessionStepDue = false;
  lastSessionAt = now;
  publishSession();
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
  // Under WorldConfig.genes byte 3 of PARAM1 is the gene byte, not a far-ring offset.
  const g = decodeGenome(p.genome, { genes: w.sim.cfg.genes !== undefined });
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
    ...(w.sim.cfg.genes !== undefined ? { genes: g.genes ?? 0 } : {}),
  });
}

/** The checkpoints on the shelf; none when this browser keeps no checkpoints. */
async function shelf(): Promise<CheckpointMeta[]> {
  return storageOff ? [] : listCheckpoints();
}

/**
 * Notes the shelf as storage lists it. A listing the store refuses leaves the shelf as it was and says so, since
 * whatever was asked has already been done. True when the shelf was listed.
 */
async function refreshShelf(): Promise<boolean> {
  try {
    session.noteShelf(await shelf());
    return true;
  } catch (e) {
    if (!(e instanceof StorageError)) throw e;
    post({ type: "notice", message: `Couldn't read the list of saved copies just now (${e.detail}), so it may be out of date. The world itself is fine.` });
    return false;
  }
}

/** Refuses, before anything moves, a request that needs the checkpoint store when this browser keeps none. */
function needStorage() {
  if (storageOff) throw new StorageError("This browser isn't letting the lab keep copies here (private browsing?). Download still gives you a file.", storageOff);
}

/**
 * Writes a checkpoint of the settled world, the run's mutation edges, the log's sidecar and its manifest. Every file beside the
 * checkpoint is written before the manifest and the shelf list it, so a listed checkpoint has its sidecar whole or none
 * (docs/pond-keeper-v0-2026-10-17.md, amendment of 2026-10-18). A write of the checkpoint, its edges or the records the store
 * refuses refuses the save; one of the sidecar alone does not, since the log is not needed to replay, nor does a store too full
 * for those records once the sidecar is in (the sidecar is given up for them): the checkpoint is kept without it, and `unkept`
 * says why (posted as a notice here unless `quiet`, for a caller that says it itself).
 */
async function saveCheckpoint(w: World, auto: boolean, quiet = false) {
  needStorage();
  const { state, observer, advanced, edges, dropped } = await w.execution.checkpoint();
  const m = w.manifest;
  const bytes = encodeCheckpoint(state, observer);
  const hash = stateHash(state);
  // Unique even after a restore trims the manifest's checkpoint list.
  const file = `${m.runId}-t${state.step}-${crypto.randomUUID()}.blck`;
  await writeFile(file, bytes);
  await writeFile(edgesFile(file), new Uint8Array(w.execution.edges.words().buffer));
  // Taken right after `checkpoint()`, which fed the log the census at this step: a restore of this file brings it back as it stood,
  // the family tree with the genealogy (edges' start, count and dropped records) it was read against. A stopped log may be
  // half-updated, so it is not kept: a restore of this file then starts the log afresh. A stopped tree alone is left out of the record.
  // The record goes in the `.rewind` sidecar (the checkpoint's bytes and observer digest stay as they are) and in this page's memory.
  // A sidecar the store would not write is removed by `writeRewind` (left torn, it reads as none and goes with its checkpoint when
  // that is deleted or pruned): a restore from another page then watches from the next census.
  const record = rewindRecord(w.log, { edgesFrom: w.lineage.edgesFrom, edges, dropped }, hash, state.step);
  const side = { kept: false, unkept: null as string | null };
  const unkeep = (e: StorageError) => {
    side.kept = false;
    side.unkept = `Its log of firsts couldn't be kept beside it (${e.detail}): restored on another page, the log watches from the next census.`;
  };
  if (record) {
    try {
      await writeRewind(file, record);
      side.kept = true;
    } catch (e) {
      if (!(e instanceof StorageError)) throw e;
      unkeep(e);
    }
  }
  // The sidecar is the one file here the checkpoint can do without: when the store has no room left for a record that lists the
  // checkpoint, the sidecar goes and that record is written once more (a record write that fails keeps its last intact version).
  const listing = async (write: () => Promise<void>) => {
    try {
      await write();
    } catch (e) {
      if (!side.kept || !storeFull(e)) throw e;
      try {
        await dropRewind(file);
      } catch {
        throw e;
      }
      unkeep(e as StorageError);
      await write();
    }
  };
  m.checkpoints.push({ step: state.step, file, hash, interventions: m.interventions.length, edges, dropped, edgesFrom: w.lineage.edgesFrom, ...(auto ? { auto } : {}) });
  await listing(() => writeManifest(m));
  if (record) rewind.set(file, record);
  await listing(() => recordCheckpoint({ file, runId: m.runId, step: state.step, bytes: bytes.byteLength, savedAt: new Date().toISOString(), ...(auto ? { auto } : {}) }));
  w.lastCheckpoint = state.step;
  const { unkept } = side;
  if (unkept && !quiet) post({ type: "notice", message: `Saved a copy at t=${state.step.toLocaleString()}. ${unkept}` });
  return { file, step: state.step, bytes: bytes.byteLength, advanced, unkept };
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
  await refreshShelf();
  publishSession();
}

/**
 * Plant, restore, or import. False leaves the Lab world in place: either uncovered work was not
 * acknowledged, or the save or download that would have kept it was refused.
 */
async function gateReplace(command: "plant" | "restore" | "import", keep?: Keep): Promise<boolean> {
  const gate = session.replace(command, keep);
  if (gate === "held") {
    publishSession();
    return false;
  }
  if (gate === "proceed") return true;
  const w = world;
  if (!w || waitingForDonors(w, command === "plant" ? "load" : command, command)) return false;
  // The file is posted before the replace begins, so the page has it even if the replacement then fails.
  if (gate === "download-then") {
    await exportWorld(w);
    return true;
  }
  const saved = await saveCheckpoint(w, false);
  await accountManual(w, saved.file);
  return true;
}

async function save() {
  const w = world;
  if (!w || waitingForDonors(w, "save", "save")) return;
  const saved = await saveCheckpoint(w, false, true);
  const settled = saved.advanced ? `The world advanced ${saved.advanced} steps to its census at t=${saved.step} first. ` : "";
  post({ type: "notice", message: `${settled}Saved ${saved.file} (${(saved.bytes / 1e6).toFixed(1)} MB)${saved.unkept ? `. ${saved.unkept}` : ""}` });
  await accountManual(w, saved.file);
}

/** An automatic checkpoint, then the run's oldest automatic ones beyond AUTO_KEEP are removed. */
async function autoSave(w: World) {
  if (!current(w) || w.execution.failure) return;
  const saved = await saveCheckpoint(w, true);
  session.noteSaved(saved.file);
  const m = w.manifest;
  // Only this run's own: a fork's manifest also lists its parent's checkpoints, which the parent still uses.
  const prune = prunableAuto(m, AUTO_KEEP);
  try {
    if (prune.length) {
      await pruneCheckpoints(m, prune.map((c) => c.file));
      rewind.forget(prune.map((c) => c.file));
    }
  } catch (e) {
    // The new copy is kept; older ones the store would not let go wait for the next automatic copy.
    if (!(e instanceof StorageError)) throw e;
    post({ type: "notice", message: `Kept an automatic copy at t=${saved.step.toLocaleString()}, but couldn't finish clearing away older automatic copies (${e.detail}).` });
  }
  session.noteStep(w.sim.step);
  await refreshShelf();
  publishSession();
}

/** A branch's id: derived from the original so it stays traceable, but never collides with it. */
function forkRunId(runId: string): string {
  return `${runId}-b${Date.now().toString(36)}`;
}

async function restore(file: string, keep?: Keep, carryNotes?: Iterable<[number, boolean]>) {
  needStorage();
  if (!(await gateReplace("restore", keep))) return;
  const meta = (await shelf()).find((c) => c.file === file);
  if (!meta) throw new Error(`unknown checkpoint ${file}`);
  const { state, observer } = decodeArtifact(await readFile(file));
  let m: RunManifest;
  let lineage: AdoptLineage;
  try {
    const saved = await readManifest(meta.runId);
    if (!saved) throw new Error("no manifest");
    const ck = saved.checkpoints.find((c) => c.file === file);
    if (!ck) throw new Error("checkpoint missing from manifest");
    // Continuing exactly where the run left off keeps its id; restoring to
    // an earlier point forks, so a later save never overwrites this
    // manifest's later checkpoints (and their provenance) again.
    const last = saved.checkpoints[saved.checkpoints.length - 1] === ck;
    m = {
      ...saved,
      runId: last ? saved.runId : forkRunId(saved.runId),
      storageRevision: last ? saved.storageRevision : undefined,
      // Keep exactly the interventions the checkpoint already contains.
      interventions: saved.interventions.slice(0, ck.interventions),
      checkpoints: saved.checkpoints.slice(0, saved.checkpoints.indexOf(ck) + 1),
    };
    lineage = await restoredLineage(saved, ck, state);
  } catch (e) {
    // A store that would not read the manifest or the genealogy says nothing about the run: refuse, and keep the
    // world on screen, rather than fork away the run's history on a passing failure.
    if (e instanceof StorageError && !missingFile(e)) throw e;
    // No confirmed, intact prior manifest to safely continue: always fork,
    // never reuse the old run's id (a missing/corrupt manifest is not "the
    // same run, resumed", it's a fresh branch from this checkpoint).
    m = importedManifest(state, forkRunId(meta.runId), observer.settings);
    lineage = freshLineage(state, "restored state");
  }
  // The log kept with this checkpoint: this page's memory, else its sidecar (a reload, another tab). None, or a torn one, is a
  // fresh log ("watching since"); `openFirstsLog` takes a record only for this very state. A store that would not open the
  // sidecar says nothing about it: refuse, and keep the world on screen, as for the genealogy above.
  const record = rewind.get(file) ?? (await readRewind(file)) ?? undefined;
  await adopt(state, m, observer, lineage, record, carryNotes);
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
    } catch (e) {
      if (e instanceof StorageError && !missingFile(e)) throw e;
      // Fall through: the genealogy starts at this checkpoint.
    }
  }
  return { edges: new MutationEdges(), dropped: 0, edgesFrom: state.step, known };
}

/** Files of the checkpoints that still exist (a parent run may have pruned one that a fork's manifest lists). */
async function filesOnDisk(): Promise<Set<string>> {
  return new Set((await shelf()).map((c) => c.file));
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
  // A shelf storage would not list offers no jump: the reading itself does not need it.
  const onDisk = await filesOnDisk().catch(() => new Set<string>());
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
  needStorage();
  if (!Number.isSafeInteger(step) || step < 0) throw new Error(`cannot jump to step ${step}`);
  const target = jumpTarget(w.manifest.checkpoints, await filesOnDisk(), step);
  if (!target) throw new Error(`no checkpoint of this run at or before step ${step}`);
  const present = await saveCheckpoint(w, false);
  session.noteManual(present.file);
  await refreshShelf();
  // Everything this run logged that the target checkpoint has not seen and that happened before `step`, and a
  // pick at `step` itself: the pond cycle is part of arriving at its boundary, as it is in a world that chooses
  // its own donors, so the world reached there is the one that was bred. The history this log covers ends at
  // the present or, while an earlier jump is still replaying, at that jump's destination; pond cycles up to
  // there take their logged picks or the rule's donors and none waits, and beyond it a boundary is a new choice.
  const history = [...w.manifest.interventions, ...w.execution.pendingReplay];
  const known = Math.max(present.step, w.execution.replayHorizon - 1);
  const plan = replayPlan(history, target.interventions, step, known, w.sim.cfg.pondPeriod);
  // The present Checkpoint is already written. A jump never asks, so a held restore must not leave the replay queued on the old world.
  // The present's notes on who chose each pick stay with the picks the restored log holds and the replay logs again.
  await restore(target.file, "discard", w.log.notes);
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
  await exportWorld(w);
}

/** Hands the page the world, settled at its census, as a checkpoint file. Needs no storage. */
async function exportWorld(w: World) {
  const { state, observer, advanced } = await w.execution.checkpoint();
  if (advanced) post({ type: "notice", message: `Advanced ${advanced} steps to the census at t=${state.step}` });
  if (session.noteStep(w.sim.step)) publishSession();
  const bytes = encodeCheckpoint(state, observer);
  post({ type: "exported", bytes: bytes.buffer as ArrayBuffer, name: `${w.manifest.runId}-t${state.step}.blck` }, [bytes.buffer as ArrayBuffer]);
}

/**
 * The session file: the world settled at its census, its history from step 0 and its firsts. Refused (the world is
 * untouched) while a pond cycle waits for donors, when the log of firsts stopped, and for a world whose history a
 * replay cannot rebuild from step 0 (`exportRefusal`).
 */
async function sessionExport(asked: number, id: number) {
  const w = world;
  const refuse = (message: string) => post({ type: "refused", request: "sessionExport", id, message });
  // Queued behind a plant, restore or jump, the request would otherwise describe the world that replaced the one asked for.
  if (!w || w.gen !== asked) return refuse("That world was replaced before its file was made; open the card again for the world on screen.");
  if (w.execution.awaiting) return refuse(`Pond cycle ${w.execution.awaiting.cycle} is waiting for its donors: choose them, then export the session`);
  const why = logRefusal(w.log) ?? exportRefusal(w.manifest);
  if (why) return refuse(why);
  // The checkpoint settles the world at its next census (feeding the log) or throws PondWaitingError if that boundary waits.
  let settled: Awaited<ReturnType<LabExecution["checkpoint"]>>;
  try {
    settled = await w.execution.checkpoint();
  } catch (e) {
    // The world settled onto a boundary that waits, or failed: this request ends here, by its id; a failure is still reported as one.
    refuse(e instanceof Error ? e.message : String(e));
    if (e instanceof PondWaitingError) return;
    throw e;
  }
  const { state, advanced } = settled;
  if (session.noteStep(w.sim.step)) publishSession();
  if (advanced) post({ type: "notice", message: `Advanced ${advanced} steps to the census at t=${state.step}` });
  // A world that has not run a single census has no history to replay (tools/run.ts refuses --steps 0).
  if (state.step === 0) return refuse("The world hasn’t run yet: let it reach its first census, then make the file.");
  // The settling above fed the log its last census: a log or a tree that stopped there is refused too.
  const stoppedWhy = logRefusal(w.log);
  if (stoppedWhy) return refuse(stoppedWhy);
  const { detector, tree, notes } = w.log;
  let text: string;
  try {
    text = JSON.stringify(buildSessionFile({
      manifest: w.manifest,
      stateHash: stateHash(state),
      step: state.step,
      firsts: { watchedFrom: detector.watchedFrom, entries: detector.entries() },
      families: { watchedFrom: tree.watchedFrom, families: tree.families(), events: tree.events() },
      card: { summary: detector.summary(), facts: interventionFacts(w.manifest.interventions, notes, session.view().replay, factsAt(w), tree.summary()) },
      adapter: adapterDesc,
      createdAt: new Date().toISOString(),
    }), null, 2);
  } catch (e) {
    // Every way this request ends answers it by its id; the page's generic error path then knows nothing of exports.
    refuse(e instanceof Error ? e.message : String(e));
    throw e;
  }
  postFirsts(w);
  post({ type: "sessionFile", world: w.gen, id, text, name: sessionFileName(w.manifest.runId, state.step) });
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
  postFirsts(w);
  post({ type: "verify", ok: a === b, detail: `${steps} steps from t=${from}: ${a}${a === b ? " = " : " ≠ "}${b}`, from, steps, live: a, twin: b });
}

/**
 * True, with a refusal of `request`, when a hand edit names a world (`ToWorker` lesion/feed `world`) that is no longer the one on
 * screen: Field notes' Try it here was made for that world, and a replacement queued before it must not take its edit.
 */
function staleHand(request: "lesion" | "feed" | "sun", gen: number | undefined): boolean {
  if (gen === undefined || world?.gen === gen) return false;
  post({ type: "refused", request, message: request === "sun" ? "That sun was chosen for a world that has since been replaced, so nothing was applied" : "That suggestion was made for a world that has since been replaced, so nothing was applied" });
  return true;
}

async function lesion(x: number, y: number, r: number, gen?: number) {
  if (staleHand("lesion", gen)) return;
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
  postTouched(w, step);
  session.noteHand(step);
  publishSession();
  forkReplay(w);
  postFirsts(w);
}

/** Tells the page which sun the world runs under (null: its own light). */
function postSun(w: World) {
  post({ type: "sun", world: w.gen, sun: w.execution.sun });
}

/**
 * Sets a sun on the world from its step (`LabExecution.applySun`): logged like a lesion, at the world's step, and drawn by the
 * Light view. A sun the world refuses (its light cannot take it, or one already shines) changes nothing and is answered as a
 * refusal, with the reason.
 */
async function setSun(percent: number, span: number, gen?: number) {
  if (staleHand("sun", gen)) return;
  const w = world;
  if (!w) return;
  if (w.execution.failure) throw new Error(w.execution.failure);
  if (waitingForDonors(w, "sun", "set a sun")) return;
  let entry;
  try {
    // The values as sent: applySun refuses a fraction or a string rather than rounding it into another sun.
    entry = await w.execution.applySun(percent, span);
  } catch (e) {
    if (e instanceof SunRefusedError) return post({ type: "refused", request: "sun", message: e.message });
    throw e;
  }
  if (!current(w)) return;
  w.manifest.interventions.push(entry);
  postTouched(w, entry.step);
  session.noteHand(entry.step);
  publishSession();
  forkReplay(w);
  postFirsts(w);
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
async function feed(x: number, y: number, r: number, amount: number, gen?: number) {
  if (staleHand("feed", gen)) return;
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
  postTouched(w, step);
  session.noteHand(step);
  publishSession();
  // Only a feed that happened forks a replay in progress: a refused one changes nothing.
  forkReplay(w);
  postFirsts(w);
}

/**
 * Applies the waiting pond cycle with the donors a person chose (or, for null, the rule's own) and logs them as
 * a pick, so a replay of this history takes the same donors without asking.
 */
const sameDonors = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((d, i) => d === b[i]);

async function resolvePick(w: World, donors: number[] | null, options: { revision?: number; withKeep?: boolean } = {}) {
  if (w.execution.failure) throw new Error(w.execution.failure);
  const waiting = w.execution.awaiting;
  if (!waiting) throw new Error("no pond cycle is waiting for donors");
  // The display says "by hand" only for donors given in breeder mode (a person's, or auto-breed's under Keep), not for the
  // rule's donors applied on request.
  handCycle = donors === null && !options.withKeep ? -1 : waiting.step;
  try {
    const done = await w.execution.resolvePond(donors, options);
    w.manifest.interventions.push({ step: done.step, kind: "pick", cycle: done.cycle, donors: done.donors });
    // The log keeps no record of who chose. A person's donors in the rule's own order are the rule's choice as far as
    // the card can tell (reordering is the only way to differ), and the card says so; so is auto-breed's answer unless
    // Keep changed it.
    w.log.notes.set(done.step, (donors !== null || !!options.withKeep) && !sameDonors(done.donors, waiting.suggested));
    forkReplay(w);
    postFirsts(w);
  } finally {
    handCycle = -1;
  }
}

async function pick(gen: number, step: number, donors: number[] | null, options: { revision?: number; withKeep?: boolean }) {
  const w = world;
  // A repeated or late message is for a cycle already applied, or for a world since replaced (another world can
  // wait at the same step): it is dropped, not an error. Explicit donors from a survey since replaced are refused
  // (`StaleSurveyError`, a `PondWaitingError`): the page answers again from the newer survey.
  if (!w || w.gen !== gen || w.execution.awaiting?.step !== step) return;
  await resolvePick(w, donors, options);
}

/**
 * Sets the pressure dial of world `gen`. The entry is logged in the same synchronous step as `setPressure` returns, in manifest
 * order: a pressure for the waiting cycle (set at its boundary's step) comes before that cycle's pick, which is logged after.
 */
async function setPressure(gen: number, score: PondScore) {
  const w = world;
  // A late message is for a world since replaced: dropped, not an error.
  if (!w || w.gen !== gen) return;
  let done: Awaited<ReturnType<LabExecution["setPressure"]>>;
  try {
    done = await w.execution.setPressure(score);
  } catch (e) {
    // A refusal: nothing was logged and the world is as it was; the page puts the dial back.
    if (e instanceof PressureRefusedError) {
      postPressure(w);
      return post({ type: "refused", request: "pressure", message: e.message });
    }
    throw e;
  }
  const { entry } = done;
  if (!entry) {
    postPressure(w);
    return post({ type: "notice", message: `The rule already breeds for ${dialWords(score).toLowerCase()} from the next cycle.` });
  }
  w.manifest.interventions.push({ step: entry.step, kind: "pressure", cycle: entry.cycle, score: entry.score });
  // A pressure is a hand edit a replaced world would lose, as a lesion is.
  session.noteHand(entry.step);
  publishSession();
  forkReplay(w);
  postPressure(w);
  postFirsts(w);
}

/** Keeps lineage `key` (or none), asked of world `gen`: the lab's setting, so the next world a restore or a jump brings in has it too. */
async function setKeep(gen: number, key: string | null) {
  const w = world;
  // A late message is for a world since replaced: dropped, not an error, as for the dial.
  if (!w || w.gen !== gen) return;
  if (key !== null && !isLineageKey(key)) throw new Error(`${JSON.stringify(key)} is not a lineage key (hi:lo)`);
  keepKey = key;
  // A failed world is not read again, but the lab's setting is still the player's.
  if (!w.execution.failure) await w.execution.setKeep(key);
  post({ type: "keep", world: w.gen, key });
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
    // A request refused because a pond cycle waits for donors (for instance a save that settled onto the boundary),
    // or because the browser would not keep or read a checkpoint, is no failure. Nor is a Feed or Drain the world refuses
    // (`feedError`'s reasons, a pond world among them, or MATTER_MAX): `sim.feed` throws it before it writes anything, and
    // `feed()` logs and books only after `sim.feed` returns, so the world goes on as it was. Only the feed request's own: a
    // logged feed that a replay refuses is a history that does not replay, which stays a failure.
    if (world) session.noteStep(world.sim.step);
    const refusedFeed = e instanceof FeedRefusedError && m.type === "feed";
    if ((e instanceof PondWaitingError || e instanceof StorageError || refusedFeed) && !world?.execution.failure) {
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
    post({ type: "error", message: world?.execution.failure ?? (e instanceof Error ? e.message : String(e)), failed: !!world?.execution.failure });
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
        return lesion(m.x, m.y, m.r, m.world);
      case "feed":
        return feed(m.x, m.y, m.r, m.amount, m.world);
      case "sun":
        return setSun(m.percent, m.span, m.world);
      case "probe":
        return probe(m.x, m.y);
      case "breeder":
        return setBreeder(m.on);
      case "pick":
        return m.donors === null ? pick(m.world, m.step, null, { withKeep: m.withKeep }) : pick(m.world, m.step, m.donors, { revision: m.revision });
      case "pressure":
        return setPressure(m.world, m.score);
      case "keep":
        return setKeep(m.world, m.key);
      case "save":
        return save();
      case "listCheckpoints":
        await refreshShelf();
        return publishSession();
      case "restore":
        return restore(m.file, m.keep);
      case "deleteCheckpoint":
        needStorage();
        try {
          await forgetCheckpoint(m.file);
          rewind.forget([m.file]);
        } finally {
          // Whatever the store managed, the shelf is read again; unread, a copy that may be gone covers nothing.
          if (!(await refreshShelf())) session.noteRemoved(m.file);
          publishSession();
        }
        return;
      case "export":
        return exportRun();
      case "sessionExport":
        return sessionExport(m.world, m.id);
      case "import": {
        if (!(await gateReplace("import", m.keep))) return;
        const { state, observer } = decodeArtifact(new Uint8Array(m.bytes));
        await adopt(state, importedManifest(state, m.name.replace(/\.blck$/, ""), observer.settings), observer, freshLineage(state, "imported state"), undefined, undefined, null);
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
