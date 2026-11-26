// GPU Mycelium world (tools/mycelium/gpu.ts) vs the CPU reference (tools/mycelium/world.ts), bit for bit.
// Both run side by side; every checkpoint compares stateDigest (the digest of the full checkpoint encoding)
// and runs validateState on the GPU readback (matter and energy ledgers). On a mismatch it reports the first
// differing array and index, then reruns one step at a time to name the first differing step.
//
//   deno run -A --no-lock tests/deno/mycelium_gpu.ts [name-substring ...]
//
// Needs a real GPU (native WebGPU). Exits non-zero on any mismatch or if a case fails to exercise its paths.
import { NN_BYTES, NN_H, NN_I, NN_O } from "@bl/schema";
import {
  createWorld, decode, defaultConfig, encode, energyTotal, ID_MAX, matterTotal, type MyceliumConfig, type MyceliumState, stateDigest, step, validateState,
} from "../../tools/mycelium/world.ts";
import { GpuMycelium, myceliumDevice } from "../../tools/mycelium/gpu.ts";
import { POS_SHIFT } from "../../tools/mycelium/world.ts";
import { fieldLayout } from "../../tools/mycelium/gpu.ts";

const dev = await myceliumDevice();
const only = Deno.args;

/**
 * First difference between two states over everything the checkpoint encodes, or null. Strict by default: a counter or plane one side has and the other
 * lacks is a difference (a GPU read that drops the owner planes or the free counters must not pass). `baseline` is for comparing a keyed world with a
 * keyless baseline config (the `vs` check), where one side legitimately has no free counters and no Z, Q.
 */
function firstDiff(a: MyceliumState, b: MyceliumState, baseline = false): string | null {
  for (const k of ["step", "n", "nextId", "nextGid", "matter0", "energy0"] as const) {
    if (a[k] !== b[k]) return `${k}: cpu ${a[k]} gpu ${b[k]}`;
  }
  for (const k of new Set([...Object.keys(a.totals), ...Object.keys(b.totals)]) as Set<keyof MyceliumState["totals"]>) {
    // The free-layer counters exist only with trailFreeLayer; only a baseline comparison may skip them when one side lacks them (the digest covers them).
    if (baseline && (k === "freeUnits" || k === "paidUnits") && (a.totals[k] === undefined || b.totals[k] === undefined)) continue;
    if (a.totals[k] !== b.totals[k]) return `totals.${k}: cpu ${a.totals[k]} gpu ${b.totals[k]}`;
  }
  for (const k of ["A", "C", "P"] as const) {
    for (let i = 0; i < a[k].length; i++) if (a[k][i] !== b[k][i]) return `${k}[${i}] (x ${i % a.config.width}, y ${Math.floor(i / a.config.width)}): cpu ${a[k][i]} gpu ${b[k][i]}`;
  }
  for (const k of ["Z", "Q"] as const) {
    const x = a[k], y = b[k];
    if (!baseline && !x !== !y) return `${k}: cpu ${x ? "has" : "lacks"} the plane, gpu ${y ? "has" : "lacks"} it`;
    if (x && y) for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return `${k}[${i}] (x ${i % a.config.width}, y ${Math.floor(i / a.config.width)}): cpu ${x[i]} gpu ${y[i]}`;
  }
  for (const k of ["id", "parent", "gid", "x", "y", "M", "E", "age"] as const) {
    for (let i = 0; i < a.n; i++) if (a[k][i] !== b[k][i]) return `${k}[${i}]: cpu ${a[k][i]} gpu ${b[k][i]} (cpu id ${a.id[i]})`;
  }
  for (let i = 0; i < a.n * NN_BYTES; i++) {
    if (a.genome[i] !== b.genome[i]) return `genome slot ${Math.floor(i / NN_BYTES)} byte ${i % NN_BYTES}: cpu ${a.genome[i]} gpu ${b.genome[i]}`;
  }
  return null;
}

/** After a checkpoint mismatch: replay from scratch one step at a time and name the first step that differs. */
async function localize(c: Case, upTo: number): Promise<string> {
  const cpu = make(c);
  const gpu = await GpuMycelium.create(dev, make(c));
  for (let t = 1; t <= upTo; t++) {
    step(cpu); gpu.step(1);
    const d = firstDiff(cpu, await gpu.read());
    if (d) { gpu.destroy(); return `first differing step ${t}: ${d}`; }
  }
  gpu.destroy();
  return `no per-step difference found up to step ${upTo}`;
}

interface Case {
  name: string;
  cfg: MyceliumConfig;
  steps: number;
  seg: number;
  /** Paths the case must exercise (cumulative CPU totals above zero), or the pass means little. */
  must: ("births" | "deaths" | "contended" | "mutations" | "refused")[];
  /** Edits the freshly created world (matter and energy anchors are recomputed after). */
  tweak?: (s: MyceliumState) => void;
  /** Require a single step whose lightIn and heat each exceed 2^32 (the 64-bit counter pairs). */
  big?: boolean;
  /** Extra requirement on the finished CPU run and its largest single-step lightIn / heat; returns a complaint or null. */
  check?: (cpu: MyceliumState, maxStep: { lightIn: number; heat: number }) => string | null;
  /**
   * R2b: a baseline config run on the CPU for the same steps. `same: true` requires every field of the final state to equal
   * the case's (a key that must not change the dynamics), `same: false` requires some field to differ (the case is not vacuous).
   */
  vs?: { cfg: MyceliumConfig; same: boolean };
}

/** Second-layer bias of output k in the controller's int8 layout (W1, B1, W2, B2). */
const B2_OFF = NN_I * NN_H + NN_H + NN_H * NN_O;

/** Sets controller output biases (the same for every founder) to fixed values. */
function setOut(s: MyceliumState, outs: Record<number, number>): void {
  s.genome.fill(0);
  for (let i = 0; i < s.n; i++) for (const [k, v] of Object.entries(outs)) s.genome[i * NN_BYTES + B2_OFF + Number(k)] = v;
}

function make(c: Case): MyceliumState {
  const s = createWorld(c.cfg);
  if (c.tweak) { c.tweak(s); s.matter0 = matterTotal(s); s.energy0 = energyTotal(s); }
  return s;
}

interface Row { name: string; ok: boolean; steps: number; n: number; cpuMs: number; gpuMs: number; digest: string; note: string; totals: string }

const base = ["births", "deaths", "contended"] as const;
/** R2b keys on the GPU: the physarum null (absent key and several physarumDeposit values) and blindTrailGradient, each against its own baseline. */
function r2bCases(): Case[] {
  const w = { width: 64, height: 64, founders: 600, maxParticles: 3000 };
  const phys = (over: Partial<MyceliumConfig> = {}) => defaultConfig({ ...w, controller: "physarum", heredity: "frozen", ...over });
  const cases: Case[] = [
    { name: "physarum null, physarumDeposit absent (R2)", cfg: phys(), steps: 600, seg: 100, must: [...base] },
    // 256 = exactly one unit per step and no draw: the same dynamics as the absent key (only the config header differs).
    { name: "physarumDeposit 256 equals the R2 null", cfg: phys({ physarumDeposit: 256 }), steps: 400, seg: 100, must: [...base], vs: { cfg: phys(), same: true } },
    { name: "physarumDeposit 0 (no trail laid)", cfg: phys({ physarumDeposit: 0 }), steps: 400, seg: 100, must: ["births", "deaths"], vs: { cfg: phys(), same: false } },
    { name: "physarumDeposit 100 (fractional)", cfg: phys({ physarumDeposit: 100 }), steps: 600, seg: 100, must: [...base], vs: { cfg: phys(), same: false } },
    { name: "physarumDeposit 300 (1 + fraction)", cfg: phys({ physarumDeposit: 300 }), steps: 600, seg: 100, must: [...base], vs: { cfg: phys(), same: false } },
    { name: "physarumDeposit 768 (three units)", cfg: phys({ physarumDeposit: 768 }), steps: 400, seg: 100, must: ["births", "deaths"], vs: { cfg: phys(), same: false } },
    {
      name: "blindTrailGradient on inherit",
      cfg: defaultConfig({ ...w, blindTrailGradient: true }), steps: 800, seg: 100, must: [...base, "mutations"],
      vs: { cfg: defaultConfig(w), same: false },
    },
    { name: "blindTrailGradient on blocked", cfg: defaultConfig({ ...w, heredity: "blocked", blindTrailGradient: true }), steps: 400, seg: 100, must: [...base] },
    { name: "blindTrailGradient on physarum (wander only)", cfg: phys({ physarumDeposit: 100, blindTrailGradient: true }), steps: 400, seg: 100, must: ["births", "deaths"], vs: { cfg: phys({ physarumDeposit: 100 }), same: false } },
  ];
  return cases;
}
/**
 * Trail use (optional trailMoveDiscount and trailDiscountMode): several strengths, both modes, the physarum null in a dense world (many
 * particles per cell, trail laid every step, so a live-P read would show), saturation, moveCost 4096, a toll request whose deposit is capped
 * at zero by energy, and a keyless baseline for each. Each case that sets a key must differ from its baseline (not vacuous), td 0 must equal it.
 */
function trailCases(): Case[] {
  const w = { width: 64, height: 64, founders: 600, maxParticles: 3000 };
  const base = defaultConfig(w);
  const cs = ["births", "deaths", "contended"] as const;
  const dense = { width: 16, height: 16, founders: 300, maxParticles: 1500 };
  const phys = (over: Partial<MyceliumConfig> = {}) => defaultConfig({ ...dense, controller: "physarum", heredity: "frozen", physarumDeposit: 768, ...over });
  return [
    { name: "trail discount, public, strength 32 (inherit)", cfg: defaultConfig({ ...w, trailMoveDiscount: 32 }), steps: 800, seg: 100, must: [...cs, "mutations"], vs: { cfg: base, same: false } },
    { name: "trail discount, public, strength 256 (inherit, moveCost 12)", cfg: defaultConfig({ ...w, moveCost: 12, trailMoveDiscount: 256 }), steps: 800, seg: 100, must: [...cs, "mutations"], vs: { cfg: defaultConfig({ ...w, moveCost: 12 }), same: false } },
    { name: "trail discount, toll, strength 64 (inherit, moveCost 12)", cfg: defaultConfig({ ...w, moveCost: 12, trailMoveDiscount: 64, trailDiscountMode: "toll" }), steps: 800, seg: 100, must: [...cs, "mutations"], vs: { cfg: defaultConfig({ ...w, moveCost: 12, trailMoveDiscount: 64 }), same: false } },
    { name: "trail discount, toll, strength 256 (blocked, moveCost 12)", cfg: defaultConfig({ ...w, heredity: "blocked", moveCost: 12, trailMoveDiscount: 256, trailDiscountMode: "toll" }), steps: 500, seg: 100, must: [...cs], vs: { cfg: defaultConfig({ ...w, heredity: "blocked", moveCost: 12 }), same: false } },
    { name: "trail discount, explicit public mode, strength 128", cfg: defaultConfig({ ...w, moveCost: 8, trailMoveDiscount: 128, trailDiscountMode: "public" }), steps: 500, seg: 100, must: [...cs], vs: { cfg: defaultConfig({ ...w, moveCost: 8 }), same: false } },
    { name: "trail discount strength 0 equals the keyless dynamics", cfg: defaultConfig({ ...w, trailMoveDiscount: 0, trailDiscountMode: "toll" }), steps: 400, seg: 100, must: [...cs], vs: { cfg: base, same: true } },
    { name: "trail discount, physarum dense world (public, 64)", cfg: phys({ moveCost: 12, trailMoveDiscount: 64 }), steps: 400, seg: 50, must: ["births", "deaths"], vs: { cfg: phys({ moveCost: 12 }), same: false } },
    { name: "trail discount, physarum dense world (toll, 256)", cfg: phys({ moveCost: 12, trailMoveDiscount: 256, trailDiscountMode: "toll" }), steps: 400, seg: 50, must: ["births", "deaths"], vs: { cfg: phys({ moveCost: 12 }), same: false } },
    {
      // Trail far above the saturation point (256) everywhere: f is capped, the product never overflows.
      name: "trail discount saturates (trail 10^6 per cell, strength 1)",
      cfg: defaultConfig({ ...w, moveCost: 12, trailMoveDiscount: 1 }), steps: 300, seg: 100, must: ["births", "deaths"],
      tweak: (s) => { s.P.fill(1_000_000); }, vs: { cfg: defaultConfig({ ...w, moveCost: 12 }), same: false },
    },
    {
      // moveCost at its maximum, full outputs: raw = 254 * 4096, the largest product of the rule.
      name: "trail discount at moveCost 4096 (largest product)",
      cfg: defaultConfig({ ...w, moveCost: 4096, upkeep: 0, founderEnergy: 4096, trailMoveDiscount: 100 }), steps: 200, seg: 50, must: ["deaths"],
      tweak: (s) => { setOut(s, { 0: 127, 1: -127, 2: 127 }); s.P.fill(2); }, vs: { cfg: defaultConfig({ ...w, moveCost: 4096, upkeep: 0, founderEnergy: 4096 }), same: false },
    },
    {
      // Toll: the deposit request is positive but depositCost 4096 exceeds the energy left, so no unit is laid; the discount is still taken (documented edge).
      name: "trail discount, toll with the deposit capped to zero by energy",
      cfg: defaultConfig({ ...w, moveCost: 12, maxEat: 0, depositCost: 4096, founderEnergy: 600, trailMoveDiscount: 64, trailDiscountMode: "toll" }), steps: 300, seg: 100, must: ["deaths"],
      tweak: (s) => { setOut(s, { 0: 60, 1: 60, 2: 127, 3: 127 }); s.P.fill(50); },
      vs: { cfg: defaultConfig({ ...w, moveCost: 12, maxEat: 0, depositCost: 4096, founderEnergy: 600 }), same: false },
      check: (cpu) => (cpu.P.every((v, i) => v <= 50 || i < 0) ? null : "trail grew, so a deposit was paid for (the case is meant to lay none)"),
    },
  ];
}
/**
 * Trail conduit (optional trailConduit and trailConduitCap, docs/mycelium-conduit-2026-11-14/DESIGN.md): several strengths and caps,
 * every heredity arm and the physarum null, the toll discount switched on at the same time, uniform and gradient light, diffA 0 (the skip
 * guard) to 128 (the largest the key allows), trail far above the cap everywhere and in a checkerboard (min before multiply), and a keyless
 * baseline for each. g = 0 must equal the keyless dynamics; every other case must differ from its baseline (not vacuous).
 */
function conduitCases(): Case[] {
  const w = { width: 64, height: 64, founders: 600, maxParticles: 3000 };
  const base = defaultConfig(w);
  const cs = ["births", "deaths", "contended"] as const;
  const dense = { width: 16, height: 16, founders: 300, maxParticles: 1500 };
  const phys = (over: Partial<MyceliumConfig> = {}) => defaultConfig({ ...dense, controller: "physarum", heredity: "frozen", physarumDeposit: 768, ...over });
  const cond = (name: string, over: Partial<MyceliumConfig>, steps: number, seg: number, extra: Partial<Case> = {}, baseOver: Partial<MyceliumConfig> = {}): Case => {
    const { trailConduit: _g, trailConduitCap: _q, ...rest } = over;
    return { name: `conduit, ${name}`, cfg: defaultConfig({ ...w, ...over }), steps, seg, must: [...cs], vs: { cfg: defaultConfig({ ...w, ...rest, ...baseOver }), same: false }, ...extra };
  };
  return [
    { name: "conduit strength 0 equals the keyless dynamics", cfg: defaultConfig({ ...w, trailConduit: 0 }), steps: 400, seg: 100, must: [...cs], vs: { cfg: base, same: true } },
    { name: "conduit strength 0, cap 7 equals the keyless dynamics", cfg: defaultConfig({ ...w, trailConduit: 0, trailConduitCap: 7 }), steps: 300, seg: 100, must: [...cs], vs: { cfg: base, same: true } },
    cond("g 1 (inherit)", { trailConduit: 1 }, 600, 100, { must: [...cs, "mutations"] }),
    cond("g 8 (inherit)", { trailConduit: 8 }, 800, 100, { must: [...cs, "mutations"] }),
    cond("g 255 (inherit)", { trailConduit: 255 }, 800, 100, { must: [...cs, "mutations"] }),
    cond("g 16, cap 1 (ext 1 at most)", { trailConduit: 16, trailConduitCap: 1 }, 500, 100),
    cond("g 255, cap 1", { trailConduit: 255, trailConduitCap: 1 }, 500, 100),
    cond("g 32, cap 44", { trailConduit: 32, trailConduitCap: 44 }, 500, 100),
    cond("g 255, cap 255 (blocked)", { trailConduit: 255, heredity: "blocked" }, 500, 100),
    cond("g 32 (frozen)", { trailConduit: 32, heredity: "frozen" }, 500, 100),
    cond("g 32, gradient light", { trailConduit: 32, lightPattern: "gradient" }, 600, 100, { must: [...cs, "mutations"] }),
    cond("g 8, toll discount on (moveCost 12, td 64)", { trailConduit: 8, moveCost: 12, trailMoveDiscount: 64, trailDiscountMode: "toll" }, 600, 100, { must: [...cs, "mutations"] }),
    cond("g 8, public discount on (moveCost 12, td 256)", { trailConduit: 8, moveCost: 12, trailMoveDiscount: 256 }, 400, 100),
    cond("diffA 0 (the skip guard), g 32", { trailConduit: 32, diffA: 0 }, 600, 100, { must: ["births", "deaths"] }),
    cond("diffA 1, g 32", { trailConduit: 32, diffA: 1 }, 400, 100, { must: ["births", "deaths"] }),
    // At diffA 128 every edge is already at the 128 cap, so the conduit changes nothing: equal to keyless diffA 128.
    { name: "conduit, diffA 128 (the limit) is inert: equals keyless diffA 128", cfg: defaultConfig({ ...w, trailConduit: 255, diffA: 128 }), steps: 400, seg: 100, must: ["births", "deaths"], vs: { cfg: defaultConfig({ ...w, diffA: 128 }), same: true } },
    cond("diffA 100, g 255 (Dd caps at 128)", { trailConduit: 255, diffA: 100, diffC: 256 }, 400, 100, { must: ["births", "deaths"] }),
    {
      name: "conduit, physarum dense world (g 32)", cfg: phys({ trailConduit: 32 }), steps: 400, seg: 50, must: ["births", "deaths"],
      vs: { cfg: phys(), same: false },
    },
    {
      name: "conduit, physarum dense world (g 255, cap 20, toll 256)", cfg: phys({ trailConduit: 255, trailConduitCap: 20, moveCost: 12, trailMoveDiscount: 256, trailDiscountMode: "toll" }), steps: 400, seg: 50, must: ["births", "deaths"],
      vs: { cfg: phys({ moveCost: 12, trailMoveDiscount: 256, trailDiscountMode: "toll" }), same: false },
    },
    {
      // Trail near 2^31 per cell: min(P[k], P[nb], q) is taken before the multiply, so a raw P never overflows (255 * 255 < 2^16).
      name: "conduit saturates (trail 2^30 per cell, g 255)",
      cfg: defaultConfig({ ...w, trailConduit: 255 }), steps: 300, seg: 100, must: ["births", "deaths"],
      tweak: (s) => { s.P.fill(2 ** 30); }, vs: { cfg: defaultConfig(w), same: false },
    },
    {
      // Checkerboard of huge and zero trail: no edge has both ends above 0, so Dd = De everywhere (the conduit is inert), and the
      // CPU and GPU must agree on the min over a huge and a zero end. The trail then decays and spreads, so the rule switches on mid-run.
      name: "conduit, checkerboard of trail 2^31-1 and 0 (min before multiply)",
      cfg: defaultConfig({ ...w, trailConduit: 255, pDecay: 0 }), steps: 200, seg: 50, must: ["births", "deaths"],
      tweak: (s) => { for (let k = 0; k < s.P.length; k++) s.P[k] = (((k % 64) + Math.floor(k / 64)) & 1) ? 0 : 0x7fffffff; },
      vs: { cfg: defaultConfig({ ...w, pDecay: 0 }), same: false },
    },
    {
      // A stripe of trail: a corridor conducts, bare cells beside it do not. The 64x64 torus wraps the stripe's ends.
      name: "conduit, horizontal trail stripe (corridor, wrapped edges)",
      cfg: defaultConfig({ ...w, trailConduit: 64, pDecay: 0, maxEat: 0, upkeep: 0 }), steps: 200, seg: 50, must: [],
      tweak: (s) => { for (let x = 0; x < 64; x++) { s.P[10 * 64 + x] = 200; s.A[10 * 64 + x] = x === 0 ? 5000 : 0; } },
      vs: { cfg: defaultConfig({ ...w, pDecay: 0, maxEat: 0, upkeep: 0 }), same: false },
    },
    {
      name: "conduit, 100x60 odd size, gradient, g 100, cap 50",
      cfg: defaultConfig({ width: 100, height: 60, founders: 200, maxParticles: 300, lightPattern: "gradient", trailConduit: 100, trailConduitCap: 50 }), steps: 400, seg: 100, must: ["births", "deaths"],
      vs: { cfg: defaultConfig({ width: 100, height: 60, founders: 200, maxParticles: 300, lightPattern: "gradient" }), same: false },
    },
    {
      name: "conduit, 256x256, 4096 founders, g 16",
      cfg: defaultConfig({ width: 256, height: 256, founders: 4096, maxParticles: 16384, trailConduit: 16 }), steps: 1500, seg: 500, must: [...cs, "mutations"],
      vs: { cfg: defaultConfig({ width: 256, height: 256, founders: 4096, maxParticles: 16384 }), same: false },
    },
    {
      name: "conduit, 512x512 at the 65536 cap, g 32",
      cfg: defaultConfig({ width: 512, height: 512, maxParticles: 65536, founders: 32768, upkeep: 3, light: 2, trailConduit: 32 }), steps: 80, seg: 20, must: [...cs, "mutations"],
      vs: { cfg: defaultConfig({ width: 512, height: 512, maxParticles: 65536, founders: 32768, upkeep: 3, light: 2 }), same: false },
    },
  ];
}
/** Puts particles 0..k-1 in the middle of cell (cx, cy); the others stay where createWorld put them. */
function clump(s: MyceliumState, k: number, cx = 3, cy = 3): void {
  for (let i = 0; i < k; i++) { s.x[i] = (cx << POS_SHIFT) + 128; s.y[i] = (cy << POS_SHIFT) + 128; }
}

/** Per-particle controller output biases (setOut gives every particle the same). */
function setOutEach(s: MyceliumState, f: (i: number) => Record<number, number>): void {
  s.genome.fill(0);
  for (let i = 0; i < s.n; i++) for (const [k, v] of Object.entries(f(i))) s.genome[i * NN_BYTES + B2_OFF + Number(k)] = v;
}

/**
 * Bootstrap keys (docs/mycelium-bootstrap-2026-11-14/DESIGN.md, exploration): pre-laid trail (P), free first layer (F) and owner conduit
 * (O), each alone, at both ends of every bound, and in the combinations the screens run. Each case compares the GPU with the CPU at every
 * segment (stateDigest, which covers the free counters and the Z and Q planes) and names a baseline: `same: false` proves the key is not
 * vacuous, `same: true` proves a key set to its neutral value changes nothing. firstDiff (in baseline mode, for the `vs` check only) skips the free counters and Z, Q when the baseline
 * does not carry them, so a baseline without the keys compares on A, C, P and the particles.
 */
function bootstrapCases(): Case[] {
  const w = { width: 64, height: 64, founders: 600, maxParticles: 3000 };
  const cs = ["births", "deaths", "contended"] as const;
  const out: Case[] = [];
  /** A case from config overrides and the keys its baseline drops. */
  const mk = (name: string, over: Partial<MyceliumConfig>, drop: string[], extra: Partial<Case> = {}, size: Partial<MyceliumConfig> = w): void => {
    const rest = Object.fromEntries(Object.entries(over).filter(([k]) => !drop.includes(k))) as Partial<MyceliumConfig>;
    out.push({
      name: `bootstrap ${name}`, cfg: defaultConfig({ ...size, ...over }), steps: 400, seg: 100, must: ["births", "deaths"],
      vs: { cfg: defaultConfig({ ...size, ...rest }), same: false }, ...extra,
    });
  };
  const P = ["trailInit", "trailInitPattern", "trailInitPitch"];
  const FL = ["trailFreeLayer"];
  const OWN = ["trailOwner", "ownerDefend", "ownerConduit", "ownerConduitCap", "ownerGhost"];

  // ---- P: pre-laid trail (createWorld only; the GPU gets it through upload) ----
  mk("prelaid carpet 16 + conduit 128", { trailInit: 16, trailConduit: 128 }, [...P, "trailConduit"], { must: [...cs] });
  mk("prelaid rows 8 + conduit, gradient light", { trailInit: 32, trailInitPattern: "rows", trailConduit: 64, lightPattern: "gradient" }, [...P, "trailConduit"]);
  mk("prelaid cols 8 + conduit, gradient light", { trailInit: 32, trailInitPattern: "cols", trailConduit: 64, lightPattern: "gradient" }, [...P, "trailConduit"]);
  mk("prelaid lattice pitch 6", { trailInit: 32, trailInitPattern: "lattice", trailInitPitch: 6 }, P);
  mk("prelaid patches (default pitch 8)", { trailInit: 32, trailInitPattern: "patches" }, P);
  mk("prelaid patches pitch 2 (smallest, h 1)", { trailInit: 20, trailInitPattern: "patches", trailInitPitch: 2 }, P);
  mk("prelaid patches pitch 3 (odd, h 1)", { trailInit: 20, trailInitPattern: "patches", trailInitPitch: 3 }, P);
  mk("prelaid rows pitch 64 (largest, one row)", { trailInit: 64, trailInitPattern: "rows", trailInitPitch: 64 }, P);
  mk("prelaid carpet 1 (smallest)", { trailInit: 1 }, P);
  mk("prelaid carpet 255 clamps to nutrient0 48", { trailInit: 255 }, P, { check: (cpu) => (cpu.P.some((v) => v > 0) ? null : "no trail on the field") });
  mk("prelaid carpet 16 on nutrient0 4", { trailInit: 16, nutrient0: 4 }, ["trailInit", "trailInitPattern", "trailInitPitch"]);
  mk("prelaid rows, durable pDecay 66", { trailInit: 48, trailInitPattern: "rows", pDecay: 66 }, P);
  mk("prelaid rows, blocked", { trailInit: 48, trailInitPattern: "rows", heredity: "blocked" }, P);
  mk("prelaid rows, physarum null", { controller: "physarum", heredity: "frozen", trailInit: 48, trailInitPattern: "rows" }, P, { must: ["births", "deaths"] });
  mk("prelaid rows with toll", { trailInit: 64, trailInitPattern: "rows", moveCost: 12, trailMoveDiscount: 64, trailDiscountMode: "toll" }, P);
  mk("prelaid lattice pitch 7, 100x60", { trailInit: 40, trailInitPattern: "lattice", trailInitPitch: 7 }, P, {}, { width: 100, height: 60, founders: 300, maxParticles: 900 });
  mk("prelaid lattice pitch 16 + conduit, 256x256", { trailInit: 40, trailInitPattern: "lattice", trailInitPitch: 16, trailConduit: 32 }, [...P, "trailConduit"],
    { steps: 800, seg: 200, must: [...cs, "mutations"] }, { width: 256, height: 256, founders: 4096, maxParticles: 16384 });

  // ---- F: free first layer ----
  const dep = { maxDeposit: 12 };
  for (const F of [1, 4, 255]) mk(`free layer ${F}`, { trailFreeLayer: F, ...dep }, FL, { must: [...cs, "mutations"], check: (cpu) => ((cpu.totals.freeUnits ?? 0) > 0 ? null : "no free unit was laid") });
  mk("free layer 8 with default maxDeposit 4", { trailFreeLayer: 8 }, FL);
  mk("free layer 8 + conduit 32", { trailFreeLayer: 8, trailConduit: 32, ...dep }, FL);
  mk("free layer 8 + conduit 32 + ghost 5", { trailFreeLayer: 8, trailConduit: 32, trailConduitGhost: 5, ...dep }, FL);
  mk("conduit ghost 1 without F", { trailConduit: 64, trailConduitGhost: 1, ...dep }, ["trailConduitGhost"]);
  mk("conduit ghost 63 (largest on 64x64) without F", { trailConduit: 64, trailConduitGhost: 63, ...dep }, ["trailConduitGhost"]);
  for (const h of ["inherit", "blocked", "frozen"] as const) mk(`free layer 8, ${h}`, { trailFreeLayer: 8, heredity: h, ...dep }, FL);
  mk("free layer 8 with toll", { trailFreeLayer: 8, moveCost: 12, trailMoveDiscount: 64, trailDiscountMode: "toll", ...dep }, FL);
  mk("free layer 8, gradient light", { trailFreeLayer: 8, lightPattern: "gradient", ...dep }, FL);
  mk("free layer 16 + prelaid rows 8 + conduit 32, durable", { trailFreeLayer: 16, trailInit: 24, trailInitPattern: "rows", trailConduit: 32, pDecay: 66, ...dep }, [...FL, ...P, "trailConduit"]);
  mk("free layer 8, 256x256", { trailFreeLayer: 8, ...dep }, FL, { steps: 800, seg: 200, must: [...cs, "mutations"] }, { width: 256, height: 256, founders: 4096, maxParticles: 16384 });
  // Clipped energy: depositCost 4096 exceeds the energy, so no unit is paid for, and the free units still go down.
  mk("free layer 2 with the paid part clipped to zero by energy", { trailFreeLayer: 2, maxEat: 0, depositCost: 4096, founderEnergy: 600, moveCost: 12, ...dep }, FL, {
    must: ["deaths"], tweak: (s) => setOut(s, { 0: 60, 1: 60, 2: 127, 3: 127 }), check: (cpu) => ((cpu.totals.freeUnits ?? 0) > 0 && cpu.totals.paidUnits === 0 ? null : "expected free units and no paid unit"),
  });
  // Energy that binds part way: some paid units are clipped, some are not.
  mk("free layer 3 with the paid part clipped part way", { trailFreeLayer: 3, depositCost: 300, founderEnergy: 800, maxEat: 4, ...dep }, FL, {
    must: ["deaths"], tweak: (s) => setOut(s, { 0: 20, 1: -20, 2: 60, 3: 127 }), check: (cpu) => ((cpu.totals.freeUnits ?? 0) > 0 && (cpu.totals.paidUnits ?? 0) > 0 ? null : "expected both free and paid units"),
  });
  // P far above F everywhere: room is 0 (compare before subtract), so the state arrays equal the keyless run exactly.
  mk("free layer 8 over trail 1000 (room 0 equals keyless)", { trailFreeLayer: 8, ...dep }, FL, {
    steps: 150, seg: 50, tweak: (s) => { s.P.fill(1000); }, vs: { cfg: defaultConfig({ ...w, ...dep }), same: true },
  });
  // 100 particles on one cell, all asking for 11: the shared room, and trail that changes within one step.
  mk("free layer 255 with a clump of 100 on one cell", { trailFreeLayer: 255, ...dep }, FL, {
    steps: 12, seg: 2, must: [], tweak: (s) => { setOut(s, { 2: 127, 3: 127 }); clump(s, 100); }, // short: the clump dies out and the baseline would catch up
    check: (cpu) => ((cpu.totals.freeUnits ?? 0) > 0 ? null : "no free unit"),
  });
  mk("free layer 5 with a clump of 40 (room not a multiple of the share)", { trailFreeLayer: 5, ...dep }, FL, {
    steps: 120, seg: 20, must: [], tweak: (s) => { setOutEach(s, (i) => ({ 2: 127, 3: 20 + (i % 7) * 15 })); clump(s, 40); },
  });
  out.push({
    name: "bootstrap free layer 8 with trailConduit 0 equals free layer 8 alone", cfg: defaultConfig({ ...w, trailFreeLayer: 8, trailConduit: 0, ...dep }), steps: 300, seg: 100, must: ["births", "deaths"],
    vs: { cfg: defaultConfig({ ...w, trailFreeLayer: 8, ...dep }), same: true },
  });

  // ---- O: owner conduit ----
  const own = (m: "id" | "gid" = "id"): Partial<MyceliumConfig> => ({ trailOwner: m });
  const noOwn = (over: Partial<MyceliumConfig>) => Object.fromEntries(Object.entries(over).filter(([k]) => !OWN.includes(k))) as Partial<MyceliumConfig>;
  // Passive: the planes alone change nothing about the dynamics (only the header and Z, Q differ).
  const claimed = (cpu: MyceliumState) => (cpu.Q!.some((v) => v > 0) ? null : "no cell was claimed");
  mk("owner passive (id) equals keyless", own(), OWN, { vs: { cfg: defaultConfig(w), same: true }, check: claimed });
  mk("owner passive (gid) equals keyless", own("gid"), OWN, { vs: { cfg: defaultConfig(w), same: true }, check: claimed });
  mk("owner passive, maxDeposit 12 equals keyless", { ...own(), ...dep }, OWN, { vs: { cfg: defaultConfig({ ...w, ...dep }), same: true }, check: claimed });

  // Claims, in a clump of stationary depositors on cell (3,3) of a 16x16 world. Particle i has id i and starts with gid i; nothing moves or eats.
  const cb = { width: 16, height: 16, founders: 40, maxParticles: 400 };
  const rich = { maxDeposit: 255, founderMatter: 300, founderEnergy: 20000, energyMax: 1 << 20, depositCost: 1, maxEat: 0, bodyMax: 600, upkeep: 0, nutrient0: 0 };
  const CELL = 3 * 16 + 3;
  /** P is set in every world (the keyless baseline too); Z and Q only where the planes exist. */
  const seedCell = (s: MyceliumState, z: number, q: number, p: number, a = 0): void => { s.P[CELL] = p; s.A[CELL] = a; if (s.Z && s.Q) { s.Z[CELL] = z; s.Q[CELL] = q; } };
  const depOut = (v: number) => ({ 3: v });
  const small = (name: string, over: Partial<MyceliumConfig>, tweak: Case["tweak"], same: boolean, extra: Partial<Case> = {}): void => {
    out.push({
      name: `bootstrap ${name}`, cfg: defaultConfig({ ...cb, ...rich, ...over }), steps: 60, seg: 10, must: [], tweak,
      vs: { cfg: defaultConfig({ ...cb, ...rich, ...noOwn(over) }), same }, check: claimed, ...extra,
    });
  };
  // Deposits: 64 gives 127, 127 gives 253 (maxDeposit 255); an output of 1 gives 1.
  const tie = (v: number) => (s: MyceliumState): void => { setOutEach(s, () => depOut(v)); clump(s, 6); };
  small("owner claim tie at deposit 1 (larger id wins)", own(), tie(1), true);
  small("owner claim tie at deposit 127", own(), tie(64), true);
  small("owner claim tie at deposit 253", own(), tie(127), true);
  small("owner claim tie, gid mode, two clans of three", own("gid"), (s) => { setOutEach(s, () => depOut(127)); clump(s, 6); for (let i = 0; i < 6; i++) s.gid[i] = i % 2; }, true);
  small("owner claim: the larger deposit beats the larger tag", own(), (s) => { setOutEach(s, (i) => depOut(i === 0 ? 127 : 64)); clump(s, 5); }, true);
  small("owner claim: a same-clan depositor below the maximum still adds to Q", own("gid"), (s) => {
    setOutEach(s, (i) => depOut(i === 0 ? 127 : 64)); clump(s, 4);
    s.gid[0] = 1; s.gid[1] = 1; s.gid[2] = 0; s.gid[3] = 0;
  }, true);
  small("owner claim: a foreign deposit adds to P only and does not dislodge", own("gid"), (s) => {
    setOutEach(s, (i) => depOut(i < 3 ? 127 : 40)); clump(s, 4); s.gid[3] = 7; seedCell(s, 8, 100, 100); // clan 7 (tag 8) owns it; particle 3 is of that clan
  }, true);
  small("owner claim: only strangers deposit on an owned cell", own("gid"), (s) => { setOutEach(s, () => depOut(127)); clump(s, 4); seedCell(s, 9, 50, 80); }, true);
  // Q decays with the same draw as P: the largest rate, the smallest, and none.
  small("owner Q decay at pDecay 65535", { ...own(), pDecay: 65535 }, tie(127), true, { steps: 20, seg: 1, check: () => null }); // every cell decays to nothing each step
  small("owner Q decay at pDecay 1", { ...own(), pDecay: 1 }, tie(127), true, { steps: 120, seg: 30 });
  small("owner Q decay at pDecay 0 (no decay branch)", { ...own(), pDecay: 0 }, tie(127), true, { steps: 120, seg: 30 });

  // Eating gate. Ten particles stationary on one owned cell, two of the owner clan (tag 6) and eight strangers, all asking for 198.
  // Nobody deposits, so Q stays where it was put (pDecay 0). Q = theta - 1 never fires the gate (equals keyless); Q = theta does.
  const gate = (theta: number, q: number, a: number): void => {
    small(`owner defend theta ${theta}, Q ${q}, A ${a}${a >= 1000 ? " (R <= A: a gated request left in req would underflow A)" : ""}`,
      { ...own("gid"), ownerDefend: theta, maxEat: 200, pDecay: 0 },
      (s) => {
        setOutEach(s, () => ({ 2: 127 })); clump(s, 10);
        for (let i = 0; i < 10; i++) s.gid[i] = i < 2 ? 5 : i;
        seedCell(s, 6, q, q + 3, a);
      }, q < theta, { check: () => null });
  };
  gate(10, 9, 40); gate(10, 10, 40); gate(10, 10, 1000); gate(10, 40, 1000);
  gate(1, 1, 40);       // theta 1, the smallest: any owned trail refuses a stranger
  gate(255, 254, 40); gate(255, 255, 40); // theta 255, the largest

  // Owner conduit. A 32x32 world with two seeded territories side by side (tags 1 and 2) and extra A at their centres, so edges conduct.
  const w2 = { width: 32, height: 32, founders: 200, maxParticles: 1000 };
  const terr = (qv: number) => (s: MyceliumState): void => {
    for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) { const c = y * 32 + x; s.P[c] += qv; if (s.Z && s.Q) { s.Z[c] = 1; s.Q[c] = qv; } }
    for (let y = 4; y < 12; y++) for (let x = 12; x < 20; x++) { const c = y * 32 + x; s.P[c] += qv; if (s.Z && s.Q) { s.Z[c] = 2; s.Q[c] = qv; } }
    s.A[8 * 32 + 8] += 3000; s.A[8 * 32 + 15] += 3000;
  };
  const conduit = (name: string, over: Partial<MyceliumConfig>, drop: string[], same = false, extra: Partial<Case> = {}, size: Partial<MyceliumConfig> = w2): void => {
    const rest = Object.fromEntries(Object.entries(over).filter(([k]) => !drop.includes(k))) as Partial<MyceliumConfig>;
    out.push({
      name: `bootstrap ${name}`, cfg: defaultConfig({ ...size, ...over }), steps: 300, seg: 100, must: ["births", "deaths"], tweak: terr(120),
      vs: { cfg: defaultConfig({ ...size, ...rest }), same }, ...extra,
    });
  };
  const OC = ["ownerConduit", "ownerConduitCap", "ownerGhost"];
  conduit("owner conduit g 0 equals no conduit", { ...own(), ownerConduit: 0 }, OC, true);
  conduit("owner conduit g 1", { ...own(), ownerConduit: 1 }, OC);
  conduit("owner conduit g 255 (rate capped at 128)", { ...own(), ownerConduit: 255 }, OC);
  conduit("owner conduit g 64 cap 1", { ...own(), ownerConduit: 64, ownerConduitCap: 1 }, OC);
  conduit("owner conduit g 255 cap 255", { ...own(), ownerConduit: 255, ownerConduitCap: 255 }, OC);
  conduit("owner conduit g 16 cap 40, gid", { ...own("gid"), ownerConduit: 16, ownerConduitCap: 40 }, OC);
  conduit("owner conduit g 64, diffA 128 (the largest allowed: the cap leaves nothing to add, equals no conduit)", { ...own(), ownerConduit: 64, diffA: 128 }, OC, true);
  conduit("owner conduit g 64, diffA 0 (the skip guard is off)", { ...own(), ownerConduit: 64, diffA: 0 }, OC);
  conduit("owner conduit g 64 + ghost 1", { ...own(), ownerConduit: 64, ownerGhost: 1 }, ["ownerGhost"]);
  conduit("owner conduit g 64 + ghost 31 (largest on 32x32)", { ...own(), ownerConduit: 64, ownerGhost: 31 }, ["ownerGhost"]);
  conduit("owner conduit g 64 + ghost 5, defend 20", { ...own(), ownerConduit: 64, ownerGhost: 5, ownerDefend: 20 }, ["ownerGhost"]);
  conduit("owner defend 20 + conduit 64 (EC)", { ...own("gid"), ownerDefend: 20, ownerConduit: 64 }, OC);
  conduit("public conduit 64 beside owner + defend (C-pub)", { ...own("gid"), ownerDefend: 20, trailConduit: 64 }, ["trailConduit"]);
  conduit("owner conduit g 64, 100x60 odd size, gradient light", { ...own(), ownerConduit: 64, lightPattern: "gradient" }, OC, false, {}, { width: 100, height: 60, founders: 300, maxParticles: 900 });
  // The proposal on its own: territories form by themselves, no seeding.
  const EC = { ...own("gid"), ownerDefend: 24, ownerConduit: 48, maxDeposit: 12 };
  mk("owner EC emerging (gid)", EC, [...OWN], { must: [...cs, "mutations"], check: claimed });
  mk("owner EC emerging (id), blocked heredity", { ...EC, trailOwner: "id", heredity: "blocked" }, [...OWN], { must: [...cs] });
  mk("owner EC emerging with low mutation (mutRate 4096)", { ...EC, mutRate: 4096 }, [...OWN], { must: [...cs, "mutations"] });
  mk("owner EC emerging, physarum null (id)", { ...EC, trailOwner: "id", controller: "physarum", heredity: "frozen" }, [...OWN]);
  mk("owner EC on the toll substrate", { ...EC, moveCost: 12, trailMoveDiscount: 64, trailDiscountMode: "toll" }, [...OWN]);
  mk("owner EC-ghost 64 emerging (ghost on 64x64: displaced owner)", { ...EC, ownerGhost: 32 }, ["ownerGhost"]);
  mk("owner EC + free layer 8 + prelaid rows (every key at once)", { ...EC, trailFreeLayer: 8, trailInit: 24, trailInitPattern: "rows", pDecay: 66 }, [...OWN, ...FL, ...P]);
  mk("owner defend theta 255 + conduit 255 cap 255 emerging", { ...own("gid"), ownerDefend: 255, ownerConduit: 255, maxDeposit: 12 }, [...OWN]);
  mk("owner EC, 256x256, 4096 founders", EC, [...OWN], { steps: 800, seg: 200, must: [...cs, "mutations"], check: claimed }, { width: 256, height: 256, founders: 4096, maxParticles: 16384 });
  return out;
}

const smallWorld = { width: 32, height: 32, founders: 64, maxParticles: 256 };
const cases: Case[] = [
  {
    // 256 founders fill one 256-thread workgroup. Each has body 1 and energy 2^24 = energyMax, eats nothing and deposits
    // its whole body (output 3 = 127), so it dies in step 1 and all its energy becomes heat: the workgroup's heat is
    // exactly 256 * 2^24 = 2^32, whose low word is 0. Without the w_hi carry in w_add the whole sum is lost.
    name: "one workgroup's heat sum is exactly 2^32 (w_hi carry)",
    cfg: defaultConfig({ ...smallWorld, founders: 256, founderMatter: 1, founderEnergy: 1 << 24, energyMax: 1 << 24, maxEat: 0, maxDeposit: 255, upkeep: 0 }),
    tweak: (s) => { s.genome.fill(0); for (let i = 0; i < s.n; i++) s.genome[i * NN_BYTES + B2_OFF + 3] = 127; },
    steps: 3, seg: 1, must: ["deaths"],
    check: (cpu, m) => (m.heat === 2 ** 32 && cpu.n === 0 ? null : `expected a single step with heat exactly 2^32 and no survivors, got heat ${m.heat}, n ${cpu.n}`),
  },
  {
    // The CPU refuses a birth one at a time once the particle ids run out (ids end at 0xfffffffe); the GPU must do the same, not error.
    name: "nextId 15 below the limit (refusals one at a time)",
    cfg: defaultConfig(smallWorld), tweak: (s) => { s.nextId = 0xfffffff0; },
    steps: 300, seg: 100, must: ["births", "refused"],
    check: (cpu) => (cpu.nextId === ID_MAX + 1 ? null : `ids did not run out (nextId ${cpu.nextId})`),
  },
  {
    // Frozen heredity never starts a genotype, so a genotype-id counter near its limit is harmless and the GPU must not raise.
    name: "nextGid near the limit, frozen heredity (no genotype ids used)",
    cfg: defaultConfig({ ...smallWorld, heredity: "frozen" }), tweak: (s) => { s.nextGid = 0xfffffff0; },
    steps: 300, seg: 100, must: ["births"],
    check: (cpu) => (cpu.nextGid === 0xfffffff0 ? null : `nextGid moved to ${cpu.nextGid}`),
  },
  {
    // One step moves more than 2^32 energy through lightIn (waste everywhere, full light) and through heat
    // (every particle starts rich and pays 4096 per unit of trail), so the lo/hi pairs and carries are used.
    name: "per-step counters past 2^32",
    cfg: defaultConfig({
      width: 512, height: 512, maxParticles: 65536, founders: 65536, founderMatter: 256, founderEnergy: 1 << 22, energyMax: 1 << 24,
      bodyMax: 256, eA: 255, light: 4096, maxDeposit: 255, depositCost: 4096, upkeep: 0, nutrient0: 0,
    }),
    tweak: (s) => s.C.fill(5000), steps: 6, seg: 1, big: true, must: ["deaths"],
  },
  {
    // Every genotype id spent (nextGid = ID_MAX + 1) and the frozen arm: the CPU refuses every birth, the parents keep their
    // bodies and the population only dies. The GPU used to split the parent and raise at readback.
    name: "nextGid exhausted, frozen heredity (every birth refused, parents keep M)",
    cfg: defaultConfig({ ...smallWorld, heredity: "frozen" }), tweak: (s) => { s.nextGid = ID_MAX + 1; },
    steps: 120, seg: 20, must: ["deaths", "refused"],
    check: (cpu) => (cpu.totals.births === 0 && cpu.nextGid === ID_MAX + 1 ? null : `expected no births, got ${cpu.totals.births}`),
  },
  {
    // The genotype-id space runs out in the middle of the run while about half the children are novel.
    name: "nextGid 40 below the limit, inherit with half the children novel",
    cfg: defaultConfig({ ...smallWorld, maxParticles: 4096, mutRate: 30000 }), tweak: (s) => { s.nextGid = ID_MAX - 40; },
    steps: 300, seg: 30, must: ["births", "refused", "mutations"],
    check: (cpu) => (cpu.nextGid === ID_MAX + 1 ? null : `genotype ids did not run out (nextGid ${cpu.nextGid})`),
  },
  {
    // 65,536 particles in one cell, all asking for the maximum, with A one short of the request total: the contended
    // grant is floor(r * A / R) with r * A near 2^32 (the u32 bound), so a wrong width or an overflow shows at once.
    name: "hot cell: 65536 particles in one cell, A = R - 1 (r * A near 2^32)",
    cfg: defaultConfig({ width: 8, height: 8, founders: 65536, maxParticles: 65536, founderMatter: 1, nutrient0: 0, maxEat: 255, bodyMax: 65536, splitEnergy: 0, splitMatter: 2, founderEnergy: 100000, energyMax: 1 << 24 }),
    tweak: (s) => { setOut(s, { 2: 127, 4: 127 }); s.x.fill(0); s.y.fill(0); s.A[0] = 253 * 65536 - 1; },
    steps: 6, seg: 1, must: ["contended"],
  },
  {
    name: "hot cell: 3000 particles in one cell with births, A = R - 1",
    cfg: defaultConfig({ width: 8, height: 8, founders: 3000, maxParticles: 4000, founderMatter: 1, nutrient0: 0, maxEat: 255, bodyMax: 65536, splitEnergy: 0, splitMatter: 2, founderEnergy: 5000, energyMax: 1 << 20 }),
    tweak: (s) => { setOut(s, { 2: 127, 4: 127, 0: 40 }); s.x.fill(0); s.y.fill(0); s.A[0] = 253 * 3000 - 1; },
    steps: 80, seg: 10, must: ["contended", "births"],
  },
  ...r2bCases(),
  ...trailCases(),
  ...conduitCases(),
  ...bootstrapCases(),
  { name: "default 128x128", cfg: defaultConfig(), steps: 2000, seg: 250, must: [...base, "mutations"] },
  { name: "inherit", cfg: defaultConfig({ heredity: "inherit" }), steps: 500, seg: 100, must: [...base, "mutations"] },
  { name: "frozen", cfg: defaultConfig({ heredity: "frozen" }), steps: 500, seg: 100, must: [...base] },
  { name: "blocked", cfg: defaultConfig({ heredity: "blocked" }), steps: 500, seg: 100, must: [...base] },
  { name: "gradient light", cfg: defaultConfig({ lightPattern: "gradient" }), steps: 600, seg: 100, must: [...base, "mutations"] },
  { name: "256x256, 4096 founders", cfg: defaultConfig({ width: 256, height: 256, founders: 4096, maxParticles: 16384 }), steps: 3000, seg: 500, must: [...base, "mutations"] },
  {
    name: "512x512 at the 65536 cap",
    cfg: defaultConfig({ width: 512, height: 512, maxParticles: 65536, founders: 32768, upkeep: 3, light: 2 }),
    steps: 150, seg: 25, must: [...base, "mutations", "refused"],
  },
  {
    name: "100x60, small cap, gradient, no diffusion/decay/mutation count",
    cfg: defaultConfig({ width: 100, height: 60, founders: 200, maxParticles: 300, lightPattern: "gradient", diffA: 0, diffC: 0, pDecay: 0, mutCount: 0 }),
    steps: 400, seg: 100, must: [...base, "refused"],
  },
  {
    name: "odd params, seed 0xfffffff1",
    cfg: defaultConfig({
      width: 72, height: 40, founders: 300, maxParticles: 1200, seed: 0xfffffff1, sensorShift: 2, energyShift: 3, massShift: 2, speed: 256,
      maxEat: 200, bodyMax: 64, founderMatter: 20, moveCost: 40, massUpkeepShift: 3, excreteShift: 3, maxDeposit: 30, depositCost: 5,
      splitMatter: 24, splitEnergy: 300, mutRate: 65536, mutCount: 16, mutStep: 127, diffA: 256, diffC: 200, weightSpan: 127, light: 5,
    }),
    steps: 500, seg: 100, must: [...base, "mutations"],
  },
];

async function runCase(c: Case): Promise<Row> {
  const cpu = make(c);
  const gpu = await GpuMycelium.create(dev, make(c));
  let cpuMs = 0, gpuMs = 0, note = "", ok = true, bigLight = 0, bigHeat = 0;
  for (let done = 0; done < c.steps;) {
    const k = Math.min(c.seg, c.steps - done);
    let t0 = performance.now();
    for (let j = 0; j < k; j++) { const st = step(cpu); bigLight = Math.max(bigLight, st.lightIn); bigHeat = Math.max(bigHeat, st.heat); }
    cpuMs += performance.now() - t0;
    t0 = performance.now();
    gpu.step(k);
    await gpu.sync();
    gpuMs += performance.now() - t0;
    done += k;
    const g = await gpu.read();
    const d = firstDiff(cpu, g);
    const bad = validateState(g);
    if (d || bad.length || stateDigest(cpu) !== stateDigest(g)) {
      ok = false;
      note = `step ${done}: ${d ?? "digests differ but no field differs"}${bad.length ? `; validateState ${bad[0]}` : ""}`;
      note += `\n      ${await localize(c, done)}`;
      break;
    }
  }
  const t = cpu.totals;
  if (ok && c.big && !(bigLight > 2 ** 32 && bigHeat > 2 ** 32)) { ok = false; note = `no single step passed 2^32 (lightIn ${bigLight}, heat ${bigHeat})`; }
  if (ok) {
    for (const m of c.must) {
      if (!(t[m] > 0)) { ok = false; note = `case did not exercise ${m}`; }
    }
  }
  if (ok && c.check) { const bad = c.check(cpu, { lightIn: bigLight, heat: bigHeat }); if (bad) { ok = false; note = bad; } }
  if (ok && c.vs) {
    const base = make({ ...c, cfg: c.vs.cfg }); // same tweak, baseline config
    for (let t = 0; t < c.steps; t++) step(base);
    const d = firstDiff(cpu, base, true);
    if (c.vs.same && d) { ok = false; note = `expected the same dynamics as the baseline config, but ${d}`; }
    if (!c.vs.same && !d) { ok = false; note = "the key changed nothing against its baseline config (vacuous case)"; }
  }
  const g = ok ? await gpu.read() : null;
  gpu.destroy();
  return {
    name: c.name, ok, steps: c.steps, n: cpu.n, cpuMs: cpuMs / c.steps, gpuMs: gpuMs / c.steps, digest: stateDigest(cpu), note,
    totals: `${c.big ? `max step lightIn ${bigLight} heat ${bigHeat}; ` : ""}births ${t.births} deaths ${t.deaths} refused ${t.refused} contended ${t.contended} mutations ${t.mutations} families ${g ? new Set(g.gid.subarray(0, g.n)).size : "-"}`,
  };
}

/** GPU state read back mid-run, encoded, decoded, uploaded and continued must equal the continuous CPU run. */
async function runResume(over: Partial<MyceliumConfig> = {}, label = ""): Promise<Row> {
  const cfg = defaultConfig({ width: 96, height: 96, founders: 800, maxParticles: 3000, ...over });
  const total = 700, cut = 301; // odd cut: the live particle buffer is the second of the ping-pong pair
  const cpu = createWorld(cfg);
  const t0 = performance.now();
  for (let t = 0; t < total; t++) step(cpu);
  const cpuMs = performance.now() - t0;
  const gpuA = await GpuMycelium.create(dev, cfg);
  gpuA.step(cut);
  const mid = decode(encode(await gpuA.read())); // decode validates the checkpoint, including both ledgers
  const mid2 = createWorld(cfg);
  for (let t = 0; t < cut; t++) step(mid2);
  let ok = true, note = "";
  if (stateDigest(mid) !== stateDigest(mid2)) { ok = false; note = `mid-run readback differs: ${firstDiff(mid2, mid)}`; }
  const gpuB = await GpuMycelium.create(dev, mid); // fresh buffers
  // Run both existing objects past the checkpoint first, so the upload has live particle and field state to overwrite
  // (re-uploading the state an object already holds would pass even if the particle upload were skipped). 50 extra
  // steps leave gpuA on the same ping-pong side as the checkpoint, 49 leave gpuC on the other.
  const gpuC = await GpuMycelium.create(dev, cfg);
  gpuA.step(50); gpuC.step(cut + 49);
  await Promise.all([gpuA.sync(), gpuC.sync()]);
  gpuA.upload(mid);
  gpuC.upload(mid);
  const t1 = performance.now();
  gpuA.step(total - cut); gpuB.step(total - cut); gpuC.step(total - cut);
  await Promise.all([gpuA.sync(), gpuB.sync(), gpuC.sync()]);
  const gpuMs = performance.now() - t1;
  for (const [label, g] of [["uploaded over live state, same ping-pong side", gpuA], ["fresh object from the checkpoint", gpuB], ["uploaded over live state, other ping-pong side", gpuC]] as const) {
    const s = await g.read();
    const d = firstDiff(cpu, s);
    if (d || stateDigest(cpu) !== stateDigest(s) || validateState(s).length) { ok = false; note += `${note ? "; " : ""}${label}: ${d ?? "digest differs"}`; }
  }
  if (!(cpu.totals.births > 0 && cpu.totals.deaths > 0)) { ok = false; note += " resume case exercised nothing"; }
  gpuA.destroy(); gpuB.destroy(); gpuC.destroy();
  return {
    name: `resume at step ${cut} of ${total}${label}`, ok, steps: total, n: cpu.n, cpuMs: cpuMs / total, gpuMs: gpuMs / (total - cut) / 3, digest: stateDigest(cpu), note,
    totals: `births ${cpu.totals.births} deaths ${cpu.totals.deaths}`,
  };
}

/**
 * The one bound the GPU still detects instead of porting, the 2^50 ledger, must raise exactly when the CPU does (landing on
 * 2^50 is accepted by both, one over is refused by both). Everything else that used to be a detected limit is now ported and must
 * equal the CPU: the genotype-id refusal (cut inside a step, in every heredity arm) and the step counter past 2^32.
 */
async function runGuards(): Promise<Row> {
  const cfg = defaultConfig(smallWorld);
  let ok = true, note = "";
  const fail = (m: string) => { ok = false; note += `${m}; `; };
  const throws = async (f: () => unknown) => { try { await f(); return false; } catch { return true; } };
  const readOrFail = async (g: GpuMycelium, what: string): Promise<MyceliumState | null> => {
    try { return await g.read(); } catch (e) { fail(`${what}: GPU raised (${(e as Error).message})`); return null; }
  };

  // 2^50 ledger, over the bound: the CPU throws in step(); the GPU flags it and read() throws.
  {
    const s = createWorld(cfg);
    s.totals.heat = 2 ** 50; s.energy0 += 2 ** 50;
    const g = await GpuMycelium.create(dev, s);
    g.step(2);
    if (!await throws(() => g.read())) fail("heat counter past 2^50: no error");
    g.destroy();
    if (!await throws(() => step(Object.assign(createWorld(cfg), { totals: { ...createWorld(cfg).totals, heat: 2 ** 50 } })))) fail("CPU did not throw at the 2^50 ledger bound");
  }

  // 2^50 ledger, exactly on the bound: an empty 8x8 world with 2 waste in cell 0 and light 1 adds 1 to lightIn per step, from
  // 2^50 - 1. Step 1 lands on exactly 2^50 and both sides accept it; step 2 would pass it and both raise.
  {
    const lc = defaultConfig({ width: 8, height: 8, founders: 0, nutrient0: 0, eA: 1, light: 1, diffA: 0, diffC: 0, maxParticles: 4 });
    const mk = () => { const s = createWorld(lc); s.C[0] = 2; s.totals.lightIn = 2 ** 50 - 1; s.totals.heat = 2 ** 50 - 1; s.matter0 = matterTotal(s); s.energy0 = energyTotal(s); return s; };
    const cpu = mk();
    const g = await GpuMycelium.create(dev, mk());
    step(cpu); g.step(1);
    const gs = await readOrFail(g, "ledger exactly 2^50");
    if (cpu.totals.lightIn !== 2 ** 50) fail(`ledger exact bound: CPU lightIn ${cpu.totals.lightIn}, expected 2^50`);
    if (gs && (gs.totals.lightIn !== 2 ** 50 || stateDigest(gs) !== stateDigest(cpu))) fail(`ledger exact bound: GPU not equal at exactly 2^50: ${firstDiff(cpu, gs)}`);
    const cpuThrew = await throws(() => step(cpu));
    g.step(1);
    const gpuThrew = await throws(() => g.read());
    if (!cpuThrew || !gpuThrew) fail(`ledger one past 2^50: cpu threw ${cpuThrew}, gpu threw ${gpuThrew}`);
    g.destroy();
  }

  // Genotype ids: with nextGid = ID_MAX - room the CPU accepts births until the id space is spent, then refuses every one
  // (room -1: nextGid is already ID_MAX + 1). The GPU must equal the CPU after every step, through the refusal and after it.
  // "half the children novel" puts the cut inside a step among children that are not novel, so a parent whose child is cut
  // has to keep its body. Across the arms: some run ends a step with the space exactly spent and nothing refused, some run
  // is cut part way through a step's births.
  let boundary = 0, refusals = 0, partial = 0;
  const arms: [string, Partial<MyceliumConfig>, number[]][] = [
    ["every child novel", { mutRate: 65536 }, [-1, 0, 1, 2, 3, 5, 8]],
    ["half the children novel", { mutRate: 30000 }, [-1, 0, 1, 2, 3, 5, 8, 20]],
    ["blocked", { heredity: "blocked" }, [-1, 0, 1, 3, 8]],
    ["frozen", { heredity: "frozen" }, [-1, 0, 5]],
  ];
  for (const [label, over, rooms] of arms) {
    for (const room of rooms) {
      const tag = `genotype ids, ${label}, room ${room}`;
      const c = defaultConfig({ ...smallWorld, maxParticles: 4096, ...over });
      const s = createWorld(c);
      s.nextGid = ID_MAX - room;
      const cpu = decode(encode(s));
      const g = await GpuMycelium.create(dev, s);
      let after = 0, sawRefusal = false;
      for (let t = 1; t <= 300 && after < 12; t++) {
        const st = step(cpu);
        g.step(1);
        const gs = await readOrFail(g, `${tag}, step ${t}`);
        if (!gs) break;
        if (stateDigest(gs) !== stateDigest(cpu) || validateState(gs).length) { fail(`${tag}: differs at step ${t}: ${firstDiff(cpu, gs) ?? validateState(gs)[0]}`); break; }
        if (st.refused > 0 && cpu.nextGid === ID_MAX + 1) {
          sawRefusal = true; refusals++;
          if (st.births > 0 && cpu.n + st.refused < c.maxParticles) partial++;
        } else if (!sawRefusal && cpu.nextGid === ID_MAX + 1 && room >= 0) boundary++;
        if (sawRefusal) after++;
      }
      if (over.heredity !== "frozen" && !sawRefusal) fail(`${tag}: the CPU never refused for genotype ids`);
      if (over.heredity === "frozen" && sawRefusal !== (room < 0)) fail(`${tag}: frozen refusal ${sawRefusal}, expected ${room < 0}`);
      g.destroy();
    }
  }
  if (refusals === 0) fail("genotype ids: no run reached a refusal");
  if (boundary === 0) fail("genotype ids: no run ended a step with the id space exactly spent and nothing refused");
  if (partial === 0) fail("genotype ids: no run was cut part way through a step's births");

  // Step counter past 2^32: the GPU keeps (lo, hi) and the PRNG keys on lo, the CPU's step mod 2^32. Equal across
  // 2^32 - 1 -> 2^32 -> 2^32 + 1 on a populated world, and a checkpoint at a step above 2^32 uploads and resumes.
  {
    const s = createWorld(cfg);
    s.step = 0xfffffffd;
    const cpu = decode(encode(s));
    const g = await GpuMycelium.create(dev, s);
    for (let t = 1; t <= 6; t++) {
      step(cpu); g.step(1);
      const gs = await readOrFail(g, `step ${cpu.step}`);
      if (!gs) break;
      if (gs.step !== cpu.step || stateDigest(gs) !== stateDigest(cpu)) { fail(`step counter: differs at step ${cpu.step}: ${firstDiff(cpu, gs)}`); break; }
    }
    if (cpu.step !== 0xfffffffd + 6 || cpu.totals.births === 0) fail("step counter: the run did not cross 2^32 with births");
    const mid = decode(encode(cpu));
    const resumed = await GpuMycelium.create(dev, mid);
    for (let t = 0; t < 40; t++) step(cpu);
    resumed.step(40); g.upload(mid); g.step(40);
    for (const [label, r] of [["fresh object above 2^32", resumed], ["upload above 2^32", g]] as const) {
      const rs = await readOrFail(r, label);
      if (rs && (rs.step !== cpu.step || stateDigest(rs) !== stateDigest(cpu))) fail(`step counter, ${label}: ${firstDiff(cpu, rs)}`);
    }
    resumed.destroy(); g.destroy();
    // The step is exact up to 2^53 (a double): the step that would pass it raises, and an upload beyond it throws.
    const top = createWorld(cfg);
    top.step = 2 ** 53 - 1;
    const gt = await GpuMycelium.create(dev, top);
    gt.step(1);
    const ts = await readOrFail(gt, "step 2^53");
    if (ts && ts.step !== 2 ** 53) fail(`step counter: expected 2^53, got ${ts?.step}`);
    gt.step(1);
    if (!await throws(() => gt.read())) fail("step counter: passing 2^53 raised no error");
    gt.destroy();
    const beyond = createWorld(cfg);
    beyond.step = 2 ** 54;
    const gb = await GpuMycelium.create(dev, createWorld(cfg));
    if (!await throws(() => gb.upload(beyond))) fail("step counter: uploading a step beyond 2^53 did not throw");
    gb.destroy();
  }
  // The Physarum null runs on the GPU now (R2b); the bad config values still stop at createWorld, never at the shader.
  {
    for (const bad of [{ physarumDeposit: 100 }, { controller: "physarum" as const, heredity: "frozen" as const, physarumDeposit: 769 }, { blindTrailGradient: 1 as unknown as boolean },
      { trailMoveDiscount: 257 }, { trailMoveDiscount: -1 }, { trailMoveDiscount: 1.5 }, { trailDiscountMode: "toll" as const }, { trailMoveDiscount: 5, trailDiscountMode: "private" as unknown as "toll" },
      { trailConduit: 256 }, { trailConduit: -1 }, { trailConduit: 1.5 }, { trailConduitCap: 5 }, { trailConduit: 8, trailConduitCap: 0 }, { trailConduit: 8, trailConduitCap: 256 }, { trailConduit: 8, diffA: 129 }]) {
      let threw = false;
      try { createWorld(defaultConfig({ ...smallWorld, ...bad })); } catch { threw = true; }
      if (!threw) fail(`config ${JSON.stringify(bad)} was accepted`);
    }
  }
  return { name: "ledger bound raises like the CPU; genotype-id refusal and steps past 2^32 equal the CPU", ok, steps: 0, n: 0, cpuMs: 0, gpuMs: 0, digest: "-", note, totals: "" };
}


/**
 * Bootstrap guards: the state straight after create equals the CPU's createWorld (the pre-laid trail only exists there), the keyless field layout
 * is the frozen literal, bad new-key configs stop at createWorld, and the free-layer counters raise at 2^50 on both engines.
 */
async function runBootstrapGuards(): Promise<Row> {
  let ok = true, note = "";
  const fail = (m: string) => { ok = false; note += `${note ? "; " : ""}${m}`; };
  const w = { width: 64, height: 48, founders: 300, maxParticles: 1500 };
  // Step 0: every pattern, the clamp, and the owner and free-layer planes, read straight after create.
  const zero: [string, Partial<MyceliumConfig>][] = [
    ["carpet", { trailInit: 20 }], ["carpet clamp", { trailInit: 255 }], ["nutrient0 4", { trailInit: 16, nutrient0: 4 }],
    ["rows", { trailInit: 20, trailInitPattern: "rows" }], ["cols", { trailInit: 20, trailInitPattern: "cols", trailInitPitch: 5 }],
    ["lattice", { trailInit: 20, trailInitPattern: "lattice", trailInitPitch: 6 }], ["patches", { trailInit: 20, trailInitPattern: "patches" }],
    ["patches pitch 2", { trailInit: 20, trailInitPattern: "patches", trailInitPitch: 2 }], ["rows pitch 64", { trailInit: 20, trailInitPattern: "rows", trailInitPitch: 64 }],
    ["free layer", { trailFreeLayer: 8 }], ["owner", { trailOwner: "gid", ownerDefend: 5, ownerConduit: 9 }], ["owner id + free layer + prelaid", { trailOwner: "id", trailFreeLayer: 3, trailInit: 5 }],
  ];
  for (const [label, over] of zero) {
    const cfg = defaultConfig({ ...w, ...over });
    const cpu = createWorld(cfg);
    const g = await GpuMycelium.create(dev, cfg);
    const gs = await g.read();
    if (stateDigest(gs) !== stateDigest(cpu) || firstDiff(cpu, gs) || validateState(gs).length) fail(`step 0, ${label}: ${firstDiff(cpu, gs) ?? "digest differs"}`);
    g.destroy();
  }
  // The keyless field layout is exactly the literal; each key appends planes after it.
  const N = 64 * 48, lit = fieldLayout(defaultConfig(w));
  const same = lit.A === 0 && lit.C === N && lit.P === 2 * N && lit.D === 3 * N && lit.R === 4 * N && lit.TK === 5 * N && lit.SENT === 6 * N && lit.words === 10 * N;
  if (!same) fail(`keyless field layout moved: ${JSON.stringify(lit)}`);
  const lf = fieldLayout(defaultConfig({ ...w, trailFreeLayer: 4 })), lo = fieldLayout(defaultConfig({ ...w, trailOwner: "id" })), lb = fieldLayout(defaultConfig({ ...w, trailFreeLayer: 4, trailOwner: "id" }));
  if (lf.DS !== 10 * N || lf.words !== 11 * N || lo.Z !== 10 * N || lo.Q !== 11 * N || lo.W1 !== 12 * N || lo.W2 !== 13 * N || lo.words !== 14 * N
    || lb.DS !== 10 * N || lb.Z !== 11 * N || lb.words !== 15 * N) fail("optional planes are not appended after the keyless ones");
  // Bad values stop at createWorld, never at the shader.
  const bad: Partial<MyceliumConfig>[] = [
    { trailInit: 0 }, { trailInit: 256 }, { trailInit: 1.5 }, { trailInitPattern: "rows" }, { trailInit: 5, trailInitPattern: "stripes" as never }, { trailInitPitch: 8 },
    { trailInit: 5, trailInitPitch: 8 }, { trailInit: 5, trailInitPattern: "carpet", trailInitPitch: 8 }, { trailInit: 5, trailInitPattern: "rows", trailInitPitch: 1 },
    { trailInit: 5, trailInitPattern: "rows", trailInitPitch: 65 }, { trailFreeLayer: 0 }, { trailFreeLayer: 256 }, { trailConduitGhost: 3 },
    { trailConduit: 8, trailConduitGhost: 0 }, { trailConduit: 8, trailConduitGhost: 48 }, { trailOwner: "both" as never }, { ownerDefend: 5 }, { trailOwner: "id", ownerDefend: 0 },
    { trailOwner: "id", ownerDefend: 256 }, { ownerConduit: 5 }, { trailOwner: "id", ownerConduit: 256 }, { trailOwner: "id", ownerConduit: 5, diffA: 129 },
    { trailOwner: "id", ownerConduit: 5, trailConduit: 5 }, { trailOwner: "id", ownerConduitCap: 5 }, { trailOwner: "id", ownerConduit: 5, ownerConduitCap: 0 },
    { trailOwner: "id", ownerConduit: 5, ownerConduitCap: 256 }, { ownerGhost: 3 }, { trailOwner: "id", ownerConduit: 5, ownerGhost: 0 }, { trailOwner: "id", ownerConduit: 5, ownerGhost: 48 },
  ];
  for (const b of bad) {
    let threw = false;
    try { createWorld(defaultConfig({ ...w, ...b })); } catch { threw = true; }
    if (!threw) fail(`config ${JSON.stringify(b)} was accepted`);
  }
  // The free-layer counters are ledgers too: one unit past 2^50 raises on both engines, exactly 2^50 does not.
  {
    const cfg = defaultConfig({ width: 32, height: 32, founders: 64, maxParticles: 256, trailFreeLayer: 255, maxDeposit: 12 });
    const s = createWorld(cfg);
    s.totals.freeUnits = 2 ** 50 - 5;
    const cpu = decode(encode(s));
    const g = await GpuMycelium.create(dev, s);
    let threwAt = 0;
    for (let t = 1; t <= 200 && !threwAt; t++) { try { step(cpu); } catch { threwAt = t; } }
    if (!threwAt) fail("free counter: the CPU never passed 2^50");
    else {
      g.step(threwAt - 1);
      const before = await readOrNull(g);
      if (!before) fail(`free counter: the GPU raised before step ${threwAt}`);
      g.step(1);
      const gpuThrew = await throws(() => g.read());
      if (!gpuThrew) fail(`free counter: the CPU raised at step ${threwAt}, the GPU did not`);
    }
    g.destroy();
  }
  return { name: "bootstrap guards: step 0 equals createWorld, keyless layout frozen, bad configs refused, free counter raises at 2^50", ok, steps: 0, n: 0, cpuMs: 0, gpuMs: 0, digest: "-", note, totals: "" };
}
async function readOrNull(g: GpuMycelium): Promise<MyceliumState | null> { try { return await g.read(); } catch { return null; } }
async function throws(f: () => Promise<unknown>): Promise<boolean> { try { await f(); return false; } catch { return true; } }

const rows: Row[] = [];
for (const c of cases) {
  if (only.length && !only.some((s) => c.name.includes(s))) continue;
  rows.push(await runCase(c));
  const r = rows.at(-1)!;
  console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.note ? `\n      ${r.note}` : ""}`);
}
if (!only.length || only.some((s) => "resume".includes(s))) {
  const variants: [Partial<MyceliumConfig>, string][] = [
    [{}, ""],
    [{ controller: "physarum", heredity: "frozen", physarumDeposit: 100 }, ", physarumDeposit 100"],
    [{ blindTrailGradient: true }, ", blindTrailGradient"],
    [{ moveCost: 12, trailMoveDiscount: 64, trailDiscountMode: "toll" }, ", trailMoveDiscount 64 toll"],
    [{ trailConduit: 32, trailConduitCap: 60 }, ", trailConduit 32 cap 60"],
    [{ trailConduit: 8, moveCost: 12, trailMoveDiscount: 64, trailDiscountMode: "toll" }, ", trailConduit 8 with toll"],
    [{ trailInit: 24, trailInitPattern: "lattice", trailInitPitch: 8, trailConduit: 32, pDecay: 66 }, ", bootstrap prelaid lattice + conduit"],
    [{ trailFreeLayer: 8, maxDeposit: 12, trailConduit: 32, trailConduitGhost: 5 }, ", bootstrap free layer 8 + conduit ghost 5"],
    [{ trailOwner: "gid", ownerDefend: 24, ownerConduit: 48, maxDeposit: 12 }, ", bootstrap owner defend 24 conduit 48 (gid)"],
    [{ trailOwner: "id", ownerDefend: 24, ownerConduit: 48, ownerGhost: 7, trailFreeLayer: 8, trailInit: 24, trailInitPattern: "rows", maxDeposit: 12 }, ", bootstrap every key (id)"],
  ];
  for (const [over, label] of variants) {
    rows.push(await runResume(over, label));
    const r = rows.at(-1)!;
    console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.note ? `\n      ${r.note}` : ""}`);
  }
}

if (!only.length || only.some((s) => "guards".includes(s))) {
  rows.push(await runGuards());
  const r = rows.at(-1)!;
  console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.note ? `\n      ${r.note}` : ""}`);
}

/** The comparison helper itself: strict by default (a one-sided counter or plane is a difference), lenient only in baseline mode. */
function runDiffGuards(): Row {
  let ok = true, note = "";
  const fail = (m: string) => { ok = false; note += `${note ? "; " : ""}${m}`; };
  const w = { width: 32, height: 32, founders: 50, maxParticles: 400 };
  const keyed = createWorld(defaultConfig({ ...w, trailFreeLayer: 8, trailOwner: "gid", ownerDefend: 4 }));
  const plain = createWorld(defaultConfig(w));
  if (firstDiff(keyed, keyed) !== null) fail("a state differs from itself");
  const lacksCounters = { ...keyed, totals: { ...keyed.totals } };
  delete lacksCounters.totals.freeUnits; delete lacksCounters.totals.paidUnits;
  if (!firstDiff(keyed, lacksCounters)?.startsWith("totals.")) fail("a GPU read without the free counters was not reported");
  if (!firstDiff(lacksCounters, keyed)?.startsWith("totals.")) fail("a CPU state without the free counters was not reported");
  const lacksPlanes = { ...keyed, Z: undefined, Q: undefined } as MyceliumState;
  if (!firstDiff(keyed, lacksPlanes)?.startsWith("Z:")) fail("a GPU read without the owner planes was not reported");
  if (firstDiff(keyed, plain, true) !== null) fail(`baseline mode reported a counter or plane the baseline lacks: ${firstDiff(keyed, plain, true)}`);
  if (firstDiff(keyed, plain) === null) fail("strict mode did not report the keyed state against a keyless one");
  return { name: "firstDiff guards: one-sided free counters and owner planes are differences (baseline mode skips them)", ok, steps: 0, n: 0, cpuMs: 0, gpuMs: 0, digest: "-", note, totals: "" };
}

if (!only.length || only.some((s) => "firstdiff guards".includes(s.toLowerCase()))) {
  rows.push(runDiffGuards());
  const r = rows.at(-1)!;
  console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.note ? `\n      ${r.note}` : ""}`);
}

if (!only.length || only.some((s) => "bootstrap guards".includes(s))) {
  rows.push(await runBootstrapGuards());
  const r = rows.at(-1)!;
  console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.note ? `\n      ${r.note}` : ""}`);
}

if (rows.length === 0) {
  console.error(`no case matches ${JSON.stringify(only)}; refusing to report a pass for zero cases`);
  Deno.exit(1);
}

console.log("\ncase".padEnd(66) + "steps".padStart(6) + "  particles" + "  cpu ms/step" + "  gpu ms/step" + "  speedup  digest");
for (const r of rows) {
  console.log(
    `${r.ok ? "PASS" : "FAIL"} ${r.name}`.padEnd(65) + String(r.steps).padStart(6) + String(r.n).padStart(11) + r.cpuMs.toFixed(2).padStart(14) +
      r.gpuMs.toFixed(2).padStart(14) + `${r.gpuMs > 0 && r.cpuMs > 0 ? `${(r.cpuMs / r.gpuMs).toFixed(1)}x` : "-"}`.padStart(9) + `  ${r.digest}`,
  );
  console.log(`      ${r.totals}`);
}
const failed = rows.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} of ${rows.length} cases FAILED` : `\nall ${rows.length} cases match bit for bit`);
Deno.exit(failed ? 1 : 0);
