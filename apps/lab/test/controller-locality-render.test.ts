import { expect, it } from 'vitest';
import evidence from '../../../docs/controller-locality-2026-11-01/evidence.json';
import type { Payload } from '../../../packages/lineage/src/locality/matrix.ts';
import { ACTUATORS, esc, filterRows, fixturesTable, matrixHead, matrixRows, outcomeText, readoutTable, verdictText } from '../src/controller-locality/render.ts';
const p = evidence as unknown as Payload;
it('escapes locus labels and text', () => {
  expect(esc('<b>"x"&\'')).toBe('&lt;b&gt;&quot;x&quot;&amp;&#39;');
  const g = p.genomes[0];
  const row = { ...p.rows.find((r) => r.genome === g.id)!, slots: [{ ...p.rows[0].slots[0], locus: '<img src=x>' }] };
  const html = matrixRows([row], g, p.grid.points);
  expect(html).not.toContain('<img');
  expect(html).toContain('&lt;img src=x&gt;');
});
it('renders every row group and the fixtures panel', () => {
  for (const g of p.genomes) {
    const rows = filterRows(p.rows, { genome: g.id, family: 'all', assayedOnly: false });
    expect(rows.length).toBe(p.rows.filter((r) => r.genome === g.id).length);
    expect((matrixRows(rows, g, p.grid.points).match(/<tr>/g) ?? []).length).toBe(rows.length);
    const kinds = new Set(rows.map((r) => r.kind));
    for (const k of ['w1', 'b1', 'w2', 'b2', 'physics', 'multi']) expect(kinds.has(k)).toBe(true);
    expect(readoutTable(p.readouts.find((r) => r.genome === g.id)!, g)).toContain('all edits');
    const assayed = filterRows(p.rows, { genome: g.id, family: 'all', assayedOnly: true });
    expect(assayed.every((r) => r.assayed)).toBe(true);
    expect(outcomeText(assayed[0], g)).not.toBe('');
  }
  expect(matrixHead(p.grid.points).match(/<th /g)!.length).toBe(5 + ACTUATORS.length + 2 + 3 + 2);
  const fx = fixturesTable(p.fixtures);
  for (const f of p.fixtures) expect(fx).toContain(esc(f.label));
  expect(fx).toContain('identical');
  expect(verdictText(p.verdict)).toMatch(/inconclusive|measurement|broadly|entanglement/);
});
it('labels a clipped, unassayed row as clipped, not neutral', () => {
  const g = p.genomes[0];
  const base = p.rows.find((r) => r.genome === g.id)!;
  const text = (cls: string) => outcomeText({ ...base, cls, assay: null, assayed: false }, g);
  expect(text('unchanged')).toBe('neutral by construction');
  expect(text('boundary-clamped')).toBe('partly clipped, not assayed');
  expect(text('genuine')).toBe('not assayed');
});
