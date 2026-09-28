/**
 * Exact one-step transport shares, conditional on the simulator's displacement field.
 * These are source-site material contributions before reaction. They do not say which
 * pre-existing quantum is consumed after pools mix or identify genetic descent.
 */
import { CH, G, RND, cellBase, cellCount, draw, validateConfig, validateState, worldW,
  type WorldConfig, type WorldState } from "@bl/schema";
import { mulShareD, w1d } from "@bl/sim-ref";

export interface TransportSourceShare { sourceIndex: number; B: number; P: number; E: number;
  lotteryWeight: number }
export interface TransportDestinationAudit { destinationIndex: number; sources: TransportSourceShare[];
  incoming: { B: number; P: number; E: number }; genomeWinnerSourceIndex: number | null;
  genomeWinnerLineage: string | null }

/** A GPU census snapshot carries exactly the channels needed for the local flow/lottery audit. */
export interface TransportView { cfg: WorldConfig; step: number; cells: Uint32Array;
  genomeHead: Uint32Array }
export type TransportInput = WorldState | TransportView;
export const genomeHeadOf = (state: TransportInput): Uint32Array =>
  "genomeHead" in state ? state.genomeHead : state.genome;
export function validateTransportInput(state: TransportInput): void {
  if ("genome" in state) {
    const errors = validateState(state);
    if (errors.length) throw new Error(`invalid before-transport state: ${errors.join("; ")}`);
  } else if (validateConfig(state.cfg).length || !Number.isSafeInteger(state.step) || state.step < 0 ||
      state.cells.length !== 7 * cellCount(state.cfg) ||
      state.genomeHead.length !== 4 * cellCount(state.cfg))
    throw new Error("invalid transport snapshot shape/configuration");
}

const nb = (state: TransportInput, x: number, y: number, dx: number, dy: number): number => {
  const { tileW, tileH } = state.cfg, W = worldW(state.cfg);
  const tx = Math.floor(x / tileW), ty = Math.floor(y / tileH);
  const lx = ((x - tx * tileW + dx) % tileW + tileW) % tileW;
  const ly = ((y - ty * tileH + dy) % tileH + tileH) % tileH;
  return (ty * tileH + ly) * W + tx * tileW + lx;
};

/** Mirrors only the existing transport share and lottery arithmetic. No dynamics run here. */
export function transportDestinationAudit(before: TransportInput,
  displacement: Uint32Array | ((sourceIndex: number) => number),
  destinationIndex: number): TransportDestinationAudit {
  validateTransportInput(before);
  const n = cellCount(before.cfg), W = worldW(before.cfg);
  const genome = genomeHeadOf(before);
  if (typeof displacement !== "function" && displacement.length !== n ||
      !Number.isSafeInteger(destinationIndex) ||
      destinationIndex < 0 || destinationIndex >= n)
    throw new Error("transport audit requires full displacement and a valid destination");
  const x = destinationIndex % W, y = Math.floor(destinationIndex / W);
  const hw = 32 + before.cfg.spread, d2 = 4 * hw * hw;
  const sources: TransportSourceShare[] = [];
  let inB = 0, inP = 0, inE = 0;
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    const sourceIndex = nb(before, x, y, ox, oy);
    const packed = typeof displacement === "function" ? displacement(sourceIndex) : displacement[sourceIndex];
    if (!Number.isSafeInteger(packed) || packed < 0 || packed > 0xffff_ffff)
      throw new Error("invalid displacement word");
    const dx = (packed & 0xff) - 64, dy = ((packed >>> 8) & 0xff) - 64;
    if (dx < -64 || dx > 63 || dy < -64 || dy > 63)
      throw new Error("invalid displacement word");
    const qB = before.cells[CH.B * n + sourceIndex];
    const qP = before.cells[CH.P * n + sourceIndex];
    const qE = before.cells[CH.E * n + sourceIndex];
    let B: number, P: number, E: number;
    if (ox === 0 && oy === 0) {
      B = qB; P = qP; E = qE;
      for (let ty = -1; ty <= 1; ty++) for (let tx = -1; tx <= 1; tx++) {
        if (tx === 0 && ty === 0) continue;
        const w = w1d(dx, tx, hw) * w1d(dy, ty, hw);
        if (w === 0) continue;
        B -= mulShareD(qB, w, d2);
        P -= mulShareD(qP, w, d2);
        E -= mulShareD(qE, w, d2);
      }
    } else {
      const w = w1d(dx, -ox, hw) * w1d(dy, -oy, hw);
      B = mulShareD(qB, w, d2);
      P = mulShareD(qP, w, d2);
      E = mulShareD(qE, w, d2);
    }
    if ([B, P, E].some((v) => !Number.isSafeInteger(v) || v < 0))
      throw new Error("negative or fractional transport share");
    inB += B; inP += P; inE += E;
    sources.push({ sourceIndex, B, P, E, lotteryWeight: B + P });
  }
  if ([inB, inP, inE].some((v) => v > 0xffff_ffff))
    throw new Error("transport destination exceeds u32 range");
  let genomeWinnerSourceIndex: number | null = null;
  let genomeWinnerLineage: string | null = null;
  const total = inB + inP;
  if (total > 0) {
    const r = draw(cellBase(before.cfg.seed, before.step, destinationIndex), RND.LOTTERY) % total;
    let cumulative = 0;
    for (const share of sources) {
      cumulative += share.lotteryWeight;
      if (cumulative > r) {
        genomeWinnerSourceIndex = share.sourceIndex;
        genomeWinnerLineage = `${genome[G.LIN_HI * n + share.sourceIndex]}:${genome[G.LIN_LO * n + share.sourceIndex]}`;
        break;
      }
    }
    if (genomeWinnerSourceIndex === null) throw new Error("transport lottery lacked a winner");
  }
  return { destinationIndex, sources, incoming: { B: inB, P: inP, E: inE },
    genomeWinnerSourceIndex, genomeWinnerLineage };
}

/** Check a captured pre-reaction transport state; a post-reaction snapshot is insufficient. */
export function assertTransportObservation(audit: TransportDestinationAudit, transported: TransportInput): void {
  const n = cellCount(transported.cfg), i = audit.destinationIndex;
  if (transported.cells[CH.B * n + i] !== audit.incoming.B ||
      transported.cells[CH.P * n + i] !== audit.incoming.P ||
      transported.cells[CH.E * n + i] !== audit.incoming.E)
    throw new Error(`transport material shares do not match pre-reaction state at ${i}`);
  const genome = genomeHeadOf(transported);
  const label = `${genome[G.LIN_HI * n + i]}:${genome[G.LIN_LO * n + i]}`;
  if (audit.genomeWinnerLineage !== (audit.genomeWinnerSourceIndex === null ? null : label))
    throw new Error(`transport genome winner does not match pre-reaction state at ${i}`);
}

/** Group exact pre-reaction shares by a frozen source-region assignment. */
export function sourceRegionShares(audit: TransportDestinationAudit,
  regionOfSource: ReadonlyMap<number, string>): Record<string, { B: number; P: number; E: number }> {
  const out: Record<string, { B: number; P: number; E: number }> = Object.create(null);
  for (const share of audit.sources) {
    const key = regionOfSource.get(share.sourceIndex) ?? "unassigned";
    const row = out[key] ??= { B: 0, P: 0, E: 0 };
    row.B += share.B; row.P += share.P; row.E += share.E;
  }
  return out;
}
