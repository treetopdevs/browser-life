// Skeptic's independent recompute. Usage: node --no-warnings own.ts <outdir> <label> [v3 flags...]   env POS="x,y;x,y;..." overrides founder positions.
// Runs the model itself (no readout.json is read), labels components with its own union-find, and measures cell-level churn.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const { BodiesWorld, FOUNDER_GENOME, basinLabels } = await import(process.env.MODEL ?? '/Users/nicholas/develop/browser-life-bodies/apps/lab/src/bodies/model.ts');
type BodiesWorld = any;
import { parseArgs } from '/Users/nicholas/develop/browser-life-bodies/experiments/bodies/v3.ts';
import { writeFrameV3 } from '/Users/nicholas/develop/browser-life-bodies/experiments/bodies/png.ts';

const [outDir, label, ...flags] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const o = parseArgs(flags);
const W = Number(process.env.SIZE ?? 96), H = W, N = W * H;
const SPOTS: [number, number][] = [[24, 24], [72, 30], [46, 72], [20, 68], [74, 74]];
let positions: [number, number][] = o.scenario === 'pair' ? [[41, 48], [55, 48]] : SPOTS.slice(0, o.founders);
if (process.env.POS) positions = process.env.POS.split(';').map((s) => s.split(',').map(Number) as [number, number]);
const n = positions.length;
const tags = o.tags === 'same' ? new Array(n).fill(0) : o.tags ?? (o.scenario === 'pair' ? [64, 192] : Array.from({ length: n }, (_, i) => Math.floor(i * 256 / n)));
const genome = o.genome ?? (o.scenario === 'pair' ? [16, 60, 0, 0] : FOUNDER_GENOME);
const w = new BodiesWorld({ seed: o.seed, founders: n, positions, founderTags: tags, genome: genome as any, mutRate: o.mut ? o.mutRate : 0, blind: o.geneBlind, upkeep: o.upkeep, tagMutRate: o.tagMutRate, tagBlind: o.tagBlind, rules: o.rules });
const TOL = w.R.TAG_TOL;
const circ = (a: number, b: number) => { let x = a - b; if (x < 0) x = -x; return x > 128 ? 256 - x : x; };
const nb8 = (i: number): number[] => { const x = i % W, y = (i - x) / W, r: number[] = []; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) r.push(((y + dy + H) % H) * W + ((x + dx + W) % W)); return r; };
const nb4 = (i: number): number[] => { const x = i % W, y = (i - x) / W; return [y * W + (x + 1) % W, y * W + (x + W - 1) % W, ((y + 1) % H) * W + x, ((y + H - 1) % H) * W + x]; };
const NB8 = Array.from({ length: N }, (_, i) => nb8(i)), NB4 = Array.from({ length: N }, (_, i) => nb4(i));

function label8(live: (i: number) => boolean, link: (i: number, p: number) => boolean, nbs: number[][]): { lab: Int32Array; sizes: number[] } {
  const lab = new Int32Array(N).fill(-1); const sizes: number[] = []; const st = new Int32Array(N);
  for (let s = 0; s < N; s++) {
    if (!live(s) || lab[s] >= 0) continue;
    let sp = 0, sz = 0; st[sp++] = s; lab[s] = sizes.length;
    while (sp) { const i = st[--sp]; sz++; for (const p of nbs[i]) if (live(p) && lab[p] < 0 && link(i, p)) { lab[p] = sizes.length; st[sp++] = p; } }
    sizes.push(sz);
  }
  return { lab, sizes };
}

interface Snap { t: number; cell: Uint8Array; kin: Uint8Array; gen: Uint32Array; lab: Int32Array; sizes: number[] }
function analyse(prev: Snap | null, ref: Snap | null) {
  const live = (i: number) => w.cell[i] === 1;
  const c8 = label8(live, () => true, NB8), c4 = label8(live, () => true, NB4);
  const clade = label8(live, (i, p) => circ(w.kin[i], w.kin[p]) <= TOL, NB8); // kin-match clades, 8-conn (my own)
  const cells = w.cellCount();
  const sort = (a: number[]) => [...a].sort((x, y) => y - x);
  const s8 = sort(c8.sizes);
  // foreign contacts (live, 8-adjacent, marks not matching) and gap tiles (empty tile touching >=2 different 8-components or >=2 different clades)
  let foreignPairs = 0, gapTiles = 0, gapFood = 0, emptyTiles = 0;
  for (let i = 0; i < N; i++) {
    if (w.cell[i]) { for (const p of NB8[i]) if (p > i && w.cell[p] && circ(w.kin[i], w.kin[p]) > TOL) foreignPairs++; continue; }
    emptyTiles++;
    const comps = new Set<number>(); for (const p of NB8[i]) if (w.cell[p]) comps.add(clade.lab[p]);
    if (comps.size >= 2) { gapTiles++; gapFood += w.food[i]; }
  }
  // component size histogram and small-fragment share
  const frag = c8.sizes.filter((z) => z < 30); const fragCells = frag.reduce((a, b) => a + b, 0);
  const row: any = {
    t: w.t, cells, comps8: c8.sizes.length, comps4: c4.sizes.length, big8_ge30: c8.sizes.filter((z) => z >= 30).length, fragCells, top8: s8.slice(0, 6), medianBig: (() => { const b = s8.filter((z) => z >= 30); return b.length ? b[(b.length - 1) >> 1] : 0; })(),
    clades: clade.sizes.length, cladesBig: clade.sizes.filter((z) => z >= 30).length, cladeTop: sort(clade.sizes).slice(0, 4),
    distinctKin: new Set([...w.kin].filter((_, i) => w.cell[i])).size, foreignPairs, gapTiles, gapFoodMean: gapTiles ? +(gapFood / gapTiles).toFixed(1) : 0, emptyTiles,
    basins: (() => { const c = [...basinLabels(w).count.values()].sort((a, b) => a - b); return { n: c.length, median: c.length ? c[(c.length - 1) >> 1] : 0 }; })(), rootsNow: (() => { let r = 0; for (let i = 0; i < N; i++) if (w.cell[i] && w.d[i] === 0) r++; return r; })(),
    births: w.births, blockedGrow: w.blockedGrow, blockedBud: w.blockedBud, roots: w.rootsCreated - w.rootsEnded,
  };
  if (prev) {
    let both = 0, genChanged = 0, kinChanged = 0;
    for (let i = 0; i < N; i++) if (prev.cell[i] && w.cell[i]) { both++; if (prev.gen[i] !== w.gen[i]) genChanged++; if (circ(prev.kin[i], w.kin[i]) > TOL) kinChanged++; }
    row.churn = { dt: w.t - prev.t, tilesBoth: both, genChanged, kinTakeover: kinChanged, died: prev.cell.reduce((a, v, i) => a + (v && !w.cell[i] ? 1 : 0), 0) };
  }
  if (ref) {
    // persistence of reference clades (kin-match clades >=30 cells at ref): best overlap with one current clade, counting only tiles live now with a matching mark
    const refClade = label8((i) => ref.cell[i] === 1, (i, p) => circ(ref.kin[i], ref.kin[p]) <= TOL, NB8);
    const ov = new Map<string, number>(); const refSz = refClade.sizes;
    for (let i = 0; i < N; i++) if (ref.cell[i] && w.cell[i] && circ(ref.kin[i], w.kin[i]) <= TOL) { const k = refClade.lab[i] + ':' + clade.lab[i]; ov.set(k, (ov.get(k) ?? 0) + 1); }
    const best = new Map<number, number>(); for (const [k, v] of ov) { const a = +k.split(':')[0]; best.set(a, Math.max(best.get(a) ?? 0, v)); }
    const pers: number[] = []; refSz.forEach((z, a) => { if (z >= 30) pers.push(Math.round(1000 * (best.get(a) ?? 0) / z)); });
    { let refLive = 0, still = 0, kinMis = 0, genDiff = 0, emptyNow = 0; for (let i = 0; i < N; i++) if (ref.cell[i]) { refLive++; if (w.cell[i]) { still++; if (circ(ref.kin[i], w.kin[i]) > TOL) kinMis++; if (ref.gen[i] !== w.gen[i]) genDiff++; } else emptyNow++; } row.tileFate = { refT: ref.t, refLive, still, emptyNow, stillKinMismatch: kinMis, stillGenDiffers: genDiff }; }
    row.persist = { refT: ref.t, nRefBig: pers.length, medianPermille: pers.length ? pers.sort((x, y) => x - y)[(pers.length - 1) >> 1] : null, minPermille: pers.length ? Math.min(...pers) : null };
  }
  return { row, snap: { t: w.t, cell: Uint8Array.from(w.cell), kin: Uint8Array.from(w.kin), gen: Uint32Array.from(w.gen), lab: clade.lab, sizes: clade.sizes } as Snap };
}

const every = Number(process.env.EVERY ?? 500), refAt = Number(process.env.REFAT ?? 10000);
const rows: any[] = []; let prev: Snap | null = null, ref: Snap | null = null; const t0 = Date.now();
const frameAt = new Set((process.env.FRAMES ?? '').split(',').filter(Boolean).map(Number));
for (let t = 1; t <= o.steps; t++) {
  w.step(1);
  if (frameAt.has(t) && W === 96) writeFrameV3(join(outDir, `${label}-frame-t${String(t).padStart(5, '0')}.png`), w, 5);
  if (t % every === 0) {
    const a = analyse(prev, ref); rows.push(a.row); prev = a.snap;
    if (t === refAt) ref = a.snap;
  }
}
const resid = w.residual();
writeFileSync(join(outDir, `${label}.json`), JSON.stringify({ label, flags, positions, tags, residual: resid, ms: Date.now() - t0, rows }) + '\n');
console.log(label, 'done', 'cells', w.cellCount(), 'residual', resid, 'ms', Date.now() - t0);
