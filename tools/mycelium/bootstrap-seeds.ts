// Seed table of the bootstrap screen (docs/mycelium-bootstrap-2026-11-14/DESIGN.md section 11), EXPLORATORY. One leaf module, no imports: every
// slot of the screen is defined here and nowhere else (a unit test checks that no other file holds a slot literal), and the audit is a pure function
// so vitest can run it (conduit-screen.ts pulls jsr: imports and gpu.ts, which vitest cannot load).
//
// Rule, not memory: the table is a contiguous block from `base`: S (sizing, dev) 8 slots, T 16, D 16 (B reuses D's), F 16, O 16, SMOKE 4, in that
// order; of each 16, the first 8 are the screen slots and the second 8 are held for the extension to 16 seeds. A world seed is slot + the heredity's
// offset. The null branches use two derived seeds per world seed. `proposeBase` returns the first base of a candidate list whose whole table audits clean.

export type Heredity = "inherit" | "blocked" | "physarum" | "blind";
export const HEREDITIES: readonly Heredity[] = ["inherit", "blocked", "physarum", "blind"];
export const HEREDITY_OFFSET: Record<Heredity, number> = { inherit: 0, blocked: 200, physarum: 400, blind: 600 };
export const NULL_XOR_A = 0x5a5a5a5a;
export const NULL_XOR_B = 0x3c3c3c3c;
/** run.ts refuses seeds from 9001 up; every seed the screen uses stays below it. */
export const FRESH_MIN_SEED = 9001;

export type Series = "S" | "T" | "D" | "F" | "O" | "SMOKE";
export const SERIES_ORDER: readonly Series[] = ["S", "T", "D", "F", "O", "SMOKE"];
export const SERIES_SIZE: Record<Series, number> = { S: 8, T: 16, D: 16, F: 16, O: 16, SMOKE: 4 };
export const SCREEN_PER_SERIES = 8;
/** The default table base: the first candidate whose whole table passes the audit (`--propose` recomputes it). */
export const BOOT_BASE = 8209;
export const BASE_CANDIDATES: readonly number[] = Array.from({ length: 8 }, (_, k) => 8209 - 1000 * k);

export const worldSeed = (slot: number, h: Heredity): number => slot + HEREDITY_OFFSET[h];
export const nullSeedA = (seed: number): number => (seed ^ NULL_XOR_A) >>> 0;
export const nullSeedB = (seed: number): number => (seed ^ NULL_XOR_B) >>> 0;

export interface TableRow { series: Series; index: number; slot: number; kind: "screen" | "held" | "smoke" }

export function seriesStart(series: Series): number {
  let t = 0;
  for (const s of SERIES_ORDER) { if (s === series) return t; t += SERIES_SIZE[s]; }
  throw new Error(`unknown series ${series}`);
}
export const TABLE_SIZE = SERIES_ORDER.reduce((t, s) => t + SERIES_SIZE[s], 0);

export function tableRows(base: number): TableRow[] {
  const rows: TableRow[] = [];
  for (const series of SERIES_ORDER) {
    for (let i = 0; i < SERIES_SIZE[series]; i++) {
      rows.push({ series, index: i, slot: base + seriesStart(series) + i, kind: series === "SMOKE" ? "smoke" : i < SCREEN_PER_SERIES ? "screen" : "held" });
    }
  }
  return rows;
}
export const slotsOf = (base: number, series: Series, kind: TableRow["kind"] | "all" = "screen"): number[] =>
  tableRows(base).filter((r) => r.series === series && (kind === "all" || r.kind === kind)).map((r) => r.slot);

/** Every world seed the table can use (slot x heredity) and the two derived null-branch seeds of each. */
export function allSeeds(base: number): { seed: number; label: string; derived: boolean }[] {
  const out: { seed: number; label: string; derived: boolean }[] = [];
  for (const r of tableRows(base)) {
    for (const h of HEREDITIES) {
      const w = worldSeed(r.slot, h);
      out.push({ seed: w, label: `${r.series}/${h}/${r.slot}`, derived: false });
      out.push({ seed: nullSeedA(w), label: `${r.series}/${h}/${r.slot}/nullA`, derived: true });
      out.push({ seed: nullSeedB(w), label: `${r.series}/${h}/${r.slot}/nullB`, derived: true });
    }
  }
  return out;
}

/** A registered set: explicit seeds, or an inclusive range (the shaping scratch range is 40,000 seeds, kept as a range). */
export interface RegisteredSet { name: string; seeds?: readonly number[]; range?: readonly [number, number] }
const inSet = (set: RegisteredSet, seed: number): boolean => (set.range ? seed >= set.range[0] && seed <= set.range[1] : false) || (set.seeds ? set.seeds.includes(seed) : false);

export interface AuditOptions {
  /** World seeds found in the bootstrap run-log: each must be a row of the table (reconciled, not collision-checked). */
  bootLogSeeds?: readonly number[];
  /** run.ts's gates: returns a reason string if the seed would be refused, else null. */
  refuse?: (seed: number) => string | null;
}

/** Proves zero collisions of every world seed and derived seed with every registered set, and the table's own structure. Empty problems = clear. */
export function auditTable(base: number, registered: readonly RegisteredSet[], opts: AuditOptions = {}): { problems: string[]; report: string[] } {
  const problems: string[] = [], report: string[] = [];
  const rows = tableRows(base), seeds = allSeeds(base);
  const worlds = seeds.filter((x) => !x.derived), derived = seeds.filter((x) => x.derived);
  // Structure.
  const slotList = rows.map((r) => r.slot);
  if (new Set(slotList).size !== slotList.length) problems.push("two table rows share a slot");
  const span = slotList[slotList.length - 1] - slotList[0] + 1;
  if (span >= 200) problems.push(`the table spans ${span} slots (must be under 200 so offset images never overlap)`);
  for (const s of SERIES_ORDER) if (SERIES_SIZE[s] >= 200) problems.push(`block ${s} spans ${SERIES_SIZE[s]} (must be under 200)`);
  const wl = worlds.map((x) => x.seed);
  if (new Set(wl).size !== wl.length) problems.push("two (series, heredity, slot) rows share a world seed");
  report.push(`table base ${base}: ${rows.length} slots (${SERIES_ORDER.map((s) => `${s} ${slotsOf(base, s, "all")[0]}-${slotsOf(base, s, "all").at(-1)}`).join(", ")}), span ${span}, ${worlds.length} world seeds, ${derived.length} derived null seeds`);
  // Collisions with every registered set, for world and derived seeds.
  for (const set of registered) {
    const hitW = worlds.filter((x) => inSet(set, x.seed)), hitD = derived.filter((x) => inSet(set, x.seed));
    const size = set.range ? `range ${set.range[0]}-${set.range[1]}` : `${set.seeds?.length ?? 0} seeds`;
    report.push(`${set.name}: ${size}, ${hitW.length} world and ${hitD.length} derived collisions${hitW.length + hitD.length ? ` (${[...hitW, ...hitD].slice(0, 12).map((x) => `${x.seed} ${x.label}`).join("; ")})` : ""}`);
    if (hitW.length || hitD.length) problems.push(`${set.name}: ${[...hitW, ...hitD].map((x) => `${x.seed} ${x.label}`).join(",")}`);
  }
  // Derived seeds neither registered (above) nor equal to a world seed.
  const wset = new Set(wl);
  const dClash = derived.filter((x) => wset.has(x.seed));
  report.push(`derived null seeds equal to a world seed: ${dClash.length}`);
  if (dClash.length) problems.push(`derived seed equals a world seed: ${dClash.map((x) => `${x.seed} ${x.label}`).join(",")}`);
  const dDup = derived.length - new Set(derived.map((x) => x.seed)).size;
  report.push(`derived null seeds shared between two rows: ${dDup}`);
  if (dDup) problems.push(`${dDup} derived seeds are shared between two rows`);
  // run.ts gates, world seeds only (the null branch seeds never go through run.ts).
  const tooHigh = worlds.filter((x) => !(x.seed < FRESH_MIN_SEED));
  const refused = opts.refuse ? worlds.filter((x) => opts.refuse!(x.seed) !== null) : [];
  report.push(`world seeds below ${FRESH_MIN_SEED}: ${worlds.length - tooHigh.length} of ${worlds.length}; refused by run.ts's gates: ${refused.length}`);
  if (tooHigh.length) problems.push(`world seeds not below ${FRESH_MIN_SEED}: ${tooHigh.map((x) => x.seed).join(",")}`);
  if (refused.length) problems.push(`run.ts would refuse: ${refused.map((x) => x.seed).join(",")}`);
  // Reconcile the bootstrap's own log against the table.
  if (opts.bootLogSeeds) {
    const known = new Set(seeds.map((x) => x.seed));
    const stray = [...new Set(opts.bootLogSeeds)].filter((s) => !known.has(s));
    report.push(`bootstrap run-log: ${new Set(opts.bootLogSeeds).size} distinct world seeds logged, ${stray.length} not in the table`);
    if (stray.length) problems.push(`bootstrap run-log holds seeds that are not table rows: ${stray.join(",")}`);
  }
  report.push(`images: ${HEREDITIES.map((h) => `${h} ${rows[0].slot + HEREDITY_OFFSET[h]}-${rows[rows.length - 1].slot + HEREDITY_OFFSET[h]}`).join(", ")}`);
  return { problems, report };
}

/** The first base in the candidate list whose whole table audits clean; null when none does. */
export function proposeBase(candidates: readonly number[], registered: readonly RegisteredSet[], opts: AuditOptions = {}): { base: number | null; tried: { base: number; problems: number }[] } {
  const tried: { base: number; problems: number }[] = [];
  for (const base of candidates) {
    const r = auditTable(base, registered, { ...opts, bootLogSeeds: undefined });
    tried.push({ base, problems: r.problems.length });
    if (r.problems.length === 0) return { base, tried };
  }
  return { base: null, tried };
}
