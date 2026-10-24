import { CH, cellCount, totalsOf, ledgerResidual, stateHash, validateState, type WorldState } from "@bl/schema";
import { Tracker, census, type Census } from "@bl/metrics";
import type { EvalEvidence, Evaluation } from "@bl/search";

export const OBSERVER_VERSION = "recovery-continuity-v1";
export interface Edge { from: number; to: number; cells: number }

/** Tracks the retained ID, never a substituted component or the sum of its daughters. */
export class RemnantTrack {
  private tracker = new Tracker({ threshold: 48, minMass: 128 });
  private previous: Census;
  private id: number | undefined;
  private label: number | undefined;
  private merged = false;
  private lost = false;
  private mass = 0;
  private initialLabel: number | null = null;
  readonly history: { step: number; mass: number; label: number | null; edges: Edge[]; split: boolean; merged: boolean; lost: boolean }[] = [];
  constructor(start: Census, label: number | undefined, readonly referenceMass: number) {
    this.previous = start;
    this.tracker.update(start);
    this.label = label;
    this.id = label === undefined ? undefined : this.tracker.idOf(label);
    this.lost = this.id === undefined;
    this.initialLabel = this.id === undefined ? null : label ?? null;
    this.mass = this.id === undefined ? 0 : this.tracker.alive.get(this.id)!.mass;
  }
  update(next: Census): void {
    const overlaps = new Map<string, Edge>();
    for (let i = 0; i < next.labels.length; i++) {
      const p = this.previous.labels[i], q = next.labels[i];
      if (p < 0 || q < 0 || this.previous.components[p].mass < 128 || next.components[q].mass < 128) continue;
      const key = `${p}:${q}`;
      const edge = overlaps.get(key) ?? { from: p, to: q, cells: 0 };
      edge.cells++; overlaps.set(key, edge);
    }
    const edges = [...overlaps.values()];
    const previousLabel = this.label;
    const events = this.tracker.update(next);
    const current = this.id === undefined ? undefined : this.tracker.alive.get(this.id);
    this.label = current ? next.components.find(c => this.tracker.idOf(c.idx) === this.id)?.idx : undefined;
    if (this.label === undefined) this.lost = true;
    if (this.label !== undefined && edges.some(e => e.to === this.label && e.from !== previousLabel)) this.merged = true;
    if (events.some(e => e.kind === "fusion" && this.id !== undefined && (e.child === this.id || e.parents.includes(this.id)))) this.merged = true;
    this.mass = current?.mass ?? 0;
    this.history.push({ step: next.step, mass: this.mass, label: this.label ?? null, edges,
      split: events.some(e => e.kind === "fission" && e.parent === this.id), merged: this.merged, lost: this.lost });
    this.previous = next;
  }
  result() {
    return { initialLabel: this.initialLabel, recovered: !this.lost && !this.merged && this.referenceMass > 0 && 10 * this.mass >= 9 * this.referenceMass,
      retained: !this.lost && this.referenceMass > 0 && 10 * this.mass >= 9 * this.referenceMass,
      merged: this.merged, lost: this.lost, mass: this.mass, history: this.history };
  }
}

function overlapLabel(c: Census, cells: number[]): number | undefined {
  const votes = new Map<number, number>();
  for (const i of cells) {
    const q = c.labels[i];
    if (q >= 0) votes.set(q, (votes.get(q) ?? 0) + 1);
  }
  return [...votes].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
}
export type Target = Extract<EvalEvidence, { kind: "targets" }>["targets"][number];
export interface RecoveryObservation {
  target: Target | null;
  targetCells: { cell: number; B: number; P: number }[];
  removedMass: number;
  immediateMass: number;
  originalCellsInRemnant: number;
  R: boolean;
  R_clean: boolean;
  reason: string;
  sensitivity: { low: boolean; high: boolean };
  tracks: Record<string, ReturnType<RemnantTrack["result"]>>;
  states: Record<string, { hash: string; step: number; matter: string; residual: string; B: string; P: string }>;
}

/** One-tile observer. Evidence sinks receive snapshots only at the seven fixed boundaries. */
export class RecoveryObserver {
  private initial?: ReturnType<typeof totalsOf>;
  private grown?: WorldState;
  private target: Target | null = null;
  private targetCells: RecoveryObservation["targetCells"] = [];
  private removedMass = 0;
  private immediateMass = 0;
  private originalCellsInRemnant = 0;
  private startStep = 0;
  private tracks: Record<string, RemnantTrack> = {};
  private states: RecoveryObservation["states"] = {};
  constructor(private save: (phase: string, state: WorldState) => Promise<void> = async () => {}) {}
  async observe(event: EvalEvidence): Promise<void> {
    if (event.kind === "targets") {
      if (event.targets.length > 1) throw new Error("observer requires one tile");
      this.target = event.targets[0] ?? null;
      if (this.target && this.grown) {
        const n = cellCount(this.grown.cfg);
        this.targetCells = this.target.cells.map(cell => ({ cell, B: this.grown!.cells[CH.B * n + cell], P: this.grown!.cells[CH.P * n + cell] }));
      }
      return;
    }
    if (event.kind === "regen-census") {
      for (const [name, track] of Object.entries(this.tracks)) {
        if (name !== "fast" && (event.input.step - this.startStep) % 50 !== 0) continue;
        const threshold = name === "low" ? 32 : name === "high" ? 64 : 48;
        track.update(census(event.input, { threshold, minMass: 128 }));
      }
      return;
    }
    const s = event.state, n = cellCount(s.cfg);
    const errors = validateState(s);
    if (errors.length) throw new Error(`INVARIANT ${event.phase}: ${errors.join(",")}`);
    if (s.cfg.tilesX !== 1 || s.cfg.tilesY !== 1 || s.cfg.mutRate !== 0) throw new Error("observer requires a mutation-off single tile");
    const totals = totalsOf(s.cfg, s.cells);
    if (event.phase === "initial") this.initial = totals;
    if (!this.initial) throw new Error("initial state absent");
    const residual = ledgerResidual(this.initial, s);
    if (totals.matter !== this.initial.matter || residual !== 0n) throw new Error(`INVARIANT ${event.phase}: conservation/energy`);
    this.states[event.phase] = { hash: stateHash(s), step: s.step, matter: totals.matter.toString(), residual: residual.toString(), B: totals.B.toString(), P: totals.P.toString() };
    await this.save(event.phase, s);
    if (event.phase === "grown") this.grown = s;
    if (event.phase === "regen-start") {
      this.startStep = s.step;
      const input = { cfg: s.cfg, step: s.step, cells: s.cells, genomeHead: s.genome.subarray(0, n * 4) };
      const primary = census(input);
      const label = overlapLabel(primary, this.target?.cells ?? []);
      this.immediateMass = label === undefined ? 0 : primary.components[label].mass;
      this.originalCellsInRemnant = this.targetCells.filter(x => primary.labels[x.cell] === label && label !== undefined).length;
      this.removedMass = this.targetCells.reduce((sum, x) => sum + x.B + x.P - s.cells[CH.B * n + x.cell] - s.cells[CH.P * n + x.cell], 0);
      const remnant = Array.from(primary.labels.keys()).filter(i => label !== undefined && primary.labels[i] === label);
      for (const name of ["normal", "fast", "low", "high"]) {
        const c = name === "normal" || name === "fast" ? primary : census(input, { threshold: name === "low" ? 32 : 64, minMass: 128 });
        this.tracks[name] = new RemnantTrack(c, name === "normal" || name === "fast" ? label : overlapLabel(c, remnant), this.target?.mass ?? 0);
      }
    }
  }
  finish(e: Evaluation): RecoveryObservation {
    if (Object.keys(this.states).length !== 7 || !this.tracks.normal || this.tracks.fast.history.length !== 80 || this.tracks.normal.history.length !== 40) throw new Error("incomplete observation");
    const targetMass = this.target?.mass ?? 0;
    const tracks = Object.fromEntries(Object.entries(this.tracks).map(([name, track]) => [name, track.result()]));
    const effective = !!this.target?.lesion && this.originalCellsInRemnant > 0 && 5 * this.immediateMass <= 4 * targetMass;
    const expectedR = e.survived === 1 && effective && tracks.normal.retained;
    if (expectedR !== (e.regenerated === 1)) throw new Error("INVARIANT observer disagrees with legacy regeneration");
    const damageOK = 5 * this.removedMass >= targetMass && 2 * this.removedMass <= targetMass && targetMass > 0;
    const clean = cleanRecovery(expectedR, targetMass, this.removedMass, this.originalCellsInRemnant, tracks.normal.recovered, tracks.fast.recovered);
    const grownMass = BigInt(this.states.grown.B) + BigInt(this.states.grown.P);
    const reason = grownMass === 0n ? "failure-to-establish" : !this.target ? "no-eligible-component"
      : !this.target.lesion ? "insufficient-injury" : !this.originalCellsInRemnant ? "no-remnant"
      : !effective || !damageOK ? "injury-outside-band" : tracks.normal.merged || tracks.fast.merged ? "fusion-or-ambiguous-overlap"
      : tracks.normal.lost || tracks.fast.lost ? "tracking-loss" : !clean ? "insufficient-regrowth" : "recovery";
    return { target: this.target, targetCells: this.targetCells, removedMass: this.removedMass,
      immediateMass: this.immediateMass, originalCellsInRemnant: this.originalCellsInRemnant,
      R: expectedR, R_clean: clean, reason, sensitivity: { low: effective && tracks.low.recovered, high: effective && tracks.high.recovered }, tracks, states: this.states };
  }
}

/** Conservative eligibility is independent of the legacy outcome calculation. */
export function cleanRecovery(legacy: boolean, targetMass: number, removedMass: number, remainingOriginalCells: number, normal: boolean, fast: boolean): boolean {
  return legacy && targetMass > 0 && remainingOriginalCells > 0 && 5 * removedMass >= targetMass && 2 * removedMass <= targetMass && normal && fast;
}

/** Independent reduction of compact overlap evidence, matching Tracker's tie/order rules. */
function continuation(label: number | null, edges: Edge[]): { label: number | null; fusion: boolean } {
  if (label === null) return { label: null, fusion: false };
  const grouped = new Map<number, Map<number, number>>();
  for (const e of edges) {
    const group = grouped.get(e.from) ?? new Map<number, number>();
    group.set(e.to, e.cells); grouped.set(e.from, group);
  }
  const main = new Map<number, number>(), parents = new Map<number, number[]>();
  for (const [p, group] of grouped) for (const [q, weight] of group) {
    const best = main.get(q);
    if (best === undefined || weight > grouped.get(best)!.get(q)!) main.set(q, p);
    parents.set(q, [...(parents.get(q) ?? []), p]);
  }
  const children = new Map<number, number[]>();
  for (const [q, p] of main) children.set(p, [...(children.get(p) ?? []), q]);
  const own = children.get(label) ?? [];
  own.sort((a, b) => grouped.get(label)!.get(b)! - grouped.get(label)!.get(a)!);
  let fusion = false;
  for (const [q, ps] of parents) {
    const owner = main.get(q)!;
    const absorbed = ps.filter(p => p !== owner && !children.has(p));
    if (absorbed.length && (owner === label || absorbed.includes(label))) fusion = true;
  }
  return { label: own[0] ?? null, fusion };
}

/** Re-derive all track decisions from ordered compact observations, not saved success bits. */
export function validateObservation(o: RecoveryObservation): void {
  const required = ["initial", "grown", "tile-lesion-end", "regen-start", "regen-end", "dark-end", "light-end"];
  if (Object.keys(o.states).sort().join() !== [...required].sort().join()) throw new Error("state phases incomplete");
  for (const phase of required) {
    const step = phase === "initial" ? 0 : phase === "grown" || phase === "regen-start" ? 3000 : 5000;
    if (o.states[phase].step !== step) throw new Error("state step mismatch");
  }
  const reference = o.target?.mass ?? 0;
  if (![reference, o.removedMass, o.immediateMass, o.originalCellsInRemnant].every(v => Number.isSafeInteger(v) && v >= 0) || o.removedMass > reference) throw new Error("invalid lesion measurements");
  for (const name of ["normal", "fast", "low", "high"]) {
    const t = o.tracks[name], cadence = name === "fast" ? 25 : 50;
    if (!t || t.history.length !== 2000 / cadence) throw new Error("track incomplete");
    let label = t.initialLabel, lost = label === null, merged = false;
    for (let i = 0; i < t.history.length; i++) {
      const row = t.history[i];
      if (row.step !== 3000 + (i + 1) * cadence || !Number.isSafeInteger(row.mass) || row.mass < 0) throw new Error("track cadence/mass mismatch");
      if (row.label !== null && (!Number.isInteger(row.label) || row.label < 0)) throw new Error("invalid component label");
      const seen = new Set<string>();
      for (const edge of row.edges) {
        const key = `${edge.from}:${edge.to}`;
        if (![edge.from, edge.to, edge.cells].every(Number.isSafeInteger) || edge.from < 0 || edge.to < 0 || edge.cells < 1 || seen.has(key)) throw new Error("invalid overlap edge");
        seen.add(key);
      }
      const derived = continuation(label, row.edges);
      if (derived.label !== row.label) throw new Error("wrong retained continuation");
      if (derived.fusion) merged = true;
      if (label === null && row.label !== null) throw new Error("lost remnant replaced");
      if (row.label !== null && !row.edges.some(e => e.from === label && e.to === row.label)) throw new Error("continuation without overlap");
      if (row.label === null) lost = true;
      if (row.label !== null && row.edges.some(e => e.to === row.label && e.from !== label)) merged = true;
      if (row.label === null && label !== null && row.edges.some(e => e.from === label && row.edges.some(other => other.to === e.to && other.from !== label))) merged = true;
      // A fusion involving the retained ID is an incoming overlap or loss of that ID.
      if (row.lost !== lost || row.merged !== merged) throw new Error("continuity flags disagree with edges");
      label = row.label;
    }
    const mass = t.history.at(-1)!.mass;
    const retained = !lost && reference > 0 && 10 * mass >= 9 * reference;
    if (t.mass !== mass || t.lost !== lost || t.merged !== merged || t.retained !== retained || t.recovered !== (retained && !merged)) throw new Error("track decision mismatch");
  }
  const effective = !!o.target?.lesion && o.originalCellsInRemnant > 0 && 5 * o.immediateMass <= 4 * reference;
  const clean = cleanRecovery(o.R, reference, o.removedMass, o.originalCellsInRemnant, o.tracks.normal.recovered, o.tracks.fast.recovered);
  if (o.R_clean !== clean || o.sensitivity.low !== (effective && o.tracks.low.recovered) || o.sensitivity.high !== (effective && o.tracks.high.recovered)) throw new Error("derived recovery mismatch");
}
