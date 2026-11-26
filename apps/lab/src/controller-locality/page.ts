import original from '../../../../docs/controller-locality-2026-11-01/evidence.json';
import type { Payload } from '../../../../packages/lineage/src/locality/matrix.ts';
import { FAMILY_TEXT, KIND_TEXT, candidatesText, esc, filterRows, fixturesTable, matrixHead, matrixRows, panelNote, panelSummaryTable, readoutTable, summaryIntro, verdictText, type NamedPanel } from './render.ts';
import './style.css';

// The power-up evidence exists once its run has been written; until then the page shows the original panel only.
const found = import.meta.glob('../../../../docs/controller-locality-power-2026-11-02/evidence.json', { eager: true, import: 'default' });
const power = Object.values(found)[0] as Payload | undefined;
const panels: NamedPanel[] = [{ id: 'original', label: 'Original (24 edits per M3 controller)', p: original as unknown as Payload }];
if (power) panels.push({ id: 'power', label: 'Power-up (larger fresh draw)', p: power });

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const panelSel = el<HTMLSelectElement>('panel'), genome = el<HTMLSelectElement>('genome'), family = el<HTMLSelectElement>('family'), kind = el<HTMLSelectElement>('kind'), assayed = el<HTMLInputElement>('assayed');
panelSel.innerHTML = panels.map((x) => `<option value="${esc(x.id)}">${esc(x.label)}</option>`).join('');
panelSel.disabled = panels.length < 2;
el('summary').innerHTML = panelSummaryTable(panels);
const intro = summaryIntro(panels);
el('summary-heading').textContent = intro.heading;
el('summary-text').innerHTML = intro.paragraphs.map((t, i) => `<p${i > 0 ? ' class="muted"' : ''}>${esc(t)}</p>`).join('');
const current = (): Payload => panels.find((x) => x.id === panelSel.value)!.p;

function fill(p: Payload) {
  genome.innerHTML = p.genomes.map((g) => `<option value="${esc(g.id)}">${esc(g.label)}${g.votes ? '' : g.role === 'control' ? ' (positive control, does not vote)' : ' (did not qualify)'}</option>`).join('');
  const families = [...new Set(p.rows.map((r) => r.family))];
  family.innerHTML = `<option value="all">all edits</option>${families.map((f) => `<option value="${esc(f)}">${esc(FAMILY_TEXT[f] ?? f)}</option>`).join('')}`;
  const kinds = [...new Set(p.rows.map((r) => r.kind))];
  kind.innerHTML = `<option value="all">all kinds of locus</option>${kinds.map((k) => `<option value="${esc(k)}">${esc(KIND_TEXT[k] ?? k)}</option>`).join('')}`;
  el('verdict').textContent = verdictText(p.verdict);
  el('verdict-reasons').innerHTML = p.verdict.reasons.map((r) => `<li>${esc(r)}</li>`).join('');
  el('candidates').textContent = candidatesText(p);
  el('panel-note').textContent = panelNote(p);
  el('fixtures').innerHTML = fixturesTable(p.fixtures);
  el('seal').textContent = p.integritySha256 ?? 'unsealed';
  el('matrix').querySelector('caption')!.textContent = `One row per edit. The eight shaded columns give the permille of the ${p.grid.points.toLocaleString('en-US')} probe points at which that action changes; the three assay columns are paired changes against the unedited controller, summed over two seeds, with a star beyond the stated tolerance.`;
}

function update() {
  const p = current();
  const g = p.genomes.find((x) => x.id === genome.value)!;
  const rows = filterRows(p.rows, { genome: g.id, family: family.value, kind: kind.value, assayedOnly: assayed.checked });
  el('matrix').querySelector('thead')!.innerHTML = matrixHead(p.grid.points);
  el('matrix').querySelector('tbody')!.innerHTML = matrixRows(rows, g, p.grid.points);
  el('shown').textContent = `${rows.length} of ${p.rows.filter((r) => r.genome === g.id).length} edits of ${g.label} shown. Tolerance for "changed" (summed over the two seeds): ${g.tau.join(' / ')} permille.`;
  el('readout').innerHTML = readoutTable(p.readouts.find((r) => r.genome === g.id)!, g);
}
panelSel.addEventListener('change', () => { fill(current()); update(); });
for (const c of [genome, family, kind, assayed]) c.addEventListener('change', update);
fill(current());
update();
