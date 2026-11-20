import './style.css';
import { inspectRows, tileHeading } from './inspect.ts';
import type { OligomerWorld } from './model.ts';
import {
  type Channel,
  SUB,
  TROPHIC_COLOURS,
  WALL_COLOUR_NAMES,
  WALL_NAMES,
  WALL_PALETTE,
  bufferSize,
  channelMax,
  dominantIndex,
  feedstockAmount,
  rampInto,
  rampScale,
  renderChemistry,
  renderLysin,
  renderTrophic,
  renderWallMotif,
  stepTile,
  tileAt,
  tileSourceOf,
  zoomFor,
} from './render.ts';
import type { TileSource } from './render.ts';
import { CENSUS_EVERY, ViewerObserver, badgeState } from './viewer-observer.ts';
import { buildCondition, describeCondition } from './worlds.ts';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = el<HTMLCanvasElement>('world'), overlay = el<HTMLCanvasElement>('overlay');
const ctx = canvas.getContext('2d')!, octx = overlay.getContext('2d')!;
const hist = el<HTMLCanvasElement>('history'), h2 = el<HTMLCanvasElement>('history2'), h3 = el<HTMLCanvasElement>('history3');
const playBtn = el<HTMLButtonElement>('play'), stepBtn = el<HTMLButtonElement>('step'), paceSel = el<HTMLSelectElement>('pace');
const startSel = el<HTMLSelectElement>('start'), sizeSel = el<HTMLSelectElement>('size'), viewSel = el<HTMLSelectElement>('view'), chemSel = el<HTMLSelectElement>('chem');
const seedInput = el<HTMLInputElement>('seed'), live = el<HTMLElement>('live');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const VIEW_NOTES: Record<string, string> = {
  wall: 'Each compartment takes the colour of its main wall pattern, brighter when the wall is thicker. Dark squares are empty, with a faint blue where food is left over.',
  lysin: 'Same colours, dimmed, with a ring around compartments that carry a lysin; the ring shows which pattern that lysin cuts (dotted white = more than one, or any). Only meaningful in the worlds with predators.',
  trophic: 'Teal compartments mostly cut the light-made food, gold ones do both, magenta ones mostly cut the leftovers other compartments make. Grey means too little activity lately to say (under 4 cuts in about 130 steps).',
  chem: 'The loose matter between compartments, per square. Choose food, short pieces (two letters) or free 0s and 1s. The brightest value is rescaled as the run goes on, and the scale is written under the grid.',
};

let world: OligomerWorld = buildCondition('LYSE', 32, 1);
let src: TileSource = tileSourceOf(world);
let viewer = new ViewerObserver(world);
let paused = true, selected: number | null = null, frame = 0, zoom = 4;
let img = new ImageData(1, 1), off = document.createElement('canvas'), offCtx = off.getContext('2d')!;
const maskCache = new Map<number, number>();
const chemScale: Record<Channel, number> = { food: 4, dimers: 4, monomers: 4 };
let foodScale = 4;

function rgb(c: ArrayLike<number>): string { return `rgb(${c[0]},${c[1]},${c[2]})`; }
const say = (t: string) => { live.textContent = t; };

/** `advance` (running frames only) lets the colour scales decay; a paused redraw never moves them, so it is repeatable. */
function draw(advance = false): void {
  const view = viewSel.value;
  let fmax = 0;
  for (let i = 0; i < src.nTiles; i++) { const v = feedstockAmount(src, i); if (v > fmax) fmax = v; }
  foodScale = advance ? rampScale(fmax, foodScale) : Math.max(foodScale, fmax);
  const data = img.data;
  if (view === 'lysin') renderLysin(src, data, { food: foodScale }, maskCache);
  else if (view === 'trophic') renderTrophic(src, data, viewer.feed, viewer.sec);
  else if (view === 'chem') {
    const ch = chemSel.value as Channel;
    const max = channelMax(src, ch);
    chemScale[ch] = advance ? rampScale(max, chemScale[ch]) : Math.max(chemScale[ch], max);
    renderChemistry(src, data, ch, chemScale[ch]);
    const lm = el('legend').querySelector('#legend-max');
    if (lm) lm.textContent = String(Math.round(chemScale[ch]));
    el('scale').textContent = `scale: up to ${Math.round(chemScale[ch])} per tile (${chemSel.selectedOptions[0].text.toLowerCase()})`;
  } else renderWallMotif(src, data, { food: foodScale });
  if (view !== 'chem') el('scale').textContent = '';
  offCtx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
  drawSelection();
}

function drawSelection(): void {
  octx.clearRect(0, 0, overlay.width, overlay.height);
  if (selected === null) return;
  const t = SUB * zoom, x = (selected % src.width) * t, y = Math.floor(selected / src.width) * t;
  octx.lineWidth = 2; octx.strokeStyle = '#000'; octx.strokeRect(x + 0.5, y + 0.5, t - 1, t - 1);
  octx.lineWidth = 1; octx.strokeStyle = '#fff'; octx.strokeRect(x + 1.5, y + 1.5, t - 3, t - 3);
}

function buildLegend(): void {
  const view = viewSel.value, ul = el('legend');
  const items: string[] = [];
  const sw = (cls: string, style: string, text: string) => `<li><i class="sw ${cls}" style="${style}"></i>${text}</li>`;
  if (view === 'wall') WALL_PALETTE.forEach((c, i) => items.push(sw('', `background:${rgb(c)}`, `${WALL_NAMES[i]}  ${WALL_COLOUR_NAMES[i]}`)));
  else if (view === 'lysin') {
    WALL_PALETTE.forEach((c, i) => items.push(sw('ring', `border-color:${rgb(c)}`, `ring: lysin cuts ${WALL_NAMES[i]} (${WALL_COLOUR_NAMES[i]})`)));
    items.push(sw('ring dots', '', 'dotted white ring: cuts more than one pattern, or any'));
    items.push(sw('', 'background:#3a4a52', 'dimmed square: no lysin'));
  } else if (view === 'trophic') {
    items.push(sw('', `background:${rgb(TROPHIC_COLOURS.primary)}`, 'teal: mostly cuts food'));
    items.push(sw('', `background:${rgb(TROPHIC_COLOURS.mixed)}`, 'gold: both'));
    items.push(sw('', `background:${rgb(TROPHIC_COLOURS.secondary)}`, 'magenta: mostly cuts leftovers'));
    items.push(sw('', `background:${rgb(TROPHIC_COLOURS.quiet)}`, 'grey: too quiet to say'));
  } else {
    const stops = [0, 0.25, 0.5, 0.75, 1].map((t) => { const d = [0, 0, 0]; rampInto(t, d); return rgb(d); });
    items.push(`<li><i class="sw ramp" style="background:linear-gradient(90deg,${stops.join(',')})"></i>0 to max <span id="legend-max">${Math.round(chemScale[chemSel.value as Channel])}</span> (ring colour; the dot inside a live square is its wall)</li>`);
  }
  ul.innerHTML = items.join('');
}

function drawCharts(): void {
  const rows = viewer.ring.toArray(), n = rows.length;
  const c = hist.getContext('2d')!;
  c.fillStyle = '#101b21'; c.fillRect(0, 0, hist.width, hist.height);
  rows.forEach((r, j) => {
    if (r.live === 0) return;
    let y = hist.height;
    for (let wi = 0; wi < 6; wi++) {
      const h = r.wallShares[wi] * hist.height;
      c.fillStyle = rgb(WALL_PALETTE[wi]);
      c.fillRect(j * 3, y - h, 3, h);
      y -= h;
    }
  });
  const line = (cv: HTMLCanvasElement, f: (r: (typeof rows)[number]) => number, lo: number, hi: number, colour: string) => {
    const g = cv.getContext('2d')!;
    g.fillStyle = '#101b21'; g.fillRect(0, 0, cv.width, cv.height);
    g.strokeStyle = colour; g.lineWidth = 1.5; g.beginPath();
    rows.forEach((r, j) => { const y = cv.height - 4 - ((f(r) - lo) / Math.max(1e-9, hi - lo)) * (cv.height - 8); if (j) g.lineTo(j * 3 + 1.5, y); else g.moveTo(j * 3 + 1.5, y); });
    g.stroke();
  };
  const maxLive = Math.max(8, ...rows.map((r) => r.live));
  line(h2, (r) => r.live, 0, maxLive, '#cfd8dc'); line(h3, (r) => r.wallHillD1, 1, 6, '#9aa7b0');
  el('h2-note').textContent = `Compartments alive: 0 to ${maxLive}`;
  el('h3-note').textContent = 'Pattern diversity: 1 to 6';
  const last = rows[n - 1];
  const shares = el('shares');
  if (!last) { shares.innerHTML = ''; hist.setAttribute('aria-label', 'Wall pattern shares over time. No census yet.'); el('history-note').textContent = 'Share of wall by pattern, one column per 200 steps. The history fills over about a minute and a half.'; return; }
  shares.innerHTML = WALL_NAMES.map((nm, i) => `<li><i class="sw" style="background:${rgb(WALL_PALETTE[i])}"></i>${nm} ${WALL_COLOUR_NAMES[i]} ${(last.wallShares[i] * 100).toFixed(0)}%</li>`).join('');
  const lead = last.dominantWall >= 0 ? `${WALL_NAMES[last.dominantWall]} at ${(last.dominantWallShare * 100).toFixed(0)} percent` : 'none';
  hist.setAttribute('aria-label', `Wall pattern shares over the last ${(n * CENSUS_EVERY).toLocaleString('en-US')} steps; leading pattern ${lead}`);
  el('history-note').textContent = `Share of wall by pattern, last ${(n * CENSUS_EVERY).toLocaleString('en-US')} steps, one column per ${CENSUS_EVERY} steps.`;
}

function renderInspector(): void {
  const box = el('inspector');
  if (selected === null) { box.innerHTML = '<p class="help">Nothing selected. Click a square of the grid.</p>'; return; }
  const dl = document.createElement('dl');
  for (const [k, v] of inspectRows(world, selected, viewer, maskCache)) {
    const d = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = k; dd.textContent = v; d.append(dt, dd); dl.append(d);
  }
  const h = document.createElement('p'); h.className = 'tile-h'; h.textContent = tileHeading(world, selected);
  box.replaceChildren(h, dl);
}

function refresh(): void {
  const set = (id: string, v: string | number) => { el(id).textContent = String(v); };
  let liveN = 0;
  for (let i = 0; i < src.nTiles; i++) liveN += src.alive[i];
  const t = viewer.totals, last = viewer.ring.length ? viewer.ring.at(viewer.ring.length - 1) : null;
  set('r-t', world.stepCount); set('r-live', liveN); set('r-div', t.divisions); set('r-starve', t.deathsStarve); set('r-lyse', t.deathsLyse); set('r-cuts', t.lyseEvents);
  set('r-lead', last && last.dominantWall >= 0 ? `${WALL_NAMES[last.dominantWall]} ${(last.dominantWallShare * 100).toFixed(0)}%` : 'none yet');
  set('r-wd1', last ? last.wallHillD1.toFixed(2) : '0'); set('r-sw', viewer.leaderChanges());
  const r = viewer.residuals(world), b = badgeState(r.res0, r.res1), badge = el('r-res');
  badge.textContent = b.text; badge.className = `badge-res ${b.ok ? 'ok' : 'bad'}`; set('r-res-word', b.label);
  drawCharts();
  if (selected !== null) renderInspector();
}

function setPaused(p: boolean, text?: string): void {
  paused = p; playBtn.textContent = p ? 'Play' : 'Pause';
  if (text) say(text);
}

function stepOnce(): void {
  world.step(viewer);
  viewer.endStep(world.stepCount);
  if (world.stepCount % CENSUS_EVERY === 0) viewer.sampleCensus(world);
}

function reset(): void {
  const raw = seedInput.value.trim();
  let seed = raw === '' ? NaN : Number(raw);
  const replaced = !Number.isInteger(seed) || seed < 0 || seed > 2 ** 31 - 1;
  if (replaced) seed = 1;
  seedInput.value = String(seed);
  const size = Number(sizeSel.value);
  world = buildCondition(startSel.value, size, seed);
  src = tileSourceOf(world); viewer = new ViewerObserver(world); maskCache.clear();
  chemScale.food = chemScale.dimers = chemScale.monomers = 4; foodScale = 4;
  selected = null;
  const buf = bufferSize(src); zoom = zoomFor(buf.w);
  off.width = buf.w; off.height = buf.h; img = new ImageData(buf.w, buf.h);
  canvas.width = overlay.width = buf.w * zoom; canvas.height = overlay.height = buf.h * zoom;
  el('world-note').textContent = describeCondition(world.cfg);
  setPaused(true, replaced ? 'Seed was not a whole number from 0 to 2147483647, so seed 1 is used. Paused · new world' : 'Paused · new world');
  buildLegend(); refresh(); renderInspector(); draw();
}

function select(tile: number | null): void {
  selected = tile;
  renderInspector(); drawSelection();
  if (tile === null) { say('Selection cleared.'); return; }
  const x = tile % src.width, y = Math.floor(tile / src.width);
  say(src.alive[tile] ? `Tile (${x}, ${y}): compartment, wall ${WALL_NAMES[dominantIndex(src, tile)]}` : `Tile (${x}, ${y}): empty`);
}

function loop(): void {
  if (!paused) {
    const cap = Number(paceSel.value) || Infinity, t0 = performance.now();
    let n = 0;
    do { stepOnce(); n++; } while (n < cap && performance.now() - t0 < 10);
    if (++frame % 10 === 0) refresh();
    draw(true);
  }
  requestAnimationFrame(loop);
}

playBtn.addEventListener('click', () => { if (paused) { setPaused(false, 'Running.'); } else { setPaused(true, 'Paused.'); refresh(); draw(); } });
stepBtn.addEventListener('click', () => { setPaused(true, 'Paused · one step'); stepOnce(); refresh(); draw(); });
startSel.addEventListener('change', reset);
sizeSel.addEventListener('change', reset);
el<HTMLFormElement>('seed-form').addEventListener('submit', (e) => { e.preventDefault(); reset(); });
function viewChanged(): void {
  const chem = viewSel.value === 'chem';
  chemSel.hidden = !chem; el('chem-label').hidden = !chem;
  el('view-note').textContent = VIEW_NOTES[viewSel.value];
  buildLegend(); draw(); buildLegend();
}
viewSel.addEventListener('change', viewChanged);
chemSel.addEventListener('change', () => { draw(); buildLegend(); });
canvas.addEventListener('click', (e) => {
  const r = canvas.getBoundingClientRect();
  select(tileAt(e.clientX - r.left - canvas.clientLeft, e.clientY - r.top - canvas.clientTop, canvas.clientWidth, canvas.clientHeight, src.width, src.height));
});
canvas.addEventListener('keydown', (e) => {
  if (e.key.startsWith('Arrow')) {
    e.preventDefault();
    select(selected === null ? (Math.floor(src.height / 2) * src.width + Math.floor(src.width / 2)) : stepTile(selected, e.key, src.width, src.height));
  } else if (e.key === 'Escape') select(null);
  else if (e.key === 'Enter' && selected !== null) select(selected);
});

if (reduced) paceSel.value = '4';
reset();
viewChanged();
if (reduced) say('Paused (reduced motion is on). Press Play to run.');
requestAnimationFrame(loop);
