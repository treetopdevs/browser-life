// Lazy twins of the I14 base fixtures: the same bytes, one frame at a time, so the evidence driver never holds a movie.
// `packages/metrics/test/assembly-stream.test.ts` checks byte equality with the materialised I14 movies.
import { rnd } from "../predictability/movie.ts";
import { LIFE_PATTERNS, lifeStep, stampPattern } from "../predictability/life.ts";
import { BITS_SEED, BLOB, DUP_POSITIONS, FRAMES, SIDE, SOUP, STATIC_SEED } from "../predictability/fixtures.ts";

export interface LazyMovie { id: string; w: number; h: number; q: number; frameCount: number; frames(): Generator<Uint8Array> }

function lifeLazy(id: string, place: (g: Uint8Array) => void): LazyMovie {
  return {
    id, w: SIDE, h: SIDE, q: 2, frameCount: FRAMES,
    *frames() {
      let g: Uint8Array = new Uint8Array(SIDE * SIDE);
      place(g);
      for (let k = 0; k < FRAMES; k++) {
        if (k > 0) g = lifeStep(g, SIDE, SIDE);
        yield g;
      }
    },
  };
}

function blobsLazy(): LazyMovie {
  return {
    id: "blobs-diffuse", w: SIDE, h: SIDE, q: 16, frameCount: FRAMES,
    *frames() {
      const { particles, side, seed, cap } = BLOB;
      const n = SIDE * SIDE;
      const px = new Int32Array(particles), py = new Int32Array(particles);
      const lo = (SIDE - side) >> 1;
      for (let i = 0; i < particles; i++) { px[i] = lo + (rnd(seed, 0, 2 * i) % side); py[i] = lo + (rnd(seed, 0, 2 * i + 1) % side); }
      for (let k = 0; k < FRAMES; k++) {
        if (k > 0) for (let i = 0; i < particles; i++) {
          const d = rnd(seed, k, i) % 5;
          if (d === 1) px[i] = (px[i] + 1) % SIDE; else if (d === 2) px[i] = (px[i] + SIDE - 1) % SIDE;
          else if (d === 3) py[i] = (py[i] + 1) % SIDE; else if (d === 4) py[i] = (py[i] + SIDE - 1) % SIDE;
        }
        const latent = new Uint16Array(n);
        for (let i = 0; i < particles; i++) latent[py[i] * SIDE + px[i]]++;
        const f = new Uint8Array(n);
        for (let c = 0; c < n; c++) f[c] = Math.min(latent[c], cap);
        yield f;
      }
    },
  };
}

/** The nine base fixtures in matrix order (same order as `baseFixtures().movies`). */
export function lazyFixtures(): LazyMovie[] {
  return [
    lifeLazy("life-block", (g) => stampPattern(g, SIDE, SIDE, LIFE_PATTERNS.block, 30, 30)),
    lifeLazy("life-blinker", (g) => stampPattern(g, SIDE, SIDE, LIFE_PATTERNS.blinker, 30, 30)),
    lifeLazy("life-pulsar", (g) => stampPattern(g, SIDE, SIDE, LIFE_PATTERNS.pulsar, 25, 25)),
    lifeLazy("life-glider", (g) => stampPattern(g, SIDE, SIDE, LIFE_PATTERNS.glider, 0, 0)),
    lifeLazy("life-gliders-dup", (g) => { for (const [x, y] of DUP_POSITIONS) stampPattern(g, SIDE, SIDE, LIFE_PATTERNS.glider, x, y); }),
    lifeLazy("life-soup-early", (g) => { for (let c = 0; c < g.length; c++) g[c] = (rnd(SOUP.seed, 0, c) & 255) < SOUP.density256 ? 1 : 0; }),
    {
      id: "random-bits", w: SIDE, h: SIDE, q: 2, frameCount: FRAMES,
      *frames() { for (let k = 0; k < FRAMES; k++) { const f = new Uint8Array(SIDE * SIDE); for (let c = 0; c < f.length; c++) f[c] = rnd(BITS_SEED, k, c) >>> 31; yield f; } },
    },
    {
      id: "random-static", w: SIDE, h: SIDE, q: 2, frameCount: FRAMES,
      *frames() { for (let k = 0; k < FRAMES; k++) { const f = new Uint8Array(SIDE * SIDE); for (let c = 0; c < f.length; c++) f[c] = rnd(STATIC_SEED, 0, c) >>> 31; yield f; } },
    },
    blobsLazy(),
  ];
}
