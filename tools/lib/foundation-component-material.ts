/** One-step, pre-reaction material shares for a selected observed component. */
import { CH, G, cellCount } from "@bl/schema";
import { census, DEFAULT_CENSUS } from "@bl/metrics";
import { assertColorSnapshotParity, type ColorSnapshot } from "./foundation-copy-ancestry.ts";
import { localDisplacement } from "./foundation-local-flow.ts";
import { transportDestinationAudit, validateTransportInput, type TransportView } from
  "./foundation-material-flow.ts";

export interface MeasuredTransportView extends TransportView, ColorSnapshot {}
export interface ComponentMaterialEvidence {
  componentIndex: number;
  step: number;
  cells: number;
  /** Exact incoming B/P/E at these destination sites, before reaction. */
  incoming: { B: string; P: string; E: string };
  /** One-step source-site component regions; unassigned includes subthreshold sites. */
  incomingByPriorComponent: Record<string, { B: string; P: string; E: string }>;
  /** Net bound change across reaction in the selected destination sites, not A-derived synthesis. */
  postReactionBoundMinusIncomingBound: string;
  genomeCopyValidation: "all-matched" | "partial-unavailable-no-winner";
  noIncomingGenomeWinnerCells: number;
  reactionMaterialOwnership: "unavailable-after-mixing";
}

const labelAt = (view: MeasuredTransportView, i: number) => {
  const n = cellCount(view.cfg);
  return `${view.genomeHead[G.LIN_HI * n + i]}:${view.genomeHead[G.LIN_LO * n + i]}`;
};

/**
 * Audits the actual transport lottery and material shares from the unchanged
 * pre-step state. Reaction ownership is deliberately not invented afterward.
 */
export function componentMaterialEvidence(before: MeasuredTransportView, beforeColored: MeasuredTransportView,
  after: MeasuredTransportView, afterColored: MeasuredTransportView,
  componentIndex: number): ComponentMaterialEvidence {
  for (const view of [before, beforeColored, after, afterColored]) validateTransportInput(view);
  if (after.step !== before.step + 1 || beforeColored.step !== before.step ||
      afterColored.step !== after.step || JSON.stringify(before.cfg) !== JSON.stringify(after.cfg) ||
      JSON.stringify(before.cfg) !== JSON.stringify(beforeColored.cfg) ||
      JSON.stringify(after.cfg) !== JSON.stringify(afterColored.cfg))
    throw new Error("material evidence requires consecutive matching physical worlds");
  assertColorSnapshotParity(before, beforeColored);
  assertColorSnapshotParity(after, afterColored);
  const n = cellCount(before.cfg);
  const prior = census({ cfg: before.cfg, step: before.step, cells: before.cells,
    genomeHead: before.genomeHead }, DEFAULT_CENSUS);
  const current = census({ cfg: after.cfg, step: after.step, cells: after.cells,
    genomeHead: after.genomeHead }, DEFAULT_CENSUS);
  const component = current.components[componentIndex];
  if (!component) throw new Error("material evidence component is missing");
  const displacement = new Map<number, number>();
  const disp = (source: number) => {
    let value = displacement.get(source);
    if (value === undefined) { value = localDisplacement(before, source); displacement.set(source, value); }
    return value;
  };
  const byRegion = new Map<string, { B: bigint; P: bigint; E: bigint }>();
  let B = 0n, P = 0n, E = 0n, afterBound = 0n, noWinner = 0;
  for (let i = 0; i < n; i++) if (current.labels[i] === componentIndex) {
    const audit = transportDestinationAudit(before, disp, i);
    B += BigInt(audit.incoming.B); P += BigInt(audit.incoming.P); E += BigInt(audit.incoming.E);
    afterBound += BigInt(after.cells[CH.B * n + i]) + BigInt(after.cells[CH.P * n + i]);
    if (audit.genomeWinnerSourceIndex === null) {
      // Reaction may create bound matter on a site with no incoming genome.
      // That cell has no copy-source attribution, not a failed physical replay.
      if (labelAt(after, i) !== "0:0" || labelAt(afterColored, i) !== "0:0")
        throw new Error(`genome appeared without a transport winner at cell ${i}`);
      noWinner++;
    } else if (audit.genomeWinnerLineage !== labelAt(after, i) ||
        labelAt(beforeColored, audit.genomeWinnerSourceIndex) !== labelAt(afterColored, i))
      throw new Error(`genome lottery/copy observation mismatch at cell ${i}`);
    for (const share of audit.sources) {
      const priorComponent = prior.labels[share.sourceIndex];
      const key = priorComponent < 0 ? "unassigned-or-subthreshold" : String(priorComponent);
      let row = byRegion.get(key);
      if (!row) byRegion.set(key, (row = { B: 0n, P: 0n, E: 0n }));
      row.B += BigInt(share.B); row.P += BigInt(share.P); row.E += BigInt(share.E);
    }
  }
  const incomingByPriorComponent = Object.fromEntries([...byRegion].sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => [key, { B: String(value.B), P: String(value.P), E: String(value.E) }]));
  if (["B", "P", "E"].some((key) => Object.values(incomingByPriorComponent)
    .reduce((v, row) => v + BigInt(row[key as "B" | "P" | "E"]), 0n) !==
      ({ B, P, E })[key as "B" | "P" | "E"]))
    throw new Error("component material source totals do not close");
  return { componentIndex, step: after.step, cells: component.cells,
    incoming: { B: String(B), P: String(P), E: String(E) }, incomingByPriorComponent,
    postReactionBoundMinusIncomingBound: String(afterBound - B - P),
    genomeCopyValidation: noWinner ? "partial-unavailable-no-winner" : "all-matched",
    noIncomingGenomeWinnerCells: noWinner, reactionMaterialOwnership: "unavailable-after-mixing" };
}
