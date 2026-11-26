import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NUM_WALL_SPECIES, OP_CLEAVE, OP_LYSE, SPECIES, WALL_SPECIES, makeCatalyst } from '../src/oligomer/chem.ts';
import { inspectRows } from '../src/oligomer/inspect.ts';
import { OligomerWorld, defaultConfig } from '../src/oligomer/model.ts';
import {
  BG,
  BRIGHT_FLOOR,
  SUB,
  TROPHIC_COLOURS,
  WALL_NAMES,
  WALL_PALETTE,
  type TileSource,
  bufferSize,
  channelMax,
  contrastRatio,
  dim,
  labDistance,
  linearToLab,
  lysinTargetMask,
  ramp,
  rampScale,
  renderChemistry,
  renderLysin,
  renderTrophic,
  renderWallMotif,
  stepTile,
  tileAt,
  tileSourceOf,
  trophicClass,
  wallBrightness,
  zoomFor,
} from '../src/oligomer/render.ts';
import { CENSUS_EVERY, RingBuffer, SETTLE_STEPS, ViewerObserver, badgeState } from '../src/oligomer/viewer-observer.ts';
import { CONDITIONS, buildCondition, describeCondition, seedMixedWalls6, starterGenome } from '../src/oligomer/worlds.ts';

const IDS = ['LYSE', 'NO_LYSE', 'SINGLE_WALL', 'NEUTRAL_WALL'] as const;

/** Run the whole read path of the viewer once (renderers, masks, residuals, inspector). */
function readEverything(w: OligomerWorld, v: ViewerObserver, cache: Map<number, number>): void {
  const src = tileSourceOf(w);
  const b = bufferSize(src);
  const out = new Uint8ClampedArray(b.w * b.h * 4);
  renderWallMotif(src, out, { food: 8 });
  renderLysin(src, out, { food: 8 }, cache);
  renderTrophic(src, out, v.feed, v.sec);
  for (const ch of ['food', 'dimers', 'monomers'] as const) renderChemistry(src, out, ch, 8);
  for (let i = 0; i < w.nTiles; i++) lysinTargetMask(src, i, cache);
  v.residuals(w);
  for (let i = 0; i < w.nTiles; i += 7) inspectRows(w, i, v, cache);
}

function runWithViewer(w: OligomerWorld, steps: number, everything = true): ViewerObserver {
  const v = new ViewerObserver(w);
  const cache = new Map<number, number>();
  for (let t = 1; t <= steps; t++) {
    w.step(v);
    v.endStep(w.stepCount);
    if (w.stepCount % CENSUS_EVERY === 0) v.sampleCensus(w);
    if (everything && t % 50 === 0) readEverything(w, v, cache);
  }
  return v;
}

/** Mixed founders that all carry a lysin aimed at 0101, so onLyse really fires. */
function lysinWorld(id: (typeof IDS)[number], size = 16): OligomerWorld {
  const c = CONDITIONS.find((x) => x.id === id)!;
  const w = new OligomerWorld(defaultConfig({ width: size, height: size, seed: 1, ...c.overrides }));
  const W = size;
  const H = size;
  const at = [[0.2, 0.25], [0.5, 0.25], [0.8, 0.25], [0.2, 0.75], [0.5, 0.75], [0.8, 0.75]];
  WALL_SPECIES.forEach((wid, idx) => {
    const label = id === 'SINGLE_WALL' ? '0011' : SPECIES[wid].label;
    const wallId = id === 'SINGLE_WALL' ? WALL_SPECIES[0] : wid;
    w.seedCompartment(Math.floor(W * at[idx][0]), Math.floor(H * at[idx][1]), wallId, 20, starterGenome(label, '0101'), idx + 1);
  });
  return w;
}

describe('viewer purity', () => {
  it('digest is identical with and without the viewer observer (all four conditions)', () => {
    for (const id of IDS) {
      const bare = buildCondition(id, 16, 1);
      const seen = buildCondition(id, 16, 1);
      for (let t = 0; t < 600; t++) bare.step();
      runWithViewer(seen, 600);
      expect(seen.digest(), id).toBe(bare.digest());
      expect(seen.monomerTotals(), id).toEqual(bare.monomerTotals());
    }
  });

  it('digest is identical when lysins really fire (founders carry a lysin)', () => {
    for (const id of ['LYSE', 'NEUTRAL_WALL'] as const) {
      const bare = lysinWorld(id);
      const seen = lysinWorld(id);
      for (let t = 0; t < 1500; t++) bare.step();
      const v = runWithViewer(seen, 1500);
      expect(v.totals.lyseEvents, id).toBeGreaterThan(0);
      expect(seen.digest(), id).toBe(bare.digest());
    }
  });
});

describe('condition table', () => {
  it('preset table builds every world with residual 0, 0', () => {
    expect(CONDITIONS.map((c) => c.id).sort()).toEqual([...IDS].sort());
    expect(new Set(CONDITIONS.map((c) => c.id)).size).toBe(4);
    for (const c of CONDITIONS) {
      const w = buildCondition(c.id, 16, 1);
      let alive = 0;
      for (let i = 0; i < w.nTiles; i++) alive += w.alive[i];
      expect(alive, c.id).toBe(6);
      const v = runWithViewer(w, 300, false);
      expect(v.residuals(w), c.id).toEqual({ res0: 0, res1: 0 });
    }
  });

  it('condition table pins the run.ts arms', () => {
    const by = Object.fromEntries(CONDITIONS.map((c) => [c.id, c.overrides]));
    expect(by.LYSE).toEqual({ enableLyse: true });
    expect(by.NO_LYSE).toEqual({ enableLyse: false });
    expect(by.SINGLE_WALL).toEqual({ enableLyse: true, singleWallOnly: true });
    expect(by.NEUTRAL_WALL).toEqual({ enableLyse: true, neutralWallLyse: true });
    const dom = (id: string) => {
      const w = buildCondition(id, 32, 1);
      const src = tileSourceOf(w);
      const set = new Set<number>();
      for (let i = 0; i < w.nTiles; i++) if (w.alive[i]) set.add(dominantOf(src, i));
      return set;
    };
    expect(dom('LYSE').size).toBe(6);
    expect([...dom('SINGLE_WALL')]).toEqual([0]);
  });

  it('condition digests match the pre-refactor values (recorded from the old run.ts, 16x16, seed 1, 1000 steps)', () => {
    const expected: Record<string, string> = { LYSE: '991f0ec6', NO_LYSE: 'eaf501b5', SINGLE_WALL: 'fe5cf964', NEUTRAL_WALL: 'be17e461' };
    for (const id of IDS) {
      const w = buildCondition(id, 16, 1);
      for (let t = 0; t < 1000; t++) w.step();
      expect(w.digest().toString(16).padStart(8, '0'), id).toBe(expected[id]);
    }
  });

  it('describeCondition text follows the config', () => {
    const cfg = (o: object) => defaultConfig({ width: 16, height: 16, ...o });
    expect(describeCondition(cfg({ enableLyse: true }))).toMatch(/Predation is on/);
    expect(describeCondition(cfg({ enableLyse: false }))).toMatch(/switched off/);
    expect(describeCondition(cfg({ enableLyse: true, neutralWallLyse: true }))).toMatch(/blind/);
    expect(describeCondition(cfg({ enableLyse: true, singleWallOnly: true }))).toMatch(/0011/);
    expect(describeCondition(cfg({ enableLyse: true }))).not.toBe(describeCondition(cfg({ enableLyse: false })));
  });
});

function dominantOf(src: TileSource, i: number): number {
  let best = 0;
  for (let wi = 1; wi < NUM_WALL_SPECIES; wi++) if (src.wall[i * 6 + wi] > src.wall[i * 6 + best]) best = wi;
  return best;
}

// ---- palette -------------------------------------------------------------------

// Machado 2009, severity 1.0, applied in linear RGB.
const PROTAN = [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]];
const DEUTAN = [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]];
const lin = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
function cvdLab(rgb: readonly number[], m: number[][]): [number, number, number] {
  const l = [lin(rgb[0]), lin(rgb[1]), lin(rgb[2])];
  const o = m.map((row) => Math.min(1, Math.max(0, row[0] * l[0] + row[1] * l[1] + row[2] * l[2])));
  return linearToLab(o[0], o[1], o[2]);
}
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function minPair(cols: readonly (readonly number[])[], d: (a: readonly number[], b: readonly number[]) => number): number {
  let m = Infinity;
  for (let i = 0; i < cols.length; i++) for (let j = i + 1; j < cols.length; j++) m = Math.min(m, d(cols[i], cols[j]));
  return m;
}

describe('palette', () => {
  it('palette order matches WALL_SPECIES labels', () => {
    expect(WALL_NAMES).toEqual(WALL_SPECIES.map((id) => SPECIES[id].label));
    expect(WALL_PALETTE.length).toBe(NUM_WALL_SPECIES);
  });

  it('wall palette is legible on the dark background', () => {
    const floor = WALL_PALETTE.map((c) => dim(c, BRIGHT_FLOOR));
    const half = WALL_PALETTE.map((c) => dim(c, BRIGHT_FLOOR * 0.5));
    const minContrast = Math.min(...floor.map((c) => contrastRatio(c, BG)));
    expect(minContrast, `min contrast at floor ${minContrast.toFixed(2)}`).toBeGreaterThanOrEqual(3);
    // a dimmed predator core stays distinguishable from its full-brightness ring
    const coreRing = Math.min(...WALL_PALETTE.map((c) => contrastRatio(dim(c, BRIGHT_FLOOR * 0.5), c)));
    expect(coreRing, `core vs ring ${coreRing.toFixed(2)}`).toBeGreaterThanOrEqual(1.5);
    void half;
    const dFloor = minPair(floor, labDistance);
    const dFull = minPair(WALL_PALETTE, labDistance);
    expect(dFloor, `min deltaE at floor ${dFloor.toFixed(1)}`).toBeGreaterThanOrEqual(20);
    expect(dFull, `min deltaE full ${dFull.toFixed(1)}`).toBeGreaterThanOrEqual(20);
    for (const [name, m] of [['protan', PROTAN], ['deutan', DEUTAN]] as const) {
      const d = minPair(WALL_PALETTE, (a, b) => dist(cvdLab(a, m), cvdLab(b, m)));
      expect(d, `min deltaE ${name} ${d.toFixed(1)}`).toBeGreaterThanOrEqual(10);
    }
    const L = WALL_PALETTE.map((c) => linearToLab(lin(c[0]), lin(c[1]), lin(c[2]))[0]);
    expect(Math.max(...L) - Math.min(...L), 'L* range').toBeGreaterThanOrEqual(25);
  });

  it('the four trophic colours are distinguishable', () => {
    const cols = [TROPHIC_COLOURS.quiet, TROPHIC_COLOURS.primary, TROPHIC_COLOURS.mixed, TROPHIC_COLOURS.secondary];
    expect(minPair(cols, labDistance)).toBeGreaterThanOrEqual(20);
    for (const m of [PROTAN, DEUTAN]) expect(minPair(cols, (a, b) => dist(cvdLab(a, m), cvdLab(b, m)))).toBeGreaterThanOrEqual(10);
    for (const c of cols) expect(contrastRatio(c, BG)).toBeGreaterThanOrEqual(3);
  });
});

// ---- rendering -----------------------------------------------------------------

function tinyWorld(o: Parameters<typeof defaultConfig>[0] = {}): OligomerWorld {
  return new OligomerWorld(defaultConfig({ width: 4, height: 4, seed: 1, ...o }));
}
function px(out: Uint8ClampedArray, bufW: number, tx: number, ty: number, sx: number, sy: number): number[] {
  const o = ((ty * SUB + sy) * bufW + tx * SUB + sx) * 4;
  return [out[o], out[o + 1], out[o + 2], out[o + 3]];
}
const rgbOf = (a: ArrayLike<number>) => [a[0], a[1], a[2]];

describe('render', () => {
  it('wall-pattern render: dominant wall hue and brightness', () => {
    const w = tinyWorld();
    w.seedCompartment(1, 1, WALL_SPECIES[2], 30, starterGenome('0110'), 1);
    const src = tileSourceOf(w);
    const { w: bw, h: bh } = bufferSize(src);
    expect(bw).toBe(4 * SUB);
    const out = new Uint8ClampedArray(bw * bh * 4);
    renderWallMotif(src, out, { food: 8 });
    expect(out.length).toBe(bw * bh * 4);
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(255);
    const want = dim(WALL_PALETTE[2], 0.75 + 0.25 * Math.min(1, 30 / 32));
    expect(rgbOf(px(out, bw, 1, 1, 2, 2))).toEqual(want);
    expect(rgbOf(px(out, bw, 1, 1, 0, 0))).toEqual(want);
    // a dead tile with its food withdrawn is the background; with food it is tinted
    const dead = rgbOf(px(out, bw, 3, 3, 2, 2));
    expect(dead[2]).toBeGreaterThanOrEqual(BG[2]);
    // rendering twice into the same buffer gives identical bytes (full overwrite)
    const again = new Uint8ClampedArray(out);
    out.fill(7);
    renderWallMotif(src, out, { food: 8 });
    expect(Array.from(out)).toEqual(Array.from(again));
    // an empty-of-food dead tile is exactly BG
    for (let s = 0; s < 30; s++) w.ext[(3 * 4 + 3) * 30 + s] = 0;
    renderWallMotif(src, out, { food: 8 });
    expect(rgbOf(px(out, bw, 3, 3, 2, 2))).toEqual([...BG]);
  });

  it('lysin overlay ring colour is the target motif', () => {
    const mk = (raw: string, o: Parameters<typeof defaultConfig>[0] = { enableLyse: true }) => {
      const w = tinyWorld(o);
      const g = starterGenome('0110');
      g[5] = makeCatalyst(OP_LYSE, raw, 2);
      w.seedCompartment(1, 1, WALL_SPECIES[2], 30, g, 1);
      const src = tileSourceOf(w);
      const { w: bw, h: bh } = bufferSize(src);
      const out = new Uint8ClampedArray(bw * bh * 4);
      const cache = new Map<number, number>();
      renderLysin(src, out, { food: 8 }, cache);
      return { src, out, bw, cache };
    };
    const b = wallBrightness(30);
    // single target (a different motif)
    let r = mk('0101');
    for (let s = 0; s < SUB; s++) expect(rgbOf(px(r.out, r.bw, 1, 1, s, 0))).toEqual([...WALL_PALETTE[1]]);
    expect(rgbOf(px(r.out, r.bw, 1, 1, 2, 2))).toEqual(dim(WALL_PALETTE[2], b * 0.5));
    expect(lysinTargetMask(r.src, 5, r.cache)).toBe(1 << 1);
    const size = r.cache.size;
    expect(lysinTargetMask(r.src, 5, r.cache)).toBe(1 << 1);
    expect(r.cache.size).toBe(size);
    // self-targeting: ring still differs from the dimmed core
    r = mk('0110');
    expect(rgbOf(px(r.out, r.bw, 1, 1, 0, 0))).toEqual([...WALL_PALETTE[2]]);
    expect(rgbOf(px(r.out, r.bw, 1, 1, 0, 0))).not.toEqual(rgbOf(px(r.out, r.bw, 1, 1, 2, 2)));
    // wildcard matching two walls: dotted white ring
    r = mk('01**');
    expect(lysinTargetMask(r.src, 5, r.cache)).toBe((1 << 1) | (1 << 2));
    const ring = [0, 1, 2, 3].map((s) => rgbOf(px(r.out, r.bw, 1, 1, s, 0)));
    expect(ring[0]).toEqual([245, 245, 245]);
    expect(ring[1]).toEqual([...BG]);
    expect(ring[2]).toEqual([245, 245, 245]);
    // blind lysis: dotted white and mask 63 whatever the pattern
    r = mk('0101', { enableLyse: true, neutralWallLyse: true });
    expect(lysinTargetMask(r.src, 5, r.cache)).toBe(63);
    expect(rgbOf(px(r.out, r.bw, 1, 1, 0, 0))).toEqual([245, 245, 245]);
    expect(rgbOf(px(r.out, r.bw, 1, 1, 1, 0))).toEqual([...BG]);
    // predators off: no ring
    r = mk('0101', { enableLyse: false });
    expect(rgbOf(px(r.out, r.bw, 1, 1, 0, 0))).toEqual(rgbOf(px(r.out, r.bw, 1, 1, 2, 2)));
    // a lysin matching no wall: no ring
    r = mk('000*');
    expect(lysinTargetMask(r.src, 5, r.cache)).toBe(0);
    expect(rgbOf(px(r.out, r.bw, 1, 1, 0, 0))).toEqual(rgbOf(px(r.out, r.bw, 1, 1, 2, 2)));
  });

  it('trophic classification thresholds', () => {
    expect(trophicClass(3, 0)).toBe('quiet');
    expect(trophicClass(4, 0)).toBe('primary');
    expect(trophicClass(2, 2)).toBe('mixed');
    expect(trophicClass(0, 8)).toBe('secondary');
    expect(trophicClass(6, 2)).toBe('mixed'); // fSec exactly 0.25
    expect(trophicClass(2, 6)).toBe('mixed'); // fSec exactly 0.75
    expect(trophicClass(7, 2)).toBe('primary');
    expect(trophicClass(2, 7)).toBe('secondary');
  });

  it('chemistry render uses a monotone ramp and rescales', () => {
    const lum = (c: number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
    let prev = -1;
    for (let k = 0; k <= 20; k++) {
      const l = lum(ramp(k / 20));
      expect(l).toBeGreaterThan(prev);
      prev = l;
    }
    expect(rampScale(0, 0)).toBe(4);
    expect(rampScale(0, 100)).toBeCloseTo(98);
    expect(rampScale(500, 100)).toBe(500);
    const w = tinyWorld();
    for (let s = 0; s < 30; s++) for (let i = 0; i < 16; i++) w.ext[i * 30 + s] = 0;
    w.ext[2] = 1; w.ext[3] = 2; w.ext[4] = 3; w.ext[5] = 4; w.ext[0] = 9; w.ext[1] = 1;
    const src = tileSourceOf(w);
    const out = new Uint8ClampedArray(bufferSize(src).w * bufferSize(src).h * 4);
    expect(renderChemistry(src, out, 'dimers', 10)).toBe(10);
    expect(renderChemistry(src, out, 'monomers', 10)).toBe(10);
    expect(renderChemistry(src, out, 'food', 10)).toBe(0);
    // the page now takes the maximum first, so pixels use the scale that is displayed
    expect(channelMax(src, 'dimers')).toBe(10);
    expect(channelMax(src, 'food')).toBe(0);
    const scale = Math.max(4, channelMax(src, 'monomers'));
    renderChemistry(src, out, 'monomers', scale);
    const first = Array.from(out);
    renderChemistry(src, out, 'monomers', scale);
    expect(Array.from(out)).toEqual(first); // a paused redraw is repeatable
    // tile 0 holds the maximum (10 monomers) and tile 1 holds none: exact ends of the ramp
    const bw = bufferSize(src).w, clamp = (c: number[]) => Array.from(new Uint8ClampedArray(c));
    expect(rgbOf(px(out, bw, 0, 0, 2, 2))).toEqual(clamp(ramp(1)));
    expect(rgbOf(px(out, bw, 1, 0, 2, 2))).toEqual(clamp(ramp(0)));
    renderChemistry(src, out, 'monomers', scale * 2);
    expect(rgbOf(px(out, bw, 0, 0, 2, 2))).toEqual(clamp(ramp(0.5)));
  });

  it('tileAt maps pixel to tile and clamps edges; stepTile wraps; zoomFor is integer', () => {
    expect(tileAt(0, 0, 640, 640, 32, 32)).toBe(0);
    expect(tileAt(6.5 * 20, 8.5 * 20, 640, 640, 32, 32)).toBe(8 * 32 + 6);
    expect(tileAt(-5, 9999, 640, 640, 32, 32)).toBe(31 * 32);
    expect(tileAt(640, 640, 640, 640, 32, 32)).toBe(32 * 32 - 1);
    expect(stepTile(0, 'ArrowLeft', 4, 4)).toBe(3);
    expect(stepTile(0, 'ArrowUp', 4, 4)).toBe(12);
    expect(stepTile(15, 'ArrowRight', 4, 4)).toBe(12);
    expect(stepTile(15, 'ArrowDown', 4, 4)).toBe(3);
    expect(zoomFor(160)).toBe(4);
    expect(zoomFor(120)).toBe(5);
    expect(zoomFor(80)).toBe(8);
  });
});

// ---- observer ------------------------------------------------------------------

describe('viewer observer', () => {
  it('RingBuffer keeps the newest 200 and drops the oldest', () => {
    const r = new RingBuffer<number>(200);
    for (let i = 0; i < 250; i++) r.push(i);
    expect(r.length).toBe(200);
    expect(r.at(0)).toBe(50);
    expect(r.at(199)).toBe(249);
    expect(r.toArray()[0]).toBe(50);
    expect(r.toArray().length).toBe(200);
    r.clear();
    expect(r.length).toBe(0);
    r.push(1);
    expect(r.toArray()).toEqual([1]);
  });

  it('badgeState is ok only at exactly 0, 0', () => {
    expect(badgeState(0, 0)).toMatchObject({ ok: true, text: 'res 0, 0', label: 'balanced' });
    expect(badgeState(0, 1).ok).toBe(false);
    expect(badgeState(-2, 0)).toMatchObject({ ok: false, label: 'NOT 0' });
  });

  it('per-tile counters follow swaps, divisions and deaths, and decay to zero', () => {
    const w = tinyWorld();
    const v = new ViewerObserver(w);
    const feedstock = w.cfg.feedstocks[0];
    v.onCleave(2, feedstock, 5);
    v.onCleave(2, 7, 3);
    expect([v.feed[2], v.sec[2]]).toEqual([5, 3]);
    v.onSwap(2, 3);
    expect([v.feed[3], v.sec[3], v.feed[2], v.sec[2]]).toEqual([5, 3, 0, 0]);
    v.onDivide(3, 3);
    expect([v.feed[3], v.sec[3]]).toEqual([0, 0]);
    v.onCleave(4, feedstock, 100);
    v.onCleave(5, feedstock, 1);
    for (let k = 1; k <= 4; k++) v.endStep(64 * k);
    expect(v.feed[4]).toBe(6);
    expect(v.feed[5]).toBe(0);
    v.endStep(65);
    expect(v.feed[4]).toBe(6);
    v.onCleave(6, feedstock, 2);
    v.onDeath(6, true);
    expect(v.feed[6]).toBe(0);
    expect(v.totals.deathsLyse).toBe(1);
  });

  it('hook totals match the census windows over a real run', () => {
    const w = lysinWorld('LYSE');
    const v = runWithViewer(w, 1000, false);
    const rows = v.census.rows;
    expect(rows.length).toBe(1000 / CENSUS_EVERY);
    const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0);
    expect(v.totals.divisions).toBe(sum((r) => r.divisions));
    expect(v.totals.deathsStarve).toBe(sum((r) => r.deathsStarve));
    expect(v.totals.deathsLyse).toBe(sum((r) => r.deathsLyse));
    expect(v.totals.lyseEvents).toBe(sum((r) => r.lyseEvents));
    expect(v.totals.feedCleaves).toBe(sum((r) => r.totalFeedCleaves));
    expect(v.totals.secCleaves).toBe(sum((r) => r.totalSecCleaves));
    expect(v.ring.length).toBe(rows.length);
  });

  it('leader changes count only after settling, and the library rows stay bounded', () => {
    const w = tinyWorld();
    const v = new ViewerObserver(w);
    const origSample = v.census.sample.bind(v.census);
    let nextStep = 0, nextWall = 0;
    v.census.sample = (world: OligomerWorld) => ({ ...origSample(world), step: nextStep, dominantWall: nextWall });
    for (const [s, d] of [[200, 0], [400, 1], [600, 2], [SETTLE_STEPS, 3], [SETTLE_STEPS + 200, 3], [SETTLE_STEPS + 400, 4], [SETTLE_STEPS + 600, 3]] as const) {
      nextStep = s; nextWall = d;
      v.sampleCensus(w);
    }
    expect(v.leaderChanges()).toBe(2);
    for (let i = 0; i < 500; i++) { nextStep = SETTLE_STEPS + 1000 + i * 200; nextWall = 3; v.sampleCensus(w); }
    expect(v.census.rows.length).toBeLessThanOrEqual(v.ring.capacity);
    expect(v.leaderChanges()).toBe(2);
  });

  it('inspector rows describe a live compartment and an empty tile', () => {
    const w = buildCondition('LYSE', 32, 1);
    const v = new ViewerObserver(w);
    const live = inspectRows(w, 8 * 32 + 6, v, new Map()).map((r) => r.join(' ')).join('\n');
    expect(live).toContain('tile (6, 8)');
    expect(live).toContain('0011');
    expect(live).toContain('CLV');
    expect(inspectRows(w, 0, v, new Map()).map((r) => r.join(' ')).join('\n')).toContain('Empty');
    void seedMixedWalls6;
  });
});

// ---- page markup ---------------------------------------------------------------

describe('page markup', () => {
  const html = readFileSync(new URL('../oligomer/index.html', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../src/oligomer/page.ts', import.meta.url), 'utf8');

  it('page markup and script agree', () => {
    const used = new Set<string>();
    for (const m of page.matchAll(/\bel(?:<[^>]*>)?\('([\w-]+)'\)/g)) used.add(m[1]);
    for (const m of page.matchAll(/getElementById\('([\w-]+)'\)/g)) used.add(m[1]);
    expect(used.size).toBeGreaterThan(20);
    for (const id of used) expect(html, id).toContain(`id="${id}"`);
    expect(html).toContain('name="robots" content="noindex"');
    expect(html).toContain('id="main"');
    expect(html).toContain('<html lang="en">');
    for (const id of ['view', 'start', 'size', 'pace', 'seed']) expect(html, id).toContain(`for="${id}"`);
    expect(html).toContain('<script type="module" src="/src/oligomer/page.ts"></script>');
    const worldBlock = html.slice(html.indexOf('<select id="start">'), html.indexOf('</select>', html.indexOf('<select id="start">')));
    const values = [...worldBlock.matchAll(/value="([^"]+)"/g)].map((m) => m[1]);
    expect(values.sort()).toEqual(CONDITIONS.map((c) => c.id).sort());
    expect(page).not.toMatch(/localStorage|fetch\(|window\.__/);
  });

  it('labels are observational and the empty chart resets its description', () => {
    expect(html).not.toContain('Deaths by hunger');
    expect(html).not.toContain('Deaths by lysin');
    expect(html).toContain('Deaths with no neighbour cut');
    expect(html).toContain('after step 20,000');
    expect(page).toMatch(/if \(!last\) \{[^}]*No census yet/);
    expect(page).toMatch(/raw === ''/);
  });

  it('option text avoids bare codes', () => {
    for (const m of html.matchAll(/<option[^>]*>([^<]*)<\/option>/g)) {
      expect(m[1].trim()).not.toMatch(/^(LYSE|NO_LYSE|NEUTRAL_WALL|SINGLE_WALL)$/);
      expect(m[1]).not.toMatch(/\b(NO_LYSE|NEUTRAL_WALL|SINGLE_WALL)\b/);
    }
  });
});
void OP_CLEAVE;
