/** Exact, read-only local flow reconstruction for an assay observation window. */
import {
  CH, G, DEFAULT_K_ADHESION, buildKernel, cellCount, clampi, divi, divu, encodeGenome,
  generalistGenome, mulu, worldW,
} from "@bl/schema";
import { growth, sobelGrad } from "@bl/sim-ref";
import { genomeHeadOf, type TransportInput } from "./foundation-material-flow.ts";

const MCAP = 16383;
const bound = (s: TransportInput, i: number) => {
  const n = cellCount(s.cfg);
  return Math.min(MCAP, s.cells[CH.B * n + i] + s.cells[CH.P * n + i]);
};
const polymer = (s: TransportInput, i: number) =>
  Math.min(MCAP, s.cells[CH.P * cellCount(s.cfg) + i]);
const living = (s: TransportInput, i: number) => {
  const n = cellCount(s.cfg);
  const genome = genomeHeadOf(s);
  return (genome[G.LIN_HI * n + i] | genome[G.LIN_LO * n + i]) !== 0;
};
const nb = (s: TransportInput, i: number, dx: number, dy: number): number => {
  const W = worldW(s.cfg), x = i % W, y = Math.floor(i / W);
  const { tileW, tileH } = s.cfg;
  const tx = Math.floor(x / tileW), ty = Math.floor(y / tileH);
  return (ty * tileH + ((y - ty * tileH + dy + tileH) % tileH)) * W +
    tx * tileW + ((x - tx * tileW + dx + tileW) % tileW);
};

function affinityAt(s: TransportInput, i: number, kernel: ReturnType<typeof buildKernel>): number {
  const { taps, count, sum } = kernel, c = s.cfg, n = cellCount(c);
  let conv = 0;
  for (let k = 0; k < count; k++)
    conv += taps[k * 4 + 2] * bound(s, nb(s, i, taps[k * 4], taps[k * 4 + 1]));
  const uq = divu(conv, sum);
  let u = divu(mulu(uq, 1024), c.massUnit);
  if (u > 4095) u = 4095;
  let mu = c.defaultMu, sigma = c.defaultSigma;
  if (!c.neutral && living(s, i)) {
    const p0 = genomeHeadOf(s)[G.PARAM0 * n + i];
    mu = p0 & 0xffff; sigma = p0 >>> 16;
  }
  return growth(u, Math.min(mu, 4095), clampi(sigma, 1, 1023));
}

/** The packed displacement that the unchanged reference flow phase computes for one source site. */
export function localDisplacement(s: TransportInput, i: number): number {
  const n = cellCount(s.cfg);
  if (!Number.isSafeInteger(i) || i < 0 || i >= n)
    throw new Error("local displacement requires a valid source site");
  const c = s.cfg, kernel = buildKernel(c.kernelRadius);
  const e = nb(s, i, 1, 0), w = nb(s, i, -1, 0);
  const south = nb(s, i, 0, 1), north = nb(s, i, 0, -1);
  const ne = nb(s, i, 1, -1), nw = nb(s, i, -1, -1);
  const se = nb(s, i, 1, 1), sw = nb(s, i, -1, 1);
  const U = (j: number) => affinityAt(s, j, kernel);
  const gUx = U(ne) + 2 * U(e) + U(se) - (U(nw) + 2 * U(w) + U(sw));
  const gUy = U(sw) + 2 * U(south) + U(se) - (U(nw) + 2 * U(north) + U(ne));
  const m = (j: number) => bound(s, j);
  const gMx = m(ne) + 2 * m(e) + m(se) - (m(nw) + 2 * m(w) + m(sw));
  const gMy = m(sw) + 2 * m(south) + m(se) - (m(nw) + 2 * m(north) + m(ne));
  const Mi = m(i);
  const alpha = Mi >= c.thetaMass ? 256 : divu(mulu(mulu(Mi, Mi), 256), mulu(c.thetaMass, c.thetaMass));
  const massDiv = 8 * c.massUnit;
  let Fx = divi((256 - alpha) * gUx, 2048) - divi(alpha * gMx, massDiv);
  let Fy = divi((256 - alpha) * gUy, 2048) - divi(alpha * gMy, massDiv);
  if (c.adhesion === true) {
    const p = (j: number) => polymer(s, j);
    const [gPx, gPy] = sobelGrad(p(ne), p(e), p(se), p(nw), p(w), p(sw), p(north), p(south));
    const gain = c.kAdhesion ?? DEFAULT_K_ADHESION;
    Fx += divi(gain * gPx, massDiv);
    Fy += divi(gain * gPy, massDiv);
  }
  let dx = divi(c.dtQ * Fx, 1024), dy = divi(c.dtQ * Fy, 1024);
  if (c.motility && living(s, i)) {
    const mot = s.cells[CH.MOT * n + i];
    const gain = (c.neutral ? encodeGenome(generalistGenome(c.defaultMu, c.defaultSigma), 0, 0)[G.PARAM1] :
      genomeHeadOf(s)[G.PARAM1 * n + i]) & 0xff;
    dx += divi(((mot & 0xff) - 128) * gain, 256);
    dy += divi((((mot >>> 8) & 0xff) - 128) * gain, 256);
  }
  const dmax = 64 - c.spread;
  dx = clampi(dx, -dmax, dmax); dy = clampi(dy, -dmax, dmax);
  return (dx + 64) | ((dy + 64) << 8);
}

/** Reconstruct just the nine source displacements needed for one destination audit. */
export function localDisplacementsForDestination(s: TransportInput, destinationIndex: number): Uint32Array {
  const n = cellCount(s.cfg);
  if (!Number.isSafeInteger(destinationIndex) || destinationIndex < 0 || destinationIndex >= n)
    throw new Error("invalid destination for local flow");
  const out = new Uint32Array(n);
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    const source = nb(s, destinationIndex, ox, oy);
    out[source] = localDisplacement(s, source);
  }
  return out;
}
