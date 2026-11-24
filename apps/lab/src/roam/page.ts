/** The local /roam/ page: a canvas, a few choices, and readouts. The world steps in a worker. */

import { G_ADULT, ROAM_GENE_MAX, ROAM_GENE_NAMES, defaultRoamConfig } from './kernel.ts';
import { roamPlanColour, type RoamFrame, type RoamFromWorker, type RoamOptions, type RoamPaint, type RoamStart, type RoamToWorker } from './view.ts';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const set = (id: string, text: string) => { el(id).textContent = text; };
const fmt = (x: number) => Math.round(x).toLocaleString('en-US');
const value = (id: string) => el<HTMLSelectElement | HTMLInputElement>(id).value;

const canvas = el<HTMLCanvasElement>('view');
const ctx = canvas.getContext('2d')!;
let worker: Worker | null = null;
let gen = 0;
let waiting = false;
let playing = true;
let lastStep = 0;
let lastTime = performance.now();
let rate = 0;

function options(): RoamOptions {
  return { seed: Math.max(0, Math.floor(Number(value('seed')) || 0)), size: Number(value('size')), start: value('start') as RoamStart, mut: Number(value('mut')), drain: Number(value('drain')) };
}

function send(m: RoamToWorker): void {
  waiting = true;
  worker!.postMessage(m);
}

function reset(): void {
  worker?.terminate();
  worker = new Worker(new URL('./roam.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<RoamFromWorker>) => {
    const m = event.data;
    if (m.gen !== gen) return;
    waiting = false;
    if (m.type === 'error') {
      set('error', m.message);
      playing = false;
      el('play').textContent = 'Play';
      return;
    }
    show(m.frame);
  };
  worker.onerror = (event) => { set('error', event.message); };
  gen++;
  owed = 0;
  asked = 0;
  shownStep = 0;
  set('error', '');
  lastStep = 0;
  lastTime = performance.now();
  const opts = options();
  send({ type: 'reset', gen, opts, scale: opts.size! > 128 ? 3 : opts.size! < 128 ? 12 : 6, paint: value('paint') as RoamPaint });
}

function adultCells(gene: number): number {
  const max = defaultRoamConfig().maxAdult;
  return Math.min(max, 1 + Math.floor(((gene + ROAM_GENE_MAX) * (max - 1)) / (2 * ROAM_GENE_MAX)));
}

function show(f: RoamFrame): void {
  if (canvas.width !== f.side) { canvas.width = f.side; canvas.height = f.side; }
  ctx.putImageData(new ImageData(f.pixels as Uint8ClampedArray<ArrayBuffer>, f.side, f.side), 0, 0);
  const c = f.census;
  if (asked > 0 && Number(value('pace')) !== 0) owed += Math.max(0, asked - (c.step - askedAt));
  asked = 0;
  shownStep = c.step;
  const now = performance.now();
  if (now - lastTime > 500) {
    rate = ((c.step - lastStep) * 1000) / (now - lastTime);
    lastStep = c.step;
    lastTime = now;
  }
  set('r-step', fmt(c.step));
  set('r-rate', fmt(rate));
  set('r-bodies', `${fmt(c.bodies)} (${fmt(c.cells)} cells; ${fmt(c.singles)} are one cell)`);
  set('r-size', `${c.bodies ? (c.cells / c.bodies).toFixed(1) : '0'} (${c.largest})`);
  set('r-life', `${fmt(f.rates.releases)} / ${fmt(f.rates.bodyDeaths)} (${fmt(f.rates.newbornDeaths)} of them one cell that never divided)`);
  set('r-travel', `${f.rates.travel.toFixed(1)} tiles (${Math.round(f.rates.movedShare * 100)}% moved 2 or more)`);
  set('r-food', `${fmt(c.food)} on the ground, ${fmt(c.reservoir)} waiting`);
  set('r-drained', `${fmt(f.rates.drained)} per 1,000 steps`);
  set('r-res', c.residual === 0 ? 'balanced (0 missing)' : `NOT balanced: ${c.residual} missing`);
  showShapes(f);
  el('families').innerHTML = f.families
    .filter((row) => row.cells > 0)
    .map((row) => {
      const g = row.genes;
      const share = (v: number) => `${v >= 0 ? '+' : ''}${(v / ROAM_GENE_MAX).toFixed(2)}`;
      const grown = f.planned ? '<td>by plan</td><td>by plan</td>' : `<td>${adultCells(g[G_ADULT]) === 1 ? '1 cell' : `${adultCells(g[G_ADULT])} cells`}</td><td>${share(g[4])}</td>`;
      return `<tr><td><span class="sw" style="background:rgb(${row.colour.join(',')})"></span>${row.name}</td><td>${fmt(row.cells)}</td><td>${share(g[0])}</td><td>${share(g[1])}</td><td>${share(g[2])}</td>${grown}</tr>`;
    })
    .join('');
}

const shapesCanvas = el<HTMLCanvasElement>('shapes');
const shapesCtx = shapesCanvas.getContext('2d')!;
const SHAPE_BOX = 84;
/** The body outlines holding the most cells right now, each with how many bodies have it. */
function showShapes(f: RoamFrame): void {
  set('r-kinds', f.planned ? `${fmt(f.outlines)} outlines; ${fmt(f.plans)} plans alive of ${fmt(f.plansEver)} so far` : `${fmt(f.outlines)} outlines`);
  const g = shapesCtx;
  g.fillStyle = '#0d1311';
  g.fillRect(0, 0, shapesCanvas.width, shapesCanvas.height);
  g.font = '13px system-ui, sans-serif';
  g.textAlign = 'center';
  const byPlan = f.planned && (value('paint') === 'plan' || value('paint') === 'garden');
  f.shapes.forEach((shape, k) => {
    const x0 = k * SHAPE_BOX;
    const cell = Math.max(1, Math.min(10, Math.floor((SHAPE_BOX - 16) / Math.max(shape.w, shape.h))));
    const ox = x0 + Math.floor((SHAPE_BOX - shape.w * cell) / 2);
    const oy = Math.floor((SHAPE_BOX - shape.h * cell) / 2);
    const c = byPlan ? roamPlanColour(shape.pid) : (f.families.find((row) => row.family === shape.family)?.colour ?? [200, 200, 200]);
    g.fillStyle = `rgb(${c.join(',')})`;
    for (const [x, y] of shape.cells) g.fillRect(ox + x * cell, oy + y * cell, cell > 2 ? cell - 1 : cell, cell > 2 ? cell - 1 : cell);
    g.fillStyle = '#93a09a';
    g.fillText(`${shape.count}`, x0 + SHAPE_BOX / 2, SHAPE_BOX + 14);
  });
}

// Steps owed at the chosen pace (steps per second; 0 means as fast as the worker goes).
let owed = 0;
// What the last tick asked for and the step it started from: steps the worker ran out of time for are owed again.
let asked = 0;
let askedAt = 0;
let shownStep = 0;
let lastFrame = performance.now();
function loop(): void {
  const now = performance.now();
  const pace = Number(value('pace'));
  if (playing) owed = pace === 0 ? 400 : Math.min(owed + (pace * (now - lastFrame)) / 1000, pace);
  lastFrame = now;
  if (playing && !waiting && worker && owed >= 1) {
    asked = Math.floor(owed);
    owed -= asked;
    askedAt = shownStep;
    send({ type: 'tick', gen, steps: asked, paint: value('paint') as RoamPaint });
  }
  requestAnimationFrame(loop);
}

el('play').addEventListener('click', () => {
  playing = !playing;
  el('play').textContent = playing ? 'Pause' : 'Play';
  lastTime = performance.now();
});
el('reset').addEventListener('click', reset);
for (const id of ['seed', 'start', 'mut', 'size', 'drain']) el(id).addEventListener('change', reset);
el('genes-head').innerHTML = ['Family', 'cells', ...ROAM_GENE_NAMES].map((h) => `<th>${h}</th>`).join('');

reset();
requestAnimationFrame(loop);
