// Tracks individuals across censuses by cell overlap and infers life events.
// A fission is one individual whose cells become two or more individuals,
// each above the size threshold: reproduction detected, never declared.

import { DEFAULT_CENSUS, type Census, type CensusOptions, type Component } from "./census.ts";

export type LifeEvent =
  | { step: number; kind: "birth"; id: number }
  | { step: number; kind: "death"; id: number }
  | { step: number; kind: "fission"; parent: number; children: number[] }
  | { step: number; kind: "fusion"; parents: number[]; child: number };

export interface Individual {
  id: number;
  parent: number | null;
  born: number;
  died: number | null;
  /** Traits at the latest observation. */
  mass: number;
  mu: number;
  sigma: number;
  lineage: string;
  cx: number;
  cy: number;
  /** Independent world (tile) the individual lives in. */
  tile: number;
  generation: number;
  /** Traits recorded when the individual was born by fission (for heredity analysis). */
  birthTraits?: { mu: number; sigma: number; mass: number };
}

export interface TrackerState {
  opt: CensusOptions;
  prevLabels: string | null;
  prevIds: [number, number][];
  nextId: number;
  alive: Individual[];
  fissions: number;
  fusions: number;
  counts: Record<LifeEvent["kind"], number>;
}

function validIndividual(a: unknown): a is Individual {
  if (!a || typeof a !== "object") return false;
  const x = a as Record<string, unknown>;
  const int = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  const traits = (t: unknown) => t === undefined || (!!t && typeof t === "object" && ["mu", "sigma", "mass"].every((k) => num((t as Record<string, unknown>)[k])));
  return (
    int(x.id) && (x.parent === null || int(x.parent)) && int(x.born) && x.died === null && int(x.generation) && int(x.tile) &&
    ["mass", "mu", "sigma", "cx", "cy"].every((k) => num(x[k])) && typeof x.lineage === "string" && traits(x.birthTraits)
  );
}

export function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class Tracker {
  readonly opt: CensusOptions;
  private prevLabels: Int32Array | null = null;
  /** prev component idx -> individual id */
  private prevIds = new Map<number, number>();
  private nextId = 1;
  readonly alive = new Map<number, Individual>();
  readonly history: LifeEvent[] = [];
  /** Completed (dead) individuals, kept for life-history statistics. */
  readonly dead: Individual[] = [];
  fissions = 0;
  fusions = 0;

  constructor(opt: CensusOptions = DEFAULT_CENSUS) {
    this.opt = opt;
  }

  update(c: Census): LifeEvent[] {
    const events: LifeEvent[] = [];
    const indiv = (k: Component) => k.mass >= this.opt.minMass;
    const cur = c.components;
    const curIds = new Map<number, number>();

    if (!this.prevLabels) {
      for (const k of cur) if (indiv(k)) curIds.set(k.idx, this.spawn(k, null, c.step, 0));
    } else {
      // overlap[p][c]
      const overlap = new Map<number, Map<number, number>>();
      const prev = this.prevLabels;
      const L = c.labels;
      for (let i = 0; i < L.length; i++) {
        const p = prev[i];
        const q = L[i];
        if (p < 0 || q < 0 || !this.prevIds.has(p) || !indiv(cur[q])) continue;
        let m = overlap.get(p);
        if (!m) overlap.set(p, (m = new Map()));
        m.set(q, (m.get(q) ?? 0) + 1);
      }
      // Main parent of each current component.
      const mainParent = new Map<number, number>();
      const parentsOf = new Map<number, number[]>();
      for (const [p, m] of overlap) {
        for (const [q, n] of m) {
          const best = mainParent.get(q);
          if (best === undefined || n > (overlap.get(best)!.get(q) ?? 0)) mainParent.set(q, p);
          const arr = parentsOf.get(q) ?? [];
          arr.push(p);
          parentsOf.set(q, arr);
        }
      }
      const children = new Map<number, number[]>();
      for (const [q, p] of mainParent) {
        const arr = children.get(p) ?? [];
        arr.push(q);
        children.set(p, arr);
      }
      const merged = new Set<number>();
      for (const [p, kids] of children) {
        const pid = this.prevIds.get(p)!;
        const ov = overlap.get(p)!;
        kids.sort((a, b) => (ov.get(b) ?? 0) - (ov.get(a) ?? 0));
        const parentInd = this.alive.get(pid)!;
        curIds.set(kids[0], pid);
        this.observe(parentInd, cur[kids[0]]);
        if (kids.length > 1) {
          const newIds: number[] = [];
          for (const q of kids.slice(1)) {
            const id = this.spawn(cur[q], pid, c.step, parentInd.generation + 1);
            curIds.set(q, id);
            newIds.push(id);
          }
          this.fissions++;
          events.push({ step: c.step, kind: "fission", parent: pid, children: newIds });
        }
      }
      // Fusions: a current component fed by several previous individuals.
      for (const [q, ps] of parentsOf) {
        if (ps.length < 2) continue;
        const main = mainParent.get(q)!;
        const absorbed = ps.filter((p) => p !== main && !children.has(p));
        if (!absorbed.length) continue;
        const ids = absorbed.map((p) => this.prevIds.get(p)!);
        for (const id of ids) {
          merged.add(id);
          this.kill(id, c.step);
        }
        this.fusions++;
        events.push({ step: c.step, kind: "fusion", parents: [this.prevIds.get(main)!, ...ids], child: curIds.get(q)! });
      }
      // Deaths: previous individuals with no continuation.
      for (const [p, pid] of this.prevIds) {
        if (children.has(p) || merged.has(pid)) continue;
        this.kill(pid, c.step);
        events.push({ step: c.step, kind: "death", id: pid });
      }
      // Births: individuals with no predecessor (condensation or fast motion).
      for (const k of cur) {
        if (!indiv(k) || curIds.has(k.idx)) continue;
        const id = this.spawn(k, null, c.step, 0);
        curIds.set(k.idx, id);
        events.push({ step: c.step, kind: "birth", id });
      }
    }
    this.prevLabels = c.labels;
    this.prevIds = curIds;
    for (const e of events) this.history.push(e);
    return events;
  }

  private spawn(k: Component, parent: number | null, step: number, generation: number): number {
    const id = this.nextId++;
    const ind: Individual = {
      id,
      parent,
      born: step,
      died: null,
      mass: k.mass,
      mu: k.mu,
      sigma: k.sigma,
      lineage: k.lineage,
      cx: k.cx,
      cy: k.cy,
      tile: k.tile,
      generation,
      birthTraits: parent !== null ? { mu: k.mu, sigma: k.sigma, mass: k.mass } : undefined,
    };
    this.alive.set(id, ind);
    return id;
  }

  private observe(ind: Individual, k: Component): void {
    ind.mass = k.mass;
    ind.mu = k.mu;
    ind.sigma = k.sigma;
    ind.lineage = k.lineage;
    ind.cx = k.cx;
    ind.cy = k.cy;
  }

  private kill(id: number, step: number): void {
    const ind = this.alive.get(id);
    if (!ind) return;
    ind.died = step;
    this.alive.delete(id);
    this.dead.push(ind);
    if (this.dead.length > 50_000) this.dead.splice(0, this.dead.length - 50_000);
  }

  /** Serialisable state, so a run split into segments observes like a continuous one. */
  toJSON(): TrackerState {
    return structuredClone({
      opt: this.opt,
      prevLabels: this.prevLabels ? b64(new Uint8Array(this.prevLabels.buffer, this.prevLabels.byteOffset, this.prevLabels.byteLength)) : null,
      prevIds: [...this.prevIds.entries()],
      nextId: this.nextId,
      alive: [...this.alive.values()],
      fissions: this.fissions,
      fusions: this.fusions,
      counts: this.eventCounts(),
    });
  }

  static fromJSON(saved: TrackerState): Tracker {
    const s = structuredClone(saved);
    const int = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
    const ok =
      s && typeof s === "object" && s.opt && int(s.opt.threshold) && int(s.opt.minMass) &&
      (s.prevLabels === null || typeof s.prevLabels === "string") &&
      Array.isArray(s.prevIds) && s.prevIds.every((p) => Array.isArray(p) && p.length === 2 && int(p[0]) && int(p[1])) &&
      int(s.nextId) && int(s.fissions) && int(s.fusions) &&
      Array.isArray(s.alive) && s.alive.every(validIndividual) && s.alive.every((a) => a.id < s.nextId) &&
      s.counts && (["birth", "death", "fission", "fusion"] as const).every((k) => int(s.counts[k]));
    if (!ok) throw new Error("malformed tracker state");
    // Referential integrity: unique individuals and labels, and every tracked
    // component refers to a distinct living individual.
    const ids = new Set(s.alive.map((a) => a.id));
    const refs = new Set(s.prevIds.map((p) => p[1]));
    if (ids.size !== s.alive.length || new Set(s.prevIds.map((p) => p[0])).size !== s.prevIds.length || refs.size !== s.prevIds.length || [...refs].some((id) => !ids.has(id)))
      throw new Error("tracker state references missing or duplicate individuals");
    if (s.prevLabels === null && s.prevIds.length) throw new Error("tracker state has component ids without labels");
    const t = new Tracker(s.opt);
    t.prevLabels = s.prevLabels ? new Int32Array(unb64(s.prevLabels).buffer) : null;
    t.prevIds = new Map(s.prevIds);
    t.nextId = s.nextId;
    for (const ind of s.alive) t.alive.set(ind.id, ind);
    t.fissions = s.fissions;
    t.fusions = s.fusions;
    t.carried = s.counts;
    return t;
  }

  /** Life-event counts including those carried over from earlier segments. */
  eventCounts(): Record<LifeEvent["kind"], number> {
    const c = { ...this.carried };
    for (const e of this.history) c[e.kind]++;
    return c;
  }

  private carried: Record<LifeEvent["kind"], number> = { birth: 0, death: 0, fission: 0, fusion: 0 };

  /** Number of cells labelled at the latest census (0 before the first). */
  labelCount(): number {
    return this.prevLabels?.length ?? 0;
  }

  /** Individual id at component idx for the latest census. */
  idOf(componentIdx: number): number | undefined {
    return this.prevIds.get(componentIdx);
  }

  maxGeneration(): number {
    let g = 0;
    for (const ind of this.alive.values()) g = Math.max(g, ind.generation);
    return g;
  }
}

/** Squared distance on the tile torus; Infinity across different tiles. */
export function tileDistance2(a: { cx: number; cy: number; tile: number }, b: { cx: number; cy: number; tile: number }, tileW: number, tileH: number): number {
  if (a.tile !== b.tile) return Infinity;
  const dx = Math.abs(a.cx - b.cx);
  const dy = Math.abs(a.cy - b.cy);
  const wx = Math.min(dx, tileW - dx);
  const wy = Math.min(dy, tileH - dy);
  return wx * wx + wy * wy;
}
