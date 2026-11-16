// The /mycelium3d/ page's choices: world size, sinking and trail rule, each with plain words for what differs and why it
// matters, and the one function that turns a choice into a config. Pure, no DOM; the test
// checks that every combination validates (apps/lab/test/mycelium3d-pack.test.ts). Optional rule keys are left out of the config when unused (never set to
// undefined), so the default choice is defaultConfig() itself and its digests match tools/mycelium3d/run.ts.
import { defaultConfig, type Mycelium3dConfig } from '../../../../tools/mycelium3d/world.ts';

export type SizeId = '32x32x16' | '64x64x32' | '64x64x64';
export type Sink = 'off' | 'slow' | 'fast';
export type Trail = 'none' | 'toll' | 'owner';

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
    text: 'Moving costs six times the usual energy, but a particle that is laying trail pays much less for moving through a cell that already holds a little trail (on all three axes). In the flat world this kept trail but nothing was found using it. The strengths were sized in the flat world, not here.',
  },
  owner: {
    delta: { trailOwner: 'gid', ownerDefend: 4, ownerConduit: 30 },
    title: 'owner conduit with gate: a family’s own trail pipes food to it',
    text: 'Trail remembers which family laid it. A cell held by another family with at least 4 units of its trail is closed to my eating (the gate), and nutrient flows faster between two neighbouring cells only when the same family owns both (the conduit, up and down as well as sideways). In the flat world this pairing, without the toll, kept trail in 6 of 8 worlds: the open lead. Theta 4 and strength 30 were sized in the flat world, not here.',
  },
};

export const isSize = (v: string): v is SizeId => Object.hasOwn(SIZES, v);
export const isSink = (v: string): v is Sink => Object.hasOwn(SINKS, v);
export const isTrail = (v: string): v is Trail => Object.hasOwn(TRAILS, v);

export interface Choice { size: SizeId; seed: number; sink: Sink; trail: Trail }
export const DEFAULT_CHOICE: Choice = { size: '32x32x16', seed: 1, sink: 'off', trail: 'none' };

/** The config for a choice. The default world is defaultConfig itself; bigger worlds keep the founders and the room per cell. */
export function worldConfig(c: Choice): Mycelium3dConfig {
  const [width, height, depth] = SIZES[c.size].dims;
  const k = (width * height * depth) / BASE_CELLS;
  const over: Partial<Mycelium3dConfig> = { seed: c.seed >>> 0, ...TRAILS[c.trail].delta };
  if (k !== 1) Object.assign(over, { width, height, depth, founders: Math.round(1024 * k), maxParticles: Math.min(PARTICLE_CAP, Math.round(8192 * k)) });
  const shift = SINKS[c.sink].shift;
  if (shift !== undefined) over.sinkShift = shift;
  return defaultConfig(over);
}

/** Which choice a config came from, as plain words (status lines and tests). */
export function describeChoice(c: Choice): string {
  return `${SIZES[c.size].dims.join(' × ')}, seed ${c.seed}, sinking ${c.sink}, trail rule ${c.trail === 'none' ? 'none' : c.trail === 'toll' ? 'toll road' : 'owner conduit with gate'}`;
}
