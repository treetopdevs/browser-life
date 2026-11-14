// The regime instrument on a real native WebGPU device, tests (c) and (e) of docs/3d-regime-meters-plan-2026-10-23.md section 8.3
// (packages/sim-gpu/src/regime.ts: createDiff and its log, runLockstep). Seeds 9900 and up only.
//
//  c. The counters are right. The GPU log equals a CPU recomputation (tests/deno/regime_lib.ts refDiffRow, written from the
//     definitions of R6 and not from the shader) from two readCells arrays, word for word, at steps 1, 10 and 100 for every
//     member of the bank (S with its per-site words, U, N, Z, the doses, the F pair against its own reference), under rung P1 and
//     rung P2, at 128 x 128 x 8, and at steps 1 and 10 at the production size 256 x 256 x 8. Row 0 (the pass before step 1) is
//     compared with the CPU on the kicked state built from the kick set alone, which also checks what applyKick wrote, and
//     satisfies C5 (n_blk is the number of kicked blocks under P1, n_occ and n_live are 0, L1_B = L1_C = the dose). Also: the
//     per-site words add up to the global block counts at every step, a pass past the end of the log is dropped without touching
//     the last row, and setParams takes effect on the next pass.
//  e. 2D. The same fork, kick and diff on a 64 x 64 2D world (spots-m3 shrunk, the kernel of the project's gate worlds), under
//     both rungs.
//
// Run from the repo root: deno run -A --no-lock tests/deno/regime_diff.ts
import { CH } from "@bl/schema";
import { DIFF_GLOBAL_WORDS, DIFF_SITE_WORDS, applyKick, blockGrid, createDiff, createTwin, freezeRef, kickSites, requestDevice3, runLockstep, type DiffLog, type KickSet, type RefSimLike } from "@bl/sim-gpu";
import { Checker, buildBank, burnIn, flatWorld, hashOf, readLogs, refDiffRow, rowMismatch, scaleOf, slabWorld, uptime, type AnySim, type Bank, type World } from "./regime_lib.ts";

const T0 = performance.now();
const t = new Checker("regime_diff");
console.log(await uptime());

const kickOf = (bank: Bank, name: string): KickSet | null =>
  name === "S" || name === "XF" ? bank.kicks.S : name === "U" ? bank.kicks.U : name.startsWith("D") ? (bank.kicks.doses.find((d) => `D${d.m}` === name)?.kick ?? null) : null;

/** The cells of the frozen reference with a kick applied on the CPU alone. */
function kicked(bank: Bank, kick: KickSet | null): Uint32Array {
  const c = bank.frozen.cells.slice();
  if (kick) for (let j = 0; j < kick.voxels.length; j++) { c[CH.B * bank.g.n + kick.voxels[j]] -= kick.amounts[j]; c[CH.C * bank.g.n + kick.voxels[j]] += kick.amounts[j]; }
  return c;
}

/** Row t of every member's log against the CPU recomputation from the live cells. Returns the names that mismatch. */
async function compareAt(bank: Bank, logs: Record<string, DiffLog>, step: number): Promise<string[]> {
  const p = { thetaB: bank.thetaB, thetaV: bank.thetaV, occV: 8 };
  const Rc = await bank.ref.readCells();
  const RFc = bank.sims.RF ? await (bank.sims.RF as AnySim).readCells() : null;
  const bad: string[] = [];
  for (const name of Object.keys(bank.diffs)) {
    const against = name === "XF" ? RFc! : Rc;
    const Xc = await (bank.sims[name] as AnySim).readCells();
    const cpu = refDiffRow(bank.g, against, Xc, p, name === "S" || name === "XF" ? bank.sites : []);
    const mm = rowMismatch(logs[name].row(step), cpu);
    if (mm) bad.push(`${name}@${step}: ${mm}`);
  }
  return bad;
}

/** Row 0 of every member against the CPU on the kicked state, then the live rows at `stops`. */
async function checkBank(label: string, bank: Bank, stops: number[]) {
  const p = { thetaB: bank.thetaB, thetaV: bank.thetaV, occV: 8 };
  await runLockstep(bank.ref, bank.members, 0, { initial: true });
  let logs = await readLogs(bank);
  const bad0: string[] = [];
  for (const name of Object.keys(bank.diffs)) {
    const kick = kickOf(bank, name);
    const cpu = refDiffRow(bank.g, bank.frozen.cells, kicked(bank, kick), p, name === "S" || name === "XF" ? bank.sites : []);
    const mm = rowMismatch(logs[name].row(0), cpu);
    if (mm) bad0.push(`${name}: ${mm}`);
  }
  t.check(`${label}: row 0 (before any step) of all ${Object.keys(bank.diffs).length} logs equals the CPU on the kicked state built from the kick sets alone`, bad0.length === 0, bad0.join(" | "));
  // C5
  const S0 = logs.S;
  const c5 = (name: string) => {
    const l = logs[name], k = kickOf(bank, name);
    if (!k) return l.at(0, "n_blk") === 0 && l.at(0, "L1_B") === 0 && l.at(0, "n_live") === 0;
    const rung1 = label.includes("P1") || label.includes("2D P1");
    const blkOk = rung1 ? l.at(0, "n_blk") === (name === "U" ? 0 : k.blocks.length) : l.at(0, "n_blk") <= k.blocks.length;
    return blkOk && l.at(0, "n_live") === 0 && l.at(0, "L1_A") === 0 && l.at(0, "L1_P") === 0 && l.at(0, "L1_B") === k.total && l.at(0, "L1_C") === k.total;
  };
  t.check(`${label}: C5 at t = 0 for every member (kicked blocks, n_live 0, L1_A = L1_P = 0, L1_B = L1_C = the dose)`, Object.keys(logs).every(c5), Object.keys(logs).filter((n) => !c5(n)).join(","));
  t.check(`${label}: n_occ is 0 at t = 0 under P1 (one voxel cannot reach OCC_V)`, !label.includes("P1") || Object.keys(logs).every((n) => logs[n].at(0, "n_occ") === 0));
  // Under P1 a kick sits in one block, whose centre is its origin + 4: reach 0 to 4. A ball (P2) can also mark the blocks beside
  // its own: a neighbour's centre is at most 7 columns from a site that is within 3 of the shared edge.
  const reach0 = Array.from({ length: S0.nSites }, (_, j) => S0.site(0, j)).flatMap((s) => [s.reachNet, s.reachOcc]);
  const bound = label.includes("P1") ? 4 : 7;
  t.check(`${label}: the reach of every S site at t = 0 is at most ${bound} (max ${Math.max(...reach0)}; the block centre is its origin + 4)`, reach0.every((r) => r <= bound));
  let done = 0;
  for (const stop of stops) {
    await runLockstep(bank.ref, bank.members, stop - done, { done });
    done = stop;
    logs = await readLogs(bank);
    const bad = await compareAt(bank, logs, stop);
    t.check(`${label}: the GPU log equals the CPU recomputation at step ${stop} for all ${Object.keys(bank.diffs).length} members, every word`, bad.length === 0, bad.join(" | "));
  }
  // per-site words add up to the block counts at every step (every damaged block is attributed, no cutoff)
  let sumsOk = true, any = false;
  for (const name of ["S", "XF"]) {
    const l = logs[name];
    if (!l) continue;
    for (let r = 0; r <= done; r++) {
      let net = 0, occ = 0;
      for (let j = 0; j < l.nSites; j++) { const s = l.site(r, j); net += s.net; occ += s.occ; }
      if (net !== l.at(r, "n_blk") || occ !== l.at(r, "n_occ")) sumsOk = false;
      if (l.at(r, "n_blk") > 0) any = true;
    }
  }
  t.check(`${label}: the per-site words add up to n_blk and n_occ at every step 0 to ${done}`, sumsOk && any);
  const S = logs.S;
  t.check(`${label}: S shows damage (n_blk ${S.at(done, "n_blk")}, n_occ ${S.at(done, "n_occ")}, n_1 ${S.at(done, "n_1")} at step ${done}); Z shows none`, S.at(done, "n_1") > 0 && logs.Z.at(done, "n_1") === 0);
  t.check(`${label}: C7: live_R of the last row equals the reference's living count`, S.at(done, "live_R") === (await (bank.ref as RefSimLike).readStats()).living);
}

// ---- c. the counters are right (128 x 128 x 8, a carpet so that the doses and sites exist)
console.log("-- c. the counters are right");
{
  const world = slabWorld(9920, 128, 128, { defaultMu: 60, defaultSigma: 8, lightK: 1024 });
  const device = await requestDevice3(navigator.gpu, world.cfg);
  const ref = await burnIn(device, world, 3000); // 234 of the 256 blocks are living: the dose cap lets several doses run
  for (const rung of ["P1", "P2"] as const) {
    const bank = await buildBank(world, ref, { rung, maxSites: 9, dsep: 40, doses: [4, 8, 16, 32, 64], steps: { Z: 100, S: 100, U: 100, N: 100, dose: 100 }, F: true });
    console.log(`${rung}: ${bank.scale.living} living voxels, ${bank.liveblk} living blocks, B* ${bank.scale.Bstar}, k ${bank.scale.k}, thresholds ${bank.thetaB}/${bank.thetaV}, ${bank.sites.length} sites, doses run: ${bank.kicks.doses.filter((d) => d.run).map((d) => d.m).join(",") || "none"}`);
    t.check(`${rung}: the bank has sites and several doses`, bank.sites.length >= 4 && bank.kicks.doses.filter((d) => d.run).length >= 2, `${bank.sites.length} sites, doses ${bank.kicks.doses.filter((d) => d.run).length}`);
    await checkBank(`128x128x8 ${rung}`, bank, [1, 10, 100]);
    bank.destroy();
  }
  ref.destroy();
  device.destroy();
}
{
  // the production size: 256 x 256 x 8, the full-grid dispatch of 1,024 workgroups
  const world = slabWorld(9921, 256, 256, { defaultMu: 60, defaultSigma: 8, lightK: 1024 });
  const device = await requestDevice3(navigator.gpu, world.cfg);
  const ref = await burnIn(device, world, 1000);
  const bank = await buildBank(world, ref, { rung: "P1", maxSites: 16, dsep: 40, doses: [], steps: { Z: 10, S: 10, U: 10, N: 10, dose: 10 } });
  console.log(`256x256x8: ${bank.scale.living} living voxels, ${bank.liveblk} living blocks, ${bank.sites.length} sites`);
  t.check("256x256x8: sixteen sites fit, or at least six", bank.sites.length >= 6, `${bank.sites.length}`);
  await checkBank("256x256x8 P1", bank, [1, 10]);
  bank.destroy();
  ref.destroy();
  device.destroy();
}
{
  // a pass past the end of the log is dropped; setParams takes effect on the next pass
  const world = slabWorld(9922, 32, 32, { defaultMu: 60, defaultSigma: 8, lightK: 1024 });
  const device = await requestDevice3(navigator.gpu, world.cfg);
  const ref = await burnIn(device, world, 300);
  const frozen = await freezeRef(ref as RefSimLike);
  const g = blockGrid(ref.cfg);
  const n = g.n;
  const sc = scaleOf(frozen.cells, n);
  const site = sc.E[0];
  const S = await createTwin(ref, world.state0);
  applyKick(S, frozen, kickSites(g, frozen.cells.subarray(CH.B * n, (CH.B + 1) * n), [site], sc.k));
  const diff = await createDiff(ref, S, { startStep: frozen.step, maxSteps: 5, thetaB: sc.thetaB, thetaV: sc.thetaV, sites: [site] });
  const members = [{ sim: S as AnySim, diff, steps: 12 }];
  await runLockstep(ref, members, 5, { initial: true });
  const p = { thetaB: sc.thetaB, thetaV: sc.thetaV, occV: 8 };
  const cpu5 = refDiffRow(g, await ref.readCells(), await S.readCells(), p, [site]);
  await runLockstep(ref, members, 3, { done: 5 }); // passes at rows 6 to 8 of a log that ends at row 5
  const log = await diff.read();
  t.check("a log of 5 steps has 6 rows, and passes past its end leave row 5 as the CPU had it at step 5", log.rows === 6 && log.words.length === 6 * (DIFF_GLOBAL_WORDS + DIFF_SITE_WORDS) && rowMismatch(log.row(5), cpu5) === "", rowMismatch(log.row(5), cpu5));
  diff.setParams({ thetaB: sc.thetaB + 5, thetaV: sc.thetaV + 2 });
  const diff2 = await createDiff(ref, S, { startStep: frozen.step, maxSteps: 40, thetaB: sc.thetaB, thetaV: sc.thetaV, sites: [site] });
  diff2.setParams({ thetaB: sc.thetaB + 5, thetaV: sc.thetaV + 2 });
  const members2 = [{ sim: S as AnySim, diff: diff2, steps: 12 }];
  await runLockstep(ref, members2, 1, { done: 8 });
  const cpu9 = refDiffRow(g, await ref.readCells(), await S.readCells(), { thetaB: sc.thetaB + 5, thetaV: sc.thetaV + 2, occV: 8 }, [site]);
  t.check("setParams changes the thresholds the next pass uses (checked against the CPU at the new thresholds)", rowMismatch((await diff2.read()).row(9), cpu9) === "", rowMismatch((await diff2.read()).row(9), cpu9));
  diff.destroy();
  diff2.destroy();
  S.destroy();
  ref.destroy();
  device.destroy();
}

// ---- c2. living is B + P > 0 (R6): a voxel with P > 0 and B = 0 lives, in R and in X alike (CR-F09, CR-F15)
console.log("-- c2. living is B + P > 0");
{
  // Hand-poked raw buffers: a P-only voxel in R that X lacks, a P-only voxel in X that R lacks, and a P-only voxel in a block that has no other living
  // voxel (so liveblk_R moves). A kernel that counts living by B alone (in R or in X) disagrees with the CPU definition on all of them.
  const world = slabWorld(9923, 32, 32);
  const device = await requestDevice3(navigator.gpu, world.cfg);
  const ref = await burnIn(device, world, 300);
  const S = await createTwin(ref, world.state0);
  const g = blockGrid(ref.cfg);
  const n = g.n;
  const base = await ref.readCells();
  const blockLive = new Array<number>(g.nBlocks).fill(0);
  const emptyIn = new Map<number, number>();
  for (let v = 0; v < n; v++) {
    const b = (Math.floor(v / g.W) % g.H >> 3) * g.bx + ((v % g.W) >> 3);
    if (base[CH.B * n + v] + base[CH.P * n + v] > 0) blockLive[b]++;
    else if (!emptyIn.has(b)) emptyIn.set(b, v);
  }
  const deadBlocks = [...emptyIn.keys()].filter((b) => blockLive[b] === 0);
  const pick = (k: number): number => emptyIn.get(deadBlocks[k] ?? [...emptyIn.keys()][k])!;
  const vR = pick(0), vX = pick(1);
  t.check("two distinct empty voxels exist to poke (B = 0 and P = 0 in R)", vR !== undefined && vX !== undefined && vR !== vX && base[CH.B * n + vR] + base[CH.P * n + vR] === 0 && base[CH.B * n + vX] + base[CH.P * n + vX] === 0);
  const poke = (sim: AnySim, v: number, p: number) => sim.device.queue.writeBuffer(sim.cells[0], (CH.P * n + v) * 4, Uint32Array.of(p));
  poke(ref, vR, 5);
  poke(S as AnySim, vX, 7);
  const th = { thetaB: 6, thetaV: 3 };
  const diff = await createDiff(ref, S, { startStep: ref.step, maxSteps: 2, ...th });
  await runLockstep(ref, [{ sim: S as AnySim, diff, steps: 2 }], 0, { initial: true });
  const log = await diff.read();
  const Rc = await ref.readCells(), Xc = await S.readCells();
  const cpu = refDiffRow(g, Rc, Xc, { ...th, occV: 8 }, []);
  t.check("row 0 equals the CPU definition on the poked pair (living = B + P > 0 in R and in X)", rowMismatch(log.row(0), cpu) === "", rowMismatch(log.row(0), cpu));
  const liveBase = base.reduce((a, _, i) => (i < n && base[CH.B * n + i] + base[CH.P * n + i] > 0 ? a + 1 : a), 0);
  t.check("live_R counts the P-only voxel of R (not of X) and live_X the P-only voxel of X (not of R)", log.at(0, "live_R") === liveBase + 1 && log.at(0, "live_X") === liveBase + 1, `live_R ${log.at(0, "live_R")}, live_X ${log.at(0, "live_X")}, base ${liveBase}`);
  t.check("n_live counts both voxels (they live in one sim and not in the other)", log.at(0, "n_live") === 2, `n_live ${log.at(0, "n_live")}`);
  const blocksR = new Set<number>();
  for (let v = 0; v < n; v++) if (Rc[CH.B * n + v] + Rc[CH.P * n + v] > 0) blocksR.add((Math.floor(v / g.W) % g.H >> 3) * g.bx + ((v % g.W) >> 3));
  t.check("liveblk_R counts the blocks that hold a living voxel of R, the P-only one included", log.at(0, "liveblk_R") === blocksR.size, `${log.at(0, "liveblk_R")} against ${blocksR.size}`);
  t.check("the poke is visible to L1_P and n_vox (the pair differs in two voxels)", log.at(0, "L1_P") === 12 && log.at(0, "n_vox") === 2, `L1_P ${log.at(0, "L1_P")}, n_vox ${log.at(0, "n_vox")}`);
  diff.destroy();
  S.destroy();
  ref.destroy();
  device.destroy();
}

// ---- e. 2D: the same fork, kick and diff on the kernel of the project's gate worlds
console.log("-- e. 2D");
{
  const world: World = flatWorld("spots-m3", 9930, 64, 64);
  const device = await requestDevice3(navigator.gpu, world.cfg);
  for (const rung of ["P1", "P2"] as const) {
    const ref = await burnIn(device, world, 300);
    const bank = await buildBank(world, ref, { rung, maxSites: 4, dsep: 16, doses: [4], steps: { Z: 100, S: 100, U: 100, N: 100, dose: 100 }, F: true });
    console.log(`2D ${rung}: ${bank.scale.living} living cells of ${bank.g.n}, ${bank.liveblk} living blocks, B* ${bank.scale.Bstar}, k ${bank.scale.k}, thresholds ${bank.thetaB}/${bank.thetaV}, ${bank.sites.length} sites, D = ${bank.g.D}`);
    t.check(`2D ${rung}: the world is one layer of 8 x 8 blocks and has sites`, bank.g.D === 1 && bank.g.nBlocks === 64 && bank.sites.length >= 2, `${bank.sites.length} sites`);
    await checkBank(`2D ${rung}`, bank, [1, 10, 100]);
    t.check(`2D ${rung}: the zero-control fork has the reference's full-state hash after 100 steps`, (await hashOf(ref)) === (await hashOf(bank.sims.Z as AnySim)));
    bank.destroy();
    ref.destroy();
  }
  device.destroy();
}

console.log(`${((performance.now() - T0) / 1000).toFixed(1)} s`);
console.log(await uptime());
t.done();
