// Second-level individuality (M7). Individuals within `linkDist` of each
// other (on their tile's torus) form collectives. Collectives are tracked by
// shared members (or members' parents), so a collective that splits into two
// that each keep growing is a *collective fission*. Composition (lineage mix)
// is recorded at every fission, so collective-level heredity can be measured:
// do offspring collectives resemble their parent collective more than random
// collectives do? That plus bottlenecked propagules is the operational
// signature of a candidate major transition. Nothing is declared by the
// simulator; this is measurement only.

import type { Individual } from "./tracker.ts";

export interface CollectiveOptions {
  /** Max centroid distance (cells) for two individuals to be linked. */
  linkDist: number;
  /** Min members for a group to count as a collective. */
  minMembers: number;
  tileW: number;
  tileH: number;
}

export const DEFAULT_COLLECTIVES: Omit<CollectiveOptions, "tileW" | "tileH"> = { linkDist: 10, minMembers: 3 };

export interface Collective {
  id: number;
  parent: number | null;
  born: number;
  died: number | null;
  members: Set<number>;
  /** Lineage key -> member count at the latest observation. */
  composition: Map<string, number>;
  /** Members at birth (propagule size for fission-born collectives). */
  foundingSize: number;
  maxSize: number;
  generation: number;
  tile: number;
}

export type CollectiveEvent =
  | { step: number; kind: "fission"; parent: number; children: number[]; propagules: number[]; similarity: number[] }
  | { step: number; kind: "birth"; id: number }
  | { step: number; kind: "death"; id: number };

/** Cosine similarity of two composition vectors. */
export function compositionSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0, na = 0, nb = 0;
  for (const [k, v] of a) {
    na += v * v;
    dot += v * (b.get(k) ?? 0);
  }
  for (const v of b.values()) nb += v * v;
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

export class CollectiveTracker {
  readonly alive = new Map<number, Collective>();
  readonly dead: Collective[] = [];
  readonly events: CollectiveEvent[] = [];
  /**
   * Matched pairs per offspring collective: similarity to its parent and to a
   * random established collective (null model). Only offspring with an
   * eligible null partner are recorded, so the samples stay paired.
   */
  readonly pairs: { offspring: number; random: number }[] = [];
  private nextId = 1;
  /** individual id -> collective id at the previous update */
  private memberOf = new Map<number, number>();
  private rng = 0x2545f491;

  constructor(readonly opt: CollectiveOptions) {}

  private rand(): number {
    this.rng ^= this.rng << 13;
    this.rng ^= this.rng >>> 17;
    this.rng ^= this.rng << 5;
    return (this.rng >>> 0) / 2 ** 32;
  }

  /** Groups living individuals into linked components (grid-bucketed, tile torus). */
  group(inds: Individual[]): Individual[][] {
    const { linkDist: d, tileW, tileH } = this.opt;
    const nx = Math.max(1, Math.floor(tileW / d));
    const ny = Math.max(1, Math.floor(tileH / d));
    // Tile-local bucket coordinates; buckets are at least d wide, so linked
    // pairs are always in the same or an adjacent (wrapped) bucket.
    const bx = (ind: Individual) => Math.min(nx - 1, Math.floor((ind.cx % tileW) / (tileW / nx)));
    const by = (ind: Individual) => Math.min(ny - 1, Math.floor((ind.cy % tileH) / (tileH / ny)));
    const buckets = new Map<string, number[]>();
    inds.forEach((ind, k) => {
      const key = `${ind.tile}:${bx(ind)}:${by(ind)}`;
      const arr = buckets.get(key) ?? [];
      arr.push(k);
      buckets.set(key, arr);
    });
    const parent = inds.map((_, k) => k);
    const find = (k: number): number => (parent[k] === k ? k : (parent[k] = find(parent[k])));
    inds.forEach((a, k) => {
      const x0 = bx(a), y0 = by(a);
      const seen = new Set<string>();
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const key = `${a.tile}:${(((x0 + dx) % nx) + nx) % nx}:${(((y0 + dy) % ny) + ny) % ny}`;
          if (seen.has(key)) continue;
          seen.add(key);
          for (const j of buckets.get(key) ?? []) {
            if (j <= k) continue;
            const b = inds[j];
            const ddx = Math.abs(a.cx - b.cx), ddy = Math.abs(a.cy - b.cy);
            const wx = Math.min(ddx, tileW - ddx), wy = Math.min(ddy, tileH - ddy);
            if (wx * wx + wy * wy <= d * d) parent[find(j)] = find(k);
          }
        }
    });
    const groups = new Map<number, Individual[]>();
    inds.forEach((ind, k) => {
      const r = find(k);
      const arr = groups.get(r) ?? [];
      arr.push(ind);
      groups.set(r, arr);
    });
    return [...groups.values()].filter((g) => g.length >= this.opt.minMembers);
  }

  update(step: number, individuals: Iterable<Individual>): CollectiveEvent[] {
    const inds = [...individuals];
    const groups = this.group(inds);
    const events: CollectiveEvent[] = [];
    // Predecessor votes: a member (or its parent) that belonged to collective c.
    const votes = groups.map((g) => {
      const v = new Map<number, number>();
      for (const ind of g) {
        const prev = this.memberOf.get(ind.id) ?? (ind.parent !== null ? this.memberOf.get(ind.parent) : undefined);
        if (prev !== undefined) v.set(prev, (v.get(prev) ?? 0) + 1);
      }
      return v;
    });
    const mainParent = votes.map((v) => {
      let best: number | undefined, n = 0;
      for (const [c, k] of v) if (k > n) [best, n] = [c, k];
      return best;
    });
    const children = new Map<number, number[]>();
    mainParent.forEach((p, gi) => {
      if (p === undefined) return;
      const arr = children.get(p) ?? [];
      arr.push(gi);
      children.set(p, arr);
    });
    const assigned = new Array<number>(groups.length);
    const composition = (g: Individual[]) => {
      const m = new Map<string, number>();
      for (const ind of g) m.set(ind.lineage, (m.get(ind.lineage) ?? 0) + 1);
      return m;
    };
    for (const [p, kids] of children) {
      const parent = this.alive.get(p);
      if (!parent) continue;
      kids.sort((a, b) => (votes[b].get(p) ?? 0) - (votes[a].get(p) ?? 0));
      const parentComp = parent.composition;
      assigned[kids[0]] = p;
      if (kids.length > 1) {
        const newIds: number[] = [];
        const sims: number[] = [];
        const props: number[] = [];
        for (const gi of kids.slice(1)) {
          const id = this.spawn(groups[gi], p, step, parent.generation + 1);
          assigned[gi] = id;
          newIds.push(id);
          props.push(groups[gi].length);
          const comp = composition(groups[gi]);
          const sim = compositionSimilarity(parentComp, comp);
          sims.push(sim);
          // Null model: established collectives only (not ones born in this update).
          const others = [...this.alive.values()].filter((c) => c.id !== p && c.born < step && c.composition.size > 0);
          if (others.length) this.pairs.push({ offspring: sim, random: compositionSimilarity(others[Math.floor(this.rand() * others.length)].composition, comp) });
        }
        events.push({ step, kind: "fission", parent: p, children: newIds, propagules: props, similarity: sims });
      }
    }
    groups.forEach((g, gi) => {
      if (assigned[gi] === undefined) {
        assigned[gi] = this.spawn(g, null, step, 0);
        events.push({ step, kind: "birth", id: assigned[gi] });
      }
      const c = this.alive.get(assigned[gi])!;
      c.members = new Set(g.map((i) => i.id));
      c.composition = composition(g);
      c.maxSize = Math.max(c.maxSize, g.length);
    });
    const live = new Set(assigned);
    for (const [id, c] of this.alive) {
      if (live.has(id)) continue;
      c.died = step;
      this.alive.delete(id);
      this.dead.push(c);
      events.push({ step, kind: "death", id });
    }
    if (this.dead.length > 20_000) this.dead.splice(0, this.dead.length - 20_000);
    this.memberOf = new Map();
    groups.forEach((g, gi) => g.forEach((ind) => this.memberOf.set(ind.id, assigned[gi])));
    for (const e of events) this.events.push(e);
    return events;
  }

  private spawn(g: Individual[], parent: number | null, step: number, generation: number): number {
    const id = this.nextId++;
    this.alive.set(id, {
      id,
      parent,
      born: step,
      died: null,
      members: new Set(g.map((i) => i.id)),
      composition: new Map(),
      foundingSize: g.length,
      maxSize: g.length,
      generation,
      tile: g[0].tile,
    });
    return id;
  }

  /**
   * Summary of collective-level reproduction and heredity. A positive
   * `heritability` means offspring collectives resemble their parent more
   * than they resemble a random living collective.
   */
  summary(): {
    alive: number;
    fissions: number;
    maxGeneration: number;
    meanPropagule: number;
    offspringSimilarity: number;
    randomSimilarity: number;
    heritability: number;
    pairs: number;
  } {
    const fis = this.events.filter((e) => e.kind === "fission") as Extract<CollectiveEvent, { kind: "fission" }>[];
    const props = fis.flatMap((e) => e.propagules);
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
    const os = mean(this.pairs.map((p) => p.offspring)), rs = mean(this.pairs.map((p) => p.random));
    let gen = 0;
    for (const c of this.alive.values()) gen = Math.max(gen, c.generation);
    return {
      alive: this.alive.size,
      fissions: fis.length,
      maxGeneration: gen,
      meanPropagule: mean(props),
      offspringSimilarity: os,
      randomSimilarity: rs,
      // Mean of matched differences (equals os - rs because the samples are paired).
      heritability: mean(this.pairs.map((p) => p.offspring - p.random)),
      pairs: this.pairs.length,
    };
  }
}
