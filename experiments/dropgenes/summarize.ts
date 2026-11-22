/**
 * Droplet genes: read every run JSON in a directory and print the tables the plan's decision rules need.
 *
 * Usage: deno run -A --no-lock experiments/dropgenes/summarize.ts runs/dropgenes/confirm-v2 [--per-seed] [--json]
 *
 * Tables: held and late state, heredity, bookkeeping, largest K held, compartment properties; with --per-seed,
 * one row per run as well (for rules stated over more than 4 seeds, which the "(held)" cell mark does not cover).
 *
 * A cell (setting, K, sites, arm) is "held" when it has at least 4 seeds and at least 3 of them are held.
 * Refuses a directory whose runs of one setting do not share steps and configuration (apart from the keys a
 * cell is named by), so results of different settings cannot be mixed by accident.
 *
 * Ladder worlds (heritable trait): summarize.ts <dir> --trait [--json] reads a directory of ladder runs with
 * experiments/dropgenes/trait-summarize.ts instead; see that file. Without --trait nothing here changes.
 */

interface Heredity {
  pairs: number;
  parentR: number | null;
  neighbourR: number | null;
  unrelatedPairs: number;
  parentRUnrelatedSet: number | null;
  unrelatedR: number | null;
  read?: number;
  gone?: number;
  fused?: number;
  pending?: number;
}
interface Summary {
  config: Record<string, unknown>;
  protocol: { census: number; report: number; heredityDelay: number; founders: string; spacing: number; seedPerGene: number };
  seed: number;
  genes: number;
  gated: boolean;
  mutPar: number;
  capPerTile: number;
  steps: number;
  stepsRun: number;
  residual: string;
  extinctAt: number | null;
  lateMeanCompartments: number;
  lateCompleteShare: number;
  held: boolean;
  fissions: number;
  fusions: number;
  deaths: number;
  deathsIncomplete: number;
  denovo: number;
  ages?: { observedDeaths: { n: number; median: number | null }; absorbedByFusion: { n: number; median: number | null }; aliveAtEnd: { n: number; median: number | null } };
  heredityGene0: Heredity | null;
  heredityGene0Delayed: Heredity | null;
  heredityParasiteDelayed: Heredity | null;
}
interface Row {
  step: number;
  compartments: number;
  parasiteShare: number;
  strandedShare: number;
  strandedBareShare: number;
  strandedHaloShare: number;
  varGene0: number | null;
  meanCopies: number;
  meanArea: number;
}

const dir = Deno.args[0];
if (!dir) throw new Error('usage: summarize.ts <dir> [--per-seed] [--json]');
const asJson = Deno.args.includes('--json');
if (Deno.args.includes('--trait')) {
  const { traitSummary } = await import('./trait-summarize.ts');
  await traitSummary(dir, Deno.args.slice(1));
  Deno.exit(0);
}
const perSeed = Deno.args.includes('--per-seed');
const CELL_KEYS = new Set(['seed', 'genes', 'capPerTile', 'gated', 'mutPar']);

interface Cell { tag: string; genes: number; cap: number; arm: string; runs: { s: Summary; rows: Row[] }[] }
const cells = new Map<string, Cell>();
const sharedByTag = new Map<string, string>();
let protocol: Summary['protocol'] | null = null;
const parMutByTag = new Map<string, number>();
const names: string[] = [];
for await (const e of Deno.readDir(dir)) if (e.isFile && e.name.endsWith('.json')) names.push(e.name);
names.sort();
for (const name of names) {
  const { summary, rows } = JSON.parse(await Deno.readTextFile(`${dir}/${name}`)) as { summary: Summary; rows: Row[] };
  const m = /^(?:(.+)-)?K(\d+)-cap(\d+)-([A-Z_]+)-s(\d+)\.json$/.exec(name);
  if (!m) throw new Error(`Unexpected file name ${name}`);
  const tag = m[1] ?? '';
  const arm = m[4];
  // The name is a label only; check it against what the run recorded.
  const c = summary.config;
  const armFromRun = `${c.gated ? 'GATED' : 'UNGATED'}_${(c.mutPar as number) > 0 ? 'PAR' : 'CLEAN'}`;
  if (armFromRun !== arm || c.genes !== Number(m[2]) || c.capPerTile !== Number(m[3]) || c.seed !== Number(m[5])) {
    throw new Error(`${name}: file name disagrees with the recorded configuration`);
  }
  if (summary.residual !== '0') throw new Error(`${name}: conservation residual ${summary.residual}`);
  if (!summary.protocol) throw new Error(`${name}: no protocol record (made by an older runner)`);
  if (protocol === null) protocol = summary.protocol;
  else if (JSON.stringify(protocol) !== JSON.stringify(summary.protocol)) throw new Error(`${name}: set-up or observation protocol differs from other runs in this directory`);
  const shared = JSON.stringify([summary.steps, Object.entries(c).filter(([k]) => !CELL_KEYS.has(k)).sort(([a], [b]) => a.localeCompare(b))]);
  const seen = sharedByTag.get(tag);
  if (seen === undefined) sharedByTag.set(tag, shared);
  else if (seen !== shared) throw new Error(`${name}: steps or configuration differ from other runs of setting "${tag || 'default'}"`);
  if ((c.mutPar as number) > 0) {
    const pm = parMutByTag.get(tag);
    if (pm === undefined) parMutByTag.set(tag, c.mutPar as number);
    else if (pm !== c.mutPar) throw new Error(`${name}: mutPar differs from other parasite runs of setting "${tag || 'default'}"`);
  }
  const key = `${tag}|${c.genes}|${c.capPerTile}|${arm}`;
  let cell = cells.get(key);
  if (!cell) { cell = { tag, genes: c.genes as number, cap: c.capPerTile as number, arm, runs: [] }; cells.set(key, cell); }
  if (cell.runs.some((r) => r.s.config.seed === c.seed)) throw new Error(`${name}: seed ${c.seed} appears twice in its cell`);
  cell.runs.push({ s: summary, rows });
}

const f = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? 'n/a' : v.toFixed(d));
const range = (vs: (number | null)[], d = 1) => {
  const xs = vs.filter((v): v is number => v !== null && Number.isFinite(v));
  return xs.length ? (xs.length < vs.length ? `${Math.min(...xs).toFixed(d)} to ${Math.max(...xs).toFixed(d)} (${xs.length} of ${vs.length} runs)` : `${Math.min(...xs).toFixed(d)} to ${Math.max(...xs).toFixed(d)}`) : 'n/a';
};
/** Mean over the report rows inside the planned last tenth of the run; null when the run ended before it. */
const lateMean = (s: Summary, rows: Row[], pick: (r: Row) => number | null): number | null => {
  const from = s.steps - Math.floor(s.steps / 10);
  const vs = rows.filter((r) => r.step > from).map(pick).filter((v): v is number => v !== null && Number.isFinite(v));
  return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
};
if (protocol === null) throw new Error('no runs found');
/**
 * Turnover time: compartment-steps per observed death (mean compartments over all report rows x steps run /
 * deaths), for runs that reached the planned end only (a run that ended early has too few report rows).
 * Bookkeeping like the death count it is built from: it depends on the census interval.
 */
const turnover = (s: Summary, rows: Row[]): number | null => {
  if (rows.length === 0 || s.deaths <= 0 || s.stepsRun < s.steps) return null;
  return (rows.reduce((a, r) => a + r.compartments, 0) / rows.length) * s.stepsRun / s.deaths;
};
const margin = (h: Heredity | null): number | null => (h && h.parentR !== null && h.neighbourR !== null ? h.parentR - h.neighbourR : null);

const out: unknown[] = [];
const sorted = [...cells.values()].sort((a, b) => a.tag.localeCompare(b.tag) || a.genes - b.genes || a.cap - b.cap || a.arm.localeCompare(b.arm));
for (const c of sorted) c.runs.sort((a, b) => a.s.seed - b.s.seed);
const cellHeld = (c: Cell) => c.runs.length >= 4 && c.runs.filter((r) => r.s.held).length >= 3;

console.log(`Set-up and observation, the same for every run here: founders ${protocol.founders} (spacing ${protocol.spacing}), ${protocol.seedPerGene} copies of each gene seeded per wall tile, census every ${protocol.census} steps, report row every ${protocol.report} steps.\n`);
console.log('Held and late state (late = the last tenth of the planned run; n/a where a run ended before it)\n');
console.log('| setting | K | sites/tile | arm | seeds held | ended early at step | late compartments | late complete share | late parasite share | late copies per compartment |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const c of sorted) {
  const held = c.runs.filter((r) => r.s.held).length;
  const early = c.runs.filter((r) => r.s.stepsRun < r.s.steps).map((r) => r.s.stepsRun);
  console.log(
    `| ${c.tag || 'default'} | ${c.genes} | ${c.cap} | ${c.arm} | ${held} of ${c.runs.length}${cellHeld(c) ? ' (held)' : ''} | ${early.length ? early.join(', ') : 'none'} | ` +
      `${range(c.runs.map((r) => r.s.lateMeanCompartments))} | ${range(c.runs.map((r) => r.s.lateCompleteShare), 2)} | ` +
      `${range(c.runs.map((r) => lateMean(r.s, r.rows, (x) => x.parasiteShare)), 3)} | ${range(c.runs.map((r) => lateMean(r.s, r.rows, (x) => x.meanCopies)), 1)} |`,
  );
}

console.log(`\nHeredity of the gene-0 share, daughters read ${protocol.heredityDelay} steps after the split. Each control is shown beside the parent correlation over the same daughters: parent r / control r (daughters).\n`);
console.log('| setting | K | sites/tile | arm | per seed, control = nearest neighbour | margin at least 0.2 | per seed, control = nearest unrelated compartment | delayed reads: read / gone / fused / pending (totals) | variance of gene-0 share among compartments (late) |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const c of sorted) {
  if (c.genes < 2) continue;
  const hs = c.runs.map((r) => r.s.heredityGene0Delayed);
  const per = hs.map((h) => (h ? `${f(h.parentR)}/${f(h.neighbourR)} (${h.pairs})` : 'n/a')).join(', ');
  const perU = hs.map((h) => (h ? `${f(h.parentRUnrelatedSet)}/${f(h.unrelatedR)} (${h.unrelatedPairs})` : 'n/a')).join(', ');
  const wins = hs.filter((h) => (margin(h) ?? -1) >= 0.2).length;
  const tot = (k: 'read' | 'gone' | 'fused' | 'pending') => hs.reduce((a, h) => a + (h?.[k] ?? 0), 0);
  console.log(
    `| ${c.tag || 'default'} | ${c.genes} | ${c.cap} | ${c.arm} | ${per} | ${wins} of ${c.runs.length} | ${perU} | ${tot('read')} / ${tot('gone')} / ${tot('fused')} / ${tot('pending')} | ` +
      `${range(c.runs.map((r) => lateMean(r.s, r.rows, (x) => x.varGene0)), 3)} |`,
  );
}

console.log(`\nBookkeeping (tracker counts depend on the ${protocol.census}-step census; they are not rates)\n`);
console.log('| setting | K | sites/tile | arm | fissions | fusions / fissions | deaths | tracking misses / fissions | late share of copies on bare tiles | late share on the soft rim | residual |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
for (const c of sorted) {
  console.log(
    `| ${c.tag || 'default'} | ${c.genes} | ${c.cap} | ${c.arm} | ${range(c.runs.map((r) => r.s.fissions), 0)} | ${range(c.runs.map((r) => (r.s.fissions > 0 ? r.s.fusions / r.s.fissions : null)), 2)} | ` +
      `${range(c.runs.map((r) => r.s.deaths), 0)} | ${range(c.runs.map((r) => (r.s.fissions > 0 ? r.s.denovo / r.s.fissions : null)), 3)} | ` +
      `${range(c.runs.map((r) => lateMean(r.s, r.rows, (x) => x.strandedBareShare)), 3)} | ${range(c.runs.map((r) => lateMean(r.s, r.rows, (x) => x.strandedHaloShare)), 3)} | ${[...new Set(c.runs.map((r) => r.s.residual))].join(',')} |`,
  );
}

// Largest K held per (setting, sites, arm): the largest tested K whose cell is held. Rungs below it that were
// not held, and rungs with fewer than 4 seeds, are listed, since nothing guarantees holding is monotone in K.
console.log('\nLargest K held\n');
console.log('| setting | sites/tile | arm | largest K held | K tested | not held | fewer than 4 seeds |');
console.log('|---|---|---|---|---|---|---|');
const groups = new Map<string, Cell[]>();
for (const c of sorted) {
  const k = `${c.tag}|${c.cap}|${c.arm}`;
  groups.set(k, [...(groups.get(k) ?? []), c]);
}
for (const [k, cs] of groups) {
  const [tag, cap, arm] = k.split('|');
  cs.sort((a, b) => a.genes - b.genes);
  const heldKs = cs.filter(cellHeld).map((c) => c.genes);
  const notHeld = cs.filter((c) => c.runs.length >= 4 && !cellHeld(c)).map((c) => c.genes);
  const thin = cs.filter((c) => c.runs.length < 4).map((c) => c.genes);
  console.log(`| ${tag || 'default'} | ${cap} | ${arm} | ${heldKs.length ? Math.max(...heldKs) : 'none'} | ${cs.map((c) => c.genes).join(', ')} | ${notHeld.join(', ') || 'none'} | ${thin.join(', ') || 'none'} |`);
}

// Compartment properties, for comparing settings (docs/droplet-genes-2026-11-21/FIRMUP-PLAN.md, B3).
console.log(`\nCompartment properties (late = the last tenth of the planned run; ages and turnover depend on the ${protocol.census}-step census and are for comparing settings observed the same way)\n`);
console.log('| setting | K | sites/tile | arm | seeds held | late compartments | late mean area, tiles | late copies per compartment | median age at death, steps (observed deaths) | turnover time, steps (compartment-steps per death; runs that reached the end) | median age of those alive at the end, steps |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
for (const c of sorted) {
  console.log(
    `| ${c.tag || 'default'} | ${c.genes} | ${c.cap} | ${c.arm} | ${c.runs.filter((r) => r.s.held).length} of ${c.runs.length} | ${range(c.runs.map((r) => r.s.lateMeanCompartments))} | ` +
      `${range(c.runs.map((r) => lateMean(r.s, r.rows, (x) => x.meanArea)), 1)} | ${range(c.runs.map((r) => lateMean(r.s, r.rows, (x) => x.meanCopies)), 1)} | ` +
      `${range(c.runs.map((r) => r.s.ages?.observedDeaths.median ?? null), 0)} | ${range(c.runs.map((r) => turnover(r.s, r.rows)), 0)} | ${range(c.runs.map((r) => r.s.ages?.aliveAtEnd.median ?? null), 0)} |`,
  );
}

if (perSeed) {
  console.log(`\nPer seed (late = the last tenth of the planned run; heredity is the gene-0 share, and the parasite share, read ${protocol.heredityDelay} steps after the split, parent r / control r (daughters))\n`);
  console.log('| setting | K | sites/tile | arm | seed | held | ended early at step | late compartments | late complete share | late parasite share | late copies per compartment | late mean area, tiles | heredity, control = nearest neighbour | margin | heredity, control = nearest unrelated | parasite-share heredity, control = nearest neighbour | fissions | deaths | residual |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const c of sorted) {
    for (const r of c.runs) {
      const h = r.s.heredityGene0Delayed;
      const hp = r.s.heredityParasiteDelayed;
      console.log(
        `| ${c.tag || 'default'} | ${c.genes} | ${c.cap} | ${c.arm} | ${r.s.seed} | ${r.s.held ? 'yes' : 'no'} | ${r.s.stepsRun < r.s.steps ? r.s.stepsRun : 'none'} | ${f(r.s.lateMeanCompartments, 1)} | ${f(r.s.lateCompleteShare, 3)} | ` +
          `${f(lateMean(r.s, r.rows, (x) => x.parasiteShare), 3)} | ${f(lateMean(r.s, r.rows, (x) => x.meanCopies), 1)} | ${f(lateMean(r.s, r.rows, (x) => x.meanArea), 1)} | ` +
          `${h ? `${f(h.parentR)}/${f(h.neighbourR)} (${h.pairs})` : 'n/a'} | ${f(margin(h))} | ${h ? `${f(h.parentRUnrelatedSet)}/${f(h.unrelatedR)} (${h.unrelatedPairs})` : 'n/a'} | ` +
          `${hp ? `${f(hp.parentR)}/${f(hp.neighbourR)} (${hp.pairs})` : 'n/a'} | ${r.s.fissions} | ${r.s.deaths} | ${r.s.residual} |`,
      );
    }
  }
}

for (const c of sorted) {
  out.push({
    tag: c.tag, genes: c.genes, cap: c.cap, arm: c.arm, seeds: c.runs.map((r) => r.s.seed), heldSeeds: c.runs.filter((r) => r.s.held).length, cellHeld: cellHeld(c),
    perSeed: c.runs.map((r) => ({
      seed: r.s.seed, held: r.s.held, lateMeanCompartments: r.s.lateMeanCompartments, lateCompleteShare: r.s.lateCompleteShare, extinctAt: r.s.extinctAt,
      stepsRun: r.s.stepsRun, fissions: r.s.fissions, fusions: r.s.fusions, deaths: r.s.deaths, deathsIncomplete: r.s.deathsIncomplete, denovo: r.s.denovo,
      residual: r.s.residual, heredityGene0: r.s.heredityGene0, heredityGene0Delayed: r.s.heredityGene0Delayed, heredityParasiteDelayed: r.s.heredityParasiteDelayed,
      lateParasiteShare: lateMean(r.s, r.rows, (x) => x.parasiteShare), lateVarGene0: lateMean(r.s, r.rows, (x) => x.varGene0),
      lateMeanCopies: lateMean(r.s, r.rows, (x) => x.meanCopies), lateMeanArea: lateMean(r.s, r.rows, (x) => x.meanArea),
      medianAgeAtDeath: r.s.ages?.observedDeaths.median ?? null, observedDeaths: r.s.ages?.observedDeaths.n ?? null,
      medianAgeAliveAtEnd: r.s.ages?.aliveAtEnd.median ?? null, turnoverTime: turnover(r.s, r.rows),
      lateStrandedBareShare: lateMean(r.s, r.rows, (x) => x.strandedBareShare), lateStrandedHaloShare: lateMean(r.s, r.rows, (x) => x.strandedHaloShare),
    })),
  });
}
if (asJson) console.log('\n' + JSON.stringify(out));
