/**
 * The /softroam/ page's dials: every number a visitor can set, with its range, its default (the page's usual world),
 * what it means in plain words, and how it reaches the world's config. Kept apart from the page so the mapping can be
 * tested: with every dial at its default the options give exactly the world `softRoamConfig` builds for that start and kinds
 * switch with no dial overrides (the garden world for the garden start or with kinds on; the plain grown world for any other
 * start with kinds off).
 */

import { SoftRoamWorld, type SoftRoamConfig } from './kernel.ts';
import { softRoamConfig, SOFT_STARTS, type SoftRoamOptions, type SoftRoamStart } from './view.ts';

export interface SoftSwitches {
  seed: number;
  size: number;
  start: SoftRoamStart;
  kinds: boolean;
  toughness: boolean;
}

export type DialValues = Record<string, number>;

/** The page's switches, in the order the link keeps them. */
export const SWITCH_IDS = ['seed', 'start', 'kinds', 'toughness'];
/** The switches that start a new world as soon as they change; the start switch has its own handler, which sets kinds with it. */
export const CHANGE_IDS = SWITCH_IDS.filter((id) => id !== 'start');

/** The starts that turn on the sun, senses and manners (and the seasons' economy); the bodies start adds chunk 3's rules over the seasons'. */
export const sunStart = (start: SoftRoamStart): boolean => start === 'seasons' || start === 'bodies';

/** The switches after a start is picked: the bodies, the seasons and the garden have kinds on, every other start is the plain grown line-up (kinds off). */
export function startPick(sw: SoftSwitches, start: SoftRoamStart): SoftSwitches {
  return { ...sw, start, kinds: start === 'garden' || sunStart(start) };
}

/**
 * The switches an address asks for, over the page's defaults (`defaults`: what each switch holds on a fresh page; `allowed` says whether a select has that option).
 * A bare address is the page's own start with that start's kinds. A link that names settings but no start, or a start this page does not have, is an old
 * garden link (the page's start was the garden then). A start is looked up by its own keys only, so "constructor" is not one. An old link that names no kinds
 * switch had the default (on) whatever its start; one that names kinds takes it. Every switch a link leaves out is its default, not what was left over.
 */
export function linkSwitches(hash: string, defaults: Record<string, string>, allowed: (id: string, v: string) => boolean = () => true): Record<string, string> {
  const q = new URLSearchParams(hash.replace(/^#/, ''));
  const bare = [...q.keys()].length === 0;
  const named = q.get('start');
  const start = (named !== null && Object.hasOwn(SOFT_STARTS, named) ? named : bare ? defaults.start : 'garden') as SoftRoamStart;
  const out: Record<string, string> = { ...defaults, start };
  if (bare || (q.has('kinds') && allowed('kinds', q.get('kinds')!))) out.kinds = startPick({ seed: 0, size: 128, start, kinds: false, toughness: false }, start).kinds ? '1' : '0';
  for (const id of SWITCH_IDS) {
    const v = q.get(id);
    if (v !== null && id !== 'start' && allowed(id, v)) out[id] = v;
  }
  return out;
}

export interface Dial {
  id: string;
  group: string;
  label: string;
  min: number;
  max: number;
  step: number;
  def: number;
  /** The value when the start is `seasons` (which defines the sun, senses and manners); `def` is the value for every other start. */
  seasonsDef?: number;
  /** The value when the start is `bodies`, where it differs from `seasonsDef` (or the dial is chunk 3's own). */
  bodiesDef?: number;
  /** Whole numbers only. */
  whole?: boolean;
  /** Smallest value above 0 the world accepts (values between 0 and this become this). */
  least?: number;
  /** What the value means, in plain words. */
  say: (v: number, all: DialValues) => string;
  /** Why the dial does nothing right now, or null when it is in use. */
  idle?: (all: DialValues, sw: SoftSwitches) => string | null;
}

const n = (x: number, digits = 0) => x.toLocaleString('en-US', { maximumFractionDigits: digits });
const share = (x: number) => (x === 0 ? 'none' : x === 1 ? 'all' : `${n(x * 100, 1)}%`);
/** The plain grown world: a start other than the garden and the seasons, with kinds of cell off. Touch feeding and its rules are not part of it. */
export const plainWorld = (sw: SoftSwitches): boolean => sw.start !== 'garden' && !sunStart(sw.start) && !sw.kinds;
const noKinds = (_a: DialValues, sw: SoftSwitches) => (sw.kinds ? null : 'needs kinds of cell on');
const noDrain = (a: DialValues, sw: SoftSwitches) => noKinds(a, sw) ?? (a.drain > 0 ? null : 'needs touch feeding on (above 0)');
const notPlain = (_a: DialValues, sw: SoftSwitches) => (plainWorld(sw) ? 'the plain start has no touch feeding: turn kinds of cell on, or pick the garden' : null);

const needsDay = (a: DialValues) => (a.day > 0 ? null : 'needs a day length (above 0)');
const needsYear = (a: DialValues) => needsDay(a) ?? (a.year > 0 ? null : 'needs a year length (above 0)');
const needsLeafGround = (a: DialValues, sw: SoftSwitches) => noKinds(a, sw) ?? needsDay(a);
const needsSense = (a: DialValues, sw: SoftSwitches) => noDrain(a, sw) ?? (a.sight > 0 || a.fear > 0 ? null : 'needs hunters to see prey or prey to see hunters (above 0)');
const needsSight = (a: DialValues, sw: SoftSwitches) => noDrain(a, sw) ?? (a.sight > 0 ? null : 'needs hunters to see prey (above 0)');
const needsLeaves = (a: DialValues, sw: SoftSwitches) => needsLeafGround(a, sw) ?? (a.leaf >= 0 && sunStart(sw.start) || a.leaf > 0 ? null : 'needs leaf income');
const hours = (v: number, a: DialValues) => (a.day > 0 ? ` (a year of ${n(v / a.day, 1)} days)` : '');

export const SOFT_DIALS: readonly Dial[] = [
  // Sun and seasons
  { id: 'day', whole: true, group: 'Sun and seasons', label: 'Length of a day', min: 0, max: 3000, step: 10, def: 0, seasonsDef: 400, least: 16,
    say: (v) => (v === 0 ? 'no sun: the light is the same everywhere, always' : `a bright band half the world wide sweeps once round the arena every ${n(v)} steps; the other half is night, so food and leaves are only worth something in the light`) },
  { id: 'year', whole: true, group: 'Sun and seasons', label: 'Length of a year', min: 0, max: 60000, step: 100, def: 0, seasonsDef: 12000, least: 16,
    say: (v, a) => (v === 0 ? 'no seasons: every day is as bright as the last' : `the whole world brightens and dims once every ${n(v)} steps${hours(v, a)}, so food and leaf income swing between lean and rich; it cannot be shorter than a day`),
    idle: needsDay },
  { id: 'winter', group: 'Sun and seasons', label: 'Winter light', min: 0, max: 1, step: 0.05, def: 0.3, seasonsDef: 0.1,
    say: (v) => (v === 0 ? 'winter is pitch dark at its deepest: no leaf income, no patches in the sun' : `in the depth of winter the light is ${share(v)} of midsummer's, so winter thins whatever lives on light`),
    idle: (a) => needsYear(a) },
  { id: 'patchSun', whole: true, group: 'Sun and seasons', label: 'Patches follow the sun', min: 0, max: 1, step: 1, def: 0, seasonsDef: 1, bodiesDef: 0,
    say: (v) => (v === 0 ? 'new food patches fall anywhere, any time' : 'a new food patch lands only in proportion to the light where it would fall, so the food follows the sun round and is scarce in winter nights (matter not dropped waits in the store)'),
    idle: needsDay },
  { id: 'leaf', group: 'Sun and seasons', label: 'Leaf income', min: 0, max: 4, step: 0.1, def: 0, seasonsDef: 1.3,
    say: (v) => (v === 0 ? 'green leaf cells earn nothing from the light (a start that has no leaves has no green cells at all)' : `a green leaf cell with all four sides bare earns up to ${n(v, 2)} matter a step in full light (a leaf buried inside its body earns nothing, and a leaf cannot eat from the ground)`),
    idle: needsLeafGround },
  { id: 'patchSeason', whole: true, group: 'Sun and seasons', label: 'Patches shrink in winter', min: 0, max: 1, step: 1, def: 0, bodiesDef: 1,
    say: (v) => (v === 0 ? 'every food patch is the same size, whatever the season' : 'a food patch holds less in winter, in proportion to the year\'s light (a full patch at midsummer)'),
    idle: needsYear },
  { id: 'winterCost', group: 'Sun and seasons', label: 'Winter upkeep', min: 0, max: 200, step: 1, def: 0, bodiesDef: 30,
    say: (v) => (v === 0 ? 'cells cost the same to keep all year' : `every cell pays up to ${n(v)} matter per 1,000 steps more in deep winter, less as the light comes back, nothing at midsummer: winter thins bodies`),
    idle: needsYear },
  { id: 'leafPool', group: 'Sun and seasons', label: 'Upkeep kept for leaves', min: 0, max: 1, step: 0.05, def: 0, bodiesDef: 0.3,
    say: (v) => (v === 0 ? 'leaves are paid from the same store as the food patches' : `${share(v)} of the upkeep cells pay goes to a store only leaves draw on (up to 2,000 in the bodies start), so leaves do not compete with patches`),
    idle: needsLeaves },
  { id: 'leafPoolMax', whole: true, group: 'Sun and seasons', label: 'Most kept for leaves', min: 100, max: 20000, step: 100, def: 4000, seasonsDef: 1000, bodiesDef: 2000,
    say: (v) => `the store kept for leaves holds at most ${n(v)} matter; past that the upkeep goes back to the food store`,
    idle: (a, sw) => needsLeaves(a, sw) ?? (a.leafPool > 0 ? null : 'needs some upkeep kept for leaves (above 0)') },
  // Senses and manners
  { id: 'sight', whole: true, group: 'Senses and manners', label: 'Hunters see prey', min: 0, max: 8, step: 1, def: 0, seasonsDef: 8,
    say: (v) => (v === 0 ? 'mouths cannot see: they find prey by smell of food and by bumping into it' : `a mouth sees prey it could eat up to ${v} tiles away and swims straight at the nearest one (if its body has a chase gene)`),
    idle: noDrain },
  { id: 'fear', whole: true, group: 'Senses and manners', label: 'Prey see hunters', min: 0, max: 8, step: 1, def: 0, seasonsDef: 4,
    say: (v) => (v === 0 ? 'plain and shell cells do not notice hunters coming' : `plain and shell cells see a hunting mouth within ${v} tiles that could eat them and swim straight away from it (if their body has a chase gene)`),
    idle: noDrain },
  { id: 'truce', whole: true, group: 'Senses and manners', label: 'Kin leave kin alone', min: 0, max: 1, step: 1, def: 0, seasonsDef: 1,
    say: (v) => (v === 0 ? 'a hunter will feed on a body of its own kind' : 'bodies grown from the same founder type never feed on, hit or hunt each other'),
    // Touch feeding works without kinds of cell (any cell of a body twice the size takes), so truce does too; it only needs touch feeding on.
    idle: (a, sw) => notPlain(a, sw) ?? (a.drain > 0 ? null : 'needs touch feeding on (above 0)') },
  { id: 'jaws', whole: true, group: 'Senses and manners', label: 'Mouths are not prey', min: 0, max: 1, step: 1, def: 0, seasonsDef: 1,
    say: (v) => (v === 0 ? 'a body with a mouth can be eaten like any other' : 'no cell of a body that holds a mouth can be fed on, hit or hunted: hunters leave each other alone'),
    idle: noDrain },
  { id: 'releaseMin', whole: true, group: 'Senses and manners', label: 'Fewest cells before a release', min: 0, max: 40, step: 1, def: 0, seasonsDef: 8,
    say: (v) => (v === 0 ? 'a body of any size can let a daughter go as a new body, so single crumbs are common' : `a body lets a daughter go as a new body only when it has at least ${v} cells (a plan that never grows that large never releases)`) },
  { id: 'steer', whole: true, group: 'Senses and manners', label: 'Bodies hunt as one', min: 0, max: 1, step: 1, def: 0, bodiesDef: 1,
    say: (v) => (v === 0 ? 'each mouth steers on its own, and a one-mouth body barely bends toward prey' : 'a body with a mouth that sees prey (or a cell that sees a hunter) turns as a whole toward the prey (or away), and every cell of it with a chase gene swims that way'),
    idle: needsSense },
  { id: 'pack', whole: true, group: 'Senses and manners', label: 'Mouths open big bodies', min: 0, max: 16, step: 1, def: 0, bodiesDef: 6,
    say: (v) => (v === 0 ? 'a body can only feed on bodies half its size or less' : `a body may also feed on a body of up to ${v} cells for each of its mouths touching it; two bodies that could each eat the other leave each other alone`),
    idle: noDrain },
  { id: 'crowd', whole: true, group: 'Senses and manners', label: 'Hunters spread out', min: 0, max: 4, step: 1, def: 0, bodiesDef: 1,
    say: (v) => (v === 0 ? 'hunters all go for the nearest prey, even when others are already at it' : `a hunter counts prey with another hunter's mouth beside it as ${v} tile${v === 1 ? '' : 's'} further off for each such mouth, so hunters share out the prey`),
    idle: needsSight },
  { id: 'heal', whole: true, group: 'Bodies', label: 'Bodies heal', min: 0, max: 1, step: 1, def: 0, bodiesDef: 1,
    say: (v) => (v === 0 ? 'a cell dying inside a body splits it in two for good' : 'the cross-braces hold a body together where a cell has died, and the cell that made it grows it again: big bodies keep their shape') },
  { id: 'releaseGap', whole: true, group: 'Senses and manners', label: 'Steps between releases', min: 0, max: 3000, step: 10, def: 0, seasonsDef: 200,
    say: (v) => (v === 0 ? 'a body can release as often as it divides' : `a body lets a new body go at most once in ${n(v)} steps, even when it loses a tip or splits in two`) },
  // Armour and hunting
  { id: 'crack', whole: true, group: 'Armour and hunting', label: 'Hits to crack a shell', min: 0, max: 20000, step: 50, def: 300, seasonsDef: 10000, bodiesDef: 2000,
    say: (v) => (v === 0 ? 'shells never crack' : `a shell turns plain (and can be eaten) after ${n(v)} hits from mouths of bodies twice its size; never healed`),
    idle: noDrain },
  { id: 'shellBite', group: 'Armour and hunting', label: 'Lone shell eats', min: 0, max: 1, step: 0.05, def: 1,
    say: (v, a) => `a shell on its own (an armoured seed) eats ${share(v)} of the usual bite of ${a.bite}: ${v < 1 ? 'safe but slow to grow' : 'no cost to armour'}`,
    idle: noKinds },
  { id: 'shellLeak', group: 'Armour and hunting', label: 'Shell upkeep', min: 0, max: 1, step: 0.05, def: 0.1,
    say: (v) => `a shell pays ${share(v)} of the upkeep other cells pay on open sides`,
    idle: noKinds },
  { id: 'drain', whole: true, group: 'Armour and hunting', label: 'Touch feeding', min: 0, max: 16, step: 1, def: 1,
    say: (v) => (v === 0 ? 'bodies only push each other apart' : `a body at least twice another's size takes ${v} matter a step through each cell that touches (with kinds, only through its mouths)`),
    idle: notPlain },
  { id: 'seal', whole: true, group: 'Armour and hunting', label: 'Newborn safe for', min: 0, max: 1000, step: 10, def: 200,
    say: (v) => (v === 0 ? 'newborn bodies can be fed on at once' : `a new body cannot be fed on for its first ${n(v)} steps`),
    idle: (a, sw) => notPlain(a, sw) ?? (a.drain > 0 ? null : 'needs touch feeding on (above 0)') },
  { id: 'grip', whole: true, group: 'Armour and hunting', label: 'Hunters hold on', min: 0, max: 256, step: 8, def: 96,
    say: (v) => (v === 0 ? 'a mouth touching prey is not pulled toward it' : `a mouth touching prey it can feed on is pulled toward it with strength ${v} of 256, so it keeps hold as the prey swims`),
    idle: noDrain },
  // Bodies
  { id: 'flow', group: 'Bodies', label: 'Seeping along bonds', min: 0.1, max: 12.5, step: 0.1, def: 1.5625, least: 0.1,
    say: (v) => `each cell keeps its own store and ${n(v, 2)}% of a difference seeps across each bond a step` },
  { id: 'life', whole: true, group: 'Bodies', label: 'Cells wear out after', min: 0, max: 40000, step: 100, def: 8000, bodiesDef: 20000, least: 2,
    say: (v) => (v === 0 ? 'cells live until they starve' : `about ${n(v)} steps on average`) },
  { id: 'birthStore', whole: true, group: 'Bodies', label: 'Matter to divide', min: 10, max: 256, step: 2, def: 150, seasonsDef: 60,
    say: (v) => `a cell holding ${n(v * 2)} divides, each half starting with about ${n(v)}` },
  { id: 'minStore', whole: true, group: 'Bodies', label: 'Starves below', min: 1, max: 200, step: 1, def: 30, seasonsDef: 15,
    say: (v, a) => (v > a.birthStore ? `held at ${n(a.birthStore)}, the matter to divide: a cell with less than that dies` : `a cell with less than ${n(v)} matter dies`) },
  { id: 'bite', whole: true, group: 'Bodies', label: 'Bite', min: 1, max: 16, step: 1, def: 4,
    say: (v) => `a grazing cell takes up to ${v} food a step from the tile under its centre` },
  // Upkeep and moving
  { id: 'leakSide', group: 'Upkeep and moving', label: 'Upkeep per open side', min: 0, max: 100, step: 0.5, def: 2, seasonsDef: 8,
    say: (v) => `${n(v, 2)} matter per 1,000 steps for each side of a cell not touching its own body` },
  { id: 'leakCell', group: 'Upkeep and moving', label: 'Upkeep per cell', min: 0, max: 50, step: 0.25, def: 1, seasonsDef: 4,
    say: (v) => `${n(v, 2)} matter per 1,000 steps for every cell, wherever it sits` },
  { id: 'moveCost', group: 'Upkeep and moving', label: 'Cost of moving', min: 0, max: 200, step: 1, def: 10,
    say: (v) => `${n(v, 2)} matter per 1,000 steps per cell at full thrust (less when thrusting less)` },
  { id: 'thrustMax', whole: true, group: 'Upkeep and moving', label: 'Top thrust', min: 0, max: 600, step: 10, def: 240,
    say: (v) => (v === 0 ? 'no cell pushes: bodies only drift when something shoves them' : `full push of ${n(v)} (240 is the usual); a stronger push means a faster body, and the cost of moving is paid per push`) },
  { id: 'keep', whole: true, group: 'Upkeep and moving', label: 'Glide', min: 0, max: 250, step: 5, def: 192,
    say: (v) => (v === 0 ? 'no glide: a cell stops the moment nothing pushes it, so motion is stiff and syrupy' : `a cell keeps ${n((v / 256) * 100)}% of its speed from one tiny time-step to the next, so bodies coast and wobble before they settle`) },
  { id: 'turnMax', group: 'Upkeep and moving', label: 'Turning', min: 0, max: 100, step: 0.5, def: 15.625,
    say: (v) => `at most ${n(v, 2)} chances in 1,000 a step that a body picks a new heading` },
  // Stiffness
  { id: 'kBond', whole: true, group: 'Stiffness', label: 'Bond stiffness', min: 0, max: 400, step: 8, def: 96,
    say: (v) => (v === 0 ? 'bonds do not pull: a body falls apart into loose cells' : `how hard a bond pulls two joined cells back to one cell width apart (${n(v)}); stiffer bodies hold their shape, softer ones sag and bend`) },
  { id: 'kBrace', whole: true, group: 'Stiffness', label: 'Brace stiffness', min: 0, max: 400, step: 8, def: 64,
    say: (v) => (v === 0 ? 'no braces: a body can fold like a chain' : `how hard the cross-braces inside a body resist bending (${n(v)}); more means a body keeps its outline when it turns`) },
  { id: 'kRep', whole: true, group: 'Stiffness', label: 'Push-apart stiffness', min: 0, max: 600, step: 8, def: 256,
    say: (v) => (v === 0 ? 'cells pass through each other' : `how hard unjoined cells that overlap push apart (${n(v)}); lower lets bodies squash into each other, higher makes them hard`) },
  // Food
  { id: 'patchFood', whole: true, group: 'Food', label: 'Food per patch', min: 200, max: 20000, step: 100, def: 4000, seasonsDef: 1000,
    say: (v) => `each patch drops ${n(v)} food (when the world's store holds that much)` },
  { id: 'patchEvery', whole: true, group: 'Food', label: 'Steps between patches', min: 1, max: 500, step: 1, def: 20, seasonsDef: 12,
    say: (v) => `at least ${n(v)} steps between patches in a 128 x 128 arena (scaled for other sizes)` },
  { id: 'patchRadius', whole: true, group: 'Food', label: 'Patch radius', min: 0, max: 16, step: 1, def: 4,
    say: (v) => `patches are ${n(2 * v + 1)} tiles across` },
  { id: 'foodSpread', group: 'Food', label: 'Food spreads out', min: 0, max: 1, step: 0.01, def: 0.05, least: 0.01,
    say: (v) => (v === 0 ? 'food stays where it fell until it is eaten' : `each step ${share(v)} of a tile's food is shared out to its four neighbours, so patches blur into haze`) },
  // Scent
  { id: 'scentDecayShift', whole: true, group: 'Scent', label: 'Scent reach', min: 1, max: 12, step: 1, def: 11,
    say: (v) => `hunters and grazers smell food about ${n(Math.sqrt(2 ** v / 8), 1)} tiles away (a longer reach lets them steer toward patches from further off)` },
  { id: 'scentIters', whole: true, group: 'Scent', label: 'Scent passes', min: 0, max: 16, step: 1, def: 4,
    say: (v) => (v === 0 ? 'no scent: cells cannot steer toward food' : `the smell spreads ${v} times a step; more passes make it smoother and fuller but cost speed`) },
  { id: 'scentGain', whole: true, group: 'Scent', label: 'Scent gain', min: 1, max: 16, step: 1, def: 1,
    say: (v) => `how strongly a body reads the slope of the smell (${v}); high makes bodies turn sharply toward food, low makes them wander` },
  // Copy errors
  { id: 'mut', group: 'Copy errors', label: 'Gene copy errors', min: 0, max: 0.2, step: 0.005, def: 0.02,
    say: (v) => (v === 0 ? 'children are exact copies' : `about 1 gene in ${n(1 / v)} changes at each division`) },
  { id: 'planMut', group: 'Copy errors', label: 'Plan copy errors', min: 0, max: 0.5, step: 0.005, def: 0.01,
    say: (v) => (v === 0 ? 'plans never change' : `a new body's plan differs in one place ${n(v * 100, 1)}% of the time`) },
];

/** A value the world accepts for a dial: within its range, whole where it must be, and not in the gap above 0. */
export function fixDial(d: Dial, v: number): number {
  if (!Number.isFinite(v)) return d.def;
  let x = Math.min(d.max, Math.max(d.min, v));
  if (d.whole) x = Math.round(x);
  if (d.least !== undefined && x > 0 && x < d.least) x = d.least;
  return x;
}

/**
 * What to tell a visitor when the number they typed into a dial's box is not the one the dial took (past its range, rounded, in the gap
 * above 0, or not a number at all), or null when it was taken as typed. `kept` is the value the dial had before.
 */
export function dialMoved(d: Dial, typed: string, kept: number): string | null {
  const v = typed.trim() === '' ? NaN : Number(typed);
  if (!Number.isFinite(v)) return `"${d.label}" needs a number, so it stays at ${kept}.`;
  const x = fixDial(d, v);
  if (x === v) return null;
  if (v > d.max) return `"${d.label}" can go no higher than ${d.max}, so it is ${x}.`;
  if (v < d.min) return `"${d.label}" can go no lower than ${d.min}, so it is ${x}.`;
  if (d.whole && Math.round(v) !== v) return `"${d.label}" takes whole numbers, so it is ${x}.`;
  return `"${d.label}" is ${x}: it cannot sit between 0 and ${d.least}.`;
}

/** A dial's value with nothing moved, for a start: the seasons start defines the sun, senses and manners; every other start has them off. */
export const defFor = (d: Dial, start: SoftRoamStart): number =>
  start === 'bodies' && d.bodiesDef !== undefined ? d.bodiesDef : sunStart(start) && d.seasonsDef !== undefined ? d.seasonsDef : d.def;
const startDefined = (d: Dial): boolean => d.seasonsDef !== undefined || d.bodiesDef !== undefined;
/** The dials the seasons or bodies start defines (the ones a start sets when it is picked). */
export const START_DIAL_IDS: readonly string[] = SOFT_DIALS.filter(startDefined).map((d) => d.id);
/** The start's own values for the dials it defines. */
export const startDials = (start: SoftRoamStart): DialValues => Object.fromEntries(SOFT_DIALS.filter(startDefined).map((d) => [d.id, defFor(d, start)]));
/** What to tell a visitor after picking a start: what the start set, and by name which dials it moved from where they were (the economy ones too, not only the sun and the senses). */
export function startNote(before: DialValues, start: SoftRoamStart): string {
  const after = startDials(start);
  const moved = SOFT_DIALS.filter((d) => d.id in after && after[d.id] !== before[d.id]).map((d) => d.label);
  const what = start === 'bodies'
    ? 'The big bodies start sets the sun, senses and manners, the seasons\' economy, and its own rules (bodies that heal, hunt as one and open big bodies with several mouths, hunters that spread out, upkeep kept for leaves, a winter that costs) to its own values.'
    : start === 'seasons'
    ? 'The seasons start sets the sun, senses, manners and its own economy (matter to divide, upkeep, food patches, shell cracking) to its own values.'
    : 'This start has no sun, seasons, leaves, senses or manners, none of the big bodies\' rules, and the garden economy (matter to divide, upkeep, food patches, shell cracking): those dials are set to that (turn them up to add the sun and senses).';
  return moved.length === 0 ? what : `${what} Dials that moved: ${moved.join(', ')}.`;
}
/** Every dial at its default for a start (the page's own start is the big bodies). */
export const dialDefaults = (start: SoftRoamStart = 'bodies'): DialValues => Object.fromEntries(SOFT_DIALS.map((d) => [d.id, defFor(d, start)]));

/** Options for a world from the switches and dials. Dials left at their defaults add nothing to the config. */
export function dialOptions(sw: SoftSwitches, a: DialValues): SoftRoamOptions {
  const area = (sw.size * sw.size) / (128 * 128);
  const differs = (id: string) => a[id] !== defFor(SOFT_DIALS.find((d) => d.id === id)!, sw.start);
  const seasons = sunStart(sw.start);
  const bodies = sw.start === 'bodies';
  const over: Partial<SoftRoamConfig> = {};
  const plain = ['bite', 'birthStore', 'patchFood', 'patchRadius', 'keep', 'kBond', 'kBrace', 'kRep', 'thrustMax', 'scentDecayShift', 'scentIters', 'scentGain'] as const;
  for (const id of plain) if (differs(id)) over[id] = a[id];
  if (differs('minStore') || a.minStore > a.birthStore) over.minStore = Math.min(a.minStore, a.birthStore);
  if (differs('leakSide')) over.leakSide = a.leakSide / 1000;
  if (differs('leakCell')) over.leakCell = a.leakCell / 1000;
  if (differs('moveCost')) over.moveCost = a.moveCost / 1000;
  if (differs('turnMax')) over.turnMax = a.turnMax / 1000;
  if (differs('flow')) over.flow = a.flow / 100;
  if (differs('life')) over.life = a.life > 0 ? a.life : undefined;
  if (differs('foodSpread')) over.foodSpread = a.foodSpread > 0 ? a.foodSpread : undefined;
  if (differs('patchEvery')) over.patchEvery = Math.max(1, Math.round(a.patchEvery / area));
  const out: SoftRoamOptions = { seed: sw.seed, size: sw.size, start: sw.start };
  if (!plainWorld(sw)) {
    // Touch feeding, kinds and the rules that go with them; the plain grown world leaves all of them absent.
    Object.assign(out, { drain: a.drain, kinds: sw.kinds, crack: a.crack, toughness: sw.toughness, shellBite: a.shellBite, shellLeak: a.shellLeak, seal: a.seal, grip: a.grip });
  }
  // Sun, senses and manners. A dial that does nothing right now (idle) counts as off; an off dial leaves the key absent. The seasons start fills any key
  // left out with its own value, so there an off dial is passed as `false`, which the view reads as "leave this one out".
  const off = (seasons ? false : undefined) as unknown as number;
  const idleDial = (id: string) => SOFT_DIALS.find((d) => d.id === id)!.idle?.(a, sw) != null;
  const sun: Record<string, unknown> = {};
  for (const id of ['day', 'year', 'sight', 'fear', 'releaseMin', 'releaseGap']) sun[id] = !idleDial(id) && a[id] > 0 ? a[id] : off;
  // Leaf income of 0 is a setting, not an absence: on the seasons start the leaf cells stay in the plans and the mutations and simply earn nothing.
  // (On a start that has no leaves the dial's default is 0, which leaves the key out.)
  sun.leaf = idleDial('leaf') ? off : a.leaf > 0 || (seasons && a.leaf === 0) ? a.leaf : off;
  sun.winter = idleDial('winter') ? off : a.winter;
  for (const id of ['patchSun', 'truce', 'jaws']) sun[id] = !idleDial(id) && a[id] > 0 ? true : seasons ? false : undefined;
  // Chunk 3. The bodies start fills these itself, so there an off dial is `false` too; on the seasons start they are simply absent when off.
  const off3 = (bodies ? false : undefined) as unknown as number;
  for (const id of ['heal', 'steer', 'patchSeason']) sun[id] = !idleDial(id) && a[id] > 0 ? true : off3;
  for (const id of ['pack', 'crowd']) sun[id] = !idleDial(id) && a[id] > 0 ? a[id] : off3;
  sun.leafPool = !idleDial('leafPool') && a.leafPool > 0 ? a.leafPool : off3;
  // The cap goes with the pool: passed as the dial shows it whenever the pool is on (so the value shown is the value used, whatever the patch size).
  if (!idleDial('leafPoolMax')) sun.leafPoolMax = a.leafPoolMax;
  sun.winterCost = !idleDial('winterCost') && a.winterCost > 0 ? a.winterCost / 1000 : off3;
  for (const [k, v] of Object.entries(sun)) if (v !== undefined) (out as unknown as Record<string, unknown>)[k] = v;
  // The two copy-error dials are independent: each is always passed as the dial shows it.
  if (differs('mut')) out.mut = a.mut;
  out.planMut = a.planMut;
  if (Object.keys(over).length > 0) out.overrides = over;
  return out;
}

/** Why the world these settings describe cannot be made (the kernel's own check), or null when it can. */
export function checkDials(sw: SoftSwitches, a: DialValues): string | null {
  // The commonest refusal, said in the dials' own words (the kernel would say it too, less plainly).
  if (a.day > 0 && a.year > 0 && a.year < a.day) return `These settings do not make a world: a year of ${n(a.year)} steps is shorter than a day of ${n(a.day)}. Make the year longer than the day, or press "Put every dial back".`;
  try {
    new SoftRoamWorld(softRoamConfig(dialOptions(sw, a)));
    return null;
  } catch (error) {
    const m = error instanceof Error ? error.message : String(error);
    return `These settings do not make a world: ${m}. Move a dial back, or press "Put every dial back".`;
  }
}
