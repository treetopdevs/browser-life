// Renders simulation state straight from the GPU buffers (no readback).

import { worldH, worldW } from "@bl/schema";
import { prelude } from "./shaders.ts";
import type { GpuSim } from "./gpu-sim.ts";

export const VIEW_MODES = ["composite", "lineage", "nutrient", "waste", "energy", "signal", "affinity"] as const;
export type GpuViewMode = (typeof VIEW_MODES)[number];

export interface ViewRect {
  /** World-cell coordinates of the top-left corner. */
  x: number;
  y: number;
  /** Visible extent in cells. */
  w: number;
  h: number;
}

const shader = (pre: string) => /* wgsl */ `${pre}
struct View { origin: vec2f, size: vec2f, canvas: vec2f, mode: u32, unit: f32, tiles: u32, pad0: u32, pad1: u32, pad2: u32 }
@group(0) @binding(0) var<storage, read> cells: array<u32>;
@group(0) @binding(1) var<storage, read> genome: array<u32>;
@group(0) @binding(2) var<storage, read> U: array<i32>;
@group(0) @binding(3) var<uniform> view: View;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

fn hue(h: f32) -> vec3f {
  let k = vec3f(5.0, 3.0, 1.0);
  let p = abs(fract(vec3f(h) + k / 6.0) * 6.0 - 3.0);
  return clamp(p - 1.0, vec3f(0.0), vec3f(1.0));
}

fn sat(v: u32, k: f32) -> f32 { return min(1.0, f32(v) / k); }

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let p = pos.xy / view.canvas;
  let w = view.origin + p * view.size;
  let W = i32(WORLD_W);
  let H = i32(WORLD_H);
  let x = u32(((i32(floor(w.x)) % W) + W) % W);
  let y = u32(((i32(floor(w.y)) % H) + H) % H);
  let i = y * WORLD_W + x;
  let A = cells[CH_A + i];
  let B = cells[CH_B + i];
  let C = cells[CH_C + i];
  let P = cells[CH_P + i];
  let u = view.unit;
  var col = vec3f(0.0);
  switch view.mode {
    case 0u: {
      let bio = sat(B, u);
      let mem = sat(P, u);
      let nut = sat(A, u * 0.5);
      let was = sat(C, u * 0.5);
      col = vec3f(0.55 * was + 0.9 * mem + 0.1 * bio, 0.9 * bio + 0.8 * mem + 0.1 * nut, 0.5 * nut + 0.8 * mem + 0.2 * bio);
    }
    case 1u: {
      let hi = genome[G_LIN_HI + i];
      let lo = genome[G_LIN_LO + i];
      if ((hi | lo) != 0u) {
        let h = f32(lowbias32((hi * 0x9e3779b9u) ^ lowbias32(lo)) & 0xffffu) / 65536.0;
        col = (hue(h) * 0.85 + 0.15) * sqrt(sat(B + P, u));
      } else {
        col = vec3f(0.06) * sat(A, u * 0.5);
      }
    }
    case 2u: { col = vec3f(0.2, 0.5, 1.0) * sat(A, u * 0.5); }
    case 3u: { col = vec3f(1.0, 0.6, 0.2) * sat(C, u * 0.5); }
    case 4u: { col = vec3f(1.0, 0.9, 0.3) * sat(cells[CH_E + i], u * 4.0); }
    case 5u: { col = vec3f(0.9, 0.4, 1.0) * sat(cells[CH_S + i], u * 0.25); }
    default: {
      let g = f32(U[i]) / 256.0;
      col = select(vec3f(0.15, 0.3, 1.0) * -g, vec3f(1.0, 0.35, 0.2) * g, g > 0.0);
    }
  }
  // Tile borders when a world is split into independent tiles.
  if (view.tiles != 0u) {
    let px = view.size.x / view.canvas.x;
    let fx = abs(w.x - round(w.x / f32(TILE_W)) * f32(TILE_W));
    let fy = abs(w.y - round(w.y / f32(TILE_H)) * f32(TILE_H));
    if (min(fx, fy) < px) { col = mix(col, vec3f(0.35), 0.6); }
  }
  return vec4f(col, 1.0);
}
`;

export class Renderer {
  private readonly pipeline: GPURenderPipeline;
  private readonly uniform: GPUBuffer;
  private groups: GPUBindGroup[] = [];
  private boundTo?: GpuSim;
  private readonly ctx: GPUCanvasContext;
  private readonly device: GPUDevice;

  constructor(
    device: GPUDevice,
    ctx: GPUCanvasContext,
    format: GPUTextureFormat,
    private readonly sim: GpuSim,
  ) {
    this.device = device;
    this.ctx = ctx;
    const module = device.createShaderModule({ code: shader(prelude(sim.cfg)), label: "render" });
    this.pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "fs", targets: [{ format }] },
      primitive: { topology: "triangle-list" },
    });
    this.uniform = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  }

  private bind(): void {
    if (this.boundTo === this.sim) return;
    this.groups = [0, 1].map((p) =>
      this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.sim.cells[0] } },
          { binding: 1, resource: { buffer: this.sim.genome[p] } },
          { binding: 2, resource: { buffer: this.sim.U } },
          { binding: 3, resource: { buffer: this.uniform } },
        ],
      }),
    );
    this.boundTo = this.sim;
  }

  draw(mode: GpuViewMode, rect: ViewRect, canvasW: number, canvasH: number, unit = 256): void {
    this.bind();
    const u = new ArrayBuffer(48);
    const f = new Float32Array(u);
    const w = new Uint32Array(u);
    f[0] = rect.x;
    f[1] = rect.y;
    f[2] = rect.w;
    f[3] = rect.h;
    f[4] = canvasW;
    f[5] = canvasH;
    w[6] = VIEW_MODES.indexOf(mode);
    f[7] = unit;
    w[8] = this.sim.cfg.tilesX * this.sim.cfg.tilesY > 1 ? 1 : 0;
    this.device.queue.writeBuffer(this.uniform, 0, u);
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: this.ctx.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.groups[this.sim.currentGenome === this.sim.genome[0] ? 0 : 1]);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  static fullView(sim: GpuSim): ViewRect {
    return { x: 0, y: 0, w: worldW(sim.cfg), h: worldH(sim.cfg) };
  }

  destroy(): void {
    this.uniform.destroy();
  }
}
