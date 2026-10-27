import type { BondRecord } from './bonded-model.ts';
import type { Particle } from './model.ts';
import { torusDelta } from './model.ts';

export interface BondOverlayView {
  readonly mode: 'none' | 'chains' | 'mesh';
  readonly bonds: readonly BondRecord[];
  readonly particles: readonly Particle[];
}

/** Draw shortest torus routes as clipped edge fragments when a bond crosses a seam. */
export function drawBondOverlay(ctx: CanvasRenderingContext2D, world: BondOverlayView, size: number) {
  if (world.mode === 'none' || world.bonds.length === 0) return;
  const particles = new Map(world.particles.map(particle => [particle.id, particle]));
  ctx.save();
  ctx.strokeStyle = '#f2d18b';
  ctx.globalAlpha = .58;
  ctx.lineWidth = Math.max(1, size * .0017);
  ctx.beginPath();
  for (const bond of world.bonds) {
    const a = particles.get(bond.a), b = particles.get(bond.b);
    if (!a || !b) continue;
    const x1 = a.x * size, y1 = a.y * size;
    const x2 = (a.x + torusDelta(b.x - a.x)) * size;
    const y2 = (a.y + torusDelta(b.y - a.y)) * size;
    // Repeating the short segment in neighboring tiles leaves the canvas clip to
    // expose the correct fragment on each side of a torus boundary.
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      ctx.moveTo(x1 + ox, y1 + oy);
      ctx.lineTo(x2 + ox, y2 + oy);
    }
  }
  ctx.stroke();
  ctx.restore();
}
