import './style.css';
import { advanceDevelopmentComparison } from '../development/comparison-clock.ts';
import { loadModel, makeWorld, PARITY, resolveModelKey, type ModelModule, type WorldApi } from './models.ts';
import { SCREENS, defaultArms, getScreen, screenSeeds, type ArmSpec, type ScreenSpec } from './screens.ts';
import { accountingRows, bandReadout, drawHistory, drawWorld, lineageMetrics, viewFromWorld, FAMILY_NAMES, type DeathCounts, type TickPoint } from './render.ts';
import { checkReplay, compareFrame, describeResult, fetchRecording, recordedAvailable, replayUrl, type ReplayResult } from './replay-check.ts';
import type { PulseTargets } from './targets.ts';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const MAX_SEED = 0xffffffff;
const TICKS_PER_SECOND = 30;
const SLICE_MS = 8;

interface Card {
  readonly arm: ArmSpec;
  readonly root: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly historyCanvas: HTMLCanvasElement;
  readonly historyCtx: CanvasRenderingContext2D;
  world: WorldApi;
  points: TickPoint[];
  pulse: { pulses: number; targets: PulseTargets } | null;
  deaths: DeathCounts;
  deathKey: string;
  drawnTick: number;
}

let screen: ScreenSpec = SCREENS[0]!;
let seed = screen.seeds.primary;
let otherSeed = false;
let otherFormOpen = false;
let withOptional = false;
let mod: ModelModule | null = null;
let cards: Card[] = [];
let clockTick = 0;
let paused = true;
let pauseReason = 'Paused · ready';
let previousFrame = 0;
let accumulator = 0;
let generation = 0;
let compareRunning = false;
let compareToken = { aborted: false };
const availability = new Map<string, Promise<boolean>>();

const playButton = el<HTMLButtonElement>('play');
const stepButton = el<HTMLButtonElement>('step');
const resetButton = el<HTMLButtonElement>('reset');
const paceInput = el<HTMLSelectElement>('pace');
const status = el<HTMLElement>('status');
const tickLabel = el<HTMLElement>('tick');
const horizonLabel = el<HTMLElement>('horizon');
const worldsRoot = el<HTMLElement>('worlds');
const summary = el<HTMLElement>('screen-summary');
const fileStatus = el<HTMLElement>('file-status');
const compareSection = el<HTMLElement>('compare-section');
const compareButton = el<HTMLButtonElement>('compare');
const compareProgress = el<HTMLElement>('compare-progress');
const compareResult = el<HTMLElement>('compare-result');

function text(node: Element, value: string): void { if (node.textContent !== value) node.textContent = value; }

/* ---------- picker ---------- */

function buildScreenChoices(): void {
  const root = el('screen-choices');
  root.replaceChildren(...SCREENS.map(s => {
    const label = document.createElement('label');
    label.className = 'choice';
    const input = document.createElement('input');
    input.type = 'radio'; input.name = 'screen'; input.value = s.id; input.checked = s.id === screen.id;
    const title = document.createElement('span'); title.className = 'choice-title'; title.textContent = s.title;
    const detail = document.createElement('span'); detail.className = 'choice-text';
    detail.textContent = `${s.choiceText} Runs to ${fmt(s.horizon)} ticks.`;
    label.append(input, title, detail);
    input.addEventListener('change', () => { if (input.checked) selectScreen(s.id); });
    return label;
  }));
}

function buildSeedChoices(): void {
  const root = el('seed-choices');
  const choices = screenSeeds(screen).map((value, index) => {
    const label = document.createElement('label'); label.className = 'choice';
    const input = document.createElement('input'); input.type = 'radio'; input.name = 'seed'; input.value = String(value);
    input.checked = !otherSeed && !otherFormOpen && value === seed;
    const title = document.createElement('span'); title.className = 'choice-title';
    title.textContent = index === 0 ? `${value} · the screen's main seed` : `${value} · run again to check`;
    const detail = document.createElement('span'); detail.className = 'choice-text';
    detail.textContent = index === 0 ? 'The seed the screen was first run on.' : 'A second seed the screen was repeated on, to see whether the first run was a one-off.';
    label.append(input, title, detail);
    input.addEventListener('change', () => { if (input.checked) { otherSeed = false; otherFormOpen = false; seed = value; el('other-seed-form').hidden = true; syncUrl(); rebuild(); } });
    return label;
  });
  const other = document.createElement('label'); other.className = 'choice';
  const input = document.createElement('input'); input.type = 'radio'; input.name = 'seed'; input.value = 'other'; input.checked = otherSeed || otherFormOpen;
  const title = document.createElement('span'); title.className = 'choice-title'; title.textContent = 'Other seed (exploration)';
  const detail = document.createElement('span'); detail.className = 'choice-text'; detail.textContent = 'Any whole number. Not part of the screen, so nothing to compare with.';
  other.append(input, title, detail);
  input.addEventListener('change', () => { if (input.checked) { otherFormOpen = true; el('other-seed-form').hidden = false; el<HTMLInputElement>('other-seed').focus(); } });
  root.replaceChildren(...choices, other);
  el('other-seed-form').hidden = !(otherSeed || otherFormOpen);
}

function buildOptionalArm(): void {
  const optional = screen.arms.find(a => a.optional);
  const box = el('optional-arm');
  box.hidden = !optional;
  if (!optional) { withOptional = false; return; }
  text(el('optional-arm-label'), `Also run "${optional.label}" beside it (${optional.differs}) Same seed, same clock.`);
  el<HTMLInputElement>('optional-arm-toggle').checked = withOptional;
}

function selectScreen(id: string): void {
  const next = getScreen(id);
  if (!next) return;
  screen = next; otherSeed = false; otherFormOpen = false; seed = next.seeds.primary; withOptional = false;
  el('other-seed-error').textContent = '';
  buildSeedChoices(); buildOptionalArm();
  syncUrl();
  rebuild();
}

function syncUrl(): void {
  try {
    const url = new URL(location.href);
    url.searchParams.set('screen', screen.id); url.searchParams.set('seed', String(seed));
    history.replaceState(null, '', url);
  } catch { /* the address bar is a convenience only */ }
}

/* ---------- worlds ---------- */

function activeArms(): ArmSpec[] { return withOptional ? [...screen.arms] : [...defaultArms(screen)]; }

function makeCard(arm: ArmSpec, index: number, model: ModelModule): Card {
  const root = document.createElement('article');
  root.className = 'world-card'; root.dataset.arm = arm.id; root.dataset.mode = arm.mode;
  const headingId = `world-${index}-title`;
  root.setAttribute('aria-labelledby', headingId);
  root.innerHTML = `
    <header class="world-head"><div><p class="eyebrow">World ${'AB'[index]}</p><h2 id="${headingId}"></h2></div><span class="condition">768 food units offered per pulse</span></header>
    <p class="world-summary"></p>
    <canvas class="world-canvas" width="576" height="576" role="img"></canvas>
    <div class="canvas-legend"><span><i class="key-family family-1"></i> ${FAMILY_NAMES[0]}</span><span><i class="key-family family-2"></i> ${FAMILY_NAMES[1]}</span><span><i class="key-family family-3"></i> ${FAMILY_NAMES[2]}</span><span><i class="swatch swatch-eligible"></i> Food may be offered here</span><span><i class="swatch swatch-offered"></i> Picked by the last pulse</span></div>
    <p class="band-readout"></p>
    <p class="extinction" hidden></p>
    <section class="history-section"><div class="section-heading"><h3>Population over time</h3><span>family colours · every 20 ticks</span></div><canvas class="history-canvas" width="576" height="112" role="img"></canvas></section>`;
  root.querySelector('h2')!.textContent = arm.label;
  root.querySelector('.world-summary')!.textContent = arm.differs;
  const canvas = root.querySelector<HTMLCanvasElement>('.world-canvas')!;
  const historyCanvas = root.querySelector<HTMLCanvasElement>('.history-canvas')!;
  const ctx = canvas.getContext('2d'), historyCtx = historyCanvas.getContext('2d');
  if (!ctx || !historyCtx) throw new Error('Canvas 2D rendering is unavailable');
  historyCanvas.setAttribute('aria-label', `${arm.label}: living bodies over time, one line per family.`);
  const world = makeWorld(model, seed, arm.mode);
  const card: Card = { arm, root, canvas, ctx, historyCanvas, historyCtx, world, points: [], pulse: null, deaths: { starvation: 0, age: 0, maxGeneration: 0 }, deathKey: '', drawnTick: -1 };
  new ResizeObserver(() => resize(card)).observe(canvas);
  new ResizeObserver(() => resize(card)).observe(historyCanvas);
  return card;
}

function recordPoint(card: Card): void {
  const world = card.world;
  if (card.points.at(-1)?.tick === world.tick) return;
  const census = world.census();
  card.points.push({ tick: world.tick, population: census.population, familyCounts: census.familyCounts });
}

function resize(card: Card): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(card.canvas.getBoundingClientRect().width * dpr));
  if (width !== card.canvas.width) { card.canvas.width = width; card.canvas.height = width; }
  const historyWidth = Math.max(1, Math.round(card.historyCanvas.getBoundingClientRect().width * dpr));
  if (historyWidth !== card.historyCanvas.width) { card.historyCanvas.width = historyWidth; card.historyCanvas.height = Math.max(1, Math.round(historyWidth / 5)); }
  card.drawnTick = -1; paint(card, true); paintHistory(card);
}

function pulseTargets(card: Card): PulseTargets {
  const pulses = card.world.environment.pulses;
  if (card.pulse?.pulses !== pulses) card.pulse = { pulses, targets: viewFromWorld(card.world, mod!, card.arm.mode).pulse };
  return card.pulse.targets;
}

function paint(card: Card, force = false): void {
  if (!mod || (!force && card.drawnTick === card.world.tick)) return;
  const { view } = viewFromWorld(card.world, mod, card.arm.mode, pulseTargets(card));
  drawWorld(card.ctx, card.canvas.width, view);
  card.drawnTick = card.world.tick;
  const canvas = card.canvas;
  canvas.dataset.tick = String(card.world.tick);
  canvas.dataset.pulse = String(pulseTargets(card).pulse);
  canvas.dataset.offeredTiles = String(view.offered ? view.offered.reduce((n, v) => n + (v ? 1 : 0), 0) : 0);
  canvas.dataset.eligibleTiles = String(view.eligible ? view.eligible.reduce((n, v) => n + v, 0) : 0);
  const env = card.world.environment;
  canvas.dataset.bandLeft = String(env.bandLeft ?? '');
  canvas.dataset.activeBand = String(env.activeBand ?? '');
  canvas.dataset.outlines = view.outlines.map(o => `${o.left}+${o.width}:${o.style}`).join(',');
}

function paintHistory(card: Card): void {
  drawHistory(card.historyCtx, card.historyCanvas.width, card.historyCanvas.height, card.points, screen.horizon, mod!.RULES.maxOrganisms!);
}

function describeCanvas(card: Card): void {
  const census = card.world.census();
  const label = `${card.arm.label}, tick ${fmt(card.world.tick)}: ${census.population} living bodies. ${bandReadout(card.world, card.arm.mode)}.`;
  card.canvas.setAttribute('aria-label', label);
}

function refreshCard(card: Card): void {
  const world = card.world;
  const counters = world.countersView;
  const key = `${counters.births}/${counters.deaths}`;
  if (key !== card.deathKey) { card.deaths = lineageMetrics(world); card.deathKey = key; }
  text(card.root.querySelector('.band-readout')!, bandReadout(world, card.arm.mode));
  const extinct = card.root.querySelector<HTMLElement>('.extinction')!;
  extinct.hidden = world.extinctionTick === null;
  if (!extinct.hidden) text(extinct, `Extinct at tick ${fmt(world.extinctionTick!)}. This world is frozen; the shared clock continues to tick ${fmt(screen.horizon)} at most.`);
  paintHistory(card);
  card.historyCanvas.dataset.points = String(card.points.length);
  card.historyCanvas.dataset.lastTick = String(card.points.at(-1)?.tick ?? -1);
}

function refreshTable(): void {
  const table = el<HTMLTableElement>('accounting');
  const head = table.tHead!, body = table.tBodies[0]!;
  if (!cards.length) { head.replaceChildren(); body.replaceChildren(); delete table.dataset.signature; return; }
  const rows = cards.map(card => accountingRows(card.world, card.deaths));
  const union: { key: string; label: string; hint: string }[] = [];
  for (const set of rows) for (const row of set) if (!union.some(u => u.key === row.key)) union.push({ key: row.key, label: row.label, hint: row.hint });
  const valueOf = (c: number, key: string): string => { const row = rows[c]!.find(r => r.key === key); return row ? fmt(row.value) : '\u2014'; };
  const signature = `${cards.map(c => c.arm.label).join('|')}#${union.map(r => r.key).join(',')}`;
  if (table.dataset.signature !== signature) {
    table.dataset.signature = signature;
    const tr = document.createElement('tr');
    const first = document.createElement('th'); first.scope = 'col'; first.textContent = 'Measure'; tr.append(first);
    for (const card of cards) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = card.arm.label; tr.append(th); }
    head.replaceChildren(tr);
    body.replaceChildren(...union.map(row => {
      const r = document.createElement('tr'); r.dataset.key = row.key;
      const th = document.createElement('th'); th.scope = 'row'; th.append(row.label); const small = document.createElement('small'); small.textContent = row.hint; th.append(small);
      r.append(th);
      for (let c = 0; c < cards.length; c++) { const td = document.createElement('td'); td.dataset.card = String(c); td.textContent = valueOf(c, row.key); r.append(td); }
      return r;
    }));
    return;
  }
  [...body.rows].forEach(r => cards.forEach((_, c) => text(r.cells[c + 1]!, valueOf(c, r.dataset.key!))));
}

function updateStatus(): void {
  const allExtinct = cards.length > 0 && cards.every(card => card.world.extinctionTick !== null);
  const atHorizon = clockTick >= screen.horizon;
  if (allExtinct || atHorizon) { paused = true; accumulator = 0; }
  playButton.textContent = paused ? 'Play' : 'Pause';
  const dead = !cards.length || allExtinct || atHorizon || document.hidden;
  playButton.disabled = dead;
  stepButton.disabled = !paused || dead;
  resetButton.disabled = !cards.length;
  const next = document.hidden ? 'Paused while away' : allExtinct ? 'All worlds extinct' : atHorizon ? `${fmt(screen.horizon)} tick horizon reached` : paused ? pauseReason : 'Advancing together';
  text(status, next);
  text(tickLabel, fmt(clockTick));
  text(horizonLabel, fmt(screen.horizon));
}

function refreshAll(): void {
  for (const card of cards) refreshCard(card);
  refreshTable();
  updateStatus();
}

function paintAll(describe = false): void {
  for (const card of cards) { paint(card); if (describe) describeCanvas(card); }
}

function advanceOneTick(): boolean {
  const next = advanceDevelopmentComparison(cards.map(c => c.world), clockTick, screen.horizon);
  if (next === clockTick) return false;
  clockTick = next;
  for (const card of cards) {
    const world = card.world;
    if (world.tick % 20 === 0 || (world.extinctionTick === world.tick)) recordPoint(card);
  }
  return true;
}

/** Build the worlds for the current screen, seed and arms. Always paused at tick 0. */
async function rebuild(initial = false): Promise<void> {
  const mine = ++generation;
  compareToken.aborted = true;
  const key = resolveModelKey(screen.id);
  const model = await loadModel(key);
  if (mine !== generation) return;
  mod = model;
  clockTick = 0; paused = true; accumulator = 0; previousFrame = 0;
  pauseReason = document.hidden ? 'Paused while away' : initial && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'Paused · reduced motion' : 'Paused · ready';
  cards = activeArms().map((arm, index) => makeCard(arm, index, model));
  worldsRoot.replaceChildren(...cards.map(c => c.root));
  for (const card of cards) { recordPoint(card); resize(card); describeCanvas(card); }
  refreshAll();
  renderSummary(key);
  compareResult.replaceChildren(); compareProgress.textContent = '';
  void updateCompareAvailability(mine);
}

function renderSummary(key: string): void {
  const record = PARITY[screen.id]!;
  const modelNote = key === record.ownKey
    ? `Runs on the model copy this screen's own experiment used (${key}).`
    : `Runs on the newest model copy (${key}); it matched this screen's own model (${record.ownKey}) at ticks 0, 500 and the final tick (census, food, bodies and counters).`;
  const h2 = document.createElement('h2'); h2.textContent = screen.title;
  const question = document.createElement('p'); question.textContent = `The question it was run to ask: ${screen.question}`;
  const info = document.createElement('p');
  info.textContent = `Seed ${seed}${otherSeed ? ' (exploration: not one of the screen’s seeds)' : ''} · runs to tick ${fmt(screen.horizon)} or until every body is gone · ${activeArms().length === 1 ? 'one world' : 'two worlds, same seed, same clock'}.`;
  const note = document.createElement('p'); note.className = 'model-note'; note.textContent = `${modelNote}${screen.note ? ' ' + screen.note : ''}`;
  summary.replaceChildren(h2, question, info, note);
}

/* ---------- playback ---------- */

function frame(now: number): void {
  if (!paused && !document.hidden && cards.length) {
    const started = performance.now();
    const unlimited = paceInput.value === 'max';
    let allowed: number;
    if (unlimited) allowed = Infinity;
    else {
      accumulator = Math.min(accumulator + Math.min(previousFrame ? now - previousFrame : 0, 100) * Number(paceInput.value) * TICKS_PER_SECOND / 1000, 4 * Number(paceInput.value));
      allowed = Math.floor(accumulator);
    }
    let ticks = 0;
    while (ticks < allowed && performance.now() - started < SLICE_MS) {
      if (!advanceOneTick()) break;
      ticks++;
      if (cards.every(c => c.world.extinctionTick !== null) || clockTick >= screen.horizon) { paused = true; break; }
    }
    if (!unlimited) accumulator -= ticks;
    if (ticks) { refreshAll(); paintAll(paused); }
  }
  previousFrame = now;
  requestAnimationFrame(frame);
}

playButton.addEventListener('click', () => {
  if (document.hidden || !cards.length) return;
  paused = !paused; accumulator = 0; previousFrame = 0;
  if (paused) { pauseReason = 'Paused by you'; refreshAll(); paintAll(true); } else { pauseReason = ''; updateStatus(); }
});
stepButton.addEventListener('click', () => {
  if (!paused || document.hidden) return;
  if (advanceOneTick()) { refreshAll(); paintAll(true); }
});
resetButton.addEventListener('click', () => { void rebuild(); });
document.addEventListener('visibilitychange', () => {
  accumulator = 0; previousFrame = 0;
  if (document.hidden) { paused = true; pauseReason = 'Paused while away'; refreshAll(); paintAll(true); }
  else { if (pauseReason === 'Paused while away') pauseReason = 'Paused · ready'; updateStatus(); }
});
el<HTMLInputElement>('optional-arm-toggle').addEventListener('change', event => {
  withOptional = (event.target as HTMLInputElement).checked;
  void rebuild();
});
el<HTMLFormElement>('other-seed-form').addEventListener('submit', event => {
  event.preventDefault();
  const value = el<HTMLInputElement>('other-seed').value.trim();
  const parsed = /^\d{1,10}$/.test(value) ? Number(value) : NaN;
  const error = el('other-seed-error');
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_SEED) { error.textContent = `Enter a whole number from 0 to ${fmt(MAX_SEED)}. The worlds are unchanged.`; return; }
  error.textContent = '';
  otherSeed = !screenSeeds(screen).includes(parsed);
  otherFormOpen = false;
  seed = parsed;
  if (!otherSeed) buildSeedChoices();
  syncUrl();
  void rebuild();
});

/* ---------- compare with the recorded run ---------- */

function recordedFiles(arm: ArmSpec): readonly string[] { return otherSeed ? [] : arm.replays[seed] ?? []; }

function fileAvailable(file: string): Promise<boolean> {
  let hit = availability.get(file);
  if (!hit) { hit = recordedAvailable(replayUrl(file)); availability.set(file, hit); }
  return hit;
}

async function updateCompareAvailability(mine: number): Promise<void> {
  let any = false;
  if (!otherSeed) for (const card of cards) for (const file of recordedFiles(card.arm)) if (await fileAvailable(file)) any = true;
  if (mine !== generation) return;
  compareSection.hidden = !any;
}

async function runCompare(): Promise<void> {
  if (compareRunning || !mod) return;
  compareRunning = true; compareButton.disabled = true;
  const token = { aborted: false }; compareToken = token;
  const mine = generation;
  compareResult.replaceChildren();
  const lines: { label: string; file: string; result: ReplayResult }[] = [];
  try {
    for (const card of cards) {
      for (const file of recordedFiles(card.arm)) {
        if (!(await fileAvailable(file))) continue;
        const label = `${card.arm.label}, seed ${seed} (${file})`;
        compareProgress.textContent = `Reading ${file}…`;
        const fetched = await fetchRecording(replayUrl(file));
        let result: ReplayResult;
        if (!fetched.ok) result = { status: 'unavailable', reason: fetched.reason };
        else result = await checkReplay(fetched.data, { seed, mode: card.arm.mode, horizon: screen.horizon, mod }, {
          signal: token,
          onProgress: p => { compareProgress.textContent = `${card.arm.label}: replayed to tick ${fmt(p.tick)} of ${fmt(p.of)}`; },
        });
        if (token.aborted || mine !== generation) return;
        lines.push({ label, file, result });
        const li = document.createElement('li'); li.dataset.status = result.status; li.dataset.file = file;
        li.textContent = describeResult(label, result);
        compareResult.append(li);
      }
    }
    compareProgress.textContent = lines.length ? 'Done.' : 'No recording could be read.';
    const displayed = lines.length ? await compareDisplayed(token, mine) : '';
    if (token.aborted || mine !== generation) return;
    if (displayed) { const li = document.createElement('li'); li.dataset.status = 'info'; li.textContent = displayed; compareResult.append(li); }
  } finally {
    compareRunning = false; compareButton.disabled = false;
  }
}

/** The worlds on screen against the recorded frame at their current tick, when the recording has one. */
async function compareDisplayed(token: { aborted: boolean }, mine: number): Promise<string> {
  const parts: string[] = [];
  for (const card of cards) {
    const file = recordedFiles(card.arm).find(f => compareResult.querySelector(`li[data-file="${f}"]`));
    if (!file || card.world.tick === 0 || card.world.tick % 20 !== 0) continue;
    const tickAtStart = card.world.tick;
    const fetched = await fetchRecording(replayUrl(file));
    if (token.aborted || mine !== generation || card.world.tick !== tickAtStart) return '';
    if (!fetched.ok) continue;
    const framesValue = (fetched.data as { frames?: unknown } | null)?.frames;
    const frames: unknown[] = Array.isArray(framesValue) ? framesValue : [];
    const recorded = frames.find(f => typeof f === 'object' && f !== null && (f as { tick?: unknown }).tick === card.world.tick);
    if (!recorded) continue;
    const diff = compareFrame(card.world, recorded);
    parts.push(`${card.arm.label} at tick ${fmt(card.world.tick)}: ${diff ? `differs from the recorded frame in ${diff}` : 'the picture on screen matches the recorded frame'}`);
  }
  return parts.length ? `The worlds as displayed: ${parts.join('; ')}.` : '';
}

compareButton.addEventListener('click', () => { void runCompare(); });

/* ---------- optional download ---------- */

function downloadCounts(): void {
  if (!cards.length) return;
  const payload = {
    kind: 'food-bands-exploration-observation', schemaVersion: 1,
    description: 'Exploration, not evidence. Counts from a live run of an engineered world on this computer; not a resumable checkpoint.',
    screen: screen.id, seed, otherSeed, model: resolveModelKey(screen.id), clockTick, horizon: screen.horizon,
    runtime: navigator.userAgent,
    worlds: cards.map(card => ({ arm: card.arm.id, mode: card.arm.mode, tick: card.world.tick, extinctionTick: card.world.extinctionTick, environment: card.world.environment, census: card.world.census(), tickSeries: card.points })),
  };
  const json = JSON.stringify(payload, null, 2);
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `food-bands-${screen.id}-seed-${seed}-tick-${clockTick}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  fileStatus.textContent = `Counts saved (${fmt(new TextEncoder().encode(json).byteLength)} bytes). This is an observation only; it cannot resume a run.`;
}
el<HTMLButtonElement>('export').addEventListener('click', downloadCounts);

/* ---------- start ---------- */

const params = new URLSearchParams(location.search);
const requested = getScreen(params.get('screen') ?? '');
if (requested) {
  screen = requested; seed = requested.seeds.primary;
  const seedParam = params.get('seed');
  const wanted = seedParam !== null && /^\d{1,10}$/.test(seedParam) ? Number(seedParam) : NaN;
  if (Number.isInteger(wanted) && wanted >= 0 && wanted <= MAX_SEED) {
    seed = wanted; otherSeed = !screenSeeds(requested).includes(wanted);
  }
}
buildScreenChoices(); buildSeedChoices(); buildOptionalArm();
if (otherSeed) el<HTMLInputElement>('other-seed').value = String(seed);
void rebuild(true);
requestAnimationFrame(frame);
