// Helpers the lineage panel (lineage.ts) and its pond-route figure (lineage-route.ts) share, kept in their own
// module so the two import in one direction. Pure string builders, as in page.ts and svg.ts.
import type { GenotypeInput } from "./lineage.ts";
import { escapeHtml } from "./page.ts";
import { niceTicks, num } from "./svg.ts";

/** Expression classes of a mutation on the probe grid (tools/lib/lineage.ts). */
export const EXPRESSIONS = ["controller", "physics", "probe-silent", "clamped"] as const;
export type Expression = (typeof EXPRESSIONS)[number];

/** Extremes by loop: series can hold more entries than a spread call accepts as arguments. */
export function maxOf(vals: Iterable<number>, floor: number): number {
  let m = floor;
  for (const v of vals) if (v > m) m = v;
  return m;
}

export const int = (v: number): string => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
export const pct = (v: number): string => `${(100 * v).toFixed(1)}%`;

/** `minWidth` (CSS px) raises the page's 540px floor for one figure; its box scrolls sideways on a narrow screen. */
export const svgOpen = (w: number, h: number, label: string, minWidth?: number): string =>
  `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeHtml(label)}"${minWidth ? ` style="min-width:${minWidth}px"` : ""}>`;
export const text = (x: number, y: number, s: string, extra = ""): string =>
  `<text x="${num(x)}" y="${num(y)}" fill="var(--muted)" font-size="10"${extra}>${escapeHtml(s)}</text>`;

/** Ticks spanning `domain` and the domain widened to them, so the axis ends on a tick. */
export function ticksAndDomain(lo: number, hi: number, count: number): { ticks: number[]; domain: [number, number] } {
  const ticks = niceTicks([lo, hi > lo ? hi : lo + 1], count);
  return { ticks, domain: [ticks[0], ticks[ticks.length - 1]] };
}

/**
 * The step axis runs to the run's final census, or further when an ancestor is seen later or a given pond anchor
 * (`pond.anchor`, at cycle x period) lies beyond it, so every drawn node stays inside both figures.
 */
export function endStep(d: GenotypeInput): number {
  const last = d.population.steps[d.population.steps.length - 1];
  const a = d.pond?.anchor;
  const anchor = d.pond && a && a.source === "given" ? [a.cycle * d.pond.period] : [];
  return maxOf([...d.chain.map((c) => c.lastSeen ?? c.minted ?? 0), ...anchor], Math.max(1, d.provenance.finalCensus ?? last));
}

/** Expression-class marker at (x, y): shape and fill differ, so the class never rests on colour alone. */
export function marker(kind: Expression | "root", x: number, y: number): string {
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
