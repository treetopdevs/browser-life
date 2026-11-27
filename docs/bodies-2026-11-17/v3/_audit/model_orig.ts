// Set-loose bodies: a standalone integer cellular automaton. A body is only a pile of live
// cells that a local rule keeps together. There is no body id, no Organism object and no
// membership list in the dynamics; `census()` labels connected components for readouts only.
//
// DESIGNED ingredients (hand-built, not discovered): root cells (d == 0), the chamfer distance
// signal d (each cell sets d = 1-step + min over live neighbours), and the size gene g0 (dmax)
// that says how far from a root growth may reach. A diffusive-inhibitor design was tried first
// and abandoned (the field next to a body's edge saturates, so the threshold window is too narrow).
//
// Upkeep (the only matter sink) can be switched off for 'fed' shape tests; an alone body on rain food decays.
//
// Matter ledger (exact integers): total = sum(food) + sum(store) + C*cells
//   total = initialMatter + supplied - burned - lostOverflow - lostWound.
//
// Integer bounds: food <= 64 and store <= 24 by capped writes; d <= 255 via min(255, ..), the largest
// intermediate sum is 255 + 3; g0 in 6..60 so dmax + ORPH <= 74; g3 * ROOTP <= 255 * 24 = 6120 < 65536.
// Counters are JS numbers (supplied <= 9216 * 24 / 256 * steps, far below 2^53). No floats in state.

/** Rule version 1 (2026-11-17, kept so its numbers reproduce): a cell only absorbs from its own tile; no forage, no transport. */
export const RULES_V1 = Object.freeze({
  version: 1, W: 96, H: 96, N: 96 * 96, C: 3, FMAX: 64, CAP: 24, SUPPLY: 24, UPK: 4, SHARE: 4,
  BUDMIN: 14, BUDSHARE: 8, ORPH: 14, ORPHP: 2, RCOST: 6, ROOTP: 24, MUT: 3, INIT_FOOD: 32, FOUNDER_STORE: 16,
  FORAGE: 0, FLOW: 0, KEEP: 0, ORPH16: 0,
});
/** Rule version 2: v1 plus surface foraging and internal transport of stored food (hand-designed; see the README). */
export const RULES_V2 = Object.freeze({ ...RULES_V1, version: 2, UPK: 8, INIT_FOOD: 4, FORAGE: 1, FLOW: 1, KEEP: 3, ORPH16: 16 });
export type Rules = { -readonly [K in keyof typeof RULES_V2]: number };
/** Default rules: v2. Geometry and bounds are the same in both versions. */
export const RULES = RULES_V2;

export type Genome = readonly [number, number, number, number];
export const GENE_NAMES = ['dmax', 'grow', 'bud', 'rim'] as const;
/** [min, max, mutation step] per gene. */
export const GENE_RANGES: readonly (readonly [number, number, number])[] = [[6, 60, 2], [8, 255, 16], [0, 255, 2], [0, 255, 8]];
export const FOUNDER_GENOME: Genome = [16, 60, 4, 0];

export interface WorldOptions {
  seed: number; founders?: number; genome?: Genome; mutRate?: number; upkeep?: boolean; positions?: readonly (readonly [number, number])[];
  /** 1 = the original rule, 2 = foraging + transport (default). */
  version?: 1 | 2;
  /** Override rule constants (variants and tests). */
  rules?: Partial<Rules>;
  /** Neutral control: genes still mutate and are inherited, but every dynamics read uses the founder genome. */
  blind?: boolean;
}

/** Reject rule overrides that would break the storage bounds (Uint8 food/store/d, fixed geometry) or the integer arguments. Throws. */
export function checkedRules(R: Rules): Rules {
  const known = Object.keys(RULES_V2) as (keyof Rules)[];
  for (const k of Object.keys(R)) if (!known.includes(k as keyof Rules)) throw new Error(`unknown rule ${k}`);
  for (const k of known) if (!Number.isInteger(R[k]) || R[k] < 0) throw new Error(`rule ${k} must be a non-negative integer, got ${R[k]}`);
  const need = (ok: boolean, msg: string) => { if (!ok) throw new Error(`rule bounds: ${msg}`); };
  need(R.W === RULES_V2.W && R.H === RULES_V2.H && R.N === RULES_V2.N, 'W, H, N are fixed by the typed arrays');
  need(R.C >= 1 && R.C <= 8, 'C in 1..8');
  need(R.FMAX >= R.C && R.FMAX <= 255, 'FMAX in C..255 (food is a Uint8Array)');
  need(R.CAP >= 1 && R.CAP <= 255, 'CAP in 1..255 (store is a Uint8Array)');
  need(R.INIT_FOOD <= R.FMAX, 'INIT_FOOD <= FMAX');
  need(R.FOUNDER_STORE <= R.CAP, 'FOUNDER_STORE <= CAP');
  need(R.SHARE >= 1 && R.SHARE < R.CAP && R.BUDSHARE >= 1 && R.BUDSHARE <= R.CAP, 'SHARE < CAP and BUDSHARE <= CAP');
  need(R.UPK >= 1 && R.SUPPLY <= 256 && R.MUT <= 256, 'UPK >= 1, SUPPLY and MUT <= 256');
  need(R.ORPH16 <= 65536 && R.ORPHP <= 256, 'ORPH16 <= 65536, ORPHP <= 256');
  need(60 + R.ORPH + 3 <= 255 && R.ROOTP * 255 < 2 ** 31, 'ORPH and ROOTP keep d and the rim-root threshold in range');
  need(R.RCOST + 4 <= R.CAP + 4 && R.RCOST <= R.CAP, 'RCOST <= CAP');
  return R;
}

const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DY = [0, 1, 1, 1, 0, -1, -1, -1];
const DSTEP = [2, 3, 2, 3, 2, 3, 2, 3];

export function hash32(a: number, b: number, c: number, d: number): number {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 15; h = Math.imul(h ^ (b | 0), 0xc2b2ae35);
  h ^= h >>> 13; h = Math.imul(h ^ (c | 0), 0x165667b1);
  h ^= h >>> 16; h = Math.imul(h ^ Math.imul(d | 0, 0x27d4eb2f), 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}

const FOUNDER_SPOTS: readonly (readonly [number, number])[] = [[24, 24], [72, 30], [46, 72], [20, 68], [74, 74]];

export class BodiesWorld {
  seed: number; t = 0; mutRate: number; upkeep: boolean; R: Rules; blind: boolean; founderGenome: Genome;
  cell = new Uint8Array(RULES.N); food = new Uint8Array(RULES.N); store = new Uint8Array(RULES.N);
  d = new Uint8Array(RULES.N).fill(255);
  g0 = new Uint8Array(RULES.N); g1 = new Uint8Array(RULES.N); g2 = new Uint8Array(RULES.N); g3 = new Uint8Array(RULES.N);
  tag = new Uint16Array(RULES.N);
  /** Observer bookkeeping only (never read by the dynamics, not in the state hash): step at which a cell became a root, -1 if not a root. */
  rootSince = new Int32Array(RULES.N).fill(-1);
  rootsCreated = 0; rootsEnded = 0; rootLifeSum = 0; foraged = 0; moved = 0;
  private f0 = new Uint8Array(RULES.N); private f1 = new Uint8Array(RULES.N); private f2 = new Uint8Array(RULES.N); private f3 = new Uint8Array(RULES.N);
  nextTag = 1; supplied = 0; burned = 0; lostOverflow = 0; lostWound = 0; births = 0; mutations = 0; rootings = 0; initialMatter = 0;
  private d2 = new Uint8Array(RULES.N);
  private dead = new Int32Array(RULES.N);

  constructor(o: WorldOptions) {
    this.seed = o.seed | 0; this.mutRate = o.mutRate ?? 0; this.upkeep = o.upkeep ?? true;
    this.R = checkedRules({ ...(o.version === 1 ? RULES_V1 : RULES_V2), ...(o.rules ?? {}) } as Rules); this.blind = o.blind ?? false;
    const genome = o.genome ?? FOUNDER_GENOME; this.founderGenome = genome;
    this.f0.fill(genome[0]); this.f1.fill(genome[1]); this.f2.fill(genome[2]); this.f3.fill(genome[3]);
    this.food.fill(this.R.INIT_FOOD);
    const nf = o.founders ?? 1;
    const spots = o.positions ?? (nf === 1 ? [[48, 48] as const] : FOUNDER_SPOTS.slice(0, nf));
    for (const [x, y] of spots) {
      const i = ((y + RULES.H) % RULES.H) * RULES.W + ((x + RULES.W) % RULES.W);
      this.cell[i] = 1; this.store[i] = this.R.FOUNDER_STORE; this.d[i] = 0;
      this.g0[i] = genome[0]; this.g1[i] = genome[1]; this.g2[i] = genome[2]; this.g3[i] = genome[3];
      this.rootSince[i] = 0; this.rootsCreated++;
    }
    this.initialMatter = this.matterTotal();
  }

  setMutation(on: boolean): void { this.mutRate = on ? this.R.MUT : 0; }
  setUpkeep(on: boolean): void { this.upkeep = on; }

  matterTotal(): number {
    let s = 0;
    for (let i = 0; i < RULES.N; i++) s += this.food[i] + this.store[i] + this.cell[i] * this.R.C;
    return s;
  }
  residual(): number { return this.matterTotal() - (this.initialMatter + this.supplied - this.burned - this.lostOverflow - this.lostWound); }

  private addFood(i: number, n: number): void {
    const room = this.R.FMAX - this.food[i];
    if (n <= room) this.food[i] += n; else { this.food[i] = this.R.FMAX; this.lostOverflow += n - room; }
  }

  private birth(tile: number, par: number, share: number, r: number, dv: number): void {
    this.food[tile] -= this.R.C; this.store[par] -= share;
    this.cell[tile] = 1; this.store[tile] = share; this.d[tile] = dv;
    if (dv === 0) this.markRoot(tile);
    let a = this.g0[par], b = this.g1[par], c = this.g2[par], e = this.g3[par], tg = this.tag[par];
    if (this.mutRate > 0 && ((r >>> 20) & 255) < this.mutRate) {
      const f = (r >>> 28) & 3;
      const dir = (hash32(r, f, 0, 9) & 1) ? 1 : -1;
      const [lo, hi, st] = GENE_RANGES[f];
      const cur = f === 0 ? a : f === 1 ? b : f === 2 ? c : e;
      const nv = Math.min(hi, Math.max(lo, cur + dir * st));
      if (nv !== cur) {
        if (f === 0) a = nv; else if (f === 1) b = nv; else if (f === 2) c = nv; else e = nv;
        tg = this.nextTag++ & 0xffff; this.mutations++;
      }
    }
    this.g0[tile] = a; this.g1[tile] = b; this.g2[tile] = c; this.g3[tile] = e; this.tag[tile] = tg;
    this.births++;
  }

  step(n = 1): void { for (let k = 0; k < n; k++) this.stepOnce(); }

  private stepOnce(): void {
    const { W, H, N, C, FMAX, CAP, SUPPLY, UPK, SHARE, BUDMIN, BUDSHARE, ORPH, ORPHP, RCOST, ROOTP, FORAGE, FLOW, KEEP, ORPH16 } = this.R;
    const { cell, food, store, d, d2, seed, t } = this;
    // Gene reads: the neutral control reads the founder genome for every cell (genes still mutate and are inherited).
    const g0 = this.blind ? this.f0 : this.g0, g1 = this.blind ? this.f1 : this.g1, g2 = this.blind ? this.f2 : this.g2, g3 = this.blind ? this.f3 : this.g3;
    // 1. supply
    for (let i = 0; i < N; i++) {
      if ((hash32(seed, t, i, 1) & 255) < SUPPLY) { this.supplied++; if (food[i] < FMAX) food[i]++; else this.lostOverflow++; }
    }
    // 2a. absorb from the cell's own tile
    for (let i = 0; i < N; i++) if (cell[i] && food[i] > 0 && store[i] < CAP) { food[i]--; store[i]++; }
    // 2b. (v2) surface foraging: a live cell may take up to FORAGE units from one adjacent empty tile, leaving KEEP
    // behind so the tile can still found a new cell. Rotated scan, 4-neighbours, start direction from the hash.
    if (FORAGE > 0) {
      const offf = hash32(seed, t, 0, 11) % N;
      for (let k = 0; k < N; k++) {
        let i = offf + k; if (i >= N) i -= N;
        if (!cell[i] || store[i] >= CAP) continue;
        const x = i % W, y = (i - x) / W, r0 = hash32(seed, t, i, 12) & 3;
        for (let q = 0; q < 4; q++) {
          const dir = ((r0 + q) & 3) * 2;
          const p = ((y + DY[dir] + H) % H) * W + ((x + DX[dir] + W) % W);
          if (cell[p] || food[p] <= KEEP) continue;
          const take = Math.min(FORAGE, food[p] - KEEP, CAP - store[i]);
          food[p] -= take; store[i] += take; this.foraged += take; break;
        }
      }
    }
    // 2c. (v2) transport: along each live edge the higher store hands half the difference to the lower (remainder stays).
    if (FLOW > 0) {
      const offt = hash32(seed, t, 0, 13) % N;
      for (let k = 0; k < N; k++) {
        let i = offt + k; if (i >= N) i -= N;
        if (!cell[i]) continue;
        const x = i % W, y = (i - x) / W;
        for (let q = 0; q < 2; q++) {
          const p = q === 0 ? y * W + ((x + 1) % W) : ((y + 1) % H) * W + x;
          if (!cell[p]) continue;
          const diff = store[i] - store[p];
          if (diff >= 2) { const m = Math.min(FLOW * 8, diff >> 1); store[i] -= m; store[p] += m; this.moved += m; }
          else if (diff <= -2) { const m = Math.min(FLOW * 8, (-diff) >> 1); store[p] -= m; store[i] += m; this.moved += m; }
        }
      }
    }
    // 2d. upkeep
    let nd = 0;
    if (this.upkeep) {
      for (let i = 0; i < N; i++) {
        if (!cell[i] || (t + i) % UPK !== 0) continue;
        if (store[i] > 0) { store[i]--; this.burned++; } else this.dead[nd++] = i;
      }
    }
    for (let k = 0; k < nd; k++) {
      const i = this.dead[k];
      this.addFood(i, C + store[i]);
      this.clearCell(i);
    }
    // 3. distance relaxation (synchronous)
    for (let i = 0; i < N; i++) {
      if (!cell[i]) { d2[i] = 255; continue; }
      if (d[i] === 0) { d2[i] = 0; continue; }
      const x = i % W, y = (i - x) / W;
      let best = 255;
      for (let k = 0; k < 8; k++) {
        const p = ((y + DY[k] + H) % H) * W + ((x + DX[k] + W) % W);
        if (cell[p]) { const v = d[p] + DSTEP[k]; if (v < best) best = v; }
      }
      d2[i] = best;
      const r = hash32(seed, t, i, 5);
      if (best > g0[i] + ORPH && (ORPH16 > 0 ? (r >>> 16) < ORPH16 : (r & 255) < ORPHP)) { d2[i] = 0; this.rootings++; this.markRoot(i); }
      else if (best >= g0[i] - 3 && store[i] >= RCOST + 4 && ((r >>> 8) & 0xffff) < g3[i] * ROOTP) {
        d2[i] = 0; store[i] -= RCOST; this.addFood(i, RCOST); this.rootings++; this.markRoot(i);
      }
    }
    d.set(d2);
    // 4. growth
    const off = hash32(seed, t, 0, 2) % N;
    for (let k = 0; k < N; k++) {
      let i = off + k; if (i >= N) i -= N;
      if (cell[i] || food[i] < C) continue;
      const r = hash32(seed, t, i, 3);
      const x = i % W, y = (i - x) / W;
      let par = -1, best = 1000;
      for (let q = 0; q < 8; q++) {
        const dir = (r + q) & 7;
        const p = ((y + DY[dir] + H) % H) * W + ((x + DX[dir] + W) % W);
        if (cell[p]) { const v = d[p] + DSTEP[dir]; if (v < best) { best = v; par = p; } }
      }
      if (par < 0 || best > g0[par] || ((r >>> 8) & 255) >= g1[par] || store[par] < SHARE + 1) continue;
      this.birth(i, par, SHARE, r, best);
    }
    // 5. budding
    const off2 = hash32(seed, t, 0, 7) % N;
    for (let k = 0; k < N; k++) {
      let i = off2 + k; if (i >= N) i -= N;
      if (!cell[i] || store[i] < BUDMIN) continue;
      const r = hash32(seed, t, i, 4);
      if ((r & 65535) >= g2[i]) continue;
      const rr = hash32(seed, t, i, 6);
      const a = rr & 7, dist = (g0[i] >> 1) + 3 + ((rr >>> 3) & 3);
      const x = i % W, y = (i - x) / W;
      const tx = (((x + DX[a] * dist) % W) + W) % W, ty = (((y + DY[a] * dist) % H) + H) % H;
      const tile = ty * W + tx;
      if (cell[tile] || food[tile] < C) continue;
      this.birth(tile, i, BUDSHARE, r, 0);
    }
    this.t++;
  }

  private markRoot(i: number): void { this.rootSince[i] = this.t; this.rootsCreated++; }
  private clearCell(i: number): void {
    if (this.rootSince[i] >= 0) { this.rootsEnded++; this.rootLifeSum += this.t - this.rootSince[i]; this.rootSince[i] = -1; }
    this.cell[i] = 0; this.store[i] = 0; this.d[i] = 255;
    this.g0[i] = this.g1[i] = this.g2[i] = this.g3[i] = 0; this.tag[i] = 0;
  }

  /** Destroy every live cell in a disk (torus wrap). Returns the number killed. Matter is destroyed, not composted. */
  injure(cx: number, cy: number, r: number): number {
    const { W, H, C } = this.R; let killed = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const i = (((cy + dy) % H + H) % H) * W + (((cx + dx) % W + W) % W);
      if (!this.cell[i]) continue;
      this.lostWound += C + this.store[i]; this.clearCell(i); killed++;
    }
    return killed;
  }

  cellCount(): number { let n = 0; for (let i = 0; i < RULES.N; i++) n += this.cell[i]; return n; }

  hashState(): number { return hashState(this); }
}

/** One founder alone, no mutation, upkeep off ("fed"): isolates what the shape rule itself does. */
export function soloWorld(genome: Genome, seed: number, extra: Partial<WorldOptions> = {}): BodiesWorld { return new BodiesWorld({ seed, founders: 1, genome, mutRate: 0, upkeep: false, ...extra }); }

export function hashState(w: BodiesWorld): number {
  let h = 0x811c9dc5;
  const mix = (v: number) => { h = Math.imul(h ^ (v & 255), 0x01000193); h = Math.imul(h ^ ((v >>> 8) & 255), 0x01000193); h = Math.imul(h ^ ((v >>> 16) & 255), 0x01000193); h = Math.imul(h ^ ((v >>> 24) & 255), 0x01000193); };
  for (const a of [w.cell, w.food, w.store, w.d, w.g0, w.g1, w.g2, w.g3, w.tag]) for (let i = 0; i < a.length; i++) { h = Math.imul(h ^ a[i], 0x01000193); if (a === w.tag) h = Math.imul(h ^ (a[i] >>> 8), 0x01000193); }
  for (const v of [w.t, w.nextTag, w.supplied, w.burned, w.lostOverflow, w.lostWound, w.births, w.mutations, w.rootings, w.initialMatter]) mix(v);
  return h >>> 0;
}

export function validateWorld(w: BodiesWorld): string[] {
  const errs: string[] = [];
  const res = w.residual(); if (res !== 0) errs.push(`ledger residual ${res}`);
  for (let i = 0; i < RULES.N; i++) {
    if (w.food[i] > w.R.FMAX) { errs.push(`food ${i}`); break; }
    if (w.store[i] > w.R.CAP) { errs.push(`store ${i}`); break; }
    if (w.cell[i]) {
      for (let f = 0; f < 4; f++) {
        const v = f === 0 ? w.g0[i] : f === 1 ? w.g1[i] : f === 2 ? w.g2[i] : w.g3[i];
        if (v < GENE_RANGES[f][0] || v > GENE_RANGES[f][1]) { errs.push(`gene ${f} at ${i}`); break; }
      }
    } else if (w.store[i] !== 0) { errs.push(`store on empty ${i}`); break; }
  }
  return errs;
}

export interface Census {
  t: number; cells: number; comps: number; sizes: number[]; sizeHist: number[]; largest: number; singletons: number;
  largestSharePermille: number; interiorPermille: number; edgesPerCellPermille: number; coveragePermille: number;
  genomeVariants: number; dominant: { genome: Genome; cells: number } | null; top: { genome: Genome; cells: number }[];
  geneMeansX10: number[]; roots: number; mutations: number;
  /** All component sizes, largest first. */
  allSizes: number[];
  /** Component sizes (count of components): lower quartile, median, upper quartile. */
  sizeQ: [number, number, number];
  /** Observer-only root basins: each live cell follows its strictly-lower-d neighbour down to a root. Touching bodies count separately here. */
  domains: { n: number; sizes: number[]; q: [number, number, number]; unrooted: number };
  /** Root age in steps (observer bookkeeping): median and maximum over live roots. */
  rootAge: { median: number; max: number };
}

const quart = (a: number[]): [number, number, number] => {
  if (!a.length) return [0, 0, 0];
  const b = [...a].sort((x, y) => x - y), at = (f: number) => b[Math.min(b.length - 1, Math.floor((b.length - 1) * f))];
  return [at(0.25), at(0.5), at(0.75)];
};
/** Share of live cells (permille) in components whose size is within a factor of two of `ref`. */
export function shareWithinFactor2(c: { allSizes: number[]; cells: number }, ref: number): number {
  let n = 0; for (const z of c.allSizes) if (z * 2 >= ref && z <= ref * 2) n += z;
  return c.cells ? Math.floor(n * 1000 / c.cells) : 0;
}

function basins(w: BodiesWorld): { n: number; sizes: number[]; q: [number, number, number]; unrooted: number } {
  const { W, H, N } = RULES; const dom = new Int32Array(N).fill(-2); const count = new Map<number, number>(); let unrooted = 0;
  const path: number[] = [];
  for (let s = 0; s < N; s++) {
    if (!w.cell[s] || dom[s] !== -2) continue;
    path.length = 0; let i = s, res = -1;
    for (;;) {
      if (dom[i] !== -2) { res = dom[i]; break; }
      path.push(i);
      if (w.d[i] === 0) { res = i; break; }
      const x = i % W, y = (i - x) / W; let best = w.d[i], nxt = -1;
      for (let k = 0; k < 8; k++) {
        const p = ((y + DY[k] + H) % H) * W + ((x + DX[k] + W) % W);
        if (w.cell[p] && w.d[p] < best) { best = w.d[p]; nxt = p; }
      }
      if (nxt < 0) { res = -1; break; }
      i = nxt;
    }
    for (const q of path) dom[q] = res;
    if (res < 0) unrooted += path.length; else count.set(res, (count.get(res) ?? 0) + path.length);
  }
  const sizes = [...count.values()].sort((a, b) => b - a);
  return { n: sizes.length, sizes, q: quart(sizes), unrooted };
}

/** The only place connected components are labelled. Readout only; nothing in the dynamics reads this. */
export function census(w: BodiesWorld): Census {
  const { W, H, N } = RULES;
  const seen = new Uint8Array(N); const stack = new Int32Array(N);
  const sizes: number[] = []; let cells = 0, interior = 0, edges = 0, roots = 0;
  const variants = new Map<number, number>(); const sums = [0, 0, 0, 0]; const ages: number[] = [];
  for (let s = 0; s < N; s++) {
    if (!w.cell[s]) continue;
    cells++;
    const x = s % W, y = (s - x) / W;
    let open = 0;
    for (let k = 0; k < 8; k += 2) {
      const p = ((y + DY[k] + H) % H) * W + ((x + DX[k] + W) % W);
      if (!w.cell[p]) open++;
    }
    edges += open; if (open === 0) interior++;
    if (w.d[s] === 0) { roots++; if (w.rootSince[s] >= 0) ages.push(w.t - w.rootSince[s]); }
    const key = ((w.g0[s] * 256 + w.g1[s]) * 256 + w.g2[s]) * 256 + w.g3[s];
    variants.set(key, (variants.get(key) ?? 0) + 1);
    sums[0] += w.g0[s]; sums[1] += w.g1[s]; sums[2] += w.g2[s]; sums[3] += w.g3[s];
    if (seen[s]) continue;
    let sp = 0, size = 0; stack[sp++] = s; seen[s] = 1;
    while (sp) {
      const i = stack[--sp]; size++;
      const xi = i % W, yi = (i - xi) / W;
      for (let k = 0; k < 8; k++) {
        const p = ((yi + DY[k] + H) % H) * W + ((xi + DX[k] + W) % W);
        if (w.cell[p] && !seen[p]) { seen[p] = 1; stack[sp++] = p; }
      }
    }
    sizes.push(size);
  }
  sizes.sort((a, b) => b - a);
  const hist = new Array(14).fill(0);
  for (const z of sizes) hist[31 - Math.clz32(z)]++;
  const ranked = [...variants.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([key, n]) => ({
    genome: [Math.floor(key / 16777216), Math.floor(key / 65536) & 255, Math.floor(key / 256) & 255, key & 255] as Genome, cells: n,
  }));
  const largest = sizes[0] ?? 0;
  const aq = quart(ages); const rootAge = { median: aq[1], max: ages.length ? Math.max(...ages) : 0 };
  return {
    t: w.t, cells, comps: sizes.length, sizes: sizes.slice(0, 8), sizeHist: hist, largest, singletons: sizes.filter((z) => z === 1).length,
    largestSharePermille: cells ? Math.floor(largest * 1000 / cells) : 0,
    interiorPermille: cells ? Math.floor(interior * 1000 / cells) : 0,
    edgesPerCellPermille: cells ? Math.floor(edges * 1000 / cells) : 0,
    coveragePermille: Math.floor(cells * 1000 / N),
    genomeVariants: variants.size, dominant: ranked[0] ?? null, top: ranked.slice(0, 3),
    geneMeansX10: sums.map((s) => cells ? Math.floor(s * 10 / cells) : 0), roots, mutations: w.mutations,
    allSizes: sizes, sizeQ: quart(sizes), domains: basins(w), rootAge,
  };
}
