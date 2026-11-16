// GPU read -> brush -> create against the CPU reference: the 3D page's stroke path on the GPU engine. A CPU world and a
// GPU world run side by side; at each stroke the GPU state is read back, brushed with applyBrush3d and validated, the
// old GPU world is destroyed and a new one is made from the brushed state (GpuMycelium3d.create), while the CPU world is
// brushed in place. Both must report the same stroke, hold the same digest right after, and stay identical to the end
// (so create() restored everything the next steps need). No case may pass vacuously: every wound removes particles
// (and in the bond case cuts bonds), every feed converts waste.
//
//   deno run -A --no-lock tests/deno/mycelium3d_brush_gpu.ts
//
// Needs a real GPU (native WebGPU). Exits non-zero on any mismatch.
import { applyBrush3d, type BrushStroke3d } from "../../tools/mycelium3d/brush.ts";
import { GpuMycelium3d, mycelium3dDevice } from "../../tools/mycelium3d/gpu.ts";
import {
  BOND_NONE, createWorld, defaultConfig, energyTotal, matterTotal, type Mycelium3dConfig, type Mycelium3dState, POS_SHIFT, slotOfId, stateDigest, step, validateState,
} from "../../tools/mycelium3d/world.ts";

const dev = await mycelium3dDevice();
const arms: { name: string; over: Partial<Mycelium3dConfig> }[] = [
  { name: "no keys", over: {} },
  { name: "sinking + toll", over: { sinkShift: 6, moveCost: 12, trailMoveDiscount: 64, trailDiscountMode: "toll" } },
  { name: "owner gate + conduit", over: { trailOwner: "gid", ownerDefend: 4, ownerConduit: 16, maxDeposit: 12 } },
  { name: "bonds + children", over: { bondBreak: 1024, bondCost: 1, bondChild: true } },
];
let failed = 0;
const fail = (msg: string) => { failed++; console.error(`FAIL ${msg}`); };

const cellXYZ = (s: Mycelium3dState, i: number) => [s.x[i] >>> POS_SHIFT, s.y[i] >>> POS_SHIFT, s.z[i] >>> POS_SHIFT];
const cellOf = (s: Mycelium3dState, i: number) => { const [x, y, z] = cellXYZ(s, i); return (z * s.config.height + y) * s.config.width + x; };

/** A wound centred where it does something: on a bonded particle whose partner is in another cell (radius 0), else on particle n/2. */
function woundAt(s: Mycelium3dState): BrushStroke3d {
  if (s.bond0) {
    for (let i = 0; i < s.n; i++) {
      for (const p of [s.bond0[i], s.bond1![i]]) {
        if (p !== BOND_NONE && cellOf(s, slotOfId(s.id, s.n, p)) !== cellOf(s, i)) {
          const [cx, cy, cz] = cellXYZ(s, i);
          return { kind: "wound", cx, cy, cz, radius: 0 };
        }
      }
    }
  }
  const [cx, cy, cz] = cellXYZ(s, s.n >> 1);
  return { kind: "wound", cx, cy, cz, radius: 2 };
}

/** A feed centred on the cell with the most waste. */
function feedAt(s: Mycelium3dState): BrushStroke3d {
  let best = 0;
  for (let k = 1; k < s.C.length; k++) if (s.C[k] > s.C[best]) best = k;
  const W = s.config.width, H = s.config.height;
  return { kind: "feed", cx: best % W, cy: ((best / W) | 0) % H, cz: (best / (W * H)) | 0, radius: 2, amount: 24 };
}

for (const arm of arms) {
  const cfg = defaultConfig({ width: 16, height: 16, depth: 8, founders: 256, maxParticles: 2048, ...arm.over });
  const cpu = createWorld(cfg);
  let gpu = await GpuMycelium3d.create(dev, createWorld(cfg));
  let ok = true;
  for (const pick of [woundAt, feedAt, woundAt]) {
    for (let k = 0; k < 150; k++) step(cpu);
    gpu.step(150);
    const s = await gpu.read();
    if (stateDigest(s) !== stateDigest(cpu)) { fail(`${arm.name}: pre-stroke state differs at step ${cpu.step}`); ok = false; break; }
    const stroke = pick(cpu);
    const rc = applyBrush3d(cpu, stroke), rg = applyBrush3d(s, stroke);
    if (JSON.stringify(rc) !== JSON.stringify(rg)) { fail(`${arm.name}: stroke reports differ (${JSON.stringify(stroke)})`); ok = false; break; }
    if (rc.kind === "wound" && rc.removed === 0) { fail(`${arm.name}: vacuous wound at step ${rc.step}`); ok = false; }
    if (rc.kind === "wound" && cfg.bondBreak !== undefined && rc.bondsCut === 0) { fail(`${arm.name}: wound cut no bond at step ${rc.step}`); ok = false; }
    if (rc.kind === "feed" && rc.matterMoved === 0) { fail(`${arm.name}: vacuous feed at step ${rc.step}`); ok = false; }
    const bad = validateState(s);
    if (bad.length) { fail(`${arm.name}: brushed state invalid: ${bad[0]}`); ok = false; break; }
    gpu.destroy();
    gpu = await GpuMycelium3d.create(dev, s);
    const back = await gpu.read(); // what the page shows after a stroke: the GPU's own state, read after create
    if (stateDigest(back) !== stateDigest(cpu)) { fail(`${arm.name}: GPU after create differs from CPU (${JSON.stringify(stroke)})`); ok = false; break; }
    if (matterTotal(back) !== back.matter0 || energyTotal(back) !== back.energy0 + back.totals.lightIn - back.totals.heat) { fail(`${arm.name}: residual after create`); ok = false; break; }
    console.log(`  ${arm.name}: ${rc.kind} (${rc.cx},${rc.cy},${rc.cz}) r${rc.radius} at step ${rc.step}: n ${cpu.n}, removed ${rc.removed}, moved ${rc.matterMoved}, bonds cut ${rc.bondsCut}`);
  }
  if (ok) {
    for (let k = 0; k < 150; k++) step(cpu);
    gpu.step(150);
    const fin = await gpu.read();
    if (stateDigest(fin) !== stateDigest(cpu)) fail(`${arm.name}: final state differs after 150 more steps`);
    if (validateState(fin).length) fail(`${arm.name}: final state invalid`);
    console.log(`${failed ? "FAIL" : "ok"} ${arm.name}: n ${fin.n}, step ${fin.step}, digest ${stateDigest(fin)}`);
  }
  gpu.destroy();
}
if (failed) { console.error(`${failed} failure(s)`); Deno.exit(1); }
console.log(`all ${arms.length} brush/create cases match the CPU reference`);
