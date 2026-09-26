import { PRESETS, worldH, worldW, NN_I, NN_H, NN_O, NN_BYTES, type WorldConfig } from "@bl/schema";
import { VIEW_MODES, type GpuViewMode, type ViewRect } from "@bl/sim-gpu";
import type { CensusMsg, FromWorker, ProbeMsg, StatsMsg, ToWorker } from "./protocol.ts";
import { Series } from "./sparkline.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (v: number) =>
  Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(2)}G` : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : Math.abs(v) >= 1e4 ? `${(v / 1e3).toFixed(1)}k` : `${Math.round(v)}`;

const canvas = $<HTMLCanvasElement>("world");
const wrap = $("canvas-wrap");
const worker = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
const send = (m: ToWorker, t: Transferable[] = []) => worker.postMessage(m, t);

let cfg: WorldConfig | null = null;
let rect: ViewRect = { x: 0, y: 0, w: 256, h: 256 };
let mode: GpuViewMode = "composite";
let tool: "inspect" | "lesion" | "pan" = "inspect";
let playing = false;
let lastStep = 0;

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
  b.textContent = VIEW_LABELS[m][0];
  b.title = `${VIEW_LABELS[m][1]} (${k + 1})`;
  b.dataset.mode = m;
  b.onclick = () => setMode(m);
  views.appendChild(b);
});
function setMode(m: GpuViewMode) {
  mode = m;
  for (const b of views.querySelectorAll("button")) b.classList.toggle("on", b.dataset.mode === m);
  $("legend").textContent = VIEW_LABELS[m][1];
  pushView();
}

// ---------- presets ----------
const presetSel = $<HTMLSelectElement>("preset");
for (const p of PRESETS) presetSel.add(new Option(p.name, p.id));
const showPresetDesc = () => ($("preset-desc").textContent = PRESETS.find((p) => p.id === presetSel.value)?.description ?? "");
presetSel.onchange = showPresetDesc;
showPresetDesc();
$("btn-new").onclick = () => send({ type: "load", presetId: presetSel.value, seed: Number($<HTMLInputElement>("seed").value) || 0 });

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
  send({ type: "play", playing: p });
}
$("btn-play").onclick = () => setPlaying(!playing);
$("btn-step").onclick = () => send({ type: "step", count: 1 });
$("btn-step100").onclick = () => send({ type: "step", count: 100 });

// ---------- tools ----------
const tools = $("tools");
for (const b of tools.querySelectorAll<HTMLButtonElement>("button"))
  b.onclick = () => {
    tool = b.dataset.tool as typeof tool;
    for (const o of tools.querySelectorAll("button")) o.classList.toggle("on", o === b);
    wrap.dataset.tool = tool;
  };
wrap.dataset.tool = tool;
const radius = $<HTMLInputElement>("radius");
radius.oninput = () => ($("radius-val").textContent = radius.value);

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
}
function toWorld(ev: { clientX: number; clientY: number }): [number, number] {
  const r = canvas.getBoundingClientRect();
  return [rect.x + ((ev.clientX - r.left) / r.width) * rect.w, rect.y + ((ev.clientY - r.top) / r.height) * rect.h];
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
canvas.onpointerdown = (ev) => {
  canvas.setPointerCapture(ev.pointerId);
  if (tool === "pan" || ev.button === 1 || ev.button === 2) {
    drag = { x: ev.clientX, y: ev.clientY, rx: rect.x, ry: rect.y };
  } else if (tool === "lesion") {
    lesionDrag = true;
    lesionAt(ev);
  } else {
    const [x, y] = toWorld(ev);
    send({ type: "probe", x, y });
  }
};
canvas.onpointermove = (ev) => {
  const [x, y] = toWorld(ev);
  if (cfg) {
    const W = worldW(cfg), H = worldH(cfg);
    $("hover").textContent = `x ${(((Math.floor(x) % W) + W) % W)}  y ${(((Math.floor(y) % H) + H) % H)}  · zoom ${(worldW(cfg) / rect.w).toFixed(2)}×`;
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
  const now = performance.now();
  if (now - lastLesion < 60) return;
  lastLesion = now;
  const [x, y] = toWorld(ev);
  send({ type: "lesion", x, y, r: Number(radius.value) });
}

// ---------- keyboard ----------
window.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).matches("input, select, textarea")) return;
  if (e.key === " ") {
    e.preventDefault();
    setPlaying(!playing);
  } else if (e.key === ".") send({ type: "step", count: 1 });
  else if (/^[1-7]$/.test(e.key)) setMode(VIEW_MODES[Number(e.key) - 1]);
});

// ---------- checkpoints ----------
$("btn-save").onclick = () => send({ type: "save" });
$("btn-export").onclick = () => send({ type: "export" });
$<HTMLInputElement>("import").onchange = async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  const bytes = await f.arrayBuffer();
  send({ type: "import", bytes, name: f.name }, [bytes]);
};
$("btn-verify").onclick = () => {
  $("verify-out").textContent = "replaying…";
  send({ type: "verify", steps: 200 });
};

// ---------- stats rendering ----------
const spInd = new Series($<HTMLCanvasElement>("sp-ind"), "#3ddc97");
const spBio = new Series($<HTMLCanvasElement>("sp-bio"), "#7fd1ff");
const spLin = new Series($<HTMLCanvasElement>("sp-lin"), "#ffb454");

function onStats(s: StatsMsg) {
  lastStep = s.step;
  $("chip-step").textContent = `t = ${s.step.toLocaleString()}`;
  $("chip-rate").textContent = `${fmt(s.stepsPerSec)} steps/s · ${Math.round(s.fps)} fps`;
  $("k-matter").textContent = s.matterDelta;
  $("k-resid").textContent = s.residual;
  $("k-light").textContent = fmt(s.lightIn);
  $("k-heat").textContent = fmt(s.heatOut);
  const ok = s.residual === "0" && s.matterDelta === "0";
  const badge = $("ledger-badge");
  badge.textContent = ok ? "exact" : "violation";
  badge.className = `badge ${ok ? "ok" : "bad"}`;
  const pools: [string, number, string][] = [
    ["A nutrient", s.A, "#4f8cff"],
    ["B biomass", s.B, "#3ddc97"],
    ["P membrane", s.P, "#d8dee9"],
    ["C waste", s.C, "#c9853a"],
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
}

function onProbe(p: ProbeMsg) {
  $("probe-empty").hidden = true;
  $("probe").hidden = false;
  const rows: [string, string][] = [
    ["cell", `(${p.x}, ${p.y}) @ t=${p.step}`],
    ...Object.entries(p.cells).map(([k, v]) => [k, k === "MOT" ? `${(v & 255) - 128}, ${((v >> 8) & 255) - 128}` : String(v)] as [string, string]),
    ["lineage", p.lineage || "none"],
    ["μ / σ", p.lineage ? `${(p.mu / 1024).toFixed(3)} / ${(p.sigma / 1024).toFixed(3)}` : "—"],
    ["motility gain", p.lineage ? String(p.motGain) : "—"],
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
}

let toastTimer = 0;
function toast(msg: string, bad = false) {
  const t = $("toast");
  t.textContent = msg;
  t.className = `toast show${bad ? " bad" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.className = "toast"), bad ? 8000 : 3000);
}

worker.onmessage = (ev: MessageEvent<FromWorker>) => {
  const m = ev.data;
  switch (m.type) {
    case "ready":
      $("chip-gpu").textContent = m.adapter;
      $("chip-gpu").title = m.adapter;
      send({ type: "load", presetId: presetSel.value, seed: Number($<HTMLInputElement>("seed").value) || 0 });
      send({ type: "listCheckpoints" });
      break;
    case "loaded":
      cfg = m.manifest.cfg;
      spInd.clear();
      spBio.clear();
      spLin.clear();
      fit(true);
      toast(`Loaded ${m.manifest.runId}`);
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
    case "checkpoints":
      $("ckpts").replaceChildren(
        ...m.list
          .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
          .map((c) => {
            const li = document.createElement("li");
            const name = document.createElement("span");
            name.textContent = c.file;
            name.title = `${c.file} · ${(c.bytes / 1e6).toFixed(1)} MB · ${c.savedAt}`;
            const restore = document.createElement("button");
            restore.textContent = "Restore";
            restore.onclick = () => send({ type: "restore", file: c.file });
            const del = document.createElement("button");
            del.textContent = "Delete";
            del.onclick = () => confirm(`Delete ${c.file}?`) && send({ type: "deleteCheckpoint", file: c.file });
            li.append(name, restore, del);
            return li;
          }),
      );
      break;
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
    case "verify":
      $("verify-out").textContent = `${m.ok ? "✓ identical" : "✗ DIVERGED"} — ${m.detail}`;
      break;
    case "error":
      toast(m.message, true);
      console.error(m.message);
      break;
  }
};

// ---------- boot ----------
if (!("transferControlToOffscreen" in canvas)) {
  toast("This browser lacks OffscreenCanvas; the lab needs a WebGPU-capable browser.", true);
} else {
  const r = wrap.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const off = canvas.transferControlToOffscreen();
  send({ type: "init", canvas: off, width: Math.round(r.width * dpr), height: Math.round(r.height * dpr) }, [off]);
}
setMode("composite");
void lastStep;
