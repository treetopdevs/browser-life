import { describe, expect, it } from 'vitest';
import { SpatialWorld } from '../src/spatial/model.ts';
import { drawSpatialWorld, isInDepthSlice, projectPoint } from '../src/spatial/render.ts';

describe('spatial projection and rendering', () => {
  it('projects genuine z changes into screen position, depth, and perspective scale', () => {
    const camera = { yaw: .65, pitch: -.35 };
    const near = projectPoint({ x: .5, y: .5, z: .8 }, camera, 600);
    const far = projectPoint({ x: .5, y: .5, z: .2 }, camera, 600);
    expect(near.depth).toBeLessThan(far.depth);
    expect(near.scale).toBeGreaterThan(far.scale);
    expect(near.x).not.toBe(far.x);
  });

  it('uses torus distance for a slice across the z seam', () => {
    expect(isInDepthSlice(.98, .02, .2)).toBe(true);
    expect(isInDepthSlice(.5, .02, .2)).toBe(false);
  });

  it('draws farther particles first without mutating world state', () => {
    const world = new SpatialWorld(1201, 'pursuit');
    world.particles = [
      { ...world.particles[0], id: 2, x: .5, y: .5, z: .8 },
      { ...world.particles[1], id: 1, x: .5, y: .5, z: .2 },
    ];
    const before = JSON.stringify(world.snapshot());
    const arcs: { x: number; y: number; radius: number }[] = [];
    const ctx = {
      clearRect() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {},
      arc(x: number, y: number, radius: number) { arcs.push({ x, y, radius }); },
      set fillStyle(_value: string) {}, set strokeStyle(_value: string) {}, set lineWidth(_value: number) {}, set globalAlpha(_value: number) {},
    } as unknown as CanvasRenderingContext2D;
    expect(drawSpatialWorld(ctx, world, 600, { yaw: .65, pitch: -.35 })).toBe(2);
    const particleArcs = arcs.slice(-2);
    expect(particleArcs[0].radius).toBeLessThan(particleArcs[1].radius);
    expect(particleArcs[0].x).not.toBe(particleArcs[1].x);
    expect(JSON.stringify(world.snapshot())).toBe(before);
    // Exercise the actual renderer filter, not only its distance helper.
    const seamParticle = { ...world.particles[0], z: .98 };
    const outsideParticle = { ...world.particles[1], z: .5 };
    arcs.length = 0;
    const camera = { yaw: .65, pitch: -.35 };
    expect(drawSpatialWorld(ctx, { particles: [seamParticle, outsideParticle], food: [] }, 600, camera, { sliceCenter: .02 })).toBe(1);
    expect(arcs).toHaveLength(1);
    const expected = projectPoint(seamParticle, camera, 600);
    expect(arcs[0].x).toBe(expected.x);
    expect(arcs[0].y).toBe(expected.y);
  });

  it('keeps identical stepped trajectories after different camera and slice renders', () => {
    const plain = new SpatialWorld(1201, 'pursuit');
    const viewed = new SpatialWorld(1201, 'pursuit');
    const arcs: { x: number; y: number; radius: number }[] = [];
    const ctx = {
      clearRect() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {},
      arc(x: number, y: number, radius: number) { arcs.push({ x, y, radius }); },
      set fillStyle(_value: string) {}, set strokeStyle(_value: string) {}, set lineWidth(_value: number) {}, set globalAlpha(_value: number) {},
    } as unknown as CanvasRenderingContext2D;
    for (let tick = 0; tick < 20; tick++) {
      plain.step(); viewed.step();
      drawSpatialWorld(ctx, viewed, 600, { yaw: tick / 5, pitch: -.35 + tick / 50 }, { sliceCenter: (tick % 100) / 100, showFood: tick % 2 === 0 });
      expect(viewed.snapshot()).toEqual(plain.snapshot());
    }
  });
});
