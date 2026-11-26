/**
 * Droplet genes, heritable trait: class and score every calibration setting under a screen directory by the
 * rules fixed in docs/droplet-genes-trait-2026-11-21/CALIBRATION.md (Step 1) before the screen ran.
 *
 * Usage: deno run -A --no-lock experiments/dropgenes/trait-screen-read.ts runs/dropgenes/trait/screen [--horizon 200000] [--seeds 1,2]
 *
 * One sub-directory per setting, holding GATED_SEL runs from two start levels (trait-screen.sh). A setting is
 * classed only when it has both starts for every seed in --seeds (default 1,2: the screen's seeds); otherwise
 * it is "incomplete".
 */
interface Ladder { levels: number; mutLevel: number; startLevel: number; lateLevelMean: number | null; lateTopShare: number | null; lateCompLevelSd: number | null }
interface Summary { config: { gated: boolean; ladderNeutral?: boolean; geneSat: number; [k: string]: unknown }; protocol?: unknown; seed: number; steps: number; held: boolean; extinctAt: number | null; lateMeanCompartments: number; ladder: Ladder }

const root = Deno.args[0];
if (!root) throw new Error('usage: trait-screen-read.ts <screen dir> [--horizon steps]');
const hAt = Deno.args.indexOf('--horizon');
const horizon = hAt >= 0 ? Number(Deno.args[hAt + 1]) : 200000;
const sAt = Deno.args.indexOf('--seeds');
const wantSeeds = (sAt >= 0 ? Deno.args[sAt + 1] : '1,2').split(',').map(Number);
const f = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? 'n/a' : v.toFixed(d));

/** Predicted mean level of a neutral ladder at step t from start x0 (slowest mode; 50 steps per template lifetime). */
function neutralAt(x0: number, V: number, mut: number, t: number): number {
  const mid = (V - 1) / 2;
  const tau = 50 / (mut * (1 - Math.cos(Math.PI / V)));
  return mid + (x0 - mid) * Math.exp(-t / tau);
}

const settings: string[] = [];
for await (const e of Deno.readDir(root)) if (e.isDirectory) settings.push(e.name);
settings.sort();
console.log('| setting | levels | geneSat | mutLevel | starts | steps | per seed: late level low start, high start (compartments) | not held | class | mean late level | mean gap | predicted neutral range at horizon | score |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const name of settings) {
  const runs: Summary[] = [];
  for await (const e of Deno.readDir(`${root}/${name}`)) {
    if (!e.isFile || !e.name.endsWith('.json')) continue;
    const { summary } = JSON.parse(await Deno.readTextFile(`${root}/${name}/${e.name}`)) as { summary: Summary };
    if (summary.config.gated && !summary.config.ladderNeutral) runs.push(summary);
  }
  if (runs.length === 0) continue;
  const V = runs[0].ladder.levels;
  const mut = runs[0].ladder.mutLevel;
  const starts = [...new Set(runs.map((r) => r.ladder.startLevel))].sort((a, b) => a - b);
  const seeds = [...new Set(runs.map((r) => r.seed))].sort((a, b) => a - b);
  const lo = starts[0];
  const hi = starts[starts.length - 1];
  const get = (start: number, seed: number) => runs.find((r) => r.ladder.startLevel === start && r.seed === seed);
  const notHeld = runs.filter((r) => !r.held).length;
  // Two different start levels are needed: with one, a run would be compared with itself and "qualify".
  // Both starts must be runs of one calibration setting: one run per start and seed, one effective configuration
  // and protocol apart from seed, and one planned horizon (--horizon only sets the neutral prediction below).
  const one = new Set(runs.map((r) => `${r.ladder.startLevel}|${r.seed}`)).size === runs.length;
  const sameSetting = (r: Summary) => {
    const { seed: _s, ...cfg } = r.config as Record<string, unknown>;
    return JSON.stringify([Object.entries(cfg).sort(([a], [b]) => a.localeCompare(b)), r.protocol ?? null, r.steps, r.ladder.levels, r.ladder.mutLevel]);
  };
  const consistent = one && new Set(runs.map(sameSetting)).size === 1;
  const complete = consistent && starts.length === 2 && wantSeeds.every((s) => get(lo, s) && get(hi, s)) && seeds.every((s) => wantSeeds.includes(s));
  let moved = false;
  let converging = true;
  const gaps: number[] = [];
  const levels: number[] = [];
  const per: string[] = [];
  for (const s of seeds) {
    const a = get(lo, s);
    const b = get(hi, s);
    const la = a && a.held ? a.ladder.lateLevelMean : null;
    const lb = b && b.held ? b.ladder.lateLevelMean : null;
    per.push(`s${s}: ${f(a?.ladder.lateLevelMean)}, ${f(b?.ladder.lateLevelMean)} (${f(a?.lateMeanCompartments, 0)}, ${f(b?.lateMeanCompartments, 0)})`);
    if (la !== null && Math.abs(la - lo) >= 0.25) moved = true;
    if (lb !== null && Math.abs(lb - hi) >= 0.25) moved = true;
    if (la === null || lb === null) { converging = false; continue; }
    const gap = Math.abs(la - lb);
    gaps.push(gap);
    levels.push(la, lb);
    if (gap > (hi - lo) / 2) converging = false;
  }
  const cls = !complete ? 'incomplete' : notHeld > 0 ? 'dies' : !moved ? 'does not move' : converging ? 'qualifies' : 'moves, not yet converging';
  const meanLevel = levels.length ? levels.reduce((x, y) => x + y, 0) / levels.length : null;
  const meanGap = gaps.length ? gaps.reduce((x, y) => x + y, 0) / gaps.length : null;
  const nLo = Math.min(neutralAt(lo, V, mut, horizon), neutralAt(hi, V, mut, horizon));
  const nHi = Math.max(neutralAt(lo, V, mut, horizon), neutralAt(hi, V, mut, horizon));
  const distance = meanLevel === null ? null : meanLevel > nHi ? meanLevel - nHi : meanLevel < nLo ? nLo - meanLevel : 0;
  const score = distance !== null && meanGap !== null ? distance - meanGap : null;
  console.log(
    `| ${name} | ${V} | ${runs[0].config.geneSat} | 1/${Math.round(1 / mut)} | ${lo}, ${hi} | ${[...new Set(runs.map((r) => r.steps))].join('/')} | ${per.join('; ')} | ${notHeld} of ${runs.length} | ${cls} | ${f(meanLevel)} | ${f(meanGap)} | ${f(nLo)} to ${f(nHi)} | ${f(score)} |`,
  );
}
