// Live view of the 3D mycelium world (tools/mycelium3d/world.ts is the rule set, RULES.md the prose).
//
// Two engines run the same rules. On the GPU the world is a GpuMycelium3d (tools/mycelium3d/gpu.ts): each animation frame
// queues a batch of steps, and a full read-back at most every READ_MS (and after every single step or plant) feeds the
// census, the ledger check and the picture, packed on the CPU (pack.ts) into the volume view (apps/lab/src/volume3d/) that
// shares the device. Without WebGPU the CPU reference runs on the main thread at the default size, checks both ledgers
// after every step, and draws a flat side view (render-cpu.ts). Plant, step and the debug runTo go through one serial
// queue; a generation counter drops read-backs of a world that has since been replaced, and a sim is destroyed only after
// its queued work and read-back have settled. With bonds on, each read-back also packs the bonds as links (both views draw
// them) and counts bonded particles and bodies (bondReadout in tools/mycelium3d/observe-screen.ts).
//
// Wound and Feed (tools/mycelium3d/brush.ts) reach into the world between steps, through the same serial queue: on the GPU as
// read() -> brush on that copy -> a new GpuMycelium3d made from it, the old one destroyed (swapSim, as Plant swaps); on the
// CPU on the live state. A stroke bumps the generation, so a read-back begun before it is dropped, and reads back at once.
// The cursor (cursor.ts) is set by the x, y and layer inputs, or by pointing: hovering previews it, a click or tap that does
// not drag uses the tool there, and a drag still turns the jar. The renderer draws the brush's sphere cell by cell: exactly
// the cells a stroke reaches (render.ts).
import { applyBrush3d, FEED_AMOUNT_MAX, type BrushReport3d, type BrushStroke3d } from '../../../../tools/mycelium3d/brush.ts';
import { GpuMycelium3d, mycelium3dDevice } from '../../../../tools/mycelium3d/gpu.ts';
import { bondReadout, type BondReadout } from '../../../../tools/mycelium3d/observe-screen.ts';
import { BOND_NONE, createWorld, encode, energyTotal, lightPlane, matterTotal, POS_SHIFT, slotOfId, stateDigest, step, validateState, type Mycelium3dConfig, type Mycelium3dState } from '../../../../tools/mycelium3d/world.ts';
import { css, familyRGB } from '../mycelium/colour.ts';
import { Disposer } from '../volume3d/approaches/disposer.ts';
import { RENDERERS, type ApproachEntry } from '../volume3d/approaches/registry.ts';
import { PRESETS } from '../volume3d/camera.ts';
import { boxExtent, type ParamSpec } from '../volume3d/contract.ts';
import type { Packed } from '../volume3d/pack.ts';
import { VolumeView } from '../volume3d/view.ts';
import { cellCentre, cursorFromRay, isShown, pointerRay, sphereSummary, type Cell, type ViewClip } from './cursor.ts';
import { census, packField, packLinks, packParticles, ratePer100, type Census, type Instances, type Links } from './pack.ts';
import { createParticleHaze, type ParticleStore } from './render.ts';
import { drawSide } from './render-cpu.ts';
import {
  BONDS, choiceFromQuery, DEFAULT_CHOICE, describeChoice, isBonds, isSink, isSize, isTrail, isView, linkInt, SINKS, SIZES, STRETCH_RANGE, TRAILS, VIEW_IDS, worldConfig, type Choice, type SizeId, type ViewId,
} from './settings.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (n: number) => n.toLocaleString('en-US');
/** Matter in the census table: exact below 10,000, then 2 or 3 significant figures (12.3k, 4.77M), so the table fits a phone. */
const compact = (n: number) => (n < 10_000 ? fmt(n) : n.toLocaleString('en-US', { notation: 'compact', maximumSignificantDigits: 3 }));
const setText = (id: string, v: string) => { const t = $(id); if (t.textContent !== v) t.textContent = v; };
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A read-back at most this often while running (the census, the ledger check and the picture all come from it). */
const READ_MS = 250;
const PACES = [
  { id: '1', steps: 1, title: '1 step per frame · watch each move' },
  { id: '4', steps: 4, title: '4 steps per frame · steady' },
  { id: '16', steps: 16, title: '16 steps per frame · quick' },
  { id: 'max', steps: 0, title: 'as fast as this machine goes' },
] as const;

// ---- state ------------------------------------------------------------------------------------------------------------
type Engine = 'gpu' | 'cpu';
let engine: Engine | null = null;
let device: GPUDevice | null = null;
let noGpuWhy = '';
let sim: GpuMycelium3d | null = null;
let world: Mycelium3dState | null = null; // the CPU engine's live state
let cfg: Mycelium3dConfig | null = null;
let choice: Choice = { ...DEFAULT_CHOICE };
/** Steps queued on the GPU engine since planting (the GPU's own counter equals it; read-backs confirm it). */
let queuedSteps = 0;
let gen = 0;
/** Counts worlds planted: a stroke aimed at one world is refused if another has replaced it by the time it runs. */
let worldEpoch = 0;
let running = false;
let loopGen = 0;
let pending: Promise<void> | null = null;
let reading: Promise<void> | null = null;
let lastReadAt = 0;
let autoK = 8;
let last: Census | null = null;
let lastState: Mycelium3dState | null = null;
let lastLight: Uint32Array | null = null;
let marks: Pick<Census, 'step' | 'births' | 'deaths' | 'refused'>[] = [];
const stats = { msPerStep: 0, readMs: 0, packMs: 0, frameMs: 0, reads: 0, readEveryMs: READ_MS };
let lastFrameAt = 0;
let packed: Packed | undefined;
let inst: Instances | undefined;
let links: Links | undefined;
/** The bond census of the last read-back; null without bonds. */
let lastBonds: BondReadout | null = null;
const store: ParticleStore = { inst: null, links: null, version: 0, linkCount: 0, linkBuffer: false, cursor: null, cursorDrawn: false };

let chain: Promise<unknown> = Promise.resolve();
let exclusiveDepth = 0;
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  exclusiveDepth++;
  const run = chain.then(fn);
  chain = run.catch(() => undefined).finally(() => { exclusiveDepth--; });
  return run;
}

// ---- link parameters ----------------------------------------------------------------------------------------------------
// Optional, for links and for tools/volume-capture: size, seed, sink, trail, bonds (the Plant choices), renderer, stretch, peel,
// camera (a pose id) and waste (on or off). A value the page does not offer is ignored, so a bad link opens the defaults
// instead of failing. Values are matched against the page's own lists or own keys only, never inherited ones
// (camera=toString is just unknown). Without parameters the page is exactly as it was.
interface Link { choice: Partial<Choice>; renderer?: ViewId; stretch?: number; peel?: number; camera?: string; waste?: boolean }
function readLink(): Link {
  const q = new URLSearchParams(location.search);
  const int = (k: string, lo: number, hi: number) => linkInt(q.get(k), lo, hi);
  const l: Link = { choice: choiceFromQuery(q) };
  const renderer = q.get('renderer'), camera = q.get('camera'), waste = q.get('waste');
  if (renderer !== null && isView(renderer)) l.renderer = renderer;
  l.stretch = int('stretch', STRETCH_RANGE.min, STRETCH_RANGE.max);
  // up to the chosen size's floor; applied after the first plant, when the volume knows its layers
  l.peel = int('peel', 0, SIZES[l.choice.size ?? DEFAULT_CHOICE.size].dims[2] - 1);
  if (camera !== null && Object.hasOwn(PRESETS, camera)) l.camera = camera;
  if (waste === 'on' || waste === 'off') l.waste = waste === 'on';
  return l;
}
const link = readLink();
const debug = new URLSearchParams(location.search).has('debug');

// ---- the volume view ----------------------------------------------------------------------------------------------------
const stock = (id: string) => RENDERERS.find((r) => r.id === id)!;
const VIEWS: Record<ViewId, ApproachEntry> = {
  particles: { id: 'particles', title: 'Particles and haze (default)', text: 'Every particle as a lit bead at its true position, coloured by family, inside a haze of trail (violet) and waste (dark), with the water as bright as the light that reaches it.', load: async () => createParticleHaze(store) },
  raymarch: { ...stock('raymarch'), title: 'Cells, ray-marched', text: 'Each cell that holds particles as a glowing body in the colour of its heaviest particle, and trail as a blue haze. Coarser, but shows where bodies crowd.' },
  slices: { ...stock('slices'), title: 'Slices', text: 'Three flat cuts drawn exactly as packed, one on the top layer left by the peel. Plain on purpose: the check that particles are in the right layers.' },
};
const MENU: ApproachEntry[] = VIEW_IDS.map((id) => VIEWS[id]);
const volume = new VolumeView($<HTMLCanvasElement>('volume-canvas'), syncPeel, MENU);
volume.renderer = link.renderer ?? VIEW_IDS[0];

function syncPeel() {
  const max = Math.max(0, (volume.layers || (cfg?.depth ?? 16)) - 1);
  const peel = $<HTMLInputElement>('peel');
  peel.max = String(max);
  if (volume.peel > max) volume.peel = max;
  peel.value = String(volume.peel);
  setText('peel-out', String(volume.peel));
}

function volumeCaption(c: Census) {
  if (!cfg) return;
  const k = volume.stretch;
  setText('volume-cap', `The whole jar at step ${fmt(c.step)}: ${cfg.width} by ${cfg.height} cells across and ${cfg.depth} deep, layer 0 (the surface, where light enters) on top${k === 1 ? '' : `, each layer drawn ${k} times as tall as a viewing aid`}. ` +
    'Each bead is a particle in its family colour; violet haze is trail, dark haze is waste, and the water is brighter where more light reaches. ' +
    'Drag to turn it, the wheel or a pinch zooms, shift-drag moves it; with the picture focused, the arrow keys turn it and + and - zoom.');
  $('volume-canvas').setAttribute('aria-label', `The jar in 3D at step ${fmt(c.step)}: ${fmt(c.particles)} particles in ${cfg.depth} layers`);
}

let serial = 0;
interface Opt { value: string; title: string; text: string }
function radios(host: HTMLElement, name: string, opts: Opt[], checked: string, onChange: (v: string) => void) {
  host.replaceChildren();
  for (const o of opts) {
    const id = `r-${name}-${serial++}`;
    const label = document.createElement('label');
    label.className = 'm3-opt';
    const input = document.createElement('input');
    input.type = 'radio'; input.name = name; input.value = o.value; input.checked = o.value === checked;
    input.setAttribute('aria-describedby', `${id}-d`);
    input.addEventListener('change', () => { if (input.checked) onChange(o.value); });
    const t = document.createElement('span'); t.className = 't'; t.textContent = o.title;
    const d = document.createElement('span'); d.className = 'd'; d.id = `${id}-d`; d.textContent = o.text;
    label.append(input, t, d);
    host.append(label);
  }
}

let lookSeq = 0;
async function renderLook() {
  const host = $('volume-params');
  const seq = ++lookSeq; // a slower, earlier call must not rebuild the panel over a newer renderer's controls
  let all: ParamSpec[];
  try { all = await volume.specs(); } catch (e) { if (seq === lookSeq) setText('status', `The view's settings could not load (${errMsg(e)}).`); return; }
  if (seq !== lookSeq) return;
  // The waste haze has its own checkbox on the page; the rest are this renderer's own settings.
  const specs: ParamSpec[] = all.filter((p) => p.key !== 'waste')
    .map((p) => {
      if (volume.renderer === 'raymarch' && RAYMARCH_WORDS[p.key]) return { ...p, ...RAYMARCH_WORDS[p.key] };
      if (volume.renderer === 'slices' && p.key === 'view' && p.kind === 'select') {
        return { ...p, hint: 'What the planes display. Colour is the packed picture; the others show one channel so you can check it: the light plane, the trail, or particle density alone.', options: p.options.map((o) => (o.value === 'nutrient' ? { ...o, label: 'Trail' } : o)) };
      }
      return p;
    });
  host.replaceChildren();
  for (const p of specs) {
    const id = `look-${p.key}-${serial++}`;
    const hint = document.createElement('p');
    hint.className = 'fine'; hint.id = `${id}-d`; hint.textContent = p.hint;
    let input: HTMLInputElement | HTMLSelectElement;
    if (p.kind === 'select') {
      const sel = document.createElement('select');
      for (const o of p.options) { const op = document.createElement('option'); op.value = o.value; op.textContent = o.label; sel.append(op); }
      sel.value = p.value;
      sel.addEventListener('change', () => volume.setParam(p.key, sel.value));
      input = sel;
    } else {
      const inp = document.createElement('input');
      if (p.kind === 'toggle') {
        inp.type = 'checkbox'; inp.checked = p.value;
        inp.addEventListener('change', () => volume.setParam(p.key, inp.checked));
      } else {
        inp.type = 'range'; inp.min = String(p.min); inp.max = String(p.max); inp.step = String(p.step); inp.value = String(p.value);
        inp.addEventListener('input', () => volume.setParam(p.key, Number(inp.value)));
      }
      input = inp;
    }
    input.id = id;
    input.setAttribute('aria-describedby', hint.id);
    const label = document.createElement('label');
    label.htmlFor = id; label.textContent = p.label;
    if (p.kind === 'toggle') {
      const row = document.createElement('div');
      row.className = 'check';
      row.append(input, label);
      host.append(row, hint);
    } else host.append(label, input, hint);
  }
}

function renderViewControls() {
  radios($('o-renderer'), 'renderer', MENU.map((r) => ({ value: r.id, title: r.title, text: r.text })), volume.renderer, (v) => {
    volume.setRenderer(v);
    applyWaste();
    void renderLook();
  });
  const poses = $('camera-poses');
  for (const [id, p] of Object.entries(PRESETS)) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'button quiet'; b.textContent = POSES[id]?.label ?? p.label; b.dataset.pose = id;
    b.setAttribute('aria-describedby', 'camera-help');
    b.addEventListener('click', () => { volume.setPose(id); setText('camera-help', POSES[id]?.hint ?? p.hint); });
    poses.append(b);
  }
  const pose = link.camera ?? 'oblique';
  if (link.camera) volume.setPose(link.camera);
  setText('camera-help', `Jump to a view. ${POSES[pose]?.hint ?? PRESETS[pose]!.hint}`);
  if (link.stretch !== undefined) {
    volume.setStretch(link.stretch);
    $<HTMLInputElement>('stretch').value = String(volume.stretch);
    setText('stretch-out', String(volume.stretch));
  }
  syncPeel();
  void renderLook();
}

/** The volume view's camera poses, described for this jar. */
const POSES: Record<string, { label: string; hint: string }> = {
  oblique: { label: 'Above, at an angle', hint: 'Looking down at the surface from the side: the lit top of the jar and, through its walls, the layers below.' },
  above: { label: 'Straight down', hint: 'Looking down from where the light comes in: the surface as the light meets it.' },
  side: { label: 'Level with the jar', hint: 'Edge on: every layer from the surface (top) to the floor (bottom). The best view of where particles and waste sit in depth.' },
  below: { label: 'From below', hint: 'Looking up through the floor, where sunk waste and the dimmest light are.' },
};

/** The stock ray march's settings, renamed for what its channels hold on this page (aux.r is trail here, not nutrient). */
const RAYMARCH_WORDS: Record<string, { label: string; hint: string }> = {
  thickness: { label: 'Body thickness', hint: 'How solid the cells holding particles look. Low is a glowing cloud; high is opaque bodies that hide what is behind them.' },
  haze: { label: 'Water and trail haze', hint: 'The blue fog of the water and the trail in it. More shows where trail lies and gives a sense of depth; less is crisper.' },
};

function applyWaste() { volume.setParam('waste', $<HTMLInputElement>('show-waste').checked); }

// ---- engines ------------------------------------------------------------------------------------------------------------

async function getDevice(): Promise<GPUDevice | null> {
  if (device) return device;
  if (!('gpu' in navigator) || !navigator.gpu) { noGpuWhy = 'This browser does not offer WebGPU.'; return null; }
  try {
    const dev = await mycelium3dDevice();
    dev.addEventListener('uncapturederror', (ev) => {
      const message = (ev as GPUUncapturedErrorEvent).error.message;
      document.body.dataset.gpuError = message;
      if (device === dev) { stop(); setText('status', `The GPU reported an error and the run is stopped: ${message}`); }
    });
    void dev.lost.then((info) => {
      if (device !== dev) return;
      device = null;
      noGpuWhy = `The GPU was lost (${(info.message || info.reason).replace(/\.$/, '')}).`;
      if (engine === 'gpu') { stop(); sim = null; void plant(); }
    });
    device = dev;
    volume.attach(dev);
    return dev;
  } catch (e) {
    noGpuWhy = `WebGPU could not start (${errMsg(e)}).`;
    return null;
  }
}

function engineText(why = '') {
  const e = $('engine-now');
  e.dataset.engine = engine ?? '';
  const dims = cfg ? `${cfg.width} × ${cfg.height} × ${cfg.depth}` : '';
  setText('engine-now', engine === 'gpu'
    ? `Running on your GPU (WebGPU), a ${dims} jar. The census, the ledger check and the picture come from a full read-back at most four times a second, packed on the CPU into the 3D view.`
    : `Running on the CPU reference, a ${dims} jar: the specification itself, slower, and at the default size only.${why ? ` ${why}` : ''} The 3D view needs WebGPU, so the picture is a flat side view.`);
  setText('audit-note', engine === 'gpu'
    ? 'Numbers and both residuals come from each full read-back of the GPU state; the page stops if either residual is ever not 0.'
    : 'The CPU reference checks both ledgers after every single step; the numbers here refresh about four times a second.');
  $('gpu-fig').hidden = engine !== 'gpu';
  $('view-controls').hidden = engine !== 'gpu';
  $('cpu-fig').hidden = engine !== 'cpu';
  volume.setActive(engine === 'gpu');
}

/** Waits for the GPU engine's queued steps and any read-back in flight. */
async function settle() {
  await pending?.catch(() => undefined);
  await reading?.catch(() => undefined);
}

function readChoice(): Choice {
  const size = $<HTMLSelectElement>('size').value, sink = $<HTMLSelectElement>('sink').value, trail = $<HTMLSelectElement>('trail').value, bonds = $<HTMLSelectElement>('bonds').value;
  const seed = Math.max(0, Math.min(0xffffffff, Math.floor(Number($<HTMLInputElement>('seed').value) || 0)));
  return { size: isSize(size) ? size : DEFAULT_CHOICE.size, sink: isSink(sink) ? sink : DEFAULT_CHOICE.sink, trail: isTrail(trail) ? trail : DEFAULT_CHOICE.trail, bonds: isBonds(bonds) ? bonds : DEFAULT_CHOICE.bonds, seed };
}

let planting = 0;
async function plant(): Promise<void> {
  planting++; // Play stays enabled (start() waits out a plant), so the controls a keyboard reaches never change under it
  try {
    await exclusive(async () => {
      stop();
      gen++;
      await settle();
      let c = readChoice();
      let why = '';
      let dev = await getDevice();
      if (!dev) why = noGpuWhy;
      let next: GpuMycelium3d | null = null;
      if (dev) {
        try {
          next = await GpuMycelium3d.create(dev, worldConfig(c));
        } catch (e) {
          dev = null;
          why = `The GPU engine could not start (${errMsg(e)}).`;
        }
      }
      worldEpoch++; // here, where the world is replaced: a stroke queued behind this plant is then dropped
      swapSim(next);
      world = null;
      if (next) {
        engine = 'gpu';
      } else {
        engine = 'cpu';
        if (c.size !== '32x32x16') { c = { ...c, size: '32x32x16' }; $<HTMLSelectElement>('size').value = c.size; }
        world = createWorld(worldConfig(c));
      }
      choice = c;
      cfg = engine === 'gpu' ? next!.config : world!.config;
      queuedSteps = 0; marks = []; last = null; lastState = null; lastLight = null; lastBonds = null;
      stats.msPerStep = 0; stats.reads = 0; autoK = 8;
      volume.clear();
      store.inst = null; store.links = null; store.version++;
      $('bond-census').hidden = cfg.bondBreak === undefined;
      fitCursor();
      engineText(why);
      setTool(tool);
      sizeHelp();
      fillPaces();
      await readAndShow(gen);
      if (link.peel !== undefined) { volume.peel = Math.min(link.peel, cfg.depth - 1); link.peel = undefined; syncPeel(); volume.request(); }
      setText('status', `Planted ${fmt(cfg.founders)} founders with random controllers: ${describeChoice(c)}. Most founders die; watch which families spread, and where.`);
      document.body.dataset.ready = '1';
    });
  } catch (e) {
    setText('status', `Could not plant: ${errMsg(e)}`);
  } finally {
    planting--;
  }
}

/** Puts a new GPU world in place of the current one and destroys the old one's buffers (Plant and every GPU stroke). The
 *  renderer holds nothing of a sim (each read-back is packed on the CPU), so nothing else needs to follow. */
function swapSim(next: GpuMycelium3d | null) {
  if (sim && sim !== next) sim.destroy();
  sim = next;
}

/** One read-back (GPU) or a look at the live state (CPU): census, ledger check, picture. Dropped if the world changed. */
async function readAndShow(g: number): Promise<void> {
  const t0 = performance.now();
  const s = engine === 'gpu' ? await sim!.read() : world!;
  if (g !== gen) return;
  const t1 = performance.now();
  const I = lightPlane(s);
  const c = census(s, I);
  // only with bonds: the links for both views and the bond census (no allocation or pass without them)
  const l = s.bond0 ? packLinks(s, links) : null;
  if (l) links = l;
  lastBonds = s.bond0 ? bondReadout(s) : null;
  if (engine === 'gpu') {
    packed = packField(s, I, {}, packed);
    inst = packParticles(s, I, inst);
    store.inst = inst; store.links = l; store.version++;
    volume.uploadPacked(packed);
    volumeCaption(c);
  } else {
    drawSide($<HTMLCanvasElement>('side-canvas'), s, I, $<HTMLInputElement>('show-waste').checked, l);
  }
  const t2 = performance.now();
  if (engine === 'gpu') stats.readMs = stats.reads ? stats.readMs * 0.7 + (t1 - t0) * 0.3 : t1 - t0;
  stats.packMs = stats.reads ? stats.packMs * 0.7 + (t2 - t1) * 0.3 : t2 - t1;
  stats.reads++;
  stats.readEveryMs = Math.max(READ_MS, Math.round(4 * (stats.readMs + stats.packMs)));
  lastReadAt = performance.now();
  last = c; lastState = s; lastLight = I;
  publish(c);
  publishBonds(c);
  showCursor();
  if (c.matterResidual !== 0 || c.energyResidual !== 0) {
    stop();
    setText('status', `Stopped: a ledger residual appeared at step ${fmt(c.step)}. This is a bug in the rules; please report the seed and choices.`);
  } else if (c.particles === 0 && c.step > 0) {
    stop();
    setText('status', `Every particle is gone at step ${fmt(c.step)}. Plant again, or try another seed.`);
  }
}

// ---- readouts ------------------------------------------------------------------------------------------------------------

function publish(c: Census) {
  setText('r-step', fmt(c.step));
  setText('r-n', fmt(c.particles));
  setText('r-g', fmt(c.families));
  setText('r-m', fmt(c.matterResidual));
  setText('r-e', fmt(c.energyResidual));
  setText('r-t', stats.msPerStep ? `${stats.msPerStep.toFixed(stats.msPerStep < 1 ? 2 : 1)} ms` : '–');
  const lastMark = marks[marks.length - 1];
  if (!lastMark || lastMark.step !== c.step) {
    marks.push({ step: c.step, births: c.births, deaths: c.deaths, refused: c.refused });
    if (marks.length > 400) marks = marks.filter((_, i) => i % 2 === 0 || i === marks.length - 1);
  }
  let base = marks[0]!;
  for (const m of marks) if (m.step <= c.step - 100) base = m; else break;
  const r = ratePer100(base, c);
  setText('r-b', r ? fmt(r.births) : '–');
  setText('r-d', r ? fmt(r.deaths) : '–');
  setText('r-f', r ? fmt(r.refused) : '–');
  const body = $('depth-rows');
  const rows = c.groups.map((g) => {
    const tr = document.createElement('tr');
    const cell = (v: string, head = false) => { const td = document.createElement(head ? 'th' : 'td'); if (head) td.setAttribute('scope', 'row'); td.textContent = v; return td; };
    const light = cell(`${(g.light * 100).toFixed(g.light < 0.1 ? 1 : 0)}%`);
    tr.append(cell(g.z0 === g.z1 ? `${g.z0}` : `${g.z0}–${g.z1}`, true), cell(fmt(g.particles)), cell(compact(g.M)), cell(compact(g.A)), cell(compact(g.C)), cell(compact(g.P)), light);
    return tr;
  });
  body.replaceChildren(...rows);
}

function publishBonds(c: Census) {
  const b = lastBonds;
  if (!b) return;
  const share = c.particles ? (100 * b.bonded) / c.particles : 0;
  setText('r-bonded', `${fmt(b.bonded)} (${share.toFixed(share < 10 && share > 0 ? 1 : 0)}%)`);
  setText('r-bonds', fmt(b.bonds));
  setText('r-bodies', fmt(b.bodies));
  setText('r-largest', b.bodies ? fmt(b.largest) : '–');
}

function statusLine() {
  if (!last) return;
  const sps = stats.msPerStep ? Math.round(1000 / stats.msPerStep) : 0;
  const rb = engine === 'gpu' ? ` · read-back every ${stats.readEveryMs} ms (read ${stats.readMs.toFixed(0)} ms, census and pack ${stats.packMs.toFixed(0)} ms)` : ` · census every ${READ_MS} ms (${stats.packMs.toFixed(0)} ms)`;
  setText('status', `Running · step ${fmt(last.step)} · ${fmt(sps)} steps/s${rb} · frame ${stats.frameMs.toFixed(0)} ms`);
}

// ---- running ------------------------------------------------------------------------------------------------------------

function paceSteps(): number {
  const id = $<HTMLSelectElement>('pace').value;
  const p = PACES.find((x) => x.id === id) ?? PACES[1];
  return p.steps || autoK;
}

/** One CPU step with the ledger check after it. Returns false when the run should stop. */
function advanceCpu(): boolean {
  const w = world!;
  const t0 = performance.now();
  step(w);
  stats.msPerStep = stats.msPerStep ? stats.msPerStep * 0.9 + (performance.now() - t0) * 0.1 : performance.now() - t0;
  const dm = matterTotal(w) - w.matter0, de = energyTotal(w) - (w.energy0 + w.totals.lightIn - w.totals.heat);
  return dm === 0 && de === 0 && w.n > 0;
}

function frame(lg: number) {
  if (!running || lg !== loopGen) return;
  const now = performance.now();
  if (lastFrameAt) stats.frameMs = stats.frameMs ? stats.frameMs * 0.9 + (now - lastFrameAt) * 0.1 : now - lastFrameAt;
  lastFrameAt = now;
  if (exclusiveDepth === 0) {
    const g = gen;
    if (engine === 'gpu' && sim) {
      const s = sim;
      if (!pending) {
        const k = paceSteps();
        const t0 = performance.now();
        s.step(k);
        queuedSteps += k;
        pending = s.sync().then(() => {
          const ms = performance.now() - t0;
          stats.msPerStep = stats.msPerStep ? stats.msPerStep * 0.8 + (ms / k) * 0.2 : ms / k;
          if ($<HTMLSelectElement>('pace').value === 'max') autoK = Math.max(1, Math.min(512, Math.round((autoK * 14) / Math.max(1, ms))));
        }, () => undefined).finally(() => { pending = null; });
      }
      if (!reading && now - lastReadAt > stats.readEveryMs) {
        reading = readAndShow(g).catch((e) => { stop(); setText('status', `Read-back failed and the run is stopped: ${errMsg(e)}`); }).finally(() => { reading = null; });
      }
    } else if (engine === 'cpu' && world) {
      let ok = true;
      if ($<HTMLSelectElement>('pace').value === 'max') { while (ok && performance.now() - now < 14) ok = advanceCpu(); }
      else for (let k = 0; k < paceSteps() && ok; k++) ok = advanceCpu();
      if (!ok) stop();
      if (!ok || now - lastReadAt > READ_MS) void readAndShow(g);
      if (!ok) return;
    }
    if (running) statusLine();
  }
  requestAnimationFrame(() => frame(lg));
}

function start() {
  if (running || !engine || planting > 0 || (last && last.particles === 0)) return;
  running = true;
  lastFrameAt = 0;
  const lg = ++loopGen;
  syncPlay();
  requestAnimationFrame(() => frame(lg));
}

function stop() {
  running = false;
  loopGen++;
  syncPlay();
}

function syncPlay() {
  const b = $('play');
  b.textContent = running ? 'Pause' : 'Play';
  b.setAttribute('aria-pressed', String(running));
}

/** Steps the current world to `target`, or one step past wherever it is when the queue reaches this call, then reads it back. */
function stepTo(target: number | 'next'): Promise<void> {
  stop();
  return exclusive(async () => {
    const g = gen;
    // Taken inside the queue: a step clicked while a plant is queued or running steps the new world, not the old one's step + 1.
    const want = target === 'next' ? currentStep() + 1 : target;
    if (engine === 'gpu' && sim) {
      await settle();
      while (queuedSteps < want && g === gen) {
        const k = Math.min(256, want - queuedSteps);
        const t0 = performance.now();
        sim.step(k);
        queuedSteps += k;
        await sim.sync();
        const ms = performance.now() - t0;
        stats.msPerStep = stats.msPerStep ? stats.msPerStep * 0.8 + (ms / k) * 0.2 : ms / k;
      }
    } else if (engine === 'cpu' && world) {
      while (world.step < want && advanceCpu());
    }
    if (g === gen) await readAndShow(g);
  });
}
const currentStep = () => (engine === 'gpu' ? queuedSteps : world?.step ?? 0);

// ---- choices --------------------------------------------------------------------------------------------------------------

function fillSelect(id: string, opts: { value: string; text: string }[], value: string) {
  const sel = $<HTMLSelectElement>(id);
  sel.replaceChildren(...opts.map((o) => { const op = document.createElement('option'); op.value = o.value; op.textContent = o.text; return op; }));
  sel.value = value;
}

function fillPaces() {
  const keep = $<HTMLSelectElement>('pace').value || '4';
  fillSelect('pace', PACES.map((p) => ({ value: p.id, text: p.title })), keep);
}

function sizeHelp() {
  const id = $<HTMLSelectElement>('size').value as SizeId;
  const s = SIZES[id] ?? SIZES[DEFAULT_CHOICE.size];
  const c = worldConfig({ ...choice, size: id });
  const cpu = engine === 'cpu' ? ' On the CPU reference only the default size runs; the bigger ones need WebGPU.' : '';
  setText('size-help', `${fmt(c.width * c.height * c.depth)} cells, ${fmt(c.founders)} founders, room for ${fmt(c.maxParticles)} particles. ${s.text}${cpu}`);
}

function fillChoices() {
  const c = { ...DEFAULT_CHOICE, ...link.choice };
  fillSelect('size', Object.entries(SIZES).map(([value, s]) => ({ value, text: s.title })), c.size);
  fillSelect('sink', Object.entries(SINKS).map(([value, s]) => ({ value, text: s.title })), c.sink);
  fillSelect('trail', Object.entries(TRAILS).map(([value, s]) => ({ value, text: s.title })), c.trail);
  fillSelect('bonds', Object.entries(BONDS).map(([value, s]) => ({ value, text: s.title })), c.bonds);
  if (link.choice.seed !== undefined) $<HTMLInputElement>('seed').value = String(c.seed);
  fillPaces();
  const help = () => {
    sizeHelp();
    const sink = $<HTMLSelectElement>('sink').value, trail = $<HTMLSelectElement>('trail').value, bonds = $<HTMLSelectElement>('bonds').value;
    setText('sink-help', isSink(sink) ? SINKS[sink].text : '');
    setText('trail-help', isTrail(trail) ? TRAILS[trail].text : '');
    setText('bonds-help', isBonds(bonds) ? BONDS[bonds].text : '');
  };
  for (const id of ['size', 'sink', 'trail', 'bonds']) $(id).addEventListener('change', help);
  help();
}

// ---- the tools: Look, Wound and Feed ----------------------------------------------------------------------------------------

type Tool = 'look' | 'wound' | 'feed';
const TOOLS: { value: Tool; title: string; text: string }[] = [
  { value: 'look', title: 'Look', text: 'Dragging turns the jar. Nothing in the world changes.' },
  { value: 'wound', title: 'Wound', text: 'Removes every particle in a small sphere. Their bodies stay in the jar as waste where they stood, their energy is booked as heat, and any bond to them is cut.' },
  { value: 'feed', title: 'Feed', text: 'A flash of light in a small sphere: it turns waste already there into food. It adds nothing, so in clean water it does nothing, and the matter in the jar is the same before and after.' },
];
/** The feed's strengths: how much waste at most becomes food in each cell. Unshaded surface light converts `light` (1) a step. */
const FEEDS = [
  { amount: 16, title: 'A glimmer: up to 16 waste per cell', text: 'Up to 16 waste in each cell becomes food, as much as a surface cell in full, unshaded light converts in 16 steps. A gentle nudge.' },
  { amount: 256, title: 'Daylight: up to 256 waste per cell', text: 'Up to 256 waste in each cell becomes food. Clears the thin waste that drifts through the water; a heap on the floor keeps some.' },
  { amount: FEED_AMOUNT_MAX, title: `A flash: up to ${fmt(FEED_AMOUNT_MAX)} waste per cell`, text: `Up to ${fmt(FEED_AMOUNT_MAX)} waste in each cell becomes food, the most one stroke may. On almost every cell that is all the waste there.` },
] as const;
const PRESS_SLOP = 6; // CSS pixels a press may move and still count as a click, not a drag
const PICK_PX = 5; // how near the pointer must pass a bead to snap to it

let tool: Tool = 'look';
/** The committed cursor: the cell the inputs show and Apply uses. */
const cursor: Cell & { r: number } = { x: 16, y: 16, z: 0, r: 2 };
/** Where the pointer hovers (a preview only), or null. */
let hover: Cell | null = null;
let lastReport: BrushReport3d | null = null;
let strokes = 0;

function viewClip(): ViewClip | null {
  if (!cfg) return null;
  const dims = { W: cfg.width, H: cfg.height, D: cfg.depth };
  return { ext: boxExtent(dims, volume.stretch), dims, peel: volume.peel, cut: volume.cut };
}
/** Whether the view shows a cell; on the CPU engine (a flat side view, no peel or cut) every cell counts as shown. */
const cellShown = (c: Cell) => { const v = viewClip(); return engine !== 'gpu' || !v || isShown(v, c); };

/** Keeps the cursor inside a newly planted world (the centre when the size changed) and the inputs' ranges in step. */
function fitCursor() {
  if (!cfg) return;
  const fit = (id: string, max: number) => { const i = $<HTMLInputElement>(id); i.max = String(max); };
  if (cursor.x >= cfg.width || cursor.y >= cfg.height || cursor.z >= cfg.depth) { cursor.x = cfg.width >> 1; cursor.y = cfg.height >> 1; cursor.z = 0; }
  fit('cur-x', cfg.width - 1); fit('cur-y', cfg.height - 1); fit('cur-z', cfg.depth - 1);
  hover = null;
  syncCursorInputs();
}

function syncCursorInputs() {
  const put = (id: string, v: number) => { const i = $<HTMLInputElement>(id); if (i.value !== String(v)) i.value = String(v); };
  put('cur-x', cursor.x); put('cur-y', cursor.y); put('cur-z', cursor.z); put('cur-r', cursor.r);
  setText('cur-r-out', String(cursor.r));
}

/** The readout under the inputs (where the cursor is and what its sphere holds in the last read-back), and the sphere drawn. */
function showCursor() {
  if (!cfg) return;
  const at = hover ?? cursor;
  const shownNow = cellShown(at);
  const where = `${hover ? 'Pointing at' : 'Cursor at'} cell x ${at.x}, y ${at.y}, layer ${at.z} of 0 to ${cfg.depth - 1} (0 is the surface)`;
  let text: string;
  if (!shownNow) {
    text = `${where}. That cell is peeled or cut away in the view, so the tool will not act there: pick a layer from ${volume.peel} down, or lower the peel or widen the cut.`;
  } else if (!lastState) {
    text = `${where}, radius ${cursor.r}.`;
  } else {
    const sum = sphereSummary(lastState, at, cursor.r);
    const dry = sum.dryCells === sum.cells ? 'none of them holds waste' : `${fmt(sum.waste)} waste${sum.dryCells ? ` (${fmt(sum.dryCells)} of the cells ${sum.dryCells === 1 ? 'holds' : 'hold'} none)` : ''}`;
    text = `${where}, radius ${cursor.r}: ${fmt(sum.cells)} cells holding ${fmt(sum.particles)} ${sum.particles === 1 ? 'particle' : 'particles'} and ${dry}, at step ${fmt(lastState.step)}.`;
  }
  const r = $('cur-readout');
  setText('cur-readout', text);
  r.dataset.hidden = shownNow ? '0' : '1';
  const want = tool !== 'look' && engine === 'gpu' && shownNow ? { x: at.x, y: at.y, z: at.z, r: cursor.r, kind: tool } : null;
  const had = store.cursor;
  if (JSON.stringify(had) !== JSON.stringify(want)) { store.cursor = want; volume.request(); }
}

function setTool(t: Tool) {
  tool = t;
  $('brush').hidden = t === 'look';
  $('feed-field').hidden = t !== 'feed';
  $('volume-canvas').dataset.tool = t;
  setText('apply', t === 'feed' ? 'Feed here' : 'Wound here');
  setText('tool-help', t === 'look' ? '' : (engine === 'gpu'
    ? `Click or tap the picture to ${t === 'wound' ? 'wound' : 'feed'} where you point; dragging still turns the jar. The red block in the picture is the tool's sphere drawn cell by cell: exactly the cells a stroke reaches, with a bead in the centre cell; where beads are in front of it, it shows faintly through them. It is drawn in the particles and haze way of drawing; the others show neither the block nor the beads to point at, so there the cursor sits on the working layer. Or set the cell below and press ${t === 'feed' ? 'Feed here' : 'Wound here'}. The centre must be in the part of the jar you can see; the sphere itself can reach into peeled or cut-away cells.`
    : `The flat side view cannot be pointed at, so set the cell below and press ${t === 'feed' ? 'Feed here' : 'Wound here'}.`));
  hover = null;
  showCursor();
}

/** Words for a stroke's report, from the BrushReport3d. */
function reportText(r: BrushReport3d, c: Census | null): string {
  const where = `at step ${fmt(r.step)}, cell x ${r.cx}, y ${r.cy}, layer ${r.cz}, radius ${r.radius}`;
  const books = c ? ` Matter residual ${fmt(c.matterResidual)}, energy residual ${fmt(c.energyResidual)}.` : '';
  if (r.kind === 'wound') {
    if (r.removed === 0) return `Wound ${where}: no particle stood in its ${fmt(r.cells)} cells, so nothing changed.${books}`;
    const bonds = cfg?.bondBreak !== undefined ? `; ${fmt(r.bondsCut)} ${r.bondsCut === 1 ? 'bond' : 'bonds'} cut` : '';
    return `Wound ${where}: removed ${fmt(r.removed)} ${r.removed === 1 ? 'particle' : 'particles'}; ${fmt(r.matterMoved)} matter went to waste, ${fmt(r.heatBooked)} energy to heat${bonds}.${books}`;
  }
  if (r.matterMoved === 0) return `Feed ${where}: none of its ${fmt(r.cells)} cells held waste, so nothing was turned into food.${books}`;
  return `Feed ${where}: turned ${fmt(r.matterMoved)} waste into food in ${fmt(r.cells - r.cellsWithoutWaste)} cells; ${fmt(r.cellsWithoutWaste)} cells had no waste. ${fmt(r.lightBooked)} energy booked as light.${books}`;
}

/**
 * One stroke, through the serial queue. GPU: read the world back, brush that copy, make a new GpuMycelium3d from it and destroy
 * the old one; CPU: brush the live state. A refused stroke (RangeError, or a state the rules reject) changes nothing. Either
 * way the world is read back at once, under a new generation, so a read-back begun before the stroke is dropped.
 */
function brush(stroke: BrushStroke3d, epoch?: number): Promise<BrushReport3d> {
  return exclusive(async () => {
    if (!engine || !cfg) throw new Error('there is no world yet');
    if (epoch !== undefined && epoch !== worldEpoch) throw new Error('a new world was planted before this stroke ran, so it was dropped');
    const g = ++gen;
    let report: BrushReport3d;
    try {
      if (engine === 'gpu' && sim && device) {
        await settle();
        const s = await sim.read();
        report = applyBrush3d(s, stroke);
        const bad = validateState(s);
        if (bad.length) throw new Error(`the stroke would break the books (${bad[0]}); nothing was changed`);
        swapSim(await GpuMycelium3d.create(device, s));
      } else if (engine === 'cpu' && world) {
        report = applyBrush3d(world, stroke);
        const bad = validateState(world);
        if (bad.length) { stop(); throw new Error(`the stroke broke the books (${bad[0]})`); }
      } else throw new Error('the world is not ready');
    } catch (e) {
      if (g === gen) await readAndShow(g);
      throw e;
    }
    await readAndShow(g);
    strokes++;
    lastReport = report;
    return report;
  });
}

/** Uses the tool at the committed cursor (Apply, or a click that set it), and says what happened. */
async function useTool(): Promise<void> {
  if (tool === 'look' || !cfg) return;
  if (planting) { setText('brush-report', 'Not applied: a new world is being planted. Try again when it is in the jar.'); return; }
  const at = { x: cursor.x, y: cursor.y, z: cursor.z };
  if (!cellShown(at)) {
    setText('brush-report', `Not applied: cell x ${at.x}, y ${at.y}, layer ${at.z} is peeled or cut away in the view. Pick a cell you can see, or lower the peel or widen the cut. The world is as it was.`);
    return;
  }
  const amount = Number($<HTMLSelectElement>('feed-amount').value) || FEEDS[1].amount;
  try {
    const r = await brush({ kind: tool, cx: at.x, cy: at.y, cz: at.z, radius: cursor.r, ...(tool === 'feed' ? { amount } : {}) }, worldEpoch);
    setText('brush-report', reportText(r, last));
  } catch (e) {
    setText('brush-report', `Not applied: ${errMsg(e)}. The world is as it was.`);
  }
}

/** Reads a whole number from an input, held to [0, max]; null while the box is empty or not a number. */
function readInt(id: string, max: number): number | null {
  const raw = $<HTMLInputElement>(id).value;
  if (raw.trim() === '' || !Number.isFinite(Number(raw))) return null;
  return Math.max(0, Math.min(max, Math.round(Number(raw))));
}

function onCursorInput() {
  if (!cfg) return;
  const x = readInt('cur-x', cfg.width - 1), y = readInt('cur-y', cfg.height - 1), z = readInt('cur-z', cfg.depth - 1);
  if (x !== null) cursor.x = x;
  if (y !== null) cursor.y = y;
  if (z !== null) cursor.z = z;
  hover = null;
  showCursor();
}

/** The cell under a pointer event by the depth rule (cursor.ts), or null where the view shows nothing of the jar. */
function cellAtPointer(e: PointerEvent | MouseEvent): Cell | null {
  const v = viewClip();
  const cv = $<HTMLCanvasElement>('volume-canvas');
  if (!v || engine !== 'gpu') return null;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return null;
  const rect = cv.getBoundingClientRect();
  const px = e.clientX - rect.left - cv.clientLeft, py = e.clientY - rect.top - cv.clientTop;
  // the camera exactly as the view draws it: aspect from the drawing buffer, as paint() sizes it
  const info = volume.cam.info(cv.width && cv.height ? cv.width / cv.height : w / h);
  const ray = pointerRay(info.invViewProj, (px / w) * 2 - 1, 1 - (py / h) * 2);
  const tol = (PICK_PX * 2 * Math.tan(info.fovY / 2)) / h;
  const size = Number(volume.paramsOf('particles').size ?? 1);
  const hit = cursorFromRay(ray, volume.renderer === 'particles' ? lastState : null, v, cursor.z, tol, size);
  return hit ? hit.cell : null;
}

function renderTools() {
  radios($('o-tool'), 'tool', TOOLS, tool, (v) => setTool(v as Tool));
  fillSelect('feed-amount', FEEDS.map((f) => ({ value: String(f.amount), text: f.title })), String(FEEDS[1].amount));
  const feedHelp = () => setText('feed-help', FEEDS.find((f) => String(f.amount) === $<HTMLSelectElement>('feed-amount').value)?.text ?? '');
  $('feed-amount').addEventListener('change', feedHelp);
  feedHelp();
  for (const id of ['cur-x', 'cur-y', 'cur-z']) $(id).addEventListener('input', onCursorInput);
  $<HTMLInputElement>('cur-r').addEventListener('input', (e) => { cursor.r = Number((e.target as HTMLInputElement).value); setText('cur-r-out', String(cursor.r)); showCursor(); });
  $('apply').addEventListener('click', () => { void useTool(); });

  // Pointing. The camera's own handlers (view.ts) orbit on every drag; these only watch: a press that stays within a few
  // pixels, with the main button, no shift and no second finger, is a click and uses the tool at the cell it began on.
  const cv = $<HTMLCanvasElement>('volume-canvas');
  const down = new Set<number>();
  let press: { id: number; x: number; y: number; cell: Cell | null; far: boolean } | null = null;
  cv.addEventListener('pointerdown', (e) => {
    down.add(e.pointerId);
    if (down.size > 1) { press = null; return; }
    press = tool !== 'look' && e.button === 0 && !e.shiftKey ? { id: e.pointerId, x: e.clientX, y: e.clientY, cell: cellAtPointer(e), far: false } : null;
  });
  cv.addEventListener('pointermove', (e) => {
    if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > PRESS_SLOP) press.far = true;
    if (tool !== 'look' && e.buttons === 0 && e.pointerType !== 'touch') { hover = cellAtPointer(e); showCursor(); }
  });
  const end = (e: PointerEvent, cancelled: boolean) => {
    down.delete(e.pointerId);
    const p = press;
    if (!p || p.id !== e.pointerId) return;
    press = null;
    if (cancelled || p.far || tool === 'look') return;
    if (!p.cell) { setText('brush-report', 'Not applied: no part of the jar you can see is under the pointer there. The world is as it was.'); return; }
    Object.assign(cursor, p.cell);
    hover = null;
    syncCursorInputs();
    showCursor();
    void useTool();
  };
  cv.addEventListener('pointerup', (e) => end(e, false));
  cv.addEventListener('pointercancel', (e) => end(e, true));
  // A capture lost without an up or a cancel (the finger lifts outside after the browser took the capture away) must not leave
  // its id in `down`: every later tap would then look like a second finger and never apply.
  cv.addEventListener('lostpointercapture', (e) => end(e, true));
  cv.addEventListener('pointerleave', () => { if (hover) { hover = null; showCursor(); } });
}

/** Debug and tests: a cell of a kind in the last read-back (null if none). */
function findCell(kind: 'particle' | 'waste' | 'clean' | 'bonded', r = 1): Cell | null {
  const s = lastState;
  if (!s) return null;
  const { width: W, height: H } = s.config;
  const of = (i: number): Cell => ({ x: s.x[i] >>> POS_SHIFT, y: s.y[i] >>> POS_SHIFT, z: s.z[i] >>> POS_SHIFT });
  const at = (k: number): Cell => ({ x: k % W, y: Math.floor(k / W) % H, z: Math.floor(k / (W * H)) });
  if (kind === 'particle') return s.n ? of(s.n >> 1) : null;
  if (kind === 'waste') { let best = -1; for (let k = 0; k < s.C.length; k++) if (s.C[k] > 0 && (best < 0 || s.C[k] > s.C[best])) best = k; return best < 0 ? null : at(best); }
  if (kind === 'bonded') {
    if (!s.bond0 || !s.bond1) return null;
    for (let i = 0; i < s.n; i++) for (const p of [s.bond0[i], s.bond1[i]]) {
      if (p === BOND_NONE) continue;
      const j = slotOfId(s.id, s.n, p);
      const a = of(i), b = of(j);
      if (a.x !== b.x || a.y !== b.y || a.z !== b.z) return a;
    }
    return null;
  }
  for (let k = 0; k < s.C.length; k++) { const c = at(k); if (sphereSummary(s, c, r).waste === 0) return c; }
  return null;
}

/** Debug and tests: where a cell's centre is drawn on screen, in client pixels (GPU engine), or null. */
function screenOf(c: Cell): { x: number; y: number } | null {
  const v = viewClip();
  const cv = $<HTMLCanvasElement>('volume-canvas');
  if (!v || engine !== 'gpu') return null;
  const info = volume.cam.info(cv.width && cv.height ? cv.width / cv.height : cv.clientWidth / cv.clientHeight);
  const p = cellCentre(v, c), m = info.viewProj;
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  const nx = (m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) / w, ny = (m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) / w;
  const rect = cv.getBoundingClientRect();
  return { x: rect.left + cv.clientLeft + ((nx + 1) / 2) * cv.clientWidth, y: rect.top + cv.clientTop + ((1 - ny) / 2) * cv.clientHeight };
}

// ---- wiring ----------------------------------------------------------------------------------------------------------------

$('play').addEventListener('click', () => {
  if (running) { stop(); void exclusive(async () => { const g = gen; await settle(); if (g === gen) await readAndShow(g); setText('status', `Paused at step ${fmt(last?.step ?? 0)}.`); }); }
  else start();
});
$('step').addEventListener('click', () => { void stepTo('next').then(() => setText('status', `Stepped to ${fmt(last?.step ?? 0)}.`)); });
$('plant').addEventListener('click', () => { void plant(); });
$('turntable').addEventListener('click', () => {
  volume.setTurntable(!volume.turntable);
  $('turntable').setAttribute('aria-pressed', String(volume.turntable));
});
$<HTMLInputElement>('stretch').addEventListener('input', (e) => {
  volume.setStretch(Number((e.target as HTMLInputElement).value));
  setText('stretch-out', String(volume.stretch));
  if (last) volumeCaption(last);
});
$<HTMLInputElement>('peel').addEventListener('input', (e) => { volume.peel = Number((e.target as HTMLInputElement).value); setText('peel-out', String(volume.peel)); volume.request(); showCursor(); });
$<HTMLInputElement>('cut').addEventListener('input', (e) => { const v = Number((e.target as HTMLInputElement).value); volume.cut = v / 100; setText('cut-out', String(v)); volume.request(); showCursor(); });
$('show-waste').addEventListener('change', () => {
  applyWaste();
  if (engine === 'cpu' && lastState && lastLight) drawSide($<HTMLCanvasElement>('side-canvas'), lastState, lastLight, $<HTMLInputElement>('show-waste').checked, lastState.bond0 ? links : null);
});

// The page's hooks for tests and captures (tests/e2e/mycelium3d.spec.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).__m3d = {
  state: () => ({ engine, step: last?.step ?? -1, queued: currentStep(), choice, running }),
  config: () => (cfg ? { ...cfg } : null),
  census: () => last,
  /** Bonds in the last read-back (null without bonds): the bond census, the link instances packed from it, and what the
   *  particle renderer last uploaded (link instances, and whether it holds a link buffer at all). */
  bonds: () => ({
    readout: lastBonds && { bonds: lastBonds.bonds, bonded: lastBonds.bonded, bodies: lastBonds.bodies, largest: lastBonds.largest, rings: lastBonds.rings },
    packed: lastState?.bond0 && links ? { count: links.count, bonds: links.bonds, seamBonds: links.seamBonds } : null,
    uploaded: store.linkCount, linkBuffer: store.linkBuffer,
  }),
  stats: () => ({ ...stats }),
  runTo: (n: number) => stepTo(n),
  /** A stroke as the page makes one (no check that the view shows its centre): resolves to the brush's report, or rejects
   *  with the refusal, the world unchanged. */
  brush: (stroke: BrushStroke3d) => brush(stroke),
  /** The tool, the committed cursor and any hover, whether the view shows it, what its sphere holds, whether the renderer
   *  drew the sphere in its last frame, the last report and the strokes made since the page opened. */
  cursor: () => ({
    tool, cell: { x: cursor.x, y: cursor.y, z: cursor.z }, radius: cursor.r, hover, shown: cellShown(hover ?? cursor),
    holds: lastState ? sphereSummary(lastState, hover ?? cursor, cursor.r) : null, drawn: store.cursorDrawn ?? false, report: lastReport, strokes,
    readout: $('cur-readout').textContent,
  }),
  findCell: (kind: 'particle' | 'waste' | 'clean' | 'bonded', r?: number) => findCell(kind, r),
  screenOf: (c: Cell) => screenOf(c),
  families: () => {
    const s = lastState;
    if (!s) return [];
    const m = new Map<number, number>();
    for (let i = 0; i < s.n; i++) m.set(s.gid[i], (m.get(s.gid[i]) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([gid, n]) => ({ gid, n, colour: css(familyRGB(gid)) }));
  },
  /** Quantiles of trail, waste and nutrient per cell in the last read-back, for tuning the packer's scales. */
  quantiles: () => {
    const s = lastState;
    if (!s) return null;
    const q = (a: Uint32Array) => { const b = Array.from(a).sort((x, y) => x - y); return [0.5, 0.9, 0.99, 1].map((p) => b[Math.min(b.length - 1, Math.floor(p * b.length))]); };
    return { P: q(s.P), C: q(s.C), A: q(s.A) };
  },
  volume: () => ({ errors: [...volume.errors], draws: volume.draws, live: volume.liveCount, renderer: volume.renderer, mounted: volume.mountedRenderer, painted: volume.lastPainted, peel: volume.peel, stretch: volume.stretch, waste: $<HTMLInputElement>('show-waste').checked, pose: { yaw: volume.cam.yaw, pitch: volume.cam.pitch, dist: volume.cam.dist }, resources: Disposer.live }),
  volumeDraw: () => volume.drawNow(),
  volumeShot: async () => { await volume.drawNow(); return $<HTMLCanvasElement>('volume-canvas').toDataURL('image/png'); },
  /** Mean milliseconds for one fresh draw, GPU work included (n draws, each waited for). */
  timeDraw: async (n = 10) => {
    if (!device) return null;
    await volume.drawNow(); await device.queue.onSubmittedWorkDone();
    const t0 = performance.now();
    for (let i = 0; i < n; i++) { await volume.drawNow(); await device.queue.onSubmittedWorkDone(); }
    return (performance.now() - t0) / n;
  },
  /** A capture still: turntable off, no jitter, the camera at a pose. */
  still: async (pose: { yaw?: number; pitch?: number; dist?: number } = {}) => {
    volume.setTurntable(false);
    $('turntable').setAttribute('aria-pressed', 'false');
    volume.still = true;
    if (pose.yaw !== undefined) volume.cam.yaw = pose.yaw;
    if (pose.pitch !== undefined) volume.cam.pitch = pose.pitch;
    if (pose.dist !== undefined) volume.cam.dist = pose.dist;
    await volume.drawNow();
  },
  // Debug pages only (?debug), for tools/volume-capture, as the slab's __slab hooks.
  ...(debug ? {
    /** A capture still: as `still`, then the canvas as a PNG data URL with its size and the camera pose it was drawn at.
     *  The particle-and-haze renderer keeps one jitter pattern in a still frame and reads no clock, so the picture depends
     *  only on the read-back and these settings. */
    volumeStill: async (pose: { yaw?: number; pitch?: number; dist?: number } = {}) => {
      if (engine !== 'gpu') return null;
      volume.setTurntable(false);
      $('turntable').setAttribute('aria-pressed', 'false');
      volume.still = true;
      if (pose.yaw !== undefined) volume.cam.yaw = pose.yaw;
      if (pose.pitch !== undefined) volume.cam.pitch = pose.pitch;
      if (pose.dist !== undefined) volume.cam.dist = pose.dist;
      await volume.drawNow();
      const c = $<HTMLCanvasElement>('volume-canvas');
      return { url: c.toDataURL('image/png'), w: c.width, h: c.height, yaw: volume.cam.yaw, pitch: volume.cam.pitch, dist: volume.cam.dist };
    },
    /** The state on screen: its step, a SHA-256 of its checkpoint encoding, the rule set's own digest (tools/mycelium3d/run.ts
     *  prints the same) and counts. */
    digest: async () => {
      const s = lastState;
      if (!s) return null;
      const h = new Uint8Array(await crypto.subtle.digest('SHA-256', encode(s) as Uint8Array<ArrayBuffer>));
      return { step: s.step, sha256: [...h].map((b) => b.toString(16).padStart(2, '0')).join(''), stateDigest: stateDigest(s), particles: s.n, families: last?.families ?? 0, gpuError: document.body.dataset.gpuError ?? null };
    },
  } : {}),
};

// On a phone the world comes first: the long descriptions start folded.
if (window.matchMedia('(max-width: 760px)').matches) for (const d of document.querySelectorAll('.m3-how')) d.removeAttribute('open');
if (link.waste !== undefined) $<HTMLInputElement>('show-waste').checked = link.waste;
fillChoices();
renderViewControls();
renderTools();
setTool('look');
applyWaste();
syncPlay();
void plant();
