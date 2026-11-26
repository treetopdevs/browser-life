// Browser run of the rung 1a benchmark (same harness and shaders as bench.ts). Result in window.__bench3d.
import { buildKernel, defaultConfig, generalistWorld, G } from "@bl/schema";
import { affinityShader } from "@bl/sim-gpu";
import { affinity3dRef, buildKernel3, makeFill } from "../kernel3d.ts";
import { type Variant, BU, bindWorld, buf, compile, dispatchOnce, getDevice, makeAff3, readU, runInterleaved, timingStats } from "../harness.ts";

const out = document.getElementById("out")!;
const log: string[] = [];
const say = (s: string) => { log.push(s); out.textContent = log.join("\n"); };

async function main() {
  const gpu = (navigator as any).gpu as GPU;
  const { device, env } = await getDevice(gpu);
  say(`adapter ${env.adapter} ts=${env.timestamps} wgStorage=${env.maxComputeWorkgroupStorageSize}`);
  const cfg0 = defaultConfig();
  const MU = cfg0.defaultMu, SG = cfg0.defaultSigma, MASS = cfg0.massUnit;
  const o = (sx: number, sy: number, sz: number, radius: number, split?: number, block = 2, wg: [number, number, number] = [4, 4, 4]) => ({ sx, sy, sz, radius, wg, block, split, massUnit: MASS, defMu: MU, defSigma: SG });
  const correctness: string[] = [];
  for (const [label, R, split] of [["R=3", 3, undefined], ["R=4", 4, undefined], ["R=3 split", 3, 2048], ["R=4 split", 4, 2048]] as const) {
    const fill = makeFill(16 * 16 * 16, 7);
    const v = await makeAff3(device, label, o(16, 16, 16, R, split), fill, env);
    await dispatchOnce(device, v);
    const got = await readU(device, v);
    const want = affinity3dRef(16, 16, 16, buildKernel3(R), fill, MASS, MU, SG);
    let bad = 0; for (let i = 0; i < want.length; i++) if (got[i] !== want[i]) bad++;
    if (bad) throw new Error(`CORRECTNESS FAIL 16^3 ${label}: ${bad} cells differ`);
    correctness.push(`16^3 ${label}: exact`);
  }
  say(correctness.join("; "));

  const cfg2 = defaultConfig({ tileW: 256, tileH: 256, seed: 42 });
  const w2 = generalistWorld(cfg2, 12);
  const n2 = 65536;
  const pipe2 = await compile(device, affinityShader(cfg2), "2D");
  const c2 = buf(device, w2.cells.byteLength, BU.STORAGE | BU.COPY_DST, "c");
  const g2 = buf(device, w2.genome.byteLength, BU.STORAGE | BU.COPY_DST, "g");
  const U2 = buf(device, n2 * 4, BU.STORAGE, "U");
  device.queue.writeBuffer(c2, 0, w2.cells as BufferSource);
  device.queue.writeBuffer(g2, 0, w2.genome as BufferSource);
  void G; void buildKernel;
  const v2: Variant = { name: "2D R=9 256^2 (affinityShader isolated)", taps: 224, cells: n2, pipeline: pipe2, bind: bindWorld(device, pipe2, { cells: c2, genome: g2, U: U2 }), dispatch: [16, 16, 1] };

  const fill64 = makeFill(64 ** 3, 11, true), fillSlab = makeFill(256 * 256 * 8, 13, true);
  const vs: Variant[] = [v2];
  vs.push(await makeAff3(device, "3D 64^3 R=4 single", o(64, 64, 64, 4), fill64, env));
  vs.push(await makeAff3(device, "3D 64^3 R=4 split", o(64, 64, 64, 4, 2048), fill64, env));
  vs.push(await makeAff3(device, "3D 64^3 R=3 single", o(64, 64, 64, 3), fill64, env));
  vs.push(await makeAff3(device, "3D 64^3 R=3 split", o(64, 64, 64, 3, 2048), fill64, env));
  vs.push(await makeAff3(device, "3D slab R=3 single", o(256, 256, 8, 3), fillSlab, env));
  vs.push(await makeAff3(device, "3D slab R=3 split", o(256, 256, 8, 3, 2048), fillSlab, env));
  vs.push(await makeAff3(device, "3D slab R=4 single", o(256, 256, 8, 4), fillSlab, env));
  vs.push(await makeAff3(device, "3D slab R=4 split", o(256, 256, 8, 4, 2048), fillSlab, env));
  vs.push(await makeAff3(device, "abl 64^3 R=3 wg8,8,4 b1", o(64, 64, 64, 3, undefined, 1, [8, 8, 4]), fill64, env));
  vs.push(await makeAff3(device, "abl 64^3 R=4 wg4 b1", o(64, 64, 64, 4, undefined, 1), fill64, env));

  // tuning sweep: other workgroup/block shapes of the same design (each verified at 32^3 against the CPU loop first)
  const sweepCfgs: Array<[number, [number, number, number], number]> = [];
  for (const R of [3, 4]) for (const wg of [[8, 4, 4], [8, 8, 4], [8, 8, 2], [16, 4, 4], [16, 8, 2], [8, 8, 8]] as Array<[number, number, number]>) sweepCfgs.push([R, wg, 1]);
  sweepCfgs.push([4, [8, 4, 2], 2], [3, [8, 4, 2], 2]);
  for (const [R, wg, b] of sweepCfgs) {
    const label = `sweep R=${R} wg${wg.join(",")} b${b}`;
    try {
      const f = makeFill(32 ** 3, 5);
      const sp = wg[0] * wg[1] * wg[2] >= 512 ? 2048 : undefined;
      const cv = await makeAff3(device, label, o(32, 32, 32, R, sp, b, wg), f, env);
      await dispatchOnce(device, cv);
      const got = await readU(device, cv);
      const want = affinity3dRef(32, 32, 32, buildKernel3(R), f, MASS, MU, SG);
      let bad = 0; for (let i = 0; i < want.length; i++) if (got[i] !== want[i]) bad++;
      if (bad) throw new Error(`CORRECTNESS FAIL ${label}: ${bad} cells differ`);
      correctness.push(`${label}: 32^3 exact`);
      vs.push(await makeAff3(device, label, o(64, 64, 64, R, sp, b, wg), fill64, env));
    } catch (e) { correctness.push(`${label}: skipped ${String(e).slice(0, 80)}`); }
  }
  // empty-shader probe of the per-declaration workgroup memory cost (512 workgroups)
  const probe = async (name: string, parts: number): Promise<Variant> => {
    const per = 4096 / parts;
    const decl = Array.from({ length: parts }, (_, k) => `var<workgroup> sm${k}: array<u32, ${per}>;`).join("\n");
    const code = `${decl}
@group(0) @binding(0) var<storage, read_write> o: array<u32>;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) w: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  ${Array.from({ length: parts }, (_, k) => `sm${k}[li] = li;`).join(" ")}
  workgroupBarrier();
  o[w.x * 64u + li] = ${Array.from({ length: parts }, (_, k) => `sm${k}[(li + 1u) % 64u]`).join(" + ")};
}`;
    const pipeline = await compile(device, code, name);
    const o = buf(device, 4096 * 64 * 4, BU.STORAGE, "o");
    return { name, taps: 0, cells: 1, pipeline, bind: device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: o } }] }), dispatch: [512, 1, 1] };
  };
  vs.push(await probe("probe empty 16KB x1 decl", 1), await probe("probe empty 16KB x2 decl", 2));

  const results: Record<string, any> = {};
  for (const method of (env.timestamps ? ["timestamp", "wall"] : ["wall"]) as Array<"timestamp" | "wall">) {
    say(`timing ${method}`);
    const iters = method === "wall" ? 100 : 100;
    let res = await runInterleaved(device, vs, 15, iters, method, 50, 150);
    if (res.some((r) => r.spread > 1.15)) { say(`spread > 15% on ${res.filter((r) => r.spread > 1.15).map((r) => r.name).join(", ")}: rerun with 30 trials`); res = await runInterleaved(device, vs, 30, iters, method, 50, 150); }
    results[method] = res.map((r) => ({ trials: r.trials, name: r.name, medUs: r.med / 1e3, p10Us: r.p10 / 1e3, p90Us: r.p90 / 1e3, spread: r.spread, gtaps: r.gtaps, taps: r.taps, cells: r.cells }));
    const t2 = res[0].med;
    for (const r of results[method]) r.ratio = (r.medUs * 1e3) / t2;
    say(JSON.stringify(results[method].map((r: any) => `${r.name}: ${r.medUs.toFixed(1)}us x${r.ratio.toFixed(2)}`), null, 1));
  }
  (window as any).__bench3d = { timing: { ...timingStats, fallbackNames: [...timingStats.fallbackNames] }, env, correctness, results, ua: navigator.userAgent };
  say("DONE");
}
main().catch((e) => { say("ERROR " + e + "\n" + (e?.stack ?? "")); (window as any).__bench3d = { error: String(e) }; });
