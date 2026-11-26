import evidence from '../../../../docs/moving-light-2026-11-02/evidence.json';
import { BLIND, SCHEDULE_TEXT, labelOf, blindedOrder, contrastsHtml, coordFixturesHtml, criteriaHtml, esc, listHtml, panelHtml, physFixturesHtml, stripSvg, verdictHtml, type EvidenceView } from './render.ts';
import './style.css';

const ev = evidence as unknown as EvidenceView;
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const sel = el<HTMLSelectElement>('schedule');
const reveal = el<HTMLButtonElement>('reveal');
const scrub = el<HTMLInputElement>('scrub');
let revealed = false;

function drawStrips() {
  const cursor = Number(scrub.value);
  for (const s of blindedOrder()) {
    const svg = document.getElementById(`strip-${BLIND[s]}`);
    if (svg) {
      svg.innerHTML = stripSvg(ev, sel.value, s, cursor);
      const at = (pl: string) => {
        const r = ev.fresh.blocks[0]?.strip?.[`${sel.value}/${s}/${pl}`];
        if (!r || !r.t.length) return 'no value';
        const i = Math.min(cursor, r.t.length - 1);
        return `${(r.d1000[i] / 1000).toFixed(1)} cells`;
      };
      svg.setAttribute('aria-label', `${labelOf(s, revealed)}: signed offset of the bodies from the sun at the cursor, grouped ${at('grouped')}, dispersed ${at('dispersed')}`);
    }
  }
  const t = ev.fresh.blocks[0]?.strip?.[`${sel.value}/sense/grouped`]?.t ?? [];
  el('scrub-out').textContent = t.length ? `step ${t[Math.min(cursor, t.length - 1)]} of ${t[t.length - 1]}` : 'no strip stored';
}

function render() {
  const sc = sel.value;
  el('schedule-what').textContent = SCHEDULE_TEXT[sc]?.what ?? '';
  el('panels').innerHTML = blindedOrder().map((s) => panelHtml(ev.fresh.blocks, sc, s, revealed)).join('');
  el('contrasts').innerHTML = contrastsHtml(ev, sc, revealed);
  el('criteria').innerHTML = criteriaHtml(ev, sc);
  const t = ev.fresh.blocks[0]?.strip?.[`${sc}/sense/grouped`]?.t ?? [];
  scrub.max = String(Math.max(0, t.length - 1));
  reveal.textContent = revealed ? 'Hide the names again' : 'Reveal the names';
  reveal.setAttribute('aria-pressed', String(revealed));
  drawStrips();
}

function init() {
  sel.innerHTML = Object.entries(SCHEDULE_TEXT).map(([id, t]) => `<option value="${esc(id)}">${esc(t.name)}</option>`).join('');
  sel.addEventListener('change', () => { scrub.value = '0'; render(); });
  reveal.addEventListener('click', () => { revealed = !revealed; render(); });
  scrub.addEventListener('input', drawStrips);
  el('verdict').insertAdjacentHTML('beforeend', verdictHtml(ev));
  el('coord-fixtures').innerHTML = coordFixturesHtml(ev);
  el('phys-fixtures').innerHTML = physFixturesHtml(ev);
  el('limits').innerHTML = listHtml(ev.limits);
  el('gaps').innerHTML = listHtml(ev.gaps);
  render();
}
init();
