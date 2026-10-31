// Live view of the BFF program soup (tools/soup/*): runs the grid soup on
// WebGPU (the CPU port when WebGPU is missing), paints every program as an 8x8
// block of byte colours, and lets a click inspect or plant a program.
import { type Grid, selfRep, show, Soup, TAPE } from '../../../../tools/soup/bff.ts';
import { census } from '../../../../tools/soup/census.ts';
import { GpuSoup } from '../../../../tools/soup/gpu.ts';
import { paintGrid } from '../../../../tools/soup/png.ts';
import './style.css';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (n: number) => n.toLocaleString('en-US');
const setText = (target: HTMLElement, value: string) => { if (target.textContent !== value) target.textContent = value; };

/** A copier that evolved on the 240 x 135 grid (seed 1, epoch 16,961); cubff's copy test scores it 64/64. */
const COPIER = Uint8Array.from('b54eb9865b3fb3ddb3f62332ab3c2c7d31f987a16c6c87a10387eaea875da1876c6ca187f9317d2c3cab3223f603ddb33f5ba8c881c60ccec34a4342b5a17675'.match(/../g)!, (h) => parseInt(h, 16));
const CPU_GRID: Grid = { width: 120, height: 68, radius: 2 };

const canvas = el<HTMLCanvasElement>('world');
const ctx = canvas.getContext('2d')!;
const historyCanvas = el<HTMLCanvasElement>('history');
const historyCtx = historyCanvas.getContext('2d')!;
const playButton = el<HTMLButtonElement>('play');
const stepButton = el<HTMLButtonElement>('step');
const pace = el<HTMLSelectElement>('pace');
const view = el<HTMLSelectElement>('view');

/** `shown` is the epoch of the programs in the CPU copy: GpuSoup counts epochs when they are queued, before read() brings them back. */
interface Run { gpu: GpuSoup | null; soup: Soup; grid: Grid; bytes: ImageData; families: ImageData; seed: number; mutationProb: number; shown: number }
let run: Run | null = null;
let retired: Run | null = null; // the last run built, whose GPU buffers the next start frees
let device: GPUDevice | null = null;
let running = false;
let looping = false; // one run loop at most, however fast Play and Pause are pressed
let busy: Promise<void> = Promise.resolve(); // serialises steps, reads and edits
let selected: number | null = null;
let history: { epoch: number; distinct: number }[] = [];
let lastCensus = 0;
let opsSince = 0, runsSince = 0;

async function getDevice(): Promise<GPUDevice | null> {
  if (device) return device;
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' }).catch(() => null);
  const dev = adapter ? await adapter.requestDevice().catch(() => null) : null;
  // A lost device (driver reset, GPU switch) cannot be reused: stop, and let
  // the next "Start new soup" ask for a fresh one.
  void dev?.lost.then((info) => {
    if (device === dev) device = null;
    if (run?.gpu?.device === dev) fail(`The GPU was lost (${(info.message || info.reason).replace(/\.$/, '')}). Start a new soup to continue.`);
  });
  device = dev;
  return device;
}

/** Stops the run and says why; used when a step fails or the GPU is lost. */
function fail(message: string) {
  setRunning(false);
  setText(el('status'), message);
}

/** Runs `fn` after any step or edit in flight, so the CPU copy of the programs is current while it runs. */
function exclusive(fn: () => Promise<void> | void): Promise<void> {
  busy = busy.then(fn, fn);
  return busy;
}

async function start(seed: number, grid: Grid, mutationProb: number) {
  running = false;
  // Drop the old run now, so a click or plant before the new one is ready does nothing.
  selected = null; run = null;
  await exclusive(async () => {
    retired?.gpu?.destroy();
    const dev = await getDevice();
    const g = dev ? grid : CPU_GRID;
    const params = { num: g.width * g.height, seed, grid: g, mutation: Math.round(mutationProb * 2 ** 30) };
    const gpu = dev ? await GpuSoup.create(dev, params) : null;
    const soup = gpu ? gpu.cpu : new Soup(params);
    run = retired = { gpu, soup, grid: g, bytes: ctx.createImageData(g.width * 8, g.height * 8), families: ctx.createImageData(g.width, g.height), seed, mutationProb, shown: soup.epoch };
    history = []; lastCensus = 0; opsSince = 0; runsSince = 0; selected = null;
    el('inspect').hidden = true; el('inspect-hint').hidden = false;
    setText(el('total'), fmt(params.num));
    const where = gpu ? 'GPU' : 'CPU (no WebGPU here, so a smaller grid)';
    setText(el('active-settings'), `Seed ${seed} · ${g.width} × ${g.height} · ${mutationLabel(mutationProb)} · ${where}`);
    setText(el('status'), 'Paused · ready');
    draw(true);
  });
}

function mutationLabel(p: number) { return p === 0 ? 'no mutation' : `mutation 1 in ${fmt(Math.round(1 / p))}`; }

async function advance(n: number) {
  if (!run) return;
  const r = run;
  if (r.gpu) { r.gpu.step(n); opsSince += await r.gpu.read(); }
  else { for (let k = 0; k < n; k++) r.soup.step(); opsSince += r.soup.ops; r.soup.ops = 0; }
  runsSince += r.soup.runs; r.soup.runs = 0;
  r.shown = r.soup.epoch;
}

function draw(force = false) {
  if (!run) return;
  const scale = cellPixels();
  if (canvas.width !== run.grid.width * scale) { canvas.width = run.grid.width * scale; canvas.height = run.grid.height * scale; }
  if (scale === 8) { paintGrid(run.soup.programs, run.grid, run.bytes.data, 4); ctx.putImageData(run.bytes, 0, 0); }
  else { paintFamilies(run.soup.programs, run.families.data); ctx.putImageData(run.families, 0, 0); }
  if (selected !== null) outlineSelected();
  setText(el('epoch'), fmt(run.shown));
  const now = performance.now();
  if (force || now - lastCensus > 400) { lastCensus = now; updateCensus(); }
}

/** Canvas pixels per program: 8 in the byte view (each pixel one byte), 1 in the family view. */
const cellPixels = () => (view.value === 'bytes' ? 8 : 1);

const COMMANDS = new Uint8Array(256);
for (const ch of '[]+-.,<>{}') COMMANDS[ch.charCodeAt(0)] = 1;

/**
 * Family view: programs that share their instruction bytes (data bytes, which
 * do nothing, are ignored) and have at least 3 such copies get one colour per
 * family, hashed from those instructions; everything else is drawn dark. Only
 * programs with at least MIN_INSTRUCTIONS instructions count: a random program
 * has about 2.5, so unrelated ones with 0-2 would otherwise share a "family".
 */
const MIN_INSTRUCTIONS = 6;
function paintFamilies(programs: Uint8Array, out: Uint8ClampedArray) {
  const n = programs.length / TAPE;
  const keys: string[] = new Array(n);
  const counts = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    let key = '', instructions = 0;
    for (let k = i * TAPE; k < (i + 1) * TAPE; k++) {
      // '_' marks a data byte; it is not an instruction, unlike '.'.
      if (COMMANDS[programs[k]]) { key += String.fromCharCode(programs[k]); instructions++; } else key += '_';
    }
    keys[i] = instructions >= MIN_INSTRUCTIONS ? key : '';
    if (keys[i]) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (let i = 0; i < n; i++) {
    let r = 22, g = 38, b = 44;
    if (keys[i] && (counts.get(keys[i]) ?? 0) >= 3) {
      let h = 2166136261;
      for (let k = 0; k < keys[i].length; k++) h = Math.imul(h ^ keys[i].charCodeAt(k), 16777619);
      [r, g, b] = hsl(((h >>> 0) % 360) / 360, 0.75, 0.6);
    }
    out[4 * i] = r; out[4 * i + 1] = g; out[4 * i + 2] = b; out[4 * i + 3] = 255;
  }
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const f = (n: number) => { const k = (n + h * 12) % 12; return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function updateCensus() {
  if (!run) return;
  const c = census(run.soup.programs);
  setText(el('distinct'), fmt(c.distinct));
  setText(el('top-count'), `${fmt(c.topCount)} ${c.topCount === 1 ? 'copy' : 'copies'}`);
  setText(el('top-selfrep'), c.topCount > 1 ? `${selfRep(c.top)} / 64` : '–');
  setText(el('ops'), runsSince ? fmt(Math.round(opsSince / runsSince)) : '–');
  opsSince = 0; runsSince = 0;
  const h = history;
  if (!h.length || h[h.length - 1].epoch !== run.shown) h.push({ epoch: run.shown, distinct: c.distinct });
  if (h.length > 600) history = h.filter((_, i) => i % 2 === 0 || i === h.length - 1);
  drawHistory();
  if (selected !== null) inspect(selected);
}

function drawHistory() {
  if (!run) return;
  const w = historyCanvas.width, h = historyCanvas.height, total = run.grid.width * run.grid.height;
  historyCtx.clearRect(0, 0, w, h);
  historyCtx.strokeStyle = '#2b3e43'; historyCtx.lineWidth = 1;
  for (const f of [0.25, 0.5, 0.75]) { historyCtx.beginPath(); historyCtx.moveTo(0, h * f); historyCtx.lineTo(w, h * f); historyCtx.stroke(); }
  if (history.length < 2) { setText(el('chart-range'), ''); return; }
  const e0 = history[0].epoch, e1 = history[history.length - 1].epoch || 1;
  historyCtx.strokeStyle = '#9fe4c4'; historyCtx.lineWidth = 2; historyCtx.beginPath();
  history.forEach((p, i) => {
    const x = ((p.epoch - e0) / Math.max(1, e1 - e0)) * (w - 4) + 2;
    const y = h - 2 - (p.distinct / total) * (h - 4);
    if (i === 0) historyCtx.moveTo(x, y); else historyCtx.lineTo(x, y);
  });
  historyCtx.stroke();
  setText(el('chart-range'), `Steps ${fmt(e0)}–${fmt(e1)}`);
}

function outlineSelected() {
  if (!run || selected === null) return;
  const s = cellPixels();
  const x = (selected % run.grid.width) * s, y = Math.floor(selected / run.grid.width) * s;
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = s === 8 ? 2 : 0.5;
  ctx.strokeRect(x - s / 8, y - s / 8, s * 1.25, s * 1.25);
}

function inspect(i: number) {
  if (!run) return;
  const prog = run.soup.programs.subarray(i * TAPE, (i + 1) * TAPE);
  el('inspect').hidden = false; el('inspect-hint').hidden = true;
  setText(el('cell-xy'), `${i % run.grid.width + 1}, ${Math.floor(i / run.grid.width) + 1}`);
  const text = show(prog);
  setText(el('program'), `${text.slice(0, 32)}\n${text.slice(32)}`);
  const score = selfRep(prog);
  setText(el('selfrep'), `Copy test: ${score} / 64 · ${score >= 48 ? 'copies itself' : score >= 16 ? 'partly copies itself' : 'does not copy itself'}`);
  el('selfrep').dataset.level = score >= 48 ? 'high' : score >= 16 ? 'mid' : 'low';
}

canvas.addEventListener('click', (ev) => {
  if (!run) return;
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((ev.clientX - rect.left) / (rect.width / run.grid.width));
  const y = Math.floor((ev.clientY - rect.top) / (rect.height / run.grid.height));
  if (x < 0 || y < 0 || x >= run.grid.width || y >= run.grid.height) return;
  select(y * run.grid.width + x);
});

/** Selects a square; the CPU copy is the frame on screen, so inspecting need not wait for a step. */
function select(i: number) {
  selected = i;
  inspect(i); draw();
}

// Keyboard: arrows move the selected square (Shift moves 10), starting from the centre.
canvas.addEventListener('keydown', (ev) => {
  if (!run) return;
  const step = ev.shiftKey ? 10 : 1;
  const d = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] } as Record<string, [number, number]>)[ev.key];
  if (!d && ev.key !== 'Enter' && ev.key !== ' ') return;
  ev.preventDefault();
  const { width, height } = run.grid;
  const cur = selected ?? Math.floor(height / 2) * width + Math.floor(width / 2);
  if (!d) { select(cur); return; }
  const x = Math.min(width - 1, Math.max(0, (cur % width) + d[0]));
  const y = Math.min(height - 1, Math.max(0, Math.floor(cur / width) + d[1]));
  select(y * width + x);
});

el('plant').addEventListener('click', () => {
  if (selected === null || !run) return;
  const i = selected, target = run;
  void exclusive(() => {
    if (run !== target) return; // a new soup started since the click
    // A lone copier is often overwritten by its first partner, so plant a patch
    // the size of one neighbourhood. Runs after any read in flight, so the CPU
    // copy is current when it is uploaded.
    const { width, height } = run.grid, cx = i % width, cy = Math.floor(i / width);
    let planted = 0;
    for (let y = Math.max(0, cy - 2); y <= Math.min(height - 1, cy + 2); y++) {
      for (let x = Math.max(0, cx - 2); x <= Math.min(width - 1, cx + 2); x++) { run.soup.plant(y * width + x, COPIER); planted++; }
    }
    run.gpu?.upload();
    setText(el('status'), `${running ? 'Running' : 'Paused'} · planted ${planted} copiers around ${cx + 1}, ${cy + 1}`);
    inspect(i); draw(true);
  });
});

/** The next animation frame, or 100 ms, whichever comes first: an embedded or hidden view may never paint a frame. */
const nextFrame = () => new Promise<void>((resolve) => {
  const timer = setTimeout(resolve, 100);
  requestAnimationFrame(() => { clearTimeout(timer); resolve(); });
});

/**
 * Steps in small chunks, so a plant or a new soup waits at most one chunk.
 * "max" runs as fast as the GPU allows and redraws about four times a second;
 * a number is how many steps to show per drawn frame.
 */
async function loop() {
  if (looping) return;
  looping = true;
  try {
    let lastDraw = 0;
    while (running) {
      const max = pace.value === 'max';
      const chunk = max ? 4 : Number(pace.value);
      try {
        await exclusive(async () => { if (running) await advance(chunk); });
      } catch (err) {
        fail(`Stopped: ${err instanceof Error ? err.message : String(err)}. Start a new soup to continue.`);
        break;
      }
      if (!max || performance.now() - lastDraw > 250) { draw(); lastDraw = performance.now(); await nextFrame(); }
      else await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    looping = false;
  }
}

function setRunning(on: boolean) {
  running = on;
  playButton.textContent = on ? 'Pause' : 'Play';
  playButton.setAttribute('aria-pressed', String(on));
  stepButton.disabled = on;
  setText(el('status'), on ? 'Running' : 'Paused');
  if (on) void loop();
}

playButton.addEventListener('click', () => setRunning(!running));
view.addEventListener('change', () => { el('legend-bytes').hidden = view.value !== 'bytes'; el('legend-families').hidden = view.value === 'bytes'; draw(); });
stepButton.addEventListener('click', () => void exclusive(async () => { await advance(1); draw(true); }));
document.addEventListener('visibilitychange', () => { if (document.hidden && running) setRunning(false); });

el<HTMLFormElement>('settings-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const seed = Number(el<HTMLInputElement>('seed').value);
  const [w, h] = el<HTMLSelectElement>('grid').value.split('x').map(Number);
  const mutationProb = Number(el<HTMLSelectElement>('mutation').value);
  setRunning(false);
  void start(Number.isInteger(seed) && seed >= 0 && seed < 2 ** 32 ? seed : 1, { width: w, height: h, radius: 2 }, mutationProb);
});

new ResizeObserver(() => {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(historyCanvas.getBoundingClientRect().width * ratio);
  if (width > 0 && historyCanvas.width !== width) { historyCanvas.width = width; historyCanvas.height = Math.round(width / 3.6); drawHistory(); }
}).observe(historyCanvas);

void start(1, { width: 240, height: 135, radius: 2 }, 2 ** -12).catch((err) => {
  setText(el('status'), `Could not start: ${err instanceof Error ? err.message : String(err)}`);
});
