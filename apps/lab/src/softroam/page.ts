/** The local /softroam/ page: a canvas, a few choices, and readouts. The world steps in a worker. */

import { SoftRoamPacer } from './pacer.ts';
import type { SoftPaint, SoftRoamFrame, SoftRoamFromWorker, SoftRoamStart, SoftRoamToWorker } from './view.ts';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const set = (id: string, text: string) => { el(id).textContent = text; };
const fmt = (x: number) => Math.round(x).toLocaleString('en-US');
const value = (id: string) => el<HTMLSelectElement | HTMLInputElement>(id).value;

const canvas = el<HTMLCanvasElement>('view');
const ctx = canvas.getContext('2d')!;
const SIZE = 128;
const SCALE = 6; // 128 tiles x 6 = 768 px

let worker: Worker | null = null;
let gen = 0;
const pacer = new SoftRoamPacer(performance.now());
let lastFrameTime = performance.now();

const paintChoice = (): SoftPaint => (value('paint') === 'plain' ? 'plain' : 'garden');
const pace = (): number => Number(value('pace'));

function post(m: SoftRoamToWorker, transfer: Transferable[] = []): void {
  worker!.postMessage(m, transfer);
}

/** The world could not be made or stepped: say so, and let Play start again. */
function fail(message: string): void {
  set('error', `${message} (press Play to start again)`);
  pacer.onFailure();
  el('play').textContent = 'Play';
  el<HTMLButtonElement>('step').disabled = true;
}

function reset(): void {
  worker?.terminate();
  gen++;
  const mine = gen;
  worker = new Worker(new URL('./softroam.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<SoftRoamFromWorker>) => {
    const m = event.data;
    if (m.gen !== mine) return; // a frame from a world that has been replaced
    if (m.type === 'error') { fail(m.message); return; }
    show(m.frame);
  };
  // A module that fails to load, or a crash outside a request, would otherwise leave the request pending for ever.
  worker.onerror = (event) => { if (mine === gen) fail(event.message || 'The world could not be started'); };
  worker.onmessageerror = () => { if (mine === gen) fail('The worker sent something unreadable'); };
  pacer.reset(performance.now());
  set('r-rate', '0');
  set('error', '');
  const seed = Math.min(0xffffffff, Math.max(0, Math.floor(Number(value('seed')) || 0)));
  post({ type: 'reset', gen: mine, opts: { seed, size: SIZE, start: value('start') as SoftRoamStart }, scale: SCALE, paint: paintChoice() });
}

function show(f: SoftRoamFrame): void {
  if (canvas.width !== f.side) { canvas.width = f.side; canvas.height = f.side; }
  ctx.putImageData(new ImageData(f.pixels as Uint8ClampedArray<ArrayBuffer>, f.side, f.side), 0, 0);
  // The canvas has its own copy now: give the pixels back to the worker to paint into again.
  const buffer = f.pixels.buffer as ArrayBuffer;
  post({ type: 'recycle', gen, buffer }, [buffer]);
  pacer.onFrame(f.step, performance.now());
  const c = f.census;
  set('r-step', fmt(c.step));
  set('r-rate', fmt(pacer.rate));
  set('r-bodies', fmt(c.bodies));
  set('r-cells', `${fmt(c.cells)} (${fmt(c.singles)} of them single)`);
  set('r-largest', `${fmt(c.largest)} cells`);
  set('r-food', `${fmt(c.food)} on the ground, ${fmt(c.reservoir)} waiting to drop as a new patch`);
  set('r-res', c.residual === 0 ? 'balanced (0 missing)' : `NOT balanced: ${c.residual} missing`);
}

function loop(): void {
  const now = performance.now();
  const dt = Math.min(250, now - lastFrameTime);
  lastFrameTime = now;
  if (worker) {
    const a = pacer.tick(dt, pace());
    if (a?.kind === 'advance') post({ type: 'advance', gen, steps: a.steps, alpha: a.alpha, paint: paintChoice() });
    else if (a?.kind === 'paint') post({ type: 'paint', gen, alpha: a.alpha, paint: paintChoice() });
  }
  requestAnimationFrame(loop);
}

el('play').addEventListener('click', () => {
  const again = pacer.toggle();
  el('play').textContent = pacer.playing ? 'Pause' : 'Play';
  el<HTMLButtonElement>('step').disabled = pacer.playing;
  if (again) reset();
});
el('step').addEventListener('click', () => { pacer.stepOnce(); });
el('reset').addEventListener('click', () => { if (pacer.failed) pacer.toggle(); el('play').textContent = pacer.playing ? 'Pause' : 'Play'; el<HTMLButtonElement>('step').disabled = pacer.playing; reset(); });
el('paint').addEventListener('change', () => { pacer.wantRepaint(); });
el('seed').addEventListener('change', reset);
el('start').addEventListener('change', reset);
el<HTMLButtonElement>('step').disabled = pacer.playing;

reset();
requestAnimationFrame(loop);
