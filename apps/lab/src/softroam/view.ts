/**
 * Starting line-ups, the picture and the readouts for Soft Roam, shared by the local page and the headless look.
 *
 * The picture is drawn from interpolated positions: a frame shown at `alpha` sits between the state before the last step
 * (alpha 0) and the state after it (alpha 1), every cell moving the short way across the torus seam. A cell that was born
 * in the last step is never interpolated from its (meaningless) previous position: it grows in over about ten steps from
 * the side of its mother (and keeps coming out of the place where she was if she dies meanwhile). A cell that died leaves
 * a ghost: a pale light that fades to nothing, with a small blue puff when its matter composted; the light is added to the
 * ground like the glow, never merged as a body, so it cannot leave a hole, a ring or a seam in anything. Ghosts are kept by
 * position in the paint memory, never by slot.
 *
 * Kinds are drawn with eased "levels" the paint memory keeps per cell (by serial number, never by slot) and moves a little
 * toward its target each step, so nothing pops: a shell's pale thick bone rim darkens and gains fracture lines as its hits
 * approach the crack count, and flashes when hit; a mouth glows warm red and pulses for some steps after it feeds, the prey
 * cell it feeds on dims, and a thin red thread joins them; a crack leaves a short broken ring. The painter reads the world
 * and never writes to it.
 */

import { ROAM_PLANS, ROAM_STARTS, ROAM_TYPES, roamFamily, roamPlanColour, type RoamTypeId } from '../roam/view.ts';
import { defaultSoftRoamConfig, KIND_MOUTH, KIND_SHELL, PLAN_REST, roamHash, SOFT_U, type SoftRoamCensus, type SoftRoamConfig, SoftRoamWorld } from './kernel.ts';

export { ROAM_PLANS };

const U = SOFT_U;

// ---------------------------------------------------------------------------------------------------- starts

/** The grown starts (bodies by plan) Soft Roam offers; each is a list of founder types taking turns. */
export const SOFT_STARTS = {
  /** The default: the grown founders as in 'grown-all', with kinds, touch feeding, shells and cracking on (Roam's page line-up). */
  garden: ROAM_STARTS['grown-all'],
  'grown-all': ROAM_STARTS['grown-all'],
  'grown-lines': ROAM_STARTS['grown-lines'],
  'grown-plates': ROAM_STARTS['grown-plates'],
  'grown-crosses': ROAM_STARTS['grown-crosses'],
  'grown-blocks': ROAM_STARTS['grown-blocks'],
  'grown-specks': ROAM_STARTS['grown-specks'],
  'grown-bushes': ROAM_STARTS['grown-bushes'],
} as const satisfies Record<string, readonly RoamTypeId[]>;
export type SoftRoamStart = keyof typeof SOFT_STARTS;

export interface SoftRoamOptions {
  seed: number;
  size?: number;
  start?: SoftRoamStart;
  /** Founder bodies in all, dealt in turn to the types of the start. */
  founders?: number;
  /** Chance per gene that a daughter's copy differs. */
  mut?: number;
  /** Chance that a released daughter's plan differs in one place (when absent: 2.5 times `mut` if `mut` is given, else the page's own 0.01). */
  planMut?: number;
  /** Milestone 2 switches, as in Roam: they are read and carried now, their rules come later. */
  drain?: number;
  kinds?: boolean;
  crack?: number;
  toughness?: boolean;
  shellBite?: number;
  shellLeak?: number;
  /** Steps a new body is sealed from touch feeding (needs drain), and how hard a mouth holds on to prey (out of 256). */
  seal?: number;
  grip?: number;
  overrides?: Partial<SoftRoamConfig>;
}

/**
 * What the garden start turns on (an option given in `SoftRoamOptions` wins over these). The rules are Roam's; the numbers are Soft
 * Roam's own, chosen by looking, and none equals Roam's page (drain 2, seal 100, crack 2000, shellBite 0.5, shellLeak 0.25). Note
 * `shellBite 1`: a lone armoured seed eats the full bite, so here armour costs it only a tenth of the open-side upkeep and the
 * 300 hits it takes to crack it is never a cost; the dial "Lone shell eats" sets the trade back toward Roam's.
 */
export const GARDEN_DEFAULTS = { kinds: true, drain: 1, seal: 200, crack: 300, shellBite: 1, shellLeak: 0.1, grip: 96 } as const;

/**
 * The page's usual world, over the kernel's neutral defaults (which the kernel tests rely on): chosen by looking at 12000-step
 * runs on seeds 1 and 2. Weak pull toward food (`scentGain` 1 where Roam's formula uses 8, so a chase gene is worth roughly a tenth of a
 * drive gene of the same size here, about 0.9 of one by Roam's formula) so bodies cross open water, cheap moving, long lives and low upkeep so bodies hold
 * together, fat cells that divide less often, plan copy errors of 0.01 (not Roam's 2.5 times the gene rate), a faint haze of spread food,
 * and a smaller closed store of matter.
 */
export const PAGE_WORLD = { matter: 100_000, bite: 4, birthStore: 150, minStore: 30, leakSide: 0.002, leakCell: 0.001, moveCost: 0.01, life: 8000, scentGain: 1, planMut: 0.01, foodSpread: 0.05 } as const satisfies Partial<SoftRoamConfig>;

export function softRoamConfig(input: SoftRoamOptions): SoftRoamConfig {
  const garden = (input.start ?? 'garden') === 'garden';
  const o: SoftRoamOptions = garden
    ? { ...input, kinds: input.kinds ?? GARDEN_DEFAULTS.kinds, drain: input.drain ?? GARDEN_DEFAULTS.drain, seal: input.seal ?? GARDEN_DEFAULTS.seal, crack: input.crack ?? GARDEN_DEFAULTS.crack, shellBite: input.shellBite ?? GARDEN_DEFAULTS.shellBite, shellLeak: input.shellLeak ?? GARDEN_DEFAULTS.shellLeak, grip: input.grip ?? GARDEN_DEFAULTS.grip }
    : input;
  const cfg: SoftRoamConfig = { ...defaultSoftRoamConfig(), ...PAGE_WORLD };
  cfg.seed = o.seed;
  if (o.size !== undefined) {
    // Matter and the patch rhythm follow the area, so a bigger arena is the same world with more room.
    const area = (o.size * o.size) / (cfg.size * cfg.size);
    cfg.matter = Math.round(cfg.matter * area);
    cfg.startPatches = Math.max(1, Math.round(cfg.startPatches * area));
    cfg.patchEvery = Math.max(1, Math.round(cfg.patchEvery / area));
    // A patch may not outgrow half the matter or the arena (small arenas), as the kernel requires.
    cfg.patchFood = Math.max(1, Math.min(cfg.patchFood, Math.floor(cfg.matter / 2)));
    cfg.patchRadius = Math.max(0, Math.min(cfg.patchRadius, (o.size >> 1) - 1));
    cfg.size = o.size;
  }
  if (o.mut !== undefined) cfg.mut = o.mut;
  const merged: SoftRoamConfig = { ...cfg, ...o.overrides };
  if (o.drain !== undefined && o.drain > 0 && merged.drain === undefined) merged.drain = o.drain;
  if (merged.drain !== undefined && o.seal !== undefined && merged.seal === undefined) merged.seal = o.seal;
  if (o.kinds === true && merged.kinds === undefined) merged.kinds = true;
  if (merged.kinds && merged.drain !== undefined && o.crack !== undefined && o.crack > 0 && merged.crack === undefined) merged.crack = o.crack;
  if (merged.crack !== undefined && o.toughness === true && merged.toughness === undefined) merged.toughness = true;
  if (merged.kinds && o.shellBite !== undefined && merged.shellBite === undefined) merged.shellBite = o.shellBite;
  if (merged.kinds && o.shellLeak !== undefined && merged.shellLeak === undefined) merged.shellLeak = o.shellLeak;
  if (merged.kinds && merged.drain !== undefined && o.grip !== undefined && o.grip > 0 && merged.grip === undefined) merged.grip = o.grip;
  if (o.overrides?.planMut === undefined) merged.planMut = o.planMut ?? (o.mut === undefined ? cfg.planMut : Math.min(1, 2.5 * merged.mut));
  // The first patches may use at most half the matter, so the founders can always be paid for.
  if (merged.patchFood > 0) merged.startPatches = Math.min(merged.startPatches, Math.floor(merged.matter / (2 * merged.patchFood)));
  // ... and a tiny arena keeps enough in the store to pay for at least one founder (about 3 times the matter to divide).
  if (merged.patchFood > 0) merged.startPatches = Math.min(merged.startPatches, Math.floor(Math.max(0, merged.matter - 3 * merged.birthStore) / merged.patchFood));
  return merged;
}

const KIND_SHELL_BITS = KIND_SHELL << 12;
const KIND_MOUTH_BITS = KIND_MOUTH << 12;

/**
 * A world with its founders: single cells at hash-chosen, well spaced positions on the torus, the types of the start
 * taking turns. With kinds, every other founder of a type is a hunter (its first kept daughter is a mouth) or, for a type
 * that keeps none, armoured (every daughter it lets go is a shell), as in Roam; which of a round's founders are variants
 * alternates by round, and the first round already holds some of each when the start has six types.
 */
export function foundSoftRoam(o: SoftRoamOptions): SoftRoamWorld {
  const start = o.start ?? 'garden';
  if (!(start in SOFT_STARTS)) throw new Error(`Unknown start: ${start}`);
  const world = new SoftRoamWorld(softRoamConfig({ ...o, start }));
  const types: readonly RoamTypeId[] = SOFT_STARTS[start];
  const planOf = (t: RoamTypeId): readonly number[] => (ROAM_TYPES[t] as unknown as { plan: readonly number[] }).plan;
  const planIds = types.map((t) => world.addPlan(planOf(t)));
  const hunterIds = types.map((t, j) => {
    const plan = planOf(t);
    if (!world.cfg.kinds || (plan[0] & 15) >= PLAN_REST) return planIds[j];
    if ((plan[0] & 15) >= 4) return world.addPlan(plan.map((e) => ((e & 15) >= 4 && (e & 15) < PLAN_REST ? e | KIND_SHELL_BITS : e)), planIds[j]);
    return world.addPlan(plan.map((e, m) => (m === 0 ? e | KIND_MOUTH_BITS : e)), planIds[j]);
  });
  const founders = o.founders ?? Math.max(types.length, Math.round((120 * world.n) / (128 * 128)));
  if (!Number.isSafeInteger(founders) || founders < 1) throw new Error(`Invalid founders: ${founders}`);
  const cost = 2 * world.cfg.birthStore - 1;
  const maxTries = 40 * Math.min(founders, world.n);
  // Well spaced: no two founders closer than about half the spacing of an even grid; the gap shrinks as tries run out.
  let gap = 0.5 * (world.size / Math.sqrt(founders)) * U;
  const placedAt: number[] = [];
  let placed = 0;
  for (let tries = 0; placed < founders && tries < maxTries && world.reservoir >= cost; tries++) {
    if (tries > 0 && tries % (5 * founders) === 0) gap *= 0.8;
    const px = roamHash(world.cfg.seed, 0, tries, 41) % world.span;
    const py = roamHash(world.cfg.seed, 0, tries, 42) % world.span;
    let ok = true;
    for (let k = 0; k < placedAt.length && ok; k += 2) {
      const dx = world.dlt(px, placedAt[k]);
      const dy = world.dlt(py, placedAt[k + 1]);
      if (dx * dx + dy * dy < gap * gap) ok = false;
    }
    if (!ok) continue;
    const j = placed % types.length;
    const type = types[j];
    // Variants (hunters, armoured) alternate by type and round, starting with the first type: even a small arena's first
    // round holds some of each (with the garden's six types: lines and crosses hunting, specks armoured).
    const plan = (j + Math.floor(placed / types.length)) % 2 === 0 ? hunterIds[j] : planIds[j];
    if (world.found(px, py, ROAM_TYPES[type].genes, roamFamily(type), undefined, plan) >= 0) {
      placed++;
      placedAt.push(px, py);
    }
  }
  if (o.founders !== undefined && placed < founders) throw new Error(`Only ${placed} of the ${founders} founders asked for could be placed (${world.reservoir} matter left, a founder needs ${cost}; the arena or the cell limit is too small)`);
  if (placed === 0) throw new Error(`No founder could be placed: ${world.reservoir} matter left after the first patches, a founder needs ${cost}`);
  return world;
}

// ---------------------------------------------------------------------------------------------------- the picture

export type SoftPaint = 'garden' | 'plain';

/** Founder family numbers 1 to 11 in the order of Roam's types, with the colours Roam gives them. */
const FAMILY_ORDER: readonly RoamTypeId[] = ['chaser', 'wanderer', 'sitter', 'single', 'big', 'line', 'plate', 'cross', 'block', 'speck', 'bush'];
const FAM_COLOUR: readonly (readonly number[])[] = FAMILY_ORDER.map((t) => ROAM_TYPES[t].colour);

/** Light to a 0..255 channel, a little lifted (power 0.8), as a table: light 0 to 1.5 in 2,048 steps. */
const GAMMA_N = 2048, GAMMA_STEP = GAMMA_N / 1.5;
const GAMMA = Uint8ClampedArray.from({ length: GAMMA_N }, (_, k) => Math.min(255, 255 * ((k + 0.5) / GAMMA_STEP) ** 0.8));

/** Tuning of the garden look (tiles). */
const FIELD_R = 1.2; // reach of one cell's soft field
const THRESH = 0.5; // the membrane lies where a body's field (less the next strongest) crosses this
const GROW_STEPS = 10; // a newborn grows in over this many steps
const GHOST_STEPS = 14; // a death fades over this many steps
const GHOST_KEEP = 20;
const FOOD_TAU = 6.5; // steps for the food haze to ease 63% of the way to a new level
const FOOD_FULL = 120;
const GLOW_R = 1.9;

interface Ghost { x: number; y: number; kind: number; step: number; compost: boolean }
interface Ring { x: number; y: number; step: number }
/** A thread from a feeding mouth to the cell it fed on, by serial numbers (slots only to find them again quickly). */
interface Thread { mc: number; pc: number; ms: number; ps: number; lvl: number; prv: number; seen: boolean }

/** Per-cell eased levels the picture is drawn from (kept by serial number): hit flash, feeding, being fed on, shell damage, how shell-like, how mouth-like. */
const NLV = 6;
const LV_HIT = 0, LV_FEED = 1, LV_PREY = 2, LV_DMG = 3, LV_SHELL = 4, LV_MOUTH = 5;
/** Steps for a level to ease 63% of the way up, and down. */
const LV_UP = [0.8, 1.5, 1.5, 3, 3, 3];
const LV_DOWN = [4, 6, 6, 3, 3, 3];
const RING_STEPS = 14;
const RING_KEEP = 16;
const BONE = [0.95, 0.91, 0.76] as const;

const smooth = (a: number, b: number, v: number): number => {
  const t = v <= a ? 0 : v >= b ? 1 : (v - a) / (b - a);
  return t * t * (3 - 2 * t);
};

/**
 * What the painter remembers between frames, and its scratch buffers: the haze of food eased over time, the ghosts of
 * recent deaths, and the per-pixel fields. One memory belongs to one world; call `observe` after every step so no
 * death or patch is missed (the painter calls it too, which catches the last step only).
 */
export class SoftPaintMemory {
  side = 0;
  scale = 0;
  size = 0;
  cap = 0;
  /** Per pixel: strongest field, second strongest, colour (3), shell share, shell damage. Left at zero between frames. */
  field = new Float32Array(0);
  /** Per pixel: one body's field, colour (3), shell share, shell damage while it is being stamped. Left at zero between frames. */
  acc = new Float32Array(0);
  foodShown = new Float32Array(0);
  foodPrev = new Float32Array(0);
  foodTmp = new Float32Array(0);
  /** Tiles whose pixels a stamp may have touched this frame. */
  busy = new Uint8Array(0);
  foodBlur = new Float32Array(0);
  haze = new Float32Array(0);
  glow = new Float32Array(0);
  hazeRowA = new Float32Array(0);
  hazeRowB = new Float32Array(0);
  glowRowA = new Float32Array(0);
  glowRowB = new Float32Array(0);
  tileOf = new Int32Array(0);
  x0 = new Int32Array(0);
  x1 = new Int32Array(0);
  wx = new Float32Array(0);
  px = new Float32Array(0);
  py = new Float32Array(0);
  grow = new Float32Array(0);
  /** Per slot: the vector from a young kept daughter to her mother (tiles) as of the last step the mother was alive, and whose cell it is (cid). */
  anchorX = new Float32Array(0);
  anchorY = new Float32Array(0);
  anchorCid = new Uint32Array(0);
  order = new Int32Array(0);
  counts = new Int32Array(0);
  ghosts: Ghost[] = [];
  rings: Ring[] = [];
  threads: Thread[] = [];
  /** Per slot and level: where the eased level is now and where it was a step ago; the serial number it belongs to. */
  lvCur = new Float32Array(0);
  lvPrv = new Float32Array(0);
  lvCid = new Uint32Array(0);
  feedT = new Uint8Array(0);
  hitT = new Uint8Array(0);
  preyT = new Uint8Array(0);
  seenStep = -1;
  private sized = false;

  /** Note what the last step did: ease the food haze, keep the deaths as ghosts. Does nothing twice for one step. */
  observe(world: SoftRoamWorld): void {
    this.ensureWorld(world);
    if (world.step === this.seenStep) return;
    if (world.step < this.seenStep || this.seenStep < 0) {
      // A new world, or the first look: show the food as it is, no bloom.
      for (let i = 0; i < world.n; i++) this.foodShown[i] = this.foodPrev[i] = Math.min(1, world.food[i] / FOOD_FULL);
      this.ghosts.length = 0;
      this.rings.length = 0;
    } else {
      const dt = Math.min(60, world.step - this.seenStep);
      const k = 1 - Math.exp(-dt / FOOD_TAU);
      for (let i = 0; i < world.n; i++) {
        const v = this.foodShown[i];
        this.foodPrev[i] = v;
        this.foodShown[i] = v + (Math.min(1, world.food[i] / FOOD_FULL) - v) * k;
      }
    }
    // The deaths of the step just done are still in the world's events, even at a first look.
    if (world.step > 0) for (const d of world.events.deaths) this.ghosts.push({ x: d.x / U, y: d.y / U, kind: d.kind, step: world.step, compost: world.cfg.compost === true });
    this.rememberAnchors(world);
    this.observeKinds(world, this.seenStep < 0 || world.step < this.seenStep, Math.max(1, Math.min(60, world.step - this.seenStep)));
    this.seenStep = world.step;
    let keep = 0;
    for (let k = 0; k < this.ghosts.length; k++) if (world.step - this.ghosts[k].step < GHOST_KEEP) this.ghosts[keep++] = this.ghosts[k];
    this.ghosts.length = keep;
    if (this.ghosts.length > 512) this.ghosts.splice(0, this.ghosts.length - 512);
    keep = 0;
    for (let k = 0; k < this.rings.length; k++) if (world.step - this.rings[k].step < RING_KEEP) this.rings[keep++] = this.rings[k];
    this.rings.length = keep;
  }

  /**
   * Kinds: ease the per-cell levels toward what the last step did (a hit, a feeding, damage, a change of kind), find which
   * mouth fed on which cell, keep the threads between them, and note the cracks. `snap` (a first look) sets levels at once.
   */
  private observeKinds(world: SoftRoamWorld, snap: boolean, dt: number): void {
    const crack = world.cfg.crack ?? 0;
    // What the step just done did (the kernel's own events: a first step counts like any other).
    if (world.step > 0) for (const e of world.events.cracks) this.rings.push({ x: e.x / U, y: e.y / U, step: world.step });
    this.feedT.fill(0);
    this.preyT.fill(0);
    this.hitT.fill(0);
    for (const th of this.threads) th.seen = false;
    if (world.step > 0) {
      for (const h of world.events.hits) if (world.alive[h.s] && world.cid[h.s] === h.c) this.hitT[h.s] = 1;
      for (const f of world.events.feeds) {
        const m = f.ms, p = f.ps;
        // A feed that killed its prey still pulsed the mouth; the dim and the thread need the prey to be there to draw.
        if (!world.alive[m] || world.cid[m] !== f.mc) continue;
        this.feedT[m] = 1;
        if (!world.alive[p] || world.cid[p] !== f.pc) continue;
        this.preyT[p] = 1;
        let th = this.threads.find((q) => q.mc === f.mc && q.pc === f.pc);
        if (!th) { th = { mc: f.mc, pc: f.pc, ms: m, ps: p, lvl: 0, prv: 0, seen: true }; this.threads.push(th); }
        th.ms = m; th.ps = p; th.seen = true;
      }
    }
    for (const th of this.threads) {
      th.prv = th.lvl;
      const k = 1 - Math.exp(-dt / (th.seen ? LV_UP[LV_FEED] : LV_DOWN[LV_FEED]));
      th.lvl += ((th.seen ? 1 : 0) - th.lvl) * k;
      if (snap) th.prv = th.lvl = th.seen ? 1 : 0;
    }
    this.threads = this.threads.filter((th) => th.seen || th.lvl > 0.01);
    const tgt = [0, 0, 0, 0, 0, 0];
    for (let c = 0; c < world.cap; c++) {
      if (!world.alive[c]) continue;
      const o = c * NLV;
      let fresh = snap;
      if (this.lvCid[c] !== world.cid[c]) { this.lvCid[c] = world.cid[c]; fresh = true; }
      const kind = world.kind[c];
      tgt[LV_HIT] = this.hitT[c];
      tgt[LV_FEED] = this.feedT[c];
      tgt[LV_PREY] = this.preyT[c] === 1 && this.feedT[c] === 0 ? 1 : 0;
      tgt[LV_DMG] = kind === KIND_SHELL && crack > 0 ? Math.min(1, world.hits[c] / Math.min(60000, crack << world.tough[c])) : 0;
      tgt[LV_SHELL] = kind === KIND_SHELL ? 1 : 0;
      tgt[LV_MOUTH] = kind === KIND_MOUTH ? 1 : 0;
      for (let j = 0; j < NLV; j++) {
        const cur = fresh ? tgt[j] : this.lvCur[o + j];
        this.lvPrv[o + j] = cur;
        const k = 1 - Math.exp(-dt / (tgt[j] > cur ? LV_UP[j] : LV_DOWN[j]));
        this.lvCur[o + j] = fresh ? tgt[j] : cur + (tgt[j] - cur) * k;
      }
    }
  }

  /** Where each young kept daughter's mother is, so she can keep growing out of that place if the mother dies. */
  private rememberAnchors(world: SoftRoamWorld): void {
    for (let c = 0; c < world.cap; c++) {
      if (!world.alive[c]) continue;
      const b = world.bornStep[c];
      const m = world.mother[c];
      if (b === 0 || m < 0 || world.step - b >= GROW_STEPS || !world.alive[m]) continue;
      this.anchorX[c] = world.dlt(world.x[c], world.x[m]) / U;
      this.anchorY[c] = world.dlt(world.y[c], world.y[m]) / U;
      this.anchorCid[c] = world.cid[c];
    }
  }

  private ensureWorld(world: SoftRoamWorld): void {
    if (this.size !== world.size || this.cap !== world.cap || !this.sized) {
      this.size = world.size;
      this.cap = world.cap;
      this.sized = true;
      const n = world.n;
      this.foodShown = new Float32Array(n);
      this.foodPrev = new Float32Array(n);
      this.foodTmp = new Float32Array(n);
      this.busy = new Uint8Array(n);
      this.foodBlur = new Float32Array(n);
      this.haze = new Float32Array(n * 3);
      this.glow = new Float32Array(n * 3);
      this.px = new Float32Array(world.cap);
      this.py = new Float32Array(world.cap);
      this.grow = new Float32Array(world.cap);
      this.anchorX = new Float32Array(world.cap);
      this.anchorY = new Float32Array(world.cap);
      this.anchorCid = new Uint32Array(world.cap);
      this.order = new Int32Array(world.cap);
      this.lvCur = new Float32Array(world.cap * NLV);
      this.lvPrv = new Float32Array(world.cap * NLV);
      this.lvCid = new Uint32Array(world.cap);
      this.feedT = new Uint8Array(world.cap);
      this.hitT = new Uint8Array(world.cap);
      this.preyT = new Uint8Array(world.cap);
      this.rings.length = 0;
      this.threads.length = 0;
      this.counts = new Int32Array(world.cap + 3);
      this.seenStep = -1;
      this.side = 0;
    }
  }

  /** Make the per-pixel buffers for a scale (they are zero and stay zero between frames). */
  ensureSide(world: SoftRoamWorld, scale: number): void {
    this.ensureWorld(world);
    const side = world.size * scale;
    if (this.side === side && this.scale === scale) return;
    this.side = side;
    this.scale = scale;
    this.field = new Float32Array(side * side * 7);
    this.acc = new Float32Array(side * side * 6);
    this.hazeRowA = new Float32Array(side * 3);
    this.hazeRowB = new Float32Array(side * 3);
    this.glowRowA = new Float32Array(side * 3);
    this.glowRowB = new Float32Array(side * 3);
    this.tileOf = new Int32Array(side);
    for (let i = 0; i < side; i++) this.tileOf[i] = (i / scale) | 0;
    this.x0 = new Int32Array(side);
    this.x1 = new Int32Array(side);
    this.wx = new Float32Array(side);
    const s = world.size;
    // Ground (haze and glow) is smooth: it is sampled once per 2 x 2 pixels, at the block's centre.
    for (let ix = 0; ix < side; ix++) {
      const u = ((ix & ~1) + 1) / scale - 0.5;
      const i0 = Math.floor(u);
      this.wx[ix] = u - i0;
      this.x0[ix] = ((i0 % s) + s) % s;
      this.x1[ix] = (((i0 + 1) % s) + s) % s;
    }
  }
}

const pending: number[] = [];
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Where cell `c` is drawn at `alpha` (0 = start of the last step, 1 = its end), in tiles on [0, size), the short way
 * across the seam. `out[0]`, `out[1]` get x and y. Cells born in the last step sit at their birth place (their stored
 * previous position is not theirs).
 */
export function softCellPosition(world: SoftRoamWorld, c: number, alpha: number, out: number[] | Float32Array): void {
  const born = world.bornStep[c] > 0 && world.bornStep[c] >= world.step;
  const span = world.span;
  let x: number, y: number;
  if (born) {
    x = world.x[c];
    y = world.y[c];
  } else {
    x = world.prevX[c] + alpha * world.dlt(world.prevX[c], world.x[c]);
    y = world.prevY[c] + alpha * world.dlt(world.prevY[c], world.y[c]);
  }
  if (alpha >= 1) { x = world.x[c]; y = world.y[c]; }
  x = ((x % span) + span) % span;
  y = ((y % span) + span) % span;
  out[0] = x / U;
  out[1] = y / U;
}

/** Growth of a cell at `alpha`: 0 just born, 1 grown in. Founders and cells found by hand are grown. */
function growth(world: SoftRoamWorld, c: number, alpha: number): number {
  const b = world.bornStep[c];
  if (b === 0) return 1;
  const age = world.step - b + alpha;
  if (age < 0) return 1;
  // Linear in age: the painter applies the one smooth step (its `ease`) wherever it uses this.
  return age >= GROW_STEPS ? 1 : age / GROW_STEPS;
}

/** The smooth ease of a growth share. */
const ease = (g: number): number => g * g * (3 - 2 * g);

function famColour(fam: number): readonly number[] {
  return FAM_COLOUR[(Math.max(1, fam) - 1) % FAM_COLOUR.length] ?? [200, 200, 200];
}

/** Paint the world at `scale` pixels per tile into `out` (RGBA, `size * scale` square) at `alpha` between the last two steps. */
export function paintSoftRoam(world: SoftRoamWorld, paint: SoftPaint, scale: number, alpha: number, out: Uint8ClampedArray | Uint8Array, memory?: SoftPaintMemory): void {
  const side = world.size * scale;
  if (out.length !== side * side * 4) throw new Error('paintSoftRoam: wrong buffer size');
  if (!Number.isInteger(scale) || scale < 1) throw new Error(`paintSoftRoam: scale ${scale} must be a whole number of at least 1`);
  alpha = clamp01(alpha);
  const mem = memory ?? new SoftPaintMemory();
  mem.ensureSide(world, scale);
  mem.observe(world);
  // Where every live cell is drawn, and how grown it is.
  const pos = [0, 0];
  const cells: number[] = [];
  for (let c = 0; c < world.cap; c++) {
    if (!world.alive[c]) continue;
    softCellPosition(world, c, alpha, pos);
    mem.px[c] = pos[0];
    mem.py[c] = pos[1];
    mem.grow[c] = growth(world, c, alpha);
    cells.push(c);
  }
  // A young daughter comes out of her mother's side: she is drawn between the mother and her own place.
  const s = world.size;
  const half = s / 2;
  for (const c of cells) {
    const m = world.mother[c];
    const g = mem.grow[c];
    if (g >= 1 || world.bornStep[c] === 0) continue;
    const e = ease(g);
    let nx: number, ny: number;
    if (m >= 0 && world.alive[m]) {
      let dx = mem.px[c] - mem.px[m];
      let dy = mem.py[c] - mem.py[m];
      if (dx > half) dx -= s; else if (dx < -half) dx += s;
      if (dy > half) dy -= s; else if (dy < -half) dy += s;
      nx = mem.px[m] + dx * e;
      ny = mem.py[m] + dy * e;
    } else if (m < 0 && mem.anchorCid[c] === world.cid[c]) {
      // The mother died while the daughter was growing out of her side: keep coming out of the place she was.
      nx = mem.px[c] + mem.anchorX[c] * (1 - e);
      ny = mem.py[c] + mem.anchorY[c] * (1 - e);
    } else continue;
    nx = ((nx % s) + s) % s;
    ny = ((ny % s) + s) % s;
    // Keep reading the mother's undisturbed place for her other daughters: store the result after the loop.
    pending.push(c, nx, ny);
  }
  for (let k = 0; k < pending.length; k += 3) {
    mem.px[pending[k]] = pending[k + 1];
    mem.py[pending[k]] = pending[k + 2];
  }
  pending.length = 0;
  if (paint === 'plain') paintPlain(world, scale, alpha, out, mem, cells);
  else paintGarden(world, scale, alpha, out, mem, cells);
}
/** A cell's eased level `j` at `alpha` between the last two steps. */
function level(mem: SoftPaintMemory, c: number, j: number, alpha: number): number {
  const o = c * NLV + j;
  return mem.lvPrv[o] + (mem.lvCur[o] - mem.lvPrv[o]) * alpha;
}

/** The pulse of a feeding mouth: about every seven steps, never below 0.75, with its own phase per cell. */
const pulseOf = (world: SoftRoamWorld, c: number, alpha: number): number => 0.875 + 0.125 * Math.sin((world.step + alpha) * 0.9 + world.cid[c] * 1.7);

const PLAIN = [0, 0, 0];
/**
 * A cell's colour and how lit it is: family and plan hue with the store as inner brightness; shells pale bone (darker as they
 * are hit, white for a moment when hit), mouths red (warm and bright while feeding), a cell being fed on dimmer. The mix of
 * shell, mouth and plain follows the eased kind levels, so a cell that cracks changes over a few steps.
 */
function cellTint(world: SoftRoamWorld, c: number, full: number, rgb: Float32Array | number[], mem: SoftPaintMemory, alpha: number): number {
  const f = famColour(world.fam[c]);
  const p = roamPlanColour(world.pid[c]);
  // Mostly the family's colour, a little of the plan's own, and a trace of the garden's biomass green.
  PLAIN[0] = 0.12 * 0.2 + 0.58 * (f[0] / 255) + 0.3 * (p[0] / 255);
  PLAIN[1] = 0.12 * 0.85 + 0.58 * (f[1] / 255) + 0.3 * (p[1] / 255);
  PLAIN[2] = 0.12 * 0.35 + 0.58 * (f[2] / 255) + 0.3 * (p[2] / 255);
  let sh = level(mem, c, LV_SHELL, alpha), mo = level(mem, c, LV_MOUTH, alpha);
  const both = sh + mo;
  if (both > 1) { sh /= both; mo /= both; }
  const pl = 1 - sh - mo;
  const dmg = level(mem, c, LV_DMG, alpha), feed = level(mem, c, LV_FEED, alpha) * pulseOf(world, c, alpha), prey = level(mem, c, LV_PREY, alpha), hit = level(mem, c, LV_HIT, alpha);
  const dk = 1 - 0.6 * dmg;
  // Shell: pale bone, darker and browner with damage. Mouth: red, warmer and brighter while feeding.
  const sr = 0.84 * dk, sg = 0.82 * (dk - 0.04 * dmg), sb = 0.7 * (dk - 0.1 * dmg);
  const mr = 1, mg = 0.24 + 0.2 * feed, mb = 0.18 + 0.04 * feed;
  rgb[0] = pl * PLAIN[0] + sh * sr + mo * mr;
  rgb[1] = pl * PLAIN[1] + sh * sg + mo * mg;
  rgb[2] = pl * PLAIN[2] + sh * sb + mo * mb;
  let lit = pl * (0.5 + 0.5 * Math.min(1, world.store[c] / full)) + sh * 0.85 + mo * (1 + 0.4 * feed);
  lit *= 1 - 0.5 * prey;
  if (hit > 0) {
    const fl = hit * (1 - 0.5 * dmg);
    rgb[0] += (1 - rgb[0]) * 0.3 * fl; rgb[1] += (1 - rgb[1]) * 0.3 * fl; rgb[2] += (1 - rgb[2]) * 0.28 * fl;
    lit *= 1 + 0.15 * fl;
  }
  return lit;
}

const tintBuf = new Float32Array(3);

function paintGarden(world: SoftRoamWorld, scale: number, alpha: number, out: Uint8ClampedArray | Uint8Array, mem: SoftPaintMemory, cells: number[]): void {
  const s = world.size;
  const side = s * scale;
  const full = 2 * world.cfg.birthStore;
  const { field, acc, haze, glow, busy } = mem;
  busy.fill(0);
  const n = world.n;
  // ---- Low-resolution layers at tile centres: food haze (eased over time) and the wide soft glow.
  const fs = mem.foodTmp;
  for (let i = 0; i < n; i++) fs[i] = mem.foodPrev[i] + (mem.foodShown[i] - mem.foodPrev[i]) * alpha;
  // One soft pass (1-2-1 each way) so patches read as haze, not as stamped discs.
  for (let ty = 0; ty < s; ty++) {
    const up = ((ty + s - 1) % s) * s, mid = ty * s, dn = ((ty + 1) % s) * s;
    for (let tx = 0; tx < s; tx++) {
      const l = (tx + s - 1) % s, r = (tx + 1) % s;
      mem.foodBlur[mid + tx] = (fs[up + l] + 2 * fs[up + tx] + fs[up + r] + 2 * (fs[mid + l] + 2 * fs[mid + tx] + fs[mid + r]) + fs[dn + l] + 2 * fs[dn + tx] + fs[dn + r]) / 16;
    }
  }
  for (let i = 0; i < n; i++) {
    const f = Math.min(1, mem.foodBlur[i] * 1.15);
    haze[i * 3] = 0.006 + 0.02 * f;
    haze[i * 3 + 1] = 0.01 + 0.06 * f;
    haze[i * 3 + 2] = 0.04 + 0.2 * f;
  }
  glow.fill(0);
  const splat = (cx: number, cy: number, rad: number, r: number, g: number, b: number): void => {
    const x0 = Math.floor(cx - rad - 0.5), x1 = Math.ceil(cx + rad - 0.5);
    const y0 = Math.floor(cy - rad - 0.5), y1 = Math.ceil(cy + rad - 0.5);
    const inv = 1 / (rad * rad);
    for (let ty = y0; ty <= y1; ty++) {
      const dy = ty + 0.5 - cy;
      const wy = ty < 0 ? ty + s : ty >= s ? ty - s : ty;
      for (let tx = x0; tx <= x1; tx++) {
        const dx = tx + 0.5 - cx;
        const q = 1 - (dx * dx + dy * dy) * inv;
        if (q <= 0) continue;
        const w = q * q;
        const wx = tx < 0 ? tx + s : tx >= s ? tx - s : tx;
        const k = (wy * s + wx) * 3;
        glow[k] += r * w; glow[k + 1] += g * w; glow[k + 2] += b * w;
      }
    }
  };
  // ---- Bodies: group the cells by body, stamp each body's soft field, merge it into the strongest and second strongest.
  const counts = mem.counts;
  counts.fill(0);
  let maxLabel = 0;
  for (const c of cells) { const l = world.body[c]; counts[l + 1]++; if (l > maxLabel) maxLabel = l; }
  for (let l = 1; l <= maxLabel + 2; l++) counts[l] += counts[l - 1];
  const order = mem.order;
  for (const c of cells) order[counts[world.body[c]]++] = c;
  let lo = 0;
  const total = cells.length;
  const stamp = (cx: number, cy: number, rad: number, amp: number, r: number, g: number, b: number, sh: number, dm: number): void => {
    const x0 = Math.floor((cx - rad) * scale), x1 = Math.ceil((cx + rad) * scale);
    const y0 = Math.floor((cy - rad) * scale), y1 = Math.ceil((cy + rad) * scale);
    const inv = 1 / (rad * rad);
    for (let ty = Math.floor(y0 / scale); ty <= Math.floor(y1 / scale); ty++) {
      const wty = ty < 0 ? ty + s : ty >= s ? ty - s : ty;
      for (let tx = Math.floor(x0 / scale); tx <= Math.floor(x1 / scale); tx++) busy[wty * s + (tx < 0 ? tx + s : tx >= s ? tx - s : tx)] = 1;
    }
    for (let yy = y0; yy <= y1; yy++) {
      const dy = (yy + 0.5) / scale - cy;
      const wy = yy < 0 ? yy + side : yy >= side ? yy - side : yy;
      for (let xx = x0; xx <= x1; xx++) {
        const dx = (xx + 0.5) / scale - cx;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rad * rad) continue;
        const q = 1 - d2 * inv;
        const f = q * q * amp;
        const wxp = xx < 0 ? xx + side : xx >= side ? xx - side : xx;
        const k = (wy * side + wxp) * 6;
        acc[k] += f; acc[k + 1] += r * f; acc[k + 2] += g * f; acc[k + 3] += b * f; acc[k + 4] += sh * f; acc[k + 5] += dm * f;
      }
    }
  };
  const merge = (cx: number, cy: number, rad: number): void => {
    const x0 = Math.floor((cx - rad) * scale), x1 = Math.ceil((cx + rad) * scale);
    const y0 = Math.floor((cy - rad) * scale), y1 = Math.ceil((cy + rad) * scale);
    for (let yy = y0; yy <= y1; yy++) {
      const wy = yy < 0 ? yy + side : yy >= side ? yy - side : yy;
      for (let xx = x0; xx <= x1; xx++) {
        const wxp = xx < 0 ? xx + side : xx >= side ? xx - side : xx;
        const idx = wy * side + wxp;
        const k = idx * 6;
        const f = acc[k];
        if (f <= 0) continue;
        const m = idx * 7;
        if (f > field[m]) {
          field[m + 1] = field[m];
          field[m] = f;
          const inv = 1 / f;
          field[m + 2] = acc[k + 1] * inv; field[m + 3] = acc[k + 2] * inv; field[m + 4] = acc[k + 3] * inv; field[m + 5] = acc[k + 4] * inv; field[m + 6] = acc[k + 5] * inv;
        } else if (f > field[m + 1]) field[m + 1] = f;
        acc[k] = 0; acc[k + 1] = 0; acc[k + 2] = 0; acc[k + 3] = 0; acc[k + 4] = 0; acc[k + 5] = 0;
      }
    }
  };
  while (lo < total) {
    const label = world.body[order[lo]];
    let hi = lo;
    while (hi < total && world.body[order[hi]] === label) hi++;
    for (let q = lo; q < hi; q++) {
      const c = order[q];
      const g = mem.grow[c];
      const lit = cellTint(world, c, full, tintBuf, mem, alpha);
      const e = ease(g);
      const rad = FIELD_R * (0.35 + 0.65 * e);
      const shl = Math.min(1, level(mem, c, LV_SHELL, alpha));
      const mol = Math.min(1, level(mem, c, LV_MOUTH, alpha));
      const feed = level(mem, c, LV_FEED, alpha), hit = level(mem, c, LV_HIT, alpha);
      stamp(mem.px[c], mem.py[c], rad, 0.6 + 0.4 * e, tintBuf[0] * lit, tintBuf[1] * lit, tintBuf[2] * lit, shl, shl * level(mem, c, LV_DMG, alpha));
      splat(mem.px[c], mem.py[c], GLOW_R, 0.2 * tintBuf[0] * lit * e, 0.2 * tintBuf[1] * lit * e, 0.2 * tintBuf[2] * lit * e);
      if (mol > 0.001) splat(mem.px[c], mem.py[c], GLOW_R, 0.3 * e * mol, 0.06 * e * mol, 0.04 * e * mol);
      // A feeding mouth: a warm red halo that pulses. A shell that was just hit: a short white flare.
      if (feed > 0.001) {
        const pu = feed * pulseOf(world, c, alpha) * e;
        splat(mem.px[c], mem.py[c], GLOW_R - 0.2, 0.5 * pu, 0.09 * pu, 0.03 * pu);
      }
      if (hit > 0.001) splat(mem.px[c], mem.py[c], GLOW_R - 0.4, 0.16 * hit * e, 0.15 * hit * e, 0.12 * hit * e);
    }
    for (let q = lo; q < hi; q++) {
      const c = order[q];
      const e = ease(mem.grow[c]);
      merge(mem.px[c], mem.py[c], FIELD_R * (0.35 + 0.65 * e));
    }
    lo = hi;
  }
  // ---- Ghosts of the recently dead: a pale light that shrinks and fades to nothing (added to the glow, so it can never
  // leave a hole, a ring or a seam in the bodies or the ground), and a puff of compost when the matter went to the ground.
  const step = world.step;
  for (const gh of mem.ghosts) {
    const age = step - gh.step + alpha;
    if (age >= GHOST_STEPS) continue;
    const t = age / GHOST_STEPS;
    const fade = (1 - t) * (1 - t);
    const rad = FIELD_R * (1 - 0.35 * t) + 0.3;
    const lit = 0.5 * fade;
    if (gh.kind === KIND_MOUTH) splat(gh.x, gh.y, rad, 1 * lit, 0.3 * lit, 0.25 * lit);
    else splat(gh.x, gh.y, rad, 0.8 * lit, 0.86 * lit, 0.82 * lit);
    if (gh.compost) {
      const puff = Math.sin(Math.PI * Math.min(1, t * 1.15)) * 0.55;
      if (puff > 0) splat(gh.x, gh.y, 1.3 + 1.2 * t, 0.1 * puff, 0.5 * puff, 1.0 * puff);
    }
  }
  // ---- Per pixel: ground (haze) and glow sampled per 2 x 2 block, bodies composed over it per pixel.
  const { hazeRowA, hazeRowB, glowRowA, glowRowB, x0, x1, wx, tileOf } = mem;
  const out32 = out.byteOffset % 4 === 0 ? new Uint32Array(out.buffer, out.byteOffset, out.length >> 2) : null;
  let cachedRow = -2;
  const T = THRESH;
  const grd = [0, 0, 0];
  for (let iy = 0; iy < side; iy += 2) {
    const v = ((iy & ~1) + 1) / scale - 0.5;
    const j0 = Math.floor(v);
    const fy = v - j0;
    if (j0 !== cachedRow) {
      cachedRow = j0;
      const rowA = (((j0 % s) + s) % s) * s;
      const rowB = ((((j0 + 1) % s) + s) % s) * s;
      for (let ix = 0; ix < side; ix += 2) {
        const a = (rowA + x0[ix]) * 3, b = (rowA + x1[ix]) * 3, c = (rowB + x0[ix]) * 3, d = (rowB + x1[ix]) * 3;
        const w = wx[ix];
        const o = ix * 3;
        for (let ch = 0; ch < 3; ch++) {
          hazeRowA[o + ch] = haze[a + ch] + (haze[b + ch] - haze[a + ch]) * w;
          hazeRowB[o + ch] = haze[c + ch] + (haze[d + ch] - haze[c + ch]) * w;
          glowRowA[o + ch] = glow[a + ch] + (glow[b + ch] - glow[a + ch]) * w;
          glowRowB[o + ch] = glow[c + ch] + (glow[d + ch] - glow[c + ch]) * w;
        }
      }
    }
    const yEnd = Math.min(side, iy + 2);
    for (let ix = 0; ix < side; ix += 2) {
      const o = ix * 3;
      const hr = hazeRowA[o] + (hazeRowB[o] - hazeRowA[o]) * fy;
      const hg = hazeRowA[o + 1] + (hazeRowB[o + 1] - hazeRowA[o + 1]) * fy;
      const hb = hazeRowA[o + 2] + (hazeRowB[o + 2] - hazeRowA[o + 2]) * fy;
      const gr = glowRowA[o] + (glowRowB[o] - glowRowA[o]) * fy;
      const gg = glowRowA[o + 1] + (glowRowB[o + 1] - glowRowA[o + 1]) * fy;
      const gb = glowRowA[o + 2] + (glowRowB[o + 2] - glowRowA[o + 2]) * fy;
      const xEnd = Math.min(side, ix + 2);
      // The ground's own bytes, used by every pixel of the block that holds no body.
      const gR = GAMMA[Math.min(GAMMA_N - 1, ((hr + gr) * GAMMA_STEP) | 0)];
      const gG = GAMMA[Math.min(GAMMA_N - 1, ((hg + gg) * GAMMA_STEP) | 0)];
      const gB = GAMMA[Math.min(GAMMA_N - 1, ((hb + gb) * GAMMA_STEP) | 0)];
      const tx0 = tileOf[ix], tx1 = tileOf[xEnd - 1], ty0 = tileOf[iy] * s, ty1 = tileOf[yEnd - 1] * s;
      const isBusy = busy[ty0 + tx0] | busy[ty0 + tx1] | busy[ty1 + tx0] | busy[ty1 + tx1];
      if (isBusy === 0 && out32 !== null && xEnd - ix === 2) {
        const word = (255 << 24) | (gB << 16) | (gG << 8) | gR;
        const q = (iy * side + ix);
        out32[q] = word; out32[q + 1] = word;
        if (yEnd - iy === 2) { out32[q + side] = word; out32[q + side + 1] = word; }
        continue;
      }
      for (let yy = iy; yy < yEnd; yy++) {
        for (let xx = ix; xx < xEnd; xx++) {
          const idx = yy * side + xx;
          const p = idx * 4;
          const m = idx * 7;
          const best = isBusy ? field[m] : 0;
          if (best <= 0) { out[p] = gR; out[p + 1] = gG; out[p + 2] = gB; out[p + 3] = 255; continue; }
          grd[0] = hr; grd[1] = hg; grd[2] = hb;
          const F = best - field[m + 1];
          const sh = field[m + 5];
          const dm = sh > 0 ? Math.min(1, field[m + 6] / sh) : 0;
          const inside = smooth(T - 0.05, T + 0.05, F);
          // A shell's rim is wider and stronger: thick pale bone, darker and browner as it is damaged.
          const rimW = 0.1 + 0.2 * sh;
          const rz = (F - T - 0.1) / rimW;
          const rq = 1 / (1 + rz * rz * 1.2);
          const rim = rq * rq * (1 + 0.8 * sh);
          const depth = 0.62 + 0.38 * smooth(T + 0.2, T + 1.2, F);
          const cr = field[m + 2], cg = field[m + 3], cb = field[m + 4];
          const k = inside * depth;
          // The rim is the body's own colour lifted toward white (a shell's: bone).
          const dk = 1 - 0.55 * dm;
          const pr = (0.4 + 0.6 * cr) * (1 - sh) + sh * BONE[0] * dk;
          const pg = (0.4 + 0.6 * cg) * (1 - sh) + sh * BONE[1] * (dk - 0.05 * dm);
          const pb = (0.4 + 0.6 * cb) * (1 - sh) + sh * BONE[2] * (dk - 0.12 * dm);
          const rimK = 0.36 + 0.4 * sh;
          const r = grd[0] * (1 - inside) + cr * k + rimK * pr * rim * inside + 0.12 * rim * (1 - inside) + gr;
          const g = grd[1] * (1 - inside) + cg * k + rimK * pg * rim * inside + 0.12 * rim * (1 - inside) + gg;
          const b = grd[2] * (1 - inside) + cb * k + rimK * pb * rim * inside + 0.12 * rim * (1 - inside) + gb;
          field[m] = 0; field[m + 1] = 0; field[m + 2] = 0; field[m + 3] = 0; field[m + 4] = 0; field[m + 5] = 0; field[m + 6] = 0;
          out[p] = GAMMA[Math.min(GAMMA_N - 1, (r * GAMMA_STEP) | 0)];
          out[p + 1] = GAMMA[Math.min(GAMMA_N - 1, (g * GAMMA_STEP) | 0)];
          out[p + 2] = GAMMA[Math.min(GAMMA_N - 1, (b * GAMMA_STEP) | 0)];
          out[p + 3] = 255;
        }
      }
    }
  }
  // ---- Mother links as soft strands, brighter where the two stores differ.
  drawLinks(world, scale, out, mem, cells, full, 'garden');
  drawKinds(world, scale, alpha, out, mem, cells);
}

/**
 * One soft stroke straight into the picture (bytes): from (ax, ay) by (dx, dy) in tiles. `dark` darkens what is under it
 * (a fracture), otherwise it adds light of colour (r, g, b).
 */
function stroke(out: Uint8ClampedArray | Uint8Array, scale: number, side: number, ax: number, ay: number, dx: number, dy: number, sigma: number, strength: number, dark: boolean, r: number, g: number, b: number): void {
  if (strength <= 0.003) return;
  const reach = 3 * sigma;
  const len2 = dx * dx + dy * dy;
  const x0 = Math.floor((Math.min(ax, ax + dx) - reach) * scale), x1 = Math.ceil((Math.max(ax, ax + dx) + reach) * scale);
  const y0 = Math.floor((Math.min(ay, ay + dy) - reach) * scale), y1 = Math.ceil((Math.max(ay, ay + dy) + reach) * scale);
  const inv2 = 1 / (2 * sigma * sigma);
  for (let yy = y0; yy <= y1; yy++) {
    const wy = yy < 0 ? yy + side : yy >= side ? yy - side : yy;
    const py = (yy + 0.5) / scale - ay;
    for (let xx = x0; xx <= x1; xx++) {
      const wxp = xx < 0 ? xx + side : xx >= side ? xx - side : xx;
      const pxx = (xx + 0.5) / scale - ax;
      let t = len2 > 0 ? (pxx * dx + py * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = pxx - t * dx, ey = py - t * dy;
      const d2 = ex * ex + ey * ey;
      if (d2 > reach * reach) continue;
      const a = strength * Math.exp(-d2 * inv2);
      const p = (wy * side + wxp) * 4;
      if (dark) {
        const q = 1 - 0.75 * a;
        out[p] = out[p] * q; out[p + 1] = out[p + 1] * q; out[p + 2] = out[p + 2] * q;
      } else {
        out[p] = Math.min(255, out[p] + a * r * 255);
        out[p + 1] = Math.min(255, out[p + 1] + a * g * 255);
        out[p + 2] = Math.min(255, out[p + 2] + a * b * 255);
      }
    }
  }
}

/** Fracture lines on damaged shells, a thread from each feeding mouth to its prey, and the broken ring of a fresh crack. */
function drawKinds(world: SoftRoamWorld, scale: number, alpha: number, out: Uint8ClampedArray | Uint8Array, mem: SoftPaintMemory, cells: number[]): void {
  const s = world.size;
  const side = s * scale;
  const half = s / 2;
  const sigma = Math.max(0.04, 0.6 / scale);
  const seed = world.cfg.seed;
  // Fractures: up to five jagged dark lines from the middle of a shell cell to its edge, each easing in at its own damage.
  for (const c of cells) {
    const sh = level(mem, c, LV_SHELL, alpha);
    const dmg = level(mem, c, LV_DMG, alpha);
    if (sh < 0.05 || dmg < 0.12) continue;
    const e = ease(mem.grow[c]);
    const cx = mem.px[c], cy = mem.py[c];
    for (let i = 0; i < 5; i++) {
      const thr = 0.12 + 0.17 * i;
      const a = smooth(thr, thr + 0.18, dmg) * sh * e;
      if (a <= 0.01) continue;
      let ang = (roamHash(seed, 0, world.cid[c], 200 + i) % 6283) / 1000;
      let x = cx + 0.06 * Math.cos(ang), y = cy + 0.06 * Math.sin(ang);
      for (let sgm = 0; sgm < 3; sgm++) {
        ang += ((roamHash(seed, 0, world.cid[c], 210 + 3 * i + sgm) % 1000) / 1000 - 0.5) * 1.1;
        const len = 0.15 * (0.6 + 0.4 * Math.min(1, dmg * 1.3));
        const dx = len * Math.cos(ang), dy = len * Math.sin(ang);
        stroke(out, scale, side, x, y, dx, dy, sigma * 0.7, 0.8 * a, true, 0, 0, 0);
        x += dx; y += dy;
      }
    }
  }
  // Mouths: a small warm core on top of the body, so a hunter reads at a glance; it brightens and pulses while feeding.
  for (const c of cells) {
    const mo = level(mem, c, LV_MOUTH, alpha);
    if (mo < 0.05) continue;
    const feed = level(mem, c, LV_FEED, alpha) * pulseOf(world, c, alpha);
    const a = mo * ease(mem.grow[c]) * (0.5 + 0.5 * feed);
    stroke(out, scale, side, mem.px[c], mem.py[c], 0, 0, Math.max(0.12, 0.7 / scale) * (1 + 0.35 * feed), a, false, 1, 0.3 + 0.2 * feed, 0.12);
  }
  // Feeding threads: a thin red line from the mouth to the cell it feeds on, brighter at the mouth end.
  for (const th of mem.threads) {
    const lvl = th.prv + (th.lvl - th.prv) * alpha;
    const m = th.ms, p = th.ps;
    if (lvl < 0.02 || !world.alive[m] || !world.alive[p] || world.cid[m] !== th.mc || world.cid[p] !== th.pc) continue;
    let dx = mem.px[p] - mem.px[m], dy = mem.py[p] - mem.py[m];
    if (dx > half) dx -= s; else if (dx < -half) dx += s;
    if (dy > half) dy -= s; else if (dy < -half) dy += s;
    if (dx * dx + dy * dy > 9) continue;
    const a = lvl * ease(Math.min(mem.grow[m], mem.grow[p])) * (0.85 + 0.15 * pulseOf(world, m, alpha));
    const ax = mem.px[m], ay = mem.py[m];
    // Two halves: the mouth's half stronger, so the thread reads as running from the mouth to its prey.
    stroke(out, scale, side, ax, ay, dx * 0.5, dy * 0.5, sigma * 1.2, 0.95 * a, false, 1, 0.22, 0.14);
    stroke(out, scale, side, ax + dx * 0.5, ay + dy * 0.5, dx * 0.5, dy * 0.5, sigma, 0.6 * a, false, 1, 0.3, 0.2);
  }
  // Cracks: a ring of bone-white arcs, with gaps, that opens out and fades.
  for (const rg of mem.rings) {
    const age = world.step - rg.step + alpha;
    if (age < 0 || age >= RING_STEPS) continue;
    const t = age / RING_STEPS;
    const a = smooth(0, 1.5, age) * (1 - smooth(0.25, 1, t));
    if (a <= 0.01) continue;
    const rad = 0.55 + 1.3 * (1 - (1 - t) * (1 - t));
    const spin = rg.x * 3.1 + rg.y * 1.7;
    const N = 18;
    for (let k = 0; k < N; k++) {
      const th0 = (2 * Math.PI * k) / N, th1 = (2 * Math.PI * (k + 1)) / N;
      // Gaps where a slow wave dips: the ring looks broken, not drawn.
      if (Math.sin(3 * (th0 + th1) / 2 + spin) < -0.25) continue;
      const x0 = rg.x + rad * Math.cos(th0), y0 = rg.y + rad * Math.sin(th0);
      stroke(out, scale, side, ((x0 % s) + s) % s, ((y0 % s) + s) % s, rad * (Math.cos(th1) - Math.cos(th0)), rad * (Math.sin(th1) - Math.sin(th0)), sigma * 1.4, 0.8 * a, false, BONE[0], BONE[1], BONE[2]);
    }
  }
}

/** Mother links drawn straight into the picture (bytes), after the rest. */
function drawLinks(world: SoftRoamWorld, scale: number, out: Uint8ClampedArray | Uint8Array, mem: SoftPaintMemory, cells: number[], full: number, paint: SoftPaint): void {
  const s = world.size;
  const side = s * scale;
  const half = s / 2;
  const sigma = paint === 'garden' ? 0.11 : 0.05;
  const reach = 3 * sigma;
  for (const c of cells) {
    const m = world.mother[c];
    if (m < 0 || !world.alive[m]) continue;
    let dx = mem.px[m] - mem.px[c];
    let dy = mem.py[m] - mem.py[c];
    if (dx > half) dx -= s; else if (dx < -half) dx += s;
    if (dy > half) dy -= s; else if (dy < -half) dy += s;
    const len2 = dx * dx + dy * dy;
    if (len2 > 9) continue;
    const gMin = ease(Math.min(mem.grow[c], mem.grow[m]));
    const diff = Math.min(1, Math.abs(world.store[c] - world.store[m]) / full);
    const strength = paint === 'garden' ? (0.04 + 0.6 * diff) * gMin : 0.8;
    if (strength <= 0.002) continue;
    const ax = mem.px[c], ay = mem.py[c];
    const x0 = Math.floor((Math.min(ax, ax + dx) - reach) * scale), x1 = Math.ceil((Math.max(ax, ax + dx) + reach) * scale);
    const y0 = Math.floor((Math.min(ay, ay + dy) - reach) * scale), y1 = Math.ceil((Math.max(ay, ay + dy) + reach) * scale);
    const inv2 = 1 / (2 * sigma * sigma);
    for (let yy = y0; yy <= y1; yy++) {
      const wy = yy < 0 ? yy + side : yy >= side ? yy - side : yy;
      const py = (yy + 0.5) / scale - ay;
      for (let xx = x0; xx <= x1; xx++) {
        const wxp = xx < 0 ? xx + side : xx >= side ? xx - side : xx;
        const pxx = (xx + 0.5) / scale - ax;
        let t = len2 > 0 ? (pxx * dx + py * dy) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = pxx - t * dx, ey = py - t * dy;
        const d2 = ex * ex + ey * ey;
        if (d2 > reach * reach) continue;
        const a = strength * Math.exp(-d2 * inv2) * 255;
        const p = (wy * side + wxp) * 4;
        if (paint === 'garden') {
          out[p] = Math.min(255, out[p] + a * 0.85);
          out[p + 1] = Math.min(255, out[p + 1] + a * 0.95);
          out[p + 2] = Math.min(255, out[p + 2] + a * 0.8);
        } else {
          out[p] = Math.min(255, out[p] + a * 0.5);
          out[p + 1] = Math.min(255, out[p + 1] + a * 0.5);
          out[p + 2] = Math.min(255, out[p + 2] + a * 0.5);
        }
      }
    }
  }
}

/** Discs and links, for debugging: a disc per cell at its drawn place (family colour, dimmer when hungry), a grey line to its mother. */
function paintPlain(world: SoftRoamWorld, scale: number, alpha: number, out: Uint8ClampedArray | Uint8Array, mem: SoftPaintMemory, cells: number[]): void {
  void alpha;
  const s = world.size;
  const side = s * scale;
  const full = 2 * world.cfg.birthStore;
  for (let ty = 0; ty < s; ty++) {
    for (let tx = 0; tx < s; tx++) {
      const f = Math.min(1, world.food[ty * s + tx] / FOOD_FULL);
      const r = 13 + 30 * f, g = 19 + 120 * f, b = 17 + 40 * f;
      for (let py = 0; py < scale; py++) {
        let p = ((ty * scale + py) * side + tx * scale) * 4;
        for (let px = 0; px < scale; px++, p += 4) { out[p] = r; out[p + 1] = g; out[p + 2] = b; out[p + 3] = 255; }
      }
    }
  }
  const rad = 0.5;
  for (const c of cells) {
    const lit = 0.45 + 0.55 * Math.min(1, world.store[c] / full);
    const col = world.kind[c] === KIND_MOUTH ? [255, 60, 50] : world.kind[c] === KIND_SHELL ? [215, 210, 180] : famColour(world.fam[c]);
    const cx = mem.px[c], cy = mem.py[c];
    const x0 = Math.floor((cx - rad) * scale), x1 = Math.ceil((cx + rad) * scale);
    const y0 = Math.floor((cy - rad) * scale), y1 = Math.ceil((cy + rad) * scale);
    for (let yy = y0; yy <= y1; yy++) {
      const wy = yy < 0 ? yy + side : yy >= side ? yy - side : yy;
      const dy = (yy + 0.5) / scale - cy;
      for (let xx = x0; xx <= x1; xx++) {
        const dx = (xx + 0.5) / scale - cx;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > rad) continue;
        const wxp = xx < 0 ? xx + side : xx >= side ? xx - side : xx;
        const p = (wy * side + wxp) * 4;
        const edge = scale >= 3 && d > rad - 1 / scale;
        out[p] = edge ? 13 : col[0] * lit;
        out[p + 1] = edge ? 19 : col[1] * lit;
        out[p + 2] = edge ? 17 : col[2] * lit;
      }
    }
  }
  drawLinks(world, scale, out, mem, cells, full, 'plain');
}

// ---------------------------------------------------------------------------------------------------- readouts

export interface SoftFamilyRow { family: number; name: string; colour: readonly number[]; cells: number }

export function softFamilies(world: SoftRoamWorld): SoftFamilyRow[] {
  const rows = FAMILY_ORDER.map((t, k) => ({ family: k + 1, name: ROAM_TYPES[t].name, colour: ROAM_TYPES[t].colour, cells: 0 }));
  for (let c = 0; c < world.cap; c++) {
    if (!world.alive[c]) continue;
    const row = rows[world.fam[c] - 1];
    if (row) row.cells++;
  }
  return rows;
}

/**
 * How far cells moved over the last step: the largest and the mean displacement of a cell that was not born in it (a cell
 * that moved and then died counts), in tiles (shortest way round the torus). Smooth motion keeps the largest small and close to a few times the mean.
 */
export function softSmoothness(world: SoftRoamWorld): { max: number; mean: number; cells: number } {
  let max = 0, sum = 0, cells = 0;
  const take = (dx: number, dy: number): void => {
    const d = Math.sqrt(dx * dx + dy * dy) / U;
    cells++;
    sum += d;
    if (d > max) max = d;
  };
  for (let c = 0; c < world.cap; c++) {
    if (!world.alive[c] || (world.bornStep[c] > 0 && world.bornStep[c] >= world.step)) continue;
    take(world.dlt(world.prevX[c], world.x[c]), world.dlt(world.prevY[c], world.y[c]));
  }
  // Cells that moved and then died in the step are no longer in a slot (or the slot is someone else's): the death events keep their path.
  for (const d of world.events.deaths) take(world.dlt(d.fromX, d.x), world.dlt(d.fromY, d.y));
  return { max, mean: cells ? sum / cells : 0, cells };
}

/**
 * How far cells travelled between two looks: remembers where every cell (by serial number) was, and on the next call
 * gives the mean straight-line distance of the cells still alive, in tiles (shortest way round the torus).
 */
export function softTravel(world: SoftRoamWorld): () => { cells: number; mean: number; movedShare: number } {
  let before = new Map<number, number>();
  return () => {
    const now = new Map<number, number>();
    let cells = 0, sum = 0, moved = 0;
    for (let c = 0; c < world.cap; c++) {
      if (!world.alive[c]) continue;
      const id = world.cid[c];
      const was = before.get(id);
      now.set(id, world.x[c] + world.y[c] * world.span);
      if (was === undefined) continue;
      const wy = Math.floor(was / world.span);
      const wxx = was - wy * world.span;
      const dx = world.dlt(wxx, world.x[c]);
      const dy = world.dlt(wy, world.y[c]);
      const d = Math.sqrt(dx * dx + dy * dy) / U;
      cells++;
      sum += d;
      if (d >= 2) moved++;
    }
    before = now;
    return { cells, mean: cells ? sum / cells : 0, movedShare: cells ? moved / cells : 0 };
  };
}

export interface SoftRoamRates { steps: number; divisions: number; releases: number; cellDeaths: number; bodyDeaths: number; worn: number; composted: number; patches: number; travel: number; movedShare: number }

export interface SoftRoamReadouts {
  families: SoftFamilyRow[];
  /** Per 1,000 steps over the last stretch, and how far cells travelled in it (tiles). */
  rates: SoftRoamRates;
  /** Largest and mean displacement of a cell over the last step, in tiles. */
  smooth: { max: number; mean: number };
  plansEver: number;
}

export interface SoftRoamFrame {
  side: number;
  pixels: Uint8ClampedArray;
  census: SoftRoamCensus;
  step: number;
  readouts: SoftRoamReadouts;
}

export type SoftRoamToWorker =
  | { type: 'reset'; gen: number; opts: SoftRoamOptions; scale: number; paint: SoftPaint }
  | { type: 'advance'; gen: number; steps: number; alpha: number; paint: SoftPaint; budgetMs?: number }
  /** Redraw at a given alpha without stepping. */
  | { type: 'paint'; gen: number; alpha: number; paint: SoftPaint }
  /** Give back the pixels of a frame already drawn, to be painted into again. */
  | { type: 'recycle'; gen: number; buffer: ArrayBuffer };
export type SoftRoamFromWorker = { type: 'frame'; gen: number; frame: SoftRoamFrame } | { type: 'error'; gen: number; message: string };

const RATE_EVERY = 200;

/** A world plus what the page shows of it. */
export class SoftRoamSession {
  readonly world: SoftRoamWorld;
  readonly memory = new SoftPaintMemory();
  private readonly scale: number;
  private readonly travel: () => { cells: number; mean: number; movedShare: number };
  private last: SoftRoamCensus;
  private rates: SoftRoamRates = { steps: 0, divisions: 0, releases: 0, cellDeaths: 0, bodyDeaths: 0, worn: 0, composted: 0, patches: 0, travel: 0, movedShare: 0 };
  private smoothNow = { max: 0, mean: 0 };

  constructor(opts: SoftRoamOptions, scale: number) {
    this.world = foundSoftRoam(opts);
    this.scale = scale;
    this.travel = softTravel(this.world);
    this.travel();
    this.last = this.world.census();
    this.memory.observe(this.world);
  }

  /** Step up to `steps` times, stopping early after `budgetMs`. Returns the steps taken. */
  advance(steps: number, budgetMs: number): number {
    const t0 = performance.now();
    let done = 0;
    for (let i = 0; i < steps; i++) {
      this.world.stepOnce();
      this.memory.observe(this.world);
      done++;
      if (this.world.step % RATE_EVERY === 0) {
        const c = this.world.census();
        const tr = this.travel();
        const per = 1000 / RATE_EVERY;
        this.rates = {
          steps: RATE_EVERY,
          divisions: (c.divisions - this.last.divisions) * per,
          releases: (c.releases - this.last.releases) * per,
          cellDeaths: (c.cellDeaths - this.last.cellDeaths) * per,
          bodyDeaths: (c.bodyDeaths - this.last.bodyDeaths) * per,
          worn: (c.worn - this.last.worn) * per,
          composted: (c.composted - this.last.composted) * per,
          patches: (c.patches - this.last.patches) * per,
          travel: tr.mean,
          movedShare: tr.movedShare,
        };
        this.last = c;
      }
      if ((i & 7) === 7 && performance.now() - t0 > budgetMs) break;
    }
    if (done > 0) {
      const sm = softSmoothness(this.world);
      this.smoothNow = { max: sm.max, mean: sm.mean };
    }
    return done;
  }

  private spare: Uint8ClampedArray | null = null;

  /** Hand back the pixels of a frame that has been shown, so the next frame can be painted into them instead of a new buffer. */
  recycle(pixels: Uint8ClampedArray): void {
    const side = this.world.size * this.scale;
    if (pixels.length === side * side * 4 && pixels.buffer.byteLength === pixels.length && pixels.buffer.byteLength > 0) this.spare = pixels;
  }

  /** The picture at `alpha` between the last two steps, with the census and readouts. */
  frame(paint: SoftPaint, alpha: number): SoftRoamFrame {
    const side = this.world.size * this.scale;
    const pixels = this.spare ?? new Uint8ClampedArray(side * side * 4);
    this.spare = null;
    paintSoftRoam(this.world, paint, this.scale, alpha, pixels, this.memory);
    return {
      side,
      pixels,
      census: this.world.census(),
      step: this.world.step,
      readouts: { families: softFamilies(this.world), rates: this.rates, smooth: this.smoothNow, plansEver: this.world.plans.length - 1 },
    };
  }
}
