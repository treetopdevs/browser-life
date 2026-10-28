import './style.css';
import { MatterWorld, MATTER_HEIGHT, MATTER_SIZE, MATTER_WIDTH } from './model.ts';
import type { MatterCensus, MatterHistorySample, MatterMode } from './model.ts';
import { advanceMatterComparison, MATTER_TICK_LIMIT } from './comparison-clock.ts';

type View = 'composite' | 'biomass' | 'nutrient' | 'detritus';
type Card = { root: HTMLElement; world: MatterWorld; canvas: HTMLCanvasElement; context: CanvasRenderingContext2D; fieldCanvas: HTMLCanvasElement; fieldContext: CanvasRenderingContext2D; fieldImage: ImageData; biomassHistoryCanvas: HTMLCanvasElement; biomassHistoryContext: CanvasRenderingContext2D; activeHistoryCanvas: HTMLCanvasElement; activeHistoryContext: CanvasRenderingContext2D; census: MatterCensus; history: readonly MatterHistorySample[]; drawWidth: number };
const modes: MatterMode[] = ['closed', 'rain', 'burial', 'rain-burial'];
const LIMIT_BYTES = 12 * 1024 * 1024;
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (value: number) => Math.round(value).toLocaleString('en-US');
const roots = [...document.querySelectorAll<HTMLElement>('.world-card')];
const cards: Card[] = roots.map((root, index) => {
  const canvas = root.querySelector<HTMLCanvasElement>('.world-canvas')!;
  const context = canvas.getContext('2d');
  const fieldCanvas = document.createElement('canvas');
  fieldCanvas.width = MATTER_WIDTH; fieldCanvas.height = MATTER_HEIGHT;
  const fieldContext = fieldCanvas.getContext('2d');
  const biomassHistoryCanvas = root.querySelector<HTMLCanvasElement>('.history-biomass-canvas')!;
  const activeHistoryCanvas = root.querySelector<HTMLCanvasElement>('.history-active-canvas')!;
  const biomassHistoryContext = biomassHistoryCanvas.getContext('2d');
  const activeHistoryContext = activeHistoryCanvas.getContext('2d');
  if (!context || !fieldContext || !biomassHistoryContext || !activeHistoryContext) throw new Error('Canvas rendering is unavailable');
  const fieldImage = fieldContext.createImageData(MATTER_WIDTH, MATTER_HEIGHT);
  return { root, world: new MatterWorld(1201, modes[index]!), canvas, context, fieldCanvas, fieldContext, fieldImage, biomassHistoryCanvas, biomassHistoryContext, activeHistoryCanvas, activeHistoryContext, census: null as unknown as MatterCensus, history: [], drawWidth: 0 };
});
const seedInput = el<HTMLInputElement>('seed');
const seedError = el<HTMLElement>('seed-error');
const playButton = el<HTMLButtonElement>('play');
const stepButton = el<HTMLButtonElement>('step');
const paceInput = el<HTMLSelectElement>('pace');
const status = el<HTMLElement>('status');
const tickLabel = el<HTMLElement>('tick');
const fileStatus = el<HTMLElement>('file-status');
let seed = 1201;
let comparisonTick = 0;
let paused = true;
let pauseReason = document.hidden ? 'Paused while away' : matchMedia('(prefers-reduced-motion: reduce)').matches ? 'Paused · reduced motion' : 'Paused · ready';
let previousFrame = 0;
let accumulator = 0;
let lastMetricsAt = -Infinity;
let view: View = 'composite';

function updateStatus(): void {
  const capped = comparisonTick >= MATTER_TICK_LIMIT;
  if (capped) { paused = true; accumulator = 0; }
  playButton.textContent = paused ? 'Play' : 'Pause';
  playButton.disabled = capped || document.hidden;
  stepButton.disabled = !paused || capped || document.hidden;
  status.textContent = document.hidden ? 'Paused while away' : capped ? '6,000 tick limit reached' : paused ? pauseReason : 'Four tanks advancing together';
  tickLabel.textContent = fmt(comparisonTick);
  el<HTMLElement>('light-position').textContent = `Light center x=${Math.floor(comparisonTick / 10) % MATTER_WIDTH}`;
  el<HTMLElement>('seed-display').textContent = `Matched seed ${fmt(seed)}`;
}

function drawHistory(card: Card, canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, field: 'biomass' | 'activeCells', max: number): void {
  const width = canvas.width, height = canvas.height;
  if (width < 1 || height < 1) return;
  ctx.fillStyle = '#0c1a20'; ctx.fillRect(0, 0, width, height);
  const samples = card.history;
  const maxTick = Math.max(comparisonTick, 1);
  ctx.strokeStyle = '#30464e'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, height - 1); ctx.lineTo(width, height - 1); ctx.stroke();
  ctx.strokeStyle = field === 'biomass' ? '#91e1c0' : '#b5adf2'; ctx.lineWidth = Math.max(1.5, width * .0025); ctx.beginPath();
  samples.forEach((sample, index) => {
    const x = sample.tick / maxTick * width;
    const y = height - 4 - Math.min(1, sample[field] / max) * (height - 8);
    if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  if (samples.length) ctx.stroke();
}

function niceCeiling(value: number): number {
  if (value <= 1) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const scaled = value / power;
  return (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10) * power;
}

function drawHistories(): void {
  const maxFor = (field: 'biomass' | 'activeCells') => niceCeiling(Math.max(1, ...cards.flatMap(card => [card.census[field], ...card.history.map(sample => sample[field])]))) ;
  const biomassMax = maxFor('biomass'), activeMax = maxFor('activeCells');
  for (const card of cards) {
    const biomassScale = card.root.querySelector<HTMLElement>('.history-biomass-scale')!;
    const activeScale = card.root.querySelector<HTMLElement>('.history-active-scale')!;
    biomassScale.textContent = `0–${fmt(biomassMax)} units · shared`;
    activeScale.textContent = `0–${fmt(activeMax)} tiles · shared`;
    drawHistory(card, card.biomassHistoryCanvas, card.biomassHistoryContext, 'biomass', biomassMax);
    drawHistory(card, card.activeHistoryCanvas, card.activeHistoryContext, 'activeCells', activeMax);
  }
}

const PALETTE = {
  biomass: [145, 225, 192] as const,
  nutrient: [242, 190, 120] as const,
  detritus: [181, 173, 242] as const,
};
function intensity(value: number, max: number): number { return Math.sqrt(Math.min(value, max) / max); }
function drawWorld(card: Card): void {
  const { canvas, context: ctx } = card;
  const width = canvas.width;
  if (!width) return;
  const height = Math.round(width * MATTER_HEIGHT / MATTER_WIDTH);
  if (canvas.height !== height) canvas.height = height;
  const fields = card.world.fields;
  const out = card.fieldImage.data;
  const { biomass, nutrient, detritus } = fields;
  for (let i = 0; i < MATTER_SIZE; i++) {
    const p = i * 4;
    const bi = intensity(biomass[i]!, 64), ni = intensity(nutrient[i]!, 32), di = intensity(detritus[i]!, 16);
    let r: number, g: number, b: number;
    if (view === 'biomass') { r = PALETTE.biomass[0] * bi; g = PALETTE.biomass[1] * bi; b = PALETTE.biomass[2] * bi; }
    else if (view === 'nutrient') { r = PALETTE.nutrient[0] * ni; g = PALETTE.nutrient[1] * ni; b = PALETTE.nutrient[2] * ni; }
    else if (view === 'detritus') { r = PALETTE.detritus[0] * di; g = PALETTE.detritus[1] * di; b = PALETTE.detritus[2] * di; }
    else {
      r = Math.min(255, PALETTE.biomass[0] * bi + PALETTE.nutrient[0] * ni * .60 + PALETTE.detritus[0] * di * .35);
      g = Math.min(255, PALETTE.biomass[1] * bi + PALETTE.nutrient[1] * ni * .58 + PALETTE.detritus[1] * di * .35);
      b = Math.min(255, PALETTE.biomass[2] * bi + PALETTE.nutrient[2] * ni * .50 + PALETTE.detritus[2] * di * .55);
    }
    out[p] = r; out[p + 1] = g; out[p + 2] = b; out[p + 3] = 255;
  }
  card.fieldContext.putImageData(card.fieldImage, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(card.fieldCanvas, 0, 0, width, height);
  const sx = width / MATTER_WIDTH, sy = height / MATTER_HEIGHT;
  const lightCenter = Math.floor(card.world.tick / 10) % MATTER_WIDTH;
  // A translucent backdrop shows the supplied moving light band under field color.
  ctx.fillStyle = 'rgba(235,220,140,.065)';
  for (let x = 0; x < MATTER_WIDTH; x++) {
    const distance = Math.min((x - lightCenter + MATTER_WIDTH) % MATTER_WIDTH, (lightCenter - x + MATTER_WIDTH) % MATTER_WIDTH);
    if (distance <= 24) ctx.fillRect(x * sx, 0, Math.ceil(sx), 36 * sy);
  }
  ctx.fillStyle = 'rgba(10,16,24,.27)'; ctx.fillRect(0, 36 * sy, width, 12 * sy);
  ctx.fillStyle = 'rgba(92,78,111,.24)'; ctx.fillRect(0, 40 * sy, width, 8 * sy);
  ctx.strokeStyle = 'rgba(236,231,178,.8)'; ctx.lineWidth = Math.max(1, width / 700); ctx.beginPath(); ctx.moveTo(0, sy * .5); ctx.lineTo(width, sy * .5); ctx.stroke();
  ctx.strokeStyle = 'rgba(205,217,201,.42)'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(0, 36 * sy); ctx.lineTo(width, 36 * sy); ctx.moveTo(0, 40 * sy); ctx.lineTo(width, 40 * sy); ctx.stroke(); ctx.setLineDash([]);
  ctx.font = `${Math.max(8, Math.round(width / 85))}px ui-sans-serif,system-ui,sans-serif`;
  ctx.textAlign = 'right'; ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(249,239,184,.9)'; ctx.fillText('TOP INLET', width - 5, 3);
  ctx.fillStyle = 'rgba(225,233,229,.72)'; ctx.fillText('DARK ZONE', width - 5, 36 * sy + 3);
  ctx.fillStyle = 'rgba(218,209,245,.85)'; ctx.fillText('BURIAL ZONE', width - 5, 40 * sy + 3);
}

function updateCard(card: Card): void {
  const c = card.census;
  const set = (selector: string, value: string) => { const node = card.root.querySelector<HTMLElement>(selector)!; if (node.textContent !== value) node.textContent = value; };
  set('.biomass-total', fmt(c.biomass)); set('.active-cells', fmt(c.activeCells)); set('.nutrient-total', fmt(c.nutrient)); set('.detritus-total', fmt(c.detritus));
  set('.reservoir-total', fmt(c.reservoir)); set('.sediment-total', fmt(c.sediment)); set('.ledger', c.residual === 0 ? 'Balanced' : `Residual ${fmt(c.residual)}`); set('.components', fmt(c.components));
  for (const key of ['imported', 'growth', 'recycled', 'buried', 'relaxed', 'spread', 'settled'] as const) set(`.${key}`, fmt(c[key]));
  set('.mortality', fmt(c.mortality));
  const reservoirBar = card.root.querySelector<HTMLProgressElement>('.reservoir-bar')!;
  const sedimentBar = card.root.querySelector<HTMLProgressElement>('.sediment-bar')!;
  reservoirBar.max = c.initialTotal; reservoirBar.value = c.reservoir; sedimentBar.max = c.initialTotal; sedimentBar.value = c.sediment;
  const extinction = card.root.querySelector<HTMLElement>('.extinction')!;
  extinction.hidden = card.world.extinctionTick === null;
  if (!extinction.hidden) extinction.textContent = `Biomass reached zero at tick ${fmt(card.world.extinctionTick!)}; material updates continue.`;
}

function refreshAll(force = false): void {
  for (const card of cards) {
    card.census = card.world.census();
    card.history = card.world.history;
    updateCard(card);
  }
  drawHistories();
  lastMetricsAt = performance.now(); updateStatus();
  if (force) drawAll();
}
function drawAll(): void { for (const card of cards) drawWorld(card); }
function resetWorlds(nextSeed: number, initial = false): void {
  cards.forEach((card, index) => { card.world = new MatterWorld(nextSeed, modes[index]!); card.census = card.world.census(); card.history = card.world.history; });
  seed = nextSeed; comparisonTick = 0; paused = true; accumulator = 0; previousFrame = 0;
  pauseReason = document.hidden ? 'Paused while away' : initial && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'Paused · reduced motion' : 'Paused · reset';
  seedInput.value = String(nextSeed); refreshAll(true);
  fileStatus.textContent = `All four tanks reset with shared seed ${fmt(nextSeed)}.`;
}

function parseSeed(value: string): number | null {
  const trimmed = value.trim(); if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 0xffff_ffff ? parsed : null;
}
el<HTMLFormElement>('seed-form').addEventListener('submit', event => {
  event.preventDefault();
  const parsed = parseSeed(seedInput.value);
  if (parsed === null) { seedError.textContent = 'Enter a number from 0 to 4,294,967,295. The current tanks are unchanged.'; return; }
  resetWorlds(parsed); seedError.textContent = '';
});
playButton.addEventListener('click', () => {
  if (document.hidden || comparisonTick >= MATTER_TICK_LIMIT) return;
  paused = !paused; accumulator = 0; previousFrame = 0;
  if (paused) { pauseReason = 'Paused by you'; refreshAll(true); } else { pauseReason = ''; updateStatus(); }
});
stepButton.addEventListener('click', () => {
  if (!paused || document.hidden || comparisonTick >= MATTER_TICK_LIMIT) return;
  comparisonTick = advanceMatterComparison(cards.map(card => card.world), comparisonTick);
  refreshAll(true);
});
el<HTMLButtonElement>('export').addEventListener('click', () => {
  refreshAll(true);
  const payload = { kind: 'matter-aquarium-observation', schemaVersion: 1, description: 'Full observation, not a resumable checkpoint. These are designed material-flow rules, not organisms or an ecological claim.', seed, comparisonTick, view, worlds: cards.map(card => {
    const snapshot = card.world.snapshot();
    return { mode: card.world.mode, snapshot: { ...snapshot, fields: Object.fromEntries(Object.entries(snapshot.fields).map(([name, values]) => [name, Array.from(values)])) } };
  }) };
  const json = JSON.stringify(payload, null, 2);
  const bytes = new TextEncoder().encode(json).byteLength;
  if (bytes > LIMIT_BYTES) { fileStatus.textContent = `Download refused: ${fmt(bytes)} bytes exceeds the 12 MiB limit. No observations were truncated.`; return; }
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `matter-seed-${seed}-tick-${comparisonTick}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  fileStatus.textContent = `All four full observations saved (${fmt(bytes)} bytes). This file cannot resume a run.`;
});
for (const input of document.querySelectorAll<HTMLInputElement>('input[name="view"]')) input.addEventListener('change', () => {
  view = input.value as View;
  for (const node of document.querySelectorAll<HTMLElement>('.view-description')) node.textContent = `${view[0]!.toUpperCase()}${view.slice(1)} view`;
  drawAll();
});
function resizeCard(card: Card): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(card.canvas.getBoundingClientRect().width * dpr));
  const height = Math.round(width * MATTER_HEIGHT / MATTER_WIDTH);
  if (card.canvas.width !== width || card.canvas.height !== height) { card.canvas.width = width; card.canvas.height = height; }
  for (const historyCanvas of [card.biomassHistoryCanvas, card.activeHistoryCanvas]) {
    const historyWidth = Math.max(1, Math.round(historyCanvas.getBoundingClientRect().width * dpr));
    const historyHeight = Math.round(historyWidth / 10);
    if (historyCanvas.width !== historyWidth || historyCanvas.height !== historyHeight) { historyCanvas.width = historyWidth; historyCanvas.height = historyHeight; }
  }
  card.drawWidth = width; drawWorld(card); drawHistories();
}
for (const card of cards) {
  new ResizeObserver(() => resizeCard(card)).observe(card.canvas);
  new ResizeObserver(() => resizeCard(card)).observe(card.biomassHistoryCanvas);
  new ResizeObserver(() => resizeCard(card)).observe(card.activeHistoryCanvas);
}
document.addEventListener('visibilitychange', () => {
  accumulator = 0; previousFrame = 0;
  if (document.hidden) { paused = true; pauseReason = 'Paused while away'; refreshAll(true); }
  else { if (pauseReason === 'Paused while away') pauseReason = 'Paused · ready'; updateStatus(); }
});

function frame(now: number): void {
  if (!paused && !document.hidden) {
    const duration = 1000 / 30;
    accumulator = Math.min(accumulator + Math.min(previousFrame ? now - previousFrame : 0, 100) * Number(paceInput.value), duration * 4);
    const availableTicks = Math.floor((accumulator + 1e-7) / duration);
    const ticks = Math.min(availableTicks, 4, MATTER_TICK_LIMIT - comparisonTick);
    for (let index = 0; index < ticks; index++) comparisonTick = advanceMatterComparison(cards.map(card => card.world), comparisonTick);
    accumulator = Math.max(0, accumulator - ticks * duration);
    if (comparisonTick >= MATTER_TICK_LIMIT) { paused = true; pauseReason = '6,000 tick limit reached'; }
    if (ticks) {
      if (now - lastMetricsAt >= 180 || paused) refreshAll();
      else updateStatus();
      drawAll();
    }
  }
  previousFrame = now; requestAnimationFrame(frame);
}

resetWorlds(1201, true);
requestAnimationFrame(frame);
