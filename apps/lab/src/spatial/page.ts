import { PRESETS, RULES, SpatialWorld, type PresetId } from './model.ts';
import { drawSpatialWorld, SPATIAL_FAMILY_COLORS, type Camera } from './render.ts';
import './style.css';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (n: number) => n.toLocaleString('en-US');
const names = ['Mint', 'Amber', 'Lilac'];
const worldCanvas = el<HTMLCanvasElement>('world');
const worldContext = worldCanvas.getContext('2d')!;
const historyCanvas = el<HTMLCanvasElement>('history');
const historyContext = historyCanvas.getContext('2d')!;
const preset = el<HTMLSelectElement>('preset');
const seed = el<HTMLInputElement>('seed');
const mutation = el<HTMLInputElement>('mutation');
const playButton = el<HTMLButtonElement>('play');
const stepButton = el<HTMLButtonElement>('step');
const yaw = el<HTMLInputElement>('yaw');
const pitch = el<HTMLInputElement>('pitch');
const sliceEnabled = el<HTMLInputElement>('slice-enabled');
const sliceZ = el<HTMLInputElement>('slice-z');

for (const item of PRESETS) preset.add(new Option(item.name, item.id));
preset.value = 'pursuit';
const camera: Camera = { yaw: 37 * Math.PI / 180, pitch: -20 * Math.PI / 180 };
let world = new SpatialWorld(1201, 'pursuit', true);
let paused = true;
let pauseReason = 'Paused · ready';
let previousTime = 0;
let accumulator = 0;

function setText(target: HTMLElement, value: string) { if (target.textContent !== value) target.textContent = value; }
function updateCanvasSize() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(worldCanvas.getBoundingClientRect().width * ratio);
  if (width > 0 && worldCanvas.width !== width) { worldCanvas.width = width; worldCanvas.height = width; }
  const historyWidth = Math.round(historyCanvas.getBoundingClientRect().width * ratio);
  if (historyWidth > 0 && historyCanvas.width !== historyWidth) { historyCanvas.width = historyWidth; historyCanvas.height = Math.round(historyWidth / 3.6); }
  draw();
}
new ResizeObserver(updateCanvasSize).observe(worldCanvas);
new ResizeObserver(updateCanvasSize).observe(historyCanvas);

function viewOptions() {
  return { showFood: el<HTMLInputElement>('food-visible').checked, sliceCenter: sliceEnabled.checked ? Number(sliceZ.value) : null, sliceThickness: .2 };
}
function draw() {
  const displayed = drawSpatialWorld(worldContext, world, worldCanvas.width, camera, viewOptions());
  setText(el('displayed'), fmt(displayed));
}
function drawHistory() {
  const width = historyCanvas.width, height = historyCanvas.height;
  historyContext.fillStyle = '#0c1a20'; historyContext.fillRect(0, 0, width, height);
  historyContext.strokeStyle = '#30464e'; historyContext.lineWidth = 1;
  historyContext.beginPath(); historyContext.moveTo(0, height - 1); historyContext.lineTo(width, height - 1); historyContext.stroke();
  const requestedStart = Math.max(0, world.tick - 3000), rangeEnd = world.tick;
  const rangeStart = Math.max(requestedStart, world.history[0]?.tick ?? rangeEnd), span = rangeEnd - rangeStart;
  const samples = world.history.filter(sample => sample.tick >= rangeStart && sample.tick <= rangeEnd).map(sample => ({ ...sample }));
  if (samples.at(-1)?.tick !== rangeEnd) samples.push({ ...world.census(), tick: rangeEnd });
  for (let family = 0; family < 3; family++) {
    historyContext.strokeStyle = SPATIAL_FAMILY_COLORS[family]; historyContext.lineWidth = Math.max(1.5, width * .003); historyContext.beginPath();
    samples.forEach((sample, index) => {
      const x = span === 0 ? width : (sample.tick - rangeStart) / span * width;
      const y = height - 6 - sample.counts[family] / RULES.populationMax * (height - 12);
      if (index === 0) historyContext.moveTo(x, y); else historyContext.lineTo(x, y);
    });
    if (samples.length) historyContext.stroke();
  }
  setText(el('chart-range'), `Ticks ${fmt(rangeStart)}–${fmt(rangeEnd)}`);
}
function updateStatus() {
  const complete = world.tick >= 6000;
  const extinct = world.particles.length === 0;
  if (complete || extinct) { paused = true; accumulator = 0; }
  playButton.textContent = paused ? 'Play' : 'Pause';
  playButton.disabled = complete || extinct;
  stepButton.disabled = !paused || complete || extinct;
  setText(el('status'), complete ? 'Pilot horizon reached · reset to continue' : extinct ? `Extinct at tick ${fmt(world.tick)} · remains empty` : paused ? pauseReason : 'Running');
}
function updateMetrics() {
  const census = world.census();
  setText(el('tick'), fmt(world.tick));
  setText(el('population'), fmt(census.population));
  setText(el('births'), fmt(census.births)); setText(el('deaths'), fmt(census.deaths));
  setText(el('speed'), census.meanSpeed.toFixed(5));
  setText(el('bins'), `${census.occupiedBins} / 125`); setText(el('bands'), `${census.occupiedZBands} / 5`); setText(el('vz'), census.meanAbsVz.toFixed(5));
  el('families').replaceChildren(...names.map((name, family) => {
    const item = document.createElement('span'); item.className = 'family'; item.style.setProperty('--color', SPATIAL_FAMILY_COLORS[family]); item.textContent = `${name} ${fmt(census.counts[family])}`; return item;
  }));
  setText(el('active-settings'), `${PRESETS.find(item => item.id === world.preset)?.name ?? world.preset} · seed ${world.seed} · inherited mutation ${world.mutation ? 'on' : 'off'}`);
  drawHistory(); updateStatus();
}
function install(next: SpatialWorld, message: string) {
  world = next; paused = true; pauseReason = message; accumulator = 0; previousTime = 0;
  updateMetrics(); draw();
}
function syncCameraLabels() {
  camera.yaw = Number(yaw.value) * Math.PI / 180;
  camera.pitch = Number(pitch.value) * Math.PI / 180;
  setText(el('yaw-value'), `${Number(yaw.value)}°`);
  const degrees = Number(pitch.value); setText(el('pitch-value'), `${degrees < 0 ? '−' : ''}${Math.abs(degrees)}°`);
  draw();
}
function syncSlice() {
  sliceZ.disabled = !sliceEnabled.checked;
  setText(el('slice-value'), Number(sliceZ.value).toFixed(2));
  draw();
}

playButton.addEventListener('click', () => {
  paused = !paused; pauseReason = paused ? 'Paused by you' : '';
  accumulator = 0; previousTime = 0; updateStatus();
});
stepButton.addEventListener('click', () => { if (!paused || world.tick >= 6000 || !world.particles.length) return; world.step(); updateMetrics(); draw(); });
el('reset').addEventListener('click', () => install(new SpatialWorld(world.seed, world.preset, world.mutation), 'Paused · world reset'));
el<HTMLFormElement>('settings-form').addEventListener('submit', event => {
  event.preventDefault(); if (!seed.reportValidity()) return;
  install(new SpatialWorld(Number(seed.value), preset.value as PresetId, mutation.checked), 'Paused · new world ready');
  el('file-status').textContent = 'New world started at tick 0. Save an observation before leaving if you want to keep it.';
});
for (const slider of [yaw, pitch]) slider.addEventListener('input', syncCameraLabels);
el('reset-view').addEventListener('click', () => { yaw.value = '37'; pitch.value = '-20'; syncCameraLabels(); });
el<HTMLInputElement>('food-visible').addEventListener('change', draw);
sliceEnabled.addEventListener('change', syncSlice); sliceZ.addEventListener('input', syncSlice);
el('export').addEventListener('click', () => {
  const observation = {
    kind: 'spatial-particle-world-observation',
    description: 'Engineered open-energy 3D toy. Observation only, not a resumable checkpoint. Same-runtime seeded replay only. Camera and displayed slice do not affect physics.',
    requestedHorizon: 6000, stoppedTick: world.tick,
    extinct: world.particles.length === 0, horizonReached: world.tick >= 6000,
    settings: { seed: world.seed, preset: world.preset, mutation: world.mutation },
    view: { camera: { yaw: camera.yaw, pitch: camera.pitch }, showFood: el<HTMLInputElement>('food-visible').checked, sliceCenter: sliceEnabled.checked ? Number(sliceZ.value) : null, sliceThickness: .2 },
    snapshot: world.snapshot(),
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(observation, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `spatial-seed-${world.seed}-tick-${world.tick}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  el('file-status').textContent = 'Bounded observation saved. It includes the current world and recent history, and cannot resume a run.';
});
document.addEventListener('visibilitychange', () => {
  accumulator = 0; previousTime = 0;
  if (document.hidden) { paused = true; pauseReason = 'Paused while away'; }
  updateStatus();
});
function frame(now: number) {
  if (!paused && !document.hidden) {
    const ticksPerSecond = 60 * Number(el<HTMLSelectElement>('pace').value);
    accumulator += Math.min(previousTime ? now - previousTime : 0, 100) * ticksPerSecond / 1000;
    const wholeTicks = Math.min(16, Math.floor(accumulator));
    const remaining = Math.max(0, 6000 - world.tick);
    const batch = Math.min(wholeTicks, remaining);
    if (batch) { world.step(batch); accumulator -= batch; }
    // Discard whole-tick debt after the bounded batch; preserve only its fraction.
    accumulator -= Math.floor(accumulator);
    if (batch) { updateMetrics(); draw(); }
  }
  previousTime = now; requestAnimationFrame(frame);
}

el<HTMLInputElement>('seed').value = String(world.seed); el<HTMLInputElement>('mutation').checked = world.mutation;
syncCameraLabels(); syncSlice(); updateCanvasSize(); updateMetrics(); draw(); requestAnimationFrame(frame);
