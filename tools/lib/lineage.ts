// Genotype lineage dossier (docs/lineage-inspector.md). A lineage id is (birth step + 1, birth cell)
// and its genome is immutable, so a child's genome is `mutateInPlace` applied to its parent's with
// the draws keyed on (seed, birth step, birth cell). Every genome in a run therefore follows from its
// roots (the initial world, or genomes.tsv), mutations.tsv and the config, without replay.
// Tracker births are attribution, not copying, and are reported apart from genotype descent.
// Pure: bundle files arrive as line iterables, so vitest can exercise it directly.
import { G, PRESETS, isSupportedRuleVersion, genomeFromHex, initWorld, lowbias32, m3World, stateHash, validateConfig, type WorldConfig, type WorldState } from "@bl/schema";
import {
  ancestry,
  applyMutation,
  byBirth,
  decodeKey,
  descendants,
  expressionOf,
  genomesOf,
  parseKey,
  probeGenome,
  wordsFromHex,
  wordsHex,
  type Expression,
  type Key,
  type Mutation,
  type Probe,
} from "@bl/lineage";

// The genotype core moved to @bl/lineage (shared with the lab); re-exported so existing callers keep working.
export * from "@bl/lineage";

export const DOSSIER_VERSION = 1;
const MUTATIONS_HEADER = "childHi\tchildLo\tparentHi\tparentLo";

// ---- Mutation log -------------------------------------------------------------------------------

export interface MutationLog {
  /** child -> parent; the first row for a child wins, as in tools/lib/clade.ts. */
  parent: Map<Key, Key>;
  rows: number;
  /** Repeated child rows naming the same parent. */
  duplicates: number;
  /** Repeated child rows naming a different parent: how many, and the first 20. */
  conflicting: number;
  conflicts: { child: Key; first: Key; other: Key }[];
}

export async function readMutationLog(lines: AsyncIterable<string>): Promise<MutationLog> {
  const parent = new Map<Key, Key>();
  const conflicts: MutationLog["conflicts"] = [];
  let header = true, rows = 0, duplicates = 0, conflicting = 0;
  for await (const l of lines) {
    if (header) {
      if (l !== MUTATIONS_HEADER) throw new Error(`mutations.tsv: unexpected header ${JSON.stringify(l)}`);
      header = false;
      continue;
    }
    if (!l) continue;
    const f = l.split("\t");
    const child = `${f[0]}:${f[1]}`, p = `${f[2]}:${f[3]}`;
    // A child copies a genome that existed before its minting step, so its parent's birth step is
    // strictly earlier. Every walk over the log relies on this (it rules out cycles).
    if (!(parseKey(p)[0] < parseKey(child)[0])) throw new Error(`mutations.tsv: ${child} names parent ${p}, which was not minted before it`);
    rows++;
    const seen = parent.get(child);
    if (seen === undefined) parent.set(child, p);
    else if (seen === p) duplicates++;
    else if (conflicting++ < 20) conflicts.push({ child, first: seen, other: p });
  }
  if (header) throw new Error("mutations.tsv: empty file");
  return { parent, rows, duplicates, conflicting, conflicts };
}

/**
 * The initial world's genomes, rebuilt the way the runner builds it (packages/runner/src/runner.ts,
 * `runExperiment`) and accepted only when its state hash equals the manifest's `initHash`. Null
 * when the run did not start at step 0 or its start state cannot be rebuilt here.
 */
export function initialGenomes(manifest: any): Map<Key, Uint32Array> | null {
  const cfg = manifest.cfg as WorldConfig, spec = manifest.spec ?? {};
  if ((manifest.startStep ?? 0) !== 0 || !manifest.initHash || !manifest.init) return null;
  const preset = PRESETS.find((p) => p.id === spec.presetId);
  const init = preset?.init ?? manifest.init;
  let s: WorldState;
  try {
    s = spec.soloFounder !== undefined || spec.soloGenome !== undefined || spec.founderSet !== undefined
      ? m3World(cfg, init.founders, init.nutrient, init.biomass, spec.founderSet !== undefined ? spec.founderSet.map(genomeFromHex) : spec.soloGenome !== undefined ? genomeFromHex(spec.soloGenome) : spec.soloFounder)
      : initWorld(cfg, manifest.init);
  } catch {
    return null;
  }
  return stateHash(s) === manifest.initHash ? genomesOf(s, cfg) : null;
}


// ---- Census tables ------------------------------------------------------------------------------

/** lineages.tsv one census at a time; rows must come in ascending step order. */
export async function* censuses(lines: AsyncIterable<string>): AsyncGenerator<[number, [Key, number][]]> {
  let header = true, step = -Infinity;
  let rows: [Key, number][] = [];
  for await (const l of lines) {
    if (header) {
      if (!l.startsWith("step\tlineage\tcells")) throw new Error(`lineages.tsv: unexpected header ${JSON.stringify(l)}`);
      header = false;
      continue;
    }
    if (!l) continue;
    const [s, k, c] = l.split("\t");
    const n = Number(s);
    if (n !== step) {
      if (!(n > step)) throw new Error(`lineages.tsv: step ${s} follows ${step}; rows must be in ascending census order`);
      if (rows.length) yield [step, rows];
      step = n;
      rows = [];
    }
    rows.push([k, Number(c)]);
  }
  if (rows.length) yield [step, rows];
}

/** Rows of a headed TSV as objects keyed by column name. Throws when a needed column is missing. */
export async function* tsvRows(name: string, lines: AsyncIterable<string>, need: readonly string[]): AsyncGenerator<Record<string, string>> {
  let cols: string[] | undefined;
  for await (const l of lines) {
    if (!cols) {
      cols = l.split("\t");
      const missing = need.filter((c) => !cols!.includes(c));
      if (missing.length) throw new Error(`${name}: missing column(s) ${missing.join(", ")}`);
      continue;
    }
    if (!l) continue;
    const f = l.split("\t");
    const r: Record<string, string> = {};
    cols.forEach((c, i) => (r[c] = f[i]));
    yield r;
  }
}

// ---- Subject rules ------------------------------------------------------------------------------

export type SubjectRule =
  | { kind: "key"; key: Key }
  /** Most cells at the census, ties to the earlier-minted lineage. */
  | { kind: "top"; step?: number }
  /** Uniform among lineages holding at least `minShare` of living cells, seeded. */
  | { kind: "random"; step?: number; seed: number; minShare: number }
  /** The earliest-minted lineage alive at the census: the longest-lived, by its own id. */
  | { kind: "longest"; step?: number };

const RANDOM_SALT = 0x6c696e65; // "line"

/** Throws on a rule whose parameters would be coerced (a seed outside u32, a share outside [0, 1], a fractional step). */
export function checkRule(rule: SubjectRule): void {
  if (rule.kind === "key") return void parseKey(rule.key);
  if (rule.step !== undefined && !(Number.isSafeInteger(rule.step) && rule.step >= 0)) throw new Error(`census step must be a non-negative integer, got ${rule.step}`);
  if (rule.kind !== "random") return;
  if (!(Number.isInteger(rule.seed) && rule.seed >= 0 && rule.seed <= 0xffffffff)) throw new Error(`random seed must be an integer in 0..4294967295, got ${rule.seed}`);
  if (!(rule.minShare >= 0 && rule.minShare <= 1)) throw new Error(`minShare must be in [0, 1], got ${rule.minShare}`);
}

export function pickSubject(rule: Exclude<SubjectRule, { kind: "key" }>, rows: [Key, number][]): Key | null {
  checkRule(rule);
  if (!rows.length) return null;
  if (rule.kind === "top") return rows.reduce((a, b) => (b[1] > a[1] || (b[1] === a[1] && byBirth(b[0], a[0]) < 0) ? b : a))[0];
  if (rule.kind === "longest") return rows.map((r) => r[0]).sort(byBirth)[0];
  const total = rows.reduce((s, r) => s + r[1], 0);
  const eligible = rows.filter((r) => r[1] >= rule.minShare * total).map((r) => r[0]).sort(byBirth);
  return eligible.length ? eligible[lowbias32((rule.seed ^ RANDOM_SALT) >>> 0) % eligible.length] : null;
}

// ---- Dossier ------------------------------------------------------------------------------------

/** A run bundle: its manifest and a way to stream each file (null when the file is absent). */
export interface BundleSource {
  dir: string;
  manifest: any;
  open(file: string): AsyncIterable<string> | null;
}

export interface ChainNode {
  key: Key;
  /** Minting step, null for a root. */
  minted: number | null;
  parent: Key | null;
  /** Other children its parent minted (siblings), 0 for a root. */
  siblings: number;
  firstSeen: number | null;
  lastSeen: number | null;
  peakCells: number;
  peakStep: number | null;
  /** [census step, living cells]. */
  series: [number, number][];
  genome: string;
  mu: number;
  sigma: number;
  motGain: number;
  probe: Omit<Probe, "outs">;
  /** Realized at deep censuses (profiles.tsv); null when not recorded. */
  profile: { censuses: number; cellCensuses: number; roles: Record<string, number>; perCell: { photo: number; grow: number; decomp: number; resp: number } } | null;
}

export interface Dossier {
  kind: "genotype";
  dossierVersion: number;
  provenance: {
    dir: string;
    runId: string;
    presetId: string;
    condition: string;
    seed: number;
    censusEvery: number;
    deepEvery: number;
    finalHash: string | null;
    /** The run's last census step (series.jsonl, else the manifest), empty or not; null when unknown. */
    finalCensus: number | null;
    /** False in `neutral`, where every cell expresses the reference phenotype. */
    expressed: boolean;
    files: string[];
  };
  rule: SubjectRule & { step: number };
  subject: { key: Key; origin: ReturnType<typeof decodeKey>; cellsAtStep: number; shareAtStep: number; firstSeen: number | null; lastSeen: number | null; aliveAtEnd: boolean };
  root: { key: Key; source: "initial world" | "genomes.tsv" };
  verification: { genomesChecked: number; against: "genomes.tsv" | null; lineagesEverCensused: number | null };
  /**
   * mutations.tsv: rows, distinct children, and the run's own count of mutation events. `complete` is
   * true when the distinct children match that count with no conflicting rows, null when it cannot be
   * checked (no count, or a bundle starting after step 0, whose counter includes earlier events).
   */
  log: { rows: number; children: number; duplicates: number; conflicting: number; conflicts: MutationLog["conflicts"]; expectedMutations: number | null; complete: boolean | null };
  chain: ChainNode[];
  mutations: (Mutation & { expression: Expression; maxDelta: number[]; changedShare: number[] })[];
  offspring: { children: { key: Key; minted: number; peakCells: number; firstSeen: number | null }[]; childCount: number; childrenCensused: number; descendants: number };
  /** Per census: living cells, cells of the ancestry line (any chain member), cells of the subject's clade. */
  population: { steps: number[]; living: number[]; line: number[]; clade: number[] };
  /** Tracker births touching the subject: attribution, not copying (reset, 2026-09-29). */
  trackerBirths: { fission: number; budding: number; asParent: number; asChild: number; rows: Record<string, string>[] } | null;
  gaps: string[];
}

export interface DossierOptions {
  /**
   * Census step (a rule's own `step` must agree when both are given). Default: the final census, or for
   * a rule-based subject in a run with no lineage alive at the end, the last census with living lineages.
   */
  step?: number;
  /** Most tracker-birth rows to keep. */
  birthRows?: number;
}

const need = (src: BundleSource, file: string): AsyncIterable<string> => {
  const l = src.open(file);
  if (!l) throw new Error(`${src.dir}: ${file} is missing`);
  return l;
};

/** Every census in series.jsonl, empty ones included, with its lineage count (null if unrecorded); null when the file is absent. */
async function seriesCensuses(src: BundleSource): Promise<{ steps: number[]; lineages: (number | null)[] } | null> {
  const l = src.open("series.jsonl");
  if (!l) return null;
  const steps: number[] = [], lineages: (number | null)[] = [];
  for await (const line of l) {
    if (!line) continue;
    const r = JSON.parse(line);
    const prev = steps.length ? steps[steps.length - 1] : -1;
    if (!Number.isSafeInteger(r.step) || r.step <= prev) throw new Error(`${src.dir}: series.jsonl census step ${r.step} does not follow ${prev}`);
    steps.push(r.step);
    lineages.push(Number.isSafeInteger(r.lineages) ? r.lineages : null);
  }
  return { steps, lineages };
}

export async function buildDossier(src: BundleSource, rule: SubjectRule, opts: DossierOptions = {}): Promise<Dossier> {
  const m = src.manifest;
  const cfg = m.cfg as WorldConfig;
  if (!isSupportedRuleVersion(m.ruleVersion) || cfg?.ruleVersion !== m.ruleVersion) throw new Error(`${src.dir}: unsupported or inconsistent rule version ${m.ruleVersion}/${cfg?.ruleVersion}; expected matching rule 1 or 2`);
  const configErrors = validateConfig(cfg);
  if (configErrors.length) throw new Error(`${src.dir}: invalid config: ${configErrors.join("; ")}`);
  checkRule(rule);
  const ruleStep = rule.kind === "key" ? undefined : rule.step;
  if (opts.step !== undefined && !(Number.isSafeInteger(opts.step) && opts.step >= 0)) throw new Error(`census step must be a non-negative integer, got ${opts.step}`);
  if (ruleStep !== undefined && opts.step !== undefined && ruleStep !== opts.step) throw new Error(`the rule's census step ${ruleStep} and options.step ${opts.step} disagree`);
  const want = ruleStep ?? opts.step;
  const gaps: string[] = [];
  const files = ["manifest.json", "mutations.tsv", "lineages.tsv"];

  // lineages.tsv has no rows for a census without living lineages. series.jsonl lists every census with
  // its lineage count, so an empty census is told from missing rows only where that count is 0 (without
  // series.jsonl, only at the final census, from the manifest's finalLineages).
  const grid = await seriesCensuses(src);
  if (grid) files.push("series.jsonl");
  else gaps.push("series.jsonl absent: only the final census can be confirmed empty (from the manifest)");
  const finalCensus = grid ? (grid.steps.length ? grid.steps[grid.steps.length - 1] : null) : (m.summary?.steps ?? null);
  const confirmEmpty = (step: number, i = grid ? grid.steps.indexOf(step) : -1): void => {
    const n = grid ? (i < 0 ? undefined : grid.lineages[i]) : step === m.summary?.steps ? m.summary?.finalLineages : undefined;
    if (n === 0) return;
    throw new Error(`${src.dir}: lineages.tsv has no rows for the census at step ${step}, but ${n === undefined || n === null ? "nothing records it as empty" : `${grid ? "series.jsonl" : "the manifest"} records ${n} lineage(s) there`}: lineages.tsv is incomplete`);
  };

  // Subject: one pass over lineages.tsv to the chosen census.
  let atStep = -1, atRows: [Key, number][] = [];
  for await (const [s, rows] of censuses(need(src, "lineages.tsv"))) {
    if (want !== undefined && s > want) break;
    atStep = s;
    atRows = rows;
  }
  if (want !== undefined) {
    if (atStep !== want) {
      if (grid ? !grid.steps.includes(want) : want !== finalCensus) throw new Error(`${src.dir}: no census at step ${want}${atStep >= 0 ? ` (the nearest before with living lineages is ${atStep})` : ""}`);
      confirmEmpty(want);
      atStep = want;
      atRows = [];
    }
  } else if (finalCensus !== null && finalCensus > atStep) {
    confirmEmpty(finalCensus);
    if (rule.kind === "key" || atStep < 0) {
      atStep = finalCensus;
      atRows = [];
    } else gaps.push(`no lineage is alive at the final census (step ${finalCensus}); rule ${rule.kind} was applied at step ${atStep}, the last census with living lineages`);
  }
  if (atStep < 0) throw new Error(`${src.dir}: lineages.tsv has no census`);
  const subject = rule.kind === "key" ? rule.key : pickSubject(rule, atRows);
  if (!subject) throw new Error(`${src.dir}: no lineage at step ${atStep} satisfies rule ${JSON.stringify(rule)}${atRows.length ? "" : " (no lineage is alive there)"}`);

  const log = await readMutationLog(need(src, "mutations.tsv"));
  const chain = ancestry(subject, log.parent);
  const root = chain[0];
  // Every mutation event mints one id and writes one row, so the distinct children should equal the
  // run's event count. A bundle that starts after step 0 carries a counter that includes earlier events.
  const startStep = m.startStep ?? 0;
  const expected = m.summary?.mutations ?? null;
  let complete: boolean | null = null;
  if (startStep !== 0) gaps.push(`the bundle starts at step ${startStep}: mutations.tsv holds only its own events, so ancestry stops at lineages minted before then`);
  else if (expected === null) gaps.push("the manifest has no mutation count, so mutations.tsv cannot be checked for completeness");
  else {
    complete = log.parent.size === expected && log.conflicting === 0;
    if (log.parent.size !== expected) gaps.push(`mutations.tsv names ${log.parent.size} distinct children but the run counted ${expected} mutation events: ${log.parent.size < expected ? "events are missing, so ancestry and descendants may be cut short" : "it holds children the run did not count"}`);
  }
  if (log.duplicates) gaps.push(`${log.duplicates} mutations.tsv row(s) repeat a child with the same parent`);
  if (log.conflicting) gaps.push(`${log.conflicting} mutations.tsv row(s) name a second parent for a child; the first row was used`);
  const [rootHi] = parseKey(root);
  if (rootHi !== 0) gaps.push(`root ${root} is not a founder and has no parent row (imported, minted before the bundle starts, or its event was lost): its ancestry before step ${rootHi - 1} is unknown`);

  // Recorded genomes (lineageObs runs): roots and a check on every reconstructed ancestor.
  const chainSet = new Set(chain);
  const recorded = new Map<Key, string>();
  let everCensused: number | null = null;
  const gl = src.open("genomes.tsv");
  if (gl) {
    files.push("genomes.tsv");
    everCensused = 0;
    for await (const r of tsvRows("genomes.tsv", gl, ["lineage", "words"])) {
      everCensused++;
      if (chainSet.has(r.lineage)) recorded.set(r.lineage, r.words);
    }
  } else gaps.push("genomes.tsv absent (run without --lineage-obs): genomes are reconstructed but not cross-checked");

  let rootWords: Uint32Array | undefined, rootSource: Dossier["root"]["source"];
  const initial = parseKey(root)[0] === 0 ? initialGenomes(m) : null;
  if (initial?.has(root)) {
    rootWords = initial.get(root)!;
    rootSource = "initial world";
  } else if (recorded.has(root)) {
    rootWords = wordsFromHex(root, recorded.get(root)!);
    rootSource = "genomes.tsv";
  } else {
    throw new Error(`${src.dir}: the genome of root ${root} is unknown: ${parseKey(root)[0] === 0 ? "the initial world could not be rebuilt to the manifest's initHash" : "it has no parent row (imported, or its event was lost)"}, and genomes.tsv does not record it`);
  }

  const words = new Map<Key, Uint32Array>([[root, rootWords]]);
  const mutations: Mutation[] = [];
  for (let i = 1; i < chain.length; i++) {
    const r = applyMutation(words.get(chain[i - 1])!, chain[i], chain[i - 1], cfg);
    words.set(chain[i], r.words);
    mutations.push(r.mutation);
  }
  let checked = 0;
  for (const [k, hex] of recorded) {
    const got = wordsHex(words.get(k)!);
    if (got !== hex) throw new Error(`${src.dir}: reconstructed genome of ${k} differs from genomes.tsv (reconstruction is wrong for this run; refusing to report)`);
    checked++;
  }

  // Offspring and siblings from the parent map; clade membership for the census pass.
  const desc = descendants(subject, log.parent);
  const kids: Key[] = [];
  const siblings = new Map<Key, number>();
  for (const [c, p] of log.parent) {
    if (p === subject) kids.push(c);
    if (chainSet.has(p)) siblings.set(p, (siblings.get(p) ?? 0) + 1);
  }
  kids.sort(byBirth);
  const kidSet = new Set(kids);

  // Census pass: population, line and clade cells; series for the chain and the subject's children.
  const series = new Map<Key, [number, number][]>();
  const kidSeen = new Map<Key, { first: number; peak: number }>();
  const pop: Dossier["population"] = { steps: [], living: [], line: [], clade: [] };
  const emptyCensus = (s: number) => {
    pop.steps.push(s);
    pop.living.push(0);
    pop.line.push(0);
    pop.clade.push(0);
  };
  let gi = 0;
  let lastStep = -1, lastRows: [Key, number][] = [];
  for await (const [s, rows] of censuses(need(src, "lineages.tsv"))) {
    if (grid) {
      while (gi < grid.steps.length && grid.steps[gi] < s) {
        confirmEmpty(grid.steps[gi], gi);
        emptyCensus(grid.steps[gi++]);
      }
      if (grid.steps[gi] !== s) throw new Error(`${src.dir}: lineages.tsv has a census at step ${s} that series.jsonl lacks`);
      const n = grid.lineages[gi++];
      if (n !== null && n !== rows.length) throw new Error(`${src.dir}: lineages.tsv has ${rows.length} lineage(s) at step ${s}, series.jsonl records ${n}`);
    }
    let living = 0, line = 0, clade = 0;
    for (const [k, c] of rows) {
      living += c;
      if (chainSet.has(k)) {
        line += c;
        (series.get(k) ?? series.set(k, []).get(k)!).push([s, c]);
      }
      if (k === subject || desc.has(k)) clade += c;
      if (kidSet.has(k)) {
        const e = kidSeen.get(k);
        if (!e) kidSeen.set(k, { first: s, peak: c });
        else if (c > e.peak) e.peak = c;
      }
    }
    pop.steps.push(s);
    pop.living.push(living);
    pop.line.push(line);
    pop.clade.push(clade);
    lastStep = s;
    lastRows = rows;
  }
  if (grid)
    while (gi < grid.steps.length) {
      confirmEmpty(grid.steps[gi], gi);
      emptyCensus(grid.steps[gi++]);
    }

  // Realized behaviour at deep censuses (lineageObs runs).
  const profiles = new Map<Key, NonNullable<ChainNode["profile"]>>();
  const pl = src.open("profiles.tsv");
  if (pl) {
    files.push("profiles.tsv");
    const sums = new Map<Key, { photo: number; grow: number; decomp: number; resp: number }>();
    for await (const r of tsvRows("profiles.tsv", pl, ["lineage", "cells", "photo", "grow", "decomp", "resp", "role"])) {
      if (!chainSet.has(r.lineage)) continue;
      const p = profiles.get(r.lineage) ?? profiles.set(r.lineage, { censuses: 0, cellCensuses: 0, roles: {}, perCell: { photo: 0, grow: 0, decomp: 0, resp: 0 } }).get(r.lineage)!;
      const f = sums.get(r.lineage) ?? sums.set(r.lineage, { photo: 0, grow: 0, decomp: 0, resp: 0 }).get(r.lineage)!;
      const cells = Number(r.cells);
      p.censuses++;
      p.cellCensuses += cells;
      p.roles[r.role] = (p.roles[r.role] ?? 0) + cells;
      f.photo += Number(r.photo);
      f.grow += Number(r.grow);
      f.decomp += Number(r.decomp);
      f.resp += Number(r.resp);
    }
    for (const [k, p] of profiles) {
      const f = sums.get(k)!, d = p.cellCensuses || 1;
      const r3 = (v: number) => Math.round((1000 * v) / d) / 1000;
      p.perCell = { photo: r3(f.photo), grow: r3(f.grow), decomp: r3(f.decomp), resp: r3(f.resp) };
    }
  } else gaps.push("profiles.tsv absent: no realized roles or fluxes");
  gaps.push("per-lineage free energy, mass history and experienced environment are not recorded in run bundles (docs/lineage-inspector.md §6.5)");

  // Tracker births touching the subject.
  let trackerBirths: Dossier["trackerBirths"] = null;
  const bl = src.open("births.tsv");
  if (bl) {
    files.push("births.tsv");
    trackerBirths = { fission: 0, budding: 0, asParent: 0, asChild: 0, rows: [] };
    for await (const r of tsvRows("births.tsv", bl, ["kind", "parentLineage", "childLineage"])) {
      const asParent = r.parentLineage === subject, asChild = r.childLineage === subject;
      if (!asParent && !asChild) continue;
      if (r.kind === "fission") trackerBirths.fission++;
      else if (r.kind === "budding") trackerBirths.budding++;
      if (asParent) trackerBirths.asParent++;
      if (asChild) trackerBirths.asChild++;
      if (trackerBirths.rows.length < (opts.birthRows ?? 50)) trackerBirths.rows.push(r);
    }
  } else gaps.push("births.tsv absent: no tracker-attributed births");

  // Probe the chain in order, keeping only summaries: each probe's grid outputs are ~400 KB.
  const probes: Omit<Probe, "outs">[] = [];
  const expressions: ReturnType<typeof expressionOf>[] = [];
  let prev: Probe | null = null;
  for (let i = 0; i < chain.length; i++) {
    const p = probeGenome(words.get(chain[i])!);
    if (prev) expressions.push(expressionOf(mutations[i - 1], prev, p));
    const { outs: _outs, ...summary } = p;
    probes.push(summary);
    prev = p;
  }
  const nodes: ChainNode[] = chain.map((k, i) => {
    const s = series.get(k) ?? [];
    const peak = s.reduce<[number, number] | null>((a, r) => (!a || r[1] > a[1] ? r : a), null);
    const w = words.get(k)!;
    return {
      key: k,
      minted: parseKey(k)[0] === 0 ? null : parseKey(k)[0] - 1,
      parent: i === 0 ? null : chain[i - 1],
      siblings: i === 0 ? 0 : (siblings.get(chain[i - 1]) ?? 1) - 1,
      firstSeen: s.length ? s[0][0] : null,
      lastSeen: s.length ? s[s.length - 1][0] : null,
      peakCells: peak ? peak[1] : 0,
      peakStep: peak ? peak[0] : null,
      series: s,
      genome: wordsHex(w),
      mu: w[G.PARAM0] & 0xffff,
      sigma: w[G.PARAM0] >>> 16,
      motGain: w[G.PARAM1] & 0xff,
      probe: probes[i],
      profile: profiles.get(k) ?? null,
    };
  });

  const total = atRows.reduce((s, r) => s + r[1], 0);
  const cellsAtStep = atRows.find((r) => r[0] === subject)?.[1] ?? 0;
  const subjNode = nodes[nodes.length - 1];
  return {
    kind: "genotype",
    dossierVersion: DOSSIER_VERSION,
    provenance: {
      dir: src.dir,
      runId: m.runId,
      presetId: m.spec?.presetId,
      condition: m.spec?.condition,
      seed: cfg.seed,
      censusEvery: m.spec?.censusEvery,
      deepEvery: m.spec?.deepEvery,
      finalHash: m.summary?.finalHash ?? null,
      finalCensus,
      expressed: !cfg.neutral,
      files,
    },
    rule: { ...rule, step: atStep },
    subject: {
      key: subject,
      origin: decodeKey(subject, cfg),
      cellsAtStep,
      shareAtStep: total ? cellsAtStep / total : 0,
      firstSeen: subjNode.firstSeen,
      lastSeen: subjNode.lastSeen,
      aliveAtEnd: lastStep >= 0 && (finalCensus === null || lastStep === finalCensus) && lastRows.some((r) => r[0] === subject),
    },
    root: { key: root, source: rootSource },
    verification: { genomesChecked: checked, against: gl ? "genomes.tsv" : null, lineagesEverCensused: everCensused },
    log: { rows: log.rows, children: log.parent.size, duplicates: log.duplicates, conflicting: log.conflicting, conflicts: log.conflicts, expectedMutations: expected, complete },
    chain: nodes,
    mutations: mutations.map((mu, i) => ({ ...mu, ...expressions[i] })),
    offspring: {
      children: kids.map((k) => ({ key: k, minted: parseKey(k)[0] - 1, peakCells: kidSeen.get(k)?.peak ?? 0, firstSeen: kidSeen.get(k)?.first ?? null })),
      childCount: kids.length,
      childrenCensused: kidSeen.size,
      descendants: desc.size,
    },
    population: pop,
    trackerBirths,
    gaps,
  };
}

/** The comparison row for a twin history (same rule, e.g. the same-seed `neutral` run). */
export function twinSummary(d: Dossier) {
  const peaks = d.chain.map((c) => c.peakCells).sort((a, b) => a - b);
  const by = (e: Expression) => d.mutations.filter((x) => x.expression === e).length;
  return {
    runId: d.provenance.runId,
    condition: d.provenance.condition,
    expressed: d.provenance.expressed,
    rule: d.rule,
    subject: d.subject.key,
    depth: d.mutations.length,
    medianAncestorPeak: peaks[Math.floor(peaks.length / 2)],
    ancestorsNeverCensused: d.chain.filter((c) => c.firstSeen === null).length,
    mutationsByExpression: { controller: by("controller"), physics: by("physics"), "probe-silent": by("probe-silent"), clamped: by("clamped") },
    childCount: d.offspring.childCount,
    descendants: d.offspring.descendants,
    lineagesMinted: d.log.children,
  };
}
