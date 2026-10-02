// Divergence-control roster and analysis: type-matched random mutants, single-slot
// reconstructions and a reconstruction specificity control for the completed
// improvement study's evolved descendants. Pure functions; no simulation here.
// Protocol: experiments/founder-discovery/v1/divergence-control-protocol.md
import { B2_OFF, NN_BYTES, OUT } from "@bl/schema";
import { Random, sha256 } from "./founder-policy.ts";
import { fromHex, toHex } from "./selection-funnel-audit.ts";
import {
  ASSAY_SEEDS,
  assayCacheKey,
  type Manifest,
} from "./discovery-improvement-runtime.ts";

export const SLOTS = NN_BYTES + 3; // 160 weights, mu, sigma, motGain (mutateInPlace order)
export const MU = NN_BYTES, SIGMA = NN_BYTES + 1, GAIN = NN_BYTES + 2;
export const ENDPOINT = 1_000_000;
// Assignments 2 and 3 only swap lineage labels of 0 and 1; the frozen study shows
// identical outcomes for each pair, which buildRoster re-asserts on the evolved arm.
export const ASSIGNMENTS = [0, 1] as const;
export const PER_GENOME = ASSAY_SEEDS.length * ASSIGNMENTS.length; // 8
export const MUTANTS_PER_DRAW = 2;
export const MUTANT_SEED_BASE = 6480000; // mutant j = 1..128 uses 6480000 + j
export const SPECIFICITY_SEED_BASE = 6480200; // seed index i = 1..8 uses 6480200 + i
export const BOOTSTRAP_SEED = 6480300;
export const RECONSTRUCTIONS = [
  {
    founderId: "discovery-cluster-33",
    slot: B2_OFF + OUT.PHOTO,
    slotName: "b2[PHOTO]",
    specificity: true,
  },
  {
    founderId: "discovery-cluster-139",
    slot: MU,
    slotName: "mu",
    specificity: false,
  },
] as const;

// Value bounds the simulator's mutation operator enforces per slot.
export function bounds(slot: number): [number, number] {
  if (slot < NN_BYTES) return [-127, 127];
  if (slot === MU) return [16, 4095];
  if (slot === SIGMA) return [2, 1023];
  if (slot === GAIN) return [0, 255];
  throw Error(`slot out of range ${slot}`);
}

export function slotsOf(hex: string): number[] {
  const g = fromHex(hex);
  if (toHex(g) !== hex) throw Error("non-canonical genome hex");
  return [...g.weights, g.mu, g.sigma, g.motGain];
}

export function hexOf(slots: readonly number[]): string {
  if (slots.length !== SLOTS) throw Error("genome requires 163 slots");
  return toHex({
    weights: slots.slice(0, NN_BYTES),
    mu: slots[MU],
    sigma: slots[SIGMA],
    motGain: slots[GAIN],
  });
}

/** First in-bounds value of founder ± magnitude, trying the drawn sign first. */
function signed(slot: number, base: number, magnitude: number, sign: number) {
  const [lo, hi] = bounds(slot);
  return [base + sign * magnitude, base - sign * magnitude].find((v) =>
    v >= lo && v <= hi
  );
}

/** Place one magnitude on a uniformly drawn slot from `pool`; redraw if both signs clamp. */
function place(
  rng: Random,
  base: readonly number[],
  out: number[],
  pool: number[],
  magnitude: number,
): number {
  const excluded = new Set<number>();
  for (;;) {
    const candidates = pool.filter((s) => !excluded.has(s));
    if (!candidates.length) throw Error(`no slot fits magnitude ${magnitude}`);
    const slot = candidates[rng.int(candidates.length)];
    const value = signed(slot, base[slot], magnitude, rng.int(2) ? 1 : -1);
    if (value === undefined) {
      excluded.add(slot);
      continue;
    }
    out[slot] = value;
    pool.splice(pool.indexOf(slot), 1);
    return slot;
  }
}

/**
 * Type-matched mutant. Weight-change magnitudes (in ascending slot order) go to
 * uniformly drawn distinct weight slots with uniform signs. Each mu, sigma or gain
 * change keeps its own parameter and magnitude with a uniform sign. A clamped sign
 * takes the other sign; a weight slot where both clamp is redrawn.
 */
export function typeMatchedMutant(
  founder: readonly number[],
  descendant: readonly number[],
  seed: number,
) {
  if (founder.length !== SLOTS || descendant.length !== SLOTS) {
    throw Error("genome requires 163 slots");
  }
  const changed = founder.flatMap((v, s) => descendant[s] === v ? [] : [s]);
  const rng = new Random(seed), out = [...founder];
  const weights = Array.from({ length: NN_BYTES }, (_, s) => s);
  for (const s of changed.filter((s) => s < NN_BYTES)) {
    place(rng, founder, out, weights, Math.abs(descendant[s] - founder[s]));
  }
  for (const s of changed.filter((s) => s >= NN_BYTES)) {
    const magnitude = Math.abs(descendant[s] - founder[s]);
    const value = signed(s, founder[s], magnitude, rng.int(2) ? 1 : -1);
    if (value === undefined) {
      throw Error(`parameter ${s} cannot take ${magnitude}`);
    }
    out[s] = value;
  }
  return {
    slots: out,
    weightMagnitudes: changed.filter((s) => s < NN_BYTES).map((s) =>
      Math.abs(descendant[s] - founder[s])
    ),
    parameterSlots: changed.filter((s) => s >= NN_BYTES),
  };
}

/** Mass-weighted lower median of a slot over genomes carrying an upward change. */
export function carrierMedian(
  founder: readonly number[],
  abundance: readonly { hex: string; mass: number }[],
  slot: number,
): number | null {
  const carriers = abundance
    .map((g) => ({ value: slotsOf(g.hex)[slot], mass: g.mass }))
    .filter((g) => g.value > founder[slot])
    .sort((a, b) => a.value - b.value);
  const total = carriers.reduce((a, g) => a + g.mass, 0);
  let acc = 0;
  for (const g of carriers) {
    acc += g.mass;
    if (acc * 2 >= total) return g.value;
  }
  return null;
}

// Minimal shape of the frozen operation042 report this roster reads.
export interface ImprovementReport {
  manifestHash: string;
  observations: {
    id: string;
    drawId: string;
    unitId: string;
    founderId: string;
    seed: number;
    mode: string;
    time: number;
    draw: number;
    assaySeed: number;
    assignment: number;
    cacheKey: string | null;
    status: string;
    score: number | null;
  }[];
  byTime: {
    time: number;
    abundance: {
      unitId: string;
      founderId: string;
      seed: number;
      mode: string;
      sample: {
        byGenomeAbundance: { hex: string; mass: number }[];
        draws: { status: string; genomes: string[] };
      } | null;
    }[];
  }[];
}

export type GenomeRequest = {
  id: string;
  arm: "mutant" | "reconstruction" | "specificity";
  founderId: string;
  founderHex: string;
  descendantHex: string;
};

function assaysOf(genome: GenomeRequest, sourceManifestHash: string) {
  return ASSAY_SEEDS.flatMap((assaySeed) =>
    ASSIGNMENTS.map((assignment) => ({
      id: `${genome.id}-s${assaySeed}-a${assignment}`,
      genomeId: genome.id,
      assaySeed,
      assignment,
      cacheKey: assayCacheKey(
        genome.descendantHex,
        genome.founderHex,
        assaySeed,
        assignment,
        sourceManifestHash,
      ),
    }))
  );
}

export function buildRoster(
  report: ImprovementReport,
  reportSha256: string,
  manifest: Manifest,
) {
  if (report.manifestHash !== manifest.manifestHash) {
    throw Error("report and manifest disagree");
  }
  const unitById = new Map(manifest.units.map((u) => [u.id, u]));
  const atEndpoint = report.byTime.find((t) => t.time === ENDPOINT);
  if (!atEndpoint) throw Error("report lacks the endpoint");
  const sampleOf = (unitId: string) => {
    const s = atEndpoint.abundance.find((a) => a.unitId === unitId)?.sample;
    if (!s || s.draws.status !== "present") throw Error(`no sample ${unitId}`);
    return s;
  };

  // Evolved arm: normal-mode endpoint draws in report observation order. Every
  // observation's identity is re-derived; scores at assignments 2 and 3 must equal
  // those at 0 and 1 for the same assay seed, or the reduced design is invalid.
  const evolved: {
    k: number;
    drawId: string;
    unitId: string;
    founderId: string;
    seed: number;
    draw: number;
    descendantHex: string;
    observationIds: string[];
  }[] = [];
  const scoreBy = new Map<string, number | null>();
  for (const o of report.observations) {
    if (o.time !== ENDPOINT || o.mode !== "normal") continue;
    let e = evolved.find((x) => x.drawId === o.drawId);
    if (!e) {
      e = {
        k: evolved.length + 1,
        drawId: o.drawId,
        unitId: o.unitId,
        founderId: o.founderId,
        seed: o.seed,
        draw: o.draw,
        descendantHex: sampleOf(o.unitId).draws.genomes[o.draw],
        observationIds: [],
      };
      evolved.push(e);
    }
    const unit = unitById.get(o.unitId)!;
    if (
      o.status !== "scored" ||
      o.cacheKey !== assayCacheKey(
          e.descendantHex,
          unit.founderHex,
          o.assaySeed,
          o.assignment,
          manifest.sourceManifestHash,
        )
    ) throw Error(`evolved observation identity drift ${o.id}`);
    scoreBy.set(`${o.drawId}/${o.assaySeed}/${o.assignment}`, o.score);
    if ((ASSIGNMENTS as readonly number[]).includes(o.assignment)) {
      e.observationIds.push(o.id);
    }
  }
  if (
    evolved.length !== 64 ||
    evolved.some((e) => e.observationIds.length !== PER_GENOME)
  ) throw Error("evolved arm must be 64 draws of 8 used observations");
  for (const e of evolved) {
    for (const s of ASSAY_SEEDS) {
      for (const a of ASSIGNMENTS) {
        if (
          scoreBy.get(`${e.drawId}/${s}/${a}`) !==
            scoreBy.get(`${e.drawId}/${s}/${a + 2}`)
        ) {
          throw Error(
            `assignment pair invariance violated ${e.drawId}/${s}/${a}`,
          );
        }
      }
    }
  }

  const genomes: GenomeRequest[] = [];
  const mutants = evolved.flatMap((e) => {
    const founderHex = unitById.get(e.unitId)!.founderHex;
    return Array.from({ length: MUTANTS_PER_DRAW }, (_, i) => {
      const j = (e.k - 1) * MUTANTS_PER_DRAW + i + 1;
      const seed = MUTANT_SEED_BASE + j;
      const m = typeMatchedMutant(
        slotsOf(founderHex),
        slotsOf(e.descendantHex),
        seed,
      );
      const id = `m${String(j).padStart(3, "0")}`;
      const hex = hexOf(m.slots);
      genomes.push({
        id,
        arm: "mutant",
        founderId: e.founderId,
        founderHex,
        descendantHex: hex,
      });
      return {
        genomeId: id,
        evolvedDrawId: e.drawId,
        seed,
        weightMagnitudes: m.weightMagnitudes,
        parameterSlots: m.parameterSlots,
        hex,
      };
    });
  });

  const specificity: {
    founderId: string;
    seed: number;
    controlSeed: number;
    slot: number;
    value: number;
    genomeId: string;
  }[] = [];
  const reconstructions = RECONSTRUCTIONS.map((r) => {
    const units = manifest.units
      .filter((u) => u.founderId === r.founderId && u.mode === "normal")
      .sort((a, b) => a.seed - b.seed);
    const founderHex = units[0].founderHex;
    const founder = slotsOf(founderHex);
    const short = r.founderId.split("-").at(-1);
    const perSeed = units.map((u, index) => {
      const value = carrierMedian(
        founder,
        sampleOf(u.id).byGenomeAbundance,
        r.slot,
      );
      if (value === null) throw Error(`no carriers ${u.id}`);
      const slots = [...founder];
      slots[r.slot] = value;
      const id = `r-${short}-${r.slotName.replace(/\W/g, "")}-${value}`;
      if (!genomes.some((g) => g.id === id)) {
        genomes.push({
          id,
          arm: "reconstruction",
          founderId: r.founderId,
          founderHex,
          descendantHex: hexOf(slots),
        });
      }
      if (r.specificity) {
        // Same magnitude on a uniformly drawn other weight slot, uniform sign.
        const controlSeed = SPECIFICITY_SEED_BASE + index + 1;
        const out = [...founder];
        const pool = Array.from({ length: NN_BYTES }, (_, s) => s).filter((s) =>
          s !== r.slot
        );
        const slot = place(
          new Random(controlSeed),
          founder,
          out,
          pool,
          Math.abs(value - founder[r.slot]),
        );
        const cid = `c-${short}-s${u.seed}`;
        genomes.push({
          id: cid,
          arm: "specificity",
          founderId: r.founderId,
          founderHex,
          descendantHex: hexOf(out),
        });
        specificity.push({
          founderId: r.founderId,
          seed: u.seed,
          controlSeed,
          slot,
          value: out[slot],
          genomeId: cid,
        });
      }
      return { seed: u.seed, value, genomeId: id };
    });
    return { ...r, founderValue: founder[r.slot], perSeed };
  });

  // Replay: first used observation of each founder's first evolved draw and last of its last.
  const replay = manifest.founders.flatMap((f) => {
    const draws = evolved.filter((e) => e.founderId === f.id);
    return [draws[0].observationIds[0], draws.at(-1)!.observationIds.at(-1)!];
  }).map((id) => ({
    observationId: id,
    cacheKey: report.observations.find((o) => o.id === id)!.cacheKey!,
  }));

  const assays = genomes.flatMap((g) =>
    assaysOf(g, manifest.sourceManifestHash)
  );
  const unique = new Set(assays.map((a) => a.cacheKey));
  const evolvedKeys = new Set(
    report.observations.filter((o) => o.cacheKey).map((o) => o.cacheKey!),
  );
  if (
    new Set(genomes.map((g) => g.descendantHex + g.founderHex)).size !==
      genomes.length
  ) {
    throw Error("duplicate new genome");
  }
  if (unique.size !== assays.length) throw Error("duplicate new configuration");
  if (assays.some((a) => evolvedKeys.has(a.cacheKey))) {
    throw Error("new configuration collides with an existing assay");
  }
  if (new Set(replay.map((r) => r.cacheKey)).size !== replay.length) {
    throw Error("replay sample must be distinct");
  }
  return {
    format: "discovery-divergence-control-roster/v2",
    status: "PREPARED",
    note: "A PREPARED roster never authorizes execution.",
    inputs: {
      reportSha256,
      manifestHash: manifest.manifestHash,
      sourceManifestHash: manifest.sourceManifestHash,
    },
    design: {
      assaySeeds: ASSAY_SEEDS,
      assignments: ASSIGNMENTS,
      mutantsPerDraw: MUTANTS_PER_DRAW,
      mutantSeeds: [
        MUTANT_SEED_BASE + 1,
        MUTANT_SEED_BASE + evolved.length * MUTANTS_PER_DRAW,
      ],
      specificitySeeds: [
        SPECIFICITY_SEED_BASE + 1,
        SPECIFICITY_SEED_BASE + specificity.length,
      ],
      bootstrapSeed: BOOTSTRAP_SEED,
    },
    evolved,
    mutants,
    reconstructions,
    specificity,
    genomes,
    replay,
    assays,
    counts: {
      evolvedDraws: evolved.length,
      mutantGenomes: mutants.length,
      reconstructionGenomes:
        genomes.filter((g) => g.arm === "reconstruction").length,
      specificityGenomes: specificity.length,
      newConfigurations: unique.size,
      replayConfigurations: replay.length,
      totalConfigurations: unique.size + replay.length,
    },
    rosterPayloadSha256: sha256(JSON.stringify({ genomes, assays, replay })),
  };
}

// ---- Analysis (pure). Unavailable or missing scores take their full [-1, 1] range
// and stay in every denominator.

export const THRESHOLD = 0.10;
export const REQUIRED = 7;
export const SIGN_TAIL = 9 / 256;
export type Roster = ReturnType<typeof buildRoster>;
/** null = technically missing; a both-extinct outcome has status but no score. */
export type Outcome = {
  status: "scored" | "both-extinct";
  score: number | null;
} | null;
type Range = { lower: number; upper: number; point: number | null };

function summarize(outcomes: readonly Outcome[]) {
  const scores = outcomes.map((o) => o?.score ?? null);
  const n = scores.length;
  return {
    lower: scores.reduce<number>((a, s) => a + (s ?? -1), 0) / n,
    upper: scores.reduce<number>((a, s) => a + (s ?? 1), 0) / n,
    point: scores.every((s) => s !== null)
      ? scores.reduce<number>((a, s) => a + s!, 0) / n
      : null,
    scored: outcomes.filter((o) => o?.status === "scored").length,
    bothExtinct: outcomes.filter((o) => o?.status === "both-extinct").length,
    missing: outcomes.filter((o) => o === null).length,
  };
}
function average(ranges: readonly Range[]): Range {
  const n = ranges.length;
  return {
    lower: ranges.reduce((a, r) => a + r.lower, 0) / n,
    upper: ranges.reduce((a, r) => a + r.upper, 0) / n,
    point: ranges.every((r) => r.point !== null)
      ? ranges.reduce((a, r) => a + r.point!, 0) / n
      : null,
  };
}
const contrast = (a: Range, b: Range): Range => ({
  lower: a.lower - b.upper,
  upper: a.upper - b.lower,
  point: a.point === null || b.point === null ? null : a.point - b.point,
});
function percentile(sorted: readonly number[], p: number): number {
  const at = (sorted.length - 1) * p, lo = Math.floor(at), hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

/** The protocol's fixed reading of a per-founder selection test. */
export function readSelection(
  technicalComplete: boolean,
  met: boolean,
  evolved: Range,
  mutant: Range,
): string {
  if (!technicalComplete) return "technically incomplete";
  if (!met) {
    return "not met: no evidence that evolved change beats random change of the same size; this is not evidence that selection was absent";
  }
  if (evolved.lower <= THRESHOLD) {
    return "met, purifying selection only: evolved genomes are not clearly better than the founder, but avoid the harm that random change of this size causes";
  }
  if (mutant.upper <= 0) {
    return "met, beyond divergence: evolved genomes beat the founder, random change of the same size does not help, and evolved change beats it";
  }
  return "met, partly divergence: random change of this size may also help, but evolved change beats it";
}

export function analyzeDivergence(input: {
  roster: Roster;
  evolvedObservations: ReadonlyMap<string, Outcome>;
  results: ReadonlyMap<string, Outcome>;
  replay: { expected: number; matched: number };
  audits: { total: number; matched: number };
  bootstrapResamples?: number;
}) {
  const { roster, evolvedObservations, results } = input;
  const assaysByGenome = new Map<string, string[]>();
  for (const a of roster.assays) {
    assaysByGenome.set(a.genomeId, [
      ...(assaysByGenome.get(a.genomeId) ?? []),
      a.cacheKey,
    ]);
  }
  const genomeSummary = (id: string) => {
    const keys = assaysByGenome.get(id) ?? [];
    if (keys.length !== PER_GENOME) {
      throw Error(`genome ${id} lacks ${PER_GENOME} requests`);
    }
    return summarize(keys.map((k) => results.get(k) ?? null));
  };
  const founders = [...new Set(roster.evolved.map((e) => e.founderId))];
  const seeds = [...new Set(roster.evolved.map((e) => e.seed))].sort((a, b) =>
    a - b
  );
  const mutantsOf = new Map<string, string[]>();
  for (const m of roster.mutants) {
    mutantsOf.set(m.evolvedDrawId, [
      ...(mutantsOf.get(m.evolvedDrawId) ?? []),
      m.genomeId,
    ]);
  }

  const draws = roster.evolved.map((e) => {
    if (e.observationIds.length !== PER_GENOME) {
      throw Error(`draw ${e.drawId} lacks observations`);
    }
    const evolved = summarize(e.observationIds.map((id) => {
      if (!evolvedObservations.has(id)) {
        throw Error(`unknown evolved observation ${id}`);
      }
      return evolvedObservations.get(id)!;
    }));
    const ids = mutantsOf.get(e.drawId) ?? [];
    if (ids.length !== MUTANTS_PER_DRAW) {
      throw Error(`draw ${e.drawId} lacks mutants`);
    }
    const mutants = ids.map(genomeSummary);
    return {
      drawId: e.drawId,
      founderId: e.founderId,
      seed: e.seed,
      evolved,
      mutants,
      mutant: average(mutants),
    };
  });
  const units = founders.flatMap((founderId) =>
    seeds.map((seed) => {
      const d = draws.filter((x) =>
        x.founderId === founderId && x.seed === seed
      );
      if (d.length !== 2) {
        throw Error(`unit ${founderId}/${seed} lacks two draws`);
      }
      const evolved = average(d.map((x) => x.evolved)),
        mutant = average(d.map((x) => x.mutant));
      const c = contrast(evolved, mutant);
      return {
        founderId,
        seed,
        evolved,
        mutant,
        contrast: c,
        certified: c.lower > THRESHOLD,
      };
    })
  );

  const missing =
    roster.assays.filter((a) => (results.get(a.cacheKey) ?? null) === null)
      .length;
  const evolvedMissing =
    [...evolvedObservations.values()].filter((o) => o === null).length;
  const technicalComplete = missing === 0 && evolvedMissing === 0 &&
    input.replay.expected === roster.replay.length &&
    input.replay.matched === input.replay.expected &&
    input.audits.matched === input.audits.total;

  // Confirmatory A: one test per founder.
  const selection = founders.map((founderId) => {
    const u = units.filter((x) => x.founderId === founderId);
    const evolved = average(u.map((x) => x.evolved)),
      mutant = average(u.map((x) => x.mutant));
    const certified = u.filter((x) => x.certified).length;
    const met = technicalComplete && certified >= REQUIRED;
    return {
      founderId,
      certifiedSeeds: certified,
      criterionMet: met,
      evolved,
      mutant,
      contrast: average(u.map((x) => x.contrast)),
      reading: readSelection(technicalComplete, met, evolved, mutant),
    };
  });

  // Descriptive: the original pooled block rule and its bootstrap.
  const blocks = seeds.map((seed) => {
    const effect = average(
      units.filter((u) => u.seed === seed).map((u) => u.contrast),
    );
    return { seed, ...effect, certified: effect.lower > THRESHOLD };
  });
  const resamples = input.bootstrapResamples ?? 10_000;
  const rng = new Random(BOOTSTRAP_SEED);
  const bootLower: number[] = [],
    bootUpper: number[] = [],
    bootPoint: number[] = [];
  const allPoints = blocks.every((b) => b.point !== null);
  for (let i = 0; i < resamples; i++) {
    const s = Array.from(
      { length: blocks.length },
      () => rng.int(blocks.length),
    );
    bootLower.push(s.reduce((a, j) => a + blocks[j].lower, 0) / s.length);
    bootUpper.push(s.reduce((a, j) => a + blocks[j].upper, 0) / s.length);
    if (allPoints) {
      bootPoint.push(s.reduce((a, j) => a + blocks[j].point!, 0) / s.length);
    }
  }
  for (const b of [bootLower, bootUpper, bootPoint]) b.sort((x, y) => x - y);

  // Confirmatory B, plus the descriptive specificity comparison for cluster-33.
  const reconstruction = roster.reconstructions.map((r) => {
    const perSeed = r.perSeed.map((p) => {
      const s = genomeSummary(p.genomeId);
      return {
        seed: p.seed,
        value: p.value,
        genomeId: p.genomeId,
        ...s,
        certified: s.lower > THRESHOLD,
      };
    });
    const certified = perSeed.filter((p) => p.certified).length;
    const mean = average(perSeed);
    const evolvedMean = selection.find((f) =>
      f.founderId === r.founderId
    )!.evolved;
    const controls = roster.specificity.filter((c) =>
      c.founderId === r.founderId
    ).map((c) => {
      const s = genomeSummary(c.genomeId);
      const own = perSeed.find((p) => p.seed === c.seed)!;
      return {
        seed: c.seed,
        slot: c.slot,
        genomeId: c.genomeId,
        control: s,
        reconstructionMinusControl: contrast(own, s),
      };
    });
    return {
      founderId: r.founderId,
      slotName: r.slotName,
      founderValue: r.founderValue,
      perSeed,
      distinctGenomes: new Set(r.perSeed.map((p) => p.genomeId)).size,
      mean,
      certifiedSeeds: certified,
      criterionMet: technicalComplete && certified >= REQUIRED,
      recoveredShareOfEvolved:
        mean.point !== null && evolvedMean.point !== null &&
          evolvedMean.point > 0
          ? mean.point / evolvedMean.point
          : null,
      specificity: controls.length
        ? {
          controls,
          meanReconstructionMinusControl: average(
            controls.map((c) => c.reconstructionMinusControl),
          ),
          seedsReconstructionAboveControl:
            controls.filter((c) => c.reconstructionMinusControl.lower > 0)
              .length,
        }
        : null,
      reading: !technicalComplete
        ? "technically incomplete"
        : certified >= REQUIRED
        ? "met: the single evolved change alone gives an advantage over the founder in typical seeds; this shows sufficiency, not necessity; specificity is described by the control, not tested"
        : "not met: this does not show the change is irrelevant",
    };
  });

  return {
    format: "discovery-divergence-control-analysis/v2",
    rosterPayloadSha256: roster.rosterPayloadSha256,
    reportSha256: roster.inputs.reportSha256,
    technicalComplete,
    missingNewResults: missing,
    replay: input.replay,
    audits: input.audits,
    threshold: THRESHOLD,
    required: REQUIRED,
    exactOneSidedSignTailPerTest: SIGN_TAIL,
    confirmatoryTests: founders.length + roster.reconstructions.length,
    selection,
    reconstruction,
    descriptive: {
      pooledBlocks: blocks,
      pooledCertifiedBlocks: blocks.filter((b) => b.certified).length,
      pooledEffect: average(blocks),
      bootstrap: {
        seed: BOOTSTRAP_SEED,
        resamples,
        bounded95: {
          lower: percentile(bootLower, 0.025),
          upper: percentile(bootUpper, 0.975),
        },
        point95: allPoints
          ? {
            lower: percentile(bootPoint, 0.025),
            upper: percentile(bootPoint, 0.975),
          }
          : null,
      },
    },
    units,
    draws,
  };
}
