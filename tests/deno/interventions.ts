// Scheduled interventions (RunSpec.interventions, packages/runner/src/interventions.ts) on a real native WebGPU device: the lab's
// lesions and feeds applied by runExperiment at their steps, so that a wounded or fed history runs, and replays, headless bit for bit.
// The vitest file beside the runner (packages/runner/test/interventions.test.ts) drives the same loop on a CPU stand-in for GpuSim;
// this script is the part only a GPU can show. Two worlds are used, and why:
//
//   small  spots with overrides (48 x 48, kernelRadius 6, eA 1): the CPU reference steps it at about 8 ms a step, so a CPU oracle
//          for 1000 steps is affordable (the preset's own 256 x 256 world costs about 300 ms a step on the CPU). eA 1 is there so
//          that a feed's energy-baseline move is real: with eA 0 a wrong baseline move would be invisible to the ledger.
//   full   the preset as it is (256 x 256), GPU only. tools/run.ts has no flag for a config override beyond mutRate and pondDeath,
//          so the CLI checks can only run this world; their reference is the API runner on the same spec, on the same device
//          kind (the CPU-vs-GPU equality is the small world's job, and gpu_golden.ts / feed_gpu.ts's for the kernels).
//
//  1. oracle: a schedule of a lesion at step 0, a lesion at 137 (not a census step), a feed at 200 (a census step), a drain at 337
//     and a feed at the final step 1000 (its radius clamped), against RefSim stepping on the CPU with applyLesion / applyFeed at
//     the same steps in the same order: the same final state hash, conservation exact (the census checks, and the whole ledger
//     once more after the last feed), observer.fed the oracle's sum, interventions.jsonl with the oracle's effective radii and
//     matter, manifest.json carrying spec.interventions and interventions.applied; a clean run has none of these, and the
//     schedule is not vacuous (the clean run's final hash differs, every feed moved matter, every lesion destroyed structure);
//  2. segments: the same spec cut at the feed's own step (200) and in the middle of a chunk (300) equals the continuous run (final
//     state hash, artifact digest so observer.fed travels, observer.fed), each segment logs only what it applied and the two logs
//     concatenate to the continuous run's;
//  3. order at a boundary: a migration world with a lesion at a migration boundary that is also a census step equals the same
//     world driven by hand (GpuSim, applyBoundary, then sim.lesion): the boundary first, the lab's order. The opposite order
//     gives another state, so the check discriminates;
//  4. refusals before the GPU is touched: a feed in a pond preset (feedError's own reason), a centre outside the world; a feed
//     whose named matter the run does not reproduce stops the run with an InterventionError ("this is not the observed
//     history"); specRefusal turns a scheduled spec away from an island;
//  5. through tools/run.ts as a subprocess (needs the --lesion STEP:X,Y,R, --feed STEP:X,Y,R,AMOUNT and --interventions FILE flags
//     and a lab manifest with lesions and feeds for --picks-from): (a) the flags give the API runner's artifact digest and
//     interventions.jsonl on the full world, (a2, a3) so does --interventions FILE holding the run's own log or a JSON array, (b) a lab-style manifest
//     built by hand replays and the output says it matches the lab's checkpoint, with the feed's matter off by one it exits
//     non-zero ("not the observed history"), (c) with a wrong checkpoint hash it exits 4, (d) the refusals (exit 2, before any GPU
//     work) and the stop (exit 4) of the flags and of a lab manifest: a malformed flag, an entry after --steps or off the world, an
//     unknown key (including the names on Object.prototype), a lab feed without its matter, a start hash this checkout does not
//     build, and a step-0 feed that does not reproduce its matter, which says that nothing was written and leaves no bundle;
//  6. the lab's own traversal (checks 3 and 3c): the same wounded and fed history made by hand in LabExecution (apps/lab/src/execution.ts) on a real
//     GpuSim, as sim.worker.ts makes it (advanceFrame to the step, then sim.lesion / sim.feed with recordFeed, each logged with its
//     effective radius and a feed's matter), is read back with labHistory and run by runExperiment: the same final state hash, the same
//     observer.fed, in the small world (a lesion at step 0, mid-chunk, a feed at a census step, a drain, a clamped feed at the last
//     step), at a migration boundary (3) and at a pond cycle and mid-chunk (3c). Nothing else pins the runner to the lab's order.
//
// Run from the repo root: deno run -A tests/deno/interventions.ts
import {
  CH,
  PRESETS,
  RULE_VERSION,
  applyFeed,
  applyMigration,
  cellCount,
  clampLesionRadius,
  cloneState,
  feedError,
  initWorld,
  lowbias32,
  stateHash,
  totalsOf,
  worldW,
  type FeedResult,
  type Intervention,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";
import { GpuSim, requestDevice } from "@bl/sim-gpu";
import { RefSim, applyLesion } from "@bl/sim-ref";
import { LabExecution } from "../../apps/lab/src/execution.ts";
import {
  INTERVENTIONS_FILE,
  InterventionError,
  applyBoundary,
  decodeArtifact,
  formatInterventionLine,
  labHistory,
  observerSettings,
  parseInterventionLog,
  runExperiment,
  specConfig,
  specRefusal,
  validateSpec,
  type InterventionLogEntry,
  type RunSpec,
  type ScheduledIntervention,
  type Sink,
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
/** One numbered group of checks. An exception in it is a FAIL of its own and does not stop the others. */
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

type RunOpts = NonNullable<Parameters<typeof runExperiment>[5]>;
/** A run through the real runner with an in-memory sink, its manifest parsed and its log read back. */
async function run(device: GPUDevice, spec: RunSpec, opts: RunOpts = {}) {
  const mem = new Mem();
  const r = await runExperiment(device, spec, mem, host, noop, { keepFinal: true, ...opts });
  const manifest = JSON.parse(mem.files.get("manifest.json")!) as { spec: { interventions?: unknown }; interventions?: { file: string; applied: number }; summary: unknown };
  return { summary: r.summary, final: r.final!, observer: r.observer, mem, manifest, log: mem.files.get(INTERVENTIONS_FILE) };
}
/** A value with its object keys sorted, as JSON: two schedules written with different key orders compare equal. */
const canon = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const textOf = (entries: readonly InterventionLogEntry[]) => entries.map(formatInterventionLine).join("");
/** Quanta of bound structure (biomass and polymer) in a state: what a lesion destroys. */
const bound = (s: WorldState) => {
  const n = cellCount(s.cfg);
  let t = 0;
  for (let i = 0; i < n; i++) t += s.cells[CH.B * n + i] + s.cells[CH.P * n + i];
  return t;
};
/** The six founders' centres, as the generalist init places them (world.ts generalistWorld). */
function founderCentres(cfg: WorldConfig, k: number): { x: number; y: number }[] {
  const W = worldW(cfg), H = cellCount(cfg) / W;
  return Array.from({ length: k }, (_, i) => {
    const h = lowbias32(cfg.seed * 31 + i);
    return { x: h % W, y: (h >>> 12) % H };
  });
}
/** Runs a GpuSim `steps` more steps in batches of 64 as the runner does, then waits for the device. */
async function advance(sim: GpuSim, device: GPUDevice, steps: number) {
  for (let k = steps; k > 0; k -= 64) sim.run(Math.min(64, k));
  await device.queue.onSubmittedWorkDone();
}

/** One thing a person does to the lab's world at `at`: a lesion, or a feed (a negative amount drains). */
type Hand = { at: number; kind: "lesion"; x: number; y: number; r: number } | { at: number; kind: "feed"; x: number; y: number; r: number; amount: number };
/**
 * A history made by hand in the lab's own traversal, as sim.worker.ts makes it: LabExecution over a real GpuSim, advanceFrame to each
 * step (it stops at every census and settles it: observation, migration, pond cycle), then the lesion or feed on the simulation, a feed
 * booked with recordFeed, and the manifest's intervention logged with the effective radius and, for a feed, the matter it moved. Returns
 * that log, the execution's checkpoint at `total` and the feed total it holds.
 */
async function labByHand(device: GPUDevice, spec: RunSpec, init: WorldState, plan: readonly Hand[], total: number) {
  const cfg = specConfig(spec);
  const sim = await GpuSim.create(device, cloneState(init));
  try {
    const exec = new LabExecution(sim, observerSettings(spec), { waitForIdle: () => device.queue.onSubmittedWorkDone(), isCurrent: () => true, ...(cfg.pondPeriod !== undefined ? { start: cloneState(init) } : {}) });
    const log: Intervention[] = [];
    const reach = async (step: number) => {
      while (sim.step < step) await exec.advanceFrame(step - sim.step);
    };
    for (const h of plan) {
      await reach(h.at);
      const step = sim.step;
      if (h.kind === "lesion") log.push({ step, kind: "lesion", x: h.x, y: h.y, r: sim.lesion(h.x, h.y, h.r) });
      else {
        const res = await sim.feed(h.x, h.y, h.r, h.amount);
        exec.recordFeed(res.matter);
        log.push({ step, kind: "feed", x: h.x, y: h.y, r: res.radius, amount: h.amount, matter: res.matter });
      }
    }
    await reach(total);
    const saved = await exec.checkpoint();
    return { log, state: saved.state, fed: exec.fed };
  } finally {
    sim.destroy();
  }
}

const spots = PRESETS.find((p) => p.id === "spots")!;

// ---- The small world: spots, shrunk so that the CPU reference can be the oracle.
const SMALL = { tileW: 48, tileH: 48, kernelRadius: 6, eA: 1 };
const small: RunSpec = { experiment: "interv-small", presetId: "spots", condition: "treatment", seed: 3, steps: 1000, censusEvery: 100, deepEvery: 5, checkpointEvery: 0, overrides: SMALL };
const smallCfg = specConfig(small);
const smallInit = initWorld(smallCfg, spots.init);
const devSmall = await requestDevice(navigator.gpu, smallCfg);
const smallSchedule: ScheduledIntervention[] = [
  { step: 0, kind: "lesion", x: 12, y: 14, r: 6 },
  { step: 137, kind: "lesion", x: 30, y: 28, r: 9 },
  { step: 200, kind: "feed", x: 24, y: 24, r: 10, amount: 16 },
  { step: 337, kind: "feed", x: 24, y: 24, r: 7, amount: -8 },
  { step: 1000, kind: "feed", x: 40, y: 8, r: 99, amount: 4 }, // r 99 is clamped to the largest lesion radius, 23
];
const scheduled: RunSpec = { ...small, interventions: smallSchedule };
const FINAL_STEP = small.steps;

/** The CPU oracle: RefSim stepping the starting world with the reference lesion and feed applied at their steps, in list order. */
function cpuOracle(cfg: WorldConfig, init: WorldState, schedule: readonly ScheduledIntervention[], total: number) {
  const ref = new RefSim(cloneState(init));
  const log: InterventionLogEntry[] = [];
  const feeds: FeedResult[] = [];
  const destroyed: number[] = [];
  let at = 0;
  for (const e of schedule) {
    if (e.step > at) {
      ref.run(e.step - at);
      at = e.step;
    }
    if (e.kind === "lesion") {
      const before = bound(ref.state);
      applyLesion(ref, e.x, e.y, e.r);
      destroyed.push(before - bound(ref.state));
      log.push({ step: e.step, kind: "lesion", x: e.x, y: e.y, r: clampLesionRadius(cfg, e.r) });
    } else {
      const f = applyFeed(ref.state, e.x, e.y, e.r, e.amount);
      feeds.push(f);
      log.push({ step: e.step, kind: "feed", x: e.x, y: e.y, r: f.radius, amount: e.amount, matter: f.matter });
    }
  }
  if (total > at) ref.run(total - at);
  return { state: ref.state, hash: stateHash(ref.state), log, feeds, destroyed };
}

// A continuous run of the scheduled small world, shared by checks 1 and 2.
const whole = await run(devSmall, scheduled);

await section("1. oracle: lesion and feed schedule on the GPU against the CPU reference", async () => {
  const t = performance.now();
  const oracle = cpuOracle(smallCfg, smallInit, smallSchedule, FINAL_STEP);
  console.log(`   (CPU oracle, ${FINAL_STEP} steps: ${((performance.now() - t) / 1000).toFixed(1)} s)`);
  const clean = await run(devSmall, small);
  const fedMatter = oracle.feeds.reduce((a, f) => a + f.matter, 0);

  check("1. same final state hash as the CPU oracle", stateHash(whole.final) === oracle.hash, `${stateHash(whole.final)} vs ${oracle.hash}`);
  check("1. ...conservation exact at every census", whole.summary.conservationOk === true);
  check("1. ...observer.fed is the oracle's sum over the 3 feeds", canon(whole.observer.fed) === canon({ matter: fedMatter, feeds: 3 }), `${canon(whole.observer.fed)} vs matter ${fedMatter}, 3 feeds`);
  // The census checks stop at step 1000, before the last feed; close the books here with the moves a host makes.
  const t0 = totalsOf(smallCfg, smallInit.cells), tf = totalsOf(smallCfg, whole.final.cells);
  const baseline = t0.energy + smallInit.heatOut - smallInit.lightIn + oracle.feeds.reduce((a, f) => a + f.energy, 0n);
  check("1. ...total matter is the start plus what the feeds moved, and the energy ledger closes exactly after the last feed", tf.matter === t0.matter + BigInt(fedMatter) && tf.energy + whole.final.heatOut - whole.final.lightIn - baseline === 0n, `matter ${tf.matter} vs ${t0.matter + BigInt(fedMatter)}; residual ${tf.energy + whole.final.heatOut - whole.final.lightIn - baseline}`);

  const logged = parseInterventionLog(whole.log ?? "");
  check("1. ...interventions.jsonl: 5 lines, in order, with the oracle's effective radii and matter", logged.length === 5 && canon(logged) === canon(oracle.log), `${logged.length} lines: ${whole.log}`);
  check("1. ...and the text is the shared formatter's, byte for byte", whole.log === textOf(oracle.log));
  check("1. ...the clamped feed logged its effective radius (the largest lesion radius, not the 99 asked)", logged[4]?.r === clampLesionRadius(smallCfg, 99) && oracle.log[4].r === logged[4]?.r && logged[4].r < 99, JSON.stringify(logged[4]));
  check("1. ...manifest.json carries spec.interventions and interventions.applied = 5", canon(whole.manifest.spec.interventions) === canon(smallSchedule) && whole.manifest.interventions?.file === INTERVENTIONS_FILE && whole.manifest.interventions?.applied === 5, JSON.stringify(whole.manifest.interventions));

  check("1. a clean run has no interventions.jsonl, no manifest.interventions, no spec.interventions", clean.log === undefined && clean.manifest.interventions === undefined && clean.manifest.spec.interventions === undefined && clean.observer.fed === undefined);
  check("1. ...and the schedule is not vacuous: the clean run ends in another state", stateHash(clean.final) !== stateHash(whole.final));
  check("1. ...every feed moved matter (the drain too), every lesion destroyed bound structure", oracle.feeds.every((f) => f.matter !== 0) && oracle.feeds[1].matter < 0 && oracle.destroyed.every((d) => d > 0), `${oracle.feeds.map((f) => f.matter)} / ${oracle.destroyed}`);
});

await section("2. segments: a run cut at a feed's step and at a later census equals the continuous run; an off-grid cut keeps the physics", async () => {
  const wholeLog = parseInterventionLog(whole.log ?? "");
  // Both cuts are on the census grid (censusEvery 100), as every real segment is: a continuation re-chunks from its own start, so an
  // off-grid cut shifts the census grid and with it the observations and the artifact digest, as it did before schedules existed.
  // The physics does not depend on the grid, so the off-grid cut below must still reproduce the state, the log and fed.
  for (const cut of [200, 300]) {
    const a = await run(devSmall, { ...scheduled, steps: cut });
    const b = await run(devSmall, { ...scheduled, steps: FINAL_STEP - cut }, { start: a.final, observer: a.observer });
    const logA = parseInterventionLog(a.log ?? ""), logB = parseInterventionLog(b.log ?? "");
    const wantA = wholeLog.filter((e) => e.step <= cut), wantB = wholeLog.filter((e) => e.step > cut);
    const tag = `2. cut at ${cut}`;
    check(`${tag}: the final state hash equals the continuous run's`, stateHash(b.final) === stateHash(whole.final), `${stateHash(b.final)} vs ${stateHash(whole.final)}`);
    check(`${tag}: ...and the artifact digest (physics + observer, so observer.fed travels)`, b.summary.finalHash === whole.summary.finalHash, `${b.summary.finalHash} vs ${whole.summary.finalHash}`);
    check(`${tag}: ...observer.fed is the continuous run's (the first segment holds ${wantA.filter((e) => e.kind === "feed").length} of the 3 feeds)`, canon(b.observer.fed) === canon(whole.observer.fed) && a.observer.fed?.feeds === wantA.filter((e) => e.kind === "feed").length, `${canon(a.observer.fed)} then ${canon(b.observer.fed)} vs ${canon(whole.observer.fed)}`);
    check(`${tag}: ...each segment's log holds only what it applied (steps <= ${cut}, then > ${cut}), and the two concatenate to the continuous log`, canon(logA) === canon(wantA) && canon(logB) === canon(wantB) && (a.log ?? "") + (b.log ?? "") === whole.log, `${logA.map((e) => e.step)} | ${logB.map((e) => e.step)}`);
    check(`${tag}: ...the manifests count their own entries (${wantA.length} + ${wantB.length})`, a.manifest.interventions?.applied === wantA.length && b.manifest.interventions?.applied === wantB.length, `${a.manifest.interventions?.applied} + ${b.manifest.interventions?.applied}`);
    check(`${tag}: ...conservation exact in both segments`, a.summary.conservationOk && b.summary.conservationOk);
  }
  // Off the census grid (250, inside a chunk and between the feed at 200 and the drain at 337): the physics, the log and fed are
  // the continuous run's; the observations are not (the grid moved: 11 censuses against 10, and censusIdx is in the digest), so
  // the artifact digest is asserted to differ, not to match. As in segments.ts, a cut like this is not a segment any caller makes.
  {
    const cut = 250;
    const a = await run(devSmall, { ...scheduled, steps: cut });
    const b = await run(devSmall, { ...scheduled, steps: FINAL_STEP - cut }, { start: a.final, observer: a.observer });
    const tag = `2. cut off the census grid at ${cut}`;
    check(`${tag}: the final state hash equals the continuous run's (the physics does not depend on the grid)`, stateHash(b.final) === stateHash(whole.final), `${stateHash(b.final)} vs ${stateHash(whole.final)}`);
    check(`${tag}: ...observer.fed and the concatenated log are the continuous run's`, canon(b.observer.fed) === canon(whole.observer.fed) && (a.log ?? "") + (b.log ?? "") === whole.log, `${canon(b.observer.fed)} vs ${canon(whole.observer.fed)}`);
    check(`${tag}: ...and the artifact digest differs, because the census grid moved (a continuation's own behaviour, not a schedule's)`, b.summary.finalHash !== whole.summary.finalHash, `${b.summary.finalHash}`);
  }
});

await section("3. order at a boundary: migration, then the lesion (the lab's order)", async () => {
  const arch = PRESETS.find((p) => p.id === "archipelago")!;
  const archSpec: RunSpec = { experiment: "interv-order", presetId: "archipelago", condition: "treatment", seed: 5, steps: 400, censusEvery: 100, deepEvery: 5, checkpointEvery: 0 };
  const cfg = specConfig(archSpec);
  const init = initWorld(cfg, arch.init);
  const S = cfg.migrationPeriod!;
  check("3. the fixture: a migration world whose first boundary is a census step inside the run", S > 0 && S % archSpec.censusEvery === 0 && S < archSpec.steps, `migrationPeriod ${S}`);
  const dev = await requestDevice(navigator.gpu, cfg);
  const W = worldW(cfg), n = cellCount(cfg);

  // Where to wound: the destination of a migrant that carries living structure, so that the order of the boundary and the lesion matters.
  const probe = await GpuSim.create(dev, cloneState(init));
  let centre: { x: number; y: number };
  try {
    await advance(probe, dev, S);
    const pre = await probe.readState();
    const events = applyMigration(pre, S).events;
    const alive = events.find((e) => pre.cells[CH.B * n + e.fromCell] > 0) ?? events[0];
    centre = { x: alive.toCell % W, y: Math.floor(alive.toCell / W) };
  } finally {
    probe.destroy();
  }
  const wound = { ...centre, r: 4 };

  /** The same world driven by hand as the lab does: census cadence, applyBoundary at each, the lesion on the order named at S. */
  async function byHand(order: "boundary-first" | "lesion-first" | "none"): Promise<string> {
    const sim = await GpuSim.create(dev, cloneState(init));
    try {
      for (let at = archSpec.censusEvery; at <= archSpec.steps; at += archSpec.censusEvery) {
        await advance(sim, dev, archSpec.censusEvery);
        await sim.drainLedger();
        if (at === S && order === "lesion-first") sim.lesion(wound.x, wound.y, wound.r);
        await applyBoundary(sim, at, null);
        if (at === S && order === "boundary-first") sim.lesion(wound.x, wound.y, wound.r);
      }
      return stateHash(await sim.readState());
    } finally {
      sim.destroy();
    }
  }
  const [boundaryFirst, lesionFirst, none] = [await byHand("boundary-first"), await byHand("lesion-first"), await byHand("none")];
  const runner = await run(dev, { ...archSpec, interventions: [{ step: S, kind: "lesion", ...wound }] });
  check(`3. runExperiment's lesion at t=${S} (a migration boundary and a census step, at ${centre.x},${centre.y}) equals the hand-driven world with the boundary first`, stateHash(runner.final) === boundaryFirst, `${stateHash(runner.final)} vs ${boundaryFirst}`);
  check("3. ...the opposite order ends in another state, so the check discriminates", lesionFirst !== boundaryFirst, "lesion-first equals boundary-first: the lesion does not meet the migrant");
  check("3. ...and the lesion mattered at all", none !== boundaryFirst && none !== lesionFirst);
  check("3. ...migration did happen at that step, and the log holds the one lesion", new RegExp(`^${S}\\t`, "m").test(runner.mem.files.get("migrations.tsv") ?? "") && runner.log === textOf([{ step: S, kind: "lesion", ...wound }]), `${runner.log}`);
  check("3. ...conservation exact", runner.summary.conservationOk);

  // The lab's own traversal, made by hand: advanceFrame settles the migration at S, and the lesion comes after it.
  const lab = await labByHand(dev, archSpec, init, [{ at: S, kind: "lesion", ...wound }], archSpec.steps);
  check("3. the lab's own traversal (LabExecution, the lesion made by hand after its census step settled) ends in the same state", stateHash(lab.state) === stateHash(runner.final) && stateHash(lab.state) === boundaryFirst, `${stateHash(lab.state)} vs ${stateHash(runner.final)}`);
  check("3. ...and its log, read back by labHistory, is the schedule that produced it", canon(labHistory({ interventions: lab.log, edgesFrom: 0 }).scheduled) === canon([{ step: S, kind: "lesion", ...wound }]));
});

await section("3b. a checkpoint at a pond boundary carries the post-lesion world", async () => {
  // The pond cycle reads the whole state back at its boundary, and the runner reuses that readback for a checkpoint at the same
  // step; a lesion applied after the cycle makes it stale. The checkpoint must be read again, so it holds the wounded world.
  const ponds: RunSpec = { experiment: "interv-pond-checkpoint", presetId: "ponds-small", condition: "treatment", seed: 1, steps: 1000, censusEvery: 100, deepEvery: 5, checkpointEvery: 1000 };
  const cfg = specConfig(ponds);
  const dev = await requestDevice(navigator.gpu, cfg);
  const at = cfg.pondPeriod!;
  check("3b. the fixture: a pond boundary at the run's last step, on the checkpoint cadence", at === ponds.steps && ponds.steps % ponds.checkpointEvery === 0, `pondPeriod ${at}`);
  const wound: ScheduledIntervention = { step: at, kind: "lesion", x: cfg.tileW / 2, y: cfg.tileH / 2, r: 99 };
  const wounded = await run(dev, { ...ponds, interventions: [wound] });
  const clean = await run(dev, ponds);
  const file = `checkpoints/t${String(at).padStart(9, "0")}.blck`;
  const kept = wounded.mem.bytes.get(file), cleanKept = clean.mem.bytes.get(file);
  check("3b. the checkpoint at the boundary holds the post-lesion state, the run's final state", kept !== undefined && stateHash(decodeArtifact(kept).state) === stateHash(wounded.final), `${kept ? stateHash(decodeArtifact(kept).state) : "(no checkpoint)"} vs ${stateHash(wounded.final)}`);
  check("3b. ...which is not the post-cycle state of the clean run (the lesion met a pond's reseeded packet)", cleanKept !== undefined && stateHash(decodeArtifact(cleanKept).state) !== stateHash(wounded.final) && stateHash(clean.final) !== stateHash(wounded.final));
  check("3b. ...the lesion was logged with its effective radius, and the pond cycle's matter checks held", wounded.log === textOf([{ step: at, kind: "lesion", x: wound.x, y: wound.y, r: clampLesionRadius(cfg, 99) }]) && wounded.summary.conservationOk, `${wounded.log}`);
});

await section("3c. the lab's own traversal: the small world's whole schedule, and a pond cycle", async () => {
  // Made by hand in LabExecution, then run through labHistory by runExperiment: a lesion at step 0, mid-chunk (137), a feed at a census
  // step (200), a drain mid-chunk (337) and a feed at the last step (600) whose radius is clamped.
  const total = 600;
  const plan: Hand[] = [
    { at: 0, kind: "lesion", x: 12, y: 14, r: 6 },
    { at: 137, kind: "lesion", x: 30, y: 28, r: 9 },
    { at: 200, kind: "feed", x: 24, y: 24, r: 10, amount: 16 },
    { at: 337, kind: "feed", x: 24, y: 24, r: 7, amount: -8 },
    { at: total, kind: "feed", x: 40, y: 8, r: 99, amount: 4 },
  ];
  const spec: RunSpec = { ...small, steps: total };
  const lab = await labByHand(devSmall, spec, smallInit, plan, total);
  check("3c. the lab logged the five interventions at the steps they were made, the last with its clamped radius", lab.log.map((e) => e.step).join() === "0,137,200,337,600" && lab.log[4].kind === "feed" && lab.log[4].r === clampLesionRadius(smallCfg, 99) && lab.log[4].r < 99, JSON.stringify(lab.log));
  const rn = await run(devSmall, { ...spec, interventions: labHistory({ interventions: lab.log, edgesFrom: 0 }).scheduled });
  check("3c. runExperiment on labHistory's schedule ends in the lab's final state", stateHash(rn.final) === stateHash(lab.state), `${stateHash(rn.final)} vs ${stateHash(lab.state)}`);
  check("3c. ...with the lab's feed total in the observer, and conservation exact", canon(rn.observer.fed) === canon(lab.fed) && lab.fed.feeds === 3 && rn.summary.conservationOk, `${canon(rn.observer.fed)} vs ${canon(lab.fed)}`);
  check("3c. ...and its own log is the lab's, line for line", rn.log === textOf(lab.log as InterventionLogEntry[]), `${rn.log}`);
  const clean = await run(devSmall, spec);
  check("3c. ...which is not the clean run's state", stateHash(clean.final) !== stateHash(lab.state));

  // A pond world: a lesion mid-chunk, then one at the cycle step, which the lab applies after the cycle. The checkpoint at the cycle
  // step must carry it (the runner reads the world again there, since the cycle's own readback is stale once a lesion followed).
  const ponds: RunSpec = { experiment: "interv-pond-lab", presetId: "ponds-small", condition: "treatment", seed: 1, steps: 1000, censusEvery: 100, deepEvery: 5, checkpointEvery: 1000 };
  const cfg = specConfig(ponds);
  const dev = await requestDevice(navigator.gpu, cfg);
  const pondInit = initWorld(cfg, PRESETS.find((p) => p.id === "ponds-small")!.init);
  const hands: Hand[] = [
    { at: 550, kind: "lesion", x: cfg.tileW / 4, y: cfg.tileH / 4, r: 20 },
    { at: cfg.pondPeriod!, kind: "lesion", x: cfg.tileW / 2, y: cfg.tileH / 2, r: 99 },
  ];
  check("3c. the pond fixture: the cycle is at the run's last step", cfg.pondPeriod === ponds.steps, `pondPeriod ${cfg.pondPeriod}`);
  const pl = await labByHand(dev, ponds, pondInit, hands, ponds.steps);
  const pr = await run(dev, { ...ponds, interventions: labHistory({ interventions: pl.log, edgesFrom: 0 }).scheduled });
  const file = `checkpoints/t${String(ponds.steps).padStart(9, "0")}.blck`;
  const kept = pr.mem.bytes.get(file);
  check("3c. the pond world: runExperiment ends in the lab's final state", stateHash(pr.final) === stateHash(pl.state), `${stateHash(pr.final)} vs ${stateHash(pl.state)}`);
  check("3c. ...its checkpoint at the cycle step holds that wounded world", kept !== undefined && stateHash(decodeArtifact(kept).state) === stateHash(pl.state), kept ? stateHash(decodeArtifact(kept).state) : "(no checkpoint)");
  check("3c. ...and the pond cycle's matter checks held", pr.summary.conservationOk);
});

await section("4. refusals: before the GPU, and the run that stops", async () => {
  const fake = {} as GPUDevice; // any use of it throws "createBuffer is not a function"
  const refusal = async (spec: RunSpec): Promise<{ message: string; sink: Mem }> => {
    const sink = new Mem();
    try {
      await runExperiment(fake, spec, sink, host, noop, {});
    } catch (e) {
      return { message: e instanceof Error ? e.message : String(e), sink };
    }
    return { message: "(no error)", sink };
  };
  const pond: RunSpec = { experiment: "interv-ponds", presetId: "ponds-small", condition: "treatment", seed: 1, steps: 1000, censusEvery: 100, deepEvery: 5, checkpointEvery: 0, interventions: [{ step: 300, kind: "feed", x: 10, y: 10, r: 5, amount: 8 }] };
  const why = feedError(specConfig(pond), 8, 5);
  check("4. the spec of a feed in a pond preset passes the shape checks (the world is the runner's to refuse)", validateSpec(pond).length === 0 && why !== null, validateSpec(pond).join("; "));
  const pr = await refusal(pond);
  check("4. a feed in a pond preset is refused before the GPU with feedError's own reason, and nothing is written", why !== null && pr.message.includes(why) && pr.sink.files.size === 0, `${pr.message} (${pr.sink.files.size} files)`);
  const lesionOk = await refusal({ ...pond, interventions: [{ step: 300, kind: "lesion", x: 10, y: 10, r: 5 }] });
  check("4. ...a lesion in the same pond world is not refused by the schedule checks (it reaches the GPU: the fake device fails)", /is not a function/.test(lesionOk.message), lesionOk.message);
  const off = await refusal({ ...small, interventions: [{ step: 10, kind: "lesion", x: 500, y: 5, r: 3 }] });
  check("4. a centre outside the world is refused before the GPU, and nothing is written", /outside the world/.test(off.message) && off.sink.files.size === 0, `${off.message} (${off.sink.files.size} files)`);

  // A feed whose named matter the run does not reproduce stops the run there.
  const bad: ScheduledIntervention[] = [
    { step: 50, kind: "lesion", x: 10, y: 10, r: 5 },
    { step: 200, kind: "feed", x: 24, y: 24, r: 10, amount: 16, matter: 999 },
    { step: 500, kind: "lesion", x: 30, y: 30, r: 5 },
  ];
  const sink = new Mem();
  let caught: unknown;
  try {
    await runExperiment(devSmall, { ...small, steps: 600, interventions: bad }, sink, host, noop, {});
  } catch (e) {
    caught = e;
  }
  const rows = (sink.files.get("series.jsonl") ?? "").split("\n").filter((l) => l !== "").length;
  const manifest = JSON.parse(sink.files.get("manifest.json") ?? "{}") as { summary?: unknown };
  check("4. a wrong expected matter (999) throws an InterventionError saying this is not the observed history", caught instanceof InterventionError && /not the observed history/.test(caught.message) && /999/.test(caught.message), String(caught));
  check("4. ...the run stopped there: the lesion before it is logged, nothing after, two census rows, no summary", sink.files.get(INTERVENTIONS_FILE) === textOf([{ step: 50, kind: "lesion", x: 10, y: 10, r: 5 }]) && rows === 2 && manifest.summary === null, `${JSON.stringify(sink.files.get(INTERVENTIONS_FILE))} rows ${rows} summary ${JSON.stringify(manifest.summary)}`);

  const why2 = specRefusal(scheduled);
  check("4. specRefusal turns a scheduled spec away from an island, and not a clean one", why2 !== null && /interventions/.test(why2) && specRefusal(small) === null, String(why2));
});

// ---- The full world, for the CLI: GPU only.
const full: RunSpec = { experiment: "interv-full", presetId: "spots", condition: "treatment", seed: 3, steps: 400, censusEvery: 100, deepEvery: 5, checkpointEvery: 0 };
const fullCfg = specConfig(full);
const fullInit = initWorld(fullCfg, spots.init);
const [f0, f1, f2] = founderCentres(fullCfg, 3);
const fullSchedule: ScheduledIntervention[] = [
  { step: 0, kind: "lesion", x: f0.x, y: f0.y, r: 6 },
  { step: 137, kind: "lesion", x: f1.x, y: f1.y, r: 9 },
  { step: 200, kind: "feed", x: f2.x, y: f2.y, r: 12, amount: 16 },
  { step: 337, kind: "feed", x: f2.x, y: f2.y, r: 8, amount: -8 },
  { step: 400, kind: "feed", x: f0.x, y: f0.y, r: 20, amount: 4 },
];
const decode = (b: Uint8Array) => new TextDecoder().decode(b);
async function cli(args: string[]): Promise<{ code: number; text: string }> {
  const o = await new Deno.Command(Deno.execPath(), { args: ["run", "-A", "--config", DENO_JSON, RUN_TS, ...args], cwd: ROOT, stdin: "null", stdout: "piped", stderr: "piped" }).output();
  return { code: o.code, text: decode(o.stdout) + decode(o.stderr) };
}
const readJson = async (p: string) => JSON.parse(await Deno.readTextFile(p)) as Record<string, unknown>;
const readText = (p: string) => Deno.readTextFile(p).catch(() => null);

const tmp = await Deno.makeTempDir({ prefix: "interventions-" });
try {
  await section("5. through tools/run.ts", async () => {
    const devFull = await requestDevice(navigator.gpu, fullCfg);
    const common = (exp: string, steps: number) => ["--experiment", exp, "--preset", "spots", "--conditions", "treatment", "--seeds", "3", "--steps", String(steps), "--census", "100", "--deep", "5", "--out", tmp];
    const bundle = (exp: string, by?: string) => `${tmp}/${exp}/spots/treatment${by ? `-by-${by}` : ""}/seed-3`; // a lab replay lands under -by-<label>
    const missing = "(no interventions block in the CLI bundle's manifest: run.ts did not apply the schedule, so the --lesion / --feed / --interventions flags have not landed)";
    const hint = (m: Record<string, unknown> | null) => (m && m.interventions === undefined ? ` ${missing}` : "");

    // Sanity of the fixture: the schedule is aimed at the founders' biomass, and the API runner is the reference.
    const n = cellCount(fullCfg), W = worldW(fullCfg);
    check("5. the schedule's lesion and feed centres sit on the founders' biomass", [f0, f1, f2].every((c) => fullInit.cells[CH.B * n + c.y * W + c.x] > 0), JSON.stringify([f0, f1, f2]));
    const api = await run(devFull, { ...full, interventions: fullSchedule });
    const apiClean = await run(devFull, full);
    check("5. the API runner on the full world: conservation exact, the schedule applied (5 lines) and not vacuous", api.summary.conservationOk && api.manifest.interventions?.applied === 5 && api.summary.finalHash !== apiClean.summary.finalHash);

    // (a) the flags
    const flags = fullSchedule.flatMap((e) => (e.kind === "lesion" ? ["--lesion", `${e.step}:${e.x},${e.y},${e.r}`] : ["--feed", `${e.step}:${e.x},${e.y},${e.r},${e.amount}`]));
    const a = await cli([...common("iv-flags", full.steps), ...flags]);
    const aMan = (await readJson(`${bundle("iv-flags")}/manifest.json`).catch(() => null)) as { summary?: { finalHash?: string }; spec?: { interventions?: unknown }; interventions?: { applied: number } } | null;
    check("5a. --lesion and --feed: exit 0 and conservation reported exact", a.code === 0 && /conservation exact/.test(a.text), `exit ${a.code}: ${a.text.slice(-400)}`);
    check("5a. ...the bundle's artifact digest is the API runner's", aMan?.summary?.finalHash === api.summary.finalHash, `${aMan?.summary?.finalHash} vs ${api.summary.finalHash}.${hint(aMan)}`);
    check("5a. ...its interventions.jsonl is the Mem sink's, byte for byte", (await readText(`${bundle("iv-flags")}/${INTERVENTIONS_FILE}`)) === api.log, `${hint(aMan)}`);
    check("5a. ...and its manifest says the schedule and 5 applied", canon(aMan?.spec?.interventions) === canon(fullSchedule) && aMan?.interventions?.applied === 5, `${canon(aMan?.spec?.interventions)} / ${JSON.stringify(aMan?.interventions)}`);

    // (a2), (a3) --interventions FILE: the run's own log is a schedule (one JSON line each, a feed carrying the matter it moved, which
    // the replay must reproduce), and so is a JSON array of the same entries.
    const viaFile = async (exp: string, file: string, text: string) => {
      await Deno.writeTextFile(file, text);
      const r = await cli([...common(exp, full.steps), "--interventions", file]);
      const man = (await readJson(`${bundle(exp)}/manifest.json`).catch(() => null)) as { summary?: { finalHash?: string } } | null;
      return { ...r, digest: man?.summary?.finalHash, log: await readText(`${bundle(exp)}/${INTERVENTIONS_FILE}`) };
    };
    const fromLog = await viaFile("iv-log", `${tmp}/schedule.jsonl`, api.log!);
    check("5a2. --interventions FILE holding the run's own interventions.jsonl: the API runner's artifact digest and the same log", fromLog.code === 0 && fromLog.digest === api.summary.finalHash && fromLog.log === api.log, `exit ${fromLog.code}: ${fromLog.text.slice(-400)}`);
    const fromArray = await viaFile("iv-array", `${tmp}/schedule.json`, JSON.stringify(fullSchedule));
    check("5a3. --interventions FILE holding a JSON array: the same digest and log", fromArray.code === 0 && fromArray.digest === api.summary.finalHash && fromArray.log === api.log, `exit ${fromArray.code}: ${fromArray.text.slice(-400)}`);

    // (b), (c) a lab-style manifest by hand: a lesion and a feed, 300 steps, a checkpoint at 300.
    const labSteps = 300;
    const labList: ScheduledIntervention[] = [fullSchedule[1], fullSchedule[2]];
    const lab = await run(devFull, { ...full, steps: labSteps, interventions: labList });
    const labLog = parseInterventionLog(lab.log!);
    const manifestOf = (over: { matter?: number; hash?: string; startHash?: string; bare?: boolean } = {}) => ({
      runId: "lab-interventions-test",
      presetId: "spots",
      seed: full.seed,
      cfg: fullCfg,
      init: spots.init,
      ruleVersion: RULE_VERSION,
      createdAt: "2026-10-16T00:00:00.000Z",
      adapter: "test",
      userAgent: "test",
      // The lab logs the effective radius and, for a feed, the matter it moved.
      interventions: labLog.map((e) => {
        if (e.kind !== "feed") return e;
        if (over.bare) return { step: e.step, kind: e.kind, x: e.x, y: e.y, r: e.r, amount: e.amount }; // a log that lost its matter
        return over.matter !== undefined ? { ...e, matter: e.matter + over.matter } : e;
      }),
      checkpoints: [{ step: labSteps, file: "x.blck", hash: over.hash ?? stateHash(lab.final), interventions: labLog.length }],
      settings: { censusEvery: full.censusEvery, deepEvery: full.deepEvery, activityThreshold: null },
      startHash: over.startHash ?? stateHash(fullInit),
      edgesFrom: 0,
    });
    const write = async (name: string, m: object) => {
      const p = `${tmp}/${name}.run.json`;
      await Deno.writeTextFile(p, JSON.stringify(m, null, 2));
      return p;
    };
    const good = await cli([...common("iv-lab", labSteps), "--picks-from", await write("good", manifestOf())]);
    check(`5b. a lab-style manifest (a lesion and a feed, checkpoint at t=${labSteps}) replays: exit 0 and the output says it matches the lab's checkpoint at t=${labSteps}`, good.code === 0 && new RegExp(`matches the lab's checkpoint at t=${labSteps}`).test(good.text), `exit ${good.code}: ${good.text.slice(-500)}`);
    const off = await cli([...common("iv-matter", labSteps), "--picks-from", await write("matter", manifestOf({ matter: 1 }))]);
    check("5b. ...with the feed's matter off by one it exits 4 saying this is not the observed history, and the log of what was applied is there", off.code === 4 && /not the observed history/.test(off.text) && /interventions\.jsonl holds the interventions applied so far/.test(off.text) && (await readText(`${bundle("iv-matter", "replay")}/${INTERVENTIONS_FILE}`)) !== null, `exit ${off.code}: ${off.text.slice(-500)}`);
    const flipped = stateHash(lab.final).replace(/^./, (c) => (c === "0" ? "1" : "0"));
    const wrong = await cli([...common("iv-hash", labSteps), "--picks-from", await write("hash", manifestOf({ hash: flipped }))]);
    check("5c. ...with a wrong checkpoint hash it exits 4", wrong.code === 4 && !/matches the lab's checkpoint/.test(wrong.text), `exit ${wrong.code}: ${wrong.text.slice(-500)}`);

    // (d) refusals before any GPU work (exit 2, nothing written) and the stop (exit 4).
    const none = async (exp: string, by?: string) => !(await Deno.stat(bundle(exp, by)).then(() => true, () => false));
    const writeFile = async (name: string, text: string) => {
      const path = `${tmp}/${name}`;
      await Deno.writeTextFile(path, text);
      return path;
    };
    // `slug` names the experiment (a valid one: the message quotes it, so it must not hold the words the pattern looks for).
    const refused = async (slug: string, what: string, args: string[], re: RegExp, steps = full.steps) => {
      const exp = `iv-r-${slug}`;
      const r = await cli([...common(exp, steps), ...args]);
      // No bundle under either directory a run of these flags could write: the plain one, or a lab replay's -by-replay.
      check(`5d. ${what}: exit 2 saying ${re}, and no bundle`, r.code === 2 && re.test(r.text) && (await none(exp)) && (await none(exp, "replay")), `exit ${r.code}: ${r.text.slice(-400)}`);
    };
    await refused("lgrammar", "a --lesion that is not STEP:X,Y,R", ["--lesion", "5:1,1"], /expected STEP:X,Y,R/);
    await refused("fgrammar", "a --feed that is not STEP:X,Y,R,AMOUNT", ["--feed", "5:1,1,1"], /expected STEP:X,Y,R,AMOUNT/);
    await refused("late", "an entry after --steps", ["--lesion", `${full.steps + 1}:1,1,1`], /after the run's last step/);
    await refused("off", "a centre outside the world", ["--lesion", `5:${worldW(fullCfg)},1,1`], /outside the world/);
    // Names that sit on Object.prototype are unknown keys like any other, not silently dropped (a plain {} already "has" them).
    for (const key of ["constructor", "toString", "hasOwnProperty", "__proto__"])
      await refused(`key${key.toLowerCase()}`, `an unknown key ${key}`, ["--interventions", await writeFile(`key-${key}.json`, `[{"step":1,"kind":"lesion","x":1,"y":1,"r":1,${JSON.stringify(key)}:7}]`)], new RegExp(`a lesion has no key "${key}"`));
    const bareFeed = await write("bare", manifestOf({ bare: true }));
    await refused("bare", "a lab manifest whose feed lost its matter", ["--picks-from", bareFeed], /a logged feed needs the matter it moved/, labSteps);
    const driftFlip = stateHash(fullInit).replace(/^./, (c) => (c === "0" ? "1" : "0"));
    await refused("drift", "a lab manifest whose start hash this checkout does not build", ["--picks-from", await write("drift", manifestOf({ startHash: driftFlip }))], /start world has changed since/, labSteps);
    // A founder option would build another start world under the same config, which the start-hash check (it hashes the preset's) cannot see.
    await refused("solo", "a lab manifest with --solo-founder", ["--picks-from", await write("solo", manifestOf()), "--solo-founder", "0"], /the manifest is the history, and its start world is the preset's/, labSteps);
    // Refused before the branch source is read (so a source that does not exist never gets to answer first): a branch would start
    // mid-history and skip every logged entry before its boundary, and a nat or shuf pond manifest is not a picked run, so validateSpec's
    // picked-and-branch exclusion would not catch it.
    await refused("branch", "a lab manifest with --branch-from", ["--picks-from", await write("branch", manifestOf()), "--branch-from", `${tmp}/nowhere`, "--branch-boundary", "1"], /--picks-from cannot be combined with --branch-from/, labSteps);

    // A feed at step 0 that does not reproduce its matter is applied on the CPU before the run writes a file: exit 4, and the message
    // does not point at a log that does not exist. One at a later step stops inside the run, with the log begun.
    const feedAt = (step: number, matter: number) => ({ step, kind: "feed", x: f2.x, y: f2.y, r: 3, amount: 4, matter });
    const atZero = await cli([...common("iv-stop-zero", 100), "--interventions", await writeFile("stop-zero.json", JSON.stringify([feedAt(0, 1)]))]);
    check("5d. a step-0 feed that does not reproduce its matter: exit 4, 'nothing was written', no bundle directory, and no pointer to a log", atZero.code === 4 && /not the observed history/.test(atZero.text) && /stopped before it began; nothing was written/.test(atZero.text) && !/holds the interventions applied/.test(atZero.text) && (await none("iv-stop-zero")), `exit ${atZero.code}: ${atZero.text.slice(-400)}`);
    const later = await cli([...common("iv-stop-late", 300), "--interventions", await writeFile("stop-late.json", JSON.stringify([{ step: 50, kind: "lesion", x: f1.x, y: f1.y, r: 5 }, feedAt(200, 1)]))]);
    check("5d. ...one at step 200: exit 4, the log holds the lesion before it and the message says so", later.code === 4 && /holds the interventions applied so far/.test(later.text) && (await readText(`${bundle("iv-stop-late")}/${INTERVENTIONS_FILE}`)) === textOf([{ step: 50, kind: "lesion", x: f1.x, y: f1.y, r: 5 }]), `exit ${later.code}: ${later.text.slice(-400)}`);
  });
} finally {
  await Deno.remove(tmp, { recursive: true }).catch(() => {});
}

console.log(`${checks - failures} of ${checks} checks passed in ${((performance.now() - T0) / 1000).toFixed(1)} s`);
Deno.exit(ok ? 0 : 1);
