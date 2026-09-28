/** One physical snapshot stream, many independent uses of the existing observers. */
import { census, morphology, Tracker, type LifeEvent, type Morphology } from "@bl/metrics";
import { CELL_CHANNELS, cellCount, stateHash, type WorldConfig, type WorldState } from "@bl/schema";

export const SENSITIVITY_THRESHOLDS = [24, 48, 96] as const;
export const SENSITIVITY_MIN_MASSES = [128, 256, 512] as const;
export const SENSITIVITY_CADENCES = [25, 100, 200] as const;
export const FINE_STEP = 25;

export interface SensitivitySetting { threshold: number; minMass: number; cadence: number }
export interface SensitivitySnapshot { step: number; cells: Uint32Array; genomeHead: Uint32Array }
export interface SensitivityRow {
  setting: SensitivitySetting;
  /** The first observation defines a left-truncated local cohort, not an event. */
  baseline: { step: number; eligibleComponents: number; trackedIndividuals: number };
  observedSteps: number[];
  postBaselineCensuses: number;
  atRiskIndividualIntervals: number;
  eligibleComponentObservations: number;
  trackedIndividualObservations: number;
  events: Record<LifeEvent["kind"], number>;
  fissionChildIdentities: number;
  /** References in emitted fusion rows; one identity may appear in more than one row. */
  fusionAbsorptionReferences: number;
  morphology: {
    measuredFrames: number;
    framesWithIndividuals: number;
    individualObservations: number;
    framesWithPositiveDifferentiation: number;
    framesWithCompartments: number;
    compartmentObservations: number;
    maxCompartmentsInFrame: number;
    meanDifferentiationWhenIndividuals: number | null;
    meanMembraneFractionWhenIndividuals: number | null;
  };
}

interface MutableRow extends SensitivityRow {
  tracker: Tracker;
  differentiationSum: number;
  membraneSum: number;
}

export function settingsGrid(thresholds: readonly number[] = SENSITIVITY_THRESHOLDS,
  minMasses: readonly number[] = SENSITIVITY_MIN_MASSES,
  cadences: readonly number[] = SENSITIVITY_CADENCES): SensitivitySetting[] {
  for (const [name, values] of [["threshold", thresholds], ["minMass", minMasses], ["cadence", cadences]] as const) {
    if (!values.length || values.some((v) => !Number.isSafeInteger(v) || v <= 0) || new Set(values).size !== values.length)
      throw new Error(`invalid ${name} sensitivity grid`);
  }
  if (cadences.some((c) => c % FINE_STEP !== 0)) throw new Error("observer cadence must use the fine snapshot grid");
  return thresholds.flatMap((threshold) => minMasses.flatMap((minMass) => cadences.map((cadence) =>
    ({ threshold, minMass, cadence }))));
}

export class SensitivityObserver {
  readonly settings: SensitivitySetting[];
  readonly fineObservedSteps: number[] = [];
  private readonly rows: MutableRow[];
  private startStep: number | null = null;
  constructor(readonly cfg: WorldConfig, settings: SensitivitySetting[] = settingsGrid()) {
    this.settings = settings.map((s) => ({ ...s }));
    const keys = this.settings.map((s) => JSON.stringify(s));
    if (new Set(keys).size !== keys.length || this.settings.some((s) =>
      !Number.isSafeInteger(s.threshold) || s.threshold <= 0 || !Number.isSafeInteger(s.minMass) || s.minMass <= 0 ||
      !Number.isSafeInteger(s.cadence) || s.cadence <= 0 || s.cadence % FINE_STEP !== 0))
      throw new Error("invalid or duplicate observer setting");
    this.rows = this.settings.map((setting) => ({ setting, tracker: new Tracker(setting),
      baseline: { step: -1, eligibleComponents: 0, trackedIndividuals: 0 }, observedSteps: [],
      postBaselineCensuses: 0, atRiskIndividualIntervals: 0, eligibleComponentObservations: 0,
      trackedIndividualObservations: 0, events: { birth: 0, death: 0, fission: 0, fusion: 0 },
      fissionChildIdentities: 0, fusionAbsorptionReferences: 0,
      morphology: { measuredFrames: 0, framesWithIndividuals: 0, individualObservations: 0,
        framesWithPositiveDifferentiation: 0, framesWithCompartments: 0, compartmentObservations: 0,
        maxCompartmentsInFrame: 0, meanDifferentiationWhenIndividuals: null, meanMembraneFractionWhenIndividuals: null },
      differentiationSum: 0, membraneSum: 0 }));
  }

  accept(snap: SensitivitySnapshot): void {
    const n = cellCount(this.cfg);
    if (snap.cells.length !== n * CELL_CHANNELS || snap.genomeHead.length !== n * 4)
      throw new Error("sensitivity snapshot buffer length mismatch");
    const previous = this.fineObservedSteps.at(-1);
    if (!Number.isSafeInteger(snap.step) || snap.step < 0 || previous !== undefined && snap.step !== previous + FINE_STEP)
      throw new Error("sensitivity snapshots must follow the exact 25-step grid");
    if (this.startStep === null) this.startStep = snap.step;
    const offset = snap.step - this.startStep;
    this.fineObservedSteps.push(snap.step);
    const due = this.rows.filter((r) => offset % r.setting.cadence === 0);
    const byThreshold = new Map<number, ReturnType<typeof census>>();
    const byMorphology = new Map<string, Morphology>();
    for (const row of due) {
      let c = byThreshold.get(row.setting.threshold);
      if (!c) {
        c = census({ cfg: this.cfg, ...snap }, row.setting);
        byThreshold.set(row.setting.threshold, c);
      }
      const eligible = c.components.filter((x) => x.mass >= row.setting.minMass).length;
      const priorAlive = row.tracker.alive.size;
      const events = row.tracker.update(c);
      row.observedSteps.push(snap.step);
      if (offset === 0) {
        row.baseline = { step: snap.step, eligibleComponents: eligible, trackedIndividuals: row.tracker.alive.size };
        continue;
      }
      row.postBaselineCensuses++;
      row.atRiskIndividualIntervals += priorAlive;
      row.eligibleComponentObservations += eligible;
      row.trackedIndividualObservations += row.tracker.alive.size;
      for (const e of events) {
        row.events[e.kind]++;
        if (e.kind === "fission") row.fissionChildIdentities += e.children.length;
        if (e.kind === "fusion") row.fusionAbsorptionReferences += e.parents.length - 1;
      }
      const morphKey = `${row.setting.threshold}:${row.setting.minMass}`;
      let m = byMorphology.get(morphKey);
      if (!m) {
        m = morphology(this.cfg, snap.cells, c, row.setting.minMass);
        byMorphology.set(morphKey, m);
      }
      if (!Number.isSafeInteger(m.individuals) || m.individuals < 0 ||
          !Number.isSafeInteger(m.compartmentalised) || m.compartmentalised < 0 || m.compartmentalised > m.individuals ||
          !Number.isFinite(m.differentiation) || !Number.isFinite(m.membraneFraction) || !Number.isFinite(m.sizeEntropy))
        throw new Error("morphology produced non-finite or inconsistent measurements");
      const dest = row.morphology;
      dest.measuredFrames++;
      dest.individualObservations += m.individuals;
      dest.compartmentObservations += m.compartmentalised;
      dest.maxCompartmentsInFrame = Math.max(dest.maxCompartmentsInFrame, m.compartmentalised);
      if (m.compartmentalised > 0) dest.framesWithCompartments++;
      if (m.individuals > 0) {
        dest.framesWithIndividuals++;
        if (m.differentiation > 0) dest.framesWithPositiveDifferentiation++;
        row.differentiationSum += m.differentiation;
        row.membraneSum += m.membraneFraction;
        dest.meanDifferentiationWhenIndividuals = row.differentiationSum / dest.framesWithIndividuals;
        dest.meanMembraneFractionWhenIndividuals = row.membraneSum / dest.framesWithIndividuals;
      }
    }
  }

  results(): SensitivityRow[] {
    if (this.startStep === null) throw new Error("sensitivity observer has no baseline snapshot");
    return this.rows.map(({ tracker: _tracker, differentiationSum: _d, membraneSum: _m, ...row }) =>
      structuredClone(row));
  }
}

export interface ReferenceSimulator {
  run(count: number): void;
  settle(): Promise<void>;
  drainLedger(): Promise<{ events: readonly unknown[]; dropped: number }>;
  readState(): Promise<WorldState>;
}
export interface ReferenceResult {
  step: number;
  stateHash: string;
  matchedMeasured: boolean;
  drainedMutationEvents: number;
  droppedMutationEvents: number;
  chunkSteps: number;
  chunks: number;
}

/** Same start and horizon, no census or morphology; the caller creates the second simulator from the exact start state. */
export async function runReferenceReplay(sim: ReferenceSimulator, startStep: number, steps: number,
  measuredHash: string, checkBudget: (stage: string) => void, chunkSteps = 100): Promise<ReferenceResult> {
  if (!Number.isSafeInteger(startStep) || startStep < 0 || !Number.isSafeInteger(steps) || steps <= 0 ||
      !Number.isSafeInteger(chunkSteps) || chunkSteps <= FINE_STEP || chunkSteps % FINE_STEP !== 0)
    throw new Error("invalid reference replay schedule");
  let drained = 0, dropped = 0, chunks = 0;
  for (let advanced = 0; advanced < steps; ) {
    const count = Math.min(chunkSteps, steps - advanced);
    checkBudget(`before reference steps ending ${startStep + advanced + count}`);
    sim.run(count);
    await sim.settle();
    const ledger = await sim.drainLedger();
    drained += ledger.events.length;
    dropped += ledger.dropped;
    if (ledger.dropped) throw new Error(`reference mutation event buffer dropped ${ledger.dropped} events`);
    advanced += count;
    chunks++;
    checkBudget(`after reference steps ending ${startStep + advanced}`);
  }
  checkBudget("before reference terminal readback");
  const final = await sim.readState();
  checkBudget("after reference terminal readback");
  if (final.step !== startStep + steps) throw new Error("reference terminal step differs from measured continuation");
  const hash = stateHash(final);
  return { step: final.step, stateHash: hash, matchedMeasured: hash === measuredHash,
    drainedMutationEvents: drained, droppedMutationEvents: dropped, chunkSteps, chunks };
}
