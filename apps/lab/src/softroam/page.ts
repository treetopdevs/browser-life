/** The local /softroam/ page: a canvas, a few choices, and readouts. The world steps in a worker. */

import { SoftRoamPacer } from './pacer.ts';
import { CHANGE_IDS, checkDials, defFor, dialDefaults, dialMoved, dialOptions, fixDial, linkSwitches, SOFT_DIALS, startDials, startNote, startPick, SWITCH_IDS, type DialValues, type SoftSwitches } from './dials.ts';
import { softTimeWords as timeWords, type SoftPaint, type SoftRoamFrame, type SoftRoamFromWorker, type SoftRoamStart, type SoftRoamToWorker } from './view.ts';

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

// Dials: a slider and an exact number box each, with a line saying what the value means. Values live here; the URL
// hash keeps the ones that differ from the defaults (and the switches), so a link brings the same world back.
const dials: DialValues = dialDefaults('bodies');

function switches(): SoftSwitches {
  return {
    seed: Math.min(0xffffffff, Math.max(0, Math.floor(Number(value('seed')) || 0))),
    size: SIZE,
    start: value('start') as SoftRoamStart,
    kinds: value('kinds') === '1',
    toughness: value('toughness') === '1',
  };
}

function buildDials(): void {
  const box = el('dials');
  let group = '';
  for (const d of SOFT_DIALS) {
    if (d.group !== group) {
      group = d.group;
      const h = document.createElement('h3');
      h.textContent = group;
      box.append(h);
    }
    const row = document.createElement('div');
    row.className = 'dial';
    row.id = `dial-${d.id}`;
    row.innerHTML = `<span>${d.label}</span><input type="range" min="${d.min}" max="${d.max}" step="${d.step}" aria-label="${d.label}" /><input type="number" min="${d.min}" max="${d.max}" step="any" aria-label="${d.label}, exact" /><small></small>`;
    const [range, num] = row.querySelectorAll('input');
    // An exact value off the slider's grid (a day of 16 on a slider in tens) is shown as it is (step "any"); touching the
    // slider puts it back on its grid.
    // Only a key that moves the slider, or a primary press on it, restores the grid (Tab or a right click would snap it silently).
    // Restoring may snap the value to the grid with no input event: then the dial takes the snapped value, so the box, the
    // slider and the world always agree.
    const MOVE_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'];
    const onGrid = (): void => {
      if (range.step === String(d.step)) return;
      range.step = String(d.step);
      const v = fixDial(d, Number(range.value));
      // The box is written too: it may still hold focus, and showDials leaves a focused box alone.
      if (v !== dials[d.id]) { dials[d.id] = v; num.value = String(v); changed(); }
    };
    range.addEventListener('pointerdown', (e) => { if (e.button === 0) onGrid(); });
    range.addEventListener('keydown', (e) => { if (MOVE_KEYS.includes(e.key)) onGrid(); });
    range.addEventListener('input', () => { dials[d.id] = fixDial(d, Number(range.value)); showDials(); });
    range.addEventListener('change', () => { dials[d.id] = fixDial(d, Number(range.value)); changed(); });
    num.addEventListener('change', () => {
      // A number the dial could not take as typed is moved to the nearest one it can, and the visitor is told.
      const moved = dialMoved(d, num.value, dials[d.id]);
      if (num.value.trim() !== '') dials[d.id] = fixDial(d, Number(num.value));
      num.value = String(dials[d.id]);
      changed();
      if (moved !== null) set('dials-note', moved);
    });
    box.append(row);
  }
}

function showDials(): void {
  const sw = switches();
  for (const d of SOFT_DIALS) {
    const row = el(`dial-${d.id}`);
    const [range, num] = row.querySelectorAll('input');
    const v = dials[d.id];
    const k = (v - d.min) / d.step;
    range.step = Math.abs(k - Math.round(k)) < 1e-9 ? String(d.step) : 'any';
    range.value = String(v);
    if (document.activeElement !== num) num.value = String(v);
    const idle = d.idle?.(dials, sw) ?? null;
    row.classList.toggle('off', idle !== null);
    row.classList.toggle('changed', v !== defFor(d, sw.start));
    row.querySelector('small')!.textContent = idle ? `${d.say(v, dials)} (off: ${idle})` : d.say(v, dials);
  }
}

/** Write the settings into the address, but only when the kernel accepts them: the address always names the world that is running. */
function saveHash(): void {
  if (checkDials(switches(), dials) !== null) return;
  const q = new URLSearchParams();
  for (const id of SWITCH_IDS) q.set(id, value(id));
  // Dials that differ from what the chosen start sets: the start itself is in the link, so a dial left as the start made it is not.
  const start = value('start') as SoftRoamStart;
  for (const d of SOFT_DIALS) if (dials[d.id] !== defFor(d, start)) q.set(d.id, String(dials[d.id]));
  history.replaceState(null, '', `#${q}`);
}

/** What a switch holds when the page is first opened (the markup's own default). */
function switchDefault(id: string): string {
  const input = el<HTMLSelectElement | HTMLInputElement>(id);
  if (input instanceof HTMLSelectElement) return (input.options[[...input.options].findIndex((o) => o.defaultSelected)] ?? input.options[0]).value;
  return input.defaultValue;
}

function loadHash(): void {
  const defaults = Object.fromEntries(SWITCH_IDS.map((id) => [id, switchDefault(id)]));
  const allowed = (id: string, v: string): boolean => {
    const input = el<HTMLSelectElement | HTMLInputElement>(id);
    return !(input instanceof HTMLSelectElement) || [...input.options].some((o) => o.value === v);
  };
  const got = linkSwitches(location.hash, defaults, allowed);
  for (const id of SWITCH_IDS) el<HTMLSelectElement | HTMLInputElement>(id).value = got[id];
  const start = got.start as SoftRoamStart;
  const q = new URLSearchParams(location.hash.slice(1));
  Object.assign(dials, dialDefaults(start));
  for (const d of SOFT_DIALS) {
    const raw = q.get(d.id);
    // An empty or malformed value keeps the chosen start's own setting.
    if (raw !== null && raw.trim() !== '' && Number.isFinite(Number(raw))) dials[d.id] = fixDial(d, Number(raw));
  }
}

function changed(): void {
  set('dials-note', '');
  showDials();
  saveHash();
  reset();
}

function reset(): void {
  // An impossible combination (the kernel refuses it) says why and leaves the world that is running.
  const why = checkDials(switches(), dials);
  if (why !== null) { set('error', why); return; }
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
  // A failure disabled One step; a new world that is paused can be stepped again at once.
  el('play').textContent = pacer.playing ? 'Pause' : 'Play';
  el<HTMLButtonElement>('step').disabled = pacer.playing;
  set('r-rate', '0');
  set('error', '');
  post({ type: 'reset', gen: mine, opts: dialOptions(switches(), dials), scale: SCALE, paint: paintChoice() });
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
  set('r-food', `${fmt(c.food)} on the ground, ${fmt(c.reservoir)} waiting to drop as a new patch${c.leafPool > 0 ? `, ${fmt(c.leafPool)} kept for leaves` : ''}`);
  set('r-time', timeWords(f));
  const plain = c.cells - c.shells - c.mouths - c.leaves;
  set('r-kinds', `${fmt(plain)} plain, ${fmt(c.shells)} shell, ${fmt(c.mouths)} mouth, ${fmt(c.leaves)} leaf`);
  set('r-chase', f.sky.day === 0 && c.hunting + c.fleeing === 0 ? 'none' : `${fmt(c.hunting)} ${c.steering > 0 ? 'cells' : 'mouths'} hunting ${fmt(c.targets)} prey cells, ${fmt(c.fleeing)} cells fleeing${c.steering > 0 ? `; ${fmt(c.steering)} bodies turning as one` : ''}`);
  set('r-light', f.sky.day === 0 ? 'full everywhere' : `${fmt(f.sky.meanLight * 100)}% of full across the arena`);
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
for (const id of CHANGE_IDS) el(id).addEventListener('change', changed);
// Picking a start also sets the kinds switch to what that start is: the garden has kinds on, every other start is the plain grown
// line-up (kinds off). The switch can still be turned the other way afterwards.
// It also sets the dials the start defines (the sun, senses and manners, and the big bodies' rules) to that start's values: the garden has them off, the seasons the sun ones, the big bodies all of them.
el('start').addEventListener('change', () => {
  const start = value('start') as SoftRoamStart;
  el<HTMLSelectElement>('kinds').value = startPick(switches(), start).kinds ? '1' : '0';
  const before = { ...dials };
  Object.assign(dials, startDials(start));
  changed();
  set('dials-note', startNote(before, start));
});
// A settings link opened in this tab: take its settings (replaceState in saveHash does not fire this).
window.addEventListener('hashchange', () => { loadHash(); showDials(); reset(); });
el('dials-reset').addEventListener('click', () => { Object.assign(dials, dialDefaults(value('start') as SoftRoamStart)); changed(); });
el('dials-link').addEventListener('click', () => {
  // Refused settings make no world, and the address may hold them (a link typed or opened by hand): hand out no link to a refusal.
  if (checkDials(switches(), dials) !== null) { set('dials-note', 'these settings are refused, so there is no link to copy: move a dial back first'); return; }
  saveHash();
  navigator.clipboard?.writeText(location.href).then(() => set('dials-note', 'link copied'), () => set('dials-note', 'copy the address bar'));
});
el<HTMLButtonElement>('step').disabled = pacer.playing;

loadHash();
buildDials();
showDials();
reset();
requestAnimationFrame(loop);
