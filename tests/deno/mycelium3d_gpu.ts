// GPU 3D mycelium world (tools/mycelium3d/gpu.ts) vs the CPU reference (tools/mycelium3d/world.ts), bit for bit.
// Both run side by side; every checkpoint compares stateDigest (the digest of the full checkpoint encoding) and runs
// validateState on the GPU readback (matter and energy ledgers). On a mismatch it reports the first differing array
// and index, then reruns one step at a time to name the first differing step.
//
//   deno run -A --no-lock tests/deno/mycelium3d_gpu.ts [name-substring ...]
//   deno run -A --no-lock tests/deno/mycelium3d_gpu.ts --bench     (steps per second only; no parity)
//
// Needs a real GPU (native WebGPU). Exits non-zero on any mismatch or if a case fails to exercise its paths.
import {
  B2_OFF3, BOND_NONE, type BondStats, createWorld, decode, defaultConfig, encode, energyTotal, ID_MAX, LEDGER_MAX, matterTotal, type Mycelium3dConfig, type Mycelium3dState, NN_BYTES3,
  OUT, POS_SHIFT, stateDigest, step, STEP_MAX, validateState,
} from "../../tools/mycelium3d/world.ts";
import { GpuMycelium3d, mycelium3dDevice } from "../../tools/mycelium3d/gpu.ts";

const dev = await mycelium3dDevice();
const only = Deno.args.filter((a) => !a.startsWith("--"));

/** "cell 123 (x 3, y 4, z 1)" for a field index of config c. */
const at = (c: Mycelium3dConfig, i: number) => `${i} (x ${i % c.width}, y ${Math.floor(i / c.width) % c.height}, z ${Math.floor(i / (c.width * c.height))})`;

/**
 * First difference between two states over everything the checkpoint encodes, or null. Strict by default: a plane one
 * side has and the other lacks is a difference. `baseline` is for comparing a keyed world with a keyless baseline config
 * (the `vs` check), where one side legitimately has no Z, Q.
 */
function firstDiff(a: Mycelium3dState, b: Mycelium3dState, baseline = false): string | null {
  for (const k of ["step", "n", "nextId", "nextGid", "matter0", "energy0"] as const) {
    if (a[k] !== b[k]) return `${k}: cpu ${a[k]} gpu ${b[k]}`;
  }
  for (const k of new Set([...Object.keys(a.totals), ...Object.keys(b.totals)]) as Set<keyof Mycelium3dState["totals"]>) {
    if (a.totals[k] !== b.totals[k]) return `totals.${k}: cpu ${a.totals[k]} gpu ${b.totals[k]}`;
  }
  for (const k of ["A", "C", "P"] as const) {
    for (let i = 0; i < a[k].length; i++) if (a[k][i] !== b[k][i]) return `${k}[${at(a.config, i)}]: cpu ${a[k][i]} gpu ${b[k][i]}`;
  }
  for (const k of ["Z", "Q"] as const) {
    const x = a[k], y = b[k];
    if (!baseline && !x !== !y) return `${k}: cpu ${x ? "has" : "lacks"} the plane, gpu ${y ? "has" : "lacks"} it`;
    if (x && y) for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return `${k}[${at(a.config, i)}]: cpu ${x[i]} gpu ${y[i]}`;
  }
  for (const k of ["id", "parent", "gid", "x", "y", "z", "M", "E", "age"] as const) {
    for (let i = 0; i < a.n; i++) if (a[k][i] !== b[k][i]) return `${k}[${i}]: cpu ${a[k][i]} gpu ${b[k][i]} (cpu id ${a.id[i]})`;
  }
  for (const k of ["bond0", "bond1"] as const) {
    const x = a[k], y = b[k];
    if (!baseline && !x !== !y) return `${k}: cpu ${x ? "has" : "lacks"} the slots, gpu ${y ? "has" : "lacks"} them`;
    if (x && y) for (let i = 0; i < a.n; i++) if (x[i] !== y[i]) return `${k}[${i}]: cpu ${x[i]} gpu ${y[i]} (cpu id ${a.id[i]})`;
  }
  for (let i = 0; i < a.n * NN_BYTES3; i++) {
    if (a.genome[i] !== b.genome[i]) return `genome slot ${Math.floor(i / NN_BYTES3)} byte ${i % NN_BYTES3}: cpu ${a.genome[i]} gpu ${b.genome[i]}`;
  }
  return null;
}

/** After a checkpoint mismatch: replay from scratch one step at a time and name the first step that differs. */
async function localize(c: Case, upTo: number): Promise<string> {
  const cpu = make(c);
  const gpu = await GpuMycelium3d.create(dev, make(c));
  for (let t = 1; t <= upTo; t++) {
    step(cpu); gpu.step(1);
    const d = firstDiff(cpu, await gpu.read());
    if (d) { gpu.destroy(); return `first differing step ${t}: ${d}`; }
  }
  gpu.destroy();
  return `no per-step difference found up to step ${upTo}`;
}

type Must = "births" | "deaths" | "contended" | "mutations" | "refused";
interface Case {
  name: string;
  cfg: Mycelium3dConfig;
  steps: number;
  seg: number;
  /** Paths the case must exercise (cumulative CPU totals above zero), or the pass means little. */
  must: Must[];
  /** Edits the freshly created world (matter and energy anchors are recomputed after). */
  tweak?: (s: Mycelium3dState) => void;
  /** Require that particles changed layers and that some particle sat on each z wall (surface and floor) during the run. */
  walls?: boolean;
  /** Extra requirement on the finished CPU run and its largest single-step lightIn / heat; returns a complaint or null. */
  check?: (cpu: Mycelium3dState, maxStep: { lightIn: number; heat: number }) => string | null;
  /** A baseline config run on the CPU for the same steps: `same: true` requires the same final state, `same: false` a different one (the key is not vacuous). */
  vs?: { cfg: Mycelium3dConfig; same: boolean };
  /** Bond events the CPU run must show (summed StepStats.bonds above zero), so a bond case cannot pass vacuously. */
  bonds?: (keyof BondStats)[];
}

/** Sets controller output biases (the same for every particle) to fixed values. */
function setOut(s: Mycelium3dState, outs: Record<number, number>): void {
  setOutEach(s, () => outs);
}
/** Per-particle controller output biases; every other weight is 0. */
function setOutEach(s: Mycelium3dState, f: (i: number) => Record<number, number>): void {
  s.genome.fill(0);
  for (let i = 0; i < s.n; i++) for (const [k, v] of Object.entries(f(i))) s.genome[i * NN_BYTES3 + B2_OFF3 + Number(k)] = v;
}
/** Puts particles 0..k-1 in the middle of cell (cx, cy, cz). */
function clump(s: Mycelium3dState, k: number, cx = 3, cy = 3, cz = 1): void {
  for (let i = 0; i < k; i++) { s.x[i] = (cx << POS_SHIFT) + 128; s.y[i] = (cy << POS_SHIFT) + 128; s.z[i] = (cz << POS_SHIFT) + 128; }
}

function make(c: Case): Mycelium3dState {
  const s = createWorld(c.cfg);
  if (c.tweak) { c.tweak(s); s.matter0 = matterTotal(s); s.energy0 = energyTotal(s); }
  return s;
}

interface Row { name: string; ok: boolean; steps: number; n: number; cpuMs: number; gpuMs: number; digest: string; note: string; totals: string }

const cs: Must[] = ["births", "deaths", "contended"];
const OWN = ["trailOwner", "ownerDefend", "ownerConduit", "ownerConduitCap", "ownerGhost"];
/** A case whose baseline is the same config without the keys in `drop` (which must change the dynamics, unless `same`). */
function lever(name: string, over: Partial<Mycelium3dConfig>, drop: string[], extra: Partial<Case> = {}, size: Partial<Mycelium3dConfig> = mid, same = false): Case {
  const rest = Object.fromEntries(Object.entries(over).filter(([k]) => !drop.includes(k))) as Partial<Mycelium3dConfig>;
  return { name, cfg: defaultConfig({ ...size, ...over }), steps: 500, seg: 100, must: [...cs], vs: { cfg: defaultConfig({ ...size, ...rest }), same }, ...extra };
}

const mid = { width: 16, height: 16, depth: 8, founders: 300, maxParticles: 2000 };
const claimed = (cpu: Mycelium3dState) => (cpu.Q!.some((v) => v > 0) ? null : "no cell was claimed");

const cases: Case[] = [
  // ---- 64-bit counters ----
  {
    // 256 founders fill one 256-thread workgroup. Each has body 1 and energy 2^24 = energyMax, eats nothing and deposits its
    // whole body, so it dies in step 1 and all its energy becomes heat: the workgroup's heat is exactly 2^32 (low word 0).
    name: "one workgroup's heat sum is exactly 2^32 (w_hi carry)",
    cfg: defaultConfig({ width: 8, height: 8, depth: 4, founders: 256, maxParticles: 256, founderMatter: 1, founderEnergy: 1 << 24, energyMax: 1 << 24, maxEat: 0, maxDeposit: 255, upkeep: 0 }),
    tweak: (s) => setOut(s, { [OUT.DEPOSIT]: 127 }), steps: 3, seg: 1, must: ["deaths"],
    check: (cpu, m) => (m.heat === 2 ** 32 && cpu.n === 0 ? null : `expected one step with heat exactly 2^32 and no survivors, got heat ${m.heat}, n ${cpu.n}`),
  },
  {
    // Waste everywhere under full light at eA 255: one step's lightIn is 4096 * 255 * 8192 cells, above 2^32 (the add64 carry).
    name: "per-step lightIn past 2^32",
    cfg: defaultConfig({ width: 64, height: 64, depth: 2, founders: 500, maxParticles: 2000, eA: 255, light: 4096, energyMax: 1 << 24, nutrient0: 0 }),
    tweak: (s) => s.C.fill(5000), steps: 4, seg: 1, must: ["births"],
    check: (_cpu, m) => (m.lightIn > 2 ** 32 ? null : `no single step passed 2^32 (lightIn ${m.lightIn})`),
  },
  // ---- shapes ----
  { name: "8x8x4, 40 founders, cap 300", cfg: defaultConfig({ width: 8, height: 8, depth: 4, founders: 40, maxParticles: 300 }), steps: 600, seg: 100, must: ["births", "deaths"], walls: true },
  { name: "16x16x8, 300 founders", cfg: defaultConfig(mid), steps: 1000, seg: 100, must: [...cs, "mutations"], walls: true },
  {
    name: "13x9x5 odd shape, gradient light, cap 777", cfg: defaultConfig({ width: 13, height: 9, depth: 5, founders: 150, maxParticles: 777, lightPattern: "gradient" }),
    steps: 800, seg: 100, must: [...cs, "mutations"], walls: true,
  },
  { name: "D = 1 (16x16x1)", cfg: defaultConfig({ width: 16, height: 16, depth: 1, founders: 100, maxParticles: 800 }), steps: 800, seg: 100, must: [...cs, "mutations"] },
  // Sinking needs a layer below: with D = 1 the key changes nothing.
  lever("D = 1 with sinkShift 3 equals no sinking", { width: 16, height: 16, depth: 1, founders: 100, maxParticles: 800, sinkShift: 3 }, ["sinkShift"], { steps: 400 }, {}, true),
  {
    name: "D = 1 with toll, owner gate and owner conduit",
    cfg: defaultConfig({ width: 16, height: 16, depth: 1, founders: 100, maxParticles: 800, moveCost: 12, trailMoveDiscount: 64, trailDiscountMode: "toll", trailOwner: "gid", ownerDefend: 8, ownerConduit: 48, maxDeposit: 12 }),
    steps: 600, seg: 100, must: [...cs], check: claimed,
  },
  { name: "default 32x32x16", cfg: defaultConfig(), steps: 1500, seg: 250, must: [...cs, "mutations"], walls: true },
  {
    name: "32x32x16 gradient light, seed 0xfffffff1, odd params",
    cfg: defaultConfig({
      lightPattern: "gradient", seed: 0xfffffff1, sensorShift: 2, energyShift: 3, massShift: 2, speed: 256, maxEat: 200, bodyMax: 64, founderMatter: 20,
      moveCost: 40, massUpkeepShift: 3, excreteShift: 3, maxDeposit: 30, depositCost: 5, splitMatter: 24, splitEnergy: 300, mutRate: 65536, mutCount: 16,
      mutStep: 127, diffA: 256, diffC: 200, weightSpan: 127, light: 5, maxParticles: 5000,
    }),
    steps: 500, seg: 100, must: [...cs, "mutations"],
  },
  // ---- sinking ----
  lever("sinkShift 6", { sinkShift: 6 }, ["sinkShift"], { steps: 800, must: [...cs, "mutations"] }),
  lever("sinkShift 1 (half of every cell falls)", { sinkShift: 1 }, ["sinkShift"], { steps: 500 }),
  lever("sinkShift 16 (k = 1)", { sinkShift: 16, pDecay: 66 }, ["sinkShift"], { steps: 400 }),
  lever("32x32x16 with sinkShift 6", { sinkShift: 6 }, ["sinkShift"], { steps: 1000, seg: 250, must: [...cs, "mutations"] }, {}),
  // ---- heredity and mutation ----
  { name: "frozen heredity", cfg: defaultConfig({ ...mid, heredity: "frozen" }), steps: 600, seg: 100, must: [...cs], check: (s) => (s.totals.mutations === 0 ? null : "mutations under frozen") },
  { name: "blocked heredity", cfg: defaultConfig({ ...mid, heredity: "blocked" }), steps: 600, seg: 100, must: [...cs] },
  { name: "mutation off (mutRate 0)", cfg: defaultConfig({ ...mid, mutRate: 0 }), steps: 600, seg: 100, must: [...cs], check: (s) => (s.totals.mutations === 0 ? null : "mutations with mutRate 0") },
  { name: "mutation count 0 (draws but no change)", cfg: defaultConfig({ ...mid, mutCount: 0 }), steps: 400, seg: 100, must: [...cs], check: (s) => (s.totals.mutations === 0 ? null : "mutations with mutCount 0") },
  { name: "every child mutates (mutRate 65536, mutCount 16)", cfg: defaultConfig({ ...mid, mutRate: 65536, mutCount: 16, mutStep: 127 }), steps: 500, seg: 100, must: [...cs, "mutations"] },
  // ---- the cap ----
  {
    name: "cap 257 reached (refused births)", cfg: defaultConfig({ ...mid, founders: 200, maxParticles: 257 }), steps: 500, seg: 50, must: [...cs, "refused"],
    check: (s) => (s.totals.refused > 0 ? null : "no refusal"),
  },
  { name: "cap 1000 in the default volume (refused births)", cfg: defaultConfig({ maxParticles: 1000, founders: 900 }), steps: 400, seg: 100, must: [...cs, "refused"] },
  // ---- light ----
  { name: "light 0 (nothing converts)", cfg: defaultConfig({ ...mid, light: 0 }), steps: 400, seg: 100, must: ["births", "deaths"], check: (s) => (s.totals.lightIn === 0 ? null : `lightIn ${s.totals.lightIn}`) },
  { name: "light 4096 (the largest), uniform", cfg: defaultConfig({ ...mid, light: 4096 }), steps: 400, seg: 100, must: [...cs] },
  { name: "light 4096, gradient, eA 255", cfg: defaultConfig({ ...mid, light: 4096, lightPattern: "gradient", eA: 255, energyMax: 1 << 24 }), steps: 300, seg: 100, must: ["births", "deaths"] },
  { name: "light 3, gradient (fractional surface)", cfg: defaultConfig({ width: 13, height: 9, depth: 6, founders: 150, maxParticles: 900, light: 3, lightPattern: "gradient" }), steps: 500, seg: 100, must: [...cs] },
  lever("lightK 1 (shading is almost total)", { lightK: 1 }, [], { vs: { cfg: defaultConfig(mid), same: false } }),
  lever("lightK 65536 (almost lossless)", { lightK: 65536 }, [], { vs: { cfg: defaultConfig(mid), same: false } }),
  {
    // Trail far above MCAP everywhere: m saturates at 16383, the floor gets almost no light.
    name: "shading saturates (trail 10^6 per cell, lightK 1)", cfg: defaultConfig({ ...mid, lightK: 1 }), steps: 200, seg: 50, must: ["deaths"],
    tweak: (s) => { s.P.fill(1_000_000); },
  },
  // ---- waste shading ----
  lever("wasteShade 0, sinkShift 6", { wasteShade: 0, sinkShift: 6 }, ["wasteShade"], { steps: 800, must: [...cs, "mutations"] }),
  lever("wasteShade 3, sinkShift 4, lightK 16", { wasteShade: 3, sinkShift: 4, lightK: 16 }, ["wasteShade"], { steps: 600 }),
  lever("wasteShade 2, 13x9x5 odd shape, light 3, gradient", { wasteShade: 2, sinkShift: 5, light: 3, lightPattern: "gradient" }, ["wasteShade"], { steps: 500 },
    { width: 13, height: 9, depth: 5, founders: 150, maxParticles: 900 }),
  lever("32x32x16 with sinkShift 6 and wasteShade 4", { sinkShift: 6, wasteShade: 4 }, ["wasteShade"], { steps: 1000, seg: 250, must: [...cs, "mutations"] }, {}),
  lever("wasteShade with sinkShift 6, toll and owner gate + conduit (gid)", {
    wasteShade: 1, sinkShift: 6, moveCost: 12, trailMoveDiscount: 64, trailDiscountMode: "toll", trailOwner: "gid", ownerDefend: 2, ownerConduit: 120, maxDeposit: 12,
  }, ["wasteShade"], { steps: 600, check: claimed }),
  lever("D = 1 with wasteShade 0 equals no waste shading", { width: 16, height: 16, depth: 1, founders: 100, maxParticles: 800, wasteShade: 0, sinkShift: 3 }, ["wasteShade"], { steps: 400 }, {}, true),
  {
    // Waste far above MCAP everywhere: m saturates on C alone (shift 0), the floor gets almost no light.
    name: "waste shading saturates (waste 10^6 per cell, wasteShade 0)", cfg: defaultConfig({ ...mid, wasteShade: 0, sinkShift: 6 }), steps: 200, seg: 50, must: ["deaths"],
    tweak: (s) => { s.C.fill(1_000_000); },
    vs: { cfg: defaultConfig({ ...mid, sinkShift: 6 }), same: false },
  },
  {
    // The largest shift: 2^19 waste per cell (2^30 in all) gives C >> 16 = 8 per cell, so the shift-16 path still shades.
    name: "wasteShade 16 with waste 2^19 per cell", cfg: defaultConfig({ ...mid, wasteShade: 16, nutrient0: 0 }), steps: 200, seg: 50, must: ["deaths"],
    tweak: (s) => { s.C.fill(1 << 19); },
    vs: { cfg: defaultConfig({ ...mid, nutrient0: 0 }), same: false },
  },
  // ---- toll road ----
  lever("toll road, public 32", { moveCost: 12, trailMoveDiscount: 32 }, ["trailMoveDiscount"], { must: [...cs, "mutations"] }),
  lever("toll road, toll 64", { moveCost: 12, trailMoveDiscount: 64, trailDiscountMode: "toll" }, ["trailMoveDiscount", "trailDiscountMode"], { must: [...cs, "mutations"] }),
  lever("toll road, toll 256, blocked", { moveCost: 12, heredity: "blocked", trailMoveDiscount: 256, trailDiscountMode: "toll" }, ["trailMoveDiscount", "trailDiscountMode"]),
  lever("toll road, strength 0 equals keyless", { trailMoveDiscount: 0, trailDiscountMode: "toll" }, ["trailMoveDiscount", "trailDiscountMode"], {}, mid, true),
  {
    // moveCost at its maximum and every move output full: raw = 381 * 4096, the largest product of the rule.
    name: "toll road at moveCost 4096 with full MX, MY, MZ",
    cfg: defaultConfig({ ...mid, moveCost: 4096, upkeep: 0, founderEnergy: 4096, trailMoveDiscount: 100 }), steps: 200, seg: 50, must: ["deaths"],
    tweak: (s) => { setOut(s, { [OUT.MX]: 127, [OUT.MY]: -127, [OUT.MZ]: 127, [OUT.EAT]: 127 }); s.P.fill(2); },
  },
  // ---- conduits ----
  lever("trail conduit g 32", { trailConduit: 32 }, ["trailConduit"], { must: [...cs, "mutations"] }),
  lever("trail conduit g 255, cap 7", { trailConduit: 255, trailConduitCap: 7 }, ["trailConduit", "trailConduitCap"]),
  lever("trail conduit g 255, cap 1, sinkShift 4", { trailConduit: 255, trailConduitCap: 1, sinkShift: 4 }, ["trailConduit", "trailConduitCap"]),
  lever("trail conduit g 64, ghost 5", { trailConduit: 64, trailConduitGhost: 5, maxDeposit: 12 }, ["trailConduitGhost"]),
  lever("trail conduit g 0 equals keyless", { trailConduit: 0 }, ["trailConduit"], {}, mid, true),
  lever("trail conduit, diffA 0 (the skip guard), g 32", { trailConduit: 32, diffA: 0 }, ["trailConduit"], { must: ["births", "deaths"] }),
  {
    name: "trail conduit, trail 2^19 per cell, g 255 (min before multiply)", cfg: defaultConfig({ ...mid, trailConduit: 255 }), steps: 200, seg: 50, must: ["births", "deaths"],
    tweak: (s) => { s.P.fill(1 << 19); } // 2048 cells: total matter stays below 2^31, vs: { cfg: defaultConfig(mid), same: false },
  },
  // ---- owner planes, gate and owner conduit ----
  lever("owner passive (id) equals keyless", { trailOwner: "id", maxDeposit: 12 }, OWN, { check: claimed }, mid, true),
  lever("owner gate (gid, theta 8)", { trailOwner: "gid", ownerDefend: 8, maxDeposit: 12 }, OWN, { must: [...cs, "mutations"], check: claimed }),
  lever("owner gate theta 1 (id), sinkShift 3", { trailOwner: "id", ownerDefend: 1, maxDeposit: 12, sinkShift: 3 }, OWN, { check: claimed }),
  lever("owner conduit g 48 (gid) + gate 24", { trailOwner: "gid", ownerDefend: 24, ownerConduit: 48, maxDeposit: 12 }, ["ownerConduit"], { must: [...cs, "mutations"], check: claimed }),
  lever("owner conduit g 255 cap 3, ghost 7 (id)", { trailOwner: "id", ownerConduit: 255, ownerConduitCap: 3, ownerGhost: 7, maxDeposit: 12 }, ["ownerConduit", "ownerConduitCap", "ownerGhost"], { check: claimed }),
  lever("owner conduit g 64, diffA 0, sinkShift 5", { trailOwner: "gid", ownerConduit: 64, diffA: 0, maxDeposit: 12, sinkShift: 5 }, ["ownerConduit"], { must: ["births", "deaths"], check: claimed }),
  {
    // Ten stationary particles on one owned cell, two of the owner clan and eight strangers, all asking to eat: Q = theta fires the gate.
    name: "owner gate fires on a seeded cell (Q = theta)",
    cfg: defaultConfig({ width: 8, height: 8, depth: 3, founders: 30, maxParticles: 200, trailOwner: "gid", ownerDefend: 10, maxEat: 200, pDecay: 0 }), steps: 40, seg: 1, must: [],
    tweak: (s) => {
      setOutEach(s, () => ({ [OUT.EAT]: 127 })); clump(s, 10);
      for (let i = 0; i < 10; i++) s.gid[i] = i < 2 ? 5 : i;
      const k = (1 * 8 + 3) * 8 + 3; s.P[k] = 13; s.A[k] = 40; if (s.Z && s.Q) { s.Z[k] = 6; s.Q[k] = 10; } // the keyless baseline has no planes
    },
    vs: { cfg: defaultConfig({ width: 8, height: 8, depth: 3, founders: 30, maxParticles: 200, maxEat: 200, pDecay: 0 }), same: false },
  },
  {
    // Owner claims in a clump of stationary depositors: ties at the largest deposit go to the largest tag.
    name: "owner claim tie in a clump (larger id wins)",
    cfg: defaultConfig({ width: 8, height: 8, depth: 3, founders: 40, maxParticles: 400, trailOwner: "id", maxDeposit: 255, founderMatter: 255, founderEnergy: 20000, energyMax: 1 << 20, depositCost: 1, maxEat: 0, upkeep: 0, nutrient0: 0 }),
    steps: 30, seg: 1, must: [], tweak: (s) => { setOutEach(s, () => ({ [OUT.DEPOSIT]: 64 })); clump(s, 6); }, check: claimed,
  },
  // ---- z motion and walls ----
  {
    // Half the particles swim down at full speed, half up: they pile on both walls, MZ is paid against the clamp.
    name: "z walls: full MZ down and up (frozen)",
    cfg: defaultConfig({ ...mid, heredity: "frozen", speed: 256 }), steps: 300, seg: 1, must: ["deaths"], walls: true,
    tweak: (s) => setOutEach(s, (i) => ({ [OUT.MZ]: i % 2 ? 127 : -127, [OUT.EAT]: 127, [OUT.SPLIT]: 127, [OUT.MX]: (i % 7) * 30 - 90 })),
  },
  {
    // Births at the floor and at the surface: the child's z is clamped.
    name: "births clamped at both z walls",
    cfg: defaultConfig({ width: 8, height: 8, depth: 4, founders: 200, maxParticles: 3000, heredity: "frozen", splitEnergy: 0, splitMatter: 2, founderEnergy: 4000 }), steps: 60, seg: 1, must: ["births"],
    tweak: (s) => { setOutEach(s, () => ({ [OUT.EAT]: 127, [OUT.SPLIT]: 127 })); for (let i = 0; i < s.n; i++) s.z[i] = i % 2 ? 0 : (4 << POS_SHIFT) - 1; },
  },
  // ---- contended eating ----
  {
    name: "hot cell: 3000 particles in one cell with births, A = R - 1",
    cfg: defaultConfig({ width: 8, height: 8, depth: 2, founders: 3000, maxParticles: 4000, founderMatter: 1, nutrient0: 0, maxEat: 255, bodyMax: 65536, splitEnergy: 0, splitMatter: 2, founderEnergy: 5000, energyMax: 1 << 20 }),
    tweak: (s) => { setOut(s, { [OUT.EAT]: 127, [OUT.SPLIT]: 127, [OUT.MX]: 40 }); s.x.fill(0); s.y.fill(0); s.z.fill(0); s.A[0] = 253 * 3000 - 1; },
    steps: 60, seg: 1, must: ["contended", "births"],
  },
  {
    // 65,536 particles in one cell, all asking for the maximum: r * A near 2^32 (the u32 bound).
    name: "hot cell: 65536 particles in one cell, A = R - 1 (r * A near 2^32)",
    cfg: defaultConfig({ width: 8, height: 8, depth: 2, founders: 65536, maxParticles: 65536, founderMatter: 1, nutrient0: 0, maxEat: 255, bodyMax: 65536, splitEnergy: 0, splitMatter: 2, founderEnergy: 100000, energyMax: 1 << 24 }),
    tweak: (s) => { setOut(s, { [OUT.EAT]: 127, [OUT.SPLIT]: 127 }); s.x.fill(0); s.y.fill(0); s.z.fill(0); s.A[0] = 253 * 65536 - 1; },
    steps: 4, seg: 1, must: ["contended"],
  },
  // ---- per step: a divergence that later reconverges (a clamped position, a particle that dies) cannot hide between checkpoints ----
  { name: "per step: sinkShift 1 (sinking rounding)", cfg: defaultConfig({ ...mid, sinkShift: 1 }), steps: 200, seg: 1, must: [...cs] },
  { name: "per step: sinkShift 7 with owned trail (gid, gate 8)", cfg: defaultConfig({ ...mid, sinkShift: 7, trailOwner: "gid", ownerDefend: 8, maxDeposit: 12 }), steps: 200, seg: 1, must: [...cs], check: claimed },
  { name: "per step: owner conduit 48 + gate 24 (gid)", cfg: defaultConfig({ ...mid, trailOwner: "gid", ownerDefend: 24, ownerConduit: 48, maxDeposit: 12 }), steps: 200, seg: 1, must: [...cs], check: claimed },
  { name: "per step: wasteShade 1, sinkShift 5, owner gate 8 (id)", cfg: defaultConfig({ ...mid, wasteShade: 1, sinkShift: 5, trailOwner: "id", ownerDefend: 8, maxDeposit: 12 }), steps: 200, seg: 1, must: [...cs], check: claimed },
  { name: "per step: light 3, gradient, lightK 16 (light rounding)", cfg: defaultConfig({ width: 13, height: 9, depth: 6, founders: 150, maxParticles: 900, light: 3, lightPattern: "gradient", lightK: 16 }), steps: 200, seg: 1, must: ["births", "deaths"] },
  { name: "per step: default 32x32x16 (contended eating, z walls)", cfg: defaultConfig(), steps: 200, seg: 1, must: [...cs], walls: true },
  { name: "per step: toll 64 + trail conduit 32 cap 9", cfg: defaultConfig({ ...mid, moveCost: 12, trailMoveDiscount: 64, trailDiscountMode: "toll", trailConduit: 32, trailConduitCap: 9 }), steps: 200, seg: 1, must: [...cs] },
  // ---- id spaces ----
  {
    name: "nextId 15 below the limit (refusals one at a time)", cfg: defaultConfig(mid), tweak: (s) => { s.nextId = 0xfffffff0; },
    steps: 300, seg: 50, must: ["births", "refused"], check: (s) => (s.nextId === ID_MAX + 1 ? null : `ids did not run out (nextId ${s.nextId})`),
  },
  {
    name: "nextGid 40 below the limit, half the children novel", cfg: defaultConfig({ ...mid, mutRate: 30000 }), tweak: (s) => { s.nextGid = ID_MAX - 40; },
    steps: 300, seg: 20, must: ["births", "refused", "mutations"], check: (s) => (s.nextGid === ID_MAX + 1 ? null : `genotype ids did not run out (nextGid ${s.nextGid})`),
  },
  {
    name: "nextGid 25 below the limit, blocked", cfg: defaultConfig({ ...mid, heredity: "blocked" }), tweak: (s) => { s.nextGid = ID_MAX - 25; },
    steps: 200, seg: 10, must: ["births", "refused"],
  },
  { name: "steps across 2^32", cfg: defaultConfig(mid), tweak: (s) => { s.step = 2 ** 32 - 30; }, steps: 80, seg: 10, must: [...cs] },
  ...bondCases(),
  largeVolume(),
  {
    name: "64x64x8, 4096 founders", cfg: defaultConfig({ width: 64, height: 64, depth: 8, founders: 4096, maxParticles: 16384, sinkShift: 6 }), steps: 600, seg: 200, must: [...cs, "mutations"],
  },
];

/** Bonds (RULES.md, "Bonds"): shapes, levers, contested proposals, bonded deaths, children bonded at birth, id limits, per step. */
function bondCases(): Case[] {
  const B = { bondBreak: 512, bondCost: 1 } as const;
  const BC = { ...B, bondChild: true } as const;
  const DROP = ["bondBreak", "bondCost", "bondChild"];
  const evolve: (keyof BondStats)[] = ["proposals", "formed", "partnerDied", "letGo", "stretched"];
  const kids: (keyof BondStats)[] = [...evolve, "childBonds"];
  /** Every particle wants to bond and stays put; positions spread over a 2 x 2 x 1 block of cells, with some exact duplicates (id tie-breaks). */
  const crowd = (s: Mycelium3dState, k: number, extra: (i: number) => Record<number, number> = () => ({})) => {
    setOutEach(s, (i) => ({ [OUT.BOND]: 127, ...extra(i) }));
    for (let i = 0; i < k; i++) {
      const j = i % 7 === 3 ? i - 1 : i; // every seventh particle sits exactly on the one before it
      s.x[i] = (3 << POS_SHIFT) + ((j * 97) % 512); s.y[i] = (3 << POS_SHIFT) + ((j * 61) % 512); s.z[i] = (1 << POS_SHIFT) + ((j * 29) % 256);
    }
  };
  const bondsNow = (cpu: Mycelium3dState) => { let b = 0; for (let i = 0; i < cpu.n; i++) b += cpu.bond0![i] !== BOND_NONE ? 1 : 0; return b; };
  return [
    // ---- shapes ----
    lever("bonds: 8x8x4, 40 founders", { width: 8, height: 8, depth: 4, founders: 40, maxParticles: 300, ...B }, DROP, { steps: 600, seg: 50, must: ["births", "deaths"], bonds: ["proposals", "formed", "partnerDied", "letGo"] }, {}),
    lever("bonds: 16x16x8, cost 1", { ...B }, DROP, { steps: 800, must: [...cs, "mutations"], bonds: evolve, walls: true }),
    lever("bonds + children: 13x9x5 odd shape, gradient light, break 300", { width: 13, height: 9, depth: 5, founders: 150, maxParticles: 777, lightPattern: "gradient", ...BC, bondBreak: 300 }, DROP,
      { steps: 700, must: [...cs, "mutations"], bonds: kids }, {}),
    lever("bonds + children: D = 1 (16x16x1)", { width: 16, height: 16, depth: 1, founders: 100, maxParticles: 800, ...BC }, DROP, { steps: 600, bonds: kids }, {}),
    lever("bonds + children: default 32x32x16", { ...BC }, DROP, { steps: 1000, seg: 250, must: [...cs, "mutations"], bonds: kids, walls: true }, {}),
    lever("bonds + children: 32x32x16, sinkShift 6, lightK 64", { ...BC, sinkShift: 6 }, DROP, { steps: 800, seg: 200, must: [...cs, "mutations"], bonds: kids }, {}),
    // ---- with the levers ----
    lever("bonds + children with sinkShift 6, wasteShade 2, toll", { ...BC, sinkShift: 6, wasteShade: 2, moveCost: 12, trailMoveDiscount: 64, trailDiscountMode: "toll" }, DROP, { steps: 600, bonds: kids }),
    lever("bonds + children with owner gate + conduit (gid), sinkShift 4", { ...BC, sinkShift: 4, trailOwner: "gid", ownerDefend: 4, ownerConduit: 64, maxDeposit: 12 }, DROP,
      { steps: 600, bonds: kids, check: claimed }),
    // The largest upkeep: a bond costs about all of a particle's energy, so both ends die together (no survivor sees a partner die).
    lever("bonds, cost 4096, blocked heredity", { bondBreak: 700, bondCost: 4096, heredity: "blocked" }, DROP, { steps: 400, bonds: ["proposals", "formed"] }),
    lever("bonds, break 1 (almost every bond stretches at once), speed 256", { bondBreak: 1, speed: 256 }, DROP, { steps: 400, bonds: ["proposals", "formed", "stretched"] }),
    {
      // Nobody ever wants a bond (BOND -127, frozen): the move is the R0 move and the cost has no upkeep, so it equals the keyless run.
      name: "bonds on, BOND always negative, equals keyless", cfg: defaultConfig({ ...mid, ...B, heredity: "frozen" }), steps: 300, seg: 100, must: ["births", "deaths"],
      tweak: (s) => setOutEach(s, (i) => ({ [OUT.BOND]: -127, [OUT.EAT]: 60 + (i % 5) * 10, [OUT.SPLIT]: 127, [OUT.MX]: (i % 9) * 25 - 100, [OUT.MZ]: (i % 4) * 40 - 60 })),
      vs: { cfg: defaultConfig({ ...mid, heredity: "frozen" }), same: true },
    },
    // ---- contested proposals ----
    {
      // 600 particles in four cells, all wanting a bond, none moving or eating: most proposals go unanswered; duplicates exercise the id tie-break.
      name: "bonds: 600 particles contest in four cells (frozen)", cfg: defaultConfig({ ...mid, ...B, founders: 600, heredity: "frozen", speed: 0, maxEat: 0 }), steps: 40, seg: 1, must: [],
      tweak: (s) => crowd(s, 600), bonds: ["proposals", "formed"],
      check: (cpu) => (bondsNow(cpu) > 200 ? null : `only ${bondsNow(cpu)} bonded particles`),
    },
    {
      // The same crowd moving: one half drifts east, the other west, and some let go (BOND negative on every fifth), so bonds form, stretch and release.
      name: "bonds: a moving contested crowd, break 200 (frozen)", cfg: defaultConfig({ ...mid, bondBreak: 200, founders: 500, heredity: "frozen", maxEat: 0, founderEnergy: 4000 }), steps: 60, seg: 1, must: [],
      tweak: (s) => crowd(s, 500, (i): Record<number, number> => ({ [OUT.MX]: i % 2 ? 90 : -90, [OUT.MZ]: (i % 3) * 50 - 50, [OUT.BOND]: i % 5 === 0 ? -40 : 127 })),
      bonds: ["proposals", "formed", "stretched"],
    },
    // ---- deaths of bonded partners ----
    {
      // Everyone bonds at once, then dies one by one (energies spread, no eating): partners die under bonds still held.
      name: "bonds: bonded partners die one by one (frozen)", cfg: defaultConfig({ ...mid, ...B, founders: 400, heredity: "frozen", maxEat: 0, speed: 64 }), steps: 120, seg: 1, must: ["deaths"],
      tweak: (s) => { crowd(s, 400, (i) => ({ [OUT.MX]: (i % 3) * 40 - 40 })); for (let i = 0; i < s.n; i++) s.E[i] = 30 + ((i * 37) % 600); },
      bonds: ["formed", "partnerDied"],
    },
    // ---- children bonded at birth ----
    {
      // Frozen splitters that want bonds: chains grow at their ends by division; z walls clamp both partners.
      name: "bonds + children: frozen splitters build chains", cfg: defaultConfig({ width: 8, height: 8, depth: 4, founders: 60, maxParticles: 3000, heredity: "frozen", splitEnergy: 0, splitMatter: 2, founderEnergy: 4000, ...BC, bondBreak: 400 }),
      steps: 80, seg: 1, must: ["births", "refused"],
      tweak: (s) => setOutEach(s, (i) => ({ [OUT.EAT]: 127, [OUT.SPLIT]: 127, [OUT.BOND]: 100, [OUT.MZ]: i % 2 ? 127 : -127, [OUT.MX]: (i % 5) * 20 - 40 })),
      bonds: ["childBonds", "formed"],
    },
    {
      name: "bonds + children: cap 257 reached (refused births)", cfg: defaultConfig({ ...mid, founders: 200, maxParticles: 257, ...BC }), steps: 400, seg: 50, must: [...cs, "refused"],
      bonds: ["childBonds", "formed"],
    },
    {
      // The genotype-id limit cuts children after k_compact placed them: k_trim must give the parent its bonds back without the child.
      name: "bonds + children: nextGid 40 below the limit, half the children novel", cfg: defaultConfig({ ...mid, mutRate: 30000, ...BC }), tweak: (s) => { s.nextGid = ID_MAX - 40; },
      steps: 300, seg: 10, must: ["births", "refused", "mutations"], bonds: ["childBonds"],
      check: (s) => (s.nextGid === ID_MAX + 1 ? null : `genotype ids did not run out (nextGid ${s.nextGid})`),
    },
    {
      name: "bonds + children: nextId 15 below the limit", cfg: defaultConfig({ ...mid, ...BC }), tweak: (s) => { s.nextId = 0xfffffff0; },
      steps: 300, seg: 25, must: ["births", "refused"], bonds: ["childBonds"], check: (s) => (s.nextId === ID_MAX + 1 ? null : `ids did not run out (nextId ${s.nextId})`),
    },
    // ---- per step ----
    { name: "per step: bonds + children, 16x16x8", cfg: defaultConfig({ ...mid, ...BC }), steps: 250, seg: 1, must: [...cs], bonds: kids },
    { name: "per step: bonds + children, sinkShift 6, toll, owner gate (gid)", cfg: defaultConfig({ ...mid, ...BC, sinkShift: 6, moveCost: 12, trailMoveDiscount: 64, trailDiscountMode: "toll", trailOwner: "gid", ownerDefend: 8, maxDeposit: 12 }),
      steps: 200, seg: 1, must: [...cs], bonds: kids, check: claimed },
    { name: "per step: bonds, break 128, speed 256, wasteShade 1", cfg: defaultConfig({ ...mid, bondBreak: 128, speed: 256, wasteShade: 1, sinkShift: 5 }), steps: 200, seg: 1, must: [...cs], bonds: evolve },
  ];
}

/**
 * A large volume, a few steps: above 8,388,608 cells (32,768 workgroups of 256) every cell kernel runs on a grid of several
 * rows without forcing it. 512 x 512 x 40 if the device allows, otherwise the deepest 512 x 512 volume that fits.
 */
function largeVolume(): Case {
  const lim = Math.min(dev.limits.maxStorageBufferBindingSize, dev.limits.maxBufferSize);
  const over = { width: 512, height: 512, founders: 30000, maxParticles: 65536, founderMatter: 60, sinkShift: 6, trailOwner: "gid" as const, ownerConduit: 32, maxDeposit: 12 };
  let depth = 40;
  while (depth > 1 && GpuMycelium3d.bufferBytes(defaultConfig({ ...over, depth })) > lim) depth--;
  const cfg = defaultConfig({ ...over, depth });
  const N = 512 * 512 * depth;
  return {
    name: `large volume 512x512x${depth} (${N} cells, ${Math.ceil(Math.ceil(N / 256) / 32768)} grid rows), sinkShift 6, owner conduit`, cfg, steps: 4, seg: 1, must: ["births", "contended"],
    tweak: (s) => clump(s, 2000, 100, 200, 3),
    check: () => (Math.ceil(N / 256) > 32768 ? null : `only ${N} cells fit this device: the cell grid has one row`),
  };
}

async function runCase(c: Case): Promise<Row> {
  const cpu = make(c);
  const gpu = await GpuMycelium3d.create(dev, make(c));
  let cpuMs = 0, gpuMs = 0, note = "", ok = true, bigLight = 0, bigHeat = 0;
  const zMax = (c.cfg.depth << POS_SHIFT) - 1;
  let top = false, floor = false, moved = false;
  const bsum: Record<string, number> = {};
  const z0 = new Map<number, number>();
  for (let i = 0; i < cpu.n; i++) z0.set(cpu.id[i], cpu.z[i] >>> POS_SHIFT);
  // Step 0: the upload itself.
  {
    const d = firstDiff(cpu, await gpu.read());
    if (d) { ok = false; note = `step 0 (upload): ${d}`; }
  }
  for (let done = 0; ok && done < c.steps;) {
    const k = Math.min(c.seg, c.steps - done);
    let t0 = performance.now();
    for (let j = 0; j < k; j++) {
      const st = step(cpu);
      bigLight = Math.max(bigLight, st.lightIn); bigHeat = Math.max(bigHeat, st.heat);
      if (st.bonds) for (const [k, v] of Object.entries(st.bonds)) bsum[k] = (bsum[k] ?? 0) + v;
      if (c.walls) {
        for (let i = 0; i < cpu.n; i++) {
          const z = cpu.z[i];
          if (z === 0) top = true;
          if (z === zMax) floor = true;
          const was = z0.get(cpu.id[i]);
          if (was !== undefined && was !== z >>> POS_SHIFT) moved = true;
        }
      }
    }
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
    }
  }
  const t = cpu.totals;
  if (ok) for (const m of c.must) if (!(t[m] > 0)) { ok = false; note = `case did not exercise ${m}`; }
  if (ok && c.bonds) for (const m of c.bonds) if (!(bsum[m] > 0)) { ok = false; note = `case did not exercise bond event ${m}`; }
  if (ok && c.walls && !(top && floor && moved)) { ok = false; note = `z walls not exercised (surface ${top}, floor ${floor}, layer change ${moved})`; }
  if (ok && c.check) { const bad = c.check(cpu, { lightIn: bigLight, heat: bigHeat }); if (bad) { ok = false; note = bad; } }
  if (ok && c.vs) {
    const base = make({ ...c, cfg: c.vs.cfg }); // same tweak, baseline config
    for (let s = 0; s < c.steps; s++) step(base);
    const d = firstDiff(cpu, base, true);
    if (c.vs.same && d) { ok = false; note = `expected the same dynamics as the baseline config, but ${d}`; }
    if (!c.vs.same && !d) { ok = false; note = "the key changed nothing against its baseline config (vacuous case)"; }
  }
  gpu.destroy();
  return {
    name: c.name, ok, steps: c.steps, n: cpu.n, cpuMs: cpuMs / c.steps, gpuMs: gpuMs / c.steps, digest: stateDigest(cpu), note,
    totals: `births ${t.births} deaths ${t.deaths} refused ${t.refused} contended ${t.contended} mutations ${t.mutations} lightIn ${t.lightIn}` +
      (c.cfg.bondBreak === undefined ? "" : `; bonds ${Object.entries(bsum).map(([k, v]) => `${k} ${v}`).join(" ")}`),
  };
}

/**
 * GPU state read back mid-run, encoded, decoded, uploaded and continued must equal the continuous CPU run: into a fresh
 * object, and over live state on both ping-pong sides (re-uploading the state an object already holds would pass even
 * if the upload were skipped).
 */
async function runResume(over: Partial<Mycelium3dConfig>, label: string): Promise<Row> {
  const cfg = defaultConfig({ ...over });
  const total = 700, cut = 301; // odd cut: the live particle buffer is the second of the ping-pong pair
  const cpu = createWorld(cfg);
  const t0 = performance.now();
  const digests = new Map<number, string>();
  for (let t = 1; t <= total; t++) { step(cpu); if (t === cut || t === cut + 49 || t === cut + 50 || t === 500) digests.set(t, stateDigest(cpu)); }
  const cpuMs = performance.now() - t0;
  const gpuA = await GpuMycelium3d.create(dev, cfg);
  gpuA.step(cut);
  const midState = decode(encode(await gpuA.read())); // decode validates the checkpoint, including both ledgers
  let ok = true, note = "";
  if (stateDigest(midState) !== digests.get(cut)) { ok = false; note = "mid-run readback differs from the CPU at the cut"; }
  const gpuB = await GpuMycelium3d.create(dev, midState);
  const gpuC = await GpuMycelium3d.create(dev, cfg);
  gpuA.step(50); gpuC.step(cut + 49);
  await Promise.all([gpuA.sync(), gpuC.sync()]);
  // A read still waiting when an upload is queued must return the state it was asked for, anchors included. The state uploaded
  // in between has other anchors (extra waste), so anchors read after the await would show.
  const other = createWorld(cfg);
  other.C[0] += 1000; other.matter0 = matterTotal(other); other.energy0 = energyTotal(other);
  for (const [l, g, t] of [["A", gpuA, cut + 50], ["C", gpuC, cut + 49]] as const) {
    const pending = g.read();
    g.upload(other);
    const old = await pending;
    if (stateDigest(old) !== digests.get(t) || old.matter0 === other.matter0) { ok = false; note += `${note ? "; " : ""}read overlapping an upload (${l}) returned digest ${stateDigest(old)} (expected ${digests.get(t)}), matter0 ${old.matter0} (uploaded ${other.matter0})`; }
  }
  gpuA.upload(midState); gpuC.upload(midState);
  const t1 = performance.now();
  for (const g of [gpuA, gpuB, gpuC]) g.step(500 - cut);
  for (const [l, g] of [["over live state, same side", gpuA], ["fresh object", gpuB], ["over live state, other side", gpuC]] as const) {
    if (stateDigest(await g.read()) !== digests.get(500)) { ok = false; note += `${note ? "; " : ""}${l}: differs at step 500`; }
  }
  for (const g of [gpuA, gpuB, gpuC]) g.step(total - 500);
  await Promise.all([gpuA.sync(), gpuB.sync(), gpuC.sync()]);
  const gpuMs = performance.now() - t1;
  for (const [l, g] of [["over live state, same side", gpuA], ["fresh object", gpuB], ["over live state, other side", gpuC]] as const) {
    const s = await g.read();
    const d = firstDiff(cpu, s);
    if (d || stateDigest(cpu) !== stateDigest(s) || validateState(s).length) { ok = false; note += `${note ? "; " : ""}${l}: ${d ?? "digest differs"}`; }
  }
  if (!(cpu.totals.births > 0 && cpu.totals.deaths > 0)) { ok = false; note += " resume case exercised nothing"; }
  if (cfg.trailOwner !== undefined && !cpu.Q!.some((v) => v > 0)) { ok = false; note += " no owned trail at the end"; }
  if (cfg.bondBreak !== undefined && !cpu.bond0!.subarray(0, cpu.n).some((v) => v !== BOND_NONE)) { ok = false; note += " no bond at the end"; }
  gpuA.destroy(); gpuB.destroy(); gpuC.destroy();
  return {
    name: `resume at step ${cut} of ${total}${label}`, ok, steps: total, n: cpu.n, cpuMs: cpuMs / total, gpuMs: gpuMs / (total - cut) / 3, digest: stateDigest(cpu), note,
    totals: `births ${cpu.totals.births} deaths ${cpu.totals.deaths}`,
  };
}

/** The CPU's throws are detected on the GPU: read() raises exactly where step() throws, and accepts the step before. */
async function runGuards(): Promise<Row> {
  const cfg = defaultConfig({ width: 8, height: 8, depth: 4, founders: 40, maxParticles: 300 });
  let ok = true, note = "";
  const fail = (m: string) => { ok = false; note += `${note ? "; " : ""}${m}`; };
  const throws = async (f: () => unknown) => { try { await f(); return false; } catch { return true; } };
  /** Steps a CPU copy and the GPU from `s` once and checks they agree on whether it throws (and, when not, on the state). */
  const both = async (label: string, s: Mycelium3dState, expectThrow: boolean) => {
    const cpu = decode(encode(s));
    const g = await GpuMycelium3d.create(dev, s);
    const cpuThrew = await throws(() => step(cpu));
    g.step(1);
    let gs: Mycelium3dState | null = null;
    try { gs = await g.read(); } catch { /* raised */ }
    if (cpuThrew !== expectThrow) fail(`${label}: CPU threw ${cpuThrew}, expected ${expectThrow}`);
    if ((gs === null) !== cpuThrew) fail(`${label}: GPU raised ${gs === null}, CPU threw ${cpuThrew}`);
    if (gs && !cpuThrew && stateDigest(gs) !== stateDigest(cpu)) fail(`${label}: ${firstDiff(cpu, gs)}`);
    g.destroy();
  };
  const fresh = () => createWorld(cfg);
  // The step counter: 2^53 - 2 steps to 2^53 - 1; from 2^53 - 1 both refuse.
  { const s = fresh(); s.step = STEP_MAX - 1; await both("step 2^53 - 2", s, false); }
  { const s = fresh(); s.step = STEP_MAX; await both("step 2^53 - 1", s, true); }
  // Event counters: exactly at 2^50 - max(cells, cap) steps, one above refuses.
  const room = LEDGER_MAX - Math.max(8 * 8 * 4, 300);
  for (const k of ["births", "deaths", "refused", "contended", "mutations"] as const) {
    { const s = fresh(); s.totals[k] = room; await both(`${k} at the room`, s, false); }
    { const s = fresh(); s.totals[k] = room + 1; await both(`${k} one above the room`, s, true); }
  }
  // The 2^50 ledger: an empty world with 2 waste in cell 0 and light 1 adds 1 to lightIn per step, from 2^50 - 1.
  {
    const lc = defaultConfig({ width: 8, height: 8, depth: 2, founders: 0, nutrient0: 0, eA: 1, light: 1, diffA: 0, diffC: 0, maxParticles: 4 });
    const s = createWorld(lc); s.C[0] = 2; s.totals.lightIn = 2 ** 50 - 1; s.totals.heat = 2 ** 50 - 1; s.matter0 = matterTotal(s); s.energy0 = energyTotal(s);
    const cpu = decode(encode(s));
    const g = await GpuMycelium3d.create(dev, s);
    step(cpu); g.step(1);
    let gs: Mycelium3dState | null = null;
    try { gs = await g.read(); } catch (e) { fail(`ledger exactly 2^50: GPU raised (${(e as Error).message})`); }
    if (cpu.totals.lightIn !== 2 ** 50) fail(`ledger exact bound: CPU lightIn ${cpu.totals.lightIn}`);
    if (gs && stateDigest(gs) !== stateDigest(cpu)) fail(`ledger exact bound: ${firstDiff(cpu, gs)}`);
    const cpuThrew = await throws(() => step(cpu));
    g.step(1);
    const gpuThrew = await throws(() => g.read());
    if (!cpuThrew || !gpuThrew) fail(`ledger one past 2^50: cpu threw ${cpuThrew}, gpu threw ${gpuThrew}`);
    g.destroy();
  }
  // Buffer limits: on a device with the WebGPU default limits (128 MiB per binding) a volume whose field needs more is refused
  // at create, before anything is allocated, with no error scope left open; the same device then runs a world that fits.
  {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    const small = await adapter!.requestDevice();
    const big = defaultConfig({ width: 512, height: 512, depth: 16, founders: 100 });
    const need = GpuMycelium3d.bufferBytes(big), lim = Math.min(small.limits.maxStorageBufferBindingSize, small.limits.maxBufferSize);
    if (!(need > lim)) fail(`limit test: ${need} bytes fit the default device (${lim}); the test needs a bigger volume`);
    let msg = "";
    try { await GpuMycelium3d.create(small, big); } catch (e) { msg = (e as Error).message; }
    if (!msg.includes("exceeds this device's limit")) fail(`oversized volume on a default-limits device: ${msg || "no error"}`);
    if (!await throws(() => small.popErrorScope())) fail("an error scope was left open on the device after the limit rejection");
    const okCfg = defaultConfig({ width: 16, height: 16, depth: 8, founders: 200, maxParticles: 1000 });
    const cpu = createWorld(okCfg);
    const g = await GpuMycelium3d.create(small, okCfg);
    for (let t = 0; t < 30; t++) step(cpu);
    g.step(30);
    const gs = await g.read();
    if (stateDigest(gs) !== stateDigest(cpu)) fail(`default-limits device after a rejection: ${firstDiff(cpu, gs)}`);
    g.destroy();
    small.destroy();
  }
  // A failed upload inside create (a step beyond 2^53 - 1) throws and leaves no error scope open.
  {
    const s = fresh(); s.step = 2 ** 53;
    if (!await throws(() => GpuMycelium3d.create(dev, s))) fail("create from a state at step 2^53 did not throw");
    if (!await throws(() => dev.popErrorScope())) fail("an error scope was left open after a failed create");
  }
  // Uploads refuse a state from another config or a step beyond 2^53 - 1.
  {
    const g = await GpuMycelium3d.create(dev, cfg);
    if (!await throws(() => g.upload(createWorld(defaultConfig({ ...cfg, seed: 2 }))))) fail("upload of another config did not throw");
    const s = fresh(); s.step = 2 ** 53;
    if (!await throws(() => g.upload(s))) fail("upload of step 2^53 did not throw");
    g.destroy();
  }
  return { name: "guards: step 2^53 - 1, counters near 2^50, the 2^50 ledger, buffer limits and error scopes", ok, steps: 0, n: 0, cpuMs: 0, gpuMs: 0, digest: "-", note, totals: "" };
}

/** Steps per second of the GPU engine alone (step + sync, no readback inside the timed part), after a warm-up. */
async function bench(): Promise<void> {
  const lim = Math.min(dev.limits.maxStorageBufferBindingSize, dev.limits.maxBufferSize);
  console.log(`device: maxStorageBufferBindingSize ${dev.limits.maxStorageBufferBindingSize}, maxBufferSize ${dev.limits.maxBufferSize}; ` +
    `the field buffer (14 words per cell, 18 with trailOwner) fits ${Math.floor(lim / 56)} cells (${Math.floor(lim / 72)} with trailOwner)`);
  const worlds: [string, Mycelium3dConfig][] = [
    ["default 32x32x16", defaultConfig()],
    ["64^3, 20,000 founders, cap 32768", defaultConfig({ width: 64, height: 64, depth: 64, founders: 20000, maxParticles: 32768 })],
  ];
  for (const [label, cfg] of worlds) {
    const g = await GpuMycelium3d.create(dev, cfg);
    g.step(200); await g.sync();
    const k = 2000;
    const t0 = performance.now();
    g.step(k); await g.sync();
    const ms = performance.now() - t0;
    const s = await g.read();
    const cpu = createWorld(cfg);
    const c0 = performance.now();
    for (let t = 0; t < 50; t++) step(cpu);
    const cms = (performance.now() - c0) / 50;
    console.log(`${label}: GPU ${(k / (ms / 1000)).toFixed(0)} steps/s (${(ms / k).toFixed(3)} ms/step, live n ${s.n} at step ${s.step}); CPU ${(1000 / cms).toFixed(0)} steps/s over the first 50 steps`);
    g.destroy();
  }
}

if (Deno.args.includes("--bench")) {
  await bench();
  Deno.exit(0);
}

const rows: Row[] = [];
const report = (r: Row) => console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.note ? `\n      ${r.note}` : ""}`);
for (const c of cases) {
  if (only.length && !only.some((s) => c.name.includes(s))) continue;
  rows.push(await runCase(c));
  report(rows.at(-1)!);
}
if (!only.length || only.some((s) => "resume".includes(s))) {
  const variants: [Partial<Mycelium3dConfig>, string][] = [
    [{}, " (default 32x32x16)"],
    [{ sinkShift: 6, trailOwner: "gid", ownerDefend: 24, ownerConduit: 48, maxDeposit: 12 }, ", sinkShift 6 + owner gate and conduit (gid)"],
    [{ sinkShift: 6, wasteShade: 2, trailOwner: "gid", ownerDefend: 2, ownerConduit: 120, maxDeposit: 12 }, ", sinkShift 6 + wasteShade 2 + owner gate and conduit (gid)"],
    [{ sinkShift: 3, moveCost: 12, trailMoveDiscount: 64, trailDiscountMode: "toll", trailConduit: 32, trailConduitCap: 60, trailConduitGhost: 3 }, ", sinkShift 3 + toll + trail conduit ghost"],
    [{ width: 13, height: 9, depth: 5, founders: 150, maxParticles: 777, lightPattern: "gradient", trailOwner: "id", ownerConduit: 64, ownerGhost: 4, maxDeposit: 12 }, ", 13x9x5 owner conduit ghost (id)"],
    [{ sinkShift: 6, bondBreak: 512, bondCost: 1, bondChild: true }, ", sinkShift 6 + bonds + children"],
    [{ sinkShift: 6, wasteShade: 2, bondBreak: 300, moveCost: 12, trailMoveDiscount: 64, trailDiscountMode: "toll" }, ", sinkShift 6 + wasteShade 2 + toll + bonds (break 300)"],
  ];
  for (const [over, label] of variants) {
    rows.push(await runResume(over, label));
    report(rows.at(-1)!);
  }
}
if (!only.length || only.some((s) => "guards".includes(s))) {
  rows.push(await runGuards());
  report(rows.at(-1)!);
}

if (rows.length === 0) {
  console.error(`no case matches ${JSON.stringify(only)}; refusing to report a pass for zero cases`);
  Deno.exit(1);
}

console.log("\ncase".padEnd(70) + "steps".padStart(6) + "  particles" + "  cpu ms/step" + "  gpu ms/step  digest");
for (const r of rows) {
  console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}`.padEnd(69) + String(r.steps).padStart(6) + String(r.n).padStart(11) + r.cpuMs.toFixed(2).padStart(14) + r.gpuMs.toFixed(2).padStart(14) + `  ${r.digest}`);
  if (r.totals) console.log(`      ${r.totals}`);
}
const failed = rows.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} of ${rows.length} cases FAILED` : `\nall ${rows.length} cases match bit for bit`);
Deno.exit(failed ? 1 : 0);
