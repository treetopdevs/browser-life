// The fixed fixture matrix. Every generator is a pure integer function of its parameters.
import { cloneFrames, rnd, type Movie } from "./movie.ts";
import { LIFE_PATTERNS, lifeRun, stampPattern } from "./life.ts";

export const FRAMES = 96;
export const SIDE = 64;

export interface FixtureSpec { id: string; family: string; q: number; params: Record<string, unknown> }

const lifeMovie = (id: string, family: string, place: (g: Uint8Array) => void): Movie => {
  const g = new Uint8Array(SIDE * SIDE);
  place(g);
  return { id, family, w: SIDE, h: SIDE, q: 2, frames: lifeRun(g, SIDE, SIDE, FRAMES) };
};

export const DUP_POSITIONS: readonly (readonly [number, number])[] = [0, 20, 40].flatMap((y) => [0, 20, 40].map((x) => [x, y] as const));
export const DUP_COUNT = DUP_POSITIONS.length;
export const BLOB = { particles: 600, side: 12, seed: 0xb10b, cap: 15 } as const;
export const SOUP = { density256: 64, seed: 0x50a9 } as const; // 64/256 = 25%
export const BITS_SEED = 0x0b17;
export const STATIC_SEED = 0x57a7;

export function lifeBlock(): Movie { return lifeMovie("life-block", "still life", (g) => stampPattern(g, SIDE, SIDE, LIFE_PATTERNS.block, 30, 30)); }
export function lifeBlinker(): Movie { return lifeMovie("life-blinker", "oscillator", (g) => stampPattern(g, SIDE, SIDE, LIFE_PATTERNS.blinker, 30, 30)); }
export function lifePulsar(): Movie { return lifeMovie("life-pulsar", "oscillator", (g) => stampPattern(g, SIDE, SIDE, LIFE_PATTERNS.pulsar, 25, 25)); }
export function lifeGlider(): Movie { return lifeMovie("life-glider", "translating", (g) => stampPattern(g, SIDE, SIDE, LIFE_PATTERNS.glider, 0, 0)); }
export function lifeGlidersDup(): Movie {
  return lifeMovie("life-gliders-dup", "duplicated motif", (g) => { for (const [x, y] of DUP_POSITIONS) stampPattern(g, SIDE, SIDE, LIFE_PATTERNS.glider, x, y); });
}
export function lifeSoupEarly(): Movie {
  return lifeMovie("life-soup-early", "chaotic transient", (g) => { for (let c = 0; c < g.length; c++) g[c] = (rnd(SOUP.seed, 0, c) & 255) < SOUP.density256 ? 1 : 0; });
}
export function randomBits(): Movie {
  const frames: Uint8Array[] = [];
  for (let k = 0; k < FRAMES; k++) { const f = new Uint8Array(SIDE * SIDE); for (let c = 0; c < f.length; c++) f[c] = rnd(BITS_SEED, k, c) >>> 31; frames.push(f); }
  return { id: "random-bits", family: "noise", w: SIDE, h: SIDE, q: 2, frames };
}
export function randomStatic(): Movie {
  const f = new Uint8Array(SIDE * SIDE);
  for (let c = 0; c < f.length; c++) f[c] = rnd(STATIC_SEED, 0, c) >>> 31;
  return { id: "random-static", family: "frozen noise", w: SIDE, h: SIDE, q: 2, frames: Array.from({ length: FRAMES }, () => Uint8Array.from(f)) };
}

export interface BlobsResult { movie: Movie; latentTotal: number; saturatedCellFrames: number; maxCount: number }

/** Passive aggregate: particles take a lazy random walk on the torus. The latent count array is conserved exactly; the observed frame saturates at BLOB.cap. */
export function blobsDiffuse(): BlobsResult {
  const { particles, side, seed, cap } = BLOB;
  const n = SIDE * SIDE;
  const px = new Int32Array(particles), py = new Int32Array(particles);
  const lo = (SIDE - side) >> 1;
  for (let i = 0; i < particles; i++) { px[i] = lo + (rnd(seed, 0, 2 * i) % side); py[i] = lo + (rnd(seed, 0, 2 * i + 1) % side); }
  const frames: Uint8Array[] = [];
  let saturated = 0, maxCount = 0;
  for (let k = 0; k < FRAMES; k++) {
    if (k > 0) for (let i = 0; i < particles; i++) {
      const d = rnd(seed, k, i) % 5; // stay, +x, -x, +y, -y
      if (d === 1) px[i] = (px[i] + 1) % SIDE; else if (d === 2) px[i] = (px[i] + SIDE - 1) % SIDE;
      else if (d === 3) py[i] = (py[i] + 1) % SIDE; else if (d === 4) py[i] = (py[i] + SIDE - 1) % SIDE;
    }
    const latent = new Uint16Array(n);
    for (let i = 0; i < particles; i++) latent[py[i] * SIDE + px[i]]++;
    let total = 0;
    const f = new Uint8Array(n);
    for (let c = 0; c < n; c++) { total += latent[c]; if (latent[c] > cap) saturated++; if (latent[c] > maxCount) maxCount = latent[c]; f[c] = Math.min(latent[c], cap); }
    if (total !== particles) throw new Error(`blobs-diffuse lost matter at frame ${k}: ${total} != ${particles}`);
    frames.push(f);
  }
  return { movie: { id: "blobs-diffuse", family: "passive aggregate", w: SIDE, h: SIDE, q: 16, frames }, latentTotal: particles, saturatedCellFrames: saturated, maxCount };
}

export const FIXTURE_SPECS: readonly FixtureSpec[] = [
  { id: "life-block", family: "still life", q: 2, params: { pattern: "block", at: [30, 30] } },
  { id: "life-blinker", family: "oscillator", q: 2, params: { pattern: "blinker", at: [30, 30] } },
  { id: "life-pulsar", family: "oscillator", q: 2, params: { pattern: "pulsar", at: [25, 25] } },
  { id: "life-glider", family: "translating", q: 2, params: { pattern: "glider", at: [0, 0] } },
  { id: "life-gliders-dup", family: "duplicated motif", q: 2, params: { pattern: "glider", positions: DUP_POSITIONS } },
  { id: "life-soup-early", family: "chaotic transient", q: 2, params: SOUP },
  { id: "random-bits", family: "noise", q: 2, params: { seed: BITS_SEED } },
  { id: "random-static", family: "frozen noise", q: 2, params: { seed: STATIC_SEED } },
  { id: "blobs-diffuse", family: "passive aggregate", q: 16, params: BLOB },
];

/** The nine fixtures that need no simulator, in matrix order. The ecology clip (ecology.ts) is the tenth. */
export function baseFixtures(): { movies: Movie[]; blobs: Omit<BlobsResult, "movie"> } {
  const b = blobsDiffuse();
  const movies = [lifeBlock(), lifeBlinker(), lifePulsar(), lifeGlider(), lifeGlidersDup(), lifeSoupEarly(), randomBits(), randomStatic(), b.movie];
  return { movies, blobs: { latentTotal: b.latentTotal, saturatedCellFrames: b.saturatedCellFrames, maxCount: b.maxCount } };
}

export { cloneFrames };
