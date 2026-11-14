// The view onto the world: one transform shared by both painters, the pointer mapping and the overlay.
// z is the zoom over "fit" (the whole world fills the square canvas, z = 1); (cx, cy) is the world point, in
// cells, at the middle of the canvas. The view is clamped to the world: the rules wrap at the edges, the picture does not.
export interface View { z: number; cx: number; cy: number }

/** The most the view magnifies: this many CSS pixels per cell. */
export const MAX_CELL_PX = 56;
export const ZOOM_STEP = 1.25;

export const fitView = (world: number): View => ({ z: 1, cx: world / 2, cy: world / 2 });
/** CSS pixels per cell at zoom 1, for a canvas `css` CSS pixels wide. */
export const fitScale = (world: number, css: number) => css / world;
export const maxZoom = (world: number, css: number) => Math.max(1, MAX_CELL_PX / fitScale(world, css));
/** CSS pixels per cell under this view. */
export const scaleOf = (v: View, world: number, css: number) => fitScale(world, css) * v.z;

export function clampView(v: View, world: number, css: number): View {
  const z = Math.min(maxZoom(world, css), Math.max(1, v.z));
  const half = css / (2 * fitScale(world, css) * z);
  const lo = half, hi = world - half;
  return { z, cx: lo >= hi ? world / 2 : Math.min(hi, Math.max(lo, v.cx)), cy: lo >= hi ? world / 2 : Math.min(hi, Math.max(lo, v.cy)) };
}

/** World point (cells) under a canvas-relative CSS pixel. */
export function toWorld(v: View, world: number, css: number, px: number, py: number): { x: number; y: number } {
  const s = scaleOf(v, world, css);
  return { x: v.cx + (px - css / 2) / s, y: v.cy + (py - css / 2) / s };
}

/** Canvas-relative CSS pixel of a world point (cells). */
export function toScreen(v: View, world: number, css: number, x: number, y: number): { x: number; y: number } {
  const s = scaleOf(v, world, css);
  return { x: css / 2 + (x - v.cx) * s, y: css / 2 + (y - v.cy) * s };
}

/** Multiply the zoom by `factor`, keeping the world point under pixel (px, py) where it is. */
export function zoomAt(v: View, world: number, css: number, factor: number, px: number, py: number): View {
  const before = toWorld(v, world, css, px, py);
  const z = Math.min(maxZoom(world, css), Math.max(1, v.z * factor));
  const next = { z, cx: v.cx, cy: v.cy };
  const s = scaleOf(next, world, css);
  next.cx = before.x - (px - css / 2) / s;
  next.cy = before.y - (py - css / 2) / s;
  return clampView(next, world, css);
}

/** Move the view by a drag of (dx, dy) CSS pixels: the world follows the pointer. */
export function panBy(v: View, world: number, css: number, dx: number, dy: number): View {
  const s = scaleOf(v, world, css);
  return clampView({ z: v.z, cx: v.cx - dx / s, cy: v.cy - dy / s }, world, css);
}

/** A two-finger gesture: zoom by `factor` about the fingers' previous midpoint, then move that point to the new midpoint, so each finger stays on the world point it started on. */
export function pinchView(v: View, world: number, css: number, factor: number, prev: { x: number; y: number }, next: { x: number; y: number }): View {
  return panBy(zoomAt(v, world, css, factor, prev.x, prev.y), world, css, next.x - prev.x, next.y - prev.y);
}
