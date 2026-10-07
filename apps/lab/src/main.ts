import { PRESETS, pondScoreTerms, worldH, worldW, worstRanks, NN_I, NN_H, NN_O, NN_BYTES, type PondTerm, type WorldConfig } from "@bl/schema";
import { VIEW_MODES, type GpuViewMode, type ViewRect } from "@bl/sim-gpu";
import type { CensusMsg, FromWorker, PondAwaitMsg, PondsMsg, ProbeMsg, StatsMsg, ToWorker } from "./protocol.ts";
import { Series } from "./sparkline.ts";
import { createLineagePanel } from "./lineage-panel.ts";
import { FAMILIES, byId, familyOf } from "./worlds.ts";
import { createWorldPicker, describeWorld } from "./worlds-ui.ts";
import "./theme.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (v: number) =>
  Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(2)}G` : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : Math.abs(v) >= 1e4 ? `${(v / 1e3).toFixed(1)}k` : `${Math.round(v)}`;

const canvas = $<HTMLCanvasElement>("world");
const wrap = $("canvas-wrap");
const worker = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
const send = (m: ToWorker, t: Transferable[] = []) => worker.postMessage(m, t);
const lineagePanel = createLineagePanel(send);

let cfg: WorldConfig | null = null;
/** The world's config when a load was requested: the worker keeps that world if the load fails. */
let cfgBeforeLoad: WorldConfig | null = null;
let rect: ViewRect = { x: 0, y: 0, w: 256, h: 256 };
let mode: GpuViewMode = "composite";
type Tool = "inspect" | "lesion" | "feed" | "drain" | "pan" | "pick";
let tool: Tool = "inspect";
let playing = false;
let lastStep = 0;
let worldReady = false;
let verifying = false;
let loadingWorld = false;
/** The worker has a GPU device: a failure after that is about a world, not about the browser. */
let gpuReady = false;
/**
 * What a checkpoint holds of the current run. `cleanStep` is the latest step one holds (the step the world was
 * loaded at, until then). `touched`: the world was changed by hand since, without its step moving; `cleanFile` is
 * the checkpoint that last answered that, and deleting it brings `touched` back. `advanceAsked`: steps were asked
 * for at that step and no stats have shown them yet, so the step counter cannot be trusted to say "nothing new".
 */
let runId = "";
let loadedStep = 0;
let cleanStep = 0;
let touched = false;
let cleanFile: string | null = null;
let advanceAsked: number | null = null;
/** Changes made by hand, counted; each save in flight remembers the count it was asked at (oldest first). */
let changes = 0;
/** The count the latest surviving save of this run holds: the strip shows what has happened by hand since. */
let savedChanges = 0;
/** The count each of this run's saved copies holds, by file, and the count the run was loaded with: deleting a copy moves the baseline back. */
const handHeld = new Map<string, number>();
let handAtLoad = 0;
const savesAsked: number[] = [];
/** The starting world and seed the world on screen grew from: Plant says whether it would change anything. */
let loadedPresetId: string | null = null;
let loadedSeed: number | null = null;
/** Runs when the save it was queued with is acknowledged ("saved"); dropped if that save is refused or fails. */
let afterSave: (() => void) | null = null;
/** The last replay check: the segment it covered, and whether the world was changed at its end step afterwards. */
let verified: { ok: boolean; from: number; to: number; live: string; twin: string; touched: boolean } | null = null;
/** A brush was used while a check was running: it lands on the check's end step, after the hashes were taken. */
let touchedWhileVerifying = false;
/** The cell last inspected, in world coordinates. */
let probed: { x: number; y: number } | null = null;
const t = (step: number) => `t=${step.toLocaleString()}`;

function setStatus(message: string, state: "ready" | "running" | "error" | "loading" = "ready") {
  $("simulation-status").textContent = message;
  $("simulation-dot").className = `status-dot ${state}`;
}

function setWorldControls(enabled: boolean) {
  worldReady = enabled;
  for (const id of ["btn-play", "btn-step", "btn-step100", "btn-save", "btn-export", "btn-verify"])
    $<HTMLButtonElement>(id).disabled = !enabled;
}
setWorldControls(false);

/** What each view shows: its name on the button, and what the colours mean under the field. */
const VIEW_LABELS: Record<GpuViewMode, [string, string]> = {
  composite: ["Everything", "green biomass · white membrane · blue nutrient · brown waste"],
  lineage: ["Lineages", "one colour per lineage, brighter where there is more bound mass"],
  nutrient: ["Nutrient", "dissolved nutrient A, the food"],
  waste: ["Waste", "dissolved waste C, what is left after work"],
  energy: ["Energy", "free energy E, carried with biomass"],
  signal: ["Signal", "secreted signal S, what cells can sense of each other"],
  affinity: ["Pull", "where mass is pulled: red attracts, blue repels (the growth field U)"],
  light: ["Light", "where the sun falls at this step, brighter where there is more of it"],
};

// ---------- view modes ----------
const views = $("views");
VIEW_MODES.forEach((m, k) => {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = VIEW_LABELS[m][0];
  b.title = `${VIEW_LABELS[m][1]} (${k + 1})`;
  b.dataset.mode = m;
  b.setAttribute("aria-pressed", "false");
  b.onclick = () => setMode(m);
  views.appendChild(b);
});
function setMode(m: GpuViewMode) {
  mode = m;
  for (const b of views.querySelectorAll("button")) {
    const selected = b.dataset.mode === m;
    b.classList.toggle("on", selected);
    b.setAttribute("aria-pressed", String(selected));
    // On a phone the picker scrolls sideways: keep the lit view in sight, also when chosen by key.
    if (selected) b.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  const name = document.createElement("b");
  name.textContent = VIEW_LABELS[m][0];
  $("legend").replaceChildren("Showing ", name, `: ${VIEW_LABELS[m][1]}`);
  pushView();
}

// ---------- presets ----------
const presetSel = $<HTMLSelectElement>("preset");
// The select groups worlds by the catalogue's families (worlds.ts), in its order; a world in no family lands last.
{
  const option = (p: { id: string; name: string }) => new Option(p.name, p.id);
  for (const f of FAMILIES) {
    const g = document.createElement("optgroup");
    g.label = f.name;
    for (const id of f.ids) {
      const p = byId(id);
      if (p) g.append(option(p));
    }
    presetSel.append(g);
  }
  const orphans = PRESETS.filter((p) => !familyOf(p.id));
  if (orphans.length) {
    const g = document.createElement("optgroup");
    g.label = "Other worlds";
    for (const p of orphans) g.append(option(p));
    presetSel.append(g);
  }
}
/** A fresh seed number for this visit, 1 to 9999: short enough to read out, so a history can be grown again. */
const freshSeed = () => 1 + Math.floor(Math.random() * 9999);
// Every visit opens on a fresh seed number, so two visitors grow different histories unless they mean not to.
// A link can choose the world and the seed (/lab/?world=<id>&seed=<n>); anything it names that does not exist is ignored.
{
  const params = new URLSearchParams(location.search);
  const world = params.get("world");
  if (world && byId(world)) presetSel.value = world;
  const seed = Number(params.get("seed"));
  const linked = params.has("seed") && Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff;
  $<HTMLInputElement>("seed").value = String(linked ? seed : freshSeed());
}
// A link naming a world is served a copy of the lab titled for that world (deploy/Caddyfile); once another world is
// planted, the tab names that one instead. The plain lab keeps its own title whatever is planted.
const servedTitle = document.title;
const servedWorld = byId(new URLSearchParams(location.search).get("world"))?.id ?? null;
const titleFor = (presetId: string | null, name: string) =>
  servedWorld === null || presetId === servedWorld ? servedTitle : `${name} · Cadence Garden`;
const presetName = (id: string | null) => PRESETS.find((p) => p.id === id)?.name ?? (id ? "an opened world" : "");
const showPresetDesc = () => describeWorld(byId(presetSel.value), $("preset-desc"));
/**
 * Choosing a starting world or a seed changes nothing until Plant is pressed: the button says which it would do,
 * lights up when the choice differs from the world on screen, and the note says what is on screen meanwhile.
 */
function syncPlant() {
  const button = $<HTMLButtonElement>("btn-new"), note = $("plant-note");
  const seedNow = Number($<HTMLInputElement>("seed").value) || 0;
  const same = loadedPresetId === presetSel.value && loadedSeed === seedNow;
  button.textContent = same ? "Plant it again" : "Plant this world";
  button.classList.toggle("primary", !same && loadedPresetId !== null);
  note.hidden = loadedPresetId === null;
  note.classList.toggle("armed", !same);
  note.textContent = same
    ? "Planting again grows the same history from step 0, without anything you did by hand."
    : `Not planted yet: the world on screen is still ${presetName(loadedPresetId)}, seed ${loadedSeed}.`;
}
presetSel.onchange = () => { showPresetDesc(); syncPlant(); };
$<HTMLInputElement>("seed").oninput = syncPlant;
showPresetDesc();
// The catalogue: choosing there is choosing in the select, and Plant then says whether it would change anything.
const worldPicker = createWorldPicker($<HTMLDialogElement>("worlds"), (id) => {
  presetSel.value = id;
  showPresetDesc();
  syncPlant();
  $("btn-new").focus();
});
$("btn-worlds").onclick = () => worldPicker.open({ chosen: presetSel.value, onScreen: loadedPresetId });
/** Whether leaving this world now would lose steps or interventions that no checkpoint holds. */
const unsaved = () => worldReady && (lastStep > cleanStep || touched || advanceAsked !== null);
const unsavedText = () =>
  `This world is at ${t(lastStep)}. ${cleanStep > 0 ? `Its last saved copy is at ${t(cleanStep)}; ${touched && lastStep <= cleanStep ? "changes made by hand since then" : "everything after that"} would be lost.` : "Nothing from this run is saved yet."}`;
/** What has happened by hand since the last save, in the strip beside the world's name. */
function syncHand() {
  const n = changes - savedChanges;
  $("run-hand-item").hidden = n === 0;
  $("run-hand").textContent = `${n} change${n === 1 ? "" : "s"}, unsaved`;
}

// ---------- inline questions ----------
type Choice = [label: string, run: () => void];
let closeQuestion: (() => void) | null = null;
/** Asks in place, beside the action that raised the question. Cancel and Escape put the focus back on `opener`. */
function ask(host: HTMLElement, opener: HTMLElement, text: string, choices: Choice[], cancel = "Cancel") {
  closeQuestion?.();
  const close = (refocus: boolean) => {
    host.hidden = true;
    host.replaceChildren();
    host.onkeydown = null;
    closeQuestion = null;
    // The answered button is gone: focus goes back to what raised the question, or to the nearest control still
    // there when that was a checkpoint row redrawn in the meantime.
    if (refocus) [opener, ...host.parentElement!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.isConnected && !(b as HTMLButtonElement).disabled && b.getClientRects().length > 0)?.focus();
  };
  closeQuestion = () => close(false);
  const p = document.createElement("p");
  p.textContent = text;
  const row = document.createElement("div");
  row.className = "row";
  for (const [label, run] of [...choices, [cancel, () => {}] as Choice]) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.onclick = () => { close(true); run(); };
    row.append(b);
  }
  host.replaceChildren(p, row);
  host.hidden = false;
  host.onkeydown = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(true); } };
  row.querySelector("button")!.focus();
}
function requestSave() {
  savesAsked.push(changes);
  send({ type: "save" });
}
/** Saves, then runs `next` once that save is acknowledged. A refused or failed save drops `next`. */
function saveThen(next: () => void) {
  afterSave = next;
  requestSave();
}
/** Steps were asked for: until stats show the world past this step, it may hold more than the counter says. */
function askedToAdvance() {
  if (advanceAsked === null) advanceAsked = lastStep;
}
/** Runs `go` at once when nothing would be lost; otherwise asks first, offering to save. */
function guardUnsaved(host: HTMLElement, opener: HTMLElement, verb: string, consequence: string, go: () => void) {
  if (!unsaved()) return go();
  ask(host, opener, `${unsavedText()} ${consequence}`, [[`Save, then ${verb}`, () => saveThen(go)], [`${verb[0].toUpperCase()}${verb.slice(1)} without saving`, go]]);
}

$("btn-new").onclick = () => guardUnsaved($("guard-new"), $("btn-new"), "plant", "A new world replaces it.", startWorld);
function startWorld() {
  setPlaying(false);
  setWorldControls(false);
  cfgBeforeLoad = cfg;
  cfg = null;
  loadingWorld = true;
  setStatus(`Planting ${presetName(presetSel.value)}…`, "loading");
  $<HTMLButtonElement>("btn-new").disabled = true;
  send({ type: "load", presetId: presetSel.value, seed: Number($<HTMLInputElement>("seed").value) || 0 });
}

// ---------- playback ----------
const SPEEDS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];
const speed = $<HTMLInputElement>("speed");
speed.oninput = () => {
  const v = SPEEDS[Number(speed.value)];
  $("speed-val").textContent = `×${v}`;
  send({ type: "speed", stepsPerFrame: v });
};
function setPlaying(p: boolean) {
  playing = p;
  const b = $("btn-play");
  b.setAttribute("aria-pressed", String(p));
  syncPlayLabel();
  if (worldReady) showRunStatus();
  if (p) askedToAdvance();
  send({ type: "play", playing: p });
}
/**
 * While a cycle waits, Play does not advance the world: it becomes a switch for running on once the donors are in,
 * with one label either way and its state in aria-pressed, so it never reads "Pause" over a world that is not moving.
 */
function syncPlayLabel() {
  const b = $("btn-play");
  b.textContent = awaiting ? "Run after breed" : playing ? "Pause" : "Play";
  b.title = awaiting ? (playing ? "On: the world runs on once you breed" : "Off: the world stays paused once you breed") : "";
}
/** The header status: a waiting pond cycle is the news until it is resolved, whatever Play says. */
function showRunStatus() {
  if (awaiting) setStatus(`Cycle ${awaiting.cycle}: choose the donors${playing ? ", then the world runs on" : ""}`, "ready");
  else setStatus(playing ? "Growing" : "Paused", playing ? "running" : "ready");
}
/** Steps wait with everything else while a pond cycle waits: the "." shortcut included. */
const stepBy = (count: number) => { if (awaiting) return; askedToAdvance(); send({ type: "step", count }); };
$("btn-play").onclick = () => setPlaying(!playing);
$("btn-step").onclick = () => stepBy(1);
$("btn-step100").onclick = () => stepBy(100);

// ---------- tools ----------
const tools = $("tools");
/** The tool's name as on its button, and what it does, said under the hand that holds it. */
const TOOL_NAMES: Record<Tool, string> = { inspect: "Look", lesion: "Wound", feed: "Feed", drain: "Drain", pan: "Move", pick: "Pick" };
const TOOL_SAYS: Record<Tool, string> = {
  inspect: "Click a spot on the world to see what is in that cell.",
  lesion: "Click or drag to clear a patch. Bodies there turn to waste and their stored energy to heat; no matter leaves the jar.",
  feed: "Click or drag to add nutrient where you point.",
  drain: "Click or drag to take nutrient out where you point.",
  pan: "Drag to move around. Scroll to zoom, double-click to fit the whole world.",
  pick: "Click ponds on the field to choose the donors of the next round.",
};
/** The verb for the hover line on the field: what a click there would do with this tool. */
const TOOL_VERB: Record<Tool, string> = {
  inspect: "click to look", lesion: "click or drag to wound", feed: "click or drag to feed", drain: "click or drag to drain", pan: "drag to move", pick: "click to pick",
};
function setTool(t: Tool) {
  tool = t;
  for (const o of tools.querySelectorAll<HTMLButtonElement>("button")) {
    const selected = o.dataset.tool === t;
    o.classList.toggle("on", selected);
    o.setAttribute("aria-pressed", String(selected));
  }
  wrap.dataset.tool = tool;
  const name = document.createElement("b");
  name.textContent = `${TOOL_NAMES[t]}.`;
  $("tool-says").replaceChildren(name, ` ${TOOL_SAYS[t]}`);
  syncBrush();
}
for (const b of tools.querySelectorAll<HTMLButtonElement>("button")) b.onclick = () => setTool(b.dataset.tool as Tool);
wrap.dataset.tool = tool;
const radius = $<HTMLInputElement>("radius");
radius.oninput = () => ($("radius-val").textContent = radius.value);
const amount = $<HTMLInputElement>("amount");
amount.oninput = () => ($("amount-val").textContent = amount.value);
const brush = () => tool === "lesion" || tool === "feed" || tool === "drain";
const feeding = () => tool === "feed" || tool === "drain";
/** The radius serves every brush; the amount only Feed and Drain, with their notice. */
function syncBrush() {
  radius.disabled = !brush();
  amount.disabled = !feeding();
  $("feed-hint").hidden = !feeding();
}
syncBrush();
/** One application of the current brush at world position (x, y). */
function applyBrush(x: number, y: number) {
  if (tool !== "lesion" && !feeding()) return;
  // The world changes without its step moving: no checkpoint holds this, and a replay check that ended here no longer describes it.
  touched = true;
  changes++;
  strokeApplied++;
  syncHand();
  if (verifying) touchedWhileVerifying = true;
  if (verified && !verified.touched) { verified.touched = true; showVerification(); }
  if (tool === "lesion") send({ type: "lesion", x, y, r: Number(radius.value) });
  else if (feeding()) send({ type: "feed", x, y, r: Number(radius.value), amount: (tool === "feed" ? 1 : -1) * Number(amount.value) });
}
/** Brush applications in the stroke under way (a press, or a press and drag): the toast at its end says what it did. */
let strokeApplied = 0;
/** A stroke ended: say what it did and what it adds up to, once per stroke, and only if the brush was applied at all. */
function strokeToast() {
  if (strokeApplied === 0) return;
  const n = changes - savedChanges;
  const did = tool === "lesion" ? "Wounded" : tool === "feed" ? "Fed" : "Drained";
  const what = strokeApplied === 1 ? "a patch" : `a stroke of ${strokeApplied} patches`;
  toast(`${did} ${what}, radius ${Number(radius.value)} · ${n} change${n === 1 ? "" : "s"} by hand, unsaved`);
  strokeApplied = 0;
}
setTool(tool);

// ---------- canvas geometry, zoom and pan ----------
function resize() {
  const r = wrap.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  send({ type: "resize", width: Math.round(r.width * dpr), height: Math.round(r.height * dpr) });
  // While a cycle waits the whole world stays in view, whatever the new shape of the field.
  fit(awaiting !== null);
}
function fit(reset = true) {
  if (!cfg) return;
  const r = wrap.getBoundingClientRect();
  const W = worldW(cfg), H = worldH(cfg);
  const aspect = r.width / Math.max(1, r.height);
  if (reset || rect.w === 0) {
    if (aspect >= W / H) rect = { x: 0, y: 0, w: H * aspect, h: H };
    else rect = { x: 0, y: 0, w: W, h: W / aspect };
    rect.x = -(rect.w - W) / 2;
    rect.y = -(rect.h - H) / 2;
  } else {
    const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
    rect.h = rect.w / aspect;
    rect.x = cx - rect.w / 2;
    rect.y = cy - rect.h / 2;
  }
  pushView();
}
function pushView() {
  send({ type: "view", mode, rect: { ...rect } });
  drawPondOverlay();
  placeProbeMarker();
}
/** The inspected cell's marker follows the view, and hides when the cell is out of it. */
function placeProbeMarker() {
  const mark = $("probe-marker");
  const fx = probed ? (probed.x + 0.5 - rect.x) / rect.w : -1, fy = probed ? (probed.y + 0.5 - rect.y) / rect.h : -1;
  mark.hidden = !(fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1);
  mark.style.left = `${fx * 100}%`;
  mark.style.top = `${fy * 100}%`;
}
function toWorld(ev: { clientX: number; clientY: number }): [number, number] {
  const r = canvas.getBoundingClientRect();
  return [rect.x + ((ev.clientX - r.left) / r.width) * rect.w, rect.y + ((ev.clientY - r.top) / r.height) * rect.h];
}
/** In a pond world, the pond under world point (x, y), wrapped: the index the pond cycle uses (ty * tilesX + tx); null otherwise. */
function pondAt(x: number, y: number): number | null {
  if (!cfg || cfg.pondPeriod === undefined) return null;
  const W = worldW(cfg), H = worldH(cfg);
  const cx = ((Math.floor(x) % W) + W) % W, cy = ((Math.floor(y) % H) + H) % H;
  return Math.floor(cy / cfg.tileH) * cfg.tilesX + Math.floor(cx / cfg.tileW);
}
new ResizeObserver(resize).observe(wrap);
$("btn-fit").onclick = () => fit(true);
canvas.ondblclick = () => fit(true);
canvas.addEventListener(
  "wheel",
  (ev) => {
    ev.preventDefault();
    const [wx, wy] = toWorld(ev);
    const k = Math.exp(ev.deltaY * 0.0015);
    const nw = Math.min(Math.max(rect.w * k, 8), (cfg ? worldW(cfg) : 256) * 4);
    const f = nw / rect.w;
    rect = { x: wx - (wx - rect.x) * f, y: wy - (wy - rect.y) * f, w: rect.w * f, h: rect.h * f };
    pushView();
  },
  { passive: false },
);
let drag: { x: number; y: number; rx: number; ry: number } | null = null;
let lesionDrag = false;
let focusX = 0.5, focusY = 0.5;
const focusCursor = document.createElement("span");
focusCursor.className = "focus-cursor";
focusCursor.setAttribute("aria-hidden", "true");
wrap.append(focusCursor);
function placeFocusCursor() {
  focusCursor.style.left = `${focusX * 100}%`;
  focusCursor.style.top = `${focusY * 100}%`;
  if (cfg) {
    const x = rect.x + focusX * rect.w, y = rect.y + focusY * rect.h;
    const pond = pondAt(x, y);
    const verb = tool === "pan" ? "center here" : TOOL_NAMES[tool].toLowerCase();
    $("hover").textContent = `x ${Math.floor(x)}  y ${Math.floor(y)}${pond === null ? "" : ` · pond ${pond}`} · Enter to ${verb}`;
    $("keyboard-position").textContent = `Column ${Math.floor(x)}, row ${Math.floor(y)}.${pond === null ? "" : ` Pond ${pond}.`} Enter to ${verb}.`;
  }
}
// The focus point belongs to the keyboard: a pointer click focuses the canvas without showing it.
const showFocusCursor = () => { wrap.classList.add("keyboard-focus"); placeFocusCursor(); };
canvas.addEventListener("focus", () => { if (canvas.matches(":focus-visible")) showFocusCursor(); });
canvas.addEventListener("blur", () => { wrap.classList.remove("keyboard-focus"); $("hover").textContent = ""; $("keyboard-position").textContent = ""; });
canvas.addEventListener("keydown", (ev) => {
  const moves: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
  };
  if (ev.key in moves) {
    ev.preventDefault();
    const [dx, dy] = moves[ev.key];
    // 3% of the view per press; with Shift, exactly one cell.
    focusX = Math.min(1, Math.max(0, focusX + dx * (ev.shiftKey ? 1 / rect.w : 0.03)));
    focusY = Math.min(1, Math.max(0, focusY + dy * (ev.shiftKey ? 1 / rect.h : 0.03)));
    showFocusCursor();
  } else if (ev.key === "Enter" && worldReady && cfg) {
    ev.preventDefault();
    const x = rect.x + focusX * rect.w, y = rect.y + focusY * rect.h;
    if (tool === "inspect") send({ type: "probe", x, y });
    else if (brush()) { strokeApplied = 0; applyBrush(x, y); strokeToast(); }
    else if (tool === "pick") pickAt(x, y);
    else { rect.x = x - rect.w / 2; rect.y = y - rect.h / 2; pushView(); }
  } else if ((ev.key === "+" || ev.key === "-") && cfg) {
    ev.preventDefault();
    const factor = ev.key === "+" ? 0.8 : 1.25;
    const x = rect.x + focusX * rect.w, y = rect.y + focusY * rect.h;
    const w = Math.min(Math.max(rect.w * factor, 8), worldW(cfg) * 4);
    const h = rect.h * w / rect.w;
    rect = { x: x - focusX * w, y: y - focusY * h, w, h };
    pushView();
  }
});
canvas.onpointerdown = (ev) => {
  if (!worldReady) return;
  canvas.setPointerCapture(ev.pointerId);
  if (tool === "pan" || ev.button === 1 || ev.button === 2) {
    drag = { x: ev.clientX, y: ev.clientY, rx: rect.x, ry: rect.y };
  } else if (brush()) {
    lesionDrag = true;
    strokeApplied = 0;
    lesionAt(ev);
  } else if (tool === "pick") {
    const [x, y] = toWorld(ev);
    pickAt(x, y);
  } else {
    const [x, y] = toWorld(ev);
    send({ type: "probe", x, y });
  }
};
canvas.onpointermove = (ev) => {
  const [x, y] = toWorld(ev);
  if (cfg) {
    const W = worldW(cfg), H = worldH(cfg);
    const pond = pondAt(x, y);
    // The hover line says where the pointer is and what a click there would do with the tool in hand.
    const verb = document.createElement("b");
    verb.textContent = TOOL_VERB[tool];
    const where = `x ${(((Math.floor(x) % W) + W) % W)}  y ${(((Math.floor(y) % H) + H) % H)}  · zoom ${(worldW(cfg) / rect.w).toFixed(2)}×${pond === null ? "" : ` · pond ${pond}${pondReadout(pond)}`}`;
    if (worldReady && !drag) $("hover").replaceChildren(`${where} · `, verb);
    else $("hover").textContent = where;
  }
  if (drag) {
    const r = canvas.getBoundingClientRect();
    rect.x = drag.rx - ((ev.clientX - drag.x) / r.width) * rect.w;
    rect.y = drag.ry - ((ev.clientY - drag.y) / r.height) * rect.h;
    pushView();
  } else if (lesionDrag) lesionAt(ev);
};
canvas.onpointerup = canvas.onpointercancel = () => {
  drag = null;
  // The stroke is over: one toast for the press and whatever the drag added, none if the throttle swallowed a lone press.
  if (lesionDrag) strokeToast();
  lesionDrag = false;
};
canvas.onpointerleave = () => ($("hover").textContent = "");
canvas.oncontextmenu = (e) => e.preventDefault();
let lastLesion = 0;
function lesionAt(ev: PointerEvent) {
  if (!worldReady) return;
  const now = performance.now();
  if (now - lastLesion < 60) return;
  lastLesion = now;
  const [x, y] = toWorld(ev);
  applyBrush(x, y);
}

// ---------- keyboard ----------
window.addEventListener("keydown", (e) => {
  // Leave focused controls and links to their native keyboard behavior, and the catalogue to its own keys while it is open.
  if (e.target !== document.body && e.target !== canvas) return;
  if ($<HTMLDialogElement>("worlds").open) return;
  if (e.key === " ") {
    if (!worldReady) return;
    e.preventDefault();
    setPlaying(!playing);
  } else if (e.key === "." && worldReady) stepBy(1);
  else if (/^[1-8]$/.test(e.key)) setMode(VIEW_MODES[Number(e.key) - 1]);
});

// ---------- checkpoints ----------
/** The newest checkpoints stay in view; the rest fold behind one control. */
const CKPT_SHOWN = 4;
let ckptAll = false;
function syncCkptMore() {
  const list = $("ckpts"), more = $<HTMLButtonElement>("ckpt-more");
  const extra = list.querySelectorAll("li.extra").length;
  list.classList.toggle("folded", !ckptAll);
  more.hidden = extra === 0;
  more.textContent = ckptAll ? "Show the newest only" : `Show all ${extra + CKPT_SHOWN}`;
  more.setAttribute("aria-expanded", String(ckptAll));
}
$("ckpt-more").onclick = () => { ckptAll = !ckptAll; syncCkptMore(); };
$("btn-save").onclick = requestSave;
$("btn-export").onclick = () => send({ type: "export" });
$("btn-import").onclick = () => guardUnsaved($("guard-ckpt"), $("btn-import"), "open", "The world in the file replaces it.", () => $<HTMLInputElement>("import").click());
$<HTMLInputElement>("import").onchange = async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  const bytes = await f.arrayBuffer();
  send({ type: "import", bytes, name: f.name }, [bytes]);
  (e.target as HTMLInputElement).value = "";
};
$("btn-verify").onclick = () => {
  verifying = true;
  $<HTMLButtonElement>("btn-verify").disabled = true;
  verified = null;
  touchedWhileVerifying = false;
  askedToAdvance();
  $("verification-status").textContent = "Checking";
  $("verification-status").className = "badge busy";
  $("verify-out").textContent = `Replaying ${t(lastStep)} to ${t(lastStep + 200)} twice…`;
  setStrip("run-replay", "checking", "busy");
  send({ type: "verify", steps: 200 });
};
/** A line of the run strip beside the world's name, with its state when it has one. */
function setStrip(id: string, text: string, state = "") {
  const e = $(id);
  e.textContent = text;
  e.dataset.state = state;
}
/**
 * The replay verdict with its scope. It stays true of the segment it covered; once the world has moved past that
 * segment, or was changed by hand at its end, the badge stops reading as a statement about the present.
 */
function showVerification() {
  const v = verified;
  if (!v) return;
  const range = `${t(v.from)} to ${v.to.toLocaleString()}`;
  const past = lastStep !== v.to || v.touched;
  const badge = $("verification-status");
  badge.textContent = !v.ok ? "Diverged" : past ? "Earlier segment" : "Identical";
  badge.className = `badge ${!v.ok ? "bad" : past ? "note" : "ok"}`;
  const scope = !past ? "" : v.touched && lastStep === v.to ? ` The world was changed by hand at ${t(v.to)} after this check.` : ` The world is now at ${t(lastStep)}; steps after ${t(v.to)} are not covered.`;
  $("verify-out").textContent = v.ok
    ? `Steps ${range}: live ${v.live} = replay ${v.twin}. The same bits, both times.${scope}`
    : `Steps ${range}: live ${v.live} ≠ replay ${v.twin}. The two runs disagree. Download this world to keep the diverging state, then run the self-test below on this device.${scope}`;
  setStrip("run-replay", `${!v.ok ? "diverged" : past ? "earlier segment" : "identical"}, ${range}`, !v.ok ? "bad" : past ? "" : "ok");
}

// ---------- stats rendering ----------
const spInd = new Series($<HTMLCanvasElement>("sp-ind"));
const spBio = new Series($<HTMLCanvasElement>("sp-bio"));
const spLin = new Series($<HTMLCanvasElement>("sp-lin"));
window.addEventListener("browser-life-theme-change", () => { spInd.redraw(); spBio.redraw(); spLin.redraw(); });

function resetEvidence() {
  for (const id of ["k-matter", "k-fed", "k-resid", "k-light", "k-heat", "k-ind", "k-mass", "k-lin", "k-mut", "k-fis", "k-bd", "k-gen"])
    $(id).textContent = "";
  $("ledger-badge").textContent = "waiting";
  $("ledger-badge").className = "badge";
  $("verification-status").textContent = "Not checked";
  $("verification-status").className = "badge";
  $("verify-out").textContent = "";
  verified = null;
  setStrip("run-ledger", "waiting");
  setStrip("run-replay", "not checked");
  probed = null;
  placeProbeMarker();
  $("probe-empty").hidden = false;
  $("probe").hidden = true;
  $("top-lin").replaceChildren();
  $("pools").replaceChildren();
  spInd.clear(); spBio.clear(); spLin.clear();
  verifying = false;
}

function onStats(s: StatsMsg) {
  const moved = s.step !== lastStep;
  lastStep = s.step;
  if (advanceAsked !== null && s.step !== advanceAsked) advanceAsked = null;
  if (moved) showVerification();
  $("chip-step").textContent = `t = ${s.step.toLocaleString()}`;
  $("chip-rate").textContent = `${fmt(s.stepsPerSec)} steps/s · ${Math.round(s.fps)} fps`;
  $("k-matter").textContent = s.matterDelta;
  $("k-resid").textContent = s.residual;
  $("k-light").textContent = fmt(s.lightIn);
  $("k-heat").textContent = fmt(s.heatOut);
  // A fed world is exact against a baseline that moved: say so, in words, beside the amount.
  $("k-fed").textContent = s.feeds === 0 ? "none" : `${Number(s.fed) > 0 ? "+" : ""}${Number(s.fed).toLocaleString()} in ${s.feeds} feed${s.feeds === 1 ? "" : "s"}`;
  const ok = s.residual === "0" && s.matterDelta === "0";
  const badge = $("ledger-badge");
  // Sealed: nothing in or out and no energy unaccounted for, to the last quantum. A fed jar was opened by hand, and
  // everything that came through is accounted for; that is a different statement, so it gets different words.
  badge.textContent = ok ? (s.feeds === 0 ? "sealed" : "fed by hand, all accounted") : "broken";
  // Sealed against a baseline that feeds have moved is true, but it is not the closed-world result: no success colour.
  badge.className = `badge ${!ok ? "bad" : s.feeds === 0 ? "ok" : "note"}`;
  setStrip("run-ledger", badge.textContent, !ok ? "bad" : s.feeds === 0 ? "ok" : "");
  const pools: [string, number, string][] = [
    ["A nutrient", s.A, "var(--nutrient)"],
    ["B biomass", s.B, "var(--biomass)"],
    ["P membrane", s.P, "var(--membrane)"],
    ["C waste", s.C, "var(--waste)"],
  ];
  const bars = $("pools");
  bars.replaceChildren(
    ...pools.map(([name, v, c]) => {
      const e = document.createElement("span");
      e.style.width = `${(100 * v) / Math.max(1, s.matter)}%`;
      e.style.background = c;
      e.title = `${name}: ${fmt(v)} (${((100 * v) / Math.max(1, s.matter)).toFixed(1)}%)`;
      return e;
    }),
  );
  spBio.push(s.B + s.P);
}

function onCensus(c: CensusMsg) {
  $("k-ind").textContent = String(c.individuals);
  $("k-mass").textContent = fmt(c.meanMass);
  $("k-lin").textContent = String(c.lineageCount);
  $("k-mut").textContent = String(c.mutations);
  $("k-fis").textContent = `${c.fissions} / ${c.fusions}`;
  $("k-bd").textContent = `${c.births} / ${c.deaths}`;
  $("k-gen").textContent = String(c.maxGen);
  spInd.push(c.individuals);
  spLin.push(c.lineageCount);
  $("top-lin").replaceChildren(
    ...c.top.map((l) => {
      const row = document.createElement("div");
      const [r, g, b] = l.color.map((v) => Math.round(Math.min(1, v) * 255));
      const col = `rgb(${r} ${g} ${b})`;
      const sw = document.createElement("i");
      sw.style.background = col;
      const bar = document.createElement("span");
      bar.className = "bar";
      const fill = document.createElement("b");
      fill.style.width = `${(l.share * 100).toFixed(1)}%`;
      fill.style.background = col;
      bar.append(fill);
      const pct = document.createElement("span");
      pct.className = "mono";
      pct.textContent = `${(l.share * 100).toFixed(1)}%`;
      row.append(sw, bar, pct);
      row.title = `lineage ${l.key}`;
      return row;
    }),
  );
  if (c.top.length === 0) $("top-lin").textContent = "No lineages counted at this census.";
}

/** What each cell channel holds, beside its letter in the rules. */
const CHANNEL_LABELS: Record<string, string> = {
  A: "Nutrient (A)", B: "Biomass (B)", C: "Waste (C)", P: "Membrane (P)", E: "Free energy (E)", S: "Signal (S)", MOT: "Motility x, y",
};
function onProbe(p: ProbeMsg) {
  $("probe-empty").hidden = true;
  $("probe").hidden = false;
  probed = { x: p.x, y: p.y };
  placeProbeMarker();
  const pond = pondAt(p.x, p.y);
  const rows: [string, string][] = [
    ["Cell", `(${p.x}, ${p.y}) at ${t(p.step)}`],
    ...(pond === null ? [] : [["Pond", String(pond)] as [string, string]]),
    ...Object.entries(p.cells).map(([k, v]) => [CHANNEL_LABELS[k] ?? k, k === "MOT" ? `${(v & 255) - 128}, ${((v >> 8) & 255) - 128}` : String(v)] as [string, string]),
    ["Lineage", p.lineage || "none"],
    ["Growth μ / σ", p.lineage ? `${(p.mu / 1024).toFixed(3)} / ${(p.sigma / 1024).toFixed(3)}` : "none"],
    ["Motility gain", p.lineage ? String(p.motGain) : "none"],
    // Heritable kernel shape: weights of the inner, outer and far ring (neutral 64 / 64 / 0), shown once a genome leaves neutral.
    ...(p.lineage && p.rings ? [["Ring weights", `${Math.max(64 + p.rings[0], 0)} / ${Math.max(64 + p.rings[1], 0)} / ${Math.max(p.rings[2], 0)}`] as [string, string]] : []),
  ];
  $("probe-kv").replaceChildren(
    ...rows.flatMap(([k, v]) => {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = v;
      return [dt, dd];
    }),
  );
  const cv = $<HTMLCanvasElement>("probe-weights");
  cv.width = NN_BYTES / 4;
  cv.height = 4;
  const ctx = cv.getContext("2d")!;
  const img = ctx.createImageData(cv.width, cv.height);
  for (let b = 0; b < NN_BYTES; b++) {
    const v = p.lineage ? p.weights[b] / 127 : 0;
    const px = (b % cv.width) + Math.floor(b / cv.width) * cv.width;
    img.data[px * 4] = v < 0 ? 255 * -v : 0;
    img.data[px * 4 + 1] = 40;
    img.data[px * 4 + 2] = v > 0 ? 255 * v : 0;
    img.data[px * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  cv.title = `Controller weights: ${NN_I}→${NN_H}→${NN_O} (red negative, blue positive)`;
  const inspect = $<HTMLButtonElement>("btn-lineage");
  // The key travels with the button: a later probe of an empty cell hides it rather than retargeting a click.
  inspect.hidden = !p.lineage;
  inspect.dataset.key = p.lineage;
  inspect.onclick = () => inspect.dataset.key && lineagePanel.open(inspect.dataset.key);
}

// ---------- pond cycle ----------
/** The cycle status line: shown only for pond worlds, and fed only by the worker's display-only `ponds` message. */
function resetPondStatus() {
  const line = $("pond-status");
  line.hidden = !cfg || cfg.pondPeriod === undefined;
  $("history-cycles").hidden = line.hidden;
  line.textContent = cfg?.pondPeriod === undefined ? "" : `${cfg.pondArm} · cycle every ${cfg.pondPeriod.toLocaleString()} steps`;
  line.title = "";
}
function onPonds(m: PondsMsg) {
  const line = $("pond-status");
  line.hidden = false;
  line.textContent = `cycle ${m.cycle} · ${m.hand ? "by hand" : m.arm} · donor ponds ${m.donors.length ? m.donors.join(", ") : "none"}`;
  // The line can clip a long donor list (up to 16 on the 8 × 8 preset); the tooltip always holds it in full.
  line.title = `Pond cycle ${m.cycle} at t=${m.step.toLocaleString()} · donor ponds ${m.donors.length ? m.donors.join(", ") : "none"}${m.hand && pickedBy ? ` · picked by hand, viewing ranks by ${pickedBy}` : ""}`;
  // A cycle clears every pond: the histories mark where, so the drop that follows reads as the cycle, not a collapse.
  spInd.mark(); spBio.mark(); spLin.mark();
  // The cycle that was waiting has been applied.
  if (awaiting && awaiting.step === m.step) {
    // Breed and the bar it lived in are gone: the focus goes to Play, the next thing to do, rather than to the page.
    const hadFocus = $("breed-bar").contains(document.activeElement);
    const view = viewBeforePick;
    endAwait();
    // Only onto the world it came from: with a new world loading (cfg is null) the view is left as the worker has it.
    if (view && cfg) { rect = view; fit(false); }
    if (hadFocus || document.activeElement === document.body) $("btn-play").focus();
    toast(`Cycle ${m.cycle} applied: ${m.donors.length} donor pond${m.donors.length === 1 ? "" : "s"} (${m.donors.join(", ")})`);
    // The status keeps the news until the next action, rather than only a toast that fades.
    if (!playing) setStatus(`Cycle ${m.cycle} applied. Paused`, "ready");
  }
  pickedBy = null;
}

// ---------- breeder: choosing the donors of a pond cycle by hand ----------
/** What a pond is ranked by while picking: a term, or the world's own score ("score") when it has one. */
type RankKey = PondTerm | "speed" | "score";
const RANK_LABELS: Record<RankKey, string> = {
  score: "This world's score",
  speed: "Speed",
  drive: "Moving mass",
  seed: "Seed packet",
  body: "Body size",
  mass: "Bound mass",
  reach: "Reach to the edge",
};
/** The world's own score, in the measures' names: "drive+seed+body" reads as "Moving mass, seed packet, body size". */
const scoreLabel = (score: string) => `This world's score: ${pondScoreTerms(score).map((k, i) => (i ? RANK_LABELS[k].toLowerCase() : RANK_LABELS[k])).join(", ")}`;
let awaiting: PondAwaitMsg | null = null;
/** The ranking on screen when Breed was pressed: shown with the cycle it applies to. Display only; the log holds the donors. */
let pickedBy: string | null = null;
/** Breed was pressed and the worker has not yet applied the cycle (or refused it): the step it was pressed for. */
let breeding: number | null = null;
let breedSlowTimer = 0;
let picks: number[] = [];
/** The ranking last chosen; until one is, the world's own score when it has one, else speed. */
let rankKey: RankKey | null = null;
let toolBeforePick: Tool = "inspect";
/** The view before a cycle began waiting: picking fits the whole world, and the view returns once the cycle is applied. */
let viewBeforePick: typeof rect | null = null;
/** Breed has been pressed and the cycle is taking longer than it should: the bar says so until it resolves. */
let breedSlow = false;
const overlay = $<HTMLCanvasElement>("pond-overlay");
const breederOn = $<HTMLInputElement>("breeder-on");
const termSel = $<HTMLSelectElement>("breeder-term");

/** The lab can let a person choose donors for the arms whose cycle chooses them. */
const takesDonors = (c: WorldConfig | null) => !!c && c.pondPeriod !== undefined && (c.pondArm === "scaf" || c.pondArm === "rand" || c.pondArm === "breed");

/** Each pond's value of `key` at the waiting boundary. Speed is the motility term per unit of bound mass, in cells per 1,000 steps. */
function rankValues(a: PondAwaitMsg, key: RankKey): number[] {
  if (key === "score") return a.score === null ? a.terms.mass : (() => { const t = pondScoreTerms(a.score).map((term) => a.terms[term]); return t.length === 1 ? t[0] : worstRanks(t); })();
  if (key === "speed") return a.terms.drive.map((d, p) => (a.terms.mass[p] > 0 ? ((d / a.terms.mass[p]) * 1000) / 64 : 0));
  return a.terms[key];
}
/** Occupied ponds from the best value of `key` down; equal values by bound mass, then by index. */
function rankOrder(a: PondAwaitMsg, key: RankKey): number[] {
  const v = rankValues(a, key), mass = a.terms.mass;
  return mass.map((_, p) => p).filter((p) => mass[p] > 0).sort((x, y) => v[y] - v[x] || mass[y] - mass[x] || x - y);
}
const showValue = (key: RankKey, v: number) => (key === "body" ? (v / 256).toFixed(1) : key === "speed" ? v.toFixed(1) : fmt(v));
/** The hover line's account of a pond while a cycle waits. */
function pondReadout(pond: number): string {
  const a = awaiting;
  if (!a) return "";
  if (a.terms.mass[pond] === 0) return " · empty";
  return ` · speed ${showValue("speed", rankValues(a, "speed")[pond])} · seed ${fmt(a.terms.seed[pond])} · body ${showValue("body", a.terms.body[pond])} · mass ${fmt(a.terms.mass[pond])}`;
}

function resetBreeder() {
  $("breeder").hidden = !takesDonors(cfg);
  endAwait();
}
function onPondAwait(m: PondAwaitMsg) {
  awaiting = m;
  picks = m.suggested.slice();
  const keys: RankKey[] = [...(m.score === null ? [] : ["score" as const]), "speed", "seed", "body", "mass", "drive", "reach"];
  if (rankKey === null || !keys.includes(rankKey)) rankKey = keys[0];
  termSel.replaceChildren(...keys.map((k) => new Option(k === "score" ? scoreLabel(m.score!) : RANK_LABELS[k], k, false, k === rankKey)));
  $("breeder-pick").hidden = false;
  $("breeder-hint").hidden = true;
  $("breed-bar").hidden = false;
  document.body.classList.add("breeding");
  syncPlayLabel();
  overlay.hidden = false;
  const pickTool = tools.querySelector<HTMLButtonElement>('button[data-tool="pick"]')!;
  pickTool.hidden = false;
  // Said, not shown: a toast would sit over the pond labels on a phone, and the Pick tool and the bar already show it.
  if (tool !== "pick") {
    toolBeforePick = tool;
    $("keyboard-position").textContent = `Cycle ${m.cycle} is waiting. The Pick tool is selected: select ponds on the field to choose donors.`;
  }
  setTool("pick");
  // The whole world in view, once: each pond appears once to pick, and the repeats around it are dimmed.
  if (!viewBeforePick) { viewBeforePick = { ...rect }; fit(true); }
  showRunStatus();
  syncWaitingControls();
  syncPicks();
}
/**
 * A waiting cycle holds a pre-cycle world, which cannot be saved, exported or verified, and does not step: those
 * wait for the pick. Each says so beside it rather than going quiet.
 */
function syncWaitingControls() {
  const waiting = awaiting !== null;
  for (const id of ["btn-save", "btn-export", "btn-verify", "btn-step", "btn-step100"]) {
    const b = $<HTMLButtonElement>(id);
    b.disabled = !worldReady || waiting || (id === "btn-verify" && verifying);
    if (id.startsWith("btn-step")) {
      b.title = waiting ? "The world waits for this cycle's donors: breed first" : id === "btn-step" ? "One step (.)" : "100 steps";
      if (waiting) b.setAttribute("aria-describedby", "breed-bar-wait");
      else b.removeAttribute("aria-describedby");
    }
  }
  $("ckpt-wait").hidden = !waiting;
  $("verify-wait").hidden = !waiting;
}
function endAwait() {
  const was = awaiting !== null;
  awaiting = null;
  picks = [];
  viewBeforePick = null;
  if (!$("guard-breed").hidden) closeQuestion?.();
  $("breeder-pick").hidden = true;
  $("breeder-hint").hidden = false;
  $("breed-bar").hidden = true;
  document.body.classList.remove("breeding");
  endBreeding();
  overlay.hidden = true;
  tools.querySelector<HTMLButtonElement>('button[data-tool="pick"]')!.hidden = true;
  if (tool === "pick") setTool(toolBeforePick);
  syncPlayLabel();
  if (was && worldReady) showRunStatus();
  if (was) syncWaitingControls();
}
/** A pick on the field: only on the world itself, not on the dimmed repeats around it. */
function pickAt(x: number, y: number) {
  if (!awaiting || !cfg || x < 0 || y < 0 || x >= worldW(cfg) || y >= worldH(cfg)) return;
  togglePick(pondAt(x, y));
}
function togglePick(pond: number | null) {
  const a = awaiting;
  if (!a || pond === null || breeding !== null) return;
  if (a.terms.mass[pond] === 0) return toast(`Pond ${pond} is empty: it has nothing to seed a pond with`);
  closeBreedQuestion();
  const at = picks.indexOf(pond);
  if (at >= 0) picks.splice(at, 1);
  else picks.push(pond);
  syncPicks();
  // The overlay is a picture: say what changed, in the same terms.
  const r = rankOrder(a, rankKey ?? "speed").indexOf(pond) + 1;
  $("keyboard-position").textContent = at >= 0 ? `Pond ${pond} removed. ${picks.length} picked.` : `Pond ${pond} picked, number ${picks.length} in the order. Rank ${r} by ${RANK_LABELS[rankKey ?? "speed"].toLowerCase()}.`;
}
/** The panel and the overlay after the picks, the ranking or the waiting cycle changed. */
function syncPicks() {
  const a = awaiting;
  if (!a) return;
  const occupied = a.terms.mass.filter((m) => m > 0).length;
  const key = rankKey ?? "speed";
  $("breeder-call").textContent = `Cycle ${a.cycle} at t=${a.step.toLocaleString()} is waiting. ${occupied} of ${a.terms.mass.length} ponds are occupied.`;
  // Say what Breed will do before it is pressed: it cannot be undone. While it is in flight, say that instead.
  $("breed-bar-call").textContent = breeding !== null
    ? breedSlow ? `Still applying cycle ${a.cycle}. The lab is waiting for the GPU; a failure will show on the field.` : `Applying cycle ${a.cycle}.`
    : picks.length === 0
      ? `Cycle ${a.cycle} waits for its donors. Select ponds on the field.`
      : `Cycle ${a.cycle}: Breed clears all ${a.terms.mass.length} ponds and reseeds them from pond${picks.length === 1 ? "" : "s"} ${picks.join(", ")}, in that order.`;
  const go = $<HTMLButtonElement>("breeder-go");
  if (breeding === null) {
    go.disabled = picks.length === 0;
    go.textContent = picks.length === 0 ? "Pick at least one pond" : `Breed from ${picks.length} pond${picks.length === 1 ? "" : "s"}`;
  }
  // The pick controls are locked while Breed is in flight, and say so by being disabled rather than ignoring a press.
  for (const id of ["breeder-top", "breeder-rule", "breeder-clear"]) $<HTMLButtonElement>(id).disabled = breeding !== null;
  $("breeder-top").textContent = `Top ${topCount(a)} by ${key === "score" ? "score" : RANK_LABELS[key].toLowerCase()}`;
  // Pond number first, as on the field and in the run strip; then its rank and value by the measure on screen.
  const rank = new Map(rankOrder(a, key).map((p, j) => [p, j + 1]));
  const values = rankValues(a, key);
  $("breeder-list").replaceChildren(...picks.map((p) => {
    const li = document.createElement("li");
    li.textContent = `${p} #${rank.get(p)} · ${showValue(key, values[p])}`;
    li.setAttribute("aria-label", `Pond ${p}, rank ${rank.get(p)}, ${RANK_LABELS[key].toLowerCase()} ${showValue(key, values[p])}`);
    return li;
  }));
  drawPondOverlay();
}
termSel.onchange = () => { rankKey = termSel.value as RankKey; syncPicks(); };
$("breeder-top").onclick = () => {
  if (!awaiting || breeding !== null) return;
  picks = rankOrder(awaiting, rankKey ?? "speed").slice(0, topCount(awaiting));
  syncPicks();
};
/** A quarter of the ponds, at least one. */
function topCount(a: PondAwaitMsg) { return Math.max(1, Math.floor(a.terms.mass.length / 4)); }
/** Breed is no longer in flight: applied, refused, or the world failed. */
function endBreeding() {
  clearTimeout(breedSlowTimer);
  breedSlow = false;
  if (breeding === null) return;
  breeding = null;
  $("breed-bar").removeAttribute("aria-busy");
  syncPicks();
}
$("breeder-rule").onclick = () => { if (awaiting && breeding === null) { picks = awaiting.suggested.slice(); syncPicks(); } };
$("breeder-clear").onclick = () => { if (breeding === null) { picks = []; syncPicks(); } };
/** Picks changed while Breed's question was open: the question no longer describes them. */
const closeBreedQuestion = () => { if (!$("guard-breed").hidden) closeQuestion?.(); };
for (const id of ["breeder-top", "breeder-rule", "breeder-clear"]) $(id).addEventListener("click", closeBreedQuestion);
termSel.addEventListener("change", closeBreedQuestion);
// Breed cannot be undone: it asks once, in place, naming the donors it will use.
$("breeder-go").onclick = () => {
  const a = awaiting;
  if (!a || !picks.length || breeding !== null) return;
  const donors = picks.slice();
  ask($("guard-breed"), $("breeder-go"), `Replace all ${a.terms.mass.length} ponds with seed from pond${donors.length === 1 ? "" : "s"} ${donors.join(", ")}? This cannot be undone.`, [[`Breed from ${donors.length} pond${donors.length === 1 ? "" : "s"}`, () => breed(donors)]], "Keep picking");
};
function breed(donors: number[]) {
  if (!awaiting || breeding !== null || donors.join() !== picks.join()) return;
  send({ type: "pick", world: awaiting.world, step: awaiting.step, donors });
  pickedBy = (rankKey ?? "speed") === "score" ? "this world's score" : RANK_LABELS[rankKey ?? "speed"].toLowerCase();
  // One message per cycle: the panel closes when the worker reports the cycle applied, or comes back if it refuses.
  breeding = awaiting.step;
  const go = $<HTMLButtonElement>("breeder-go");
  go.disabled = true;
  go.textContent = "Breeding…";
  $("breed-bar").setAttribute("aria-busy", "true");
  syncPicks();
  breedSlowTimer = window.setTimeout(() => {
    if (breeding === null) return;
    breedSlow = true;
    syncPicks();
    // The bar is busy, so it is not announced: the live region says it.
    $("keyboard-position").textContent = $("breed-bar-call").textContent ?? "";
  }, 5000);
}
breederOn.onchange = () => send({ type: "breeder", on: breederOn.checked });

/**
 * The pond grid over the field while a cycle waits: each pond's number and its rank by the chosen measure, empty
 * ponds dimmed, picked ponds outlined with their place in the order. The world
 * itself takes the picks; the repeats of it around the view are dimmed and unlabelled. Picks are marked by weight and shape in the field's own ink, never a hue:
 * colour on the field belongs to the pools.
 */
function drawPondOverlay() {
  const a = awaiting;
  if (!a || !cfg || overlay.hidden) return;
  const box = wrap.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(box.width * dpr)), h = Math.max(1, Math.round(box.height * dpr));
  if (overlay.width !== w || overlay.height !== h) { overlay.width = w; overlay.height = h; }
  const g = overlay.getContext("2d")!;
  g.clearRect(0, 0, w, h);
  const css = getComputedStyle(wrap);
  const ink = css.getPropertyValue("--field-ink").trim(), ground = css.getPropertyValue("--field").trim();
  const W = worldW(cfg), H = worldH(cfg);
  const sx = w / rect.w, sy = h / rect.h;
  const rank = new Map(rankOrder(a, rankKey ?? "speed").map((p, j) => [p, j + 1]));
  // Sizes in CSS pixels, scaled to the canvas: labels never drop below the lab's 11px floor; ponds too small to carry one go unlabelled (the hover line names them).
  const sideCss = (cfg.tileW * sx) / dpr;
  const fontCss = Math.min(14, Math.max(11, sideCss / 6));
  const labelled = sideCss >= 46;
  const font = fontCss * dpr, pad = 3 * dpr, gap = 4 * dpr;
  g.font = `600 ${font}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  g.textBaseline = "top";
  const tag = (text: string, x: number, y: number, fill: string, color: string) => {
    const tw = g.measureText(text).width + 2 * pad;
    g.fillStyle = fill;
    g.fillRect(x, y, tw, font + 2 * pad);
    g.fillStyle = color;
    g.fillText(text, x + pad, y + pad);
    return tw;
  };
  for (let ox = Math.floor(rect.x / W) * W; ox < rect.x + rect.w; ox += W)
    for (let oy = Math.floor(rect.y / H) * H; oy < rect.y + rect.h; oy += H)
      for (let p = 0; p < a.terms.mass.length; p++) {
        const tx = p % cfg.tilesX, ty = (p - tx) / cfg.tilesX;
        const x = (ox + tx * cfg.tileW - rect.x) * sx, y = (oy + ty * cfg.tileH - rect.y) * sy, pw = cfg.tileW * sx, ph = cfg.tileH * sy;
        if (x + pw < 0 || y + ph < 0 || x > w || y > h) continue;
        // A repeat of the world around the one in the middle: dimmed and unlabelled, since only the world itself takes picks.
        if (ox !== 0 || oy !== 0) {
          g.fillStyle = ground;
          g.globalAlpha = 0.72;
          g.fillRect(x, y, pw, ph);
          g.globalAlpha = 1;
          continue;
        }
        const order = picks.indexOf(p);
        g.globalAlpha = 1;
        if (a.terms.mass[p] === 0) {
          g.fillStyle = ground;
          g.globalAlpha = 0.6;
          g.fillRect(x, y, pw, ph);
          g.globalAlpha = 1;
        }
        if (order >= 0) {
          // A dark halo under a heavy ink outline holds against any pool colour beneath it.
          g.strokeStyle = ground;
          g.lineWidth = 5 * dpr;
          g.strokeRect(x + 2.5 * dpr, y + 2.5 * dpr, pw - 5 * dpr, ph - 5 * dpr);
          g.strokeStyle = ink;
          g.lineWidth = 2.5 * dpr;
          g.strokeRect(x + 2.5 * dpr, y + 2.5 * dpr, pw - 5 * dpr, ph - 5 * dpr);
        } else {
          g.strokeStyle = ink;
          g.globalAlpha = 0.28;
          g.lineWidth = 1;
          g.strokeRect(x + 0.5, y + 0.5, pw - 1, ph - 1);
          g.globalAlpha = 1;
        }
        if (!labelled) continue;
        const r = rank.get(p);
        // Number first, then rank: the same reading as the picked list and the run strip.
        // The rank drops off a pond too narrow to hold it beside the number; the list and the hover line still give it.
        const full = r === undefined ? `${p}` : `${p} #${r}`;
        const fits = g.measureText(full).width + 2 * pad + 2 * gap + 4 * dpr <= pw;
        const nw = tag(fits ? full : `${p}`, x + gap + 2 * dpr, y + gap + 2 * dpr, ground, ink);
        if (order >= 0) {
          // The pick order goes top right when both tags fit on one row, under the number otherwise.
          const label = `${order + 1}`;
          const lw = g.measureText(label).width + 2 * pad;
          const oneRow = nw + lw + 3 * gap + 4 * dpr <= pw;
          tag(label, oneRow ? x + pw - lw - gap - 2 * dpr : x + gap + 2 * dpr, oneRow ? y + gap + 2 * dpr : y + 2 * gap + 2 * dpr + font + 2 * pad, ink, ground);
        }
      }
}

let toastTimer = 0;
function toast(msg: string, bad = false) {
  const el = $("toast");
  el.textContent = msg;
  el.className = `toast show${bad ? " bad" : ""}`;
  clearTimeout(toastTimer);
  // Long enough to read: three seconds, and more for a long message such as a checkpoint's file name.
  toastTimer = window.setTimeout(() => (el.className = "toast"), Math.max(bad ? 8000 : 3000, msg.length * 70));
}

/** A failure, kept on the field until dismissed or until a world loads. Without a world there is nothing to dismiss to. */
function showAlert(message: string) {
  const noWorld = cfg === null && !loadingWorld;
  $("stage-alert-title").textContent = !noWorld ? "This world has stopped" : gpuReady ? "The world could not be planted" : "The lab could not start";
  $("stage-alert-text").textContent = message;
  $("stage-alert-help").textContent = !noWorld
    ? "The world is paused. Your saved copies are still listed under Keep a copy."
    : gpuReady
      ? "Choose a starting world under Plant a world, or open a saved copy."
      : "The lab needs a browser with WebGPU. Check that hardware acceleration is on, then reload the page.";
  $("stage-alert-dismiss").hidden = noWorld;
  $("stage-alert").hidden = false;
  if (noWorld) {
    $("world-heading").textContent = "No world yet";
    $("run-id").textContent = "none";
    if (!gpuReady) $("chip-gpu").textContent = "No GPU adapter";
  }
}
$("stage-alert-dismiss").onclick = () => { $("stage-alert").hidden = true; canvas.focus(); };

worker.onmessage = (ev: MessageEvent<FromWorker>) => {
  const m = ev.data;
  switch (m.type) {
    case "ready":
      gpuReady = true;
      $("chip-gpu").textContent = m.adapter;
      $("chip-gpu").title = m.adapter;
      loadingWorld = true;
      $<HTMLButtonElement>("btn-new").disabled = true;
      setStatus(`Planting ${presetName(presetSel.value)}…`, "loading");
      send({ type: "load", presetId: presetSel.value, seed: Number($<HTMLInputElement>("seed").value) || 0 });
      send({ type: "listCheckpoints" });
      break;
    case "loaded":
      loadingWorld = false;
      cfg = m.manifest.cfg;
      setWorldControls(true);
      $<HTMLButtonElement>("btn-new").disabled = false;
      runId = m.manifest.runId;
      loadedStep = cleanStep = lastStep = m.step;
      touched = false;
      cleanFile = null;
      advanceAsked = null;
      afterSave = null;
      savesAsked.length = 0;
      closeQuestion?.();
      $("stage-alert").hidden = true;
      $("world-heading").textContent = PRESETS.find((p) => p.id === m.manifest.presetId)?.name ?? "Opened world";
      document.title = titleFor(m.manifest.presetId, $("world-heading").textContent);
      loadedPresetId = m.manifest.presetId;
      loadedSeed = m.manifest.seed;
      handHeld.clear();
      handAtLoad = savedChanges = changes;
      syncHand();
      syncPlant();
      $("run-id").textContent = $("run-id").title = runId;
      $("run-seed").textContent = String(m.manifest.seed);
      $("run-rules").textContent = `v${m.manifest.ruleVersion}`;
      $("chip-step").textContent = `t = ${m.step.toLocaleString()}`;
      // The worker always pauses a freshly loaded/restored world; keep our
      // own `playing` flag and the Pause/Play button in sync with that
      // (harmless no-op message if we were already paused).
      setPlaying(false);
      resetEvidence();
      resetPondStatus();
      resetBreeder();
      fit(true);
      lineagePanel.onLoaded();
      break;
    case "stats":
      onStats(m);
      break;
    case "census":
      onCensus(m);
      break;
    case "probe":
      onProbe(m);
      break;
    case "ponds":
      onPonds(m);
      break;
    case "pondAwait":
      onPondAwait(m);
      break;
    case "lineage":
      lineagePanel.onLineage(m);
      break;
    case "highlight":
      lineagePanel.onHighlight(m.key);
      break;
    case "checkpoints":
      // The list is the authority on what is saved: a deleted checkpoint lowers the baseline again.
      cleanStep = Math.max(loadedStep, ...m.list.filter((c) => c.runId === runId).map((c) => c.step));
      if (cleanFile && !m.list.some((c) => c.file === cleanFile)) { cleanFile = null; touched = true; }
      // A deleted copy no longer holds the changes it held: the strip's baseline falls back to the latest copy that survives.
      for (const file of handHeld.keys()) if (!m.list.some((c) => c.file === file)) handHeld.delete(file);
      savedChanges = Math.max(handAtLoad, ...handHeld.values());
      syncHand();
      $("checkpoint-empty").hidden = m.list.length > 0;
      // Redrawing the rows must not drop the keyboard's place in them.
      const rowHadFocus = $("ckpts").contains(document.activeElement);
      // A row reads by what it holds: the step, and whether it is this run's. The file name stays in the tooltip.
      $("ckpts").replaceChildren(
        ...m.list
          .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
          .map((c, i) => {
            const li = document.createElement("li");
            if (i >= CKPT_SHOWN) li.className = "extra";
            const name = document.createElement("span");
            name.textContent = `${t(c.step)}${c.runId === runId ? "" : " · other run"}${c.auto ? " · auto" : ""} · ${(c.bytes / 1e6).toFixed(1)} MB`;
            name.title = `${c.file} · ${(c.bytes / 1e6).toFixed(1)} MB · ${c.savedAt}`;
            const restore = document.createElement("button");
            restore.type = "button";
            restore.textContent = "Restore";
            restore.setAttribute("aria-label", `Restore ${c.file}`);
            restore.onclick = () => guardUnsaved($("guard-ckpt"), restore, "restore", `Restoring the copy from ${t(c.step)} replaces it.`, () => send({ type: "restore", file: c.file }));
            const del = document.createElement("button");
            del.type = "button";
            del.textContent = "Delete";
            del.setAttribute("aria-label", `Delete ${c.file}`);
            del.onclick = () => ask($("guard-ckpt"), del, `Delete the copy from ${t(c.step)} (${c.file})? A deleted copy cannot be brought back.`, [["Delete this copy", () => send({ type: "deleteCheckpoint", file: c.file })]], "Keep it");
            li.append(name, restore, del);
            return li;
          }),
      );
      syncCkptMore();
      if (rowHadFocus) ($("ckpts").querySelector<HTMLButtonElement>("button") ?? $("btn-import")).focus();
      break;
    case "saved": {
      // This page's own save, and only that: an automatic checkpoint never answers a save-first choice.
      const asked = savesAsked.shift();
      // It holds every change made before it was asked for; one made while it was in flight is still unsaved.
      if (asked === changes) { touched = false; cleanFile = m.file; }
      // The copy holds the changes made before it was asked for, whether or not more came while it was in flight.
      if (asked !== undefined) { handHeld.set(m.file, asked); savedChanges = Math.max(savedChanges, asked); syncHand(); }
      const next = afterSave;
      afterSave = null;
      next?.();
      break;
    }
    case "exported": {
      const url = URL.createObjectURL(new Blob([m.bytes], { type: "application/octet-stream" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = m.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      break;
    }
    case "notice":
      toast(m.message);
      break;
    case "refused":
      // The world is fine; a lineage inspection or a jump that was refused must not be waited for any longer.
      toast(m.message);
      if (m.request === "save") { savesAsked.shift(); afterSave = null; }
      if (m.request === "pick") endBreeding();
      if (m.request === "lineage" || m.request === "jump") lineagePanel.onError();
      if (m.request === "verify" && verifying) {
        // The check never ran: the button comes back and the panel says so (no earlier result survives, the click cleared it).
        verifying = false;
        syncWaitingControls();
        $("verification-status").textContent = "Not checked";
        $("verification-status").className = "badge";
        $("verify-out").textContent = m.message;
        setStrip("run-replay", "not checked");
      }
      break;
    case "verify":
      verifying = false;
      syncWaitingControls();
      verified = { ok: m.ok, from: m.from, to: m.from + m.steps, live: m.live, twin: m.twin, touched: touchedWhileVerifying };
      // The check ran the world to the end of its segment; the stats that follow will say the same step.
      lastStep = verified.to;
      showVerification();
      break;
    case "error":
      // The worker pauses itself on stepping and census failures; stay in sync.
      if (playing) setPlaying(false);
      if (loadingWorld) {
        // The worker builds a replacement first and keeps the current world when that fails: so does this page,
        // with whatever that world was waiting for (a pond cycle's donors) still on screen.
        loadingWorld = false;
        cfg = cfgBeforeLoad;
        setWorldControls(cfg !== null);
        syncWaitingControls();
        drawPondOverlay();
      }
      if (verifying) {
        verifying = false;
        syncWaitingControls();
        $("verification-status").textContent = "Couldn't check";
        $("verification-status").className = "badge bad";
        $("verify-out").textContent = m.message;
        setStrip("run-replay", "couldn't check", "bad");
      }
      endBreeding();
      // Whatever was in flight may not have happened: nothing waits on it, and no later save is taken for an earlier one.
      savesAsked.length = 0;
      afterSave = null;
      advanceAsked = null;
      $<HTMLButtonElement>("btn-new").disabled = false;
      setStatus(cfg ? "World stopped" : gpuReady ? "No world yet" : "Lab could not start", "error");
      lineagePanel.onError();
      showAlert(m.message);
      console.error(m.message);
      break;
  }
};

// ---------- boot ----------
if (!("transferControlToOffscreen" in canvas)) {
  setStatus("Lab could not start", "error");
  showAlert("This browser has no OffscreenCanvas.");
} else {
  const r = wrap.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const off = canvas.transferControlToOffscreen();
  send({ type: "init", canvas: off, width: Math.round(r.width * dpr), height: Math.round(r.height * dpr) }, [off]);
}
setMode("composite");
