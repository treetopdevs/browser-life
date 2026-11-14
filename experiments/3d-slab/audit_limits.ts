// Adversarial audit scratch (rung 1b M1/M2): RefSim3 vs GpuSim3 at the arithmetic limits.
// Run: deno run -A --no-lock experiments/3d-slab/audit_limits.ts [scenario-prefix]   (FUZZ=n sets the fuzz count)
import { GpuSim3, requestDevice3 } from "@bl/sim-gpu";
import { RefSim3 } from "@bl/sim-ref";
import {
  CELL_CHANNELS, CH, G, GENOME_CHANNELS3, MATTER_MAX, MAX_STEP, NN_BYTES3, POOL_MAX3, allocState3, cellCount, cloneState, defaultConfig,
  encodeGenome3, generalistGenome3, ledgerResidual, lowbias32, totalsOf, validateState, B2_OFF3,
  type Genome3, type WorldConfig, type WorldState,
} from "@bl/schema";

const only = Deno.args[0] ?? "";
const adapter = await navigator.gpu.requestAdapter();
const results: { name: string; ok: boolean; msg: string }[] = [];
let deviceCache: GPUDevice | null = null;
const dev = async (cfg: WorldConfig) => (deviceCache ??= await requestDevice3(navigator.gpu, cfg));

function rng(seed: number): () => number {
  let s = lowbias32(seed >>> 0);
  return () => (s = lowbias32((s + 0x9e3779b9) >>> 0));
}

const cfgOf = (o: Partial<WorldConfig> = {}): WorldConfig =>
  defaultConfig({ tileW: 8, tileH: 8, tileD: 4, kernelRadius: 3, lightK: 1024, lightMode: "uniform", mutRate: 429_497, eventCap: 1 << 16, ...o });

/** A genome with every reaction output pinned to +127 through B2 (and chosen motility biases). */
function maxGenome(mot = [0, 0, 0], motGain = 255): Genome3 {
  const g = generalistGenome3(154, 24);
  g.motGain = motGain;
  g.weights.fill(0);
  for (let k = 0; k < 6; k++) g.weights[B2_OFF3 + k] = 127;
  for (let k = 0; k < 3; k++) g.weights[B2_OFF3 + 6 + k] = mot[k];
  return g;
}

function setLineage(s: WorldState, i: number, g: Genome3, hi: number, lo: number) {
  const n = cellCount(s.cfg);
  const w = encodeGenome3(g, hi, lo);
  for (let k = 0; k < GENOME_CHANNELS3; k++) s.genome[k * n + i] = w[k];
}

interface Opts { steps?: number; checkLight?: boolean; expectInE?: { cell: number; value: number }; allowThrow?: boolean }

function firstCellDiff(a: WorldState, b: WorldState): string | null {
  const n = cellCount(a.cfg);
  for (let ch = 0; ch < CELL_CHANNELS; ch++)
    for (let i = 0; i < n; i++) if (a.cells[ch * n + i] !== b.cells[ch * n + i]) return `cells ch${ch} cell ${i}: gpu ${a.cells[ch * n + i]} ref ${b.cells[ch * n + i]}`;
  for (let i = 0; i < n; i++) {
    const living = (b.genome[G.LIN_HI * n + i] | b.genome[G.LIN_LO * n + i]) !== 0;
    for (let g = 0; g < GENOME_CHANNELS3; g++) {
      if (g >= 2 && !living) continue;
      if (a.genome[g * n + i] !== b.genome[g * n + i]) return `genome word ${g} cell ${i}: gpu ${a.genome[g * n + i]} ref ${b.genome[g * n + i]}`;
    }
  }
  if (a.lightIn !== b.lightIn) return `lightIn gpu ${a.lightIn} ref ${b.lightIn}`;
  if (a.heatOut !== b.heatOut) return `heatOut gpu ${a.heatOut} ref ${b.heatOut}`;
  for (let k = 0; k < a.flux.length; k++) if (a.flux[k] !== b.flux[k]) return `flux ${k} gpu ${a.flux[k]} ref ${b.flux[k]}`;
  if (a.step !== b.step) return `step gpu ${a.step} ref ${b.step}`;
  return null;
}

async function scenario(name: string, state: WorldState, o: Opts = {}) {
  if (only && !name.startsWith(only)) return;
  const steps = o.steps ?? 4;
  const t0 = performance.now();
  try {
    const errs = validateState(state);
    if (errs.length) throw new Error(`audit state invalid: ${errs.join("; ")}`);
    const cfg = state.cfg;
    const n = cellCount(cfg);
    const start = totalsOf(cfg, state.cells);
    const ref = new RefSim3(cloneState(state));
    const device = await dev(cfg);
    device.pushErrorScope("validation");
    const gpu = await GpuSim3.create(device, cloneState(state));
    const notes: string[] = [];
    // Instrument the CPU transport: totals must be conserved exactly (a u32 wrap would break it) and report the peaks.
    const origT = ref.transport.bind(ref);
    let peakE = 0, peakS = 0, wrapSeen = "";
    (ref as unknown as { transport: () => void }).transport = () => {
      const before = totalsOf(cfg, ref.state.cells);
      const stepNow = ref.state.step;
      origT();
      const after = totalsOf(cfg, ref.state.cells);
      for (const k of ["A", "B", "C", "P", "E", "S"] as const) if (before[k] !== after[k]) wrapSeen += ` transport changed ${k}: ${before[k]} -> ${after[k]};`;
      for (let i = 0; i < n; i++) {
        peakE = Math.max(peakE, ref.state.cells[CH.E * n + i]);
        peakS = Math.max(peakS, ref.state.cells[CH.S * n + i]);
      }
      if (o.expectInE && ref.state.cells[CH.E * n + o.expectInE.cell] !== o.expectInE.value && stepNow === state.step)
        wrapSeen += ` E at target after transport ${ref.state.cells[CH.E * n + o.expectInE.cell]} != ${o.expectInE.value};`;
    };
    let refEvents = 0;
    let bad = "";
    let threw = false;
    for (let s = 1; s <= steps && !bad; s++) {
      try {
        refEvents += ref.step().events.length;
      } catch (e) {
        if (!o.allowThrow) throw e;
        threw = true;
        notes.push(`ref threw at step ${s}: ${(e as Error).message}`);
        let gthrew = false;
        try { gpu.run(1); await gpu.readState(); } catch (e2) { gthrew = true; notes.push(`gpu threw: ${(e2 as Error).message}`); }
        if (!gthrew) bad = "ref threw but gpu did not";
        break;
      }
      gpu.run(1);
      const g = await gpu.readState();
      const d = firstCellDiff(g, ref.state);
      if (d) bad = `step ${s}: ${d}`;
      const tg = totalsOf(cfg, g.cells);
      if (tg.matter !== start.matter) bad ||= `step ${s}: gpu matter ${tg.matter} != ${start.matter}`;
      const tr = totalsOf(cfg, ref.state.cells);
      if (tr.matter !== start.matter) bad ||= `step ${s}: ref matter ${tr.matter} != ${start.matter}`;
      const off = state.heatOut - state.lightIn; // a state may enter with a non-zero ledger imbalance; the step must not change it
      const rg = ledgerResidual(totalsOf(cfg, state.cells), g) - off;
      const rr = ledgerResidual(totalsOf(cfg, state.cells), ref.state) - off;
      if (rg !== 0n) bad ||= `step ${s}: gpu energy residual ${rg}`;
      if (rr !== 0n) bad ||= `step ${s}: ref energy residual ${rr}`;
      if (wrapSeen) bad ||= `step ${s}: ${wrapSeen}`;
      {
        const st = await gpu.readStats();
        const t = totalsOf(cfg, ref.state.cells);
        let living = 0, dense = 0;
        for (let i = 0; i < n; i++) {
          if ((ref.state.genome[G.LIN_HI * n + i] | ref.state.genome[G.LIN_LO * n + i]) !== 0) living++;
          if (ref.state.cells[CH.B * n + i] + ref.state.cells[CH.P * n + i] >= 64) dense++;
        }
        for (const k of ["A", "B", "C", "P", "E", "S"] as const) if (st[k] !== t[k]) bad ||= `step ${s}: readStats ${k} gpu ${st[k]} cpu ${t[k]}`;
        if (st.living !== living) bad ||= `step ${s}: readStats living gpu ${st.living} cpu ${living}`;
        if (st.dense !== dense) bad ||= `step ${s}: readStats dense gpu ${st.dense} cpu ${dense}`;
        const snap = await gpu.readSnapshot(true);
        for (let i = 0; i < n * 2; i++) if (snap.roles![i] !== ref.roles[i]) { bad ||= `step ${s}: roles word ${i} gpu ${snap.roles![i]} ref ${ref.roles[i]}`; break; }
        for (let i = 0; i < n; i++) {
          const lv = (ref.state.genome[G.LIN_HI * n + i] | ref.state.genome[G.LIN_LO * n + i]) !== 0;
          for (let g = 0; g < 4; g++) if ((lv || g < 2) && snap.genomeHead[g * n + i] !== ref.state.genome[g * n + i]) { bad ||= `step ${s}: genomeHead ch ${g} cell ${i}`; break; }
        }
      }
      if (o.checkLight) {
        const lg = await gpu.readLight();
        const lr = ref.lightField;
        for (let i = 0; i < n; i++) if (lg[i] !== lr[i]) { bad ||= `step ${s}: light cell ${i} gpu ${lg[i]} ref ${lr[i]}`; break; }
      }
    }
    const err = await device.popErrorScope();
    if (err) bad ||= `webgpu validation: ${err.message}`;
    if (!bad && !threw) {
      const dl = await gpu.drainLedger();
      if (dl.dropped === 0 && dl.events.length !== refEvents) bad = `event counts gpu ${dl.events.length} ref ${refEvents}`;
      notes.push(`events ${refEvents}`);
    }
    notes.push(`peakE ${peakE} (${(peakE / 2 ** 27).toFixed(2)}x2^27) peakS ${peakS}`);
    gpu.destroy();
    results.push({ name, ok: !bad, msg: bad || `${notes.join("; ")} [${(performance.now() - t0).toFixed(0)} ms]` });
  } catch (e) {
    results.push({ name, ok: false, msg: `EXCEPTION ${(e as Error).stack?.split("\n").slice(0, 3).join(" | ")}` });
  }
  const r = results[results.length - 1];
  console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}: ${r.msg}`);
}

// ---------------------------------------------------------------- A. 27 sources, everything aimed at one target
function storm(over: Partial<WorldConfig>, fillAll: boolean, bp = 1_000_000, target: [number, number, number] = [4, 4, 1]): { state: WorldState; ti: number } {
  const cfg = cfgOf({ spread: 0, dtQ: 0, motility: true, lightBase: 55, lightAmp: 200, diffA: 256, diffC: 256, diffS: 256, ...over });
  const s = allocState3(cfg);
  const n = cellCount(cfg);
  const W = cfg.tileW, H = cfg.tileH;
  s.cells.fill(0x808080, CH.MOT * n, (CH.MOT + 1) * n);
  const [tx, ty, tz] = target;
  const g = maxGenome([0, 0, 0], 255);
  const byte = (o: number) => (o < 0 ? 255 : o > 0 ? 0 : 128); // source at offset o must move by -o
  for (let oz = -1; oz <= 1; oz++) for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    const x = (tx + ox + W) % W, y = (ty + oy + H) % H, z = tz + oz;
    if (z < 0 || z >= cfg.tileD!) continue;
    const i = (z * H + y) * W + x;
    setLineage(s, i, g, 0, 1);
    s.cells[CH.B * n + i] = bp;
    s.cells[CH.P * n + i] = bp;
    s.cells[CH.E * n + i] = POOL_MAX3;
    s.cells[CH.S * n + i] = POOL_MAX3;
    s.cells[CH.MOT * n + i] = (byte(ox) | (byte(oy) << 8) | (byte(oz) << 16)) >>> 0;
  }
  if (fillAll)
    for (let i = 0; i < n; i++) {
      s.cells[CH.E * n + i] = POOL_MAX3;
      s.cells[CH.S * n + i] = POOL_MAX3;
    }
  return { state: s, ti: (tz * H + ty) * W + tx };
}

for (const [label, over] of Object.entries({
  base: {},
  cheapEnergy: { eA: 0, eC: 0, eB: 30, eP: 31, kResp: 4096, kDecomp: 4096, kGrow: 4096, kBuild: 4096, kEmit: 4096, kPhoto: 4096 },
  pricey: { kCost: 65535, kMaint: 65535, kELeak: 65535, kSDecay: 65535, kAbio: 65535, kPDecay: 65535, kBDecay: 65535 },
  lightK1: { lightK: 1 },
  lightK64k: { lightK: 65536 },
  sg127: { signalGain: 127 },
  neutral: { neutral: true },
} as Record<string, Partial<WorldConfig>>)) {
  for (const fillAll of [false, true]) {
    const { state, ti } = storm(over, fillAll);
    await scenario(`A-storm-${label}${fillAll ? "-fill" : ""}`, state, { steps: 5, expectInE: label === "neutral" ? undefined : { cell: ti, value: 27 * POOL_MAX3 } });
  }
}

// literal max: 27 sources x (B + P) = 2^26 matter at the target together with 27 * 2^27 of E
for (const bp of [1_242_756]) {
  const { state, ti } = storm({ kPhoto: 4096, kResp: 4096, eB: 30, eP: 31 }, true, bp);
  await scenario(`A3-storm-maxmatter-bp${bp}`, state, { steps: 5, expectInE: { cell: ti, value: 27 * POOL_MAX3 } });
}

// storms at corners/edges/walls of the slab and across the x/y seam, plus a bigger grid with several workgroups
for (const [lab, tgt, W, H, D, nsrc] of [
  ["corner000", [0, 0, 0], 8, 8, 4, 18], ["corner777-3", [7, 7, 3], 8, 8, 4, 18], ["seam-floor", [7, 0, 3], 8, 8, 4, 18],
  ["wgseam-16x16x8", [8, 8, 4], 16, 16, 8, 27], ["wgseam2-16x16x8", [7, 7, 3], 16, 16, 8, 27],
] as [string, [number, number, number], number, number, number, number][]) {
  const cfg0 = { tileW: W, tileH: H, tileD: D };
  const { state, ti } = storm(cfg0, true, 1_000_000, tgt);
  await scenario(`A2-storm-${lab}`, state, { steps: 4, expectInE: { cell: ti, value: nsrc * POOL_MAX3 } });
}

// ---------------------------------------------------------------- B. matter at the cap
{
  const cfg = cfgOf({ lightBase: 55, lightAmp: 200 });
  for (const split of ["B", "P", "BP", "C", "A"]) {
    const s = allocState3(cfg);
    const n = cellCount(cfg);
    s.cells.fill(0x808080, CH.MOT * n, (CH.MOT + 1) * n);
    const i = (1 * 8 + 4) * 8 + 4;
    setLineage(s, i, maxGenome(), 0, 1);
    const tot = MATTER_MAX;
    if (split === "B") s.cells[CH.B * n + i] = tot;
    if (split === "P") { s.cells[CH.B * n + i] = 1; s.cells[CH.P * n + i] = tot - 1; }
    if (split === "BP") { s.cells[CH.B * n + i] = tot / 2; s.cells[CH.P * n + i] = tot / 2; }
    if (split === "C") { s.cells[CH.B * n + i] = 1000; s.cells[CH.C * n + i] = tot - 1000; }
    if (split === "A") { s.cells[CH.B * n + i] = 1000; s.cells[CH.A * n + i] = tot - 1000; }
    s.cells[CH.E * n + i] = POOL_MAX3;
    s.cells[CH.S * n + i] = POOL_MAX3;
    for (const [lab, over] of [["def", {}], ["eMax", { eA: 0, eC: 0, eB: 30, eP: 31, kResp: 4096, kDecomp: 4096, kGrow: 4096, kBuild: 4096, kPhoto: 4096, kPDecay: 65535, kBDecay: 65535, kAbio: 65535 }]] as const) {
      const c2 = { ...s, cfg: { ...cfg, ...over } } as WorldState;
      await scenario(`B-mattercap-${split}-${lab}`, c2, { steps: 4 });
    }
  }
}

// ---------------------------------------------------------------- C. light
{
  for (const K of [1, 65536, 1024]) {
    const cfg = cfgOf({ lightBase: 55, lightAmp: 200, lightK: K });
    const s = allocState3(cfg);
    const n = cellCount(cfg);
    s.cells.fill(0x808080, CH.MOT * n, (CH.MOT + 1) * n);
    const g = maxGenome();
    const masses = [0, 1, 16382, 16383, 16384, 500_000, 2_000_000, 0];
    for (let x = 0; x < 8; x++) for (let z = 0; z < 3; z++) {
      const i = (z * 8 + 3) * 8 + x;
      setLineage(s, i, g, 0, 1);
      s.cells[CH.B * n + i] = Math.floor(masses[x] / 2);
      s.cells[CH.P * n + i] = masses[x] - Math.floor(masses[x] / 2);
    }
    await scenario(`C-light-K${K}`, s, { steps: 3, checkLight: true });
    const cfg2 = cfgOf({ lightMode: "gradient", lightBase: 0, lightAmp: 200, seasonPeriod: 8_000_000, seasonAmp: 55, lightK: K });
    const s2 = { ...cloneState(s), cfg: cfg2 } as WorldState;
    s2.step = 3_999_999;
    await scenario(`C-light-K${K}-season8e6`, s2, { steps: 3, checkLight: true });
    s2.step = 7_999_998;
    await scenario(`C-light-K${K}-season8e6-wrap`, s2, { steps: 4, checkLight: true });
  }
}

// ---------------------------------------------------------------- D. step counter and ledger limits
{
  const base = storm({ mutRate: 0xffffffff }, false).state;
  for (const [lab, st] of [["maxstep-6", MAX_STEP - 6], ["maxstep-1", MAX_STEP - 1]] as const) {
    const s = cloneState(base);
    s.step = st;
    await scenario(`D-${lab}`, s, { steps: lab === "maxstep-1" ? 2 : 5, allowThrow: true });
  }
  const s = cloneState(base);
  s.lightIn = (1n << 32n) - 5n;
  s.heatOut = (1n << 32n) - 1n;
  s.flux = s.flux.map((_, k) => (1n << 32n) - 3n - BigInt(k));
  await scenario("D-ledger-carry32", s, { steps: 3 });
  const s3 = cloneState(base);
  s3.lightIn = (1n << 63n) - 100n;
  s3.heatOut = (1n << 63n) - 100n;
  await scenario("D-ledger-2^63", s3, { steps: 2, allowThrow: true });
}

// ---------------------------------------------------------------- E. cells against all walls, all outward
{
  for (const [lab, over] of [["def", {}], ["spread32", { spread: 32 }], ["dtQ1024", { dtQ: 1024, thetaMass: 2048, massUnit: 16 }]] as const) {
    const cfg = cfgOf({ lightBase: 55, lightAmp: 200, dtQ: 0, spread: 0, ...over });
    const s = allocState3(cfg);
    const n = cellCount(cfg);
    const W = cfg.tileW, H = cfg.tileH, D = cfg.tileD!;
    s.cells.fill(0x808080, CH.MOT * n, (CH.MOT + 1) * n);
    const g = maxGenome([127, 127, 127], 255);
    for (let z = 0; z < D; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const wall = z === 0 || z === D - 1 || x === 0 || x === W - 1 || y === 0 || y === H - 1;
      if (!wall) continue;
      const i = (z * H + y) * W + x;
      setLineage(s, i, g, 0, 1);
      s.cells[CH.B * n + i] = 5000;
      s.cells[CH.P * n + i] = 5000;
      s.cells[CH.E * n + i] = POOL_MAX3;
      s.cells[CH.S * n + i] = POOL_MAX3;
      const bz = z === 0 ? 0 : z === D - 1 ? 255 : 128;
      const bx = x === 0 ? 0 : x === W - 1 ? 255 : 128;
      const by = y === 0 ? 0 : y === H - 1 ? 255 : 128;
      s.cells[CH.MOT * n + i] = (bx | (by << 8) | (bz << 16)) >>> 0;
    }
    await scenario(`E-walls-${lab}`, s, { steps: 5 });
  }
}

// ---------------------------------------------------------------- F. signal gradient extremes
{
  for (const sg of [1, 127]) {
    const cfg = cfgOf({ lightBase: 55, lightAmp: 200, signalGain: sg, kSDecay: 0, kEmit: 4096, diffS: 0 });
    const s = allocState3(cfg);
    const n = cellCount(cfg);
    const W = cfg.tileW, H = cfg.tileH, D = cfg.tileD!;
    s.cells.fill(0x808080, CH.MOT * n, (CH.MOT + 1) * n);
    const g = generalistGenome3(154, 24);
    g.weights.fill(0);
    for (let j = 0; j < 8; j++) { g.weights[7 * 8 + j] = 127; g.weights[8 * 8 + j] = 127; g.weights[10 * 8 + j] = j & 1 ? -127 : 127; }
    for (let j = 0; j < 8; j++) for (let k = 0; k < 9; k++) g.weights[96 + j * 9 + k] = 127;
    g.motGain = 255;
    for (let z = 0; z < D; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (z * H + y) * W + x;
      setLineage(s, i, g, 0, 1);
      s.cells[CH.B * n + i] = 300;
      s.cells[CH.E * n + i] = 1000;
      s.cells[CH.S * n + i] = (x + y + z) % 2 ? POOL_MAX3 : 0;
      s.cells[CH.A * n + i] = 10;
    }
    await scenario(`F-signal-sg${sg}`, s, { steps: 6 });
    for (let z = 0; z < D; z++) for (let c = 0; c < W * H; c++) s.cells[CH.S * n + z * W * H + c] = z % 2 ? POOL_MAX3 : POOL_MAX3 - 1;
    await scenario(`F-signal-sg${sg}-stripes`, s, { steps: 4 });
    for (let z = 0; z < D; z++) for (let c = 0; c < W * H; c++) s.cells[CH.S * n + z * W * H + c] = z === 0 ? 0 : POOL_MAX3;
    await scenario(`F-signal-sg${sg}-stepwall`, s, { steps: 4 });
  }
}

// ---------------------------------------------------------------- G. fuzz
function fuzzState(seed: number): WorldState {
  const r = rng(seed * 7919 + 13);
  const pick = <T>(a: readonly T[]): T => a[r() % a.length];
  const W = pick([8, 16, 24]), H = pick([8, 16]), D = pick([4, 8, 12]);
  const eB = 1 + (r() % 30), eC = r() % eB, eA = r() % (eC + 1), eP = eB + 1 + (r() % (31 - eB));
  const lb = r() % 100, la = r() % (256 - lb);
  const cfg = defaultConfig({
    tileW: W, tileH: H, tileD: D, kernelRadius: 3, seed: r(),
    eA, eB, eC, eP,
    lightK: pick([1, 2, 64, 1024, 65536, 1 + (r() % 65536)]),
    lightMode: pick(["uniform", "gradient"] as const),
    lightBase: lb, lightAmp: la,
    spread: pick([0, 0, 1, 8, 31, 32]),
    dtQ: pick([0, 51, 255, 1024]),
    thetaMass: pick([1, 64, 512, 2048]),
    massUnit: pick([16, 64, 256, 4096]),
    defaultMu: pick([0, 60, 154, 4095]), defaultSigma: pick([1, 20, 24, 1023]),
    diffA: pick([0, 100, 256]), diffC: pick([0, 200, 256]), diffS: pick([0, 150, 256]),
    gateK: pick([1, 64, 65535]),
    kCatHalf: pick([0, 128, 65535]),
    kPhoto: pick([0, 160, 4096]), kResp: pick([0, 128, 4096]), kDecomp: pick([0, 96, 4096]), kGrow: pick([0, 128, 4096]), kBuild: pick([0, 64, 4096]), kEmit: pick([0, 64, 4096]),
    kCost: pick([0, 64, 65535]), kMaint: pick([0, 200, 65535]), kPDecay: pick([0, 66, 65535]), kBDecay: pick([0, 20, 65535]), kELeak: pick([0, 330, 65535]), kSDecay: pick([0, 1300, 65535]), kAbio: pick([0, 400, 65535]),
    mutRate: pick([0, 429_497, 40_000_000, 0xffffffff]), mutStep: pick([1, 24, 127]),
    eventCap: 1 << 16,
    neutral: r() % 6 === 0, motility: r() % 5 !== 0,
  });
  const sgv = pick([0, 1, 64, 127]);
  if (sgv) cfg.signalGain = sgv;
  if (r() % 3 === 0) { cfg.seasonPeriod = pick([37, 1000, 8_000_000]); cfg.seasonAmp = r() % (256 - lb - la); }
  const s = allocState3(cfg);
  const n = cellCount(cfg);
  s.step = pick([0, 5, 100, 7_999_990, MAX_STEP - 20]);
  s.cells.fill(0x808080, CH.MOT * n, (CH.MOT + 1) * n);
  const lineages: Uint32Array[] = [];
  const nl = 1 + (r() % 5);
  for (let k = 0; k < nl; k++) {
    const g = generalistGenome3(pick([0, 16, 154, 4095, 65535]), pick([0, 1, 24, 1023, 65535]));
    g.motGain = pick([0, 100, 255]);
    const wm = r() % 4;
    for (let b = 0; b < NN_BYTES3; b++) g.weights[b] = wm === 0 ? (r() % 256) - 128 : wm === 1 ? (r() % 2 ? 127 : -128) : wm === 2 ? (r() % 41) - 20 : g.weights[b];
    if (wm === 2) for (let k2 = 0; k2 < 6; k2++) g.weights[B2_OFF3 + k2] = 100 + (r() % 28);
    lineages.push(encodeGenome3(g, k + 1 <= s.step ? k : 0, (r() % (n - 1)) + 1 + 0));
  }
  lineages.forEach((w, k) => { w[G.LIN_LO] = (k * 7 + 1) % n; w[G.LIN_HI] = Math.min(k, s.step); if ((w[G.LIN_HI] | w[G.LIN_LO]) === 0) w[G.LIN_LO] = 1; });
  let budget = MATTER_MAX;
  const density = pick([0.02, 0.2, 0.7, 1]);
  const mode = r() % 5;
  const bigE = () => pick([0, 5, 60000, POOL_MAX3, POOL_MAX3 - 1, POOL_MAX3, 1 << 24, (1 << 24) + 7]);
  for (let i = 0; i < n; i++) {
    const live = (r() % 1000) / 1000 < density;
    if (live) {
      const w = lineages[r() % lineages.length];
      for (let k = 0; k < GENOME_CHANNELS3; k++) s.genome[k * n + i] = w[k];
      const mot = r() % 3;
      s.cells[CH.MOT * n + i] = mot === 0 ? 0x808080 : mot === 1 ? ((r() % 256) | ((r() % 256) << 8) | ((r() % 256) << 16)) >>> 0 : (((r() % 2) * 255) | (((r() % 2) * 255) << 8) | (((r() % 2) * 255) << 16)) >>> 0;
    }
    const per = Math.floor(budget / Math.max(1, n - i));
    const take = (frac: number) => { const v = Math.min(budget, Math.floor(per * frac * (mode === 0 ? 1 : (r() % 1000) / 500))); budget -= v; return v; };
    if (live) {
      s.cells[CH.B * n + i] = take(r() % 2 ? 0.5 : 0.01);
      if (r() % 3 === 0) s.cells[CH.P * n + i] = take(0.3);
    }
    s.cells[CH.A * n + i] = take(0.3 * (r() % 3));
    if (r() % 2) s.cells[CH.C * n + i] = take(0.2);
    s.cells[CH.E * n + i] = r() % 3 === 0 ? bigE() : mode === 4 ? POOL_MAX3 : r() % 100000;
    s.cells[CH.S * n + i] = r() % 3 === 0 ? bigE() : mode === 4 ? (r() % 2 ? POOL_MAX3 : 0) : r() % 100000;
  }
  if (budget > 0) {
    const i = r() % n;
    s.cells[CH.A * n + i] += budget;
  }
  s.lightIn = BigInt(r()) * 12345n;
  s.heatOut = BigInt(r()) * 777n;
  return s;
}

const FUZZ = Number(Deno.env.get("FUZZ") ?? 40);
const FUZZ0 = Number(Deno.env.get("FUZZ0") ?? 1);
for (let seed = FUZZ0; seed < FUZZ0 + FUZZ; seed++) {
  let st: WorldState;
  try { st = fuzzState(seed); } catch (e) { console.log(`fuzz ${seed} build failed: ${(e as Error).message}`); continue; }
  await scenario(`G-fuzz-${seed}`, st, { steps: 5, checkLight: true, allowThrow: true });
}

// ---------------------------------------------------------------- I. event buffer overflow must not change the physics
{
  const { state } = storm({ mutRate: 0xffffffff, eventCap: 1, kPhoto: 4096, lightBase: 55, lightAmp: 200 }, true, 20000);
  await scenario("I-eventcap1-mutmax", state, { steps: 6 });
}

// ---------------------------------------------------------------- H. long and big runs
import { slabSpotsWorld } from "@bl/schema";
if (!only || only.startsWith("H")) {
  const lab = Deno.env.get("HBIG") ? "big" : "";
  void lab;
  for (const [name, W, H, D, steps, over] of [
    ["H-long-64x64x8", 64, 64, 8, 300, { mutRate: 40_000_000, seasonPeriod: 97, seasonAmp: 50, lightBase: 20, lightAmp: 150 }],
    ["H-long-neutral-32x32x12", 32, 32, 12, 300, { neutral: true, kMaint: 100, lightBase: 20, lightAmp: 200 }],
    ["H-big-256x256x8", 256, 256, 8, 6, { mutRate: 4_294_967 }],
  ] as [string, number, number, number, number, Partial<WorldConfig>][]) {
    const cfg = defaultConfig({ tileW: W, tileH: H, tileD: D, lightK: 1024, kernelRadius: 3, seed: 11, mutRate: 4_294_967, lightMode: "gradient", eventCap: 1 << 16, defaultMu: 60, defaultSigma: 20, ...over });
    const st = slabSpotsWorld(cfg, generalistGenome3(60, 20), Math.max(8, (W * H) >> 7), 32, 64);
    await scenario(name, st, { steps, checkLight: false });
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} pass; adapter ${adapter ? "ok" : "none"}`);
for (const f of failed) console.log(`FAILED ${f.name}: ${f.msg}`);
Deno.exit(failed.length ? 1 : 0);
