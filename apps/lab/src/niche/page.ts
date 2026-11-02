import evidence from '../../../../docs/niche-construction-2026-11-01/evidence.json';
import { armsHtml, candidateOptions, contrastsHtml, costHtml, devRowsHtml, edgeHtml, esc, fixturesHtml, fluxText, guardsText, ledgerHtml, ledgerNote, verdictHtml, wallHtml, type EvidenceView } from './render.ts';
import './style.css';

const ev = evidence as unknown as EvidenceView;
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const sel = el<HTMLSelectElement>('cand');

function render() {
  const cluster = sel.value === '' ? undefined : Number(sel.value);
  const c = ev.fresh.candidates.find((x) => x.cluster === cluster);
  const r = ev.fresh.results.find((x) => x.id === `cluster-${cluster}`);
  el('edge').innerHTML = edgeHtml(ev, cluster);
  el('arms').innerHTML = armsHtml(c);
  el('contrasts').innerHTML = contrastsHtml(r);
  el('ledger').innerHTML = ledgerHtml(c);
  el('ledger-note').textContent = ledgerNote(ev, c);
  el('cost').innerHTML = costHtml(c);
  el('flux').textContent = fluxText(c);
}

function init() {
  sel.innerHTML = candidateOptions(ev);
  sel.disabled = ev.fresh.candidates.length === 0;
  sel.addEventListener('change', render);
  el('limits').innerHTML = ev.limits.map((l) => `<li>${esc(l)}</li>`).join('');
  el('verdict').insertAdjacentHTML('beforeend', verdictHtml(ev));
  el('fixtures').innerHTML = fixturesHtml(ev);
  el('guards').textContent = guardsText(ev);
  el('wall').innerHTML = wallHtml(ev);
  el('devrows').innerHTML = devRowsHtml(ev);
  render();
}
init();
