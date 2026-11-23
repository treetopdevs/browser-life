/**
 * Droplet genes, heritable trait: monoculture pre-scout. Every founder copy is put at one ladder level and the
 * level cannot change (mutLevel 0), so this shows how a compartment population does at each fixed level: the
 * between-compartment side of the trait on its own. Nothing can evolve here; it is not a test of the question.
 *
 * Usage:
 *   deno run -A --no-lock experiments/dropgenes/trait-mono.ts --levels 5 --geneSats 2,4,8 --startLevels 0,1,2,3 \
 *     --seeds 1,2 --steps 8000 --out runs/dropgenes/trait/mono/v5.jsonl [--gated 1] [--ov '{"diffT":0.1,...}']
 *
 * One JSON line per (geneSat, level, seed), appended to --out; a line already there is skipped (resumable).
 * Reported at the last step: compartments (wall >= gateHi, at least 3 tiles), wall share of all matter, copies
 * per compartment, and gene function on compartment tiles recomputed from the state by the kernel's rule
 * (mean of geneQ / 1024, and the share of those tiles at full function).
 */
import { DG_SCALE, DropGenesKernel, defaultDropGenesConfig, type DropGenesConfig } from '../../apps/lab/src/dropgenes/kernel.ts';
import { labelCompartments } from '../../apps/lab/src/dropgenes/observe.ts';

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`Unexpected argument: ${a}`);
    // Every option takes an operand; a bare one (for example a trailing --out) is a mistake, not the string 'true'.
    if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) throw new Error(`Option ${a} needs a value`);
    out[a.slice(2)] = argv[++i];
  }
  return out;
}
const KNOWN = new Set(['levels', 'geneSats', 'startLevels', 'seeds', 'steps', 'out', 'gated', 'ov', 'genes', 'cap', 'size']);
const args = parseArgs(Deno.args);
for (const k of Object.keys(args)) if (!KNOWN.has(k)) throw new Error(`Unknown option --${k}`);
for (const k of ['levels', 'geneSats', 'startLevels', 'seeds', 'steps', 'out']) if (args[k] === undefined) throw new Error(`--${k} is required`);
const list = (s: string) => s.split(',').map((v) => Number(v.trim()));
const V = Number(args.levels);
const steps = Number(args.steps);
const size = Number(args.size ?? 64);
const genes = Number(args.genes ?? 2);
const ov = JSON.parse(args.ov ?? '{}') as Partial<DropGenesConfig>;
const gated = (args.gated ?? '1') !== '0';
// A row is labelled by this script's own options; an override of one of them would run something else under that label.
for (const k of ['seed', 'width', 'height', 'genes', 'capPerTile', 'gated', 'mutPar', 'geneSat', 'ladderLevels', 'mutLevel', 'ladderNeutral']) {
  if (k in ov) throw new Error(`--ov must not set ${k}; use the matching option`);
}

const slash = args.out.lastIndexOf('/');
if (slash > 0) await Deno.mkdir(args.out.slice(0, slash), { recursive: true });
const done = new Set<string>();
{
  // Resume from the rows already there. A crash can leave a half-written last line: cut it off at the last intact
  // row, so that the next append does not join onto it. A complete last row without its newline gets one. Any
  // other read or parse failure is reported rather than treated as a missing file.
  let text = '';
  try {
    text = await Deno.readTextFile(args.out);
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  const lines = text.split('\n');
  const tail = lines.pop() ?? ''; // what follows the last newline: '' for a file that ends in one
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      done.add(JSON.parse(line).key);
    } catch {
      throw new Error(`${args.out}: a row before the end of the file is not valid JSON: ${line.slice(0, 80)}`);
    }
  }
  if (tail.trim()) {
    let ok = true;
    try {
      done.add(JSON.parse(tail).key);
    } catch {
      ok = false;
    }
    if (ok) await Deno.writeTextFile(args.out, '\n', { append: true });
    else await Deno.truncate(args.out, new TextEncoder().encode(text).length - new TextEncoder().encode(tail).length);
  } else if (tail !== '') {
    await Deno.truncate(args.out, new TextEncoder().encode(text).length - new TextEncoder().encode(tail).length);
  }
}

/** Gene function per tile by the kernel's ladder rule, from the state (the kernel keeps its own copy private). */
function geneQOf(w: DropGenesKernel, i: number): number {
  const { width: Wd, height: H, species: S, genes: K, ladderLevels: LV, ladderWeight: weight, ladderSatW: satW } = w.p;
  const x = i % Wd;
  const y = (i / Wd) | 0;
  let minS = satW;
  for (let k = 0; k < K; k++) {
    let sum = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const j = ((y + dy + H) % H) * Wd + ((x + dx + Wd) % Wd);
        for (let v = 0; v < LV; v++) sum += w.T[j * S + k * LV + v] * weight[k * LV + v];
      }
    }
    if (sum < minS) minS = sum;
  }
  return Math.floor((minS * 1024) / satW);
}

for (const geneSat of list(args.geneSats)) {
  for (const level of list(args.startLevels)) {
    for (const seed of list(args.seeds)) {
      // The key names everything a row depends on, so a file made with other settings is not taken for this run.
      const key = `V${V}-sat${geneSat}-L${level}-s${seed}-${gated ? 'gated' : 'ungated'}-${steps}-K${genes}-cap${Number(args.cap ?? 16)}-size${size}-ov${JSON.stringify(ov)}`;
      if (done.has(key)) continue;
      const cfg = defaultDropGenesConfig({ width: size, height: size, seed, genes, capPerTile: Number(args.cap ?? 16), gated, mutPar: 0, ...ov, geneSat, ladderLevels: V, mutLevel: 0 });
      const w = new DropGenesKernel(cfg);
      const gridN = Math.max(1, Math.floor(size / 16));
      for (let gy = 0; gy < gridN; gy++) {
        for (let gx = 0; gx < gridN; gx++) w.seedDroplet(Math.floor(((gx + 0.5) / gridN) * size), Math.floor(((gy + 0.5) / gridN) * size), 3);
      }
      w.seedTemplatesAtLevel(2, level, 0.125);
      const t0 = performance.now();
      const track: number[] = [];
      for (let s = 1; s <= steps; s++) {
        w.step();
        if (s % (steps / 4) === 0) track.push(labelCompartments(w.W, size, size, Math.round(cfg.gateHi * DG_SCALE), 3).areas.length - 1);
      }
      const { labels, areas } = labelCompartments(w.W, size, size, Math.round(cfg.gateHi * DG_SCALE), 3);
      const comps = areas.length - 1;
      let wall = 0;
      let copiesIn = 0;
      let qSum = 0;
      let qFull = 0;
      let tiles = 0;
      for (let i = 0; i < w.nTiles; i++) {
        wall += w.W[i];
        if (labels[i] === 0) continue;
        tiles++;
        for (let s = 0; s < w.p.species; s++) copiesIn += w.T[i * w.p.species + s];
        const q = geneQOf(w, i);
        qSum += q;
        if (q === 1024) qFull++;
      }
      const row = {
        key, levels: V, geneSat, level, seed, gated, steps,
        compartmentsAtQuarters: track,
        compartments: comps,
        meanArea: comps ? tiles / comps : 0,
        wallShare: wall / (w.nTiles * cfg.initMatterPerTile),
        copiesPerCompartment: comps ? copiesIn / comps : 0,
        meanFunction: tiles ? qSum / tiles / 1024 : null,
        fullFunctionTileShare: tiles ? qFull / tiles : null,
        residual: (w.totalMatter() - w.initTotalMatter).toString(),
        cpuSecondsWall: (performance.now() - t0) / 1000,
      };
      await Deno.writeTextFile(args.out, JSON.stringify(row) + '\n', { append: true });
      console.log(`${key}: comps ${track.join('/')} area ${row.meanArea.toFixed(1)} copies/comp ${row.copiesPerCompartment.toFixed(1)} function ${row.meanFunction?.toFixed(2) ?? 'n/a'} full ${row.fullFunctionTileShare?.toFixed(2) ?? 'n/a'} residual ${row.residual}`);
    }
  }
}
