import './style.css';
import modelSource from './model.ts?raw';
import { RULES, HungryWorld } from './model.ts';
import type { DevelopmentOrganism, FoodMode } from './model.ts';

const HORIZON = 3000;
const FAMILY_COLORS = ['#91e1c0', '#f2be78', '#b5adf2'] as const;
const FAMILY_HUES = [154, 37, 249] as const;
const MAX_EXPORT_BYTES = 16 * 1024 * 1024;
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

interface TickPoint { tick: number; population: number; familyCounts: readonly number[] }
interface Card {
  root: HTMLElement;
  mode: FoodMode;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  historyCanvas: HTMLCanvasElement;
  historyCtx: CanvasRenderingContext2D;
  world: HungryWorld | null;
  targets: Uint8Array;
  points: TickPoint[];
  capTicks: number;
  nearCapTicks: number;
  lateCapTicks: number;
  lateNearCapTicks: number;
  lateCapBlocked: number;
  lateBirths: number;
  starvation: number;
  ageDeaths: number;
  maxGeneration: number;
  metricBirths: number;
  metricDeaths: number;
  cachedFood: Uint8Array;
  lastDrawTick: number;
  drawWidth: number;
}

function sha256(source: string): Promise<string> {
  if (!globalThis.crypto?.subtle) return Promise.reject(new Error('This browser does not provide SHA-256 in its current context.'));
  const bytes = new TextEncoder().encode(source);
  return globalThis.crypto.subtle.digest('SHA-256', bytes).then(buffer => [...new Uint8Array(buffer)].map(value => value.toString(16).padStart(2, '0')).join(''));
}

const cards: Card[] = [...document.querySelectorAll<HTMLElement>('.world-card')].map(root => {
  const canvas = root.querySelector<HTMLCanvasElement>('.world-canvas')!;
  const historyCanvas = root.querySelector<HTMLCanvasElement>('.history-canvas')!;
  const ctx = canvas.getContext('2d');
  const historyCtx = historyCanvas.getContext('2d');
  if (!ctx || !historyCtx) throw new Error('Canvas 2D rendering is unavailable');
  return {
    root, mode: root.dataset.mode as FoodMode, canvas, ctx, historyCanvas, historyCtx, world: null,
    targets: new Uint8Array(RULES.tileCount), points: [], capTicks: 0, nearCapTicks: 0,
    lateCapTicks: 0, lateNearCapTicks: 0, lateCapBlocked: 0, lateBirths: 0,
    starvation: 0, ageDeaths: 0, maxGeneration: 0, metricBirths: -1, metricDeaths: -1,
    cachedFood: new Uint8Array(RULES.tileCount), lastDrawTick: -1, drawWidth: 0,
  };
});

let seed = 1201;
let comparisonTick = 0;
let paused = true;
let pauseReason = document.hidden ? 'Paused while away' : matchMedia('(prefers-reduced-motion: reduce)').matches ? 'Paused · reduced motion' : 'Paused · ready';
let previousFrame = 0;
let accumulator = 0;
const seedInput = el<HTMLInputElement>('seed');
const seedError = el<HTMLElement>('seed-error');
const playButton = el<HTMLButtonElement>('play');
const stepButton = el<HTMLButtonElement>('step');
const paceInput = el<HTMLSelectElement>('pace');
const status = el<HTMLElement>('status');
const tickLabel = el<HTMLElement>('tick');
const fileStatus = el<HTMLElement>('file-status');

function hashGenome(organism: DevelopmentOrganism): number {
  let hash = 2166136261;
  for (const value of [organism.genome.turnEvery, organism.genome.turn + 1, organism.genome.branchEvery, organism.genome.maxCells]) hash = Math.imul(hash ^ value, 16777619);
  return hash >>> 0;
}

function bodyColor(organism: DevelopmentOrganism): string {
  const hue = FAMILY_HUES[organism.family] ?? FAMILY_HUES[0];
  const light = 66 + hashGenome(organism) % 5 * 4;
  return `hsl(${hue} 67% ${light}%)`;
}

function resize(card: Card): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(card.canvas.getBoundingClientRect().width * dpr));
  if (width !== card.canvas.width) { card.canvas.width = width; card.canvas.height = width; }
  const historyWidth = Math.max(1, Math.round(card.historyCanvas.getBoundingClientRect().width * dpr));
  if (historyWidth !== card.historyCanvas.width) { card.historyCanvas.width = historyWidth; card.historyCanvas.height = Math.round(historyWidth / 5); }
  card.drawWidth = width;
  drawWorld(card); drawHistory(card);
}

function drawWorld(card: Card): void {
  const world = card.world;
  const size = card.canvas.width;
  if (!world || size < 1) return;
  const { ctx } = card;
  const tile = size / RULES.width;
  ctx.fillStyle = '#09151a'; ctx.fillRect(0, 0, size, size);
  const food = world.food;
  card.cachedFood = food;
  for (let index = 0; index < food.length; index++) {
    const x = index % RULES.width, y = Math.floor(index / RULES.width);
    const left = Math.round(x * tile), right = Math.round((x + 1) * tile);
    const top = Math.round(y * tile), bottom = Math.round((y + 1) * tile);
    const width = right - left, height = bottom - top;
    if (card.targets[index]) {
      ctx.fillStyle = 'rgba(63, 145, 117, .22)';
      ctx.fillRect(left, top, width, height);
    }
    const value = food[index]!;
    if (value > 0) {
      const alpha = Math.min(.34, .04 + value / RULES.maxFood * .30);
      ctx.fillStyle = `rgba(175, 229, 187, ${alpha})`;
      ctx.fillRect(left, top, width, height);
    }
  }
  for (const organism of world.organisms) {
    ctx.fillStyle = bodyColor(organism);
    for (const cell of organism.cells) {
      const x = cell.tile % RULES.width, y = Math.floor(cell.tile / RULES.width);
      ctx.fillRect(x * tile + .15, y * tile + .15, Math.max(1, tile - .3), Math.max(1, tile - .3));
    }
  }
  card.lastDrawTick = world.tick;
}

function drawHistory(card: Card): void {
  const { historyCanvas, historyCtx: ctx } = card;
  const width = historyCanvas.width, height = historyCanvas.height;
  if (!width || !height) return;
  ctx.fillStyle = '#0c1a20'; ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#30464e'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, height - 1); ctx.lineTo(width, height - 1); ctx.stroke();
  for (let family = 0; family < 3; family++) {
    ctx.strokeStyle = FAMILY_COLORS[family]!; ctx.lineWidth = Math.max(1.4, width * .003); ctx.beginPath();
    card.points.forEach((point, index) => {
      const x = point.tick / HORIZON * width;
      const y = height - 4 - point.familyCounts[family]! / RULES.maxOrganisms * (height - 8);
      if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    if (card.points.length) ctx.stroke();
  }
}

function lineageMetrics(world: HungryWorld): { starvation: number; age: number; maxGeneration: number } {
  let starvation = 0, age = 0, maxGeneration = 0;
  for (const node of world.lineage) {
    if (node.deathCause === 'starvation') starvation++;
    if (node.deathCause === 'age') age++;
    maxGeneration = Math.max(maxGeneration, node.generation);
  }
  return { starvation, age, maxGeneration };
}

function setText(card: Card, selector: string, value: string): void {
  const node = card.root.querySelector<HTMLElement>(selector)!;
  if (node.textContent !== value) node.textContent = value;
}

function refreshCard(card: Card, capturePoint = false): void {
  const world = card.world!;
  const census = world.census();
  const environment = world.environment;
  const counters = world.countersView;
  if (counters.births !== card.metricBirths || counters.deaths !== card.metricDeaths) {
    const deathCounts = lineageMetrics(world);
    card.starvation = deathCounts.starvation;
    card.ageDeaths = deathCounts.age;
    card.maxGeneration = deathCounts.maxGeneration;
    card.metricBirths = counters.births;
    card.metricDeaths = counters.deaths;
  }
  if (capturePoint && (card.points.at(-1)?.tick !== world.tick)) {
    card.points.push({ tick: world.tick, population: census.population, familyCounts: census.familyCounts });
  }
  setText(card, '.observed-tick', fmt(world.tick));
  setText(card, '.population', fmt(census.population));
  setText(card, '.cells', fmt(census.cells));
  setText(card, '.generation', fmt(card.maxGeneration));
  setText(card, '.offered', fmt(environment.offered));
  setText(card, '.accepted', fmt(environment.accepted));
  setText(card, '.overflow', fmt(environment.overflow));
  setText(card, '.starvation', fmt(card.starvation));
  setText(card, '.age-deaths', fmt(card.ageDeaths));
  setText(card, '.blocked-cap', fmt(counters.blockedCapBirths));
  setText(card, '.blocked-space', fmt(counters.blockedSpaceBirths));
  setText(card, '.cap-ticks', `${fmt(card.capTicks)} total · ${fmt(card.lateCapTicks)}/500 late`);
  setText(card, '.near-cap-ticks', `${fmt(card.nearCapTicks)} total · ${fmt(card.lateNearCapTicks)}/500 late`);
  const extinct = card.root.querySelector<HTMLElement>('.extinction')!;
  extinct.hidden = world.extinctionTick === null;
  if (!extinct.hidden) extinct.textContent = `Extinct at tick ${fmt(world.extinctionTick!)}. This card is frozen; shared time continues to tick ${fmt(HORIZON)} at most.`;
  drawHistory(card);
}

function updateStatus(): void {
  const allExtinct = cards.every(card => card.world?.extinctionTick !== null);
  const atHorizon = comparisonTick >= HORIZON;
  if (allExtinct || atHorizon) { paused = true; accumulator = 0; }
  playButton.textContent = paused ? 'Play' : 'Pause';
  playButton.disabled = allExtinct || atHorizon || document.hidden;
  stepButton.disabled = !paused || allExtinct || atHorizon || document.hidden;
  const nextStatus = document.hidden ? 'Paused while away' : allExtinct ? 'All worlds extinct' : atHorizon ? '3,000 tick horizon reached' : paused ? pauseReason : 'Advancing together';
  if (status.textContent !== nextStatus) status.textContent = nextStatus;
  tickLabel.textContent = fmt(comparisonTick);
}

function refreshAll(capturePoint = false): void {
  for (const card of cards) refreshCard(card, capturePoint);
  updateStatus();
}

function createWorlds(nextSeed: number, initial = false): void {
  seed = nextSeed;
  comparisonTick = 0;
  paused = true;
  pauseReason = document.hidden ? 'Paused while away' : initial && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'Paused · reduced motion' : 'Paused · comparison reset';
  accumulator = 0; previousFrame = 0;
  for (const card of cards) {
    card.world = new HungryWorld(nextSeed, true, card.mode);
    card.targets = new Uint8Array(RULES.tileCount);
    for (const index of card.world.foodTargets) card.targets[index] = 1;
    card.points = [];
    card.capTicks = card.nearCapTicks = card.lateCapTicks = card.lateNearCapTicks = card.lateCapBlocked = card.lateBirths = 0;
    card.starvation = card.ageDeaths = card.maxGeneration = 0;
    card.metricBirths = card.metricDeaths = -1;
    card.lastDrawTick = -1;
    card.root.querySelector<HTMLElement>('.extinction')!.hidden = true;
    refreshCard(card, true);
    drawWorld(card);
  }
  seedInput.value = String(nextSeed);
  updateStatus();
}

function advanceOneTick(): boolean {
  if (comparisonTick >= HORIZON || cards.every(card => card.world!.extinctionTick !== null)) return false;
  for (const card of cards) {
    const world = card.world!;
    if (world.extinctionTick !== null) continue;
    const beforeBirths = world.countersView.births;
    const beforeBlockedCap = world.countersView.blockedCapBirths;
    world.step(1);
    const census = world.census();
    const blockedCapDelta = world.countersView.blockedCapBirths - beforeBlockedCap;
    if (census.population === RULES.maxOrganisms) card.capTicks++;
    if (census.population >= RULES.maxOrganisms - 1) card.nearCapTicks++;
    if (comparisonTick + 1 >= 2501) {
      if (census.population === RULES.maxOrganisms) card.lateCapTicks++;
      if (census.population >= RULES.maxOrganisms - 1) card.lateNearCapTicks++;
      card.lateCapBlocked += blockedCapDelta;
      card.lateBirths += world.countersView.births - beforeBirths;
    }
    const counts = census.familyCounts;
    card.points.push({ tick: world.tick, population: census.population, familyCounts: counts });
  }
  comparisonTick++;
  return true;
}

function parseSeed(value: string): number | null {
  const trimmed = value.trim(); if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 0xffffffff ? parsed : null;
}

function resetFromInput(event?: Event): void {
  event?.preventDefault();
  const parsed = parseSeed(seedInput.value);
  if (parsed === null) { seedError.textContent = 'Enter a whole number from 0 to 4,294,967,295. The comparison is unchanged.'; return; }
  createWorlds(parsed); seedError.textContent = '';
  fileStatus.textContent = `All three worlds reset with shared seed ${fmt(parsed)}.`;
}

async function downloadObservations(): Promise<void> {
  refreshAll(true);
  let digest: string;
  try { digest = await sha256(modelSource); }
  catch {
    fileStatus.textContent = 'This browser cannot calculate the model SHA-256 here, so observations were not downloaded.';
    return;
  }
  const payload = {
    kind: 'hungry-shapes-comparison-observation', schemaVersion: 1,
    description: 'Observation only, not a resumable checkpoint. The model copy, bodies, growth, food allocation, reproduction and inheritance are engineered rules.',
    provenance: { modelSourceSha256: digest, browserRuntime: navigator.userAgent, runtime: 'Browser runtime; same-runtime repeatability only.' },
    seed, mutation: true, comparisonTick, horizon: HORIZON,
    worlds: cards.map(card => ({ mode: card.mode, observedTick: card.world!.tick, extinctAt: card.world!.extinctionTick,
      environment: card.world!.environment, foodTargets: card.world!.foodTargets,
      summary: { capTicks: card.capTicks, nearCapTicks: card.nearCapTicks,
        lateWindow: { startTick: 2501, denominatorTicks: 500 },
        lateCapTicks: card.lateCapTicks, lateNearCapTicks: card.lateNearCapTicks, lateCapBlockedAttempts: card.lateCapBlocked,
        lateBirths: card.lateBirths, starvationDeaths: card.starvation, ageDeaths: card.ageDeaths },
      tickSeries: card.points, snapshot: card.world!.snapshot() })),
  };
  const json = JSON.stringify(payload, null, 2);
  const bytes = new TextEncoder().encode(json).byteLength;
  if (bytes > MAX_EXPORT_BYTES) { fileStatus.textContent = `Download refused: ${fmt(bytes)} bytes exceeds the 16 MiB limit.`; return; }
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `hungry-shapes-seed-${seed}-tick-${comparisonTick}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  fileStatus.textContent = `Observation saved (${fmt(bytes)} bytes), with model SHA-256 and environment accounting. It cannot resume a run.`;
}

el<HTMLFormElement>('seed-form').addEventListener('submit', resetFromInput);
playButton.addEventListener('click', () => {
  if (document.hidden) return;
  paused = !paused; accumulator = 0; previousFrame = 0;
  if (paused) { pauseReason = 'Paused by you'; refreshAll(true); for (const card of cards) drawWorld(card); }
  else { pauseReason = ''; updateStatus(); }
});
stepButton.addEventListener('click', () => {
  if (!paused || document.hidden) return;
  if (advanceOneTick()) { refreshAll(true); for (const card of cards) drawWorld(card); }
});
el<HTMLButtonElement>('export').addEventListener('click', () => { void downloadObservations(); });
for (const card of cards) {
  new ResizeObserver(() => resize(card)).observe(card.canvas);
  new ResizeObserver(() => resize(card)).observe(card.historyCanvas);
}
document.addEventListener('visibilitychange', () => {
  accumulator = 0; previousFrame = 0;
  if (document.hidden) { paused = true; pauseReason = 'Paused while away'; refreshAll(true); for (const card of cards) drawWorld(card); }
  else { if (pauseReason === 'Paused while away') pauseReason = 'Paused · ready'; updateStatus(); }
});

function frame(now: number): void {
  if (!paused && !document.hidden) {
    const tickDuration = 1000 / 30;
    accumulator = Math.min(accumulator + Math.min(previousFrame ? now - previousFrame : 0, 100) * Number(paceInput.value), tickDuration * 4);
    let ticks = 0;
    while (accumulator >= tickDuration && ticks < 4 && comparisonTick < HORIZON) {
      if (!advanceOneTick()) break;
      accumulator -= tickDuration; ticks++;
      if (cards.every(card => card.world!.extinctionTick !== null) || comparisonTick >= HORIZON) { paused = true; break; }
    }
    if (ticks) {
      if (ticks > 0) refreshAll(paused);
      for (const card of cards) if (card.lastDrawTick !== card.world!.tick) drawWorld(card);
    }
  }
  previousFrame = now; requestAnimationFrame(frame);
}

createWorlds(1201, true);
requestAnimationFrame(frame);
