import { ParticleWorld, PRESETS, RULES, torusDelta } from './model.ts';
import type { Census, FoodPatch, Particle, ParticleEnvironment, PresetId } from './model.ts';
import { advanceComparison } from './comparison-clock.ts';
import './oases.css';

export interface EnvironmentPageConfig {
  environments: { label: string; detail: string; value: ParticleEnvironment }[];
  initialSettings: { seed: number; preset: PresetId; mutation: boolean };
  exportKind: string;
  filenamePrefix: string;
  phaseAt?: (environment: ParticleEnvironment, positiveStep: number) => { phase: number; nextChangeTick: number } | null;
  renewalAt?: (environment: ParticleEnvironment, positiveStep: number, patchIndex: number) => number;
  worldFactory?: (settings: EnvironmentSettings, environment: ParticleEnvironment, slot: number) => ViewWorld;
  overlay?: (ctx: CanvasRenderingContext2D, world: ViewWorld, size: number) => void;
  summary?: (world: ViewWorld) => string;
  worldMetadata?: readonly Record<string, string>[];
}

export interface EnvironmentSettings { seed: number; preset: PresetId; mutation: boolean }

/** Narrow structural surface shared by ordinary and composed comparison worlds. */
export interface ViewWorld {
  readonly tick: number;
  readonly particles: Particle[];
  readonly food: FoodPatch[];
  readonly history: Census[];
  readonly environment: ParticleEnvironment;
  step(count?: number): void;
  census(): Census;
  snapshot(): unknown;
}

export interface EnvironmentClock {
  environment: ParticleEnvironment;
  comparisonTick: number;
  worldTick: number;
  extinctionTick: number | null;
  lastAppliedStep: number | null;
  phaseReferenceStep: number;
  seasonalPhase: { phase: number; nextChangeTick: number | null } | null;
  nextChangeTick: number | null;
}

export function environmentClock(
  environment: ParticleEnvironment,
  worldTick: number,
  comparisonTick: number,
  extinctionTick: number | null,
  phaseAt?: EnvironmentPageConfig['phaseAt'],
): EnvironmentClock {
  const phaseReferenceStep = Math.max(1, worldTick);
  const phase = phaseAt?.(environment, phaseReferenceStep) ?? null;
  const nextChangeTick = extinctionTick === null ? phase?.nextChangeTick ?? null : null;
  return {
    environment, comparisonTick, worldTick, extinctionTick,
    lastAppliedStep: worldTick === 0 ? null : worldTick,
    phaseReferenceStep,
    seasonalPhase: phase ? { phase: phase.phase, nextChangeTick } : null,
    nextChangeTick,
  };
}

export function mountEnvironmentPage(config: EnvironmentPageConfig) {

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (n: number) => n.toLocaleString('en-US');
const names = ['Mint', 'Amber', 'Lilac'];
const colors = ['#91e1c0', '#f2be78', '#b5adf2'];
const { environments } = config;
const preset = el<HTMLSelectElement>('preset');
const seed = el<HTMLInputElement>('seed');
const mutation = el<HTMLInputElement>('mutation');
const play = el<HTMLButtonElement>('play');
const step = el<HTMLButtonElement>('step');
const pace = el<HTMLSelectElement>('pace');
for (const item of PRESETS) preset.add(new Option(item.name, item.id));

let settings = { ...config.initialSettings };
seed.value = String(settings.seed);
preset.value = settings.preset;
let worlds: ViewWorld[] = [];
let comparisonTick = 0;
let extinctionTicks: (number | null)[] = [null, null, null];
let paused = matchMedia('(prefers-reduced-motion: reduce)').matches || document.hidden;
let pauseReason = paused ? 'Paused · ready to compare' : '';
let previousTime = 0;
let accumulator = 0;
let lastDisplay = -1;
let displayedRegimeKeys: string[] = [];

function buildWorlds(candidate = settings) {
  return environments.map(({ value }, index) => config.worldFactory
    ? config.worldFactory(candidate, value, index)
    : new ParticleWorld(candidate.seed, candidate.preset, candidate.mutation, undefined, value));
}
const cards = environments.map(({ label, detail }, index) => {
  const card = document.createElement('section');
  card.className = 'world';
  card.setAttribute('aria-labelledby', `world-${index}-title`);
  card.innerHTML = `<div class="world-top"><h2 id="world-${index}-title">${label}</h2><span class="environment">${detail}<small>Same recipe, seed and mutation setting</small><small class="regime"></small></span></div><canvas class="world-view" width="560" height="560" role="img" aria-label="${label} environment; population and food contact are listed below.">Canvas unavailable. Population and food contact are listed below.</canvas><div class="world-summary"><div class="numbers"><span><strong class="population">120</strong>living</span><span>Births <b class="births">0</b><br>Deaths <b class="deaths">0</b></span></div><canvas class="world-history" width="540" height="150" role="img" aria-label="Recent population history by founding family; current family counts are listed below."></canvas><p class="chart-note">Population history · one sample every 10 ticks · up to 3,000 ticks <span class="chart-range"></span></p><div class="families"></div><div class="metric-row"><span>Inside food patches <b class="food-contact">—</b></span><span>Extinction <b class="extinction">—</b></span></div><p class="world-state"></p><p class="extension-summary" hidden></p><p class="patch-stock"><strong>Food patch stock</strong> <span class="stocks"></span></p></div>`;
  el('worlds').append(card);
  const canvas = card.querySelector<HTMLCanvasElement>('.world-view')!;
  const history = card.querySelector<HTMLCanvasElement>('.world-history')!;
  const resize = () => {
    const width = Math.round(canvas.getBoundingClientRect().width * Math.min(devicePixelRatio || 1, 2));
    if (width > 0 && canvas.width !== width) { canvas.width = width; canvas.height = width; drawWorld(index); }
    const chartWidth = Math.round(history.getBoundingClientRect().width * Math.min(devicePixelRatio || 1, 2));
    if (chartWidth > 0 && history.width !== chartWidth) { history.width = chartWidth; history.height = Math.round(chartWidth / 3.6); drawHistory(index); }
  };
  new ResizeObserver(resize).observe(canvas);
  new ResizeObserver(resize).observe(history);
  return { card, canvas, context: canvas.getContext('2d')!, history, historyContext: history.getContext('2d')! };
});

function setText(target: HTMLElement, value: string) { if (target.textContent !== value) target.textContent = value; }
function regimeKey(world: ViewWorld) {
  const phase = config.phaseAt?.(world.environment, Math.max(1, world.tick)) ?? null;
  return config.phaseAt ? `${phase?.phase ?? 'still'}:${world.tick === 0 ? 'ready' : 'applied'}` : '';
}
function regimeChanged() { return worlds.some((world, index) => regimeKey(world) !== displayedRegimeKeys[index]); }
function status() {
  const allExtinct = worlds.every(world => world.particles.length === 0);
  if (allExtinct || comparisonTick >= 10_000_000) paused = true;
  play.textContent = paused ? 'Play' : 'Pause';
  play.disabled = allExtinct || comparisonTick >= 10_000_000;
  step.disabled = !paused || play.disabled;
  setText(el('status'), allExtinct ? 'All worlds extinct · restart to compare again' : comparisonTick >= 10_000_000 ? 'Tick limit reached · restart to continue' : paused ? pauseReason || 'Paused' : 'Running together');
}
function insideAnyPatch(world: Pick<ViewWorld, 'food'>, x: number, y: number) {
  return world.food.some(patch => {
    const dx = torusDelta(patch.x - x), dy = torusDelta(patch.y - y);
    return dx * dx + dy * dy <= patch.radius * patch.radius;
  });
}
function metrics() {
  el('tick').textContent = fmt(comparisonTick);
  worlds.forEach((world, index) => {
    const census = world.census(), card = cards[index].card;
    card.querySelector('.population')!.textContent = fmt(census.population);
    card.querySelector('.births')!.textContent = fmt(census.births);
    card.querySelector('.deaths')!.textContent = fmt(census.deaths);
    card.querySelector('.food-contact')!.textContent = census.population
      ? `${Math.round(world.particles.filter(p => insideAnyPatch(world, p.x, p.y)).length / census.population * 100)}%`
      : '—';
    card.querySelector('.extinction')!.textContent = extinctionTicks[index] === null ? '—' : `tick ${fmt(extinctionTicks[index]!)}`;
    const families = card.querySelector('.families')!;
    families.replaceChildren(...names.map((name, family) => {
      const item = document.createElement('span'); item.className = 'family'; item.style.setProperty('--color', colors[family]); item.textContent = `${name} ${fmt(census.counts[family])}`; return item;
    }));
    setText(card.querySelector('.world-state')!, extinctionTicks[index] !== null ? `Extinct at tick ${fmt(extinctionTicks[index]!)} · remains empty` : `Tick ${fmt(comparisonTick)} · ${fmt(census.mutations)} mutated births · ${fmt(census.blockedBirths)} blocked birth attempts`);
    const extension = card.querySelector<HTMLElement>('.extension-summary');
    const extensionSummary = config.summary?.(world);
    if (extension) { extension.hidden = !extensionSummary; extension.textContent = extensionSummary ?? ''; }
    const clock = environmentClock(world.environment, world.tick, comparisonTick, extinctionTicks[index], config.phaseAt);
    const phaseStep = clock.phaseReferenceStep;
    const phase = clock.seasonalPhase;
    displayedRegimeKeys[index] = regimeKey(world);
    setText(card.querySelector('.regime')!, config.phaseAt
      ? phase ? world.tick === 0 ? 'First phase ready · applies from tick 1'
        : extinctionTicks[index] === null ? `Phase ${phase.phase + 1} · next change at tick ${fmt(phase.nextChangeTick!)}` : `Phase ${phase.phase + 1} · frozen at extinction tick ${fmt(extinctionTicks[index]!)}` : 'Still renewal'
      : '');
    setText(card.querySelector('.stocks')!, Array.from({ length: 3 }, (_, row) => {
      const stock = world.food.slice(row * 3, row * 3 + 3).map(patch => fmt(Math.round(patch.amount))).join(' · ');
      const multiplier = config.renewalAt?.(world.environment, phaseStep, row * 3);
      return multiplier === undefined ? `Row ${row + 1} stock: ${stock}` : `Row ${row + 1} · ${multiplier.toFixed(2)}× renewal · stock: ${stock}`;
    }).join('\n'));
    drawHistory(index);
  });
  el('active-settings').textContent = `${PRESETS.find(item => item.id === settings.preset)?.name ?? settings.preset} · seed ${settings.seed} · inherited mutation ${settings.mutation ? 'on' : 'off'}`;
  lastDisplay = comparisonTick;
  status();
}
function install(candidate: typeof settings, message: string) {
  const nextWorlds = buildWorlds(candidate); // Build all three before replacing the active comparison.
  settings = { ...candidate };
  worlds = nextWorlds;
  comparisonTick = 0;
  extinctionTicks = [null, null, null];
  paused = true;
  accumulator = 0; previousTime = 0; pauseReason = message;
  seed.value = String(settings.seed); preset.value = settings.preset; mutation.checked = settings.mutation;
  metrics(); draw();
}
function advance() { comparisonTick = advanceComparison(worlds, comparisonTick, extinctionTicks); }
function drawWorld(index: number) {
  const view = cards[index], world = worlds[index];
  if (!view || !world) return;
  const ctx = view.context, size = view.canvas.width;
  ctx.fillStyle = '#08151c'; ctx.fillRect(0, 0, size, size);
  for (let patchIndex = 0; patchIndex < world.food.length; patchIndex++) {
    const patch = world.food[patchIndex];
    for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) {
      const x = (patch.x + dx) * size, y = (patch.y + dy) * size, radius = patch.radius * size;
      if (x + radius < 0 || x - radius > size || y + radius < 0 || y - radius > size) continue;
      ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(64,160,108,${.025 + .12 * Math.max(0, Math.min(1, patch.amount / RULES.foodCapacity))})`; ctx.fill();
      const multiplier = config.renewalAt?.(world.environment, Math.max(1, world.tick), patchIndex);
      ctx.strokeStyle = multiplier === undefined ? '#a0d2ae' : multiplier > 1 ? '#88ebbd' : multiplier < 1 ? '#d5a5a0' : '#a6c8ef';
      ctx.setLineDash(multiplier === undefined || multiplier > 1 ? [] : multiplier < 1 ? [Math.max(2, size * .009), Math.max(2, size * .007)] : [Math.max(2, size * .004), Math.max(2, size * .007)]);
      ctx.globalAlpha = .74; ctx.lineWidth = Math.max(1, size * .0017); ctx.stroke(); ctx.globalAlpha = 1; ctx.setLineDash([]);
    }
  }
  config.overlay?.(ctx, world, size);
  for (const particle of world.particles) for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) {
    const x = (particle.x + dx) * size, y = (particle.y + dy) * size, radius = Math.max(1.4, size * .004);
    if (x < -radius || x > size + radius || y < -radius || y > size + radius) continue;
    ctx.strokeStyle = colors[particle.family]; ctx.globalAlpha = .4; ctx.lineWidth = Math.max(1, size * .0015); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - particle.vx * size * 3, y - particle.vy * size * 3); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillStyle = colors[particle.family]; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
  }
}
function drawHistory(index: number) {
  const view = cards[index], world = worlds[index]; if (!view || !world) return;
  const ctx = view.historyContext, width = view.history.width, height = view.history.height;
  const rangeStart = Math.max(0, comparisonTick - 3000), rangeEnd = comparisonTick, span = rangeEnd - rangeStart;
  const rangeLabel = `Ticks ${fmt(rangeStart)}–${fmt(rangeEnd)}`;
  setText(view.card.querySelector('.chart-range')!, rangeLabel);
  ctx.fillStyle = '#0c1a20'; ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#30464e'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, height - 1); ctx.lineTo(width, height - 1); ctx.stroke();
  const samples = world.history.filter(sample => sample.tick >= rangeStart && sample.tick <= rangeEnd);
  // Once extinction predates the visible window, its known zero population spans the whole window.
  if (extinctionTicks[index] !== null && extinctionTicks[index]! <= rangeStart && !samples.some(sample => sample.tick === rangeStart)) samples.unshift({ ...world.census(), tick: rangeStart });
  const last = samples.at(-1);
  if (!last || last.tick < rangeEnd) samples.push({ ...world.census(), tick: rangeEnd });
  const maximum = RULES.populationMax;
  for (let family = 0; family < 3; family++) {
    ctx.strokeStyle = colors[family]; ctx.lineWidth = Math.max(1.5, width * .003); ctx.beginPath();
    samples.forEach((sample, i) => {
      const x = span === 0 ? width : (sample.tick - rangeStart) / span * width;
      const y = height - 6 - sample.counts[family] / maximum * (height - 12);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    if (samples.length) ctx.stroke();
  }
}
function draw() { worlds.forEach((_, i) => drawWorld(i)); }

play.addEventListener('click', () => { paused = !paused; pauseReason = ''; accumulator = 0; previousTime = 0; metrics(); });
step.addEventListener('click', () => { if (!paused) return; advance(); metrics(); draw(); });
el('restart').addEventListener('click', () => install(settings, 'Paused · comparison restarted'));
el<HTMLFormElement>('new-session').addEventListener('submit', event => {
  event.preventDefault(); if (!seed.reportValidity()) return;
  install({ seed: Number(seed.value), preset: preset.value as PresetId, mutation: mutation.checked }, 'Paused · new comparison ready');
  el('file-status').textContent = 'New comparison started. Save an observation before leaving if you want to keep it.';
});
el('export').addEventListener('click', () => {
  const observation = {
    kind: config.exportKind,
    description: 'Engineered open-energy toy. Observation only, not a resumable checkpoint. Same-runtime seeded replay only.',
    comparisonTick,
    extinctionTicks: [...extinctionTicks],
    settings: { ...settings, environments: environments.map(({ value }) => value), ...(config.worldMetadata ? { worlds: config.worldMetadata.map(item => ({ ...item })) } : {}) },
    ...(config.phaseAt ? { comparisonClocks: worlds.map((world, index) => environmentClock(world.environment, world.tick, comparisonTick, extinctionTicks[index], config.phaseAt)) } : {}),
    worlds: worlds.map(world => world.snapshot()),
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(observation, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `${config.filenamePrefix}-seed-${settings.seed}-tick-${comparisonTick}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  el('file-status').textContent = 'Comparison observation saved. It includes all three worlds and cannot resume a run.';
});
document.addEventListener('visibilitychange', () => { if (document.hidden) { paused = true; pauseReason = 'Paused while away'; } accumulator = 0; previousTime = 0; metrics(); });
function frame(now: number) {
  if (!paused && !document.hidden) {
    accumulator += Math.min(previousTime ? now - previousTime : 0, 100) * Number(pace.value);
    const start = performance.now(); let ticks = 0;
    while (accumulator >= 1000 / 30 && ticks < 4 && performance.now() - start < 9) {
      advance(); accumulator -= 1000 / 30; ticks++;
      if (worlds.every(world => !world.particles.length) || comparisonTick >= 10_000_000) { paused = true; break; }
    }
    accumulator = Math.min(accumulator, 1000 / 30 * 4);
    if (comparisonTick - lastDisplay >= 10 || regimeChanged() || paused) metrics();
    if (ticks) draw();
  }
  previousTime = now; requestAnimationFrame(frame);
}
worlds = buildWorlds();
metrics(); draw(); requestAnimationFrame(frame);
}
