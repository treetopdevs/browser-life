/** Pure prospective A2 recruitment. Inputs are continuous-copy and physical-separation certificates. */
import { createHash } from "node:crypto";

export const V2_RECRUITMENT_END = 1000;
export const V2_CENSUS_EVERY = 25;
export const V2_MIN_MASS = 256;
export const V2_SELECTION_SALT = "foundation-serial-v2/first-separate-copy-linked/v1";

export interface CopyLinkedComponent {
  /** Index in the complete current census, including subeligible components. */
  componentIndex: number;
  cells: number;
  mass: number;
  /** One entry per member cell: initial inoculum source site, or -1 if the copy link is unavailable. */
  initialCopySourceByCell: number[];
  /** Coverage of every intermediate genome-copy transition from placement to this census. */
  continuousCopyCoverage: "complete" | "unavailable";
  /** Independent geometry/continuity diagnosis; translation or mixing must not be called separation. */
  physicalSeparation: "confirmed" | "ambiguous" | "not-separate";
  /** Optional, stronger diagnosis that must never be a universal recruitment requirement. */
  immediateParentSplit: "confirmed" | "ambiguous" | "not-observed";
  /** Equal non-lineage genome words throughout this component, checked before extraction. */
  singleGenotype: boolean;
  /** Physical membership digest from the current census. */
  memberSha256: string;
}

export interface CopyTransitionFrame {
  /** Current census step; provenance binds continuous sidecar coverage from placement. */
  step: number;
  currentStateHash: string;
  /** SHA of the independently validated continuous per-cell copy-link map. */
  copyMapSha256: string;
  /** SHA of independent physical-separation evidence; no observer ID alone is sufficient. */
  separationEvidenceSha256: string;
  initialSourceCellCount: number;
  components: CopyLinkedComponent[];
}

export interface V2SelectionIdentity {
  sourceKey: string;
  arm: "donor" | "founder-genotype" | "zero-controller-genotype";
  stage: 0 | 1 | 2;
  seed: number;
}

export interface V2Candidate {
  step: number;
  componentIndex: number;
  memberSha256: string;
  mass: number;
  initialCopySourceCells: number[];
  immediateParentSplit: CopyLinkedComponent["immediateParentSplit"];
  rejectionReasons: string[];
  selectionSha256: string;
  disposition: "rejected" | "eligible-not-selected" | "selected" | "eligible-after-selection";
}

export interface V2Selection {
  status: "pending" | "selected" | "no-eligible-transition";
  selected: V2Candidate | null;
  candidates: V2Candidate[];
  framesInspected: number;
  lastStep: number;
  /** Extraction is deliberately absent. A failed selected packet cannot cause reselection. */
  limitation: string;
}

const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const hex64 = (s: string) => /^[a-f0-9]{64}$/.test(s);
const fail = (s: string): never => { throw new Error(`invalid A2 copy transition: ${s}`); };

function validateFrame(frame: CopyTransitionFrame): void {
  if (!Number.isSafeInteger(frame.step) || frame.step < V2_CENSUS_EVERY ||
      frame.step > V2_RECRUITMENT_END || frame.step % V2_CENSUS_EVERY !== 0 ||
      !Number.isSafeInteger(frame.initialSourceCellCount) || frame.initialSourceCellCount < 1)
    fail("invalid census step or initial source count");
  if (![frame.currentStateHash, frame.copyMapSha256, frame.separationEvidenceSha256].every(hex64))
    fail("missing state/copy-map hashes");
  const seen = new Set<number>();
  for (const c of frame.components) {
    if (!Number.isSafeInteger(c.componentIndex) || c.componentIndex < 0 || seen.has(c.componentIndex))
      fail("duplicate or invalid current component index");
    seen.add(c.componentIndex);
    if (!Number.isSafeInteger(c.cells) || c.cells < 1 || !Number.isSafeInteger(c.mass) || c.mass < 0 ||
        c.initialCopySourceByCell.length !== c.cells || typeof c.singleGenotype !== "boolean" ||
        !["complete", "unavailable"].includes(c.continuousCopyCoverage) ||
        !["confirmed", "ambiguous", "not-separate"].includes(c.physicalSeparation) ||
        !["confirmed", "ambiguous", "not-observed"].includes(c.immediateParentSplit) ||
        !hex64(c.memberSha256)) fail("incomplete current component record");
    if (c.initialCopySourceByCell.some((x) => !Number.isSafeInteger(x) || x < -1 ||
        x >= frame.initialSourceCellCount)) fail("copy source outside initial inoculum");
  }
  for (let i = 0; i < frame.components.length; i++) if (!seen.has(i)) fail("current census is incomplete");
}

/** Selects from the complete frozen 25-step census stream. No biological outcome enters ranking. */
export function selectFirstCopyLinkedTransition(identity: V2SelectionIdentity,
  frames: readonly CopyTransitionFrame[]): V2Selection {
  if (!identity.sourceKey || !Number.isSafeInteger(identity.seed) || identity.seed <= 0 ||
      ![0, 1, 2].includes(identity.stage) ||
      !["donor", "founder-genotype", "zero-controller-genotype"].includes(identity.arm) ||
      (identity.stage > 0 && identity.arm === "zero-controller-genotype"))
    fail("invalid selection identity");
  const candidates: V2Candidate[] = [];
  let selected: V2Candidate | null = null;
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    validateFrame(frame);
    if (frame.step !== (i + 1) * V2_CENSUS_EVERY) fail("missing or reordered census frame");
    const atStep: V2Candidate[] = frame.components.map((c) => {
      const reasons: string[] = [];
      if (c.mass < V2_MIN_MASS) reasons.push("below-minimum-mass");
      if (!c.singleGenotype) reasons.push("mixed-genotype");
      if (c.continuousCopyCoverage !== "complete" || c.initialCopySourceByCell.includes(-1))
        reasons.push("continuous-copy-link-unavailable");
      if (c.physicalSeparation !== "confirmed") reasons.push(c.physicalSeparation === "ambiguous" ?
        "physical-separation-ambiguous" : "not-physically-separate");
      return { step: frame.step, componentIndex: c.componentIndex,
        memberSha256: c.memberSha256, mass: c.mass,
        initialCopySourceCells: [...new Set(c.initialCopySourceByCell.filter((x) => x >= 0))]
          .sort((a, b) => a - b), immediateParentSplit: c.immediateParentSplit,
        rejectionReasons: reasons,
        selectionSha256: digest(`${V2_SELECTION_SALT}\n${identity.sourceKey}\n${identity.arm}\n${identity.stage}\n${identity.seed}\n${frame.step}\n${c.componentIndex}`),
        disposition: reasons.length ? "rejected" : selected ? "eligible-after-selection" : "eligible-not-selected" };
    });
    if (!selected) {
      const eligible = atStep.filter((x) => x.rejectionReasons.length === 0)
        .sort((a, b) => a.selectionSha256.localeCompare(b.selectionSha256) ||
          a.componentIndex - b.componentIndex);
      if (eligible.length) {
        selected = eligible[0];
        selected.disposition = "selected";
      }
    }
    candidates.push(...atStep);
  }
  return { status: selected ? "selected" : frames.length === V2_RECRUITMENT_END / V2_CENSUS_EVERY ?
      "no-eligible-transition" : "pending", selected, candidates,
    framesInspected: frames.length, lastStep: frames.at(-1)?.step ?? 0,
    limitation: "Continuous copy and physical-separation certificates must be authenticated by the runner. A copy-linked newly separate packet does not imply an immediate-parent split, organism parenthood, or newly synthesized structure." };
}

/** Recompute reasons and first-hash choice from saved complete component certificates. */
export function validateSavedV2Selection(identity: V2SelectionIdentity, saved: V2Selection,
  frames: readonly CopyTransitionFrame[]): void {
  if (frames.length !== V2_RECRUITMENT_END / V2_CENSUS_EVERY)
    fail("saved selection lacks complete fixed recruitment window");
  const recomputed = selectFirstCopyLinkedTransition(identity, frames);
  if (JSON.stringify(saved) !== JSON.stringify(recomputed))
    fail("saved rejection reasons or first eligible hash choice differ from component certificates");
}
