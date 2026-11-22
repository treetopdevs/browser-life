/**
 * Droplet genes: read every run JSON in a directory and print the tables the plan's decision rules need.
 *
 * Usage: deno run -A --no-lock experiments/dropgenes/summarize.ts runs/dropgenes/confirm-v2 [--json]
 *
 * A cell (setting, K, sites, arm) is "held" when it has at least 4 seeds and at least 3 of them are held.
 * Refuses a directory whose runs of one setting do not share steps and configuration (apart from the keys a
 * cell is named by), so results of different settings cannot be mixed by accident.
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
  heredityGene0: Heredity | null;
  heredityGene0Delayed: Heredity | null;
  heredityParasiteDelayed: Heredity | null;
  /** Linked-template runs only (docs/droplet-genes-linked-2026-11-21/PLAN.md). */
  linked?: { founders: string; sites: string; lateCensuses: number; late: LinkedReadout | null; atEnd: LinkedReadout };
  /** Runs made for the second linked screen (docs/droplet-genes-linked2-2026-11-21/PLAN.md); absent in older files. */
  deathGenes?: { records: number; withMissing: number; missingByGene: number[]; byMissingCount: number[]; medianMissingSteps: number | null; missingAtTwoCensusesShare: number | null };
  lastCompartments?: { step: number; compartments: number; complete: number; arena: number[]; inCompartments: number[]; byLength?: number[] } | null;
}
interface LinkedReadout {
  linkedShare: (number | null)[];
  meanLength: number | null;
  shortenedShare: number | null;
  fullShare: number | null;
  byLength: number[];
}
interface Row {
  step: number;
  parasiteShare: number;
  strandedShare: number;
  strandedBareShare: number;
  strandedHaloShare: number;
  varGene0: number | null;
  meanCopies: number;
  meanArea: number;
  linked?: LinkedReadout;
}

const dir = Deno.args[0];
if (!dir) throw new Error('usage: summarize.ts <dir> [--json]');
const asJson = Deno.args.includes('--json');
const CELL_KEYS = new Set(['seed', 'genes', 'capPerTile', 'gated', 'mutPar']);

interface Cell { tag: string; genes: number; cap: number; arm: string; runs: { s: Summary; rows: Row[] }[] }
const cells = new Map<string, Cell>();
const sharedByTag = new Map<string, string>();
let protocol: Summary['protocol'] | null = null;
const parMutByTag = new Map<string, number>();
const foundersByTag = new Map<string, string>(); // linked runs: the founders' template form, one per setting
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
  {
    const form = summary.linked ? summary.linked.founders : 'single';
    const seenForm = foundersByTag.get(tag);
    if (seenForm === undefined) foundersByTag.set(tag, form);
    else if (seenForm !== form) throw new Error(`${name}: founders' template form differs from other runs of setting "${tag || 'default'}"`);
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

// Linked templates: printed only when the directory holds linked runs, so first-rung directories read as before.
if (sorted.some((c) => c.runs.some((r) => r.s.linked))) {
  console.log('\nLinked templates (late = pooled over the censuses of the last tenth of the planned run; n/a where a run ended before it). Ranges over seeds.\n');
  console.log('| setting | K | sites/tile | arm | founders | site rule | share of each gene\'s copies that are linked (lowest to highest gene) | mean genes per template | share of linked templates that are shortened | share of templates carrying every gene |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const c of sorted) {
    const ls = c.runs.map((r) => r.s.linked);
    if (!ls.some((l) => l)) continue;
    const late = ls.map((l) => l?.late ?? null);
    const withLate = late.filter((l): l is LinkedReadout => l !== null);
    const shares = withLate.flatMap((l) => l.linkedShare).filter((v): v is number => v !== null);
    const perGene = shares.length
      ? `${Math.min(...shares).toFixed(2)} to ${Math.max(...shares).toFixed(2)}${withLate.length < late.length ? ` (${withLate.length} of ${late.length} runs)` : ''}`
      : 'n/a';
    console.log(
      `| ${c.tag || 'default'} | ${c.genes} | ${c.cap} | ${c.arm} | ${[...new Set(ls.map((l) => l?.founders ?? 'n/a'))].join(',')} | ${[...new Set(ls.map((l) => l?.sites ?? 'n/a'))].join(',')} | ` +
        `${perGene} | ${range(late.map((l) => l?.meanLength ?? null), 2)} | ${range(late.map((l) => l?.shortenedShare ?? null), 3)} | ${range(late.map((l) => l?.fullShare ?? null), 3)} |`,
    );
  }
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

// Second linked screen: templates by length at fixed steps. Printed only when the directory holds linked runs
// of at least 2,000 steps; it reads the report rows, which linked runs have always carried.
const AT_STEPS = [2000, 10000, 50000, 200000];
const linkedCells = sorted.filter((c) => c.runs.some((r) => r.s.linked));
if (linkedCells.length > 0) {
  const rowAt = (r: { rows: Row[] }, step: number): LinkedReadout | null => r.rows.find((x) => x.step === step)?.linked ?? null;
  console.log('\nFull templates over time: the share of gene-carrying molecules that carry every gene, whole arena, per seed in seed order (n/a: the run had ended, or was not planned that long).\n');
  console.log(`| setting | K | sites/tile | arm | ${AT_STEPS.map((t) => `step ${t}`).join(' | ')} |`);
  console.log(`|---|---|---|---|${AT_STEPS.map(() => '---').join('|')}|`);
  for (const c of linkedCells) {
    console.log(`| ${c.tag || 'default'} | ${c.genes} | ${c.cap} | ${c.arm} | ${AT_STEPS.map((t) => c.runs.map((r) => f(rowAt(r, t)?.fullShare ?? null, 3)).join(', ')).join(' | ')} |`);
  }
  console.log('\nMolecules by genes carried (1 to K), whole arena, summed over the seeds that reached the step: shares of all gene-carrying molecules, shortest first.\n');
  console.log(`| setting | K | sites/tile | arm | ${AT_STEPS.map((t) => `step ${t}`).join(' | ')} |`);
  console.log(`|---|---|---|---|${AT_STEPS.map(() => '---').join('|')}|`);
  for (const c of linkedCells) {
    const cols = AT_STEPS.map((t) => {
      const rs = c.runs.map((r) => rowAt(r, t)).filter((l): l is LinkedReadout => l !== null);
      if (rs.length === 0) return 'n/a';
      const sum = new Array<number>(c.genes).fill(0);
      for (const l of rs) l.byLength.forEach((v, i) => { sum[i] += v; });
      const tot = sum.reduce((a, b) => a + b, 0);
      return tot > 0 ? `${sum.map((v) => (v / tot).toFixed(3)).join(' / ')} (${rs.length} of ${c.runs.length})` : `no molecule (${rs.length} of ${c.runs.length})`;
    });
    console.log(`| ${c.tag || 'default'} | ${c.genes} | ${c.cap} | ${c.arm} | ${cols.join(' | ')} |`);
  }
}

// Second linked screen: which genes were missing when compartments ended. Printed only for runs that recorded it.
if (sorted.some((c) => c.runs.some((r) => r.s.deathGenes))) {
  console.log('\nCompartments that ended (the tracker\'s deaths): genes missing at the compartment\'s last census, a gene counted wherever it sits. Ranges over seeds; counts by gene are summed over seeds.\n');
  console.log('| setting | K | sites/tile | arm | deaths recorded | share with a gene missing at the last census | deaths by gene missing (lowest to highest gene) | deaths by number of genes missing (0 to K) | median steps from first seen missing to gone | share seen missing at two censuses or more |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const c of sorted) {
    const ds = c.runs.map((r) => r.s.deathGenes ?? null);
    const have = ds.filter((d): d is NonNullable<Summary['deathGenes']> => d !== null);
    if (have.length === 0) continue;
    const sumOver = (pick: (d: NonNullable<Summary['deathGenes']>) => number[], n: number) => {
      const sum = new Array<number>(n).fill(0);
      for (const d of have) pick(d).forEach((v, i) => { sum[i] += v; });
      return sum.join(', ');
    };
    console.log(
      `| ${c.tag || 'default'} | ${c.genes} | ${c.cap} | ${c.arm} | ${range(ds.map((d) => d?.records ?? null), 0)} | ${range(ds.map((d) => (d && d.records > 0 ? d.withMissing / d.records : null)), 2)} | ` +
        `${sumOver((d) => d.missingByGene, c.genes)} | ${sumOver((d) => d.byMissingCount, c.genes + 1)} | ${range(ds.map((d) => d?.medianMissingSteps ?? null), 0)} | ${range(ds.map((d) => d?.missingAtTwoCensusesShare ?? null), 2)} |`,
    );
  }
  const lost = sorted.filter((c) => c.runs.some((r) => r.s.lastCompartments));
  if (lost.length > 0) {
    console.log('\nRuns that lost every compartment: the last census that still had one. Copies per gene over the whole arena, then the parasite, a gene counted wherever it sits.\n');
    console.log('| setting | K | sites/tile | arm | seed | step | compartments (complete) | copies per gene, whole arena | parasite, whole arena | copies per gene inside compartments | molecules by genes carried (1 to K) |');
    console.log('|---|---|---|---|---|---|---|---|---|---|---|');
    for (const c of lost) {
      for (const r of c.runs) {
        const l = r.s.lastCompartments;
        if (!l) continue;
        console.log(
          `| ${c.tag || 'default'} | ${c.genes} | ${c.cap} | ${c.arm} | ${r.s.seed} | ${l.step} | ${l.compartments} (${l.complete}) | ${l.arena.slice(0, c.genes).join(', ')} | ${l.arena[c.genes]} | ` +
            `${l.inCompartments.slice(0, c.genes).join(', ')} | ${l.byLength ? l.byLength.join(', ') : 'n/a'} |`,
        );
      }
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
      ...(r.s.linked ? { linked: r.s.linked } : {}),
      ...(r.s.deathGenes ? { deathGenes: r.s.deathGenes } : {}),
      ...(r.s.lastCompartments !== undefined ? { lastCompartments: r.s.lastCompartments } : {}),
      ...(r.s.linked ? { fullShareAt: Object.fromEntries(AT_STEPS.map((t) => [t, r.rows.find((x) => x.step === t)?.linked?.fullShare ?? null])) } : {}),
    })),
  });
}
if (asJson) console.log('\n' + JSON.stringify(out));
