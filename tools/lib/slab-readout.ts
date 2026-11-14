// The rung 1b depth check's readout, exactly as fixed (docs/3d-brainstorm-2026-10-22.md section 5, rung 1b; plan
// docs/3d-rung1b-plan-2026-10-23.md section 5.2; execution notes docs/3d-rung1b-m5-plan.md section 7). Pure: no Deno, no
// file system; tools/slab-readout.ts loads the text and passes it in.
//
// The rule, in this module's terms:
//   * Activity: for a layer group, sum photo, grow, decomp and resp over its layers and over the 10 censuses ending at step
//     300,000 (291,000 ... 300,000). Saturation of the 16-bit counts is reported, never corrected, and never enters a decision.
//   * Photo share of a group = photo / (photo + grow + decomp + resp). A zero total leaves the share undefined.
//   * D = photo share of the top two layers (z in {0, 1}) - photo share of the bottom two (z in {6, 7}). If either share is
//     undefined, D is undefined.
//   * Bar: m = mean and r = range (max - min) of the neutral seeds' D. An evolving seed passes iff D > m + r (strictly);
//     an evolving seed whose D is undefined fails.
//   * Decision on seeds 1-3 of each arm: 3 of 3 pass -> go; 0 of 3 -> pause (depth did nothing beyond the light); 1 or 2 ->
//     extend: seeds 4-6 of each arm, m and r recomputed over all 6 neutral seeds, go only if at least 5 of the 6 evolving
//     seeds pass, else pause.
//   * An undefined neutral D (any neutral seed in play) is not dropped, replaced or rerun: the verdict is
//     "pause: control undefined".
// All arithmetic that decides anything is exact (BigInt rationals); decimals are printed beside the fractions for reading.

export const TOP: readonly number[] = [0, 1];
export const BOTTOM: readonly number[] = [6, 7];
export const DEPTH = 8;
export const CENSUS_EVERY = 1000;
export const FINAL_STEP = 300_000;
export const WINDOW = 10;
export const FIRST_SEEDS: readonly number[] = [1, 2, 3];
export const EXTENSION_SEEDS: readonly number[] = [4, 5, 6];
export const LAYERS_HEADER = "step\tz\tphoto\tgrow\tdecomp\tresp\tsaturated";

/** The input is not a usable bundle: an operational failure, never a verdict. */
export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

// ------------------------------------------------------------------------------------------ exact rationals
export interface Rat {
  n: bigint;
  d: bigint;
}
const gcd = (a: bigint, b: bigint): bigint => {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
};
export function rat(n: bigint, d: bigint = 1n): Rat {
  if (d === 0n) throw new Error("rat: zero denominator");
  if (d < 0n) [n, d] = [-n, -d];
  const g = gcd(n, d) || 1n;
  return { n: n / g, d: d / g };
}
export const ratAdd = (a: Rat, b: Rat): Rat => rat(a.n * b.d + b.n * a.d, a.d * b.d);
export const ratSub = (a: Rat, b: Rat): Rat => rat(a.n * b.d - b.n * a.d, a.d * b.d);
export const ratDiv = (a: Rat, k: bigint): Rat => rat(a.n, a.d * k);
/** -1, 0 or 1, by cross-multiplication. */
export const ratCmp = (a: Rat, b: Rat): number => {
  const l = a.n * b.d, r = b.n * a.d;
  return l < r ? -1 : l > r ? 1 : 0;
};
export const ratStr = (a: Rat): string => `${a.n}/${a.d}`;
/** Decimal text of `a` rounded half away from zero to `digits` places (exact BigInt arithmetic). */
export function ratDecimal(a: Rat, digits = 6): string {
  const neg = a.n < 0n;
  const abs = neg ? -a.n : a.n;
  const scale = 10n ** BigInt(digits);
  const scaled = (abs * scale * 2n + a.d) / (a.d * 2n);
  const whole = scaled / scale;
  const frac = (scaled % scale).toString().padStart(digits, "0");
  return `${neg && scaled !== 0n ? "-" : ""}${whole}.${frac}`;
}

// ------------------------------------------------------------------------------------------ layers.tsv
export interface LayerRow {
  step: number;
  z: number;
  photo: bigint;
  grow: bigint;
  decomp: bigint;
  resp: bigint;
  saturated: bigint;
}

/** Parses a slab bundle's layers.tsv: the exact header, seven non-negative integers per line, z in 0..7, no repeated (step, z). */
export function parseLayers(text: string): LayerRow[] {
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  if (lines[0] !== LAYERS_HEADER) throw new InputError(`layers.tsv: the header is ${JSON.stringify(lines[0] ?? "")}, expected ${JSON.stringify(LAYERS_HEADER)}`);
  const seen = new Set<string>();
  const out: LayerRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split("\t");
    if (cols.length !== 7 || cols.some((c) => !/^\d+$/.test(c))) throw new InputError(`layers.tsv line ${i + 1}: expected 7 non-negative integers, got ${JSON.stringify(lines[i])}`);
    const [step, z] = [Number(cols[0]), Number(cols[1])];
    if (!Number.isSafeInteger(step) || z >= DEPTH) throw new InputError(`layers.tsv line ${i + 1}: step ${cols[0]} or layer ${cols[1]} is out of range (layers are 0..${DEPTH - 1})`);
    const key = `${step}:${z}`;
    if (seen.has(key)) throw new InputError(`layers.tsv line ${i + 1}: step ${step} layer ${z} appears twice`);
    seen.add(key);
    out.push({ step, z, photo: BigInt(cols[2]), grow: BigInt(cols[3]), decomp: BigInt(cols[4]), resp: BigInt(cols[5]), saturated: BigInt(cols[6]) });
  }
  return out;
}

// ------------------------------------------------------------------------------------------ per-seed statistics
export interface Window {
  /** The last census step (300,000 for the check). */
  finalStep: number;
  /** How many censuses end at it (10 for the check). */
  censuses: number;
}
export const CHECK_WINDOW: Window = { finalStep: FINAL_STEP, censuses: WINDOW };

/** The census steps of a window, ascending: finalStep - 1000 * (censuses - 1) ... finalStep. */
export const windowSteps = (w: Window): number[] => Array.from({ length: w.censuses }, (_, k) => w.finalStep - CENSUS_EVERY * (w.censuses - 1 - k));

export interface GroupSums {
  photo: bigint;
  grow: bigint;
  decomp: bigint;
  resp: bigint;
  /** photo + grow + decomp + resp */
  total: bigint;
  /** Count fields at their 65,535 cap inside the group, over the window (reported only). */
  saturated: bigint;
  /** Count fields examined: censuses x layers x cells x 4. */
  fields: bigint;
}

export interface SeedStats {
  top: GroupSums;
  bottom: GroupSums;
  /** Saturation over all layers: the saturated fields and the fields examined. */
  all: { saturated: bigint; fields: bigint };
  /** photo / total for the group, or undefined when the total is zero. */
  shareTop: Rat | undefined;
  shareBottom: Rat | undefined;
  /** shareTop - shareBottom, or undefined when either share is. */
  D: Rat | undefined;
}

const obj = (v: unknown, what: string): Record<string, unknown> => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new InputError(`${what} is not an object`);
  return v as Record<string, unknown>;
};

/**
 * The statistics of one history: sums of each group over the window's censuses. Validates the manifest (a finished 300,000-step
 * run at census 1,000 and deep 1 with 8 layers) and that every step of the window has all 8 layers, rather than trusting that
 * layers.tsv happens to hold ten censuses; rows at other steps are ignored.
 */
export function seedStats(layersText: string, manifest: unknown, window: Window = CHECK_WINDOW): SeedStats {
  const m = obj(manifest, "manifest");
  const summary = m.summary;
  if (typeof summary !== "object" || summary === null) throw new InputError("manifest has no summary: the run did not finish");
  if ((summary as { steps?: unknown }).steps !== window.finalStep) throw new InputError(`manifest summary.steps is ${(summary as { steps?: unknown }).steps}, expected ${window.finalStep}`);
  const spec = obj(m.spec, "manifest.spec");
  if (spec.censusEvery !== CENSUS_EVERY) throw new InputError(`manifest spec.censusEvery is ${spec.censusEvery}, expected ${CENSUS_EVERY}`);
  if (spec.deepEvery !== 1) throw new InputError(`manifest spec.deepEvery is ${spec.deepEvery}, expected 1 (layers.tsv rows are written at deep censuses)`);
  const cfg = obj(m.cfg, "manifest.cfg");
  if (cfg.tileD !== DEPTH) throw new InputError(`manifest cfg.tileD is ${cfg.tileD}, expected ${DEPTH}`);
  const w = cfg.tileW, h = cfg.tileH;
  if (typeof w !== "number" || typeof h !== "number" || !Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w <= 0 || h <= 0)
    throw new InputError(`manifest cfg.tileW and tileH must be positive integers, got ${JSON.stringify(w)} and ${JSON.stringify(h)}`);
  const cells = BigInt(w) * BigInt(h);

  const byStep = new Map<number, Map<number, LayerRow>>();
  for (const r of parseLayers(layersText)) {
    let layers = byStep.get(r.step);
    if (!layers) byStep.set(r.step, (layers = new Map()));
    layers.set(r.z, r);
  }
  const steps = windowSteps(window);
  for (const s of steps) {
    const layers = byStep.get(s);
    if (!layers) throw new InputError(`layers.tsv has no census at step ${s}`);
    for (let z = 0; z < DEPTH; z++) if (!layers.has(z)) throw new InputError(`layers.tsv has no layer ${z} at step ${s}`);
  }

  const group = (zs: readonly number[]): GroupSums => {
    let photo = 0n, grow = 0n, decomp = 0n, resp = 0n, saturated = 0n;
    for (const s of steps)
      for (const z of zs) {
        const r = byStep.get(s)!.get(z)!;
        photo += r.photo;
        grow += r.grow;
        decomp += r.decomp;
        resp += r.resp;
        saturated += r.saturated;
      }
    return { photo, grow, decomp, resp, total: photo + grow + decomp + resp, saturated, fields: BigInt(steps.length) * BigInt(zs.length) * cells * 4n };
  };
  const top = group(TOP), bottom = group(BOTTOM);
  let allSat = 0n;
  for (const s of steps) for (let z = 0; z < DEPTH; z++) allSat += byStep.get(s)!.get(z)!.saturated;
  const shareTop = top.total > 0n ? rat(top.photo, top.total) : undefined;
  const shareBottom = bottom.total > 0n ? rat(bottom.photo, bottom.total) : undefined;
  const D = shareTop && shareBottom ? ratSub(shareTop, shareBottom) : undefined;
  return { top, bottom, all: { saturated: allSat, fields: BigInt(steps.length) * BigInt(DEPTH) * cells * 4n }, shareTop, shareBottom, D };
}

// ------------------------------------------------------------------------------------------ the decision
export interface Bar {
  /** Seeds whose D formed the bar. */
  seeds: number[];
  /** Mean of the neutral D. */
  m: Rat;
  /** Range (max - min) of the neutral D. */
  r: Rat;
  /** m + r: an evolving seed passes iff its D is strictly above. */
  threshold: Rat;
}

export interface SeedJudgement {
  seed: number;
  stats: SeedStats;
  /** Evolving seeds only: whether D > threshold (false when D is undefined). */
  pass?: boolean;
}

export type Verdict = "go" | "pause" | "pause: control undefined" | "extend: waiting for seeds";

export interface Decision {
  verdict: Verdict;
  /** Plain-language reason, one sentence. */
  reason: string;
  /** What the first three seeds of each arm said, before any extension. */
  phase1: { outcome: "go" | "pause" | "extend" | "pause: control undefined"; passes: number; bar?: Bar };
  /** Set when the extension was needed and present: the bar over all six neutral seeds and the pass count over six. */
  phase2?: { bar: Bar; passes: number };
  /** The bar the verdict rests on (phase 2's when there was an extension, else phase 1's). */
  bar?: Bar;
  neutral: SeedJudgement[];
  evolving: SeedJudgement[];
  /** Seeds present but not used (4-6 when phase 1 settled it). */
  unused: { arm: "evolving" | "neutral"; seed: number }[];
  /** For "extend: waiting for seeds": the missing (arm, seed) pairs. */
  waitingFor?: { arm: "evolving" | "neutral"; seed: number }[];
}

export interface DecisionInput {
  evolving: ReadonlyMap<number, SeedStats>;
  neutral: ReadonlyMap<number, SeedStats>;
}

/** The bar from the neutral D of `seeds`; undefined if any of them has no D. */
function barOf(neutral: ReadonlyMap<number, SeedStats>, seeds: readonly number[]): Bar | undefined {
  const ds: Rat[] = [];
  for (const s of seeds) {
    const d = neutral.get(s)!.D;
    if (!d) return undefined;
    ds.push(d);
  }
  let sum = rat(0n), min = ds[0], max = ds[0];
  for (const d of ds) {
    sum = ratAdd(sum, d);
    if (ratCmp(d, min) < 0) min = d;
    if (ratCmp(d, max) > 0) max = d;
  }
  const m = ratDiv(sum, BigInt(ds.length));
  const r = ratSub(max, min);
  return { seeds: [...seeds], m, r, threshold: ratAdd(m, r) };
}

const judgeEvolving = (evolving: ReadonlyMap<number, SeedStats>, seeds: readonly number[], bar: Bar): SeedJudgement[] =>
  seeds.map((seed) => {
    const stats = evolving.get(seed)!;
    return { seed, stats, pass: stats.D !== undefined && ratCmp(stats.D, bar.threshold) > 0 };
  });
const plain = (map: ReadonlyMap<number, SeedStats>, seeds: readonly number[]): SeedJudgement[] => seeds.map((seed) => ({ seed, stats: map.get(seed)! }));

/** The whole rule. Throws InputError when seeds 1-3 are not present in both arms. */
export function decide(input: DecisionInput): Decision {
  const { evolving, neutral } = input;
  for (const [arm, map] of [["evolving", evolving], ["neutral", neutral]] as const)
    for (const s of FIRST_SEEDS) if (!map.has(s)) throw new InputError(`the ${arm} arm has no seed ${s}: the check needs seeds ${FIRST_SEEDS.join(", ")} of both arms`);
  const present = (map: ReadonlyMap<number, SeedStats>) => EXTENSION_SEEDS.filter((s) => map.has(s));
  const extensionPresent = (arm: "evolving" | "neutral") => present(arm === "evolving" ? evolving : neutral).map((seed) => ({ arm, seed }));
  const allUnused = () => [...extensionPresent("evolving"), ...extensionPresent("neutral")];
  const neutral1 = plain(neutral, FIRST_SEEDS);

  // Phase 1: seeds 1-3.
  const bar1 = barOf(neutral, FIRST_SEEDS);
  if (!bar1) {
    return {
      verdict: "pause: control undefined",
      reason: "a neutral seed's D is undefined (an empty top or bottom group), so the bar cannot be formed; nothing is dropped, replaced or rerun",
      phase1: { outcome: "pause: control undefined", passes: 0 },
      neutral: neutral1,
      evolving: plain(evolving, FIRST_SEEDS),
      unused: allUnused(),
    };
  }
  const evolving1 = judgeEvolving(evolving, FIRST_SEEDS, bar1);
  const p1 = evolving1.filter((j) => j.pass).length;
  const outcome1 = p1 === 3 ? "go" : p1 === 0 ? "pause" : "extend";
  const base = { phase1: { outcome: outcome1, passes: p1, bar: bar1 } as Decision["phase1"], neutral: neutral1, evolving: evolving1, bar: bar1 };
  if (outcome1 === "go") return { ...base, verdict: "go", reason: "3 of 3 evolving seeds pass: go to rung 2", unused: allUnused() };
  if (outcome1 === "pause") return { ...base, verdict: "pause", reason: "0 of 3 evolving seeds pass: depth did nothing beyond the light, and the line pauses", unused: allUnused() };

  // Phase 2: 1 or 2 of 3 passed; seeds 4-6 of each arm decide.
  // An undefined neutral D among the extension seeds already finished is "pause: control undefined" now: that is what the
  // fixed rule says of any neutral seed in play, and it does not wait for the other extension seeds (nothing is dropped,
  // replaced or rerun, so waiting could only end the same way).
  const lateNeutral = EXTENSION_SEEDS.filter((s) => neutral.has(s));
  if (lateNeutral.some((s) => !neutral.get(s)!.D)) {
    const have = (map: ReadonlyMap<number, SeedStats>) => [...FIRST_SEEDS, ...EXTENSION_SEEDS].filter((s) => map.has(s));
    return {
      ...base,
      neutral: plain(neutral, have(neutral)),
      evolving: plain(evolving, have(evolving)),
      bar: undefined,
      verdict: "pause: control undefined",
      reason: "a neutral seed's D is undefined in the extension, so the bar over six neutral seeds cannot be formed; nothing is dropped, replaced or rerun",
      unused: [],
    };
  }
  const missing: { arm: "evolving" | "neutral"; seed: number }[] = [];
  for (const arm of ["evolving", "neutral"] as const) for (const seed of EXTENSION_SEEDS) if (!(arm === "evolving" ? evolving : neutral).has(seed)) missing.push({ arm, seed });
  if (missing.length)
    return {
      ...base,
      verdict: "extend: waiting for seeds",
      reason: `${p1} of 3 evolving seeds pass: run seeds ${EXTENSION_SEEDS.join(", ")} of each arm (missing: ${missing.map((x) => `${x.arm} ${x.seed}`).join(", ")})`,
      unused: allUnused(),
      waitingFor: missing,
    };
  const all6 = [...FIRST_SEEDS, ...EXTENSION_SEEDS];
  const bar2 = barOf(neutral, all6);
  const neutral6 = plain(neutral, all6);
  if (!bar2)
    return {
      ...base,
      neutral: neutral6,
      evolving: plain(evolving, all6),
      bar: undefined,
      verdict: "pause: control undefined",
      reason: "a neutral seed's D is undefined in the extension, so the bar over six neutral seeds cannot be formed; nothing is dropped, replaced or rerun",
      unused: [],
    };
  const evolving6 = judgeEvolving(evolving, all6, bar2);
  const p2 = evolving6.filter((j) => j.pass).length;
  return {
    ...base,
    neutral: neutral6,
    evolving: evolving6,
    bar: bar2,
    phase2: { bar: bar2, passes: p2 },
    verdict: p2 >= 5 ? "go" : "pause",
    reason: p2 >= 5 ? `${p2} of 6 evolving seeds pass the recomputed bar (at least 5 needed): go to rung 2` : `${p2} of 6 evolving seeds pass the recomputed bar (at least 5 needed): the line pauses`,
    unused: [],
  };
}

// ------------------------------------------------------------------------------------------ what a bundle must be
/** The preset of the check. */
export const PRESET_ID = "slab-spots";
/** The check's fixed world (docs/3d-rung1b-plan-2026-10-23.md section 5.1), written here independently of the preset in code. */
export const PROTOCOL_CFG: Readonly<Record<string, number | string>> = {
  tileW: 256, tileH: 256, tilesX: 1, tilesY: 1, tileD: DEPTH, kernelRadius: 3,
  lightMode: "uniform", lightBase: 40, lightAmp: 200, seasonPeriod: 0, seasonAmp: 0,
};
/** The check's founding: eight balls, nutrient 32 everywhere, biomass 64 in the balls. */
export const PROTOCOL_INIT: Readonly<Record<string, number | string>> = { kind: "slab-spots", founders: 8, nutrient: 32, biomass: 64 };
/** The M4 pick, and nothing else, may be overridden (and must be: every bundle records all three). */
export const OVERRIDE_KEYS: readonly string[] = ["defaultMu", "defaultSigma", "lightK"];

/** Where a bundle sits: its arm, its condition (the evolving arm is the condition `treatment`), its seed and its experiment. */
export interface Slot {
  arm: "evolving" | "neutral";
  condition: "treatment" | "neutral";
  seed: number;
  experiment: string;
  /** The run's last step (300,000; a rehearsal's own). */
  steps: number;
}

const sortedJson = (o: Record<string, unknown>): string => JSON.stringify(Object.fromEntries(Object.entries(o).sort(([x], [y]) => (x < y ? -1 : 1))));

/**
 * Throws InputError unless `manifest` is the run of `slot` in the fixed check: the manifest's spec says the same experiment,
 * preset, condition, seed and steps as the slot it was found in; its config is the protocol's world (256 x 256 x 8, kernel
 * radius 3, uniform light 40 + 200, seasons off, one tile) with the arm's seed and neutral switch and the three recorded
 * overrides (whatever M4 chose; never assumed here); its founding is the protocol's. `expectedCfg` is the config the code
 * builds for that spec (`specConfig`); the bundle's must equal it except `ruleVersion`, which the cross-bundle agreement covers.
 * The point is that a copied or renamed directory cannot count as another seed or arm, and a different world cannot count at all.
 */
export function checkBundleIdentity(manifest: unknown, slot: Slot, expectedCfg: Record<string, unknown>): void {
  const m = obj(manifest, "manifest");
  const spec = obj(m.spec, "manifest.spec");
  const want: [string, unknown][] = [["experiment", slot.experiment], ["presetId", PRESET_ID], ["condition", slot.condition], ["seed", slot.seed], ["steps", slot.steps]];
  for (const [k, v] of want) if (spec[k] !== v) throw new InputError(`manifest spec.${k} is ${JSON.stringify(spec[k])}, but this is the ${slot.arm} slot ${JSON.stringify(v)} (${k})`);
  const ov = obj(spec.overrides, "manifest.spec.overrides");
  const keys = Object.keys(ov).sort();
  if (keys.join(",") !== [...OVERRIDE_KEYS].sort().join(",")) throw new InputError(`manifest spec.overrides has keys ${keys.join(", ") || "none"}; the check overrides exactly ${OVERRIDE_KEYS.join(", ")}`);
  for (const k of OVERRIDE_KEYS) if (!Number.isSafeInteger(ov[k])) throw new InputError(`manifest spec.overrides.${k} is ${JSON.stringify(ov[k])}, not an integer`);
  const cfg = obj(m.cfg, "manifest.cfg");
  for (const [k, v] of Object.entries(PROTOCOL_CFG)) if (cfg[k] !== v) throw new InputError(`manifest cfg.${k} is ${JSON.stringify(cfg[k])}, the protocol has ${JSON.stringify(v)}`);
  if (cfg.seed !== slot.seed) throw new InputError(`manifest cfg.seed is ${JSON.stringify(cfg.seed)}, but this is seed ${slot.seed}`);
  if (cfg.neutral !== (slot.arm === "neutral")) throw new InputError(`manifest cfg.neutral is ${JSON.stringify(cfg.neutral)}, but this is the ${slot.arm} arm`);
  for (const k of OVERRIDE_KEYS) if (cfg[k] !== ov[k]) throw new InputError(`manifest cfg.${k} is ${JSON.stringify(cfg[k])} but spec.overrides.${k} is ${JSON.stringify(ov[k])}`);
  const init = obj(m.init, "manifest.init");
  for (const [k, v] of Object.entries(PROTOCOL_INIT)) if (init[k] !== v) throw new InputError(`manifest init.${k} is ${JSON.stringify(init[k])}, the protocol has ${JSON.stringify(v)}`);
  if (Object.keys(init).length !== Object.keys(PROTOCOL_INIT).length) throw new InputError(`manifest init has keys ${Object.keys(init).sort().join(", ")}, the protocol has ${Object.keys(PROTOCOL_INIT).sort().join(", ")}`);
  const { ruleVersion: _a, ...gotCfg } = cfg;
  const { ruleVersion: _b, ...wantCfg } = expectedCfg;
  if (sortedJson(gotCfg) !== sortedJson(wantCfg)) {
    const diff = [...new Set([...Object.keys(gotCfg), ...Object.keys(wantCfg)])].find((k) => JSON.stringify(gotCfg[k]) !== JSON.stringify(wantCfg[k]));
    throw new InputError(`manifest cfg is not the check's world: cfg.${diff} is ${JSON.stringify(gotCfg[diff!])}, expected ${JSON.stringify(wantCfg[diff!])}`);
  }
}

/** Throws InputError when two slots hold the same final state hash (one history copied into two directories), or when a hash is absent. */
export function checkDistinctHistories(entries: readonly { label: string; finalHash: unknown }[]): void {
  const seen = new Map<string, string>();
  for (const e of entries) {
    if (typeof e.finalHash !== "string" || e.finalHash === "") throw new InputError(`${e.label}: manifest summary.finalHash is missing`);
    const prior = seen.get(e.finalHash);
    if (prior !== undefined) throw new InputError(`${prior} and ${e.label} hold the same final state hash: one history cannot stand for two seeds or arms`);
    seen.set(e.finalHash, e.label);
  }
}

/**
 * Why a bundle's layers.tsv is not the whole of a finished `steps`-step run at `censusEvery` (deep every census), or null: the
 * exact header, one census per `censusEvery` steps (the last at `steps`), eight rows each, the last row complete. A run writes
 * its summary before its last files, so a manifest with a summary does not by itself say the bundle is whole.
 */
export function layersIncomplete(text: string, steps: number, censusEvery: number): string | null {
  if (!text.endsWith("\n")) return "layers.tsv does not end in a newline (cut off mid-row)";
  const lines = text.slice(0, -1).split("\n");
  if (lines[0] !== LAYERS_HEADER) return "layers.tsv has the wrong header";
  const rows = Math.ceil(steps / censusEvery) * DEPTH;
  if (lines.length - 1 !== rows) return `layers.tsv has ${lines.length - 1} rows, expected ${rows}`;
  const last = lines[lines.length - 1].split("\t");
  if (last.length !== 7 || Number(last[0]) !== steps || Number(last[1]) !== DEPTH - 1) return "layers.tsv does not end with layer 7 of the last census";
  return null;
}

// ------------------------------------------------------------------------------------------ reporting
const frac = (r: Rat | undefined) => (r ? `${ratStr(r)} = ${ratDecimal(r)}` : "undefined");

/** The markdown readout. `banner`, when given, heads the page (the rehearsal's "not a check result"). */
export interface BundleInfo {
  arm: "evolving" | "neutral";
  seed: number;
  conservationOk: unknown;
  extinct: unknown;
}

export function render(decision: Decision, opt: { banner?: string; window?: Window; params?: string; bundles?: readonly BundleInfo[] } = {}): string {
  const w = opt.window ?? CHECK_WINDOW;
  const steps = windowSteps(w);
  const lines: string[] = [];
  if (opt.banner) lines.push(`> ${opt.banner}`, "");
  lines.push("# Rung 1b depth check: readout", "");
  lines.push(`Window: ${steps.length} censuses, steps ${steps[0]} ... ${steps[steps.length - 1]}. Top = layers ${TOP.join(", ")}, bottom = layers ${BOTTOM.join(", ")}.`);
  if (opt.params) lines.push(opt.params);
  lines.push("", `**Verdict: ${decision.verdict}.** ${decision.reason}.`, "");
  const bar = decision.bar;
  if (bar) lines.push(`Bar over neutral seeds ${bar.seeds.join(", ")}: m = ${frac(bar.m)}, r = ${frac(bar.r)}, m + r = ${frac(bar.threshold)}. An evolving seed passes iff D > m + r.`, "");
  if (decision.phase2) lines.push(`Phase 1 (seeds 1-3, bar over 3 neutral seeds): ${decision.phase1.passes} of 3 pass${decision.phase1.bar ? ` (m + r = ${ratDecimal(decision.phase1.bar.threshold)})` : ""}. Extension: ${decision.phase2.passes} of 6 pass.`, "");
  const table = (title: string, js: SeedJudgement[], evo: boolean) => {
    lines.push(`## ${title}`, "", `| seed | top photo | top grow | top decomp | top resp | bottom photo | bottom grow | bottom decomp | bottom resp | share top | share bottom | D |${evo ? " pass |" : ""}`);
    lines.push(`|${"---|".repeat(evo ? 13 : 12)}`);
    for (const j of js) {
      const s = j.stats;
      lines.push(
        `| ${j.seed} | ${s.top.photo} | ${s.top.grow} | ${s.top.decomp} | ${s.top.resp} | ${s.bottom.photo} | ${s.bottom.grow} | ${s.bottom.decomp} | ${s.bottom.resp} | ${frac(s.shareTop)} | ${frac(s.shareBottom)} | ${frac(s.D)} |${evo ? ` ${j.pass === undefined ? "not judged" : j.pass ? "pass" : "FAIL"} |` : ""}`,
      );
    }
    lines.push("");
  };
  table("Neutral seeds", decision.neutral, false);
  table("Evolving seeds", decision.evolving, true);
  lines.push("## Saturation (reported, not corrected)", "", "| arm | seed | saturated fields, top | saturated fields, bottom | saturated fields, all layers | fields examined (all layers) |", "|---|---|---|---|---|---|");
  let anySat = false;
  for (const [arm, js] of [["neutral", decision.neutral], ["evolving", decision.evolving]] as const)
    for (const j of js) {
      const s = j.stats;
      if (s.all.saturated > 0n) anySat = true;
      lines.push(`| ${arm} | ${j.seed} | ${s.top.saturated} | ${s.bottom.saturated} | ${s.all.saturated} | ${s.all.fields} |`);
    }
  lines.push("", anySat ? "FLAG: some 16-bit count fields sit at their 65,535 cap. The sums above are not corrected for it; saturation is reported and never enters the decision." : "No 16-bit count field reached its 65,535 cap in the window.", "");
  if (opt.bundles?.length) {
    lines.push("## Run summaries (reported, not part of the decision)", "", "| arm | seed | conservationOk | extinct |", "|---|---|---|---|");
    for (const b of opt.bundles) lines.push(`| ${b.arm} | ${b.seed} | ${String(b.conservationOk)} | ${String(b.extinct)} |`);
    const odd = opt.bundles.filter((b) => b.conservationOk !== true || b.extinct !== false);
    lines.push("", odd.length ? `FLAG: ${odd.map((b) => `${b.arm} ${b.seed}`).join(", ")} did not end with conservationOk true and extinct false. The readout takes its counts from layers.tsv as they stand; this never enters the decision.` : "Every bundle ended with conservationOk true and extinct false.", "");
  }
  if (decision.unused.length) lines.push(`Not used (the first three seeds settled the decision): ${decision.unused.map((u) => `${u.arm} ${u.seed}`).join(", ")}.`, "");
  if (decision.waitingFor) lines.push(`Waiting for: ${decision.waitingFor.map((u) => `${u.arm} ${u.seed}`).join(", ")}.`, "");
  return lines.join("\n");
}

const jr = (r: Rat | undefined) => (r ? { fraction: ratStr(r), decimal: ratDecimal(r, 9) } : null);
const jstats = (s: SeedStats) => ({
  top: { photo: String(s.top.photo), grow: String(s.top.grow), decomp: String(s.top.decomp), resp: String(s.top.resp), saturated: String(s.top.saturated), fields: String(s.top.fields) },
  bottom: { photo: String(s.bottom.photo), grow: String(s.bottom.grow), decomp: String(s.bottom.decomp), resp: String(s.bottom.resp), saturated: String(s.bottom.saturated), fields: String(s.bottom.fields) },
  allSaturated: String(s.all.saturated),
  allFields: String(s.all.fields),
  shareTop: jr(s.shareTop),
  shareBottom: jr(s.shareBottom),
  D: jr(s.D),
});
const jbar = (b: Bar | undefined) => (b ? { seeds: b.seeds, m: jr(b.m), r: jr(b.r), threshold: jr(b.threshold) } : null);

/** A JSON-safe form of the decision: rationals as "n/d" strings with decimals, counts as strings. */
export function decisionJson(d: Decision) {
  return {
    verdict: d.verdict,
    reason: d.reason,
    phase1: { outcome: d.phase1.outcome, passes: d.phase1.passes, bar: jbar(d.phase1.bar) },
    phase2: d.phase2 ? { passes: d.phase2.passes, bar: jbar(d.phase2.bar) } : null,
    bar: jbar(d.bar),
    neutral: d.neutral.map((j) => ({ seed: j.seed, ...jstats(j.stats) })),
    evolving: d.evolving.map((j) => ({ seed: j.seed, pass: j.pass ?? null, ...jstats(j.stats) })),
    unused: d.unused,
    waitingFor: d.waitingFor ?? null,
  };
}
