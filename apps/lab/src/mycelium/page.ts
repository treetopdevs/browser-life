// Live view of the Mycelium world (tools/mycelium/world.ts is the rule set).
//
// Two engines run the same rules. On the GPU (WebGPU) the world is a GpuMycelium and the picture is drawn straight
// from its buffers by render-gpu.ts, with no per-frame readback; the numbers and the ledger audit come from a full
// read-back about twice a second and after every brush stroke. On the CPU the reference runs on the main thread and
// render-cpu.ts paints it with Canvas 2D. Both share one view (zoom and pan), one set of colours and one set of brushes
// (tools/mycelium/brush.ts, applied between steps; on the GPU as read() -> brush -> upload()).
import { applyBrush, type BrushKind, type BrushReport } from '../../../../tools/mycelium/brush.ts';
import { GpuMycelium, myceliumDevice } from '../../../../tools/mycelium/gpu.ts';
import { createWorld, defaultConfig, energyTotal, type Heredity, type LightPattern, matterTotal, type MyceliumConfig, type MyceliumState, step, validateState } from '../../../../tools/mycelium/world.ts';
import { AGE_OCTAVES, css, familyRGB, LAYER, LAYER_SWATCH, type ColourMode, rampRGB, rampValue, type Scales } from './colour.ts';
import { nearestParticle } from './pick.ts';
import { CpuRenderer } from './render-cpu.ts';
import { GpuRenderer } from './render-gpu.ts';
import { clampView, fitView, panBy, pinchView, scaleOf, toScreen, toWorld, ZOOM_STEP, zoomAt, type View } from './view.ts';
import './style.css';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (n: number) => n.toLocaleString('en-US');
const setText = (id: string, v: string) => { const t = el(id); if (t.textContent !== v) t.textContent = v; };

type Engine = 'gpu' | 'cpu';
type Tool = 'inspect' | 'wound' | 'scrape';

const stage = el<HTMLDivElement>('stage');
const overlay = el<HTMLCanvasElement>('overlay');
const octx = overlay.getContext('2d')!;
const hist = el<HTMLCanvasElement>('history');
const hctx = hist.getContext('2d')!;
const play = el<HTMLButtonElement>('play');
const engineSel = el<HTMLSelectElement>('engine');
const sizeSel = el<HTMLSelectElement>('size');
const paceSel = el<HTMLSelectElement>('pace');

// ---- state ------------------------------------------------------------------------------------------------------------

let engine: Engine = 'cpu';
let cfg: MyceliumConfig | null = null;
let world: MyceliumState | null = null; // the CPU engine's live state
let snap: MyceliumState | null = null; // the GPU engine's latest read-back
let gpu: GpuMycelium | null = null;
let gpuRenderer: GpuRenderer | null = null;
let cpuRenderer: CpuRenderer | null = null;
let worldCanvas: HTMLCanvasElement | null = null;
let device: GPUDevice | null = null;
let view: View = fitView(128);
let running = false;
/** Incremented by every start and stop, so a callback queued by an earlier loop ends itself. */
let loopGen = 0;
/** Incremented whenever the state is replaced or edited, so a read-back that started earlier is not shown. */
let stateGen = 0;
let msPerStep = 0;
let autoK = 8;
let stepsPending: Promise<void> | null = null;
let auditing: Promise<MyceliumState | null> | null = null;
let lastAuditAt = 0;
let history: { n: number; g: number }[] = [];
let marks: { step: number; births: number; deaths: number; refused: number }[] = [];
let famCounts = new Map<number, number>();
let legendKey = '';
let lastLegendAt = 0;
let interventions: BrushReport[] = [];
let tool: Tool = 'inspect';
let radius = 6;
let hover: { x: number; y: number } | null = null;

interface Inspected { id: number; gid: number; parent: number; age: number; M: number; E: number; x: number; y: number; step: number; alive: boolean; family: number }
let inspected: Inspected | null = null;
let inspectSeq = 0; // each click's request number: a readback that finishes after a newer click is dropped
let planting = 0; // Plant calls queued or running (they can overlap): Play waits until every one is done

/** Serialises plant, brush strokes and single steps; frames do not queue steps while one is waiting or running. */
let chain: Promise<unknown> = Promise.resolve();
let exclusiveDepth = 0;
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  exclusiveDepth++;
  const run = chain.then(fn);
  chain = run.catch(() => undefined).finally(() => { exclusiveDepth--; });
  return run;
}

// ---- world sizes and engine text ----------------------------------------------------------------------------------------

const SIZES = [128, 256, 512] as const;

/** The config for a world size: the 128 world is defaultConfig itself; bigger worlds keep the density of founders and the room per cell. */
function sizeConfig(size: number, seed: number, heredity: Heredity, lightPattern: LightPattern, trailRule: TrailRule = 'none'): MyceliumConfig {
  const area = (size / 128) ** 2;
  return defaultConfig({ seed, heredity, lightPattern, width: size, height: size, founders: Math.round(1024 * area), maxParticles: Math.min(1 << 16, Math.round(8192 * area)), ...TRAIL_RULES[trailRule].delta });
}

// ---- trail rules ------------------------------------------------------------------------------------------------------------
// Optional rule variants, each a handful of optional config keys that are absent from the default world, so 'none' is the world the
// earlier rungs ran. Each runs identically on both engines (tools/mycelium/RULES.md; parity cases in tests/deno/mycelium_gpu.ts).

type TrailRule = 'none' | 'toll' | 'conduit8' | 'conduit128';

const TRAIL_RULES: Record<TrailRule, { delta: Partial<MyceliumConfig>; help: string }> = {
  none: {
    delta: {},
    help: 'The world the earlier tests ran. Laying trail only costs the particle energy and matter, and nothing rewards it. In the R3 test, inheritance purged this kind of trail: particles that lay less out-reproduce those that lay more, so the trail fades. That is a directional test on fresh seeds, not a measure of selection.',
  },
  toll: {
    delta: { moveCost: 12, trailMoveDiscount: 64, trailDiscountMode: 'toll' },
    help: 'Moving costs six times the usual energy, but a particle that is laying trail pays much less for moving over ground that already holds a little trail (the discount is complete at 4 units). This does keep trail (15 of 16 inherited worlds in the R4 test), but the particles only pay the smallest toll and do not follow the trail: it is kept, and nothing was found using it. Run it to see a carpet of trail that goes nowhere.',
  },
  conduit8: {
    delta: { trailConduit: 8 },
    help: 'Nutrient spreads faster between two neighbouring cells when both hold trail, so a connected trail acts like a pipe. Medium strength. In the conduit screen (an exploration, 4 seeds per cell, not a test) inherited worlds with it lost their trail in 3 of 4 worlds and held 0.16 per particle in the fourth, as worlds without it do. Nobody laid enough trail for the pipe to matter, so the screen could not say whether a trail that already existed would pay. Expect a world that looks like the plain one.',
  },
  conduit128: {
    delta: { trailConduit: 128 },
    help: 'The same pipe at the strongest setting: two neighbouring cells holding about 11 units of trail each already spread nutrient as fast as the rules allow. In the same screen it also lost its trail in 3 of 4 worlds and the fourth held 0.44 per particle. Nothing was found that it helps; the strength is yours to vary.',
  },
};

const SIZE_NOTES: Record<number, string> = {
  128: 'The size the default numbers were tuned on, and the cheapest: it runs smoothly even on a weak GPU or on the CPU.',
  256: 'Four times the room. Separate colonies can grow without meeting, which a small world cannot show. Each step costs about four times as much, which a weak or battery-saving GPU may feel.',
  512: 'Sixteen times the room. The rules cap the particles at 65,536, so a population here can fill the cap and stop growing; births refused for lack of room are counted and shown below as "Births refused per 100 steps", and the books stay exact. The heaviest size: expect it to be slow on a weak GPU. The default numbers were tuned on 128, so this is the least tested size.',
};

function sizeLabel(size: number): string {
  const c = sizeConfig(size, 1, 'inherit', 'uniform');
  return `${size} × ${size} · ${fmt(c.width * c.height)} cells · up to ${fmt(c.maxParticles)} particles${size === 128 ? ' · the tuned size' : size === 256 ? ' · four times the room' : ' · the most the rules allow'}`;
}

function fillSizes(): void {
  sizeSel.replaceChildren(...SIZES.map((s) => { const o = document.createElement('option'); o.value = String(s); o.textContent = sizeLabel(s); return o; }));
  sizeSel.value = '128';
}

function sizeHelp(): void {
  const size = Number(sizeSel.value);
  const c = sizeConfig(size, 1, 'inherit', 'uniform');
  const text = engineSel.value === 'cpu'
    ? `On the CPU the world is always 128 × 128 (${fmt(c.width * c.height)} cells, up to ${fmt(c.maxParticles)} particles): the bigger sizes need the GPU.`
    : `${size} × ${size}: ${fmt(c.width * c.height)} cells, ${fmt(c.founders)} founders at the start, room for ${fmt(c.maxParticles)} particles at once. ${SIZE_NOTES[size]}`;
  setText('size-help', text);
}

function setPaces(): void {
  const opts: [string, string][] = engine === 'gpu'
    ? [['1', '1 step per frame · watch each move'], ['4', '4 steps per frame · steady'], ['16', '16 steps per frame · quick'], ['max', 'as fast as this GPU goes']]
    : [['1', '1 step per frame · watch each move'], ['4', '4 steps per frame · steady'], ['max', 'as fast as this CPU goes']];
  const keep = paceSel.value;
  paceSel.replaceChildren(...opts.map(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; return o; }));
  paceSel.value = opts.some(([v]) => v === keep) ? keep : '4';
}

function engineText(reason = ''): void {
  const e = el('engine-now');
  e.dataset.engine = engine;
  const n = cfg ? `${cfg.width} × ${cfg.height}` : '';
  setText('engine-now', engine === 'gpu'
    ? `Running on: your GPU (WebGPU), ${n} world. The picture is drawn straight from GPU memory with no per-frame readback.`
    : `Running on: the CPU reference (R0), ${n} world, drawn with Canvas 2D.${reason ? ` ${reason}` : ''}`);
  setText('engine-help', engine === 'gpu'
    ? 'The GPU engine runs many steps per frame and can hold worlds up to 512 × 512. It computes exactly what the CPU reference computes (checked bit for bit in a local test on one Mac), so the choice changes speed and size, not the rules.'
    : 'The CPU reference is the specification the GPU port is checked against: slower, 128 × 128 only, and it checks both ledgers after every single step.');
  setText('audit-note', engine === 'gpu'
    ? 'Numbers and the ledger check come from a full read-back about twice a second and after every brush stroke; the picture itself is never read back.'
    : 'Numbers and the ledger check run after every step.');
  sizeHelp();
}

// ---- engines ----------------------------------------------------------------------------------------------------------------

async function getDevice(): Promise<{ device: GPUDevice | null; why: string }> {
  if (device) return { device, why: '' };
  if (!('gpu' in navigator) || !navigator.gpu) return { device: null, why: 'This browser does not offer WebGPU.' };
  try {
    const dev = await myceliumDevice();
    dev.addEventListener('uncapturederror', (ev) => {
      const message = (ev as GPUUncapturedErrorEvent).error.message;
      document.body.dataset.gpuError = message;
      if (device === dev) { stop(); setText('status', `The GPU reported an error and the run is stopped: ${message}`); }
    });
    void dev.lost.then((info) => {
      if (device !== dev) return;
      device = null;
      if (engine === 'gpu') void fallBack(`The GPU was lost (${(info.message || info.reason).replace(/\.$/, '')}).`);
    });
    device = dev;
    return { device, why: '' };
  } catch (e) {
    return { device: null, why: `WebGPU could not start (${e instanceof Error ? e.message : String(e)}).` };
  }
}

/** Switch to the CPU reference after the GPU failed or went away, and plant a fresh 128 world there. */
async function fallBack(why: string): Promise<void> {
  stop();
  engineSel.value = 'cpu';
  await plant(`${why} Switched to the CPU reference; this is a new world.`);
}

/** A new, empty canvas for the world, replacing the old one (a canvas keeps the first context type it was given). */
function freshCanvas(): HTMLCanvasElement {
  worldCanvas?.remove();
  const c = document.createElement('canvas');
  c.id = 'world';
  c.setAttribute('role', 'img');
  c.setAttribute('aria-label', 'The mycelium world seen from above. Green is dissolved nutrient, violet is trail, amber is waste, and each coloured dot is a particle. The colour legend below says what the particle colour means.');
  stage.insertBefore(c, overlay);
  worldCanvas = c;
  return c;
}

async function plant(note = ''): Promise<void> {
  planting++;
  play.disabled = true;
  try { await plantNow(note); } finally { if (--planting === 0) play.disabled = false; }
}

async function plantNow(note: string): Promise<void> {
  await exclusive(async () => {
    stop();
    stateGen++;
    await auditing?.catch(() => undefined);
    const seed = Math.max(0, Math.min(0xffffffff, Math.floor(Number(el<HTMLInputElement>('seed').value) || 0)));
    let useGpu = engineSel.value === 'gpu';
    let why = note;
    if (useGpu) {
      const d = await getDevice();
      if (!d.device) { useGpu = false; why = `${d.why} Using the CPU reference instead.`; }
    }
    const size = useGpu ? Number(sizeSel.value) : 128;
    const rule = el<HTMLSelectElement>('trailrule').value as TrailRule;
    const config = sizeConfig(size, seed, el<HTMLSelectElement>('heredity').value as Heredity, el<HTMLSelectElement>('light').value as LightPattern, rule);
    const wasGpu = engine === 'gpu';
    if (useGpu) {
      let next: GpuMycelium | null = null;
      let made: GpuRenderer | null = null; // a painter this call built, to release if the engine then fails to start
      try {
        let renderer = gpuRenderer;
        if (!renderer || !wasGpu) renderer = made = await GpuRenderer.create(device!, freshCanvas());
        next = await GpuMycelium.create(device!, config);
        renderer.bind(next);
        gpuRenderer = renderer; cpuRenderer = null;
        gpu?.destroy();
        gpu = next; world = null; engine = 'gpu';
      } catch (e) {
        next?.destroy();
        made?.destroy();
        useGpu = false;
        why = `The GPU engine could not start (${e instanceof Error ? e.message : String(e)}). Using the CPU reference instead.`;
      }
    }
    if (!useGpu) {
      gpu?.destroy(); gpu = null; gpuRenderer?.destroy(); gpuRenderer = null; snap = null;
      // Reuse the 2D painter only while its own canvas is still the one on the page. A switch to the GPU that failed
      // has already replaced the canvas (and a canvas that was offered to WebGPU can no longer give a 2D context).
      if (!cpuRenderer || cpuRenderer.canvas !== worldCanvas || !cpuRenderer.canvas.isConnected) cpuRenderer = new CpuRenderer(freshCanvas());
      world = createWorld(sizeConfig(128, seed, config.heredity, config.lightPattern, rule));
      engine = 'cpu';
      engineSel.value = 'cpu';
      sizeSel.value = '128';
    }
    cfg = (useGpu ? config : world!.config);
    sizeSel.disabled = engine === 'cpu';
    const radiusIn = el<HTMLInputElement>('radius');
    radiusIn.max = String(Math.min(40, cfg.width / 2));
    radius = Math.min(radius, Number(radiusIn.max)); radiusIn.value = String(radius); setText('radius-out', String(radius));
    setPaces();
    history = []; marks = []; interventions = []; inspected = null; msPerStep = 0; famCounts = new Map(); legendKey = ''; lastSampleStep = -1;
    view = fitView(cfg.width);
    renderLog();
    renderInspect();
    engineText(why);
    describeColour();
    if (engine === 'gpu') { snap = await gpu!.read(); } else snap = null;
    onSnapshot(engine === 'gpu' ? snap! : world!, true);
    render();
    setText('status', `Planted ${fmt(cfg.founders)} founders with random controllers on seed ${seed}${rule === 'none' ? '' : `, trail rule: ${ruleSel.selectedOptions[0]?.dataset.short ?? rule}`}. Most founders die; watch which families spread.`);
    document.body.dataset.ready = '1';
  }).catch((e) => { setText('status', `Could not plant: ${e instanceof Error ? e.message : String(e)}`); });
}

// ---- drawing ----------------------------------------------------------------------------------------------------------------

const cssSize = () => stage.clientWidth || 512;
const dprNow = () => Math.min(2, window.devicePixelRatio || 1);
const mode = (): ColourMode => el<HTMLSelectElement>('colour').value as ColourMode;
const layers = (): number =>
  (el<HTMLInputElement>('layer-nutrient').checked ? LAYER.nutrient : 0) | (el<HTMLInputElement>('layer-trail').checked ? LAYER.trail : 0) |
  (el<HTMLInputElement>('layer-waste').checked ? LAYER.waste : 0) | (el<HTMLInputElement>('layer-particles').checked ? LAYER.particles : 0);

let renderQueued = false;
function requestRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(); });
}

function render(): void {
  if (!cfg) return;
  const size = cssSize(), dpr = dprNow();
  view = clampView(view, cfg.width, size);
  try {
    if (engine === 'gpu' && gpu && gpuRenderer) {
      gpuRenderer.resize(size, dpr);
      gpuRenderer.draw(view, mode(), layers(), size, dpr);
    } else if (world && cpuRenderer) {
      const px = Math.round(size * dpr);
      if (cpuRenderer.canvas.width !== px) { cpuRenderer.canvas.width = px; cpuRenderer.canvas.height = px; }
      cpuRenderer.draw(world, view, { mode: mode(), layers: layers() }, size, dpr);
    }
  } catch (e) {
    stop();
    setText('status', `Drawing failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  drawOverlay();
  setText('zoom-level', `Zoom ${view.z.toFixed(1)}× · centre (${Math.floor(view.cx)}, ${Math.floor(view.cy)})`);
}

/** The brush circle under the pointer and the ring round the inspected particle, in CSS pixels over the world canvas. */
function drawOverlay(): void {
  const size = cssSize(), dpr = dprNow();
  const px = Math.round(size * dpr);
  if (overlay.width !== px) { overlay.width = px; overlay.height = px; }
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  octx.clearRect(0, 0, size, size);
  if (!cfg) return;
  const W = cfg.width;
  if (inspected) {
    const p = toScreen(view, W, size, inspected.x / 256, inspected.y / 256);
    octx.lineWidth = 3; octx.strokeStyle = 'rgba(0,0,0,0.65)';
    octx.beginPath(); octx.arc(p.x, p.y, 10, 0, Math.PI * 2); octx.stroke();
    octx.lineWidth = 1.5; octx.strokeStyle = inspected.alive ? '#f2f6f4' : '#f2c978';
    octx.setLineDash(inspected.alive ? [] : [4, 3]);
    octx.beginPath(); octx.arc(p.x, p.y, 10, 0, Math.PI * 2); octx.stroke();
    octx.setLineDash([]);
  }
  if (tool !== 'inspect' && hover) {
    const w = toWorld(view, W, size, hover.x, hover.y);
    const cx = Math.floor(w.x), cy = Math.floor(w.y);
    if (cx >= 0 && cy >= 0 && cx < W && cy < W) {
      const r = (radius + 0.5) * scaleOf(view, W, size);
      octx.fillStyle = tool === 'wound' ? 'rgba(235,90,80,0.16)' : 'rgba(242,201,120,0.16)';
      octx.lineWidth = 1.5; octx.strokeStyle = tool === 'wound' ? '#f08a80' : '#f2c978'; octx.setLineDash([5, 4]);
      // The brush measures distance around the torus, so a stroke near an edge also reaches the opposite edge: draw the wrapped copies too.
      for (const ox of [-W, 0, W]) for (const oy of [-W, 0, W]) {
        const c = toScreen(view, W, size, cx + 0.5 + ox, cy + 0.5 + oy);
        if (c.x + r < 0 || c.y + r < 0 || c.x - r > size || c.y - r > size) continue;
        octx.beginPath(); octx.arc(c.x, c.y, r, 0, Math.PI * 2); octx.fill(); octx.stroke();
      }
      octx.setLineDash([]);
    }
  }
}

// ---- readouts ----------------------------------------------------------------------------------------------------------

const residuals = (s: MyceliumState) => ({ m: matterTotal(s) - s.matter0, e: energyTotal(s) - (s.energy0 + s.totals.lightIn - s.totals.heat) });

function countFamilies(s: MyceliumState): Map<number, number> {
  const m = new Map<number, number>();
  for (let i = 0; i < s.n; i++) m.set(s.gid[i], (m.get(s.gid[i]) ?? 0) + 1);
  return m;
}

/** Show a state's numbers: from the CPU world after each frame or step, from a GPU read-back after each audit. */
function publish(s: MyceliumState, r: { m: number; e: number }): void {
  famCounts = countFamilies(s);
  setText('r-step', fmt(s.step));
  setText('r-n', fmt(s.n));
  setText('r-g', fmt(famCounts.size));
  setText('r-m', fmt(r.m));
  setText('r-e', fmt(r.e));
  setText('r-t', msPerStep ? `${msPerStep.toFixed(msPerStep < 1 ? 2 : 1)} ms` : '–');
  const last = marks[marks.length - 1];
  if (!last || last.step !== s.step) {
    marks.push({ step: s.step, births: s.totals.births, deaths: s.totals.deaths, refused: s.totals.refused });
    if (marks.length > 800) marks = marks.filter((_, i) => i % 2 === 0 || i === marks.length - 1);
  }
  let base = marks[0];
  for (const mk of marks) if (mk.step <= s.step - 100) base = mk; else break;
  const span = s.step - base.step;
  setText('r-b', span > 0 ? fmt(Math.round(((s.totals.births - base.births) * 100) / span)) : '–');
  setText('r-d', span > 0 ? fmt(Math.round(((s.totals.deaths - base.deaths) * 100) / span)) : '–');
  setText('r-f', span > 0 ? fmt(Math.round(((s.totals.refused - base.refused) * 100) / span)) : '–');
  const now = performance.now();
  if (now - lastLegendAt > 400) { lastLegendAt = now; renderLegend(); }
  refreshInspected(s);
}

/** The snapshot handler shared by both engines: ledger stop, history sample, readouts. */
function onSnapshot(s: MyceliumState, first = false): void {
  const r = residuals(s);
  publish(s, r);
  sample(s);
  drawHistory();
  if (r.m !== 0 || r.e !== 0) {
    stop();
    setText('status', `Stopped: a ledger residual appeared at step ${fmt(s.step)}. This is a bug in the rules; please report the seed.`);
  } else if (s.n === 0 && !first) {
    stop();
    setText('status', `Every particle is gone at step ${fmt(s.step)}. Plant again, or try another seed.`);
  }
}

let lastSampleStep = -1;
function sample(s: MyceliumState): void {
  // The CPU engine is read every frame, so thin it to one point per 10 steps; the GPU engine gives one point per audit.
  if (history.length > 0 && (s.step === lastSampleStep || (engine === 'cpu' && s.step - lastSampleStep < 10))) return;
  history.push({ n: s.n, g: famCounts.size });
  lastSampleStep = s.step;
  if (history.length > 600) history = history.filter((_, i) => i % 2 === 0);
}

function drawHistory(): void {
  const W = hist.width, H = hist.height;
  hctx.fillStyle = '#0b171d';
  hctx.fillRect(0, 0, W, H);
  if (history.length < 2) return;
  const top = Math.max(1, ...history.map((r) => r.n));
  const line = (key: 'n' | 'g', colour: string) => {
    hctx.strokeStyle = colour;
    hctx.lineWidth = 2;
    hctx.beginPath();
    history.forEach((r, i) => {
      const px = (i / (history.length - 1)) * (W - 8) + 4;
      const py = H - 6 - (r[key] / top) * (H - 14);
      if (i === 0) hctx.moveTo(px, py); else hctx.lineTo(px, py);
    });
    hctx.stroke();
  };
  line('n', '#dfe9e4');
  line('g', '#c79be6');
  hctx.fillStyle = '#8fa3a0';
  hctx.font = '11px system-ui, sans-serif';
  hctx.fillText(fmt(top), 6, 14);
}

// ---- legend ----------------------------------------------------------------------------------------------------------------

const scales = (): Scales => ({ energyMax: cfg?.energyMax ?? 4096, bodyMax: cfg?.bodyMax ?? 256 });

function bar(gradient: string): HTMLDivElement {
  const b = document.createElement('div');
  b.className = 'bar';
  b.style.background = gradient;
  return b;
}

function renderLegend(): void {
  const m = mode();
  const box = el('legend');
  const sc = scales();
  let key: string;
  if (m === 'family') {
    const top = [...famCounts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 5);
    key = `${m}|${top.map(([g, c]) => `${g}:${c}`).join(',')}`;
    if (key === legendKey) return;
    legendKey = key;
    const hues = Array.from({ length: 13 }, (_, i) => `hsl(${i * 30} 80% 68%)`).join(',');
    const ul = document.createElement('ul');
    for (const [gid, count] of top) {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'dot'; dot.style.background = css(familyRGB(gid));
      li.append(dot, `family ${fmt(gid)} · ${fmt(count)} ${count === 1 ? 'particle' : 'particles'}`);
      ul.append(li);
    }
    const intro = document.createElement('div');
    intro.textContent = 'Particle colour: family. A family is one set of identical controllers. The hues carry no order, and colours can repeat: two different families may look alike, so tell families apart by their number (listed below and shown when you inspect a particle).';
    const head = document.createElement('div');
    head.textContent = top.length ? 'Largest families now:' : 'No particles alive.';
    box.replaceChildren(intro, bar(`linear-gradient(90deg,${hues})`), head, ul);
  } else {
    key = `${m}|${sc.energyMax}|${sc.bodyMax}`;
    if (key === legendKey) return;
    legendKey = key;
    const stops = Array.from({ length: 9 }, (_, i) => css(rampRGB(i / 8))).join(',');
    const at = (t: number) => Math.round(rampValue(m, t, sc));
    const info = {
      energy: { name: 'energy stored', scale: 'square-root scale', ticks: [0, at(0.5), at(1)], unit: '', last: '' },
      age: { name: 'age in steps', scale: 'log scale', ticks: [0, at(0.5), at(1)], unit: '', last: '+' },
      body: { name: 'body matter', scale: 'linear scale', ticks: [0, at(0.5), at(1)], unit: '', last: '' },
    }[m];
    const intro = document.createElement('div');
    intro.textContent = `Particle colour: ${info.name} (${info.scale}). Low is indigo, high is pale yellow.`;
    const ticks = document.createElement('div');
    ticks.className = 'ticks';
    info.ticks.forEach((v, i) => { const s = document.createElement('span'); s.textContent = `${fmt(v)}${i === 2 ? info.last : ''}`; ticks.append(s); });
    box.replaceChildren(intro, bar(`linear-gradient(90deg,${stops})`), ticks);
  }
}

function describeColour(): void {
  const m = mode();
  const c = cfg ?? defaultConfig();
  setText('colour-help', {
    family: 'Family colours are arbitrary hues from the genotype id. Particles with identical controllers share one, and a mutation usually starts a new colour. There are only so many hues, so two different families can share a colour: the family number is the exact identity.',
    energy: `Energy is what a particle can spend before it dies or splits (a split needs ${fmt(c.splitEnergy)}, and ${fmt(c.energyMax)} is the most it can hold). Pale means well fed, indigo means close to starving.`,
    age: `Age is steps lived since birth. A log scale keeps both newborns and old survivors visible: the top of the scale is ${fmt(2 ** AGE_OCTAVES - 1)} steps and older.`,
    body: `Body size is the matter a particle holds; a split needs ${fmt(c.splitMatter)}, and the most it can reach by eating is ${fmt(c.bodyMax)}.`,
  }[m]);
  legendKey = '';
  renderLegend();
}

function swatches(): void {
  for (const k of ['nutrient', 'trail', 'waste'] as const) el(`sw-${k}`).style.background = css(LAYER_SWATCH[k]);
}

// ---- intervention log and inspect panel -----------------------------------------------------------------------------------

function renderLog(): void {
  const ol = el('log');
  ol.replaceChildren(...interventions.slice().reverse().slice(0, 100).map((r) => {
    const li = document.createElement('li');
    li.dataset.kind = r.kind; li.dataset.matter = String(r.matterMoved); li.dataset.step = String(r.step);
    const b = document.createElement('b');
    b.textContent = r.kind === 'wound' ? 'wound' : 'scrape trail';
    const tail = r.kind === 'wound'
      ? `${fmt(r.removed)} ${r.removed === 1 ? 'particle' : 'particles'} removed · matter moved ${fmt(r.matterMoved)} (to waste where they stood) · energy ${fmt(r.heatBooked)} booked as heat`
      : `matter moved ${fmt(r.matterMoved)} (trail to waste)`;
    li.append(`step ${fmt(r.step)} · `, b, ` · centre (${r.cx}, ${r.cy}) · radius ${r.radius} · ${tail}`);
    return li;
  }));
  setText('log-note', interventions.length
    ? `${fmt(interventions.length)} ${interventions.length === 1 ? 'intervention' : 'interventions'} so far, newest first. This run no longer follows from its seed alone.`
    : 'No interventions yet: this run follows its seed and the rules alone.');
}

/** Say something to a screen reader once, through the small status region; the changing numbers stay outside any live region. */
function announce(text: string): void { setText('i-announce', text); }

function renderInspect(): void {
  const i = inspected;
  setText('i-id', i ? fmt(i.id) : '–');
  const fam = el('i-fam');
  if (i) {
    if (fam.dataset.gid !== String(i.gid)) {
      const dot = document.createElement('span');
      dot.style.cssText = `display:inline-block;width:10px;height:10px;border-radius:50%;background:${css(familyRGB(i.gid))}`;
      fam.replaceChildren(dot, `${fmt(i.gid)}`);
      fam.dataset.gid = String(i.gid);
    }
  } else { fam.textContent = '–'; delete fam.dataset.gid; }
  setText('i-par', i ? (i.parent === 0xffffffff ? 'none (a founder)' : fmt(i.parent)) : '–');
  setText('i-age', i ? `${fmt(i.age)} steps` : '–');
  setText('i-m', i ? fmt(i.M) : '–');
  setText('i-e', i ? `${fmt(i.E)} of ${fmt(cfg?.energyMax ?? 0)}` : '–');
  setText('i-count', i ? `${fmt(i.family)} ${i.family === 1 ? 'particle' : 'particles'}` : '–');
  setText('i-pos', i ? `(${(i.x / 256).toFixed(1)}, ${(i.y / 256).toFixed(1)})` : '–');
  setText('i-note', !i ? 'Choose Inspect above and click a particle.'
    : i.alive ? `As of step ${fmt(i.step)}.${engine === 'gpu' ? ' It refreshes with each read-back while the world runs.' : ''}`
      : `No longer alive at step ${fmt(i.step)}: it died or was wounded. These are its last known values.`);
}

function familyCount(s: MyceliumState, gid: number): number {
  let c = 0;
  for (let k = 0; k < s.n; k++) if (s.gid[k] === gid) c++;
  return c;
}

function indexOfId(s: MyceliumState, id: number): number {
  let lo = 0, hi = s.n - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (s.id[mid] === id) return mid;
    if (s.id[mid] < id) lo = mid + 1; else hi = mid - 1;
  }
  return -1;
}

function fromState(s: MyceliumState, i: number): Inspected {
  return { id: s.id[i], gid: s.gid[i], parent: s.parent[i], age: s.age[i], M: s.M[i], E: s.E[i], x: s.x[i], y: s.y[i], step: s.step, alive: true, family: familyCount(s, s.gid[i]) };
}

/** Keep the inspected particle's numbers current from a full snapshot (the CPU world each frame, a GPU read-back at each audit). */
function refreshInspected(s: MyceliumState): void {
  // A snapshot older than the inspection (an audit that started before the click) cannot know a newer particle: ignore it.
  // Strokes and replants need no extra rule: they bump stateGen, which discards every read-back that began before them.
  if (!inspected || s.step < inspected.step) return;
  const i = inspected.alive ? indexOfId(s, inspected.id) : -1;
  if (i >= 0) inspected = fromState(s, i);
  else if (inspected.alive) { inspected = { ...inspected, alive: false, step: s.step }; announce(`Particle ${fmt(inspected.id)} is no longer alive.`); }
  else return;
  renderInspect();
}

/** Reads back only the particle planes and the counters (no genomes, no field) and inspects the particle nearest a world point. */
async function inspectAt(wx: number, wy: number): Promise<void> {
  if (!cfg) return;
  const req = ++inspectSeq;
  const reach = Math.max(1, 16 / scaleOf(view, cfg.width, cssSize()));
  const miss = 'No particle near that click. Click closer to one, or zoom in.';
  if (engine === 'cpu' && world) {
    const i = nearestParticle(world.n, world.x, world.y, wx, wy, reach);
    if (i < 0) { setText('i-note', miss); announce(miss); return; }
    inspected = fromState(world, i);
  } else if (gpu) {
    const sim = gpu;
    const v = sim.view, d = sim.device;
    const mk = (size: number) => d.createBuffer({ size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const sc = mk(64), sp = mk(8 * v.cap * 4);
    const enc = d.createCommandEncoder();
    enc.copyBufferToBuffer(v.ctl, 0, sc, 0, 64);
    enc.copyBufferToBuffer(v.parts[v.cur], 0, sp, 0, 8 * v.cap * 4);
    d.queue.submit([enc.finish()]);
    await Promise.all([sc.mapAsync(GPUMapMode.READ), sp.mapAsync(GPUMapMode.READ)]);
    const ctl = new Uint32Array(sc.getMappedRange().slice(0)), part = new Uint32Array(sp.getMappedRange().slice(0));
    sc.destroy(); sp.destroy();
    if (sim !== gpu || req !== inspectSeq) return;
    const n = ctl[v.ctlN], stepNow = ctl[v.ctlStepHi] * 2 ** 32 + ctl[v.ctlStep];
    const pl = (off: number) => part.subarray(off, off + n);
    const X = pl(v.planes.x), Y = pl(v.planes.y), G = pl(v.planes.gid);
    const i = nearestParticle(n, X, Y, wx, wy, reach);
    if (i < 0) { setText('i-note', miss); announce(miss); return; }
    let family = 0;
    for (let k = 0; k < n; k++) if (G[k] === G[i]) family++;
    inspected = { id: pl(v.planes.id)[i], gid: G[i], parent: pl(v.planes.parent)[i], age: pl(v.planes.age)[i], M: pl(v.planes.M)[i], E: pl(v.planes.E)[i], x: X[i], y: Y[i], step: stepNow, alive: true, family };
  }
  if (inspected) announce(`Selected particle ${fmt(inspected.id)} of family ${fmt(inspected.gid)}.`);
  renderInspect();
  drawOverlay();
}

// ---- brush strokes ---------------------------------------------------------------------------------------------------------------

/** Read the GPU world back and show it. Resolves to the state shown, or null when the read was stale or failed. */
async function startAudit(): Promise<MyceliumState | null> {
  if (auditing) return auditing;
  const sim = gpu, g = stateGen;
  if (!sim) return null;
  const p: Promise<MyceliumState | null> = (async () => {
    try {
      const s = await sim.read();
      if (g !== stateGen || sim !== gpu) return null;
      snap = s;
      lastAuditAt = performance.now();
      onSnapshot(s);
      return s;
    } catch (e) {
      if (g === stateGen && sim === gpu) { stop(); setText('status', `Stopped: ${e instanceof Error ? e.message : String(e)}`); }
      return null;
    }
  })().finally(() => { if (auditing === p) auditing = null; });
  auditing = p;
  return p;
}

/** A read-back that began after this call: wait out any audit already in flight (its result predates the caller's change), then start a new one. */
async function freshAudit(): Promise<MyceliumState | null> {
  while (auditing) await auditing.catch(() => undefined);
  return startAudit();
}

async function stroke(kind: BrushKind, cx: number, cy: number): Promise<void> {
  const r = radius;
  await exclusive(async () => {
    if (!cfg) return;
    stateGen++;
    let report: BrushReport;
    let after: { m: number; e: number };
    if (engine === 'gpu' && gpu) {
      while (auditing) await auditing.catch(() => undefined); // frames start no audit while this stroke is queued or running
      const sim = gpu;
      const s = await sim.read();
      report = applyBrush(s, kind, cx, cy, r);
      const bad = validateState(s);
      if (bad.length) throw new Error(`the stroke would break the books (${bad[0]}); nothing was changed`);
      sim.upload(s);
      stateGen++;
      const fresh = await freshAudit(); // what the GPU now holds, read back after the upload, is what the residuals show
      after = residuals(fresh ?? s);
    } else if (world) {
      report = applyBrush(world, kind, cx, cy, r);
      const bad = validateState(world);
      if (bad.length) { stop(); throw new Error(`the stroke broke the books (${bad[0]})`); }
      stateGen++;
      after = residuals(world);
      onSnapshot(world);
    } else return;
    interventions.push(report);
    renderLog();
    setText('status', `${kind === 'wound' ? 'Wound' : 'Scrape trail'} at (${report.cx}, ${report.cy}), radius ${report.radius}, step ${fmt(report.step)}: ${kind === 'wound'
      ? `${fmt(report.removed)} particles removed, ${fmt(report.matterMoved)} matter moved to waste, ${fmt(report.heatBooked)} energy booked as heat`
      : `${fmt(report.matterMoved)} trail moved to waste`}. Residuals now: matter ${fmt(after.m)}, energy ${fmt(after.e)}.`);
    render();
  }).catch((e) => { setText('status', `Stroke not applied: ${e instanceof Error ? e.message : String(e)}`); });
}

/** What a click, or the apply-at-centre button, does at a world point. */
function useTool(wx: number, wy: number): void {
  if (!cfg) return;
  const cx = Math.floor(wx), cy = Math.floor(wy);
  if (cx < 0 || cy < 0 || cx >= cfg.width || cy >= cfg.height) return;
  if (tool === 'inspect') inspectAt(wx, wy).catch((e) => setText('i-note', `Could not read the particles: ${e instanceof Error ? e.message : String(e)}`));
  else void stroke(tool, cx, cy);
}

// ---- running ----------------------------------------------------------------------------------------------------------------

/** One CPU step with the ledger check after it. Returns false when the run should stop. */
function advance(): boolean {
  const w = world!;
  const t0 = performance.now();
  step(w);
  msPerStep = msPerStep * 0.9 + (performance.now() - t0) * 0.1;
  const r = residuals(w);
  if (r.m !== 0 || r.e !== 0) { onSnapshot(w); return false; }
  return w.n > 0;
}

function frameCpu(gen: number): void {
  if (!running || gen !== loopGen || !world) return;
  if (exclusiveDepth === 0) {
    const t0 = performance.now();
    let ok = true;
    if (paceSel.value === 'max') { while (running && ok && performance.now() - t0 < 14) ok = advance(); }
    else { for (let k = 0; k < Number(paceSel.value) && running && ok; k++) ok = advance(); }
    render();
    onSnapshot(world);
  }
  requestAnimationFrame(() => frameCpu(gen));
}

function frameGpu(gen: number): void {
  if (!running || gen !== loopGen || !gpu) return;
  const sim = gpu;
  if (!stepsPending && exclusiveDepth === 0) {
    const k = paceSel.value === 'max' ? autoK : Number(paceSel.value);
    const t0 = performance.now();
    sim.step(k);
    render();
    stepsPending = sim.sync().then(() => {
      const ms = performance.now() - t0;
      msPerStep = msPerStep ? msPerStep * 0.8 + (ms / k) * 0.2 : ms / k;
      if (paceSel.value === 'max') autoK = Math.max(1, Math.min(512, Math.round((autoK * 14) / Math.max(1, ms))));
    }, () => undefined).finally(() => { stepsPending = null; });
  }
  if (!auditing && exclusiveDepth === 0 && performance.now() - lastAuditAt > 500) void startAudit();
  requestAnimationFrame(() => frameGpu(gen));
}

function start(): void {
  if (running || !cfg || planting > 0) return;
  if ((engine === 'cpu' ? world?.n : snap?.n) === 0) return;
  running = true;
  const gen = ++loopGen;
  play.textContent = 'Pause';
  play.setAttribute('aria-pressed', 'true');
  setText('status', 'Running.');
  requestAnimationFrame(() => (engine === 'gpu' ? frameGpu(gen) : frameCpu(gen)));
}

function stop(): void {
  running = false;
  loopGen++;
  play.textContent = 'Play';
  play.setAttribute('aria-pressed', 'false');
}

// ---- interaction: view, pointer, keys -------------------------------------------------------------------------------------

const ptrs = new Map<number, { x: number; y: number }>();
let gesture = { moved: false, sx: 0, sy: 0, pinch: 0, button: 0 };
const rel = (e: { clientX: number; clientY: number }) => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
const pinchDist = () => { const [a, b] = [...ptrs.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
const pinchMid = () => { const [a, b] = [...ptrs.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };

function setView(v: View): void { view = v; requestRender(); }
function zoomCentre(factor: number): void { if (cfg) { const s = cssSize(); setView(zoomAt(view, cfg.width, s, factor, s / 2, s / 2)); } }
function panKey(dx: number, dy: number): void { if (cfg) setView(panBy(view, cfg.width, cssSize(), dx, dy)); }

stage.addEventListener('pointerdown', (e) => {
  if (!cfg) return;
  stage.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, rel(e));
  if (ptrs.size === 1) { const p = rel(e); gesture = { moved: false, sx: p.x, sy: p.y, pinch: 0, button: e.button }; }
  else if (ptrs.size === 2) { gesture.moved = true; gesture.pinch = pinchDist(); }
  stage.classList.toggle('grab', ptrs.size > 0);
});

stage.addEventListener('pointermove', (e) => {
  if (!cfg) return;
  const p = rel(e);
  hover = e.pointerType === 'mouse' ? p : null;
  const prev = ptrs.get(e.pointerId);
  if (!prev) { drawOverlay(); return; }
  const size = cssSize();
  if (ptrs.size === 1) {
    if (!gesture.moved && Math.hypot(p.x - gesture.sx, p.y - gesture.sy) > 5) gesture.moved = true;
    ptrs.set(e.pointerId, p);
    if (gesture.moved) setView(panBy(view, cfg.width, size, p.x - prev.x, p.y - prev.y));
  } else if (ptrs.size === 2) {
    const before = pinchMid();
    ptrs.set(e.pointerId, p);
    const d = pinchDist(), mid = pinchMid();
    setView(pinchView(view, cfg.width, size, gesture.pinch > 0 && d > 0 ? d / gesture.pinch : 1, before, mid));
    gesture.pinch = d;
  }
  drawOverlay();
});

function release(e: PointerEvent, cancelled: boolean): void {
  const p = ptrs.get(e.pointerId);
  ptrs.delete(e.pointerId);
  stage.classList.toggle('grab', ptrs.size > 0);
  if (!p || cancelled || ptrs.size > 0 || gesture.moved || gesture.button !== 0 || !cfg) return;
  const w = toWorld(view, cfg.width, cssSize(), p.x, p.y);
  useTool(w.x, w.y);
}
stage.addEventListener('pointerup', (e) => release(e, false));
stage.addEventListener('pointercancel', (e) => release(e, true));
stage.addEventListener('pointerleave', () => { hover = null; drawOverlay(); });

stage.addEventListener('wheel', (e) => {
  if (!cfg) return;
  e.preventDefault();
  const p = rel(e);
  setView(zoomAt(view, cfg.width, cssSize(), Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016)), p.x, p.y));
}, { passive: false });

stage.addEventListener('keydown', (e) => {
  if (!cfg || e.ctrlKey || e.metaKey || e.altKey) return;
  const nudge = 48;
  const handled = ({
    '+': () => zoomCentre(ZOOM_STEP), '=': () => zoomCentre(ZOOM_STEP), '-': () => zoomCentre(1 / ZOOM_STEP), '_': () => zoomCentre(1 / ZOOM_STEP),
    '0': () => setView(fitView(cfg!.width)),
    ArrowLeft: () => panKey(nudge, 0), ArrowRight: () => panKey(-nudge, 0), ArrowUp: () => panKey(0, nudge), ArrowDown: () => panKey(0, -nudge),
    Enter: () => useTool(view.cx, view.cy),
  } as Record<string, () => void>)[e.key];
  if (handled) { e.preventDefault(); handled(); }
});

// ---- wiring -----------------------------------------------------------------------------------------------------------------

play.addEventListener('click', () => {
  if (running) {
    stop();
    if (engine === 'gpu') void (async () => { await freshAudit(); if (!running && snap) setText('status', `Paused at step ${fmt(snap.step)}.`); })();
    else setText('status', `Paused at step ${fmt(world?.step ?? 0)}.`);
  } else start();
});
el('step').addEventListener('click', () => {
  stop();
  void exclusive(async () => {
    if (engine === 'gpu' && gpu) { while (auditing) await auditing.catch(() => undefined); gpu.step(1); stateGen++; await freshAudit(); }
    else if (world && world.n > 0) { advance(); onSnapshot(world); }
    render();
  });
});
el('plant').addEventListener('click', () => { void plant(); });
engineSel.addEventListener('change', () => {
  // The choice takes effect on Plant; until then the page keeps describing the world that is running.
  sizeSel.disabled = engineSel.value !== 'gpu';
  if (engineSel.value !== 'gpu') sizeSel.value = '128';
  sizeHelp();
});
sizeSel.addEventListener('change', sizeHelp);
const ruleSel = el<HTMLSelectElement>('trailrule');
const ruleHelp = () => setText('rule-help', TRAIL_RULES[ruleSel.value as TrailRule]?.help ?? '');
ruleSel.addEventListener('change', ruleHelp);
ruleHelp();
el('colour').addEventListener('change', () => { describeColour(); requestRender(); });
for (const id of ['layer-nutrient', 'layer-trail', 'layer-waste', 'layer-particles']) el(id).addEventListener('change', requestRender);
el('zoom-in').addEventListener('click', () => zoomCentre(ZOOM_STEP));
el('zoom-out').addEventListener('click', () => zoomCentre(1 / ZOOM_STEP));
el('fit').addEventListener('click', () => { if (cfg) setView(fitView(cfg.width)); });
for (const r of document.querySelectorAll<HTMLInputElement>('input[name="tool"]')) {
  r.addEventListener('change', () => { if (r.checked) { tool = r.value as Tool; drawOverlay(); } });
}
el<HTMLInputElement>('radius').addEventListener('input', (e) => { radius = Number((e.target as HTMLInputElement).value); setText('radius-out', String(radius)); drawOverlay(); });
el('apply-centre').addEventListener('click', () => { if (cfg) useTool(view.cx, view.cy); });
new ResizeObserver(() => requestRender()).observe(stage);

// On a phone the world comes first: the long description starts folded (it opens with one tap).
if (window.matchMedia('(max-width: 760px)').matches) document.querySelector('.how')?.removeAttribute('open');
el<HTMLButtonElement>('apply-centre').disabled = false;
swatches();
fillSizes();
describeColour();
void (async () => {
  // Decide the engine before anything touches a canvas: GPU when WebGPU starts, the CPU reference otherwise.
  const d = await getDevice();
  if (!d.device) { engineSel.value = 'cpu'; engineSel.querySelector<HTMLOptionElement>('option[value="gpu"]')!.disabled = true; setText('engine-help', d.why); }
  sizeSel.disabled = engineSel.value === 'cpu';
  await plant(d.device ? '' : `${d.why} Using the CPU reference.`);
})();
