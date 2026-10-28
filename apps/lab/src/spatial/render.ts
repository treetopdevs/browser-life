import type { Particle, SpatialWorld } from './model.ts';
import { torusDelta } from './model.ts';

export interface Camera { yaw: number; pitch: number }
export interface SpatialViewOptions {
  showFood?: boolean;
  sliceCenter?: number | null;
  sliceThickness?: number;
}
export interface ProjectedPoint { x: number; y: number; depth: number; scale: number }

const FAMILY_COLORS = ['#91e1c0', '#f2be78', '#b5adf2'] as const;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** Perspective projection of a unit-torus coordinate into a square viewport. */
export function projectPoint(point: Pick<Particle, 'x' | 'y' | 'z'>, camera: Camera, size: number): ProjectedPoint {
  const dx = point.x - .5, dy = point.y - .5, dz = point.z - .5;
  const cy = Math.cos(camera.yaw), sy = Math.sin(camera.yaw);
  const cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch);
  const xYaw = cy * dx + sy * dz;
  const zYaw = -sy * dx + cy * dz;
  const yRot = cp * dy - sp * zYaw;
  const zRot = sp * dy + cp * zYaw;
  const depth = 2.5 - zRot;
  const scale = 1 / (2 * Math.tan(Math.PI / 8) * depth);
  const extent = size * .82;
  return { x: size / 2 + xYaw * scale * extent, y: size / 2 - yRot * scale * extent, depth, scale };
}

export function isInDepthSlice(z: number, center: number, thickness = .2): boolean {
  return Math.abs(torusDelta(z - center)) <= thickness / 2;
}

/** Draws a wire cube and the supplied 3D positions without changing world state. */
export function drawSpatialWorld(
  ctx: CanvasRenderingContext2D,
  world: Pick<SpatialWorld, 'particles' | 'food'>,
  size: number,
  camera: Camera,
  options: SpatialViewOptions = {},
): number {
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#08151c'; ctx.fillRect(0, 0, size, size);
  const corners = Array.from({ length: 8 }, (_, index) => ({ x: index & 1 ? 1 : 0, y: index & 2 ? 1 : 0, z: index & 4 ? 1 : 0 }))
    .map(point => projectPoint(point, camera, size));
  ctx.strokeStyle = '#52666b'; ctx.globalAlpha = .65; ctx.lineWidth = Math.max(1, size * .002);
  ctx.beginPath();
  for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) if (!(i & bit)) {
    const a = corners[i], b = corners[i | bit]; ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  }
  ctx.stroke(); ctx.globalAlpha = 1;

  if (options.showFood) for (const patch of world.food) {
    const point = projectPoint(patch, camera, size);
    if (point.depth <= .1) continue;
    const radius = clamp(size * .006 * 2.5 / point.depth, 2, size * .018);
    ctx.beginPath(); ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#a9f0b8'; ctx.globalAlpha = .8; ctx.fill();
    ctx.strokeStyle = '#d4ffd6'; ctx.lineWidth = Math.max(1, size * .0015); ctx.stroke(); ctx.globalAlpha = 1;
  }

  const visible = options.sliceCenter === undefined || options.sliceCenter === null
    ? world.particles
    : world.particles.filter(particle => isInDepthSlice(particle.z, options.sliceCenter!, options.sliceThickness ?? .2));
  const projected = visible.map(particle => ({ particle, point: projectPoint(particle, camera, size) }))
    .filter(entry => entry.point.depth > .1)
    .sort((a, b) => b.point.depth - a.point.depth || a.particle.id - b.particle.id);
  for (const { particle, point } of projected) {
    const radius = clamp(size * .0065 * 2.5 / point.depth, 1.8, size * .014);
    ctx.beginPath(); ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = FAMILY_COLORS[particle.family];
    ctx.globalAlpha = clamp(.96 - (point.depth - 1.9) * .13, .55, .96); ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = '#061014'; ctx.lineWidth = Math.max(1, size * .0015); ctx.stroke();
  }
  return projected.length;
}

export const SPATIAL_FAMILY_COLORS = FAMILY_COLORS;
