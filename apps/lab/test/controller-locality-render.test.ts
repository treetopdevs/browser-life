import { expect, it } from 'vitest';
import evidence from '../../../docs/controller-locality-2026-11-01/evidence.json';
import type { Payload } from '../../../packages/lineage/src/locality/matrix.ts';
import { ACTUATORS, esc, filterRows, fixturesTable, matrixHead, matrixRows, outcomeText, panelNote, panelSummaryTable, readoutTable, summaryIntro, verdictText } from '../src/controller-locality/render.ts';
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

// A synthetic second panel built from the original: a "power" record with its own seeds and a changed kind on one row.
const power = (): Payload => {
  const q = JSON.parse(JSON.stringify(p)) as Payload;
  (q as unknown as { panel: unknown }).panel = { id: 'power-v1', seeds: [101, 102] };
  (q.protocol as { assay: { seeds: number[] } }).assay.seeds = [101, 102];
  return q;
};
it('panel summary shows each panel its own A, C, K and verdict, with denominators, unpooled', () => {
  const q = power();
  // Distinct statistics so that reusing the original panel's numbers for the power rows would fail.
  for (const r of q.readouts) { r.overall = { ...r.overall, assayedGenuine: 192, improving: 7, collateral: 3, clean: 4 }; }
  q.verdict = { ...q.verdict, kind: 'broadly-useful' } as typeof q.verdict;
  const html = panelSummaryTable([{ id: 'original', label: 'Original', p }, { id: 'power', label: 'Power-up', p: q }]);
  const rows = html.split('<tr>').filter((x) => x.includes('<th scope="row">'));
  expect(rows.length).toBe(p.genomes.length + q.genomes.length);
  const orig = rows.filter((r) => r.includes('>Original<')), pw = rows.filter((r) => r.includes('>Power-up<'));
  expect(orig.length).toBe(p.genomes.length);
  expect(pw.length).toBe(q.genomes.length);
  for (const g of p.genomes) {
    const t = p.readouts.find((r) => r.genome === g.id)!.overall;
    const row = orig.find((r) => r.includes(esc(g.label)))!;
    expect(row).toContain(`<td>${t.assayedGenuine}</td><td>${t.improving}/${t.assayedGenuine}</td>`);
    if (t.improving > 0) expect(row).toContain(`<td>${t.collateral}/${t.improving}</td><td>${t.clean}/${t.improving}</td>`);
    expect(row).toContain(esc(verdictText(p.verdict)));
    expect(row).not.toContain('7/192');
  }
  for (const r of pw) {
    expect(r).toContain('<td>192</td><td>7/192</td><td>3/7</td><td>4/7</td>');
    expect(r).toContain(esc(verdictText(q.verdict)));
    expect(r).toContain('101, 102');
  }
  expect(panelSummaryTable([])).not.toContain('<tr><th scope="row">');
});
it('panel note names the panel, seeds and per-genome assayed counts, and says it is not pooled', () => {
  expect(panelNote(p)).toMatch(/^Original panel \(PR136\)/);
  const q = power();
  const note = panelNote(q);
  expect(note).toMatch(/^Power-up panel \(power-v1\)/);
  expect(note).toContain('assay seeds 101 and 102');
  for (const g of q.genomes.filter((x) => x.votes)) expect(note).toContain(`${g.label}: ${q.rows.filter((r) => r.genome === g.id && r.assay).length}`);
  expect(note).toContain('not pooled');
});
it('filters by kind of locus, composing with the other filters', () => {
  const g = p.genomes[0];
  const all = filterRows(p.rows, { genome: g.id, family: 'all', assayedOnly: false });
  expect(filterRows(p.rows, { genome: g.id, family: 'all', kind: 'all', assayedOnly: false }).length).toBe(all.length);
  const w1 = filterRows(p.rows, { genome: g.id, family: 'all', kind: 'w1', assayedOnly: false });
  expect(w1.length).toBeGreaterThan(0);
  expect(w1.length).toBeLessThan(all.length);
  expect(w1.every((r) => r.kind === 'w1')).toBe(true);
  const both = filterRows(p.rows, { genome: g.id, family: 'single24', kind: 'w1', assayedOnly: true });
  expect(both.every((r) => r.kind === 'w1' && r.family === 'single24' && r.assayed)).toBe(true);
});
it('the summary intro depends on the panels loaded and states that go was unreachable only with two panels', () => {
  const one = summaryIntro([{ id: 'original', label: 'o', p }]);
  expect(one.heading).not.toMatch(/side by side/);
  expect(one.paragraphs.join(' ')).toContain('has not been run yet');
  const two = summaryIntro([{ id: 'original', label: 'o', p }, { id: 'power', label: 'x', p: power() }]);
  expect(two.heading).toMatch(/side by side/);
  expect(two.paragraphs.join(' ')).toMatch(/could not have happened/);
  expect(two.paragraphs.join(' ')).toMatch(/not evidence against/);
});
