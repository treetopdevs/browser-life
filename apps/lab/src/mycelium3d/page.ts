// Live view of the 3D mycelium world (tools/mycelium3d/world.ts is the rule set, RULES.md the prose).
//
// Two engines run the same rules. On the GPU the world is a GpuMycelium3d (tools/mycelium3d/gpu.ts): each animation frame
// queues a batch of steps, and a full read-back at most every READ_MS (and after every single step or plant) feeds the
// census, the ledger check and the picture, packed on the CPU (pack.ts) into the volume view (apps/lab/src/volume3d/) that
// shares the device. Without WebGPU the CPU reference runs on the main thread at the default size, checks both ledgers
// after every step, and draws a flat side view (render-cpu.ts). Plant, step and the debug runTo go through one serial
// queue; a generation counter drops read-backs of a world that has since been replaced, and a sim is destroyed only after
// its queued work and read-back have settled.
import { GpuMycelium3d, mycelium3dDevice } from '../../../../tools/mycelium3d/gpu.ts';
import { createWorld, energyTotal, lightPlane, matterTotal, type Mycelium3dConfig, type Mycelium3dState, step } from '../../../../tools/mycelium3d/world.ts';
import { css, familyRGB } from '../mycelium/colour.ts';
import { Disposer } from '../volume3d/approaches/disposer.ts';
import { RENDERERS, type ApproachEntry } from '../volume3d/approaches/registry.ts';
import { PRESETS } from '../volume3d/camera.ts';
import type { ParamSpec } from '../volume3d/contract.ts';
import type { Packed } from '../volume3d/pack.ts';
import { VolumeView } from '../volume3d/view.ts';
import { census, packField, packParticles, ratePer100, type Census, type Instances } from './pack.ts';
import { createParticleHaze, type ParticleStore } from './render.ts';
import { drawSide } from './render-cpu.ts';
import { DEFAULT_CHOICE, describeChoice, isSink, isSize, isTrail, SINKS, SIZES, TRAILS, worldConfig, type Choice, type SizeId } from './settings.ts';

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
const store: ParticleStore = { inst: null, version: 0 };

let chain: Promise<unknown> = Promise.resolve();
let exclusiveDepth = 0;
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  exclusiveDepth++;
  const run = chain.then(fn);
  chain = run.catch(() => undefined).finally(() => { exclusiveDepth--; });
  return run;
}

// ---- the volume view ----------------------------------------------------------------------------------------------------
const stock = (id: string) => RENDERERS.find((r) => r.id === id)!;
const MENU: ApproachEntry[] = [
  { id: 'particles', title: 'Particles and haze (default)', text: 'Every particle as a lit bead at its true position, coloured by family, inside a haze of trail (violet) and waste (dark), with the water as bright as the light that reaches it.', load: async () => createParticleHaze(store) },
  { ...stock('raymarch'), title: 'Cells, ray-marched', text: 'Each cell that holds particles as a glowing body in the colour of its heaviest particle, and trail as a blue haze. Coarser, but shows where bodies crowd.' },
  { ...stock('slices'), title: 'Slices', text: 'Three flat cuts drawn exactly as packed, one on the top layer left by the peel. Plain on purpose: the check that particles are in the right layers.' },
];
const volume = new VolumeView($<HTMLCanvasElement>('volume-canvas'), syncPeel, MENU);
volume.renderer = 'particles';

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

async function renderLook() {
  const host = $('volume-params');
  // The waste haze has its own checkbox on the page; the rest are this renderer's own settings.
  const specs: ParamSpec[] = (await volume.specs()).filter((p) => p.key !== 'waste')
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
  setText('camera-help', `Jump to a view. ${POSES.oblique!.hint}`);
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
  const size = $<HTMLSelectElement>('size').value, sink = $<HTMLSelectElement>('sink').value, trail = $<HTMLSelectElement>('trail').value;
  const seed = Math.max(0, Math.min(0xffffffff, Math.floor(Number($<HTMLInputElement>('seed').value) || 0)));
  return { size: isSize(size) ? size : DEFAULT_CHOICE.size, sink: isSink(sink) ? sink : DEFAULT_CHOICE.sink, trail: isTrail(trail) ? trail : DEFAULT_CHOICE.trail, seed };
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
      sim?.destroy();
      sim = next;
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
      queuedSteps = 0; marks = []; last = null; lastState = null; lastLight = null;
      stats.msPerStep = 0; stats.reads = 0; autoK = 8;
      volume.clear();
      store.inst = null; store.version++;
      engineText(why);
      sizeHelp();
      fillPaces();
      await readAndShow(gen);
      setText('status', `Planted ${fmt(cfg.founders)} founders with random controllers: ${describeChoice(c)}. Most founders die; watch which families spread, and where.`);
      document.body.dataset.ready = '1';
    });
  } catch (e) {
    setText('status', `Could not plant: ${errMsg(e)}`);
  } finally {
    planting--;
  }
}

/** One read-back (GPU) or a look at the live state (CPU): census, ledger check, picture. Dropped if the world changed. */
async function readAndShow(g: number): Promise<void> {
  const t0 = performance.now();
  const s = engine === 'gpu' ? await sim!.read() : world!;
  if (g !== gen) return;
  const t1 = performance.now();
  const I = lightPlane(s);
  const c = census(s, I);
  if (engine === 'gpu') {
    packed = packField(s, I, {}, packed);
    inst = packParticles(s, I, inst);
    store.inst = inst; store.version++;
    volume.uploadPacked(packed);
    volumeCaption(c);
  } else {
    drawSide($<HTMLCanvasElement>('side-canvas'), s, I, $<HTMLInputElement>('show-waste').checked);
  }
  const t2 = performance.now();
  if (engine === 'gpu') stats.readMs = stats.reads ? stats.readMs * 0.7 + (t1 - t0) * 0.3 : t1 - t0;
  stats.packMs = stats.reads ? stats.packMs * 0.7 + (t2 - t1) * 0.3 : t2 - t1;
  stats.reads++;
  stats.readEveryMs = Math.max(READ_MS, Math.round(4 * (stats.readMs + stats.packMs)));
  lastReadAt = performance.now();
  last = c; lastState = s; lastLight = I;
  publish(c);
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
  fillSelect('size', Object.entries(SIZES).map(([value, s]) => ({ value, text: s.title })), DEFAULT_CHOICE.size);
  fillSelect('sink', Object.entries(SINKS).map(([value, s]) => ({ value, text: s.title })), DEFAULT_CHOICE.sink);
  fillSelect('trail', Object.entries(TRAILS).map(([value, s]) => ({ value, text: s.title })), DEFAULT_CHOICE.trail);
  fillPaces();
  const help = () => {
    sizeHelp();
    const sink = $<HTMLSelectElement>('sink').value, trail = $<HTMLSelectElement>('trail').value;
    setText('sink-help', isSink(sink) ? SINKS[sink].text : '');
    setText('trail-help', isTrail(trail) ? TRAILS[trail].text : '');
  };
  for (const id of ['size', 'sink', 'trail']) $(id).addEventListener('change', help);
  help();
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
$<HTMLInputElement>('peel').addEventListener('input', (e) => { volume.peel = Number((e.target as HTMLInputElement).value); setText('peel-out', String(volume.peel)); volume.request(); });
$<HTMLInputElement>('cut').addEventListener('input', (e) => { const v = Number((e.target as HTMLInputElement).value); volume.cut = v / 100; setText('cut-out', String(v)); volume.request(); });
$('show-waste').addEventListener('change', () => {
  applyWaste();
  if (engine === 'cpu' && lastState && lastLight) drawSide($<HTMLCanvasElement>('side-canvas'), lastState, lastLight, $<HTMLInputElement>('show-waste').checked);
});

// The page's hooks for tests and captures (tests/e2e/mycelium3d.spec.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).__m3d = {
  state: () => ({ engine, step: last?.step ?? -1, queued: currentStep(), choice, running }),
  config: () => (cfg ? { ...cfg } : null),
  census: () => last,
  stats: () => ({ ...stats }),
  runTo: (n: number) => stepTo(n),
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
  volume: () => ({ errors: [...volume.errors], draws: volume.draws, live: volume.liveCount, renderer: volume.renderer, mounted: volume.mountedRenderer, painted: volume.lastPainted, peel: volume.peel, stretch: volume.stretch, resources: Disposer.live }),
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
};

// On a phone the world comes first: the long descriptions start folded.
if (window.matchMedia('(max-width: 760px)').matches) for (const d of document.querySelectorAll('.m3-how')) d.removeAttribute('open');
fillChoices();
renderViewControls();
applyWaste();
syncPlay();
void plant();
