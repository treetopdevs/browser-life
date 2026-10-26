import { ParticleWorld, PRESETS, RULES } from './model.ts';
import type { PresetId, ParticleRecipe } from './model.ts';
import { createExploration, keepFavorite, parseExploration, serializeExploration, recipeNode, MAX_SELECTIONS, MAX_IMPORT_BYTES } from './comparison.ts';
import type { Exploration } from './comparison.ts';
import { advanceComparison } from './comparison-clock.ts';
import './picker.css';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const names = ['Mint', 'Amber', 'Lilac'];
const colors = ['#91e1c0', '#f2be78', '#b5adf2'];
const fmt = (n: number) => n.toLocaleString('en-US');
const preset = el<HTMLSelectElement>('preset');
const seed = el<HTMLInputElement>('seed');
const mutation = el<HTMLInputElement>('mutation');
const reason = el<HTMLInputElement>('reason');
const play = el<HTMLButtonElement>('play');
const step = el<HTMLButtonElement>('step');
const pace = el<HTMLSelectElement>('pace');
const fileInput = el<HTMLInputElement>('import');
for (const item of PRESETS) preset.add(new Option(item.name, item.id));
let session = createExploration(1201, 'flocks', true);
let worlds = buildWorlds(session);
let comparisonTick = 0;
let extinctionTicks: (number | null)[] = [null, null, null];
let paused = matchMedia('(prefers-reduced-motion: reduce)').matches || document.hidden;
let previousTime = 0;
let accumulator = 0;
let lastDisplay = -1;
let revision = 0;
let importRequest = 0;
let pauseReason = paused ? 'Paused · ready to compare' : '';

function buildWorlds(candidate: Exploration) {
  return candidate.slate.map(id => new ParticleWorld(candidate.seed, candidate.preset, candidate.mutation, recipeNode(candidate, id).recipe));
}
const cards = [0, 1, 2].map(index => {
  const card = document.createElement('section'); card.className = 'world'; card.setAttribute('aria-labelledby', `world-${index}-title`);
  // This template contains only our own fixed strings. Imported data is always assigned as text.
  card.innerHTML = `<div class="world-top"><h2 id="world-${index}-title">World ${index + 1}</h2><span class="recipe-id"></span></div><canvas width="560" height="560" role="img" aria-label="World ${index + 1}; population and family counts are given below."></canvas><div class="world-summary"><div class="numbers"><span><strong class="population">0</strong>living</span><span>Births <b class="births">0</b><br>Deaths <b class="deaths">0</b></span></div><div class="families"></div><p class="world-state"></p><p class="differences"></p><button type="button" class="keep">Keep world ${index + 1}</button><details><summary>Exact recipe</summary><div class="recipe-details"></div></details></div>`;
  el('worlds').append(card);
  const canvas = card.querySelector('canvas')!;
  const keep = card.querySelector<HTMLButtonElement>('.keep')!;
  keep.addEventListener('click', () => {
    if (!paused || session.selections.length >= MAX_SELECTIONS) return;
    try {
      const next = keepFavorite(session, index as 0 | 1 | 2, comparisonTick, reason.value);
      install(next, 'Paused · favorite kept');
      reason.value = '';
    } catch (error) {
      el('keep-help').textContent = `Could not keep this recipe: ${error instanceof Error ? error.message : 'Please try again.'}`;
    }
  });
  new ResizeObserver(() => {
    const width = Math.round(canvas.getBoundingClientRect().width * Math.min(devicePixelRatio || 1, 2));
    if (width > 0 && canvas.width !== width) { canvas.width = width; canvas.height = width; drawWorld(index); }
  }).observe(canvas);
  return { card, canvas, context: canvas.getContext('2d')!, keep };
});
function setText(target: HTMLElement, value: string) { if (target.textContent !== value) target.textContent = value; }
function status() {
  const allExtinct = worlds.every(world => world.particles.length === 0);
  if (allExtinct || comparisonTick >= 10_000_000) paused = true;
  play.textContent = paused ? 'Play' : 'Pause'; play.disabled = allExtinct || comparisonTick >= 10_000_000;
  step.disabled = !paused || play.disabled;
  setText(el('status'), allExtinct ? 'All worlds extinct · restart to compare again' : comparisonTick >= 10_000_000 ? 'Tick limit reached · restart to continue' : paused ? pauseReason || 'Paused' : 'Running together');
  const atLimit = session.selections.length >= MAX_SELECTIONS;
  for (const card of cards) card.keep.disabled = !paused || atLimit;
  el('keep-help').textContent = atLimit ? '30 choices saved. You can watch this final comparison, export your choices, or start a new session.' : paused ? 'Keep a favorite to begin the next comparison at tick zero, paused.' : 'Pause before choosing a favorite. All three worlds will restart together.';
}
function metrics() {
  el('tick').textContent = fmt(comparisonTick);
  worlds.forEach((world, i) => {
    const census = world.census(); const card = cards[i].card;
    card.querySelector('.population')!.textContent = fmt(census.population);
    card.querySelector('.births')!.textContent = fmt(census.births);
    card.querySelector('.deaths')!.textContent = fmt(census.deaths);
    card.querySelector('.world-state')!.textContent = extinctionTicks[i] !== null ? `Extinct at tick ${fmt(extinctionTicks[i]!)} · still empty` : `Comparison tick ${fmt(comparisonTick)} · ${fmt(census.mutations)} mutated births · ${fmt(census.blockedBirths)} blocked birth attempts`;
    card.querySelector('.families')!.replaceChildren(...names.map((name, family) => {
      const item = document.createElement('span'); item.className = 'family'; item.style.setProperty('--color', colors[family]); item.textContent = `${name} ${fmt(census.counts[family])}`; return item;
    }));
  });
  lastDisplay = comparisonTick; status();
}
function coefficientChange(before: number, after: number) {
  if (before > 0 && after < 0) return 'attraction becomes repulsion';
  if (before < 0 && after > 0) return 'repulsion becomes attraction';
  if (after === 0) return before > 0 ? 'attraction removed' : 'repulsion removed';
  if (before === 0) return after > 0 ? 'attraction added' : 'repulsion added';
  if (after > 0) return after > before ? 'more attraction' : 'less attraction';
  return after < before ? 'stronger repulsion' : 'weaker repulsion';
}
function recipeDescription(recipe: ParticleRecipe, baseline: ParticleRecipe, index: number) {
  if (session.selections.length === 0) return PRESETS.find(item => item.rows.every((row, i) => row.every((n, j) => n === recipe.rows[i][j])) && item.alignment === recipe.alignment)?.description ?? 'A starting movement recipe.';
  if (index === 0) return 'Your kept recipe, unchanged. A fresh world with the same seed.';
  const differences: string[] = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (recipe.rows[i][j] !== baseline.rows[i][j]) differences.push(`${names[i]} → ${names[j]} ${coefficientChange(baseline.rows[i][j], recipe.rows[i][j])}`);
  if (recipe.alignment !== baseline.alignment) differences.push(`${recipe.alignment > baseline.alignment ? 'more' : 'less'} alignment`);
  if (recipe.foodRenewal !== baseline.foodRenewal) differences.push(`${recipe.foodRenewal > baseline.foodRenewal ? 'faster' : 'slower'} food renewal`);
  return `Compared with your favorite: ${differences.join('; ')}.`;
}
function showRecipes() {
  const baseline = recipeNode(session, session.slate[0]).recipe;
  session.slate.forEach((id, i) => {
    const node = recipeNode(session, id); const card = cards[i].card;
    card.querySelector('.recipe-id')!.textContent = id;
    card.querySelector('h2')!.textContent = session.selections.length ? i === 0 ? 'Your favorite' : `Variation ${i}` : PRESETS.find(item => item.rows.every((row, r) => row.every((value, c) => value === node.recipe.rows[r][c])) && item.alignment === node.recipe.alignment)?.name ?? `World ${i + 1}`;
    cards[i].canvas.setAttribute('aria-label', `${card.querySelector('h2')!.textContent}; population and family counts are given below.`);
    card.querySelector('.differences')!.textContent = recipeDescription(node.recipe, baseline, i);
    const content = card.querySelector('.recipe-details')!; content.replaceChildren();
    const caption = document.createElement('p'); caption.className = 'recipe-caption'; caption.textContent = 'Rows respond to columns: positive attracts, negative repels. Values range from −1 to 1.';
    const table = document.createElement('table'); table.className = 'recipe';
    const head = document.createElement('tr');
    for (const text of ['Responds to', ...names]) { const th = document.createElement('th'); th.textContent = text; th.scope = 'col'; head.append(th); }
    table.append(head);
    node.recipe.rows.forEach((row, r) => { const tr = document.createElement('tr'); const label = document.createElement('th'); label.scope = 'row'; label.textContent = names[r]; tr.append(label); for (const value of row) { const td = document.createElement('td'); td.textContent = value.toFixed(3); tr.append(td); } table.append(tr); });
    const other = document.createElement('p'); other.className = 'recipe-caption'; other.textContent = `Alignment ${node.recipe.alignment.toFixed(3)} · food renewal ${node.recipe.foodRenewal.toFixed(3)} per tick and patch. Parent: ${node.parentId ?? 'starting recipe'}.`;
    content.append(caption, table, other);
  });
  el('active-settings').textContent = `Seed ${session.seed} · inherited changes ${session.mutation ? 'on' : 'off'}`;
  el('selection-count').textContent = String(session.selections.length);
  const history = el('history'); history.replaceChildren();
  if (!session.selections.length) { const item = document.createElement('li'); item.textContent = 'No choices yet. Let the worlds move, then pick one.'; history.append(item); }
  for (const selection of session.selections) {
    const item = document.createElement('li'); item.textContent = `Kept ${selection.chosenId} at tick ${fmt(selection.evaluationTick)}, seed ${selection.seed}.`;
    if (selection.reason) { const note = document.createElement('span'); note.className = 'reason'; note.textContent = selection.reason; item.append(note); }
    history.append(item);
  }
}
function install(candidate: Exploration, message: string) {
  const nextWorlds = buildWorlds(candidate); // Construct everything before changing the current session.
  session = candidate; worlds = nextWorlds; comparisonTick = 0; extinctionTicks = [null, null, null]; paused = true;
  accumulator = 0; previousTime = 0; revision++; pauseReason = message;
  seed.value = String(session.seed); preset.value = session.preset; mutation.checked = session.mutation;
  showRecipes(); metrics(); draw();
}
function advance() {
  comparisonTick = advanceComparison(worlds, comparisonTick, extinctionTicks);
}
function drawWorld(index: number) {
  const view = cards[index]; if (!view) return;
  const ctx = view.context, size = view.canvas.width, world = worlds[index];
  ctx.fillStyle = '#08151c'; ctx.fillRect(0, 0, size, size);
  for (const patch of world.food) for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) {
    const x = (patch.x + dx) * size, y = (patch.y + dy) * size, radius = patch.radius * size;
    if (x + radius < 0 || x - radius > size || y + radius < 0 || y - radius > size) continue;
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fillStyle = `rgba(64,130,91,${.04 + .15 * Math.max(0, Math.min(1, patch.amount / RULES.foodCapacity))})`; ctx.fill(); ctx.strokeStyle = '#29473f'; ctx.lineWidth = 1; ctx.stroke();
  }
  for (const particle of world.particles) for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) {
    const x = (particle.x + dx) * size, y = (particle.y + dy) * size, radius = Math.max(1.4, size * .004);
    if (x < -radius || x > size + radius || y < -radius || y > size + radius) continue;
    ctx.strokeStyle = colors[particle.family]; ctx.globalAlpha = .4; ctx.lineWidth = Math.max(1, size * .0015); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - particle.vx * size * 3, y - particle.vy * size * 3); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillStyle = colors[particle.family]; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
  }
}
function draw() { worlds.forEach((_, i) => drawWorld(i)); }
play.addEventListener('click', () => { revision++; paused = !paused; pauseReason = ''; accumulator = 0; previousTime = 0; metrics(); });
step.addEventListener('click', () => { if (!paused) return; revision++; advance(); metrics(); draw(); });
el('restart').addEventListener('click', () => install(session, 'Paused · comparison restarted'));
el<HTMLFormElement>('new-session').addEventListener('submit', event => {
  event.preventDefault(); if (!seed.reportValidity()) return;
  const next = createExploration(Number(seed.value), preset.value as PresetId, mutation.checked);
  install(next, 'Paused · new session ready'); reason.value = ''; el('file-status').textContent = 'New session started. Export choices before leaving this page.';
});
for (const control of [seed, preset, mutation, reason, pace]) control.addEventListener('input', () => { revision++; });
el('export-before').addEventListener('click', () => el('export').click());
el('export').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([serializeExploration(session)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `particle-choices-seed-${session.seed}-round-${session.selections.length}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  el('file-status').textContent = 'Choices exported. This document records recipes and choices, not the current particle states.';
});
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0]; fileInput.value = ''; if (!file) return;
  const request = ++importRequest, startedAt = revision;
  try {
    if (file.size > MAX_IMPORT_BYTES) throw new Error('File is larger than 128 KiB.');
    const text = await file.text();
    if (request !== importRequest) return;
    if (startedAt !== revision) throw new Error('The comparison changed while reading the file. Import it again.');
    const candidate = parseExploration(text);
    install(candidate, 'Paused · imported recipes ready'); reason.value = '';
    el('file-status').textContent = `Imported ${session.selections.length} choices. Recipes restart at tick zero; particle states were not restored.`;
  } catch (error) {
    if (request === importRequest) el('file-status').textContent = `Import refused: ${error instanceof Error ? error.message : 'Unreadable file.'} Current worlds are unchanged.`;
  }
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
    if (comparisonTick - lastDisplay >= 10 || paused) metrics();
    if (ticks) draw();
  }
  previousTime = now; requestAnimationFrame(frame);
}
showRecipes(); metrics(); draw(); requestAnimationFrame(frame);
