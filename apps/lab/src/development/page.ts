import './style.css';
import { DEVELOPMENT_TICK_LIMIT, advanceDevelopmentComparison } from './comparison-clock.ts';
import { DevelopmentWorld, GENOME_PRESETS, RULES } from './model.ts';
import type { DevelopmentCensus, DevelopmentGenome, DevelopmentHistory, DevelopmentLineageNode, DevelopmentOrganism } from './model.ts';

const FAMILY_COLORS = ['#91e1c0', '#f2be78', '#b5adf2'] as const;
const FAMILY_NAMES = ['Mint', 'Amber', 'Lilac'] as const;
const MAX_EXPORT_BYTES = 8 * 1024 * 1024;
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const cards = [...document.querySelectorAll<HTMLElement>('.world-card')].map((root, index) => {
  const canvas = root.querySelector<HTMLCanvasElement>('.world-canvas')!;
  const historyCanvas = root.querySelector<HTMLCanvasElement>('.history-canvas')!;
  const ctx = canvas.getContext('2d');
  const historyCtx = historyCanvas.getContext('2d');
  if (!ctx || !historyCtx) throw new Error('Canvas 2D rendering is unavailable');
  return {
    id: index === 0 ? 'fixed' : 'mutation', root, canvas, ctx, historyCanvas, historyCtx,
    world: null as DevelopmentWorld | null, selectedID: null as number | null, selectionNote: '',
    foodHeatmap: false, samples: [] as readonly DevelopmentHistory[], cachedHistoryTick: -1,
    lineage: [] as readonly DevelopmentLineageNode[], cachedBirthCount: -1, cachedDeathCount: -1, food: new Uint8Array(RULES.tileCount) as Uint8Array<ArrayBufferLike>, foodTick: -1,
    organisms: [] as readonly DevelopmentOrganism[], occupancy: new Float64Array(RULES.tileCount) as Float64Array<ArrayBufferLike>, census: null as DevelopmentCensus | null,
    drawWidth: 0,
  };
});

let seed = 1201;
let comparisonTick = 0;
let paused = true;
let pauseReason = document.hidden ? 'Paused while away' : matchMedia('(prefers-reduced-motion: reduce)').matches ? 'Paused · reduced motion' : 'Paused · ready';
let previousFrame = 0;
let accumulator = 0;
let lastMetricTick = -1;
let lastDrawTick = -1;
const seedInput = el<HTMLInputElement>('seed');
const seedError = el<HTMLElement>('seed-error');
const playButton = el<HTMLButtonElement>('play');
const stepButton = el<HTMLButtonElement>('step');
const paceInput = el<HTMLSelectElement>('pace');
const status = el<HTMLElement>('status');
const tickLabel = el<HTMLElement>('tick');
const fileStatus = el<HTMLElement>('file-status');

function geneSummary(genome: DevelopmentGenome): string {
  const turn = genome.turn === 0 ? 'go straight' : genome.turn < 0 ? 'turn left' : 'turn right';
  return `Every ${genome.turnEvery} depth${genome.turnEvery === 1 ? '' : 's'}, ${turn}; branch every ${genome.branchEvery}; max ${genome.maxCells} cells.`;
}

function setupProgramCards(card: typeof cards[number]): void {
  const container = card.root.querySelector<HTMLElement>('.program-cards')!;
  const names = ['Branching', 'Curling', 'Bushy'] as const;
  container.replaceChildren(...GENOME_PRESETS.map((genome, index) => {
    const section = document.createElement('article'); section.className = 'program-card';
    const title = document.createElement('h4'); title.textContent = names[index];
    const description = document.createElement('p'); description.textContent = geneSummary(genome);
    const genes = document.createElement('p'); const code = document.createElement('code');
    code.textContent = `turnEvery ${genome.turnEvery} · turn ${genome.turn} · branchEvery ${genome.branchEvery} · maxCells ${genome.maxCells}`;
    genes.append(code); section.append(title, description, genes); return section;
  }));
}

function clearSelection(card: typeof cards[number], note = ''): void {
  card.selectedID = null;
  card.selectionNote = note;
  updateSelection(card);
  drawWorld(card);
}

function createWorlds(nextSeed: number, initial = false): void {
  const fixed = new DevelopmentWorld(nextSeed, false);
  const mutated = new DevelopmentWorld(nextSeed, true);
  seed = nextSeed;
  comparisonTick = 0;
  paused = true;
  pauseReason = document.hidden ? 'Paused while away' : initial && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'Paused · reduced motion' : 'Paused · comparison reset';
  accumulator = 0; previousFrame = 0; lastMetricTick = -1; lastDrawTick = -1;
  cards.forEach((card, index) => {
    card.world = index === 0 ? fixed : mutated;
    card.selectedID = null; card.selectionNote = ''; card.samples = []; card.cachedHistoryTick = -1;
    card.lineage = []; card.cachedBirthCount = -1; card.cachedDeathCount = -1; card.food = new Uint8Array(RULES.tileCount) as Uint8Array<ArrayBufferLike>; card.foodTick = -1;
    card.organisms = []; card.occupancy = new Float64Array(RULES.tileCount) as Float64Array<ArrayBufferLike>; card.census = null;
    card.foodHeatmap = card.root.querySelector<HTMLInputElement>('.food-toggle')!.checked;
    card.root.querySelector<HTMLElement>('.selection-empty')!.textContent = 'Choose a colored body in the world.';
    refreshCard(card, true);
  });
  seedInput.value = String(nextSeed);
  updateAll(true); drawAll();
}

function cacheHistory(card: typeof cards[number], force = false): void {
  const world = card.world!;
  const completedBoundary = Math.floor(world.tick / RULES.historyEvery) * RULES.historyEvery;
  if (!force && world.extinctionTick === null && completedBoundary <= card.cachedHistoryTick) return;
  const history = world.history;
  const newest = history.at(-1)?.tick ?? -1;
  if (force || newest !== card.cachedHistoryTick) {
    card.samples = history;
    card.cachedHistoryTick = newest;
  }
}

function refreshPhysical(card: typeof cards[number]): void {
  const world = card.world!;
  card.organisms = world.organisms;
  card.occupancy = world.occupancy;
  const counters = world.countersView;
  if (counters.births !== card.cachedBirthCount || counters.deaths !== card.cachedDeathCount) {
    card.lineage = world.lineage;
    card.cachedBirthCount = counters.births;
    card.cachedDeathCount = counters.deaths;
    renderBirths(card);
  }
  updateSelection(card);
}

function refreshCard(card: typeof cards[number], forceHistory = false): void {
  const world = card.world!;
  refreshPhysical(card);
  card.census = world.census();
  cacheHistory(card, forceHistory);
  updateCard(card);
}

function hashGenome(genome: DevelopmentGenome): number {
  let hash = 2166136261;
  for (const value of [genome.turnEvery, genome.turn + 1, genome.branchEvery, genome.maxCells]) hash = Math.imul(hash ^ value, 16777619);
  return hash >>> 0;
}

function bodyColor(organism: DevelopmentOrganism): string {
  const hash = hashGenome(organism.genome);
  const baseHue = [154, 37, 249][organism.family] ?? 154;
  const baseLight = 72 + (hash % 4) * 3;
  return `hsl(${baseHue} 64% ${baseLight}%)`;
}

function resizeCanvas(card: typeof cards[number]): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(card.canvas.getBoundingClientRect().width * dpr));
  if (width !== card.canvas.width) { card.canvas.width = width; card.canvas.height = width; }
  const historyWidth = Math.max(1, Math.round(card.historyCanvas.getBoundingClientRect().width * dpr));
  if (historyWidth !== card.historyCanvas.width) { card.historyCanvas.width = historyWidth; card.historyCanvas.height = Math.round(historyWidth / 4); }
  card.drawWidth = width;
  drawWorld(card); drawHistory(card);
}

function drawWorld(card: typeof cards[number]): void {
  const { canvas, ctx, world } = card;
  const size = canvas.width;
  if (!world || size < 1) return;
  refreshPhysical(card);
  ctx.fillStyle = '#09151a'; ctx.fillRect(0, 0, size, size);
  const tileSize = size / RULES.width;
  if (card.foodHeatmap) {
    if (card.foodTick !== world.tick) { card.food = world.food; card.foodTick = world.tick; }
    const food = card.food;
    for (let tile = 0; tile < food.length; tile++) {
      const value = food[tile]!;
      if (!value) continue;
      const x = tile % RULES.width, y = Math.floor(tile / RULES.width);
      ctx.fillStyle = `rgba(85, 180, 126, ${0.025 + value / RULES.maxFood * 0.20})`;
      ctx.fillRect(x * tileSize, y * tileSize, Math.ceil(tileSize), Math.ceil(tileSize));
    }
  }
  for (const organism of card.organisms) {
    ctx.fillStyle = bodyColor(organism);
    for (const cell of organism.cells) {
      const x = cell.tile % RULES.width, y = Math.floor(cell.tile / RULES.width);
      const px = x * tileSize, py = y * tileSize;
      ctx.fillRect(px + .15, py + .15, Math.max(1, tileSize - .3), Math.max(1, tileSize - .3));
      if (organism.id === card.selectedID) {
        ctx.strokeStyle = '#fff3c7'; ctx.lineWidth = Math.max(1.3, tileSize * .17);
        ctx.strokeRect(px + .45, py + .45, Math.max(1, tileSize - .9), Math.max(1, tileSize - .9));
      }
    }
    if (organism.id === card.selectedID && organism.cells.length) {
      const root = organism.cells[0]!; const x = (root.tile % RULES.width + .5) * tileSize, y = (Math.floor(root.tile / RULES.width) + .5) * tileSize;
      ctx.beginPath(); ctx.arc(x, y, Math.max(2.2, tileSize * .31), 0, Math.PI * 2); ctx.fillStyle = '#fff5cc'; ctx.fill();
    }
  }
}

function drawHistory(card: typeof cards[number]): void {
  const { historyCanvas, historyCtx: ctx } = card;
  const width = historyCanvas.width, height = historyCanvas.height;
  if (!width || !height) return;
  ctx.fillStyle = '#0c1a20'; ctx.fillRect(0, 0, width, height);
  const end = Math.max(comparisonTick, 1), start = Math.max(0, end - DEVELOPMENT_TICK_LIMIT), span = Math.max(1, end - start);
  const samples = card.samples.filter(sample => sample.tick >= start && sample.tick <= end);
  if (card.census && (!samples.length || samples.at(-1)!.tick < comparisonTick) && comparisonTick <= 1) {
    samples.push(card.census as DevelopmentHistory);
  }
  ctx.strokeStyle = '#30464e'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, height - 1); ctx.lineTo(width, height - 1); ctx.stroke();
  for (let family = 0; family < 3; family++) {
    ctx.strokeStyle = FAMILY_COLORS[family]!; ctx.lineWidth = Math.max(1.5, width * .003); ctx.beginPath();
    samples.forEach((sample, index) => {
      const x = span === 0 ? width : (sample.tick - start) / span * width;
      const y = height - 5 - sample.familyCounts[family]! / RULES.maxOrganisms * (height - 10);
      if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    if (samples.length) ctx.stroke();
  }
}

function findOrganism(card: typeof cards[number], id: number): DevelopmentOrganism | undefined {
  return card.organisms.find(organism => organism.id === id);
}

function updateSelection(card: typeof cards[number]): void {
  const empty = card.root.querySelector<HTMLElement>('.selection-empty')!;
  const panel = card.root.querySelector<HTMLElement>('.selection-info')!;
  const organism = card.selectedID === null ? undefined : findOrganism(card, card.selectedID);
  if (!organism) {
    if (card.selectedID !== null) {
      const deadID = card.selectedID;
      const dead = card.lineage.find(node => node.id === deadID && node.deathTick !== null);
      card.selectedID = null;
      card.selectionNote = dead ? `Body ${deadID} died at tick ${fmt(dead.deathTick!)}.` : `Body ${deadID} is no longer present.`;
    }
    panel.hidden = true; empty.hidden = false;
    empty.textContent = card.selectionNote || 'Choose a colored body in the world.';
    return;
  }
  empty.hidden = true; panel.hidden = false;
  const lineage = card.lineage.find(node => node.id === organism.id);
  card.root.querySelector<HTMLElement>('.selected-name')!.textContent = `Body ${organism.id} · ${FAMILY_NAMES[organism.family] ?? 'Unknown'} family`;
  card.root.querySelector<HTMLElement>('.selected-genome')!.textContent = `turnEvery ${organism.genome.turnEvery} · turn ${organism.genome.turn} · branchEvery ${organism.genome.branchEvery} · maxCells ${organism.genome.maxCells}`;
  card.root.querySelector<HTMLElement>('.selected-cells')!.textContent = `${organism.cells.length} of ${organism.genome.maxCells}`;
  card.root.querySelector<HTMLElement>('.selected-parent')!.textContent = organism.parentID === null ? 'Founder' : `Body ${organism.parentID}${lineage?.parentRecordDropped ? ' · record pruned' : ''}`;
  card.root.querySelector<HTMLElement>('.selected-generation')!.textContent = fmt(organism.generation);
  card.root.querySelector<HTMLElement>('.selected-age')!.textContent = `${fmt(organism.age)} ticks`;
  card.root.querySelector<HTMLElement>('.selected-births')!.textContent = fmt(organism.births);
}

function renderBirths(card: typeof cards[number]): void {
  const nodes = card.lineage.filter(node => node.generation > 0).slice(-8).reverse();
  const list = card.root.querySelector<HTMLOListElement>('.recent-births')!;
  if (!nodes.length) { list.replaceChildren(Object.assign(document.createElement('li'), { textContent: 'No births yet.' })); return; }
  list.replaceChildren(...nodes.map(node => {
    const item = document.createElement('li');
    const mutation = node.mutation ? ` · ${node.mutation.field}: ${node.mutation.from} → ${node.mutation.to}` : '';
    item.textContent = `Tick ${fmt(node.birthTick)} · Body ${node.parentID ?? '—'} → ${node.id} · generation ${node.generation}${mutation}`;
    return item;
  }));
}

function updateCard(card: typeof cards[number]): void {
  const world = card.world!, census = card.census!;
  const text = (selector: string, value: string) => { const node = card.root.querySelector<HTMLElement>(selector)!; if (node.textContent !== value) node.textContent = value; };
  text('.population', fmt(census.population)); text('.cells', fmt(census.cells)); text('.growths', fmt(census.growths));
  text('.births', fmt(census.births)); text('.deaths', fmt(census.deaths));
  text('.mutations', fmt(card.id === 'mutation' ? census.effectiveMutations : 0));
  text('.generation', fmt(census.maxGeneration)); text('.ledger', census.ledgerResidual === 0 ? 'Balanced' : `Residual ${fmt(census.ledgerResidual)}`);
  card.root.querySelectorAll<HTMLElement>('.family-count').forEach(item => {
    const family = Number(item.dataset.family);
    const strong = item.querySelector('strong');
    if (strong) strong.textContent = fmt(census.familyCounts[family] ?? 0);
  });
  const extinct = card.root.querySelector<HTMLElement>('.extinction')!;
  extinct.hidden = world.extinctionTick === null;
  if (!extinct.hidden) extinct.textContent = `This world became extinct at tick ${fmt(world.extinctionTick!)} and stays frozen there.`;
  drawHistory(card);
}

function updateStatus(): void {
  const allExtinct = cards.length > 0 && cards.every(card => card.world?.extinctionTick !== null);
  const cap = comparisonTick >= DEVELOPMENT_TICK_LIMIT;
  if (allExtinct || cap) { paused = true; accumulator = 0; }
  playButton.textContent = paused ? 'Play' : 'Pause';
  playButton.disabled = allExtinct || cap || document.hidden;
  stepButton.disabled = !paused || allExtinct || cap || document.hidden;
  status.textContent = document.hidden ? 'Paused while away' : allExtinct ? 'Both worlds extinct' : cap ? '6,000 tick limit reached' : paused ? pauseReason : 'Advancing together';
  tickLabel.textContent = fmt(comparisonTick);
}

function updateAll(force = false, flushHistory = false): void {
  if (!force && comparisonTick === lastMetricTick) return;
  for (const card of cards) refreshCard(card, flushHistory);
  updateStatus(); lastMetricTick = comparisonTick;
}

function drawAll(): void { for (const card of cards) drawWorld(card); for (const card of cards) drawHistory(card); }

function selectAt(card: typeof cards[number], clientX: number, clientY: number): void {
  const bounds = card.canvas.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return;
  const x = Math.min(RULES.width - 1, Math.floor((clientX - bounds.left) / bounds.width * RULES.width));
  const y = Math.min(RULES.height - 1, Math.floor((clientY - bounds.top) / bounds.height * RULES.height));
  const id = card.occupancy[y * RULES.width + x] ?? 0;
  if (!id) { clearSelection(card, 'No body on that tile.'); return; }
  card.selectedID = id; card.selectionNote = ''; updateSelection(card); drawWorld(card);
}

function parseSeed(value: string): number | null {
  const trimmed = value.trim(); if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 0xffffffff ? parsed : null;
}

function resetFromInput(event?: Event): void {
  event?.preventDefault();
  const parsed = parseSeed(seedInput.value);
  if (parsed === null) {
    seedError.textContent = 'Enter a whole number from 0 to 4,294,967,295. The comparison is unchanged.';
    return;
  }
  createWorlds(parsed); seedError.textContent = '';
  fileStatus.textContent = `Both worlds reset with shared seed ${fmt(parsed)}.`;
}

function downloadObservations(): void {
  updateAll(true, true);
  const payload = {
    kind: 'development-comparison-observation', schemaVersion: 1,
    description: 'Observation only, not a resumable checkpoint. Bodies, reproduction and inherited developmental programs are engineered rules.',
    runtime: { userAgent: navigator.userAgent, runtime: 'Browser runtime; repeatability is claimed within the same runtime only.' },
    seed, comparisonTick,
    worlds: cards.map(card => ({ id: card.id, mutation: card.id === 'mutation', snapshot: card.world!.snapshot() })),
  };
  const json = JSON.stringify(payload, null, 2);
  const byteLength = new TextEncoder().encode(json).byteLength;
  if (byteLength > MAX_EXPORT_BYTES) {
    fileStatus.textContent = `Download refused: both snapshots total ${fmt(byteLength)} bytes, above the 8 MiB limit.`;
    return;
  }
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `development-seed-${seed}-tick-${comparisonTick}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  fileStatus.textContent = `Both full world snapshots saved (${fmt(byteLength)} bytes). This observation cannot resume a run.`;
}

el<HTMLFormElement>('seed-form').addEventListener('submit', resetFromInput);
playButton.addEventListener('click', () => {
  if (document.hidden) return;
  paused = !paused; accumulator = 0; previousFrame = 0;
  if (paused) { pauseReason = 'Paused by you'; updateAll(true, true); drawAll(); }
  else { pauseReason = ''; updateStatus(); }
});
stepButton.addEventListener('click', () => {
  if (!paused || document.hidden) return;
  const next = advanceDevelopmentComparison(cards.map(card => card.world!), comparisonTick);
  if (next !== comparisonTick) comparisonTick = next;
  updateAll(true, true); drawAll();
});
el<HTMLButtonElement>('export').addEventListener('click', downloadObservations);
for (const card of cards) {
  setupProgramCards(card);
  card.canvas.addEventListener('click', event => selectAt(card, event.clientX, event.clientY));
  card.canvas.addEventListener('keydown', event => {
    if (event.key === 'Escape') clearSelection(card);
  });
  card.root.querySelector<HTMLInputElement>('.food-toggle')!.addEventListener('change', event => {
    card.foodHeatmap = (event.currentTarget as HTMLInputElement).checked; drawWorld(card);
  });
  card.root.querySelector<HTMLButtonElement>('.clear-selection')!.addEventListener('click', () => clearSelection(card));
  new ResizeObserver(() => resizeCanvas(card)).observe(card.canvas);
  new ResizeObserver(() => resizeCanvas(card)).observe(card.historyCanvas);
}
document.addEventListener('visibilitychange', () => {
  accumulator = 0; previousFrame = 0;
  if (document.hidden) { paused = true; pauseReason = 'Paused while away'; updateAll(true, true); drawAll(); }
  else { if (pauseReason === 'Paused while away') pauseReason = 'Paused · ready'; updateStatus(); }
});

function frame(now: number): void {
  if (!paused && !document.hidden) {
    const tickDuration = 1000 / 30;
    accumulator = Math.min(accumulator + Math.min(previousFrame ? now - previousFrame : 0, 100) * Number(paceInput.value), tickDuration * 4);
    let ticks = 0;
    while (accumulator >= tickDuration && ticks < 4 && comparisonTick < DEVELOPMENT_TICK_LIMIT) {
      const next = advanceDevelopmentComparison(cards.map(card => card.world!), comparisonTick);
      if (next === comparisonTick) break;
      comparisonTick = next; accumulator -= tickDuration; ticks++;
      if (cards.every(card => card.world!.extinctionTick !== null) || comparisonTick >= DEVELOPMENT_TICK_LIMIT) { paused = true; break; }
    }
    if (ticks) {
      if (comparisonTick - lastMetricTick >= 5 || paused) updateAll(false, paused);
      else updateStatus();
      if (comparisonTick !== lastDrawTick) { drawAll(); lastDrawTick = comparisonTick; }
    }
  }
  previousFrame = now; requestAnimationFrame(frame);
}

createWorlds(1201, true);
requestAnimationFrame(frame);
