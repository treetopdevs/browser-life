import type { Edge, RemnantTrack } from "../recovery-accessibility/observer.ts";
function continuation(
  label: number | null,
  edges: Edge[],
): { label: number | null; fusion: boolean; split: boolean } {
  if (label === null) return { label: null, fusion: false, split: false };
  const grouped = new Map<number, Map<number, number>>();
  for (const e of edges) {
    const group = grouped.get(e.from) ?? new Map<number, number>();
    group.set(e.to, e.cells);
    grouped.set(e.from, group);
  }
  const main = new Map<number, number>(), parents = new Map<number, number[]>();
  for (const [p, group] of grouped) {
    for (const [q, weight] of group) {
      const best = main.get(q);
      if (best === undefined || weight > grouped.get(best)!.get(q)!) {
        main.set(q, p);
      }
      parents.set(q, [...(parents.get(q) ?? []), p]);
    }
  }
  const children = new Map<number, number[]>();
  for (const [q, p] of main) children.set(p, [...(children.get(p) ?? []), q]);
  const own = children.get(label) ?? [];
  own.sort((a, b) => grouped.get(label)!.get(b)! - grouped.get(label)!.get(a)!);
  let fusion = false;
  for (const [q, ps] of parents) {
    const owner = main.get(q)!;
    const absorbed = ps.filter((p) => p !== owner && !children.has(p));
    if (absorbed.length && (owner === label || absorbed.includes(label))) {
      fusion = true;
    }
  }
  return { label: own[0] ?? null, fusion, split: own.length > 1 };
}

/** Independently reconstruct retained continuity from ordered overlap evidence. */
export function validateTrack(
  t: ReturnType<RemnantTrack["result"]>,
  reference: number,
  cadence: 25 | 50,
  start: number,
): void {
  if (t.history.length !== 2000 / cadence) {
    throw new Error("incomplete recovery observations");
  }
  let label = t.initialLabel, lost = label === null, merged = false;
  for (let i = 0; i < t.history.length; i++) {
    const row = t.history[i];
    if (
      row.step !== start + (i + 1) * cadence ||
      !Number.isSafeInteger(row.mass) || row.mass < 0
    ) throw new Error("track cadence/mass mismatch");
    if (row.label !== null && (!Number.isInteger(row.label) || row.label < 0)) {
      throw new Error("invalid component label");
    }
    if (row.label === null ? row.mass !== 0 : row.mass < 128) {
      throw new Error("ineligible retained component mass");
    }
    const seen = new Set<string>();
    for (const edge of row.edges) {
      const key = `${edge.from}:${edge.to}`;
      if (
        ![edge.from, edge.to, edge.cells].every(Number.isSafeInteger) ||
        edge.from < 0 || edge.to < 0 || edge.cells < 1 || seen.has(key)
      ) throw new Error("invalid overlap edge");
      seen.add(key);
    }
    const derived = continuation(label, row.edges);
    if (derived.split !== row.split) {
      throw new Error("split flag disagrees with edges");
    }
    if (derived.label !== row.label) {
      throw new Error("wrong retained continuation");
    }
    if (derived.fusion) merged = true;
    if (label === null && row.label !== null) {
      throw new Error("lost remnant replaced");
    }
    if (
      row.label !== null &&
      !row.edges.some((e) => e.from === label && e.to === row.label)
    ) throw new Error("continuation without overlap");
    if (row.label === null) lost = true;
    if (
      row.label !== null &&
      row.edges.some((e) => e.to === row.label && e.from !== label)
    ) merged = true;
    if (
      row.label === null && label !== null &&
      row.edges.some((e) =>
        e.from === label &&
        row.edges.some((other) => other.to === e.to && other.from !== label)
      )
    ) merged = true;
    // A fusion involving the retained ID is an incoming overlap or loss of that ID.
    if (row.lost !== lost || row.merged !== merged) {
      throw new Error("continuity flags disagree with edges");
    }
    label = row.label;
  }
  const mass = t.history.at(-1)!.mass;
  const retained = !lost && reference > 0 && 10 * mass >= 9 * reference;
  if (
    t.mass !== mass || t.lost !== lost || t.merged !== merged ||
    t.retained !== retained || t.recovered !== (retained && !merged)
  ) throw new Error("track decision mismatch");
}
