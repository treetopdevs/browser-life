// Arms and run lists of the bootstrap screen (docs/mycelium-bootstrap-2026-11-14/DESIGN.md sections 7 and 8), EXPLORATORY.
//
// No gpu, no Deno: a pure description of every run (config delta, heredity, slot, length, read schedule, branch plan), so vitest can check the
// counts of the design table (208 T runs, 24 D0, 88 D, ...) and the runner and the analysis share one definition. Strengths that the sizing step S0
// measures come in through `Sizing`; PROVISIONAL is a stand-in used only for smoke runs and is flagged everywhere it is used.
import { defaultConfig, type MyceliumConfig, type MyceliumState, type TrailInitPattern, validateConfig } from "./world.ts";
import { HEREDITY_OFFSET, type Heredity, nullSeedA, nullSeedB, slotsOf, type Series, worldSeed } from "./bootstrap-seeds.ts";

export interface Sizing {
  /** The fields that were measured by the sizing step (a sizing file lists them). A real run needing any other field is refused (`armNeeds`). */
  measured: string[];
  /** True while any field in SIZING_FIELDS is unmeasured: every table prints a warning. */
  provisional: boolean;
  /** R1: founder-settle step. R2: road strength v. R4: rising g_R. */
  t0: number; v: number; gR: number;
  /** R3: t_alive(q) for the plateau strengths q = 1, 2, 3. */
  tAlive: Record<1 | 2 | 3, number>;
  /** The diffA-matched twin's diffA for T (and D) and for F (frozen at the F pilot). */
  diffA: number; diffAF: number;
  /** R5: free-layer ceiling F* and the sized conduit strengths Fg lo/mid/hi. */
  Fstar: number; Fg: { lo: number; mid: number; hi: number };
  /** R6: theta lo/mid/hi (stricter defence = higher theta) and owner conduit g lo/mid/hi, and the matched public g' (C-pub). */
  theta: { lo: number; mid: number; hi: number }; gOwner: { lo: number; mid: number; hi: number }; gCpub: number;
  /** S0.4 stop rule fired (under 50 percent of occupied cells owned in the toll substrate): O is not run and not labelled. */
  ownerStopRule?: boolean;
}
export const SIZING_FIELDS = ["t0", "v", "gR", "tAlive", "diffA", "diffAF", "Fstar", "Fg", "theta", "gOwner", "gCpub"] as const;
export const PROVISIONAL: Sizing = {
  measured: [], provisional: true, t0: 200, v: 32, gR: 15, tAlive: { 1: 345, 2: 276, 3: 236 }, diffA: 56, diffAF: 56,
  Fstar: 16, Fg: { lo: 15, mid: 30, hi: 60 }, theta: { lo: 2, mid: 8, hi: 32 }, gOwner: { lo: 4, mid: 16, hi: 64 }, gCpub: 8,
};

export type ReadMode = "dense" | "road" | "std";
export interface BranchPlan {
  /** Steps of the main run at which it is read back and branched. */
  at: number[];
  variants: string[];
  /** Branch length (default 2,000). `relax-*` variants run only from the last checkpoint and for RELAX_LEN steps. */
  len?: number;
}
export const BRANCH_LEN = 2000;
export const RELAX_LEN = 5000;

export interface ArmDef {
  id: string; series: string; steps: number; light: "U" | "G";
  hered: Heredity[]; over: Partial<MyceliumConfig>;
  /** Table series whose slots this arm uses (B uses D's, D0 uses D's, R7 uses the smoke slots). */
  slotSeries: Series;
  reads: ReadMode;
  butterfly?: boolean;
  branch?: BranchPlan;
  /** Arm belongs to a gated block (extras) and runs only with --extras. */
  gated?: "extras";
  /** The paired comparison role used by the analysis ("on", "off", "bf", "diffA", ...). */
  role?: string;
}

export interface RunSpec extends ArmDef { hered1: Heredity; slot: number; runId: string; seed: number }

const INH: Heredity[] = ["inherit"], INHBLK: Heredity[] = ["inherit", "blocked"];
export const TOLL = { moveCost: 12, trailMoveDiscount: 64, trailDiscountMode: "toll" } as const;

export function lay(v: number, pattern: TrailInitPattern): Partial<MyceliumConfig> {
  const o: Partial<MyceliumConfig> = { trailInit: v, trailInitPattern: pattern };
  if (pattern === "rows" || pattern === "cols" || pattern === "lattice") o.trailInitPitch = 8;
  if (pattern === "patches") o.trailInitPitch = 16;
  return o;
}
export const plateau = (q: 1 | 2 | 3): Partial<MyceliumConfig> => ({ trailConduit: 255, trailConduitCap: q });

/** Heredity config of an arm, as conduit-screen.ts's screenConfig (physarum is frozen with physarumDeposit 256; blind zeroes the gradient inputs). */
export function heredityOver(h: Heredity): Partial<MyceliumConfig> {
  return h === "inherit" ? { heredity: "inherit" }
    : h === "blocked" ? { heredity: "blocked" }
    : h === "physarum" ? { heredity: "frozen", controller: "physarum", physarumDeposit: 256 }
    : { heredity: "frozen", controller: "physarum", physarumDeposit: 256, blindTrailGradient: true };
}

export function runConfig(over: Partial<MyceliumConfig>, light: "U" | "G", h: Heredity, seed: number): MyceliumConfig {
  return defaultConfig({ ...over, ...(light === "G" ? { lightPattern: "gradient" as const } : {}), ...heredityOver(h), seed });
}
export const specConfig = (r: RunSpec): MyceliumConfig => runConfig(r.over, r.light, r.hered1, r.seed);

const arm = (a: Omit<ArmDef, "slotSeries" | "reads" | "light" | "hered"> & Partial<Pick<ArmDef, "slotSeries" | "reads" | "light" | "hered">>): ArmDef =>
  ({ slotSeries: "T", reads: "std", light: "U", hered: INH, ...a });

// ---- series S (sizing, dev slots) -------------------------------------------------------------------------------

export const PATTERNS: TrailInitPattern[] = ["rows", "cols", "lattice", "patches", "carpet"];
export const S2_VALUES = [16, 24, 32, 48] as const;

function sArms(series: string, sz: Sizing): ArmDef[] {
  const s = (a: Omit<ArmDef, "slotSeries">): ArmDef => ({ ...a, slotSeries: "S" });
  switch (series) {
    case "S1": return [
      s({ id: "base0-U", series, steps: 1000, light: "U", hered: INH, over: {}, reads: "dense" }),
      s({ id: "base0-G", series, steps: 1000, light: "G", hered: INH, over: {}, reads: "dense" }),
    ];
    case "S2": case "S2d": return PATTERNS.flatMap((p) => S2_VALUES.map((v) =>
      s({ id: `${p}-v${v}`, series, steps: 1000, light: "G", hered: INH, over: { ...lay(v, p), ...(series === "S2d" ? { pDecay: 66 } : {}) }, reads: "road" })));
    case "S3": return [
      ...[4, 16].map((F) => s({ id: `free${F}`, series, steps: 20000, light: "U", hered: INHBLK, over: { trailFreeLayer: F }, reads: "std" })),
      s({ id: `T-16-mid`, series, steps: 20000, light: "U", hered: INH, over: { trailFreeLayer: 16, trailConduit: sz.Fg.mid }, reads: "std" }),
    ];
    case "S4": return ["gid", "id"].flatMap((tag) => [
      s({ id: `pass-toll-${tag}`, series, steps: 20000, light: "U", hered: INH, over: { ...TOLL, trailOwner: tag as "id" | "gid" }, reads: "std" }),
      s({ id: `pass-notoll-${tag}`, series, steps: 20000, light: "U", hered: INH, over: { trailOwner: tag as "id" | "gid" }, reads: "std" }),
    ]);
    default: throw new Error(`unknown sizing series ${series}`);
  }
}

// ---- series T, D0, D, B -----------------------------------------------------------------------------------------

function tArms(sz: Sizing): ArmDef[] {
  const lat = (id: string, light: "U" | "G", pattern: TrailInitPattern, extra: Partial<MyceliumConfig>, role: string, o: Partial<ArmDef> = {}): ArmDef =>
    arm({ id, series: "T", steps: 3000, light, hered: INH, over: { ...lay(sz.v, pattern), ...extra }, reads: "dense", role, ...o });
  const trio = (name: string, light: "U" | "G", pattern: TrailInitPattern): ArmDef[] => [
    lat(`${name}.on-P2`, light, pattern, plateau(2), "on"), lat(`${name}.off`, light, pattern, {}, "off"), lat(`${name}.bf`, light, pattern, {}, "bf", { butterfly: true }),
  ];
  const pair = (name: string, light: "U" | "G", pattern: TrailInitPattern, o: Partial<ArmDef> = {}): ArmDef[] => [
    lat(`${name}.on-P2`, light, pattern, plateau(2), "on", o), lat(`${name}.off`, light, pattern, {}, "off", o),
  ];
  return [
    ...trio("carpet-U", "U", "carpet"), ...trio("carpet-G", "G", "carpet"),
    lat("rows-G.on-P1", "G", "rows", plateau(1), "on"), lat("rows-G.on-P2", "G", "rows", plateau(2), "on"), lat("rows-G.on-P3", "G", "rows", plateau(3), "on"),
    lat("rows-G.on-R", "G", "rows", { trailConduit: sz.gR }, "on"), lat("rows-G.off", "G", "rows", {}, "off"),
    lat("rows-G.bf", "G", "rows", {}, "bf", { butterfly: true }), lat("rows-G.diffA", "G", "rows", { diffA: sz.diffA }, "diffA"),
    ...trio("cols-G", "G", "cols"),
    ...pair("lat-G", "G", "lattice"), ...pair("pat-G", "G", "patches"), ...pair("rows-U", "U", "rows"),
    ...pair("phys-rows-G", "G", "rows", { hered: ["physarum"] }),
    arm({ id: "base0-U", series: "T", steps: 3000, light: "U", over: {}, reads: "dense", role: "base0" }),
    arm({ id: "base0-G", series: "T", steps: 3000, light: "G", over: {}, reads: "dense", role: "base0" }),
  ];
}

const DURABLE = { pDecay: 66 } as const;
function d0Arms(sz: Sizing): ArmDef[] {
  const o = (id: string, extra: Partial<MyceliumConfig>, role: string, bf = false): ArmDef =>
    arm({ id, series: "D0", slotSeries: "D", steps: 5000, light: "G", hered: INH, over: { ...lay(sz.v, "rows"), ...DURABLE, ...extra }, reads: "road", role, butterfly: bf });
  return [o("rows-G.on-P2", plateau(2), "on"), o("rows-G.off", {}, "off"), o("rows-G.bf", {}, "bf", true)];
}

const D_BRANCH: BranchPlan = { at: [5000, 50000], variants: ["on", "noconduit", "nullA", "nullB"] };
function dArms(sz: Sizing): ArmDef[] {
  const mk = (id: string, hered: Heredity[], extra: Partial<MyceliumConfig>, role: string, o: Partial<ArmDef> = {}, pattern: TrailInitPattern | null = "rows"): ArmDef =>
    arm({ id, series: "D", slotSeries: "D", steps: 50000, light: "G", hered, over: { ...(pattern ? lay(sz.v, pattern) : {}), ...DURABLE, ...extra }, reads: "std", role, ...o });
  return [
    mk("rows-G.on-P2", INH, plateau(2), "on", { branch: D_BRANCH }), mk("rows-G.on-R", INHBLK, { trailConduit: sz.gR }, "on", { branch: D_BRANCH }),
    mk("rows-G.off", INHBLK, {}, "off"), mk("rows-G.bf", INH, {}, "bf", { butterfly: true }), mk("rows-G.diffA", INH, { diffA: sz.diffA }, "diffA"),
    mk("cols-G.on-R", INH, { trailConduit: sz.gR }, "on", { branch: D_BRANCH }, "cols"), mk("cols-G.off", INH, {}, "off", {}, "cols"),
    mk("base-G", INHBLK, {}, "base", {}, null),
  ];
}

function bArms(sz: Sizing): ArmDef[] {
  const mk = (id: string, extra: Partial<MyceliumConfig>, role: string): ArmDef =>
    arm({ id, series: "B", slotSeries: "D", steps: 50000, light: "G", hered: INHBLK, over: { ...lay(sz.v, "rows"), ...DURABLE, trailFreeLayer: sz.Fstar, ...extra }, reads: "std", role });
  return [mk("B-on", { trailConduit: sz.gR }, "on"), mk("B-noC", {}, "off")];
}

// ---- series F ---------------------------------------------------------------------------------------------------

const F_VARIANTS = ["on", "noconduit", "ghost", "nofree", "nullA", "nullB"];
/** The low dose of the F series is F* divided by 4 (DESIGN 7: 4 when F* is 16, 2 when F* is 8), never below 1. */
export const lowDoseF = (F: number): number => Math.max(1, F >> 2);
function fArms(sz: Sizing): ArmDef[] {
  const F = sz.Fstar, g = sz.Fg, lo = lowDoseF(F);
  const mk = (id: string, hered: Heredity[], over: Partial<MyceliumConfig>, role: string, o: Partial<ArmDef> = {}): ArmDef =>
    arm({ id, series: "F", slotSeries: "F", steps: 100000, light: "U", hered, over, reads: "std", role, ...o });
  const cp = { at: [50000, 100000] };
  const anchorBranch: BranchPlan = { at: [20000, 40000], variants: F_VARIANTS };
  return [
    mk("base", INHBLK, {}, "base"), mk(`FREE-${F}`, INHBLK, { trailFreeLayer: F }, "free"), mk("COND", INH, { trailConduit: g.mid }, "cond"),
    mk(`T-${F}-mid`, INHBLK, { trailFreeLayer: F, trailConduit: g.mid }, "treated", { branch: { ...cp, variants: F_VARIANTS } }),
    mk("GHOST", INH, { trailFreeLayer: F, trailConduit: g.mid, trailConduitGhost: 64 }, "ghost", { branch: { ...cp, variants: F_VARIANTS.filter((v) => v !== "ghost") } }),
    mk("DIFF", INH, { trailFreeLayer: F, diffA: sz.diffAF }, "diff"),
    mk(`anchor-phys-T-${F}-mid`, ["physarum"], { trailFreeLayer: F, trailConduit: g.mid }, "anchor", { steps: 40000, branch: anchorBranch }),
    mk(`anchor-blind-T-${F}-mid`, ["blind"], { trailFreeLayer: F, trailConduit: g.mid }, "anchor", { steps: 40000, branch: anchorBranch }),
    // Extras (gated).
    mk(`FREE-${lo}`, INH, { trailFreeLayer: lo }, "free4", { gated: "extras" }), mk(`T-${lo}-mid`, INH, { trailFreeLayer: lo, trailConduit: g.mid }, "treated4", { gated: "extras" }),
    mk(`T-${F}-lo`, INH, { trailFreeLayer: F, trailConduit: g.lo }, "treatedLo", { gated: "extras" }), mk(`T-${F}-hi`, INH, { trailFreeLayer: F, trailConduit: g.hi }, "treatedHi", { gated: "extras" }),
    mk("GHOST", ["blocked"], { trailFreeLayer: F, trailConduit: g.mid, trailConduitGhost: 64 }, "ghost", { gated: "extras", id: "GHOST-blocked" }),
    mk("toll-base", INH, { ...TOLL }, "tollBase", { gated: "extras" }), mk("toll-C", INH, { ...TOLL, trailConduit: g.mid }, "tollC", { gated: "extras" }),
    mk("toll-FC", INH, { ...TOLL, trailFreeLayer: F, trailConduit: g.mid }, "tollFC", { gated: "extras" }),
  ];
}

// ---- series O ---------------------------------------------------------------------------------------------------

const O_VARIANTS = ["on", "coff", "eoff", "both", "oghost", "cpub", "nullA", "nullB"];
const O_ANCHOR_VARIANTS = [...O_VARIANTS];
function oArms(sz: Sizing): ArmDef[] {
  const th = sz.theta, go = sz.gOwner;
  const own = (extra: Partial<MyceliumConfig>): Partial<MyceliumConfig> => ({ ...TOLL, trailOwner: "gid", ...extra });
  const mk = (id: string, hered: Heredity[], over: Partial<MyceliumConfig>, role: string, o: Partial<ArmDef> = {}): ArmDef =>
    arm({ id, series: "O", slotSeries: "O", steps: 100000, light: "U", hered, over, reads: "std", role, ...o });
  const EC = own({ ownerDefend: th.mid, ownerConduit: go.mid });
  const ecBranch: BranchPlan = { at: [60000, 100000], variants: [...O_VARIANTS, "relax-on", "relax-coff", "relax-both"] };
  const anchorBranch: BranchPlan = { at: [20000, 30000], variants: O_ANCHOR_VARIANTS };
  return [
    mk("T-P", INH, own({}), "passive"), mk("T-E", INH, own({ ownerDefend: th.mid }), "E"), mk("T-C", INH, own({ ownerConduit: go.mid }), "C"),
    mk("T-EC", INH, EC, "EC", { branch: ecBranch }), mk("T-EC-ghost", INH, { ...EC, ownerGhost: 64 }, "ECghost"),
    mk("T-C-pub", INH, own({ ownerDefend: th.mid, trailConduit: sz.gCpub }), "Cpub"),
    mk("T-base", INH, { ...TOLL }, "tbase"), mk("N-base", INH, {}, "nbase"),
    mk("anchor-phys-EC", ["physarum"], EC, "anchor", { steps: 30000, branch: anchorBranch }), mk("anchor-blind-EC", ["blind"], EC, "anchor", { steps: 30000, branch: anchorBranch }),
    // Extras (gated).
    mk("T-EC-thLo", INH, own({ ownerDefend: th.lo, ownerConduit: go.mid }), "thLo", { gated: "extras" }), mk("T-EC-thHi", INH, own({ ownerDefend: th.hi, ownerConduit: go.mid }), "thHi", { gated: "extras" }),
    mk("T-EC-gLo", INH, own({ ownerDefend: th.mid, ownerConduit: go.lo }), "gLo", { gated: "extras" }), mk("T-EC-gHi", INH, own({ ownerDefend: th.mid, ownerConduit: go.hi }), "gHi", { gated: "extras" }),
    mk("T-EC-lowmut", INH, { ...EC, mutRate: 4096 }, "lowmut", { gated: "extras" }), mk("T-EC-id", INH, { ...EC, trailOwner: "id" }, "ECid", { gated: "extras" }),
    mk("blk-id-T-P", ["blocked"], { ...TOLL, trailOwner: "id" }, "blkP", { gated: "extras" }), mk("blk-id-T-EC", ["blocked"], { ...EC, trailOwner: "id" }, "blkEC", { gated: "extras" }),
    mk("N-P", INH, { trailOwner: "gid" }, "nP", { gated: "extras" }), mk("N-E", INH, { trailOwner: "gid", ownerDefend: th.mid }, "nE", { gated: "extras" }),
    mk("N-EC", INH, { trailOwner: "gid", ownerDefend: th.mid, ownerConduit: go.mid }, "nEC", { gated: "extras" }),
  ];
}

/** R7 timing smoke: keyless, an F core arm and an O core arm at 5,000 steps (smoke slots), plus a 400-step per-step-read run. */
function r7Arms(sz: Sizing): ArmDef[] {
  const s = (id: string, steps: number, reads: ReadMode, over: Partial<MyceliumConfig>): ArmDef => ({ id, series: "R7", slotSeries: "SMOKE", steps, light: "U", hered: INH, over, reads });
  return [
    s("keyless", 5000, "std", {}), s("F-core", 5000, "std", { trailFreeLayer: sz.Fstar, trailConduit: sz.Fg.mid }),
    s("O-core", 5000, "std", { ...TOLL, trailOwner: "gid", ownerDefend: sz.theta.mid, ownerConduit: sz.gOwner.mid }), s("perstep", 400, "dense", { ...lay(sz.v, "rows"), ...plateau(2) }),
  ];
}

/** The sizing fields an arm's config is built from: a real run is refused unless the sizing file measured every one of them. */
export function armNeeds(series: string, armId: string): string[] {
  switch (series) {
    case "S1": case "S2": case "S2d": case "S4": return [];
    case "S3": return armId.startsWith("T-") ? ["Fg"] : [];
    case "T": return ["v", "gR", "diffA", "t0", "tAlive"];
    case "D0": return ["v", "t0"];
    case "D": return ["v", "gR", "diffA", "t0"];
    case "B": return ["v", "gR", "Fstar"];
    case "F": return ["Fstar", "Fg", "diffAF"];
    case "O": return ["theta", "gOwner", "gCpub"];
    case "R7": return [];
    default: return [...SIZING_FIELDS];
  }
}
/** The fields a run list needs that the sizing did not measure (empty = the runs may start). */
export const unmeasuredNeeds = (sz: Sizing, runs: readonly RunSpec[]): string[] => [...new Set(runs.flatMap((r) => armNeeds(r.series, r.id)))].filter((k) => !sz.measured.includes(k));

/** The read schedule: every step of 1..400 then every 50 (dense), 10 and every 50 (road), every 100 (std), plus the checkpoints. */
export function schedule(mode: ReadMode, steps: number, extra: readonly number[]): number[] {
  const set = new Set<number>(extra.filter((t) => t > 0 && t <= steps));
  if (mode === "dense") { for (let t = 1; t <= Math.min(400, steps); t++) set.add(t); for (let t = 450; t <= steps; t += 50) set.add(t); }
  else if (mode === "road") { if (steps >= 10) set.add(10); for (let t = 50; t <= steps; t += 50) set.add(t); for (let t = 100; t <= steps; t += 100) set.add(t); }
  else for (let t = 100; t <= steps; t += 100) set.add(t);
  set.add(steps);
  return [...set].sort((a, b) => a - b);
}

export const SERIES_IDS = ["S1", "S2", "S2d", "S3", "S4", "T", "D0", "D", "B", "F", "O", "R7"] as const;
export type SeriesId = (typeof SERIES_IDS)[number];

export function armsOf(series: string, sz: Sizing): ArmDef[] {
  switch (series) {
    case "S1": case "S2": case "S2d": case "S3": case "S4": return sArms(series, sz);
    case "T": return tArms(sz);
    case "D0": return d0Arms(sz);
    case "D": return dArms(sz);
    case "B": return bArms(sz);
    case "F": return fArms(sz);
    case "O": return oArms(sz);
    case "R7": return r7Arms(sz);
    default: throw new Error(`unknown series ${series}`);
  }
}

/** Slots an arm may use: the first 8 (screen) of its slot series, 16 with `held`, the S series' own 8 (the first `sCount` of them), the smoke slots for R7. */
export function slotsForArm(base: number, a: ArmDef, held: boolean): number[] {
  if (a.slotSeries === "SMOKE") return slotsOf(base, "SMOKE", "smoke");
  if (a.slotSeries === "S") {
    const all = slotsOf(base, "S", "screen");
    return a.series === "S1" || a.series === "S4" ? all.slice(0, 4) : all.slice(0, 2);
  }
  return [...slotsOf(base, a.slotSeries, "screen"), ...(held ? slotsOf(base, a.slotSeries, "held") : [])];
}

export const runIdOf = (a: ArmDef, h: Heredity, slot: number): string => `${a.series}.${a.id}.${h}.${slot}`;

/**
 * Every run of a series: arms x heredities x slots. Extras only with `extras`. Explicit `slots` are a restriction, never an extension: an arm takes only
 * the slots its own slot series allows (the screen slots, plus the held ones with `held`), so the S dev slots can never become a series cohort
 * (DESIGN 7: nothing from S0 enters a table) and a SMOKE slot only runs with `smoke` (and then only the SMOKE slots).
 */
export function expandRuns(series: string, sz: Sizing, base: number, opts: { held?: boolean; extras?: boolean; slots?: number[]; smoke?: boolean } = {}): RunSpec[] {
  const out: RunSpec[] = [];
  for (const a of armsOf(series, sz)) {
    if (a.gated === "extras" && !opts.extras) continue;
    let slots = slotsForArm(base, a, opts.held ?? false);
    if (opts.slots) {
      const smokeSlots = slotsOf(base, "SMOKE", "smoke");
      slots = opts.smoke ? opts.slots.filter((s) => smokeSlots.includes(s)) : opts.slots.filter((s) => slots.includes(s));
    }
    for (const h of a.hered) for (const slot of slots) out.push({ ...a, hered1: h, slot, seed: worldSeed(slot, h), runId: runIdOf(a, h, slot) });
  }
  return out;
}

/** The checkpoints a run branches at: none without a plan or with --no-branch; `--steps N` (an explicit length) branches once, at N. */
export function branchCheckpoints(branch: BranchPlan | undefined, steps: number, opts: { noBranch: boolean; stepsGiven: boolean }): number[] {
  if (opts.noBranch || !branch) return [];
  return opts.stepsGiven ? [steps] : branch.at.filter((t) => t <= steps);
}

/**
 * The sizing numbers a run depends on that its config does not show, as one comparable string (stored in every run file; a resume refuses a different one).
 * Config equality already covers v, gR, diffA, Fg, theta and the rest. What is left: t0 and t_alive set the read schedule and the analysis windows (T, D0, D, B,
 * F, O), and F* sets the stored `tmAboveStar` column (F). The sizing-free series (S, R7) stamp nothing, and `measured` is never stamped: `--size` rewrites the
 * same file as later pilots finish, which must not strand finished runs of an earlier series.
 */
export const sizingStamp = (sz: Sizing, series: string): string => {
  if (series.startsWith("S") || series === "R7") return "";
  return JSON.stringify({ t0: sz.t0, tAlive: sz.tAlive, ...(series === "F" ? { Fstar: sz.Fstar } : {}) });
};

/**
 * Why an existing run file may not be skipped on resume (null = it is the same run): different length, smoke flag, config or sizing, or a residual or a
 * branch variant error. A file from an older runner (no stored sizing) is compared on config and length only.
 */
export function resumeProblem(
  done: { steps: number; smoke?: boolean; config: unknown; sizing?: string; ledgerBadChecks?: number; branchErrors?: number; branchAt?: number[]; branchLen?: number; branchGrid?: number },
  want: { steps: number; smoke: boolean; config: unknown; sizing: string; branchAt?: number[]; branchLen?: number; branchGrid?: number },
): string | null {
  if (done.steps !== want.steps) return `exists with ${done.steps} steps, not ${want.steps}; use a fresh --out`;
  if (!!done.smoke !== want.smoke) return `exists as a ${done.smoke ? "smoke" : "real"} run, not a ${want.smoke ? "smoke" : "real"} one; use a fresh --out`;
  if (JSON.stringify(done.config) !== JSON.stringify(JSON.parse(JSON.stringify(want.config)))) return "exists with a different config (another sizing or arm definition); use a fresh --out";
  if (done.sizing !== undefined && done.sizing !== want.sizing) return "exists with a different t0, t_alive or F* (the sizing file changed); use a fresh --out";
  // Branch settings: the checkpoint plan, the branch length and the read grid (a run made with --no-branch, --branch-steps or --branch-grid is not the default run).
  // Length and grid only matter when the run branches. A file from the runner before the plan was stored has no branchAt and is compared on the rest.
  if (want.branchAt !== undefined) {
    if (done.branchAt === undefined) return "exists without a stored branch plan (written by an older runner); use a fresh --out";
    if (JSON.stringify(done.branchAt) !== JSON.stringify(want.branchAt)) return `exists with branch checkpoints [${done.branchAt}], not [${want.branchAt}] (--no-branch or --steps changed); use a fresh --out`;
    if (want.branchAt.length && want.branchLen !== undefined && done.branchLen !== want.branchLen) return `exists with branches of ${done.branchLen ?? "unrecorded"} steps, not ${want.branchLen}; use a fresh --out`;
    if (want.branchAt.length && want.branchGrid !== undefined && done.branchGrid !== want.branchGrid) return `exists with a branch read grid of ${done.branchGrid ?? "unrecorded"}, not ${want.branchGrid}; use a fresh --out`;
  }
  if (done.ledgerBadChecks) return "exists with ledger residuals; remove it and its claim to rerun";
  if (done.branchErrors) return "exists with failed branch variants; remove it and its claim to rerun";
  return null;
}

/** The end-of-run summary and exit code of the runner: a run skipped on a claim file is an unfinished run, never a clean exit. */
export function runSummary(c: { failures: number; fatal: number; skippedClaims: number }): { message: string; code: 0 | 1 | 2 } {
  const parts: string[] = [];
  if (c.failures) parts.push(`${c.failures} runs failed or had ledger residuals or failed branch variants${c.fatal ? ` (${c.fatal} intake-identity failures)` : ""}`);
  if (c.skippedClaims) parts.push(`${c.skippedClaims} runs NOT run: a claim file exists (another process, or a killed one; rerun with --reclaim only when no other process uses this --out)`);
  if (!parts.length) return { message: "all ledgers exact, intake identity exact", code: 0 };
  return { message: parts.join("; "), code: c.fatal ? 2 : 1 };
}

/**
 * Wall seconds per 1,000 planned steps from the finished lines of a run-log text: sum(seconds) / sum(plannedSteps) / jobs. Smoke lines count only for
 * series R7 (the designated timing smoke), lines made with stand-in sizing for the run's own arm never count, lines with residuals or under 2,000
 * planned steps never count. Only lines of `series` count when any exist, else all remaining lines. null with none.
 */
export function rateFromLog(txt: string, series?: string): { rate: number; lines: number; basis: string } | null {
  const fin: { series: string; seconds: number; planned: number; jobs: number }[] = [];
  for (const line of txt.split("\n")) {
    if (!line.trim()) continue;
    const o = JSON.parse(line);
    if (o.state !== "finished" || typeof o.seconds !== "number" || typeof o.plannedSteps !== "number" || o.plannedSteps < 2000 || o.ledgerBadChecks) continue;
    if (o.smoke && o.series !== "R7") continue;
    if (o.standIn) continue;
    fin.push({ series: o.series, seconds: o.seconds, planned: o.plannedSteps, jobs: o.jobs ?? 1 });
  }
  const same = series ? fin.filter((x) => x.series === series) : [];
  const use = same.length ? same : fin;
  if (!use.length) return null;
  const jobs = Math.max(...use.map((x) => x.jobs));
  const sec = use.reduce((t, x) => t + x.seconds, 0), st = use.reduce((t, x) => t + x.planned, 0);
  return { rate: (1000 * sec) / st / jobs, lines: use.length, basis: `${same.length ? `series ${series}` : "all series (none for this one yet)"}, ${use.length} finished lines, ${jobs} concurrent jobs` };
}

/** The world seeds a run list can use, with the two derived null seeds of each run that branches (for the logs and tests). */
export const derivedSeeds = (r: RunSpec): number[] => (r.branch ? [nullSeedA(r.seed), nullSeedB(r.seed)] : []);
export { HEREDITY_OFFSET };

// ---- branch variants ---------------------------------------------------------------------------------------------

/** The config-and-totals transform of one branch variant from a state; null when the variant does not apply to this world. */
export function variantState(s: MyceliumState, v: string, sz: Sizing): { state: MyceliumState; len: number } | null {
  const c: MyceliumConfig = { ...s.config };
  const totals = { ...s.totals };
  const relax = v.startsWith("relax-");
  const name = relax ? v.slice(6) : v;
  const has = (k: keyof MyceliumConfig) => c[k] !== undefined;
  switch (name) {
    case "on": break;
    case "noconduit": if (!has("trailConduit")) return null; delete c.trailConduit; delete c.trailConduitCap; delete c.trailConduitGhost; break;
    case "ghost": if (!has("trailConduit") || has("trailConduitGhost")) return null; c.trailConduitGhost = 64; break;
    case "nofree": if (!has("trailFreeLayer")) return null; delete c.trailFreeLayer; delete totals.freeUnits; delete totals.paidUnits; break;
    case "nullA": c.seed = nullSeedA(c.seed); break;
    case "nullB": c.seed = nullSeedB(c.seed); break;
    case "coff": if (!has("ownerConduit")) return null; c.ownerConduit = 0; break;
    case "eoff": if (!has("ownerDefend")) return null; delete c.ownerDefend; break;
    case "both": if (!has("ownerConduit")) return null; c.ownerConduit = 0; delete c.ownerDefend; break;
    case "oghost": if (!has("ownerConduit") || has("ownerGhost")) return null; c.ownerGhost = 64; break;
    case "cpub": if (!has("ownerConduit")) return null; delete c.ownerConduit; delete c.ownerConduitCap; delete c.ownerGhost; c.trailConduit = sz.gCpub; break;
    default: throw new Error(`unknown branch variant ${v}`);
  }
  const bad = validateConfig(c);
  if (bad.length) throw new Error(`branch variant ${v}: ${bad.join("; ")}`);
  return { state: { ...s, config: c, totals }, len: relax ? RELAX_LEN : 0 };
}

