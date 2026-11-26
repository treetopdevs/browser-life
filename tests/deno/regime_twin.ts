// The regime instrument on a real native WebGPU device, tests (a) and (f) of docs/3d-regime-meters-plan-2026-10-23.md section 8.3
// (packages/sim-gpu/src/regime.ts: forkSim, createTwin, createDiff, runLockstep). Seeds 9900 and up only.
//
//  a. No kick, no difference. A fork with no kick stays equal to the reference: every counter of the zero control (DIFF_ZERO_COLS)
//     is 0 at every step, the living and biomass totals agree, and the full state hash (cells, current genome, ledger, step) is
//     equal to the reference's, at 32 x 32 x 8 and 128 x 128 x 8 for 200 steps and at 256 x 256 x 8 for 100 steps with the reference
//     as the continuing burn-in sim (as the probe did). A fork taken at an odd step (the current genome buffer is index 1) is
//     exercised. A genome difference that no counter can see (an unread padding byte of one voxel's genome) leaves every counter
//     at 0 and is caught by the hash alone: that is why C1 compares full-state hashes.
//  f. Re-run. The whole twin phase of a small job (burn-in, freeze, bank of Z S U N doses and the F pair, lockstep, logs, final state
//     hashes) run three times, once with one step per command buffer, reproduces itself exactly. This is the instrument-level
//     reading of "one job re-run reproduces its JSON except timings and device": the runner (M2) does not exist yet, so the
//     whole-job version of this test waits for it.
//
// Run from the repo root: deno run -A --no-lock tests/deno/regime_twin.ts
import { GENOME_CHANNELS3, stateHash } from "@bl/schema";
import { DIFF_GLOBAL_WORDS, DIFF_ZERO_COLS, createDiff, createTwin, freezeRef, requestDevice3, runLockstep, type DiffLog, type RefSimLike } from "@bl/sim-gpu";
import { Checker, buildBank, burnIn, hashOf, runBank, scaleOf, slabWorld, uptime, type AnySim, type World } from "./regime_lib.ts";

const T0 = performance.now();
const t = new Checker("regime_twin");
console.log(await uptime());

// ---- runLockstep's callbacks report steps that are on the device (a queue mock; no GPU): batch not a multiple of stepsPerSubmit
{
  const mock = (steps: number, stepsPerSubmit: number, batch: number) => {
    let submittedRef = 0, submittedTwin = 0, submits = 0;
    const calls: { t: number; ref: number; twin: number }[] = [];
    const enc = () => ({ ref: 0, twin: 0, finish() { return { ref: this.ref, twin: this.twin }; } });
    const device = {
      createCommandEncoder: () => enc(),
      queue: { submit: (bufs: { ref: number; twin: number }[]) => { for (const b of bufs) { submittedRef += b.ref; submittedTwin += b.twin; } submits++; }, onSubmittedWorkDone: async () => {} },
    };
    const ref = { device, n: 0, encodeStep: (e: { ref: number }) => { e.ref++; } };
    const twin = { device, n: 0, encodeStep: (e: { twin: number }) => { e.twin++; } };
    return runLockstep(ref as never, [{ sim: twin as never, diff: null, steps: 60 }], steps, {
      stepsPerSubmit, batch, onBatch: (done) => { calls.push({ t: done, ref: submittedRef, twin: submittedTwin }); },
    }).then((r) => ({ r, calls, submittedRef, submittedTwin, submits }));
  };
  // The exact submit count and callback sequence of each case, derived from the loop (a command buffer is submitted when `per` steps are encoded or a batch
  // ends; onBatch runs after that submit, at every multiple of `batch` and at the last step): 105 steps at 7 per submit with batches of 100 flush the two
  // steps held at step 100 (15 submits by then) and the five held at step 105 (16).
  const WANT: Record<string, { submits: number; callbacks: number[] }> = {
    "105/7/100": { submits: 16, callbacks: [100, 105] },
    "100/30/100": { submits: 4, callbacks: [100] },
    "240/7/50": { submits: 38, callbacks: [50, 100, 150, 200, 240] },
    "30/10/100": { submits: 3, callbacks: [30] },
    "100/10/100": { submits: 10, callbacks: [100] },
    "17/1/5": { submits: 17, callbacks: [5, 10, 15, 17] },
  };
  for (const [steps, per, batch] of [[105, 7, 100], [100, 30, 100], [240, 7, 50], [30, 10, 100], [100, 10, 100], [17, 1, 5]] as const) {
    const m = await mock(steps, per, batch);
    const want = WANT[`${steps}/${per}/${batch}`];
    t.check(`runLockstep(${steps} steps, ${per} per submit, batch ${batch}): every callback finds the steps it reports submitted`, m.calls.length > 0 && m.calls.every((c) => c.ref === c.t && c.twin === Math.min(c.t, 60)), JSON.stringify(m.calls.filter((c) => c.ref !== c.t)));
    t.check(`...and the run ends with all ${steps} steps submitted, ${m.r.submits} submits`, m.submittedRef === steps && m.submittedTwin === Math.min(steps, 60) && m.r.done === steps && m.r.simSteps === steps + Math.min(steps, 60));
    t.check(`...exactly ${want.submits} submits (the queue saw ${m.submits}) and callbacks at ${want.callbacks.join(", ")}`, m.r.submits === want.submits && m.submits === want.submits && JSON.stringify(m.calls.map((c) => c.t)) === JSON.stringify(want.callbacks), `submits ${m.r.submits} / ${m.submits}, callbacks ${m.calls.map((c) => c.t).join(",")}`);
  }
  const exact = await mock(100, 10, 100);
  t.check("batch a multiple of stepsPerSubmit: the same 10 submits as before (no extra flush)", exact.r.submits === 10 && exact.calls.length === 1 && exact.calls[0].t === 100);
}

/** Counters of the zero control are 0 at every row, and the census totals agree. Returns the first offending row, or -1. */
function firstNonZeroRow(log: DiffLog): number {
  for (let r = 0; r < log.rows; r++) {
    for (const c of DIFF_ZERO_COLS) if (log.at(r, c) !== 0) return r;
    if (log.at(r, "live_R") !== log.at(r, "live_X") || log.at(r, "SB_R") !== log.at(r, "SB_X")) return r;
  }
  return -1;
}

async function zeroFork(device: GPUDevice, world: World, T: number, steps: number, hashAt: number[], label: string) {
  const ref = await burnIn(device, world, T);
  const frozen = await freezeRef(ref as RefSimLike);
  const n = ref.n;
  const sc = scaleOf(frozen.cells, n);
  const Z = await createTwin(ref, world.state0);
  t.check(`${label}: the fork equals the reference before any step (full state hash, step ${frozen.step})`, (await hashOf(ref)) === (await hashOf(Z)));
  const diff = await createDiff(ref, Z, { startStep: frozen.step, maxSteps: steps, thetaB: sc.thetaB, thetaV: sc.thetaV });
  const members = [{ sim: Z as AnySim, diff, steps }];
  let done = 0;
  let allEqual = true;
  for (const h of hashAt) {
    await runLockstep(ref, members, h - done, { done, initial: done === 0 });
    done = h;
    const same = (await hashOf(ref)) === (await hashOf(Z));
    allEqual &&= same;
    if (!same) t.check(`${label}: hash at step ${h}`, false);
  }
  t.check(`${label}: the fork and the reference have equal full-state hashes at steps ${hashAt.join(", ")} after the fork`, allEqual);
  const log = await diff.read();
  const bad = firstNonZeroRow(log);
  t.check(`${label}: every zero-control counter is 0 at every step 0 to ${steps} (${log.rows} rows)`, bad < 0, `row ${bad}: ${Array.from(log.row(Math.max(bad, 0))).join(",")}`);
  t.check(`${label}: liveblk_R is positive and live_R equals the reference's living count`, log.at(steps, "liveblk_R") > 0 && log.at(steps, "live_R") === (await (ref as RefSimLike).readStats()).living, `live_R ${log.at(steps, "live_R")}`);
  diff.destroy();
  Z.destroy();
  return ref;
}

// ---- a. no kick, no difference
console.log("-- a. no kick, no difference");
{
  // 32 x 32 x 8, forked at an odd step (the genome buffer in use is index 1)
  const world = slabWorld(9901, 32, 32);
  const device = await requestDevice3(navigator.gpu, world.cfg);
  const ref = await zeroFork(device, world, 301, 200, [1, 50, 200], "32x32x8");
  ref.destroy();
  // 128 x 128 x 8
  const w128 = slabWorld(9902, 128, 128);
  const r128 = await zeroFork(device, w128, 500, 200, [1, 100, 200], "128x128x8");
  r128.destroy();
  device.destroy();
}
{
  // 256 x 256 x 8 with the reference as the continuing burn-in sim (as the probe did): 600 steps, fork, 100 steps
  const world = slabWorld(9903, 256, 256);
  const device = await requestDevice3(navigator.gpu, world.cfg);
  const ref = await zeroFork(device, world, 600, 100, [100], "256x256x8");
  ref.destroy();
  device.destroy();
}
{
  // A genome-only difference: one voxel's unread padding byte (bits 8 to 31 of the last genome word of a slab genome).
  const world = slabWorld(9904, 32, 32);
  const device = await requestDevice3(navigator.gpu, world.cfg);
  const ref = await burnIn(device, world, 300);
  const frozen = await freezeRef(ref as RefSimLike);
  const n = ref.n;
  const sc = scaleOf(frozen.cells, n);
  let v = 0;
  for (const e of sc.E) if (frozen.cells[n + e] > frozen.cells[n + v]) v = e; // the densest voxel (CH.B is channel 1)
  const Z = await createTwin(ref, world.state0);
  const word = (await (Z as AnySim).readGenomeChannels(GENOME_CHANNELS3 - 1, 1))[v];
  const poked = (word | 0x100) >>> 0;
  Z.device.queue.writeBuffer(Z.genome[0], ((GENOME_CHANNELS3 - 1) * n + v) * 4, Uint32Array.of(poked));
  Z.device.queue.writeBuffer(Z.genome[1], ((GENOME_CHANNELS3 - 1) * n + v) * 4, Uint32Array.of(poked));
  const diff = await createDiff(ref, Z, { startStep: frozen.step, maxSteps: 100, thetaB: sc.thetaB, thetaV: sc.thetaV });
  await runLockstep(ref, [{ sim: Z as AnySim, diff, steps: 100 }], 100, { initial: true });
  const log = await diff.read();
  t.check("a genome-only difference (an unread padding byte) leaves every counter at 0 for 100 steps", firstNonZeroRow(log) < 0, `row ${firstNonZeroRow(log)}`);
  t.check("...and the full-state hash sees it (C1 compares hashes, not counters alone)", (await hashOf(ref)) !== (await hashOf(Z)));
  diff.destroy();
  Z.destroy();
  ref.destroy();
  device.destroy();
}

// ---- f. re-run: the whole twin phase of a small job reproduces itself
console.log("-- f. re-run");
{
  const world = slabWorld(9905, 64, 64);
  const device = await requestDevice3(navigator.gpu, world.cfg);
  const job = async (stepsPerSubmit: number, rung: "P1" | "P2") => {
    const ref = await burnIn(device, world, 400);
    const bank = await buildBank(world, ref, {
      rung,
      maxSites: 4,
      dsep: 16,
      doses: [4, 8, 16],
      steps: { Z: 20, S: 60, U: 40, N: 40, dose: 40 },
      F: true,
    });
    const stateHashT = await hashOf(ref);
    const logs = await runBank(bank, bank.length, { stepsPerSubmit });
    const hashes: Record<string, string> = { R: await hashOf(ref) };
    for (const [name, sim] of Object.entries(bank.sims)) hashes[name] = stateHash(await sim.readState());
    const record = {
      stateHashT,
      scale: { ...bank.scale, E: bank.scale.E.length },
      sites: bank.sites,
      thresholds: [bank.thetaB, bank.thetaV],
      liveblk: bank.liveblk,
      kicks: { S: [bank.kicks.S.total, bank.kicks.S.blocks.length], U: [bank.kicks.U.total, bank.kicks.U.blocks.length], doses: bank.kicks.doses.map((d) => [d.m, d.run, d.kick.total, d.kick.blocks.length]) },
      members: bank.members.length,
      logs: Object.fromEntries(Object.entries(logs).map(([k, l]) => [k, Array.from(l.words)])),
      hashes,
    };
    bank.destroy();
    ref.destroy();
    return record;
  };
  for (const rung of ["P1", "P2"] as const) {
    const a = await job(10, rung);
    const b = await job(10, rung);
    const c = await job(1, rung);
    console.log(`${rung}: ${a.members} members, ${a.sites.length} sites, thresholds ${a.thresholds.join("/")}, doses (m, run, total, blocks) ${JSON.stringify(a.kicks.doses)}`);
    t.check(`${rung}: the twin phase has the members it should (Z S U N, the doses that pass the cap, the F pair)`, a.members >= 6, `members ${a.members}`);
    t.check(`${rung}: S has a non-trivial log (damage after the kick)`, a.logs.S.length === 61 * (DIFF_GLOBAL_WORDS + 4 * a.sites.length) && a.logs.S.some((x) => x !== 0));
    t.check(`${rung}: a re-run reproduces the logs, hashes, kicks and scale exactly`, JSON.stringify(a) === JSON.stringify(b));
    t.check(`${rung}: ...and so does a run with one lockstep step per command buffer`, JSON.stringify(a) === JSON.stringify(c));
  }
  device.destroy();
}

console.log(`${((performance.now() - T0) / 1000).toFixed(1)} s`);
console.log(await uptime());
t.done();
