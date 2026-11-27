/**
 * DOM glue for the /dropgenes/ page. The kernel runs in viewer.worker.ts; this file asks it for one tick
 * per animation frame at most, waits for the answer before asking again, and only ever draws what comes back.
 * Like the other standalone experiment pages it does not load theme.ts (which starts the site's page-view counter); it keeps its own small theme switch.
 */

import './style.css';
import {
  ARENA,
  CENSUS_EVERY,
  DEFAULT_OPTIONS,
  DEFAULT_PACE,
  GATE_CHOICE_TEXT,
  GENE_CHOICE_TEXT,
  PACE_CHOICE_TEXT,
  PARASITE_CHOICE_TEXT,
  RateMeter,
  SIZE_CHOICE_TEXT,
  legendItems,
  parseSeed,
  recordedHeld,
  recordedSentence,
  type Choice,
  type Frame,
  type FromWorker,
  type GeneCount,
  type SizeId,
  type ToWorker,
  type ViewerOptions,
} from './viewer-core.ts';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = el<HTMLCanvasElement>('world');
const ctx = canvas.getContext('2d')!;
const playBtn = el<HTMLButtonElement>('play');
const stepBtn = el<HTMLButtonElement>('step');
const seedInput = el<HTMLInputElement>('seed');
const live = el<HTMLElement>('live');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmt = (n: number) => n.toLocaleString('en-US');
const pct = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`;
const set = (id: string, text: string) => { const node = el(id); if (node.textContent !== text) node.textContent = text; };
const say = (text: string) => { live.textContent = text; };

// ---- day and night ----------------------------------------------------------------------------------------------

// The site's own key, so a choice made on any page holds here; with none made, the device's setting decides.
const THEME_KEY = 'browser-life-theme';
type Theme = 'light' | 'dark';
const storedTheme = (() => { try { return localStorage.getItem(THEME_KEY); } catch { return null; } })();
let theme: Theme = storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
const themeBtn = el<HTMLButtonElement>('theme');

function applyTheme(): void {
  document.documentElement.dataset.theme = theme;
  themeBtn.textContent = theme === 'dark' ? 'Day' : 'Night';
  themeBtn.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'day' : 'night'} colours`);
  drawCharts();
}
themeBtn.addEventListener('click', () => {
  theme = theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* the choice still holds for this visit */ }
  applyTheme();
});

// ---- the run ----------------------------------------------------------------------------------------------------

let opts: ViewerOptions = { ...DEFAULT_OPTIONS };
let pace = DEFAULT_PACE;
let playing = !reducedMotion;
/** Presses of One step not yet sent to the worker: each is one step, however fast they come. */
let stepsWanted = 0;
/** The request with the worker is a single step asked for by hand; its answer is announced. */
let manualInFlight = false;
/** The world the page is showing. Answers carrying an older number belong to a world that was replaced. */
let gen = 0;
/** A request for the current world is with the worker; nothing more is sent until its answer arrives. */
let awaiting = false;
let failed: string | null = null;
let frame: Frame | null = null;
let emptyAnnounced = false;
let endAnnounced = false;
const rate = new RateMeter();
let worker: Worker | null = null;

function startWorker(): Worker {
  const w = new Worker(new URL('./viewer.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (event: MessageEvent<FromWorker>) => {
    const m = event.data;
    if (w !== worker || m.gen !== gen) return;
    awaiting = false;
    const manual = manualInFlight;
    manualInFlight = false;
    if (m.type === 'error') fail(m.message);
    else {
      // One announcement per answer: a world notice (ended, no compartments left) and, for a step taken by hand,
      // the pause message, together, so that the second does not replace the first in the live region.
      const notice = show(m.frame);
      const pause = manual && !playing && !m.frame.ended ? `Paused at step ${fmt(m.frame.step)}.` : null;
      const message = [notice, pause].filter(Boolean).join(' ');
      if (message) say(message);
    }
  };
  w.onerror = (event) => { if (w === worker) fail(event.message || 'the worker could not run'); };
  w.onmessageerror = () => { if (w === worker) fail('a message from the worker could not be read'); };
  return w;
}

function send(message: ToWorker): void {
  awaiting = true;
  worker!.postMessage(message);
}

function describe(o: ViewerOptions): string {
  return `${o.genes} genes, gate ${o.gated ? 'on' : 'off'}, parasite ${o.parasite ? 'on' : 'off'}, ${o.size === 'large' ? 'larger' : 'default'} compartments, seed ${o.seed}`;
}

/** Builds a new world from the current settings. A worker that failed is replaced, not reused. */
function reset(note = ''): void {
  if (failed !== null || worker === null) {
    worker?.terminate();
    worker = startWorker();
    failed = null;
  }
  gen++;
  frame = null;
  clearDisplay();
  stepsWanted = 0;
  manualInFlight = false;
  emptyAnnounced = false;
  endAnnounced = false;
  rate.clear();
  send({ type: 'reset', gen, opts });
  say(`${note}New world: ${describe(opts)}.`.trim());
  set('world-name', `This world: ${describe(opts)}.`);
  set('r-rate', playing ? 'measuring' : 'paused');
  renderRecorded();
  renderLegend();
  syncButtons();
}

/** The picture, readouts and charts belong to the world that was replaced: blank them until the new world's first frame. */
function clearDisplay(): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const id of ['r-step', 'r-comps', 'r-complete', 'r-complete-n', 'r-copies', 'r-par', 'r-fis', 'r-dead']) set(id, '');
  set('r-res', 'res ...');
  el('r-res').className = 'badge-res';
  set('r-res-word', '');
  set('summary', 'Building the new world.');
  drawCharts(true);
}

function fail(message: string): void {
  failed = message;
  playing = false;
  awaiting = false;
  stepsWanted = 0;
  manualInFlight = false;
  rate.clear();
  say(`The run stopped: ${message}. Choose Start again to rebuild the world.`);
  syncButtons();
}

function setPlaying(on: boolean): void {
  playing = on;
  stepsWanted = 0;
  rate.clear();
  set('r-rate', on ? 'measuring' : 'paused');
  // No frame may be on its way when the run is paused, so the sentence under the picture is brought up to date here.
  if (!on && frame) set('summary', summarise(frame));
  say(on ? 'Running.' : 'Paused.');
  syncButtons();
}

function syncButtons(): void {
  // aria-disabled, not disabled: a button that is switched off while it has the focus must not drop the focus.
  const ready = failed === null && frame !== null && !frame.ended;
  playBtn.setAttribute('aria-disabled', String(!ready));
  stepBtn.setAttribute('aria-disabled', String(!ready || playing));
  playBtn.textContent = playing && ready ? 'Pause' : 'Play';
}

// ---- drawing ----------------------------------------------------------------------------------------------------

let summaryAt = 0;

/** Draws a frame. Returns the notice about the world's state that this frame calls for, or null; the caller announces it. */
function show(f: Frame): string | null {
  let notice: string | null = null;
  const first = frame === null;
  frame = f;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(f.rgba), ARENA, ARENA), 0, 0);

  const r = f.readouts;
  set('r-step', fmt(f.step));
  set('r-comps', fmt(r.compartments));
  set('r-complete', r.completeShare === null ? 'no compartments' : pct(r.completeShare));
  set('r-complete-n', r.completeShare === null ? '' : `${r.complete} of ${r.compartments}`);
  set('r-copies', r.meanCopies === null ? 'no compartments' : r.meanCopies.toFixed(1));
  set('r-par', !opts.parasite ? 'parasite off' : r.parasiteShare === null ? 'no copies' : pct(r.parasiteShare, 1));
  set('r-fis', fmt(f.fissions));
  set('r-dead', fmt(f.deaths));
  const balanced = f.residual === '0';
  const badge = el('r-res');
  set('r-res', balanced ? 'res 0' : `res ${f.residual}`);
  badge.className = `badge-res ${balanced ? 'ok' : 'bad'}`;
  set('r-res-word', balanced ? 'balanced' : 'NOT 0: matter was made or lost');

  const now = performance.now();
  if (playing && !f.ended) {
    rate.push(now, f.step);
    const v = rate.rate();
    set('r-rate', v === null ? 'measuring' : fmt(Math.round(v)));
  }

  // The sentence under the picture is what a screen reader gets for it; once a second is often enough.
  if (first || !playing || f.ended || now - summaryAt >= 1000) {
    summaryAt = now;
    set('summary', summarise(f));
  }
  if (f.ended) {
    if (!endAnnounced) notice = `The world ended at step ${fmt(f.step)}: no wall is left, and wall is only made where there is wall, so no compartment can form again. Start again, or change a setting.`;
    endAnnounced = true;
    playing = false;
    set('r-rate', 'ended');
  } else if (f.emptySince !== null && f.readouts.compartments === 0 && !emptyAnnounced) {
    // The frame's own count decides: emptySince is the last census's, and the frame can be a later step.
    emptyAnnounced = true;
    notice = `No compartments are left as of step ${fmt(f.emptySince)}. Thin wall remains and is still fading.`;
  } else if (f.emptySince === null) {
    emptyAnnounced = false;
  }
  drawCharts(false);
  syncButtons();
  return notice;
}

function summarise(f: Frame): string {
  const r = f.readouts;
  if (f.ended) return `Step ${fmt(f.step)}. The world has ended: no wall is left.`;
  if (r.compartments === 0) return `Step ${fmt(f.step)}. No compartments${f.emptySince !== null ? ` since step ${fmt(f.emptySince)}` : ''}.`;
  const par = opts.parasite && r.parasiteShare !== null ? ` The parasite is ${pct(r.parasiteShare, 1)} of all copies.` : '';
  return `Step ${fmt(f.step)}. ${r.compartments} compartments, ${r.complete} carrying every gene.${par}`;
}

function renderLegend(): void {
  el('fade-note').hidden = !opts.parasite;
  el('legend').replaceChildren(...legendItems(opts.genes).filter((item) => opts.parasite || !/parasite/i.test(item.text)).map((item) => {
    const li = document.createElement('li');
    const sw = document.createElement('i');
    sw.style.background = item.swatch;
    li.append(sw, item.text);
    return li;
  }));
}

function renderRecorded(): void {
  const own = recordedHeld(opts) !== null && opts.seed >= 5 && opts.seed <= 8 ? ` Seed ${opts.seed} is one of those four.` : '';
  set('recorded', recordedSentence(opts) + own);
}

/**
 * One line from zero to `top`, in the canvas's own text colour, with the scale's top printed at the left and the
 * latest reading at the right. One measure per chart: the two charts share a time axis, never a vertical one.
 */
function drawLine(c: HTMLCanvasElement, values: readonly number[], top: number, label: (x: number) => string): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(c.clientWidth * dpr));
  const h = Math.max(1, Math.round(c.clientHeight * dpr));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, w, h);
  const ink = getComputedStyle(c).color;
  g.fillStyle = ink;
  g.font = `${11 * dpr}px ui-monospace, Menlo, monospace`;
  if (values.length < 2) {
    g.globalAlpha = 0.6;
    g.textAlign = 'center';
    g.fillText(values.length ? 'One reading so far' : 'No readings yet', w / 2, h / 2 + 3 * dpr);
    g.globalAlpha = 1;
    return;
  }
  const head = 16 * dpr;
  const pad = 3 * dpr;
  const yAt = (v: number) => h - pad - (Math.max(0, Math.min(top, v)) / top) * (h - pad - head);
  g.globalAlpha = 0.25;
  g.fillRect(0, Math.round(yAt(0)), w, dpr);
  g.fillRect(0, Math.round(yAt(top)), w, dpr);
  g.globalAlpha = 1;
  g.beginPath();
  values.forEach((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - 2 * pad);
    if (i === 0) g.moveTo(x, yAt(v));
    else g.lineTo(x, yAt(v));
  });
  g.strokeStyle = ink;
  g.lineWidth = 2 * dpr;
  g.lineJoin = 'round';
  g.stroke();
  g.textAlign = 'right';
  g.fillText(label(values[values.length - 1]), w - pad, 11 * dpr);
  g.globalAlpha = 0.6;
  g.textAlign = 'left';
  g.fillText(label(top), pad, 11 * dpr);
  g.globalAlpha = 1;
}

let chartKey = '';

function drawCharts(force = true): void {
  const points = frame?.history.points ?? [];
  const last = points[points.length - 1];
  const key = `${gen}:${points.length}:${last?.step ?? -1}`;
  if (!force && key === chartKey) return;
  chartKey = key;
  const comps = points.map((p) => p.compartments);
  const top = Math.max(16, ...comps);
  drawLine(el<HTMLCanvasElement>('chart-comps'), comps, top, (x) => String(Math.round(x)));
  drawLine(el<HTMLCanvasElement>('chart-share'), points.map((p) => p.completeShare), 1, (x) => pct(x));
  set('chart-note', last && points.length > 1
    ? `The whole run so far, steps 0 to ${fmt(last.step)}, one reading every ${fmt(frame!.history.interval)} steps. Each chart starts at zero; the left number is its top, the right number the latest reading (${last.compartments} compartments, ${pct(last.completeShare)} carrying every gene at step ${fmt(last.step)}).`
    : `No readings yet. A reading is taken every ${CENSUS_EVERY} steps.`);
}

// ---- controls ---------------------------------------------------------------------------------------------------

function radioGroup<V extends string | number | boolean>(name: string, legend: string, choices: readonly Choice<V>[], current: V, onPick: (v: V) => void): HTMLFieldSetElement {
  const fs = document.createElement('fieldset');
  const lg = document.createElement('legend');
  lg.textContent = legend;
  fs.append(lg);
  for (const c of choices) {
    const label = document.createElement('label');
    label.className = 'choice';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = String(c.value);
    input.checked = c.value === current;
    input.addEventListener('change', () => { if (input.checked) onPick(c.value); });
    const text = document.createElement('span');
    text.className = 'choice-text';
    const strong = document.createElement('strong');
    strong.textContent = c.name;
    text.append(strong, ' ', c.effect);
    label.append(input, text);
    fs.append(label);
  }
  return fs;
}

const change = (patch: Partial<ViewerOptions>) => { opts = { ...opts, ...patch }; reset(); };

el('choices').append(
  radioGroup<number>('pace', 'Speed: steps between two pictures (does not restart the world)', PACE_CHOICE_TEXT, pace, (v) => { pace = v; rate.clear(); }),
  radioGroup<GeneCount>('genes', 'Genes: how many kinds a compartment must keep', GENE_CHOICE_TEXT, opts.genes, (genes) => change({ genes })),
  radioGroup<boolean>('gate', 'Gate: whether templates can leave a compartment', GATE_CHOICE_TEXT, opts.gated, (gated) => change({ gated })),
  radioGroup<boolean>('parasite', 'Parasite: whether a faster, useless template can arise', PARASITE_CHOICE_TEXT, opts.parasite, (parasite) => change({ parasite })),
  radioGroup<SizeId>('size', 'Compartment size: how far wall, food and leftovers spread each step', SIZE_CHOICE_TEXT, opts.size, (size) => change({ size })),
);

function useSeed(): string {
  const { seed, replaced } = parseSeed(seedInput.value);
  seedInput.value = String(seed);
  opts = { ...opts, seed };
  return replaced ? `That seed was not a whole number from 0 to 2147483647, so seed ${seed} is used. ` : '';
}

el<HTMLFormElement>('settings').addEventListener('submit', (event) => { event.preventDefault(); reset(useSeed()); });
el('reset').addEventListener('click', () => reset(useSeed()));
playBtn.addEventListener('click', () => { if (failed === null && frame && !frame.ended) setPlaying(!playing); });
stepBtn.addEventListener('click', () => {
  if (failed !== null || !frame || frame.ended || playing) return;
  stepsWanted++;
});

// A hidden tab gets no animation frames, so no ticks are sent and the worker idles; the speed reading starts over.
document.addEventListener('visibilitychange', () => rate.clear());
window.addEventListener('resize', () => drawCharts());

function loop(): void {
  requestAnimationFrame(loop);
  if (failed !== null || awaiting || !frame || frame.ended) return;
  if (stepsWanted > 0) {
    stepsWanted--;
    manualInFlight = true;
    send({ type: 'tick', gen, steps: 1 });
  } else if (playing) {
    send({ type: 'tick', gen, steps: pace });
  }
}

applyTheme();
reset();
if (reducedMotion) say(`Paused, because this device asks for reduced motion. New world: ${describe(opts)}.`);
requestAnimationFrame(loop);
