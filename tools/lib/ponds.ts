// Pond cycle of the ecological-scaffolding sandbox (docs/scaffold-protocol-v1.md, "Pond cycle").
// Tiles are ponds: at each boundary every pond is ground back to nutrient and reseeded by a k x k
// packet copied from a donor pond. The transform is host-side and pure -- it runs between steps
// (GpuSim.readState -> applyPondCycle -> assertConserved -> GpuSim.upload) and never touches the
// per-step rules. Matter (A+B+C+P) per pond is restored to its initial value M_r, and the energy
// ledger closes exactly through two gross bookings (heatOut for what is ground up, lightIn for what
// lands), the way applyLesion books its heat. All arithmetic is integer; ledger sums are bigint.
// Pure and CPU only: no Deno API, so vitest exercises it directly.
import {
  CH,
  G,
  GENOME_CHANNELS,
  M3_FOUNDERS,
  buildWorld,
  cellBase,
  cellCount,
  defaultConfig,
  draw,
  founderGenome,
  totalsOf,
  worldW,
  type Founder,
  type Genome,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";
import { MOT_ZERO } from "@bl/sim-ref";
import { DEFAULT_EVAL } from "@bl/search";

/** Salts every pond-cycle random key away from the physics and mutation streams ("POND"). */
export const POND_SALT = 0x504f4e44;

/** Column order of ponds.tsv. */
export const POND_COLUMNS = [
  "cycle", "step", "recipient", "donor", "cx", "cy", "landed", "reqMass", "retMass", "reqE", "retE", "truncated",
  "packetLineages", "domHi", "domLo", "domShare", "donorTrait", "recipientTrait", "recipientIndividuals", "recipientLineages", "heat", "light",
] as const;

export type PondArm = "scaf" | "rand" | "cont";

/**
 * One recipient's row of one cycle. Integers except `domShare`; `heat` and `light` are decimal strings
 * of bigints. `cx`, `cy` are the packet centre in the donor's tile-local coordinates. The packet
 * columns (`packetLineages`, `dom*`) describe the retained landed cells with B+P > 0.
 */
export interface PondRow {
  cycle: number;
  step: number;
  recipient: number;
  donor: number;
  cx: number;
  cy: number;
  landed: number;
  reqMass: number;
  retMass: number;
  reqE: number;
  retE: number;
  truncated: number;
  packetLineages: number;
  domHi: number;
  domLo: number;
  domShare: number;
  donorTrait: number;
  recipientTrait: number;
  recipientIndividuals: number;
  recipientLineages: number;
  heat: string;
  light: string;
}

/** Census support threshold: a cell counts toward a pond's trait, lineages and packet centre from B+P >= 48. */
const SUPPORT = 48;
/** Pond side and the landing centre, fixed by the protocol (tiles are 64x64, the packet lands at (32, 32)). */
const TILE = 64;
const CENTRE = 32;

const lineageKey = (hi: number, lo: number): string => `${hi}:${lo}`;

/** The M3 evaluator's world configuration at `side`x`side` ponds. An undefined `mutRate` keeps defaultConfig's own. */
export function pondConfig(side: number, seed: number, mutRate?: number): WorldConfig {
  return defaultConfig({
    ...DEFAULT_EVAL.world,
    tileW: TILE,
    tileH: TILE,
    tilesX: side,
    tilesY: side,
    seed,
    ...(mutRate === undefined ? {} : { mutRate }),
  });
}

const pondCount = (cfg: WorldConfig): number => cfg.tilesX * cfg.tilesY;

function assertPondTiles(cfg: WorldConfig): void {
  if (cfg.tileW !== TILE || cfg.tileH !== TILE) throw new Error(`ponds are ${TILE}x${TILE} tiles, got ${cfg.tileW}x${cfg.tileH}`);
}

/** World cell index of tile-local (x, y) in `pond` (pond index = ty * tilesX + tx). */
function cellOf(cfg: WorldConfig, pond: number, x: number, y: number): number {
  const tx = pond % cfg.tilesX;
  const ty = (pond - tx) / cfg.tilesX;
  return (ty * cfg.tileH + y) * worldW(cfg) + tx * cfg.tileW + x;
}

/** The standard disc of the protocol (evaluate.ts:181): radius 10, biomass 64, energy 128 at the pond centre. */
function standardFounder(cfg: WorldConfig, pond: number, genome: Genome): Founder {
  const tx = pond % cfg.tilesX;
  const ty = (pond - tx) / cfg.tilesX;
  return { x: tx * cfg.tileW + CENTRE, y: ty * cfg.tileH + CENTRE, radius: 10, genome, biomass: 64, energy: 128 };
}

/** One standard disc of `genome` in every pond, nutrient 32. Lineage ids follow planting index (= pond index). */
export function cloneWorld(cfg: WorldConfig, genome: Genome): WorldState {
  assertPondTiles(cfg);
  const founders = Array.from({ length: pondCount(cfg) }, (_, t) => standardFounder(cfg, t, genome));
  return buildWorld(cfg, { nutrient: 32, founders });
}

/** The 12 M3 founders round-robin as standard discs (pond t gets founder t mod 12); `plantingToFounder[t]` records the map. */
export function foundersWorld(cfg: WorldConfig): { state: WorldState; plantingToFounder: number[] } {
  assertPondTiles(cfg);
  const plantingToFounder = Array.from({ length: pondCount(cfg) }, (_, t) => t % M3_FOUNDERS.length);
  const founders = plantingToFounder.map((f, t) => standardFounder(cfg, t, founderGenome(M3_FOUNDERS[f])));
  return { state: buildWorld(cfg, { nutrient: 32, founders }), plantingToFounder };
}

/** Per-pond sums of `f(cell)` over the world, in one pass. */
function perPond(state: WorldState, f: (i: number) => number): number[] {
  const cfg = state.cfg;
  const W = worldW(cfg);
  const n = cellCount(cfg);
  const out = new Array<number>(pondCount(cfg)).fill(0);
  for (let i = 0; i < n; i++) {
    const x = i % W;
    const y = (i - x) / W;
    out[Math.floor(y / cfg.tileH) * cfg.tilesX + Math.floor(x / cfg.tileW)] += f(i);
  }
  return out;
}

/** A+B+C+P per pond. */
export function pondMatter(state: WorldState): number[] {
  const n = cellCount(state.cfg);
  const c = state.cells;
  return perPond(state, (i) => c[CH.A * n + i] + c[CH.B * n + i] + c[CH.C * n + i] + c[CH.P * n + i]);
}

/** B+P per pond summed over cells with B+P >= 48 (the census support threshold). */
export function pondTraits(state: WorldState): number[] {
  const n = cellCount(state.cfg);
  const c = state.cells;
  return perPond(state, (i) => {
    const m = c[CH.B * n + i] + c[CH.P * n + i];
    return m >= SUPPORT ? m : 0;
  });
}

/** `draw(cellBase((seed ^ POND_SALT) >>> 0, b, slot), purpose)`. Purposes 0-4 cycle, 5-6 assay source pond, 8 permutation. */
export function randomKey(seed: number, b: number, slot: number, purpose: number): number {
  return draw(cellBase((seed ^ POND_SALT) >>> 0, b, slot), purpose);
}

/**
 * Seed of an assay's fragments and physics: 4,820,001 + 5000 r + 250 h + 100 t + 20 v + s. Mixed radix, so it
 * cannot collide; the fields are range-checked.
 */
export function assaySeed(r: number, h: number, t: number, v: number, s: number): number {
  const field = (name: string, x: number, max: number) => {
    if (!Number.isInteger(x) || x < 0 || x > max) throw new Error(`assaySeed: ${name} must be an integer in 0..${max}, got ${x}`);
  };
  field("r", r, 4);
  field("h", h, 18);
  field("t", t, 1);
  field("v", v, 4);
  field("s", s, 9);
  return 4_820_001 + 5000 * r + 250 * h + 100 * t + 20 * v + s;
}

/** `(hi * 2^21 + (lo >>> 11)) mod total`, exact: the numerator stays below 2^53. */
export function weightedPick(hi: number, lo: number, total: number): number {
  if (!Number.isInteger(total) || total < 1) throw new Error(`weightedPick: total must be a positive integer, got ${total}`);
  return ((hi >>> 0) * 2_097_152 + (lo >>> 11)) % total;
}

/**
 * The lineage with the largest trait mass (B+P over cells with B+P >= 48) in `ponds` (default: every pond),
 * ties to the smallest (hi, lo). Cells without a lineage are ignored. `null` if there is none.
 */
export function dominantGenome(state: WorldState, ponds?: number[]): { hi: number; lo: number; words: Uint32Array } | null {
  const cfg = state.cfg;
  const n = cellCount(cfg);
  const c = state.cells;
  const g = state.genome;
  const list = ponds ?? Array.from({ length: pondCount(cfg) }, (_, p) => p);
  const mass = new Map<string, { hi: number; lo: number; mass: number; cell: number }>();
  for (const p of list) {
    for (let y = 0; y < cfg.tileH; y++) {
      for (let x = 0; x < cfg.tileW; x++) {
        const i = cellOf(cfg, p, x, y);
        const m = c[CH.B * n + i] + c[CH.P * n + i];
        if (m < SUPPORT) continue;
        const hi = g[G.LIN_HI * n + i], lo = g[G.LIN_LO * n + i];
        if ((hi | lo) === 0) continue;
        const key = lineageKey(hi, lo);
        const e = mass.get(key);
        if (e) e.mass += m;
        else mass.set(key, { hi, lo, mass: m, cell: i });
      }
    }
  }
  let best: { hi: number; lo: number; mass: number; cell: number } | null = null;
  for (const e of mass.values()) {
    if (!best || e.mass > best.mass || (e.mass === best.mass && (e.hi < best.hi || (e.hi === best.hi && e.lo < best.lo)))) best = e;
  }
  if (!best) return null;
  const words = new Uint32Array(GENOME_CHANNELS);
  for (let w = 0; w < GENOME_CHANNELS; w++) words[w] = g[w * n + best.cell];
  return { hi: best.hi, lo: best.lo, words };
}

/**
 * World cell indices of the k x k window about `centreCell` (a cell of `pond`), row-major over (j, i), i.e.
 * offsets -floor(k/2) .. k-1-floor(k/2) on each axis, wrapping inside the pond's tile.
 */
export function packetWindow(state: WorldState, pond: number, k: number, centreCell: number): number[] {
  const cfg = state.cfg;
  if (!Number.isInteger(k) || k < 1 || k > Math.min(cfg.tileW, cfg.tileH)) throw new Error(`packet size k must be in 1..${Math.min(cfg.tileW, cfg.tileH)}, got ${k}`);
  const W = worldW(cfg);
  const cx = (centreCell % W) % cfg.tileW;
  const cy = Math.floor(centreCell / W) % cfg.tileH;
  const half = k >> 1;
  const out: number[] = [];
  for (let j = 0; j < k; j++) {
    const y = (((cy + j - half) % cfg.tileH) + cfg.tileH) % cfg.tileH;
    for (let i = 0; i < k; i++) {
      const x = (((cx + i - half) % cfg.tileW) + cfg.tileW) % cfg.tileW;
      out.push(cellOf(cfg, pond, x, y));
    }
  }
  return out;
}

/**
 * The packet centre for `slot` (the recipient) in `pond` (the donor): an eligible cell (B+P >= 48) drawn with
 * probability proportional to its B+P from purposes 3 (high) and 4 (low), walking the tile in raster order.
 * `null` if the pond has no eligible cell.
 */
export function drawPacketCentre(state: WorldState, pond: number, seed: number, b: number, slot: number): number | null {
  const cfg = state.cfg;
  const n = cellCount(cfg);
  const c = state.cells;
  const weight = (i: number) => {
    const m = c[CH.B * n + i] + c[CH.P * n + i];
    return m >= SUPPORT ? m : 0;
  };
  let total = 0;
  for (let y = 0; y < cfg.tileH; y++) for (let x = 0; x < cfg.tileW; x++) total += weight(cellOf(cfg, pond, x, y));
  if (total === 0) return null;
  const v = weightedPick(randomKey(seed, b, slot, 3), randomKey(seed, b, slot, 4), total);
  let acc = 0;
  for (let y = 0; y < cfg.tileH; y++) {
    for (let x = 0; x < cfg.tileW; x++) {
      const i = cellOf(cfg, pond, x, y);
      acc += weight(i);
      if (acc > v) return i;
    }
  }
  throw new Error("drawPacketCentre: unreachable, the weighted walk always ends past the draw");
}

export interface CycleResult {
  state: WorldState;
  rows: PondRow[];
  /** Gross heat booked (everything ground up) and light booked (everything landed). */
  heat: bigint;
  light: bigint;
  /** True when no pond was eligible: every pond is cleared and the history is over. */
  ended: boolean;
  /** Donor ponds in selection order. */
  donors: number[];
}

/** Per-pond census callback of applyPondCycle and contRows, indexed by pond. */
export type PondCensus = (s: WorldState) => { individuals: number[]; lineages: number[] };

/** Distinct lineage ids among each pond's cells with B+P >= 48. */
function pondLineages(state: WorldState): number[] {
  const cfg = state.cfg;
  const n = cellCount(cfg);
  const seen = Array.from({ length: pondCount(cfg) }, () => new Set<string>());
  const W = worldW(cfg);
  for (let i = 0; i < n; i++) {
    if (state.cells[CH.B * n + i] + state.cells[CH.P * n + i] < SUPPORT) continue;
    const hi = state.genome[G.LIN_HI * n + i], lo = state.genome[G.LIN_LO * n + i];
    if ((hi | lo) === 0) continue;
    const x = i % W;
    seen[Math.floor(Math.floor(i / W) / cfg.tileH) * cfg.tilesX + Math.floor(x / cfg.tileW)].add(lineageKey(hi, lo));
  }
  return seen.map((s) => s.size);
}

/** Heat of grinding each pond back to nutrient: sum of (eB-eA)B + (eP-eA)P + (eC-eA)C + E + S over its cells. */
function pondHeat(state: WorldState): bigint[] {
  const cfg = state.cfg;
  const n = cellCount(cfg);
  const c = state.cells;
  const W = worldW(cfg);
  const dB = BigInt(cfg.eB - cfg.eA), dP = BigInt(cfg.eP - cfg.eA), dC = BigInt(cfg.eC - cfg.eA);
  const out = new Array<bigint>(pondCount(cfg)).fill(0n);
  for (let i = 0; i < n; i++) {
    const B = c[CH.B * n + i], P = c[CH.P * n + i], C = c[CH.C * n + i], E = c[CH.E * n + i], S = c[CH.S * n + i];
    if ((B | P | C | E | S) === 0) continue;
    const x = i % W;
    out[Math.floor(Math.floor(i / W) / cfg.tileH) * cfg.tilesX + Math.floor(x / cfg.tileW)] += BigInt(B) * dB + BigInt(P) * dP + BigInt(C) * dC + BigInt(E) + BigInt(S);
  }
  return out;
}

const cmpKey = (a: { key: number; pond: number }, b: { key: number; pond: number }): number => a.key - b.key || a.pond - b.pond;

/** A pond's A refilled uniformly to `amount`, remainder one quantum per cell in raster order. */
function refillA(cells: Uint32Array, cfg: WorldConfig, pond: number, amount: number): void {
  const n = cellCount(cfg);
  const area = cfg.tileW * cfg.tileH;
  const each = Math.floor(amount / area);
  const rem = amount - each * area;
  let r = 0;
  for (let y = 0; y < cfg.tileH; y++)
    for (let x = 0; x < cfg.tileW; x++) cells[CH.A * n + cellOf(cfg, pond, x, y)] = each + (r++ < rem ? 1 : 0);
}

/**
 * One cycle of the pond transform at boundary `b` (protocol steps 1-7), from the pre-cycle snapshot `pre`.
 * Pure: `pre` is not mutated. `Mr` is each pond's initial matter; the post-transform state has exactly that
 * matter in every pond and the same `ledgerEnergy` as `pre`. Throws if the pre-cycle matter of any pond is not
 * `Mr` (the ledger would not close) or the post-transform matter is not.
 */
export function applyPondCycle(pre: WorldState, b: number, arm: "scaf" | "rand", k: number, Mr: number[], census?: PondCensus): CycleResult {
  const cfg = pre.cfg;
  assertPondTiles(cfg);
  const R = pondCount(cfg);
  const n = cellCount(cfg);
  if (Mr.length !== R) throw new Error(`Mr has ${Mr.length} ponds, the world has ${R}`);
  const preMatter = pondMatter(pre);
  for (let p = 0; p < R; p++) if (preMatter[p] !== Mr[p]) throw new Error(`pond ${p} holds matter ${preMatter[p]} before the cycle, not ${Mr[p]}`);

  const seed = cfg.seed;
  const traits = pondTraits(pre);
  const eligible: number[] = [];
  for (let p = 0; p < R; p++) if (traits[p] > 0) eligible.push(p);
  const D = Math.max(1, Math.floor(R / 4));
  const Dp = Math.min(D, eligible.length);

  const donors: number[] = [];
  if (Dp > 0) {
    if (arm === "scaf") {
      const order = eligible.map((pond) => ({ pond, key: randomKey(seed, b, pond, 0), trait: traits[pond] }));
      order.sort((x, y) => y.trait - x.trait || cmpKey(x, y));
      for (let d = 0; d < Dp; d++) donors.push(order[d].pond);
    } else {
      const order = eligible.map((pond) => ({ pond, key: randomKey(seed, b, pond, 1) }));
      order.sort(cmpKey);
      for (let d = 0; d < Dp; d++) donors.push(order[d].pond);
    }
  }

  const heatPond = pondHeat(pre);
  const lightPond = new Array<bigint>(R).fill(0n);
  const cells = new Uint32Array(pre.cells.length);
  cells.fill(MOT_ZERO, CH.MOT * n, (CH.MOT + 1) * n);
  const genome = new Uint32Array(pre.genome.length);
  const cen = census?.(pre);
  const lineages = pondLineages(pre);
  const dB = BigInt(cfg.eB - cfg.eA), dP = BigInt(cfg.eP - cfg.eA);
  const rows: PondRow[] = [];

  if (Dp === 0) {
    for (let p = 0; p < R; p++) {
      refillA(cells, cfg, p, Mr[p]);
      rows.push(makeRow(pre, b, p, -1, traits, cen, lineages, heatPond[p], 0n));
    }
  } else {
    const recipients = Array.from({ length: R }, (_, pond) => ({ pond, key: randomKey(seed, b, pond, 2) }));
    recipients.sort(cmpKey);
    const donorOf = new Array<number>(R).fill(-1);
    recipients.forEach((r, p) => (donorOf[r.pond] = donors[p % Dp]));

    const half = k >> 1;
    for (let r = 0; r < R; r++) {
      const donor = donorOf[r];
      const centre = drawPacketCentre(pre, donor, seed, b, r);
      if (centre === null) throw new Error(`donor pond ${donor} has no eligible cell`);
      const window = packetWindow(pre, donor, k, centre);
      const mass = window.map((i) => pre.cells[CH.B * n + i] + pre.cells[CH.P * n + i]);
      const reqMass = mass.reduce((a, m) => a + m, 0);
      const reqE = window.reduce((a, i) => a + pre.cells[CH.E * n + i], 0);
      // Truncation: drop landing cells in reverse raster order (window order is raster order) until the packet fits.
      let kept = window.length;
      let retMass = reqMass;
      while (retMass > Mr[r]) retMass -= mass[--kept];
      let retE = 0;
      let light = 0n;
      const packetMass = new Map<string, { hi: number; lo: number; mass: number }>();
      for (let q = 0; q < kept; q++) {
        const src = window[q];
        const dst = cellOf(cfg, r, CENTRE - half + (q % k), CENTRE - half + Math.floor(q / k));
        const B = pre.cells[CH.B * n + src], P = pre.cells[CH.P * n + src], E = pre.cells[CH.E * n + src];
        cells[CH.B * n + dst] = B;
        cells[CH.P * n + dst] = P;
        cells[CH.E * n + dst] = E;
        cells[CH.MOT * n + dst] = pre.cells[CH.MOT * n + src];
        for (let w = 0; w < GENOME_CHANNELS; w++) genome[w * n + dst] = pre.genome[w * n + src];
        retE += E;
        light += BigInt(B) * dB + BigInt(P) * dP + BigInt(E);
        const hi = pre.genome[G.LIN_HI * n + src], lo = pre.genome[G.LIN_LO * n + src];
        if (B + P > 0 && (hi | lo) !== 0) {
          const key = lineageKey(hi, lo);
          const e = packetMass.get(key);
          if (e) e.mass += B + P;
          else packetMass.set(key, { hi, lo, mass: B + P });
        }
      }
      refillA(cells, cfg, r, Mr[r] - retMass);
      lightPond[r] = light;
      let dom: { hi: number; lo: number; mass: number } | null = null;
      for (const e of packetMass.values())
        if (!dom || e.mass > dom.mass || (e.mass === dom.mass && (e.hi < dom.hi || (e.hi === dom.hi && e.lo < dom.lo)))) dom = e;
      const W = worldW(cfg);
      const row = makeRow(pre, b, r, donor, traits, cen, lineages, heatPond[r], light);
      row.cx = (centre % W) % cfg.tileW;
      row.cy = Math.floor(centre / W) % cfg.tileH;
      row.landed = kept;
      row.reqMass = reqMass;
      row.retMass = retMass;
      row.reqE = reqE;
      row.retE = retE;
      row.truncated = kept < window.length ? 1 : 0;
      row.packetLineages = packetMass.size;
      row.domHi = dom?.hi ?? 0;
      row.domLo = dom?.lo ?? 0;
      row.domShare = dom && retMass > 0 ? dom.mass / retMass : 0;
      rows.push(row);
    }
  }

  const heat = heatPond.reduce((a, h) => a + h, 0n);
  const light = lightPond.reduce((a, l) => a + l, 0n);
  const post: WorldState = { cfg, step: pre.step, cells, genome, lightIn: pre.lightIn + light, heatOut: pre.heatOut + heat, flux: pre.flux.slice() };
  const postMatter = pondMatter(post);
  for (let p = 0; p < R; p++) if (postMatter[p] !== Mr[p]) throw new Error(`pond ${p} holds matter ${postMatter[p]} after the cycle, not ${Mr[p]}`);
  return { state: post, rows, heat, light, ended: Dp === 0, donors };
}

/** A row with the recipient's pre-cycle measurements and every packet field zeroed (donor -1 and cx = cy = -1 unless set). */
function makeRow(pre: WorldState, b: number, recipient: number, donor: number, traits: number[], cen: { individuals: number[]; lineages: number[] } | undefined, lineages: number[], heat: bigint, light: bigint): PondRow {
  return {
    cycle: b,
    step: pre.step,
    recipient,
    donor,
    cx: -1,
    cy: -1,
    landed: 0,
    reqMass: 0,
    retMass: 0,
    reqE: 0,
    retE: 0,
    truncated: 0,
    packetLineages: 0,
    domHi: 0,
    domLo: 0,
    domShare: 0,
    donorTrait: donor >= 0 ? traits[donor] : 0,
    recipientTrait: traits[recipient],
    recipientIndividuals: cen ? cen.individuals[recipient] : -1,
    recipientLineages: lineages[recipient],
    heat: heat.toString(),
    light: light.toString(),
  };
}

/** The `cont` arm's summary rows at boundary `b`: one per pond, donor -1, cx = cy = -1, every packet field 0. */
export function contRows(pre: WorldState, b: number, census?: PondCensus): PondRow[] {
  const traits = pondTraits(pre);
  const cen = census?.(pre);
  const lineages = pondLineages(pre);
  return traits.map((_, p) => makeRow(pre, b, p, -1, traits, cen, lineages, 0n, 0n));
}

/** Σ e·X + E + S + heatOut − lightIn over the full state: the quantity the energy ledger holds constant. */
export function ledgerEnergy(state: WorldState): bigint {
  return totalsOf(state.cfg, state.cells).energy + state.heatOut - state.lightIn;
}

/** Throws unless total matter equals `startMatter` and the ledger equals `baseline` (`ledgerEnergy` of the initial state). */
export function assertConserved(state: WorldState, startMatter: bigint, baseline: bigint): void {
  const t = totalsOf(state.cfg, state.cells);
  if (t.matter !== startMatter) throw new Error(`matter not conserved at step ${state.step}: ${t.matter} != ${startMatter}`);
  const residual = ledgerEnergy(state) - baseline;
  if (residual !== 0n) throw new Error(`energy ledger residual ${residual} at step ${state.step}`);
}
