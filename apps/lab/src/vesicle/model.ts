// Vesicle world: walls are matter, division is mechanics. Rules in prose: docs/vesicle-2026-11-18/RULES.md.
//
// Three kinds of thing share a closed dish:
//   - wall beads, bonded into closed oriented loops (interior on the left of each bond). There are no body
//     ids: a vesicle is whatever a ring of bonds encloses, and observers find it by walking `next`.
//   - solute particles with positions. Wall bonds repel them, so pressure is the crowd pushing on the wall.
//   - small molecules (food, waste, free lipid) as integer counts on a grid; walls do not stop them.
// Counts (beads, particles, grid units) are integers and the matter total is exact. Positions are float64
// and the step uses only + - * / and Math.sqrt, which IEEE 754 rounds identically everywhere, so a run is
// reproducible bit for bit on any JS engine. (A GPU port in f32 would not match; see RULES.md.)

export interface Params {
  W: number; H: number;
  /** Grid cell edge for the small-molecule fields and the bond hash. */
  cell: number;
  // wall mechanics
  l0: number; ks: number; kb: number; beadNoise: number; beadCap: number;
  /** Ambient pressure: an inward force per unit wall length (outside solute, taken as well mixed). */
  pOut: number;
  // particle / wall contact
  rp: number; kp: number; partNoise: number;
  // wall / wall contact and pinching
  rw: number; kw: number; facing: number; minBeads: number; minArea: number;
  // lipid exchange (mass action both ways)
  kIn: number; kOut: number; sIn: number; sOut: number; rateMax: number;
  /** A wall with eight bonds in a row stretched past this ruptures: the loop returns to free lipid. 0 = never. */
  sBurst: number;
  // field diffusion: share of a cell's count that moves to each neighbour per step
  dLipid: number; dFood: number; dWaste: number;
  // chemistry (all zero = mechanics only)
  /** Lipid made within this distance of a wall bond joins that bond directly; farther away it enters the water. 0 = always the water. */
  rIns: number;
  kRep: number; kDecay: number; kLip: number; kLight: number; kLipDecay: number; foodCap: number; crowdCap: number;
  // heredity
  mut: number; mutStep: number; neutral: boolean;
  /** How much copying speed a particle gains by making less lipid: 1 = a pure copier copies twice as fast as the founder, 0 = no private gain. */
  tradeoff: number;
  /** Heredity lives in the wall: each bead carries the two bytes, a new bead copies them (with shifts) from an
   *  end of the bond it joins, and solute is only made against the inner face of a wall, stamped with that
   *  wall's bytes. Solute then carries no heredity of its own. Off = the bytes ride on solute (rung 2). */
  wallGenes: boolean;
  /** Control for `wallGenes`: solute copies only against the inner face of a wall, as there, but the copy
   *  takes its parent's bytes (shifted), as in rung 2. Ignored when `wallGenes` is on. */
  wallGate: boolean;
  /** Stage 1, "the thread": a linked genome that is a physical thing. A thread is a particle of its own kind that
   *  carries `tG` bytes (gene 0 = the lipid share solute takes, gene 1 = an idle marker) and is matter (one unit
   *  for its body plus the food it has stored). Solute can only copy next to a thread (nearest one within `rShare`,
   *  no wall between) and takes its bytes from it. A thread stores food from its grid cell and splits once it holds
   *  `tCost` and no other thread is within `rInhib` on its side of the walls; each byte of the copy may shift. A
   *  thread with fewer than `kSup` solute within `rSup` (same side of the walls) decays to waste at rate `kTDecay`.
   *  Off = nothing below is read, drawn or hashed. */
  thread: boolean;
  tG: number; tCost: number; kTFood: number; rInhib: number; rShare: number; kTDecay: number; rSup: number; kSup: number;
  maxThreads: number;
  /** Patchy moving light: with `lightPatches` > 0, waste turns to food only in grid cells whose centre lies within
   *  `patchR` of a patch centre; patches drift in straight lines at `patchSpeed` per step and wrap round the dish
   *  (a pure function of the step, no random draws). The rate inside is `kLight` times (cells in the dish / cells
   *  lit this step), so the light per unit area, averaged over the dish, equals the uniform case as long as the rate stays at or below 1 (kLight times dish cells / lit cells; above that the light is capped and the mean is lower). 0 = uniform light. */
  lightPatches: number; patchR: number; patchSpeed: number;
  maxBeads: number; maxParts: number;
}

export const DEFAULTS: Params = {
  W: 192, H: 192, cell: 4,
  l0: 2, ks: 0.3, kb: 0.02, beadNoise: 0.05, beadCap: 0.15,
  pOut: 0.0067,
  rp: 1, kp: 0.9, partNoise: 0.4,
  rw: 1, kw: 0.8, facing: 0.3, minBeads: 8, minArea: 12,
  kIn: 0.02, kOut: 0.005, sIn: 0.04, sOut: 0.04, rateMax: 4, sBurst: 0.25,
  dLipid: 0.02, dFood: 0.1, dWaste: 0.1,
  rIns: 3,
  kRep: 0, kDecay: 0, kLip: 0, kLight: 0, kLipDecay: 0, foodCap: 8, crowdCap: 6,
  mut: 0, mutStep: 8, neutral: false, tradeoff: 1, wallGenes: false, wallGate: false,
  thread: false, tG: 2, tCost: 6, kTFood: 0.02, rInhib: 14, rShare: 12, kTDecay: 0.01, rSup: 8, kSup: 3, maxThreads: 4096, lightPatches: 0, patchR: 40, patchSpeed: 0.004,
  maxBeads: 1 << 15, maxParts: 1 << 16,
};

export interface Events { pinch: number; dissolve: number; burst: number; insert: number; desorb: number; birth: number; decay: number; lipidMade: number; tcopy: number; tdecay: number }

/** Deterministic sine and cosine from basic operations only (seeding must not depend on the host's Math.sin). */
export function sinCos(theta: number): [number, number] {
  const TAU = 6.283185307179586;
  let t = theta - TAU * Math.floor(theta / TAU);
  if (t > TAU / 2) t -= TAU;
  const t2 = t * t;
  let s = t, c = 1, ts = t, tc = 1;
  for (let k = 1; k <= 12; k++) {
    tc = -tc * t2 / ((2 * k - 1) * (2 * k));
    ts = -ts * t2 / ((2 * k) * (2 * k + 1));
    c += tc; s += ts;
  }
  return [s, c];
}

export class VesicleWorld {
  readonly p: Params;
  step = 0;
  // wall beads
  readonly bx: Float64Array; readonly by: Float64Array;
  readonly next: Int32Array; readonly prev: Int32Array; readonly alive: Uint8Array;
  /** The wall's own bytes, one pair per bead: lipid share and idle marker (read only when `wallGenes` is on). */
  readonly wgene: Uint8Array; readonly wmark: Uint8Array;
  /** Length of bond i -> next[i] as of the last force pass. */
  readonly blen: Float64Array;
  private readonly fx: Float64Array; private readonly fy: Float64Array; private readonly born: Int32Array;
  /** Smallest distance, this step, between bead i and anything of the wall it is in contact with (a bond it
   *  is near, or a bead near one of its own two bonds); `rw` when it touches nothing. */
  private readonly gap: Float64Array;
  /** Set when a bead has left a ring since the hash was built: the shortcut bond can lie in cells that list
   *  neither of the bonds it replaced, so the next lookup rebuilds the hash first (except the desorption check, which
   *  searches `shortcuts` as well). */
  private hashStale = false;
  /** First beads of the shortcut bonds made since the hash was last built (read only by the lazy crossing check). */
  private shortcuts: number[] = [];
  beadHi = 0; beadCount = 0;
  /** Bead slots free for reuse, and those freed during this step (reused from the next step on, so a slot the
   *  bond hash still lists never comes back as a different bead within the step). */
  private freeBeads: number[] = []; private freedNow: number[] = [];
  // solute particles
  readonly px: Float64Array; readonly py: Float64Array;
  /** Share of a particle's activity spent making lipid, 0..255 (128 = founder). */
  readonly gene: Uint8Array;
  /** A byte that does nothing, copied and mutated like `gene`: the drift reference. */
  readonly mark: Uint8Array;
  readonly founder: Uint16Array;
  n = 0;
  // threads (stage 1; empty and untouched unless `thread` is on)
  readonly tx: Float64Array; readonly ty: Float64Array; readonly tgene: Uint8Array; readonly tstore: Int32Array;
  nt = 0;
  // small molecules
  readonly gw: number; readonly gh: number;
  readonly food: Int32Array; readonly waste: Int32Array; readonly lipid: Int32Array;
  private readonly tmp: Int32Array; readonly sCount: Int32Array;
  /** Grid cells lit by the patches, as filled by `lightMask()` (observers and the light step; not state). */
  readonly litMask: Uint8Array;
  /** Scratch for `lightMask`: per-axis distances to the patch and the columns and rows within its radius. */
  private colD?: Float64Array; private rowD?: Float64Array; private cols?: Int32Array; private rows?: Int32Array;
  // bond hash
  private readonly hStart: Int32Array; private hItems = new Int32Array(1024);
  // rng (sfc32)
  private ra: number; private rb: number; private rc: number; private rd: number;
  readonly events: Events = { pinch: 0, dissolve: 0, burst: 0, insert: 0, desorb: 0, birth: 0, decay: 0, lipidMade: 0, tcopy: 0, tdecay: 0 };
  /** Each pinch: step and the bead counts of the two daughters. */
  readonly pinchLog: { step: number; a: number; b: number }[] = [];
  /** Observer hooks (never read by the rules, no random draws): called around a successful pinch (stage 0 just
   *  before the reconnection, 1 just after; c..a and b..pc are the two daughters) and just before a whole ring is
   *  returned to free lipid. Empty by default. */
  readonly hooks: { pinch?: (stage: 0 | 1, c: number, a: number, pc: number, b: number) => void; end?: (kind: 'burst' | 'dissolve' | 'wound', bead: number) => void } = {};

  constructor(seed: number, params: Partial<Params> = {}) {
    const p = (this.p = { ...DEFAULTS, ...params });
    // the bond hash is built once per step, before beads move: its padding has to cover a bead's move,
    // and direct insertion looks one hash cell around
    if (!(p.beadCap < 0.35 * p.rw)) throw new Error('beadCap must be below 0.35 rw (two beads out of contact must not be able to cross in one step)');
    if (!(p.beadCap < Math.max(p.rp, p.rw))) throw new Error('beadCap must be below the hash padding max(rp, rw)');
    // a particle's move (push cap plus noise, per axis) has to stay inside that padding too, so that every bond
    // it could reach is listed in its own hash cell
    if (!(0.5 * p.rp + p.partNoise < Math.max(p.rp, p.rw))) throw new Error('0.5 * rp + partNoise must be below the hash padding max(rp, rw)');
    if (p.rIns > p.cell) throw new Error('rIns must not exceed the cell edge');
    this.gw = Math.ceil(p.W / p.cell); this.gh = Math.ceil(p.H / p.cell);
    const nb = p.maxBeads, np = p.maxParts, nc = this.gw * this.gh;
    this.bx = new Float64Array(nb); this.by = new Float64Array(nb);
    this.next = new Int32Array(nb).fill(-1); this.prev = new Int32Array(nb).fill(-1); this.alive = new Uint8Array(nb);
    this.blen = new Float64Array(nb); this.fx = new Float64Array(nb); this.fy = new Float64Array(nb); this.born = new Int32Array(nb).fill(-1);
    this.gap = new Float64Array(nb);
    this.wgene = new Uint8Array(nb).fill(128); this.wmark = new Uint8Array(nb).fill(128);
    if ((p.wallGenes || p.wallGate) && !(p.rIns > 0)) throw new Error('wallGenes and wallGate need rIns > 0 (solute is made within rIns of a wall)');
    const mt = p.thread ? p.maxThreads : 0;
    this.tx = new Float64Array(mt); this.ty = new Float64Array(mt); this.tgene = new Uint8Array(mt * p.tG); this.tstore = new Int32Array(mt);
    if (p.thread && !(Number.isInteger(p.tCost) && p.tCost >= 1)) throw new Error('tCost is a whole number of units, at least 1 (the body is one of them)');
    if (p.thread && !(p.tG >= 2)) throw new Error('threads carry at least two genes');
    if (p.thread && !(0.5 * p.rp + p.partNoise < Math.max(p.rp, p.rw))) throw new Error('thread moves must stay inside the hash padding');
    this.px = new Float64Array(np); this.py = new Float64Array(np);
    this.gene = new Uint8Array(np); this.mark = new Uint8Array(np); this.founder = new Uint16Array(np);
    this.food = new Int32Array(nc); this.waste = new Int32Array(nc); this.lipid = new Int32Array(nc);
    this.tmp = new Int32Array(nc); this.sCount = new Int32Array(nc); this.litMask = new Uint8Array(nc);
    this.hStart = new Int32Array(nc + 1);
    this.ra = 0x9e3779b9; this.rb = 0x243f6a88; this.rc = 0xb7e15162; this.rd = seed | 0;
    for (let i = 0; i < 16; i++) this.rand();
  }

  rand(): number {
    let a = this.ra | 0, b = this.rb | 0, c = this.rc | 0, d = this.rd | 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); c = (c + t) | 0;
    this.ra = a; this.rb = b; this.rc = c; this.rd = d;
    return (t >>> 0) / 4294967296;
  }

  cellOf(x: number, y: number): number {
    const c = this.p.cell;
    let cx = Math.floor(x / c), cy = Math.floor(y / c);
    if (cx < 0) cx = 0; else if (cx >= this.gw) cx = this.gw - 1;
    if (cy < 0) cy = 0; else if (cy >= this.gh) cy = this.gh - 1;
    return cy * this.gw + cx;
  }

  // ---- seeding -------------------------------------------------------------------------------------------

  private allocBead(): number {
    const i = this.freeBeads.length ? this.freeBeads.pop()! : this.beadHi < this.p.maxBeads ? this.beadHi++ : -1;
    if (i >= 0) { this.alive[i] = 1; this.beadCount++; this.born[i] = this.step; }
    return i;
  }
  private freeBead(i: number): void {
    this.alive[i] = 0; this.next[i] = this.prev[i] = -1; this.beadCount--; this.freedNow.push(i);
  }

  /** A round loop of `beads` beads (default: rest spacing), counter-clockwise, inside the dish inset. Returns its first bead. */
  addLoop(cx: number, cy: number, radius: number, beads = Math.max(8, Math.round((6.283185307179586 * radius) / this.p.l0)), gene = 128, mark = 128): number {
    let first = -1, last = -1;
    for (let k = 0; k < beads; k++) {
      const [s, c] = sinCos((6.283185307179586 * k) / beads);
      const i = this.allocBead();
      if (i < 0) throw new Error('bead capacity');
      const x = cx + radius * c, y = cy + radius * s, inset = 2 * this.p.rp;
      // beads live inside the dish inset: a bead seeded outside it would be snapped in by more than its step cap
      if (x < inset || x > this.p.W - inset || y < inset || y > this.p.H - inset) throw new Error('a ring must start inside the dish inset (2 rp from the edge)');
      this.bx[i] = x; this.by[i] = y; this.wgene[i] = gene; this.wmark[i] = mark;
      if (last >= 0) { this.next[last] = i; this.prev[i] = last; } else first = i;
      last = i;
    }
    this.next[last] = first; this.prev[first] = last;
    return first;
  }

  addParticle(x: number, y: number, gene = 128, founder = 0, mark = 128): void {
    if (this.n >= this.p.maxParts) return;
    const k = this.n++;
    this.px[k] = x; this.py[k] = y; this.gene[k] = gene; this.mark[k] = mark; this.founder[k] = founder;
  }

  /** `count` particles uniformly inside a disc. */
  addSolute(cx: number, cy: number, radius: number, count: number, gene = 128, founder = 0): void {
    for (let k = 0; k < count;) {
      const dx = (this.rand() * 2 - 1) * radius, dy = (this.rand() * 2 - 1) * radius;
      if (dx * dx + dy * dy > radius * radius) continue;
      this.addParticle(cx + dx, cy + dy, gene, founder); k++;
    }
  }

  /** Scatter `total` units of a field uniformly over the dish. */
  scatter(field: Int32Array, total: number): void {
    for (let k = 0; k < total; k++) field[Math.floor(this.rand() * field.length)]++;
  }

  // ---- one step ------------------------------------------------------------------------------------------

  tick(): void {
    if (this.freedNow.length) { for (const i of this.freedNow) this.freeBeads.push(i); this.freedNow.length = 0; }
    this.buildHash();
    this.wallContact();
    this.wallForces();
    this.moveParticles();
    if (this.p.thread && this.nt > 0) this.moveThreads();
    this.moveBeads();
    if (this.p.sBurst > 0) this.rupture();
    this.exchange();
    const p = this.p;
    if (p.kRep > 0 || p.kDecay > 0 || p.kLip > 0) this.chemistry();
    if (p.thread) this.threadChemistry();
    if (p.kLight > 0) { if (p.lightPatches > 0) this.convertLit(); else this.convert(this.waste, this.food, p.kLight); }
    if (p.kLipDecay > 0) this.convert(this.lipid, this.waste, p.kLipDecay);
    if (p.dLipid > 0) this.diffuse(this.lipid, p.dLipid);
    if (p.dFood > 0) this.diffuse(this.food, p.dFood);
    if (p.dWaste > 0) this.diffuse(this.waste, p.dWaste);
    this.step++;
  }

  private buildHash(): void {
    const { cell } = this.p, gw = this.gw, gh = this.gh, hs = this.hStart, pad = Math.max(this.p.rp, this.p.rw);
    hs.fill(0);
    this.hashStale = false; this.shortcuts.length = 0;
    const { bx, by, next, alive } = this;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < this.beadHi; i++) {
        if (!alive[i]) continue;
        const j = next[i];
        let x0 = bx[i], x1 = bx[j], y0 = by[i], y1 = by[j];
        if (x0 > x1) { const t = x0; x0 = x1; x1 = t; }
        if (y0 > y1) { const t = y0; y0 = y1; y1 = t; }
        let cx0 = Math.floor((x0 - pad) / cell), cx1 = Math.floor((x1 + pad) / cell), cy0 = Math.floor((y0 - pad) / cell), cy1 = Math.floor((y1 + pad) / cell);
        if (cx0 < 0) cx0 = 0; if (cy0 < 0) cy0 = 0; if (cx1 >= gw) cx1 = gw - 1; if (cy1 >= gh) cy1 = gh - 1;
        for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
          const c = cy * gw + cx;
          if (pass === 0) hs[c + 1]++; else this.hItems[hs[c]++] = i;
        }
      }
      if (pass === 0) {
        for (let c = 0; c < gw * gh; c++) hs[c + 1] += hs[c];
        if (hs[gw * gh] > this.hItems.length) this.hItems = new Int32Array(hs[gw * gh] * 2);
      }
    }
    // after the fill pass hs[c] is the end of cell c, which is the start of cell c + 1: shift back
    for (let c = gw * gh; c > 0; c--) hs[c] = hs[c - 1];
    hs[0] = 0;
  }

  /** Bead against bond: push apart, or reconnect when a neck closes with interiors facing. */
  private wallContact(): void {
    const { bx, by, next, prev, alive, fx, fy, hStart, p } = this;
    let items = this.hItems;
    const gap = this.gap;
    fx.fill(0, 0, this.beadHi); fy.fill(0, 0, this.beadHi); gap.fill(p.rw, 0, this.beadHi);
    for (let c = 0; c < this.beadHi; c++) {
      let pinched = false;
      if (!alive[c]) continue;
      const cx = bx[c], cy = by[c], cellI = this.cellOf(cx, cy);
      for (let h = hStart[cellI]; h < hStart[cellI + 1]; h++) {
        const a = items[h];
        if (!alive[a]) continue;
        const pc = prev[c], nc = next[c];
        if (a === c) continue;
        const b = next[a];
        if (b === c) continue;
        const ex = bx[b] - bx[a], ey = by[b] - by[a], rx = cx - bx[a], ry = cy - by[a];
        const e2 = ex * ex + ey * ey;
        if (e2 === 0) continue;
        let t = (rx * ex + ry * ey) / e2;
        if (t < 0) t = 0; else if (t > 1) t = 1;
        const qx = bx[a] + t * ex, qy = by[a] + t * ey, dx = cx - qx, dy = cy - qy, d2 = dx * dx + dy * dy;
        if (d2 >= p.rw * p.rw || d2 === 0) continue;
        const d = Math.sqrt(d2);
        if (ex * ry - ey * rx > 0) {
          // c is on the interior side of a -> b. A real neck also has c's own interior facing the bond.
          const tx = bx[nc] - bx[pc], ty = by[nc] - by[pc], tl = Math.sqrt(tx * tx + ty * ty);
          if (tl > 0 && (-ty * -dx + tx * -dy) > p.facing * tl * d && this.tryPinch(c, a)) {
            pinched = true;
            break;
          }
        }
        if (d < gap[c]) gap[c] = d;
        if (d < gap[a]) gap[a] = d;
        if (d < gap[b]) gap[b] = d;
        const f = (p.kw * (p.rw / d - 1)) / d;
        fx[c] += f * dx; fy[c] += f * dy;
        fx[a] -= f * dx * (1 - t); fy[a] -= f * dy * (1 - t);
        fx[b] -= f * dx * t; fy[b] -= f * dy * t;
      }
      if (pinched) {
        // The two new bonds are not where the hash lists them, and beads that now sit next to a new bond
        // (often a fraction of rw away) have been given no push from it. Nothing has moved yet, so rebuild
        // the hash and start the whole pass again on the new rings. Each restart follows a pinch and each
        // pinch adds a ring, so this ends.
        this.buildHash(); items = this.hItems;
        fx.fill(0, 0, this.beadHi); fy.fill(0, 0, this.beadHi); gap.fill(p.rw, 0, this.beadHi);
        c = -1;
      }
    }
  }

  /** Reconnect ... p -> c ... a -> b ... into two loops, only if both daughters are real. */
  private tryPinch(c: number, a: number): boolean {
    const { bx, by, next, prev, p } = this, b = next[a], pc = prev[c];
    let n1 = 1, i = c, area1 = 0;
    while (i !== a) {
      const j = next[i];
      area1 += bx[i] * by[j] - bx[j] * by[i];
      i = j; n1++;
      if (i === c) return false;
    }
    area1 += bx[a] * by[c] - bx[c] * by[a];
    let n2 = 1, area2 = 0;
    i = b;
    while (i !== pc) {
      const j = next[i];
      area2 += bx[i] * by[j] - bx[j] * by[i];
      i = j; n2++;
      if (i === b) return false;
    }
    area2 += bx[pc] * by[b] - bx[b] * by[pc];
    if (n1 < p.minBeads || n2 < p.minBeads || area1 < 2 * p.minArea || area2 < 2 * p.minArea) return false;
    if (this.wouldCross(a, c) || this.wouldCross(pc, b)) return false;
    // the two new bonds must not cross each other either (neither exists yet, so the checks above cannot see that)
    const acx = bx[c] - bx[a], acy = by[c] - by[a], pbx = bx[b] - bx[pc], pby = by[b] - by[pc];
    const s1 = acx * (by[pc] - by[a]) - acy * (bx[pc] - bx[a]), s2 = acx * (by[b] - by[a]) - acy * (bx[b] - bx[a]);
    const s3 = pbx * (by[a] - by[pc]) - pby * (bx[a] - bx[pc]), s4 = pbx * (by[c] - by[pc]) - pby * (bx[c] - bx[pc]);
    if (((s1 <= 0 && s2 >= 0) || (s1 >= 0 && s2 <= 0)) && ((s3 <= 0 && s4 >= 0) || (s3 >= 0 && s4 <= 0))) return false;
    this.hooks.pinch?.(0, c, a, pc, b);
    next[a] = c; prev[c] = a; next[pc] = b; prev[b] = pc;
    this.hooks.pinch?.(1, c, a, pc, b);
    this.events.pinch++;
    this.pinchLog.push({ step: this.step, a: n1, b: n2 });
    return true;
  }

  /** Would a new bond u -> v touch or cross any bond that shares no bead with it? `lazy`: see `segHit`. */
  private wouldCross(u: number, v: number, lazy = false): boolean {
    return this.segHit(this.bx[u], this.by[u], this.bx[v], this.by[v], u, v, lazy);
  }

  /** Does the segment from (x0, y0) to (x1, y1) reach a wall bond: its start strictly on one side, its end on
   *  the bond's line or past it, within the bond's span (ends included)? Bonds with an end at bead u or v are
   *  left out. Looks in every hash cell the segment's box touches; a bond that meets the segment does so
   *  inside that box, and the hash lists each bond in every cell its own box touches (with padding that
   *  covers this step's bead moves). The hash can be older than the rings: it is rebuilt first if a bead has
   *  left a ring since, and beads born since are reached by walking on from the bond they split (a split
   *  stays inside its parent bond's box). A start exactly on a bond counts as reaching it unless the end is
   *  strictly on that bond's interior side.
   *  `lazy` (the desorption check only): a stale hash is not rebuilt; the shortcut bonds made since it was built are
   *  searched as well, which lists every bond again. The answer is a yes or no about the bonds as they are, so it is
   *  the same either way; only `nearBond`, which picks the first of equally near bonds, reads the hash's order.
   *  One known difference (Sol review, 2026-11-20): a shortcut of zero length (two beads at the same point) is found from
   *  anywhere in the lazy search but only from its own cells in a fresh hash, so in that degenerate case a far-off
   *  desorption can be refused that a rebuild would have allowed. It errs toward refusing; no crossing is missed. */
  private segHit(x0: number, y0: number, x1: number, y1: number, u: number, v: number, lazy = false): boolean {
    const stale = this.hashStale && lazy;
    if (this.hashStale && !lazy) this.buildHash();
    const { gw, gh, hStart } = this, items = this.hItems, cell = this.p.cell;
    let cx0 = Math.floor((x0 < x1 ? x0 : x1) / cell), cx1 = Math.floor((x0 < x1 ? x1 : x0) / cell);
    let cy0 = Math.floor((y0 < y1 ? y0 : y1) / cell), cy1 = Math.floor((y0 < y1 ? y1 : y0) / cell);
    if (cx0 < 0) cx0 = 0; if (cy0 < 0) cy0 = 0; if (cx1 >= gw) cx1 = gw - 1; if (cy1 >= gh) cy1 = gh - 1;
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const c = cy * gw + cx;
      for (let h = hStart[c]; h < hStart[c + 1]; h++) if (this.chainHit(items[h], x0, y0, x1, y1, u, v)) return true;
    }
    if (stale) for (const a of this.shortcuts) if (this.chainHit(a, x0, y0, x1, y1, u, v)) return true;
    return false;
  }

  /** `segHit` for the bond that starts at bead a and for the bonds of beads born since into it. */
  private chainHit(a: number, x0: number, y0: number, x1: number, y1: number, u: number, v: number): boolean {
    const { bx, by, next, alive, born, step } = this, dx = x1 - x0, dy = y1 - y0;
    if (!alive[a]) return false;
    const first = a;
    for (;;) {
      const b = next[a];
      if (a !== u && a !== v && b !== u && b !== v) {
        const ex = bx[b] - bx[a], ey = by[b] - by[a];
        const s0 = ex * (y0 - by[a]) - ey * (x0 - bx[a]), s1 = ex * (y1 - by[a]) - ey * (x1 - bx[a]);
        if ((s0 > 0 && s1 <= 0) || (s0 < 0 && s1 >= 0)) {
          const o3 = dx * (by[a] - y0) - dy * (bx[a] - x0), o4 = dx * (by[b] - y0) - dy * (bx[b] - x0);
          if ((o3 <= 0 && o4 >= 0) || (o3 >= 0 && o4 <= 0)) return true;
        } else if (s0 === 0 && s1 <= 0) {
          const along = (x0 - bx[a]) * ex + (y0 - by[a]) * ey;
          if (along >= 0 && along <= ex * ex + ey * ey) return true;
        }
      }
      if (born[b] !== step || b === first) return false;
      a = b;
    }
  }

  private wallForces(): void {
    const { bx, by, next, prev, alive, fx, fy, blen, p } = this;
    for (let i = 0; i < this.beadHi; i++) {
      if (!alive[i]) continue;
      const j = next[i], dx = bx[j] - bx[i], dy = by[j] - by[i], len = Math.sqrt(dx * dx + dy * dy);
      blen[i] = len;
      if (len > 0) {
        const f = (p.ks * (len - p.l0)) / len;
        fx[i] += f * dx; fy[i] += f * dy; fx[j] -= f * dx; fy[j] -= f * dy;
      }
      // ambient pressure pushes the bond toward its interior (the left of i -> j)
      const hx = -0.5 * p.pOut * dy, hy = 0.5 * p.pOut * dx;
      fx[i] += hx; fy[i] += hy; fx[j] += hx; fy[j] += hy;
      const q = prev[i], qq = prev[q], jj = next[j];
      fx[i] -= p.kb * (bx[qq] - 4 * bx[q] + 6 * bx[i] - 4 * bx[j] + bx[jj]);
      fy[i] -= p.kb * (by[qq] - 4 * by[q] + 6 * by[i] - 4 * by[j] + by[jj]);
    }
  }

  private moveParticles(): void {
    for (let k = 0; k < this.n; k++) this.pushMove(this.px, this.py, k);
  }

  /** Threads move exactly like solute: pushed off walls (and pushing them back), random step, never through a wall. */
  private moveThreads(): void {
    for (let k = 0; k < this.nt; k++) this.pushMove(this.tx, this.ty, k);
  }

  /** One particle-like body: pushed away from every wall bond within rp (the bond's beads take the opposite push),
   *  then a random step that is not made if it would end on or cross a wall. */
  private pushMove(px: Float64Array, py: Float64Array, k: number): void {
    const { bx, by, next, alive, fx, fy, hStart, p } = this, items = this.hItems;
    const lo = p.rp, hiX = p.W - p.rp, hiY = p.H - p.rp, r2 = p.rp * p.rp, pc = 0.5 * p.rp;
    {
      const x = px[k], y = py[k], cellI = this.cellOf(x, y);
      let gx = 0, gy = 0, nearest = Infinity;
      for (let h = hStart[cellI]; h < hStart[cellI + 1]; h++) {
        const a = items[h];
        if (!alive[a]) continue;
        const b = next[a], ex = bx[b] - bx[a], ey = by[b] - by[a], rx = x - bx[a], ry = y - by[a];
        const e2 = ex * ex + ey * ey;
        if (e2 === 0) continue;
        let t = (rx * ex + ry * ey) / e2;
        if (t < 0) t = 0; else if (t > 1) t = 1;
        let dx = rx - t * ex, dy = ry - t * ey;
        const d2 = dx * dx + dy * dy;
        if (d2 < nearest) nearest = d2;
        if (d2 >= r2) continue;
        let f: number;
        if (d2 === 0) {
          // exactly on the bond there is no direction to push along: push toward the bond's interior at the cap
          const el = Math.sqrt(e2);
          dx = -ey / el; dy = ex / el; f = pc;
        } else { const d = Math.sqrt(d2); f = (p.kp * (p.rp / d - 1)) / d; }
        gx += f * dx; gy += f * dy;
        fx[a] -= f * dx * (1 - t); fy[a] -= f * dy * (1 - t);
        fx[b] -= f * dx * t; fy[b] -= f * dy * t;
      }
      if (gx > pc) gx = pc; else if (gx < -pc) gx = -pc;
      if (gy > pc) gy = pc; else if (gy < -pc) gy = -pc;
      let nx = x + gx + (this.rand() * 2 - 1) * p.partNoise, ny = y + gy + (this.rand() * 2 - 1) * p.partNoise;
      if (nx < lo) nx = lo; else if (nx > hiX) nx = hiX;
      if (ny < lo) ny = lo; else if (ny > hiY) ny = hiY;
      // a particle does not step onto or through a wall: such a move is not made (the wall still feels the push)
      // (only a bond no farther away than the move is long can be reached, and all of those are in this cell's list)
      if ((nx - x) * (nx - x) + (ny - y) * (ny - y) >= nearest && this.segHit(x, y, nx, ny, -1, -1)) return;
      px[k] = nx; py[k] = ny;
    }
  }

  private moveBeads(): void {
    const { bx, by, alive, fx, fy, gap, p } = this, lo = 2 * p.rp, hiX = p.W - lo, hiY = p.H - lo;
    for (let i = 0; i < this.beadHi; i++) {
      if (!alive[i]) continue;
      // A bead in contact moves at most a quarter of its smallest gap (0.17 per axis is under 1/(4 sqrt 2)).
      // The bead and the bond it faces then close less than half the gap between them, however hard the
      // crowd pushes, so walls in contact cannot pass through each other in one step. Walls not in contact
      // are more than rw apart and no step is that long.
      const near = 0.17 * gap[i], cap = near < p.beadCap ? near : p.beadCap;
      let dx = fx[i] + (this.rand() * 2 - 1) * p.beadNoise, dy = fy[i] + (this.rand() * 2 - 1) * p.beadNoise;
      if (dx > cap) dx = cap; else if (dx < -cap) dx = -cap;
      if (dy > cap) dy = cap; else if (dy < -cap) dy = -cap;
      let x = bx[i] + dx, y = by[i] + dy;
      if (x < lo) x = lo; else if (x > hiX) x = hiX;
      if (y < lo) y = lo; else if (y > hiY) y = hiY;
      bx[i] = x; by[i] = y;
    }
  }

  /** Osmotic lysis: a run of eight bonds all pulled too far gives way and the whole ring goes back to free lipid,
   *  leaving its contents loose. Each bead is tested one step in eight. */
  private rupture(): void {
    const { bx, by, next, alive, blen, lipid, p } = this, limit = p.l0 * (1 + p.sBurst);
    for (let i = this.step & 7; i < this.beadHi; i += 8) {
      if (!alive[i]) continue;
      let m = i, k = 0;
      for (; k < 8 && blen[m] > limit; k++) m = next[m];
      if (k < 8) continue;
      this.hooks.end?.('burst', i);
      for (m = i; ;) { const nx = next[m]; lipid[this.cellOf(bx[m], by[m])]++; this.freeBead(m); if (nx === i) break; m = nx; }
      this.events.burst++;
    }
  }

  /** Lipid joins a bond in proportion to free lipid, more readily when stretched; beads leave at a base rate
   *  that falls with stretch. A loop too small to hold a shape dissolves into free lipid. */
  private exchange(): void {
    const { bx, by, next, prev, alive, blen, lipid, born, p } = this;
    if (p.kIn <= 0 && p.kOut <= 0) return;
    const hi = this.beadHi;
    for (let i = 0; i < hi; i++) {
      if (!alive[i] || born[i] === this.step) continue;
      const j = next[i], q = prev[i];
      // leave
      let h = 1 - ((blen[q] + blen[i]) / (2 * p.l0) - 1) / p.sOut;
      if (h < 0) h = 0; else if (h > p.rateMax) h = p.rateMax;
      if (h > 0 && this.rand() < p.kOut * h) {
        let m = j, size = 1;
        while (m !== i && size <= 6) { m = next[m]; size++; }
        if (size <= 6) {
          this.hooks.end?.('dissolve', i);
          for (m = i; ;) { const nx = next[m]; lipid[this.cellOf(bx[m], by[m])]++; this.freeBead(m); if (nx === i) break; m = nx; }
          this.events.dissolve++;
        } else {
          // checked without rebuilding a stale hash (one rebuild per desorption made the step grow with the square of
          // the dish); a refusal rebuilds it here, where the check always used to, since `nearBond` may read it next
          if (this.wouldCross(q, j, true)) { if (this.hashStale) this.buildHash(); continue; }
          next[q] = j; prev[j] = q; blen[q] += blen[i];
          this.hashStale = true; this.shortcuts.push(q);
          lipid[this.cellOf(bx[i], by[i])]++; this.freeBead(i); this.events.desorb++;
        }
        continue;
      }
      // join
      const mx = 0.5 * (bx[i] + bx[j]), my = 0.5 * (by[i] + by[j]), c = this.cellOf(mx, my);
      if (lipid[c] <= 0) continue;
      let g = 1 + (blen[i] / p.l0 - 1) / p.sIn;
      if (g < 0) g = 0; else if (g > p.rateMax) g = p.rateMax;
      if (g > 0 && this.rand() < p.kIn * lipid[c] * g) {
        const m = this.allocBead();
        if (m < 0) continue;
        bx[m] = mx; by[m] = my; next[i] = m; prev[m] = i; next[m] = j; prev[j] = m;
        blen[i] = blen[m] = 0.5 * blen[i];
        this.inherit(m, i, j);
        lipid[c]--; this.events.insert++;
      }
    }
  }

  /** Solute copies itself from food only in company, makes lipid from food, and decays to waste. */
  private chemistry(): void {
    const { px, py, gene, mark, founder, food, waste, lipid, sCount, p } = this;
    sCount.fill(0);
    for (let k = 0; k < this.n; k++) sCount[this.cellOf(px[k], py[k])]++;
    for (let k = this.n - 1; k >= 0; k--) {
      const c = this.cellOf(px[k], py[k]);
      if (p.kDecay > 0 && this.rand() < p.kDecay) {
        waste[c]++; sCount[c]--; this.events.decay++;
        const l = --this.n;
        px[k] = px[l]; py[k] = py[l]; gene[k] = gene[l]; mark[k] = mark[l]; founder[k] = founder[l];
        continue;
      }
      const f = food[c];
      if (f <= 0) continue;
      const ff = (f < p.foodCap ? f : p.foodCap) / p.foodCap, g = p.neutral ? 128 : gene[k];
      const crowd = sCount[c] - 1;
      if (p.kRep > 0 && crowd > 0 && this.n < p.maxParts) {
        const cf = (crowd < p.crowdCap ? crowd : p.crowdCap) / p.crowdCap;
        if (this.rand() < p.kRep * ff * cf * (1 + (p.tradeoff * (128 - g)) / 127)) {
          // with wall genes, a copy is only made against the inner face of a wall, and takes that wall's bytes
          // (with the gate-only control, the same place is required but the bytes are the parent's)
          // with threads, a copy needs a thread near it (no wall between) and takes that thread's bytes
          const from = p.thread ? this.nearThread(px[k], py[k]) : p.wallGenes ? this.innerBead(px[k], py[k], c) : p.wallGate ? (this.innerBead(px[k], py[k], c) >= 0 ? -2 : -1) : -2;
          if (from !== -1) {
            food[c]--; sCount[c]++; this.events.birth++;
            const l = this.n++;
            px[l] = px[k]; py[l] = py[k]; founder[l] = founder[k];
            if (from >= 0 && p.thread) { gene[l] = this.tgene[from * p.tG]; mark[l] = this.tgene[from * p.tG + 1]; }
            else if (from >= 0) { gene[l] = this.wgene[from]; mark[l] = this.wmark[from]; }
            else { gene[l] = this.copyByte(gene[k]); mark[l] = this.copyByte(mark[k]); }
            if (food[c] <= 0) continue;
          }
        }
      }
      if (p.kLip > 0 && this.rand() < p.kLip * ff * (g / 128)) {
        food[c]--; this.events.lipidMade++;
        if (!this.insertNear(px[k], py[k], c)) lipid[c]++;
      }
    }
  }

  // ---- threads (stage 1) ---------------------------------------------------------------------------------

  /** The thread nearest to (x, y) within `rShare` with no wall between, or -1. */
  private nearThread(x: number, y: number): number {
    const { tx, ty, p } = this;
    let best = -1, bd = p.rShare * p.rShare;
    for (let k = 0; k < this.nt; k++) {
      const dx = tx[k] - x, dy = ty[k] - y, d2 = dx * dx + dy * dy;
      if (d2 < bd && !this.segHit(x, y, tx[k], ty[k], -1, -1)) { bd = d2; best = k; }
    }
    return best;
  }

  /** Is another thread within `rInhib` of thread k on its side of the walls? */
  private inhibited(k: number): boolean {
    const { tx, ty, p } = this, r2 = p.rInhib * p.rInhib;
    for (let m = 0; m < this.nt; m++) {
      if (m === k) continue;
      const dx = tx[m] - tx[k], dy = ty[m] - ty[k];
      if (dx * dx + dy * dy < r2 && !this.segHit(tx[k], ty[k], tx[m], ty[m], -1, -1)) return true;
    }
    return false;
  }

  /** Does thread k have `kSup` solute within `rSup` on its side of the walls? */
  private supported(k: number): boolean {
    const { px, py, p } = this, r2 = p.rSup * p.rSup, x = this.tx[k], y = this.ty[k];
    let seen = 0;
    for (let q = 0; q < this.n; q++) {
      const dx = px[q] - x, dy = py[q] - y;
      if (dx * dx + dy * dy < r2 && !this.segHit(x, y, px[q], py[q], -1, -1) && ++seen >= p.kSup) return true;
    }
    return false;
  }

  /** A thread takes up food where it sits; with `tCost` stored and no other thread near, it splits (the copy is one
   *  unit of body, the rest of the cost goes back to the water as waste); unsupported threads decay to waste. */
  private threadChemistry(): void {
    const { tx, ty, tgene, tstore, food, waste, p } = this, G = p.tG;
    for (let k = this.nt - 1; k >= 0; k--) {
      const c = this.cellOf(tx[k], ty[k]);
      if (p.kTDecay > 0 && this.rand() < p.kTDecay && !this.supported(k)) {
        waste[c]++; food[c] += tstore[k]; this.events.tdecay++;
        const l = --this.nt;
        tx[k] = tx[l]; ty[k] = ty[l]; tstore[k] = tstore[l];
        for (let g = 0; g < G; g++) tgene[k * G + g] = tgene[l * G + g];
        continue;
      }
      if (tstore[k] < p.tCost) {
        const f = food[c];
        if (f > 0 && this.rand() < (p.kTFood * (f < p.foodCap ? f : p.foodCap)) / p.foodCap) { food[c]--; tstore[k]++; }
        continue;
      }
      if (this.nt >= p.maxThreads || this.inhibited(k)) continue;
      tstore[k] -= p.tCost; waste[c] += p.tCost - 1; this.events.tcopy++;
      const l = this.nt++;
      for (let g = 0; g < G; g++) tgene[l * G + g] = this.copyByte(tgene[k * G + g]);
      tstore[l] = 0; tx[l] = tx[k]; ty[l] = ty[k];
    }
  }

  /** Seed a thread (stage 1) with the given genes. */
  addThread(x: number, y: number, genes: number[]): void {
    if (!this.p.thread) throw new Error('threads are off');
    if (this.nt >= this.p.maxThreads) return;
    const k = this.nt++, G = this.p.tG;
    this.tx[k] = x; this.ty[k] = y; this.tstore[k] = 0;
    for (let g = 0; g < G; g++) this.tgene[k * G + g] = genes[g] ?? 128;
  }

  /** The wall bond nearest to (x, y) within `rIns` (its first bead), or -1. Searches the 3 by 3 block of hash
   *  cells around cell c (rIns does not exceed the cell edge). Like `segHit`, it rebuilds a hash that a
   *  departed bead has made stale and walks through beads born since. */
  private nearBond(x: number, y: number, c: number): number {
    if (this.hashStale) this.buildHash();
    const { bx, by, next, alive, born, hStart, p, gw, gh, step } = this, items = this.hItems;
    let best = -1, bd = p.rIns * p.rIns;
    const cx = c % gw, cy = (c - cx) / gw;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const qx = cx + ox, qy = cy + oy;
      if (qx < 0 || qy < 0 || qx >= gw || qy >= gh) continue;
      const q = qy * gw + qx;
      for (let h = hStart[q]; h < hStart[q + 1]; h++) {
        let a = items[h];
        if (!alive[a]) continue;
        const first = a;
        for (;;) {
          const b = next[a], ex = bx[b] - bx[a], ey = by[b] - by[a], rx = x - bx[a], ry = y - by[a], e2 = ex * ex + ey * ey;
          if (e2 > 0) {
            let t = (rx * ex + ry * ey) / e2;
            if (t < 0) t = 0; else if (t > 1) t = 1;
            const dx = rx - t * ex, dy = ry - t * ey, d2 = dx * dx + dy * dy;
            if (d2 < bd) { bd = d2; best = a; }
          }
          if (born[b] !== step || b === first) break;
          a = b;
        }
      }
    }
    return best;
  }

  /** The bead nearest to (x, y) on the nearest wall bond within `rIns`, if (x, y) is on the wall's interior
   *  side there; -1 if there is no such bond or the point is outside. Where the nearest point of the wall is
   *  a bead (a corner), the side is judged against both of that bead's bonds: inside a corner that bulges
   *  outward means left of both, inside one that folds inward means left of either. */
  private innerBead(x: number, y: number, c: number): number {
    const a = this.nearBond(x, y, c);
    if (a < 0) return -1;
    const { bx, by, next, prev } = this, b = next[a], ex = bx[b] - bx[a], ey = by[b] - by[a], rx = x - bx[a], ry = y - by[a];
    const along = rx * ex + ry * ey, e2 = ex * ex + ey * ey;
    if (along > 0 && along < e2) return ex * ry - ey * rx > 0 ? (2 * along < e2 ? a : b) : -1;
    const v = along <= 0 ? a : b, q = prev[v], n = next[v];
    const ax = bx[v] - bx[q], ay = by[v] - by[q], cx = bx[n] - bx[v], cy = by[n] - by[v];
    const s1 = ax * (y - by[q]) - ay * (x - bx[q]), s2 = cx * (y - by[v]) - cy * (x - bx[v]);
    const inside = ax * cy - ay * cx >= 0 ? s1 > 0 && s2 > 0 : s1 > 0 || s2 > 0;
    return inside ? v : -1;
  }

  /** Put one new bead into the nearest wall bond within `rIns` of (x, y). False if there is none. */
  private insertNear(x: number, y: number, c: number): boolean {
    const { bx, by, next, prev, blen } = this;
    if (this.p.rIns <= 0) return false;
    const best = this.nearBond(x, y, c);
    if (best < 0) return false;
    const m = this.allocBead();
    if (m < 0) return false;
    const j = next[best];
    bx[m] = 0.5 * (bx[best] + bx[j]); by[m] = 0.5 * (by[best] + by[j]);
    next[best] = m; prev[m] = best; next[m] = j; prev[j] = m;
    blen[best] = blen[m] = 0.5 * blen[best];
    this.inherit(m, best, j);
    this.events.insert++;
    return true;
  }

  /** A new bead m in the bond i -> j takes its bytes from one of the two ends, picked evenly, each byte
   *  shifted like any copy. With `wallGenes` off it takes i's bytes and no random number is drawn. */
  private inherit(m: number, i: number, j: number): void {
    const src = this.p.wallGenes && this.rand() < 0.5 ? j : i;
    if (this.p.wallGenes) { this.wgene[m] = this.copyByte(this.wgene[src]); this.wmark[m] = this.copyByte(this.wmark[src]); }
    else { this.wgene[m] = this.wgene[src]; this.wmark[m] = this.wmark[src]; }
  }

  private copyByte(v: number): number {
    const p = this.p;
    if (p.mut <= 0 || this.rand() >= p.mut) return v;
    const d = 1 + Math.floor(this.rand() * p.mutStep), w = this.rand() < 0.5 ? v - d : v + d;
    return w < 0 ? 0 : w > 255 ? 255 : w;
  }

  /** Centre of light patch `k` at the current step: start spread by the golden angle, straight drift, wrapped round the dish. */
  patchCentre(k: number, step = this.step): [number, number] {
    const { W, H, patchSpeed } = this.p, [sn, cs] = sinCos(2.399963229728653 * k + 0.7);
    const x = W * (((0.5 + 0.6180339887498949 * k) % 1)) + cs * patchSpeed * step, y = H * (((0.5 + 0.7548776662466927 * k) % 1)) + sn * patchSpeed * step;
    return [x - W * Math.floor(x / W), y - H * Math.floor(y / H)];
  }

  /** Fill `litMask` for the current step and return how many grid cells are lit. The same per-cell test as `lit`,
   *  made per patch only on the columns and rows that pass its one-axis part (a cell inside a patch passes both),
   *  so the cost is the lit area rather than cells times patches. */
  lightMask(): number {
    const { p, gw, gh, litMask } = this, { W, H, patchR } = p, r2 = patchR * patchR;
    const colD = this.colD ??= new Float64Array(gw), rowD = this.rowD ??= new Float64Array(gh);
    const cols = this.cols ??= new Int32Array(gw), rows = this.rows ??= new Int32Array(gh);
    litMask.fill(0);
    let n = 0;
    for (let k = 0; k < p.lightPatches; k++) {
      const [px, py] = this.patchCentre(k);
      let nc = 0, nr = 0;
      for (let x = 0; x < gw; x++) { let dx = Math.abs((x + 0.5) * p.cell - px); if (dx > W / 2) dx = W - dx; if (dx * dx <= r2) { colD[x] = dx; cols[nc++] = x; } }
      for (let y = 0; y < gh; y++) { let dy = Math.abs((y + 0.5) * p.cell - py); if (dy > H / 2) dy = H - dy; if (dy * dy <= r2) { rowD[y] = dy; rows[nr++] = y; } }
      for (let b = 0; b < nr; b++) {
        const y = rows[b], dy = rowD[y], o = y * gw;
        for (let a = 0; a < nc; a++) { const x = cols[a], dx = colD[x]; if (!litMask[o + x] && dx * dx + dy * dy <= r2) { litMask[o + x] = 1; n++; } }
      }
    }
    return n;
  }

  /** Light that comes in patches: like `convert(waste, food, kLight)` but only in lit cells, at the rate that keeps the dish's mean. */
  private convertLit(): void {
    const { waste, food, p, gw, gh } = this, mask = this.litMask, n = this.lightMask();
    if (n === 0) return;
    const rate = Math.min(1, (p.kLight * gw * gh) / n);
    for (let c = 0; c < waste.length; c++) {
      const v = waste[c];
      if (!mask[c] || v <= 0) continue;
      const x = v * rate, m0 = Math.floor(x), m = m0 + (this.rand() < x - m0 ? 1 : 0);
      waste[c] -= m; food[c] += m;
    }
  }

  /** Move `rate` of each cell's `from` into `to`, rounding by chance so nothing is lost. */
  private convert(from: Int32Array, to: Int32Array, rate: number): void {
    for (let c = 0; c < from.length; c++) {
      const v = from[c];
      if (v <= 0) continue;
      const x = v * rate, m0 = Math.floor(x), m = m0 + (this.rand() < x - m0 ? 1 : 0);
      from[c] -= m; to[c] += m;
    }
  }

  /** Each cell sends `rate` of its count to each of its four neighbours (units aimed at the dish edge stay).
   *  The total leaving is rounded by chance and the odd units go to directions picked without a favourite. */
  private diffuse(field: Int32Array, rate: number): void {
    const { gw, gh, tmp } = this;
    tmp.set(field);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      const c = y * gw + x, v = field[c];
      if (v <= 0) continue;
      const q = 4 * rate * v, q0 = Math.floor(q);
      let total = q0 + (this.rand() < q - q0 ? 1 : 0);
      if (total > v) total = v;
      if (total === 0) continue;
      const each = total >> 2, odd = total & 3, start = odd ? Math.floor(this.rand() * 4) : 0;
      for (let dir = 0; dir < 4; dir++) {
        const m = each + (((dir - start) & 3) < odd ? 1 : 0);
        if (m === 0) continue;
        const nx = dir === 0 ? x - 1 : dir === 2 ? x + 1 : x, ny = dir === 1 ? y - 1 : dir === 3 ? y + 1 : y;
        if (nx < 0 || nx >= gw || ny < 0 || ny >= gh) continue;
        tmp[c] -= m; tmp[ny * gw + nx] += m;
      }
    }
    field.set(tmp);
  }

  /** Intervention: return the ring that holds bead `first` to free lipid (a wound). Matter is unchanged. */
  dissolveLoop(first: number): number {
    if (first < 0 || first >= this.beadHi || !this.alive[first]) return 0;
    let n = 0;
    this.hooks.end?.('wound', first);
    for (let m = first; ;) { const nx = this.next[m]; this.lipid[this.cellOf(this.bx[m], this.by[m])]++; this.freeBead(m); n++; if (nx === first) break; m = nx; }
    return n;
  }

  /** Intervention: add `units` to a field in the cell under (x, y). This adds matter. */
  feed(field: Int32Array, x: number, y: number, units: number): void { field[this.cellOf(x, y)] += units; }

  /** Everything that is matter, in units: wall beads, solute, food, waste, free lipid. */
  matter(): number {
    let s = this.beadCount + this.n + this.nt;
    for (let k = 0; k < this.nt; k++) s += this.tstore[k];
    for (let c = 0; c < this.food.length; c++) s += this.food[c] + this.waste[c] + this.lipid[c];
    return s;
  }

  /** FNV-1a over the whole state, for pins and replay checks. */
  digest(): string {
    let h = 0x811c9dc5;
    const eat = (bytes: Uint8Array) => { for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); } };
    const view = (a: { buffer: ArrayBufferLike; byteOffset: number; BYTES_PER_ELEMENT: number }, len: number) => new Uint8Array(a.buffer, a.byteOffset, len * a.BYTES_PER_ELEMENT);
    eat(new Uint8Array(new Int32Array([this.step, this.beadHi, this.beadCount, this.n]).buffer));
    for (const a of [this.bx, this.by, this.next, this.prev, this.alive]) eat(view(a, this.beadHi));
    for (const a of [this.px, this.py, this.gene, this.mark, this.founder]) eat(view(a, this.n));
    for (const a of [this.food, this.waste, this.lipid]) eat(view(a, a.length));
    if (this.p.wallGenes) for (const a of [this.wgene, this.wmark]) eat(view(a, this.beadHi));
    if (this.p.thread) {
      eat(new Uint8Array(new Int32Array([this.nt]).buffer));
      for (const a of [this.tx, this.ty, this.tgene, this.tstore]) eat(view(a, a === this.tgene ? this.nt * this.p.tG : this.nt));
      // where the retired anchored variant's column was (its bead, -1 for a free thread): kept so that the pins hold
      eat(new Uint8Array(new Int32Array(this.nt).fill(-1).buffer));
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }
}
