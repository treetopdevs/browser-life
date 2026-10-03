// World configuration. Every value is an integer so that the CPU reference
// and the WGSL kernels agree exactly. Fractions are numerators over the
// power of two named in the comment.
import type { PondArm } from "./ponds.ts";

export const SCHEMA_VERSION = 3;
export const RULE_VERSION = 1;
/**
 * Bumped whenever a metric's *definition* changes (e.g. `compressionRatio`'s
 * compressor) in a way that makes its values incomparable to earlier runs,
 * so those runs are never pooled together. Lives here rather than in
 * `@bl/metrics` because every one of its callers (`runExperiment`,
 * `stitchRun`, `analyze.ts`) already imports `SCHEMA_VERSION`/`RULE_VERSION`
 * from `@bl/schema` alongside it — one "versions this manifest records" home,
 * no new inter-package import. A manifest without this field predates the
 * constant and is treated as version 1.
 */
export const METRICS_VERSION = 2;

export type LightMode = "uniform" | "gradient" | "patches";

export interface WorldConfig {
  ruleVersion: number;
  seed: number;
  /** One tile is an independent torus; tiles let many small worlds share one dispatch. */
  tileW: number;
  tileH: number;
  tilesX: number;
  tilesY: number;

  // Potential energy per quantum of each species (A nutrient, B biomass, C waste, P polymer).
  eA: number;
  eB: number;
  eC: number;
  eP: number;

  /** Quanta that make one Lenia mass unit. */
  massUnit: number;
  kernelRadius: number;
  /** Flow-Lenia crowding threshold θ, in quanta. */
  thetaMass: number;
  /** Flow-Lenia dt, /256. */
  dtQ: number;
  /** Extra half-width of the reintegration box, /64 cell (Flow-Lenia's s - 1/2). */
  spread: number;
  /** Growth-function defaults for cells without a genome, /1024 Lenia units. */
  defaultMu: number;
  defaultSigma: number;

  // Diffusion per 4-neighbour, /1024 (<= 256).
  diffA: number;
  diffC: number;
  diffS: number;
  /** Membrane gate: D_eff = D * gateK / (gateK + P_s + P_t). */
  gateK: number;

  /** Catalyst half-saturation (quanta): effective catalyst = B^2 / (B + kCatHalf). */
  kCatHalf: number;
  // Catalysed reaction capacity at full controller output, /4096 of B per step.
  kPhoto: number;
  kResp: number;
  kDecomp: number;
  kGrow: number;
  kBuild: number;
  kEmit: number;
  // Costs and decays, /65536 per step.
  kCost: number;
  kMaint: number;
  kPDecay: number;
  kBDecay: number;
  kELeak: number;
  kSDecay: number;
  /** Uncatalysed light-driven C -> A, /2^24 per quantum per light level. */
  kAbio: number;

  /** Mutation probability per newly synthesised quantum, /2^32. */
  mutRate: number;
  /** Max absolute change of one weight per mutation. */
  mutStep: number;

  lightMode: LightMode;
  /** 0..255 */
  lightBase: number;
  /** Added across the tile (gradient) or inside patches. */
  lightAmp: number;
  /** Steps per seasonal cycle; 0 disables seasons. */
  seasonPeriod: number;
  seasonAmp: number;

  /** Capacity of the per-dispatch mutation event buffer. */
  eventCap: number;

  /**
   * Neutral shadow control: genomes, lineages and mutations propagate as usual
   * but every cell expresses the same reference phenotype (the generalist
   * built from defaultMu/defaultSigma), so lineage dynamics are pure drift.
   */
  neutral: boolean;
  /** Active motility enabled (controller outputs move biomass). Off in the no-coordination control. */
  motility: boolean;
  /**
   * Adhesion actuator: an attraction term toward local structural-polymer
   * density (gradient climbing on P, the membrane matter the BUILD output
   * already deposits — see docs/plan.md decision 4). A cell is pulled toward
   * denser nearby P; this is a measured, tested effect (see
   * packages/sim-ref/test/adhesion.test.ts) on the single-step, motility-off
   * displacement of a cell next to a strong polymer source.
   *
   * Whether this is *enough* to hold a moving, growing colony together
   * against its own members' independent motility -- "coherent group
   * movement", the M7 collective-tracker property -- is a hypothesis. Its
   * effect on cohesion is **not demonstrated**: an exploratory multistep test
   * (motility on, a colony with chemistry-driven per-cell motility, growing
   * over 300 steps) showed no measurable reduction in dispersion at the
   * default gain, and only about 1% even at the maximum `kAdhesion`.
   * Evaluating and, if needed, strengthening cohesion (larger gain, an
   * evolvable per-lineage multiplier, or a different mechanism entirely) is
   * left to M7 rather than asserted here.
   *
   * There is no free NN output or genome slot to spend on a dedicated
   * adhesion signal without changing genome layout (all 8 controller
   * outputs and all 3 extra mutation slots are already spoken for), so
   * adhesion is derived from the existing "deposition of structural
   * polymer" actuator (BUILD/P) instead of adding one: a lineage that
   * builds more membrane is pulled more strongly toward it.
   *
   * Both fields are **optional and omitted from `defaultConfig()`'s own
   * defaults** rather than defaulting to `false`/a number: `stateHash` and
   * the coordinator's checkpoint digest hash the whole config object
   * (canonical JSON, sorted keys), so every existing checkpoint, run bundle
   * and replay-verification digest was computed without these keys. Adding
   * them to the defaults would silently change those digests for every
   * config, adhesion-enabled or not. Treat `adhesion` as on only when it is
   * exactly `true`; treat a missing `kAdhesion` as `DEFAULT_K_ADHESION`. A
   * config that never sets either key round-trips (encode, decode, hash)
   * byte-for-byte as if this actuator did not exist.
   */
  adhesion?: boolean;
  /** Adhesion gain: F += kAdhesion * grad(P) / massDiv, only when `adhesion` is true. */
  kAdhesion?: number;

  /**
   * Migration between tiles ("islands" of one archipelago run — see
   * docs/plan.md §7 and this file's tileW/tileH/tilesX/tilesY doc, "One tile
   * is an independent torus"): every `migrationPeriod` steps (an *absolute*
   * step count, so segmented and continuous runs trigger it identically —
   * see packages/schema/src/migration.ts), `migrantCount` cell-sized packets
   * rotate one tile position around a ring. Absent or 0 disables migration
   * (the default, and the "no-migration" control —
   * packages/runner/src/conditions.ts).
   *
   * Genuinely *optional* (not just zero-valued) so that a config with no
   * migration configured — every preset but "archipelago" — serialises to
   * exactly the same bytes `canonicalConfig`/`stateHash` hashed before this
   * feature existed: `stateHash` and `artifactDigest` hash the config's own
   * JSON, so an always-present `migrationPeriod: 0` field would still change
   * every existing golden hash and checkpoint digest, migration-disabled or
   * not. `defaultConfig` never sets these two keys itself — only an
   * `overrides`/preset `cfg` that mentions them does — and `validateConfig`
   * checks them explicitly rather than through the generic per-key loop
   * below, which walks `Object.keys(defaultConfig())` and so never sees a key
   * `defaultConfig` doesn't set.
   */
  migrationPeriod?: number;
  /** Cells migrated from each tile to its ring neighbour at each migration event. Must be >= 1 when migrationPeriod > 0. See `migrationPeriod`'s doc on why this is optional rather than defaulted to 0. */
  migrantCount?: number;

  /**
   * This run's position in a cross-run metapopulation ring (see
   * packages/schema/src/exchange.ts and Coordinator.Queue's `:metapopulation`
   * spec), mixed into every founder's and mutation's LIN_LO at birth via
   * `packLineageLo` so lineage ids stay unique *across* the ring's runs, not
   * only within one run. Without this, two different seeds' founders (both
   * `(0, 1)`, `(0, 2)`, ...) or two runs' mutations born at the same absolute
   * step at the same cell index collide: `applyExchange` copies a foreign
   * lineage id verbatim, and `validateState`'s "same id -> same genome words"
   * check (which this must never weaken) correctly rejects the result once
   * the two same-id, different-genome cells coexist after an exchange.
   *
   * Optional and absent by default for the same reason `migrationPeriod`/
   * `adhesion` are: `stateHash`/`artifactDigest` hash the config's own JSON,
   * so an always-present `ringNamespace: 0` would change every existing
   * golden hash whether or not a run belongs to a metapopulation.
   * `packLineageLo` returns its input completely unchanged when this is
   * absent, so both the CPU reference and the WGSL kernels mint exactly the
   * ids they always have unless a namespace is actually configured.
   *
   * 0 is reserved for "unnamespaced" bit patterns (never assigned by the
   * runner, which numbers ring members from 1); values are bounded by
   * `MAX_RING_NAMESPACE` (`RING_NAMESPACE_BITS` bits), and a namespaced
   * config's `cellCount` is additionally capped at `2 ** RING_CELL_BITS` (see
   * `validateConfig`) so the cell-index portion of a packed LIN_LO can never
   * overflow into the namespace bits.
   */
  ringNamespace?: number;

  /**
   * Pond cycle of the ecological-scaffolding protocol (docs/scaffold-protocol-v1.md,
   * "Pond cycle"; docs/scaffold-integration-v1.md): tiles are ponds, and at
   * every step s > 0 with s mod `pondPeriod` = 0 (an *absolute* step, so
   * segmented and continuous runs cycle at the same steps, as migration does)
   * every pond is ground back to nutrient and reseeded by a `pondK` x `pondK`
   * packet from a donor pond chosen by `pondArm` (packages/schema/src/ponds.ts,
   * a host-side transform between steps). The cycle index is
   * step / `pondPeriod`. Absent disables the cycle (the default).
   *
   * Optional, with `pondK` and `pondArm`, for the reason `migrationPeriod` is:
   * `stateHash`/`artifactDigest` hash the config's own JSON, so `defaultConfig`
   * never sets these keys and every config without them hashes exactly as it
   * did before the pond cycle existed. `validateConfig` checks them
   * explicitly: all three together, 64 x 64 tiles, at least 4 ponds, and no
   * tile migration or `ringNamespace` -- both move matter between ponds or
   * runs, which breaks the per-pond matter invariant the cycle restores.
   */
  pondPeriod?: number;
  /** Packet side k of the pond cycle, 1..64. Set exactly when `pondPeriod` is; see its doc. */
  pondK?: number;
  /**
   * Donor rule of the pond cycle: "scaf" (the ponds with the largest trait
   * donate), "rand" (random surviving ponds donate), "cont" (no transform;
   * each boundary only records one row per pond), or the transition hunt's
   * "nat" and "shuf" (the current: ponds die at random and are reseeded from
   * the export zone of a donor drawn in proportion to its export mass, or to a
   * shuffled copy of it; docs/scaffold-transition-hunt-v1.md). Set exactly
   * when `pondPeriod` is; see its doc.
   */
  pondArm?: PondArm;
  /**
   * The current's per-boundary death probability, `pondDeath` / 65,536 (integer
   * 1..65,536; the hunt uses 32,768, so e = 1/2, and 65,536 kills every pond):
   * a pond dies at a boundary if it is unoccupied or its death key is below
   * `pondDeath * 65,536` (applyCurrentCycle, packages/schema/src/ponds.ts).
   * Set exactly when `pondArm` is "nat" or "shuf", and then required; absent
   * for "scaf", "rand", "cont" and without a pond cycle.
   *
   * Optional, absent from `defaultConfig()` and from every preset, for the
   * reason `pondPeriod` is: the keys enter `stateHash`/`artifactDigest` through
   * the config's own JSON, so every config without them hashes exactly as it
   * did before the current existed.
   */
  pondDeath?: number;
  /**
   * The current's export threshold (integer 1..32; the hunt uses 28): the
   * export zone is the cells of a pond whose torus Chebyshev distance from the
   * landing centre (32, 32) is at least `pondExport` (`exportDistance`; 1,071
   * cells at 28). Set exactly when `pondArm` is "nat" or "shuf"; see
   * `pondDeath`.
   */
  pondExport?: number;
}

/**
 * Bit layout for a namespaced LIN_LO (see `WorldConfig.ringNamespace`): the
 * top `RING_NAMESPACE_BITS` bits hold the ring member's namespace, the rest
 * hold the founder/mutation-cell index LIN_LO always encoded before
 * namespacing existed. 10 bits comfortably covers a metapopulation ring (the
 * coordinator caps `seeds` at 1000 per experiment); the remaining 22 bits
 * cover any preset in use today (all well under `2 ** 22` cells) and are
 * enforced as a hard cap on a *namespaced* config's `cellCount` specifically
 * (see `validateConfig`) — an unnamespaced config keeps the unrelated,
 * looser `2 ** 24` cap `cellCount(c) > 1 << 24` already checks.
 */
export const RING_NAMESPACE_BITS = 10;
export const RING_CELL_BITS = 32 - RING_NAMESPACE_BITS;
export const RING_CELL_MASK = (1 << RING_CELL_BITS) - 1;
export const MAX_RING_NAMESPACE = (1 << RING_NAMESPACE_BITS) - 1;

/**
 * Packs a founder/mutation's raw LIN_LO (`< 2 ** RING_CELL_BITS` for a
 * namespaced config — `validateConfig` enforces this via `cellCount`) with
 * `cfg.ringNamespace`. Returns `raw` completely unchanged when `ringNamespace`
 * is absent (the default for every config that predates this field), so
 * every existing checkpoint/golden hash is byte-for-byte unaffected. The CPU
 * reference (packages/sim-ref) and WGSL kernels
 * (packages/sim-gpu/src/shaders.ts) both mint LIN_LO through this exact
 * formula — the GPU side inlines the identical arithmetic in WGSL (which
 * can't import a TS function), importing `RING_CELL_BITS`/`RING_CELL_MASK`
 * from here so the bit widths are the one shared source of truth.
 */
export function packLineageLo(cfg: { ringNamespace?: number }, raw: number): number {
  if (cfg.ringNamespace === undefined) return raw >>> 0;
  return (((cfg.ringNamespace & MAX_RING_NAMESPACE) << RING_CELL_BITS) | (raw & RING_CELL_MASK)) >>> 0;
}

/**
 * The largest `raw` value `packLineageLo` can pack without silently
 * truncating it (`raw & RING_CELL_MASK` wraps modulo `2 ** RING_CELL_BITS`
 * otherwise, which is exactly how two founders can collide onto the same
 * lineage id -- review P3). A mutation's own `raw` (a cell index) is already
 * bounded by this via `validateConfig`'s `cellCount` check, but a founder's
 * `raw` (`founderIndex + 1`, from `InitSpec.founders.length` -- see
 * `buildWorld` in world.ts) is a *separate* input `validateConfig` never
 * sees, so callers that mint a raw id from something other than a cell index
 * must check it against this themselves before calling `packLineageLo`.
 */
export function maxPackableRaw(cfg: { ringNamespace?: number }): number {
  return cfg.ringNamespace === undefined ? 0xffffffff : RING_CELL_MASK;
}

/** `kAdhesion` when `adhesion` is enabled but `kAdhesion` itself is not set. */
export const DEFAULT_K_ADHESION = 64;

export function defaultConfig(overrides: Partial<WorldConfig> = {}): WorldConfig {
  return {
    ruleVersion: RULE_VERSION,
    seed: 1,
    tileW: 256,
    tileH: 256,
    tilesX: 1,
    tilesY: 1,
    eA: 0,
    eB: 10,
    eC: 2,
    eP: 12,
    massUnit: 256,
    kernelRadius: 9,
    thetaMass: 512,
    dtQ: 51,
    spread: 8,
    defaultMu: 154,
    defaultSigma: 24,
    diffA: 200,
    diffC: 200,
    diffS: 150,
    gateK: 64,
    kCatHalf: 128,
    kPhoto: 160,
    kResp: 128,
    kDecomp: 96,
    kGrow: 128,
    kBuild: 64,
    kEmit: 64,
    kCost: 64,
    kMaint: 200,
    kPDecay: 66,
    kBDecay: 20,
    kELeak: 330,
    kSDecay: 1300,
    kAbio: 400,
    mutRate: 429_497,
    mutStep: 24,
    lightMode: "gradient",
    lightBase: 40,
    lightAmp: 200,
    seasonPeriod: 0,
    seasonAmp: 0,
    eventCap: 1 << 16,
    neutral: false,
    motility: true,
    // migrationPeriod/migrantCount, pondPeriod/pondK/pondArm and pondDeath/pondExport deliberately absent here — see their docs on WorldConfig.
    ...overrides,
  };
}

export const worldW = (c: WorldConfig) => c.tileW * c.tilesX;
export const worldH = (c: WorldConfig) => c.tileH * c.tilesY;
export const cellCount = (c: WorldConfig) => worldW(c) * worldH(c);

/** Numeric view of the config used for WGSL constants and validation. */
export function lightModeId(m: LightMode): number {
  return m === "uniform" ? 0 : m === "gradient" ? 1 : 2;
}

/**
 * Arithmetic-safety bounds. Every intermediate product in the rules is proved
 * to fit in u32/i32 under these limits (see docs/rules.md, "Bounds"):
 *  - total world matter <= MATTER_MAX, so every matter channel and every
 *    per-reaction amount is <= 2^26;
 *  - energy ladder values <= 31, so amount x energy gap < 2^31;
 *  - free energy E and signal S per cell are capped at POOL_MAX; excess is
 *    exported as heat, which keeps the ledger exact.
 */
export const MATTER_MAX = 2 ** 26;
export const POOL_MAX = 2 ** 28;
/** Cumulative ledger ceiling for accepted states; steps that would cross 2^64 raise an overflow flag. */
export const LEDGER_MAX = 1n << 63n;
/** Last step index that can be taken; lineage ids use step + 1 as a u32. */
export const MAX_STEP = 0xffff_fff0;

type Range = [number, number];
const RANGES: Partial<Record<keyof WorldConfig, Range>> = {
  seed: [0, 0xffffffff],
  tileW: [8, 4096],
  tileH: [8, 4096],
  tilesX: [1, 256],
  tilesY: [1, 256],
  eA: [0, 31],
  eB: [0, 31],
  eC: [0, 31],
  eP: [0, 31],
  massUnit: [16, 4096],
  kernelRadius: [2, 16],
  thetaMass: [1, 2048],
  dtQ: [0, 1024],
  spread: [0, 32],
  defaultMu: [0, 4095],
  defaultSigma: [1, 1023],
  diffA: [0, 256],
  diffC: [0, 256],
  diffS: [0, 256],
  gateK: [1, 65535],
  kCatHalf: [0, 65535],
  kPhoto: [0, 4096],
  kResp: [0, 4096],
  kDecomp: [0, 4096],
  kGrow: [0, 4096],
  kBuild: [0, 4096],
  kEmit: [0, 4096],
  kCost: [0, 65535],
  kMaint: [0, 65535],
  kPDecay: [0, 65535],
  kBDecay: [0, 65535],
  kELeak: [0, 65535],
  kSDecay: [0, 65535],
  kAbio: [0, 65535],
  // Bounded so kAdhesion * gradP (|gradP| <= 4*16383 = 65532, see poly() in
  // packages/sim-ref/src/step.ts) stays far under 2^31, matching the same
  // margin as the existing alpha * gradM term in flow().
  kAdhesion: [0, 1024],
  mutRate: [0, 0xffffffff],
  mutStep: [1, 127],
  lightBase: [0, 255],
  lightAmp: [0, 255],
  seasonPeriod: [0, 8_000_000],
  seasonAmp: [0, 255],
  eventCap: [1, 1 << 22],
};
/** Bounds for migrationPeriod/migrantCount, checked explicitly in `validateConfig` (see WorldConfig's doc on why they're not in `RANGES`/the generic per-key loop). */
const MIGRATION_PERIOD_RANGE: Range = [0, 8_000_000];
const MIGRANT_COUNT_RANGE: Range = [0, 4096];
/** Bounds for pondPeriod/pondK, checked explicitly in `validateConfig` like migration's. A pond is a 64 x 64 tile, so k <= 64. */
const POND_PERIOD_RANGE: Range = [1, MAX_STEP];
const POND_K_RANGE: Range = [1, 64];
/** Bounds for pondDeath (a probability in 1/65,536) and pondExport (a Chebyshev distance on the 64-torus is at most 32). */
const POND_DEATH_RANGE: Range = [1, 65_536];
const POND_EXPORT_RANGE: Range = [1, 32];
const POND_ARMS: readonly PondArm[] = ["scaf", "rand", "cont", "nat", "shuf"];

export function validateConfig(c: WorldConfig): string[] {
  const errs: string[] = [];
  if (c === null || typeof c !== "object") return ["config must be an object"];
  const defaults = defaultConfig();
  for (const k of Object.keys(defaults) as (keyof WorldConfig)[]) {
    const v = c[k];
    const want = typeof defaults[k];
    if (typeof v !== want) {
      errs.push(`${k} must be a ${want}`);
      continue;
    }
    const r = RANGES[k];
    if (r && (!Number.isInteger(v) || (v as number) < r[0] || (v as number) > r[1])) errs.push(`${k} must be an integer in ${r[0]}..${r[1]}`);
  }
  // adhesion/kAdhesion are optional (see WorldConfig) and so are not in
  // defaultConfig()'s keys above; validate them only when present, since a
  // missing key is a valid, meaningful value (off / DEFAULT_K_ADHESION).
  if (c.adhesion !== undefined && typeof c.adhesion !== "boolean") errs.push("adhesion must be a boolean");
  if (c.kAdhesion !== undefined) {
    const r = RANGES.kAdhesion!;
    if (typeof c.kAdhesion !== "number" || !Number.isInteger(c.kAdhesion) || c.kAdhesion < r[0] || c.kAdhesion > r[1])
      errs.push(`kAdhesion must be an integer in ${r[0]}..${r[1]}`);
  }
  if (errs.length) return errs;
  if (c.ruleVersion !== RULE_VERSION) errs.push(`ruleVersion ${c.ruleVersion} != ${RULE_VERSION}`);
  if (!["uniform", "gradient", "patches"].includes(c.lightMode)) errs.push("lightMode must be uniform, gradient or patches");
  if (c.tileW % 8 !== 0 || c.tileH % 8 !== 0) errs.push("tile dimensions must be multiples of 8");
  if (c.kernelRadius * 2 + 1 > Math.min(c.tileW, c.tileH)) errs.push("kernel larger than tile");
  if (cellCount(c) > 1 << 24) errs.push("world larger than 2^24 cells");
  if (!(c.eB > c.eC && c.eC >= c.eA && c.eP > c.eB)) errs.push("energy ladder must satisfy eP > eB > eC >= eA");
  if ((c.massUnit & (c.massUnit - 1)) !== 0) errs.push("massUnit must be a power of two");
  if (c.lightBase + c.lightAmp + c.seasonAmp > 255) errs.push("light must stay within 0..255");
  // Optional fields, so checked explicitly rather than through the generic loop above
  // (see WorldConfig's doc on migrationPeriod for why they're not in `defaultConfig`/`RANGES`).
  for (const [key, range] of [
    ["migrationPeriod", MIGRATION_PERIOD_RANGE],
    ["migrantCount", MIGRANT_COUNT_RANGE],
    ["ringNamespace", [0, MAX_RING_NAMESPACE] as Range],
    ["pondPeriod", POND_PERIOD_RANGE],
    ["pondK", POND_K_RANGE],
    ["pondDeath", POND_DEATH_RANGE],
    ["pondExport", POND_EXPORT_RANGE],
  ] as const) {
    const v = c[key];
    if (v === undefined) continue;
    if (!Number.isInteger(v) || v < range[0] || v > range[1]) errs.push(`${key} must be an integer in ${range[0]}..${range[1]}`);
  }
  if (c.pondArm !== undefined && !POND_ARMS.includes(c.pondArm)) errs.push("pondArm must be scaf, rand, cont, nat or shuf");
  const pondKeys = [c.pondPeriod, c.pondK, c.pondArm].filter((v) => v !== undefined).length;
  if (pondKeys !== 0 && pondKeys !== 3) errs.push("pondPeriod, pondK and pondArm must be set together");
  // The current's keys go with its arms, both required there and neither anywhere else.
  const current = c.pondArm === "nat" || c.pondArm === "shuf";
  for (const key of ["pondDeath", "pondExport"] as const) {
    if (current && c[key] === undefined) errs.push(`${key} is required when pondArm is nat or shuf`);
    if (!current && c[key] !== undefined) errs.push(`${key} may be set only when pondArm is nat or shuf`);
  }
  if (errs.length) return errs;
  const migrationPeriod = c.migrationPeriod ?? 0;
  const migrantCount = c.migrantCount ?? 0;
  if (migrationPeriod > 0 && c.tilesX * c.tilesY < 2) errs.push("migrationPeriod > 0 requires at least 2 tiles (tilesX * tilesY > 1)");
  if (migrationPeriod > 0 && migrantCount < 1) errs.push("migrationPeriod > 0 requires migrantCount >= 1");
  // migration.ts assigns each migrant slot a unique within-tile offset (linear
  // probing over the tile's own cells); more slots than cells in a tile could
  // never all be unique.
  if (migrationPeriod > 0 && migrantCount > c.tileW * c.tileH) errs.push("migrantCount must be at most tileW * tileH (offsets must be unique within a tile)");
  // A namespaced LIN_LO reserves its top RING_NAMESPACE_BITS bits for
  // ringNamespace, leaving only RING_CELL_BITS for the founder/mutation-cell
  // index packLineageLo packs in -- every cell index (and founder index) must
  // fit in that narrower range, or two different cells could pack to the same
  // LIN_LO (a real, not just cosmetic, collision).
  if (c.ringNamespace !== undefined && cellCount(c) > 1 << RING_CELL_BITS) errs.push(`a namespaced config (ringNamespace set) must have cellCount at most 2^${RING_CELL_BITS}`);
  // The pond cycle (see WorldConfig's pondPeriod): ponds are the protocol's
  // 64 x 64 tiles, D = max(1, floor(R / 4)) donors need R >= 4 ponds, and each
  // pond's matter must stay its own -- so no tile migration and no
  // metapopulation ring (the runner rejects an immigrant state as well).
  if (c.pondPeriod !== undefined) {
    if (c.tileW !== 64 || c.tileH !== 64) errs.push("a pond config (pondPeriod set) must have 64x64 tiles");
    if (c.tilesX * c.tilesY < 4) errs.push("a pond config (pondPeriod set) must have at least 4 ponds (tilesX * tilesY >= 4)");
    if (migrationPeriod > 0) errs.push("a pond config (pondPeriod set) cannot migrate between tiles (migrationPeriod > 0)");
    if (c.ringNamespace !== undefined) errs.push("a pond config (pondPeriod set) cannot be a metapopulation member (ringNamespace set)");
  }
  return errs;
}

/** Largest lesion radius that keeps a disc inside one tile without wrapping onto itself. */
export function maxLesionRadius(c: WorldConfig): number {
  return Math.floor((Math.min(c.tileW, c.tileH) - 1) / 2);
}

export function clampLesionRadius(c: WorldConfig, r: number): number {
  return Math.max(0, Math.min(Math.floor(r), maxLesionRadius(c)));
}
