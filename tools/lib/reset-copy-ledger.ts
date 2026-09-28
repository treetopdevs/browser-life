/** Mutation-enabled, read-only copy-path audit. It never relabels a physical genome. */
import { CH, G, GENOME_CHANNELS, canonicalConfig, cellCount, packLineageLo,
  stateHash, validateState, type WorldState } from "@bl/schema";
import type { MutationEvent } from "@bl/sim-ref";
import { localDisplacement } from "./foundation-local-flow.ts";
import { transportDestinationAudit, type TransportSourceShare,
  type TransportView } from "./foundation-material-flow.ts";

export type CopySource = { checkpointStep: number; cellIndex: number;
  referenceRegion: "attributed-parent-support" | "other-support" | "unassigned";
  olderAncestry: "unknown-before-checkpoint" };
export type CopyAvailability = "linked-to-checkpoint-cell" | "unavailable-unobserved-path" |
  "unavailable-no-living-winner" | "none-no-bound-structure";
export type MutationClassification = "effective-genotype-change" |
  "clamped-or-no-change-proposal" | "transient-after-death";

export interface ResetCellObservation {
  step: number; index: number; incoming: { B: number; P: number; E: number };
  /** Exact previous-site shares before reaction, not molecular ancestry after mixing. */
  sourceShares: TransportSourceShare[];
  winnerSourceIndex: number | null; winnerLineage: string | null;
  copySource: CopySource | null; copyAvailability: CopyAvailability;
  attributedParentCopy: "supported-by-local-parent-reference" |
    "from-other-local-reference" | "unavailable";
  mutation: { parentLineage: string; childLineage: string;
    classification: MutationClassification } | null;
  afterBound: number; netPostReactionBoundChange: number;
  materialInterpretation: "prior-site-transport-only-postreaction-ownership-unknown";
}
export interface ResetStepObservation {
  beforeStep: number; afterStep: number; propagatedLivingCells: number;
  observedCells: ResetCellObservation[]; uninspectedMutationEvents: number;
  continuousCoverage: boolean;
}

const label = (genome: Uint32Array, n: number, index: number) =>
  `${genome[G.LIN_HI * n + index]}:${genome[G.LIN_LO * n + index]}`;
const validIndex = (index: number, n: number) =>
  Number.isSafeInteger(index) && index >= 0 && index < n;
const keyOf = (e: MutationEvent) => `${e.childHi}:${e.childLo}`;
const sameNonLabelGenome = (before: WorldState, source: number,
  after: WorldState, destination: number) => {
  const n = cellCount(before.cfg);
  for (let g = 2; g < GENOME_CHANNELS; g++)
    if (before.genome[g * n + source] !== after.genome[g * n + destination]) return false;
  return true;
};

/**
 * `propagate` must cover each required copy path at every intervening step.
 * A skipped destination loses its tag; later visits cannot restore it by matching a lineage ID.
 * Passing `displacement` from the reference flow phase is a test oracle. Production callers
 * must reconstruct/validate it from the actual pre-step state before using these labels.
 */
export class ResetCopyLedger {
  private readonly n: number;
  private tags: (CopySource | null)[];
  private expectedStep: number;
  private expectedHash: string;
  constructor(checkpoint: WorldState, options: { parentSites?: readonly number[] } = {}) {
    const errors = validateState(checkpoint);
    if (errors.length) throw new Error(`invalid copy-ledger checkpoint: ${errors.join("; ")}`);
    this.n = cellCount(checkpoint.cfg);
    const parentSites = new Set(options.parentSites ?? []);
    if (options.parentSites && (parentSites.size !== options.parentSites.length ||
        parentSites.size === 0 || [...parentSites].some(i => !validIndex(i, this.n) ||
          checkpoint.cells[CH.B * this.n + i] + checkpoint.cells[CH.P * this.n + i] === 0)))
      throw new Error("event-local parent reference has invalid or empty physical support");
    this.tags = Array.from({ length: this.n }, (_, i) => {
      const bound = checkpoint.cells[CH.B * this.n + i] + checkpoint.cells[CH.P * this.n + i];
      return bound > 0 && label(checkpoint.genome, this.n, i) !== "0:0" ?
        { checkpointStep: checkpoint.step, cellIndex: i,
          referenceRegion: options.parentSites ? parentSites.has(i) ?
            "attributed-parent-support" as const : "other-support" as const : "unassigned" as const,
          olderAncestry: "unknown-before-checkpoint" as const } : null;
    });
    this.expectedStep = checkpoint.step;
    this.expectedHash = stateHash(checkpoint);
  }

  /** The continuously observed checkpoint source tag, if this site's path remains covered. */
  tagAt(index: number): CopySource | null {
    if (!validIndex(index, this.n)) throw new Error("invalid copy-ledger tag index");
    return this.tags[index];
  }

  observeStep(before: WorldState, after: WorldState, events: readonly MutationEvent[],
    options: { propagate?: readonly number[] | "all"; record?: readonly number[];
      displacement?: Uint32Array | ((sourceIndex: number) => number) } = {}): ResetStepObservation {
    if (before.step !== this.expectedStep || after.step !== before.step + 1 ||
        stateHash(before) !== this.expectedHash ||
        canonicalConfig(before.cfg) !== canonicalConfig(after.cfg) ||
        this.n !== cellCount(after.cfg))
      throw new Error("copy-ledger step is not a continuous identical-config physical replay");
    const afterErrors = validateState(after);
    if (afterErrors.length) throw new Error(`invalid post-step state: ${afterErrors.join("; ")}`);
    const propagate = options.propagate === undefined || options.propagate === "all" ?
      Array.from({ length: this.n }, (_, i) => i) : [...options.propagate];
    if (new Set(propagate).size !== propagate.length ||
        propagate.some(i => !validIndex(i, this.n)))
      throw new Error("copy-ledger propagation indices are duplicate or invalid");
    const propagated = new Set(propagate);
    const record = options.record ?? propagate;
    if (new Set(record).size !== record.length ||
        record.some(i => !validIndex(i, this.n) || !propagated.has(i)))
      throw new Error("copy-ledger recorded indices must be distinct propagated destinations");
    const recorded = new Set(record), next: (CopySource | null)[] = Array(this.n).fill(null);
    const view: TransportView = { cfg: before.cfg, step: before.step, cells: before.cells,
      genomeHead: before.genome.subarray(0, 4 * this.n) };
    const displacementCache = new Map<number, number>();
    const displacement = (sourceIndex: number) => {
      const supplied = options.displacement;
      if (supplied instanceof Uint32Array) return supplied[sourceIndex];
      if (typeof supplied === "function") return supplied(sourceIndex);
      let packed = displacementCache.get(sourceIndex);
      if (packed === undefined) {
        packed = localDisplacement(view, sourceIndex);
        displacementCache.set(sourceIndex, packed);
      }
      return packed;
    };
    if (options.displacement instanceof Uint32Array && options.displacement.length !== this.n)
      throw new Error("copy-ledger displacement field length mismatch");
    const mutations = new Map<string, MutationEvent>();
    for (const e of events) {
      const k = keyOf(e);
      if (e.childHi !== after.step || mutations.has(k))
        throw new Error("copy-ledger mutation event step or identity invalid");
      mutations.set(k, e);
    }
    const used = new Set<string>(), observedCells: ResetCellObservation[] = [];
    let propagatedLivingCells = 0;
    for (const i of propagate) {
      const afterBound = after.cells[CH.B * this.n + i] + after.cells[CH.P * this.n + i];
      const eventKey = `${after.step}:${packLineageLo(before.cfg, i)}`;
      const mutation = mutations.get(eventKey) ?? null;
      if (mutation) used.add(eventKey);
      // No surviving bound material and no mutation event: there is no genome copy to propagate.
      if (afterBound === 0 && !mutation) {
        if (recorded.has(i)) {
          const audit = transportDestinationAudit(view, displacement, i);
          observedCells.push({ step: after.step, index: i,
            incoming: audit.incoming, sourceShares: audit.sources,
            winnerSourceIndex: audit.genomeWinnerSourceIndex,
            winnerLineage: audit.genomeWinnerLineage, copySource: null,
            copyAvailability: "none-no-bound-structure", attributedParentCopy: "unavailable",
            mutation: null, afterBound: 0,
            netPostReactionBoundChange: -audit.incoming.B - audit.incoming.P,
            materialInterpretation: "prior-site-transport-only-postreaction-ownership-unknown" });
        }
        continue;
      }
      const audit = transportDestinationAudit(view, displacement, i);
      const sourceIndex = audit.genomeWinnerSourceIndex;
      const winnerLineage = audit.genomeWinnerLineage;
      const afterLineage = label(after.genome, this.n, i);
      if (mutation && (mutation.parentHi + ":" + mutation.parentLo !== winnerLineage ||
          mutation.childHi !== after.step || mutation.childLo !== packLineageLo(before.cfg, i)))
        throw new Error(`mutation parent/child differs from actual transport winner at ${i}`);
      if (afterBound > 0 && (mutation ? afterLineage !== keyOf(mutation) :
          afterLineage !== (winnerLineage ?? "0:0")))
        throw new Error(`postreaction lineage differs from lottery/mutation at ${i}`);
      const source = sourceIndex === null ? null : this.tags[sourceIndex];
      const availability: CopyAvailability = afterBound === 0 ? "none-no-bound-structure" :
        sourceIndex === null || winnerLineage === "0:0" ? "unavailable-no-living-winner" :
        source === null ? "unavailable-unobserved-path" : "linked-to-checkpoint-cell";
      if (afterBound > 0) {
        propagatedLivingCells++;
        next[i] = source;
      }
      const mutationRecord = mutation ? { parentLineage: `${mutation.parentHi}:${mutation.parentLo}`,
        childLineage: `${mutation.childHi}:${mutation.childLo}`,
        classification: afterBound === 0 ? "transient-after-death" as const :
          sameNonLabelGenome(before, sourceIndex!, after, i) ?
            "clamped-or-no-change-proposal" as const : "effective-genotype-change" as const } : null;
      if (recorded.has(i)) observedCells.push({ step: after.step, index: i,
        incoming: audit.incoming, sourceShares: audit.sources,
        winnerSourceIndex: sourceIndex, winnerLineage,
        copySource: availability === "linked-to-checkpoint-cell" ? source : null,
        copyAvailability: availability,
        attributedParentCopy: availability !== "linked-to-checkpoint-cell" ? "unavailable" :
          source?.referenceRegion === "attributed-parent-support" ?
            "supported-by-local-parent-reference" :
          source?.referenceRegion === "other-support" ? "from-other-local-reference" : "unavailable",
        mutation: mutationRecord,
        afterBound, netPostReactionBoundChange: afterBound - audit.incoming.B - audit.incoming.P,
        materialInterpretation: "prior-site-transport-only-postreaction-ownership-unknown" });
    }
    this.tags = next;
    this.expectedStep = after.step;
    this.expectedHash = stateHash(after);
    return { beforeStep: before.step, afterStep: after.step, propagatedLivingCells,
      observedCells, uninspectedMutationEvents: mutations.size - used.size,
      continuousCoverage: propagate.length === this.n && mutations.size === used.size };
  }
}
