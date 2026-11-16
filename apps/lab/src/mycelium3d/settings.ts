// The /mycelium3d/ page's choices: world size, sinking, trail rule and bonds, each with plain words for what differs and why it
// matters, and the one function that turns a choice into a config. Pure, no DOM; the test
// checks that every combination validates (apps/lab/test/mycelium3d-pack.test.ts). Optional rule keys are left out of the config when unused (never set to
// undefined), so the default choice is defaultConfig() itself and its digests match tools/mycelium3d/run.ts.
import { defaultConfig, type Mycelium3dConfig } from '../../../../tools/mycelium3d/world.ts';

export type SizeId = '32x32x16' | '64x64x32' | '64x64x64';
export type Sink = 'off' | 'slow' | 'fast';
export type Trail = 'none' | 'toll' | 'owner';
export type Bonds = 'off' | 'upkeep' | 'free';

/** Cells in the default world (32 x 32 x 16); bigger worlds scale founders and room by their cell count. */
const BASE_CELLS = 32 * 32 * 16;
export const PARTICLE_CAP = 1 << 16;

export const SIZES: Record<SizeId, { dims: [number, number, number]; title: string; text: string }> = {
  '32x32x16': {
    dims: [32, 32, 16],
    title: '32 × 32 × 16 · the default world',
    text: 'The size the default numbers were tuned on (16,384 cells, the cell count of the flat world). The cheapest: it runs smoothly on a weak GPU, and it is the only size the CPU reference offers here.',
  },
  '64x64x32': {
    dims: [64, 64, 32],
    title: '64 × 64 × 32 · eight times the room',
    text: 'Twice as wide each way and twice as deep: separate colonies can grow without meeting, and the light has twice as many layers to fall through, so the floor is darker. Founders and room scale with the cells. Each step costs about eight times as much.',
  },
  '64x64x64': {
    dims: [64, 64, 64],
    title: '64 × 64 × 64 · a cube',
    text: 'Sixteen times the cells, as deep as the rules allow. The rules cap the particles at 65,536, so a large population can fill the cap; births refused for lack of room are counted below. The heaviest size and the least tested: expect it to be slow on a weak GPU.',
  },
};

export const SINKS: Record<Sink, { shift?: number; title: string; text: string }> = {
  off: {
    title: 'off: waste and trail stay where they are made',
    text: 'Waste spreads to its six neighbours by diffusion and trail stays where it was laid until it decays into waste, as in the flat world. Waste made near the top mostly stays within reach of the light, so the top keeps its raw material.',
  },
  slow: {
    shift: 8,
    title: 'slow: about 1/256 of the waste and trail sinks one layer per step',
    text: 'Each step every cell above the floor passes about one 256th of its waste and trail to the cell below. Over thousands of steps matter drifts to the dark floor, where light cannot turn it back into food. Watch whether the surface runs short.',
  },
  fast: {
    shift: 4,
    title: 'fast: about 1/16 sinks one layer per step',
    text: 'Sixteen times faster: waste piles up on the floor within a few hundred steps and the lit surface is starved of the waste it turns into food. The sharpest version of the problem the 3D world was built to pose: matter has to be lifted back up for the top to stay productive.',
  },
};

export const TRAILS: Record<Trail, { delta: Partial<Mycelium3dConfig>; title: string; text: string }> = {
  none: {
    delta: {},
    title: 'none: laying trail is only a cost',
    text: 'Trail costs the particle energy and matter, and nothing rewards it. In the flat world, inheritance purged this kind of trail; here it starts the same way, and the tuning runs found it nearly gone everywhere.',
  },
  toll: {
    delta: { moveCost: 12, trailMoveDiscount: 64, trailDiscountMode: 'toll' },
    title: 'toll road: cheaper moves on trail for particles that lay it',
    text: 'Moving costs six times the usual energy, but a particle that is laying trail pays much less for moving through a cell that already holds a little trail (on all three axes). In the flat world this kept trail but nothing was found using it. In the 3D tuning runs (64 × 64 × 32, sinking between this page’s slow and fast) it kept a bed of trail on the floor every time, and in 3 of 16 worlds the trail also ran unbroken from the surface to the floor. The strengths were sized in the flat world, not here.',
  },
  owner: {
    delta: { trailOwner: 'gid', ownerDefend: 4, ownerConduit: 30 },
    title: 'owner conduit with gate: a family’s own trail pipes food to it',
    text: 'Trail remembers which family laid it. A cell held by another family with at least 4 units of its trail is closed to my eating (the gate), and nutrient flows faster between two neighbouring cells only when the same family owns both (the conduit, up and down as well as sideways). In the flat world this pairing, without the toll, kept trail in 6 of 8 worlds: the open lead. Theta 4 and strength 30 were sized in the flat world, not here.',
  },
};

// Bonds (tools/mycelium3d/RULES.md, "Bonds"; screens in experiments/mycelium3d/bonds-screen-2026-11-16.md). bondBreak 1024 is
// four cells (256 position units per cell), the bodies screen's setting; those runs sank with shift 6, which this page does not offer.
export const BONDS: Record<Bonds, { delta: Partial<Mycelium3dConfig>; title: string; text: string }> = {
  off: {
    delta: {},
    title: 'off: every particle moves on its own',
    text: 'No bonds, as in the flat world: the controller’s BOND output is ignored and each particle moves by itself.',
  },
  upkeep: {
    delta: { bondBreak: 1024, bondCost: 1 },
    title: 'with upkeep: partners move together and pay for it',
    text: 'A particle whose BOND output is positive pairs with the nearest neighbour (in its own cell or the six around it) that also wants a bond and has a free slot. Each particle holds at most two bonds, so bodies are chains and rings. Bonded partners share their moves, and a bond breaks when its partners end a step more than 4 cells apart or either lets go. Each bond costs each partner 1 energy per step. In the tuning runs (64 × 64 × 32, sinking between this page’s slow and fast) bodies formed in the first few thousand steps and were nearly all gone by about step 8,000 to 20,000 in all 16 runs.',
  },
  free: {
    delta: { bondBreak: 1024 },
    title: 'free: the same bonds with no upkeep',
    text: 'Bonds as with upkeep, but a bond costs nothing to keep. In the tuning runs (64 × 64 × 32) nearly every world still lost most of its bodies: one of the first four kept chains and rings for the whole run, and none of twelve further seeds did, though two held about a fifth and two fifths of their particles in bodies on average. Those runs sank at a rate between this page’s slow and fast, so no seed here is known to keep its bodies.',
  },
};

// Own keys only: "toString" or "__proto__" from a link are not choices.
export const isSize = (v: string): v is SizeId => Object.hasOwn(SIZES, v);
export const isSink = (v: string): v is Sink => Object.hasOwn(SINKS, v);
export const isTrail = (v: string): v is Trail => Object.hasOwn(TRAILS, v);
export const isBonds = (v: string): v is Bonds => Object.hasOwn(BONDS, v);

export interface Choice { size: SizeId; seed: number; sink: Sink; trail: Trail; bonds: Bonds }
export const DEFAULT_CHOICE: Choice = { size: '32x32x16', seed: 1, sink: 'off', trail: 'none', bonds: 'off' };
/** The seed box's range (index.html #seed). */
export const SEED_MAX = 0xffffffff;

/** A whole number from a link, if it is all digits and in [lo, hi]. */
export function linkInt(raw: string | null, lo: number, hi: number): number | undefined {
  const n = raw === null || !/^\d+$/.test(raw) ? NaN : Number(raw);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : undefined;
}

/** The Plant choices a link carries (size, seed, sink, trail, bonds); a value the page does not offer is left out. */
export function choiceFromQuery(q: URLSearchParams): Partial<Choice> {
  const c: Partial<Choice> = {};
  const size = q.get('size'), sink = q.get('sink'), trail = q.get('trail'), bonds = q.get('bonds');
  if (size !== null && isSize(size)) c.size = size;
  if (sink !== null && isSink(sink)) c.sink = sink;
  if (trail !== null && isTrail(trail)) c.trail = trail;
  if (bonds !== null && isBonds(bonds)) c.bonds = bonds;
  const seed = linkInt(q.get('seed'), 0, SEED_MAX);
  if (seed !== undefined) c.seed = seed;
  return c;
}

/** The link parameters for a choice, defaults left out (so the default choice is the bare page, and old links keep their meaning). */
export function choiceQuery(c: Choice): URLSearchParams {
  const q = new URLSearchParams();
  for (const k of ['size', 'seed', 'sink', 'trail', 'bonds'] as const) if (c[k] !== DEFAULT_CHOICE[k]) q.set(k, String(c[k]));
  return q;
}

/** The ways of drawing the jar, in menu order: page.ts builds its menu from these ids (the first is the default). */
export const VIEW_IDS = ['particles', 'raymarch', 'slices'] as const;
export type ViewId = (typeof VIEW_IDS)[number];
export const isView = (v: string): v is ViewId => (VIEW_IDS as readonly string[]).includes(v);
/** The depth stretch slider's range (index.html #stretch). */
export const STRETCH_RANGE = { min: 1, max: 4 } as const;

/** The config for a choice. The default world is defaultConfig itself; bigger worlds keep the founders and the room per cell. */
export function worldConfig(c: Choice): Mycelium3dConfig {
  const [width, height, depth] = SIZES[c.size].dims;
  const k = (width * height * depth) / BASE_CELLS;
  const over: Partial<Mycelium3dConfig> = { seed: c.seed >>> 0, ...TRAILS[c.trail].delta, ...BONDS[c.bonds].delta };
  if (k !== 1) Object.assign(over, { width, height, depth, founders: Math.round(1024 * k), maxParticles: Math.min(PARTICLE_CAP, Math.round(8192 * k)) });
  const shift = SINKS[c.sink].shift;
  if (shift !== undefined) over.sinkShift = shift;
  return defaultConfig(over);
}

/** Which choice a config came from, as plain words (status lines and tests). Without bonds the words are as before bonds existed. */
export function describeChoice(c: Choice): string {
  const bonds = c.bonds === 'upkeep' ? ', bonds with upkeep' : c.bonds === 'free' ? ', bonds free' : '';
  return `${SIZES[c.size].dims.join(' × ')}, seed ${c.seed}, sinking ${c.sink}, trail rule ${c.trail === 'none' ? 'none' : c.trail === 'toll' ? 'toll road' : 'owner conduit with gate'}${bonds}`;
}
