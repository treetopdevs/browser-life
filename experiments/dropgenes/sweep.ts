/**
 * Droplet genes: run a grid of experiments/dropgenes/run.ts processes, a few at a time, one JSON per run.
 *
 * Usage:
 *   deno run -A --no-lock experiments/dropgenes/sweep.ts --dir runs/dropgenes/confirm --genes 2 --caps 8,16,32 \
 *     --seeds 5,6,7,8 --steps 200000 --mutPar 1e-6 --jobs 8 [--arms GATED_PAR,GATED_CLEAN,UNGATED_PAR,UNGATED_CLEAN]
 *     [--ov '{"kDecT":0.03}'] [--tag large] [--size 64]
 *
 * A run whose output file already exists is skipped, so the sweep can be re-invoked after an interruption.
 * File name: <tag->K<genes>-cap<cap>-<ARM>-s<seed>.json
 */

import { defaultDropGenesConfig, type DropGenesConfig } from '../../apps/lab/src/dropgenes/kernel.ts';

const ARMS: Record<string, { gated: boolean; par: boolean }> = {
  GATED_PAR: { gated: true, par: true },
  GATED_CLEAN: { gated: true, par: false },
  UNGATED_PAR: { gated: false, par: true },
  UNGATED_CLEAN: { gated: false, par: false },
};

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`Unexpected argument: ${a}`);
    out[a.slice(2)] = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
  }
  return out;
}

const KNOWN = new Set(['dir', 'genes', 'caps', 'seeds', 'steps', 'mutPar', 'jobs', 'arms', 'ov', 'tag', 'size']);
const args = parseArgs(Deno.args);
for (const k of Object.keys(args)) if (!KNOWN.has(k)) throw new Error(`Unknown option --${k}`);
for (const k of ['dir', 'genes', 'caps', 'seeds', 'steps', 'mutPar']) if (args[k] === undefined) throw new Error(`--${k} is required`);

const list = (s: string) => s.split(',').map((v) => v.trim()).filter(Boolean);
const dir = args.dir;
const genesList = list(args.genes).map(Number);
const caps = list(args.caps).map(Number);
const seeds = list(args.seeds).map(Number);
const arms = list(args.arms ?? Object.keys(ARMS).join(','));
const steps = Number(args.steps);
const mutPar = Number(args.mutPar);
const jobs = Number(args.jobs ?? 6);
const size = Number(args.size ?? 64);
const tag = args.tag ? `${args.tag}-` : '';
for (const a of arms) if (!ARMS[a]) throw new Error(`Unknown arm ${a}`);
if (![...genesList, ...caps, ...seeds, steps, mutPar, jobs, size].every(Number.isFinite)) throw new Error('Non-numeric option');
const ovObj = (args.ov ? JSON.parse(args.ov) : {}) as Record<string, unknown>;

const runner = new URL('./run.ts', import.meta.url).pathname;
/** The observation protocol a sweep always uses (run.ts defaults); an existing file made otherwise is not this run. */
const PROTOCOL = { census: 50, report: 2000, heredityDelay: 500, founders: 'grid', spacing: 16, seedPerGene: 2 };
await Deno.mkdir(dir, { recursive: true });

interface Job { name: string; argv: string[] }
const queue: Job[] = [];
for (const genes of genesList) {
  for (const cap of caps) {
    for (const arm of arms) {
      for (const seed of seeds) {
        const name = `${tag}K${genes}-cap${cap}-${arm}-s${seed}`;
        const out = `${dir}/${name}.json`;
        let existing: string | null = null;
        try {
          existing = await Deno.readTextFile(out);
        } catch { /* not there: run it */ }
        if (existing !== null) {
          // Skip only a finished run of exactly this request; anything else in the way is an error, not a skip.
          const { summary } = JSON.parse(existing) as { summary: { steps: number; residual: string; config: Record<string, unknown>; protocol?: Record<string, unknown> } };
          const c = summary.config;
          // The whole effective configuration this request would run, defaults included, not only what was overridden.
          const want = defaultDropGenesConfig({
            width: size, height: size, seed, genes, capPerTile: cap, gated: ARMS[arm].gated, mutPar: ARMS[arm].par ? mutPar : 0, ...(ovObj as Partial<DropGenesConfig>),
          }) as unknown as Record<string, unknown>;
          const wrong = [...new Set([...Object.keys(want), ...Object.keys(c)])].filter((k) => c[k] !== want[k]);
          if (JSON.stringify(summary.protocol) !== JSON.stringify(PROTOCOL)) wrong.push('protocol');
          if (summary.steps !== steps) wrong.push('steps');
          if (summary.residual !== '0') wrong.push('residual');
          if (wrong.length > 0) throw new Error(`${out} exists but is not this run (differs in: ${wrong.join(', ')}); use another --dir or remove it`);
          continue;
        }
        const argv = [
          'run', '-A', '--no-lock', runner,
          '--size', String(size), '--steps', String(steps), '--seed', String(seed), '--genes', String(genes), '--cap', String(cap),
          '--gated', ARMS[arm].gated ? '1' : '0', '--mutPar', String(ARMS[arm].par ? mutPar : 0),
          '--label', name, '--out', out,
        ];
        if (args.ov) argv.push('--ov', args.ov);
        queue.push({ name, argv });
      }
    }
  }
}

console.log(`${queue.length} runs to do, ${jobs} at a time`);
let failed = 0;
let done = 0;
async function worker(): Promise<void> {
  for (;;) {
    const job = queue.shift();
    if (!job) return;
    const t0 = performance.now();
    const res = await new Deno.Command('deno', { args: job.argv, stdout: 'piped', stderr: 'piped' }).output();
    done++;
    const secs = ((performance.now() - t0) / 1000).toFixed(0);
    if (res.code !== 0) {
      failed++;
      console.log(`FAILED ${job.name} (exit ${res.code}, ${secs}s): ${new TextDecoder().decode(res.stderr).split('\n').slice(-4).join(' | ')}`);
    } else {
      const s = JSON.parse(new TextDecoder().decode(res.stdout).trim().split('\n').pop() ?? '{}');
      console.log(`${job.name}: held=${s.held} comps=${Number(s.lateMeanCompartments).toFixed(1)} complete=${Number(s.lateCompleteShare).toFixed(2)} residual=${s.residual} (${secs}s, ${queue.length} left)`);
    }
  }
}
await Promise.all(Array.from({ length: Math.max(1, jobs) }, () => worker()));
console.log(`done: ${done} runs, ${failed} failed`);
if (failed > 0) Deno.exit(1);
