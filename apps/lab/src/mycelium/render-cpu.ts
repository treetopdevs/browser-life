// The Canvas 2D painter: the fallback when WebGPU is not available (and the choice of anyone who wants the
// reference engine). It paints the CPU world's field as an image of one pixel per cell, scaled with smoothing off
// so cells stay crisp at any zoom, then each particle as a square.
import { fieldRGB, LAYER, particleRGB, css, type ColourMode, type RGB } from './colour.ts';
import { scaleOf, type View } from './view.ts';
import type { MyceliumState } from '../../../../tools/mycelium/world.ts';
import { POS_SHIFT } from '../../../../tools/mycelium/world.ts';

export interface PaintOptions { mode: ColourMode; layers: number }

export class CpuRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly fieldCanvas = document.createElement('canvas');
  private readonly fctx = this.fieldCanvas.getContext('2d')!;
  private img: ImageData | null = null;
  private readonly tmp: RGB = [0, 0, 0];

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  draw(s: MyceliumState, v: View, o: PaintOptions, cssSize: number, dpr: number): void {
    const W = s.config.width, H = s.config.height;
    if (!this.img || this.img.width !== W || this.img.height !== H) {
      this.fieldCanvas.width = W; this.fieldCanvas.height = H;
      this.img = this.fctx.createImageData(W, H);
    }
    const d = this.img.data, { A, C, P } = s, t = this.tmp;
    for (let k = 0; k < A.length; k++) {
      fieldRGB(A[k], C[k], P[k], o.layers, t);
      d[4 * k] = t[0] * 255; d[4 * k + 1] = t[1] * 255; d[4 * k + 2] = t[2] * 255; d[4 * k + 3] = 255;
    }
    this.fctx.putImageData(this.img, 0, 0);
    const ctx = this.ctx;
    const px = this.canvas.width, py = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#04090c';
    ctx.fillRect(0, 0, px, py);
    // Device pixels per cell, and the transform that puts world cell (x, y) at its place.
    const sc = scaleOf(v, W, cssSize) * dpr;
    ctx.setTransform(sc, 0, 0, sc, px / 2 - v.cx * sc, py / 2 - v.cy * sc);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.fieldCanvas, 0, 0, W, H);
    if (!(o.layers & LAYER.particles)) return;
    const side = Math.max(3 / sc * dpr, 0.5);
    const scales = { energyMax: s.config.energyMax, bodyMax: s.config.bodyMax };
    const inv = 1 / (1 << POS_SHIFT);
    for (let i = 0; i < s.n; i++) {
      ctx.fillStyle = css(particleRGB(o.mode, s.gid[i], s.E[i], s.age[i], s.M[i], scales));
      ctx.fillRect(s.x[i] * inv - side / 2, s.y[i] * inv - side / 2, side, side);
    }
  }
}
