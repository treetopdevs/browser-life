// Orbit camera, ported from the 3D volume sandbox: pure maths, no DOM. World space is the box [0, ext] (contract.ts
// boxExtent), y up; poses name their target as a fraction of the box so one pose fits a slab and a jar alike. Matrices are
// column-major with WebGPU's 0..1 depth range, so they upload to a uniform buffer as they are.
import type { CameraInfo } from "./contract.ts";

type V3 = [number, number, number];

export function mat4Mul(a: Float32Array, b: Float32Array): Float32Array {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!;
    o[c * 4 + r] = s;
  }
  return o;
}

export function mat4Invert(m: Float32Array): Float32Array {
  const a = Array.from(m, Number);
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = a as [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return new Float32Array(16);
  const id = 1 / det;
  return new Float32Array([
    (a11 * b11 - a12 * b10 + a13 * b09) * id, (a02 * b10 - a01 * b11 - a03 * b09) * id, (a31 * b05 - a32 * b04 + a33 * b03) * id, (a22 * b04 - a21 * b05 - a23 * b03) * id,
    (a12 * b08 - a10 * b11 - a13 * b07) * id, (a00 * b11 - a02 * b08 + a03 * b07) * id, (a32 * b02 - a30 * b05 - a33 * b01) * id, (a20 * b05 - a22 * b02 + a23 * b01) * id,
    (a10 * b10 - a11 * b08 + a13 * b06) * id, (a01 * b08 - a00 * b10 - a03 * b06) * id, (a30 * b04 - a31 * b02 + a33 * b00) * id, (a21 * b02 - a20 * b04 - a23 * b00) * id,
    (a11 * b07 - a10 * b09 - a12 * b06) * id, (a00 * b09 - a01 * b07 + a02 * b06) * id, (a31 * b01 - a30 * b03 - a32 * b00) * id, (a20 * b03 - a21 * b01 + a22 * b00) * id,
  ]);
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export function lookAt(eye: V3, target: V3, up: V3): Float32Array {
  const f = norm(sub(target, eye));
  const s = norm(cross(f, up));
  const u = cross(s, f);
  return new Float32Array([s[0], u[0], -f[0], 0, s[1], u[1], -f[1], 0, s[2], u[2], -f[2], 0, -dot(s, eye), -dot(u, eye), dot(f, eye), 1]);
}

/** Right-handed, looking down -z, clip z in 0..1. */
export function perspective(fovY: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = far / (near - far);
  m[11] = -1;
  m[14] = (far * near) / (near - far);
  return m;
}

export interface CameraPose {
  yaw: number;
  pitch: number;
  /** Distance from the target, in units of the box's longest side (1). */
  dist: number;
  /** The point looked at, as a fraction of the box on each axis. */
  targetFrac: V3;
}

export const PRESETS: Record<string, { label: string; hint: string; pose: CameraPose }> = {
  oblique: { label: "Above, at an angle", hint: "Looking down at the surface from the side: the canopy on top and its edge, where the lower layers show.", pose: { yaw: 0.6, pitch: 0.62, dist: 1.45, targetFrac: [0.5, 0.5, 0.5] } },
  above: { label: "Straight down", hint: "Looking down from the sun: sees the surface as the light does, like the top-down view.", pose: { yaw: 0, pitch: 1.5, dist: 1.6, targetFrac: [0.5, 0.5, 0.5] } },
  side: { label: "Level with the sheet", hint: "Edge on: every layer stacked from the surface (top) to the floor (bottom), the best view of depth.", pose: { yaw: 0.6, pitch: 0.12, dist: 1.6, targetFrac: [0.5, 0.5, 0.5] } },
  below: { label: "From below", hint: "Looking up through the floor: lineages show against the bright surface.", pose: { yaw: 0.6, pitch: -0.7, dist: 1.75, targetFrac: [0.5, 0.5, 0.5] } },
};

export const DIST_MIN = 0.08;
export const DIST_MAX = 6;
export const PITCH_LIMIT = Math.PI / 2 - 0.02;

export class OrbitCamera {
  yaw = 0.6;
  pitch = 0.62;
  dist = 1.45;
  target: V3 = [0.5, 0.5, 0.5];
  fovY = 0.8;
  /** World-space size of the box the poses refer to. */
  ext: V3 = [1, 1, 1];

  /** Sets the box; keeps the target at the same fraction of it. */
  setBox(ext: readonly number[]) {
    const f = this.target.map((t, i) => t / (this.ext[i] || 1)) as V3;
    this.ext = [ext[0]!, ext[1]!, ext[2]!];
    this.target = f.map((v, i) => v * this.ext[i]!) as V3;
  }

  setPose(p: CameraPose) {
    this.yaw = p.yaw;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, p.pitch));
    this.dist = Math.max(DIST_MIN, Math.min(DIST_MAX, p.dist));
    this.target = p.targetFrac.map((v, i) => v * this.ext[i]!) as V3;
  }

  orbit(dYaw: number, dPitch: number) {
    this.yaw += dYaw;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch + dPitch));
  }

  /** factor > 1 moves away. */
  zoom(factor: number) {
    this.dist = Math.max(DIST_MIN, Math.min(DIST_MAX, this.dist * factor));
  }

  /** dx, dy in screen units of the view plane at the target, i.e. fractions of the view height. */
  pan(dx: number, dy: number) {
    const { eye } = this.vectors();
    const f = norm(sub(this.target, eye));
    const s = norm(cross(f, [0, 1, 0]));
    const u = cross(s, f);
    const k = 2 * Math.tan(this.fovY / 2) * this.dist;
    for (let i = 0; i < 3; i++) this.target[i] = Math.max(-1, Math.min(2, this.target[i]! - s[i]! * dx * k + u[i]! * dy * k));
  }

  /** `fit` > 1 backs the eye off along the same direction (narrow views), without changing the stored distance. */
  private vectors(fit = 1): { eye: V3 } {
    const cp = Math.cos(this.pitch);
    const d = this.dist * fit;
    const eye: V3 = [this.target[0] + d * cp * Math.sin(this.yaw), this.target[1] + d * Math.sin(this.pitch), this.target[2] + d * cp * Math.cos(this.yaw)];
    return { eye };
  }

  /** A view narrower than 1.3 : 1 backs off, so a phone's square canvas frames the box as a wide one does. */
  info(aspect: number): CameraInfo {
    const fit = Math.max(1, 1.3 / aspect);
    const { eye } = this.vectors(fit);
    const up: V3 = [0, 1, 0];
    const near = Math.max(0.005, this.dist * 0.02);
    const view = lookAt(eye, this.target, up);
    const proj = perspective(this.fovY, aspect, near, this.dist * fit + 6); // the eye sits at dist * fit, so the far plane follows it
    const viewProj = mat4Mul(proj, view);
    return { eye, target: [...this.target], up, fovY: this.fovY, aspect, view, proj, viewProj, invViewProj: mat4Invert(viewProj) };
  }
}
