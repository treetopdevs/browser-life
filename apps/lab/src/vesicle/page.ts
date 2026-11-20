import './style.css';
import { VesicleWorld } from './model.ts';
import { census } from './observe.ts';
import type { Census } from './observe.ts';
import { HEREDITY, THREAD, WALL_GENES, Weather, feedWorld, garden, theftWorld, wild } from './worlds.ts';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = el<HTMLCanvasElement>('world'), historyCanvas = el<HTMLCanvasElement>('history');
const ctx = canvas.getContext('2d')!, hctx = historyCanvas.getContext('2d')!;
const playBtn = el<HTMLButtonElement>('play'), stepBtn = el<HTMLButtonElement>('step'), paceSel = el<HTMLSelectElement>('pace');
const startSel = el<HTMLSelectElement>('start'), colorSel = el<HTMLSelectElement>('color'), tintSel = el<HTMLSelectElement>('tint');
const seedInput = el<HTMLInputElement>('seed'), live = el<HTMLElement>('live');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The page runs the wild worlds on a dish of 4 times the base area (the 16-fold dish is too slow for a browser frame loop). */
const WILD_AREA = 4;
let weather = new Weather(1, 0);

function build(kind: string, seed: number): VesicleWorld {
  weather = new Weather(seed, 0);
  if (kind.startsWith('wild')) {
    const wl = wild(WILD_AREA), arm = kind === 'wild-wall' ? WALL_GENES : kind === 'wild-thread' ? THREAD : kind === 'wild-heredity' ? HEREDITY : {};
    weather = new Weather(seed, 0, wl.weatherRings ?? 0);
    return garden(seed, { founders: wl.founders, params: { ...wl.params, ...arm } });
  }
  if (kind === 'theft') return theftWorld(seed);
  if (kind === 'feed') return feedWorld(seed);
  if (kind === 'wall') return garden(seed, { params: WALL_GENES });
  if (kind === 'thread') return garden(seed, { params: THREAD });
  if (kind === 'heredity') return garden(seed, { params: HEREDITY });
  if (kind === 'neutral') return garden(seed, { params: { ...HEREDITY, neutral: true } });
  if (kind === 'nogain') return garden(seed, { params: { ...HEREDITY, tradeoff: 0 } });
  return garden(seed);
}

let world = build('garden', 1), paused = true, last: Census = census(world), frame = 0;
const history: { live: number; gene: number; mark: number }[] = [];

function hue(h: number): string { return `hsl(${((h % 360) + 360) % 360} 70% 62%)`; }
const geneColour = (v: number) => hue(240 - (v * 240) / 255 + 360);

function draw(): void {
  const w = world, sx = canvas.width / w.p.W, sy = canvas.height / w.p.H, s = Math.min(sx, sy);
  ctx.fillStyle = '#0e141a'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const tint = tintSel.value, field = tint === 'lipid' ? w.lipid : tint === 'food' ? w.food : null, cs = w.p.cell * s;
  if (w.p.lightPatches > 0) {
    // light patches: a pale wash over the lit cells
    w.lightMask(); ctx.fillStyle = 'rgba(255,240,190,0.10)';
    for (let c = 0; c < w.litMask.length; c++) if (w.litMask[c]) ctx.fillRect((c % w.gw) * cs, Math.floor(c / w.gw) * cs, cs, cs);
  }
  if (field) {
    const full = tint === 'food' ? 12 : 4;
    for (let c = 0; c < field.length; c++) {
      const v = field[c];
      if (v <= 0) continue;
      ctx.fillStyle = tint === 'food' ? `rgba(120,200,110,${Math.min(0.5, (0.5 * v) / full)})` : `rgba(150,130,255,${Math.min(0.55, (0.55 * v) / full)})`;
      ctx.fillRect((c % w.gw) * cs, Math.floor(c / w.gw) * cs, cs, cs);
    }
  }
  const mode = colorSel.value, groups = new Map<string, number[]>();
  for (let k = 0; k < w.n; k++) {
    const col = mode === 'founder' ? hue(w.founder[k] * 67 + 30) : geneColour(((mode === 'gene' ? w.gene[k] : w.mark[k]) >> 3) << 3);
    let g = groups.get(col);
    if (!g) groups.set(col, (g = []));
    g.push(k);
  }
  for (const [col, ks] of groups) {
    ctx.fillStyle = col;
    for (const k of ks) ctx.fillRect(w.px[k] * s - 1.5, w.py[k] * s - 1.5, 3, 3);
  }
  // threads: clear rings (never filled), coloured by the idle marker, gene 1
  if (w.p.thread) {
    ctx.lineWidth = 1.5;
    for (let k = 0; k < w.nt; k++) {
      ctx.strokeStyle = geneColour(((w.tgene[k * w.p.tG + 1]) >> 3) << 3);
      ctx.beginPath(); ctx.arc(w.tx[k] * s, w.ty[k] * s, 4, 0, 6.283185307179586); ctx.stroke();
    }
  }
  ctx.lineWidth = 2; ctx.lineJoin = 'round';
  if (w.p.wallGenes && mode !== 'founder') {
    // heredity is in the wall: draw each bond in the colour of its own byte
    ctx.lineWidth = 3;
    const bonds = new Map<string, number[]>();
    for (let i = 0; i < w.beadHi; i++) {
      if (!w.alive[i]) continue;
      const col = geneColour(((mode === 'gene' ? w.wgene[i] : w.wmark[i]) >> 3) << 3);
      let g = bonds.get(col);
      if (!g) bonds.set(col, (g = []));
      g.push(i);
    }
    for (const [col, is] of bonds) {
      ctx.strokeStyle = col; ctx.beginPath();
      for (const i of is) { const j = w.next[i]; ctx.moveTo(w.bx[i] * s, w.by[i] * s); ctx.lineTo(w.bx[j] * s, w.by[j] * s); }
      ctx.stroke();
    }
    return;
  }
  for (const [colour, lo, hi] of [['#b99cff', -9, -0.03], ['#f1f0ea', -0.03, 0.05], ['#ffa24a', 0.05, 9]] as const) {
    ctx.strokeStyle = colour; ctx.beginPath();
    for (let i = 0; i < w.beadHi; i++) {
      if (!w.alive[i]) continue;
      const st = w.blen[i] / w.p.l0 - 1;
      if (st < lo || st >= hi) continue;
      const j = w.next[i];
      ctx.moveTo(w.bx[i] * s, w.by[i] * s); ctx.lineTo(w.bx[j] * s, w.by[j] * s);
    }
    ctx.stroke();
  }
}

function refresh(): void {
  last = census(world);
  const liveCells = last.loops.filter((l) => l.solute >= 5).length;
  let g = 0, m = 0;
  let count = world.n;
  if (world.p.wallGenes) {
    // the heritable bytes are the wall's: average them over beads
    count = 0;
    for (let i = 0; i < world.beadHi; i++) if (world.alive[i]) { g += world.wgene[i]; m += world.wmark[i]; count++; }
  } else for (let k = 0; k < world.n; k++) { g += world.gene[k]; m += world.mark[k]; }
  const gene = count ? g / count : 0, mark = count ? m / count : 0;
  const set = (id: string, v: string | number) => { el(id).textContent = String(v); };
  set('r-t', world.step.toLocaleString()); set('r-live', liveCells); set('r-empty', last.loops.length - liveCells); set('r-solute', last.particles);
  set('r-beads', last.beads); set('r-lipid', last.freeLipid); set('r-pinch', world.events.pinch); set('r-dissolve', world.events.dissolve);
  set('r-burst', world.events.burst); set('r-gene', gene.toFixed(1)); set('r-mark', mark.toFixed(1)); set('r-matter', world.matter().toLocaleString());
  set('r-threads', world.nt); set('r-threads-out', last.freeThreads); set('r-tcopy', world.events.tcopy); set('r-tdecay', world.events.tdecay);
  history.push({ live: liveCells, gene, mark });
  if (history.length > 576) history.shift();
  const H = historyCanvas.height, W = historyCanvas.width;
  hctx.fillStyle = '#101b21'; hctx.fillRect(0, 0, W, H);
  const top = Math.max(8, ...history.map((h) => h.live));
  const line = (colour: string, f: (h: { live: number; gene: number; mark: number }) => number) => {
    hctx.strokeStyle = colour; hctx.lineWidth = 1.5; hctx.beginPath();
    history.forEach((h, i) => { const y = H - 4 - f(h) * (H - 8); if (i) hctx.lineTo(i, y); else hctx.moveTo(i, y); });
    hctx.stroke();
  };
  line('#9fe4c4', (h) => h.live / top); line('#f2be78', (h) => h.gene / 255); line('#b5adf2', (h) => h.mark / 255);
}

function say(text: string): void { live.textContent = text; }
function pause(text = 'Paused.'): void { paused = true; playBtn.textContent = 'Play'; say(text); }
function reset(): void {
  const seed = Number.parseInt(seedInput.value, 10);
  world = build(startSel.value, Number.isFinite(seed) ? seed : 1);
  canvas.height = Math.round((canvas.width * world.p.H) / world.p.W);
  history.length = 0;
  pause('Paused · new world'); refresh(); draw();
}

function loop(): void {
  if (!paused) {
    const n = Number(paceSel.value);
    for (let i = 0; i < n; i++) { world.tick(); weather.after(world, world.step); }
    if (++frame % 30 === 0) refresh();
    draw();
  }
  requestAnimationFrame(loop);
}

playBtn.addEventListener('click', () => { if (paused) { paused = false; playBtn.textContent = 'Pause'; say('Running.'); } else pause(); });
stepBtn.addEventListener('click', () => { pause('Paused · one step'); world.tick(); weather.after(world, world.step); refresh(); draw(); });
startSel.addEventListener('change', reset);
el<HTMLFormElement>('seed-form').addEventListener('submit', (e) => { e.preventDefault(); reset(); });
colorSel.addEventListener('change', draw); tintSel.addEventListener('change', draw);
canvas.addEventListener('pointerdown', (e) => {
  const r = canvas.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * world.p.W, y = ((e.clientY - r.top) / r.height) * world.p.H;
  const tool = (document.querySelector('input[name=tool]:checked') as HTMLInputElement).value;
  if (tool === 'lipid') { world.feed(world.lipid, x, y, 60); say('Dropped 60 lipid.'); }
  else if (tool === 'food') { world.feed(world.food, x, y, 200); say('Dropped 200 food.'); }
  else {
    const hit = census(world).loops.find((l) => { let c = false; for (let i = 0, j = l.xs.length - 1; i < l.xs.length; j = i++) if ((l.ys[i] > y) !== (l.ys[j] > y) && x < ((l.xs[j] - l.xs[i]) * (y - l.ys[i])) / (l.ys[j] - l.ys[i]) + l.xs[i]) c = !c; return c; });
    say(hit ? `Burst a cell: ${world.dissolveLoop(hit.first)} beads back to the water.` : 'No cell there.');
  }
  refresh(); draw();
});

refresh(); draw();
if (reduced) say('Paused (reduced motion is on). Press Play to run.');
requestAnimationFrame(loop);
