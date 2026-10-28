import { BOUNDARY_MODES, BOUNDARY_RULES, BoundaryWorld, type BoundaryMode } from './model.ts';
import { advanceBoundaryComparison, BOUNDARY_MAX_TICKS, canAdvanceBoundaryComparison, ticksForFrame } from './comparison-clock.ts';

const modes = [...BOUNDARY_MODES] as BoundaryMode[];
const palette = {
  density: [[8, 24, 31], [63, 208, 153], [255, 232, 153]],
  nutrient: [[13, 26, 49], [75, 130, 211], [203, 239, 255]],
} as const;
const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing boundary comparison element: ${id}`);
  return element as T;
};

const seedInput = byId<HTMLInputElement>('seed');
const status = byId<HTMLElement>('run-status');
const playButton = byId<HTMLButtonElement>('play');
const stepButton = byId<HTMLButtonElement>('step');
const paceSelect = byId<HTMLSelectElement>('pace');
const viewSelect = byId<HTMLSelectElement>('field-view');
const overlayInput = byId<HTMLInputElement>('wall-overlay');
const worldByMode = new Map<BoundaryMode, BoundaryWorld>();
let seed = 1201;
let comparisonTick = 0;
let paused = matchMedia('(prefers-reduced-motion: reduce)').matches || document.hidden;
let seedError: string | null = null;
let lastFrame = 0;
let elapsed = 0;
const frameMs = 1000 / 24;

function makeWorlds(nextSeed: number): void {
  worldByMode.clear();
  for (const mode of modes) worldByMode.set(mode, new BoundaryWorld(nextSeed, mode));
}

function setPaused(value: boolean): void {
  paused = value;
  playButton.textContent = value ? 'Play' : 'Pause';
  playButton.setAttribute('aria-label', value ? 'Play' : 'Pause');
  updateStatus();
}

function component(value: number): string {
  return value.toLocaleString('en-US');
}

function metricText(value: number, decimals = 3): string {
  return Number.isFinite(value) ? value.toFixed(decimals) : '—';
}

function colorFor(value: number, kind: 'density' | 'nutrient'): readonly number[] {
  const ramp = palette[kind];
  const clamped = Math.max(0, Math.min(1, value));
  const scaled = clamped * 2;
  const segment = Math.min(1, Math.floor(scaled));
  const amount = scaled - segment;
  return ramp[segment].map((channel, index) => Math.round(channel + (ramp[segment + 1][index] - channel) * amount));
}

function draw(mode: BoundaryMode, world: BoundaryWorld): void {
  const canvas = byId<HTMLCanvasElement>(`field-${mode}`);
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return;
  const fields = viewSelect.value === 'nutrient' ? world.nutrient : world.density;
  const walls = world.wall;
  const kind = viewSelect.value === 'nutrient' ? 'nutrient' : 'density';
  const image = context.createImageData(world.size, world.size);
  for (let i = 0; i < fields.length; i++) {
    let [red, green, blue] = colorFor(fields[i], kind);
    if (overlayInput.checked && walls[i] >= BOUNDARY_RULES.wallThreshold) {
      // A warm, translucent-looking tint keeps the field legible under the gate overlay.
      red = Math.round(red * 0.48 + 241 * 0.52);
      green = Math.round(green * 0.48 + 210 * 0.52);
      blue = Math.round(blue * 0.48 + 140 * 0.52);
    }
    const offset = i * 4;
    image.data[offset] = red;
    image.data[offset + 1] = green;
    image.data[offset + 2] = blue;
    image.data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  canvas.setAttribute('aria-label', `${mode} recipe ${kind === 'density' ? 'density' : 'nutrient'} proxy field at comparison tick ${comparisonTick}`);
}

function drawHistory(mode: BoundaryMode, world: BoundaryWorld): void {
  const canvas = byId<HTMLCanvasElement>(`history-${mode}`);
  const context = canvas.getContext('2d');
  if (!context) return;
  const samples = world.history;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = '#36515a';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, canvas.height / 2);
  context.lineTo(canvas.width, canvas.height / 2);
  context.stroke();
  context.strokeStyle = '#9fe4c4';
  context.lineWidth = 2;
  context.beginPath();
  samples.forEach((sample, index) => {
    const x = samples.length <= 1 ? canvas.width / 2 : index * (canvas.width - 4) / (samples.length - 1) + 2;
    const y = canvas.height - 3 - Math.max(0, Math.min(1, sample.densityTotal / (world.size * world.size))) * (canvas.height - 6);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
  canvas.setAttribute('aria-label', `Recent total-density history for ${mode} recipe, ${samples.length} retained samples through tick ${world.tick}`);
}

function updatePanel(mode: BoundaryMode, world: BoundaryWorld): void {
  const census = world.census();
  byId<HTMLElement>(`tick-${mode}`).textContent = component(world.tick);
  const panelStatus = byId<HTMLElement>(`status-${mode}`);
  if (world.extinctionTick !== null) {
    panelStatus.textContent = `Extinct at ${component(world.extinctionTick)}`;
    panelStatus.classList.add('extinct');
  } else {
    panelStatus.textContent = world.tick === comparisonTick ? 'In step' : 'Frozen';
    panelStatus.classList.remove('extinct');
  }
  byId<HTMLElement>(`components-${mode}`).textContent = component(census.components);
  byId<HTMLElement>(`tiny-${mode}`).textContent = component(census.tinyComponents);
  byId<HTMLElement>(`largest-${mode}`).textContent = component(census.largestComponent);
  byId<HTMLElement>(`active-${mode}`).textContent = `${metricText(census.activeCellFraction * 100, 1)}%`;
  byId<HTMLElement>(`total-${mode}`).textContent = metricText(census.densityTotal, 2);
  byId<HTMLElement>(`nutrient-${mode}`).textContent = metricText(census.nutrientMean);
  byId<HTMLElement>(`contrast-${mode}`).textContent = metricText(census.neighborContrast);
  byId<HTMLElement>(`blocked-${mode}`).textContent = `${metricText(census.blockedEdgeFraction * 100, 1)}%`;
  const change = census.sampledChange;
  byId<HTMLElement>(`change-${mode}`).textContent = change
    ? `${metricText(change.meanAbsDelta)} · mask ${metricText(change.maskFlipFraction * 100, 1)}% (${component(change.fromTick)}–${component(change.toTick)})`
    : 'No interval yet';
  draw(mode, world);
  drawHistory(mode, world);
}

function update(): void {
  for (const mode of modes) {
    const world = worldByMode.get(mode);
    if (world) updatePanel(mode, world);
  }
  const worlds = modes.map(mode => worldByMode.get(mode)!);
  const allExtinct = worlds.every(world => world.extinctionTick !== null);
  const atLimit = comparisonTick >= BOUNDARY_MAX_TICKS;
  playButton.disabled = !canAdvanceBoundaryComparison(worlds, comparisonTick);
  stepButton.disabled = !canAdvanceBoundaryComparison(worlds, comparisonTick);
  updateStatus(allExtinct, atLimit);
  byId<HTMLElement>('main').setAttribute('data-comparison-tick', String(comparisonTick));
}

function updateStatus(allExtinct = modes.every(mode => worldByMode.get(mode)?.extinctionTick !== null), atLimit = comparisonTick >= BOUNDARY_MAX_TICKS): void {
  if (seedError) status.textContent = seedError;
  else if (allExtinct) status.textContent = `All four fields extinct · comparison tick ${comparisonTick.toLocaleString()}`;
  else if (atLimit) status.textContent = `Maximum comparison age reached · tick ${comparisonTick.toLocaleString()}`;
  else status.textContent = paused ? `Paused · comparison tick ${comparisonTick.toLocaleString()}` : `Running · comparison tick ${comparisonTick.toLocaleString()}`;
}

function advanceOne(refresh = true): void {
  comparisonTick = advanceBoundaryComparison(modes.map(mode => worldByMode.get(mode)!), comparisonTick);
  if (comparisonTick >= BOUNDARY_MAX_TICKS || modes.every(mode => worldByMode.get(mode)!.extinctionTick !== null)) setPaused(true);
  if (refresh) update();
}

function reset(nextSeed: number): void {
  seed = nextSeed;
  comparisonTick = 0;
  elapsed = 0;
  makeWorlds(seed);
  setPaused(true);
  update();
}

function animate(now: number): void {
  requestAnimationFrame(animate);
  if (!lastFrame) lastFrame = now;
  const delta = Math.min(250, now - lastFrame);
  lastFrame = now;
  if (paused || document.hidden || modes.every(mode => worldByMode.get(mode)!.extinctionTick !== null)) return;
  elapsed += delta * Number(paceSelect.value);
  if (elapsed < frameMs) return;
  const requested = Math.floor(elapsed / frameMs);
  elapsed %= frameMs;
  for (let i = 0; i < ticksForFrame(requested); i++) {
    advanceOne(false);
    if (paused) break;
  }
  update();
}

byId<HTMLFormElement>('reset-form').addEventListener('submit', event => {
  event.preventDefault();
  const nextSeed = Number(seedInput.value);
  if (seedInput.value.trim() === '' || !Number.isInteger(nextSeed) || nextSeed < 0 || nextSeed > 0xffff_ffff) {
    seedError = 'Seed must be a whole number from 0 to 4294967295. Current comparison is unchanged.';
    updateStatus();
    seedInput.focus();
    return;
  }
  seedError = null;
  reset(nextSeed);
});
playButton.addEventListener('click', () => {
  const worlds = modes.map(mode => worldByMode.get(mode)!);
  if (!canAdvanceBoundaryComparison(worlds, comparisonTick)) {
    setPaused(true);
    update();
    return;
  }
  setPaused(!paused);
});
stepButton.addEventListener('click', () => {
  setPaused(true);
  advanceOne();
});
viewSelect.addEventListener('change', update);
overlayInput.addEventListener('change', update);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) setPaused(true);
  else update();
});
document.addEventListener('keydown', event => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const target = event.target;
  if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(target.tagName))) return;
  if (event.code === 'Space') {
    event.preventDefault();
    setPaused(!paused);
  } else if (event.code === 'ArrowRight') {
    event.preventDefault();
    setPaused(true);
    advanceOne();
  }
});
byId<HTMLButtonElement>('export').addEventListener('click', () => {
  const observation = {
    kind: 'boundary-field-comparison-observation',
    description: 'Observation of four designed field recipes; density and nutrient are proxies, walls are engineered transport gates, and no organisms or heredity are modeled.',
    seed,
    comparisonTick,
    display: { view: viewSelect.value, wallOverlay: overlayInput.checked, densityScale: [0, 1], nutrientScale: [0, 1] },
    modes: Object.fromEntries(modes.map(mode => {
      const snapshot = worldByMode.get(mode)!.snapshot();
      return [mode, {
        ...snapshot,
        fields: Object.fromEntries(Object.entries(snapshot.fields).map(([key, value]) => [key, Array.from(value as ArrayLike<number>)])),
      }];
    })),
  };
  const blob = new Blob([JSON.stringify(observation, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `boundary-fields-seed-${seed}-tick-${comparisonTick}.json`;
  link.click();
  URL.revokeObjectURL(url);
});

makeWorlds(seed);
seedInput.value = String(seed);
setPaused(paused);
update();
requestAnimationFrame(animate);
