/**
 * Droplet genes: run a grid of experiments/dropgenes/run.ts processes, a few at a time, one JSON per run.
 *
 * Usage:
 *   deno run -A --no-lock experiments/dropgenes/sweep.ts --dir runs/dropgenes/confirm --genes 2 --caps 8,16,32 \
 *     --seeds 5,6,7,8 --steps 200000 --mutPar 1e-6 --jobs 8 [--arms GATED_PAR,GATED_CLEAN,UNGATED_PAR,UNGATED_CLEAN]
 *     [--ov '{"kDecT":0.03}'] [--tag large] [--size 64] [--templates linked|single]
 *
 * Linked templates: put the link keys in --ov ("linked":true, "linkSites", "linkJoin", "linkBreak", "linkLoss")
 * and give linked and unlinked runs different --tag values. --templates is passed to run.ts (founders' form).
 *
 * A run whose output file already exists is skipped, so the sweep can be re-invoked after an interruption.
 * File name: <tag->K<genes>-cap<cap>-<ARM>-s<seed>.json
 *
 * Ladder worlds (heritable trait, docs/droplet-genes-trait-2026-11-21/PLAN.md): give --levels V --mutLevel p
 * --startLevel v and the ladder arms GATED_SEL, GATED_NEU, UNGATED_SEL, UNGATED_NEU (SEL: rates and function
 * follow the ladder; NEU: the neutral twin), with --mutPar 0. One start level per invocation: put it in --tag,
 * for example --tag trait-L0, so the two starts sit side by side in one directory.
 */

import { defaultDropGenesConfig, type DropGenesConfig } from '../../apps/lab/src/dropgenes/kernel.ts';

const ARMS: Record<string, { gated: boolean; par: boolean }> = {
  GATED_PAR: { gated: true, par: true },
  GATED_CLEAN: { gated: true, par: false },
  UNGATED_PAR: { gated: false, par: true },
  UNGATED_CLEAN: { gated: false, par: false },
};
/** Ladder arms: neutral = the neutral twin. Kept apart from ARMS so the first-rung default arm list is unchanged. */
const LADDER_ARMS: Record<string, { gated: boolean; neutral: boolean }> = {
  GATED_SEL: { gated: true, neutral: false },
  GATED_NEU: { gated: true, neutral: true },
  UNGATED_SEL: { gated: false, neutral: false },
  UNGATED_NEU: { gated: false, neutral: true },
};

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`Unexpected argument: ${a}`);
    // Every option of this sweep takes an operand; a bare one is a mistake, not the string 'true'.
    if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) throw new Error(`Option ${a} needs a value`);
    out[a.slice(2)] = argv[++i];
  }
  return out;
}

const KNOWN = new Set(['dir', 'genes', 'caps', 'seeds', 'steps', 'mutPar', 'jobs', 'arms', 'ov', 'tag', 'size', 'templates']);
for (const k of ['levels', 'mutLevel', 'startLevel']) KNOWN.add(k); // ladder worlds
const args = parseArgs(Deno.args);
for (const k of Object.keys(args)) if (!KNOWN.has(k)) throw new Error(`Unknown option --${k}`);
for (const k of ['dir', 'genes', 'caps', 'seeds', 'steps', 'mutPar']) if (args[k] === undefined) throw new Error(`--${k} is required`);

const list = (s: string) => s.split(',').map((v) => v.trim()).filter(Boolean);
const dir = args.dir;
// Numbers are normalised before names are built ("1" and "01" are one seed), and a repeated value is queued once:
// two queue entries with one --out path could run side by side and fight over the same .tmp file.
const uniq = <T,>(xs: T[]): T[] => [...new Set(xs)];
const genesList = uniq(list(args.genes).map(Number));
const caps = uniq(list(args.caps).map(Number));
const seeds = uniq(list(args.seeds).map(Number));
const arms = uniq(list(args.arms ?? Object.keys(ARMS).join(',')));
for (const [k, v] of [['genes', genesList], ['caps', caps], ['seeds', seeds], ['arms', arms]] as const) {
  if (v.length === 0) throw new Error(`--${k} has no values`);
}
// The kernel reads the seed as a u32: 1 and 4294967297 would be one trajectory under two names.
for (const sd of seeds) if (!Number.isInteger(sd) || sd < 0 || sd > 0xffffffff) throw new Error(`Seed must be an integer in 0..4294967295, got ${sd}`);
const steps = Number(args.steps);
const mutPar = Number(args.mutPar);
const jobs = Number(args.jobs ?? 6);
const size = Number(args.size ?? 64);
const tag = args.tag ? `${args.tag}-` : '';
// Ladder worlds: with --levels every arm is a ladder arm (and is registered in ARMS as a gated or ungated arm
// with no parasite origin, which is what the existing loop below reads); without it none is.
const ladderLevels = args.levels === undefined ? 0 : Number(args.levels);
// A supplied --levels is checked before it decides whether the ladder is on: a typo must not run the first-rung grid.
if (args.levels !== undefined && (!Number.isInteger(ladderLevels) || ladderLevels < 0)) throw new Error(`--levels must be a non-negative integer, got ${args.levels}`);
const ladderMut = Number(args.mutLevel ?? 0);
const ladderStart = Number(args.startLevel ?? 0);
if (ladderLevels > 0) {
  if (args.arms === undefined) throw new Error('--levels needs --arms from GATED_SEL, GATED_NEU, UNGATED_SEL, UNGATED_NEU');
  if (Number(args.mutPar) !== 0) throw new Error('--levels needs --mutPar 0');
  if (![ladderLevels, ladderMut, ladderStart].every(Number.isFinite)) throw new Error('Non-numeric ladder option');
  for (const a of arms) {
    if (!Object.hasOwn(LADDER_ARMS, a)) throw new Error(`Arm ${a} is not a ladder arm`);
    ARMS[a] = { gated: LADDER_ARMS[a].gated, par: false };
  }
} else if (args.mutLevel !== undefined || args.startLevel !== undefined) {
  throw new Error('--mutLevel and --startLevel need --levels');
}
/** The ladder keys of an arm's configuration, exactly as run.ts builds them (none for a first-rung arm). */
const ladderWant = (arm: string): Partial<DropGenesConfig> =>
  ladderLevels > 0 ? { ladderLevels, mutLevel: ladderMut, ladderNeutral: LADDER_ARMS[arm].neutral } : {};
for (const a of arms) if (!Object.hasOwn(ARMS, a)) throw new Error(`Unknown arm ${a}`);
if (![...genesList, ...caps, ...seeds, steps, mutPar, jobs, size].every(Number.isFinite)) throw new Error('Non-numeric option');
const ovObj = (args.ov ? JSON.parse(args.ov) : {}) as Record<string, unknown>;
/** Linked runs: the founders' template form this sweep asks for (run.ts default: linked when linking is on). */
const wantFounderTemplates = ovObj.linked === true ? (args.templates ?? 'linked') : null;
if (args.templates !== undefined && ovObj.linked !== true && args.templates !== 'single') throw new Error('--templates linked needs "linked": true in --ov');

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
          const { summary } = JSON.parse(existing) as { summary: { steps: number; residual: string; config: Record<string, unknown>; protocol?: Record<string, unknown>; ladder?: { startLevel: number }; linked?: { founders?: string } } };
          const c = summary.config;
          // The whole effective configuration this request would run, defaults included, not only what was overridden.
          const want = defaultDropGenesConfig({
            width: size, height: size, seed, genes, capPerTile: cap, gated: ARMS[arm].gated, mutPar: ARMS[arm].par ? mutPar : 0, ...(ovObj as Partial<DropGenesConfig>), ...ladderWant(arm),
          }) as unknown as Record<string, unknown>;
          const wrong = [...new Set([...Object.keys(want), ...Object.keys(c)])].filter((k) => c[k] !== want[k]);
          if (JSON.stringify(summary.protocol) !== JSON.stringify(PROTOCOL)) wrong.push('protocol');
          if (summary.steps !== steps) wrong.push('steps');
          if ((summary.linked?.founders ?? null) !== wantFounderTemplates) wrong.push('templates');
          if (summary.residual !== '0') wrong.push('residual');
          if (ladderLevels > 0 && summary.ladder?.startLevel !== ladderStart) wrong.push('startLevel');
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
        if (ladderLevels > 0) {
          argv.push('--levels', String(ladderLevels), '--mutLevel', String(ladderMut), '--startLevel', String(ladderStart), '--neutral', LADDER_ARMS[arm].neutral ? '1' : '0');
        }
        if (args.templates) argv.push('--templates', args.templates);
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
      const lad = s.ladder ? ` level=${s.ladder.lateLevelMean === null ? 'n/a' : Number(s.ladder.lateLevelMean).toFixed(3)} top=${s.ladder.lateTopShare === null ? 'n/a' : Number(s.ladder.lateTopShare).toFixed(3)} extinctAt=${s.extinctAt}` : '';
      console.log(`${job.name}: held=${s.held} comps=${Number(s.lateMeanCompartments).toFixed(1)} complete=${Number(s.lateCompleteShare).toFixed(2)} residual=${s.residual}${lad} (${secs}s, ${queue.length} left)`);
    }
  }
}
await Promise.all(Array.from({ length: Math.max(1, jobs) }, () => worker()));
console.log(`done: ${done} runs, ${failed} failed`);
if (failed > 0) Deno.exit(1);
