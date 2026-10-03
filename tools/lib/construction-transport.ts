// Exact, read-only transport accounting for a fixed spatial patch. Call BEFORE
// RefSim.step(): dissolved transport uses the incoming cells, including their
// incoming P, before any reaction or movement of bound material in that step.
import {
  addu,
  cellBase,
  cellCount,
  CH,
  divu,
  mulu,
  type WorldState,
  worldW,
} from "@bl/schema";
import { diffOut } from "@bl/sim-ref";

export interface PatchFlux {
  /** Quanta crossing from outside the mask to inside it. */
  grossIn: number;
  /** Quanta crossing from inside the mask to outside it. */
  grossOut: number;
  /** grossIn - grossOut: the patch's change from diffusion alone. */
  netIn: number;
  /** Quanta moving along directed edges whose two cells are inside the mask. */
  internal: number;
}

export interface PatchTransport {
  A: PatchFlux;
  C: PatchFlux;
}

/**
 * Per-step dissolved transport, using exactly the physics' stochastic rounding
 * and source-direction draws. Each source's four outgoing edges is visited
 * once. Edges wrap inside that source's tile, never across tiles.
 *
 * The mask is a fixed set of spatial cells, not an inferred organism. Values
 * must be boolean or 0/1. Net flux is exact integer quanta; concentrations after
 * a full step additionally reflect reactions and therefore are not this flux.
 * At validated state bounds the sums here fit exactly in a JS number. Longer
 * run accumulators must separately ensure they remain safe integers.
 */
export function patchTransport(
  state: WorldState,
  mask: ArrayLike<boolean | number>,
): PatchTransport {
  const { cfg, cells, step } = state;
  const n = cellCount(cfg);
  if (mask.length !== n) {
    throw new Error(`patch mask length ${mask.length}, expected ${n}`);
  }
  for (let i = 0; i < n; i++) {
    if (
      mask[i] !== true && mask[i] !== false && mask[i] !== 0 && mask[i] !== 1
    ) {
      throw new Error(`patch mask at ${i} must be boolean or 0/1`);
    }
  }
  const empty = (): PatchFlux => ({
    grossIn: 0,
    grossOut: 0,
    netIn: 0,
    internal: 0,
  });
  const result: PatchTransport = { A: empty(), C: empty() };
  const W = worldW(cfg);
  const dx = [1, -1, 0, 0], dy = [0, 0, 1, -1];
  for (let source = 0; source < n; source++) {
    const x = source % W, y = Math.floor(source / W);
    const lx = x % cfg.tileW, ly = y % cfg.tileH;
    const ox = x - lx, oy = y - ly;
    const fromInside = Boolean(mask[source]);
    const base = cellBase(cfg.seed, step, source);
    for (let d = 0; d < 4; d++) {
      const tx = ox + (lx + dx[d] + cfg.tileW) % cfg.tileW;
      const ty = oy + (ly + dy[d] + cfg.tileH) % cfg.tileH;
      const target = ty * W + tx;
      const toInside = Boolean(mask[target]);
      if (!fromInside && !toInside) continue;
      const denominator = addu(
        addu(cfg.gateK, cells[CH.P * n + source]),
        cells[CH.P * n + target],
      );
      for (let sp = 0; sp < 2; sp++) {
        const ch = sp === 0 ? CH.A : CH.C;
        const D = sp === 0 ? cfg.diffA : cfg.diffC;
        const effective = cfg.polymerTransport === false
          ? D
          : divu(mulu(D, cfg.gateK), denominator);
        const q = diffOut(cells[ch * n + source], d, effective, base, sp);
        const f = sp === 0 ? result.A : result.C;
        if (fromInside && toInside) f.internal += q;
        else if (fromInside) f.grossOut += q;
        else f.grossIn += q;
      }
    }
  }
  for (const f of [result.A, result.C]) f.netIn = f.grossIn - f.grossOut;
  return result;
}
