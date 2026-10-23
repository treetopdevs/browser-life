// Rung 1a (throwaway): 3D affinity benchmark vs today's 2D affinity pass.
// deno run -A --no-lock experiments/3d-bench/bench.ts [--trials=15] [--iters=200] [--json=out.json] [--skip-ablations]
import { buildKernel, defaultConfig, generalistWorld, GENOME_CHANNELS, G } from "@bl/schema";
import { affinityShader, GpuSim } from "@bl/sim-gpu";
import { assertKernels, affinity3dRef, buildKernel3, makeFill } from "./kernel3d.ts";
import { affinity3dShader } from "./shader3d.ts";
import {
  type Env, type Result, type Variant, bindWorld, buf, BU, compile, dispatchOnce, getDevice, makeAff3, makeTransport27, makeWorldBuffers,
  median, readU, runInterleaved, summarise, timeVariant, timingStats, validateTimestamps,
} from "./harness.ts";

const arg = (k: string, d: string) => (Deno.args.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split("=")[1];
const TRIALS = Number(arg("trials", "15")), ITERS = Number(arg("iters", "200"));
const JSON_OUT = arg("json", ""), SKIP_ABL = Deno.args.includes("--skip-ablations");

const us = (ns: number) => (ns / 1e3).toFixed(1);
const kinfo = assertKernels(buildKernel);
console.log("kernel asserts ok:", JSON.stringify(kinfo));

const { device, env } = await getDevice(navigator.gpu);
device.addEventListener?.("uncapturederror", (e: any) => { console.error("GPU error", e.error?.message); });
console.log("adapter:", env.adapter, "| timestamps:", env.timestamps, "| wg storage:", env.maxComputeWorkgroupStorageSize, "| max invocations:", env.maxComputeInvocationsPerWorkgroup);

// ---------- correctness: GPU vs CPU loop, bit for bit ----------
const cfg0 = defaultConfig();
const MU = cfg0.defaultMu, SG = cfg0.defaultSigma, MASS = cfg0.massUnit;
const correctness: string[] = [];
async function check(label: string, sx: number, sy: number, sz: number, R: number, wg: [number, number, number], block: number, split?: number) {
  const fill = makeFill(sx * sy * sz, 7);
  const v = await makeAff3(device, label, { sx, sy, sz, radius: R, wg, block, split, massUnit: MASS, defMu: MU, defSigma: SG }, fill, env);
  await dispatchOnce(device, v);
  const got = await readU(device, v);
  const want = affinity3dRef(sx, sy, sz, buildKernel3(R), fill, MASS, MU, SG);
  let bad = 0;
  for (let i = 0; i < want.length; i++) if (got[i] !== want[i]) bad++;
  const distinct = new Set(want).size;
  if (bad) throw new Error(`CORRECTNESS FAIL ${label}: ${bad}/${want.length} cells differ`);
  correctness.push(`${label}: ${want.length} cells exact (${distinct} distinct U values)`);
}
await check("16^3 R=3 wg4 b2", 16, 16, 16, 3, [4, 4, 4], 2);
await check("16^3 R=3 wg4 b2 split", 16, 16, 16, 3, [4, 4, 4], 2, 2048);
await check("16^3 R=4 wg4 b2 split", 16, 16, 16, 4, [4, 4, 4], 2, 2048);
await check("16x16x8 R=3 wg4 b2 split", 16, 16, 8, 3, [4, 4, 4], 2, 2048);
await check("16x16x8 R=4 wg4 b2 split", 16, 16, 8, 4, [4, 4, 4], 2, 2048);
await check("32^3 R=4 wg4 b2 split", 32, 32, 32, 4, [4, 4, 4], 2, 2048);
await check("32^3 R=3 wg4 b2 split4", 32, 32, 32, 3, [4, 4, 4], 2, 700);
await check("16^3 R=4 wg4 b2", 16, 16, 16, 4, [4, 4, 4], 2);
await check("16x16x8 R=3 wg4 b2", 16, 16, 8, 3, [4, 4, 4], 2);
await check("16x16x8 R=4 wg4 b2", 16, 16, 8, 4, [4, 4, 4], 2);
await check("16^3 R=3 wg4 b1", 16, 16, 16, 3, [4, 4, 4], 1);
await check("16x16x8 R=3 wg8,8,4 b1", 16, 16, 8, 3, [8, 8, 4], 1);
// A larger grid, still cheap on the CPU: 32^3 R=4
await check("32^3 R=4 wg4 b2", 32, 32, 32, 4, [4, 4, 4], 2);
console.log(correctness.join("\n"));

// ---------- 2D baselines ----------
const cfg2 = defaultConfig({ tileW: 256, tileH: 256, seed: 42 });
if (cfg2.kernelRadius !== 9) throw new Error("expected R=9");
const world2 = generalistWorld(cfg2, 12);
const n2 = 256 * 256;
const k2 = buildKernel(9);
if (k2.count !== 224) throw new Error("2D taps != 224");

// Method B: the unmodified affinityShader on its own buffers.
async function make2dB(name: string, allAlive: boolean): Promise<Variant> {
  const pipeline = await compile(device, affinityShader(cfg2), name);
  const cells = buf(device, world2.cells.byteLength, BU.STORAGE | BU.COPY_DST, "c2");
  const gen = world2.genome.slice();
  if (allAlive) {
    gen.fill(1, G.LIN_LO * n2, (G.LIN_LO + 1) * n2);
    gen.fill((cfg2.defaultMu | (cfg2.defaultSigma << 16)) >>> 0, G.PARAM0 * n2, (G.PARAM0 + 1) * n2);
  }
  const genome = buf(device, gen.byteLength, BU.STORAGE | BU.COPY_DST, "g2");
  const U = buf(device, n2 * 4, BU.STORAGE | BU.COPY_SRC, "U2");
  device.queue.writeBuffer(cells, 0, world2.cells as BufferSource);
  device.queue.writeBuffer(genome, 0, gen as BufferSource);
  return { name, taps: 224, cells: n2, pipeline, bind: bindWorld(device, pipeline, { cells, genome, U }), uBuf: U, dispatch: [16, 16, 1], note: "affinityShader(cfg) unmodified, isolated" };
}
const v2B = await make2dB("2D R=9 256^2 (B isolated, generalist)", false);
const v2Ball = await make2dB("2D R=9 256^2 (B isolated, all alive)", true);
const alive = (() => { let c = 0; for (let i = 0; i < n2; i++) if ((world2.genome[G.LIN_HI * n2 + i] | world2.genome[G.LIN_LO * n2 + i]) !== 0) c++; return c; })();
console.log(`2D generalist world: ${alive}/${n2} cells with lineage`);

// Method A: the real GpuSim, affinity timestamp pair of every step.
let simSet: GPUQuerySet | null = null;
const simRes = buf(device, 400 * 8, BU.QUERY_RESOLVE | BU.COPY_SRC, "r");
const simRd = buf(device, 400 * 8, BU.MAP_READ | BU.COPY_DST, "rd");
const deviceSet = (cnt: number) => (simSet ??= device.createQuerySet({ type: "timestamp", count: 400 }));
const transportSamples: number[] = [];
const allPassSamples: number[][] = [[], [], [], [], []];
let v2A: Variant | null = null;
if (env.timestamps) {
  const sim = await GpuSim.create(device, world2);
  sim.run(200);
  await device.queue.onSubmittedWorkDone();
  v2A = {
    name: "2D R=9 256^2 (A real GpuSim pass)", taps: 224, cells: n2, dispatch: [16, 16, 1], note: "profile hook pair 0 of 5 in a live step",
    custom: async (total: number) => {
      // Metal cannot allocate counter sample buffers for ~1000 passes in one submission: chunks of 40 steps.
      const out: number[] = [];
      for (let done = 0; done < total; done += 40) out.push(...(await chunk(Math.min(40, total - done))));
      return out;
    },
  };
  async function chunk(steps: number): Promise<number[]> {
    {
      const cnt = steps * 10;
      const set = deviceSet(cnt);
      sim.profile = { set, next: 0 };
      const enc = device.createCommandEncoder();
      for (let s = 0; s < steps; s++) sim.encodeStep(enc);
      sim.profile = null;
      const res = simRes, rd = simRd;
      enc.resolveQuerySet(set, 0, cnt, res, 0);
      enc.copyBufferToBuffer(res, 0, rd, 0, cnt * 8);
      device.queue.submit([enc.finish()]);
      await rd.mapAsync(1);
      const t = new BigUint64Array(rd.getMappedRange().slice(0, cnt * 8));
      const out: number[] = [];
      // Only the passes this benchmark reads (affinity k=0, transport k=2) must be valid. On the M3 Pro, Metal
      // occasionally stamps a zero duration on one of the other three short passes; count those, do not abort.
      for (const k of [0, 2]) validateTimestamps(`real GpuSim pass ${k} samples`, Array.from({ length: steps }, (_, s) => t[(s * 5 + k) * 2 + 1] - t[(s * 5 + k) * 2]));
      for (const k of [1, 3, 4]) for (let s = 0; s < steps; s++) if (!(t[(s * 5 + k) * 2 + 1] > t[(s * 5 + k) * 2])) timingStats.droppedSamples++;
      for (let s = 0; s < steps; s++) {
        for (let k = 0; k < 5; k++) allPassSamples[k].push(Number(t[(s * 5 + k) * 2 + 1] - t[(s * 5 + k) * 2]));
        out.push(Number(t[s * 10 + 1] - t[s * 10]));
        transportSamples.push(Number(t[(s * 5 + 2) * 2 + 1] - t[(s * 5 + 2) * 2]));
      }
      rd.unmap();
      return out;
    }
  }
}

// ---------- 3D variants ----------
const fill64 = makeFill(64 ** 3, 11, true);          // all cells take the genome branch (slow side)
const fillSlab = makeFill(256 * 256 * 8, 13, true);
const o = (sx: number, sy: number, sz: number, radius: number, block = 2, wg: [number, number, number] = [4, 4, 4]) => ({ sx, sy, sz, radius, wg, block, massUnit: MASS, defMu: MU, defSigma: SG });
const SPLIT = 2048; // words per workgroup declaration, below the wgpu/Metal cliff (see results.md)
const v3R4s = await makeAff3(device, "3D 64^3 R=4 split", { ...o(64, 64, 64, 4), split: SPLIT }, fill64, env);
const v3R3s = await makeAff3(device, "3D 64^3 R=3 split", { ...o(64, 64, 64, 3), split: SPLIT }, fill64, env);
const vSlR3s = await makeAff3(device, "3D slab 256x256x8 R=3 split", { ...o(256, 256, 8, 3), split: SPLIT }, fillSlab, env);
const vSlR4s = await makeAff3(device, "3D slab 256x256x8 R=4 split", { ...o(256, 256, 8, 4), split: SPLIT }, fillSlab, env);
const v3R4 = await makeAff3(device, "3D 64^3 R=4", o(64, 64, 64, 4), fill64, env);
const v3R3 = await makeAff3(device, "3D 64^3 R=3", o(64, 64, 64, 3), fill64, env);
const vSlR3 = await makeAff3(device, "3D slab 256x256x8 R=3", o(256, 256, 8, 3), fillSlab, env);
const vSlR4 = await makeAff3(device, "3D slab 256x256x8 R=4", o(256, 256, 8, 4), fillSlab, env);
const vT27 = await makeTransport27(device, "27-source transport stub 64^3", 64, 64, 64);

const primary = [...(v2A ? [v2A] : []), v2B, v2Ball, v3R4, v3R3, vSlR3, vSlR4, v3R4s, v3R3s, vSlR3s, vSlR4s, vT27];
for (const v of primary) console.log(`variant: ${v.name}${v.note ? ` [${v.note}]` : ""}`);


// ---------- tuning sweep (--sweep-only): other tile/workgroup shapes of the same design, same T2 ----------
/** PLAN.md:41 — T2 is the real pass A, unless A and B disagree by more than ~10%; then B. */
function pickT2(a: number | undefined, b: number): number {
  return a !== undefined && Math.abs(b / a - 1) <= 0.10 ? a : b;
}

if (Deno.args.includes("--sweep-only") || Deno.args.includes("--sweep")) {
  const cfgs: Array<[number, [number, number, number], number]> = [];
  for (const R of [3, 4]) for (const [wg, b] of [[[4, 4, 4], 1], [[8, 4, 4], 1], [[8, 8, 4], 1], [[8, 8, 2], 1], [[16, 4, 4], 1], [[16, 8, 2], 1], [[16, 16, 1], 1], [[4, 4, 4], 2], [[8, 4, 2], 2], [[8, 8, 8], 1]] as Array<[[number, number, number], number]>) cfgs.push([R, wg, b]);
  const sv: Variant[] = [];
  const skipped: string[] = [];
  for (const [R, wg, b] of cfgs) {
    const label = `R=${R} wg${wg.join("x")} b${b}`;
    try {
      const sp = wg[0] * wg[1] * wg[2] >= 512 ? SPLIT : undefined; // 8x8x8 tiles are over the single-declaration cliff
      await check(`sweep 32^3 ${label}${sp ? " split" : ""}`, 32, 32, 32, R, wg, b, sp);
      sv.push(await makeAff3(device, `sweep 64^3 ${label}${sp ? " split" : ""}`, { ...o(64, 64, 64, R, b, wg), split: sp }, fill64, env));
    } catch (e) { skipped.push(`${label}: ${String(e).slice(0, 90)}`); }
  }
  console.log("sweep skipped:", skipped);
  const sres = await runInterleaved(device, [...(v2A ? [v2A, v2B] : [v2B]), ...sv], TRIALS, ITERS, env.timestamps ? "timestamp" : "wall");
  const sA = v2A ? sres[0].med : undefined, sB = sres[v2A ? 1 : 0].med;
  const base = pickT2(sA, sB);
  console.log("sweep T2 =", us(base), "us", sA !== undefined ? `(A ${us(sA)}, B ${us(sB)}, using ${base === sA ? "A" : "B"} by the 10% rule)` : "(B)");
  sres.splice(0, v2A ? 2 : 1);
  console.log("| variant | tile B | median us | p90/p10 | Gtap/s | ratio vs T2 | predicted bar |");
  console.log("|---|---|---|---|---|---|---|");
  for (const r of sres) console.log(`| ${r.name} | ${sv.find((v) => v.name === r.name)!.note} | ${us(r.med)} | ${r.spread.toFixed(2)} | ${r.gtaps.toFixed(1)} | ${(r.med / base).toFixed(2)} | ${((r.taps * r.cells) / (224 * 65536)).toFixed(2)} |`);
  if (Deno.args.includes("--sweep-only")) Deno.exit(0);
}
const method = env.timestamps ? "timestamp" : "wall";
async function runAll(vs: Variant[], trials: number, m: typeof method) {
  let res = await runInterleaved(device, vs, trials, ITERS, m);
  const wide = res.filter((r) => r.spread > 1.15);
  if (wide.length && trials < 30) {
    console.log(`spread > 15% on ${wide.map((w) => w.name).join(", ")}: rerun with 30 trials`);
    res = await runInterleaved(device, vs, 30, ITERS, m);
  }
  return res;
}
console.log(`\ntiming method: ${method}, trials ${TRIALS}, iters ${ITERS}`);
const res = await runAll(primary, TRIALS, method);

// Wall-clock cross-check (always): same variants minus the custom hook.
const wallVs = primary.filter((v) => !v.custom);
const wall = await runInterleaved(device, wallVs, Math.max(5, Math.min(TRIALS, 7)), ITERS, "wall");

const by = new Map(res.map((r) => [r.name, r]));
const wallBy = new Map(wall.map((r) => [r.name, r]));
const t2A = v2A ? by.get(v2A.name)!.med : undefined;
const t2 = pickT2(t2A, by.get(v2B.name)!.med);
const t2Label = t2 === t2A ? "A real pass" : t2A !== undefined ? "B isolated: A and B disagree by more than 10%" : "B isolated";
const predicted = (r: Result) => (r.taps * r.cells) / (224 * 65536);

function table(rs: Result[], ref: number, extra?: Map<string, Result>) {
  const rows = ["| variant | taps | cells | median us | min | p10 | p90 | p90/p10 | Gtap/s | ratio vs T2 | predicted | wall-clock us (ratio) |", "|---|---|---|---|---|---|---|---|---|---|---|---|"];
  for (const r of rs) {
    const w = extra?.get(r.name);
    rows.push(`| ${r.name} | ${r.taps} | ${r.cells} | ${us(r.med)} | ${us(r.min)} | ${us(r.p10)} | ${us(r.p90)} | ${r.spread.toFixed(2)} | ${r.gtaps.toFixed(1)} | ${(r.med / ref).toFixed(2)} | ${predicted(r).toFixed(2)} | ${w ? `${us(w.med)} (${(w.med / (wallBy.get(v2B.name)!.med)).toFixed(2)} vs B)` : ""} |`);
  }
  return rows.join("\n");
}
console.log("\n" + table(res, t2, wallBy));

// ---------- verdict by the fixed pass rule ----------
const R = (v: Variant) => by.get(v.name)!.med / t2;
function judge(label: string, vs: [Variant, Variant, Variant, Variant]) {
  const rule = [
    { id: "64^3 R=4", ratio: R(vs[0]), bar: 4.5 },
    { id: "64^3 R=3", ratio: R(vs[1]), bar: 1.6 },
    { id: "slab R=3", ratio: R(vs[2]), bar: 3.3 },
    { id: "slab R=4", ratio: R(vs[3]), bar: 8.9 },
  ];
  const passing = rule.filter((r) => r.ratio <= r.bar);
  const verdict = passing.length ? (passing[0].id === "64^3 R=4" ? "PASS" : `PASS via fallback ${passing[0].id}`) : "STOP";
  console.log(`\n[${label}] T2 = ${us(t2)} us (${t2Label})`);
  for (const r of rule) console.log(`${r.id}: ratio ${r.ratio.toFixed(2)} vs bar ${r.bar} -> ${r.ratio <= r.bar ? "pass" : "fail"} (margin ${(100 * (r.bar / r.ratio - 1)).toFixed(0)}%)`);
  console.log(`VERDICT [${label}]: ${verdict}`);
  return { rule, verdict };
}
const single = judge("single declaration", [v3R4, v3R3, vSlR3, vSlR4]);
const split = judge("split declarations", [v3R4s, v3R3s, vSlR3s, vSlR4s]);
const rule = [...single.rule, ...split.rule];
const verdict = `single: ${single.verdict}; split: ${split.verdict}`;
if (v2A) {
  const a = t2A!, b = by.get(v2B.name)!.med;
  console.log(`A vs B: ${us(a)} vs ${us(b)} us, B/A = ${(b / a).toFixed(3)} (cross-check bar 10%; T2 = ${t2 === a ? "A" : "B"})`);
  const names = ["affinity", "flow", "transport", "react", "tick"];
  console.log("real 2D pass medians (us):", names.map((n, k) => `${n} ${us(median(allPassSamples[k]))}`).join("  "));
  const t27 = by.get(vT27.name)!.med, tr = median(transportSamples);
  console.log(`27-source stub 64^3 ${us(t27)} us vs real 2D transport 256^2 ${us(tr)} us: ratio ${(t27 / tr).toFixed(2)} (cell ratio 4.0)`);
}

// ---------- ablations: only on fail or near miss (within 15% of any bar) ----------
let ablations: Result[] = [];
const near = split.rule.some((r) => r.ratio > r.bar * 0.85 && r.ratio < r.bar * 1.15);
if (!SKIP_ABL && (split.verdict === "STOP" || near || Deno.args.includes("--ablations"))) {
  console.log("\nablations (fail or near miss)");
  const A = (name: string, opt: Parameters<typeof o>, extra: object = {}) => makeAff3(device, name, { ...o(...opt), split: SPLIT, ...extra }, fill64, env);
  const vs: Variant[] = [v3R4s, v3R3s];
  vs.push(await A("abl 64^3 R=4 split halo-only", [64, 64, 64, 4], { haloOnly: true }));
  vs.push(await A("abl 64^3 R=3 split halo-only", [64, 64, 64, 3], { haloOnly: true }));
  vs.push(await A("abl 64^3 R=4 split 1024w (4 decl)", [64, 64, 64, 4], { split: 1024 }));
  vs.push(await A("abl 64^3 R=4 split 512w (8 decl)", [64, 64, 64, 4], { split: 512 }));
  vs.push(await A("abl 64^3 R=4 block1 wg4", [64, 64, 64, 4, 1]));
  vs.push(await A("abl 64^3 R=3 block1 wg4", [64, 64, 64, 3, 1]));
  vs.push(await A("abl 64^3 R=4 wg8,8,4 block1 (256 thr)", [64, 64, 64, 4, 1, [8, 8, 4]]));
  vs.push(await A("abl 64^3 R=3 wg8,8,4 block1 (256 thr)", [64, 64, 64, 3, 1, [8, 8, 4]]));
  vs.push(v3R4, v3R3); // single-declaration versions, same run
  ablations = await runInterleaved(device, vs.filter(Boolean), TRIALS, ITERS, method);
  console.log(table(ablations, t2));
}

console.log("timing validity:", JSON.stringify({ ...timingStats, fallbackNames: [...timingStats.fallbackNames] }));
const out = { timing: { ...timingStats, fallbackNames: [...timingStats.fallbackNames] }, env, kernel: kinfo, correctness, method, trials: TRIALS, iters: ITERS, t2_ns: t2, verdict, rule, results: res, wall, ablations,
  realPass2d: v2A ? Object.fromEntries(["affinity", "flow", "transport", "react", "tick"].map((n, k) => [n, median(allPassSamples[k])])) : null };
if (JSON_OUT) await Deno.writeTextFile(JSON_OUT, JSON.stringify(out, (_, v) => (typeof v === "bigint" ? v.toString() : v), 1));
Deno.exit(0);
