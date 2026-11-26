import './style.css';
import { BodiesWorld, FOUNDER_GENOME, RULES, census, soloWorld } from './model.ts';
import type { WorldOptions } from './model.ts';
import type { Census } from './model.ts';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = el<HTMLCanvasElement>('world'), historyCanvas = el<HTMLCanvasElement>('history');
const ctx = canvas.getContext('2d')!, hctx = historyCanvas.getContext('2d')!;
const SCALE = 6, { W, H, N } = RULES;
const img = ctx.createImageData(W, H);
const playBtn = el<HTMLButtonElement>('play'), stepBtn = el<HTMLButtonElement>('step'), paceSel = el<HTMLSelectElement>('pace');
const mutBox = el<HTMLInputElement>('mutation'), upkeepBox = el<HTMLInputElement>('upkeep'), colorSel = el<HTMLSelectElement>('color');
const seedInput = el<HTMLInputElement>('seed'), live = el<HTMLElement>('live');
const neutralBox = el<HTMLInputElement>('neutral'), rulesSel = el<HTMLSelectElement>('rules');
const version = (): 1 | 2 => (rulesSel.value === '1' ? 1 : 2);

let world: BodiesWorld = newWorld(1);
let paused = true, last: Census = census(world), frame = 0;
let cursor = { x: 48, y: 48 };
const history: { cells: number; comps: number; interior: number }[] = [];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

function newWorld(seed: number, extra: Partial<WorldOptions> = {}): BodiesWorld { return new BodiesWorld({ seed, founders: 3, genome: FOUNDER_GENOME, mutRate: neutralBox.checked ? RULES.MUT : 0, version: version(), blind: neutralBox.checked, ...extra }); }
function install(w: BodiesWorld): void {
  world = w; history.length = 0; mutBox.checked = w.mutRate > 0; upkeepBox.checked = w.upkeep; neutralBox.checked = w.blind;
  pause('Paused · reset'); refresh(); draw();
}
function hsl(tag: number): [number, number, number] {
  if (tag === 0) return [132, 176, 150];
  const h = (tag * 137) % 360, s = 0.55, l = 0.62; const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
function draw(): void {
  const mode = colorSel.value, px = img.data;
  for (let i = 0; i < N; i++) {
    let r = 16, g = 27, b = 33;
    if (mode === 'food') { const f = world.food[i]; r = 16 + (f >> 2); g = 27 + f; b = 33 + (f >> 1); }
    if (world.cell[i]) {
      if (mode === 'roots') { const root = world.d[i] === 0; [r, g, b] = root ? [255, 255, 255] : [70, 100, 90]; }
      else if (mode === 'd') { const v = Math.max(40, 245 - world.d[i] * 6); [r, g, b] = world.d[i] === 0 ? [255, 90, 80] : [v, v, v]; }
      else [r, g, b] = world.d[i] === 0 && mode === 'lineage' ? [255, 255, 255] : hsl(world.tag[i]);
    }
    px[i * 4] = r; px[i * 4 + 1] = g; px[i * 4 + 2] = b; px[i * 4 + 3] = 255;
  }
  const off = new OffscreenCanvas(W, H); off.getContext('2d')!.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(off, 0, 0, W * SCALE, H * SCALE);
  if (document.activeElement === canvas) { ctx.strokeStyle = '#f2be78'; ctx.lineWidth = 2; ctx.strokeRect(cursor.x * SCALE, cursor.y * SCALE, SCALE, SCALE); }
}
function drawHistory(): void {
  const w = historyCanvas.width, h = historyCanvas.height; hctx.clearRect(0, 0, w, h);
  const n = history.length; if (n < 2) return;
  const series: [string, (s: typeof history[number]) => number][] = [['#9fe4c4', (s) => s.cells / 5000], ['#f2be78', (s) => s.comps / 300], ['#b5adf2', (s) => s.interior / 1000]];
  for (const [color, f] of series) {
    hctx.strokeStyle = color; hctx.lineWidth = 1.5; hctx.beginPath();
    history.forEach((s, k) => { const x = (k / Math.max(1, n - 1)) * (w - 2) + 1, y = h - 4 - Math.min(1, f(s)) * (h - 8); k ? hctx.lineTo(x, y) : hctx.moveTo(x, y); });
    hctx.stroke();
  }
}
const set = (id: string, v: string | number) => { el(id).textContent = String(v); };
const pm = (v: number) => `${(v / 10).toFixed(1)}%`;
function refresh(): void {
  last = census(world);
  set('r-t', world.t); set('r-cells', last.cells); set('r-comps', last.comps); set('r-share', pm(last.largestSharePermille)); set('r-interior', pm(last.interiorPermille));
  set('r-cover', pm(last.coveragePermille)); set('r-var', last.genomeVariants); set('r-mut', world.mutations); set('r-roots', last.roots); set('r-dom', `${last.domains.n} (median ${last.domains.q[1]})`); set('r-res', world.residual());
  live.textContent = `${paused ? 'Paused' : 'Running'} at step ${world.t}: ${last.cells} cells in ${last.comps} components, ${last.genomeVariants} genome variants, ledger residual ${world.residual()}.`;
}
function pause(msg: string): void { paused = true; playBtn.textContent = 'Play'; live.textContent = msg; }
function advance(n: number): void {
  const before = Math.floor(world.t / 50); world.step(n);
  if (Math.floor(world.t / 50) !== before || history.length === 0) { const c = census(world); history.push({ cells: c.cells, comps: c.comps, interior: c.interiorPermille }); if (history.length > 400) history.shift(); drawHistory(); }
}
function loop(): void {
  if (!paused && !document.hidden) { advance(Number(paceSel.value)); if (++frame % 6 === 0) refresh(); draw(); }
  requestAnimationFrame(loop);
}
function wound(x: number, y: number): void {
  const r = Number((document.querySelector<HTMLInputElement>('input[name=wound]:checked')!).value);
  const k = world.injure(x, y, r); refresh(); draw(); live.textContent = `Wounded ${k} cells at ${x},${y}. ` + live.textContent;
}
canvas.addEventListener('click', (e) => {
  const b = canvas.getBoundingClientRect();
  const x = Math.min(W - 1, Math.max(0, Math.floor(((e.clientX - b.left) / b.width) * W))), y = Math.min(H - 1, Math.max(0, Math.floor(((e.clientY - b.top) / b.height) * H)));
  cursor = { x, y }; wound(x, y);
});
canvas.addEventListener('keydown', (e) => {
  const m: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (m[e.key]) { e.preventDefault(); cursor = { x: (cursor.x + m[e.key][0] + W) % W, y: (cursor.y + m[e.key][1] + H) % H }; draw(); }
  else if (e.key === 'Enter') { e.preventDefault(); wound(cursor.x, cursor.y); }
});
canvas.addEventListener('focus', draw); canvas.addEventListener('blur', draw);
playBtn.addEventListener('click', () => { paused = !paused; playBtn.textContent = paused ? 'Play' : 'Pause'; refresh(); });
stepBtn.addEventListener('click', () => { pause('Paused'); advance(1); refresh(); draw(); });
mutBox.addEventListener('change', () => { world.setMutation(mutBox.checked); });
neutralBox.addEventListener('change', () => { world.blind = neutralBox.checked; if (neutralBox.checked && !mutBox.checked) { mutBox.checked = true; world.setMutation(true); } });
rulesSel.addEventListener('change', () => install(newWorld(Number(seedInput.value) | 0)));
upkeepBox.addEventListener('change', () => { world.setUpkeep(upkeepBox.checked); });
colorSel.addEventListener('change', draw);
el<HTMLFormElement>('seed-form').addEventListener('submit', (e) => { e.preventDefault(); const s = Number(seedInput.value); install(newWorld(Number.isFinite(s) ? Math.trunc(s) : 1)); });
// v2: one founder alone with upkeep ON (scarcity); v1: the original fed world (upkeep off), where a lone body cannot live.
el<HTMLButtonElement>('alone').addEventListener('click', () => install(soloWorld(FOUNDER_GENOME, Number(seedInput.value) | 0, { version: version(), upkeep: version() === 2, blind: neutralBox.checked, mutRate: neutralBox.checked ? RULES.MUT : 0 })));
document.addEventListener('visibilitychange', () => { if (document.hidden && !paused) pause('Paused while away'); });
if (reduced) pause('Paused · reduced motion');
refresh(); draw(); requestAnimationFrame(loop);
