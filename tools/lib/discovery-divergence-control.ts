// Divergence-control roster: magnitude-matched random mutants and single-slot
// reconstructions of the completed improvement study's evolved descendants.
// Pure functions over the frozen operation042 report; no simulation here.
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
export const MUTANT_SEED_BASE = 6480000;
export const BOOTSTRAP_SEED = 6480100;
export const ENDPOINT = 1_000_000;
export const RECONSTRUCTIONS = [
  {
    founderId: "discovery-cluster-33",
    slot: B2_OFF + OUT.PHOTO,
    slotName: "b2[PHOTO]",
  },
  { founderId: "discovery-cluster-139", slot: MU, slotName: "mu" },
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

/**
 * Founder plus the descendant's change magnitudes, placed on uniformly drawn
 * distinct slots with uniform signs. A clamped sign takes the other sign; if both
 * clamp, that slot is excluded for this magnitude and another is drawn.
 */
export function shuffledMutant(
  founder: readonly number[],
  descendant: readonly number[],
  seed: number,
): { slots: number[]; magnitudes: number[] } {
  if (founder.length !== SLOTS || descendant.length !== SLOTS) {
    throw Error("genome requires 163 slots");
  }
  const magnitudes = founder.flatMap((v, s) =>
    descendant[s] === v ? [] : [Math.abs(descendant[s] - v)]
  );
  const rng = new Random(seed), out = [...founder];
  const available = Array.from({ length: SLOTS }, (_, s) => s);
  for (const magnitude of magnitudes) {
    const excluded = new Set<number>();
    for (;;) {
      const candidates = available.filter((s) => !excluded.has(s));
      if (!candidates.length) {
        throw Error(`no slot fits magnitude ${magnitude}`);
      }
      const slot = candidates[rng.int(candidates.length)];
      const sign = rng.int(2) ? 1 : -1;
      const [lo, hi] = bounds(slot);
      const value = [
        founder[slot] + sign * magnitude,
        founder[slot] - sign * magnitude,
      ]
        .find((v) => v >= lo && v <= hi);
      if (value === undefined) {
        excluded.add(slot);
        continue;
      }
      out[slot] = value;
      available.splice(available.indexOf(slot), 1);
      break;
    }
  }
  return { slots: out, magnitudes };
}

/** Mass-weighted median of a slot over genomes carrying an upward change. */
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
  arm: "mutant" | "reconstruction";
  founderId: string;
  founderHex: string;
  descendantHex: string;
};

function assaysOf(genome: GenomeRequest, sourceManifestHash: string) {
  return ASSAY_SEEDS.flatMap((assaySeed) =>
    [0, 1, 2, 3].map((assignment) => ({
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

  // Evolved arm: normal-mode endpoint draws, in report observation order.
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
    e.observationIds.push(o.id);
  }
  if (
    evolved.length !== 64 || evolved.some((e) => e.observationIds.length !== 16)
  ) {
    throw Error("evolved arm must be 64 draws of 16 observations");
  }

  const genomes: GenomeRequest[] = [];
  const mutants = evolved.map((e) => {
    const founderHex = unitById.get(e.unitId)!.founderHex;
    const seed = MUTANT_SEED_BASE + e.k;
    const { slots, magnitudes } = shuffledMutant(
      slotsOf(founderHex),
      slotsOf(e.descendantHex),
      seed,
    );
    const hex = hexOf(slots);
    genomes.push({
      id: `m${String(e.k).padStart(2, "0")}`,
      arm: "mutant",
      founderId: e.founderId,
      founderHex,
      descendantHex: hex,
    });
    return {
      genomeId: `m${String(e.k).padStart(2, "0")}`,
      evolvedDrawId: e.drawId,
      seed,
      slotsChanged: magnitudes.length,
      magnitudes,
      hex,
    };
  });

  const reconstructions = RECONSTRUCTIONS.map((r) => {
    const units = manifest.units
      .filter((u) => u.founderId === r.founderId && u.mode === "normal")
      .sort((a, b) => a.seed - b.seed);
    const founderHex = units[0].founderHex;
    const founder = slotsOf(founderHex);
    const perSeed = units.map((u) => {
      const value = carrierMedian(
        founder,
        sampleOf(u.id).byGenomeAbundance,
        r.slot,
      );
      if (value === null) throw Error(`no carriers ${u.id}`);
      const slots = [...founder];
      slots[r.slot] = value;
      const hex = hexOf(slots);
      const id = `r-${r.founderId.split("-").at(-1)}-${
        r.slotName.replace(/\W/g, "")
      }-${value}`;
      if (!genomes.some((g) => g.id === id)) {
        genomes.push({
          id,
          arm: "reconstruction",
          founderId: r.founderId,
          founderHex,
          descendantHex: hex,
        });
      }
      return { seed: u.seed, value, genomeId: id };
    });
    return { ...r, founderValue: founder[r.slot], perSeed };
  });

  // Replay: first observation of each founder's first evolved draw and last of its last.
  const replay = manifest.founders.flatMap((f) => {
    const draws = evolved.filter((e) => e.founderId === f.id);
    return [draws[0].observationIds[0], draws.at(-1)!.observationIds[15]];
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
  if (unique.size !== assays.length) throw Error("duplicate new configuration");
  if (assays.some((a) => evolvedKeys.has(a.cacheKey))) {
    throw Error("new configuration collides with an existing assay");
  }
  if (new Set(replay.map((r) => r.cacheKey)).size !== replay.length) {
    throw Error("replay sample must be distinct");
  }
  return {
    format: "discovery-divergence-control-roster/v1",
    status: "PREPARED",
    note: "A PREPARED roster never authorizes execution.",
    inputs: {
      reportSha256,
      manifestHash: manifest.manifestHash,
      sourceManifestHash: manifest.sourceManifestHash,
    },
    seeds: {
      mutants: [MUTANT_SEED_BASE + 1, MUTANT_SEED_BASE + evolved.length],
      bootstrap: BOOTSTRAP_SEED,
      assay: ASSAY_SEEDS,
    },
    evolved,
    mutants,
    reconstructions,
    genomes,
    replay,
    assays,
    counts: {
      evolvedDraws: evolved.length,
      mutantGenomes: mutants.length,
      reconstructionGenomes:
        genomes.filter((g) => g.arm === "reconstruction").length,
      newConfigurations: unique.size,
      replayConfigurations: replay.length,
      totalConfigurations: unique.size + replay.length,
    },
    rosterPayloadSha256: sha256(JSON.stringify({ genomes, assays, replay })),
  };
}

// ---- Analysis (pure). Unavailable or missing scores take their full [-1, 1] range.

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

export function analyzeDivergence(input: {
  roster: Roster;
  evolvedObservations: ReadonlyMap<string, Outcome>;
  results: ReadonlyMap<string, Outcome>;
  replay: { expected: number; matched: number };
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
    if (keys.length !== 16) throw Error(`genome ${id} lacks 16 requests`);
    return summarize(keys.map((k) => results.get(k) ?? null));
  };
  const founders = [...new Set(roster.evolved.map((e) => e.founderId))];
  const seeds = [...new Set(roster.evolved.map((e) => e.seed))].sort((a, b) =>
    a - b
  );
  const mutantOf = new Map(
    roster.mutants.map((m) => [m.evolvedDrawId, m.genomeId]),
  );

  const draws = roster.evolved.map((e) => {
    const evolved = summarize(e.observationIds.map((id) => {
      if (!evolvedObservations.has(id)) {
        throw Error(`unknown evolved observation ${id}`);
      }
      return evolvedObservations.get(id)!;
    }));
    return {
      drawId: e.drawId,
      founderId: e.founderId,
      seed: e.seed,
      evolved,
      mutant: genomeSummary(mutantOf.get(e.drawId)!),
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
      return {
        founderId,
        seed,
        evolved,
        mutant,
        contrast: contrast(evolved, mutant),
      };
    })
  );
  const blocks = seeds.map((seed) => {
    const effect = average(
      units.filter((u) => u.seed === seed).map((u) => u.contrast),
    );
    return { seed, ...effect, certified: effect.lower > THRESHOLD };
  });

  const missing =
    roster.assays.filter((a) => (results.get(a.cacheKey) ?? null) === null)
      .length;
  const evolvedMissing =
    [...evolvedObservations.values()].filter((o) => o === null).length;
  const technicalComplete = missing === 0 && evolvedMissing === 0 &&
    input.replay.matched === input.replay.expected &&
    input.replay.expected === roster.replay.length;

  const certifiedA = blocks.filter((b) => b.certified).length;
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

  const byFounder = founders.map((founderId) => {
    const u = units.filter((x) => x.founderId === founderId);
    return {
      founderId,
      evolved: average(u.map((x) => x.evolved)),
      mutant: average(u.map((x) => x.mutant)),
      contrast: average(u.map((x) => x.contrast)),
    };
  });

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
    const evolvedMean = byFounder.find((f) =>
      f.founderId === r.founderId
    )!.evolved;
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
      interpretation: !technicalComplete
        ? "technically incomplete"
        : certified >= REQUIRED
        ? "the single evolved change alone gives an advantage over the founder in typical seeds; this shows sufficiency, not necessity"
        : "criterion not met; this does not show the change is irrelevant",
    };
  });

  return {
    format: "discovery-divergence-control-analysis/v1",
    rosterPayloadSha256: roster.rosterPayloadSha256,
    reportSha256: roster.inputs.reportSha256,
    technicalComplete,
    missingNewResults: missing,
    replay: input.replay,
    threshold: THRESHOLD,
    required: REQUIRED,
    exactOneSidedSignTail: SIGN_TAIL,
    selection: {
      blocks,
      certifiedBlocks: certifiedA,
      criterionMet: technicalComplete && certifiedA >= REQUIRED,
      effect: average(blocks),
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
      byFounder,
      interpretation: !technicalComplete
        ? "technically incomplete"
        : certifiedA >= REQUIRED
        ? "evolved descendants beat their founder by more than equally changed random mutants in typical seed blocks; read with the mutants' own scores, since harmful mutants with neutral descendants indicate purifying selection rather than adaptation"
        : "criterion not met; this does not establish that selection was absent",
    },
    reconstruction,
    units,
    draws,
  };
}
