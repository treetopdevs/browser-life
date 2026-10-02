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
