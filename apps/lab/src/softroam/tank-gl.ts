/**
 * WebGL2 3D tilted-tank renderer for Soft Roam (/softroam/).
 *
 * Renders the arena as a foreshortened aquarium box [0, 1] x [0, tankHeight] x [0, 1]:
 * 1. Deep-water backdrop gradient.
 * 2. Foreshortened floor plane textured with food haze + daylight band and a subtle 16-tile grid.
 * 3. Soft projected shadows clipped cleanly to the floor under every cell.
 * 4. Instanced 3D sphere impostors with exact per-fragment ray-sphere intersection (perspective)
 *    or orthographic hemisphere depth (ortho) and gl_FragDepth so overlapping cells intersect cleanly.
 * 5. Depth-tested 3D elevation stems, mother-daughter strands, and feeding threads.
 * 6. Glass tank wireframe, level guide rings, and translucent water-surface sheen.
 *
 * Uploads cell/line/floor GPU buffers only when a new TankSnapshot arrives; camera-only redraws
 * (orbit, zoom, presets) reuse the uploaded buffers and cached uniform locations.
 */

import { TANK_CELL_STRIDE, TANK_LINK_STRIDE, TANK_THREAD_STRIDE, type TankCamera, type TankSnapshot } from './tank-math.ts';

const BACKDROP_VS = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID & 1) == 0 ? -1.0 : 3.0, (gl_VertexID & 2) == 0 ? -1.0 : 3.0);
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.999, 1.0);
}`;

const BACKDROP_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec3 bot = vec3(0.018, 0.028, 0.052);
  vec3 top = vec3(0.042, 0.072, 0.125);
  float t = smoothstep(0.0, 1.0, vUv.y);
  fragColor = vec4(mix(bot, top, t), 1.0);
}`;

const FLOOR_VS = `#version 300 es
layout(location = 0) in vec2 aPos;
uniform mat4 uViewProj;
out vec2 vUv;
void main() {
  vUv = aPos;
  gl_Position = uViewProj * vec4(aPos.x, 0.0, aPos.y, 1.0);
}`;

const FLOOR_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uFloorTex;
uniform float uLevels;
out vec4 fragColor;
void main() {
  vec3 base = texture(uFloorTex, vUv).rgb;
  vec3 col = base + vec3(0.025, 0.036, 0.052);
  vec2 g = abs(fract(vUv * 8.0 - 0.5) - 0.5) / max(fwidth(vUv * 8.0), vec2(0.001));
  float line = 1.0 - min(min(g.x, g.y), 1.0);
  float gridAlpha = uLevels > 0.5 ? 0.14 : 0.11;
  col = mix(col, vec3(0.28, 0.42, 0.58), line * gridAlpha);
  vec2 edgeDist = min(vUv, 1.0 - vUv);
  float rim = 1.0 - smoothstep(0.0, 0.008, min(edgeDist.x, edgeDist.y));
  col = mix(col, vec3(0.36, 0.54, 0.72), rim * 0.35);
  fragColor = vec4(col, 1.0);
}`;

const SHADOW_VS = `#version 300 es
layout(location = 0) in vec2 aQuad;
layout(location = 1) in vec4 aPosRad; // x, y, z, rad
uniform mat4 uViewProj;
uniform float uTankH;
out vec2 vUv;
out vec2 vWorldXZ;
out float vAlpha;
void main() {
  float h = clamp(aPosRad.y / max(uTankH, 0.001), 0.0, 1.0);
  float r = aPosRad.w * (1.25 + 0.9 * h);
  vec3 p = vec3(aPosRad.x + aQuad.x * r, 0.0012, aPosRad.z + aQuad.y * r);
  vUv = aQuad;
  vWorldXZ = p.xz;
  vAlpha = 0.22 + 0.38 * h;
  gl_Position = uViewProj * vec4(p, 1.0);
}`;

const SHADOW_FS = `#version 300 es
precision highp float;
in vec2 vUv;
in vec2 vWorldXZ;
in float vAlpha;
out vec4 fragColor;
void main() {
  if (vWorldXZ.x < 0.0 || vWorldXZ.x > 1.0 || vWorldXZ.y < 0.0 || vWorldXZ.y > 1.0) discard;
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0) discard;
  float soft = (1.0 - r2);
  fragColor = vec4(0.006, 0.01, 0.02, soft * soft * vAlpha);
}`;

const LINE_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec4 aCol;
uniform mat4 uViewProj;
out vec4 vCol;
void main() {
  vCol = aCol;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

const LINE_FS = `#version 300 es
precision highp float;
in vec4 vCol;
out vec4 fragColor;
void main() {
  fragColor = vCol;
}`;

const SPHERE_VS = `#version 300 es
layout(location = 0) in vec2 aQuad;
layout(location = 1) in vec4 aPosRad;  // x, y, z, rad
layout(location = 2) in vec4 aColShl;  // r, g, b, shell
layout(location = 3) in vec2 aGlowDim; // glow, dim
uniform mat4 uViewProj;
uniform vec3 uRight;
uniform vec3 uUp;
uniform float uIsOrtho;
out vec2 vUv;
out vec3 vWorldPos;
flat out vec3 vCenter;
flat out float vRad;
flat out vec3 vCol;
flat out float vShell;
flat out float vGlow;
flat out float vDim;
void main() {
  vec3 c = aPosRad.xyz;
  float r = aPosRad.w;
  // Slightly wider billboard in perspective so off-axis ray-sphere silhouettes never clip.
  float pad = uIsOrtho > 0.5 ? 1.04 : 1.32;
  vec3 worldPos = c + (uRight * aQuad.x + uUp * aQuad.y) * (r * pad);
  vUv = aQuad * pad;
  vWorldPos = worldPos;
  vCenter = c;
  vRad = r;
  vCol = aColShl.rgb;
  vShell = aColShl.a;
  vGlow = aGlowDim.x;
  vDim = aGlowDim.y;
  gl_Position = uViewProj * vec4(worldPos, 1.0);
}`;

const SPHERE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
in vec3 vWorldPos;
flat in vec3 vCenter;
flat in float vRad;
flat in vec3 vCol;
flat in float vShell;
flat in float vGlow;
flat in float vDim;
uniform mat4 uViewProj;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uBack;
uniform vec3 uEye;
uniform float uIsOrtho;
out vec4 fragColor;
void main() {
  vec3 p;
  vec3 n;
  vec3 V;
  if (uIsOrtho > 0.5) {
    float r2 = dot(vUv, vUv);
    if (r2 > 1.0) discard;
    float nz = sqrt(1.0 - r2);
    n = normalize(uRight * vUv.x + uUp * vUv.y + uBack * nz);
    p = vCenter + n * vRad;
    V = normalize(uBack);
  } else {
    // Exact perspective ray-sphere intersection so off-axis silhouettes and gl_FragDepth are geometrically exact.
    vec3 rd = normalize(vWorldPos - uEye);
    vec3 oc = uEye - vCenter;
    float b = dot(oc, rd);
    float c = dot(oc, oc) - vRad * vRad;
    float disc = b * b - c;
    if (disc < 0.0) discard;
    float t = -b - sqrt(disc);
    if (t <= 0.0) discard;
    p = uEye + rd * t;
    n = normalize(p - vCenter);
    V = -rd;
  }

  vec4 clip = uViewProj * vec4(p, 1.0);
  float ndcZ = clip.z / clip.w;
  gl_FragDepth = ndcZ * 0.5 + 0.5;

  vec3 sunDir = normalize(vec3(0.28, 0.92, 0.25));
  float wrap = clamp((dot(n, sunDir) + 0.42) / 1.42, 0.0, 1.0);
  vec3 hemi = mix(vec3(0.08, 0.11, 0.18), vec3(0.36, 0.44, 0.56), n.y * 0.5 + 0.5);
  vec3 lit = vCol * (vec3(1.05, 1.0, 0.92) * wrap * 0.92 + hemi * 0.65);

  vec3 H = normalize(sunDir + V);
  float specPow = mix(24.0, 42.0, vShell);
  float spec = pow(max(dot(n, H), 0.0), specPow) * mix(0.22, 0.42, vShell);
  lit += vec3(0.96, 0.94, 0.88) * spec;

  float rim = pow(1.0 - max(dot(n, V), 0.0), 2.4);
  vec3 rimCol = mix(vCol * 0.85 + vec3(0.18), vec3(0.95, 0.91, 0.76), vShell * 0.75);
  lit += rimCol * rim * (0.42 + 0.25 * vShell + 0.35 * vGlow);

  vec3 waterTint = vec3(0.84, 0.93, 1.0);
  lit *= mix(waterTint * 0.72, vec3(1.0), vDim);

  vec3 outCol = pow(clamp(lit, 0.0, 1.5), vec3(0.8));
  fragColor = vec4(clamp(outCol, 0.0, 1.0), 1.0);
}`;

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('Could not allocate WebGL2 shader');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(sh) ?? 'unknown shader error';
    gl.deleteShader(sh);
    throw new Error(`WebGL2 shader compile failed: ${info}`);
  }
  return sh;
}

function linkProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  if (!prog) throw new Error('Could not allocate WebGL2 program');
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(prog) ?? 'unknown link error';
    gl.deleteProgram(prog);
    throw new Error(`WebGL2 program link failed: ${info}`);
  }
  return prog;
}

function buildTankBoxLines(tankH: number, levels: number): Float32Array {
  const out: number[] = [];
  const push = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r: number, g: number, b: number, a: number): void => {
    out.push(x0, y0, z0, r, g, b, a, x1, y1, z1, r, g, b, a);
  };
  const edgeR = 0.45, edgeG = 0.68, edgeB = 0.88;
  push(0, 0, 0, 1, 0, 0, edgeR, edgeG, edgeB, 0.55);
  push(1, 0, 0, 1, 0, 1, edgeR, edgeG, edgeB, 0.55);
  push(1, 0, 1, 0, 0, 1, edgeR, edgeG, edgeB, 0.55);
  push(0, 0, 1, 0, 0, 0, edgeR, edgeG, edgeB, 0.55);
  push(0, tankH, 0, 1, tankH, 0, edgeR, edgeG, edgeB, 0.48);
  push(1, tankH, 0, 1, tankH, 1, edgeR, edgeG, edgeB, 0.48);
  push(1, tankH, 1, 0, tankH, 1, edgeR, edgeG, edgeB, 0.48);
  push(0, tankH, 1, 0, tankH, 0, edgeR, edgeG, edgeB, 0.48);
  for (const [cx, cz] of [[0, 0], [1, 0], [1, 1], [0, 1]] as const) {
    push(cx, 0, cz, cx, tankH, cz, edgeR, edgeG, edgeB, 0.42);
  }
  if (levels >= 2) {
    for (let k = 1; k < levels - 1; k++) {
      const ly = (k / (levels - 1)) * tankH;
      const a = 0.22;
      push(0, ly, 0, 1, ly, 0, 0.48, 0.72, 0.92, a);
      push(1, ly, 0, 1, ly, 1, 0.48, 0.72, 0.92, a);
      push(1, ly, 1, 0, ly, 1, 0.48, 0.72, 0.92, a);
      push(0, ly, 1, 0, ly, 0, 0.48, 0.72, 0.92, a);
    }
  }
  return new Float32Array(out);
}

function buildSurfaceQuad(tankH: number): Float32Array {
  const r = 0.25, g = 0.55, b = 0.85, a = 0.055;
  return new Float32Array([
    0, tankH, 0, r, g, b, a,
    1, tankH, 0, r, g, b, a,
    1, tankH, 1, r, g, b, a,
    0, tankH, 0, r, g, b, a,
    1, tankH, 1, r, g, b, a,
    0, tankH, 1, r, g, b, a,
  ]);
}

interface GLResources {
  backdropProg: WebGLProgram;
  floorProg: WebGLProgram;
  shadowProg: WebGLProgram;
  lineProg: WebGLProgram;
  sphereProg: WebGLProgram;
  uFloorVP: WebGLUniformLocation | null;
  uFloorTex: WebGLUniformLocation | null;
  uFloorLevels: WebGLUniformLocation | null;
  uShadowVP: WebGLUniformLocation | null;
  uShadowTankH: WebGLUniformLocation | null;
  uLineVP: WebGLUniformLocation | null;
  uSphereVP: WebGLUniformLocation | null;
  uSphereRight: WebGLUniformLocation | null;
  uSphereUp: WebGLUniformLocation | null;
  uSphereBack: WebGLUniformLocation | null;
  uSphereEye: WebGLUniformLocation | null;
  uSphereIsOrtho: WebGLUniformLocation | null;
  emptyVao: WebGLVertexArrayObject;
  floorVao: WebGLVertexArrayObject;
  floorBuf: WebGLBuffer;
  floorTex: WebGLTexture;
  quadBuf: WebGLBuffer;
  cellBuf: WebGLBuffer;
  shadowVao: WebGLVertexArrayObject;
  sphereVao: WebGLVertexArrayObject;
  lineVao: WebGLVertexArrayObject;
  lineBuf: WebGLBuffer;
  boxVao: WebGLVertexArrayObject;
  boxBuf: WebGLBuffer;
  surfaceVao: WebGLVertexArrayObject;
  surfaceBuf: WebGLBuffer;
}

function createResources(gl: WebGL2RenderingContext): GLResources {
  const backdropProg = linkProgram(gl, BACKDROP_VS, BACKDROP_FS);
  const floorProg = linkProgram(gl, FLOOR_VS, FLOOR_FS);
  const shadowProg = linkProgram(gl, SHADOW_VS, SHADOW_FS);
  const lineProg = linkProgram(gl, LINE_VS, LINE_FS);
  const sphereProg = linkProgram(gl, SPHERE_VS, SPHERE_FS);

  const emptyVao = gl.createVertexArray()!;

  const floorVao = gl.createVertexArray()!;
  const floorBuf = gl.createBuffer()!;
  gl.bindVertexArray(floorVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, floorBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const floorTex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, floorTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const quadBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);

  const cellBuf = gl.createBuffer()!;
  const strideBytes = TANK_CELL_STRIDE * 4;

  const shadowVao = gl.createVertexArray()!;
  gl.bindVertexArray(shadowVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, cellBuf);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, strideBytes, 0);
  gl.vertexAttribDivisor(1, 1);

  const sphereVao = gl.createVertexArray()!;
  gl.bindVertexArray(sphereVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, cellBuf);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, strideBytes, 0);
  gl.vertexAttribDivisor(1, 1);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 4, gl.FLOAT, false, strideBytes, 16);
  gl.vertexAttribDivisor(2, 1);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 2, gl.FLOAT, false, strideBytes, 32);
  gl.vertexAttribDivisor(3, 1);

  const lineVao = gl.createVertexArray()!;
  const lineBuf = gl.createBuffer()!;
  gl.bindVertexArray(lineVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);

  const boxVao = gl.createVertexArray()!;
  const boxBuf = gl.createBuffer()!;
  gl.bindVertexArray(boxVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, boxBuf);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);

  const surfaceVao = gl.createVertexArray()!;
  const surfaceBuf = gl.createBuffer()!;
  gl.bindVertexArray(surfaceVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, surfaceBuf);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);

  gl.bindVertexArray(null);

  return {
    backdropProg,
    floorProg,
    shadowProg,
    lineProg,
    sphereProg,
    uFloorVP: gl.getUniformLocation(floorProg, 'uViewProj'),
    uFloorTex: gl.getUniformLocation(floorProg, 'uFloorTex'),
    uFloorLevels: gl.getUniformLocation(floorProg, 'uLevels'),
    uShadowVP: gl.getUniformLocation(shadowProg, 'uViewProj'),
    uShadowTankH: gl.getUniformLocation(shadowProg, 'uTankH'),
    uLineVP: gl.getUniformLocation(lineProg, 'uViewProj'),
    uSphereVP: gl.getUniformLocation(sphereProg, 'uViewProj'),
    uSphereRight: gl.getUniformLocation(sphereProg, 'uRight'),
    uSphereUp: gl.getUniformLocation(sphereProg, 'uUp'),
    uSphereBack: gl.getUniformLocation(sphereProg, 'uBack'),
    uSphereEye: gl.getUniformLocation(sphereProg, 'uEye'),
    uSphereIsOrtho: gl.getUniformLocation(sphereProg, 'uIsOrtho'),
    emptyVao,
    floorVao,
    floorBuf,
    floorTex,
    quadBuf,
    cellBuf,
    shadowVao,
    sphereVao,
    lineVao,
    lineBuf,
    boxVao,
    boxBuf,
    surfaceVao,
    surfaceBuf,
  };
}

export class SoftRoamTankRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly canvas: HTMLCanvasElement;
  private res: GLResources | null;
  private floorTexSize = 0;
  private boxVertexCount = 0;
  private cachedBoxH = -1;
  private cachedBoxLevels = -1;
  private uploadedSnap: TankSnapshot | null = null;
  private dynLineVertexCount = 0;
  private dynLines = new Float32Array(0);
  private lost = false;
  private readonly onLostListener: (e: Event) => void;
  private readonly onRestoredListener: () => void;

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext, onRestored?: () => void) {
    this.canvas = canvas;
    this.gl = gl;
    this.res = createResources(gl);

    this.onLostListener = (e: Event) => {
      e.preventDefault();
      this.lost = true;
      this.res = null;
      this.uploadedSnap = null;
      this.floorTexSize = 0;
      this.cachedBoxH = -1;
      this.cachedBoxLevels = -1;
    };
    this.onRestoredListener = () => {
      this.lost = false;
      try {
        this.res = createResources(this.gl);
        this.uploadedSnap = null;
        this.floorTexSize = 0;
        this.cachedBoxH = -1;
        this.cachedBoxLevels = -1;
        onRestored?.();
      } catch {
        this.lost = true;
        this.res = null;
      }
    };
    canvas.addEventListener('webglcontextlost', this.onLostListener);
    canvas.addEventListener('webglcontextrestored', this.onRestoredListener);
  }

  static create(canvas: HTMLCanvasElement, onRestored?: () => void): SoftRoamTankRenderer | null {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, depth: true, preserveDrawingBuffer: true });
    if (!gl) return null;
    try {
      return new SoftRoamTankRenderer(canvas, gl, onRestored);
    } catch {
      return null;
    }
  }

  private syncSize(): { w: number; h: number } {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = this.canvas.getBoundingClientRect();
    const cssW = rect.width > 0 ? rect.width : 768;
    const cssH = rect.height > 0 ? rect.height : 768;
    const w = Math.max(64, Math.round(cssW * dpr));
    const h = Math.max(64, Math.round(cssH * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    return { w, h };
  }

  private ensureBoxGeometry(res: GLResources, tankH: number, levels: number): void {
    if (this.cachedBoxH === tankH && this.cachedBoxLevels === levels) return;
    this.cachedBoxH = tankH;
    this.cachedBoxLevels = levels;
    const gl = this.gl;
    const lines = buildTankBoxLines(tankH, levels);
    this.boxVertexCount = lines.length / 7;
    gl.bindBuffer(gl.ARRAY_BUFFER, res.boxBuf);
    gl.bufferData(gl.ARRAY_BUFFER, lines, gl.STATIC_DRAW);

    const surf = buildSurfaceQuad(tankH);
    gl.bindBuffer(gl.ARRAY_BUFFER, res.surfaceBuf);
    gl.bufferData(gl.ARRAY_BUFFER, surf, gl.STATIC_DRAW);
  }

  private uploadSnapshot(res: GLResources, snap: TankSnapshot): void {
    if (this.uploadedSnap === snap) return;
    this.uploadedSnap = snap;
    const gl = this.gl;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, res.floorTex);
    if (this.floorTexSize !== snap.size) {
      this.floorTexSize = snap.size;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, snap.size, snap.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, snap.floorTex);
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, snap.size, snap.size, gl.RGBA, gl.UNSIGNED_BYTE, snap.floorTex);
    }

    if (snap.cellCount > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, res.cellBuf);
      gl.bufferData(gl.ARRAY_BUFFER, snap.cells.subarray(0, snap.cellCount * TANK_CELL_STRIDE), gl.DYNAMIC_DRAW);
    }

    const maxSegs = snap.cellCount + snap.linkCount + snap.threadCount;
    const needed = maxSegs * 14;
    if (this.dynLines.length < needed) this.dynLines = new Float32Array(Math.max(1024, needed));
    let ptr = 0;
    const dl = this.dynLines;

    if (snap.levels >= 2) {
      const cells = snap.cells;
      const minY = snap.tankHeight * 0.14;
      for (let i = 0; i < snap.cellCount; i++) {
        const o = i * TANK_CELL_STRIDE;
        const y = cells[o + 1]!;
        if (y <= minY) continue;
        const x = cells[o]!, z = cells[o + 2]!;
        const r = cells[o + 4]!, g = cells[o + 5]!, b = cells[o + 6]!;
        dl[ptr++] = x; dl[ptr++] = 0.002; dl[ptr++] = z;
        dl[ptr++] = r * 0.6 + 0.25; dl[ptr++] = g * 0.6 + 0.35; dl[ptr++] = b * 0.6 + 0.45; dl[ptr++] = 0.06;
        dl[ptr++] = x; dl[ptr++] = y; dl[ptr++] = z;
        dl[ptr++] = r * 0.7 + 0.2; dl[ptr++] = g * 0.7 + 0.25; dl[ptr++] = b * 0.7 + 0.35; dl[ptr++] = 0.22;
      }
    }

    const links = snap.links;
    for (let i = 0; i < snap.linkCount; i++) {
      const o = i * TANK_LINK_STRIDE;
      const inten = links[o + 6]!;
      const a = 0.28 + 0.48 * inten;
      dl[ptr++] = links[o]!; dl[ptr++] = links[o + 1]!; dl[ptr++] = links[o + 2]!;
      dl[ptr++] = 0.92; dl[ptr++] = 0.96; dl[ptr++] = 0.88; dl[ptr++] = a;
      dl[ptr++] = links[o + 3]!; dl[ptr++] = links[o + 4]!; dl[ptr++] = links[o + 5]!;
      dl[ptr++] = 0.92; dl[ptr++] = 0.96; dl[ptr++] = 0.88; dl[ptr++] = a;
    }

    const threads = snap.threads;
    for (let i = 0; i < snap.threadCount; i++) {
      const o = i * TANK_THREAD_STRIDE;
      const a = Math.min(1, threads[o + 6]!) * 0.85;
      dl[ptr++] = threads[o]!; dl[ptr++] = threads[o + 1]!; dl[ptr++] = threads[o + 2]!;
      dl[ptr++] = 1.0; dl[ptr++] = 0.32; dl[ptr++] = 0.16; dl[ptr++] = a;
      dl[ptr++] = threads[o + 3]!; dl[ptr++] = threads[o + 4]!; dl[ptr++] = threads[o + 5]!;
      dl[ptr++] = 1.0; dl[ptr++] = 0.62; dl[ptr++] = 0.32; dl[ptr++] = a * 0.65;
    }

    this.dynLineVertexCount = ptr / 7;
    if (ptr > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, res.lineBuf);
      gl.bufferData(gl.ARRAY_BUFFER, dl.subarray(0, ptr), gl.DYNAMIC_DRAW);
    }
  }

  render(snap: TankSnapshot, camera: TankCamera): void {
    if (this.lost || !this.res) return;
    const res = this.res;
    const gl = this.gl;
    const { w, h } = this.syncSize();
    const cam = camera.matrices(w / h, snap.tankHeight);

    this.ensureBoxGeometry(res, snap.tankHeight, snap.levels);
    this.uploadSnapshot(res, snap);

    gl.viewport(0, 0, w, h);
    gl.clearDepth(1.0);
    gl.clear(gl.DEPTH_BUFFER_BIT);

    // 1. Backdrop gradient
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(res.backdropProg);
    gl.bindVertexArray(res.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 2. Foreshortened floor plane
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, res.floorTex);
    gl.useProgram(res.floorProg);
    gl.uniformMatrix4fv(res.uFloorVP, false, cam.viewProj);
    gl.uniform1i(res.uFloorTex, 0);
    gl.uniform1f(res.uFloorLevels, snap.levels);
    gl.bindVertexArray(res.floorVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // 3. Soft floor shadows
    if (snap.cellCount > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.useProgram(res.shadowProg);
      gl.uniformMatrix4fv(res.uShadowVP, false, cam.viewProj);
      gl.uniform1f(res.uShadowTankH, snap.tankHeight);
      gl.bindVertexArray(res.shadowVao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, snap.cellCount);

      // 4. Opaque 3D lit sphere impostors
      gl.disable(gl.BLEND);
      gl.depthMask(true);
      gl.useProgram(res.sphereProg);
      gl.uniformMatrix4fv(res.uSphereVP, false, cam.viewProj);
      gl.uniform3fv(res.uSphereRight, cam.right);
      gl.uniform3fv(res.uSphereUp, cam.up);
      gl.uniform3fv(res.uSphereBack, cam.back);
      gl.uniform3fv(res.uSphereEye, cam.eye);
      gl.uniform1f(res.uSphereIsOrtho, cam.isOrtho ? 1.0 : 0.0);
      gl.bindVertexArray(res.sphereVao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, snap.cellCount);
    }

    // 5. Dynamic 3D lines + glass tank wireframe + water surface
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.useProgram(res.lineProg);
    gl.uniformMatrix4fv(res.uLineVP, false, cam.viewProj);

    if (this.dynLineVertexCount > 0) {
      gl.bindVertexArray(res.lineVao);
      gl.drawArrays(gl.LINES, 0, this.dynLineVertexCount);
    }

    gl.bindVertexArray(res.boxVao);
    gl.drawArrays(gl.LINES, 0, this.boxVertexCount);

    if (snap.levels >= 2) {
      gl.bindVertexArray(res.surfaceVao);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.onLostListener);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestoredListener);
    if (!this.res) return;
    const gl = this.gl;
    const r = this.res;
    this.res = null;
    gl.deleteProgram(r.backdropProg);
    gl.deleteProgram(r.floorProg);
    gl.deleteProgram(r.shadowProg);
    gl.deleteProgram(r.lineProg);
    gl.deleteProgram(r.sphereProg);
    gl.deleteVertexArray(r.emptyVao);
    gl.deleteVertexArray(r.floorVao);
    gl.deleteVertexArray(r.shadowVao);
    gl.deleteVertexArray(r.sphereVao);
    gl.deleteVertexArray(r.lineVao);
    gl.deleteVertexArray(r.boxVao);
    gl.deleteVertexArray(r.surfaceVao);
    gl.deleteBuffer(r.floorBuf);
    gl.deleteBuffer(r.quadBuf);
    gl.deleteBuffer(r.cellBuf);
    gl.deleteBuffer(r.lineBuf);
    gl.deleteBuffer(r.boxBuf);
    gl.deleteBuffer(r.surfaceBuf);
    gl.deleteTexture(r.floorTex);
  }
}
