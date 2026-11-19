// Headless harness for set-loose bodies rules v3 (recognition marks and boundaries). One CLI: every knob is a flag, nothing is hard-wired.
// Everything is deterministic given the flags (no clocks in the physics; wall times go in `timingMs`, outside the readouts).
//
// Usage:
//   PATH=/Users/nicholas/.nvm/versions/node/v24.2.0/bin:$PATH node experiments/bodies/v3.ts --scenario pair|crowd|wound-in-crowd --out <dir> [flags]
//
// Scenario
//   --scenario S        pair | crowd | wound-in-crowd                                   (default crowd)
//   --seed N            world seed                                                      (default 1)
//   --steps N           steps to run                                                    (default 20000)
//   --founders N        crowd / wound-in-crowd: founders 1..5 at the v2 long-run spots  (default 3; pair always has 2)
//   --genome a,b,c,d    founder genome dmax,grow,bud,rim                                (default 16,60,4,0; pair 16,60,0,0 = budless)
//   --tags a,b,..|same  founder marks 0..255, one per founder; `same` gives every founder mark 0
//                       (default: spread evenly, 256*i/n; pair: 64,192 which are 128 apart, the maximum)
//   --gap N             pair: distance between the two founders along the row y=48      (default 14; bodies of dmax 16 reach 8 each)
//   --upkeep on|off     upkeep switch (default on; off is the fed world)
// Mutation (all independent)
//   --mut on|off        gene mutation (dmax, grow, bud, rim)                            (default off)
//   --mut-rate N        gene mutation rate per birth out of 256, used when --mut on     (default 3 = the v2 value)
//   --gene-blind        neutral control: genes mutate, every dynamics read uses the founder genome
//   --tag-mut-rate N    recognition-mark mutation per birth out of 65536               (default 0 = marks never mutate)
//   --tag-blind         control: marks mutate and are inherited, every gate/seam/raid treats all pairs as matching
//   pair has no mutation: --mut on or --tag-mut-rate > 0 is an error there.
// v3 rule knobs (shortcuts for --rules-override; the shortcuts win when both are given)
//   --gates share,grow,signal   any subset, comma separated (GATE_SHARE, GATE_GROW, GATE_SIGNAL = 1)
//   --seam-cost N       SEAM_COST: extra store burned at an upkeep tick by a cell that touches a non-matching 4-neighbour
//   --raid N            RAID: a cell takes up to N from a richer non-matching 4-neighbour (at most half the gap), once per step
//   --tol N             TAG_TOL: match when the circular mark distance is <= N (128 or more matches every pair)   (rule default 16)
//   --tag-step N        TAG_STEP: a mark mutation moves the mark by +-N, circular                                  (rule default 8)
//   --tol-gene          TAG_TOL_GENE=1: the tolerance is a heritable gene (starts at TAG_TOL; a pair of cells matches under the LOWER of the two tolerances)
//   --tag-mut-bud       TAG_MUT_BUD=1: marks mutate only at bud births (new bodies), not at growth births
//   --rules-override J  JSON object of any rule constants, e.g. '{"UPK":6,"GATE_SHARE":1}'; unknown keys are an error
// Flags that would silently do nothing are errors (exit 2): --founders with pair, --gap without pair, --wound-* without wound-in-crowd, --mut-rate or --gene-blind
//   without --mut on, --tag-step / --tol-gene / --tag-mut-bud (also as --rules-override keys) without --tag-mut-rate > 0, --tag-blind without any gate / seam cost / raid,
//   --frames or --frame-scale with --no-frames. --tol is always allowed (the readouts use it).
// Readouts and output
//   --out DIR           output directory (required); writes readout.json and frame PNGs
//   --sample-every N    readout row every N steps (default 200)
//   --min-patch N       patches smaller than this are not counted in births/deaths/ages (default 10)
//   --lone-ref N        reference body size for the basin `within2Permille` readout (default 170)
//   --frames a,b,..     steps at which to write a 3-panel frame (mark | lineage | d); `end` allowed; default depends on the scenario
//   --no-frames         write no PNGs;  --frame-scale N  pixels per tile (default 5)
//   --quiet             no progress lines
// wound-in-crowd only
//   --wound-at N        step of the wound (default 8000; must be < --steps)
//   --wound-radius N    wound disk radius (default 4);  --wound-d N  wound centre at chamfer d near N inside the target basin (default 14, about 7 tiles from its root)
//   --wound-watch N     steps tracked after the wound (default 1500);  --wound-every N  tracking interval (default 50)
//   The target is the root basin (observer label) whose size is the median of basins of at least 60 cells; its root is spared (no root tile is inside the disk).
//   woundTrack rows count the basin's tiles and the disk's tiles that are live again and how many of those carry a mark matching the pre-wound majority mark.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BodiesWorld, FOUNDER_GENOME, RULES_V2, basinLabels, hashState, hashStateFull, validateWorld } from '../../apps/lab/src/bodies/model.ts';
import type { Genome } from '../../apps/lab/src/bodies/model.ts';
import { PatchTracker, observe, realMarksMatch } from '../../apps/lab/src/bodies/observe.ts';
import { writeFrameV3 } from './png.ts';

export type Scenario = 'pair' | 'crowd' | 'wound-in-crowd';
export interface V3Options {
  scenario: Scenario; seed: number; steps: number; founders: number; genome: Genome | null; tags: number[] | 'same' | null; gap: number; upkeep: boolean;
  mut: boolean; mutRate: number; geneBlind: boolean; tagMutRate: number; tagBlind: boolean; rules: Record<string, number>;
  sampleEvery: number; minPatch: number; loneRef: number; frames: (number | 'end')[] | null; noFrames: boolean; frameScale: number; out: string | null; quiet: boolean;
  woundAt: number; woundRadius: number; woundD: number; woundWatch: number; woundEvery: number;
}
export const defaultOptions = (): V3Options => ({
  scenario: 'crowd', seed: 1, steps: 20000, founders: 3, genome: null, tags: null, gap: 14, upkeep: true, mut: false, mutRate: RULES_V2.MUT, geneBlind: false, tagMutRate: 0, tagBlind: false,
  rules: {}, sampleEvery: 200, minPatch: 10, loneRef: 170, frames: null, noFrames: false, frameScale: 5, out: null, quiet: false,
  woundAt: 8000, woundRadius: 4, woundD: 14, woundWatch: 1500, woundEvery: 50,
});

const FOUNDER_SPOTS: readonly (readonly [number, number])[] = [[24, 24], [72, 30], [46, 72], [20, 68], [74, 74]];
const pad = (t: number, n = 5) => String(t).padStart(n, '0');
const mode = (a: number[]) => { const m = new Map<number, number>(); for (const v of a) m.set(v, (m.get(v) ?? 0) + 1); let best = -1, bn = 0; for (const [v, n] of [...m].sort((x, y) => x[0] - y[0])) if (n > bn) { best = v; bn = n; } return best; };

// ------------------------------------------------------------------ flag parsing (strict: unknown flags and malformed values throw)
const BOOLEAN = new Set(['gene-blind', 'tag-blind', 'tol-gene', 'tag-mut-bud', 'no-frames', 'quiet', 'help']);
const VALUED = new Set(['scenario', 'seed', 'steps', 'founders', 'genome', 'tags', 'gap', 'upkeep', 'mut', 'mut-rate', 'tag-mut-rate', 'gates', 'seam-cost', 'raid', 'tol', 'tag-step', 'rules-override',
  'out', 'sample-every', 'min-patch', 'lone-ref', 'frames', 'frame-scale', 'wound-at', 'wound-radius', 'wound-d', 'wound-watch', 'wound-every']);
const int = (name: string, v: string, lo = 0, hi = Number.MAX_SAFE_INTEGER): number => {
  const n = Number(v); if (v.trim() === '' || !Number.isInteger(n) || n < lo || n > hi) throw new Error(`--${name} needs an integer in ${lo}..${hi}, got '${v}'`); return n;
};
const list = (name: string, v: string, lo: number, hi: number) => v.split(',').map((s) => int(name, s, lo, hi));
const onOff = (name: string, v: string) => { if (v !== 'on' && v !== 'off') throw new Error(`--${name} needs on or off, got '${v}'`); return v === 'on'; };

export function parseArgs(argv: string[]): V3Options {
  const o = defaultOptions(); const seen = new Map<string, string | true>();
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k]; if (!a.startsWith('--')) throw new Error(`unexpected argument '${a}'`);
    const name = a.slice(2);
    if (BOOLEAN.has(name)) { seen.set(name, true); continue; }
    if (!VALUED.has(name)) throw new Error(`unknown flag --${name}`);
    const v = argv[++k]; if (v === undefined || (v.startsWith('--') && !/^--?\d/.test(v))) throw new Error(`--${name} needs a value`);
    seen.set(name, v);
  }
  const s = (n: string) => seen.get(n) as string | undefined; const b = (n: string) => seen.has(n);
  if (b('help')) throw new Error('help requested: see the header comment of experiments/bodies/v3.ts');
  if (s('scenario')) { if (!['pair', 'crowd', 'wound-in-crowd'].includes(s('scenario')!)) throw new Error(`--scenario must be pair, crowd or wound-in-crowd, got '${s('scenario')}'`); o.scenario = s('scenario') as Scenario; }
  if (s('seed')) o.seed = int('seed', s('seed')!, -2147483648, 2147483647);
  if (s('steps')) o.steps = int('steps', s('steps')!, 0);
  if (s('founders')) o.founders = int('founders', s('founders')!, 1, 5);
  if (s('genome')) { const g = list('genome', s('genome')!, 0, 255); if (g.length !== 4) throw new Error('--genome needs four integers dmax,grow,bud,rim'); o.genome = g as unknown as Genome; }
  if (s('tags')) o.tags = s('tags') === 'same' ? 'same' : list('tags', s('tags')!, 0, 255);
  if (s('gap')) o.gap = int('gap', s('gap')!, 1, 40);
  if (s('upkeep')) o.upkeep = onOff('upkeep', s('upkeep')!);
  if (s('mut')) o.mut = onOff('mut', s('mut')!);
  if (s('mut-rate')) o.mutRate = int('mut-rate', s('mut-rate')!, 0, 256);
  o.geneBlind = b('gene-blind'); o.tagBlind = b('tag-blind');
  if (s('tag-mut-rate')) o.tagMutRate = int('tag-mut-rate', s('tag-mut-rate')!, 0, 65536);
  if (s('rules-override')) {
    let j: unknown; try { j = JSON.parse(s('rules-override')!); } catch { throw new Error('--rules-override is not valid JSON'); }
    if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('--rules-override must be a JSON object');
    for (const [key, v] of Object.entries(j)) { if (typeof v !== 'number') throw new Error(`--rules-override ${key} must be a number`); o.rules[key] = v; }
  }
  if (s('gates')) for (const g of s('gates')!.split(',')) {
    if (!['share', 'grow', 'signal'].includes(g)) throw new Error(`--gates takes share, grow, signal (comma separated), got '${g}'`);
    o.rules[`GATE_${g.toUpperCase()}`] = 1;
  }
  if (s('seam-cost')) o.rules.SEAM_COST = int('seam-cost', s('seam-cost')!);
  if (s('raid')) o.rules.RAID = int('raid', s('raid')!);
  if (s('tol')) o.rules.TAG_TOL = int('tol', s('tol')!);
  if (s('tag-step')) o.rules.TAG_STEP = int('tag-step', s('tag-step')!);
  if (b('tol-gene')) o.rules.TAG_TOL_GENE = 1;
  if (b('tag-mut-bud')) o.rules.TAG_MUT_BUD = 1;
  if (s('out')) o.out = s('out')!;
  if (s('sample-every')) o.sampleEvery = int('sample-every', s('sample-every')!, 1);
  if (s('min-patch')) o.minPatch = int('min-patch', s('min-patch')!, 1);
  if (s('lone-ref')) o.loneRef = int('lone-ref', s('lone-ref')!, 0);
  if (s('frames')) o.frames = s('frames')!.split(',').map((x) => (x === 'end' ? 'end' : int('frames', x, 0)));
  o.noFrames = b('no-frames'); o.quiet = b('quiet');
  if (s('frame-scale')) o.frameScale = int('frame-scale', s('frame-scale')!, 1, 12);
  if (s('wound-at')) o.woundAt = int('wound-at', s('wound-at')!, 1);
  if (s('wound-radius')) o.woundRadius = int('wound-radius', s('wound-radius')!, 1, 20);
  if (s('wound-d')) o.woundD = int('wound-d', s('wound-d')!, 0, 250);
  if (s('wound-watch')) o.woundWatch = int('wound-watch', s('wound-watch')!, 1);
  if (s('wound-every')) o.woundEvery = int('wound-every', s('wound-every')!, 1);
  // Flags that would silently do nothing are errors: say what you mean.
  const used = (...names: string[]) => names.filter((n) => seen.has(n)).map((n) => `--${n}`);
  const bad = (flags: string[], why: string) => { if (flags.length) throw new Error(`${flags.join(', ')} ${why}`); };
  if (o.scenario === 'pair') bad(used('founders'), 'has no effect with --scenario pair (a pair always has 2 founders)');
  else bad(used('gap'), 'only applies to --scenario pair');
  if (o.scenario !== 'wound-in-crowd') bad(used('wound-at', 'wound-radius', 'wound-d', 'wound-watch', 'wound-every'), 'only applies to --scenario wound-in-crowd');
  if (!o.mut) bad(used('mut-rate', 'gene-blind'), 'needs --mut on (genes do not mutate otherwise, so it would do nothing)');
  const tagMut = o.tagMutRate > 0;
  if (!tagMut) bad(['TAG_STEP', 'TAG_TOL_GENE', 'TAG_MUT_BUD'].filter((k) => k in o.rules), 'is set (--tag-step, --tol-gene, --tag-mut-bud or --rules-override) but needs --tag-mut-rate > 0: marks never mutate otherwise, so it would do nothing');
  const knob = ['GATE_SHARE', 'GATE_GROW', 'GATE_SIGNAL', 'SEAM_COST', 'RAID'].some((k) => (o.rules[k] ?? 0) > 0);
  if (o.tagBlind && !knob) throw new Error('--tag-blind needs at least one gate, --seam-cost or --raid (it only switches those off, so it would do nothing)');
  if (o.noFrames) bad(used('frames', 'frame-scale'), 'conflicts with --no-frames');
  return o;
}

// ------------------------------------------------------------------ world construction
export function buildWorld(o: V3Options): { w: BodiesWorld; positions: [number, number][]; tags: number[]; genome: Genome } {
  const pair = o.scenario === 'pair';
  if (pair && (o.mut || o.tagMutRate > 0)) throw new Error('pair has no mutation: drop --mut / --tag-mut-rate or use --scenario crowd');
  if (o.scenario === 'wound-in-crowd' && o.woundAt >= o.steps) throw new Error(`--wound-at ${o.woundAt} must be below --steps ${o.steps}`);
  const n = pair ? 2 : o.founders;
  const positions: [number, number][] = pair
    ? [[48 - Math.floor(o.gap / 2), 48], [48 - Math.floor(o.gap / 2) + o.gap, 48]]
    : FOUNDER_SPOTS.slice(0, n).map(([x, y]) => [x, y] as [number, number]);
  let tags: number[];
  if (o.tags === 'same') tags = new Array(n).fill(0);
  else if (o.tags) { if (o.tags.length !== n) throw new Error(`--tags has ${o.tags.length} values for ${n} founders`); tags = o.tags; }
  else tags = pair ? [64, 192] : Array.from({ length: n }, (_, i) => Math.floor(i * 256 / n));
  const genome: Genome = o.genome ?? (pair ? [16, 60, 0, 0] : FOUNDER_GENOME);
  const w = new BodiesWorld({
    seed: o.seed, founders: n, positions, founderTags: tags, genome, mutRate: o.mut ? o.mutRate : 0, blind: o.geneBlind, upkeep: o.upkeep,
    tagMutRate: o.tagMutRate, tagBlind: o.tagBlind, rules: o.rules,
  });
  return { w, positions, tags, genome };
}

// ------------------------------------------------------------------ wound tracking (observer labels choose the target; the dynamics never see them)
function kinMatchesRef(w: BodiesWorld, i: number, refKin: number, refTol: number): boolean { return realMarksMatch(w, w.kin[i], w.kinTol[i], refKin, refTol); }
interface Wound { rootTile: number; basinTiles: number[]; diskTiles: number[]; refKin: number; refTol: number; rootsInDisk: number; centre: [number, number]; killed: number; basinSize: number; diskLive0: number; basinsConsidered: number }
function placeBasinWound(w: BodiesWorld, o: V3Options): Wound {
  const { W, H, N } = w.R; const bl = basinLabels(w);
  const big = [...bl.count.entries()].filter(([, c]) => c >= 60).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  if (!big.length) throw new Error('wound-in-crowd: no root basin of at least 60 cells at the wound step');
  const med = big[Math.floor((big.length - 1) / 2)][1];
  const [rootTile, basinSize] = [...big].sort((a, b) => Math.abs(a[1] - med) - Math.abs(b[1] - med) || a[0] - b[0])[0];
  const tiles: number[] = []; for (let i = 0; i < N; i++) if (bl.label[i] === rootTile) tiles.push(i);
  const r = o.woundRadius, disk = (c: number) => {
    const cx = c % W, cy = (c - cx) / W, out: number[] = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) out.push((((cy + dy) % H + H) % H) * W + (((cx + dx) % W + W) % W));
    return out;
  };
  const order = tiles.slice().sort((a, b) => Math.abs(w.d[a] - o.woundD) - Math.abs(w.d[b] - o.woundD) || a - b);
  const centre = order.find((c) => !disk(c).some((q) => w.cell[q] && w.d[q] === 0));
  if (centre === undefined) throw new Error('wound-in-crowd: no wound centre that spares every root in the target basin');
  const diskTiles = disk(centre).filter((q) => w.cell[q]);
  const refKin = mode(diskTiles.map((q) => w.kin[q])), refTol = mode(diskTiles.map((q) => w.kinTol[q]));
  const rootsInDisk = diskTiles.filter((q) => w.d[q] === 0).length;
  const killed = w.injure(centre % W, (centre / W) | 0, r);
  return { rootTile, basinTiles: tiles, diskTiles, refKin, refTol, rootsInDisk, centre: [centre % W, (centre / W) | 0], killed, basinSize, diskLive0: diskTiles.length, basinsConsidered: big.length };
}
function trackWound(w: BodiesWorld, wd: Wound, t0: number) {
  let s0 = 0, s0Match = 0, dk = 0, dkMatch = 0;
  for (const i of wd.basinTiles) if (w.cell[i]) { s0++; if (kinMatchesRef(w, i, wd.refKin, wd.refTol)) s0Match++; }
  for (const i of wd.diskTiles) if (w.cell[i]) { dk++; if (kinMatchesRef(w, i, wd.refKin, wd.refTol)) dkMatch++; }
  const rootAlive = w.cell[wd.rootTile] === 1 && w.d[wd.rootTile] === 0;
  return {
    t: w.t, sinceWound: w.t - t0, basinLive: s0, basinLivePermille: Math.floor(s0 * 1000 / wd.basinSize), basinLiveMatching: s0Match, basinLiveForeign: s0 - s0Match,
    diskLive: dk, diskLivePermille: Math.floor(dk * 1000 / wd.diskLive0), diskMatching: dkMatch, diskForeign: dk - dkMatch, rootAlive, cells: w.cellCount(),
  };
}

// ------------------------------------------------------------------ the run
export function runV3(o: V3Options) {
  const t0 = Date.now(); const { w, positions, tags, genome } = buildWorld(o);
  const tracker = new PatchTracker(o.minPatch); const series = [observe(w, tracker, o.loneRef)];
  if (o.out) mkdirSync(o.out, { recursive: true });
  const defaultFrames: Record<Scenario, (number | 'end')[]> = {
    pair: [0, 100, 300, 1000, 3000, 'end'], crowd: [0, 1000, 5000, 10000, 'end'], 'wound-in-crowd': [0, 5000, 'end'],
  };
  const frameSet = new Set<number>(); const frameList = o.noFrames ? [] : (o.frames ?? defaultFrames[o.scenario]);
  for (const f of frameList) frameSet.add(f === 'end' ? o.steps : f);
  if (!o.noFrames && !o.frames && o.scenario === 'wound-in-crowd') for (const k of [0, 150, o.woundWatch]) frameSet.add(o.woundAt + k);
  const framesWritten: string[] = [];
  const snap = (label = '') => {
    if (!o.out || o.noFrames) return; const f = `frame-t${pad(w.t)}${label}.png`; writeFrameV3(join(o.out, f), w, o.frameScale); framesWritten.push(f);
  };
  if (frameSet.has(0)) snap();
  let wound: Wound | null = null; const woundTrack: ReturnType<typeof trackWound>[] = []; let woundMeta: unknown = null; let observeMs = 0;
  const tStep = Date.now();
  for (let t = 1; t <= o.steps; t++) {
    w.step(1);
    if (t % o.sampleEvery === 0) { const a = Date.now(); series.push(observe(w, tracker, o.loneRef)); observeMs += Date.now() - a; if (!o.quiet) console.error(`t=${t} cells=${series.at(-1)!.cells} patches=${series.at(-1)!.patches.nBig} seam‰=${series.at(-1)!.seams.seamPermille}`); }
    if (o.scenario === 'wound-in-crowd') {
      if (t === o.woundAt) {
        if (frameSet.has(t)) snap('-before');
        wound = placeBasinWound(w, o);
        woundMeta = { t, rootTile: wound.rootTile, centre: wound.centre, radius: o.woundRadius, killed: wound.killed, basinSize: wound.basinSize, diskLiveBefore: wound.diskLive0, refKin: wound.refKin, refTol: wound.refTol, rootsInDisk: wound.rootsInDisk, basinsConsidered: wound.basinsConsidered, rootSpared: wound.rootsInDisk === 0 };
        woundTrack.push(trackWound(w, wound, t));
      } else if (wound && t > o.woundAt && t <= o.woundAt + o.woundWatch && (t - o.woundAt) % o.woundEvery === 0) woundTrack.push(trackWound(w, wound, o.woundAt));
    }
    if (frameSet.has(t)) snap();
  }
  const stepMs = Date.now() - tStep - observeMs;
  const final = series.at(-1)!.t === w.t ? series.at(-1)! : observe(w, tracker, o.loneRef);
  return {
    meta: {
      scenario: o.scenario, seed: o.seed, steps: o.steps, positions, founderMarks: tags, genome: [...genome], upkeep: o.upkeep, mut: o.mut, mutRate: o.mut ? o.mutRate : 0, geneBlind: o.geneBlind,
      tagMutRate: o.tagMutRate, tagBlind: o.tagBlind, sampleEvery: o.sampleEvery, minPatch: o.minPatch, loneRef: o.loneRef, rules: { ...w.R }, rulesOverride: o.rules,
      args: { gap: o.gap, founders: o.founders, woundAt: o.woundAt, woundRadius: o.woundRadius, woundD: o.woundD, woundWatch: o.woundWatch, woundEvery: o.woundEvery },
    },
    series, wound: woundMeta, woundTrack,
    final: { ...final, residual: w.residual(), validate: validateWorld(w), stateHash: hashState(w), stateHashFull: hashStateFull(w) },
    frames: framesWritten,
    timingMs: { total: Date.now() - t0, step: stepMs, observe: observeMs },
  };
}

function main() {
  let o: V3Options;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`error: ${(e as Error).message}`); process.exit(2); }
  if (!o.out) { console.error('error: --out <dir> is required'); process.exit(2); }
  let res: ReturnType<typeof runV3>;
  try { res = runV3(o); } catch (e) { console.error(`error: ${(e as Error).message}`); process.exit(2); }
  writeFileSync(join(o.out, 'readout.json'), JSON.stringify(res) + '\n');
  const f = res.final;
  console.log(`${o.scenario} seed ${o.seed} steps ${o.steps}: cells ${f.cells} basins ${f.basins.n} patches(>=${o.minPatch}) ${f.patches.nBig} seam ${f.seams.seamPermille} permille distinct marks ${f.kin.distinct} residual ${f.residual} validate ${JSON.stringify(f.validate)} hash ${f.stateHashFull} step ${res.timingMs.step} ms observe ${res.timingMs.observe} ms -> ${join(o.out, 'readout.json')}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
