// Renders a lineage dossier (the JSON `tools/lineage.ts --out` writes) into the static lineage panel of
// docs/lineage-inspector.md (section 3, the panel; section 6, build step 3). Three inputs:
//   kind "genotype"   one genotype lineage: ancestry lanes with the mutation table, population, the
//                     controller's light response and mean outputs along the ancestry, realized fluxes
//                     (profiles.tsv runs), offspring, tracker births and the neutral twin row;
//   kind "pond"       one scaffold pond node: its trait against the population band, and donor-packet
//                     descent (descendants of each ancestor, clade size afterwards);
//   kind "pond-twin"  the same pond rule on a scaf history and its rand twin, side by side.
//
// Same rules as the other report-html pages (tools/lib/report-html/page.ts): a pure function of its input,
// tokens only inside SVG, no interpretive prose. Every sentence on the page is either a static method fact
// or a template filled from the dossier, and the dossier's own notes and gaps are printed verbatim. Each
// section and key number carries an evidence chip (exact, inferred, context, not recorded).
import type { Dossier, twinSummary } from "../lineage.ts";
import type { PondDossier, PondNode, PondTwin } from "../pond-lineage.ts";
import {
  caveatParagraph,
  caveatsSection,
  escapeHtml,
  evidenceChip,
  figure,
  header,
  keyNumbersList,
  numbersTable,
  pageShell,
  type DataStatus,
  type Evidence,
  type KeyNumberItem,
  type SourceRef,
} from "./page.ts";
import { axis, linearScale, niceTicks, num, type Scale } from "./svg.ts";

/** Matches tools/report-html.ts's `RenderMeta` structurally (see individuality.ts for why it is not imported). */
export interface RenderMeta {
  sources: SourceRef[];
  status: DataStatus;
}

export type GenotypeInput = Dossier & { twin?: ReturnType<typeof twinSummary> | null };
export type LineageInput = GenotypeInput | PondDossier | PondTwin;

/** The controller's outputs in genome order; mirrors OUTPUTS in tools/lib/lineage.ts (checked by the tests). */
export const OUTPUT_NAMES = ["photo", "resp", "decomp", "grow", "build", "emit", "moveX", "moveY"] as const;
const EXPRESSIONS = ["controller", "physics", "probe-silent", "clamped"] as const;

// ---- validation -----------------------------------------------------------------------------------------

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
function fail(path: string, what: string): never {
  throw new Error(`lineage dossier: ${path} ${what}`);
}
function rec(x: unknown, path: string): Record<string, unknown> {
  if (!isRecord(x)) fail(path, "must be an object");
  return x;
}
function arr(x: unknown, path: string): unknown[] {
  if (!Array.isArray(x)) fail(path, "must be an array");
  return x;
}
function numAt(x: unknown, path: string, nullable = false): void {
  if (nullable && x === null) return;
  if (typeof x !== "number" || !Number.isFinite(x)) fail(path, `must be a finite number${nullable ? " or null" : ""}`);
}
function strAt(x: unknown, path: string, nullable = false): void {
  if (nullable && x === null) return;
  if (typeof x !== "string") fail(path, `must be a string${nullable ? " or null" : ""}`);
}
function numbers(x: unknown, path: string, length?: number): void {
  const a = arr(x, path);
  if (length !== undefined && a.length !== length) fail(path, `must have ${length} entries, has ${a.length}`);
  a.forEach((v, i) => numAt(v, `${path}[${i}]`));
}
function strings(x: unknown, path: string): void {
  arr(x, path).forEach((v, i) => strAt(v, `${path}[${i}]`));
}
function boolAt(x: unknown, path: string): void {
  if (typeof x !== "boolean") fail(path, "must be a boolean");
}
/** A field the producer may leave out (older manifests): absent, or of the given kind. */
function optional(x: unknown, path: string, check: (x: unknown, path: string) => void): void {
  if (x !== undefined) check(x, path);
}
function genotypeRule(x: unknown, path: string): void {
  const r = rec(x, path);
  if (!["key", "top", "random", "longest"].includes(r.kind as string)) fail(`${path}.kind`, "must be key, top, random or longest");
  numAt(r.step, `${path}.step`);
  if (r.kind === "key") strAt(r.key, `${path}.key`);
  if (r.kind === "random") {
    numAt(r.seed, `${path}.seed`);
    numAt(r.minShare, `${path}.minShare`);
  }
}
function pondPacket(x: unknown, path: string): void {
  const k = rec(x, path);
  for (const f of ["landed", "retMass", "domShare"]) numAt(k[f], `${path}.${f}`, true);
  strAt(k.dominant, `${path}.dominant`, true);
}

function validateGenotype(d: Record<string, unknown>): void {
  const s = rec(d.subject, "subject");
  strAt(s.key, "subject.key");
  numAt(s.cellsAtStep, "subject.cellsAtStep");
  numAt(s.shareAtStep, "subject.shareAtStep");
  boolAt(s.aliveAtEnd, "subject.aliveAtEnd");
  const origin = rec(s.origin, "subject.origin");
  if ("founder" in origin) numAt(origin.founder, "subject.origin.founder");
  else for (const k of ["minted", "cell", "x", "y", "tile"]) numAt(origin[k], `subject.origin.${k}`);
  genotypeRule(d.rule, "rule");
  const root = rec(d.root, "root");
  strAt(root.key, "root.key");
  strAt(root.source, "root.source");
  const p = rec(d.provenance, "provenance");
  for (const k of ["dir", "runId"]) strAt(p[k], `provenance.${k}`);
  for (const k of ["presetId", "condition"]) optional(p[k], `provenance.${k}`, (x, at) => strAt(x, at));
  for (const k of ["censusEvery", "deepEvery"]) optional(p[k], `provenance.${k}`, (x, at) => numAt(x, at));
  numAt(p.seed, "provenance.seed");
  numAt(p.finalCensus, "provenance.finalCensus", true);
  strAt(p.finalHash, "provenance.finalHash", true);
  boolAt(p.expressed, "provenance.expressed");
  strings(p.files, "provenance.files");
  const chain = arr(d.chain, "chain");
  if (chain.length === 0) fail("chain", "must not be empty");
  chain.forEach((c, i) => {
    const n = rec(c, `chain[${i}]`);
    strAt(n.key, `chain[${i}].key`);
    for (const k of ["minted", "firstSeen", "lastSeen"]) numAt(n[k], `chain[${i}].${k}`, true);
    for (const k of ["peakCells", "siblings", "mu", "sigma", "motGain"]) numAt(n[k], `chain[${i}].${k}`);
    arr(n.series, `chain[${i}].series`).forEach((pt, j) => numbers(pt, `chain[${i}].series[${j}]`, 2));
    const probe = rec(n.probe, `chain[${i}].probe`);
    numbers(probe.meanOut, `chain[${i}].probe.meanOut`, OUTPUT_NAMES.length);
    for (const k of ["activeHidden", "regimes", "regimeEntropy"]) numAt(probe[k], `chain[${i}].probe.${k}`);
    arr(probe.lightCurve, `chain[${i}].probe.lightCurve`).forEach((pt, j) => numbers(pt, `chain[${i}].probe.lightCurve[${j}]`, OUTPUT_NAMES.length + 1));
    if (n.profile !== null) {
      const pr = rec(n.profile, `chain[${i}].profile`);
      numAt(pr.censuses, `chain[${i}].profile.censuses`);
      numAt(pr.cellCensuses, `chain[${i}].profile.cellCensuses`);
      for (const [role, v] of Object.entries(rec(pr.roles, `chain[${i}].profile.roles`))) numAt(v, `chain[${i}].profile.roles.${role}`);
      const pc = rec(pr.perCell, `chain[${i}].profile.perCell`);
      for (const k of ["photo", "grow", "decomp", "resp"]) numAt(pc[k], `chain[${i}].profile.perCell.${k}`);
    }
  });
  const muts = arr(d.mutations, "mutations");
  if (muts.length !== chain.length - 1) fail("mutations", `must have one entry per chain edge (${chain.length - 1}), has ${muts.length}`);
  muts.forEach((m, i) => {
    const x = rec(m, `mutations[${i}]`);
    for (const k of ["child", "parent", "locus"]) strAt(x[k], `mutations[${i}].${k}`);
    for (const k of ["step", "before", "after"]) numAt(x[k], `mutations[${i}].${k}`);
    if (!(EXPRESSIONS as readonly unknown[]).includes(x.expression)) fail(`mutations[${i}].expression`, `must be one of ${EXPRESSIONS.join(", ")}`);
    numbers(x.maxDelta, `mutations[${i}].maxDelta`, OUTPUT_NAMES.length);
    numbers(x.changedShare, `mutations[${i}].changedShare`, OUTPUT_NAMES.length);
  });
  const pop = rec(d.population, "population");
  numbers(pop.steps, "population.steps");
  const len = (pop.steps as number[]).length;
  if (len === 0) fail("population.steps", "must not be empty");
  for (const k of ["living", "line", "clade"]) numbers(pop[k], `population.${k}`, len);
  const off = rec(d.offspring, "offspring");
  for (const k of ["childCount", "childrenCensused", "descendants"]) numAt(off[k], `offspring.${k}`);
  arr(off.children, "offspring.children").forEach((c, i) => {
    const x = rec(c, `offspring.children[${i}]`);
    strAt(x.key, `offspring.children[${i}].key`);
    numAt(x.minted, `offspring.children[${i}].minted`);
    numAt(x.peakCells, `offspring.children[${i}].peakCells`);
    numAt(x.firstSeen, `offspring.children[${i}].firstSeen`, true);
  });
  const log = rec(d.log, "log");
  for (const k of ["rows", "children", "duplicates", "conflicting"]) numAt(log[k], `log.${k}`);
  numAt(log.expectedMutations, "log.expectedMutations", true);
  if (log.complete !== null && typeof log.complete !== "boolean") fail("log.complete", "must be a boolean or null");
  const v = rec(d.verification, "verification");
  numAt(v.genomesChecked, "verification.genomesChecked");
  strAt(v.against, "verification.against", true);
  if (d.trackerBirths !== null) {
    const t = rec(d.trackerBirths, "trackerBirths");
    for (const k of ["fission", "budding", "asParent", "asChild"]) numAt(t[k], `trackerBirths.${k}`);
    arr(t.rows, "trackerBirths.rows").forEach((x, i) => {
      for (const [k, v] of Object.entries(rec(x, `trackerBirths.rows[${i}]`))) strAt(v, `trackerBirths.rows[${i}].${k}`);
    });
  }
  strings(d.gaps, "gaps");
  if (d.twin !== undefined && d.twin !== null) {
    const t = rec(d.twin, "twin");
    for (const k of ["runId", "subject"]) strAt(t[k], `twin.${k}`);
    optional(t.condition, "twin.condition", (x, at) => strAt(x, at));
    boolAt(t.expressed, "twin.expressed");
    genotypeRule(t.rule, "twin.rule");
    for (const k of ["depth", "medianAncestorPeak", "ancestorsNeverCensused", "childCount", "descendants", "lineagesMinted"]) numAt(t[k], `twin.${k}`);
    const by = rec(t.mutationsByExpression, "twin.mutationsByExpression");
    for (const k of EXPRESSIONS) numAt(by[k], `twin.mutationsByExpression.${k}`);
  }
}

function validatePond(d: Record<string, unknown>, at: string): void {
  if (d.kind !== "pond") fail(`${at}kind`, 'must be "pond"');
  if (d.dossierVersion !== 1) fail(`${at}dossierVersion`, "must be 1");
  if (d.descent !== "donor-packet" && d.descent !== "none") fail(`${at}descent`, 'must be "donor-packet" or "none"');
  strAt(d.arm, `${at}arm`, true);
  const s = rec(d.subject, `${at}subject`);
  for (const k of ["pond", "cycle", "step", "trait", "rank", "of", "candidates"]) numAt(s[k], `${at}subject.${k}`);
  const r = rec(s.rule, `${at}subject.rule`);
  if (!["explicit", "top", "random"].includes(r.kind as string)) fail(`${at}subject.rule.kind`, "must be explicit, top or random");
  numAt(r.cycle, `${at}subject.rule.cycle`);
  if (r.kind === "random") for (const k of ["seed", "minTrait"]) numAt(r[k], `${at}subject.rule.${k}`);
  const h = rec(d.history, `${at}history`);
  for (const k of ["ponds", "firstCycle", "lastCycle"]) numAt(h[k], `${at}history.${k}`);
  const a = rec(d.ancestry, `${at}ancestry`);
  for (const k of ["depth", "rootPond", "rootCycle", "distinctDonorPonds"]) numAt(a[k], `${at}ancestry.${k}`);
  numAt(a.commonAncestorCycle, `${at}ancestry.commonAncestorCycle`, true);
  const chain = arr(a.chain, `${at}ancestry.chain`);
  if (chain.length === 0) fail(`${at}ancestry.chain`, "must not be empty");
  chain.forEach((c, i) => {
    const n = rec(c, `${at}ancestry.chain[${i}]`);
    for (const k of ["pond", "cycle", "step", "trait"]) numAt(n[k], `${at}ancestry.chain[${i}].${k}`);
    for (const k of ["descendants", "individuals", "lineages"]) numAt(n[k], `${at}ancestry.chain[${i}].${k}`, true);
    if (n.parent !== null) {
      const pa = rec(n.parent, `${at}ancestry.chain[${i}].parent`);
      numAt(pa.pond, `${at}ancestry.chain[${i}].parent.pond`);
      numAt(pa.cycle, `${at}ancestry.chain[${i}].parent.cycle`);
    }
    if (n.packet !== null) pondPacket(n.packet, `${at}ancestry.chain[${i}].packet`);
  });
  arr(d.band, `${at}band`).forEach((b, i) => {
    const x = rec(b, `${at}band[${i}]`);
    for (const k of ["cycle", "n", "eligible", "min", "q1", "median", "q3", "max"]) numAt(x[k], `${at}band[${i}].${k}`);
  });
  if (d.offspring !== null) {
    const o = rec(d.offspring, `${at}offspring`);
    numAt(o.count, `${at}offspring.count`);
    boolAt(o.measured, `${at}offspring.measured`);
    arr(o.children, `${at}offspring.children`).forEach((c, i) => {
      const x = rec(c, `${at}offspring.children[${i}]`);
      numAt(x.pond, `${at}offspring.children[${i}].pond`);
      numAt(x.cycle, `${at}offspring.children[${i}].cycle`);
      numAt(x.trait, `${at}offspring.children[${i}].trait`, true);
      numAt(x.seeded, `${at}offspring.children[${i}].seeded`, true);
      pondPacket(x.packet, `${at}offspring.children[${i}].packet`);
    });
  }
  if (d.clade !== null) {
    const c = rec(d.clade, `${at}clade`);
    arr(c.series, `${at}clade.series`).forEach((p, i) => {
      const x = rec(p, `${at}clade.series[${i}]`);
      for (const k of ["cycle", "size", "eligible", "traitSum"]) numAt(x[k], `${at}clade.series[${i}].${k}`);
    });
    numAt(c.extinctAt, `${at}clade.extinctAt`, true);
  }
  for (const k of ["notes", "gaps", "warnings"]) strings(d[k], `${at}${k}`);
}

export function validate(data: unknown): asserts data is LineageInput {
  const d = rec(data, "(root)");
  if (d.kind === "genotype") {
    if (d.dossierVersion !== 1) fail("dossierVersion", "must be 1");
    validateGenotype(d);
  } else if (d.kind === "pond") validatePond(d, "");
  else if (d.kind === "pond-twin") {
    if (d.dossierVersion !== 1) fail("dossierVersion", "must be 1");
    validatePond(rec(d.scaf, "scaf"), "scaf.");
    validatePond(rec(d.rand, "rand"), "rand.");
    strings(d.notes, "notes");
  } else fail("kind", 'must be "genotype", "pond" or "pond-twin" (the JSON tools/lineage.ts --out writes)');
}

// ---- formatting ------------------------------------------------------------------------------------------

/** Extremes by loop: series can hold more entries than a spread call accepts as arguments. */
function maxOf(vals: Iterable<number>, floor: number): number {
  let m = floor;
  for (const v of vals) if (v > m) m = v;
  return m;
}
function minOf(vals: Iterable<number>, ceil: number): number {
  let m = ceil;
  for (const v of vals) if (v < m) m = v;
  return m;
}

const int = (v: number): string => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const pct = (v: number): string => `${(100 * v).toFixed(1)}%`;
const orNone = (v: number | null, f: (x: number) => string = int): string => (v === null ? "none" : f(v));
const fixed = (v: number, d: number): string => v.toFixed(d);

function section(title: string, evidence: Evidence | null, body: string): string {
  return `<section class="lineage-section">
  <h2>${escapeHtml(title)}${evidence ? evidenceChip(evidence) : ""}</h2>
${body}
</section>`;
}
const para = (t: string): string => `<p>${escapeHtml(t)}</p>`;
const list = (items: string[]): string => `<ul>${items.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>`;
const tableBlock = (headers: string[], rows: (string | number)[][]): string => `<div class="table-wrap">\n${numbersTable(headers, rows)}\n</div>`;
const svgOpen = (w: number, h: number, label: string): string =>
  `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeHtml(label)}">`;
const text = (x: number, y: number, s: string, extra = ""): string =>
  `<text x="${num(x)}" y="${num(y)}" fill="var(--muted)" font-size="10"${extra}>${escapeHtml(s)}</text>`;

/** A dashed vertical marker; its label flips to the left of the line near the right edge so it stays inside. */
function vline(x: number, y0: number, y1: number, label: string, right: number): string {
  const flip = x > right - label.length * 6.2 - 8;
  return `<g><line x1="${num(x)}" x2="${num(x)}" y1="${num(y0)}" y2="${num(y1)}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="4,3" />${text(flip ? x - 4 : x + 4, y0 + 10, label, flip ? ' text-anchor="end"' : "")}</g>`;
}

/** Labels at line ends, nudged apart vertically so none overlaps another. */
function endLabels(items: { x: number; y: number; label: string }[], gap = 11): string {
  const sorted = [...items].sort((a, b) => a.y - b.y || (a.label < b.label ? -1 : 1));
  for (let i = 1; i < sorted.length; i++) if (sorted[i].y < sorted[i - 1].y + gap) sorted[i] = { ...sorted[i], y: sorted[i - 1].y + gap };
  return sorted.map((it) => text(it.x, it.y + 3.5, it.label)).join("");
}

/** Ticks spanning `domain` and the domain widened to them, so the axis ends on a tick. */
function ticksAndDomain(lo: number, hi: number, count: number): { ticks: number[]; domain: [number, number] } {
  const ticks = niceTicks([lo, hi > lo ? hi : lo + 1], count);
  return { ticks, domain: [ticks[0], ticks[ticks.length - 1]] };
}

/**
 * A series as a polyline, or, when it has more points than pixel columns, as the band between each column's
 * minimum and maximum (so a spike is never dropped by thinning).
 */
function trace(xs: number[], ys: number[], x: Scale, y: Scale, px: [number, number], color: string, cols: number, dash = ""): string {
  const d = dash ? ` stroke-dasharray="${dash}"` : "";
  if (xs.length <= cols) {
    const pts = xs.map((v, i) => `${num(x(v))},${num(y(ys[i]))}`).join(" ");
    return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5"${d} />`;
  }
  const lo = new Array<number>(cols).fill(Infinity), hi = new Array<number>(cols).fill(-Infinity), at = new Array<number>(cols).fill(NaN);
  for (let i = 0; i < xs.length; i++) {
    const c = Math.min(cols - 1, Math.max(0, Math.floor(((x(xs[i]) - px[0]) / (px[1] - px[0])) * cols)));
    if (ys[i] < lo[c]) lo[c] = ys[i];
    if (ys[i] > hi[c]) hi[c] = ys[i];
    at[c] = x(xs[i]);
  }
  const top: string[] = [], bottom: string[] = [];
  for (let c = 0; c < cols; c++) {
    if (!Number.isFinite(lo[c])) continue;
    top.push(`${num(at[c])},${num(y(hi[c]))}`);
    bottom.push(`${num(at[c])},${num(y(lo[c]))}`);
  }
  return `<polygon points="${[...top, ...bottom.reverse()].join(" ")}" fill="${color}" fill-opacity="0.3" stroke="${color}" stroke-width="1"${d} />`;
}

// ---- genotype --------------------------------------------------------------------------------------------

type Mut = GenotypeInput["mutations"][number];
type Node = GenotypeInput["chain"][number];

/** The step axis runs to the run's final census. */
function endStep(d: GenotypeInput): number {
  const last = d.population.steps[d.population.steps.length - 1];
  return maxOf(d.chain.map((c) => c.lastSeen ?? c.minted ?? 0), Math.max(1, d.provenance.finalCensus ?? last));
}

/** Expression-class marker at (x, y): shape and fill differ, so the class never rests on colour alone. */
function marker(kind: (typeof EXPRESSIONS)[number] | "root", x: number, y: number): string {
  switch (kind) {
    case "root":
      return `<polygon points="${num(x)},${num(y - 4.5)} ${num(x + 4.5)},${num(y)} ${num(x)},${num(y + 4.5)} ${num(x - 4.5)},${num(y)}" fill="var(--ink)" />`;
    case "controller":
      return `<circle cx="${num(x)}" cy="${num(y)}" r="3.5" fill="var(--accent2)" />`;
    case "physics":
      return `<rect x="${num(x - 3.2)}" y="${num(y - 3.2)}" width="6.4" height="6.4" fill="var(--pass)" />`;
    case "probe-silent":
      return `<circle cx="${num(x)}" cy="${num(y)}" r="3.2" fill="var(--panel)" stroke="var(--muted)" stroke-width="1.3" />`;
    case "clamped":
      return `<g><line x1="${num(x - 3)}" x2="${num(x + 3)}" y1="${num(y - 3)}" y2="${num(y + 3)}" stroke="var(--muted)" stroke-width="1.4" /><line x1="${num(x - 3)}" x2="${num(x + 3)}" y1="${num(y + 3)}" y2="${num(y - 3)}" stroke="var(--muted)" stroke-width="1.4" /></g>`;
  }
}

/** The mechanical effect template of one mutation on the probe grid. */
export function effectText(m: Mut): string {
  switch (m.expression) {
    case "clamped":
      return "no genome change (clamped)";
    case "physics":
      return "acts through physics, not on the probe grid";
    case "probe-silent":
      return "no output moves on the probe grid";
    case "controller": {
      const moved = OUTPUT_NAMES.map((name, k) => ({ name, k, d: m.maxDelta[k] })).filter((o) => o.d > 0).sort((a, b) => b.d - a.d || a.k - b.k);
      const shown = moved.slice(0, 3).map((o) => `${o.name} ${o.d} (${pct(m.changedShare[o.k])})`);
      return shown.join(", ") + (moved.length > 3 ? `, +${moved.length - 3} more` : "");
    }
  }
}

function ancestryFigure(d: GenotypeInput, n: number): string {
  const chain = d.chain, rows = chain.length;
  const rowH = rows <= 60 ? 16 : rows <= 150 ? 9 : 5;
  const W = 960, left = 210, right = 36, top = 34, bottom = 44;
  const H = top + rows * rowH + bottom;
  const { ticks, domain } = ticksAndDomain(0, endStep(d), 6);
  const x = linearScale(domain, [left, W - right]);
  const peak = maxOf(chain.map((c) => c.peakCells), 1);
  const barH = (c: number) => ((rowH - 3) * Math.log10(1 + c)) / Math.log10(1 + peak);
  const cols = 300, colW = (W - right - left) / cols;
  const parts: string[] = [svgOpen(W, H, `Ancestry: ${rows} lineages from root ${chain[0].key} to subject ${chain[rows - 1].key}`)];

  // Legend.
  let lx = left;
  for (const k of ["root", ...EXPRESSIONS] as const) {
    parts.push(marker(k, lx + 4, 12), text(lx + 12, 15.5, k === "root" ? "root" : k));
    lx += k === "root" ? 52 : k.length * 6.2 + 28;
  }
  parts.push(text(lx + 8, 15.5, `bar height: living cells per census, log scale to ${int(peak)}`));

  parts.push(axis({ orientation: "bottom", scale: x, ticks, at: H - bottom + 4, gridTo: top - 4, format: int, label: "step", viewBox: { width: W, height: H } }));
  chain.forEach((c, i) => {
    const y0 = top + i * rowH, base = y0 + rowH - 1.5, mid = y0 + rowH / 2;
    const start = c.minted ?? 0;
    if (c.firstSeen !== null && c.firstSeen > start)
      parts.push(`<line x1="${num(x(start))}" x2="${num(x(c.firstSeen))}" y1="${num(base)}" y2="${num(base)}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="2,2" />`);
    if (c.firstSeen !== null && c.lastSeen !== null)
      parts.push(`<line x1="${num(x(c.firstSeen))}" x2="${num(x(c.lastSeen))}" y1="${num(base)}" y2="${num(base)}" stroke="var(--rule)" stroke-width="1" />`);
    const tallest = new Map<number, number>();
    for (const [s, cells] of c.series) {
      const col = Math.min(cols - 1, Math.max(0, Math.floor((x(s) - left) / colW)));
      if (cells > (tallest.get(col) ?? 0)) tallest.set(col, cells);
    }
    for (const [col, cells] of [...tallest].sort((a, b) => a[0] - b[0])) {
      const h = Math.max(1, barH(cells));
      parts.push(`<rect x="${num(left + col * colW)}" y="${num(base - h)}" width="${num(colW + 0.4)}" height="${num(h)}" fill="var(--accent)" fill-opacity="0.85" />`);
    }
    parts.push(marker(i === 0 ? "root" : d.mutations[i - 1].expression, x(start), mid));
    if (rowH >= 9 || i === 0 || i === rows - 1 || i % 10 === 0)
      parts.push(text(left - 10, mid + 3.5, `${c.key}  ${i === 0 ? "root" : d.mutations[i - 1].locus}`, ' text-anchor="end"'));
  });
  parts.push("</svg>");

  const table = numbersTable(
    ["#", "step", "child", "locus", "change", "expression", "effect on probe grid (max |Δ|, share of grid)", "child peak cells", "child's siblings"],
    d.mutations.map((m, i) => [
      String(i + 1),
      int(m.step),
      m.child,
      m.locus,
      `${m.before} → ${m.after}`,
      m.expression,
      effectText(m),
      int(chain[i + 1].peakCells),
      int(chain[i + 1].siblings),
    ]),
  );
  return figure(
    n,
    parts.join(""),
    `One row per lineage on the ancestry, root ${chain[0].key} at the top and subject ${chain[rows - 1].key} at the bottom. Bars: the row's living cells at each census (tallest per pixel column). Dashes: minted but not yet seen at a census. Marker: the mutation that minted the row's lineage, by its expression class on the probe grid. The table lists each mutation; siblings are the other children its parent minted.`,
    table,
  );
}

function populationFigure(d: GenotypeInput, n: number): string {
  const p = d.population;
  const W = 960, H = 410, left = 64, right = 36;
  const { ticks: xt, domain: xd } = ticksAndDomain(0, endStep(d), 6);
  const x = linearScale(xd, [left, W - right]);
  const px: [number, number] = [left, W - right];
  const cols = 600;
  const a = { top: 30, bottom: 170 }, b = { top: 222, bottom: 362 };
  const { ticks: yt, domain: yd } = ticksAndDomain(0, maxOf(p.living, 1), 4);
  const ya = linearScale(yd, [a.bottom, a.top]);
  const yb = linearScale([0, 1], [b.bottom, b.top]);
  const share = (num_: number[]) => num_.map((v, i) => (p.living[i] ? v / p.living[i] : 0));
  const vb = { width: W, height: H };
  const minted = d.chain[d.chain.length - 1].minted;
  const parts = [svgOpen(W, H, "Population: living cells, and the shares held by the ancestry line and by the subject's clade")];
  parts.push(text(left, a.top - 12, "living cells"));
  parts.push(axis({ orientation: "left", scale: ya, ticks: yt, at: left, gridTo: W - right, format: int, viewBox: vb }));
  parts.push(axis({ orientation: "bottom", scale: x, ticks: xt, at: a.bottom, format: int, viewBox: vb }));
  parts.push(trace(p.steps, p.living, x, ya, px, "var(--ink)", cols));
  parts.push(text(left, b.top - 12, "share of living cells: ancestry line (solid), subject's clade (dashed)"));
  parts.push(axis({ orientation: "left", scale: yb, ticks: [0, 0.25, 0.5, 0.75, 1], at: left, gridTo: W - right, format: (v) => `${Math.round(v * 100)}%`, viewBox: vb }));
  parts.push(axis({ orientation: "bottom", scale: x, ticks: xt, at: b.bottom, format: int, label: "step", viewBox: vb }));
  parts.push(trace(p.steps, share(p.line), x, yb, px, "var(--accent)", cols));
  parts.push(trace(p.steps, share(p.clade), x, yb, px, "var(--accent2)", cols, "5,3"));
  if (minted !== null) parts.push(vline(x(minted), b.top, b.bottom, "subject minted", W - right));
  parts.push("</svg>");
  return figure(
    n,
    parts.join(""),
    `Every census from step ${int(p.steps[0])} to ${int(p.steps[p.steps.length - 1])} (${int(p.steps.length)} censuses, empty ones included). The ancestry line is the cells of any lineage on the ancestry; the clade is the subject and every lineage descending from it. Where censuses outnumber pixel columns, each column shows its minimum-to-maximum band.`,
  );
}

/** Root, the ancestor with the most peak cells (ties to the earlier), and the subject; fewer for short chains. */
function strategyNodes(chain: Node[]): { node: Node; role: string; color: string; dash: string }[] {
  const out = [{ node: chain[0], role: "root", color: "var(--muted)", dash: "5,3" }];
  if (chain.length > 2) {
    let best = 1;
    for (let i = 2; i < chain.length - 1; i++) if (chain[i].peakCells > chain[best].peakCells) best = i;
    out.push({ node: chain[best], role: "peak ancestor", color: "var(--accent2)", dash: "1.5,2.5" });
  }
  if (chain.length > 1) out.push({ node: chain[chain.length - 1], role: "subject", color: "var(--accent)", dash: "" });
  return out;
}

function strategyFigure(d: GenotypeInput, n: number): string {
  const lines = strategyNodes(d.chain);
  const W = 960, legendH = 30, pw = 240, ph = 200;
  const H = legendH + 2 * ph;
  const parts = [svgOpen(W, H, "Controller output against light for root, peak ancestor and subject")];
  let lx = 8;
  for (const l of lines) {
    parts.push(`<line x1="${num(lx)}" x2="${num(lx + 28)}" y1="13" y2="13" stroke="${l.color}" stroke-width="2"${l.dash ? ` stroke-dasharray="${l.dash}"` : ""} />`);
    const label = `${l.role} ${l.node.key}`;
    parts.push(text(lx + 34, 16.5, label));
    lx += 34 + label.length * 6.2 + 24;
  }
  OUTPUT_NAMES.forEach((name, k) => {
    const left = 44, right = 12, top = 22, bottom = 38;
    const vals = lines.flatMap((l) => l.node.probe.lightCurve.map((r) => r[k + 1]));
    const { ticks: yt, domain: yd } = ticksAndDomain(minOf(vals, 0), maxOf(vals, 1), 4);
    const x = linearScale([0, 120], [left, pw - right]);
    const y = linearScale(yd, [ph - bottom, top]);
    const vb = { width: pw, height: ph };
    const panel = [`<text x="${left}" y="14" fill="var(--ink)" font-size="12" font-weight="600">${escapeHtml(name)}</text>`];
    panel.push(axis({ orientation: "left", scale: y, ticks: yt, at: left, gridTo: pw - right, viewBox: vb }));
    panel.push(axis({ orientation: "bottom", scale: x, ticks: [0, 40, 80, 120], at: ph - bottom, format: String, label: "light", viewBox: vb }));
    for (const l of lines) {
      const pts = l.node.probe.lightCurve;
      panel.push(trace(pts.map((r) => r[0]), pts.map((r) => r[k + 1]), x, y, [left, pw - right], l.color, 1000, l.dash));
    }
    parts.push(`<g transform="translate(${(k % 4) * pw},${legendH + Math.floor(k / 4) * ph})">${panel.join("")}</g>`);
  });
  parts.push("</svg>");
  return figure(
    n,
    parts.join(""),
    "Controller output against light (0 to 120 in steps of 8), the other sensors held at A 32, B 64, C 32, E/B 32 and the rest 0, computed from each genome with the simulator's integer forward pass. Catalytic outputs (photo to emit) are rectified at 0, as react uses them. The middle line is the ancestor with the most peak cells, between root and subject.",
  );
}

function meanOutputFigure(d: GenotypeInput, n: number): string {
  const chain = d.chain;
  const W = 960, left = 64, right = 16, top = 12, rowH = 18, H = top + OUTPUT_NAMES.length * rowH + 36;
  const cw = (W - left - right) / chain.length;
  const parts = [svgOpen(W, H, `Mean probe output of each output along ${chain.length} ancestry lineages`)];
  OUTPUT_NAMES.forEach((name, k) => {
    const y = top + k * rowH;
    parts.push(`<rect x="${left}" y="${num(y)}" width="${num(W - left - right)}" height="${rowH - 2}" fill="var(--ground)" />`);
    parts.push(text(left - 8, y + rowH / 2 + 2.5, name, ' text-anchor="end"'));
    chain.forEach((c, i) => {
      const v = c.probe.meanOut[k];
      if (v === 0) return;
      parts.push(
        `<rect x="${num(left + i * cw)}" y="${num(y)}" width="${num(Math.max(cw - 0.5, 0.5))}" height="${rowH - 2}" fill="${v > 0 ? "var(--accent)" : "var(--accent2)"}" fill-opacity="${num(Math.min(1, Math.abs(v) / 127))}"><title>${escapeHtml(`${c.key} ${name} ${v}`)}</title></rect>`,
      );
    });
  });
  const yAxis = top + OUTPUT_NAMES.length * rowH + 14;
  const step = Math.max(1, Math.ceil(chain.length / 12));
  for (let i = 0; i < chain.length; i += step) parts.push(text(left + (i + 0.5) * cw, yAxis, String(i), ' text-anchor="middle"'));
  parts.push(text(left, yAxis + 16, "position on the ancestry (0 = root)"));
  parts.push("</svg>");
  const table = numbersTable(
    ["#", "lineage", "μ", "σ", "gain", "active hidden", "regimes", "entropy (bits)", ...OUTPUT_NAMES.map((o) => `mean ${o}`)],
    chain.map((c, i) => [String(i), c.key, c.mu, c.sigma, c.motGain, c.probe.activeHidden, c.probe.regimes, fixed(c.probe.regimeEntropy, 3), ...c.probe.meanOut.map((v) => fixed(v, 1))]),
  );
  return figure(
    n,
    parts.join(""),
    "Mean output of each controller output over the probe grid, one column per lineage on the ancestry. Fill strength is |mean| / 127; only moveX and moveY can be negative, and negative means use the second hue. The table adds μ, σ, motility gain, the hidden units active anywhere on the grid, and the distinct hidden activation patterns (regimes) with their entropy.",
    table,
  );
}

function fluxFigure(d: GenotypeInput, n: number): string | null {
  const rows = d.chain.map((c, i) => ({ c, i })).filter((r) => r.c.profile !== null);
  if (!rows.length) return null;
  const W = 960, H = 280, left = 64, right = 90, top = 20, bottom = 40;
  const fluxes = ["photo", "grow", "decomp", "resp"] as const;
  const colors = ["var(--accent)", "var(--pass)", "var(--accent2)", "var(--fail)"];
  const dashes = ["", "6,3", "2,2", "8,3,2,3"];
  const vals = rows.flatMap((r) => fluxes.map((f) => r.c.profile!.perCell[f]));
  const { ticks: yt, domain: yd } = ticksAndDomain(0, maxOf(vals, 0.001), 4);
  const x = linearScale([0, Math.max(1, d.chain.length - 1)], [left, W - right]);
  const y = linearScale(yd, [H - bottom, top]);
  const vb = { width: W, height: H };
  const xt = niceTicks([0, Math.max(1, d.chain.length - 1)], 8).filter((v) => v <= d.chain.length - 1 && Number.isInteger(v));
  const parts = [svgOpen(W, H, "Realized flux per cell along the ancestry")];
  parts.push(axis({ orientation: "left", scale: y, ticks: yt, at: left, gridTo: W - right, format: (v) => fixed(v, 3), viewBox: vb }));
  parts.push(axis({ orientation: "bottom", scale: x, ticks: xt, at: H - bottom, format: String, label: "position on the ancestry (0 = root)", viewBox: vb }));
  const ends: { x: number; y: number; label: string }[] = [];
  fluxes.forEach((f, j) => {
    const xs = rows.map((r) => r.i), ys = rows.map((r) => r.c.profile!.perCell[f]);
    parts.push(trace(xs, ys, x, y, [left, W - right], colors[j], 1000, dashes[j]));
    for (let q = 0; q < xs.length; q++) parts.push(`<circle cx="${num(x(xs[q]))}" cy="${num(y(ys[q]))}" r="2.5" fill="${colors[j]}" />`);
    ends.push({ x: x(xs[xs.length - 1]) + 8, y: y(ys[ys.length - 1]), label: f });
  });
  parts.push(endLabels(ends));
  parts.push("</svg>");
  const table = numbersTable(
    ["#", "lineage", "deep censuses", "cell-censuses", "roles (share of cell-censuses)", "photo / cell", "grow / cell", "decomp / cell", "resp / cell"],
    rows.map(({ c, i }) => {
      const pr = c.profile!;
      const roles = Object.entries(pr.roles).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([r, v]) => `${r} ${pct(pr.cellCensuses ? v / pr.cellCensuses : 0)}`).join(", ");
      return [String(i), c.key, int(pr.censuses), int(pr.cellCensuses), roles, fixed(pr.perCell.photo, 3), fixed(pr.perCell.grow, 3), fixed(pr.perCell.decomp, 3), fixed(pr.perCell.resp, 3)];
    }),
  );
  return figure(
    n,
    parts.join(""),
    `Realized flux per cell at deep censuses (profiles.tsv), for the ${rows.length} of ${d.chain.length} lineages on the ancestry that were alive at one. Values depend on where the cells lived as well as on the genome.`,
    table,
  );
}

function medianPeak(chain: Node[]): number {
  const p = chain.map((c) => c.peakCells).sort((a, b) => a - b);
  return p[Math.floor(p.length / 2)];
}
function byExpression(d: GenotypeInput): Record<(typeof EXPRESSIONS)[number], number> {
  const out = { controller: 0, physics: 0, "probe-silent": 0, clamped: 0 };
  for (const m of d.mutations) out[m.expression]++;
  return out;
}
const expressionList = (b: Record<(typeof EXPRESSIONS)[number], number>): string => EXPRESSIONS.map((e) => `${e} ${b[e]}`).join(", ");

/** The rule as written: every parameter printed exactly (minShare unrounded), so two different rules never read alike. */
function ruleText(r: GenotypeInput["rule"]): string {
  if (r.kind === "random") return `random (seed ${r.seed}, minimum share ${r.minShare}) at step ${int(r.step)}`;
  if (r.kind === "key") return `named lineage ${r.key}, read at step ${int(r.step)}`;
  return `${r.kind} at step ${int(r.step)}`;
}

/** Whether two resolved rules are the same rule, compared field by field rather than through their text. */
function sameRule(a: GenotypeInput["rule"], b: GenotypeInput["rule"]): boolean {
  if (a.kind !== b.kind || a.step !== b.step) return false;
  if (a.kind === "key" && b.kind === "key") return a.key === b.key;
  if (a.kind === "random" && b.kind === "random") return a.seed === b.seed && a.minShare === b.minShare;
  return true;
}

function genotypeKeyNumbers(d: GenotypeInput): KeyNumberItem[] {
  const s = d.subject, o = s.origin, subj = d.chain[d.chain.length - 1];
  const final = d.provenance.finalCensus;
  return [
    { label: "Subject lineage", value: s.key, evidence: "exact" },
    { label: "Origin", value: "founder" in o ? `founder ${o.founder}` : `minted at step ${int(o.minted)}, cell (${o.x}, ${o.y}), tile ${o.tile}`, evidence: "exact" },
    { label: `Cells at step ${int(d.rule.step)}`, value: `${int(s.cellsAtStep)} (${pct(s.shareAtStep)} of living cells)`, evidence: "exact" },
    { label: final === null ? "Alive at the last census" : `Alive at the final census (step ${int(final)})`, value: s.aliveAtEnd ? "yes" : "no", evidence: "exact" },
    { label: "Root and its genome source", value: `${d.root.key} (${d.root.source})`, evidence: "exact" },
    { label: "Depth (mutations from root)", value: String(d.mutations.length), evidence: "exact" },
    {
      label: "Ancestors checked against genomes.tsv",
      value: d.verification.against ? `${d.verification.genomesChecked} of ${d.chain.length} match` : "not cross-checked (no genomes.tsv)",
      evidence: d.verification.against ? "exact" : "not recorded",
    },
    {
      label: "mutations.tsv completeness",
      value: d.log.complete === true ? `complete: ${int(d.log.children)} children, the run's count` : d.log.complete === false ? `incomplete: ${int(d.log.children)} children, run counted ${d.log.expectedMutations === null ? "unknown" : int(d.log.expectedMutations)}` : "not checked",
      evidence: d.log.complete === true ? "exact" : "not recorded",
    },
    { label: "Mutations by expression class", value: expressionList(byExpression(d)), evidence: "exact" },
    { label: "Children minted / reached a census / descendants", value: `${int(d.offspring.childCount)} / ${int(d.offspring.childrenCensused)} / ${int(d.offspring.descendants)}`, evidence: "exact" },
    {
      label: "Tracker births touching the subject",
      value: d.trackerBirths ? `${d.trackerBirths.fission} fission, ${d.trackerBirths.budding} budding` : "not recorded",
      evidence: d.trackerBirths ? "inferred" : "not recorded",
    },
    { label: "Subject μ, σ, motility gain", value: `${subj.mu}, ${subj.sigma}, ${subj.motGain}`, evidence: "exact" },
    { label: "Genomes expressed by cells", value: d.provenance.expressed ? "yes" : `no (${d.provenance.condition ?? "condition unknown"})`, evidence: "exact" },
  ];
}

function offspringSection(d: GenotypeInput): string {
  const shown = [...d.offspring.children].sort((a, b) => b.peakCells - a.peakCells || a.minted - b.minted).slice(0, 20);
  const body = [
    para(`${int(d.offspring.childCount)} children minted from the subject, ${int(d.offspring.childrenCensused)} reached a census, ${int(d.offspring.descendants)} descendants in all, from mutations.tsv.${d.offspring.childCount > shown.length ? ` The ${shown.length} with the most peak cells are listed.` : ""}`),
  ];
  if (shown.length) body.push(tableBlock(["child", "minted at step", "first census", "peak cells"], shown.map((c) => [c.key, int(c.minted), orNone(c.firstSeen), int(c.peakCells)])));
  return section("Offspring", "exact", body.join("\n"));
}

function trackerSection(d: GenotypeInput): string {
  const t = d.trackerBirths;
  if (!t) return section("Tracker births", "not recorded", para("births.tsv is absent from this bundle (a run without --lineage-obs)."));
  const body = [
    para(`${t.fission} fission and ${t.budding} budding births touch the subject: ${t.asParent} as the parent's lineage, ${t.asChild} as the child's. The tracker attributes these births to individuals; they are not genome copies.${t.rows.length < t.fission + t.budding ? ` The first ${t.rows.length} are listed.` : ""}`),
  ];
  if (t.rows.length) {
    const cell = (r: Record<string, string>, k: string) => r[k] ?? "";
    body.push(
      tableBlock(
        ["step", "kind", "parent lineage", "child lineage", "parent cells", "parent purity", "child cells", "child purity"],
        t.rows.map((r) => [cell(r, "step"), cell(r, "kind"), cell(r, "parentLineage"), cell(r, "childLineage"), cell(r, "parentCells"), cell(r, "parentPurity"), cell(r, "childCells"), cell(r, "childPurity")]),
      ),
    );
  }
  return section("Tracker births", "inferred", body.join("\n"));
}

function twinSection(d: GenotypeInput): string {
  const t = d.twin;
  if (!t) return section("Neutral twin", "not recorded", para("No twin bundle was given (tools/lineage.ts --twin)."));
  const here = byExpression(d);
  const rows: string[][] = [
    ["run", d.provenance.runId, t.runId],
    ["condition", String(d.provenance.condition ?? "unknown"), String(t.condition ?? "unknown")],
    ["genomes expressed", d.provenance.expressed ? "yes" : "no", t.expressed ? "yes" : "no"],
    ["subject", d.subject.key, t.subject],
    ["depth", String(d.mutations.length), String(t.depth)],
    ["median ancestor peak cells", int(medianPeak(d.chain)), int(t.medianAncestorPeak)],
    ["ancestors never censused", String(d.chain.filter((c) => c.firstSeen === null).length), String(t.ancestorsNeverCensused)],
    ...EXPRESSIONS.map((e) => [`mutations: ${e}`, String(here[e]), String(t.mutationsByExpression[e])]),
    ["children / descendants", `${int(d.offspring.childCount)} / ${int(d.offspring.descendants)}`, `${int(t.childCount)} / ${int(t.descendants)}`],
    ["lineages minted in the run", int(d.log.children), int(t.lineagesMinted)],
  ];
  return section(
    "Neutral twin",
    "exact",
    [
      para(
        (sameRule(t.rule, d.rule) ?`The same subject rule (${ruleText(t.rule)}) chose the twin's subject.` : `The twin's subject was chosen by rule ${ruleText(t.rule)}; this page's subject by ${ruleText(d.rule)}.`) +
          (t.expressed ? "" : " The twin's genomes mutate but are not expressed (every cell expresses the reference phenotype), so its expression classes describe genomes that never acted."),
      ),
      tableBlock(["measure", "this run", "twin"], rows),
    ].join("\n"),
  );
}

function provenanceSection(d: GenotypeInput): string {
  const p = d.provenance;
  const rows: string[][] = [
    ["bundle", p.dir],
    ["run", p.runId],
    ["preset, condition, seed", `${p.presetId ?? "unknown"}, ${p.condition ?? "unknown"}, ${p.seed}`],
    ["census cadence", `every ${p.censusEvery ?? "unknown"} steps; deep census every ${p.deepEvery ?? "unknown"} censuses`],
    ["final census", orNone(p.finalCensus)],
    ["final hash", p.finalHash ?? "unknown"],
    ["files read", p.files.join(", ")],
    ["subject rule", ruleText(d.rule)],
    ["mutations.tsv rows / distinct children / repeated / conflicting", `${int(d.log.rows)} / ${int(d.log.children)} / ${int(d.log.duplicates)} / ${int(d.log.conflicting)}`],
  ];
  return section("Provenance", null, tableBlock(["item", "value"], rows));
}

function renderGenotype(d: GenotypeInput, meta: RenderMeta): string {
  const title = "Lineage Dossier";
  const figures: string[] = [];
  const next = () => figures.length + 1;
  const sections: string[] = [];
  // In a neutral run the genomes mutate but never control a cell: say so wherever a probe of them is shown.
  const unexpressed = d.provenance.expressed ? "" : para("In this run genomes mutate but are not expressed: every cell expresses the reference phenotype, so these probe results describe genomes that never controlled a cell.");
  const fig = (heading: string, ev: Evidence, f: string | null, lead = "") => {
    if (!f) return;
    figures.push(f);
    sections.push(section(heading, ev, lead + f));
  };
  fig("Ancestry and mutations", "exact", ancestryFigure(d, next()), unexpressed);
  fig("Population", "exact", populationFigure(d, next()));
  fig("Strategy: response to light", "exact", strategyFigure(d, next()), unexpressed);
  fig("Strategy: mean outputs along the ancestry", "exact", meanOutputFigure(d, next()), unexpressed);
  const flux = fluxFigure(d, next());
  if (flux) fig("Behaviour and energy at deep censuses", "context", flux);
  else
    sections.push(
      section(
        "Behaviour and energy at deep censuses",
        "not recorded",
        para(d.provenance.files.includes("profiles.tsv") ? "profiles.tsv records no deep-census profile for any lineage on this ancestry." : "profiles.tsv is absent from this bundle (a run without --lineage-obs)."),
      ),
    );
  sections.push(offspringSection(d), trackerSection(d), twinSection(d));
  sections.push(section("Not recorded", "not recorded", list(d.gaps)));
  sections.push(provenanceSection(d));
  const body = [
    header({
      title,
      question: `How did lineage ${d.subject.key} arise from its root ${d.root.key}, mutation by mutation, and what did each mutation change?`,
      status: meta.status,
      statusNote: `${d.provenance.runId}, one lineage chosen by rule ${ruleText(d.rule)}`,
      sources: meta.sources,
      keyNumbers: keyNumbersList(genotypeKeyNumbers(d)),
    }),
    ...sections,
    caveatsSection("Caveats", [
      caveatParagraph("Ancestry is rebuilt from the root genome, mutations.tsv and the seed: each mutation's locus and size are counter-PRNG draws keyed on (seed, step, cell). The dossier tool refuses to report when a rebuilt ancestor differs from genomes.tsv."),
      caveatParagraph("The subject is chosen by a stated rule, and a rule that picks the most abundant lineage picks a winner. The twin section names the rule that chose the twin's subject."),
      caveatParagraph("Expression classes and response curves come from a fixed grid of sensor values, not from the inputs the lineage met: probe-silent means no output moved on that grid only, and physics mutations (μ, σ, motility gain) act outside the controller."),
      caveatParagraph("Cell counts are census counts: a lineage that lived and died between two censuses is never seen."),
      caveatParagraph("Design and evidence layers: docs/lineage-inspector.md."),
    ]),
  ].join("\n");
  return pageShell({ title, bodyHtml: body });
}

// ---- pond ------------------------------------------------------------------------------------------------

function pondTraitFigure(d: PondDossier, n: number, label: string): string {
  const W = 960, H = 320, left = 70, right = 24, top = 16, bottom = 40;
  const band = d.band;
  const { ticks: xt, domain: xd } = ticksAndDomain(d.history.firstCycle, d.history.lastCycle, 8);
  const { ticks: yt, domain: yd } = ticksAndDomain(0, maxOf(band.map((b) => b.max), 1), 5);
  const x = linearScale(xd, [left, W - right]);
  const y = linearScale(yd, [H - bottom, top]);
  const vb = { width: W, height: H };
  const poly = (lo: (b: (typeof band)[number]) => number, hi: (b: (typeof band)[number]) => number) =>
    [...band.map((b) => `${num(x(b.cycle))},${num(y(hi(b)))}`), ...[...band].reverse().map((b) => `${num(x(b.cycle))},${num(y(lo(b)))}`)].join(" ");
  const chain = d.ancestry.chain;
  const subj = chain[chain.length - 1];
  const parts = [svgOpen(W, H, `${label}: trait of the subject's ancestry against all ponds`)];
  parts.push(axis({ orientation: "left", scale: y, ticks: yt, at: left, gridTo: W - right, format: int, label: "trait (B+P)", viewBox: vb }));
  parts.push(axis({ orientation: "bottom", scale: x, ticks: xt, at: H - bottom, format: String, label: "cycle", viewBox: vb }));
  if (band.length > 1) {
    parts.push(`<polygon points="${poly((b) => b.min, (b) => b.max)}" fill="var(--ci)" fill-opacity="0.6" />`);
    parts.push(`<polygon points="${poly((b) => b.q1, (b) => b.q3)}" fill="var(--muted)" fill-opacity="0.25" />`);
    parts.push(trace(band.map((b) => b.cycle), band.map((b) => b.median), x, y, [left, W - right], "var(--muted)", 10000, "4,3"));
  }
  parts.push(trace(chain.map((c) => c.cycle), chain.map((c) => c.trait), x, y, [left, W - right], "var(--accent2)", 10000));
  for (const c of chain) parts.push(`<circle cx="${num(x(c.cycle))}" cy="${num(y(c.trait))}" r="2.2" fill="var(--accent2)" />`);
  parts.push(`<circle cx="${num(x(subj.cycle))}" cy="${num(y(subj.trait))}" r="5" fill="var(--accent2)" stroke="var(--panel)" stroke-width="1.5" />`);
  parts.push(text(x(subj.cycle) - 8, y(subj.trait) - 9, `pond ${subj.pond}`, ' text-anchor="end"'));
  parts.push("</svg>");
  const table = numbersTable(
    ["cycle", "pond", "trait", "individuals", "lineages", "parent (pond at cycle)", "packet dominant lineage (share)", "ponds at subject cycle descending"],
    chain.map((c: PondNode) => [
      String(c.cycle),
      String(c.pond),
      int(c.trait),
      c.individuals === null ? "none" : int(c.individuals),
      c.lineages === null ? "unknown" : int(c.lineages),
      c.parent ? `${c.parent.pond} at ${c.parent.cycle}` : "none",
      c.packet?.dominant ? `${c.packet.dominant}${c.packet.domShare === null ? "" : ` (${pct(c.packet.domShare)})`}` : "none",
      c.descendants === null ? "n/a" : String(c.descendants),
    ]),
  );
  return figure(
    n,
    parts.join(""),
    `${label}. Trait of every pond at each boundary: range (lightest band), interquartile range (darker band) and median (dashed). The line follows the subject's ancestry, one pond per cycle${d.descent === "none" ? " (without transfers, the pond's own trajectory)" : ", each node founded by its parent's packet"}; the large dot is the subject.`,
    table,
  );
}

function pondDescentFigure(arms: { d: PondDossier; label: string; color: string; dash: string }[], n: number): string | null {
  const live = arms.filter((a) => a.d.descent === "donor-packet");
  if (!live.length) return null;
  const W = 960, H = 280, left = 70, right = 56, top = 16, bottom = 40;
  const first = Math.min(...live.map((a) => a.d.history.firstCycle)), last = Math.max(...live.map((a) => a.d.history.lastCycle));
  const { ticks: xt, domain: xd } = ticksAndDomain(first, last, 8);
  const ponds = Math.max(...live.map((a) => a.d.history.ponds));
  // The axis ends at the pond count: "every pond" is the top of the scale.
  const yt = [...niceTicks([0, ponds], 4).filter((v) => v < ponds), ponds];
  const yd: [number, number] = [0, ponds];
  const x = linearScale(xd, [left, W - right]);
  const y = linearScale(yd, [H - bottom, top]);
  const vb = { width: W, height: H };
  const parts = [svgOpen(W, H, "Descent: ponds descending from each ancestor, then clade size")];
  parts.push(axis({ orientation: "left", scale: y, ticks: yt, at: left, gridTo: W - right, format: String, label: "ponds", viewBox: vb }));
  parts.push(axis({ orientation: "bottom", scale: x, ticks: xt, at: H - bottom, format: String, label: "cycle", viewBox: vb }));
  const ends: { x: number; y: number; label: string }[] = [];
  for (const a of live) {
    const chain = a.d.ancestry.chain;
    const before = chain.map((c) => [c.cycle, c.descendants ?? 0] as const);
    const after = (a.d.clade?.series ?? []).map((p) => [p.cycle, p.size] as const);
    const pts = [...before, ...after.slice(1)];
    parts.push(trace(pts.map((p) => p[0]), pts.map((p) => p[1]), x, y, [left, W - right], a.color, 10000, a.dash));
    const s = chain[chain.length - 1];
    parts.push(`<circle cx="${num(x(s.cycle))}" cy="${num(y(s.descendants ?? 1))}" r="4" fill="${a.color}" stroke="var(--panel)" stroke-width="1.5" />`);
    const end = pts[pts.length - 1];
    ends.push({ x: x(end[0]) + 6, y: y(end[1]), label: a.label });
  }
  parts.push(endLabels(ends));
  parts.push("</svg>");
  return figure(
    n,
    parts.join(""),
    `Up to the subject's cycle: how many ponds at that cycle descend from the ancestor at each earlier cycle (the population's shared ancestry is where this equals all ${ponds} ponds). After it: the size of the subject's clade at each later cycle. The dot marks the subject${arms.length > 1 ? "; scaf solid, rand dashed" : ""}.`,
  );
}

function pondKeyNumbers(d: PondDossier): KeyNumberItem[] {
  const s = d.subject, a = d.ancestry;
  const lastClade = d.clade?.series[d.clade.series.length - 1];
  return [
    { label: "Arm", value: d.arm ?? "not supplied", evidence: d.arm ? "exact" : "not recorded" },
    { label: "Subject", value: `pond ${s.pond} at cycle ${s.cycle} (step ${int(s.step)})`, evidence: "exact" },
    { label: "Trait (B+P) and rank", value: `${int(s.trait)}, rank ${s.rank} of ${s.of}`, evidence: "exact" },
    { label: "Descent", value: d.descent === "donor-packet" ? "donor packets (ponds.tsv)" : "none: no transfer in this history", evidence: "exact" },
    { label: "Transfers from root to subject", value: `${a.depth} (root pond ${a.rootPond} at cycle ${a.rootCycle})`, evidence: "exact" },
    { label: "Distinct donor ponds on the ancestry", value: String(a.distinctDonorPonds), evidence: "exact" },
    { label: "Latest cycle every pond at the subject's cycle descends from", value: orNone(a.commonAncestorCycle, String), evidence: "exact" },
    {
      label: "Recipients seeded from the subject",
      value: d.offspring ? `${d.offspring.count}${d.offspring.measured ? "" : " (seeded at the last boundary, never measured)"}` : "none (no transfer)",
      evidence: "exact",
    },
    {
      label: "Clade at the history's last cycle: ponds / with trait > 0",
      value: lastClade ? `cycle ${lastClade.cycle}: ${lastClade.size} / ${lastClade.eligible}${d.clade!.extinctAt !== null ? `, no pond from cycle ${d.clade!.extinctAt}` : ""}` : "none (no transfer)",
      evidence: "exact",
    },
  ];
}

function pondOffspringSection(d: PondDossier, label: string): string {
  const o = d.offspring;
  if (!o) return section(`${label}: offspring`, "exact", para("No transfer is recorded, so the pond seeds no other pond."));
  const body = [para(`${o.count} recipient pond(s) were seeded from the subject at its boundary${o.measured ? "" : "; the history ends there, so they were never measured"}.`)];
  if (o.children.length)
    body.push(
      tableBlock(
        ["pond", "cycle", "trait", "ponds it seeded", "cells landed", "B+P retained", "dominant lineage (share)"],
        o.children.map((c) => [
          String(c.pond),
          String(c.cycle),
          c.trait === null ? "unmeasured" : int(c.trait),
          c.seeded === null ? "unmeasured" : String(c.seeded),
          c.packet.landed === null ? "unknown" : int(c.packet.landed),
          c.packet.retMass === null ? "unknown" : int(c.packet.retMass),
          c.packet.dominant ? `${c.packet.dominant}${c.packet.domShare === null ? "" : ` (${pct(c.packet.domShare)})`}` : "none",
        ]),
      ),
    );
  return section(`${label}: offspring`, "exact", body.join("\n"));
}

function pondTextSections(d: PondDossier, label: string): string[] {
  const out: string[] = [];
  if (d.notes.length) out.push(section(`${label}: notes from the dossier`, null, list(d.notes)));
  if (d.warnings.length) out.push(section(`${label}: warnings`, null, list(d.warnings)));
  out.push(section(`${label}: not recorded`, "not recorded", list(d.gaps)));
  return out;
}

function ruleTextPond(d: PondDossier): string {
  const r = d.subject.rule;
  if (r.kind === "random") return `random (seed ${r.seed}, trait at least ${r.minTrait}) at cycle ${r.cycle}`;
  return `${r.kind} at cycle ${r.cycle}`;
}

const POND_CAVEATS = [
  "A node is a pond's pre-cycle snapshot at a boundary; its parent is the donor whose k x k packet reseeded it at the previous boundary, copied bit for bit (ponds.tsv). Descent is therefore exact.",
  "Trait is B+P over the cells with B+P of at least 48 in the pre-cycle snapshot.",
  "Design: docs/lineage-inspector.md (section 7) and the scaffold protocol.",
];

function renderPond(d: PondDossier, meta: RenderMeta): string {
  const title = "Pond Lineage Dossier";
  const label = d.arm ?? "history";
  const sections: string[] = [];
  let n = 0;
  sections.push(section("Ancestry and trait", "exact", pondTraitFigure(d, ++n, label)));
  const descent = pondDescentFigure([{ d, label, color: "var(--accent)", dash: "" }], n + 1);
  if (descent) {
    n++;
    sections.push(section("Descent and clade", "exact", descent));
  }
  sections.push(pondOffspringSection(d, label), ...pondTextSections(d, label));
  const body = [
    header({
      title,
      question: `Which ponds' packets founded pond ${d.subject.pond} at cycle ${d.subject.cycle}, and how far did its descent spread?`,
      status: meta.status,
      statusNote: `arm ${d.arm ?? "not supplied"}, ${d.history.ponds} ponds, cycles ${d.history.firstCycle} to ${d.history.lastCycle}, subject by rule ${ruleTextPond(d)}`,
      sources: meta.sources,
      keyNumbers: keyNumbersList(pondKeyNumbers(d)),
    }),
    ...sections,
    caveatsSection("Caveats", POND_CAVEATS.map(caveatParagraph)),
  ].join("\n");
  return pageShell({ title, bodyHtml: body });
}

function renderPondTwin(t: PondTwin, meta: RenderMeta): string {
  const title = "Pond Lineage Twin";
  const arms = [
    { d: t.scaf, label: "scaf", color: "var(--accent)", dash: "" },
    { d: t.rand, label: "rand", color: "var(--accent2)", dash: "5,3" },
  ];
  const sections: string[] = [];
  let n = 0;
  for (const a of arms) sections.push(section(`${a.label}: ancestry and trait`, "exact", pondTraitFigure(a.d, ++n, a.label)));
  const descent = pondDescentFigure(arms, n + 1);
  if (descent) {
    n++;
    sections.push(section("Descent and clade, both arms", "exact", descent));
  }
  const kn = arms.map((a) => pondKeyNumbers(a.d));
  const compare = kn[0].map((item, i) => [item.label, item.value, kn[1][i].value]);
  sections.push(section("Side by side", "exact", [para(`The same rule (${ruleTextPond(t.scaf)}) on both histories.`), list(t.notes), tableBlock(["measure", "scaf", "rand"], compare)].join("\n")));
  for (const a of arms) sections.push(pondOffspringSection(a.d, a.label), ...pondTextSections(a.d, a.label));
  const body = [
    header({
      title,
      question: `How does the ancestry of the rule-chosen pond differ between the scaf history and its rand twin?`,
      status: meta.status,
      statusNote: `scaf and rand histories of ${t.scaf.history.ponds} ponds, subject by rule ${ruleTextPond(t.scaf)}`,
      sources: meta.sources,
      keyNumbers: keyNumbersList([
        { label: "scaf subject", value: `pond ${t.scaf.subject.pond} at cycle ${t.scaf.subject.cycle}, trait ${int(t.scaf.subject.trait)}`, evidence: "exact" },
        { label: "rand subject", value: `pond ${t.rand.subject.pond} at cycle ${t.rand.subject.cycle}, trait ${int(t.rand.subject.trait)}`, evidence: "exact" },
        { label: "Distinct donor ponds on the ancestry (scaf / rand)", value: `${t.scaf.ancestry.distinctDonorPonds} / ${t.rand.ancestry.distinctDonorPonds}`, evidence: "exact" },
        { label: "Latest shared-ancestry cycle (scaf / rand)", value: `${orNone(t.scaf.ancestry.commonAncestorCycle, String)} / ${orNone(t.rand.ancestry.commonAncestorCycle, String)}`, evidence: "exact" },
      ]),
    }),
    ...sections,
    caveatsSection("Caveats", POND_CAVEATS.map(caveatParagraph)),
  ].join("\n");
  return pageShell({ title, bodyHtml: body });
}

export function render(data: LineageInput, meta: RenderMeta): string {
  if (data.kind === "genotype") return renderGenotype(data, meta);
  if (data.kind === "pond") return renderPond(data, meta);
  return renderPondTwin(data, meta);
}
