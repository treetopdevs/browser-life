// Continuation after the first sweep: each frozen 1M draw (L) paired with its own
// 500k ancestor genome (H) from the completed improvement study's histories, plus
// type-matched null mutants of H carrying the H→L change, and the per-founder
// continuation analysis. No simulation here.
// Protocol: experiments/founder-discovery/v1/continuation-protocol.md
import { join } from "node:path";
import {
  CH,
  cellCount,
  decodeGenome,
  G,
  GENOME_CHANNELS,
  lineageKey,
  packLineageLo,
  type WorldState,
} from "@bl/schema";
import {
  ancestryResolver,
  type MutationEdge,
  Random,
  rootMasses,
  sha256,
  simHex,
} from "./founder-policy.ts";
import {
  ASSAY_SEEDS,
  assayCacheKey,
  CHECKPOINT_STEPS,
  checkpointPaths,
  loadCheckpointChain,
  type Manifest,
  type Unit,
} from "./discovery-improvement-runtime.ts";
import {
  buildRoster,
  hexOf,
  type ImprovementReport,
  RECONSTRUCTIONS,
  slotsOf,
  typeMatchedMutant,
} from "./discovery-divergence-control.ts";

export const MIDPOINT = 500_000;
export const ENDPOINT = 1_000_000;
export const ASSIGNMENTS = [0, 1] as const;
export const PER_GENOME = ASSAY_SEEDS.length * ASSIGNMENTS.length; // 8
export const MUTANTS_PER_PAIR = 2;
export const MUTANT_SEED_BASE = 6490100; // mutant j = 1..128 uses base + j
export const BOOTSTRAP_SEED = 6490300;
export const THRESHOLD = 0.10;
export const REQUIRED = 7;
export const SIGN_TAIL = 9 / 256;

/** Present lineages of a state: genome and B+P mass, with conflicting words refused. */
export function lineageGenomes(state: WorldState) {
  const n = cellCount(state.cfg);
  if (
    state.cells.length !== n * 7 || state.genome.length !== n * GENOME_CHANNELS
  ) throw Error("malformed state buffer");
  const out = new Map<string, { hex: string; mass: number }>();
  for (let i = 0; i < n; i++) {
    const mass = state.cells[CH.B * n + i] + state.cells[CH.P * n + i];
    if (!mass) continue;
    const hi = state.genome[G.LIN_HI * n + i],
      lo = state.genome[G.LIN_LO * n + i];
    if (!hi && !lo) continue;
    const id = lineageKey(hi, lo);
    const words = Array.from(
      { length: GENOME_CHANNELS },
      (_, g) => state.genome[g * n + i],
    );
    const hex = simHex(decodeGenome(words));
    const prior = out.get(id);
    if (prior && prior.hex !== hex) {
      throw Error(`conflicting genome words for lineage ${id}`);
    }
    out.set(id, { hex, mass: (prior?.mass ?? 0) + mass });
  }
  return out;
}

/** Founder-lineage B+P mass, through the recorded mutation-parent edges. */
function founderMass(state: WorldState, edges: MutationEdge[]) {
  const roots = { [lineageKey(0, packLineageLo(state.cfg, 1))]: 0 };
  const m = rootMasses(state, ancestryResolver(roots, edges));
  if (m.unknownAncestryMass !== 0) throw Error("unknown ancestry mass");
  return m.roots[0].totalMass;
}

/**
 * Load a history's chain through `step` with the frozen loader, unchanged: hard links
 * to the chain's files up to `step` in a scratch directory (the loader returns the last
 * contiguous checkpoint), so every receipt, hash, physical state, provenance, mutation
 * delta, biology check and scheduled sample is verified by frozen code.
 */
export async function loadChainThrough(
  historyDir: string,
  scratchRoot: string,
  manifest: Manifest,
  unit: Unit,
  step: number,
) {
  if (!CHECKPOINT_STEPS.includes(step)) throw Error(`no checkpoint at ${step}`);
  const dir = await Deno.makeTempDir({ dir: scratchRoot, prefix: "chain-" });
  try {
    for (const s of CHECKPOINT_STEPS.filter((s) => s <= step)) {
      const from = checkpointPaths(historyDir, s), to = checkpointPaths(dir, s);
      for (const k of ["checkpoint", "edges", "receipt"] as const) {
        await Deno.link(from[k], to[k]);
      }
    }
    const loaded = await loadCheckpointChain(dir, manifest, unit);
    if (!loaded || loaded.state.step !== step) {
      throw Error(`chain did not reach ${unit.id}/${step}`);
    }
    return loaded;
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/** First lineage on `lineage`'s ancestral path (itself included) present in `present`. */
export function ancestorIn(
  lineage: string,
  parentOf: ReadonlyMap<string, string>,
  present: ReadonlyMap<string, unknown>,
) {
  let key = lineage, generations = 0;
  while (!present.has(key)) {
    const parent = parentOf.get(key);
    if (parent === undefined) throw Error(`no midpoint ancestor for ${lineage}`);
    key = parent;
    generations++;
  }
  return { key, generations };
}

/**
 * For one normal history: verify its whole chain with the frozen loader, check that the
 * frozen 1M draws are its verified samples, then find each draw's 500k ancestor genome.
 * L's lineage is the heaviest 1M lineage carrying L's genome (ties: lowest key); its
 * ancestor is the first lineage on its parent path present in the 500k state. A lineage
 * born at or before 500k that has a descendant born later was alive at 500k.
 */
export async function historyAncestry(
  historiesDir: string,
  scratchRoot: string,
  manifest: Manifest,
  unit: Unit,
  lateHexes: readonly string[],
) {
  const dir = join(historiesDir, unit.id);
  const end = await loadChainThrough(dir, scratchRoot, manifest, unit, ENDPOINT);
  const frozen = end.samples[ENDPOINT];
  if (
    !frozen || frozen.draws.status !== "present" ||
    JSON.stringify(frozen.draws.genomes) !== JSON.stringify(lateHexes)
  ) throw Error(`late draws are not the verified 1M sample ${unit.id}`);
  const mid = await loadChainThrough(dir, scratchRoot, manifest, unit, MIDPOINT);
  const parentOf = new Map(end.edges.map((e) => [e.child, e.parent]));
  const at1M = lineageGenomes(end.state), at500k = lineageGenomes(mid.state);
  const ancestors = lateHexes.map((lateHex, draw) => {
    const carriers = [...at1M].filter(([, v]) => v.hex === lateHex).sort((
      [a, x],
      [b, y],
    ) => y.mass - x.mass || (a < b ? -1 : a > b ? 1 : 0));
    if (!carriers.length) throw Error(`late genome absent ${unit.id}/${draw}`);
    const [lateLineage, late] = carriers[0];
    const a = ancestorIn(lateLineage, parentOf, at500k);
    const ancestorHex = at500k.get(a.key)!.hex;
    const others = carriers.slice(1).map(([k]) =>
      at500k.get(ancestorIn(k, parentOf, at500k).key)!.hex
    );
    return {
      unitId: unit.id,
      draw,
      lateHex,
      lateLineage,
      lateLineageMass: late.mass,
      carrierLineages: carriers.length,
      ancestorLineage: a.key,
      ancestorMass: at500k.get(a.key)!.mass,
      generations: a.generations,
      ancestorHex,
      carriersShareAncestorGenome: others.every((h) => h === ancestorHex),
    };
  });
  return {
    history: {
      unitId: unit.id,
      receipt500kSha256: mid.receiptSha256,
      receipt1MSha256: end.receiptSha256,
      stateHash500k: mid.receipt.stateHash,
      founderMass500k: founderMass(mid.state, mid.edges),
      founderMass1M: founderMass(end.state, end.edges),
      genomes500k: new Set([...at500k.values()].map((v) => v.hex)).size,
    },
    ancestors,
  };
}
export type HistoryAncestry = Awaited<ReturnType<typeof historyAncestry>>;


/** The founder's swept slot and value, if it had one (cluster-33, cluster-139). */
function sweptSlot(founderId: string, founderHex: string) {
  const r = RECONSTRUCTIONS.find((x) => x.founderId === founderId);
  return r
    ? { slot: r.slot, slotName: r.slotName, founderValue: slotsOf(founderHex)[r.slot] }
    : null;
}

/**
 * Roster: each 1M draw (L) paired with its own 500k ancestor genome (H), plus two
 * type-matched mutants of H carrying the H→L change. A configuration that several
 * genomes share (for example L equal to H) is run once and referenced by each.
 */
export function buildContinuationRoster(
  report: ImprovementReport,
  reportSha256: string,
  manifest: Manifest,
  ancestry: readonly HistoryAncestry[],
) {
  const base = buildRoster(report, reportSha256, manifest);
  const normal = manifest.units.filter((u) => u.mode === "normal");
  if (
    ancestry.length !== normal.length ||
    ancestry.some((h, i) =>
      h.history.unitId !== normal[i].id ||
      h.ancestors.length !== 2 ||
      h.ancestors.some((a, d) => a.unitId !== normal[i].id || a.draw !== d)
    )
  ) throw Error("ancestry does not match the normal units in manifest order");
  const ancestorOf = new Map(
    ancestry.flatMap((h) => h.ancestors.map((a) => [`${a.unitId}/${a.draw}`, a])),
  );
  const founderHex = new Map(manifest.founders.map((f) => [f.id, f.hex]));

  type Genome = {
    id: string;
    arm: "late" | "null";
    pairId: string;
    founderId: string;
    seed: number;
    descendantHex: string;
    ancestorHex: string;
    cacheKeys: string[];
  };
  const keysOf = (descendantHex: string, ancestorHex: string) =>
    ASSAY_SEEDS.flatMap((seed) =>
      ASSIGNMENTS.map((assignment) =>
        assayCacheKey(
          descendantHex,
          ancestorHex,
          seed,
          assignment,
          manifest.sourceManifestHash,
        )
      )
    );
  const genomes: Genome[] = [];
  const pairs = base.evolved.map((e) => {
    const a = ancestorOf.get(`${e.unitId}/${e.draw}`);
    if (!a || a.lateHex !== e.descendantHex) {
      throw Error(`ancestor does not match late draw ${e.drawId}`);
    }
    const ancestorHex = a.ancestorHex;
    const pairId = `${e.unitId}-p${e.draw}`;
    const late: Genome = {
      id: `l${String(e.k).padStart(3, "0")}`,
      arm: "late",
      pairId,
      founderId: e.founderId,
      seed: e.seed,
      descendantHex: e.descendantHex,
      ancestorHex,
      cacheKeys: keysOf(e.descendantHex, ancestorHex),
    };
    genomes.push(late);
    const nulls = Array.from({ length: MUTANTS_PER_PAIR }, (_, i) => {
      const j = (e.k - 1) * MUTANTS_PER_PAIR + i + 1;
      const m = typeMatchedMutant(
        slotsOf(ancestorHex),
        slotsOf(e.descendantHex),
        MUTANT_SEED_BASE + j,
      );
      const hex = hexOf(m.slots);
      const g: Genome = {
        id: `n${String(j).padStart(3, "0")}`,
        arm: "null",
        pairId,
        founderId: e.founderId,
        seed: e.seed,
        descendantHex: hex,
        ancestorHex,
        cacheKeys: keysOf(hex, ancestorHex),
      };
      genomes.push(g);
      return {
        genomeId: g.id,
        seed: MUTANT_SEED_BASE + j,
        weightMagnitudes: m.weightMagnitudes,
        parameterSlots: m.parameterSlots,
      };
    });
    const sweep = sweptSlot(e.founderId, founderHex.get(e.founderId)!);
    return {
      pairId,
      unitId: e.unitId,
      founderId: e.founderId,
      seed: e.seed,
      draw: e.draw,
      lateDrawId: e.drawId,
      lateGenomeId: late.id,
      nulls,
      generations: a.generations,
      lateEqualsMidpoint: e.descendantHex === ancestorHex,
      slotsChanged: slotsOf(ancestorHex).filter((v, s) =>
        slotsOf(e.descendantHex)[s] !== v
      ).length,
      sweep: sweep && {
        slotName: sweep.slotName,
        founderValue: sweep.founderValue,
        midpointValue: slotsOf(ancestorHex)[sweep.slot],
        lateValue: slotsOf(e.descendantHex)[sweep.slot],
      },
    };
  });

  const byKey = new Map<string, {
    cacheKey: string;
    descendantHex: string;
    ancestorHex: string;
    assaySeed: number;
    assignment: number;
  }>();
  for (const g of genomes) {
    let k = 0;
    for (const seed of ASSAY_SEEDS) {
      for (const assignment of ASSIGNMENTS) {
        const cacheKey = g.cacheKeys[k++];
        const prior = byKey.get(cacheKey);
        if (
          prior && (prior.descendantHex !== g.descendantHex ||
            prior.ancestorHex !== g.ancestorHex || prior.assaySeed !== seed ||
            prior.assignment !== assignment)
        ) throw Error(`cache key collision ${cacheKey}`);
        byKey.set(cacheKey, {
          cacheKey,
          descendantHex: g.descendantHex,
          ancestorHex: g.ancestorHex,
          assaySeed: seed,
          assignment,
        });
      }
    }
  }
  const assays = [...byKey.values()];
  const frozenKeys = new Set(
    report.observations.filter((o) => o.cacheKey).map((o) => o.cacheKey!),
  );
  const replay = base.replay;
  if (replay.some((r) => byKey.has(r.cacheKey))) {
    throw Error("a replay configuration is also a new configuration");
  }
  const histories = ancestry.map((h) => h.history);
  const ancestors = ancestry.flatMap((h) => h.ancestors);
  return {
    format: "discovery-continuation-roster/v2",
    status: "PREPARED",
    note: "A PREPARED roster never authorizes execution.",
    inputs: {
      reportSha256,
      manifestHash: manifest.manifestHash,
      sourceManifestHash: manifest.sourceManifestHash,
    },
    design: {
      midpoint: MIDPOINT,
      endpoint: ENDPOINT,
      pairing: "each 1M draw with its own 500k ancestor genome",
      assaySeeds: ASSAY_SEEDS,
      assignments: ASSIGNMENTS,
      mutantsPerPair: MUTANTS_PER_PAIR,
      mutantSeeds: [
        MUTANT_SEED_BASE + 1,
        MUTANT_SEED_BASE + pairs.length * MUTANTS_PER_PAIR,
      ],
      bootstrapSeed: BOOTSTRAP_SEED,
    },
    histories,
    ancestors,
    pairs,
    genomes,
    replay,
    assays,
    counts: {
      pairs: pairs.length,
      lateGenomes: genomes.filter((g) => g.arm === "late").length,
      nullGenomes: genomes.filter((g) => g.arm === "null").length,
      requestedConfigurations: genomes.length * PER_GENOME,
      newConfigurations: assays.length,
      sharedConfigurations: genomes.length * PER_GENOME - assays.length,
      configurationsAlsoInFrozenStudy:
        assays.filter((a) => frozenKeys.has(a.cacheKey)).length,
      pairsWithLateEqualToMidpoint:
        pairs.filter((p) => p.lateEqualsMidpoint).length,
      pairsWithAncestorDisagreementAcrossCarriers:
        ancestors.filter((a) => !a.carriersShareAncestorGenome).length,
      replayConfigurations: replay.length,
      totalConfigurations: assays.length + replay.length,
    },
    rosterPayloadSha256: sha256(
      JSON.stringify({ histories, ancestors, pairs, genomes, assays, replay }),
    ),
  };
}
export type ContinuationRoster = ReturnType<typeof buildContinuationRoster>;

// ---- Analysis (pure). Unavailable or missing scores take their full [-1, 1] range
// and stay in every denominator.
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

/**
 * The protocol's fixed reading of a per-founder continuation test, evaluated in this
 * order. Progress is per seed: late genomes must beat their own midpoint ancestors
 * (lower bound > 0.10) in at least 7 of 8 seeds, not only on average.
 */
export function readContinuation(
  technicalComplete: boolean,
  met: boolean,
  lateCertifiedSeeds: number,
  nullRange: Range,
): string {
  if (!technicalComplete) return "technically incomplete";
  if (!met) {
    return "not met: no evidence that change since the midpoint beats random change of the same size; this is not evidence that adaptation stopped";
  }
  if (lateCertifiedSeeds < REQUIRED) {
    return "met, not clearly progressing: late genomes beat random change of the same size, but do not clearly beat their own midpoint ancestors in typical seeds";
  }
  if (nullRange.lower <= THRESHOLD) {
    return "met, continued beyond divergence: late genomes beat their own midpoint ancestors in typical seeds, random change of the same size does not clearly help, and late change beats it";
  }
  return "met, partly divergence: late genomes beat their own midpoint ancestors, random change of this size also clearly helps, but late change beats it";
}

/** Roster-only description, fixed before any result exists. */
export function describeRoster(roster: ContinuationRoster) {
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  };
  const founders = [...new Set(roster.pairs.map((p) => p.founderId))];
  return founders.map((founderId) => {
    const ps = roster.pairs.filter((p) => p.founderId === founderId);
    const hs = roster.histories.filter((h) =>
      ps.some((p) => p.unitId === h.unitId)
    );
    const sweep = ps[0].sweep;
    const carries = (v: number) => sweep !== null && v > sweep.founderValue;
    return {
      founderId,
      pairs: ps.length,
      medianSlotsChanged: median(ps.map((p) => p.slotsChanged)),
      medianGenerations: median(ps.map((p) => p.generations)),
      lateEqualsMidpoint: ps.filter((p) => p.lateEqualsMidpoint).length,
      meanFounderMass500k: hs.reduce((a, h) => a + h.founderMass500k, 0) /
        hs.length,
      meanFounderMass1M: hs.reduce((a, h) => a + h.founderMass1M, 0) /
        hs.length,
      medianGenomes500k: median(hs.map((h) => h.genomes500k)),
      sweep: sweep && {
        slotName: sweep.slotName,
        founderValue: sweep.founderValue,
        midpointCarries: ps.filter((p) => carries(p.sweep!.midpointValue))
          .length,
        lateCarries: ps.filter((p) => carries(p.sweep!.lateValue)).length,
        gainedAfterMidpoint: ps.filter((p) =>
          !carries(p.sweep!.midpointValue) && carries(p.sweep!.lateValue)
        ).length,
        lostAfterMidpoint: ps.filter((p) =>
          carries(p.sweep!.midpointValue) && !carries(p.sweep!.lateValue)
        ).length,
      },
    };
  });
}

export function analyzeContinuation(input: {
  roster: ContinuationRoster;
  results: ReadonlyMap<string, Outcome>;
  replay: { expected: number; matched: number };
  audits: { total: number; matched: number };
  bootstrapResamples?: number;
}) {
  const { roster, results } = input;
  const genome = new Map(roster.genomes.map((g) => [g.id, g]));
  const summaryOf = (id: string) => {
    const g = genome.get(id);
    if (!g || g.cacheKeys.length !== PER_GENOME) {
      throw Error(`genome ${id} lacks ${PER_GENOME} configurations`);
    }
    return summarize(g.cacheKeys.map((k) => results.get(k) ?? null));
  };
  const founders = [...new Set(roster.pairs.map((p) => p.founderId))];
  const seeds = [...new Set(roster.pairs.map((p) => p.seed))].sort((a, b) =>
    a - b
  );
  const pairs = roster.pairs.map((p) => {
    if (p.nulls.length !== MUTANTS_PER_PAIR) {
      throw Error(`pair ${p.pairId} lacks mutants`);
    }
    const nulls = p.nulls.map((n) => summaryOf(n.genomeId));
    return {
      pairId: p.pairId,
      founderId: p.founderId,
      seed: p.seed,
      late: summaryOf(p.lateGenomeId),
      nulls,
      null: average(nulls),
    };
  });
  const units = founders.flatMap((founderId) =>
    seeds.map((seed) => {
      const d = pairs.filter((x) => x.founderId === founderId && x.seed === seed);
      if (d.length !== 2) throw Error(`unit ${founderId}/${seed} lacks two pairs`);
      const late = average(d.map((x) => x.late)),
        nullRange = average(d.map((x) => x.null));
      const c = contrast(late, nullRange);
      return {
        founderId,
        seed,
        late,
        null: nullRange,
        contrast: c,
        certified: c.lower > THRESHOLD,
        lateCertified: late.lower > THRESHOLD,
      };
    })
  );

  const missing =
    roster.assays.filter((a) => (results.get(a.cacheKey) ?? null) === null)
      .length;
  const technicalComplete = missing === 0 &&
    input.replay.expected === roster.replay.length &&
    input.replay.matched === input.replay.expected &&
    input.audits.matched === input.audits.total;

  const continuation = founders.map((founderId) => {
    const u = units.filter((x) => x.founderId === founderId);
    const late = average(u.map((x) => x.late)),
      nullRange = average(u.map((x) => x.null));
    const certified = u.filter((x) => x.certified).length;
    const lateCertified = u.filter((x) => x.lateCertified).length;
    const met = technicalComplete && certified >= REQUIRED;
    return {
      founderId,
      certifiedSeeds: certified,
      criterionMet: met,
      lateCertifiedSeeds: lateCertified,
      late,
      null: nullRange,
      contrast: average(u.map((x) => x.contrast)),
      reading: readContinuation(technicalComplete, met, lateCertified, nullRange),
    };
  });

  // Descriptive: the pooled block rule (contrast averaged over founders per seed).
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

  return {
    format: "discovery-continuation-analysis/v2",
    rosterPayloadSha256: roster.rosterPayloadSha256,
    reportSha256: roster.inputs.reportSha256,
    technicalComplete,
    missingNewResults: missing,
    replay: input.replay,
    audits: input.audits,
    threshold: THRESHOLD,
    required: REQUIRED,
    exactOneSidedSignTailPerTest: SIGN_TAIL,
    confirmatoryTests: founders.length,
    continuation,
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
      lateEqualsMidpointPairs: roster.counts.pairsWithLateEqualToMidpoint,
      roster: describeRoster(roster),
    },
    units,
    pairs,
  };
}
