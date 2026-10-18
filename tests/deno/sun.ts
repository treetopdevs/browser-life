// The sun (kind "sun", @bl/schema's sun.ts, docs/garden-sun-2026-10-18.md) on a real native WebGPU device. The vitest files
// (packages/schema/test/sun.test.ts, packages/sim-ref/test/sun.test.ts, packages/runner/test/sun.test.ts) check the rule, SunRefSim
// and the runner's loop on a CPU stand-in; this script is the part only a GPU can show:
//
//  1. parity: GpuSim.setLight against SunRefSim at equal steps on a 48 x 48 sweep world with a wandering sun, a season and mutation
//     on, a span starting off a census step (137) and ending at 337: the state hash equal at the start, the middle, the end and 50
//     steps after; a GpuSim created on the sun config (the derived-config oracle) equal in cells, genome and ledger; sim.cfg and
//     readState().cfg the world's own throughout; matter and the energy residual exact; and not vacuous (a clean run differs);
//  2. segments: runExperiment continuous against runs cut at a sun's step, inside its span and at its end (both on the census grid),
//     with a second sun that ends off the grid: the same final state hash and artifact digest, the logs concatenating, the observers
//     carrying the open span, and stitchRun rebuilding the continuous bundle;
//  1b. the same parity on 32 x 32 worlds of every light mode at every percent each takes; setLight's refusals (an invalid light,
//     after destroy); and a static guard that only the react shader reads light, the assumption the pipeline swap rests on;
//  3. refusals: a start observer whose sun disagrees with the schedule, and a sun the world cannot take, before any GPU work;
//  4. tools/run.ts --sun as a subprocess: the API runner's digest and interventions.jsonl, and the exit-2 refusals.
//
// Run from the repo root: deno run -A --no-lock tests/deno/sun.ts
import { PRESETS, SUN_PERCENTS, cloneState, initWorld, stateHash, sunConfig, sunError, sunLight, totalsOf, type WorldState } from "@bl/schema";
import { GpuSim, affinityShader, flowShader, lesionShader, prelude, reactShader, requestDevice, statsShader, tickShader, transportShader } from "@bl/sim-gpu";
import { SunRefSim } from "@bl/sim-ref";
import {
  BUNDLE_FILES,
  INTERVENTIONS_FILE,
  runExperiment,
  specConfig,
  stitchRun,
  type ObserverState,
  type RunSpec,
  type ScheduledIntervention,
  type Sink,
  type StitchSegment,
} from "@bl/runner";

class Mem implements Sink {
  files = new Map<string, string>();
  bytes = new Map<string, Uint8Array>();
  async writeText(p: string, t: string) { this.files.set(p, t); }
  async appendText(p: string, t: string) { this.files.set(p, (this.files.get(p) ?? "") + t); }
  async writeBytes(p: string, b: Uint8Array) { this.bytes.set(p, b); }
}

let ok = true;
let checks = 0, failures = 0;
const check = (name: string, cond: boolean, detail = "") => {
  checks++;
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail && !cond ? `: ${detail.slice(0, 600)}` : ""}`);
  ok &&= cond;
};
async function section(title: string, body: () => Promise<void>) {
  const t = performance.now();
  console.log(`-- ${title}`);
  try {
    await body();
  } catch (e) {
    check(`${title}: finished without an exception`, false, e instanceof Error ? (e.stack ?? e.message) : String(e));
  }
  console.log(`   [${title.split(".")[0]}: ${((performance.now() - t) / 1000).toFixed(1)} s]`);
}

const host = { host: "test", adapter: "test" };
const noop = () => {};
const ROOT = new URL("../../", import.meta.url).pathname;
const DENO_JSON = `${ROOT}deno.json`;
const RUN_TS = `${ROOT}tools/run.ts`;
const T0 = performance.now();
const sun = (step: number, percent: number, span: number): ScheduledIntervention => ({ step, kind: "sun", percent, span });

type RunOpts = NonNullable<Parameters<typeof runExperiment>[5]>;
async function run(device: GPUDevice, spec: RunSpec, opts: RunOpts = {}) {
  const mem = new Mem();
  const r = await runExperiment(device, spec, mem, host, noop, { keepFinal: true, ...opts });
  return { summary: r.summary, final: r.final!, observer: r.observer, mem, manifest: JSON.parse(mem.files.get("manifest.json")!), log: mem.files.get(INTERVENTIONS_FILE) };
}
async function advance(sim: GpuSim, device: GPUDevice, steps: number) {
  for (let k = steps; k > 0; k -= 64) sim.run(Math.min(64, k));
  await device.queue.onSubmittedWorkDone();
}
const sameArr = (a: Uint32Array, b: Uint32Array) => a.length === b.length && a.every((v, i) => v === b[i]);

// A 48 x 48 even-light world turned into a sweep with a wandering sun and a season: every term of the light is live, and the
// CPU reference steps it in milliseconds. eA 1 so the energy ledger sees nutrient.
const spots = PRESETS.find((p) => p.id === "spots")!;
const SMALL = { tileW: 48, tileH: 48, kernelRadius: 6, eA: 1, lightMode: "sweep" as const, lightBase: 20, lightAmp: 170, dayPeriod: 0, wanderPeriod: 640, wanderAmp: 40, seasonPeriod: 400, seasonAmp: 60 };
const small: RunSpec = { experiment: "sun-small", presetId: "spots", condition: "treatment", seed: 3, steps: 600, censusEvery: 100, deepEvery: 5, checkpointEvery: 0, overrides: SMALL };
const cfg = specConfig(small);
const init = initWorld(cfg, spots.init);
const dev = await requestDevice(navigator.gpu, cfg);

await section("1. parity: GpuSim.setLight against SunRefSim", async () => {
  const L = sunLight(cfg, 50);
  const ref = new SunRefSim(cloneState(init));
  const gpu = await GpuSim.create(dev, cloneState(init));
  const clean = await GpuSim.create(dev, cloneState(init));
  try {
    const t0 = totalsOf(cfg, init.cells);
    const baseline = t0.energy + init.heatOut - init.lightIn;
    const at = async (step: number, tag: string) => {
      ref.run(step - ref.state.step);
      await advance(gpu, dev, step - gpu.step);
      const g = await gpu.readState();
      check(`1. t=${step} (${tag}): GPU state hash equals SunRefSim's`, stateHash(g) === stateHash(ref.state), `${stateHash(g)} vs ${stateHash(ref.state)}`);
      check(`1. t=${step}: sim.cfg and readState().cfg are the world's own`, JSON.stringify(gpu.cfg) === JSON.stringify(cfg) && JSON.stringify(g.cfg) === JSON.stringify(cfg));
      const tt = totalsOf(cfg, g.cells);
      check(`1. t=${step}: matter equal and the energy residual exactly 0`, tt.matter === t0.matter && tt.energy + g.heatOut - g.lightIn - baseline === 0n, `${tt.matter} vs ${t0.matter}`);
      return g;
    };
    const start = await at(137, "the sun's step, off the census grid");
    ref.setLightNow(L);
    await gpu.setLight(L);
    check("1. activeLight is the sun's on both", JSON.stringify(gpu.activeLight) === JSON.stringify(L) && JSON.stringify(ref.activeLight) === JSON.stringify(L));
    const mid = await at(237, "mid-span");
    // The derived-config oracle: a GpuSim built on the sun config itself, from the same state at 137, run to 237.
    const oracle = await GpuSim.create(dev, { ...cloneState(start), cfg: sunConfig(cfg, 50) });
    try {
      await advance(oracle, dev, 100);
      const o = await oracle.readState();
      check("1. the derived-config oracle (GpuSim.create on the sun config) has equal cells, genome and ledger at 237", sameArr(o.cells, mid.cells) && sameArr(o.genome, mid.genome) && o.lightIn === mid.lightIn && o.heatOut === mid.heatOut && o.flux.every((f, k) => f === mid.flux[k]));
    } finally {
      oracle.destroy();
    }
    await at(300, "a census step inside the span");
    await at(337, "its end");
    ref.setLightNow(null);
    await gpu.setLight(null);
    check("1. activeLight is null after the end", gpu.activeLight === null && ref.activeLight === null);
    const end = await at(387, "50 steps after its end");
    await advance(clean, dev, 387);
    const c = await clean.readState();
    check("1. not vacuous: a clean run differs in state and absorbs more light", stateHash(c) !== stateHash(end) && c.lightIn > end.lightIn, `${c.lightIn} vs ${end.lightIn}`);
  } finally {
    gpu.destroy();
    clean.destroy();
  }
});

await section("1b. parity in every light mode, at every percent its light takes; setLight's refusals; only react reads light", async () => {
  // 32 x 32 worlds of each mode: the sun set at 5, compared at 25 (inside it) and at 35 after it ends at 30.
  const modes = [
    { lightMode: "sweep" as const, lightBase: 20, lightAmp: 170, dayPeriod: 50, seasonPeriod: 40, seasonAmp: 60 },
    { lightMode: "uniform" as const, lightBase: 40, lightAmp: 160 },
    { lightMode: "gradient" as const, lightBase: 20, lightAmp: 220 },
    { lightMode: "patches" as const, lightBase: 40, lightAmp: 160, seasonPeriod: 40, seasonAmp: 20 },
  ];
  const seen: string[] = [];
  for (const m of modes) {
    const c = specConfig({ ...small, overrides: { tileW: 32, tileH: 32, kernelRadius: 4, eA: 1, ...m } });
    const w = initWorld(c, spots.init);
    for (const pct of SUN_PERCENTS.filter((p) => sunError(c, p) === null)) {
      seen.push(`${m.lightMode} ${pct}`);
      const ref = new SunRefSim(cloneState(w));
      const gpu = await GpuSim.create(dev, cloneState(w));
      try {
        ref.run(5);
        await advance(gpu, dev, 5);
        ref.setLightNow(sunLight(c, pct));
        await gpu.setLight(sunLight(c, pct));
        ref.run(20);
        await advance(gpu, dev, 20);
        const mid = await gpu.readState();
        const refMid = stateHash(ref.state);
        ref.setLightNow(null);
        await gpu.setLight(null);
        ref.run(10);
        await advance(gpu, dev, 10);
        const end = await gpu.readState();
        check(`1b. ${m.lightMode} at ${pct}%: GPU equals SunRefSim inside the span (t=25)`, stateHash(mid) === refMid, `${stateHash(mid)} vs ${refMid}`);
        check(`1b. ${m.lightMode} at ${pct}%: GPU equals SunRefSim after it (t=35)`, stateHash(end) === stateHash(ref.state), `${stateHash(end)} vs ${stateHash(ref.state)}`);
      } finally {
        gpu.destroy();
      }
    }
  }
  check("1b. every mode ran at each percent its light takes", seen.join() === "sweep 50,sweep 75,uniform 50,uniform 75,uniform 125,gradient 50,gradient 75,patches 50,patches 75", seen.join());
  const s = await GpuSim.create(dev, cloneState(init));
  let refused = "";
  try {
    await s.setLight({ lightBase: 200, lightAmp: 200, seasonAmp: 0 });
  } catch (e) {
    refused = (e as Error).message;
  }
  check("1b. setLight refuses a light that is no valid config's", /a sun's light must make a valid config/.test(refused), refused);
  s.destroy();
  let gone = "";
  try {
    await s.setLight(sunLight(cfg, 50));
  } catch (e) {
    gone = (e as Error).message;
  }
  check("1b. setLight after destroy() throws", gone === "GpuSim destroyed", gone);
  // Only the react pass may read light: GpuSim.setLight swaps that pipeline alone. Every shader carries the prelude (its light
  // constants and light_at), so a call of light_at or a light constant outside the prelude anywhere but react breaks the swap.
  const pre = prelude(cfg);
  const uses = (src: string) => {
    const body = src.replace(pre, "");
    return { calls: (body.match(/\blight_at\(/g) ?? []).length, consts: (body.match(/\b(LIGHT_BASE|LIGHT_AMP|SEASON_AMP)\b/g) ?? []).length };
  };
  const shaders: Record<string, string> = { affinity: affinityShader(cfg), flow: flowShader(cfg), transport: transportShader(cfg), tick: tickShader(), lesion: lesionShader(cfg), stats: statsShader(cfg) };
  for (const [name, src] of Object.entries(shaders)) {
    const u = uses(src);
    check(`1b. the ${name} shader reads no light (no light_at call, no light constant outside the prelude)`, u.calls === 0 && u.consts === 0, JSON.stringify(u));
  }
  const react = reactShader(cfg);
  check("1b. the react shader carries the prelude and calls light_at", react.includes(pre) && uses(react).calls > 0 && uses(react).consts === 0, JSON.stringify(uses(react)));
});

// Sun A at 200 for 200 steps (its step and end on the census grid), sun B at 450 for 70 (ending off the grid, at 520).
const schedule: ScheduledIntervention[] = [sun(200, 75, 200), { step: 250, kind: "lesion", x: 24, y: 24, r: 5 }, sun(450, 50, 70)];
const scheduled: RunSpec = { ...small, interventions: schedule };
const whole = await run(dev, scheduled);

await section("2. segments: cut at a sun's step, inside its span and at its end", async () => {
  const clean = await run(dev, { ...small, interventions: [schedule[1]] });
  check("2. the continuous run: 3 log lines, conservation exact, and not the clean run", whole.manifest.interventions?.applied === 3 && whole.summary.conservationOk && stateHash(clean.final) !== stateHash(whole.final));
  check("2. ...the continuous log is the start lines only", whole.log === '{"step":200,"kind":"sun","percent":75,"span":200}\n{"step":250,"kind":"lesion","x":24,"y":24,"r":5}\n{"step":450,"kind":"sun","percent":50,"span":70}\n', whole.log);
  const cuts = [0, 200, 300, 400, 500, 600];
  let state: WorldState | undefined, observer: ObserverState | undefined;
  const segs: StitchSegment[] = [];
  const logs: string[] = [];
  for (let k = 0; k + 1 < cuts.length; k++) {
    const from = cuts[k], to = cuts[k + 1];
    const r = await run(dev, { ...scheduled, steps: to - from }, state ? { start: state, observer } : {});
    state = r.final;
    observer = r.observer;
    logs.push(r.log ?? "");
    segs.push({ index: k, startStep: from, steps: to - from, digest: r.summary.finalHash, files: Object.fromEntries(r.mem.files) });
    const want = to === 200 || to === 300 ? { step: 200, percent: 75, span: 200 } : to === 500 ? { step: 450, percent: 50, span: 70 } : undefined;
    check(`2. the observer at t=${to} carries ${want ? `the open span from t=${want.step}` : "no sun"}`, JSON.stringify(observer.sun) === JSON.stringify(want), JSON.stringify(observer.sun));
  }
  check("2. the last segment's final state hash is the continuous run's", stateHash(state!) === stateHash(whole.final), `${stateHash(state!)} vs ${stateHash(whole.final)}`);
  check("2. ...and its artifact digest", segs[segs.length - 1].digest === whole.summary.finalHash, `${segs[segs.length - 1].digest} vs ${whole.summary.finalHash}`);
  check("2. ...the segments' logs concatenate to the continuous log", logs.join("") === whole.log, logs.join("|"));
  let stitched: Record<string, string> | undefined;
  try {
    stitched = stitchRun([...segs].reverse(), small.steps);
  } catch (e) {
    check("2. stitchRun accepts the five segments", false, e instanceof Error ? e.message : String(e));
  }
  if (stitched) {
    const differing = [...BUNDLE_FILES.filter((f) => f !== "manifest.json"), INTERVENTIONS_FILE].filter((f) => stitched![f] !== whole.mem.files.get(f));
    check(`2. stitchRun rebuilds the continuous bundle byte for byte, ${INTERVENTIONS_FILE} included`, differing.length === 0, differing.join(", "));
  }
});

await section("3. refusals", async () => {
  const a = await run(dev, { ...scheduled, steps: 300 });
  const reject = async (spec: RunSpec, opts: RunOpts, device: GPUDevice = dev) => {
    try {
      await runExperiment(device, spec, new Mem(), host, noop, opts);
      return "";
    } catch (e) {
      return (e as Error).message;
    }
  };
  const other = [sun(200, 50, 200), schedule[1], schedule[2]];
  const msg = await reject({ ...scheduled, steps: 100, interventions: other }, { start: a.final, observer: a.observer }, {} as GPUDevice);
  check("3. a start observer under another sun than the schedule's is refused before the GPU", /^the start checkpoint was taken under another sun than this schedule's/.test(msg), msg);
  const bright = await reject({ ...scheduled, interventions: [sun(200, 125, 50)] }, {}, {} as GPUDevice);
  check("3. a sun the world cannot take (125% of 20 + 170 + 60) is sunError's refusal, before the GPU", /cannot take a sun of 125%/.test(bright), bright);
});

// ---- 4. tools/run.ts --sun on the full spots preset (even light 40 + 160: it takes 50, 75 and 125).
const decode = (b: Uint8Array) => new TextDecoder().decode(b);
async function cli(args: string[]): Promise<{ code: number; text: string }> {
  const o = await new Deno.Command(Deno.execPath(), { args: ["run", "--no-lock", "-A", "--config", DENO_JSON, RUN_TS, ...args], cwd: ROOT, stdin: "null", stdout: "piped", stderr: "piped" }).output();
  return { code: o.code, text: decode(o.stdout) + decode(o.stderr) };
}
const tmp = await Deno.makeTempDir({ prefix: "sun-" });
try {
  await section("4. through tools/run.ts", async () => {
    const full: RunSpec = { experiment: "sun-cli", presetId: "spots", condition: "treatment", seed: 3, steps: 300, censusEvery: 100, deepEvery: 5, checkpointEvery: 0 };
    const fullCfg = specConfig(full);
    const devFull = await requestDevice(navigator.gpu, fullCfg);
    const sched = [sun(100, 50, 100), sun(200, 125, 50)];
    const api = await run(devFull, { ...full, interventions: sched });
    const common = (exp: string) => ["--experiment", exp, "--preset", "spots", "--conditions", "treatment", "--seeds", "3", "--steps", "300", "--census", "100", "--deep", "5", "--out", tmp];
    const res = await cli([...common("sun-cli"), "--sun", "200:125,50", "--sun", "100:50,100"]);
    const dir = `${tmp}/sun-cli/spots/treatment/seed-3`;
    const manifest = await Deno.readTextFile(`${dir}/manifest.json`).then(JSON.parse).catch(() => null);
    check("4. --sun runs (exit 0) and gives the API runner's artifact digest", res.code === 0 && manifest?.summary?.finalHash === api.summary.finalHash, `exit ${res.code}: ${res.text.slice(-400)}`);
    check("4. ...its interventions.jsonl is the API run's, sorted by step", (await Deno.readTextFile(`${dir}/${INTERVENTIONS_FILE}`).catch(() => null)) === api.log);
    let refusals = 0;
    const refused = async (tag: string, args: string[], re: RegExp) => {
      const r = await cli([...common(`sun-refused-${++refusals}`), ...args]);
      check(`4. refused with exit 2: ${tag}`, r.code === 2 && re.test(r.text), `exit ${r.code}: ${r.text.slice(-400)}`);
    };
    await refused("malformed", ["--sun", "100:50"], /--sun "100:50": expected STEP:PERCENT,SPAN/);
    await refused("a percent outside the set", ["--sun", "100:60,10"], /percent must be one of 50, 75, 125, 150/);
    await refused("a percent the world cannot take", ["--sun", "100:150,10"], /cannot take a sun of 150%/);
    await refused("a sun that ends after the last step", ["--sun", "250:50,100"], /ends at t=350, after the run's last step \(t=300\)/);
    await refused("overlapping suns", ["--sun", "100:50,100", "--sun", "150:75,10"], /suns do not overlap/);

    // A fork (--start-from) from a checkpoint taken under a sun, with a schedule of its own: the inherited sun leads its schedule
    // (not applied or logged again), so it continues as the continuous run does, and a new sun is held to the inherited one's end.
    const srcArgs = [...common("sun-src"), "--checkpoint", "100", "--sun", "100:50,150"];
    const src = await cli(srcArgs);
    const srcDir = `${tmp}/sun-src/spots/treatment/seed-3`;
    check("4. the fork's source runs, with a checkpoint at 200 under its sun", src.code === 0, `exit ${src.code}: ${src.text.slice(-400)}`);
    const cont = await run(devFull, { ...full, interventions: [sun(100, 50, 150), { step: 220, kind: "lesion", x: 24, y: 24, r: 4 }] });
    const forkArgs = (exp: string, more: string[]) => ["--experiment", exp, "--preset", "spots", "--conditions", "treatment", "--seeds", "3", "--steps", "100", "--census", "100", "--deep", "5", "--out", tmp, "--start-from", srcDir, "--start-step", "200", ...more];
    const fork = await cli(forkArgs("sun-fork", ["--lesion", "220:24,24,4"]));
    const forkDir = `${tmp}/sun-fork/spots/treatment/seed-3`;
    const fm = await Deno.readTextFile(`${forkDir}/manifest.json`).then(JSON.parse).catch(() => null);
    check("4. a fork under an inherited sun takes a --lesion (exit 0) and ends as the continuous run does", fork.code === 0 && fm?.summary?.finalHash === cont.summary.finalHash, `exit ${fork.code}: ${fork.text.slice(-400)}`);
    check("4. ...its spec leads with the inherited sun, and its log holds only the lesion", JSON.stringify(fm?.spec?.interventions?.[0]) === JSON.stringify(sun(100, 50, 150)) &&
      (await Deno.readTextFile(`${forkDir}/${INTERVENTIONS_FILE}`).catch(() => null)) === '{"step":220,"kind":"lesion","x":24,"y":24,"r":4}\n');
    const over = await cli(forkArgs("sun-fork-over", ["--sun", "230:75,10"]));
    check("4. a fork's new sun inside the inherited sun's span is refused (exit 2)", over.code === 2 && /suns do not overlap/.test(over.text), `exit ${over.code}: ${over.text.slice(-400)}`);
  });
} finally {
  await Deno.remove(tmp, { recursive: true }).catch(() => {});
}

console.log(`${checks - failures} of ${checks} checks passed in ${((performance.now() - T0) / 1000).toFixed(1)} s`);
Deno.exit(ok ? 0 : 1);
