/** Pure, dry-run design checks. This module never reads bundles or starts a simulation. */

export type Epoch = "early" | "middle" | "late";
export type SnapshotMethod = "checkpoint" | "replay";

export interface FrozenSource {
  /** One independent source history; tiles, organisms and censuses are nested observations. */
  worldId: string;
  independenceUnit: string;
  runId: string;
  bundleDigest: string;
  codeRevision: string;
  codeDigest: string;
  ruleVersion: number;
  schemaVersion: number;
  metricsVersion: number;
  sourceSeed: number;
  /** A migrating ring is one source unit, even if its members have different run IDs. */
  migrationRingId?: string;
  finalStep: number;
  /** Original terminal digest and its source-defined meaning (M4 uses artifact). */
  finalHash: string;
  finalHashMode: "artifact" | "physics";
  snapshots: Record<Epoch, {
    step: number;
    method: SnapshotMethod;
    fileOrCacheKey: string;
    stateHash: string;
    artifactDigest: string;
    /** Checkpoint bytes or one cached replay reconstruction were independently checked. */
    validated: boolean;
  }>;
}

export interface FoundationBase {
  phase: "feasibility";
  frozenCodeRevision: string;
  frozenCodeDigest: string;
  sources: FrozenSource[];
  /** Source selection / replay seeds are distinct from these fresh assay seeds. */
  assaySeeds: number[];
  /** The protocol and its analysis must be frozen before measurements are inspected. */
  protocolDigest: string;
}

export interface Inoculum {
  biomass: number;
  energy: number;
}

export interface CompetitionArm {
  /** Rare-invader trials reverse which age is rare. */
  focal: "early" | "late";
  earlySide: "left" | "right";
  assaySeed: number;
  early: Inoculum;
  late: Inoculum;
}

export interface CompetitionBlock {
  worldId: string;
  environment: "own" | "foreign" | "common-garden";
  /** Environment time is a second axis, distinct from the focal inoculum age. */
  environmentTime: "early" | "late" | "standardized";
  environmentWorldId: string;
  /** Digest of the source sample before pools are stripped and conditioned. */
  environmentSourceArtifactDigest: string;
  /** Conditioned chemical/pool state, explicitly stripped of resident organisms. */
  poolDigest: string;
  residentTreatment: "none";
  /** Measurements after extraction and before inoculation. */
  startingPoolMatter: number;
  startingPoolEnergy: number;
  extractionControlId: string;
  extractionControlViable: boolean;
  start: "rare-invader" | "equal-frequency";
  /** Four arms: each age focal, and each age placed on both sides. */
  arms: CompetitionArm[];
}

export interface TimeShiftCompetitionPlan extends FoundationBase {
  kind: "time-shift-competition";
  blocks: CompetitionBlock[];
  outcomeHorizonSteps: number;
}

export interface LifeCycleRecord {
  worldId: string;
  parentId: number;
  childId: number;
  parentGeneration: number;
  childGeneration: number;
  birthStep: number;
  observationStep: number;
  parentAge: number;
  childAge: number;
  parentMass: number;
  childMass: number;
  parentTrait: number;
  childTrait: number;
  environmentBlockId: string;
  /** Right censoring and fusions must be recorded, even if excluded later. */
  censoring: "none" | "right";
  fusion: "none" | "parent" | "child" | "both";
}

export interface GardenPlacement {
  id: string;
  worldId: string;
  environment: "own" | "foreign";
  environmentWorldId: string;
  side: "left" | "right";
  assaySeed: number;
  /** Common-garden starting resources, measured after transplant preparation. */
  startingMatter: number;
  startingEnergy: number;
  poolDigest: string;
  residentTreatment: "none";
  extractionControlId: string;
  extractionControlViable: boolean;
}

export interface LifeCycleHeredityPlan extends FoundationBase {
  kind: "life-cycle-heredity";
  /** Fixed trait, age window, size adjustment and censoring policy, with a digest. */
  traitDefinition: string;
  matchedAgeTolerance: number;
  sizeAdjustment: string;
  censoringPolicy: "exclude-right-censored" | "survival-model";
  fusionPolicy: "exclude" | "stratify";
  gardens: GardenPlacement[];
  sourceOutcomes: { worldId: string; status: "observed-chain" | "no-chain" | "unavailable"; reason: string }[];
  records: LifeCycleRecord[];
}

export type FoundationAssayPlan = TimeShiftCompetitionPlan | LifeCycleHeredityPlan;
export interface AssayAssessment {
  designComplete: boolean;
  executionReady: boolean;
  runtimeVerified: false;
  scope: "feasibility-only";
  independentWorlds: number;
  nestedObservations: number;
  blockers: string[];
}

const present = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0;
const nonnegative = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0;
const positive = (x: unknown): x is number => nonnegative(x) && x > 0;
const natural = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0;

/** Validates a manifest supplied by a caller; validation is not evidence that its claimed digests were checked. */
export function assessFoundationAssay(plan: FoundationAssayPlan): AssayAssessment {
  const blockers: string[] = [];
  const add = (message: string) => blockers.push(message);
  if (plan.phase !== "feasibility" || !["time-shift-competition", "life-cycle-heredity"].includes(plan.kind))
    add("unknown assay kind or phase; only feasibility designs are supported");
  if (!present(plan.frozenCodeRevision) || !present(plan.frozenCodeDigest) || !present(plan.protocolDigest))
    add("frozen source code revision/digest and protocol digest are required");
  if (plan.sources.length < 5) add("feasibility pilot needs at least five independent source worlds; this is not confirmatory replication");
  const ids = new Set<string>(), units = new Set<string>(), runs = new Set<string>();
  const sourceById = new Map<string, FrozenSource>();
  for (const s of plan.sources) {
    if (!present(s.worldId) || ids.has(s.worldId)) add(`duplicate or missing source world id ${s.worldId}`);
    ids.add(s.worldId);
    sourceById.set(s.worldId, s);
    const unit = s.migrationRingId || s.independenceUnit;
    if (!present(unit) || units.has(unit)) add(`${s.worldId}: source histories share an independence unit or migrating ring`);
    units.add(unit);
    if (!present(s.runId) || runs.has(s.runId)) add(`${s.worldId}: duplicate or missing run id`);
    runs.add(s.runId);
    if (!present(s.bundleDigest) || !present(s.finalHash) || !["artifact", "physics"].includes(s.finalHashMode))
      add(`${s.worldId}: source bundle/final hash or explicit hash mode missing`);
    if (s.codeRevision !== plan.frozenCodeRevision || s.codeDigest !== plan.frozenCodeDigest)
      add(`${s.worldId}: source code does not match frozen assay source`);
    if (![s.ruleVersion, s.schemaVersion, s.metricsVersion, s.sourceSeed, s.finalStep].every(natural) || !positive(s.finalStep))
      add(`${s.worldId}: source versions, seed or final step missing`);
    const epochs: Epoch[] = ["early", "middle", "late"];
    const points = epochs.map((e) => s.snapshots?.[e]);
    if (points.some((p) => !p)) {
      add(`${s.worldId}: early, middle and late samples are required`);
      continue;
    }
    for (let i = 0; i < epochs.length; i++) {
      const p = points[i]!;
      if (!natural(p.step) || p.step > s.finalStep || !present(p.fileOrCacheKey) || !present(p.stateHash) || !present(p.artifactDigest) || !p.validated || (p.method !== "checkpoint" && p.method !== "replay"))
        add(`${s.worldId}/${epochs[i]}: sample must have validated state and artifact digests`);
    }
    if (!(points[0]!.step < points[1]!.step && points[1]!.step < points[2]!.step))
      add(`${s.worldId}: sample steps must increase from early through late`);
  }
  if (plan.sources.length && plan.sources.some((s) => s.ruleVersion !== plan.sources[0].ruleVersion || s.schemaVersion !== plan.sources[0].schemaVersion || s.metricsVersion !== plan.sources[0].metricsVersion))
    add("source worlds have incompatible rule/schema/metrics versions");
  if (!plan.assaySeeds.length || new Set(plan.assaySeeds).size !== plan.assaySeeds.length || plan.assaySeeds.some((seed) => !natural(seed)))
    add("fresh assay RNG seeds must be present and unique");
  const [seedMin, seedMax] = plan.kind === "time-shift-competition" ? [630000001, 630099999] : [640000001, 640099999];
  if (plan.assaySeeds.some((seed) => seed < seedMin || seed > seedMax || plan.sources.some((s) => s.sourceSeed === seed)))
    add(`assay seeds must be fresh and reserved in ${seedMin}..${seedMax}`);

  if (plan.kind === "time-shift-competition") {
    if (!natural(plan.outcomeHorizonSteps) || !positive(plan.outcomeHorizonSteps)) add("competition outcome horizon missing");
    const seen = new Set<string>();
    const usedSeeds = new Set<number>();
    let referencePool: [number, number] | null = null;
    let referenceInoculum: [number, number] | null = null;
    for (const b of plan.blocks) {
      const key = `${b.worldId}/${b.environment}/${b.environmentTime}/${b.start}`;
      if (seen.has(key)) add(`${key}: duplicate competition block`);
      seen.add(key);
      if (!sourceById.has(b.worldId) || (b.environment !== "common-garden" && !sourceById.has(b.environmentWorldId))) add(`${key}: source/environment world missing`);
      if (b.environment === "common-garden"
        ? (b.environmentTime !== "standardized" || b.environmentWorldId !== "standardized")
        : (b.environmentTime === "standardized" || (b.environment === "own") !== (b.worldId === b.environmentWorldId)))
        add(`${key}: environment origin and time assignment is inconsistent`);
      if (b.environment !== "common-garden" && sourceById.has(b.environmentWorldId) && b.environmentTime !== "standardized" &&
          b.environmentSourceArtifactDigest !== sourceById.get(b.environmentWorldId)!.snapshots?.[b.environmentTime]?.artifactDigest)
        add(`${key}: conditioned pool source digest does not match the selected environment sample`);
      if (b.environment === "common-garden" && !present(b.environmentSourceArtifactDigest))
        add(`${key}: standardized garden source digest missing`);
      if (!present(b.poolDigest) || b.residentTreatment !== "none" || !nonnegative(b.startingPoolMatter) || !nonnegative(b.startingPoolEnergy))
        add(`${key}: conditioned pool must be measured separately from resident organisms`);
      if (referencePool && (b.startingPoolMatter !== referencePool[0] || b.startingPoolEnergy !== referencePool[1]))
        add(`${key}: starting pool matter and energy differ across blocks`);
      if (!referencePool) referencePool = [b.startingPoolMatter, b.startingPoolEnergy];
      if (!present(b.extractionControlId) || !b.extractionControlViable) add(`${key}: viable extraction/transplant control missing`);
      if (b.arms.length !== 4 || ["early", "late"].some((focal) => ["left", "right"].some((side) => !b.arms.some((a) => a.focal === focal && a.earlySide === side))))
        add(`${key}: each focal age needs reciprocal left/right placement`);
      const totals = b.arms.map((a) => [a.early?.biomass + a.late?.biomass, a.early?.energy + a.late?.energy]);
      if (totals.some(([mass, energy]) => !positive(mass) || !positive(energy) || mass !== totals[0][0] || energy !== totals[0][1]))
        add(`${key}: arms need recorded, equal total biomass and energy`);
      if (totals.length && referenceInoculum && (totals[0][0] !== referenceInoculum[0] || totals[0][1] !== referenceInoculum[1]))
        add(`${key}: total inoculum biomass and energy differ across blocks`);
      if (totals.length && !referenceInoculum) referenceInoculum = [totals[0][0], totals[0][1]];
      for (const a of b.arms) {
        if (!positive(a.early?.biomass) || !positive(a.late?.biomass) || !positive(a.early?.energy) || !positive(a.late?.energy)) {
          add(`${key}: missing inoculum biomass/energy measurements`);
          continue;
        }
        const earlyFraction = a.early.biomass / (a.early.biomass + a.late.biomass);
        const earlyEnergyFraction = a.early.energy / (a.early.energy + a.late.energy);
        const expected = b.start === "equal-frequency" ? 0.5 : a.focal === "early" ? 0.1 : 0.9;
        if (Math.abs(earlyFraction - expected) > 1e-9 || Math.abs(earlyEnergyFraction - expected) > 1e-9)
          add(`${key}: starting biomass and energy must match the registered ${b.start} ratio`);
        if (!plan.assaySeeds.includes(a.assaySeed) || usedSeeds.has(a.assaySeed)) add(`${key}: assay seed missing or reused`);
        usedSeeds.add(a.assaySeed);
      }
    }
    for (const s of plan.sources) for (const start of ["rare-invader", "equal-frequency"]) {
      for (const env of ["own", "foreign"]) for (const time of ["early", "late"])
        if (!seen.has(`${s.worldId}/${env}/${time}/${start}`)) add(`${s.worldId}: missing ${env}/${time}/${start} competition block`);
      if (!seen.has(`${s.worldId}/common-garden/standardized/${start}`)) add(`${s.worldId}: missing common-garden/${start} competition block`);
    }
  } else {
    if (!present(plan.traitDefinition) || !present(plan.sizeAdjustment) || !nonnegative(plan.matchedAgeTolerance) || !plan.censoringPolicy || !plan.fusionPolicy)
      add("life-cycle trait, age/size adjustment, censoring and fusion policies required");
    const gardens = new Map<string, GardenPlacement>();
    const matrix = new Set<string>();
    const gardenSeeds = new Set<number>();
    for (const g of plan.gardens) {
      const key = `${g.worldId}/${g.environment}/${g.side}`;
      if (!present(g.id) || gardens.has(g.id) || matrix.has(key)) add(`${key}: duplicate or missing common-garden identity`);
      gardens.set(g.id, g);
      matrix.add(key);
      if (!sourceById.has(g.worldId) || !sourceById.has(g.environmentWorldId) || (g.environment === "own") !== (g.worldId === g.environmentWorldId))
        add(`${key}: own/foreign garden source is inconsistent`);
      if (!positive(g.startingMatter) || !positive(g.startingEnergy) || !present(g.poolDigest) || g.residentTreatment !== "none")
        add(`${key}: garden resources and resident-free pool must be measured`);
      if (plan.gardens.length && (g.startingMatter !== plan.gardens[0].startingMatter || g.startingEnergy !== plan.gardens[0].startingEnergy))
        add(`${key}: garden resources are not matched`);
      if (!present(g.extractionControlId) || !g.extractionControlViable) add(`${key}: viable transplant control missing`);
      if (!plan.assaySeeds.includes(g.assaySeed) || gardenSeeds.has(g.assaySeed)) add(`${key}: fresh garden seed missing or reused`);
      gardenSeeds.add(g.assaySeed);
    }
    for (const s of plan.sources) for (const environment of ["own", "foreign"]) for (const side of ["left", "right"])
      if (!matrix.has(`${s.worldId}/${environment}/${side}`)) add(`${s.worldId}: missing ${environment}/${side} common-garden placement`);
    const outcomes = new Map<string, LifeCycleHeredityPlan["sourceOutcomes"][number]>();
    for (const o of plan.sourceOutcomes) {
      if (!sourceById.has(o.worldId) || outcomes.has(o.worldId) || !["observed-chain", "no-chain", "unavailable"].includes(o.status) || (o.status !== "observed-chain" && !present(o.reason)))
        add(`${o.worldId}: invalid or duplicate source outcome`);
      outcomes.set(o.worldId, o);
    }
    const byWorld = new Map<string, LifeCycleRecord[]>();
    const usedPair = new Set<string>();
    for (const r of plan.records) {
      const key = `${r.worldId}/${r.parentId}/${r.childId}`;
      if (usedPair.has(key)) add(`${key}: duplicate parent-child observation`);
      usedPair.add(key);
      if (!sourceById.has(r.worldId) || !natural(r.parentId) || !natural(r.childId) || r.parentId === r.childId || !natural(r.parentGeneration) || r.childGeneration !== r.parentGeneration + 1)
        add(`${key}: parent identity and consecutive generation required`);
      if (!natural(r.birthStep) || !natural(r.observationStep) || r.observationStep < r.birthStep || !nonnegative(r.parentAge) || !nonnegative(r.childAge) || Math.abs(r.parentAge - r.childAge) > plan.matchedAgeTolerance)
        add(`${key}: matched observation age or time missing`);
      if (!positive(r.parentMass) || !positive(r.childMass) || !Number.isFinite(r.parentTrait) || !Number.isFinite(r.childTrait) || !present(r.environmentBlockId) || gardens.get(r.environmentBlockId)?.worldId !== r.worldId)
        add(`${key}: trait, size or shared-environment block missing`);
      if (r.censoring !== "none" && r.censoring !== "right") add(`${key}: censoring status missing`);
      if (!["none", "parent", "child", "both"].includes(r.fusion)) add(`${key}: fusion status missing`);
      const arr = byWorld.get(r.worldId) ?? [];
      arr.push(r);
      byWorld.set(r.worldId, arr);
    }
    for (const s of plan.sources) {
      const status = outcomes.get(s.worldId)?.status;
      if (!status) add(`${s.worldId}: source outcome missing, including failed or unavailable sources`);
      const rows = byWorld.get(s.worldId) ?? [];
      const hasChain = rows.some((first) => rows.some((second) =>
        first.childId === second.parentId && first.childGeneration === second.parentGeneration &&
        second.childGeneration === first.parentGeneration + 2 && first.birthStep < second.birthStep));
      if (status === "observed-chain" && !hasChain) add(`${s.worldId}: no linked parent-child-grandchild chain across three generations`);
      if (status === "no-chain" && hasChain) add(`${s.worldId}: observed chain conflicts with no-chain outcome`);
      if (status === "unavailable" && rows.length) add(`${s.worldId}: records conflict with unavailable source outcome`);
    }
  }
  return {
    designComplete: blockers.length === 0,
    // No executor or artifact verifier exists in this module. Never grant run authorization from declarations.
    executionReady: false,
    runtimeVerified: false,
    scope: "feasibility-only",
    independentWorlds: units.size,
    nestedObservations: plan.kind === "time-shift-competition" ? plan.blocks.reduce((n, b) => n + b.arms.length, 0) : plan.records.length,
    blockers,
  };
}
