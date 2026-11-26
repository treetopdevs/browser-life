import './style.css';
import { CURRENT_CONDITIONS, MATTER_HEIGHT, MATTER_SIZE, MATTER_WIDTH, MatterWorld } from './model.ts';
import type { MatterCensus, MatterHistorySample } from './model.ts';
import { advanceCurrentComparison, CURRENTS_TICK_LIMIT } from './comparison-clock.ts';
import { decodeReplaySeed, loadReplayPilot, replayNextIndex, replayWindowIndices, REPLAY_SEEDS, REPLAY_TICKS } from './replay.ts';
import type { ReplayPilotArtifact, ReplaySeedData } from './replay.ts';

const replayManifestAssets = import.meta.glob<string>('../../../../docs/creative-prototypes/current-pilot.json', { eager: true, query: '?url', import: 'default' });
const replaySeedAssets = import.meta.glob<string>('../../../../docs/creative-prototypes/currents-replay-*.replay', { eager: true, query: '?url&no-inline', import: 'default' });

type View = 'composite' | 'biomass' | 'nutrient' | 'detritus' | 'difference';
type Card = { root: HTMLElement; world: MatterWorld; canvas: HTMLCanvasElement; context: CanvasRenderingContext2D; fieldContext: CanvasRenderingContext2D; fieldImage: ImageData; historyCanvas: HTMLCanvasElement; historyContext: CanvasRenderingContext2D; census: MatterCensus; history: readonly MatterHistorySample[] };
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (value: number) => Math.round(value).toLocaleString('en-US');
const roots = [...document.querySelectorAll<HTMLElement>('.world-card')];
const cards: Card[] = roots.map((root, index) => {
  const canvas = root.querySelector<HTMLCanvasElement>('.world-canvas')!, context = canvas.getContext('2d');
  const fieldCanvas = document.createElement('canvas'); fieldCanvas.width = MATTER_WIDTH; fieldCanvas.height = MATTER_HEIGHT;
  const fieldContext = fieldCanvas.getContext('2d');
  const historyCanvas = root.querySelector<HTMLCanvasElement>('.history-biomass-canvas')!, historyContext = historyCanvas.getContext('2d');
  if (!context || !fieldContext || !historyContext) throw new Error('Canvas rendering is unavailable');
  return { root, world: new MatterWorld(1201, CURRENT_CONDITIONS[index]!.mode, CURRENT_CONDITIONS[index]!.current), canvas, context, fieldContext, fieldImage: fieldContext.createImageData(MATTER_WIDTH, MATTER_HEIGHT), historyCanvas, historyContext, census: null as unknown as MatterCensus, history: [] };
});
const seedInput = $('seed') as HTMLInputElement;
let seed = 1201, tick = 0, paused = true, view: View = 'composite', previousFrame = 0, accumulator = 0;
let pauseReason = document.hidden ? 'Paused while away' : matchMedia('(prefers-reduced-motion: reduce)').matches ? 'Paused · reduced motion' : 'Paused · ready';
let replayPilot: ReplayPilotArtifact | null = null, replayFrames: ReplaySeedData | null = null;
let replayWindow: 'dense' | 'coarse' = 'dense', replayFrameIndex = 0, replayTimer: ReturnType<typeof setInterval> | null = null;
let replayAbort: AbortController | null = null, replayRequest = 0, replayIsPlaying = false;
const colors = { biomass: [145, 225, 192], nutrient: [242, 190, 120], detritus: [181, 173, 242] } as const;
const intensity = (value: number, max: number) => Math.sqrt(Math.min(value, max) / max);

function updateStatus(): void {
  const capped = tick >= CURRENTS_TICK_LIMIT;
  if (capped) { paused = true; accumulator = 0; }
  $('play').textContent = paused ? 'Play' : 'Pause';
  ($('play') as HTMLButtonElement).disabled = capped || document.hidden;
  ($('step') as HTMLButtonElement).disabled = !paused || capped || document.hidden;
  $('status').textContent = document.hidden ? 'Paused while away' : capped ? '6,000 tick limit reached' : paused ? pauseReason : 'Four tanks advancing together';
  $('tick').textContent = fmt(tick); $('seed-display').textContent = `Matched seed ${fmt(seed)}`;
}

function maxBiomass(): number {
  let max = 1;
  for (const card of cards) for (const sample of card.history) max = Math.max(max, sample.biomass);
  for (const card of cards) max = Math.max(max, card.census.biomass);
  if (max <= 1) return 1;
  const power = 10 ** Math.floor(Math.log10(max)), scaled = max / power;
  return (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10) * power;
}

function drawHistory(card: Card, scale: number): void {
  const { historyCanvas: canvas, historyContext: ctx } = card, width = canvas.width, height = canvas.height;
  ctx.fillStyle = '#0c1a20'; ctx.fillRect(0, 0, width, height); ctx.strokeStyle = '#30464e'; ctx.beginPath(); ctx.moveTo(0, height - 1); ctx.lineTo(width, height - 1); ctx.stroke();
  ctx.strokeStyle = '#91e1c0'; ctx.lineWidth = Math.max(1.5, width * .0025); ctx.beginPath();
  card.history.forEach((sample, index) => {
    const x = sample.tick / Math.max(1, tick) * width, y = height - 4 - Math.min(1, sample.biomass / scale) * (height - 8);
    if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  if (card.history.length) ctx.stroke();
}

function drawArrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, sx: number, sy: number): void {
  const ax = x1 * sx, ay = y1 * sy, bx = x2 * sx, by = y2 * sy;
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  const angle = Math.atan2(by - ay, bx - ax), size = Math.max(3, sx * .42);
  ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx - size * Math.cos(angle - .55), by - size * Math.sin(angle - .55)); ctx.lineTo(bx - size * Math.cos(angle + .55), by - size * Math.sin(angle + .55)); ctx.closePath(); ctx.fill();
}

function drawPumpPaths(card: Card): void {
  if (card.world.current !== 'circulating' || view === 'difference') return;
  const ctx = card.context, sx = card.canvas.width / MATTER_WIDTH, sy = card.canvas.height / MATTER_HEIGHT;
  ctx.save(); ctx.strokeStyle = 'rgba(255,239,178,.72)'; ctx.fillStyle = 'rgba(255,239,178,.82)'; ctx.lineWidth = Math.max(1, sx * .09); ctx.setLineDash([4 * sx, 3 * sx]);
  // Static supplied path sketches for representative pairs 8/9, 24/25, 40/41 and 56/57.
  for (const left of [8, 24, 40, 56]) {
    drawArrow(ctx, left + .5, 47.5, left + .5, .5, sx, sy);
    drawArrow(ctx, left + 1.5, .5, left + 1.5, 47.5, sx, sy);
    drawArrow(ctx, left + .5, .5, left + 1.5, .5, sx, sy);
    drawArrow(ctx, left + 1.5, 47.5, left + .5, 47.5, sx, sy);
  }
  ctx.restore();
}

function drawWorld(card: Card, index: number): void {
  const { canvas, context: ctx, fieldContext, fieldImage } = card;
  const width = canvas.width; if (!width) return;
  const height = Math.round(width * MATTER_HEIGHT / MATTER_WIDTH); if (canvas.height !== height) canvas.height = height;
  const { nutrient, biomass, detritus } = card.world.fields, out = fieldImage.data;
  const sibling = index % 2 === 1 ? cards[index - 1]!.world.fields.nutrient : null;
  for (let i = 0; i < MATTER_SIZE; i++) {
    const p = i * 4, bi = intensity(biomass[i]!, 64), ni = intensity(nutrient[i]!, 32), di = intensity(detritus[i]!, 16);
    let r: number, g: number, b: number;
    if (view === 'difference') {
      const delta = card.world.current === 'off' ? 0 : Math.max(-8, Math.min(8, nutrient[i]! - sibling![i]!));
      const amount = Math.abs(delta) / 8;
      [r, g, b] = delta > 0 ? [252, 154 + 62 * (1 - amount), 126 + 60 * (1 - amount)] : delta < 0 ? [112 + 63 * (1 - amount), 166 + 63 * (1 - amount), 245] : [20, 32, 38];
      r *= delta === 0 ? 1 : amount; g *= delta === 0 ? 1 : amount; b *= delta === 0 ? 1 : amount;
    } else if (view === 'biomass') { r = colors.biomass[0] * bi; g = colors.biomass[1] * bi; b = colors.biomass[2] * bi; }
    else if (view === 'nutrient') { r = colors.nutrient[0] * ni; g = colors.nutrient[1] * ni; b = colors.nutrient[2] * ni; }
    else if (view === 'detritus') { r = colors.detritus[0] * di; g = colors.detritus[1] * di; b = colors.detritus[2] * di; }
    else { r = Math.min(255, colors.biomass[0] * bi + colors.nutrient[0] * ni * .60 + colors.detritus[0] * di * .35); g = Math.min(255, colors.biomass[1] * bi + colors.nutrient[1] * ni * .58 + colors.detritus[1] * di * .35); b = Math.min(255, colors.biomass[2] * bi + colors.nutrient[2] * ni * .5 + colors.detritus[2] * di * .55); }
    out[p] = r; out[p + 1] = g; out[p + 2] = b; out[p + 3] = 255;
  }
  fieldContext.putImageData(fieldImage, 0, 0); ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, width, height); ctx.drawImage(fieldContext.canvas, 0, 0, width, height);
  const sx = width / MATTER_WIDTH, sy = height / MATTER_HEIGHT;
  if (view !== 'difference') {
    const center = Math.floor(card.world.tick / 10) % MATTER_WIDTH; ctx.fillStyle = 'rgba(235,220,140,.065)';
    for (let x = 0; x < MATTER_WIDTH; x++) { const distance = Math.min((x - center + MATTER_WIDTH) % MATTER_WIDTH, (center - x + MATTER_WIDTH) % MATTER_WIDTH); if (distance <= 24) ctx.fillRect(x * sx, 0, Math.ceil(sx), 36 * sy); }
    ctx.fillStyle = 'rgba(10,16,24,.27)'; ctx.fillRect(0, 36 * sy, width, 12 * sy);
    ctx.strokeStyle = 'rgba(236,231,178,.8)'; ctx.lineWidth = Math.max(1, width / 700); ctx.beginPath(); ctx.moveTo(0, sy * .5); ctx.lineTo(width, sy * .5); ctx.stroke();
    ctx.font = `${Math.max(8, Math.round(width / 85))}px ui-sans-serif,system-ui,sans-serif`; ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.fillStyle = 'rgba(249,239,184,.9)'; ctx.fillText('TOP INLET', width - 5, 3); ctx.fillStyle = 'rgba(225,233,229,.78)'; ctx.fillText('DEEP ZONE', width - 5, 36 * sy + 3);
    drawPumpPaths(card);
  }
}

function refreshAll(force = false): void {
  for (const card of cards) { card.census = card.world.census(); card.history = card.world.history; updateCard(card); }
  const scale = maxBiomass();
  for (const card of cards) { card.root.querySelector<HTMLElement>('.history-biomass-scale')!.textContent = `0–${fmt(scale)} units · shared`; drawHistory(card, scale); }
  updateStatus(); if (force) drawAll();
}

function updateCard(card: Card): void {
  const c = card.census, set = (selector: string, value: string) => { const node = card.root.querySelector<HTMLElement>(selector)!; if (node.textContent !== value) node.textContent = value; };
  set('.biomass-total', fmt(c.biomass)); set('.active-cells', fmt(c.activeCells)); set('.nutrient-total', fmt(c.nutrient)); set('.detritus-total', fmt(c.detritus)); set('.reservoir-total', fmt(c.reservoir)); set('.circulated', fmt(c.circulated)); set('.ledger', c.residual === 0 ? 'Balanced' : `Residual ${fmt(c.residual)}`); set('.components', fmt(c.components));
  const extinction = card.root.querySelector<HTMLElement>('.extinction')!; extinction.hidden = card.world.extinctionTick === null;
  if (!extinction.hidden) extinction.textContent = `Biomass reached zero at tick ${fmt(card.world.extinctionTick!)}; material updates continue.`;
}
function drawAll(): void { cards.forEach(drawWorld); }
function resizeCard(card: Card): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2), width = Math.max(1, Math.round(card.canvas.getBoundingClientRect().width * dpr));
  if (card.canvas.width !== width) card.canvas.width = width;
  const historyWidth = Math.max(1, Math.round(card.historyCanvas.getBoundingClientRect().width * dpr));
  if (card.historyCanvas.width !== historyWidth) card.historyCanvas.width = historyWidth;
  card.historyCanvas.height = Math.round(historyWidth / 10); drawAll(); refreshAll();
}
function resetWorlds(nextSeed: number, initial = false): void {
  cards.forEach((card, index) => { const condition = CURRENT_CONDITIONS[index]!; card.world = new MatterWorld(nextSeed, condition.mode, condition.current); card.census = card.world.census(); card.history = card.world.history; });
  seed = nextSeed; tick = 0; paused = true; accumulator = 0; previousFrame = 0;
  pauseReason = document.hidden ? 'Paused while away' : initial && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'Paused · reduced motion' : 'Paused · reset';
  seedInput.value = String(nextSeed); refreshAll(true);
}
function parseSeed(value: string): number | null { const trimmed = value.trim(); if (!trimmed) return null; const valueNumber = Number(trimmed); return Number.isInteger(valueNumber) && valueNumber >= 0 && valueNumber <= 0xffff_ffff ? valueNumber : null; }

const replayManifestUrl = Object.values(replayManifestAssets)[0];
const replaySeedUrls = new Map(Object.entries(replaySeedAssets).flatMap(([path, url]) => {
  const match = path.match(/currents-replay-(\d+)\.replay$/); return match ? [[Number(match[1]), url] as const] : [];
}));
const replaySeedSelect = $('replay-seed') as HTMLSelectElement, replayConditionSelect = $('replay-condition') as HTMLSelectElement;
const replayWindowSelect = $('replay-window') as HTMLSelectElement, replaySlider = $('replay-slider') as HTMLInputElement;
const replayCanvases = new Map([...document.querySelectorAll<HTMLCanvasElement>('[data-replay-condition]')].map(canvas => [canvas.dataset.replayCondition!, canvas]));
const replayHistoryCanvases = new Map([...document.querySelectorAll<HTMLCanvasElement>('[data-history-condition]')].map(canvas => [canvas.dataset.historyCondition!, canvas]));
const replayHistoryContexts = new Map([...replayHistoryCanvases].map(([conditionId, canvas]) => [conditionId, canvas.getContext('2d')!]));
function replayCensusFor(seedNumber: number, conditionId: string) {
  return replayPilot?.runs.find(run => run.seed === seedNumber && run.conditionId === conditionId)?.replayCensus ?? [];
}
function pauseReplay(): void {
  replayIsPlaying = false; if (replayTimer !== null) clearInterval(replayTimer); replayTimer = null;
  const button = $('replay-play') as HTMLButtonElement; button.textContent = 'Play replay';
}
function currentReplayWindowIndexes(): number[] { return replayWindowIndices(REPLAY_TICKS, replayWindow); }
function setReplayFrame(index: number): void {
  if (!replayFrames || !replayPilot) return;
  replayFrameIndex = Math.max(0, Math.min(REPLAY_TICKS.length - 1, index));
  const actualTick = REPLAY_TICKS[replayFrameIndex]!;
  $('replay-tick').textContent = fmt(actualTick); replaySlider.value = String(Math.max(0, currentReplayWindowIndexes().indexOf(replayFrameIndex)));
  const selectedCondition = replayConditionSelect.value;
  for (const [conditionId, canvas] of replayCanvases) {
    const frames = replayFrames.get(conditionId as typeof CURRENT_CONDITIONS[number]['id']);
    const frame = frames?.[replayFrameIndex]; if (!frame) continue;
    const context = canvas.getContext('2d')!; canvas.width = Math.max(1, Math.round(canvas.getBoundingClientRect().width * Math.min(window.devicePixelRatio || 1, 2))); canvas.height = Math.round(canvas.width * MATTER_HEIGHT / MATTER_WIDTH);
    const fieldCanvas = document.createElement('canvas'); fieldCanvas.width = MATTER_WIDTH; fieldCanvas.height = MATTER_HEIGHT;
    const fieldContext = fieldCanvas.getContext('2d')!, image = fieldContext.createImageData(MATTER_WIDTH, MATTER_HEIGHT), out = image.data;
    const siblingId = conditionId.endsWith('-current') ? conditionId.replace(/-current$/, '-still') : null;
    const sibling = siblingId ? replayFrames.get(siblingId as typeof CURRENT_CONDITIONS[number]['id'])?.[replayFrameIndex] : null;
    for (let cell = 0; cell < MATTER_SIZE; cell++) {
      const p = cell * 4, bi = intensity(frame.biomass[cell]!, 64), ni = intensity(frame.nutrient[cell]!, 32), di = intensity(frame.detritus[cell]!, 16);
      let r: number, g: number, b: number;
      if (view === 'difference') {
        const delta = sibling ? Math.max(-8, Math.min(8, frame.nutrient[cell]! - sibling.nutrient[cell]!)) : 0, amount = Math.abs(delta) / 8;
        r = delta > 0 ? 252 * amount : delta < 0 ? 112 * amount : 20; g = delta > 0 ? 154 * amount : delta < 0 ? 166 * amount : 32; b = delta > 0 ? 126 * amount : delta < 0 ? 245 * amount : 38;
      } else if (view === 'biomass') { r = colors.biomass[0] * bi; g = colors.biomass[1] * bi; b = colors.biomass[2] * bi; }
      else if (view === 'nutrient') { r = colors.nutrient[0] * ni; g = colors.nutrient[1] * ni; b = colors.nutrient[2] * ni; }
      else if (view === 'detritus') { r = colors.detritus[0] * di; g = colors.detritus[1] * di; b = colors.detritus[2] * di; }
      else { r = Math.min(255, colors.biomass[0] * bi + colors.nutrient[0] * ni * .6 + colors.detritus[0] * di * .35); g = Math.min(255, colors.biomass[1] * bi + colors.nutrient[1] * ni * .58 + colors.detritus[1] * di * .35); b = Math.min(255, colors.biomass[2] * bi + colors.nutrient[2] * ni * .5 + colors.detritus[2] * di * .55); }
      out[p] = r; out[p + 1] = g; out[p + 2] = b; out[p + 3] = 255;
    }
    fieldContext.putImageData(image, 0, 0); context.imageSmoothingEnabled = false; context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(fieldCanvas, 0, 0, canvas.width, canvas.height);
    if (view !== 'difference') {
      const sx = canvas.width / MATTER_WIDTH, sy = canvas.height / MATTER_HEIGHT;
      const center = Math.floor(actualTick / 10) % MATTER_WIDTH; context.fillStyle = 'rgba(235,220,140,.065)';
      for (let x = 0; x < MATTER_WIDTH; x++) { const distance = Math.min((x - center + MATTER_WIDTH) % MATTER_WIDTH, (center - x + MATTER_WIDTH) % MATTER_WIDTH); if (distance <= 24) context.fillRect(x * sx, 0, Math.ceil(sx), 36 * sy); }
      context.fillStyle = 'rgba(10,16,24,.27)'; context.fillRect(0, 36 * sy, canvas.width, 12 * sy);
      if (conditionId.endsWith('-current')) {
        context.save(); context.strokeStyle = 'rgba(255,239,178,.72)'; context.lineWidth = Math.max(1, sx * .09); context.setLineDash([4 * sx, 3 * sx]);
        for (const left of [8, 24, 40, 56]) { drawArrow(context, left + .5, 47.5, left + .5, .5, sx, sy); drawArrow(context, left + 1.5, .5, left + 1.5, 47.5, sx, sy); drawArrow(context, left + .5, .5, left + 1.5, .5, sx, sy); drawArrow(context, left + 1.5, 47.5, left + .5, 47.5, sx, sy); }
        context.restore();
      }
    }
    canvas.closest('figure')?.classList.toggle('selected', conditionId === selectedCondition);
  }
  drawReplayHistories();
}
function drawReplayHistories(): void {
  if (!replayPilot) return;
  const series = CURRENT_CONDITIONS.map(condition => replayCensusFor(Number(replaySeedSelect.value), condition.id));
  const max = Math.max(1, ...series.flatMap(rows => rows.map(row => Number(row.biomass) || 0)));
  const scale = max <= 1 ? 1 : (10 ** Math.floor(Math.log10(max))) * (max / 10 ** Math.floor(Math.log10(max)) <= 2 ? 2 : max / 10 ** Math.floor(Math.log10(max)) <= 5 ? 5 : 10);
  for (const condition of CURRENT_CONDITIONS) {
    const conditionId = condition.id, canvas = replayHistoryCanvases.get(conditionId)!, ctx = replayHistoryContexts.get(conditionId)!;
    const rows = replayCensusFor(Number(replaySeedSelect.value), conditionId), width = canvas.width, height = canvas.height;
    ctx.fillStyle = '#0c1a20'; ctx.fillRect(0, 0, width, height); ctx.strokeStyle = '#91e1c0'; ctx.lineWidth = 1.5; ctx.beginPath();
    rows.forEach((row, index) => { const x = Number(row.tick) / 6000 * width, y = height - 4 - Math.min(1, Number(row.biomass) / scale) * (height - 8); if (!index) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    if (rows.length) ctx.stroke();
    const explicitExtinction = rows.map(row => row.extinctionTick).find(value => Number.isSafeInteger(value));
    const firstZero = rows.find(row => row.biomass === 0)?.tick;
    const status = explicitExtinction !== undefined ? `Biomass reached zero at tick ${fmt(Number(explicitExtinction))}.` : firstZero !== undefined ? `Biomass first sampled at zero by tick ${fmt(Number(firstZero))}.` : rows.length ? 'Biomass remains at tick 6,000.' : '';
    document.querySelector<HTMLElement>(`[data-status-condition="${conditionId}"]`)!.textContent = `${status} Shared scale: 0–${fmt(scale)} units.`;
  }
}
function setReplayWindow(next: 'dense' | 'coarse'): void {
  replayWindow = next; const indexes = currentReplayWindowIndexes(), currentTick = REPLAY_TICKS[replayFrameIndex] ?? 0;
  const nearest = indexes.reduce((best, candidate) => Math.abs(REPLAY_TICKS[candidate]! - currentTick) < Math.abs(REPLAY_TICKS[best]! - currentTick) ? candidate : best, indexes[0]!);
  const sliderIndex = Math.max(0, indexes.indexOf(nearest)); replaySlider.min = '0'; replaySlider.max = String(indexes.length - 1); replaySlider.value = String(sliderIndex); setReplayFrame(nearest);
}
function setReplayControls(enabled: boolean): void {
  for (const id of ['replay-condition', 'replay-window', 'replay-step', 'replay-slider']) ($(id) as HTMLInputElement | HTMLSelectElement | HTMLButtonElement).disabled = !enabled;
  ($('replay-play') as HTMLButtonElement).disabled = !enabled;
}
function clearReplayViews(): void {
  for (const canvas of replayCanvases.values()) { const context = canvas.getContext('2d')!; context.clearRect(0, 0, canvas.width, canvas.height); }
  for (const [conditionId, canvas] of replayHistoryCanvases) { replayHistoryContexts.get(conditionId)!.clearRect(0, 0, canvas.width, canvas.height); document.querySelector<HTMLElement>(`[data-status-condition="${conditionId}"]`)!.textContent = ''; }
}
async function selectReplaySeed(seedNumber: number): Promise<void> {
  if (!replayPilot || !replayManifestUrl) return;
  pauseReplay(); replayAbort?.abort(); const controller = new AbortController(); replayAbort = controller; const request = ++replayRequest; replayFrames = null; clearReplayViews();
  setReplayControls(false); replaySeedSelect.disabled = false; $('replay-tick').textContent = '—'; $('replay-state').textContent = `Loading recorded seed ${seedNumber}…`;
  const entry = replayPilot.replay.seeds.find(item => item.seed === seedNumber), seedUrl = entry ? replaySeedUrls.get(seedNumber) : undefined;
  if (!entry || !seedUrl) { replaySeedSelect.disabled = false; $('replay-state').textContent = `Replay asset for seed ${seedNumber} is missing.`; return; }
  try {
    const response = await fetch(seedUrl, { signal: controller.signal });
    if (!response.ok) throw new Error(`Replay seed request failed (${response.status})`);
    const frames = await decodeReplaySeed(replayPilot, seedNumber, await response.arrayBuffer());
    if (request !== replayRequest || controller.signal.aborted) return;
    replayFrames = frames; replayFrameIndex = 0; replaySeedSelect.disabled = false; setReplayControls(true); $('replay-state').textContent = `Seed ${seedNumber} · four matched conditions · verified saved states.`;
    setReplayWindow(replayWindow);
  } catch (error) {
    if (controller.signal.aborted || request !== replayRequest) return;
    replaySeedSelect.disabled = false; $('replay-state').textContent = `Replay could not be loaded: ${error instanceof Error ? error.message : String(error)}`;
  }
}
async function initializeReplay(): Promise<void> {
  if (!replayManifestUrl) return;
  $('replay-state').textContent = 'Checking the recorded pilot manifest…';
  try {
    replayPilot = await loadReplayPilot(replayManifestUrl);
    replaySeedSelect.replaceChildren(...REPLAY_SEEDS.map(seedNumber => { const option = document.createElement('option'); option.value = String(seedNumber); option.textContent = fmt(seedNumber); return option; }));
    replaySeedSelect.disabled = false; replayConditionSelect.disabled = false; replayWindowSelect.disabled = false;
    await selectReplaySeed(Number(replaySeedSelect.value));
  } catch (error) {
    $('replay-state').textContent = `Pilot replay is unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
}

replaySeedSelect.addEventListener('change', () => { const parsed = Number(replaySeedSelect.value); if (REPLAY_SEEDS.includes(parsed as typeof REPLAY_SEEDS[number])) void selectReplaySeed(parsed); });
replayConditionSelect.addEventListener('change', () => { if (replayFrames) setReplayFrame(replayFrameIndex); });
replayWindowSelect.addEventListener('change', () => { pauseReplay(); setReplayWindow(replayWindowSelect.value as 'dense' | 'coarse'); });
replaySlider.addEventListener('input', () => { const indexes = currentReplayWindowIndexes(), position = Number(replaySlider.value); if (Number.isInteger(position) && indexes[position] !== undefined) { pauseReplay(); setReplayFrame(indexes[position]!); } });
$('replay-step').addEventListener('click', () => { if (!replayFrames) return; pauseReplay(); setReplayFrame(replayNextIndex(REPLAY_TICKS, replayFrameIndex, 1, replayWindow)); });
$('replay-play').addEventListener('click', () => {
  if (!replayFrames || document.hidden) return;
  if (replayIsPlaying) { pauseReplay(); return; }
  replayIsPlaying = true; ($('replay-play') as HTMLButtonElement).textContent = 'Pause replay';
  replayTimer = setInterval(() => { const next = replayNextIndex(REPLAY_TICKS, replayFrameIndex, 1, replayWindow); if (next === replayFrameIndex) { pauseReplay(); return; } setReplayFrame(next); }, 100);
});

$('seed-form').addEventListener('submit', event => { event.preventDefault(); const parsed = parseSeed(seedInput.value); if (parsed === null) { $('seed-error').textContent = 'Enter a number from 0 to 4,294,967,295. The current tanks are unchanged.'; return; } $('seed-error').textContent = ''; resetWorlds(parsed); });
$('play').addEventListener('click', () => { if (document.hidden || tick >= CURRENTS_TICK_LIMIT) return; paused = !paused; accumulator = 0; previousFrame = 0; if (paused) { pauseReason = 'Paused by you'; refreshAll(true); } else { pauseReason = ''; updateStatus(); } });
$('step').addEventListener('click', () => { if (!paused || document.hidden || tick >= CURRENTS_TICK_LIMIT) return; tick = advanceCurrentComparison(cards.map(card => card.world), tick); refreshAll(true); });
$('export').addEventListener('click', () => {
  refreshAll(true);
  const payload = { kind: 'nutrient-currents-observation', schemaVersion: 1, observationOnly: true, description: 'Full observation, not a resumable checkpoint. These are designed material-flow rules, not organisms or an ecological claim.', seed, comparisonTick: tick, view, worlds: cards.map((card, index) => {
    const snapshot = card.world.snapshot();
    return { conditionId: CURRENT_CONDITIONS[index]!.id, snapshot };
  }) };
  const json = JSON.stringify(payload, null, 2), bytes = new TextEncoder().encode(json).byteLength, limit = 12 * 1024 * 1024;
  if (bytes > limit) { $('file-status').textContent = `${fmt(bytes)} bytes exceeds the 12 MiB download limit; observations were not truncated.`; return; }
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' })), link = document.createElement('a');
  link.href = url; link.download = `currents-seed-${seed}-tick-${tick}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  $('file-status').textContent = `All four full observations saved (${fmt(bytes)} bytes). Not a resumable checkpoint.`;
});
for (const input of document.querySelectorAll<HTMLInputElement>('input[name="view"]')) input.addEventListener('change', () => { if (input.checked) { view = input.value as View; for (const node of document.querySelectorAll<HTMLElement>('.view-description')) node.textContent = view === 'difference' ? 'Nutrient − still sibling' : `${view[0]!.toUpperCase()}${view.slice(1)} view`; drawAll(); if (replayFrames) setReplayFrame(replayFrameIndex); } });
for (const card of cards) { new ResizeObserver(() => resizeCard(card)).observe(card.canvas); new ResizeObserver(() => resizeCard(card)).observe(card.historyCanvas); }
document.addEventListener('visibilitychange', () => { accumulator = 0; previousFrame = 0; if (document.hidden) { paused = true; pauseReason = 'Paused while away'; pauseReplay(); refreshAll(true); } else { if (pauseReason === 'Paused while away') pauseReason = 'Paused · ready'; updateStatus(); } });

function frame(now: number): void {
  if (!paused && !document.hidden) {
    const duration = 1000 / 30;
    accumulator = Math.min(accumulator + Math.min(previousFrame ? now - previousFrame : 0, 100) * Number(($('pace') as HTMLSelectElement).value), duration * 4);
    const available = Math.floor((accumulator + 1e-7) / duration), count = Math.min(available, 4, CURRENTS_TICK_LIMIT - tick);
    for (let i = 0; i < count; i++) tick = advanceCurrentComparison(cards.map(card => card.world), tick);
    accumulator = Math.max(0, accumulator - count * duration);
    if (tick >= CURRENTS_TICK_LIMIT) { paused = true; pauseReason = '6,000 tick limit reached'; }
    if (count) { refreshAll(); drawAll(); }
  }
  previousFrame = now; requestAnimationFrame(frame);
}

resetWorlds(1201, true); requestAnimationFrame(frame); void initializeReplay();
