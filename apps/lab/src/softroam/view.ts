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
 * approach the crack count, and flashes when hit; a mouth is a dusky rose at rest and glows warm red and pulses for some steps after it feeds, the prey
 * cell it feeds on dims, and a thin red thread joins them; a crack leaves a short broken ring. The painter reads the world
 * and never writes to it.
 */

import { ROAM_PLANS, ROAM_STARTS, ROAM_TYPES, roamPlanColour, type RoamTypeId } from '../roam/view.ts';
import { ROAM_GENE_MAX } from '../roam/kernel.ts';
import { defaultSoftRoamConfig, KIND_LEAF, KIND_MOUTH, KIND_SHELL, PLAN_MODES, PLAN_REST, planEntry, PULSE_IN, PULSE_ONE, PULSE_W, roamHash, SOFT_U, type SoftRoamCensus, type SoftRoamConfig, SoftRoamWorld, softRoamLight } from './kernel.ts';

export { ROAM_PLANS };

const U = SOFT_U;

// ---------------------------------------------------------------------------------------------------- starts

// ---------------------------------------------------------------------------------------------------- founder types of its own

/** Acts of a plan mode (as in Roam): keep the daughter in front, to the right, behind, to the left; or let it go there; or rest. */
const KF = 0, KR = 1, KB = 2, KL = 3, GF = 4;
const R = 15; // a mode that rests
const PL = 0, SHELL = KIND_SHELL, MOUTH = KIND_MOUTH, LEAF = KIND_LEAF;

/**
 * A plan from the modes that do something: mode -> [act, kept (or released) daughter's mode, own next mode, the daughter's kind].
 * The rest only rest. A released daughter should be plain (a leaf cannot eat, so a one-cell leaf body starves), and always starts in mode 0.
 */
export function softPlan(modes: Record<number, readonly [act: number, child: number, next: number, kind?: number]>): number[] {
  const plan = Array.from({ length: PLAN_MODES }, (_, m) => planEntry(PLAN_REST, 0, m));
  for (const [m, [act, child, next, kind]] of Object.entries(modes)) plan[Number(m)] = planEntry(act, child, next, kind ?? PL);
  return plan;
}

/**
 * Plans of Soft Roam's own, each written as the body it grows (x runs along the way the founder faces, y to its right; a cell's own front is the
 * way it was placed from its mother). Kinds are the kinds of the daughter an entry makes.
 *
 * - `grazer`, 12 cells: a row of four plain cells that eat, each with a shell above and below it. The front cell of the row lets daughters go
 *   ahead only after its own two shells are in.
 * - `leafbush`, 12 cells: a plain cross of five that eats (the middle cell builds its four arms) and leaves around it: a tip on three arms and a
 *   leaf in each corner of the cross, where their bare sides catch the light. The fourth arm builds its two corner leaves and lets daughters go
 *   from its free tip.
 * - `hunter`, 8 cells: two columns of three (the front pair are mouths, the rest plain) and two more plain cells on the right-hand column's side. The
 *   body is built one cell after the other (each builder's own work in order) and the last cell's plain parent lets daughters go; it must be at
 *   least as big as SEASONS_DEFAULTS.releaseMin (8), or a release cap would hold it for ever (a test grows every founder alone at the page defaults).
 */
export const SOFT_PLANS = {
  grazer: softPlan({
    0: [KF, 1, 4, PL], 1: [KF, 2, 4, PL], 2: [KF, 3, 4, PL],
    3: [KR, R, 9, SHELL], 9: [KL, R, 10, SHELL], 10: [GF, 0, 10, PL],
    4: [KR, R, 5, SHELL], 5: [KL, R, 6, SHELL],
  }),
  leafbush: softPlan({
    0: [KF, 1, 2, PL], 2: [KR, 1, 3, PL], 3: [KB, 1, 4, PL], 4: [KL, 8, R, PL],
    1: [KF, R, 5, LEAF], 5: [KR, R, 6, LEAF], 6: [KL, R, R, LEAF],
    8: [KR, R, 9, LEAF], 9: [KL, R, 10, LEAF], 10: [GF, 0, 10, PL],
  }),
  hunter: softPlan({
    0: [KF, 1, 2, PL], 2: [KR, 8, R, PL],
    1: [KF, R, 3, MOUTH], 3: [KR, 5, R, PL],
    5: [KL, R, 7, MOUTH], 7: [GF, 0, 7, PL],
    8: [KF, R, 9, PL], 9: [KR, R, R, PL],
  }),
} as const;

/**
 * A body of 25 cells (chunk 3): a spine of five cells along the way the founder faces, a side cell to the right and left of each, and an outer cell
 * beyond each side. The spine is built first (each spine cell keeps the next in front), then each spine cell its two sides, each side its outer cell.
 * The front spine cell lets daughters go straight ahead from a release loop, once its own sides are in; nothing is in front of it, so the release
 * place is never one of the body's own. Kinds: `side` and `outer` for the sides and outer cells, `front` for the front spine cell, `frontSide` for its
 * sides, which get outer cells only when `frontOuter`.
 */
function turtle(side: number, outer: number, front: number, frontSide: number, frontOuter: boolean): number[] {
  return softPlan({
    0: [KF, 1, 5, PL], 1: [KF, 2, 5, PL], 2: [KF, 3, 5, PL], 3: [KF, 4, 5, front],
    4: [KR, frontOuter ? 7 : R, 11, frontSide], 11: [KL, frontOuter ? 7 : R, 12, frontSide], 12: [GF, 0, 12, PL],
    5: [KR, 7, 6, side], 6: [KL, 7, R, side], 7: [KF, R, R, outer],
  });
}

/**
 * Chunk 3's founder plans of 20 or more cells (the `bodies` start):
 * - `herd`, 25 cells: a plain spine and plain sides that eat, a shell on every outer place (ten shells down the two flanks).
 * - `grove`, 21 cells: a plain spine and plain sides that eat, and a leaf beyond the sides of every other spine cell (the first, third and fifth), so
 *   each of the six leaves has three bare sides to take the light through (a full row of outer leaves would touch each other and earn a quarter).
 * - `pack`, 23 cells: three mouths across the front (the front spine cell and its two sides), plain everywhere else.
 */
export const BIG_PLANS = {
  herd: turtle(PL, SHELL, PL, PL, true),
  grove: softPlan({
    0: [KF, 1, 5, PL], 1: [KF, 2, 13, PL], 2: [KF, 3, 5, PL], 3: [KF, 4, 13, PL],
    4: [KR, 7, 11, PL], 11: [KL, 7, 12, PL], 12: [GF, 0, 12, PL],
    5: [KR, 7, 6, PL], 6: [KL, 7, R, PL], 7: [KF, R, R, LEAF],
    13: [KR, R, 14, PL], 14: [KL, R, R, PL],
  }),
  pack: turtle(PL, PL, MOUTH, MOUTH, false),
} as const;

/** Founder types of Soft Roam's own. Numbers are chase, drive, turn, adult, shape (each -512..512); a plan is written out for each, so no founder is a variant. */
export const SOFT_OWN = {
  grazer: { name: 'armoured grazers', genes: [160, 64, -256, 0, 0], colour: [236, 140, 48], plan: SOFT_PLANS.grazer },
  leafbush: { name: 'leaf bushes', genes: [64, 0, -512, 0, 0], colour: [186, 148, 104], plan: SOFT_PLANS.leafbush },
  hunter: { name: 'hunters', genes: [384, 96, -128, 0, 0], colour: [100, 92, 206], plan: SOFT_PLANS.hunter },
  herd: { name: 'armoured herds', genes: [160, 64, -256, 0, 0], colour: [196, 168, 64], plan: BIG_PLANS.herd },
  grove: { name: 'groves', genes: [64, 64, -512, 0, 0], colour: [156, 112, 168], plan: BIG_PLANS.grove },
  pack: { name: 'pack hunters', genes: [384, 96, -128, 0, 0], colour: [64, 136, 196], plan: BIG_PLANS.pack },
} as const satisfies Record<string, { name: string; genes: readonly number[]; colour: readonly number[]; plan: readonly number[] }>;
export type SoftOwnId = keyof typeof SOFT_OWN;
export type SoftTypeId = RoamTypeId | SoftOwnId;

function typeInfo(t: SoftTypeId): { name: string; genes: readonly number[]; colour: readonly number[]; plan: readonly number[] } {
  return t in SOFT_OWN ? SOFT_OWN[t as SoftOwnId] : (ROAM_TYPES[t as RoamTypeId] as unknown as { name: string; genes: readonly number[]; colour: readonly number[]; plan: readonly number[] });
}

/** The grown starts (bodies by plan) Soft Roam offers; each is a list of founder types taking turns. */
export const SOFT_STARTS = {
  /**
   * The seasons: a sun and a year, leaves, sight and fear, bodies of several kinds of cell, and a cap on releases. Three types of its own and
   * the garden's plates (a plain body that is food for the hunters and grazers' neighbours; the garden's specks never release under a release cap, so are left out).
   */
  seasons: ['grazer', 'leafbush', 'hunter', 'plate'],
  /**
   * Big bodies (chunk 3): the seasons with bodies of 23 to 25 cells that heal, hunters that steer as one body and hunt in packs, a leaf pool and a
   * winter that bites. Only the three big types.
   */
  bodies: ['herd', 'grove', 'pack'],
  /** Depth: the big bodies in a world of three levels (see the kernel's Depth paragraph and DEEP_DEFAULTS): herds founded on the floor, pack hunters in mid-water, groves at the surface. */
  deep: ['herd', 'grove', 'pack'],
  /** The default: the grown founders as in 'grown-all', with kinds, touch feeding, shells and cracking on (Roam's page line-up). */
  garden: ROAM_STARTS['grown-all'],
  'grown-all': ROAM_STARTS['grown-all'],
  'grown-lines': ROAM_STARTS['grown-lines'],
  'grown-plates': ROAM_STARTS['grown-plates'],
  'grown-crosses': ROAM_STARTS['grown-crosses'],
  'grown-blocks': ROAM_STARTS['grown-blocks'],
  'grown-specks': ROAM_STARTS['grown-specks'],
  'grown-bushes': ROAM_STARTS['grown-bushes'],
} as const satisfies Record<string, readonly SoftTypeId[]>;
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
  /** Chunk 2 switches (see the kernel): the seasons start turns them all on at SEASONS_DEFAULTS; any start takes them when given. */
  day?: number;
  year?: number;
  winter?: number;
  patchSun?: boolean;
  leaf?: number;
  sight?: number;
  fear?: number;
  truce?: boolean;
  jaws?: boolean;
  releaseMin?: number;
  releaseGap?: number;
  /** Chunk 3 switches (see the kernel): the bodies start turns them all on at BODIES_DEFAULTS; any start takes them when given. */
  heal?: boolean;
  steer?: boolean;
  pack?: number;
  crowd?: number;
  leafPool?: number;
  leafPoolMax?: number;
  patchSeason?: boolean;
  winterCost?: number;
  /** Chunk 4 switches: the bodies start turns them on at BODIES_DEFAULTS; any start takes them when given. */
  pace?: number;
  shellThrust?: number;
  /** Chunk 4, a start option (not a kernel key): each founder's drive gene is its type's times 2^u, u drawn evenly from -log2(spread) to log2(spread). 1 is none; the bodies start's default is BODIES_DRIVE_SPREAD. */
  driveSpread?: number;
  /** Depth (see the kernel): the deep start turns `depth` on at DEEP_DEFAULTS; any start takes the keys when given (`depth: false` leaves the deep start flat). 0 is a real value for the dive and the cost. */
  depth?: number;
  depthGap?: number;
  depthCost?: number;
  depthDive?: number;
  depthDim?: number;
  depthShade?: number;
  /** Inner pulse (see the kernel): `pulse: true` turns it on for any start; the three numbers only reach a world that has it. */
  pulse?: boolean;
  pulseThrust?: number;
  pulseFlex?: number;
  pulseMut?: number;
  /** Inner pulse, a start option (not a kernel key): each founder's network is drawn on the seed and its number, every weight a whole number from -spread to spread (the weight that sets full thrust has PULSE_ONE added). 0: every founder has the still network. Default PULSE_SPREAD. */
  pulseSpread?: number;
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
 * What the seasons start adds to the garden's: a day of 400 steps (a lit band half the world wide sweeps round once), a year of 12000 (light swings to
 * 0.1 of midsummer's in winter), scheduled patches that land only in the light, leaves that earn 1.3 a step in full light through bare sides, mouths that see 8 tiles
 * and plain or shell cells that see hunters 4 tiles off, no feeding on or hitting one's own founder family, no feeding on a body that holds a mouth, and bodies that
 * release only from 8 cells and once in 200 steps (tuned by looking: see SEASONS_ECONOMY for the economy that goes with them).
 */
export const SEASONS_DEFAULTS = { day: 400, year: 12000, winter: 0.1, patchSun: true, leaf: 1.3, sight: 8, fear: 4, truce: true, jaws: true, releaseMin: 8, releaseGap: 200 } as const;
/**
 * The seasons start's own economy, under the page world (the garden keeps PAGE_WORLD and GARDEN_DEFAULTS untouched). Chosen by looking at three-year runs on
 * seeds 1 and 2 (runs/softroam/c2-combined, setting E): cheaper, leakier cells (so there are more of them and winter starves them within a year), small frequent
 * food patches (a patch lands only in the light, so the store fills in winter and drains in summer and the year shows in the numbers), shells that take 10000 hits
 * to crack (at 300 they all wear away within five years). Without these the year does not show: cells settle and the store sits at 2 to 5 thousand.
 */
export const SEASONS_ECONOMY = { birthStore: 60, minStore: 15, patchFood: 1000, patchEvery: 12, leakSide: 0.008, leakCell: 0.004, crack: 10000 } as const;
const SEASON_KEYS = ['day', 'year', 'winter', 'patchSun', 'leaf', 'sight', 'fear', 'truce', 'jaws', 'releaseMin', 'releaseGap'] as const;
/**
 * What the bodies start adds to the seasons' (chunk 3, tuned by looking: see NOTE-3.md): bodies held together by braces, one aim per body, three mouths in
 * touch opening a body of up to 18, a seeing mouth that keeps off prey another hunter is at, a third of upkeep set aside for leaves, patches that shrink in
 * winter and a winter upkeep; and over the seasons' values softer shells (2000 hits to crack) and patches that land whatever the hour (with them gated by the
 * day band too, the reservoir holds a third of the matter idle and the world starves; the year's swing comes from the winter upkeep instead).
 */
export const BODIES_DEFAULTS = { heal: true, steer: true, pack: 6, crowd: 1, leafPool: 0.3, leafPoolMax: 2000, patchSeason: true, winterCost: 0.03, pace: 0.25, shellThrust: 0.5 } as const;
/** Chunk 4: the bodies start's founders have drives from half to twice their type's (see `driveSpread`). */
export const BODIES_DRIVE_SPREAD = 2;
export const BODIES_OVER_SEASONS = { releaseMin: 8, crack: 2000, patchSun: false } as const;
/** The bodies start's economy over the seasons': cells wear out more slowly (a 25-cell body at the page's life of 8000 loses a cell every 320 steps). */
export const BODIES_ECONOMY = { life: 20000 } as const;
/** What the deep start adds to the bodies': three levels; the other depth numbers are the kernel's defaults (first look on seeds 1 and 2, runs/softroam/depth). */
export const DEEP_DEFAULTS = { depth: 3 } as const;
/** Inner pulse: how far a founder's weights are drawn from 0 unless the caller says (about a third of such networks beat on their own, see NOTE-5). */
export const PULSE_SPREAD = 64;
const PULSE_KEYS = ['pulseThrust', 'pulseFlex', 'pulseMut'] as const;
const DEPTH_KEYS = ['depth', 'depthGap', 'depthCost', 'depthDive', 'depthDim', 'depthShade'] as const;
/** Where a founder of each big type starts and what lift it carries, as a share of the way from the floor (0) to the surface (1); any other type starts on the floor. */
export const DEEP_HOME: Partial<Record<SoftTypeId, number>> = { herd: 0, pack: 0.5, grove: 1 };
const BODY_KEYS = ['heal', 'steer', 'pack', 'crowd', 'leafPool', 'leafPoolMax', 'patchSeason', 'winterCost', 'pace', 'shellThrust'] as const;

/**
 * The page's usual world, over the kernel's neutral defaults (which the kernel tests rely on): chosen by looking at 12000-step
 * runs on seeds 1 and 2. Weak pull toward food (`scentGain` 1 where Roam's formula uses 8, so a chase gene is worth roughly a tenth of a
 * drive gene of the same size here, about 0.9 of one by Roam's formula) so bodies cross open water, cheap moving, long lives and low upkeep so bodies hold
 * together, fat cells that divide less often, plan copy errors of 0.01 (not Roam's 2.5 times the gene rate), a faint haze of spread food,
 * and a smaller closed store of matter.
 */
export const PAGE_WORLD = { matter: 100_000, bite: 4, birthStore: 150, minStore: 30, leakSide: 0.002, leakCell: 0.001, moveCost: 0.01, life: 8000, scentGain: 1, planMut: 0.01, foodSpread: 0.05 } as const satisfies Partial<SoftRoamConfig>;

export function softRoamConfig(input: SoftRoamOptions): SoftRoamConfig {
  const startName = input.start ?? 'seasons';
  const deep = startName === 'deep';
  const bodies = startName === 'bodies' || deep;
  const seasons = startName === 'seasons' || bodies;
  const garden = startName === 'garden' || seasons;
  // The seasons start fills in what the caller left out, but only what its prerequisites allow (the kernel refuses a sight or a leaf without kinds, a year without a day):
  // a start with kinds or touch feeding off, or no day, is a world with those left out. A key the caller gives itself is kept, and refused if it cannot work.
  // An override wins over the option (it is applied last), so the prerequisites are read through it: `--ov '{"kinds":false}'` is a world with kinds off.
  const ov = input.overrides ?? {};
  const kindsOn = (ov.kinds !== undefined ? ov.kinds : input.kinds ?? GARDEN_DEFAULTS.kinds) === true;
  const drainOn = (ov.drain ?? input.drain ?? GARDEN_DEFAULTS.drain) > 0;
  const on = (v: unknown): boolean => v === undefined || (typeof v === 'number' && v > 0);
  const dayOn = on(ov.day ?? input.day);
  const yearOn = on(ov.year ?? input.year);
  // The implicit year is added only when it can hold the day (the kernel refuses a year shorter than a day); without it there is no implicit winter either.
  const dayVal = ov.day ?? input.day;
  const yearFits = typeof dayVal !== 'number' || dayVal <= SEASONS_DEFAULTS.year;
  const yearGiven = (ov.year ?? input.year) !== undefined;
  const needs: Partial<Record<(typeof SEASON_KEYS)[number], boolean>> = { sight: kindsOn && drainOn, fear: kindsOn && drainOn, leaf: kindsOn && dayOn, year: dayOn && yearFits, patchSun: dayOn, winter: dayOn && yearOn && (yearGiven || yearFits) };
  const seasonDef = (k: (typeof SEASON_KEYS)[number]) => (bodies && k in BODIES_OVER_SEASONS ? BODIES_OVER_SEASONS[k as keyof typeof BODIES_OVER_SEASONS] : SEASONS_DEFAULTS[k]);
  const o: SoftRoamOptions = garden
    ? { ...input, ...(seasons ? Object.fromEntries(SEASON_KEYS.map((k) => [k, input[k] ?? (needs[k] === false ? undefined : seasonDef(k))])) : {}), kinds: input.kinds ?? GARDEN_DEFAULTS.kinds, drain: input.drain ?? GARDEN_DEFAULTS.drain, seal: input.seal ?? GARDEN_DEFAULTS.seal, crack: input.crack ?? (bodies ? BODIES_OVER_SEASONS.crack : seasons ? SEASONS_ECONOMY.crack : GARDEN_DEFAULTS.crack), shellBite: input.shellBite ?? GARDEN_DEFAULTS.shellBite, shellLeak: input.shellLeak ?? GARDEN_DEFAULTS.shellLeak, grip: input.grip ?? GARDEN_DEFAULTS.grip }
    : input;
  if (bodies) {
    // The bodies start fills its own keys too, again only where what they need is on (as read through the overrides and the seasons' keys just filled).
    const pick = <T,>(k: keyof SoftRoamConfig, v: T | undefined): T | undefined => (ov[k] !== undefined ? (ov[k] as T) : v);
    const sightOn = on(pick('sight', o.sight));
    const fearOn = on(pick('fear', o.fear));
    // The year as it will reach the kernel (the seasons' implicit year may have been left out because it could not hold the day).
    const yearSet = pick('year', o.year) !== undefined && on(pick('year', o.year));
    const leafOn = pick('leaf', o.leaf) !== undefined && (pick('leaf', o.leaf) as unknown) !== false && kindsOn && dayOn;
    const bodyNeeds: Record<(typeof BODY_KEYS)[number], boolean> = { heal: true, steer: (sightOn && o.sight !== undefined) || (fearOn && o.fear !== undefined), pack: kindsOn && drainOn, crowd: sightOn && o.sight !== undefined, leafPool: leafOn, leafPoolMax: leafOn && o.leafPool !== (false as unknown as number), patchSeason: dayOn && yearSet, winterCost: dayOn && yearSet, pace: true, shellThrust: kindsOn };
    for (const k of BODY_KEYS) if (o[k] === undefined && bodyNeeds[k]) (o as unknown as Record<string, unknown>)[k] = BODIES_DEFAULTS[k];
  }
  const { crack: _crack, ...economy } = SEASONS_ECONOMY;
  const cfg: SoftRoamConfig = { ...defaultSoftRoamConfig(), ...PAGE_WORLD, ...(seasons ? economy : {}), ...(bodies ? BODIES_ECONOMY : {}) };
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
  // Chunk 2 keys: an option given sets the key (false and undefined leave it absent, so a start without them keeps the old path); an override wins over it.
  for (const k of [...SEASON_KEYS, ...BODY_KEYS]) {
    const v = o[k];
    if (v !== undefined && v !== false && (merged as unknown as Record<string, unknown>)[k] === undefined) (merged as unknown as Record<string, unknown>)[k] = v;
  }
  // Depth keys: the deep start's levels unless the caller gave its own (false: none); the other keys only reach a world that has levels.
  const mk = merged as unknown as Record<string, unknown>;
  const depthOpt = o.depth ?? (deep ? DEEP_DEFAULTS.depth : undefined);
  if (mk.depth === undefined && depthOpt !== undefined && (depthOpt as unknown) !== false) mk.depth = depthOpt;
  if (mk.depth !== undefined) for (const k of DEPTH_KEYS) if (k !== 'depth' && o[k] !== undefined && mk[k] === undefined) mk[k] = o[k];
  // Inner pulse: on only when asked for; its numbers only reach a world that has it.
  if (mk.pulse === undefined && o.pulse === true) mk.pulse = true;
  if (mk.pulse === true) for (const k of PULSE_KEYS) if (o[k] !== undefined && mk[k] === undefined) mk[k] = o[k];
  if (o.overrides?.planMut === undefined) merged.planMut = o.planMut ?? (o.mut === undefined ? cfg.planMut : Math.min(1, 2.5 * merged.mut));
  // The first patches may use at most half the matter, so the founders can always be paid for.
  if (merged.patchFood > 0) merged.startPatches = Math.min(merged.startPatches, Math.floor(merged.matter / (2 * merged.patchFood)));
  // ... and a tiny arena keeps enough in the store to pay for at least one founder (about 3 times the matter to divide).
  if (merged.patchFood > 0) merged.startPatches = Math.min(merged.startPatches, Math.floor(Math.max(0, merged.matter - 3 * merged.birthStore) / merged.patchFood));
  return merged;
}

/** A founder's network: every weight a whole number from -spread to spread, drawn on the seed and the founder's number; the weight from the constant input to go has PULSE_ONE added (held to 127), so a network that does nothing else thrusts in full. */
export function softPulseDraw(seed: number, founder: number, spread: number): number[] {
  const w: number[] = [];
  for (let i = 0; i < PULSE_W; i++) w.push((roamHash(seed, 0, founder, 300 + i) % (2 * spread + 1)) - spread);
  w[2 * PULSE_IN] = Math.min(127, w[2 * PULSE_IN] + PULSE_ONE);
  return w;
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
  const start = o.start ?? 'seasons';
  if (!(start in SOFT_STARTS)) throw new Error(`Unknown start: ${start}`);
  const world = new SoftRoamWorld(softRoamConfig({ ...o, start }));
  const types: readonly SoftTypeId[] = SOFT_STARTS[start];
  // A plan of Soft Roam's own keeps its kinds only where the world allows them: no kinds, all plain; no leaf, a leaf is plain.
  const planOf = (t: SoftTypeId): readonly number[] => {
    const plan = typeInfo(t).plan;
    if (!(t in SOFT_OWN)) return plan;
    return plan.map((e) => {
      const kind = (e >>> 12) & 3;
      return !world.cfg.kinds || (kind === KIND_LEAF && world.cfg.leaf === undefined) ? e & 0xfff : e;
    });
  };
  const planIds = types.map((t) => world.addPlan(planOf(t)));
  const hunterIds = types.map((t, j) => {
    const plan = planOf(t);
    if (t in SOFT_OWN) return planIds[j];
    if (!world.cfg.kinds || (plan[0] & 15) >= PLAN_REST) return planIds[j];
    if ((plan[0] & 15) >= 4) return world.addPlan(plan.map((e) => ((e & 15) >= 4 && (e & 15) < PLAN_REST ? e | KIND_SHELL_BITS : e)), planIds[j]);
    return world.addPlan(plan.map((e, m) => (m === 0 ? e | KIND_MOUTH_BITS : e)), planIds[j]);
  });
  const founders = o.founders ?? Math.max(types.length, Math.round((120 * world.n) / (128 * 128)));
  const spread = o.driveSpread ?? (start === 'bodies' || start === 'deep' ? BODIES_DRIVE_SPREAD : 1);
  if (!(typeof spread === 'number' && spread >= 1 && spread <= 8)) throw new Error(`Invalid driveSpread: ${spread} (1 to 8)`);
  if (!Number.isSafeInteger(founders) || founders < 1) throw new Error(`Invalid founders: ${founders}`);
  const levels = world.cfg.depth ?? 0;
  const pulseSpread = o.pulseSpread ?? PULSE_SPREAD;
  if (!(Number.isInteger(pulseSpread) && pulseSpread >= 0 && pulseSpread <= 127)) throw new Error(`Invalid pulseSpread: ${pulseSpread} (a whole number, 0 to 127)`);
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
    let genes = typeInfo(type).genes;
    if (spread !== 1) {
      // A drive drawn on the seed and the founder's number: the type's times 2^u, u even in [-log2 spread, log2 spread], a whole gene within the gene's range.
      const u = ((roamHash(world.cfg.seed, 0, placed, 43) % 2049) / 1024 - 1) * Math.log2(spread);
      const d = Math.max(-ROAM_GENE_MAX, Math.min(ROAM_GENE_MAX, Math.round(genes[1] * 2 ** u)));
      genes = genes.map((g, k) => (k === 1 ? d : g));
    }
    const cell = world.found(px, py, genes, softFamily(type), undefined, plan);
    if (cell >= 0) {
      // With levels: the type's own level and the lift that keeps its line there.
      if (levels > 0) world.setLevel(cell, Math.round((DEEP_HOME[type] ?? 0) * (levels - 1)));
      // With the pulse: a network of its own, drawn on the seed and the founder's number.
      if (world.cfg.pulse === true && pulseSpread > 0) world.setPulse(cell, softPulseDraw(world.cfg.seed, placed, pulseSpread));
      placed++;
      placedAt.push(px, py);
    }
  }
  if (o.founders !== undefined && placed < founders) throw new Error(`Only ${placed} of the ${founders} founders asked for could be placed (${world.reservoir} matter left, a founder needs ${cost}; the arena or the cell limit is too small)`);
  if (placed === 0) throw new Error(`No founder could be placed: ${world.reservoir} matter left after the first patches, a founder needs ${cost}`);
  return world;
}

// ---------------------------------------------------------------------------------------------------- the picture

/** `garden` is the picture; with depth it is slanted (a level is drawn DEEP_SLANT tiles up the screen per level, the ground stays put). `top` is the garden straight down. `plain` is for checking. */
export type SoftPaint = 'garden' | 'plain' | 'top';

/** Founder family numbers 1 to 11 in the order of Roam's types, with the colours Roam gives them; 12 to 17 are Soft Roam's own types. */
const FAMILY_ORDER: readonly SoftTypeId[] = ['chaser', 'wanderer', 'sitter', 'single', 'big', 'line', 'plate', 'cross', 'block', 'speck', 'bush', 'grazer', 'leafbush', 'hunter', 'herd', 'grove', 'pack'];
const FAM_COLOUR: readonly (readonly number[])[] = FAMILY_ORDER.map((t) => typeInfo(t).colour);
/** Family number of a founder type, which every descendant keeps (the garden's types keep Roam's numbers). */
export const softFamily = (t: SoftTypeId): number => FAMILY_ORDER.indexOf(t) + 1;

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
const TONE_KNEE = 0.25; // food per tile at which the haze tone is about a third of the way up
const TONE_TOP = 240; // food per tile that shows as the full haze
const TONE_NORM = Math.log1p(TONE_TOP / TONE_KNEE);
/** How bright the haze of a tile with this much food shows, 0..1: a log curve, so thin spread food reads and a fresh patch does not blow out. */
export function foodTone(food: number): number {
  return Math.min(1, Math.log1p(Math.max(0, food) / TONE_KNEE) / TONE_NORM);
}
const GLOW_R = 1.9;

interface Ghost { x: number; y: number; kind: number; step: number; compost: boolean; lv: number }
interface Ring { x: number; y: number; step: number; lv: number }
/** A thread from a feeding mouth to the cell it fed on, by serial numbers (slots only to find them again quickly). */
interface Thread { mc: number; pc: number; ms: number; ps: number; lvl: number; prv: number; seen: boolean }

/** Per-cell eased levels the picture is drawn from (kept by serial number): hit flash, feeding, being fed on, shell damage, how shell-like, how mouth-like, how leaf-like, the light it is in. */
const NLV = 7;
/** LV_GRAZE (chunk 4): the cell took food from the ground in the last step. */
const LV_HIT = 0, LV_FEED = 1, LV_PREY = 2, LV_DMG = 3, LV_SHELL = 4, LV_MOUTH = 5, LV_GRAZE = 6;
/** Steps for a level to ease 63% of the way up, and down. */
const LV_UP = [0.8, 1.5, 1.5, 3, 3, 3, 1.5];
const LV_DOWN = [4, 6, 6, 3, 3, 3, 5];
/** Grazing motes: pale like the food haze they come out of. Attack beads and bite marks: warm. */
const SIP = [0.72, 0.9, 1] as const;
const BITE = [1, 0.42, 0.22] as const;
/** Two more levels kept apart (stride NLX): how leaf-like a cell is, and the light it stands in; the light moves slowly, so a day sweeping over a leaf is a gradual brightening. */
const NLX = 4;
// LX_DEEP: with depth, how high the cell's body is (0 the floor, 1 the surface), eased so a body rises and sinks over some steps.
// LX_PULSE: with the inner pulse, the cell's signal A (-1 to 1), eased a little so a wave along a body reads as moving light.
const LX_LEAF = 0, LX_LIT = 1, LX_DEEP = 2, LX_PULSE = 3;
const LX_UP = [3, 12, 7, 1.2];
const LX_DOWN = [3, 12, 7, 1.2];
/** Leaf income (matter a step in full light) at which a leaf shows its fullest glow; less shows proportionally less. */
const LEAF_GLOW = 1;
const RING_STEPS = 14;
const RING_KEEP = 16;
const BONE = [0.95, 0.91, 0.76] as const;

const smooth = (a: number, b: number, v: number): number => {
  const t = v <= a ? 0 : v >= b ? 1 : (v - a) / (b - a);
  return t * t * (3 - 2 * t);
};

/**
 * How far the year has brought the light up from winter at `step`, 0 (deepest winter) to 1 (midsummer); 1 for a world with no year. The same
 * triangle wave as the kernel's own (`softRoamLight`), taken without the day.
 */
export function softSeason(cfg: Pick<SoftRoamConfig, 'year'>, step: number): number {
  if (cfg.year === undefined) return 1;
  const p = Math.floor(((step % cfg.year) * 1024) / cfg.year);
  return (p < 512 ? p >> 1 : (1024 - p) >> 1) / 256;
}

/** The year's light as a share of midsummer's, 0 to 1 (winter to 1): `winter` at the bottom of the year. */
export function softYearLight(cfg: Pick<SoftRoamConfig, 'year' | 'winter'>, step: number): number {
  if (cfg.year === undefined) return 1;
  const w = Math.round((cfg.winter ?? 0.25) * 256);
  return (w + (((256 - w) * Math.round(softSeason(cfg, step) * 256)) >> 8)) / 256;
}

/**
 * What the sky is doing at the world's step, for the readouts: the mean light over the world (0 to 1), the year's light as a share of
 * midsummer's (1 with no year), and how far through the year it is (0 to 1; 0 with no year).
 */
export function softSky(world: SoftRoamWorld): { meanLight: number; yearLight: number; yearShare: number; dayShare: number } {
  const cfg = world.cfg;
  if (cfg.day === undefined) return { meanLight: 1, yearLight: 1, yearShare: 0, dayShare: 0 };
  let sum = 0;
  for (let tx = 0; tx < world.size; tx++) sum += softRoamLight(cfg, tx, 0, world.step);
  return {
    meanLight: sum / (256 * world.size),
    yearLight: softYearLight(cfg, world.step),
    yearShare: cfg.year === undefined ? 0 : (world.step % cfg.year) / cfg.year,
    dayShare: (world.step % cfg.day) / cfg.day,
  };
}

const num = (x: number): string => Math.round(x).toLocaleString('en-US');
const SEASON_NAMES = ['winter', 'spring', 'summer', 'autumn'];
const PHASE_WORDS = ['early', 'mid', 'late'];

/** The time in plain words: how far through the year, the season, and where the lit band is. */
export function softTimeWords(f: { step: number; sky: { day: number; year: number; dayShare: number; yearShare: number; meanLight?: number } }): string {
  const { day, year, dayShare, yearShare } = f.sky;
  if (day === 0) return 'no sun: the light is full everywhere, always';
  const centre = (dayShare + 0.5) % 1;
  const where = centre < 0.17 || centre >= 0.83 ? (centre < 0.5 ? 'left edge' : 'right edge') : centre < 0.38 ? 'left side' : centre < 0.62 ? 'middle' : 'right side';
  // With no light anywhere (a winter of 0 at the bottom of the year) there is no band to place.
  const band = f.sky.meanLight === 0 ? 'it is dark everywhere' : `the lit band is over the ${where} of the arena`;
  if (year === 0) return `day ${num(Math.floor(f.step / day) + 1)} (no seasons); ${band}`;
  const q = ((yearShare + 0.125) % 1) * 4;
  const season = `${PHASE_WORDS[Math.min(2, Math.floor((q % 1) * 3))]} ${SEASON_NAMES[Math.floor(q)]}`;
  // Days follow the sky's own clock, which runs on over the turn of the year (it does not restart there): when a year is not a whole
  // number of days, the day in progress at the turn is day 1 of the new year, and the count of days a year touches varies by one.
  const y0 = f.step - (f.step % year);
  const days = Math.floor(f.step / day) - Math.floor(y0 / day) + 1;
  const total = Math.floor((y0 + year - 1) / day) - Math.floor(y0 / day) + 1;
  const short = year % day === 0 ? '' : ', days running on over the turn of the year';
  return `${season}, day ${num(days)} of the year's ${num(total)}${short} (year ${num(Math.floor(f.step / year) + 1)}); ${band}`;
}

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
  lxCur = new Float32Array(0);
  lxPrv = new Float32Array(0);
  lvCid = new Uint32Array(0);
  feedT = new Uint8Array(0);
  hitT = new Uint8Array(0);
  /**
   * With depth. `layers`: per pixel and level, a record as `field` (strongest, second strongest, colour, shell share, damage) of the bodies drawn on that level, zero between frames.
   * `lvl`: per pixel, while stamping the levels that hold something there (bit k for level k); after the compose, the level plus one of the body that shows there (0: the ground).
   * `drawLv`: per slot, the level the cell's body is drawn on this frame. `shade`: per tile and level under the surface, the shadow of what is above.
   */
  layers = new Float32Array(0);
  lvl = new Uint8Array(0);
  drawLv = new Uint8Array(0);
  shade = new Float32Array(0);
  preyT = new Uint8Array(0);
  /** With depth: how many tiles up the screen one level is drawn in the frame being painted (0 straight down). */
  slant = 0;
  seenStep = -1;
  /** The sky: per tile column the day's light (0..1, the band) at the step before the last and at the last, the year's light (0..1) at each, and per pixel block of the frame what it does to the ground. */
  dayA = new Float32Array(0);
  dayB = new Float32Array(0);
  seaA = 1;
  seaB = 1;
  skyStep = -1;
  mulR = new Float32Array(0);
  mulG = new Float32Array(0);
  mulB = new Float32Array(0);
  addR = new Float32Array(0);
  addG = new Float32Array(0);
  addB = new Float32Array(0);
  private sized = false;

  /**
   * The ground's light for a frame at `alpha` between the last two steps, one entry per pixel block column (even pixel columns): what to
   * multiply the haze by and add to it. The band's light is taken per tile column at the two steps and eased between them, and across
   * columns it follows the same interpolation as the haze, so no column edge shows. Only for a world with a day.
   */
  prepareSky(world: SoftRoamWorld, alpha: number): void {
    const cfg = world.cfg;
    const s = world.size;
    if (this.dayA.length !== s) { this.dayA = new Float32Array(s); this.dayB = new Float32Array(s); this.skyStep = -1; }
    if (this.mulR.length !== this.side) {
      this.mulR = new Float32Array(this.side); this.mulG = new Float32Array(this.side); this.mulB = new Float32Array(this.side);
      this.addR = new Float32Array(this.side); this.addG = new Float32Array(this.side); this.addB = new Float32Array(this.side);
    }
    if (this.skyStep !== world.step) {
      const dayOnly = { size: cfg.size, day: cfg.day };
      const before = Math.max(0, world.step - 1);
      for (let tx = 0; tx < s; tx++) {
        this.dayA[tx] = softRoamLight(dayOnly, tx, 0, before) / 256;
        this.dayB[tx] = softRoamLight(dayOnly, tx, 0, world.step) / 256;
      }
      // The year's light as the kernel has it, floor included (`winter`), so a winter of 0 is dark and a winter of 1 looks like midsummer.
      this.seaA = softYearLight(cfg, before);
      this.seaB = softYearLight(cfg, world.step);
      this.skyStep = world.step;
    }
    const sv = this.seaA + (this.seaB - this.seaA) * alpha;
    const { x0, x1, wx } = this;
    for (let ix = 0; ix < this.side; ix += 2) {
      const a = x0[ix], b = x1[ix], w = wx[ix];
      const d = (this.dayA[a] + (this.dayA[b] - this.dayA[a]) * w) * (1 - alpha) + (this.dayB[a] + (this.dayB[b] - this.dayB[a]) * w) * alpha;
      const warm = d * sv;
      const cool = 0.6 * (1 - d) + 0.4 * (1 - sv);
      // The band's contrast follows the light it really has (a dark winter has no bright band), eased by a square root so a faint winter still reads.
      const B = (0.34 + 0.66 * d * Math.sqrt(sv)) * (0.78 + 0.22 * sv);
      this.mulR[ix] = B * (1 + 0.3 * warm - 0.12 * cool);
      this.mulG[ix] = B * (1 + 0.06 * warm);
      this.mulB[ix] = B * (1 - 0.18 * warm + 0.1 * cool);
      this.addR[ix] = 0.15 * warm;
      this.addG[ix] = 0.12 * warm + 0.004 * cool;
      this.addB[ix] = 0.05 * warm + 0.014 * cool;
    }
  }

  /** Note what the last step did: ease the food haze, keep the deaths as ghosts. Does nothing twice for one step. */
  observe(world: SoftRoamWorld): void {
    this.ensureWorld(world);
    if (world.step === this.seenStep) return;
    if (world.step < this.seenStep || this.seenStep < 0) {
      // A new world, or the first look: show the food as it is, no bloom.
      for (let i = 0; i < world.n; i++) this.foodShown[i] = this.foodPrev[i] = foodTone(world.food[i]);
      this.ghosts.length = 0;
      this.rings.length = 0;
    } else {
      const dt = Math.min(60, world.step - this.seenStep);
      const k = 1 - Math.exp(-dt / FOOD_TAU);
      for (let i = 0; i < world.n; i++) {
        const v = this.foodShown[i];
        this.foodPrev[i] = v;
        this.foodShown[i] = v + (foodTone(world.food[i]) - v) * k;
      }
    }
    // The deaths of the step just done are still in the world's events, even at a first look.
    if (world.step > 0) for (const d of world.events.deaths) this.ghosts.push({ x: d.x / U, y: d.y / U, kind: d.kind, step: world.step, compost: world.cfg.compost === true, lv: d.lv });
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
    if (world.step > 0) for (const e of world.events.cracks) this.rings.push({ x: e.x / U, y: e.y / U, step: world.step, lv: e.lv ?? 0 });
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
    const tgt = [0, 0, 0, 0, 0, 0, 0];
    const tx2 = [0, 0, 0, 0];
    const pulse = world.cfg.pulse === true;
    const levels = world.cfg.depth ?? 0;
    const sunny = world.cfg.day !== undefined && world.cfg.leaf !== undefined;
    const born: number[] = [];
    for (let c = 0; c < world.cap; c++) {
      if (!world.alive[c]) continue;
      const o = c * NLV;
      let fresh = snap;
      if (this.lvCid[c] !== world.cid[c]) { this.lvCid[c] = world.cid[c]; fresh = true; if (!snap && levels > 0 && world.mother[c] >= 0) born.push(c); }
      const kind = world.kind[c];
      tgt[LV_HIT] = this.hitT[c];
      tgt[LV_FEED] = this.feedT[c];
      tgt[LV_PREY] = this.preyT[c] === 1 && this.feedT[c] === 0 ? 1 : 0;
      tgt[LV_DMG] = kind === KIND_SHELL && crack > 0 ? Math.min(1, world.hits[c] / Math.min(60000, crack << world.tough[c])) : 0;
      tgt[LV_SHELL] = kind === KIND_SHELL ? 1 : 0;
      tgt[LV_MOUTH] = kind === KIND_MOUTH ? 1 : 0;
      tgt[LV_GRAZE] = world.step > 0 && world.ateFromGround(c) > 0 ? 1 : 0;
      tx2[0] = kind === KIND_LEAF ? 1 : 0;
      // How lit a leaf looks is what the kernel actually paid it this step (LEAF_GLOW or more shows full; 0 shows none), so a leaf in light on an empty reservoir stays dark.
      tx2[1] = sunny && kind === KIND_LEAF ? Math.min(1, world.leafPaid[c] / LEAF_GLOW) : 0;
      tx2[2] = levels > 0 ? world.level[c] / (levels - 1) : 0;
      tx2[3] = pulse ? world.sigA[c] / 127 : 0;
      for (let j = 0; j < NLX; j++) {
        const q = c * NLX + j;
        const cur = fresh ? tx2[j] : this.lxCur[q];
        this.lxPrv[q] = cur;
        const k = 1 - Math.exp(-dt / (tx2[j] > cur ? LX_UP[j] : LX_DOWN[j]));
        this.lxCur[q] = fresh ? tx2[j] : cur + (tx2[j] - cur) * k;
      }
      for (let j = 0; j < NLV; j++) {
        const cur = fresh ? tgt[j] : this.lvCur[o + j];
        this.lvPrv[o + j] = cur;
        const k = 1 - Math.exp(-dt / (tgt[j] > cur ? LV_UP[j] : LV_DOWN[j]));
        this.lvCur[o + j] = fresh ? tgt[j] : cur + (tgt[j] - cur) * k;
      }
    }
    // A daughter born while her mother is rising or sinking starts at her mother's drawn height, not at the level itself (she would jump).
    for (const c of born) {
      const m = world.mother[c];
      if (!world.alive[m] || this.lvCid[m] !== world.cid[m]) continue;
      this.lxCur[c * NLX + LX_DEEP] = this.lxCur[m * NLX + LX_DEEP];
      this.lxPrv[c * NLX + LX_DEEP] = this.lxPrv[m * NLX + LX_DEEP];
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
      this.lxCur = new Float32Array(world.cap * NLX);
      this.lxPrv = new Float32Array(world.cap * NLX);
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
  // With depth the garden is slanted: a cell is drawn up the screen by its drawn height (the ground and the plain picture stay put).
  const levels = world.cfg.depth ?? 0;
  mem.slant = paint === 'garden' && levels > 0 ? DEEP_SLANT : 0;
  if (mem.slant > 0) for (const c of cells) mem.py[c] = wrapTo(mem.py[c] - mem.slant * levelX(mem, c, LX_DEEP, alpha) * (levels - 1), s);
  if (paint === 'plain') paintPlain(world, scale, alpha, out, mem, cells);
  else paintGarden(world, scale, alpha, out, mem, cells);
}
/** A cell's eased extra level `j` (leaf-likeness, light) at `alpha` between the last two steps. */
function levelX(mem: SoftPaintMemory, c: number, j: number, alpha: number): number {
  const o = c * NLX + j;
  return mem.lxPrv[o] + (mem.lxCur[o] - mem.lxPrv[o]) * alpha;
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
 * are hit, white for a moment when hit), mouths a dusky rose (warm red and bright while feeding), a cell being fed on dimmer. The mix of
 * shell, mouth and plain follows the eased kind levels, so a cell that cracks changes over a few steps.
 */
function cellTint(world: SoftRoamWorld, c: number, full: number, rgb: Float32Array | number[], mem: SoftPaintMemory, alpha: number): number {
  const f = famColour(world.fam[c]);
  const p = roamPlanColour(world.pid[c]);
  // Mostly the family's colour, a little of the plan's own, and a trace of the garden's biomass green.
  PLAIN[0] = 0.12 * 0.2 + 0.58 * (f[0] / 255) + 0.3 * (p[0] / 255);
  PLAIN[1] = 0.12 * 0.85 + 0.58 * (f[1] / 255) + 0.3 * (p[1] / 255);
  PLAIN[2] = 0.12 * 0.35 + 0.58 * (f[2] / 255) + 0.3 * (p[2] / 255);
  let sh = level(mem, c, LV_SHELL, alpha), mo = level(mem, c, LV_MOUTH, alpha), lf = levelX(mem, c, LX_LEAF, alpha);
  const both = sh + mo + lf;
  if (both > 1) { sh /= both; mo /= both; lf /= both; }
  const pl = 1 - sh - mo - lf;
  const dmg = level(mem, c, LV_DMG, alpha), feed = level(mem, c, LV_FEED, alpha) * pulseOf(world, c, alpha), prey = level(mem, c, LV_PREY, alpha), hit = level(mem, c, LV_HIT, alpha);
  const dk = 1 - 0.6 * dmg;
  // Shell: pale bone, darker and browner with damage. Mouth: a dusky rose at rest (chunk 4: so red means feeding, not just "a mouth"),
  // turning to a bright warm red, pulsing, while it feeds.
  const sr = 0.84 * dk, sg = 0.82 * (dk - 0.04 * dmg), sb = 0.7 * (dk - 0.1 * dmg);
  const f0 = level(mem, c, LV_FEED, alpha);
  const mr = 0.74 + 0.26 * f0, mg = 0.44 - 0.2 * f0 + 0.2 * feed, mb = 0.46 - 0.28 * f0 + 0.04 * feed;
  // Leaf: green; the light it stands in (eased over many steps) brightens it and warms it toward yellow-green, so a day sweeping over a bush is a slow glow, never a flash.
  const ll = levelX(mem, c, LX_LIT, alpha);
  rgb[0] = pl * PLAIN[0] + sh * sr + mo * mr + lf * (0.16 + 0.22 * ll);
  rgb[1] = pl * PLAIN[1] + sh * sg + mo * mg + lf * (0.78 + 0.2 * ll);
  rgb[2] = pl * PLAIN[2] + sh * sb + mo * mb + lf * (0.2 - 0.04 * ll);
  let lit = pl * (0.5 + 0.5 * Math.min(1, world.store[c] / full)) + sh * 0.85 + mo * (0.8 + 0.6 * feed) + lf * (0.45 + 0.75 * ll);
  lit *= 1 - 0.5 * prey;
  // Inner pulse: the cell's signal shows as light, brighter above 0 and dimmer below, so a wave passing along a body can be seen.
  if (world.cfg.pulse === true) lit *= 1 + PULSE_LIGHT * levelX(mem, c, LX_PULSE, alpha);
  if (hit > 0) {
    const fl = hit * (1 - 0.5 * dmg);
    rgb[0] += (1 - rgb[0]) * 0.3 * fl; rgb[1] += (1 - rgb[1]) * 0.3 * fl; rgb[2] += (1 - rgb[2]) * 0.28 * fl;
    lit *= 1 + 0.15 * fl;
  }
  return lit;
}

/** Inner pulse: how much brighter or dimmer a cell is at the ends of its signal. */
const PULSE_LIGHT = 0.3;
const tintBuf = new Float32Array(3);
/** With depth: a floor body's cells are this share of a surface body's in size and in brightness. */
const DEEP_SIZE = 0.78, DEEP_DIM = 0.66;
const DEEP_SHADOW = 0.6;
/** The slanted garden: tiles up the screen per level. Everything of level k (bodies, marks, the shadows that fall on it) is drawn k times this above its true place. */
export const DEEP_SLANT = 1.5;
/** Slanted: what the bare floor gets on top of the haze, and how much of the ground's light a full shadow takes. */
const DEEP_FLOOR = [0.034, 0.04, 0.05];
const DEEP_FLOOR_SHADOW = 0.85;
const wrapTo = (v: number, s: number): number => ((v % s) + s) % s;

function paintGarden(world: SoftRoamWorld, scale: number, alpha: number, out: Uint8ClampedArray | Uint8Array, mem: SoftPaintMemory, cells: number[]): void {
  const s = world.size;
  const side = s * scale;
  const full = 2 * world.cfg.birthStore;
  const { field, acc, haze, glow, busy } = mem;
  busy.fill(0);
  const n = world.n;
  // ---- Depth: bodies on a lower level are drawn smaller, dimmer and bluer, under the bodies above, which cast a shadow on them and on the ground.
  const Lv = world.cfg.depth ?? 0;
  if (Lv > 0) {
    if (mem.lvl.length !== side * side || mem.layers.length !== side * side * 7 * Lv) { mem.layers = new Float32Array(side * side * 7 * Lv); mem.lvl = new Uint8Array(side * side); }
    else mem.lvl.fill(0);
    if (mem.drawLv.length !== world.cap) mem.drawLv = new Uint8Array(world.cap);
    if (mem.shade.length !== n * (Lv - 1)) mem.shade = new Float32Array(n * (Lv - 1));
    else mem.shade.fill(0);
  }
  const { layers, lvl, drawLv, shade } = mem;
  const slant = mem.slant;
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
    const f = Math.min(1, mem.foodBlur[i]);
    haze[i * 3] = 0.006 + 0.045 * f;
    haze[i * 3 + 1] = 0.01 + 0.15 * f;
    haze[i * 3 + 2] = 0.04 + 0.46 * f;
  }
  // Slanted: the floor is a little paler, so the shadows that fall on it show.
  if (slant > 0) for (let i = 0; i < n; i++) { haze[i * 3] += DEEP_FLOOR[0]; haze[i * 3 + 1] += DEEP_FLOOR[1]; haze[i * 3 + 2] += DEEP_FLOOR[2]; }
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
  const splatShade = (k: number, cx: number, cy: number, rad: number, w: number): void => {
    const x0 = Math.floor(cx - rad - 0.5), x1 = Math.ceil(cx + rad - 0.5);
    const y0 = Math.floor(cy - rad - 0.5), y1 = Math.ceil(cy + rad - 0.5);
    const inv = 1 / (rad * rad);
    const base = k * n;
    for (let ty = y0; ty <= y1; ty++) {
      const dy = ty + 0.5 - cy;
      const wy = ((ty % s) + s) % s;
      for (let tx = x0; tx <= x1; tx++) {
        const dx = tx + 0.5 - cx;
        const q = 1 - (dx * dx + dy * dy) * inv;
        if (q <= 0) continue;
        shade[base + wy * s + (((tx % s) + s) % s)] += w * q * q;
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
  // With depth: a body's field goes into the record of the level it is drawn on, so what shows at a pixel never depends on the order bodies are stamped in.
  const mergeDeep = (cx: number, cy: number, rad: number, lv: number): void => {
    const x0 = Math.floor((cx - rad) * scale), x1 = Math.ceil((cx + rad) * scale);
    const y0 = Math.floor((cy - rad) * scale), y1 = Math.ceil((cy + rad) * scale);
    const bit = 1 << lv;
    for (let yy = y0; yy <= y1; yy++) {
      const wy = yy < 0 ? yy + side : yy >= side ? yy - side : yy;
      for (let xx = x0; xx <= x1; xx++) {
        const wxp = xx < 0 ? xx + side : xx >= side ? xx - side : xx;
        const idx = wy * side + wxp;
        const k = idx * 6;
        const f = acc[k];
        if (f <= 0) continue;
        const m = (idx * Lv + lv) * 7;
        lvl[idx] |= bit;
        if (f > layers[m]) {
          const inv = 1 / f;
          layers[m + 1] = layers[m];
          layers[m] = f;
          layers[m + 2] = acc[k + 1] * inv; layers[m + 3] = acc[k + 2] * inv; layers[m + 4] = acc[k + 3] * inv; layers[m + 5] = acc[k + 4] * inv; layers[m + 6] = acc[k + 5] * inv;
        } else if (f > layers[m + 1]) layers[m + 1] = f;
        acc[k] = 0; acc[k + 1] = 0; acc[k + 2] = 0; acc[k + 3] = 0; acc[k + 4] = 0; acc[k + 5] = 0;
      }
    }
  };
  while (lo < total) {
    const label = world.body[order[lo]];
    let hi = lo;
    while (hi < total && world.body[order[hi]] === label) hi++;
    // With depth: the level the body is drawn on is the one it has reached or is on its way down from (its drawn height, rounded up, the highest
    // of its cells), so a body still gliding down is still over and still shades what it was over, and one gliding up joins a level only as it gets there.
    let bodyLv = 0;
    if (Lv > 0) {
      for (let q = lo; q < hi; q++) { const v = Math.ceil(levelX(mem, order[q], LX_DEEP, alpha) * (Lv - 1) - 0.02); if (v > bodyLv) bodyLv = v; }
      if (bodyLv > Lv - 1) bodyLv = Lv - 1;
      for (let q = lo; q < hi; q++) drawLv[order[q]] = bodyLv;
    }
    for (let q = lo; q < hi; q++) {
      const c = order[q];
      const g = mem.grow[c];
      const lit = cellTint(world, c, full, tintBuf, mem, alpha);
      let e = ease(g);
      let rad = FIELD_R * (0.35 + 0.65 * e);
      const amp = 0.6 + 0.4 * e;
      if (Lv > 0) {
        // How high the body is, eased: lower is smaller, dimmer and bluer, and what is above a level shades it, further off the higher it is.
        const h = levelX(mem, c, LX_DEEP, alpha);
        const hh = h * (Lv - 1);
        rad *= DEEP_SIZE + (1 - DEEP_SIZE) * h;
        const dim = DEEP_DIM + (1 - DEEP_DIM) * h;
        tintBuf[0] *= dim * (0.82 + 0.18 * h); tintBuf[1] *= dim * (0.93 + 0.07 * h); tintBuf[2] *= dim;
        // Only onto the levels under the one it is drawn on (the one whose light it gets), so it never shades itself.
        for (let k = 0; k < bodyLv; k++) {
          const up = hh - k;
          // Slanted: the light comes straight down, so the shadow is at the body's own place on the level it falls on (drawn `up` levels lower on the screen). Straight down: a little off to one side.
          if (up > 0.02) splatShade(k, mem.px[c] + (slant > 0 ? 0 : 0.35 * up), mem.py[c] + (slant > 0 ? slant : 0.5) * up, 1.25, 0.9 * Math.min(1, up) * e);
        }
        e *= dim;
      }
      const shl = Math.min(1, level(mem, c, LV_SHELL, alpha));
      const mol = Math.min(1, level(mem, c, LV_MOUTH, alpha));
      const feed = level(mem, c, LV_FEED, alpha), hit = level(mem, c, LV_HIT, alpha);
      stamp(mem.px[c], mem.py[c], rad, amp, tintBuf[0] * lit, tintBuf[1] * lit, tintBuf[2] * lit, shl, shl * level(mem, c, LV_DMG, alpha));
      splat(mem.px[c], mem.py[c], GLOW_R, 0.2 * tintBuf[0] * lit * e, 0.2 * tintBuf[1] * lit * e, 0.2 * tintBuf[2] * lit * e);
      // A mouth's own glow: faint at rest, the full warm glow while it feeds (chunk 4).
      if (mol > 0.001) { const w8 = 0.35 + 0.65 * Math.min(1, feed); splat(mem.px[c], mem.py[c], GLOW_R, 0.3 * e * mol * w8, 0.06 * e * mol * w8, 0.04 * e * mol * w8); }
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
      if (Lv > 0) mergeDeep(mem.px[c], mem.py[c], FIELD_R * (0.35 + 0.65 * e), bodyLv);
      else merge(mem.px[c], mem.py[c], FIELD_R * (0.35 + 0.65 * e));
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
    // The ghost stays at the height the cell died at; its compost falls on the ground under it.
    const ghy = slant > 0 ? wrapTo(gh.y - slant * gh.lv, s) : gh.y;
    if (gh.kind === KIND_MOUTH) splat(gh.x, ghy, rad, 1 * lit, 0.3 * lit, 0.25 * lit);
    else splat(gh.x, ghy, rad, 0.8 * lit, 0.86 * lit, 0.82 * lit);
    if (gh.compost) {
      const puff = Math.sin(Math.PI * Math.min(1, t * 1.15)) * 0.55;
      if (puff > 0) splat(gh.x, gh.y, 1.3 + 1.2 * t, 0.1 * puff, 0.5 * puff, 1.0 * puff);
    }
  }
  // ---- Per pixel: ground (haze) and glow sampled per 2 x 2 block, bodies composed over it per pixel.
  const { hazeRowA, hazeRowB, glowRowA, glowRowB, x0, x1, wx, tileOf } = mem;
  const out32 = out.byteOffset % 4 === 0 ? new Uint32Array(out.buffer, out.byteOffset, out.length >> 2) : null;
  let cachedRow = -2;
  const sky = world.cfg.day !== undefined;
  if (sky) mem.prepareSky(world, alpha);
  const T = THRESH;
  const grd = [0, 0, 0];
  // With depth: one body's record (in `buf` at m) laid over what is in grd, its colour times `mul`; returns how far inside the body the pixel is.
  const over = (buf: Float32Array, m: number, mul: number): number => {
    const F = buf[m] - buf[m + 1];
    const sh = buf[m + 5];
    const dm = sh > 0 ? Math.min(1, buf[m + 6] / sh) : 0;
    const inside = smooth(T - 0.05, T + 0.05, F);
    const rimW = 0.1 + 0.2 * sh;
    const rz = (F - T - 0.1) / rimW;
    const rq = 1 / (1 + rz * rz * 1.2);
    const rim = rq * rq * (1 + 0.8 * sh);
    const k = inside * (0.62 + 0.38 * smooth(T + 0.2, T + 1.2, F));
    const cr = buf[m + 2], cg = buf[m + 3], cb = buf[m + 4];
    const dk = 1 - 0.55 * dm;
    const pr = (0.4 + 0.6 * cr) * (1 - sh) + sh * BONE[0] * dk;
    const pg = (0.4 + 0.6 * cg) * (1 - sh) + sh * BONE[1] * (dk - 0.05 * dm);
    const pb = (0.4 + 0.6 * cb) * (1 - sh) + sh * BONE[2] * (dk - 0.12 * dm);
    const rimK = (0.36 + 0.4 * sh) * rim * inside;
    const halo = 0.12 * rim * (1 - inside);
    grd[0] = grd[0] * (1 - inside) + mul * (cr * k + rimK * pr + halo);
    grd[1] = grd[1] * (1 - inside) + mul * (cg * k + rimK * pg + halo);
    grd[2] = grd[2] * (1 - inside) + mul * (cb * k + rimK * pb + halo);
    buf[m] = 0; buf[m + 1] = 0; buf[m + 2] = 0; buf[m + 3] = 0; buf[m + 4] = 0; buf[m + 5] = 0; buf[m + 6] = 0;
    return inside;
  };
  // The light left under what is above, per level under the surface, at the block being drawn (the surface is never shaded).
  const lightAt = [1, 1, 1, 1];
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
      let hr = hazeRowA[o] + (hazeRowB[o] - hazeRowA[o]) * fy;
      let hg = hazeRowA[o + 1] + (hazeRowB[o + 1] - hazeRowA[o + 1]) * fy;
      let hb = hazeRowA[o + 2] + (hazeRowB[o + 2] - hazeRowA[o + 2]) * fy;
      if (sky) { hr = hr * mem.mulR[ix] + mem.addR[ix]; hg = hg * mem.mulG[ix] + mem.addG[ix]; hb = hb * mem.mulB[ix] + mem.addB[ix]; }
      if (Lv > 0) {
        const ra = (((j0 % s) + s) % s) * s, rb = ((((j0 + 1) % s) + s) % s) * s;
        const xa = x0[ix], xb = x1[ix], w = wx[ix];
        for (let k = 0; k < Lv - 1; k++) {
          const q = k * n;
          const a = shade[q + ra + xa] + (shade[q + ra + xb] - shade[q + ra + xa]) * w;
          const b = shade[q + rb + xa] + (shade[q + rb + xb] - shade[q + rb + xa]) * w;
          const v = a + (b - a) * fy;
          lightAt[k] = 1 - DEEP_SHADOW * (v > 1 ? 1 : v);
        }
        // The ground under a body in the slanted garden is darker than a body in the same shadow, so a body's height reads from its shadow.
        const gl = slant > 0 ? 1 - (1 - lightAt[0]) * (DEEP_FLOOR_SHADOW / DEEP_SHADOW) : lightAt[0];
        hr *= gl; hg *= gl; hb *= gl;
      }
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
          if (best <= 0 && (Lv === 0 || !isBusy || lvl[idx] === 0)) { out[p] = gR; out[p + 1] = gG; out[p + 2] = gB; out[p + 3] = 255; continue; }
          grd[0] = hr; grd[1] = hg; grd[2] = hb;
          if (Lv > 0) {
            // From the floor up, each level's body in the light that level gets; the level that shows is kept for the marks drawn afterwards.
            let shows = 0;
            const bits = lvl[idx];
            for (let k = 0; k < Lv; k++) if ((bits & (1 << k)) !== 0 && over(layers, (idx * Lv + k) * 7, k < Lv - 1 ? lightAt[k] : 1) > 0.5) shows = k + 1;
            lvl[idx] = shows;
            out[p] = GAMMA[Math.min(GAMMA_N - 1, ((grd[0] + gr) * GAMMA_STEP) | 0)];
            out[p + 1] = GAMMA[Math.min(GAMMA_N - 1, ((grd[1] + gg) * GAMMA_STEP) | 0)];
            out[p + 2] = GAMMA[Math.min(GAMMA_N - 1, ((grd[2] + gb) * GAMMA_STEP) | 0)];
            out[p + 3] = 255;
            continue;
          }
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
  // With depth, a cell under a body drawn on a higher level gets no marks (they would show on the body above).
  let shown = cells;
  if (Lv > 0) {
    shown = [];
    for (const c of cells) {
      const ix = Math.min(side - 1, Math.floor(mem.px[c] * scale)), iy = Math.min(side - 1, Math.floor(mem.py[c] * scale));
      if (lvl[iy * side + ix] <= drawLv[c] + 1) shown.push(c);
    }
  }
  const only = Lv > 0 ? new Set(shown) : undefined;
  // ---- Mother links as soft strands, brighter where the two stores differ. With depth they are clipped pixel by pixel instead, so a strand to a covered cell still shows where it is in the open.
  drawLinks(world, scale, out, mem, cells, full, 'garden', Lv > 0);
  drawKinds(world, scale, alpha, out, mem, shown, only);
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
function drawKinds(world: SoftRoamWorld, scale: number, alpha: number, out: Uint8ClampedArray | Uint8Array, mem: SoftPaintMemory, cells: number[], only?: Set<number>): void {
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
  const tNow = world.step + alpha;
  // Grazing (chunk 4): a cell that took food from the ground draws in three pale motes, the cool colour of the food haze, that spiral in
  // from more than a tile out and fade as they reach its rim (on the dark ground, where they show). Cool and inward: eating from the ground.
  const moteSigma = Math.max(0.09, 0.9 / scale);
  for (const c of cells) {
    const g = level(mem, c, LV_GRAZE, alpha) * ease(mem.grow[c]);
    if (g < 0.03) continue;
    const base = (world.cid[c] % 997) * 0.37;
    for (let k = 0; k < 3; k++) {
      const ph = (tNow / 14 + k / 3 + (world.cid[c] % 13) / 13) % 1;
      const r = 0.45 + 0.75 * (1 - ph);
      const ang = base + (2 * Math.PI * k) / 3 + 1.4 * ph;
      const a = 0.9 * g * Math.sin(Math.PI * ph);
      const x = mem.px[c] + r * Math.cos(ang), y = mem.py[c] + r * Math.sin(ang);
      stroke(out, scale, side, ((x % s) + s) % s, ((y % s) + s) % s, 0, 0, moteSigma, a, false, SIP[0], SIP[1], SIP[2]);
    }
  }
  // Mouths: a small warm core on top of the body. Idle it is faint, so red means "feeding" more than "a mouth"; it brightens and pulses while feeding.
  for (const c of cells) {
    const mo = level(mem, c, LV_MOUTH, alpha);
    if (mo < 0.05) continue;
    const feed = level(mem, c, LV_FEED, alpha) * pulseOf(world, c, alpha);
    const a = mo * ease(mem.grow[c]) * (0.17 + 0.83 * feed);
    stroke(out, scale, side, mem.px[c], mem.py[c], 0, 0, Math.max(0.12, 0.7 / scale) * (1 + 0.35 * feed), a, false, 1, 0.3 + 0.2 * feed, 0.12);
  }
  // Feeding threads: a thin red line from the mouth to the cell it feeds on, brighter at the mouth end.
  for (const th of mem.threads) {
    // With depth: no thread to or from a cell that is under a higher body.
    if (only !== undefined && !(only.has(th.ms) && only.has(th.ps))) continue;
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
    // Chunk 4: two beads of matter run from the prey to the mouth (who eats whom), and a warm bite mark flickers on the prey's rim facing the mouth.
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 1e-3) {
      const px = ax + dx, py = ay + dy;
      for (let k = 0; k < 2; k++) {
        const ph = (tNow / 6 + k / 2 + (th.pc % 7) / 7) % 1;
        const bx = px - dx * ph, by = py - dy * ph;
        stroke(out, scale, side, ((bx % s) + s) % s, ((by % s) + s) % s, 0, 0, sigma * 1.7, 0.9 * a * Math.sin(Math.PI * ph), false, BITE[0], BITE[1], BITE[2]);
      }
      const ux = -dx / len, uy = -dy / len;
      const mx = px + ux * 0.3, my = py + uy * 0.3;
      const flick = 0.55 + 0.45 * Math.sin(tNow * 2.3 + (th.pc % 11));
      stroke(out, scale, side, ((mx - uy * 0.13) % s + s) % s, ((my + ux * 0.13) % s + s) % s, uy * 0.26, -ux * 0.26, sigma * 1.3, 0.85 * a * flick, false, BITE[0], BITE[1], BITE[2]);
    }
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
      const x0 = rg.x + rad * Math.cos(th0), y0 = rg.y - mem.slant * rg.lv + rad * Math.sin(th0);
      stroke(out, scale, side, ((x0 % s) + s) % s, ((y0 % s) + s) % s, rad * (Math.cos(th1) - Math.cos(th0)), rad * (Math.sin(th1) - Math.sin(th0)), sigma * 1.4, 0.8 * a, false, BONE[0], BONE[1], BONE[2]);
    }
  }
}

/** Mother links drawn straight into the picture (bytes), after the rest. */
/**
 * `clip` (with depth, after the compose): leave out each pixel of a strand where a body on a higher level shows, so a strand
 * between two open cells never crosses a body above it; the parts of it in the open still show.
 */
function drawLinks(world: SoftRoamWorld, scale: number, out: Uint8ClampedArray | Uint8Array, mem: SoftPaintMemory, cells: number[], full: number, paint: SoftPaint, clip = false): void {
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
    // The strand's level plus one, as `lvl` holds it: a pixel showing a body above that is covered.
    const top = clip ? Math.max(mem.drawLv[c], mem.drawLv[m]) + 1 : 0;
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
        if (clip && mem.lvl[wy * side + wxp] > top) continue;
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
    const col = world.kind[c] === KIND_MOUTH ? [255, 60, 50] : world.kind[c] === KIND_SHELL ? [215, 210, 180] : world.kind[c] === KIND_LEAF ? [70, 220, 80] : famColour(world.fam[c]);
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
  const rows = FAMILY_ORDER.map((t, k) => ({ family: k + 1, name: typeInfo(t).name, colour: typeInfo(t).colour, cells: 0 }));
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
  /** The sky for the time readout: the day and year lengths in steps (0 for none), how far through each it is (0 to 1), the year's light as a share of midsummer's, and the mean light over the arena. */
  sky: { day: number; year: number; dayShare: number; yearShare: number; yearLight: number; meanLight: number };
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
      sky: { day: this.world.cfg.day ?? 0, year: this.world.cfg.year ?? 0, ...softSky(this.world) },
    };
  }
}
