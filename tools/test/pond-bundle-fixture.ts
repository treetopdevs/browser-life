// Pond-cycle run bundles for the lineage tests (tools/test/pond-descent.test.ts, tools/test/lineage.test.ts,
// tools/test/report-html/lineage.test.ts). Not a test file itself.
//   handPondBundle  a synthetic in-memory bundle on the ponds-small physics (seed 1, pondPeriod 100, census
//                   every 50) with a real initHash, so founders rebuild from the initial world, and crafted
//                   mutations, lineages, series, ponds, births and picks tables.
//   cpuPondBundle   a real RefSim history: ponds-small physics with pondPeriod 10, arm scaf, k 8, a raised
//                   mutation rate and 30 steps (3 cycles), census every 5, the cycle applied as the runner
//                   applies it (census first, then applyPondCycle on the pre-cycle state).
import { CH, G, POND_COLUMNS, PRESETS, applyPondCycle, cellCount, defaultConfig, initWorld, pondMatter, stateHash, worldW, type InitParams, type PondRow, type WorldConfig } from "@bl/schema";
import { RefSim, type MutationEvent } from "@bl/sim-ref";
import { genomesOf, wordsHex, type BundleSource } from "../lib/lineage.ts";
import { MUT_HEADER, rows } from "./lineage-fixture.ts";

const PRESET = PRESETS.find((p) => p.id === "ponds-small")!;
export const HAND_PERIOD = 100;
export const HAND_CENSUS = 50;

export type HandArm = "scaf" | "rand" | "breed" | "cont" | "nat" | "shuf";

/** The ponds-small config (2 x 2 ponds of 64 x 64) at seed 1 with the given arm and period. */
export function handCfg(arm: HandArm = "scaf", period = HAND_PERIOD): WorldConfig {
  const extra: Partial<WorldConfig> = arm === "nat" || arm === "shuf" ? { pondDeath: 32_768, pondExport: 28 } : arm === "breed" ? { pondScore: "mass" } : {};
  return defaultConfig({ ...PRESET.cfg, seed: 1, pondPeriod: period, pondArm: arm, ...extra });
}

/** A lineage key minted at `hi` (it first exists in the state at step `hi`) in a cell of `tile`; `off` picks another cell. */
export function key(hi: number, tile: number, off = 0): string {
  const x = (tile % 2) * 64 + 5 + off, y = Math.floor(tile / 2) * 64 + 5;
  return `${hi}:${y * 128 + x}`;
}
/** Founder of pond p in ponds-small (the initial world puts founder id p + 1 in tile p). */
export const founder = (p: number): string => `0:${p + 1}`;

/** One recipient's packet: lineage count and dominant (null: an empty packet). */
export interface Packet {
  lineages: number;
  dom: string | null;
  share?: number;
}
export interface HandCycle {
  /** Donor per recipient (-1 none, -2 survivor in nat/shuf). */
  donors: number[];
  /** Packet per recipient; default: 1 lineage, dominant `${1000 c + r}:7`. */
  packets?: (Packet | undefined)[];
  traits?: number[];
}

/** A ponds.tsv (header first) from per-cycle donors and packets, cycles numbered from `first`. */
export function pondsLines(cycles: HandCycle[], opts: { period?: number; first?: number; died?: boolean } = {}): string[] {
  const period = opts.period ?? HAND_PERIOD, first = opts.first ?? 1;
  const cols = [...POND_COLUMNS, ...(opts.died ? ["died", "exportMass", "weight"] : [])];
  const lines = [cols.join("\t")];
  cycles.forEach((cy, i) => {
    const c = first + i;
    cy.donors.forEach((d, r) => {
      const p = d >= 0 ? (cy.packets?.[r] ?? { lineages: 1, dom: `${1000 * c + r}:7` }) : { lineages: 0, dom: null };
      const [hi, lo] = p.dom ? p.dom.split(":").map(Number) : [0, 0];
      const trait = cy.traits?.[r] ?? 100 + r;
      const v: Record<string, string | number> = {
        cycle: c, step: c * period, recipient: r, donor: d, cx: d >= 0 ? 30 : -1, cy: d >= 0 ? 30 : -1, landed: d >= 0 ? 64 : 0,
        reqMass: d >= 0 ? 500 : 0, retMass: d >= 0 ? 500 : 0, reqE: 0, retE: 0, truncated: 0,
        packetLineages: p.lineages, domHi: hi, domLo: lo, domShare: p.dom ? (p.share ?? 0.5) : 0,
        donorTrait: d >= 0 ? (cy.traits?.[d] ?? 100 + d) : 0, recipientTrait: trait, recipientIndividuals: -1, recipientLineages: 1, heat: 0, light: 0,
        died: d === -2 ? 0 : 1, exportMass: 0, weight: 0,
      };
      lines.push(cols.map((k) => String(v[k])).join("\t"));
    });
  });
  return lines;
}

export interface HandSpec {
  arm?: HandArm;
  /** child, parent */
  mutations: [string, string][];
  /** ponds.tsv lines, or null for a bundle without the file. */
  ponds: string[] | null;
  /** Living lineages per census step; every census 50..steps gets a series line. */
  census: Record<number, [string, number][]>;
  steps: number;
  /** series.jsonl steps flagged afterCycle; default: every boundary + 50 (as the runner flags them, cont included). */
  afterCycle?: number[];
  series?: boolean;
  births?: string[];
  picks?: string[];
  startStep?: number;
  picked?: boolean;
}

/** A synthetic pond-cycle bundle as a `BundleSource`. */
export function handPondBundle(spec: HandSpec): BundleSource & { cfg: WorldConfig; files: Record<string, string[]> } {
  const cfg = handCfg(spec.arm ?? "scaf");
  const init = PRESET.init as InitParams;
  const initHash = stateHash(initWorld(cfg, init));
  const censusSteps: number[] = [];
  for (let s = HAND_CENSUS; s <= spec.steps; s += HAND_CENSUS) censusSteps.push(s);
  const after = new Set(spec.afterCycle ?? censusSteps.filter((s) => s - HAND_CENSUS > 0 && (s - HAND_CENSUS) % HAND_PERIOD === 0));
  const lineages = ["step\tlineage\tcells"];
  for (const s of censusSteps) for (const [k, c] of spec.census[s] ?? []) lineages.push(`${s}\t${k}\t${c}`);
  const series = censusSteps.map((s) => JSON.stringify({ step: s, lineages: (spec.census[s] ?? []).length, ...(after.has(s) ? { afterCycle: true } : {}) }));
  const files: Record<string, string[]> = {
    "lineages.tsv": lineages,
    "mutations.tsv": [MUT_HEADER, ...spec.mutations.map(([c, p]) => `${c.replace(":", "\t")}\t${p.replace(":", "\t")}`)],
  };
  if (spec.series !== false) files["series.jsonl"] = series;
  if (spec.ponds) files["ponds.tsv"] = spec.ponds;
  if (spec.births) files["births.tsv"] = spec.births;
  if (spec.picks) files["picks.jsonl"] = spec.picks;
  const last = spec.census[spec.steps] ?? [];
  const manifest = {
    runId: "hand/pond",
    ruleVersion: cfg.ruleVersion,
    cfg,
    spec: { presetId: "ponds-small", condition: spec.arm === "cont" ? "pond-cont" : "treatment", censusEvery: HAND_CENSUS, deepEvery: 1, steps: spec.steps },
    init,
    initHash,
    startStep: spec.startStep ?? 0,
    ...(spec.picked ? { picks: { file: "picks.jsonl", picker: "random" } } : {}),
    summary: { mutations: new Set(spec.mutations.map((m) => m[0])).size, finalHash: "x", steps: spec.steps, finalLineages: last.length },
  };
  return { dir: "hand", manifest, cfg, files, open: (f) => (files[f] ? rows(files[f]) : null) };
}

/** A births.tsv with one row per [step, kind, parentLineage, childLineage]. */
export function birthsLines(rs: [number, string, string, string][]): string[] {
  const head = "step\tkind\tparent\tchild\tchildGeneration\tparentLineage\tchildLineage\tparentMass\tparentBiomass\tparentCells\tparentPurity\tchildMass\tchildBiomass\tchildCells\tchildPurity";
  return [head, ...rs.map(([s, k, p, c]) => `${s}\t${k}\t1\t2\t1\t${p}\t${c}\t10\t10\t3\t1\t5\t5\t2\t1`)];
}

// ---- a real CPU history ------------------------------------------------------------------------------

export const CPU_PERIOD = 10;
export const CPU_CENSUS = 5;
export const CPU_STEPS = 30;

/** A 30-step ponds-small history on the CPU reference with the pond cycle applied as the runner applies it. */
export function cpuPondBundle() {
  const cfg = defaultConfig({ ...PRESET.cfg, seed: 7, pondPeriod: CPU_PERIOD, pondArm: "scaf", pondK: 8, mutRate: 429_497 * 400 });
  const init = PRESET.init as InitParams;
  const s0 = initWorld(cfg, init);
  const initHash = stateHash(s0);
  const Mr = pondMatter(s0);
  let sim = new RefSim(s0);
  const n = cellCount(cfg), W = worldW(cfg);
  const events: MutationEvent[] = [];
  const lineages = ["step\tlineage\tcells"];
  const genomes = ["lineage\tfirstStep\twords"];
  const series: string[] = [];
  const ponds = [POND_COLUMNS.join("\t")];
  const seen = new Set<string>();
  /** Per census: the tiles each lineage occupies, and cells holding an id with B+P = 0. */
  const tilesAt = new Map<number, Map<string, Set<number>>>();
  const idWithoutMass: number[] = [];
  let afterCycle = false;
  for (let t = 1; t <= CPU_STEPS; t++) {
    for (const e of sim.step().events) events.push(e);
    if (t % CPU_CENSUS) continue;
    const st = sim.state;
    const count = new Map<string, number>();
    const tiles = new Map<string, Set<number>>();
    let orphan = 0;
    for (let i = 0; i < n; i++) {
      const hi = st.genome[G.LIN_HI * n + i], lo = st.genome[G.LIN_LO * n + i];
      if (!(hi | lo)) continue;
      const k = `${hi}:${lo}`;
      count.set(k, (count.get(k) ?? 0) + 1);
      const tile = Math.floor(Math.floor(i / W) / cfg.tileH) * cfg.tilesX + Math.floor((i % W) / cfg.tileW);
      (tiles.get(k) ?? tiles.set(k, new Set()).get(k)!).add(tile);
    }
    for (let i = 0; i < n; i++) {
      const hasId = (st.genome[G.LIN_HI * n + i] | st.genome[G.LIN_LO * n + i]) !== 0;
      if (hasId && st.cells[CH.B * n + i] + st.cells[CH.P * n + i] === 0) orphan++;
    }
    idWithoutMass.push(orphan);
    tilesAt.set(t, tiles);
    for (const [k, c] of count) lineages.push(`${t}\t${k}\t${c}`);
    for (const [k, w] of genomesOf(st, cfg)) {
      if (seen.has(k)) continue;
      seen.add(k);
      genomes.push(`${k}\t${t}\t${wordsHex(w)}`);
    }
    series.push(JSON.stringify({ step: t, lineages: count.size, ...(afterCycle ? { afterCycle: true } : {}) }));
    afterCycle = false;
    if (t % CPU_PERIOD === 0) {
      const cycle = applyPondCycle(st, t / CPU_PERIOD, "scaf", cfg.pondK!, Mr);
      for (const r of cycle.rows) ponds.push(POND_COLUMNS.map((c) => String((r as PondRow)[c])).join("\t"));
      sim = new RefSim(cycle.state);
      afterCycle = true;
    }
  }
  const mutations = [MUT_HEADER, ...events.map((e) => `${e.childHi}\t${e.childLo}\t${e.parentHi}\t${e.parentLo}`)];
  const lastCount = lineages.filter((l) => l.startsWith(`${CPU_STEPS}\t`)).length;
  const manifest = {
    runId: "cpu/pond",
    ruleVersion: cfg.ruleVersion,
    cfg,
    spec: { presetId: "ponds-small", condition: "treatment", censusEvery: CPU_CENSUS, deepEvery: 1, steps: CPU_STEPS },
    init,
    initHash,
    startStep: 0,
    summary: { mutations: events.length, finalHash: "x", steps: CPU_STEPS, finalLineages: lastCount },
  };
  const files: Record<string, string[]> = { "lineages.tsv": lineages, "mutations.tsv": mutations, "genomes.tsv": genomes, "series.jsonl": series, "ponds.tsv": ponds };
  const source = (over: Partial<Record<string, string[] | null>> = {}): BundleSource => ({
    dir: "cpu-pond",
    manifest,
    open: (f) => {
      const ls = f in over ? over[f] : files[f];
      return ls ? rows(ls) : null;
    },
  });
  return { cfg, events, files, manifest, source, tilesAt, idWithoutMass, initial: genomesOf(s0, cfg) };
}

let shared: ReturnType<typeof cpuPondBundle> | undefined;
/** One `cpuPondBundle()` per test process. */
export const cpuPond = (): ReturnType<typeof cpuPondBundle> => (shared ??= cpuPondBundle());
