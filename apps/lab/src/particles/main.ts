import { ParticleWorld, PRESETS, RULES } from './model.ts';
import type { PresetId } from './model.ts';
import './style.css';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = element<HTMLCanvasElement>('world');
const context = canvas.getContext('2d')!;
const chart = element<HTMLCanvasElement>('history');
const chartContext = chart.getContext('2d')!;
const preset = element<HTMLSelectElement>('preset');
const seed = element<HTMLInputElement>('seed');
const mutation = element<HTMLInputElement>('mutation');
const play = element<HTMLButtonElement>('play');
const step = element<HTMLButtonElement>('step');
const speed = element<HTMLSelectElement>('speed');
const colors = ['#91e1c0', '#f2be78', '#b5adf2'];
const names = ['Mint', 'Amber', 'Lilac'];
const number = (value: number) => value.toLocaleString('en-US');
for (const recipe of PRESETS) preset.add(new Option(recipe.name, recipe.id));
let world = new ParticleWorld(1101, 'flocks', true);
let paused = matchMedia('(prefers-reduced-motion: reduce)').matches || document.hidden;
let accumulator = 0;
let previousTime = 0;
let lastDisplayTick = -1;
let pauseReason = paused ? 'Paused · press Play to begin' : '';

function showStatus() {
  const extinct = world.particles.length === 0;
  if (extinct) paused = true;
  play.textContent = paused ? 'Play' : 'Pause';
  play.disabled = extinct;
  step.disabled = !paused || extinct;
  const status = extinct ? 'Extinct · reset for a new world' : paused ? pauseReason || 'Paused' : 'Running';
  if (element('run-status').textContent !== status) element('run-status').textContent = status;
}
function showCensus() {
  const census = world.census();
  element('tick').textContent = number(census.tick);
  element('population').textContent = number(census.population);
  element('births').textContent = number(census.births);
  element('deaths').textContent = number(census.deaths);
  element('mutations').textContent = number(census.mutations);
  element('generation').textContent = number(census.maxGeneration);
  element('spread').textContent = census.traitSpread.toFixed(3);
  element('blocked').textContent = number(census.blockedBirths);
  element('families').replaceChildren(...names.map((name, i) => {
    const item = document.createElement('span'); item.className = 'family';
    const dot = document.createElement('span'); dot.className = 'dot'; dot.style.backgroundColor = colors[i]; dot.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span'); text.textContent = `${name} ${number(census.counts[i])}`;
    item.append(dot, text); return item;
  }));
  chartContext.clearRect(0, 0, chart.width, chart.height);
  const history = world.history;
  const ceiling = Math.max(20, ...history.flatMap(row => row.counts));
  chartContext.strokeStyle = '#304852'; chartContext.lineWidth = 1;
  chartContext.beginPath(); chartContext.moveTo(0, chart.height - 2); chartContext.lineTo(chart.width, chart.height - 2); chartContext.stroke();
  for (let family = 0; family < 3; family++) {
    chartContext.strokeStyle = colors[family]; chartContext.lineWidth = 2;
    chartContext.beginPath();
    history.forEach((row, i) => {
      const x = 4 + i / Math.max(1, history.length - 1) * (chart.width - 8);
      const y = chart.height - 4 - row.counts[family] / ceiling * (chart.height - 12);
      if (i === 0) chartContext.moveTo(x, y); else chartContext.lineTo(x, y);
    });
    chartContext.stroke();
  }
  lastDisplayTick = world.tick;
  showStatus();
}
function draw() {
  const size = canvas.width;
  context.fillStyle = '#08151c'; context.fillRect(0, 0, size, size);
  // Drawing has no randomness and never changes the simulation. Seam copies show the torus honestly.
  for (const patch of world.food) {
    for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) {
      const x = (patch.x + dx) * size, y = (patch.y + dy) * size, radius = patch.radius * size;
      if (x + radius < 0 || x - radius > size || y + radius < 0 || y - radius > size) continue;
      context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2);
      context.fillStyle = `rgba(64, 130, 91, ${.04 + .15 * Math.max(0, Math.min(1, patch.amount / RULES.foodCapacity))})`; context.fill(); context.strokeStyle = '#29473f'; context.lineWidth = 1; context.stroke();
    }
  }
  for (const particle of world.particles) {
    const radius = size * .0035;
    for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) {
      const x = (particle.x + dx) * size, y = (particle.y + dy) * size;
      if (x < -radius || x > size + radius || y < -radius || y > size + radius) continue;
      context.strokeStyle = colors[particle.family]; context.globalAlpha = .38; context.lineWidth = Math.max(1, size * .0015);
      // The short line is the current velocity vector, not a historical path or a bond.
      context.beginPath(); context.moveTo(x, y); context.lineTo(x - particle.vx * size * 3, y - particle.vy * size * 3); context.stroke();
      context.globalAlpha = 1; context.fillStyle = colors[particle.family];
      context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill();
    }
  }
}
function reset() {
  if (!seed.reportValidity()) { preset.value = world.preset; mutation.checked = world.mutation; return; }
  const value = Number(seed.value);
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) return;
  const wasExtinct = world.particles.length === 0;
  world = new ParticleWorld(value, preset.value as PresetId, mutation.checked);
  if (wasExtinct) { paused = true; element('control-note').textContent = 'Fresh world ready. Press Play when you want it to begin.'; }
  accumulator = 0; previousTime = 0;
  pauseReason = paused ? 'Paused' : '';
  const recipe = PRESETS.find(p => p.id === preset.value)!;
  element('world-title').textContent = recipe.name;
  element('preset-description').textContent = recipe.description;
  showCensus(); draw();
}
element<HTMLFormElement>('restart-form').addEventListener('submit', event => { event.preventDefault(); reset(); });
preset.addEventListener('change', reset);
mutation.addEventListener('change', reset);
play.addEventListener('click', () => { paused = !paused; pauseReason = ''; accumulator = 0; previousTime = 0; showCensus(); });
step.addEventListener('click', () => { if (!paused || world.particles.length === 0) return; world.step(); showCensus(); draw(); });
element('export').addEventListener('click', () => {
  const observation = world.snapshot();
  const blob = new Blob([JSON.stringify(observation, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = `particles-${observation.settings.preset}-seed-${observation.settings.seed}-tick-${world.tick}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  element('control-note').textContent = 'Observation downloaded. Reset with the same settings to start again.';
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { paused = true; pauseReason = 'Paused while away'; }
  accumulator = 0; previousTime = 0; showCensus();
});
new ResizeObserver(() => {
  const width = Math.round(canvas.getBoundingClientRect().width * Math.min(devicePixelRatio || 1, 2));
  if (width > 0 && canvas.width !== width) { canvas.width = width; canvas.height = width; draw(); }
}).observe(canvas);
function frame(now: number) {
  if (!paused && !document.hidden && world.particles.length > 0) {
    accumulator += Math.min(previousTime ? now - previousTime : 0, 100) * Number(speed.value);
    const start = performance.now();
    let ticks = 0;
    while (accumulator >= 1000 / 30 && ticks < 8 && performance.now() - start < 8) {
      world.step(); accumulator -= 1000 / 30; ticks++;
      if (world.particles.length === 0) { paused = true; break; }
    }
    // Discard excess wall-clock debt; slow devices run fewer fixed ticks, never larger ticks.
    accumulator = Math.min(accumulator, 1000 / 30 * 8);
    if (world.tick - lastDisplayTick >= 10 || paused) showCensus();
    if (ticks) draw();
  }
  previousTime = now;
  requestAnimationFrame(frame);
}
reset();
requestAnimationFrame(frame);
