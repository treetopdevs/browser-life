/**
 * Pure 3D camera, projection, and snapshot layout for Soft Roam's tilted tank view.
 * No DOM or WebGL dependencies so every projection and packing invariant can be unit-tested.
 *
 * World coordinate system:
 * - Floor lies in the XZ plane: x in [0, 1], z in [0, 1], y = 0.
 * - Elevation is +y: y in [0, tankHeight], where 0 is the floor and tankHeight is the surface.
 * - Matrices are column-major with WebGL clip z in [-1, 1].
 */

export type TankProjection = 'perspective' | 'ortho';
export type TankPreset = 'tilted' | 'iso' | 'side' | 'top';

export interface TankCameraPose {
  yaw: number;
  pitch: number;
  dist: number;
  projection: TankProjection;
}

/** True isometric pitch: asin(tan(30 deg)) = atan(1 / sqrt(2)) ~= 35.264 deg. */
export const ISO_PITCH = Math.atan(Math.SQRT1_2);

export const TANK_PRESETS: Record<TankPreset, { label: string; pose: TankCameraPose }> = {
  tilted: { label: 'Tilted', pose: { yaw: 0.44, pitch: 0.58, dist: 1.55, projection: 'perspective' } },
  iso: { label: 'Isometric', pose: { yaw: Math.PI / 4, pitch: ISO_PITCH, dist: 1.55, projection: 'ortho' } },
  side: { label: 'Side', pose: { yaw: 0.26, pitch: 0.16, dist: 1.6, projection: 'perspective' } },
  top: { label: 'Top', pose: { yaw: 0, pitch: 1.52, dist: 1.45, projection: 'ortho' } },
};

export const TANK_DIST_MIN = 0.45;
export const TANK_DIST_MAX = 3.6;
export const TANK_PITCH_MIN = 0.06;
export const TANK_PITCH_MAX = Math.PI / 2 - 0.03;

/** Floats per packed cell in TankSnapshot.cells: [x, y, z, rad, r, g, b, shell, glow, dim]. */
export const TANK_CELL_STRIDE = 10;
/** Floats per packed mother-daughter bond in TankSnapshot.links: [x0, y0, z0, x1, y1, z1, intensity]. */
export const TANK_LINK_STRIDE = 7;
/** Floats per packed feeding thread in TankSnapshot.threads: [x0, y0, z0, x1, y1, z1, alpha]. */
export const TANK_THREAD_STRIDE = 7;

export interface TankSnapshot {
  /** Arena side in tiles (e.g. 128). */
  size: number;
  /** Number of discrete depth levels (0 for a flat world, 2..4 for deep). */
  levels: number;
  /** Visual height of the water column in normalized tank units (floor is 1.0 x 1.0). */
  tankHeight: number;
  cellCount: number;
  cells: Float32Array;
  linkCount: number;
  links: Float32Array;
  threadCount: number;
  threads: Float32Array;
  /** size x size x 4 RGBA floor texture (food haze + daylight band). */
  floorTex: Uint8Array;
}

/** Visual height of the tank relative to the 1.0 x 1.0 floor. */
export function tankHeightFor(levels: number): number {
  if (levels <= 1) return 0.14;
  return Math.min(0.42, 0.12 + (levels - 1) * 0.1);
}

/**
 * Maps eased cell height `hNorm` in [0, 1] (0 = floor, 1 = surface) to tank y in [0, tankHeight].
 * Floor cells sit slightly above y = 0 by their radius so they rest on the floor rather than clipping through it.
 */
export function tankElevation(hNorm: number, levels: number, tankHeight: number, cellRad: number): number {
  const base = Math.max(0.004, cellRad * 0.85);
  if (levels <= 1) return base;
  const usable = Math.max(0, tankHeight - base * 2.2);
  const clamped = hNorm < 0 ? 0 : hNorm > 1 ? 1 : hNorm;
  return base + clamped * usable;
}

type V3 = [number, number, number];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export function mat4Mul(a: Float32Array, b: Float32Array): Float32Array {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!;
      o[c * 4 + r] = s;
    }
  }
  return o;
}

export function lookAt(eye: V3, target: V3, up: V3): Float32Array {
  const f = norm(sub(target, eye));
  const s = norm(cross(f, up));
  const u = cross(s, f);
  return new Float32Array([
    s[0], u[0], -f[0], 0,
    s[1], u[1], -f[1], 0,
    s[2], u[2], -f[2], 0,
    -dot(s, eye), -dot(u, eye), dot(f, eye), 1,
  ]);
}

/** Right-handed perspective matrix for WebGL clip z in [-1, 1]. */
export function perspectiveGL(fovY: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) * nf;
  m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

/** Right-handed orthographic matrix for WebGL clip z in [-1, 1]. */
export function orthoGL(left: number, right: number, bottom: number, top: number, near: number, far: number): Float32Array {
  const lr = 1 / (left - right);
  const bt = 1 / (bottom - top);
  const nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = -2 * lr;
  m[5] = -2 * bt;
  m[10] = 2 * nf;
  m[12] = (left + right) * lr;
  m[13] = (top + bottom) * bt;
  m[14] = (far + near) * nf;
  m[15] = 1;
  return m;
}

/** Project a world point (x, y, z) into normalized device coordinates [-1, 1]^3. */
export function projectPoint(vp: Float32Array, x: number, y: number, z: number): [number, number, number] {
  const cx = vp[0]! * x + vp[4]! * y + vp[8]! * z + vp[12]!;
  const cy = vp[1]! * x + vp[5]! * y + vp[9]! * z + vp[13]!;
  const cz = vp[2]! * x + vp[6]! * y + vp[10]! * z + vp[14]!;
  const cw = vp[3]! * x + vp[7]! * y + vp[11]! * z + vp[15]!;
  const inv = cw !== 0 ? 1 / cw : 1;
  return [cx * inv, cy * inv, cz * inv];
}

export interface TankCameraMatrices {
  view: Float32Array;
  proj: Float32Array;
  viewProj: Float32Array;
  eye: V3;
  right: V3;
  up: V3;
  back: V3;
  isOrtho: boolean;
}

export class TankCamera {
  yaw: number;
  pitch: number;
  dist: number;
  projection: TankProjection;
  fovY = 0.72;

  constructor(initial: TankPreset = 'tilted') {
    const p = TANK_PRESETS[initial].pose;
    this.yaw = p.yaw;
    this.pitch = p.pitch;
    this.dist = p.dist;
    this.projection = p.projection;
  }

  setPreset(preset: TankPreset): void {
    const p = TANK_PRESETS[preset].pose;
    this.yaw = p.yaw;
    this.pitch = p.pitch;
    this.dist = p.dist;
    this.projection = p.projection;
  }

  setProjection(projection: TankProjection): void {
    this.projection = projection;
  }

  orbit(dYaw: number, dPitch: number): void {
    this.yaw += dYaw;
    this.pitch = Math.max(TANK_PITCH_MIN, Math.min(TANK_PITCH_MAX, this.pitch + dPitch));
  }

  zoom(factor: number): void {
    this.dist = Math.max(TANK_DIST_MIN, Math.min(TANK_DIST_MAX, this.dist * factor));
  }

  matrices(aspect: number, tankHeight: number): TankCameraMatrices {
    const safeAspect = Math.max(0.25, aspect);
    const target: V3 = [0.5, tankHeight * 0.42, 0.5];
    const cp = Math.cos(this.pitch);
    const eye: V3 = [
      target[0] + this.dist * cp * Math.sin(this.yaw),
      target[1] + this.dist * Math.sin(this.pitch),
      target[2] + this.dist * cp * Math.cos(this.yaw),
    ];
    const worldUp: V3 = [0, 1, 0];
    const f = norm(sub(target, eye));
    const right = norm(cross(f, worldUp));
    const up = cross(right, f);
    const back: V3 = [-f[0], -f[1], -f[2]];
    const view = lookAt(eye, target, worldUp);
    const isOrtho = this.projection === 'ortho';
    let proj: Float32Array;
    if (isOrtho) {
      const halfH = this.dist * 0.48;
      const halfW = halfH * safeAspect;
      proj = orthoGL(-halfW, halfW, -halfH, halfH, -4.0, 8.0);
    } else {
      const near = Math.max(0.02, this.dist * 0.04);
      const far = this.dist + 6.0;
      proj = perspectiveGL(this.fovY, safeAspect, near, far);
    }
    const viewProj = mat4Mul(proj, view);
    return { view, proj, viewProj, eye, right, up, back, isOrtho };
  }
}
