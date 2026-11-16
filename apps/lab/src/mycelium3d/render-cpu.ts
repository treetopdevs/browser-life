// The CPU engine's picture for /mycelium3d/ when WebGPU is missing: a flat side view with Canvas 2D (the volume view needs
// WebGPU). East runs left to right and depth top to bottom (layer 0, the surface, at the top), every north-south row summed
// into one column: the light plane's brightness, trail in violet, waste darkening, and each particle a dot in its family
// colour at its true x and depth. With bonds, each bond is a pale line under the dots, from the same link segments as the 3D
// view (packLinks in pack.ts): a bond across the east-west seam ends at the side walls, and one across the north-south seam,
// which this view folds away, shows only its east-west and depth extent.
import { POS_SHIFT, type Mycelium3dState } from '../../../../tools/mycelium3d/world.ts';
import { css, familyRGB } from '../mycelium/colour.ts';
import { LINK_FLOATS, type Links } from './pack.ts';

export function drawSide(canvas: HTMLCanvasElement, s: Mycelium3dState, I: Uint32Array, showWaste: boolean, links?: Links | null): void {
  const { width: W, height: H, depth: D, light } = s.config;
  const cw = canvas.clientWidth || 640;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cell = Math.max(1, Math.floor((cw * dpr) / W));
  const pw = cell * W, ph = cell * D;
  if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
  const g = canvas.getContext('2d')!;
  const img = g.createImageData(W, D);
  const top = (light << 8) * H;
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    let l = 0, p = 0, c = 0;
    for (let y = 0; y < H; y++) { const k = (z * H + y) * W + x; l += I[k]; p += s.P[k]; c += s.C[k]; }
    const lit = top === 0 ? 0 : l / top;
    const tr = Math.min(1, Math.log2(1 + p / H) / 5);
    const dark = showWaste ? Math.min(0.7, Math.log2(1 + c / H) / 12) : 0;
    const o = (z * W + x) * 4;
    img.data[o] = Math.round((8 + 30 * lit + 150 * tr) * (1 - dark));
    img.data[o + 1] = Math.round((18 + 70 * lit + 60 * tr) * (1 - dark));
    img.data[o + 2] = Math.round((26 + 90 * lit + 200 * tr) * (1 - dark));
    img.data[o + 3] = 255;
  }
  const tmp = document.createElement('canvas');
  tmp.width = W; tmp.height = D;
  tmp.getContext('2d')!.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = false;
  g.drawImage(tmp, 0, 0, pw, ph);
  if (links && links.count > 0) {
    // instance space: u east, v = D - depth
    g.strokeStyle = 'rgba(255, 236, 190, 0.85)';
    g.lineWidth = Math.max(1, cell * 0.14);
    g.beginPath();
    for (let k = 0; k < links.count; k++) {
      const o = k * LINK_FLOATS, d = links.data;
      g.moveTo(d[o] * cell, (D - d[o + 1]) * cell);
      g.lineTo(d[o + 3] * cell, (D - d[o + 4]) * cell);
    }
    g.stroke();
  }
  const r = Math.max(1.2, cell * 0.28);
  for (let i = 0; i < s.n; i++) {
    g.fillStyle = css(familyRGB(s.gid[i]));
    g.beginPath();
    g.arc((s.x[i] / (1 << POS_SHIFT)) * cell, (s.z[i] / (1 << POS_SHIFT)) * cell, r, 0, Math.PI * 2);
    g.fill();
  }
}
