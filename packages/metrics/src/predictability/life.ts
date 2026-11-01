// Conway's Life on a torus: a tiny integer stepper, used as a calibration world only.

export function lifeStep(g: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const ym = ((y + h - 1) % h) * w, y0 = y * w, yp = ((y + 1) % h) * w;
    for (let x = 0; x < w; x++) {
      const xm = (x + w - 1) % w, xp = (x + 1) % w;
      const n = g[ym + xm] + g[ym + x] + g[ym + xp] + g[y0 + xm] + g[y0 + xp] + g[yp + xm] + g[yp + x] + g[yp + xp];
      out[y0 + x] = n === 3 || (n === 2 && g[y0 + x] === 1) ? 1 : 0;
    }
  }
  return out;
}

/** Rows of '.' and 'O'. */
export const LIFE_PATTERNS = {
  block: ["OO", "OO"],
  blinker: ["OOO"],
  glider: [".O.", "..O", "OOO"],
  pulsar: [
    "..OOO...OOO..",
    ".............",
    "O....O.O....O",
    "O....O.O....O",
    "O....O.O....O",
    "..OOO...OOO..",
    ".............",
    "..OOO...OOO..",
    "O....O.O....O",
    "O....O.O....O",
    "O....O.O....O",
    ".............",
    "..OOO...OOO..",
  ],
} as const satisfies Record<string, readonly string[]>;

export function stampPattern(g: Uint8Array, w: number, h: number, rows: readonly string[], ox: number, oy: number): void {
  for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y].length; x++) if (rows[y][x] === "O") g[((oy + y) % h) * w + ((ox + x) % w)] = 1;
}

export function lifeRun(first: Uint8Array, w: number, h: number, frames: number): Uint8Array[] {
  const out = [first];
  for (let k = 1; k < frames; k++) out.push(lifeStep(out[k - 1], w, h));
  return out;
}
