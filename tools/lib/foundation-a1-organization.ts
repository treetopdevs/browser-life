/** Post-execution, source-bound join of A1 physical censuses to saved serial morphology. */
export interface A1Component {
  componentIndex: number; currentCells: number; currentMass: number;
  copyOriginStatus: string; unknownCopyCells: number;
}
export interface A1Transition { step: number; components: A1Component[] }
export interface A1Morphology {
  subject: string; targetStep: number; status: string;
  frame?: { step: number; componentIndex: number; id?: number; cells: number; mass: number;
    biomass: number; membraneFraction: number; membraneCellStd: number;
    rimCoreMembraneDifference: number; compartmentalised: boolean;
    cellResourceMeans: { A: number; C: number; E: number; S: number } };
  memberRanges?: [number, number][];
}
export interface A1CensusHash { step: number; labelsSha256: string }
export interface A1Material { step: number; componentIndex: number; cells: number;
  reactionMaterialOwnership: string; genomeCopyValidation: string;
  postReactionBoundMinusIncomingBound: string }

export interface OrganizationRow {
  step: number; timeSincePlacement: number; biologicalAge: null; componentIndex: number;
  cells: number; mass: number; copyOriginStatus: string; unknownCopyCells: number;
  material: A1Material | null;
  morphology: null | { subject: string; observerId: number | null; biomass: number;
    polymer: number; membraneFraction: number; membraneCellStd: number;
    rimCoreMembraneDifference: number; compartmentalised: boolean;
    cellResourceMeans: { A: number; C: number; E: number; S: number };
    traitStatus: "measured-polymer-present" | "uninformative-zero-polymer";
    joinBasis: "saved-serial-100-census-label-hash-parity" };
  morphologyAvailability: "joined" | "not-sampled-at-25-cadence" |
    "not-captured-for-component" | "saved-observer-identity-absent";
}

const key = (step: number, componentIndex: number) => `${step}:${componentIndex}`;
export function joinA1Organization(input: {
  transitions: A1Transition[]; material: A1Material[];
  morphology: A1Morphology[]; census100: A1CensusHash[];
  serialTraceMatched: boolean;
}): OrganizationRow[] {
  if (!input.serialTraceMatched) throw new Error("serial trace parity is required for the join");
  const seen = new Set<string>(), material = new Map<string, A1Material>();
  for (const row of input.material) {
    const k = key(row.step, row.componentIndex);
    if (material.has(k)) throw new Error(`duplicate material row ${k}`);
    material.set(k, row);
  }
  const hashes = new Map(input.census100.map(row => [row.step, row.labelsSha256]));
  for (const step of [100, 200])
    if (!/^[a-f0-9]{64}$/.test(hashes.get(step) ?? ""))
      throw new Error(`saved observer label hash missing at ${step}`);
  const morph = new Map<string, A1Morphology[]>();
  for (const row of input.morphology) {
    if (!row.frame || row.status !== "observed") continue;
    const k = key(row.targetStep, row.frame.componentIndex);
    morph.set(k, [...(morph.get(k) ?? []), row]);
  }
  const out: OrganizationRow[] = [];
  for (const transition of input.transitions) {
    if (transition.step < 25 || transition.step > 250 || transition.step % 25)
      throw new Error(`unexpected A1 diagnostic census ${transition.step}`);
    for (const component of transition.components) {
      const k = key(transition.step, component.componentIndex);
      if (seen.has(k)) throw new Error(`duplicate component ${k}`);
      seen.add(k);
      const m = material.get(k) ?? null;
      if (m && m.cells !== component.currentCells)
        throw new Error(`material/component cell mismatch ${k}`);
      const saved = morph.get(k) ?? [];
      if (saved.length > 1) throw new Error(`ambiguous morphology join ${k}`);
      let morphology: OrganizationRow["morphology"] = null;
      let availability: OrganizationRow["morphologyAvailability"] =
        transition.step % 100 ? "not-sampled-at-25-cadence" : "not-captured-for-component";
      if (saved.length === 1) {
        const item = saved[0], f = item.frame!;
        if (transition.step % 100 || !hashes.has(transition.step))
          throw new Error(`morphology lacks saved 100-census label parity ${k}`);
        if (f.step !== transition.step || f.cells !== component.currentCells ||
            f.mass !== component.currentMass ||
            item.memberRanges?.reduce((n, [, length]) => n + length, 0) !== f.cells)
          throw new Error(`morphology does not match physical component ${k}`);
        if (f.biomass < 0 || f.biomass > f.mass) throw new Error(`invalid bound partition ${k}`);
        if (typeof f.id !== "number")
          availability = "saved-observer-identity-absent";
        else {
          const polymer = f.mass - f.biomass;
          morphology = { subject: item.subject, observerId: f.id,
            biomass: f.biomass, polymer, membraneFraction: f.membraneFraction,
            membraneCellStd: f.membraneCellStd,
            rimCoreMembraneDifference: f.rimCoreMembraneDifference,
            compartmentalised: f.compartmentalised, cellResourceMeans: f.cellResourceMeans,
            traitStatus: polymer === 0 ? "uninformative-zero-polymer" : "measured-polymer-present",
            joinBasis: "saved-serial-100-census-label-hash-parity" };
          availability = "joined";
        }
      }
      out.push({ step: transition.step, timeSincePlacement: transition.step,
        biologicalAge: null, componentIndex: component.componentIndex,
        cells: component.currentCells, mass: component.currentMass,
        copyOriginStatus: component.copyOriginStatus,
        unknownCopyCells: component.unknownCopyCells,
        material: m, morphology, morphologyAvailability: availability });
    }
  }
  for (const k of material.keys()) if (!seen.has(k)) throw new Error(`orphan material row ${k}`);
  for (const step of [100, 200]) if (!input.transitions.some(t => t.step === step))
    throw new Error(`missing fixed placement-age census ${step}`);
  return out;
}
