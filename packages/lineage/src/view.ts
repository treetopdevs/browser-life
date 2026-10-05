// One lineage as the lab sees it (docs/lineage-inspector.md, section 6, build step 4): its ancestry from the
// mutation edges the lab kept, each ancestor's genome replayed forward from the earliest one known exactly,
// and every replayed genome that a known source also holds checked against it. Where the world came from a
// file, the edges and genomes before that point are unknown, and the view says so instead of guessing.
import { G, type WorldConfig } from "@bl/schema";
import type { MutationEdges } from "./edges.ts";
import {
  applyMutation,
  decodeKey,
  expressionOf,
  mutationSite,
  parseKey,
  probeGenome,
  wordsHex,
  type Expression,
  type Key,
  type LocusKind,
  type Probe,
} from "./genotype.ts";

/** A set of genomes known exactly, and where they come from ("start world", "restored state", "live world"). */
export interface GenomeSource {
  source: string;
  genomes: ReadonlyMap<Key, Uint32Array>;
}

export interface LineageViewInput {
  subject: Key;
  cfg: WorldConfig;
  edges: MutationEdges;
  /** In order of preference; the first source holding a key supplies it, and every other one checks it. */
  known: readonly GenomeSource[];
  /** Living cells per lineage at a census. */
  census: { step: number; rows: readonly (readonly [Key, number])[] } | null;
  /** The step from which the edges are complete: 0 for a world started here, the import step otherwise. */
  edgesFrom: number;
  /** Mutation events the ledger dropped (its buffer overflowed); the edges miss that many. */
  dropped: number;
}

export interface LineageViewNode {
  key: Key;
  /** Minting step, null for a founder. */
  minted: number | null;
  parent: Key | null;
  /** How the genome is known: a source's name, "replayed" from the earlier ancestors, or null when unknown. */
  genomeFrom: string | null;
  /** Known sources that also hold this genome and agree with it. */
  checkedBy: string[];
  mu: number | null;
  sigma: number | null;
  motGain: number | null;
  probe: Omit<Probe, "outs"> | null;
  /** Living cells at the census, and children minted from it. */
  cells: number;
  children: number;
}

export interface LineageViewMutation {
  child: Key;
  parent: Key;
  step: number;
  cell: number;
  slot: number;
  kind: LocusKind;
  locus: string;
  /** Null when the parent's genome is unknown. */
  before: number | null;
  after: number | null;
  expression: Expression | null;
  maxDelta: number[] | null;
  changedShare: number[] | null;
}

export interface LineageView {
  subject: Key;
  origin: ReturnType<typeof decodeKey>;
  censusStep: number | null;
  cells: number;
  share: number;
  /** Root first, subject last. */
  chain: LineageViewNode[];
  mutations: LineageViewMutation[];
  descendants: number;
  cladeCells: number;
  gaps: string[];
}

const valueOf = (w: Uint32Array, kind: "mu" | "sigma" | "gain"): number => (kind === "mu" ? w[G.PARAM0] & 0xffff : kind === "sigma" ? w[G.PARAM0] >>> 16 : w[G.PARAM1] & 0xff);

/** A view whose controller probes are still to be run, and the genome of each chain node (null when unknown). */
export interface LineageAncestry {
  view: LineageView;
  words: (Uint32Array | null)[];
}

/**
 * The ancestry, genomes, counts and gaps of one lineage; probes and expression classes are left null for
 * `probeLineage`, which is the slow part. Throws when a replayed genome disagrees with a known one: the
 * replay would be wrong for this world, so nothing is reported.
 */
export function lineageAncestry(input: LineageViewInput): LineageAncestry {
  const { subject, cfg, edges, known } = input;
  parseKey(subject);
  const chain: Key[] = [subject];
  for (let p = edges.parentOf(subject); p !== undefined; p = edges.parentOf(p)) chain.push(p);
  chain.reverse();

  const words: (Uint32Array | null)[] = [];
  const from: (string | null)[] = [];
  const checked: string[][] = [];
  const mutations: LineageViewMutation[] = [];
  chain.forEach((key, i) => {
    let w: Uint32Array | null = null, src: string | null = null;
    if (i > 0 && words[i - 1]) {
      const r = applyMutation(words[i - 1]!, key, chain[i - 1], cfg);
      w = r.words;
      src = "replayed";
      mutations.push({ ...r.mutation, expression: null, maxDelta: null, changedShare: null });
    } else {
      if (i > 0) {
        const s = mutationSite(key, cfg);
        mutations.push({ child: key, parent: chain[i - 1], step: s.step, cell: s.cell, slot: s.slot, kind: s.kind, locus: s.locus, before: null, after: null, expression: null, maxDelta: null, changedShare: null });
      }
      const k = known.find((s) => s.genomes.has(key));
      if (k) {
        w = k.genomes.get(key)!;
        src = k.source;
      }
    }
    const agree: string[] = [];
    if (w) {
      const hex = wordsHex(w);
      for (const s of known) {
        if (s.source === src) continue;
        const g = s.genomes.get(key);
        if (!g) continue;
        if (wordsHex(g) !== hex) throw new Error(`the ${src} genome of ${key} differs from the ${s.source}'s: replay is wrong for this world, so no lineage is reported`);
        agree.push(s.source);
      }
    }
    words.push(w);
    from.push(src);
    checked.push(agree);
  });

  const cellsOf = new Map(input.census?.rows ?? []);
  const children = edges.childCounts(chain);
  const desc = edges.descendants(subject);
  let living = 0, cladeCells = 0;
  for (const [k, c] of input.census?.rows ?? []) {
    living += c;
    if (k === subject || desc.has(k)) cladeCells += c;
  }
  const nodes: LineageViewNode[] = chain.map((key, i) => {
    const w = words[i];
    const hi = parseKey(key)[0];
    return {
      key,
      minted: hi === 0 ? null : hi - 1,
      parent: i === 0 ? null : chain[i - 1],
      genomeFrom: from[i],
      checkedBy: checked[i],
      mu: w ? valueOf(w, "mu") : null,
      sigma: w ? valueOf(w, "sigma") : null,
      motGain: w ? valueOf(w, "gain") : null,
      probe: null,
      cells: cellsOf.get(key) ?? 0,
      children: children.get(key) ?? 0,
    };
  });

  const gaps: string[] = [];
  if (input.edgesFrom > 0)
    gaps.push(`mutation edges are recorded from step ${input.edgesFrom}, where this world was loaded from a file: children and descendants minted before then are not counted`);
  const rootHi = parseKey(chain[0])[0];
  if (rootHi !== 0) {
    gaps.push(
      rootHi - 1 < input.edgesFrom
        ? `ancestry before ${chain[0]} (minted at step ${rootHi - 1}) was not observed: this world's mutation edges start at step ${input.edgesFrom}, where it was loaded from a file`
        : `${chain[0]} has no recorded parent although it was minted after step ${input.edgesFrom}; the mutation edges are incomplete`,
    );
  }
  if (input.dropped > 0) gaps.push(`${input.dropped} mutation events were dropped when the event buffer overflowed; ancestry and descendants may be cut short`);
  const unknown = nodes.filter((n) => n.genomeFrom === null).length;
  if (unknown) gaps.push(`${unknown} ancestor genome(s) are unknown: no earlier ancestor's genome is known exactly, so they cannot be replayed`);

  const view: LineageView = {
    subject,
    origin: decodeKey(subject, cfg),
    censusStep: input.census?.step ?? null,
    cells: cellsOf.get(subject) ?? 0,
    share: living ? (cellsOf.get(subject) ?? 0) / living : 0,
    chain: nodes,
    mutations,
    descendants: desc.size,
    cladeCells,
    gaps,
  };
  return { view, words };
}

/** Probes chain node `i` (its genome, if known) and classifies the mutation that minted it against `prev`. */
function probeNode(a: LineageAncestry, i: number, prev: Probe | null): Probe | null {
  const w = a.words[i];
  const p = w ? probeGenome(w) : null;
  if (i > 0 && p && prev) {
    const m = a.view.mutations[i - 1];
    if (m.before !== null) Object.assign(m, expressionOf({ ...m, before: m.before, after: m.after!, clamped: m.before === m.after }, prev, p));
  }
  if (p) {
    const { outs: _outs, ...summary } = p;
    a.view.chain[i].probe = summary;
  }
  return p;
}

/**
 * Fills in the probes and expression classes of `a.view`, a few chain nodes at a time, yielding between
 * batches so the caller's thread keeps serving (each probe is ~78,000 controller evaluations). Returns false,
 * leaving the view partly probed, once `cancelled` says the result is no longer wanted.
 */
export async function probeLineage(a: LineageAncestry, opts: { batch?: number; cancelled?: () => boolean } = {}): Promise<boolean> {
  const batch = opts.batch ?? 4;
  let prev: Probe | null = null;
  for (let i = 0; i < a.words.length; i++) {
    if (i > 0 && i % batch === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (opts.cancelled?.()) return false;
    }
    prev = probeNode(a, i, prev);
  }
  return true;
}

/** The whole view at once (`lineageAncestry`, then every probe); for callers that can block. */
export function lineageView(input: LineageViewInput): LineageView {
  const a = lineageAncestry(input);
  let prev: Probe | null = null;
  for (let i = 0; i < a.words.length; i++) prev = probeNode(a, i, prev);
  return a.view;
}
