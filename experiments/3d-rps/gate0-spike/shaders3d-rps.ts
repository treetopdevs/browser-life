// The Gate-0 spike (rule draft 3.0, D16): the review prototype's patch of the slab react shader, kept as TEXT so the repo's own
// shaders3d.ts stays untouched. Copied from runs/rps/review/proto/shaders3d-rps.ts; the removal kill and the mask mirror below are
// the prototype's, byte for byte (experiments/test/rps-gate0-spike.test.ts pins the generated text). What the copy adds is the
// compile-time kill-form switch `RPS.kill`: "removal" (the prototype's kill) or "vacancy" (rung V of the rule draft, plan 4.3a).
//
// Plan 4.2-4.3: the kill sits before the controller block (after the pool caps), the mirror OR at the MOT store. The patch applies to
// the shipped shader text as it is in the tree; the anchors are checked and a tree that has moved on throws.
import * as base from "../../../packages/sim-gpu/src/shaders3d.ts";
import type { WorldConfig } from "@bl/schema";
export * from "../../../packages/sim-gpu/src/shaders3d.ts";

export type KillForm = "removal" | "vacancy";

/**
 * Set before GpuSim3.create (the values are baked into the shader text):
 *   on    the patch at all (the mask mirror and the kill block); false gives the shipped shader;
 *   rate  removal: fraction of B in 1/65536 per dominant face neighbour; vacancy: probability in 1/65536 per dominant face of emptying the cell;
 *   min   rpsMin, the least post-transport B at which a face neighbour counts as a predator;
 *   kill  the kill form.
 */
export const RPS: { on: boolean; rate: number; min: number; kill: KillForm } = { on: false, rate: 0, min: 4, kill: "removal" };

function once(s: string, needle: string, repl: string): string {
  const k = s.split(needle).length - 1;
  if (k !== 1) throw new Error(`patch anchor found ${k} times: ${needle.slice(0, 60)}`);
  return s.replace(needle, () => repl);
}

/**
 * Counts the dominant face neighbours of the cell: a neighbour counts iff its post-transport B is at least RPS_MIN and its mirrored
 * beats-mask has bit `t_own` (the cell's own type) set; a missing z neighbour never preys. Shared by both kill forms, so that
 * "ndom counted exactly as for removal" (rule draft G0.1) is true by construction.
 */
const NDOM_COUNT = `      let t_own = (genome[G_PARAM1 + i] >> 8u) & 0xffu;
      var ndom = 0u;
      for (var dd = 0u; dd < 6u; dd++) {
        var ddx = 0; var ddy = 0; var ddz = 0;
        if (dd == 0u) { ddx = 1; } else if (dd == 1u) { ddx = -1; } else if (dd == 2u) { ddy = 1; } else if (dd == 3u) { ddy = -1; } else if (dd == 4u) { ddz = 1; } else { ddz = -1; }
        let jn = nb3(x, y, z, ddx, ddy, ddz);
        if (jn == OUTSIDE) { continue; }
        if (cells[CH_B + jn] >= RPS_MIN && ((cells[CH_MOT + jn] >> (24u + t_own)) & 1u) == 1u) { ndom += 1u; }
      }
`;

/** Removal (plan 4.3): a cell with B > 0 and ndom dominant faces loses min(B, mulFrac(B, rate * ndom)) of its B to C, booked as bdecay. */
const REMOVAL_KILL = `    var killq = 0u;
    if (living && B > 0u && RPS_RATE > 0u) {
${NDOM_COUNT}      if (ndom > 0u) {
        let qk = min(B, mul_frac(B, RPS_RATE * ndom, 16u, draw(base, RND_RPS_KILL)));
        B -= qk; C += qk; hadd(qk * (E_B - E_C)); killq = qk;
      }
    }
`;

/**
 * The vacancy kill (plan 4.3a, rule draft G0.1 rung V): a living cell (no B > 0 condition) with ndom >= 1 is EMPTIED iff
 * (draw(base, 40) & 0xffff) < min(65536, rate * ndom). Emptied is the 2D injury lesion (packages/sim-ref/src/step.ts, the injury
 * branch of react): all of B and P become C with the heat terms B (eB - eC) and P (eP - eC), E goes to heat, A and S are untouched.
 * Three hadd calls, because each term is bounded like the shader's other hadd arguments and the 64-bit heat is a sum. No flux is
 * booked (the 2D path books none). Nothing else is written: the emptied cell has B = 0, so the controller block is skipped and
 * `mot` keeps the at-rest word; the existing clear (living && B == 0 && P == 0) sets both lineage words to 0; and the mirror OR at
 * the MOT store then writes 0, since the lineage is gone.
 *
 * When it acts differs from the 2D lesion, though: the 2D injury branch runs after the cell's whole step (the reactions and the
 * passive block included), this kill before the controller block (rule draft G0.1, plan 4.3a), so the passive block runs on the
 * emptied cell and the victim's B and P are already detritus (C) when the same step's abiotic C -> A conversion runs. A and C of an
 * emptied cell can therefore differ by that step's abiotic share from what the 2D order would leave; S never does. Conservation is
 * unaffected: matter only moves between the channels of one cell, and every energy term is booked.
 */
const VACANCY_KILL = `    if (living && RPS_RATE > 0u) {
${NDOM_COUNT}      if (ndom > 0u && (draw(base, RND_RPS_KILL) & 0xffffu) < min(65536u, RPS_RATE * ndom)) {
        hadd(B * (E_B - E_C)); hadd(P * (E_P - E_C)); hadd(E);
        C += B + P; B = 0u; P = 0u; E = 0u;
      }
    }
`;

export function reactShader3(c: WorldConfig): string {
  let s = base.reactShader3(c);
  if (!RPS.on) return s;
  s = once(s, "@group(0) @binding(0) var<storage, read> cells: array<u32>;", `const RPS_RATE = ${RPS.rate}u;\nconst RPS_MIN = ${RPS.min}u;\nconst RND_RPS_KILL = 40u;\n@group(0) @binding(0) var<storage, read> cells: array<u32>;`);
  const kill = RPS.kill === "vacancy" ? VACANCY_KILL : REMOVAL_KILL;
  s = once(s, "    if (living && B > 0u) {\n      var words", kill + "    if (living && B > 0u) {\n      var words");
  // removal books its q beside the passive decay's, under bdecay; the vacancy kill books no flux
  if (RPS.kill === "removal") s = once(s, "hadd(q * (E_B - E_C)); F[FX_BDECAY] = q;", "hadd(q * (E_B - E_C)); F[FX_BDECAY] = q + killq;");
  s = once(s, "    cellsOut[CH_MOT + i] = mot;", `    var mm = 0u;
    if ((genome[G_LIN_HI + i] | genome[G_LIN_LO + i]) != 0u) { mm = (genome[G_PARAM1 + i] >> 16u) & 0xffu; }
    cellsOut[CH_MOT + i] = mot | (mm << 24u);`);
  return s;
}
