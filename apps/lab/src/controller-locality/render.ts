// Pure helpers for the controller-locality page: escaping, table rows, filters. No DOM lookups; reads only saved evidence.
import { ENDPOINTS, outcomeOf, type FixtureRow, type GenomeRecord, type GenomeReadout, type Payload, type Row, type Tally, type Verdict } from '../../../../packages/lineage/src/locality/matrix.ts';

export const esc = (s: string | number) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const ACTUATORS = ['photo', 'resp', 'decomp', 'grow', 'build', 'emit', 'moveX', 'moveY'] as const;
export const SENSORS = ['A', 'B', 'C', 'P', 'E/B', 'light', 'S', '∇Sx', '∇Sy', 'U'] as const;
export const FAMILY_TEXT: Record<string, string> = {
  single6: 'one locus, change of 6', single24: 'one locus, change of 24 (the default step)',
  multi2: '2 loci, 12 each (24 in total)', multi4: '4 loci, 6 each (24 in total)',
  multi2x24: '2 loci, 24 each (same slot count, twice the magnitude)', multi4x24: '4 loci, 24 each (same slot count, four times the magnitude)',
};
export const CLASS_TEXT: Record<string, string> = { genuine: 'changes the genome', unchanged: 'no change (bound)', 'boundary-clamped': 'partly clipped at a bound' };
export const KIND_TEXT: Record<string, string> = { w1: 'sensor to hidden weight', b1: 'hidden bias', w2: 'hidden to actuator weight', b2: 'actuator bias', physics: 'growth parameter (mu, sigma, motility gain)', multi: 'several controller weights' };

export interface Filter { genome: string; family: string; assayedOnly: boolean }
export const filterRows = (rows: readonly Row[], f: Filter): Row[] => rows.filter((r) => r.genome === f.genome && (f.family === 'all' || r.family === f.family) && (!f.assayedOnly || r.assayed));

const sensorsText = (mask: number) => SENSORS.filter((_, i) => mask & (1 << i)).join(' ') || 'none';
const heat = (permille: number) => `<td class="heat" style="--v:${Math.round(permille / 10)}">${permille === 0 ? '0' : permille}</td>`;
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

export function outcomeText(r: Row, g: GenomeRecord): string {
  if (!r.assay) return r.cls === 'genuine' ? 'not assayed' : r.cls === 'unchanged' ? 'neutral by construction' : 'partly clipped, not assayed';
  const o = outcomeOf(r.assay, g);
  return o.clean ? 'improves one, harms none' : o.collateral ? 'improves one, harms another' : o.harms.some(Boolean) ? 'harms only' : 'no change beyond tolerance';
}

export function matrixRows(rows: readonly Row[], g: GenomeRecord, points: number): string {
  return rows.map((r) => {
    const locus = r.slots.map((s) => s.locus).join(' + ');
    const dev = r.assay ? r.assay.dev.map((d, i) => `<td>${signed(d)}${Math.abs(d) > g.tau[i] ? ' *' : ''}</td>`).join('') : '<td>-</td><td>-</td><td>-</td>';
    return `<tr><th scope="row">${esc(locus)}</th><td>${esc(r.kind)}</td><td>${esc(r.family)}</td><td>${esc(CLASS_TEXT[r.cls] ?? r.cls)}</td><td>${esc(r.expression)}</td>${r.changed.map((c) => heat(Math.floor((1000 * c) / points))).join('')}<td>${r.breadth}</td><td>${esc(sensorsText(r.sensorMask))}</td>${dev}<td>${esc(outcomeText(r, g))}</td><td>${r.undoExact ? 'yes' : 'no'}</td></tr>`;
  }).join('');
}

export const matrixHead = (points: number): string =>
  `<tr><th scope="col">Edited locus</th><th scope="col">Kind</th><th scope="col">Edit</th><th scope="col">Result</th><th scope="col">Shows on the probe</th>${ACTUATORS.map((a) => `<th scope="col" title="permille of the ${points.toLocaleString('en-US')} probe points where ${a} changes">${a}</th>`).join('')}<th scope="col">Actuators moved</th><th scope="col">Sensors involved</th>${ENDPOINTS.map((e) => `<th scope="col" title="paired change from the unedited controller, summed over 2 seeds, permille of starting biomass; * beyond tolerance">${e}</th>`).join('')}<th scope="col">Assay outcome</th><th scope="col">Undone by one step</th></tr>`;

export function fixturesTable(fx: readonly FixtureRow[]): string {
  const rows = fx.map((f) => `<tr><th scope="row">${esc(f.label)}</th><td>${esc(f.expect)}</td><td>${f.naive.bytesChanged}</td><td>${f.naive.weightL1}</td><td>${f.functional.changedOutputs}</td><td>${f.functional.breadth}</td><td>${f.physical.dev.map(signed).join(' / ')}</td><td>${f.physical.identical ? 'identical' : 'differs'}</td><td>${f.passes ? 'as built' : 'NOT as built'}</td></tr>`).join('');
  return `<thead><tr><th scope="col">Fixture</th><th scope="col">Built to show</th><th scope="col">Bytes changed (naive)</th><th scope="col">Weight distance (naive)</th><th scope="col">Probe outputs changed (functional)</th><th scope="col">Actuators moved</th><th scope="col">Assay change (light / dark / dim)</th><th scope="col">Assay runs</th><th scope="col">Check</th></tr></thead><tbody>${rows}</tbody>`;
}

const pm = (n: number, d: number) => (d === 0 ? '-' : `${n}/${d}`);
export function readoutTable(read: GenomeReadout, g: GenomeRecord): string {
  const line = (name: string, t: Tally) => `<tr><th scope="row">${esc(name)}</th><td>${t.edits}</td><td>${pm(t.genuine, t.edits)}</td><td>${t.unchanged}</td><td>${t.boundaryClamped}</td><td>${pm(t.probeSilent, t.genuine)}</td><td>${pm(t.undoExactOfGenuine, t.genuine)}</td><td>${t.assayedGenuine}</td><td>${pm(t.viable, t.assayedGenuine)}</td><td>${pm(t.improving, t.assayedGenuine)}</td><td>${pm(t.collateral, t.improving)}</td><td>${pm(t.clean, t.improving)}</td><td>${pm(t.lgTransfer, t.lgImproving)}</td></tr>`;
  const body = [line(`all edits (${g.label})`, read.overall), ...Object.entries(read.byKind).map(([k, t]) => line(KIND_TEXT[k] ?? k, t)), ...Object.entries(read.byFamily).map(([k, t]) => line(FAMILY_TEXT[k] ?? k, t))].join('');
  return `<thead><tr><th scope="col">Group</th><th scope="col">Edits</th><th scope="col">Change the genome</th><th scope="col">No change</th><th scope="col">Clipped</th><th scope="col">Silent on the probe</th><th scope="col">Undone by one step</th><th scope="col">Assayed</th><th scope="col">Viable</th><th scope="col">Improve one response</th><th scope="col">Of those, harm another</th><th scope="col">Of those, harm none</th><th scope="col">Light-growth gain that also gains in dim light</th></tr></thead><tbody>${body}</tbody>`;
}

export function verdictText(v: Verdict): string {
  const label: Record<string, string> = { 'measurement-limited': 'measurement-limited: the assays cannot support a claim', inconclusive: 'inconclusive: no architecture claim', 'broadly-useful': 'broadly useful neighbourhood: better search and incentives first', 'entanglement-signal': 'entanglement signal: a representation fork is worth a separate study' };
  return `${label[v.kind] ?? v.kind}${v.singleGenome ? ' (single genome)' : ''}`;
}

export const candidatesText = (p: Payload): string => p.candidates.map((c) => `cluster ${c.cluster} (${c.slot}): ${c.qualification.pass ? 'passed the viability gate' : `failed: ${c.qualification.reasons.join('; ')}`}${c.chosen ? ', used' : ''}`).join(' | ');
