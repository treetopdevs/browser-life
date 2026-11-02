// Evidence assembly: calibration (dev and replicate-noise seeds only), the fresh confirmation, fixtures, the verdict and the seal. Pure
// and deterministic: no timestamps, no timings. Integers, integer rationals and decimal strings only.
import { CH, canonicalJSON, cellCount, sha256HexJS } from "@bl/schema";
import { RefSim } from "@bl/sim-ref";
import { ARM_EDITS, buildArm, buildPatches, genomeHash, positions } from "./arms.ts";
import { runBlock, type BlockRecord, type BlockSpec } from "./assay.ts";
import { decideSchedule, medianTimes2, verdictOf, contrastsOf, type BlockNumbers, type Floors, type ScheduleDecision, type Verdict } from "./decision.ts";
import { PLANTED_CASES, PLANTED_FLOORS, SYNTH, coordFixture, physicalFixtures, plantedReport, syntheticFloor, type CoordFixture, type PhysicalFixture, type PlantedReport } from "./fixtures.ts";
import { PROTOCOL, SCHEDULE_IDS, protocolHash, type Protocol, type ScheduleId, type StrategyId } from "./protocol.ts";
import { meridianPath, reportOf, type ScheduleReport } from "./schedule.ts";

export const EVIDENCE_VERSION = "movinglight-evidence-v1";
/** Runs a batch of single-schedule block jobs; the tool supplies a two-process pool, tests and replay supply this sequential one. */
export type JobRunner = (specs: BlockSpec[]) => Promise<BlockRecord[]>;
export const sequential: JobRunner = async (specs) => specs.map((s) => runBlock(s));

const hashOf = (v: unknown) => sha256HexJS(new TextEncoder().encode(canonicalJSON(v)));
const ALL: readonly StrategyId[] = PROTOCOL.strategies as StrategyId[];

/** Merge single-schedule jobs of the same seed into one block record (job order is the schedule order). */
export function mergeBlocks(records: readonly BlockRecord[]): BlockRecord[] {
  const out = new Map<number, BlockRecord>();
  for (const r of records) {
    const cur = out.get(r.seed);
    if (!cur) out.set(r.seed, { ...r, runs: { ...r.runs }, strip: r.strip ? { ...r.strip } : null, patchAudit: { ...r.patchAudit, problems: [...r.patchAudit.problems] } });
    else {
      Object.assign(cur.runs, r.runs);
      if (r.strip) cur.strip = { ...(cur.strip ?? {}), ...r.strip };
      cur.patchAudit.problems.push(...r.patchAudit.problems);
    }
  }
  return [...out.values()];
}

export const jobsFor = (seeds: readonly number[], schedules: readonly ScheduleId[], strategies: readonly StrategyId[], opts: { patchSeed?: number; stripSeed?: number } = {}): BlockSpec[] =>
  seeds.flatMap((seed) => schedules.map((schedule) => ({ seed, patchSeed: opts.patchSeed ?? seed, schedules: [schedule], strategies, withStrip: seed === opts.stripSeed })));

/** BlockNumbers of one schedule from a merged block. */
export function numbersOf(b: BlockRecord, schedule: ScheduleId): BlockNumbers {
  const out: BlockNumbers = {};
  for (const st of ALL) {
    const g = b.runs[schedule]?.[`${st}/grouped`], d = b.runs[schedule]?.[`${st}/dispersed`];
    if (!g || !d) continue;
    out[st] = {
      grouped: { capturePpm: g.readouts.capturePpm, survivalPpm: g.readouts.survivalPpm, cov: g.coordination.covMilliQ2 },
      dispersed: { capturePpm: d.readouts.capturePpm, survivalPpm: d.readouts.survivalPpm, cov: d.coordination.covMilliQ2 },
    };
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- calibration

export interface Calibration {
  kind: "movinglight-calibration";
  protocolId: string;
  note: string;
  schedules: ScheduleReport[];
  genomes: Record<string, { edit: string; hash: string }>;
  dev: { seeds: readonly number[]; blocks: BlockRecord[] };
  noise: { seeds: readonly number[]; patchSeed: number; blocks: BlockRecord[] };
  /** Per schedule: floors from the replicate-noise seeds only. */
  floors: Record<string, Floors>;
  sensitivity: { absErrStill1000: number[]; absErrSense1000: number[]; gain2: number | null; noiseFloor: number; senseTracks: boolean; floorUsable: boolean; sensitive: boolean; rule: string };
  crossTalk: { grouped: CrossTalk; dispersed: CrossTalk; thresholdPpm: number; flagged: boolean; method: string };
  ladder: { applied: string[]; note: string };
  workload: Workload;
}
export interface CrossTalk {
  disc: number;
  allSignal: string;
  soloSignal: string;
  /** Counterfactual signal-difference proxy, ppm: (all - solo) / all in the probe disc. Not signal ownership: removing the other bodies also changes competition, movement and emission. */
  signalDiffPpm: number;
}
export interface Workload {
  formula: string;
  worldsFresh: number;
  worldsFixtures: number;
  steps: number;
  maxProcesses: 2;
}

export function workload(p: Protocol = PROTOCOL): Workload {
  const worldsFresh = p.freshSeeds.length * p.schedules.length * p.strategies.length * 2;
  const worldsFixtures = p.fixtureSeeds.length * 3 * 2;
  return { formula: "fresh seeds * schedules * strategies * 2 placements + fixture seeds * 3 strategies * 2 placements, each T steps", worldsFresh, worldsFixtures, steps: (worldsFresh + worldsFixtures) * p.T, maxProcesses: 2 };
}

const spanOver = (xs: readonly number[]): number => {
  let m = 0;
  for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) m = Math.max(m, Math.abs(xs[i] - xs[j]));
  return m;
};

/** Floors from replicate-noise blocks (cloned patches, engine seed only): the largest spread of each contrast and residual across seeds. */
export function floorsFromNoise(blocks: readonly BlockRecord[], schedule: ScheduleId): Floors {
  const cs = blocks.map((b) => contrastsOf(numbersOf(b, schedule))).filter((c) => c !== null);
  const caps = [cs.map((c) => c!.S), cs.map((c) => c!.N), cs.map((c) => c!.V), cs.map((c) => c!.B), cs.map((c) => c!.Bdrift)];
  const res = [cs.map((c) => c!.resSense), cs.map((c) => c!.resStill), cs.map((c) => c!.resNomot)].map((xs) => xs.filter((x): x is number => x !== null));
  return { cap: Math.max(0, ...caps.map(spanOver)), res: Math.max(0, ...res.map(spanOver)) };
}

export function crossTalkOf(placement: "grouped" | "dispersed", p: Protocol, seed: number): CrossTalk {
  const patches = buildPatches(p, seed);
  const pos = positions(placement, p);
  const run = (bodies: number) => {
    const arm = buildArm("sense", placement, "fixed", seed, patches.slice(0, bodies), p, pos.slice(0, bodies));
    const sim = new RefSim(arm.state);
    for (let t = 0; t < p.T; t++) sim.step();
    return sim.state;
  };
  const all = run(p.n), solo = run(1);
  const n = cellCount(all.cfg);
  // Signal in a disc of radius 3 around body 0's start cell.
  const c = pos[0];
  const R = 3;
  let a = 0, s = 0, cells = 0;
  for (let dy = -R; dy <= R; dy++)
    for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dy * dy > R * R) continue;
      const i = ((((c.y + dy) % p.H) + p.H) % p.H) * p.W + ((((c.x + dx) % p.W) + p.W) % p.W);
      a += all.cells[CH.S * n + i];
      s += solo.cells[CH.S * n + i];
      cells++;
    }
  return { disc: cells, allSignal: `${a}`, soloSignal: `${s}`, signalDiffPpm: a > s ? Math.floor((p.PPM * (a - s)) / a) : 0 };
}

/** A dispersed run is flagged when the counterfactual signal-difference proxy of the neighbourhood signal exceeds the frozen threshold; the claim then stays 'dispersed'. */
export const isFlagged = (c: CrossTalk, p: Protocol = PROTOCOL): boolean => c.signalDiffPpm > p.crossTalkMaxPpm;

export async function calibrationReport(run: JobRunner, p: Protocol = PROTOCOL): Promise<Calibration> {
  const dev = mergeBlocks(await run(jobsFor(p.devSeeds, ["fixed"], ALL)));
  const noisePatch = p.devSeeds[0];
  const noise = mergeBlocks(await run(jobsFor(p.noiseSeeds, SCHEDULE_IDS, ALL, { patchSeed: noisePatch })));
  const floors: Record<string, Floors> = {};
  for (const sc of SCHEDULE_IDS) floors[sc] = floorsFromNoise(noise, sc);
  // Sensitivity: sense must track the sun better than the no-motility arm by more than the replicate-noise spread of the same readout.
  const err = (b: BlockRecord, st: string, pl: string) => b.runs.fixed[`${st}/${pl}`].readouts.absErr1000 ?? 0;
  const still = dev.flatMap((b) => ["grouped", "dispersed"].map((pl) => err(b, "still", pl)));
  const sense = dev.flatMap((b) => ["grouped", "dispersed"].map((pl) => err(b, "sense", pl)));
  const noiseFloor = Math.max(0, ...["grouped", "dispersed"].map((pl) => spanOver(noise.map((b) => err(b, "still", pl)))));
  const gain2 = medianTimes2(still.map((x, i) => x - sense[i]));
  const sensitivity = { absErrStill1000: still, absErrSense1000: sense, gain2, noiseFloor, senseTracks: gain2 !== null && gain2 > 2 * noiseFloor, floorUsable: floors.fixed.cap <= p.maxFloorCapPpm, sensitive: false, rule: "sensitive = senseTracks and floorUsable. senseTracks: twice the median of (still - sense) absolute circular tracking error over dev blocks and placements must exceed twice the largest replicate-noise spread of the still arm's error. floorUsable: the fixed-schedule capture floor delta_cap must not exceed maxFloorCapPpm" };
  sensitivity.sensitive = sensitivity.senseTracks && sensitivity.floorUsable;
  const crossTalk = { grouped: crossTalkOf("grouped", p, p.devSeeds[0]), dispersed: crossTalkOf("dispersed", p, p.devSeeds[0]), thresholdPpm: p.crossTalkMaxPpm, flagged: false, method: "counterfactual signal-difference proxy = ((signal in a radius-3 disc at body 0 with all bodies) - (signal at the same cells with body 0 alone)) / (all-bodies signal), at the horizon, fixed schedule, dev seed 1. The field carries no ownership and the two runs differ in competition, movement and emission as well as in the other bodies' signal, so this is not a foreign or owned fraction and no ownership percentage is claimed; it is measured once on the frozen geometry and can only flag the dispersed placement" };
  crossTalk.flagged = isFlagged(crossTalk.dispersed, p);
  return {
    kind: "movinglight-calibration",
    protocolId: p.id,
    note: "dev and replicate-noise seeds only; no fresh seed is read here",
    schedules: SCHEDULE_IDS.map((sc) => reportOf(sc, meridianPath(sc, p), hashOf(meridianPath(sc, p)), p)),
    genomes: Object.fromEntries(ALL.map((s) => [s, { edit: ARM_EDITS[s], hash: genomeHash(s, p) }])),
    dev: { seeds: p.devSeeds, blocks: dev },
    noise: { seeds: p.noiseSeeds, patchSeed: noisePatch, blocks: noise },
    floors,
    sensitivity,
    crossTalk,
    ladder: { applied: [], note: "workload fits the budget at bench; no reduction step was applied" },
    workload: workload(p),
  };
}

// ---------------------------------------------------------------------------------------------------------------- fresh and fixtures

export interface FreshReport {
  seeds: readonly number[];
  blocks: BlockRecord[];
  decisions: Record<string, ScheduleDecision>;
  verdict: Verdict;
  invalidBlocks: number;
}

export async function freshReport(cal: Calibration, run: JobRunner, p: Protocol = PROTOCOL): Promise<FreshReport> {
  const blocks = mergeBlocks(await run(jobsFor(p.freshSeeds, SCHEDULE_IDS, ALL, { stripSeed: p.freshSeeds[0] })));
  return decideFresh(cal, blocks, p);
}

export function decideFresh(cal: Pick<Calibration, "floors" | "sensitivity">, blocks: BlockRecord[], p: Protocol = PROTOCOL): FreshReport {
  const decisions: Record<string, ScheduleDecision> = {};
  for (const sc of SCHEDULE_IDS) decisions[sc] = decideSchedule(blocks.map((b) => numbersOf(b, sc)), cal.floors[sc], sc === "fixed", p);
  const invalidBlocks = blocks.filter((b) => b.patchAudit.problems.length > 0).length;
  const verdict = verdictOf({ fixed: decisions.fixed, paused: decisions.paused, reversed: decisions.reversed, wandering: decisions.wandering, floors: cal.floors, insensitive: !cal.sensitivity.sensitive, invalidBlocks, blocks: blocks.length });
  return { seeds: blocks.map((b) => b.seed), blocks, decisions, verdict, invalidBlocks };
}

export interface FixturesReport {
  syntheticFloor: Record<string, number>;
  syntheticOpts: typeof SYNTH;
  coordination: CoordFixture[];
  physical: PhysicalFixture[];
  planted: PlantedReport[];
  plantedFloors: Floors;
  /** The naive metric reads collective motion in these fixtures, and the residual control rejects them. */
  naiveFooled: string[];
}

export async function fixturesReport(cal: Calibration, run: JobRunner, p: Protocol = PROTOCOL): Promise<FixturesReport> {
  const floorSynth = { fixed: syntheticFloor("fixed", p), wandering: syntheticFloor("wandering", p) };
  const coord: CoordFixture[] = [];
  for (const kind of ["common-forcing", "coupled-synthetic", "label-takeover", "null-world"] as const) coord.push(coordFixture(kind, "fixed", floorSynth.fixed, p));
  coord.push(coordFixture("common-forcing", "wandering", floorSynth.wandering, p), coordFixture("tracking-asymmetry", "wandering", floorSynth.wandering, p), coordFixture("static-sun", "paused", 0, p));
  const blocks = mergeBlocks(await run(p.fixtureSeeds.map((seed) => ({ seed, schedules: ["fixed"] as ScheduleId[], strategies: ["drift", "sense-nosig", "still"] as StrategyId[] }))));
  const physical = physicalFixtures(cal.floors.fixed, p, blocks);
  const planted = PLANTED_CASES.map((c) => plantedReport(c.id, c.planted, p));
  const naiveFooled = coord.filter((c) => c.naiveReads && c.rejected).map((c) => c.id);
  return { syntheticFloor: floorSynth, syntheticOpts: SYNTH, coordination: coord, physical, planted, plantedFloors: PLANTED_FLOORS, naiveFooled };
}

// ---------------------------------------------------------------------------------------------------------------- payload

export const LIMITS: readonly string[] = [
  "Exploratory, CPU only (sim-ref), mutation off, small tile (24 x 16), one horizon of 1,024 steps, four bodies per inoculum. No GPU evidence, no physics change, not part of the frozen preregistration.",
  "A positive answer is 'a group-level interaction benefit is supported in this panel, world size, horizon and schedule set'; a negative is 'no interaction benefit detected here'. It does not say sensing cannot help elsewhere, does not test evolution, does not claim a new flocking mechanism.",
  "'Dispersed' is not 'isolated': the signal field diffuses and decays slowly, so no spacing is signal-free. The cross-talk number is a counterfactual signal-difference proxy ((all - solo) / all in a probe disc, measured once on the frozen geometry): removing the other bodies also changes competition, movement and emission, so it is not a foreign or owned fraction of the signal and no ownership percentage is claimed. It can only flag the dispersed placement.",
  "Grouped and dispersed placements keep the mean sun-relative offset (four cells west of the t=0 meridian) but not its distribution, so they stand in different light: the biomass-weighted light at step 0 is 162.3 grouped against 127.3 dispersed on dev seed 8700001 (172.6 against 138.7 on 8700002, 165.4 against 134.3 on 8700501; light units, base 20 plus amplitude 220). The contrasts S, N, V and B are grouped-minus-dispersed, so a placement-only illumination offset cancels to first order in B, but a strategy-by-illumination interaction does not; a matched-illumination geometry (preserve each body's sun-relative x while changing spacing) was deferred to the next rung because it changes every arm and needs new calibration and new fresh seeds. The consumed fresh blocks are not re-read against it.",
  "The sense versus sense-nosig contrast is the total strategy effect (emission, reading and their costs); information is not separated from emission cost.",
  "sense-nosig is dynamically identical to still: with no signal the movement wiring's offsets cancel, so the 'movement-capable information-free comparator' never moves (every dev probe gave identical capture, survival, tracking and coordination numbers; the state hashes differ only because the genome words differ). N therefore equals the still arm's grouped-minus-dispersed contrast, crowding-physical (still against sense-nosig) is zero by identity and not by rejection, and no arm separates 'could move but has nothing to read' from 'does not move'.",
  "Dev calibration (fixed schedule, 24 x 16 tile, 1,024 steps) found the engine-seed noise of the capture contrasts larger than the readout itself: the fixed-schedule floor delta_cap exceeds the frozen bound (half the audited input energy), so the pre-stated sensitivity rule labels the run unsupported-measurement before any fresh block is read. The fresh run is still made and reported in full; the blocks and contrasts are evidence about how noisy the assay is, not about whether grouping helps.",
  "Reversal is a mid-run turn of the wander triangle (existing keys have no westward constant-speed rotation); a live reverse or pause of a displayed world does not exist (the live sun intervention scales brightness only), so the page replays precomputed, separate histories.",
  "Capture is the scored-window lightIn increment per audited inoculum input energy; exposure, biomass change and emission are covariates and are not corrected for.",
  "The residual-coordination control cancels common forcing that reaches both placements equally. It does not cancel a difference in how well the placements follow the sun: a placement that tracks the sun more tightly than the other reads as coordination when the other lags (fixture tracking-asymmetry shows the rejecting direction); the still and sense-nomot residual controls bound this, they do not remove it.",
  "Lineage displacement is not locomotion: growth, transport and label takeover move lineage centroids. The still and sense-nomot residuals and the stationary-growth and label-takeover fixtures bound this, they do not remove it.",
  "Composition transfer (a transferred group state) is deferred. Solo baselines were not used in the run of record. Results do not transfer to the 256 x 256 planet presets.",
  "Blocks differ in their patches (biomass noise per cell) and engine seed; arms within a block share the patches exactly, so the contrasts are within-block.",
];

export const GAPS: readonly string[] = [
  "G1: a westward constant-speed rotation from step 0 is not expressible (dayPeriod is unsigned); reversal is a mid-run turn of the wander triangle.",
  "G2: no live sun reversal or pause on a displayed world; no WorldConfig key was added.",
  "G3: rotation plus wander was dropped from this rung (nominal speeds alternate between 2v and 0 under matching).",
  "G4: a matched no-turn continuation of the wander triangle cannot be expressed, so the reversed verdict has no straight-through control; recorded as a limitation.",
];

export interface Payload {
  kind: "movinglight-evidence";
  version: string;
  protocol: Protocol;
  protocolHash: string;
  registryDigest: string;
  workload: Workload;
  calibration: Calibration;
  fresh: FreshReport;
  fixtures: FixturesReport;
  limits: string[];
  gaps: string[];
  integritySha256: string;
}

export function sealPayload(body: Omit<Payload, "integritySha256">): Payload {
  return { ...body, integritySha256: hashOf(body) };
}
export function verifySeal(p: Payload): boolean {
  const { integritySha256, ...body } = p;
  return integritySha256 === hashOf(body);
}

export async function buildPayload(registryDigest: string, calibration: Calibration, run: JobRunner, p: Protocol = PROTOCOL): Promise<Payload> {
  const fresh = await freshReport(calibration, run, p);
  const fixtures = await fixturesReport(calibration, run, p);
  return sealPayload({ kind: "movinglight-evidence", version: EVIDENCE_VERSION, protocol: p, protocolHash: protocolHash(registryDigest, p), registryDigest, workload: workload(p), calibration, fresh, fixtures, limits: [...LIMITS], gaps: [...GAPS] });
}
