import evidence from '../../../../docs/niche-construction-2026-11-01/evidence.json';
import { armsHtml, candidateOptions, contrastsHtml, costHtml, devRowsHtml, edgeHtml, esc, fixturesHtml, fluxText, guardsText, ledgerHtml, ledgerNote, verdictHtml, wallHtml, type EvidenceView } from './render.ts';
import { doseLadderHtml, edgeFeHtml, farFieldHtml, firstFreeBlock, freeEnergyHtml, limitsFeHtml, noiseEffectHtml, pendingHtml, qualificationHtml, verdictFeHtml, type EvidenceFeView } from './fe.ts';
import './style.css';

// The second-rung evidence may not exist yet (it is written once, after the freeze), so it is found with a glob, not imported.
const feFound = import.meta.glob('../../../../docs/niche-construction-fe-2026-11-02/evidence.json', { eager: true, import: 'default' });
const fe = Object.values(feFound)[0] as EvidenceFeView | undefined;

function initSecondRung() {
  if (!fe) { el('r2-verdict').innerHTML = pendingHtml(); return; }
  const { rows, seed } = firstFreeBlock(fe);
  el('r2-verdict').innerHTML = verdictFeHtml(fe);
  el('r2-edges').innerHTML = edgeFeHtml(fe);
  el('r2-free').innerHTML = freeEnergyHtml(rows, seed);
  el('r2-noise').innerHTML = noiseEffectHtml(fe);
  el('r2-ladder').innerHTML = doseLadderHtml(fe);
  el('r2-qual').innerHTML = qualificationHtml(fe);
  el('r2-far').innerHTML = farFieldHtml(fe);
  el('r2-limits').innerHTML = limitsFeHtml(fe);
}

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
  initSecondRung();
}
init();
