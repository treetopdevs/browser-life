import './motif-style.css';
import { motifCatalog, MotifWorld } from './motifs.ts';
import type { CompiledMotif, MotifSample } from './motifs.ts';
import { MOTIF_TICK_LIMIT, advanceMotifComparison } from './motif-clock.ts';

const FAMILY_NAMES = ['Mint', 'Amber', 'Lilac'] as const;
const FAMILY_COLORS = ['#91e1c0', '#f2be78', '#b5adf2'] as const;
const MAX_EXPORT_BYTES = 8 * 1024 * 1024;
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const decimal = (n: number) => n.toFixed(5);
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

interface CompactSample {
  tick: number;
  population: number;
  counts: [number, number, number];
  births: number;
  deaths: number;
  maxGeneration: number;
  meanSpeed: number;
  occupiedBins: number;
  textureChange: number | null;
}

interface CardView {
  motif: CompiledMotif;
  world: MotifWorld;
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  history: HTMLCanvasElement;
  historyCtx: CanvasRenderingContext2D;
  samples: CompactSample[];
  lastSampleTick: number;
}

const catalog = motifCatalog();
let seed = 1201;
let worlds: MotifWorld[] = [];
let comparisonTick = 0;
let paused = true;
let pauseReason = document.hidden ? 'Paused while away' : matchMedia('(prefers-reduced-motion: reduce)').matches ? 'Paused · reduced motion' : 'Paused · ready';
let previousFrame = 0;
let accumulator = 0;
let lastMetricTick = -1;
let lastDrawTick = -1;
const favorites = new Set<string>();
const cards: CardView[] = [];

const playButton = el<HTMLButtonElement>('play');
const stepButton = el<HTMLButtonElement>('step');
const seedInput = el<HTMLInputElement>('seed');
const seedError = el<HTMLElement>('seed-error');
const paceInput = el<HTMLSelectElement>('pace');
const grid = el<HTMLDivElement>('worlds');
const status = el<HTMLElement>('status');
const fileStatus = el<HTMLElement>('file-status');

function compactSample(sample: MotifSample): CompactSample {
  return {
    tick: sample.tick,
    population: sample.census.population,
    counts: [...sample.census.counts],
    births: sample.census.births,
    deaths: sample.census.deaths,
    maxGeneration: sample.census.maxGeneration,
    meanSpeed: sample.census.meanSpeed,
    occupiedBins: sample.occupiedBins,
    textureChange: sample.textureChange,
  };
}

function cardMarkup(motif: CompiledMotif): string {
  const s = motif.sentence;
  return `<div class="motif-card-head"><div><h2>${motif.title}</h2><span class="motif-id">${motif.id}</span></div><button class="favorite-toggle" type="button" aria-pressed="false" aria-label="Add ${motif.id} to favorites">☆ Favorite</button></div>
    <div class="sentence" aria-label="Initial composition"><span class="part-interaction">Interaction · ${s.interaction}</span><span class="part-coordination">Coordination · ${s.coordination}</span><span class="part-habitat">Habitat · ${s.habitat}</span></div>
    <canvas class="motif-view" width="480" height="480" role="img" aria-label="${motif.id} particle world with three family colors and food patches. Population and measurements follow the canvas.">Canvas unavailable; population and measurements are listed below.</canvas>
    <dl class="motif-metrics"><div><dt>Population</dt><dd class="population">120</dd></div><div><dt>Mean speed<br>world widths / tick</dt><dd class="speed">0.00000</dd></div><div><dt>Occupied bins</dt><dd class="occupied">—</dd></div><div><dt>Births</dt><dd class="births">0</dd></div><div><dt>Deaths</dt><dd class="deaths">0</dd></div><div><dt>Max generation</dt><dd class="generation">0</dd></div></dl>
    <div class="family-counts"></div>
    <canvas class="motif-history" width="540" height="150" role="img" aria-label="Population history by family; family counts are listed above."></canvas>
    <p class="history-caption"><span>Population history · 100 tick samples</span><span class="texture-interval">Texture change · waiting for first interval</span></p>
    <p class="extinction-note" hidden></p>
    <details class="focus-details"><summary>Focus this composition</summary><dl class="detail-grid"><div><dt>Latest sample tick</dt><dd class="sample-tick">0</dd></div><div><dt>Texture change</dt><dd class="texture-value">—</dd></div><div><dt>Family 1 · Mint</dt><dd class="detail-family-0">—</dd></div><div><dt>Family 2 · Amber</dt><dd class="detail-family-1">—</dd></div><div><dt>Family 3 · Lilac</dt><dd class="detail-family-2">—</dd></div><div><dt>Energy ledger residual</dt><dd class="energy-residual">—</dd></div></dl><p class="muted motif-explanation">${motif.explanation}</p></details>`;
}

function syncCardSamples(card: CardView): void {
  const latestScheduledTick = card.world.extinctionTick ?? Math.floor(card.world.tick / 100) * 100;
  if (latestScheduledTick <= card.lastSampleTick) return;
  const samples = card.world.sampledObservations;
  card.samples = samples.map(compactSample);
  card.lastSampleTick = samples.at(-1)?.tick ?? card.lastSampleTick;
}

function createCards(): void {
  for (const motif of catalog) {
    const section = document.createElement('section');
    section.className = 'motif-card';
    section.dataset.motifId = motif.id;
    section.setAttribute('aria-labelledby', `title-${motif.id}`);
    section.innerHTML = cardMarkup(motif);
    section.querySelector('h2')!.id = `title-${motif.id}`;
    grid.append(section);
    const canvas = section.querySelector<HTMLCanvasElement>('.motif-view')!;
    const history = section.querySelector<HTMLCanvasElement>('.motif-history')!;
    const ctx = canvas.getContext('2d');
    const historyCtx = history.getContext('2d');
    if (!ctx || !historyCtx) throw new Error('Canvas 2D rendering is unavailable');
    const world = new MotifWorld(seed, motif);
    const view: CardView = { motif, world, root: section, canvas, ctx, history, historyCtx, samples: [], lastSampleTick: -1 };
    cards.push(view);
    syncCardSamples(view);
    section.querySelector<HTMLButtonElement>('.favorite-toggle')!.addEventListener('click', () => toggleFavorite(view));
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.round(canvas.getBoundingClientRect().width * dpr);
      if (width > 0 && canvas.width !== width) { canvas.width = width; canvas.height = width; drawWorld(view); }
      const chartWidth = Math.round(history.getBoundingClientRect().width * dpr);
      if (chartWidth > 0 && history.width !== chartWidth) { history.width = chartWidth; history.height = Math.round(chartWidth / 3.6); drawHistory(view); }
    };
    new ResizeObserver(resize).observe(canvas);
    new ResizeObserver(resize).observe(history);
    resize();
  }
}

function toggleFavorite(card: CardView): void {
  const id = card.motif.id;
  const button = card.root.querySelector<HTMLButtonElement>('.favorite-toggle')!;
  if (favorites.has(id)) {
    favorites.delete(id);
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', `Add ${id} to favorites`);
    button.textContent = '☆ Favorite';
    fileStatus.textContent = `${id} removed from favorites.`;
  } else if (favorites.size >= 3) {
    fileStatus.textContent = 'Three favorites are already selected. Remove one before adding another.';
    return;
  } else {
    favorites.add(id);
    button.setAttribute('aria-pressed', 'true');
    button.setAttribute('aria-label', `Remove ${id} from favorites`);
    button.textContent = '★ Favorite';
    fileStatus.textContent = `${id} added to favorites. Favorites stay selected when the worlds reset.`;
  }
  card.root.classList.toggle('is-favorite', favorites.has(id));
  el<HTMLElement>('favorite-count').textContent = `${favorites.size} of 3 favorites`;
}

function drawWorld(card: CardView): void {
  const size = card.canvas.width;
  const ctx = card.ctx;
  const world = card.world;
  if (size < 1) return;
  ctx.fillStyle = '#08151c'; ctx.fillRect(0, 0, size, size);
  for (const patch of world.base.food) {
    const radius = patch.radius * size;
    for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) {
      const x = (patch.x + dx) * size, y = (patch.y + dy) * size;
      if (x + radius < 0 || x - radius > size || y + radius < 0 || y - radius > size) continue;
      ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(73,169,116,${.035 + .15 * clamp01(patch.amount / 35)})`; ctx.fill();
      ctx.strokeStyle = '#89c99f'; ctx.globalAlpha = .68; ctx.lineWidth = Math.max(1, size * .002); ctx.stroke(); ctx.globalAlpha = 1;
    }
  }
  for (const particle of world.base.particles) {
    for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) {
      const x = (particle.x + dx) * size, y = (particle.y + dy) * size;
      const radius = Math.max(1.5, size * .005);
      if (x < -radius || x > size + radius || y < -radius || y > size + radius) continue;
      ctx.strokeStyle = FAMILY_COLORS[particle.family]; ctx.globalAlpha = .42; ctx.lineWidth = Math.max(1, size * .0015);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - particle.vx * size * 3, y - particle.vy * size * 3); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillStyle = FAMILY_COLORS[particle.family]; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function drawHistory(card: CardView): void {
  const ctx = card.historyCtx, width = card.history.width, height = card.history.height;
  if (!width || !height) return;
  ctx.fillStyle = '#0c1a20'; ctx.fillRect(0, 0, width, height);
  const end = Math.max(comparisonTick, 1), start = Math.max(0, end - 6000), span = end - start;
  const samples = card.samples.filter(sample => sample.tick >= start && sample.tick <= end).map(sample => ({ tick: sample.tick, counts: sample.counts }));
  const census = card.world.base.census();
  if (!samples.length || samples.at(-1)!.tick < comparisonTick) samples.push({ tick: comparisonTick, counts: [...census.counts] });
  ctx.strokeStyle = '#30464e'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, height - 1); ctx.lineTo(width, height - 1); ctx.stroke();
  for (let family = 0; family < 3; family++) {
    ctx.strokeStyle = FAMILY_COLORS[family]; ctx.lineWidth = Math.max(1.5, width * .003); ctx.beginPath();
    samples.forEach((sample, index) => {
      const x = span === 0 ? width : (sample.tick - start) / span * width;
      const y = height - 6 - sample.counts[family] / 240 * (height - 12);
      if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    if (samples.length) ctx.stroke();
  }
}

function energyResidual(card: CardView): number {
  const ledger = card.world.base.ledger;
  const census = card.world.base.census();
  return ledger.initial + ledger.renewed - ledger.dissipated - ledger.deathLoss - (census.particleEnergy + census.foodEnergy);
}

function updateCard(card: CardView): void {
  syncCardSamples(card);
  const current = card.world.base.census();
  const sample = card.samples.at(-1)!;
  const text = (selector: string, value: string) => { const node = card.root.querySelector<HTMLElement>(selector)!; if (node.textContent !== value) node.textContent = value; };
  text('.population', fmt(current.population));
  text('.speed', decimal(current.meanSpeed));
  text('.occupied', `${sample.occupiedBins} / 144 (tick ${fmt(sample.tick)})`);
  text('.births', fmt(current.births));
  text('.deaths', fmt(current.deaths));
  text('.generation', fmt(current.maxGeneration));
  const familyContainer = card.root.querySelector<HTMLElement>('.family-counts')!;
  familyContainer.replaceChildren(...FAMILY_NAMES.map((name, family) => {
    const item = document.createElement('span'); item.className = 'family'; item.style.setProperty('--color', FAMILY_COLORS[family]);
    const dot = document.createElement('i'); dot.className = 'dot'; dot.setAttribute('aria-hidden', 'true');
    const count = document.createElement('strong'); count.textContent = fmt(current.counts[family]);
    item.append(dot, document.createTextNode(`${name} `), count); return item;
  }));
  const prior = card.samples.length > 1 ? card.samples.at(-2)! : null;
  const interval = prior ? `${fmt(prior.tick)}–${fmt(sample.tick)}` : 'waiting for first interval';
  text('.texture-interval', sample.textureChange === null ? 'Texture change · waiting for first interval' : `Texture change · ticks ${interval}: ${sample.textureChange.toFixed(3)}`);
  text('.sample-tick', fmt(sample.tick));
  text('.texture-value', sample.textureChange === null ? '—' : sample.textureChange.toFixed(3));
  for (let family = 0; family < 3; family++) text(`.detail-family-${family}`, fmt(current.counts[family]));
  text('.energy-residual', energyResidual(card).toExponential(2));
  const extinct = card.root.querySelector<HTMLElement>('.extinction-note')!;
  extinct.hidden = card.world.extinctionTick === null;
  if (!extinct.hidden) extinct.textContent = `Extinct at tick ${fmt(card.world.extinctionTick!)} · world stays frozen here.`;
  drawHistory(card);
}

function updateStatus(): void {
  const allExtinct = worlds.length > 0 && worlds.every(world => world.extinctionTick !== null);
  const cap = comparisonTick >= MOTIF_TICK_LIMIT;
  if (allExtinct || cap) { paused = true; accumulator = 0; }
  playButton.textContent = paused ? 'Play' : 'Pause';
  playButton.disabled = allExtinct || cap || document.hidden;
  stepButton.disabled = !paused || allExtinct || cap || document.hidden;
  status.textContent = document.hidden ? 'Paused while away' : allExtinct ? 'All compositions extinct' : cap ? '6,000 tick limit reached' : paused ? pauseReason : 'Advancing together';
  el<HTMLElement>('tick').textContent = fmt(comparisonTick);
}

function updateAll(force = false): void {
  if (!force && comparisonTick === lastMetricTick) return;
  cards.forEach(updateCard);
  updateStatus();
  lastMetricTick = comparisonTick;
}

function drawAll(): void { cards.forEach(drawWorld); cards.forEach(drawHistory); }

function install(candidateSeed: number, message: string): void {
  const replacements = catalog.map(motif => new MotifWorld(candidateSeed, motif));
  seed = candidateSeed;
  worlds = replacements;
  cards.forEach((card, index) => {
    card.world = replacements[index];
    card.samples = [];
    card.lastSampleTick = -1;
    syncCardSamples(card);
  });
  comparisonTick = 0;
  paused = true;
  pauseReason = message;
  accumulator = 0; previousFrame = 0; lastMetricTick = -1; lastDrawTick = -1;
  seedInput.value = String(seed);
  seedError.textContent = '';
  updateAll(true);
  drawAll();
}

function parseSeed(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 0xffffffff ? parsed : null;
}

function scalarWorld(card: CardView) {
  const current = card.world.base.census();
  return {
    id: card.motif.id,
    title: card.motif.title,
    version: card.motif.version,
    sentence: card.motif.sentence,
    explanation: card.motif.explanation,
    tick: card.world.tick,
    extinctionTick: card.world.extinctionTick,
    current: {
      population: current.population,
      familyCounts: [...current.counts],
      births: current.births,
      deaths: current.deaths,
      mutations: current.mutations,
      blockedBirths: current.blockedBirths,
      maxGeneration: current.maxGeneration,
      meanSpeed: current.meanSpeed,
      particleEnergy: current.particleEnergy,
      foodEnergy: current.foodEnergy,
      energyLedgerResidual: energyResidual(card),
    },
    recentHistory: card.samples.map(sample => ({ ...sample, counts: [...sample.counts] })),
  };
}

function downloadObservations(): void {
  // Catch up the UI's bounded scalar cache if playback stopped between metric refreshes.
  cards.forEach(syncCardSamples);
  const selectedIDs = catalog.filter(motif => favorites.has(motif.id)).map(motif => motif.id);
  const payload = {
    kind: 'particle-motif-gallery-observation',
    description: 'Observation only, not a resumable checkpoint. Recipes describe initial composition; individual attraction traits may change through inheritance and mutation.',
    grammarVersion: catalog[0].version,
    runtime: { userAgent: navigator.userAgent, note: 'Browser observation; no cross-engine identity with the Node pilot is claimed.' },
    seed,
    comparisonTick,
    selectedIDs,
    compositions: cards.map(scalarWorld),
    selectedFullSnapshots: cards.filter(card => favorites.has(card.motif.id)).map(card => card.world.observation()),
  };
  const json = JSON.stringify(payload, null, 2);
  const byteLength = new TextEncoder().encode(json).byteLength;
  if (byteLength > MAX_EXPORT_BYTES) {
    fileStatus.textContent = `Download refused: observation bundle is ${fmt(byteLength)} bytes and exceeds the 8 MiB limit. No partial file was created.`;
    return;
  }
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `particle-motifs-seed-${seed}-tick-${comparisonTick}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  fileStatus.textContent = `Observation bundle saved (${fmt(byteLength)} bytes). It contains all 12 scalar histories and full snapshots for ${selectedIDs.length} favorite${selectedIDs.length === 1 ? '' : 's'}.`;
}

el<HTMLFormElement>('seed-form').addEventListener('submit', event => {
  event.preventDefault();
  const parsed = parseSeed(seedInput.value);
  if (parsed === null) {
    seedError.textContent = 'Enter a whole number from 0 to 4,294,967,295. The current comparison is unchanged.';
    return;
  }
  install(parsed, 'Paused · comparison reset');
  fileStatus.textContent = `All twelve compositions reset with seed ${fmt(parsed)}. Favorites remain selected.`;
});
el<HTMLButtonElement>('restart').addEventListener('click', () => {
  const parsed = parseSeed(seedInput.value);
  if (parsed === null) {
    seedError.textContent = 'Enter a whole number from 0 to 4,294,967,295. The current comparison is unchanged.';
    return;
  }
  install(parsed, 'Paused · all worlds reset');
});
playButton.addEventListener('click', () => {
  if (document.hidden) return;
  paused = !paused;
  accumulator = 0; previousFrame = 0;
  if (paused) {
    pauseReason = 'Paused by you';
    updateAll(true);
    drawAll();
  } else {
    pauseReason = '';
    updateStatus();
  }
});
stepButton.addEventListener('click', () => {
  if (!paused || document.hidden) return;
  comparisonTick = advanceMotifComparison(worlds, comparisonTick);
  updateAll(true); drawAll();
});
el<HTMLButtonElement>('export').addEventListener('click', downloadObservations);
document.addEventListener('visibilitychange', () => {
  accumulator = 0; previousFrame = 0;
  if (document.hidden) {
    paused = true;
    pauseReason = 'Paused while away';
    updateAll(true);
    drawAll();
    return;
  }
  else if (pauseReason === 'Paused while away') pauseReason = 'Paused · ready';
  updateStatus();
});

function frame(now: number): void {
  if (!paused && !document.hidden) {
    const tickDuration = 1000 / 30;
    accumulator = Math.min(accumulator + Math.min(previousFrame ? now - previousFrame : 0, 100) * Number(paceInput.value), tickDuration * 2);
    let ticks = 0;
    while (accumulator >= tickDuration && ticks < 2 && comparisonTick < MOTIF_TICK_LIMIT) {
      const next = advanceMotifComparison(worlds, comparisonTick);
      if (next === comparisonTick) break;
      comparisonTick = next;
      accumulator -= tickDuration;
      ticks++;
      if (worlds.every(world => world.extinctionTick !== null) || comparisonTick >= MOTIF_TICK_LIMIT) { paused = true; break; }
    }
    if (comparisonTick !== lastMetricTick && (comparisonTick % 5 === 0 || paused)) updateAll();
    if (ticks && comparisonTick !== lastDrawTick) { drawAll(); lastDrawTick = comparisonTick; }
  }
  previousFrame = now;
  requestAnimationFrame(frame);
}

createCards();
worlds = cards.map(card => card.world);
cards.forEach(card => card.root.classList.toggle('is-favorite', favorites.has(card.motif.id)));
el<HTMLElement>('favorite-count').textContent = '0 of 3 favorites';
updateAll(true);
drawAll();
requestAnimationFrame(frame);
