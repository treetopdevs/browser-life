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

const dev = await myceliumDevice();
const only = Deno.args;

/** First difference between two states over everything the checkpoint encodes, or null. */
function firstDiff(a: MyceliumState, b: MyceliumState): string | null {
  for (const k of ["step", "n", "nextId", "nextGid", "matter0", "energy0"] as const) {
    if (a[k] !== b[k]) return `${k}: cpu ${a[k]} gpu ${b[k]}`;
  }
  for (const k of Object.keys(a.totals) as (keyof MyceliumState["totals"])[]) {
    if (a.totals[k] !== b.totals[k]) return `totals.${k}: cpu ${a.totals[k]} gpu ${b.totals[k]}`;
  }
  for (const k of ["A", "C", "P"] as const) {
    for (let i = 0; i < a[k].length; i++) if (a[k][i] !== b[k][i]) return `${k}[${i}] (x ${i % a.config.width}, y ${Math.floor(i / a.config.width)}): cpu ${a[k][i]} gpu ${b[k][i]}`;
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
    const base = createWorld(c.vs.cfg);
    for (let t = 0; t < c.steps; t++) step(base);
    const d = firstDiff(cpu, base);
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
    for (const bad of [{ physarumDeposit: 100 }, { controller: "physarum" as const, heredity: "frozen" as const, physarumDeposit: 769 }, { blindTrailGradient: 1 as unknown as boolean }]) {
      let threw = false;
      try { createWorld(defaultConfig({ ...smallWorld, ...bad })); } catch { threw = true; }
      if (!threw) fail(`config ${JSON.stringify(bad)} was accepted`);
    }
  }
  return { name: "ledger bound raises like the CPU; genotype-id refusal and steps past 2^32 equal the CPU", ok, steps: 0, n: 0, cpuMs: 0, gpuMs: 0, digest: "-", note, totals: "" };
}

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
