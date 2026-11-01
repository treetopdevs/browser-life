import evidence from '../../../../docs/controller-locality-2026-11-01/evidence.json';
import type { Payload } from '../../../../packages/lineage/src/locality/matrix.ts';
import { FAMILY_TEXT, candidatesText, esc, filterRows, fixturesTable, matrixHead, matrixRows, readoutTable, verdictText } from './render.ts';
import './style.css';

const p = evidence as unknown as Payload;
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const genome = el<HTMLSelectElement>('genome'), family = el<HTMLSelectElement>('family'), assayed = el<HTMLInputElement>('assayed');

genome.innerHTML = p.genomes.map((g) => `<option value="${esc(g.id)}">${esc(g.label)}${g.votes ? '' : g.role === 'control' ? ' (positive control, does not vote)' : ' (did not qualify)'}</option>`).join('');
const families = [...new Set(p.rows.map((r) => r.family))];
family.innerHTML = `<option value="all">all edits</option>${families.map((f) => `<option value="${esc(f)}">${esc(FAMILY_TEXT[f] ?? f)}</option>`).join('')}`;

function update() {
  const g = p.genomes.find((x) => x.id === genome.value)!;
  const rows = filterRows(p.rows, { genome: g.id, family: family.value, assayedOnly: assayed.checked });
  el('matrix').querySelector('thead')!.innerHTML = matrixHead(p.grid.points);
  el('matrix').querySelector('tbody')!.innerHTML = matrixRows(rows, g, p.grid.points);
  el('shown').textContent = `${rows.length} of ${p.rows.filter((r) => r.genome === g.id).length} edits of ${g.label} shown. Tolerance for "changed" (summed over the two seeds): ${g.tau.join(' / ')} permille.`;
  const read = p.readouts.find((r) => r.genome === g.id)!;
  el('readout').innerHTML = readoutTable(read, g);
}
for (const c of [genome, family, assayed]) c.addEventListener('change', update);
el('fixtures').innerHTML = fixturesTable(p.fixtures);
el('verdict').textContent = verdictText(p.verdict);
el('verdict-reasons').innerHTML = p.verdict.reasons.map((r) => `<li>${esc(r)}</li>`).join('');
el('candidates').textContent = candidatesText(p);
el('seal').textContent = p.integritySha256 ?? 'unsealed';
el('matrix').querySelector('caption')!.textContent = `One row per edit. The eight shaded columns give the permille of the ${p.grid.points.toLocaleString('en-US')} probe points at which that action changes; the three assay columns are paired changes against the unedited controller, summed over two seeds, with a star beyond the stated tolerance.`;
update();
