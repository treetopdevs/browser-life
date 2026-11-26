// Skeptic re-derivation: runs the model directly (no harness), recomputes everything with its own code.
// usage: node --no-warnings sk.ts NAME seed steps founders|rand:K:posSeed blind(0|1) [rulesJSON] [sampleEvery]
import { BodiesWorld } from '../../../../../apps/lab/src/bodies/model.ts';
import { deflateSync, crc32 } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
const [name, seedS, stepsS, fnd, blindS, rulesS, sampS] = process.argv.slice(2);
const seed = +seedS, steps = +stepsS, blind = blindS === '1', rulesX = rulesS ? JSON.parse(rulesS) : {}, every = +(sampS ?? 1000);
const W = 96, H = 96, N = W * H;
const SPOTS: [number, number][] = [[24, 24], [72, 30], [46, 72], [20, 68], [74, 74]];
let positions: [number, number][];
if (fnd.startsWith('rand:')) {
  const [, K, ps] = fnd.split(':'); let s = (+ps * 2654435761) >>> 0; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s >>> 8; };
  positions = []; for (let k = 0; k < +K; k++) positions.push([rnd() % W, rnd() % H]);
} else { const k = +fnd; positions = k === 1 ? [[48, 48]] : SPOTS.slice(0, k); }
const n = positions.length;
const tags = Array.from({ length: n }, (_, i) => Math.floor(i * 256 / n));
const w = new BodiesWorld({ seed, founders: n, positions, founderTags: tags, genome: (process.env.GENOME ? process.env.GENOME.split(',').map(Number) : [16, 60, 4, 0]) as any, upkeep: true, tagMutRate: 65536, tagBlind: blind,
  rules: { GATE_GROW: 1, TAG_STEP: 40, TAG_MUT_BUD: 1, ...rulesX } });
const nb8 = (i: number) => { const x = i % W, y = (i - x) / W, o: number[] = []; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) o.push(((y + dy + H) % H) * W + ((x + dx + W) % W)); return o; };
const nb4 = (i: number) => { const x = i % W, y = (i - x) / W; return [((y + 0 + H) % H) * W + ((x + 1) % W), ((y + 0 + H) % H) * W + ((x + W - 1) % W), ((y + 1) % H) * W + x, ((y + H - 1) % H) * W + x]; };
// union-find components; `join(i,p)` decides whether adjacent live cells are joined; `nbf` neighbourhood.
function comps(nbf: (i: number) => number[], join: (i: number, p: number) => boolean) {
  const par = new Int32Array(N).map((_, i) => i); const find = (a: number): number => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  for (let i = 0; i < N; i++) if (w.cell[i]) for (const p of nbf(i)) if (w.cell[p] && join(i, p)) { const a = find(i), b = find(p); if (a !== b) par[a] = b; }
  const lab = new Int32Array(N).fill(-1), size = new Map<number, number>();
  for (let i = 0; i < N; i++) if (w.cell[i]) { const r = find(i); lab[i] = r; size.set(r, (size.get(r) ?? 0) + 1); }
  return { lab, size };
}
const circ = (a: number, b: number) => { let x = Math.abs(a - b); if (x > 128) x = 256 - x; return x; };
const med = (a: number[]) => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); return b[(b.length - 1) >> 1]; };
const rows: any[] = [];
let prevLab: Int32Array | null = null, prevSz = new Map<number, number>(); const ever = new Uint8Array(N); let t10: Uint8Array | null = null; const cum: Record<number, { b: number; d: number }> = { 10: { b: 0, d: 0 }, 40: { b: 0, d: 0 }, 100: { b: 0, d: 0 } };
function track(ex: { lab: Int32Array; size: Map<number, number> }) {
  if (prevLab) {
    const ov = new Map<string, number>();
    for (let i = 0; i < N; i++) if (prevLab[i] >= 0 && ex.lab[i] >= 0 && w.kin[i] === prevKinT[i]) { const k = prevLab[i] + ',' + ex.lab[i]; ov.set(k, (ov.get(k) ?? 0) + 1); }
    for (const m of [10, 40, 100]) {
      const linkedOld = new Set<number>(), linkedNew = new Set<number>();
      for (const [k, c] of ov) { const [a, b] = k.split(',').map(Number); const sa = prevSz.get(a)!, sb = ex.size.get(b)!; if (sa >= m && sb >= m && c * 2 >= Math.min(sa, sb)) { linkedOld.add(a); linkedNew.add(b); } }
      for (const [a, sa] of prevSz) if (sa >= m && !linkedOld.has(a)) cum[m].d++;
      for (const [b, sb] of ex.size) if (sb >= m && !linkedNew.has(b)) cum[m].b++;
    }
  }
  prevLab = ex.lab.slice(); prevSz = new Map(ex.size); prevKinT = w.kin.slice();
}
let prevKinT = new Uint8Array(N); let prevCell = new Uint8Array(N), prevKin = new Uint8Array(N), prevBirths = 0, prevCells = n;
function sample() {
  const c8 = comps(nb8, () => true), c4 = comps(nb4, () => true);
  const ex = comps(nb8, (i, p) => w.kin[i] === w.kin[p]);              // exact-equal-mark patches
  const sizes8 = [...c8.size.values()].sort((a, b) => b - a);
  const cells = w.cellCount();
  // per 8-component: distinct marks, #roots, perimeter(4-exposure)
  const per = new Map<number, { marks: Set<number>; roots: number; per: number; area: number }>();
  for (let i = 0; i < N; i++) if (w.cell[i]) { const r = c8.lab[i]; let o = per.get(r); if (!o) per.set(r, o = { marks: new Set(), roots: 0, per: 0, area: 0 }); o.marks.add(w.kin[i]); o.area++; if (w.d[i] === 0) o.roots++; for (const p of nb4(i)) if (!w.cell[p]) o.per++; }
  const P = [...per.values()].filter((o) => o.area >= 20);
  const compact = P.map((o) => o.per / Math.sqrt(o.area));        // 4*sqrt(area) = ideal square; bigger = more ragged
  const exSizes = [...ex.size.values()].sort((a, b) => b - a);
  // compactness of exact-mark patches (>=20 cells): 4-edges to a different patch or empty, over sqrt(area); disk ~ 3.5, square 4
  const pp = new Map<number, number>(); for (let i = 0; i < N; i++) if (w.cell[i]) { let e = 0; for (const p of nb4(i)) if (!w.cell[p] || ex.lab[p] !== ex.lab[i]) e++; pp.set(ex.lab[i], (pp.get(ex.lab[i]) ?? 0) + e); }
  const pcompact = [...ex.size].filter(([, a]) => a >= 20).map(([r, a]) => Math.round(100 * pp.get(r)! / Math.sqrt(a)));
  // patches that are cut into pieces: tiles of the same exact mark in >1 patch is natural; count components of each patch with holes=empty tiles inside bbox ignored
  if (w.t >= steps / 2) { if (!t10) t10 = w.cell.slice(); for (let i = 0; i < N; i++) if (w.cell[i] !== prevCell[i]) ever[i] = 1; }
  track(ex);
  // non-matching (circ>tol) 8-adjacent live pairs (seam, by my own count) and nearest-foreign distance
  let seam8 = 0; for (let i = 0; i < N; i++) if (w.cell[i]) for (const p of nb8(i)) if (p > i && w.cell[p] && circ(w.kin[i], w.kin[p]) > 16) seam8++;
  // turnover: cell-level births/deaths since last sample, tile-level mark map change
  const births = w.births - prevBirths, dCells = cells - prevCells, deaths = births - dCells;
  let changedTiles = 0, liveBoth = 0, mkChange = 0; for (let i = 0; i < N; i++) { if ((w.cell[i] !== prevCell[i])) changedTiles++; else if (w.cell[i]) { liveBoth++; if (w.kin[i] !== prevKin[i]) mkChange++; } }
  const marks = new Set<number>(); for (let i = 0; i < N; i++) if (w.cell[i]) marks.add(w.kin[i]);
  let roots = 0; for (let i = 0; i < N; i++) if (w.cell[i] && w.d[i] === 0) roots++;
  // component size histogram (log2)
  rows.push({ t: w.t, cells, comps8: sizes8.length, comps4: c4.size.size, big8: sizes8.filter((s) => s >= 20).length, sizes8top: sizes8.slice(0, 10), medBig: med(sizes8.filter((s) => s >= 20)),
    exPatches: exSizes.length, exBig: exSizes.filter((s) => s >= 20).length, exMed: med(exSizes.filter((s) => s >= 20)), distinctMarks: marks.size,
    mixedComps: P.filter((o) => o.marks.size > 1).length, rootsTotal: roots, rootsPerBigComp: med(P.map((o) => o.roots)), compactMed: +med(compact.map((v) => Math.round(v * 100))) / 100, patchCompactMed: med(pcompact) / 100, cumB10: cum[10].b, cumD10: cum[10].d, cumB40: cum[40].b, cumD40: cum[40].d, cumB100: cum[100].b, cumD100: cum[100].d, sizes8all: sizes8.length < 80 ? sizes8 : sizes8.slice(0, 80), multiRootComps: P.filter((o) => o.roots > 1).length, bigComps: P.length,
    seam8, births, deaths, tilesFlipped: changedTiles, markChangedOfLive: mkChange, liveBoth, residual: w.residual() });
  prevCell = w.cell.slice(); prevKin = w.kin.slice(); prevBirths = w.births; prevCells = cells;
}
const dir = `runs/${name}`; mkdirSync(dir, { recursive: true });
const t0 = Date.now();
for (let t = 1; t <= steps; t++) { w.step(1); if (t % every === 0) sample(); }
// final dump of mark+cell for frames, own png
const hue = (k: number) => { const h = (k / 256) * 6, f = h - Math.floor(h), q = 1 - f; const m = [[1, f, 0], [q, 1, 0], [0, 1, f], [0, q, 1], [f, 0, 1], [1, 0, q]][Math.floor(h) % 6]; return m.map((v) => Math.round(70 + 185 * v)); };
const S = 6, c8 = comps(nb8, () => true);
const img = new Uint8Array(W * S * H * S * 4);
// colour by mark; draw component outline in black? keep: empty = dark, component-boundary darkened
for (let y = 0; y < H * S; y++) for (let x = 0; x < W * S; x++) {
  const i = ((y / S) | 0) * W + ((x / S) | 0), o = (y * W * S + x) * 4; let r = 25, g = 25, b = 30;
  if (w.cell[i]) { [r, g, b] = hue(w.kin[i]); if (w.d[i] === 0 && (x % S) > 1 && (x % S) < 4 && (y % S) > 1 && (y % S) < 4) { r = g = b = 255; } }
  img[o] = r; img[o + 1] = g; img[o + 2] = b; img[o + 3] = 255;
}
function png(width: number, height: number, rgba: Uint8Array) {
  const raw = Buffer.alloc((width * 4 + 1) * height); for (let y = 0; y < height; y++) { raw[y * (width * 4 + 1)] = 0; raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1); }
  const ch = (t: string, d: Uint8Array) => { const o = Buffer.alloc(12 + d.length); o.writeUInt32BE(d.length, 0); o.write(t, 4, 'ascii'); o.set(d, 8); o.writeUInt32BE(crc32(o.subarray(4, 8 + d.length)) >>> 0, 8 + d.length); return o; };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(width, 0); ih.writeUInt32BE(height, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch('IHDR', ih), ch('IDAT', deflateSync(raw)), ch('IEND', new Uint8Array(0))]);
}
writeFileSync(`${dir}/frame-end.png`, png(W * S, H * S, img));
const everN = ever.reduce((a, b) => a + b, 0), liveEnd = w.cellCount(); let flipLive = 0; for (let i = 0; i < N; i++) if (ever[i] && w.cell[i]) flipLive++;
writeFileSync(`${dir}/skeptic.json`, JSON.stringify({ everFlipped: everN, everFlippedLiveAtEnd: flipLive, liveEnd, args: { name, seed, steps, fnd, blind, rulesX, every }, positions, tags, rows, ms: Date.now() - t0 }));
console.log(name, 'done', Date.now() - t0, 'ms');
