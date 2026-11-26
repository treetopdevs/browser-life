// Step A3 of the 3D plan (docs/3d-expansion-plan-2026-11-15.md, Phase 1): a screen of the slab levers of step A2 in the
// 64-cube jar. Exploration, judged by eye (tools/volume-capture contact sheet) plus descriptive numbers: no gate, no
// pass/fail. The arms are in jar-levers-arms.ts. Every arm starts from the jar light screen's baseline (jar-screen.ts: slab-spots, 64^3, nutrient 24, mu 50,
// sigma 8, lightK 4096, uniform light 240) and adds one thing (docs/rules.md, "Optional slab levers"):
//
//   base      the baseline
//   surface   founders' z in 0..7 (InitParams.surface 8), x and y as the baseline
//   sink      sinkShift 6: 1/64 of a cell's waste sinks one layer per step
//   floor     sinkShift 6 + floorDecay 1024: floor waste decays to nutrient at 1/64 per step
//   upwell    upwellPeriod 500, upwellShift 2: every 500 steps a quarter of A and C swaps with the mirror layer
//   all       surface + sink + floor + upwell
//   rps       the vacancy kill, K 3, rate 64, rpsMin 16, rpsMutate 32768 (half of mutation events change a type or a
//             beats-mask), founders typed in the cycle 0 > 1 > 2 > 0 (InitParams.rpsCycle 3)
//
// Every 1,000 steps: living, mutation events (drained; dropped checked), and three turnovers over the 1,000 steps: id turnover
// (living cells whose lineage id differs from the cell's id 1,000 steps earlier, over living cells; mutation alone moves it),
// occupancy turnover (cells that became living or stopped living, over living cells) and lineage turnover (lineage ids
// present now and absent 1,000 steps earlier, over the ids present now). At the end: living, activity, light, mass,
// A and C by 8-layer group, the lineage count, the P histogram, the enclosure census at four shell thresholds, RPS
// type counts, and a side view. Matter and energy are checked exactly at the end; a failure exits 1.
//
// Run: deno run -A --no-lock experiments/3d-slab/jar-levers.ts [--steps=30000] [--seeds=101,102] [--only=base,sink]
//      [--shard=0/2] [--out=runs/jar-levers-screen]
import { GpuSim3, requestDevice3 } from "@bl/sim-gpu";
import { enclosureCensus3 } from "@bl/metrics";
import { CH, G, RULE_VERSION, cellCount, initWorld, ledgerResidual, totalsOf } from "@bl/schema";
import { JAR_ARMS, jarArmConfig, jarArmInit } from "./jar-levers-arms.ts";

const arg = (k: string) => Deno.args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);

// Shell thresholds: the baseline's P never reaches 64 in a cell (its P histogram tops out at 32..63), so the low ones matter.
const SHELLS = [1, 4, 16, 64];
const GROUPS = 8;

if (import.meta.main) {
  const OUT = arg("out") ?? "runs/jar-levers-screen";
  const steps = Number(arg("steps") ?? 30_000);
  if (!Number.isSafeInteger(steps) || steps < 1000 || steps % 1000 !== 0) throw new Error(`--steps must be a positive multiple of 1000 (the run proceeds in 1,000-step batches), got ${arg("steps")}`);
  const seeds = (arg("seeds") ?? "101,102").split(",").map(Number);
  const only = arg("only")?.split(",");
  const [shard, shards] = (arg("shard") ?? "0/1").split("/").map(Number);
  Deno.mkdirSync(OUT, { recursive: true });
  const adapter = await navigator.gpu.requestAdapter();
  const info = (adapter as unknown as { info?: { description?: string } }).info;
  const loadavg = () => { try { return Deno.loadavg().map((x) => +x.toFixed(0)); } catch { return null; } };
  const jobs = Object.keys(JAR_ARMS).filter((a) => !only || only.includes(a)).flatMap((arm) => seeds.map((seed) => ({ arm, seed, id: `${arm}-seed${seed}` })));
  let device: GPUDevice | null = null;
  for (const [k, j] of jobs.entries()) {
    if (k % shards !== shard) continue;
    const file = `${OUT}/${j.id}.json`;
    let prior: { requestedSteps?: number; cfg?: unknown; init?: unknown; matterOk?: boolean; energyResidual?: string } | null = null;
    try { prior = JSON.parse(Deno.readTextFileSync(file)); } catch { /* not run yet */ }
    if (prior) {
      const same = prior.requestedSteps === steps && JSON.stringify(prior.cfg) === JSON.stringify(jarArmConfig(j.arm, j.seed)) &&
        JSON.stringify(prior.init) === JSON.stringify(jarArmInit(j.arm)) && prior.matterOk === true && prior.energyResidual === "0";
      if (!same) throw new Error(`${file} exists with different steps, config or init, or did not conserve: move it or use another --out`);
      console.log(`${j.id}: exists (same settings), skipped`);
      continue;
    }
    const cfg = jarArmConfig(j.arm, j.seed);
    const init = jarArmInit(j.arm);
    const state = initWorld(cfg, init);
    const start = totalsOf(cfg, state.cells);
    device ??= await requestDevice3(navigator.gpu, cfg);
    const sim = await GpuSim3.create(device, state);
    const n = cellCount(cfg), D = cfg.tileD!, plane = n / D, per = D / GROUPS;
    const living1k: number[] = [], events1k: number[] = [], turnover1k: number[] = [], occupancy1k: number[] = [], lineageTurn1k: number[] = [], lineages5k: number[] = [], types5k: number[][] = [];
    let prevIds = new Set<number>();
    let prevHi = new Uint32Array(n), prevLo = new Uint32Array(n);
    let dropped = 0;
    const t0 = performance.now();
    for (let s = 0; s < steps; s += 1000) {
      for (let b = 0; b < 1000; b += 100) sim.run(100);
      const led = await sim.drainLedger();
      dropped += led.dropped;
      events1k.push(led.events.length + led.dropped);
      const snap = await sim.readSnapshot(false);
      const hi = snap.genomeHead.slice(G.LIN_HI * n, (G.LIN_HI + 1) * n), lo = snap.genomeHead.slice(G.LIN_LO * n, (G.LIN_LO + 1) * n);
      let live = 0, changed = 0, flips = 0;
      const ids = new Set<number>();
      const types = [0, 0, 0];
      for (let i = 0; i < n; i++) {
        const was = (prevHi[i] | prevLo[i]) !== 0;
        if ((hi[i] | lo[i]) === 0) { if (was) flips++; continue; }
        live++;
        if (!was) flips++;
        if (hi[i] !== prevHi[i] || lo[i] !== prevLo[i]) changed++;
        ids.add(hi[i] * 16777216 + lo[i]);
        if (cfg.rpsTypes !== undefined) types[(snap.genomeHead[G.PARAM1 * n + i] >>> 8) & 3]++;
      }
      living1k.push(live);
      turnover1k.push(live ? +(changed / live).toFixed(4) : 0);
      occupancy1k.push(live ? +(flips / live).toFixed(4) : 0);
      let fresh = 0;
      for (const id of ids) if (!prevIds.has(id)) fresh++;
      lineageTurn1k.push(ids.size ? +(fresh / ids.size).toFixed(4) : 0);
      prevIds = ids;
      if ((s + 1000) % 5000 === 0) { lineages5k.push(ids.size); if (cfg.rpsTypes !== undefined) types5k.push(types); }
      prevHi = hi; prevLo = lo;
      if (live === 0) break;
    }
    const sec = (performance.now() - t0) / 1000;
    // End of run: per-group numbers, enclosure census, P histogram, side view.
    const [L, roles, snap] = [await sim.readLight(), await sim.readRoles(), await sim.readSnapshot(false)];
    const end = await sim.readState();
    sim.destroy();
    const zeros = () => new Array(GROUPS).fill(0);
    const living = zeros(), activity = zeros(), light = zeros(), mass = zeros(), A = zeros(), C = zeros(), P = zeros();
    const side = new Array(cfg.tileW * D).fill(0);
    const pHist = new Array(16).fill(0); // log2 bins of P over cells with P > 0
    const ids = new Set<number>();
    for (let i = 0; i < n; i++) {
      const z = Math.floor(i / plane), g = Math.floor(z / per);
      const hi = snap.genomeHead[G.LIN_HI * n + i], lo = snap.genomeHead[G.LIN_LO * n + i];
      if (hi | lo) { living[g]++; ids.add(hi * 16777216 + lo); }
      const w0 = roles[2 * i], w1 = roles[2 * i + 1];
      activity[g] += (w0 & 0xffff) + (w0 >>> 16) + (w1 & 0xffff) + (w1 >>> 16);
      light[g] += L[i];
      const p = snap.cells[CH.P * n + i];
      mass[g] += snap.cells[CH.B * n + i] + p;
      A[g] += snap.cells[CH.A * n + i];
      C[g] += snap.cells[CH.C * n + i];
      P[g] += p;
      if (p > 0) pHist[Math.min(15, 31 - Math.clz32(p))]++;
      side[z * cfg.tileW + (i % cfg.tileW)] += snap.cells[CH.B * n + i] + p;
    }
    const cells = plane * per;
    const enclosure = Object.fromEntries(SHELLS.map((s) => [s, enclosureCensus3({ cfg, cells: snap.cells, genomeHead: snap.genomeHead }, { shell: s })]));
    const residual = ledgerResidual(start, end);
    const matterOk = BigInt(totalsOf(cfg, end.cells).matter) === BigInt(start.matter);
    const mean10 = (a: number[]) => (a.length ? +(a.slice(-10).reduce((x, y) => x + y, 0) / a.slice(-10).length).toFixed(4) : null);
    const last10 = turnover1k.slice(-10);
    const res = {
      ...j, ruleVersion: RULE_VERSION, cfg, init, requestedSteps: steps, step: end.step,
      livingFrac: living.reduce((a, b) => a + b, 0) / n,
      livingPct: living.map((v) => +(100 * v / cells).toFixed(1)),
      activityPct: activity.map((v) => +(100 * v / Math.max(1, activity.reduce((a, b) => a + b, 0))).toFixed(1)),
      activityTotal: activity.reduce((a, b) => a + b, 0),
      light: light.map((v) => +(v / cells).toFixed(1)),
      mass: mass.map((v) => +(v / cells).toFixed(1)), A: A.map((v) => +(v / cells).toFixed(2)), C: C.map((v) => +(v / cells).toFixed(2)), P: P.map((v) => +(v / cells).toFixed(2)),
      lineages: ids.size, lineages5k, turnoverLast10k: last10.length ? +(last10.reduce((a, b) => a + b, 0) / last10.length).toFixed(4) : null,
      occupancyLast10k: mean10(occupancy1k), lineageTurnLast10k: mean10(lineageTurn1k),
      living1k, events1k, turnover1k, occupancy1k, lineageTurn1k, dropped, types5k, pHist, enclosure, side,
      matterOk, energyResidual: String(residual), seconds: +sec.toFixed(1), stepsPerSec: +(end.step / sec).toFixed(1), loadavg: loadavg(), device: info?.description ?? "unknown",
    };
    Deno.writeTextFileSync(file, JSON.stringify(res) + "\n");
    const e4 = enclosure[4];
    console.log(`${j.id}: living ${(100 * res.livingFrac).toFixed(1)}% by group ${res.livingPct.join("/")} lineages ${ids.size} turnover id/occ/lin ${res.turnoverLast10k}/${res.occupancyLast10k}/${res.lineageTurnLast10k} enclosures@4 ${e4.enclosures} (${e4.enclosedBiomass}) ${res.stepsPerSec} steps/s${matterOk && residual === 0n ? "" : " CONSERVATION FAILURE"}`);
    if (!matterOk || residual !== 0n) Deno.exit(1);
  }
  console.log("screen done");
}
