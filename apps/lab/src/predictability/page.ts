import evidence from '../../../../docs/predictability-atlas-2026-11-01/evidence.json';
import { baseFixtures } from '../../../../packages/metrics/src/predictability/fixtures.ts';
import { movieBytes, type Movie } from '../../../../packages/metrics/src/predictability/movie.ts';
import { ecologyClip } from '../../../../packages/metrics/src/predictability/ecology.ts';
import { LABEL_TEXT, drawFrame, esc, fmt, observerCell, pct, skillText, stripIndices, tableRows, type FixtureView } from './render.ts';
import './style.css';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fixtures = evidence.fixtures as unknown as (FixtureView & { sha256: string; w: number; h: number })[];
const labels = evidence.labels as Record<string, { label: string }>;
const res = el<HTMLSelectElement>('res'), hor = el<HTMLSelectElement>('hor'), pred = el<HTMLSelectElement>('pred');
const toggle = el<HTMLButtonElement>('toggle'), status = el<HTMLElement>('status'), cards = el('cards');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let movies: Movie[] = [];
let playing = !reduced.matches;
const scratch = document.createElement('canvas');
const canvases = new Map<string, HTMLCanvasElement[]>();

async function digest(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('crypto.subtle is unavailable (insecure context)');
  const d = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function observer() { return { r: Number(res.value), h: Number(hor.value), p: pred.value }; }

function buildCards() {
  cards.innerHTML = fixtures.map((f) => {
    const lab = labels[f.id].label;
    const strip = reduced.matches ? 6 : 1;
    return `<article class="card" id="card-${esc(f.id)}" aria-labelledby="t-${esc(f.id)}">
      <h3 id="t-${esc(f.id)}">${esc(f.id)}</h3>
      <p class="prov">Built as: ${esc(f.family)}, ${f.q} values per cell</p>
      <div class="frames">${Array.from({ length: strip }, (_, i) => `<canvas width="128" height="128" data-id="${esc(f.id)}" data-i="${i}" role="img" aria-label="${esc(f.id)} movie${strip > 1 ? `, frame ${i + 1} of ${strip}` : ''}"></canvas>`).join('')}</div>
      <p class="metric" data-metric="${esc(f.id)}"></p>
      <p class="label"><strong>Predictors did:</strong> ${esc(lab)} <span>(${esc(LABEL_TEXT[lab] ?? '')}, finest view, next frame)</span></p>
    </article>`;
  }).join('');
  for (const c of cards.querySelectorAll<HTMLCanvasElement>('canvas')) {
    const id = c.dataset.id!;
    canvases.set(id, [...(canvases.get(id) ?? []), c]);
  }
}

function updateMetrics() {
  const { r, h, p } = observer();
  for (const f of fixtures) {
    const { cell, erased } = observerCell(f, r, h, p);
    el(`card-${f.id}`).querySelector('[data-metric]')!.textContent = `${fmt(cell.errors)} errors in ${fmt(cell.cells)} cells (${pct(cell.errors, cell.cells)}); skill ${erased ? '– (erased at this view)' : skillText(cell.skillVsBest)}`;
  }
  const head = el('table').querySelector('thead')!;
  head.innerHTML = '<tr><th scope="col">Movie</th><th scope="col">Built as</th><th scope="col">Values</th><th scope="col">Errors</th><th scope="col">Cells scored</th><th scope="col">Error rate</th><th scope="col">Skill</th></tr>';
  el('table').querySelector('tbody')!.innerHTML = tableRows(fixtures, r, h, p).map((row) => `<tr><th scope="row">${esc(row.id)}</th><td>${esc(row.family)}</td><td>${row.alphabet}</td><td>${row.errors}</td><td>${row.cells}</td><td>${row.rate}</td><td>${row.skill}</td></tr>`).join('');
}

function paint(tick: number) {
  for (const m of movies) {
    const list = canvases.get(m.id) ?? [];
    list.forEach((c, i) => {
      const k = list.length > 1 ? stripIndices(m.frames.length, list.length)[i] : tick % m.frames.length;
      drawFrame(c, m.frames[k], m.w, m.h, m.q, scratch);
    });
  }
}

let tick = 0, last = 0;
function loop(now: number) {
  if (playing && now - last > 120) { last = now; tick++; paint(tick); }
  requestAnimationFrame(loop);
}

toggle.addEventListener('click', () => {
  playing = !playing;
  toggle.setAttribute('aria-pressed', String(!playing));
  toggle.textContent = playing ? 'Pause movies' : 'Play movies';
});
for (const s of [res, hor, pred]) s.addEventListener('change', updateMetrics);

buildCards();
updateMetrics();
toggle.hidden = reduced.matches;
requestAnimationFrame(() => {
  const base = baseFixtures().movies;
  movies = [...base, ecologyClip()];
  paint(0);
  Promise.all(movies.map(async (m) => (await digest(movieBytes(m))) === fixtures.find((f) => f.id === m.id)!.sha256)).then((ok) => {
    status.textContent = ok.every(Boolean)
      ? 'Movies regenerated in this browser match the saved evidence file byte for byte. Numbers come from that file.'
      : 'Warning: a movie regenerated here differs from the saved evidence. The numbers shown may not describe these pictures.';
  }, () => {
    status.textContent = 'Integrity check unavailable: this browser context has no SubtleCrypto (it needs https or localhost). The movies are shown, but they are not checked against the saved evidence.';
  });
  requestAnimationFrame(loop);
});
