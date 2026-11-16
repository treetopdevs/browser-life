// The slab viewer (/slab/): reads the cells back after each batch of steps and draws them, either as 2D layer tiles or as a
// volume (apps/lab/src/volume3d/, packed from the same frame on the CPU). Every create, advance, readback and destroy goes
// through one serial queue; the volume view only ever sees frames that passed the same current-world check as the tiles.
import { applySettings, SUBMIT_STEPS } from "../../../../experiments/3d-rps/gate0-spike/adapter.ts";
import { GpuSim3 as RpsSim3 } from "../../../../experiments/3d-rps/gate0-spike/gpu-sim3-rps.ts";
import { jobConfig, mixParams } from "../../../../experiments/3d-rps/gate0-spike/rungs.ts";
import { rpsMix } from "../../../../experiments/3d-rps/gate0-spike/world.ts";
import { rpsLabels } from "@bl/metrics";
import { CH, G, initWorld } from "@bl/schema";
import { GpuSim3 as StockSim3 } from "@bl/sim-gpu";
import {
  BURN_IN, CANOPY_OPTIONS, CYCLIC_SEEDS, CYCLIC_SIZES, DEFAULT_CYCLIC, DEFAULT_ECO, ECO_OPTIONS, ECO_SEEDS, JAR_OPTIONS, JAR_SEEDS, KILL_OPTIONS, PACES, SPREAD,
  cyclicRecord, cyclicSettings, ecoConfig, ecoInit, ecoRecordId, isCanopy, isJar, sizesFor, type CyclicChoice, type EcoChoice, type KillChoice, type Pace,
} from "./settings.ts";
import { PRESETS } from "../volume3d/camera.ts";
import { Disposer } from "../volume3d/approaches/disposer.ts";
import { RENDERERS } from "../volume3d/approaches/registry.ts";
import type { ParamSpec } from "../volume3d/contract.ts";
import { VolumeView } from "../volume3d/view.ts";
import { CYCLIC_COLOURS, EMPTY_RGB, censusCyclic, censusEco, paintCombined, paintLayer, share, tileLayout, type Frame } from "./render.ts";
import { createCyclic, createEco, getDevice, type WorldSim } from "./worlds.ts";

type World = "cyclic" | "eco";
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const S = {
  world: "cyclic" as World,
  cyc: { ...DEFAULT_CYCLIC } as CyclicChoice,
  eco: { ...DEFAULT_ECO } as EcoChoice,
  pace: "steady" as Pace,
  playing: false,
  view: "combined" as "combined" | "layer",
  layer: 0,
  display: "layers" as "layers" | "volume",
};
const dimsText = (s: readonly number[]) => `${s[0]} by ${s[1]} by ${s[2]}`;
/** Every ecology option the page offers: the M4 picks, the M4b canopy and the jar levers screen. */
const ALL_ECO = [...ECO_OPTIONS, ...CANOPY_OPTIONS, ...JAR_OPTIONS];
/** Keeps the ecology size one the chosen option runs at (a jar setting only at 64 by 64 by 64, the others at the slab sizes). */
function fitEcoSize() {
  const sizes = sizesFor(S.eco.option);
  if (!sizes.some((z) => z.join("x") === S.eco.size.join("x"))) S.eco.size = [sizes[0][0], sizes[0][1], sizes[0][2]];
}

// ---- link parameters -------------------------------------------------------------------------------------------------
// Optional, for links and for tools/volume-capture: world, setting (an ecology setting id, or the cyclic ring rule), seed,
// size (WxHxD, one of the listed sizes), display (layers or volume), and for the volume renderer, stretch, peel and camera
// (a pose id). A value the page does not offer is ignored, so a bad link opens the defaults instead of failing. Values are
// matched against the page's own lists or own keys only, never inherited ones (camera=toString is just unknown).
const linkVolume: { renderer?: VolumeView["renderer"]; stretch?: number; peel?: number; camera?: string } = {};
function readLink() {
  const q = new URLSearchParams(location.search);
  const int = (k: string, lo: number, hi: number) => {
    const raw = q.get(k);
    const n = raw === null || !/^\d+$/.test(raw) ? NaN : Number(raw);
    return Number.isInteger(n) && n >= lo && n <= hi ? n : undefined;
  };
  const world = q.get("world");
  if (world === "cyclic" || world === "eco") S.world = world;
  const setting = q.get("setting");
  if (setting && S.world === "cyclic" && KILL_OPTIONS.some((k) => k.id === setting)) S.cyc.kill = setting as KillChoice;
  if (setting && S.world === "eco" && ALL_ECO.some((o) => o.id === setting)) S.eco.option = setting;
  const seed = int("seed", 0, 999999);
  if (seed !== undefined) { if (S.world === "cyclic") S.cyc.seed = seed; else S.eco.seed = seed; }
  const size = (S.world === "cyclic" ? CYCLIC_SIZES : sizesFor(S.eco.option)).find((z) => z.join("x") === q.get("size"));
  if (size) { if (S.world === "cyclic") S.cyc.size = [size[0], size[1], size[2]]; else S.eco.size = [size[0], size[1], size[2]]; }
  fitEcoSize();
  const display = q.get("display");
  if (display === "layers" || display === "volume") S.display = display;
  const renderer = RENDERERS.find((r) => r.id === q.get("renderer"));
  if (renderer) linkVolume.renderer = renderer.id;
  linkVolume.stretch = int("stretch", 1, 16);
  linkVolume.peel = int("peel", 0, 63); // the deepest jar has 64 layers; syncPeel holds it to the slab shown
  const camera = q.get("camera");
  if (camera && Object.hasOwn(PRESETS, camera)) linkVolume.camera = camera;
}

// ---- serial queue ----------------------------------------------------------------------------------------------------
let chain: Promise<unknown> = Promise.resolve();
let pending = 0;
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  pending++;
  const p = chain.then(fn);
  chain = p.then(() => { pending--; }, () => { pending--; });
  return p;
}
let gen = 0;
let sim: WorldSim | null = null;
let last: Frame | null = null;
const counts = { created: 0, destroyed: 0 };
const stats = { stepsPerSec: 0, drawMs: 0, readMs: 0, t: 0, s: 0 };

function say(text: string) { $("status").textContent = text; }
function fail(e: unknown) {
  const m = $("slab-message");
  m.hidden = false;
  m.textContent = `Something went wrong: ${e instanceof Error ? e.message : String(e)}`;
  S.playing = false;
  syncPlay();
}

// ---- drawing ---------------------------------------------------------------------------------------------------------
let tileCanvases: HTMLCanvasElement[] = [];
let tileCaps: HTMLElement[] = [];
let builtFor = "";
const ctxOf = (c: HTMLCanvasElement) => c.getContext("2d")!;

function buildTiles(f: Frame) {
  const key = `${f.dims.W}x${f.dims.H}x${f.dims.D}:${f.kind}`;
  if (key === builtFor) return;
  builtFor = key;
  const host = $("tiles");
  host.replaceChildren();
  tileCanvases = []; tileCaps = [];
  for (const t of tileLayout(f.dims, 2).tiles) {
    const fig = document.createElement("figure");
    fig.className = "slab-tile";
    fig.dataset.z = String(t.z);
    const c = document.createElement("canvas");
    c.width = f.dims.W; c.height = f.dims.H;
    c.id = `tile-${t.z}`;
    c.setAttribute("role", "img");
    const cap = document.createElement("figcaption");
    cap.className = "fine";
    fig.append(c, cap);
    host.append(fig);
    tileCanvases.push(c); tileCaps.push(cap);
  }
  const big = $<HTMLCanvasElement>("combined");
  big.width = f.dims.W; big.height = f.dims.H;
  $<HTMLInputElement>("layer").max = String(f.dims.D - 1);
  if (S.layer > f.dims.D - 1) S.layer = f.dims.D - 1;
  setLayer(S.layer);
}

/** The one place the chosen layer is set: keeps the slider, the readout and the state in step (also after a clamp). */
function setLayer(z: number) {
  S.layer = z;
  $<HTMLInputElement>("layer").value = String(z);
  $("layer-out").textContent = String(z);
}

/** Every picture painted, as "chosen world:frame kind@step" (debug pages only), so a test can see a frame from the wrong world. */
const drawLog: string[] | null = new URLSearchParams(location.search).has("debug") ? [] : null;

function draw(f: Frame) {
  const t0 = performance.now();
  drawLog?.push(`${S.world}:${f.kind}@${f.step}`);
  buildTiles(f);
  const { W, H, D } = f.dims;
  if (S.display === "volume") drawVolume(f);
  else {
    const buf = new Uint8ClampedArray(W * H * 4);
    for (let z = 0; z < D; z++) {
      paintLayer(f, z, buf);
      ctxOf(tileCanvases[z]).putImageData(new ImageData(buf, W, H), 0, 0);
    }
    if (S.view === "combined") paintCombined(f, buf); else paintLayer(f, S.layer, buf);
    ctxOf($("combined")).putImageData(new ImageData(buf, W, H), 0, 0);
  }
  const pct = (a: number, b: number) => `${(100 * share(a, b)).toFixed(1)} %`;
  const plane = W * H;
  let line: string;
  const swatch = (rgb: readonly number[]) => `<span class="slab-swatch" style="background:rgb(${rgb.join(",")})"></span>`;
  if (f.kind === "cyclic") {
    const c = censusCyclic(f.labels, f.dims);
    const total = plane * D;
    for (let z = 0; z < D; z++) {
      tileCaps[z].textContent = `Layer ${z}${z === 0 ? " (surface)" : ""} · empty ${pct(c.counts[z][3], plane)}`;
      tileCanvases[z].setAttribute("aria-label", `Layer ${z} at step ${f.step}: types ${c.counts[z].slice(0, 3).map((v) => pct(v, plane)).join(", ")}, empty ${pct(c.counts[z][3], plane)}`);
    }
    line = [0, 1, 2].map((t) => `<span data-census="type${t}">${swatch(CYCLIC_COLOURS[t])}Type ${t + 1}: ${pct(c.total[t], total)}</span>`).join("") +
      `<span data-census="empty">${swatch(EMPTY_RGB)}Empty: ${pct(c.total[3], total)}</span>`;
    $("census-help").textContent = "Share of all cells held by each of the three types, and the share that is empty. Each type beats the next one in a ring (1 beats 2, 2 beats 3, 3 beats 1).";
  } else {
    const c = censusEco(f.hi, f.lo, f.dims);
    for (let z = 0; z < D; z++) {
      tileCaps[z].textContent = `Layer ${z}${z === 0 ? " (surface)" : ""} · living ${pct(c.living[z], plane)}`;
      tileCanvases[z].setAttribute("aria-label", `Layer ${z} at step ${f.step}: ${pct(c.living[z], plane)} of cells living`);
    }
    line = `<span data-census="total"><strong>All layers: ${pct(c.total, plane * D)} living</strong></span>` +
      c.living.map((v, z) => `<span data-census="layer${z}">L${z}: ${pct(v, plane)}</span>`).join("");
    $("census-help").textContent = "Living fraction of every layer (a cell is living when it carries a lineage). Colour is the lab's lineage colour; brightness is how much body the cell holds.";
  }
  $("census").innerHTML = line;
  $("combined").setAttribute("aria-label", `${S.view === "combined" ? "Combined top-down view of all layers" : `Layer ${S.layer} only`} at step ${f.step}`);
  $("combined-cap").textContent = S.view === "combined"
    ? "Top-down view of all layers. Cyclic: the type most layers hold in that column. Ecology: the layer holding the most body."
    : `Layer ${S.layer} only${S.layer === 0 ? " (the surface)" : ""}.`;
  document.querySelectorAll<HTMLElement>(".slab-tile").forEach((el) => { el.dataset.picked = String(S.view === "layer" && Number(el.dataset.z) === S.layer); });
  stats.drawMs = performance.now() - t0;
}

// ---- volume view -----------------------------------------------------------------------------------------------------
let volume: VolumeView | null = null;
let volumeShown = ""; // the frame (world:kind@step) last packed into the volume

function drawVolume(f: Frame) {
  if (!volume) return;
  volume.upload(f, f.kind === "eco" ? { lightK: ecoConfig(S.eco).lightK } : {});
  volumeShown = `${S.world}:${f.kind}@${f.step}`;
  volumeCaption(f);
  $("volume-canvas").setAttribute("aria-label", `Volume view of all ${f.dims.D} layers at step ${f.step}`);
}

function volumeCaption(f: Frame) {
  const { W, H, D } = f.dims;
  const k = volume?.stretch ?? 1;
  const shape = k === 1
    ? `at the world's true shape: ${W} by ${H} cells across and ${D} deep, so the slab is a thin sheet. `
    : `with depth stretched ${k} times as a viewing aid: the world is ${W} by ${H} cells across and only ${D} deep. `;
  $("volume-cap").textContent = `All ${D} layers at step ${f.step}, layer 0 (the surface, where light enters) on top, ${shape}` +
    (f.kind === "eco" ? "Colour is the lineage colour; how solid a cell looks is how much body it holds. " : "Colour is the type; empty cells are clear. ") +
    "Drag to turn it, the wheel or a pinch zooms, shift-drag moves it; with the picture focused, the arrow keys turn it and + and - zoom.";
}

function syncPeel() {
  if (!volume) return;
  const max = Math.max(0, (volume.layers || (S.world === "cyclic" ? S.cyc.size : S.eco.size)[2]) - 1);
  const peel = $<HTMLInputElement>("peel");
  peel.max = String(max);
  if (volume.peel > max) volume.peel = max;
  peel.value = String(volume.peel);
  $("peel-out").textContent = String(volume.peel);
  const cut = $<HTMLInputElement>("cut");
  cut.value = String(Math.round(volume.cut * 100));
  $("cut-out").textContent = cut.value;
}

let lookSeq = 0;
async function renderLook() {
  if (!volume) return;
  const host = $("volume-params");
  const seq = ++lookSeq; // a slower, earlier call must not rebuild the panel over a newer renderer's controls
  let specs: ParamSpec[];
  try { specs = await volume.specs(); } catch (e) { if (seq === lookSeq) console.error("slab: the view's settings could not load", e); return; }
  if (seq !== lookSeq) return;
  host.replaceChildren();
  for (const p of specs) {
    const id = `look-${p.key}-${serial++}`;
    const hint = document.createElement("p");
    hint.className = "fine"; hint.id = `${id}-d`; hint.textContent = p.hint;
    let input: HTMLInputElement | HTMLSelectElement;
    if (p.kind === "select") {
      const sel = document.createElement("select");
      for (const o of p.options) { const op = document.createElement("option"); op.value = o.value; op.textContent = o.label; sel.append(op); }
      sel.value = p.value;
      sel.addEventListener("change", () => volume!.setParam(p.key, sel.value));
      input = sel;
    } else {
      const inp = document.createElement("input");
      if (p.kind === "toggle") {
        inp.type = "checkbox"; inp.checked = p.value;
        inp.addEventListener("change", () => volume!.setParam(p.key, inp.checked));
      } else {
        inp.type = "range"; inp.min = String(p.min); inp.max = String(p.max); inp.step = String(p.step); inp.value = String(p.value);
        inp.addEventListener("input", () => volume!.setParam(p.key, Number(inp.value)));
      }
      input = inp;
    }
    input.id = id;
    input.setAttribute("aria-describedby", hint.id);
    const label = document.createElement("label");
    label.htmlFor = id; label.textContent = p.label;
    if (p.kind === "toggle") {
      const row = document.createElement("div");
      row.className = "check";
      row.append(input, label);
      host.append(row, hint);
    } else host.append(label, input, hint);
  }
}

function renderVolumeControls() {
  if (!volume) return;
  radios($("o-renderer"), "renderer", RENDERERS.map((r) => ({ value: r.id, title: r.title, text: r.text })), volume.renderer, (v) => {
    volume!.setRenderer(v as VolumeView["renderer"]);
    void renderLook();
  });
  const poses = $("camera-poses");
  if (!poses.childElementCount) {
    for (const [id, p] of Object.entries(PRESETS)) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "button quiet"; b.textContent = p.label; b.dataset.pose = id;
      b.setAttribute("aria-describedby", "camera-help");
      b.addEventListener("click", () => { volume!.setPose(id); $("camera-help").textContent = p.hint; });
      poses.append(b, " ");
    }
    $("camera-help").textContent = `Jump to a view. ${PRESETS[linkVolume.camera ?? "oblique"]!.hint}`;
  }
  syncPeel();
  void renderLook();
}

function setDisplay(d: "layers" | "volume") {
  S.display = d;
  const vol = d === "volume";
  $("volume").hidden = !vol;
  $<HTMLElement>("slab-views").hidden = vol;
  $("layers-only").hidden = vol;
  if (vol && !volume) {
    volume = new VolumeView($<HTMLCanvasElement>("volume-canvas"), syncPeel);
    applyLinkVolume(volume);
    renderVolumeControls();
  }
  if (volume) {
    if (vol && sharedDeviceForVolume) volume.attach(sharedDeviceForVolume);
    volume.setActive(vol);
  }
  if (last) draw(last);
}
let sharedDeviceForVolume: GPUDevice | null = null;

/** The link's volume settings, once, on the new view (the controls are drawn from it right after). */
function applyLinkVolume(v: VolumeView) {
  if (linkVolume.renderer) v.renderer = linkVolume.renderer;
  if (linkVolume.stretch !== undefined) {
    v.setStretch(linkVolume.stretch);
    $<HTMLInputElement>("stretch").value = String(v.stretch);
    $("stretch-out").textContent = String(v.stretch);
  }
  if (linkVolume.peel !== undefined) v.peel = linkVolume.peel; // clamped to the slab's layers by syncPeel and the first frame
  if (linkVolume.camera) v.setPose(linkVolume.camera);
}

function statusLine(f: Frame) {
  const phase = f.kind === "cyclic" && sim ? (sim.phase === "burn" ? " · kill off (burn-in)" : S.cyc.kill === "none" ? " · no kill" : " · kill on") : "";
  say(`step ${f.step}${phase} · ${stats.stepsPerSec.toFixed(0)} steps/s · readback ${stats.readMs.toFixed(0)} ms · draw ${stats.drawMs.toFixed(0)} ms`);
}

// ---- running ---------------------------------------------------------------------------------------------------------
let readGate: Promise<void> | null = null;
let releaseGate: (() => void) | null = null;
let held = 0;

/** True when the world this task started on is still the one on screen (no restart, no replacement since). */
const current = (g: number, s: WorldSim | null) => g === gen && s === sim;

async function showFrame() {
  const g = gen, s = sim;
  if (!s) return;
  const t0 = performance.now();
  const f = await s.frame();
  if (readGate) { held++; await readGate; } // debug pages only: lets a test hold a read open
  if (!current(g, s)) return; // superseded while reading: never paint the old world under the new controls
  stats.readMs = performance.now() - t0;
  last = f;
  draw(f);
  statusLine(f);
}

async function advanceAndShow(n: number) {
  const g = gen, s = sim;
  if (!s) return;
  const t0 = performance.now(), s0 = s.step;
  await s.advance(n);
  if (!current(g, s)) return;
  await showFrame();
  if (!current(g, s)) return;
  const dt = (performance.now() - t0) / 1000;
  if (dt > 0) stats.stepsPerSec = stats.stepsPerSec === 0 ? (s.step - s0) / dt : 0.6 * stats.stepsPerSec + 0.4 * ((s.step - s0) / dt);
  if (last) statusLine(last);
}

/** Runs a task on the queue; an error from a world that has since been replaced is dropped, any other is shown. */
function queued(fn: () => Promise<unknown>) {
  const g = gen;
  exclusive(fn).catch((e) => { if (g === gen) fail(e); });
}

function currentChoiceText(): { record: string } {
  if (S.world === "cyclic") {
    const r = cyclicRecord(S.cyc);
    return { record: r ? `Recorded setting: job ${r.id} (class ${r.klass}), from GATE0-EXPLORATION${r.id.startsWith("g2-") ? "-2" : ""}.md. Exploration, not a result.` : "Not recorded: this combination of size, rule, seed and start was not run in the committed records. Exploration, not a result." };
  }
  const id = ecoRecordId(S.eco);
  if (isJar(S.eco.option)) {
    const s = (JAR_SEEDS as readonly number[]).includes(S.eco.seed);
    return { record: `A setting of the jar levers screen (experiments/3d-slab/jar-levers-screen-2026-11-16.md)${s ? ", with a seed it ran" : "; the screen ran seeds 101 and 102 only"}. This is a fresh run from step 0, not a recorded state. Exploration, judged by eye: no setting passes or fails.` };
  }
  if (isCanopy(S.eco.option)) {
    return { record: id ? `Re-run of an M4b calibration setting: run ${id} (experiments/3d-slab/m4b-results.tsv). That file holds summaries of the run, not its states, so this is a fresh run from step 0 with the same setting and seed, not a recorded state. The calibration found no setting that qualified. Exploration, not a result.` : "Not a calibration run: the M4b calibration ran this setting only at 256 by 256 by 8 on seeds 101, 102 and 103. Exploration, not a result." };
  }
  return { record: id ? `Recorded setting: M4 calibration run ${id} (experiments/3d-slab/m4-results.tsv). The calibration found no setting that qualified, and this viewer starts at step 0 from eight small balls. Exploration, not a result.` : "Not recorded: this size or seed was not run in the M4 calibration, and 128 by 128 dynamics differ from the recorded 256 by 256 ones. Exploration, not a result." };
}

async function rebuild(myGen: number) {
  if (myGen !== gen) return;
  if (sim) { sim.destroy(); counts.destroyed++; sim = null; }
  last = null;
  say("Building the world…");
  $("provenance").textContent = currentChoiceText().record;
  const device = await getDevice((m) => fail(new Error(m)));
  sharedDeviceForVolume = device;
  volume?.attach(device);
  if (myGen !== gen) return;
  const made = S.world === "cyclic" ? await createCyclic(device, { ...S.cyc, size: [...S.cyc.size] as [number, number, number] }) : await createEco(device, { ...S.eco });
  counts.created++;
  if (myGen !== gen) { made.destroy(); counts.destroyed++; return; }
  sim = made;
  stats.stepsPerSec = 0;
  await showFrame();
}

function restart() {
  gen++;
  last = null; // the picture on screen belongs to the old choice: no redraw (view or layer change) may use it from here on
  volume?.clear();
  volumeShown = "";
  const my = gen;
  queued(() => rebuild(my));
}

function tick() {
  if (S.playing && sim && pending === 0) {
    const my = gen;
    const n = PACES.find((p) => p.id === S.pace)!.steps;
    queued(async () => { if (my === gen) await advanceAndShow(n); });
  }
  requestAnimationFrame(tick);
}

function stepBy(n: number) {
  const my = gen;
  queued(async () => { if (my === gen) await advanceAndShow(n); });
}

function syncPlay() {
  const b = $("play");
  b.textContent = S.playing ? "Pause" : "Play";
  b.setAttribute("aria-pressed", String(S.playing));
}

// ---- controls --------------------------------------------------------------------------------------------------------
interface Opt { value: string; title: string; text: string }
let serial = 0;
function radios(host: HTMLElement, name: string, opts: Opt[], checked: string, onChange: (v: string) => void) {
  const active = document.activeElement;
  const keep = active instanceof HTMLInputElement && host.contains(active) ? active.value : null; // keyboard focus survives the rebuild
  host.replaceChildren();
  for (const o of opts) {
    const id = `r-${name}-${serial++}`;
    const label = document.createElement("label");
    label.className = "slab-opt";
    const input = document.createElement("input");
    input.type = "radio"; input.name = name; input.value = o.value; input.checked = o.value === checked;
    input.setAttribute("aria-describedby", `${id}-d`);
    input.addEventListener("change", () => { if (input.checked) onChange(o.value); });
    const t = document.createElement("span"); t.className = "t"; t.textContent = o.title;
    const d = document.createElement("span"); d.className = "d"; d.id = `${id}-d`; d.textContent = o.text;
    label.append(input, t, d);
    host.append(label);
    if (keep !== null && o.value === keep) input.focus();
  }
}

function sizeOpts(): Opt[] {
  return S.world === "cyclic"
    ? CYCLIC_SIZES.map((s) => ({ value: s.join("x"), title: dimsText(s), text: s[0] === 256 ? "The size of the recorded 200,000-step runs; about 340 steps a second here. Fine detail, slower." : "The size of the registered pilot, about four times as fast; dynamics differ from the recorded 256 by 256 runs." }))
    : sizesFor(S.eco.option).map((s) => ({ value: s.join("x"), title: dimsText(s), text: s[2] === 64 ? "The jar: 64 layers deep, the only size the jar settings run at; about 200 steps a second." : s[0] === 256 ? "The recorded calibration size; about 160 to 280 steps a second here." : "Four times quicker, but not a recorded shape: dynamics differ from the calibration's." }));
}

function renderControls() {
  const cyc = S.world === "cyclic";
  $("g-kill").hidden = !cyc; $("g-burn").hidden = !cyc; $("g-eco").hidden = cyc;
  radios($("o-world"), "world", [
    { value: "cyclic", title: "Cyclic competition (4 layers)", text: "Three types that each beat the next in a ring. Gate 0 stopped: no registered setting. Starts from a recorded exploration run." },
    { value: "eco", title: "Slab ecology (8 layers)", text: "The main rule set on a slab, in lineage colours. No setting qualified in calibration; some settings give a full carpet, some stay nearly empty." },
  ], S.world, (v) => { S.world = v as World; S.playing = false; syncPlay(); renderControls(); restart(); });
  radios($("o-kill"), "kill", KILL_OPTIONS.map((k) => ({ value: k.id, title: k.title, text: k.text })), S.cyc.kill, (v) => { S.cyc.kill = v as KillChoice; renderControls(); restart(); });
  radios($("o-eco"), "eco", ALL_ECO.map((o) => ({ value: o.id, title: `${o.title} (${o.nutrient === undefined ? "" : `nutrient ${o.nutrient}, `}mu ${o.mu}, sigma ${o.sigma}, light ${o.lightK})`, text: o.text })), S.eco.option, (v) => { S.eco.option = v; fitEcoSize(); renderControls(); restart(); });
  radios($("o-display"), "display", [
    { value: "layers", title: "Layers", text: "One flat tile per layer and a large top-down picture, as drawn from the start." },
    { value: "volume", title: "Volume", text: "The whole slab drawn in 3D at its true shape, a thin sheet you can turn, zoom and peel layer by layer from the surface." },
  ], S.display, (v) => setDisplay(v as "layers" | "volume"));
  radios($("o-size"), "size", sizeOpts(), (cyc ? S.cyc.size : S.eco.size).join("x"), (v) => {
    const size = v.split("x").map(Number) as [number, number, number];
    if (cyc) S.cyc.size = size; else S.eco.size = size;
    renderControls(); restart();
  });
  radios($("o-burn"), "burn", [
    { value: "yes", title: "As recorded: 6,000 steps with the kill off first", text: "Lets the three types spread into domains before the kill starts, as the recorded runs did. The page says when the kill turns on." },
    { value: "no", title: "Kill on from step 0", text: "Skips the warm-up. Not a recorded start, so the picture is a different experiment." },
  ], S.cyc.burnIn ? "yes" : "no", (v) => { S.cyc.burnIn = v === "yes"; renderControls(); restart(); });
  radios($("o-pace"), "pace", PACES.map((p) => ({ value: p.id, title: p.title, text: p.text })), S.pace, (v) => { S.pace = v as Pace; });
  radios($("o-view"), "view", [
    { value: "combined", title: "Combined", text: "One large top-down picture of all layers at once." },
    { value: "layer", title: "One layer", text: "The large picture shows only the layer chosen below, so you can see how a layer differs from the surface." },
  ], S.view, (v) => { S.view = v as "combined" | "layer"; if (last) draw(last); });
  const seed = $<HTMLInputElement>("seed");
  seed.value = String(cyc ? S.cyc.seed : S.eco.seed);
  const quick = $("seed-quick");
  quick.replaceChildren();
  const jar = !cyc && isJar(S.eco.option);
  for (const s of cyc ? CYCLIC_SEEDS : jar ? JAR_SEEDS : ECO_SEEDS) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "button quiet"; b.textContent = jar ? `${s} (as in the screen)` : !cyc && isCanopy(S.eco.option) ? `${s} (as in M4b)` : `${s} (recorded)`;
    b.addEventListener("click", () => { setSeed(s); });
    quick.append(b, " ");
  }
  const maxZ = (cyc ? S.cyc.size : S.eco.size)[2] - 1;
  $<HTMLInputElement>("layer").max = String(maxZ);
  if (S.layer > maxZ) setLayer(maxZ);
  renderNotes();
}

function setSeed(s: number) {
  const seed = $<HTMLInputElement>("seed");
  if (!Number.isInteger(s) || s < 0 || s > 999999) { seed.value = String(S.world === "cyclic" ? S.cyc.seed : S.eco.seed); return; } // keep the box in step with the running seed
  if (S.world === "cyclic") S.cyc.seed = s; else S.eco.seed = s;
  seed.value = String(s);
  restart();
}

function renderNotes() {
  $("notes").innerHTML = S.world === "cyclic"
    ? `<h2>What you are looking at</h2><p>Each colour is one of three types; dark cells are empty. A tile is one layer of a slab four cells deep. Edges wrap sideways (left meets right, top meets bottom) but the picture does not draw the wrap; the top and bottom layers are closed. Watch for spirals, blobs and flat or tilted fronts through depth. The kill only starts after ${BURN_IN.toLocaleString("en")} steps when the recorded start is chosen.</p><p>Status of this world: Gate 0 ended in a stop, so nothing here is a result. Spread ${SPREAD}, rate and seed come from the committed exploration records; the run is not a re-run of them and no hash match is claimed.</p>`
    : isJar(S.eco.option)
    ? `<h2>What you are looking at</h2><p>A jar 64 cells wide, 64 deep and 64 tall; layer 0, at the top, gets the light. Each tile is one layer. The world starts from eight small balls, and the jar fills over the first 10,000 to 20,000 steps. The jar settings are the arms of the jar levers screen: the same world, with one change each (where life starts, waste sinking, waste rotting on the floor, upwelling, or a ring of three types). Nothing here is a result; the screen was judged by eye.</p><p>Colours are lineage colours, as in the lab; dark squares are non-living cells lit by their nutrient.</p>`
    : `<h2>What you are looking at</h2><p>Each tile is one layer of an eight-layer slab; layer 0 gets the light. The world starts from eight small balls, so with the default setting on seed 101 the recorded full carpet appears only after about 15,000 steps, about a minute at the fastest pace; other settings and seeds do something else, and some stay nearly empty. The calibration found no setting that qualified, and the 3D line is closed at rung 1b; this viewer is for looking.</p><p>Colours are lineage colours, as in the lab; dark squares are non-living cells lit by their nutrient.</p>`;
}

// ---- boot ------------------------------------------------------------------------------------------------------------
function debugHooks() {
  if (!new URLSearchParams(location.search).has("debug")) return;
  (window as unknown as Record<string, unknown>).__slab = {
    frame: () => last,
    draws: () => drawLog,
    counts: () => ({ ...counts, live: counts.created - counts.destroyed, pending }),
    step: () => sim?.step ?? -1,
    state: () => ({ world: S.world, cyc: S.cyc, eco: S.eco, display: S.display }),
    /** The volume view: what was packed last, its GPU errors and draw count, and a draw that waits for the renderer. */
    volume: () => (volume ? { shown: volumeShown, errors: [...volume.errors], draws: volume.draws, live: volume.liveCount, renderer: volume.renderer, mounted: volume.mountedRenderer, painted: volume.lastPainted, peel: volume.peel, stretch: volume.stretch, resources: Disposer.live } : null),
    volumeDraw: () => volume?.drawNow(),
    volumeShot: async () => { await volume?.drawNow(); return ($("volume-canvas") as HTMLCanvasElement).toDataURL("image/png"); },
    /** A capture still (tools/volume-capture): turntable off, no per-frame jitter or drift, the camera at the given pose
     *  (absolute, unset fields as they are), drawn fresh. The picture then depends only on the frame and these settings. */
    volumeStill: async (pose: { yaw?: number; pitch?: number; dist?: number } = {}) => {
      if (!volume) return null;
      volume.setTurntable(false);
      $("turntable").setAttribute("aria-pressed", "false");
      volume.still = true;
      if (pose.yaw !== undefined) volume.cam.yaw = pose.yaw;
      if (pose.pitch !== undefined) volume.cam.pitch = pose.pitch;
      if (pose.dist !== undefined) volume.cam.dist = pose.dist;
      await volume.drawNow();
      const c = $("volume-canvas") as HTMLCanvasElement;
      return { url: c.toDataURL("image/png"), w: c.width, h: c.height, yaw: volume.cam.yaw, pitch: volume.cam.pitch, dist: volume.cam.dist };
    },
    /** Advances to exactly `n` steps in batches of 100 (cutting at the hand-over), then draws. */
    runTo: (n: number) => {
      const asked = gen; // captured when asked, not when the queue reaches it: a world change in between makes this a no-op
      return exclusive(async () => {
        if (asked !== gen) return;
        const g = gen, s = sim;
        while (s && s.step < n && current(g, s)) await s.advance(Math.min(100, n - s.step));
        if (current(g, s)) await showFrame();
      });
    },
    /** Holds every read open after the readback finishes, until `releaseReads`; `held()` counts reads waiting. */
    holdReads: () => { readGate = new Promise<void>((r) => { releaseGate = r; }); held = 0; },
    releaseReads: () => { releaseGate?.(); readGate = null; releaseGate = null; },
    held: () => held,
    living: () => exclusive(async () => (sim?.living ? sim.living() : -1)),
    /** Ecology: a fresh stock simulator run straight to `steps` and read with the raw readers (no adapter, no slicing), compared
     *  array by array with the frame on screen. Destroys the live simulator. */
    ecoCompare: (steps: number) => exclusive(async () => {
      const shown = last;
      if (!shown || shown.kind !== "eco") throw new Error("no ecology frame on screen");
      if (sim) { sim.destroy(); counts.destroyed++; sim = null; }
      const cfg = ecoConfig(S.eco);
      const n = cfg.tileW * cfg.tileH * cfg.tileD!;
      const device = await getDevice(() => {});
      const g = await StockSim3.create(device, initWorld(cfg, ecoInit(S.eco)));
      for (let b = 0; b < steps; b += SUBMIT_STEPS) g.run(Math.min(SUBMIT_STEPS, steps - b));
      const cells = await g.readCells();
      const lin = await g.readGenomeChannels(G.LIN_HI, 2);
      const step = g.step;
      g.destroy();
      const same = (want: ArrayLike<number>, got: ArrayLike<number>) => { for (let i = 0; i < want.length; i++) if (want[i] !== got[i]) return i; return -1; };
      return {
        step, shownStep: shown.step, n,
        firstDiff: {
          B: same(cells.subarray(CH.B * n, (CH.B + 1) * n), shown.B), P: same(cells.subarray(CH.P * n, (CH.P + 1) * n), shown.P),
          A: same(cells.subarray(CH.A * n, (CH.A + 1) * n), shown.A), hi: same(lin.subarray(0, n), shown.hi), lo: same(lin.subarray(n, 2 * n), shown.lo),
        },
      };
    }),
    /** An independent direct run of the spike's harness path for the current cyclic choice, destroying the live simulator. */
    reference: (steps: number) => exclusive(async () => {
      if (sim) { sim.destroy(); counts.destroyed++; sim = null; }
      const c = S.cyc;
      const cfg = jobConfig("S0", c.size, SPREAD, c.seed);
      const dims = { W: cfg.tileW, H: cfg.tileH, D: cfg.tileD! };
      const device = await getDevice(() => {});
      applySettings(cyclicSettings(c, c.burnIn ? "burn" : "run")); // "Kill on from step 0" has no burn-in phase
      let g = await RpsSim3.create(device, rpsMix(cfg, mixParams("S0")));
      const burn = c.burnIn ? Math.min(steps, BURN_IN) : steps;
      for (let b = 0; b < burn; b += SUBMIT_STEPS) g.run(Math.min(SUBMIT_STEPS, burn - b));
      if (c.burnIn && steps > BURN_IN) {
        const st = await g.readState();
        g.destroy();
        applySettings(cyclicSettings(c, "run"));
        g = await RpsSim3.create(device, st);
        for (let b = BURN_IN; b < steps; b += SUBMIT_STEPS) g.run(Math.min(SUBMIT_STEPS, steps - b));
      }
      const snap = await g.readSnapshot(false);
      g.destroy();
      return { step: snap.step, labels: Array.from(rpsLabels({ cells: snap.cells, genomeHead: snap.genomeHead }, dims)) };
    }),
  };
}

function boot() {
  readLink();
  debugHooks();
  if (!navigator.gpu) {
    $("slab-body").hidden = true;
    const m = $("slab-message");
    m.hidden = false;
    m.textContent = "This page needs WebGPU, which this browser does not offer. Try a recent Chrome or Edge on a computer with a graphics card.";
    return;
  }
  renderControls();
  $("play").addEventListener("click", () => { S.playing = !S.playing; syncPlay(); });
  $("step1").addEventListener("click", () => { S.playing = false; syncPlay(); stepBy(1); });
  $("step100").addEventListener("click", () => { S.playing = false; syncPlay(); stepBy(100); });
  $("seed").addEventListener("change", () => { const raw = $<HTMLInputElement>("seed").value.trim(); setSeed(raw === "" ? NaN : Number(raw)); });
  $("peel").addEventListener("input", () => { if (volume) { volume.peel = Number($<HTMLInputElement>("peel").value); syncPeel(); volume.request(); } });
  $("cut").addEventListener("input", () => { if (volume) { volume.cut = Number($<HTMLInputElement>("cut").value) / 100; syncPeel(); volume.request(); } });
  $("stretch").addEventListener("input", () => {
    const k = Number($<HTMLInputElement>("stretch").value);
    $("stretch-out").textContent = String(k);
    volume?.setStretch(k);
    if (last && S.display === "volume") volumeCaption(last);
  });
  $("turntable").addEventListener("click", () => {
    if (!volume) return;
    volume.setTurntable(!volume.turntable);
    $("turntable").setAttribute("aria-pressed", String(volume.turntable));
  });
  const layer = $<HTMLInputElement>("layer");
  layer.addEventListener("input", () => { setLayer(Number(layer.value)); if (last) draw(last); });
  if (S.display === "volume") setDisplay("volume");
  restart();
  requestAnimationFrame(tick);
}
boot();
