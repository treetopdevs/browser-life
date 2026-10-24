// The regime instrument on a real native WebGPU device, tests (b) and (d) of docs/3d-regime-meters-plan-2026-10-23.md section 8.3
// (packages/sim-gpu/src/regime.ts: kickSites, kickBalls, unitKick, applyKick, writeKick). Seeds 9900 and up only.
//
//  b. The kick conserves. Right after the kick and again after 300 lockstep steps, for the reference and every twin (S, U, the
//     doses, the F pair), matter equals R's own initial total, the energy ledger residual is 0 and validateState is clean; the
//     device cells differ from the frozen reference in the kicked voxels and nowhere else; and the negative control (the
//     matter move without its heat entry) leaves a residual of exactly -(sum of kicks) * (eB - eC). Overlapping balls kick
//     each voxel once, by floor(B / 2) of the frozen value, and never underflow. The contract errors of the kick API throw.
//  d. The oracle. RefSim3, the executable specification, started from the twin's state right after the kick (read back, so the
//     step, light, heat and flux are the device's own; it is also C3, validateState on the kicked state), matches the device's
//     state hash after 50 steps, for rung P1, rung P2 and the unit-kick control: a kicked state is a legal state of the rules.
//
// Run from the repo root: deno run -A --no-lock tests/deno/regime_conserve.ts
import { CH, cloneState, stateHash, validateState } from "@bl/schema";
import { RefSim3 } from "@bl/sim-ref";
import {
  applyKick,
  ballVoxels,
  blockGrid,
  createDiff,
  createTwin,
  freezeRef,
  kickBalls,
  kickSites,
  requestDevice3,
  unitKick,
  writeKick,
  type KickSet,
  type RefSimLike,
} from "@bl/sim-gpu";
import { Checker, buildBank, burnIn, c2, keyedOrder, pickSites, runBank, scaleOf, slabWorld, startHash, uptime, type AnySim } from "./regime_lib.ts";

const T0 = performance.now();
const t = new Checker("regime_conserve");
console.log(await uptime());

/** Names of the voxels where two cells arrays differ in channel `ch`. */
function differing(a: Uint32Array, b: Uint32Array, n: number, ch: number): number[] {
  const out: number[] = [];
  for (let v = 0; v < n; v++) if (a[ch * n + v] !== b[ch * n + v]) out.push(v);
  return out;
}

/** The device cells of a kicked twin equal the frozen cells with exactly the kick applied: B down and C up by the amounts, nothing else. */
function kickIsExact(frozen: Uint32Array, got: Uint32Array, n: number, kick: KickSet): boolean {
  const want = frozen.slice();
  for (let j = 0; j < kick.voxels.length; j++) {
    want[CH.B * n + kick.voxels[j]] -= kick.amounts[j];
    want[CH.C * n + kick.voxels[j]] += kick.amounts[j];
  }
  for (let i = 0; i < want.length; i++) if (want[i] !== got[i]) return false;
  return true;
}

// ---- b. the kick conserves
console.log("-- b. the kick conserves");
{
  const world = slabWorld(9910, 128, 128);
  const device = await requestDevice3(navigator.gpu, world.cfg);
  const eBC = BigInt(world.cfg.eB - world.cfg.eC);
  const ref = await burnIn(device, world, 600);
  for (const rung of ["P1", "P2"] as const) {
    const bank = await buildBank(world, ref, {
      rung,
      maxSites: 9,
      dsep: 40,
      doses: [4, 8, 16, 32, 64],
      steps: { Z: 300, S: 300, U: 300, N: 300, dose: 300 },
      F: true,
    });
    const g = bank.g;
    const n = g.n;
    console.log(`${rung}: B* ${bank.scale.Bstar}, k ${bank.scale.k}, thresholds ${bank.thetaB}/${bank.thetaV}, ${bank.sites.length} sites, S dose ${bank.kicks.S.total} in ${bank.kicks.S.blocks.length} blocks, U dose ${bank.kicks.U.total}, doses ${bank.kicks.doses.map((d) => `${d.m}:${d.run ? d.kick.total : "-"}`).join(" ")}`);
    t.check(`${rung}: the S kick has sites to kick and the U kick is no larger than a quarter of it`, bank.sites.length >= 3 && bank.kicks.U.total * 4 <= bank.kicks.S.total, `sites ${bank.sites.length}, U ${bank.kicks.U.total}, S ${bank.kicks.S.total}`);
    const kicked: [string, KickSet][] = [["S", bank.kicks.S], ["U", bank.kicks.U], ["XF", bank.kicks.S], ...bank.kicks.doses.filter((d) => d.run).map((d) => [`D${d.m}`, d.kick] as [string, KickSet])];
    // right after the kick, before any step
    for (const [name, kick] of kicked) {
      const sim = bank.sims[name] as AnySim;
      const state = await sim.readState();
      const errs = validateState(state);
      t.check(`${rung} ${name}: validateState is clean right after the kick (C3)`, errs.length === 0, errs.join("; "));
      const r = await c2(sim, world);
      t.check(`${rung} ${name}: matter delta 0 and ledger residual 0 right after the kick`, r.ok, `delta ${r.matterDelta}, residual ${r.residual}`);
      t.check(`${rung} ${name}: the device cells are the frozen cells with exactly the kick applied (B down, C up, nothing else)`, kickIsExact(bank.frozen.cells, state.cells, n, kick));
      t.check(`${rung} ${name}: heatOut rose by the dose times (eB - eC)`, state.heatOut === bank.frozen.heatOut + BigInt(kick.total) * eBC, `${state.heatOut} against ${bank.frozen.heatOut} + ${kick.total} * ${eBC}`);
    }
    // after 300 steps
    await runBank(bank, 300);
    const every: [string, AnySim][] = [["R", ref], ...Object.entries(bank.sims)];
    let bad = "";
    for (const [name, sim] of every) {
      const r = await c2(sim, world);
      if (!r.ok) bad += ` ${name}(delta ${r.matterDelta}, residual ${r.residual})`;
    }
    t.check(`${rung}: matter delta 0 and ledger residual 0 after 300 steps for R and all ${every.length - 1} twins and controls`, bad === "", bad);
    for (const name of ["S", "U", "XF"]) {
      const errs = validateState(await (bank.sims[name] as AnySim).readState());
      t.check(`${rung} ${name}: validateState is clean after 300 steps`, errs.length === 0, errs.join("; "));
    }
    // the negative control: the matter move without its heat entry
    const S0 = await createTwin(ref, world.state0);
    // The bank ran the reference on; this fork is of the reference as it is now, so the kick is taken against a fresh freeze.
    const fr2 = await freezeRef(ref as RefSimLike);
    const g2 = blockGrid(ref.cfg);
    const B2 = fr2.cells.subarray(CH.B * n, (CH.B + 1) * n);
    const sc2 = scaleOf(fr2.cells, n);
    const sites2 = pickSites(g2, sc2.E, startHash(ref.cfg.seed, fr2.step), 6, 40);
    const k2 = rung === "P1" ? kickSites(g2, B2, sites2, sc2.k) : kickBalls(g2, B2, sites2);
    writeKick(S0, fr2, k2);
    const r0 = await c2(S0, world);
    t.check(`${rung}: negative control: no heat entry gives a residual of exactly -(dose) * (eB - eC), matter still exact`, r0.matterDelta === 0n && r0.residual === -BigInt(k2.total) * eBC, `delta ${r0.matterDelta}, residual ${r0.residual}, expected ${-BigInt(k2.total) * eBC}`);
    S0.run(20);
    const r20 = await c2(S0, world);
    t.check(`${rung}: ...and the residual does not change over 20 more steps`, r20.matterDelta === 0n && r20.residual === r0.residual, `residual ${r20.residual}`);
    S0.destroy();
    bank.destroy();
  }
  ref.destroy();

  // overlapping balls: each voxel once, by floor(B / 2) of the frozen value; no underflow
  const ref2 = await burnIn(device, world, 600);
  const frozen = await freezeRef(ref2 as RefSimLike);
  const g = blockGrid(ref2.cfg);
  const n = g.n;
  const B = frozen.cells.subarray(CH.B * n, (CH.B + 1) * n);
  const C = frozen.cells.subarray(CH.C * n, (CH.C + 1) * n);
  let v0 = 0;
  for (let v = 0; v < n; v++) if (B[v] > B[v0]) v0 = v;
  const centres = [v0, v0 + 2, v0 + g.W, v0 + 1]; // three to four mutually overlapping balls around the densest voxel
  const union = kickBalls(g, B, centres);
  const single = centres.map((c) => kickBalls(g, B, [c]));
  const cover = new Map<number, number>();
  for (const c of centres) for (const v of ballVoxels(g, c)) if (B[v] >= 3) cover.set(v, (cover.get(v) ?? 0) + 1);
  t.check("overlapping balls: the kicked set is the sorted union of the balls' voxels with B >= 3", JSON.stringify(Array.from(union.voxels)) === JSON.stringify([...cover.keys()].sort((a, b) => a - b)));
  t.check("overlapping balls: some voxels lie in 2 or more balls, and the union total is below the sum of the single balls", Math.max(...cover.values()) >= 2 && union.total < single.reduce((a, k) => a + k.total, 0), `max cover ${Math.max(...cover.values())}, union ${union.total}, sum ${single.reduce((a, k) => a + k.total, 0)}`);
  t.check("overlapping balls: every kicked voxel is kicked once, by floor(B / 2) of its frozen value", Array.from(union.voxels).every((v, j) => union.amounts[j] === B[v] >>> 1));
  t.check("overlapping balls: voxels with B below 3 are not kicked", Array.from(union.voxels).every((v) => B[v] >= 3));
  t.check("a ball has at most 123 voxels in a slab", ballVoxels(g, v0).length <= 123 && ballVoxels(g, 4 * g.W * g.H + 5 * g.W + 5).length === 123);
  const twin = await createTwin(ref2, world.state0);
  applyKick(twin, frozen, union);
  const after = await twin.readCells();
  const kickedSet = new Set(union.voxels);
  let underflow = false, exact = true;
  for (let v = 0; v < n; v++) {
    if (after[CH.B * n + v] > B[v]) underflow = true;
    const want = kickedSet.has(v) ? B[v] - (B[v] >>> 1) : B[v];
    if (after[CH.B * n + v] !== want) exact = false;
    if (after[CH.C * n + v] !== C[v] + (kickedSet.has(v) ? B[v] >>> 1 : 0)) exact = false;
  }
  t.check("overlapping balls: no voxel of B went up (no unsigned underflow) and B and C equal the expected arrays", !underflow && exact);
  const rb = await c2(twin, world);
  t.check("overlapping balls: matter delta 0 and ledger residual 0, validateState clean", rb.ok && validateState(await twin.readState()).length === 0, `delta ${rb.matterDelta}, residual ${rb.residual}`);
  // the unit-kick control: floor(k_v / 8), at least 1, at every voxel the full kick touches
  const u = unitKick(g, union);
  t.check("the unit-kick control kicks every voxel of the full kick, by max(1, floor(k_v / 8))", u.voxels.length === union.voxels.length && Array.from(u.voxels).every((v, j) => v === union.voxels[j] && u.amounts[j] === Math.max(1, Math.floor(union.amounts[j] / 8))));
  t.check("...so it is never empty, and some voxels keep the minimum of 1 below the divisor", u.total >= u.voxels.length && Array.from(union.amounts).some((a) => a < 8));

  // contract errors
  const throws = (f: () => unknown) => { try { f(); return false; } catch { return true; } };
  const okB = Array.from({ length: 4 }, (_, i) => (i === 0 ? 20 : 5));
  const gg = blockGrid(ref2.cfg);
  t.check("kickSites refuses a duplicated site", throws(() => kickSites({ ...gg, n: 4 }, okB, [0, 0], 12)));
  t.check("kickSites refuses a site that would not stay living (B < k + 1)", throws(() => kickSites({ ...gg, n: 4 }, okB, [1], 12)));
  t.check("kickSites accepts B = k + 1", !throws(() => kickSites({ ...gg, n: 4 }, [13, 1, 1, 1], [0], 12)));
  t.check("kickSites refuses B = k exactly (the voxel would be left empty, not living)", throws(() => kickSites({ ...gg, n: 4 }, [12, 1, 1, 1], [0], 12)));
  t.check("kickSites refuses a site that is not a voxel of the world (too large, negative, fractional)", throws(() => kickSites({ ...gg, n: 4 }, [13, 13, 13, 13], [4], 12)) && throws(() => kickSites({ ...gg, n: 4 }, [13, 13, 13, 13], [-1], 12)) && throws(() => kickSites({ ...gg, n: 4 }, [13, 13, 13, 13], [1.5], 12)));
  t.check("kickSites refuses k below 1", throws(() => kickSites({ ...gg, n: 4 }, [13, 13, 13, 13], [0], 0)));
  const bogus: KickSet = { voxels: Uint32Array.of(v0), amounts: Uint32Array.of(B[v0] + 1), total: B[v0] + 1, blocks: Uint32Array.of(0), blockSums: Uint32Array.of(B[v0] + 1) };
  const fresh = await createTwin(ref2, world.state0);
  t.check("writeKick refuses a kick larger than the voxel's B (underflow)", throws(() => writeKick(fresh, frozen, bogus)));
  t.check("writeKick refuses unsorted voxels", throws(() => writeKick(fresh, frozen, { ...union, voxels: Uint32Array.from([...union.voxels].reverse()) })));
  t.check("writeKick refuses a voxel outside the world", throws(() => writeKick(fresh, frozen, { ...bogus, voxels: Uint32Array.of(n), amounts: Uint32Array.of(1), total: 1 })));
  t.check("writeKick refuses frozen cells that are not of this world", throws(() => writeKick(fresh, { ...frozen, cells: frozen.cells.slice(0, 100) }, union)));
  fresh.run(1);
  t.check("writeKick refuses a twin that has stepped since the freeze", throws(() => writeKick(fresh, frozen, union)));
  t.check("createDiff refuses a zero threshold", await createDiff(ref2, fresh, { startStep: 0, maxSteps: 1, thetaB: 0, thetaV: 1 }).then(() => false, () => true));
  t.check("blockGrid refuses a world that is not a whole number of blocks", throws(() => blockGrid({ ...ref2.cfg, tileW: 30 })));
  fresh.destroy();
  twin.destroy();
  ref2.destroy();
  device.destroy();
}

// ---- d. the oracle: RefSim3 from the kicked state matches the device after 50 steps
console.log("-- d. the oracle");
{
  const world = slabWorld(9911, 32, 32);
  const device = await requestDevice3(navigator.gpu, world.cfg);
  const ref = await burnIn(device, world, 300);
  const frozen = await freezeRef(ref as RefSimLike);
  const g = blockGrid(ref.cfg);
  const n = g.n;
  const B = frozen.cells.subarray(CH.B * n, (CH.B + 1) * n);
  const sc = scaleOf(frozen.cells, n);
  const h0 = startHash(ref.cfg.seed, frozen.step);
  const sites = pickSites(g, sc.E, h0, 4, 8);
  t.check("the oracle world has 4 sites to kick", sites.length === 4, `${sites.length}`);
  const balls = kickBalls(g, B, sites);
  let v0 = 0;
  for (let v = 0; v < n; v++) if (B[v] > B[v0]) v0 = v;
  const overlap = kickBalls(g, B, [v0, v0 + 2, v0 + g.W]); // overlapping balls: the union rule on the oracle too
  const cases: [string, KickSet][] = [["P1 S", kickSites(g, B, sites, sc.k)], ["P1 U", unitKick(g, kickSites(g, B, sites, sc.k))], ["P2 S", balls], ["P2 U", unitKick(g, balls)], ["P2 overlapping balls", overlap]];
  for (const [name, kick] of cases) {
    const twin = await createTwin(ref, world.state0);
    applyKick(twin, frozen, kick);
    const s0 = await twin.readState();
    t.check(`${name}: the kicked state is legal (validateState clean; ${kick.voxels.length} voxels, dose ${kick.total})`, validateState(s0).length === 0);
    const cpu = new RefSim3(cloneState(s0));
    cpu.run(50);
    twin.run(50);
    const gpuState = await twin.readState();
    t.check(`${name}: RefSim3 from the kicked state matches the device state hash after 50 steps`, stateHash(cpu.state) === stateHash(gpuState), `${stateHash(cpu.state)} against ${stateHash(gpuState)}`);
    twin.destroy();
  }
  // and the reference itself, to show the oracle is the same arithmetic on the unkicked state
  const s0 = await ref.readState();
  const cpu = new RefSim3(cloneState(s0));
  cpu.run(50);
  ref.run(50);
  t.check("the unkicked reference: RefSim3 matches the device after 50 steps", stateHash(cpu.state) === stateHash(await ref.readState()));
  ref.destroy();
  device.destroy();
}

console.log(`${((performance.now() - T0) / 1000).toFixed(1)} s`);
console.log(await uptime());
t.done();
