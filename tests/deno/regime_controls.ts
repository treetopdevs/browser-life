// The regime instrument on a real native WebGPU device, test (g) of docs/3d-regime-meters-plan-2026-10-23.md section 8.3 and the
// code rows of the rule's boundary table (R14, rows marked "code"): the controls and what makes a frozen scar frozen.
// packages/sim-gpu/src/regime.ts: createControlSim, controlConfig, noiseSeed. Seeds 9900 and up only.
//
//  g1. The share3 at-rest table, on the reference arithmetic (share3 and w1d of @bl/sim-ref, the weights 8, 64, 8 over 80 of an
//      interior voxel at rest): a voxel keeps all of B for B = 12, 13 and 16 and 18, 29 and 64 of B = 20, 39 and 100 (also 17, 27,
//      30 and 60: 15, 23, 24 and 42). The device side of this arithmetic is carried by g3: the device state hash equals RefSim3's.
//  g2. The control configurations (C8): the N twin's cfg differs from R's only in `seed` (= noiseSeed), the F pair's only in
//      `dtQ` (0) and `motility` (false), the fork twins' not at all; and C2 passes for N and F against R's own initial totals.
//  g3. Retention. On the F pair (R_F, and X_F carrying a 12-unit kick on a voxel with B = 13) a voxel with B <= 16 sends nothing, so
//      the kick stays where it is for 100 steps: on the device log (one damaged block, one differing voxel, a B deficit of exactly
//      12) and in RefSim3 started from the same states, whose state hashes equal the device's after 100 steps. The same kick on a
//      fork with the project's own configuration spreads, which is what the frozen control is the opposite of. The N twin starts
//      equal to R (row 0 is zero) and differs from step 1 on.
//
// Run from the repo root: deno run -A --no-lock tests/deno/regime_controls.ts
import { CH, cloneState, lowbias32, stateHash } from "@bl/schema";
import { RefSim3, share3, w1d } from "@bl/sim-ref";
import {
  applyKick,
  blockGrid,
  blockOf,
  DIFF_ZERO_COLS,
  configDiff,
  controlConfig,
  createControlSim,
  createDiff,
  createTwin,
  freezeRef,
  kickSites,
  noiseSeed,
  requestDevice3,
  runLockstep,
  type RefSimLike,
} from "@bl/sim-gpu";
import { Checker, burnIn, c2, slabWorld, uptime, type AnySim } from "./regime_lib.ts";

const T0 = performance.now();
const t = new Checker("regime_controls");
console.log(await uptime());

// ---- g1. the share3 at-rest table (R14, code rows)
console.log("-- g1. share3 at rest");
{
  const hw = 40, d1 = 80; // spread 8: weights 8, 64, 8 over 80
  const w = (o: number) => w1d(0, o, hw);
  t.check("w1d at rest gives the weights 8, 64, 8", w(-1) === 8 && w(0) === 64 && w(1) === 8);
  const keeps = (q: number) => {
    let sent = 0;
    for (let tz = -1; tz <= 1; tz++) for (let ty = -1; ty <= 1; ty++) for (let tx = -1; tx <= 1; tx++) if (tx || ty || tz) sent += share3(q, w(tx), w(ty), w(tz), d1);
    return q - sent;
  };
  t.check("share3 at rest: B = 12, 13, 16 all stay", [12, 13, 16].every((q) => keeps(q) === q), [12, 13, 16].map(keeps).join(","));
  t.check("share3 at rest: B = 20, 39, 100 keep 18, 29, 64", keeps(20) === 18 && keeps(39) === 29 && keeps(100) === 64, [20, 39, 100].map(keeps).join(","));
  t.check("share3 at rest: B = 17, 27, 30, 60 keep 15, 23, 24, 42", keeps(17) === 15 && keeps(27) === 23 && keeps(30) === 24 && keeps(60) === 42, [17, 27, 30, 60].map(keeps).join(","));
}

// ---- g2, g3. controls and retention on a 32 x 32 x 8 world
console.log("-- g2, g3. controls and retention");
{
  const world = slabWorld(9903, 32, 32);
  const device = await requestDevice3(navigator.gpu, world.cfg);
  const ref = await burnIn(device, world, 300);
  const frozen = await freezeRef(ref as RefSimLike);
  const g = blockGrid(ref.cfg);
  const n = g.n;
  const B = frozen.cells.subarray(CH.B * n, (CH.B + 1) * n);
  let site = -1;
  for (let v = 0; v < n && site < 0; v++) if (B[v] === 13) site = v;
  t.check("the world has a voxel with B = 13 to kick", site >= 0);
  const kick = kickSites(g, B, [site], 12);
  const siteBlock = blockOf(g, site);

  // g2: configurations
  const N = await createControlSim(ref, world.state0, "N");
  const RF = await createControlSim(ref, world.state0, "F");
  const XF = await createControlSim(ref, world.state0, "F");
  const S = await createTwin(ref, world.state0);
  const Z = await createTwin(ref, world.state0);
  const seedN = lowbias32((ref.cfg.seed ^ 0x4e4e4e4e) >>> 0);
  t.check("C8: N's configuration differs from R's only in seed, which is noiseSeed(seed)", JSON.stringify(configDiff(ref.cfg, N.cfg)) === '["seed"]' && N.cfg.seed === seedN && seedN === noiseSeed(ref.cfg.seed) && seedN !== ref.cfg.seed, JSON.stringify(configDiff(ref.cfg, N.cfg)));
  t.check("C8: R_F and X_F differ from R's configuration only in dtQ (0) and motility (false)", [RF, XF].every((s) => JSON.stringify(configDiff(ref.cfg, s.cfg)) === '["dtQ","motility"]' && s.cfg.dtQ === 0 && s.cfg.motility === false));
  t.check("C8: the Z and S twins' configurations equal R's", configDiff(ref.cfg, S.cfg).length === 0 && configDiff(ref.cfg, Z.cfg).length === 0);
  t.check("controlConfig leaves R's configuration object untouched", ref.cfg.dtQ === 51 && ref.cfg.motility === true && controlConfig(ref.cfg, "F") !== ref.cfg);

  // the oracle's starting states, read back after the kick
  applyKick(XF, frozen, kick);
  applyKick(S, frozen, kick);
  const cpuRF = new RefSim3(cloneState(await RF.readState()));
  const cpuXF = new RefSim3(cloneState(await XF.readState()));
  const sRF0 = await RF.readState();
  t.check("R_F starts as R's state under the F configuration (step and cells equal R's)", sRF0.step === frozen.step && sRF0.cfg.dtQ === 0 && stateHash({ ...sRF0, cfg: ref.cfg }) === stateHash(await ref.readState()));

  const th = { thetaB: 6, thetaV: 3 };
  const dXF = await createDiff(RF, XF, { startStep: frozen.step, maxSteps: 100, ...th, sites: [site] });
  const dS = await createDiff(ref, S, { startStep: frozen.step, maxSteps: 100, ...th, sites: [site] });
  const dN = await createDiff(ref, N, { startStep: frozen.step, maxSteps: 100, ...th });
  await runLockstep(ref, [
    { sim: RF as AnySim, diff: null, steps: 100 },
    { sim: XF as AnySim, diff: dXF, steps: 100 },
    { sim: S as AnySim, diff: dS, steps: 100 },
    { sim: N as AnySim, diff: dN, steps: 100 },
  ], 100, { initial: true });
  const lXF = await dXF.read(), lS = await dS.read(), lN = await dN.read();

  // g3: retention on the device log
  const rows = Array.from({ length: 101 }, (_, r) => r);
  t.check("F: the kick stays in the one block it was made in at every step 0 to 100 (n_blk 1, attributed to its site)", rows.every((r) => lXF.at(r, "n_blk") === 1 && lXF.site(r, 0).net === 1));
  t.check("F: exactly one voxel differs in B at every step, and the B deficit at it is exactly 12 (L1_B = 12)", rows.every((r) => lXF.at(r, "n_1") === 1 && lXF.at(r, "L1_B") === 12 && lXF.at(r, "n_live") === 0), `n_1 at 100: ${lXF.at(100, "n_1")}, L1_B ${lXF.at(100, "L1_B")}`);
  t.check("F: the waste the kick made leaves the site and the damage in C shrinks, but no second voxel is hit in B", lXF.at(100, "L1_C") < lXF.at(0, "L1_C") && lXF.at(100, "n_live") === 0, `L1_C ${lXF.at(0, "L1_C")} -> ${lXF.at(100, "L1_C")}`);
  t.check("the same kick under the project's own configuration spreads: more than one voxel differs in B at step 100", lS.at(100, "n_1") > 1, `n_1(100) ${lS.at(100, "n_1")}, n_vox ${lS.at(100, "n_vox")}`);
  console.log(`F: n_1 ${lXF.at(100, "n_1")}, n_vox ${lXF.at(100, "n_vox")}; own configuration: n_1 ${lS.at(100, "n_1")}, n_vox ${lS.at(100, "n_vox")}, n_blk ${lS.at(100, "n_blk")}`);
  t.check("N: row 0 is zero (same state), and the noise swap makes it differ from step 1", DIFF_ZERO_COLS.every((c) => lN.at(0, c) === 0) && lN.at(1, "n_1") > 0 && lN.at(100, "n_1") > lXF.at(100, "n_1"), `n_1(1) ${lN.at(1, "n_1")}`);

  // g3: RefSim3 from the same states
  cpuRF.run(100);
  cpuXF.run(100);
  const gRF = await RF.readState(), gXF = await XF.readState();
  t.check("RefSim3 from R_F's state matches the device state hash after 100 steps (the device carries the F-configuration arithmetic, share3 included)", stateHash(cpuRF.state) === stateHash(gRF));
  t.check("RefSim3 from X_F's kicked state matches the device state hash after 100 steps", stateHash(cpuXF.state) === stateHash(gXF));
  const cB = (s: { cells: Uint32Array }) => s.cells[CH.B * n + site];
  t.check("RefSim3: after 100 steps the voxel holds 13 in R_F and 1 in X_F: the 12-unit kick is still at its site", cB(cpuRF.state) === 13 && cB(cpuXF.state) === 1, `${cB(cpuRF.state)} and ${cB(cpuXF.state)}`);
  let differ = 0;
  for (let v = 0; v < n; v++) if (cpuRF.state.cells[CH.B * n + v] !== cpuXF.state.cells[CH.B * n + v]) differ++;
  t.check("RefSim3: that is the only voxel where B differs between R_F and X_F", differ === 1, `${differ}`);
  t.check("the site's block is the block the device log attributes the damage to", lXF.at(100, "n_blk") === 1 && siteBlock === blockOf(g, site));

  // g2: C2 for every sim against R's own initial totals
  let bad = "";
  for (const [name, sim] of [["R", ref], ["N", N], ["R_F", RF], ["X_F", XF], ["S", S]] as [string, AnySim][]) {
    const r = await c2(sim, world);
    if (!r.ok) bad += ` ${name}(delta ${r.matterDelta}, residual ${r.residual})`;
  }
  t.check("C2: matter and the energy ledger are exact for R, N, R_F, X_F and S, against R's own initial totals", bad === "", bad);

  for (const d of [dXF, dS, dN]) d.destroy();
  for (const s of [N, RF, XF, S, Z, ref]) s.destroy();
  device.destroy();
}

console.log(`${((performance.now() - T0) / 1000).toFixed(1)} s`);
console.log(await uptime());
t.done();
