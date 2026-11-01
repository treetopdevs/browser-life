// Known-history fixtures for the behaviour-atlas descriptors (I01 slice 1). Synthetic tile sequences whose D1/D2
// are known by construction, including negative cases that fool the naive version of each descriptor. Used by the
// vitest suite and by `tools/atlas.ts fixture`, which writes fixture-evidence.json. CPU only, no simulator.

import { lowbias32 } from "@bl/schema";
import { TileDescriptor, type TileAtlas } from "./descriptors.ts";

export const FIXTURE_TILE = 64;
export const FIXTURE_FRAMES = 11;
export const FIXTURE_CADENCE = 100;
const BASE_STEP = 2000;

type Frame = Float64Array;
const blank = (): Frame => new Float64Array(FIXTURE_TILE * FIXTURE_TILE);
const T = FIXTURE_TILE;
const wrap = (v: number) => ((v % T) + T) % T;

function disc(f: Frame, cx: number, cy: number, r: number, mass = 200): void {
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) f[wrap(cy + dy) * T + wrap(cx + dx)] = mass;
}
const seq = (make: (k: number) => Frame): Frame[] => Array.from({ length: FIXTURE_FRAMES }, (_, k) => make(k));

export interface Fixture {
  id: string;
  /** What the naive descriptor would say, and why this case fools it. */
  note: string;
  frames: Frame[];
  /** Expected values; `null` means undefined. Exact where the construction is exact, else a [lo, hi] bracket. */
  expect: { d1: number | [number, number] | null; d2: number | [number, number] | null; comPath?: number | [number, number] | null };
}

/** Moving disc: `v` cells per frame (one frame = FIXTURE_CADENCE steps), so D1 = v exactly. */
const moving = (v: number, mass = 200, ox = 0, oy = 0): Frame[] => seq((k) => { const f = blank(); disc(f, 20 + ox + v * k, 30 + oy, 6, mass); return f; });

export function fixtures(): Fixture[] {
  const checker = (parity: number): Frame => { const f = blank(); for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if ((x + y + parity) % 2 === 0) f[y * T + x] = 200; return f; };
  const noise = (k: number): Frame => { const f = blank(); for (let i = 0; i < T * T; i++) if (lowbias32((k + 1) * 0x9e3779b1 + i) % 4 === 0) f[i] = 200; return f; };
  const stripes = (shift: number): Frame => { const f = blank(); for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if (wrap(x - shift) % 8 < 4) f[y * T + x] = 200; return f; };
  return [
    { id: "static-disc", note: "a body that does not move", frames: moving(0), expect: { d1: 0, d2: 1, comPath: 0 } },
    { id: "slow-disc", note: "1 cell per 100 steps", frames: moving(1), expect: { d1: [0.999, 1.001], d2: [0.7, 0.95] } },
    { id: "fast-disc", note: "3 cells per 100 steps; persistence falls with speed", frames: moving(3), expect: { d1: [2.999, 3.001], d2: [0.3, 0.7] } },
    {
      id: "out-and-back",
      note: "NEGATIVE: 5 frames out, 5 back. Path-length COM (naive) reads 1.0 as if it were a steady mover; net transport is 0",
      frames: seq((k) => { const f = blank(); disc(f, 20 + (k <= 5 ? k : 10 - k), 30, 6); return f; }),
      expect: { d1: [0, 1e-9], d2: [0.7, 0.95], comPath: [0.999, 1.001] },
    },
    {
      id: "flickering-edge",
      note: "NEGATIVE: a static body whose edge cells flicker one side at a time. Path-length COM (naive) is nonzero; net transport stays near zero and persistence stays high but below 1",
      frames: seq((k) => { const f = blank(); disc(f, 30, 30, 6); const dx = k % 2 === 0 ? 7 : -7; for (let dy = -2; dy <= 2; dy++) f[(30 + dy) * T + 30 + dx] = 200; return f; }),
      expect: { d1: [0, 0.05], d2: [0.85, 0.999], comPath: [0.1, 5] },
    },
    { id: "checker-alternating", note: "NEGATIVE: occupied fraction is 0.5 at every census (naive 'occupancy is constant' calls it static) but every cell turns over", frames: seq((k) => checker(k % 2)), expect: { d1: null, d2: 0 } },
    { id: "checker-static", note: "the same occupied fraction, truly static", frames: seq(() => checker(0)), expect: { d1: null, d2: 1 } },
    { id: "noise", note: "NEGATIVE: independent 25% speckle each census; no centre of mass exists, persistence is the chance overlap (about 1/7)", frames: seq(noise), expect: { d1: null, d2: [0.1, 0.2] } },
    { id: "recoloured-copy", note: "same trajectory as slow-disc with all masses x7 (a re-rendered or recoloured copy): descriptors must be identical", frames: moving(1, 1400), expect: { d1: [0.999, 1.001], d2: [0.7, 0.95] } },
    { id: "translated-copy", note: "slow-disc shifted by (17, 9) on the torus: displacement is not position, descriptors identical", frames: moving(1, 200, 17, 9), expect: { d1: [0.999, 1.001], d2: [0.7, 0.95] } },
    {
      id: "wrap-crossing",
      note: "a body crossing the tile edge: the minimal wrapped step keeps D1 at its true speed",
      frames: seq((k) => { const f = blank(); disc(f, 58 + 2 * k, 30, 6); return f; }),
      expect: { d1: [1.999, 2.001], d2: [0.5, 0.85] },
    },
    {
      id: "texture-drift",
      note: "NEGATIVE/limit: a whole-tile periodic texture sliding 1 cell per frame. No centre of mass exists (D1 undefined); persistence is not drift-invariant, so it reads as turnover (0.6). Reported as D1-undefined with D2 < 1",
      frames: seq((k) => stripes(k)),
      expect: { d1: null, d2: [0.55, 0.65] },
    },
    {
      id: "symmetric-split",
      note: "KNOWN BLIND SPOT: two bodies separating symmetrically leave the tile's centre of mass still, so D1 = 0 although both move. D1 is net transport, per-body speed is the existing speed axis",
      frames: seq((k) => { const f = blank(); disc(f, 32 - k, 32, 5); disc(f, 32 + k, 32, 5); return f; }),
      expect: { d1: [0, 1e-9], d2: [0.2, 0.9] },
    },
    { id: "extinct", note: "no occupied cell at any census: both undefined", frames: seq(() => blank()), expect: { d1: null, d2: null } },
  ];
}

export function runFixture(f: Fixture): TileAtlas {
  const d = new TileDescriptor(FIXTURE_TILE);
  f.frames.forEach((m, k) => d.push(m, BASE_STEP + k * FIXTURE_CADENCE));
  return d.result();
}
