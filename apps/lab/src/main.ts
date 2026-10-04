import { PRESETS, pondScoreTerms, worldH, worldW, worstRanks, NN_I, NN_H, NN_O, NN_BYTES, type PondTerm, type WorldConfig } from "@bl/schema";
import { VIEW_MODES, type GpuViewMode, type ViewRect } from "@bl/sim-gpu";
import type { CensusMsg, FromWorker, PondAwaitMsg, PondsMsg, ProbeMsg, StatsMsg, ToWorker } from "./protocol.ts";
import { Series } from "./sparkline.ts";
import { createLineagePanel } from "./lineage-panel.ts";
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
const savesAsked: number[] = [];
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

const VIEW_LABELS: Record<GpuViewMode, [string, string]> = {
  composite: ["Composite", "green biomass · white membrane · blue nutrient · brown waste"],
  lineage: ["Lineage", "colour = genome lineage, brightness = bound mass"],
  nutrient: ["Nutrient", "dissolved nutrient A"],
  waste: ["Waste", "dissolved waste C"],
  energy: ["Energy", "free-energy pool E carried with biomass"],
  signal: ["Signal", "secreted signal S"],
  affinity: ["Affinity", "Lenia growth field U: red attracts mass, blue repels"],
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
  }
  $("legend").textContent = VIEW_LABELS[m][1];
  pushView();
}

// ---------- presets ----------
const presetSel = $<HTMLSelectElement>("preset");
// Presets that share a family name ("Ownership: …", "Rotating planet (…)") are grouped under it; the rest lead the list.
{
  const family = (name: string) => name.split(/:| \(/)[0].trim();
  const size = new Map<string, number>();
  for (const p of PRESETS) size.set(family(p.name), (size.get(family(p.name)) ?? 0) + 1);
  const groups = new Map<string, HTMLOptGroupElement>();
  for (const p of PRESETS) {
    const f = (size.get(family(p.name)) ?? 0) >= 4 ? family(p.name) : "Starting worlds";
    let g = groups.get(f);
    if (!g) {
      g = document.createElement("optgroup");
      g.label = f;
      groups.set(f, g);
      presetSel.append(g);
    }
    g.append(new Option(p.name, p.id));
  }
}
const showPresetDesc = () => ($("preset-desc").textContent = PRESETS.find((p) => p.id === presetSel.value)?.description ?? "");
presetSel.onchange = showPresetDesc;
showPresetDesc();
/** Whether leaving this world now would lose steps or interventions that no checkpoint holds. */
const unsaved = () => worldReady && (lastStep > cleanStep || touched || advanceAsked !== null);
const unsavedText = () =>
  `This world is at ${t(lastStep)}. ${cleanStep > 0 ? `Its last checkpoint is at ${t(cleanStep)}; ${touched && lastStep <= cleanStep ? "changes made by hand since then" : "everything after that"} would be lost.` : "Nothing from this run is saved yet."}`;

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
    if (refocus) [opener, ...host.parentElement!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.isConnected && !(b as HTMLButtonElement).disabled && !b.hidden)?.focus();
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

$("btn-new").onclick = () => guardUnsaved($("guard-new"), $("btn-new"), "start", "A new world replaces it.", startWorld);
function startWorld() {
  setPlaying(false);
  setWorldControls(false);
  cfgBeforeLoad = cfg;
  cfg = null;
  loadingWorld = true;
  setStatus("Loading world", "loading");
  $<HTMLButtonElement>("btn-new").disabled = true;
  send({ type: "load", presetId: presetSel.value, seed: Number($<HTMLInputElement>("seed").value) || 0 });
}

// ---------- playback ----------
const SPEEDS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];
const speed = $<HTMLInputElement>("speed");
speed.oninput = () => {
  const v = SPEEDS[Number(speed.value)];
  $("speed-val").textContent = String(v);
  send({ type: "speed", stepsPerFrame: v });
};
function setPlaying(p: boolean) {
  playing = p;
  const b = $("btn-play");
  b.textContent = p ? "Pause" : "Play";
  b.setAttribute("aria-pressed", String(p));
  if (worldReady) setStatus(p ? "Running" : "Paused", p ? "running" : "ready");
  if (p) askedToAdvance();
  send({ type: "play", playing: p });
}
const stepBy = (count: number) => { askedToAdvance(); send({ type: "step", count }); };
$("btn-play").onclick = () => setPlaying(!playing);
$("btn-step").onclick = () => stepBy(1);
$("btn-step100").onclick = () => stepBy(100);

// ---------- tools ----------
const tools = $("tools");
function setTool(t: Tool) {
  tool = t;
  for (const o of tools.querySelectorAll<HTMLButtonElement>("button")) {
    const selected = o.dataset.tool === t;
    o.classList.toggle("on", selected);
    o.setAttribute("aria-pressed", String(selected));
  }
  wrap.dataset.tool = tool;
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
  if (verifying) touchedWhileVerifying = true;
  if (verified && !verified.touched) { verified.touched = true; showVerification(); }
  if (tool === "lesion") send({ type: "lesion", x, y, r: Number(radius.value) });
  else if (feeding()) send({ type: "feed", x, y, r: Number(radius.value), amount: (tool === "feed" ? 1 : -1) * Number(amount.value) });
}
radius.disabled = true;
tools.querySelector(".on")?.setAttribute("aria-pressed", "true");

// ---------- canvas geometry, zoom and pan ----------
function resize() {
  const r = wrap.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  send({ type: "resize", width: Math.round(r.width * dpr), height: Math.round(r.height * dpr) });
  fit(false);
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
    $("hover").textContent = `x ${Math.floor(x)}  y ${Math.floor(y)}${pond === null ? "" : ` · pond ${pond}`} · Enter to ${tool === "pan" ? "center" : tool}`;
    $("keyboard-position").textContent = `Column ${Math.floor(x)}, row ${Math.floor(y)}.${pond === null ? "" : ` Pond ${pond}.`} Enter to ${tool === "pan" ? "center" : tool}.`;
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
    else if (brush()) applyBrush(x, y);
    else if (tool === "pick") togglePick(pondAt(x, y));
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
    lesionAt(ev);
  } else if (tool === "pick") {
    const [x, y] = toWorld(ev);
    togglePick(pondAt(x, y));
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
    $("hover").textContent = `x ${(((Math.floor(x) % W) + W) % W)}  y ${(((Math.floor(y) % H) + H) % H)}  · zoom ${(worldW(cfg) / rect.w).toFixed(2)}×${pond === null ? "" : ` · pond ${pond}${pondReadout(pond)}`}`;
  }
  if (drag) {
    const r = canvas.getBoundingClientRect();
    rect.x = drag.rx - ((ev.clientX - drag.x) / r.width) * rect.w;
    rect.y = drag.ry - ((ev.clientY - drag.y) / r.height) * rect.h;
    pushView();
  } else if (lesionDrag) lesionAt(ev);
};
canvas.onpointerup = () => {
  drag = null;
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
  // Leave focused controls and links to their native keyboard behavior.
  if (e.target !== document.body && e.target !== canvas) return;
  if (e.key === " ") {
    if (!worldReady) return;
    e.preventDefault();
    setPlaying(!playing);
  } else if (e.key === "." && worldReady) stepBy(1);
  else if (/^[1-7]$/.test(e.key)) setMode(VIEW_MODES[Number(e.key) - 1]);
});

// ---------- checkpoints ----------
$("btn-save").onclick = requestSave;
$("btn-export").onclick = () => send({ type: "export" });
$("btn-import").onclick = () => guardUnsaved($("guard-ckpt"), $("btn-import"), "import", "An imported world replaces it.", () => $<HTMLInputElement>("import").click());
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
  $("verify-out").textContent = `Running ${t(lastStep)} to ${t(lastStep + 200)} twice…`;
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
    ? `Steps ${range}: live ${v.live} = replay ${v.twin}.${scope}`
    : `Steps ${range}: live ${v.live} ≠ replay ${v.twin}. Export this world to keep the diverging state, then run the self-test below on this device.${scope}`;
  setStrip("run-replay", `${!v.ok ? "diverged" : past ? "earlier segment" : "identical"}, ${range}`, !v.ok ? "bad" : past ? "" : "ok");
}

// ---------- stats rendering ----------
const spInd = new Series($<HTMLCanvasElement>("sp-ind"));
const spBio = new Series($<HTMLCanvasElement>("sp-bio"));
const spLin = new Series($<HTMLCanvasElement>("sp-lin"));
window.addEventListener("browser-life-theme-change", () => { spInd.redraw(); spBio.redraw(); spLin.redraw(); });

function resetEvidence() {
  for (const id of ["k-matter", "k-fed", "k-resid", "k-light", "k-heat", "k-ind", "k-mass", "k-lin", "k-mut", "k-fis", "k-bd", "k-gen"])
    $(id).textContent = "—";
  $("ledger-badge").textContent = "waiting";
  $("ledger-badge").className = "badge";
  $("verification-status").textContent = "Not run";
  $("verification-status").className = "badge";
  $("verify-out").textContent = "";
  verified = null;
  setStrip("run-ledger", "waiting");
  setStrip("run-replay", "not run");
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
  badge.textContent = ok ? (s.feeds === 0 ? "exact" : "exact, fed") : "violation";
  // Exact against a baseline that feeds have moved is true, but it is not the closed-world result: no success colour.
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
  if (c.top.length === 0) $("top-lin").textContent = "No lineages detected at this census.";
}

/** What each cell channel holds, beside its letter in the rules. */
const CHANNEL_LABELS: Record<string, string> = {
  A: "A · nutrient", B: "B · biomass", C: "C · waste", P: "P · membrane", E: "E · free energy", S: "S · signal", MOT: "MOT · motility x, y",
};
function onProbe(p: ProbeMsg) {
  $("probe-empty").hidden = true;
  $("probe").hidden = false;
  probed = { x: p.x, y: p.y };
  placeProbeMarker();
  const pond = pondAt(p.x, p.y);
  const rows: [string, string][] = [
    ["cell", `(${p.x}, ${p.y}) at ${t(p.step)}`],
    ...(pond === null ? [] : [["pond", String(pond)] as [string, string]]),
    ...Object.entries(p.cells).map(([k, v]) => [CHANNEL_LABELS[k] ?? k, k === "MOT" ? `${(v & 255) - 128}, ${((v >> 8) & 255) - 128}` : String(v)] as [string, string]),
    ["lineage", p.lineage || "none"],
    ["μ / σ", p.lineage ? `${(p.mu / 1024).toFixed(3)} / ${(p.sigma / 1024).toFixed(3)}` : "—"],
    ["motility gain", p.lineage ? String(p.motGain) : "—"],
    // Heritable kernel shape: weights of the inner, outer and far ring (neutral 64 / 64 / 0), shown once a genome leaves neutral.
    ...(p.lineage && p.rings ? [["ring weights", `${Math.max(64 + p.rings[0], 0)} / ${Math.max(64 + p.rings[1], 0)} / ${Math.max(p.rings[2], 0)}`] as [string, string]] : []),
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
  line.textContent = cfg?.pondPeriod === undefined ? "" : `${cfg.pondArm} · cycle every ${cfg.pondPeriod.toLocaleString()} steps`;
  line.title = "";
}
function onPonds(m: PondsMsg) {
  const line = $("pond-status");
  line.hidden = false;
  line.textContent = `cycle ${m.cycle} · ${m.hand ? "by hand" : m.arm} · donors ${m.donors.length ? m.donors.join(", ") : "none"}`;
  // The line can clip a long donor list (up to 16 on the 8 × 8 preset); the tooltip always holds it in full.
  line.title = `Pond cycle ${m.cycle} at t=${m.step.toLocaleString()} · donors ${m.donors.length ? m.donors.join(", ") : "none"}`;
  // The cycle that was waiting has been applied.
  if (awaiting && awaiting.step === m.step) endAwait();
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
let awaiting: PondAwaitMsg | null = null;
let picks: number[] = [];
/** The ranking last chosen; until one is, the world's own score when it has one, else speed. */
let rankKey: RankKey | null = null;
let toolBeforePick: Tool = "inspect";
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
  termSel.replaceChildren(...keys.map((k) => new Option(k === "score" ? `${RANK_LABELS.score} (${m.score})` : RANK_LABELS[k], k, false, k === rankKey)));
  $("breeder-pick").hidden = false;
  overlay.hidden = false;
  const pickTool = tools.querySelector<HTMLButtonElement>('button[data-tool="pick"]')!;
  pickTool.hidden = false;
  if (tool !== "pick") toolBeforePick = tool;
  setTool("pick");
  setStatus(`Cycle ${m.cycle}: choose the donors`, "ready");
  syncWaitingControls();
  syncPicks();
}
/** A waiting cycle holds a pre-cycle world, which cannot be saved, exported or verified: those wait for the pick. */
function syncWaitingControls() {
  for (const id of ["btn-save", "btn-export", "btn-verify"]) $<HTMLButtonElement>(id).disabled = !worldReady || awaiting !== null || (id === "btn-verify" && verifying);
}
function endAwait() {
  const was = awaiting !== null;
  awaiting = null;
  picks = [];
  $("breeder-pick").hidden = true;
  overlay.hidden = true;
  tools.querySelector<HTMLButtonElement>('button[data-tool="pick"]')!.hidden = true;
  if (tool === "pick") setTool(toolBeforePick);
  if (was && worldReady) setStatus(playing ? "Running" : "Paused", playing ? "running" : "ready");
  if (was) syncWaitingControls();
}
function togglePick(pond: number | null) {
  const a = awaiting;
  if (!a || pond === null) return;
  if (a.terms.mass[pond] === 0) return toast(`Pond ${pond} is empty: it has nothing to seed a pond with`);
  const at = picks.indexOf(pond);
  if (at >= 0) picks.splice(at, 1);
  else picks.push(pond);
  syncPicks();
}
/** The panel and the overlay after the picks, the ranking or the waiting cycle changed. */
function syncPicks() {
  const a = awaiting;
  if (!a) return;
  const occupied = a.terms.mass.filter((m) => m > 0).length;
  $("breeder-call").textContent = `Cycle ${a.cycle} at t=${a.step.toLocaleString()} is waiting. ${occupied} of ${a.terms.mass.length} ponds are occupied.`;
  const go = $<HTMLButtonElement>("breeder-go");
  go.disabled = picks.length === 0;
  go.textContent = picks.length === 0 ? "Pick at least one pond" : `Breed from ${picks.length} pond${picks.length === 1 ? "" : "s"}`;
  $("breeder-list").replaceChildren(...picks.map((p) => { const li = document.createElement("li"); li.textContent = String(p); return li; }));
  drawPondOverlay();
}
termSel.onchange = () => { rankKey = termSel.value as RankKey; syncPicks(); };
$("breeder-top").onclick = () => {
  if (!awaiting) return;
  picks = rankOrder(awaiting, rankKey ?? "speed").slice(0, Math.max(1, Math.floor(awaiting.terms.mass.length / 4)));
  syncPicks();
};
$("breeder-rule").onclick = () => { if (awaiting) { picks = awaiting.suggested.slice(); syncPicks(); } };
$("breeder-clear").onclick = () => { picks = []; syncPicks(); };
$("breeder-go").onclick = () => {
  if (!awaiting || !picks.length) return;
  send({ type: "pick", world: awaiting.world, step: awaiting.step, donors: picks.slice() });
  // One message per cycle: the panel closes when the worker reports the cycle applied.
  $<HTMLButtonElement>("breeder-go").disabled = true;
};
breederOn.onchange = () => send({ type: "breeder", on: breederOn.checked });

/**
 * The pond grid over the field while a cycle waits: each occupied pond's rank by the chosen measure, empty ponds
 * dimmed, picked ponds outlined with their place in the order. Drawn for the world's own copy only.
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
  const sx = w / rect.w, sy = h / rect.h;
  const rank = new Map(rankOrder(a, rankKey ?? "speed").map((p, j) => [p, j + 1]));
  const side = cfg.tileW * sx;
  const font = Math.max(9, Math.min(15, side / 5)) * (dpr > 1 ? 1.25 : 1);
  g.font = `600 ${font}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  g.textBaseline = "top";
  for (let p = 0; p < a.terms.mass.length; p++) {
    const tx = p % cfg.tilesX, ty = (p - tx) / cfg.tilesX;
    const x = (tx * cfg.tileW - rect.x) * sx, y = (ty * cfg.tileH - rect.y) * sy, pw = cfg.tileW * sx, ph = cfg.tileH * sy;
    if (x + pw < 0 || y + ph < 0 || x > w || y > h) continue;
    const order = picks.indexOf(p);
    if (a.terms.mass[p] === 0) {
      g.fillStyle = "rgba(0, 0, 0, 0.55)";
      g.fillRect(x, y, pw, ph);
    }
    g.lineWidth = order >= 0 ? 3 * dpr : 1;
    g.strokeStyle = order >= 0 ? "rgb(255, 196, 61)" : "rgba(255, 255, 255, 0.28)";
    const inset = order >= 0 ? 1.5 * dpr : 0.5;
    g.strokeRect(x + inset, y + inset, pw - 2 * inset, ph - 2 * inset);
    const r = rank.get(p);
    if (r !== undefined && side >= 26) {
      const label = `#${r}`;
      g.fillStyle = "rgba(0, 0, 0, 0.6)";
      g.fillRect(x + 3 * dpr, y + 3 * dpr, g.measureText(label).width + 6, font + 4);
      g.fillStyle = order >= 0 ? "rgb(255, 196, 61)" : "rgba(255, 255, 255, 0.85)";
      g.fillText(label, x + 3 * dpr + 3, y + 3 * dpr + 2);
    }
    if (order >= 0 && side >= 26) {
      const label = String(order + 1);
      const tw = g.measureText(label).width + 8;
      g.fillStyle = "rgb(255, 196, 61)";
      g.fillRect(x + pw - tw - 3 * dpr, y + 3 * dpr, tw, font + 4);
      g.fillStyle = "rgb(30, 22, 0)";
      g.fillText(label, x + pw - tw - 3 * dpr + 4, y + 3 * dpr + 2);
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
  $("stage-alert-title").textContent = !noWorld ? "This world has stopped" : gpuReady ? "The world could not be loaded" : "The lab could not start";
  $("stage-alert-text").textContent = message;
  $("stage-alert-help").textContent = !noWorld
    ? "The world is paused. Your saved checkpoints are still listed under Checkpoints."
    : gpuReady
      ? "Choose a preset under Start a world, or restore a checkpoint."
      : "The lab needs a browser with WebGPU. Check that hardware acceleration is on, then reload the page.";
  $("stage-alert-dismiss").hidden = noWorld;
  $("stage-alert").hidden = false;
  if (noWorld) {
    $("world-heading").textContent = "No world loaded";
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
      setStatus("Loading world", "loading");
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
      $("world-heading").textContent = PRESETS.find((p) => p.id === m.manifest.presetId)?.name ?? "Imported world";
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
      $("checkpoint-empty").hidden = m.list.length > 0;
      // Redrawing the rows must not drop the keyboard's place in them.
      const rowHadFocus = $("ckpts").contains(document.activeElement);
      $("ckpts").replaceChildren(
        ...m.list
          .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
          .map((c) => {
            const li = document.createElement("li");
            const name = document.createElement("span");
            name.textContent = c.file;
            name.title = `${c.file} · ${(c.bytes / 1e6).toFixed(1)} MB · ${c.savedAt}`;
            const restore = document.createElement("button");
            restore.type = "button";
            restore.textContent = "Restore";
            restore.setAttribute("aria-label", `Restore ${c.file}`);
            restore.onclick = () => guardUnsaved($("guard-ckpt"), restore, "restore", `Restoring the checkpoint at ${t(c.step)} replaces it.`, () => send({ type: "restore", file: c.file }));
            const del = document.createElement("button");
            del.type = "button";
            del.textContent = "Delete";
            del.setAttribute("aria-label", `Delete ${c.file}`);
            del.onclick = () => ask($("guard-ckpt"), del, `Delete ${c.file}? A deleted checkpoint cannot be restored.`, [["Delete checkpoint", () => send({ type: "deleteCheckpoint", file: c.file })]], "Keep it");
            li.append(name, restore, del);
            return li;
          }),
      );
      if (rowHadFocus) ($("ckpts").querySelector<HTMLButtonElement>("button") ?? $("btn-import")).focus();
      break;
    case "saved": {
      // This page's own save, and only that: an automatic checkpoint never answers a save-first choice.
      const asked = savesAsked.shift();
      // It holds every change made before it was asked for; one made while it was in flight is still unsaved.
      if (asked === changes) { touched = false; cleanFile = m.file; }
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
      if (m.request === "lineage" || m.request === "jump") lineagePanel.onError();
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
        $("verification-status").textContent = "Could not verify";
        $("verification-status").className = "badge bad";
        $("verify-out").textContent = m.message;
        setStrip("run-replay", "could not verify", "bad");
      }
      // Whatever was in flight may not have happened: nothing waits on it, and no later save is taken for an earlier one.
      savesAsked.length = 0;
      afterSave = null;
      advanceAsked = null;
      $<HTMLButtonElement>("btn-new").disabled = false;
      setStatus(cfg ? "World stopped" : gpuReady ? "No world loaded" : "Lab could not start", "error");
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
