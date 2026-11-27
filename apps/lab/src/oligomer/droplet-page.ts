/**
 * DOM glue for the droplet family of the /oligomer/ page. page.ts owns the Phase A world; when the world
 * select holds a droplet world this module takes over the shared canvas, legend, charts and inspector, and
 * swaps the controls that only apply to one family. The viewer only ever reads the run.
 */

import {
  CPU_BUDGET_MS,
  CpuDropletEngine,
  ENGINE_PACES,
  ENGINE_SIZES,
  type EngineKind,
  type EngineMode,
  createEngine,
  onDeviceError,
  onDeviceLost,
  acquireDevice,
} from './droplet-engine.ts';
import { dropletHeading, dropletInspectRows, dropletTileSpeech } from './droplet-inspect.ts';
import {
  type DropletChannel,
  dropletBufferSize,
  dropletMax,
  dropletRampScale,
  renderDropletChem,
  renderDropletPattern,
  renderDropletPhage,
} from './droplet-render.ts';
import { type BuildResult, DropletRun, type RunOpts, parseSeed } from './droplet-run.ts';
import { dropletPageNote } from './droplet-wording.ts';
import { DROPLET_WORLD_OPTIONS, buildDropletWorld, dropletIdOfValue, isDropletOptionValue } from './droplet-worlds.ts';
import { WALL_COLOUR_NAMES, WALL_NAMES, WALL_PALETTE, rampInto, stepTile, tileAt, zoomFor } from './render.ts';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = el<HTMLCanvasElement>('world'), overlay = el<HTMLCanvasElement>('overlay');
const ctx = canvas.getContext('2d')!, octx = overlay.getContext('2d')!;
const playBtn = el<HTMLButtonElement>('play'), stepBtn = el<HTMLButtonElement>('step');
const startSel = el<HTMLSelectElement>('start'), seedInput = el<HTMLInputElement>('seed');
const dsizeSel = el<HTMLSelectElement>('dsize'), dviewSel = el<HTMLSelectElement>('dview'), dchemSel = el<HTMLSelectElement>('dchem');
const dpaceSel = el<HTMLSelectElement>('dpace'), engineSel = el<HTMLSelectElement>('engine-mode');
const live = el<HTMLElement>('live');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const say = (t: string) => { live.textContent = t; };
const rgb = (c: ArrayLike<number>) => `rgb(${c[0]},${c[1]},${c[2]})`;
const fmt = (n: number) => n.toLocaleString('en-US');

export const isDropletWorld = (v: string): boolean => isDropletOptionValue(v);

// the droplet worlds join the one world select; their ids and labels come from the arm table
for (const o of DROPLET_WORLD_OPTIONS) {
  const opt = document.createElement('option');
  opt.value = o.value; opt.textContent = o.label;
  el('start-droplets').append(opt);
}

const VIEW_NOTES: Record<string, string> = {
  pattern: 'Each square takes the colour of its main wall pattern, brighter where the wall is thicker. Thin wall is not drawn, so the picture shows only the thicker patches, not the thin wall around them.',
  phage: 'Wall is dimmed. A bright dot marks phage, coloured by the pattern it grows in (one colour for all phage in the world where phage ignores the pattern) and brighter where there is more of it. A bright dot on dim wall of the same colour is phage sitting in wall of that pattern. On the 256 grid dots are drawn as a checkerboard. Brightness is a weak cue: the inspector gives the numbers.',
  chem: 'The loose matter between and inside wall patches, per square. Choose food or leftovers. A coloured dot marks the main pattern of a square with thick wall. The brightest value is rescaled as the run goes on and written under the grid.',
};

let active = false;
let selected: number | null = null;
let kindShown: EngineKind | null = null;
let announced: object | null = null;
let img = new ImageData(1, 1), zoom = 1, sub = 4;
const off = document.createElement('canvas'), offCtx = off.getContext('2d')!;
let pScale = 8;
const chemScale: Record<DropletChannel, number> = { food: 64, waste: 64 };
let drawnStep = -1, drawnView = '', chartsStep = -1;

async function buildEngine(opts: RunOpts): Promise<BuildResult> {
  const useGpu = opts.engineMode === 'auto' && !opts.restarted && (await acquireDevice()) !== null;
  const want: EngineKind = useGpu ? 'gpu' : 'cpu';
  const ok = (k: EngineKind, n: number) => ENGINE_SIZES[k].sizes.includes(n);
  let size = ok(want, opts.size) ? opts.size : ENGINE_SIZES[want].default;
  const { ref } = buildDropletWorld(dropletIdOfValue(startSel.value), size, opts.seed);
  const built = await createEngine(opts.engineMode, ref, { restarted: opts.restarted });
  if (built.engine.kind === 'cpu' && !ok('cpu', size)) {
    // the card failed to start at a size only it can run: rebuild at the processor's default size
    size = ENGINE_SIZES.cpu.default;
    return { engine: new CpuDropletEngine(buildDropletWorld(dropletIdOfValue(startSel.value), size, opts.seed).ref), text: built.text };
  }
  return built;
}

let pendingNote = '';
const run = new DropletRun(buildEngine, () => sync(), (t) => { pendingNote = t; say(t); });
onDeviceLost((device, why) => { if (active) void run.fallback(why, device); });
onDeviceError((device, why) => { if (active) void run.fallback(why, device); });

// ---- drawing ---------------------------------------------------------------------------------

function drawSelection(): void {
  octx.clearRect(0, 0, overlay.width, overlay.height);
  const s = run.session;
  if (selected === null || !s) return;
  const t = sub * zoom, w = s.engine.width, x = (selected % w) * t, y = Math.floor(selected / w) * t;
  octx.lineWidth = 2; octx.strokeStyle = '#000'; octx.strokeRect(x + 0.5, y + 0.5, t - 1, t - 1);
  octx.lineWidth = 1; octx.strokeStyle = '#fff'; octx.strokeRect(x + 1.5, y + 1.5, t - 3, t - 3);
}

/** `advance` (a running frame) lets the colour scales decay; a paused redraw never moves them, so it is repeatable. */
function draw(advance: boolean): void {
  const s = run.session;
  if (!s) return;
  const src = s.engine.source, view = dviewSel.value;
  if (view === 'phage') {
    const mx = dropletMax(src.P);
    pScale = advance ? dropletRampScale(mx, pScale, 8) : Math.max(pScale, mx, 8);
    renderDropletPhage(src, img.data, pScale);
    el('scale').textContent = `phage: dots from ${Math.ceil(pScale / 8)} up to ${Math.round(pScale)} per square`;
  } else if (view === 'chem') {
    const ch = dchemSel.value as DropletChannel, mx = dropletMax(ch === 'food' ? src.F : src.A);
    chemScale[ch] = advance ? dropletRampScale(mx, chemScale[ch], 64) : Math.max(chemScale[ch], mx);
    renderDropletChem(src, img.data, ch, chemScale[ch]);
    const lm = el('legend').querySelector('#legend-max');
    if (lm) lm.textContent = String(Math.round(chemScale[ch]));
    el('scale').textContent = `scale: up to ${Math.round(chemScale[ch])} per square (${dchemSel.selectedOptions[0].text.split(' (')[0].toLowerCase()})`;
  } else {
    renderDropletPattern(src, img.data);
    el('scale').textContent = '';
  }
  offCtx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
  drawSelection();
  drawnStep = s.step; drawnView = view + dchemSel.value;
}

function buildLegend(): void {
  const view = dviewSel.value, items: string[] = [];
  const sw = (style: string, text: string) => `<li><i class="sw" style="${style}"></i>${text}</li>`;
  if (view === 'pattern') WALL_PALETTE.forEach((c, i) => items.push(sw(`background:${rgb(c)}`, `${WALL_NAMES[i]} ${WALL_COLOUR_NAMES[i]}`)));
  else if (view === 'phage') {
    WALL_PALETTE.forEach((c, i) => items.push(sw(`background:${rgb(c)}`, `phage of ${WALL_NAMES[i]} (${WALL_COLOUR_NAMES[i]})`)));
    items.push(sw('background:#2a3a40', 'dim square: wall, in its main pattern colour'));
  } else {
    const stops = [0, 0.25, 0.5, 0.75, 1].map((t) => { const d = [0, 0, 0]; rampInto(t, d); return rgb(d); });
    items.push(`<li><i class="sw ramp" style="background:linear-gradient(90deg,${stops.join(',')})"></i>0 to max <span id="legend-max">${Math.round(chemScale[dchemSel.value as DropletChannel])}</span> (square colour; a dot marks the main wall pattern of a square with thick wall)</li>`);
  }
  el('legend').innerHTML = items.join('');
}

function drawCharts(): void {
  const hist = el<HTMLCanvasElement>('history'), h2 = el<HTMLCanvasElement>('history2'), h3 = el<HTMLCanvasElement>('history3');
  const s = run.session, rows = s ? s.ring.toArray() : [], n = rows.length;
  const c = hist.getContext('2d')!;
  c.fillStyle = '#101b21'; c.fillRect(0, 0, hist.width, hist.height);
  rows.forEach((r, j) => {
    let y = hist.height;
    for (let m = 0; m < 6; m++) {
      const h = r.shares[m] * hist.height;
      c.fillStyle = rgb(WALL_PALETTE[m]);
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
  const maxDrops = Math.max(8, ...rows.map((r) => r.droplets));
  line(h2, (r) => r.droplets, 0, maxDrops, '#cfd8dc'); line(h3, (r) => r.hillD1, 1, 6, '#9aa7b0');
  el('h2-note').textContent = `Wall patches: 0 to ${maxDrops}`;
  el('h3-note').textContent = 'Pattern diversity: 1 to 6';
  const last = rows[n - 1], shares = el('shares');
  if (!last) {
    shares.innerHTML = '';
    hist.setAttribute('aria-label', 'Wall pattern shares over time. No census yet.');
    el('history-note').textContent = 'Share of all wall matter by pattern, one column per 100 steps, newest 200 columns.';
    return;
  }
  shares.innerHTML = WALL_NAMES.map((nm, i) => `<li><i class="sw" style="background:${rgb(WALL_PALETTE[i])}"></i>${nm} ${WALL_COLOUR_NAMES[i]} ${(last.shares[i] * 100).toFixed(0)}%</li>`).join('');
  const lead = last.dominant >= 0 ? `${WALL_NAMES[last.dominant]} at ${(last.dominantShare * 100).toFixed(0)} percent` : 'none';
  hist.setAttribute('aria-label', `Wall pattern shares over the last ${fmt(n * 100)} steps; leading pattern ${lead}; ${last.droplets} wall patches`);
  el('history-note').textContent = `Share of all wall matter by pattern (the thin wall outside the patches counts), last ${fmt(n * 100)} steps, one column per 100 steps.`;
}

function renderInspector(): void {
  const box = el('inspector'), s = run.session;
  if (selected === null || !s) { box.innerHTML = '<p class="help">Nothing selected. Click a square of the grid.</p>'; return; }
  const dl = document.createElement('dl');
  for (const [k, v] of dropletInspectRows(s.engine.source, selected)) {
    const d = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = k; dd.textContent = v; d.append(dt, dd); dl.append(d);
  }
  const h = document.createElement('p'); h.className = 'tile-h'; h.textContent = dropletHeading(s.engine.source, selected);
  box.replaceChildren(h, dl);
}

function fillOptions(kind: EngineKind, size: number): void {
  dsizeSel.replaceChildren(...ENGINE_SIZES[kind].sizes.map((n) => {
    const o = document.createElement('option');
    o.value = String(n);
    const tag = n === ENGINE_SIZES[kind].default ? ' (default)' : '';
    const doc = kind === 'gpu' && n !== 64 ? ' (the size the doc runs used)' : ' (no doc results at this size)';
    o.textContent = `${n} x ${n}${tag}${doc}`;
    return o;
  }));
  dsizeSel.value = String(size);
  const small = ENGINE_PACES[kind].paces[0], def = reduced ? small : ENGINE_PACES[kind].default;
  dpaceSel.replaceChildren(...ENGINE_PACES[kind].paces.map((n) => {
    const o = document.createElement('option');
    o.value = String(n);
    o.textContent = kind === 'gpu' ? `${n} steps per frame${n === ENGINE_PACES.gpu.default ? ' (default)' : ''}` : `Up to ${n} steps per frame${n === ENGINE_PACES.cpu.default ? ' (default)' : ''}`;
    return o;
  }));
  dpaceSel.value = String(def);
  kindShown = kind;
}

function set(id: string, v: string | number): void { el(id).textContent = String(v); }

/** Runs on every change of the run (a frame landed, a reset finished, a check ran). */
function sync(): void {
  if (!active) return;
  const s = run.session;
  playBtn.textContent = run.paused ? 'Play' : 'Pause';
  playBtn.disabled = stepBtn.disabled = !s;
  if (!s) {
    el('engine').hidden = false;
    set('engine', 'Building the new world…');
    el('engine').dataset.engine = '';
    drawCharts();
    chartsStep = -1; drawnStep = -1;
    set('d-t', 0);
    return;
  }
  if (kindShown !== s.kind) fillOptions(s.kind, s.size);
  else if (dsizeSel.value !== String(s.size)) dsizeSel.value = String(s.size);
  const engineEl = el('engine');
  engineEl.hidden = false; engineEl.dataset.engine = s.kind; engineEl.textContent = s.text;
  const buf = dropletBufferSize(s.engine);
  if (announced !== s) {
    announced = s;
    sub = buf.sub; off.width = buf.w; off.height = buf.h; img = new ImageData(buf.w, buf.h);
    zoom = zoomFor(buf.w);
    canvas.width = overlay.width = buf.w * zoom; canvas.height = overlay.height = buf.h * zoom;
    pScale = 8; chemScale.food = chemScale.waste = 64;
    selected = null; renderInspector();
    say(`${pendingNote ? `${pendingNote} ` : ''}${s.text}. Paused · new world`);
    pendingNote = '';
  }
  const l = s.latest, b = s.res === 0n;
  set('d-t', s.step); set('d-drops', l.droplets);
  set('d-lead', l.dominant >= 0 ? `${WALL_NAMES[l.dominant]} ${(l.dominantShare * 100).toFixed(0)}%` : 'none yet');
  set('d-d1', l.hillD1.toFixed(2)); set('d-sw', s.leader.changes);
  set('d-phage', fmt(l.phageTotals.reduce((a, c) => a + c, 0)));
  const badge = el('d-res');
  badge.textContent = b ? 'res 0' : `res ${s.res}`; badge.className = `badge-res ${b ? 'ok' : 'bad'}`;
  set('d-res-word', b ? 'balanced' : 'NOT 0'); set('d-res-step', `checked at step ${s.resStep}`);
  if (chartsStep !== s.latest.step || s.ring.length === 0) { drawCharts(); chartsStep = s.latest.step; }
  if (s.step !== drawnStep || dviewSel.value + dchemSel.value !== drawnView) draw(!run.paused);
  if (selected !== null) renderInspector();
}

function select(tile: number | null): void {
  selected = tile;
  renderInspector(); drawSelection();
  const s = run.session;
  if (tile === null || !s) { say('Selection cleared.'); return; }
  say(dropletTileSpeech(s.engine.source, tile));
}

function viewChanged(): void {
  const chem = dviewSel.value === 'chem';
  el('dchem-label').hidden = !chem;
  el('view-note').textContent = VIEW_NOTES[dviewSel.value];
  buildLegend(); draw(false); buildLegend();
}

function noteFor(): void { el('world-note').textContent = dropletPageNote(dropletIdOfValue(startSel.value)); }

const FAMILY_HIDE_A = ['intro-a', 'size-label', 'view-label', 'pace-label', 'chem-label', 'readout-a', 'help-a', 'explain-a'];
const FAMILY_SHOW_D = ['intro-d', 'dsize-label', 'dview-label', 'dpace-label', 'engine-label', 'readout-d', 'help-d', 'explain-d'];

const NAME_KEYS: [string, string, string][] = [
  ['world', 'Oligomer world, a grid of squares holding wall matter. Click or use arrow keys to inspect a square.', ''],
  ['history2', 'Number of wall patches over time.', ''],
];
for (const k of NAME_KEYS) k[2] = el(k[0]).getAttribute('aria-label') ?? '';

/** The page has one title; it names the family of worlds on screen. */
const TITLES = {
  a: ['Walls made of oligomers', 'Compartments that fight over wall patterns'],
  d: ['Walls made of oligomers · wall-patch worlds', 'Six wall patterns that fight over one dish'],
} as const;

function setFamily(d: boolean): void {
  const [eyebrow, title] = d ? TITLES.d : TITLES.a;
  el('page-eyebrow').textContent = eyebrow;
  el('page-title').textContent = title;
  for (const [id, dropletName, aText] of NAME_KEYS) el(id).setAttribute('aria-label', d ? dropletName : aText);
  for (const id of FAMILY_HIDE_A) el(id).hidden = d;
  for (const id of FAMILY_SHOW_D) el(id).hidden = !d;
  el('engine').hidden = !d;
  if (d) el('dchem-label').hidden = dviewSel.value !== 'chem';
  else { el('dchem-label').hidden = true; el('chem-label').hidden = el<HTMLSelectElement>('view').value !== 'chem'; }
}

function currentOpts(size: number, seed: number): RunOpts {
  return { arm: dropletIdOfValue(startSel.value), size, seed, engineMode: engineSel.value as EngineMode };
}

export const dropletFamily = {
  get active(): boolean { return active; },
  /** Called by page.ts reset() whenever the world select holds a droplet world. */
  reset(seed: number, replaced: boolean): void {
    if (!active) { active = true; setFamily(true); viewChanged(); }
    announced = null; drawnStep = -1; chartsStep = -1;
    noteFor();
    const keep = Number(dsizeSel.value);
    const size = kindShown !== null && ENGINE_SIZES[kindShown].sizes.includes(keep) ? keep : 0;
    pendingNote = replaced ? 'Seed was not a whole number from 0 to 2147483647, so seed 1 is used.' : '';
    say(`${pendingNote} Building the new world`.trim());
    void run.reset(currentOpts(size, seed));
  },
  leave(): void {
    if (!active) return;
    active = false; selected = null; announced = null;
    void run.dispose();
    setFamily(false);
    el('engine').hidden = true;
    playBtn.disabled = stepBtn.disabled = false;
  },
  frame(): void {
    const s = run.session;
    if (!s || run.paused) return;
    const kind = s.kind, n = Number(dpaceSel.value) || ENGINE_PACES[kind].default;
    run.tryAdvance(n, kind === 'cpu' ? CPU_BUDGET_MS : undefined);
  },
  play(): void {
    if (!run.session) return;
    if (run.paused) { run.setPlaying(true); say('Running.'); sync(); } else { run.setPlaying(false); say('Paused.'); sync(); }
  },
  step(): void {
    if (!run.session) return;
    say('Paused · one step');
    void run.stepOnce().then(() => sync());
    sync();
  },
};

dsizeSel.addEventListener('change', () => { if (active) startReset(Number(dsizeSel.value)); });
engineSel.addEventListener('change', () => { if (active) startReset(0); });
function startReset(size: number): void {
  const { seed, replaced } = parseSeed(seedInput.value);
  seedInput.value = String(seed);
  announced = null; drawnStep = -1; chartsStep = -1;
  pendingNote = replaced ? 'Seed was not a whole number from 0 to 2147483647, so seed 1 is used.' : '';
  say(`${pendingNote} Building the new world`.trim());
  void run.reset(currentOpts(size, seed));
}
dviewSel.addEventListener('change', () => { if (active) viewChanged(); });
dchemSel.addEventListener('change', () => { if (active) { draw(false); buildLegend(); } });
canvas.addEventListener('click', (e) => {
  const s = run.session;
  if (!active || !s) return;
  const r = canvas.getBoundingClientRect();
  select(tileAt(e.clientX - r.left - canvas.clientLeft, e.clientY - r.top - canvas.clientTop, canvas.clientWidth, canvas.clientHeight, s.engine.width, s.engine.height));
});
canvas.addEventListener('keydown', (e) => {
  const s = run.session;
  if (!active || !s) return;
  const w = s.engine.width, h = s.engine.height;
  if (e.key.startsWith('Arrow')) {
    e.preventDefault();
    select(selected === null ? Math.floor(h / 2) * w + Math.floor(w / 2) : stepTile(selected, e.key, w, h));
  } else if (e.key === 'Escape') select(null);
  else if (e.key === 'Enter' && selected !== null) select(selected);
});
