// Live view of the Mycelium world, rung R0 (tools/mycelium/world.ts): runs the CPU reference on the
// main thread within a per-frame time budget, paints the field and the particles, and shows both
// ledger residuals after every step so a broken invariant is visible at once.
import { createWorld, defaultConfig, energyTotal, type Heredity, type LightPattern, liveGenotypes, matterTotal, type MyceliumState, POS_SHIFT, step } from '../../../../tools/mycelium/world.ts';
import './style.css';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (n: number) => n.toLocaleString('en-US');
const setText = (id: string, v: string) => { const t = el(id); if (t.textContent !== v) t.textContent = v; };

const canvas = el<HTMLCanvasElement>('world');
const ctx = canvas.getContext('2d')!;
const hist = el<HTMLCanvasElement>('history');
const hctx = hist.getContext('2d')!;
const play = el<HTMLButtonElement>('play');

let world: MyceliumState;
let running = false;
/** Incremented by every start and stop, so a callback queued by an earlier loop ends itself. */
let loopGen = 0;
let field: ImageData;
const fieldCanvas = document.createElement('canvas');
const fctx = fieldCanvas.getContext('2d')!;
let recent: { b: number; d: number }[] = [];
let history: { n: number; g: number }[] = [];
let msPerStep = 0;
let residual = { m: 0, e: 0 };

function plant(): void {
  const seed = Math.max(0, Math.min(0xffffffff, Math.floor(Number(el<HTMLInputElement>('seed').value) || 0)));
  world = createWorld(defaultConfig({
    seed,
    heredity: el<HTMLSelectElement>('heredity').value as Heredity,
    lightPattern: el<HTMLSelectElement>('light').value as LightPattern,
  }));
  fieldCanvas.width = world.config.width;
  fieldCanvas.height = world.config.height;
  field = fctx.createImageData(world.config.width, world.config.height);
  recent = []; history = []; msPerStep = 0; residual = { m: 0, e: 0 };
  sample();
  draw();
  setText('status', `Planted ${fmt(world.config.founders)} founders with random controllers on seed ${seed}. Most founders die; watch which families spread.`);
}

function advance(): void {
  const t0 = performance.now();
  const st = step(world);
  msPerStep = msPerStep * 0.9 + (performance.now() - t0) * 0.1;
  residual = { m: matterTotal(world) - world.matter0, e: energyTotal(world) - (world.energy0 + world.totals.lightIn - world.totals.heat) };
  recent.push({ b: st.births, d: st.deaths });
  if (recent.length > 100) recent.shift();
  if (world.step % 10 === 0) sample();
  if (residual.m !== 0 || residual.e !== 0) {
    stop();
    setText('status', `Stopped: a ledger residual appeared at step ${world.step}. This is a bug in the rules; please report the seed.`);
  } else if (world.n === 0) {
    stop();
    setText('status', `Every particle died by step ${fmt(world.step)}. Plant again, or try another seed.`);
  }
}

function sample(): void {
  history.push({ n: world.n, g: liveGenotypes(world) });
  if (history.length > 600) history = history.filter((_, i) => i % 2 === 0);
}

/** A stable bright colour per family (genotype id). */
function familyColour(gid: number): string {
  let h = Math.imul(gid ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  return `hsl(${h % 360} 80% ${62 + ((h >>> 9) % 14)}%)`;
}

function draw(): void {
  const view = el<HTMLSelectElement>('view').value;
  const { A, P, C } = world;
  const d = field.data;
  for (let k = 0; k < A.length; k++) {
    const a = view === 'all' ? Math.min(255, A[k] * 3) : 0;
    const p = view === 'families' ? 0 : Math.min(255, P[k] * 6);
    const c = view === 'all' ? Math.min(80, C[k] * 2) : 0;
    d[4 * k] = 6 + (p * 0.75) + c * 0.6;
    d[4 * k + 1] = 18 + a * 0.55;
    d[4 * k + 2] = 24 + p + a * 0.2;
    d[4 * k + 3] = 255;
  }
  fctx.putImageData(field, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(fieldCanvas, 0, 0, canvas.width, canvas.height);
  if (view !== 'trail') {
    const sx = canvas.width / (world.config.width << POS_SHIFT), sy = canvas.height / (world.config.height << POS_SHIFT);
    for (let i = 0; i < world.n; i++) {
      ctx.fillStyle = familyColour(world.gid[i]);
      ctx.fillRect(Math.floor(world.x[i] * sx) - 1, Math.floor(world.y[i] * sy) - 1, 3, 3);
    }
  }
  drawHistory();
  let b = 0, dd = 0;
  for (const r of recent) { b += r.b; dd += r.d; }
  setText('r-step', fmt(world.step));
  setText('r-n', fmt(world.n));
  setText('r-g', fmt(liveGenotypes(world)));
  setText('r-b', fmt(b));
  setText('r-d', fmt(dd));
  setText('r-m', fmt(residual.m));
  setText('r-e', fmt(residual.e));
  setText('r-t', msPerStep ? `${msPerStep.toFixed(1)} ms` : '–');
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

function frame(gen: number): void {
  if (!running || gen !== loopGen) return;
  const pace = el<HTMLSelectElement>('pace').value;
  const t0 = performance.now();
  if (pace === 'max') {
    while (running && performance.now() - t0 < 14) advance();
  } else {
    for (let k = 0; k < Number(pace) && running; k++) advance();
  }
  draw();
  requestAnimationFrame(() => frame(gen));
}

function start(): void {
  if (running || world.n === 0) return;
  running = true;
  const gen = ++loopGen;
  play.textContent = 'Pause';
  play.setAttribute('aria-pressed', 'true');
  setText('status', 'Running.');
  requestAnimationFrame(() => frame(gen));
}

function stop(): void {
  running = false;
  loopGen++;
  play.textContent = 'Play';
  play.setAttribute('aria-pressed', 'false');
}

play.addEventListener('click', () => { if (running) { stop(); setText('status', `Paused at step ${fmt(world.step)}.`); } else start(); });
el('step').addEventListener('click', () => { stop(); if (world.n > 0) advance(); draw(); });
el('plant').addEventListener('click', () => { stop(); plant(); });
el('view').addEventListener('change', () => draw());

plant();
