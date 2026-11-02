import evidence from '../../../../docs/assembly-observer-2026-11-02/evidence.json';
import gap from '../../../../docs/assembly-observer-2026-11-02/amendment-1-exact12.json';
import { COLUMNS, MOVIE_COLUMNS, drawPatch, esc, frameFromCells, gapText, movieRow, ratText, tableRow, verdictRows, type ClassView, type GapView, type MovieView, type VerdictView } from './render.ts';
import './style.css';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const classes = evidence.calibration as unknown as ClassView[];
const verdicts = evidence.verdicts as unknown as Record<string, VerdictView>;
const status = el('status'), cards = el('cards');
const scratch = document.createElement('canvas');

async function digest(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('crypto.subtle is unavailable (insecure context)');
  const d = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

cards.innerHTML = classes.map((c) => {
  const p = c.replicates[0].primary;
  return `<article class="card" id="card-${esc(c.id)}" aria-labelledby="t-${esc(c.id)}">
    <h3 id="t-${esc(c.id)}">${esc(c.id)}${c.matched ? ' <span class="tag">matched pair</span>' : ''}</h3>
    <p class="prov">${esc(c.role)}</p>
    <canvas width="256" height="256" data-id="${esc(c.id)}" role="img" aria-label="${esc(c.id)}, replicate 0 of 16: occupied cells on a 64 by 64 torus"></canvas>
    <dl class="readouts">
      <dt>Shared bound (cost)</dt><dd>${p.construction.sharedBound ?? '–'}</dd>
      <dt>Reuse ratio (cost)</dt><dd>${ratText(p.construction.reuseRatio)}</dd>
      <dt>Mean a per object</dt><dd>${ratText(p.construction.meanA)}</dd>
      <dt>Max copies</dt><dd>${p.copies.T.maxCopies}</dd>
      <dt>Copy-weighted a</dt><dd>${p.copies.T.copyWeightedConstruction}</dd>
      <dt>Class count T / D4 / D4 on 8-conn</dt><dd>${p.equiv.classesT} / ${p.equiv.classesD4} / ${p.equiv.classesD4on8}</dd>
      <dt>Occupied / deflate bytes</dt><dd>${p.baselines.occupied} / ${p.baselines.deflate}</dd>
    </dl>
  </article>`;
}).join('');

el('table').querySelector('thead')!.innerHTML = `<tr>${COLUMNS.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr>`;
el('table').querySelector('tbody')!.innerHTML = classes.map((c) => { const [id, ...rest] = tableRow(c); return `<tr><th scope="row">${esc(id)}</th>${rest.map((x) => `<td>${esc(x)}</td>`).join('')}</tr>`; }).join('');
el('vtable').querySelector('tbody')!.innerHTML = verdictRows(verdicts).map((r) => `<tr><th scope="row">${esc(r.name)}</th><td>${esc(r.direction)}</td><td>${esc(r.accuracy)}</td><td>${esc(r.cells)}</td><td>${esc(r.sentence)}</td></tr>`).join('');

// Movies and clips: persistence and segmentation/temporal sampling, read apart from the construction readouts.
const movies = [...evidence.fixtures, ...evidence.clips] as unknown as MovieView[];
el('mtable').querySelector('thead')!.innerHTML = `<tr>${MOVIE_COLUMNS.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr>`;
el('mtable').querySelector('tbody')!.innerHTML = movies.map((m) => { const [id, ...rest] = movieRow(m); return `<tr><th scope="row">${esc(id)}</th>${rest.map((x) => `<td>${esc(x)}</td>`).join('')}</tr>`; }).join('');
el('gap').textContent = gapText(gap as unknown as GapView);

// Draw replicate 0 of every class from its saved cells (no regeneration on this thread), then check each picture against
// the saved hash. Drawing never depends on the check: without SubtleCrypto every patch is still shown.
let ok = true, unchecked = false;
const run = async () => {
  for (const c of classes) {
    const canvas = cards.querySelector<HTMLCanvasElement>(`canvas[data-id="${c.id}"]`)!;
    const frame = frameFromCells(c.replicates[0].cells ?? [], 64 * 64);
    drawPatch(canvas, frame, 64, 64, scratch);
    if (!unchecked) {
      try {
        const head = new TextEncoder().encode(`${c.id}|r0|64x64|`);
        const bytes = new Uint8Array(head.length + frame.length); bytes.set(head); bytes.set(frame, head.length);
        if ((await digest(bytes)) !== c.replicates[0].sha256) ok = false;
      } catch { unchecked = true; }
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  status.textContent = unchecked
    ? 'All patches are drawn from the saved cells. The hash check is unavailable: this browser context has no SubtleCrypto (it needs https or localhost), so the pictures are not checked against the saved evidence.'
    : ok
      ? 'Patches are drawn from the saved cells and each matches its saved hash. Regeneration from the generator is checked by the replay check, not here. Numbers come from the evidence file.'
      : 'Warning: a patch drawn from the saved cells does not match its saved hash. The numbers shown may not describe these pictures.';
};
setTimeout(run, 0);
