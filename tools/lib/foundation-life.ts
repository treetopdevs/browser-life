// A streaming audit of the saved observer's event graph, not biological pedigrees.
// Only live identities are retained. Events at one census are handled together so
// a simultaneous fusion cannot accidentally count as clean next reproduction.
export type SavedLifeEvent =
  | { step: number; kind: "birth" | "death"; id: number }
  | { step: number; kind: "fission"; parent: number; children: number[] }
  | { step: number; kind: "budding"; parent: number; child: number }
  | { step: number; kind: "fusion"; parents: number[]; child: number };

type Origin = "fission" | "budding" | "birth" | "unrecorded-initial";
type Outcome = "nextFission" | "deathBeforeFission" | "fusionBeforeFission" | "rightCensored";
interface Live {
  id: number;
  born: number | null;
  origin: Origin;
  // At most three identities suffice for a connected three-generation witness.
  chain: { id: number; born: number | null }[];
  settled: boolean;
}
const origins: Origin[] = ["fission", "budding", "birth", "unrecorded-initial"];
const int = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0;
const id = (x: unknown): x is number => int(x) && x > 0;
const ids = (x: unknown): x is number[] => Array.isArray(x) && x.length > 0 && x.every(id) && new Set(x).size === x.length;

export function parseSavedLifeEvent(raw: unknown): SavedLifeEvent {
  const e = raw as Record<string, unknown> | null;
  if (!e || !int(e.step)) throw new Error("invalid life event step");
  if ((e.kind === "birth" || e.kind === "death") && id(e.id)) return e as SavedLifeEvent;
  if (e.kind === "fission" && id(e.parent) && ids(e.children) && !e.children.includes(e.parent)) return e as SavedLifeEvent;
  if (e.kind === "budding" && id(e.parent) && id(e.child) && e.child !== e.parent) return e as SavedLifeEvent;
  if (e.kind === "fusion" && id(e.child) && ids(e.parents) && e.parents.length >= 2) return e as SavedLifeEvent;
  throw new Error("malformed or unsupported life event");
}

export class FoundationLifeAudit {
  private live = new Map<number, Live>();
  // New identities are monotonically allocated by Tracker, but within a census
  // its fission, fusion, death, birth output order need not be numeric.
  private maxIntroduced = 0;
  private pending: SavedLifeEvent[] = [];
  private pendingStep: number | null = null;
  private lastStep = -1;
  private lastReconciledStep = 0;
  private hasReconciled = false;
  private finished = false;
  private initialized = false;
  readonly counts = { birth: 0, death: 0, fission: 0, budding: 0, fusion: 0 };
  readonly outcomes = Object.fromEntries(origins.map((o) => [o, {
    introduced: 0, nextFission: 0, deathBeforeFission: 0, fusionBeforeFission: 0, rightCensored: 0,
    summedStepsToFission: 0,
  }])) as Record<Origin, Record<"introduced" | Outcome | "summedStepsToFission", number>>;
  private threeIdentityChains = 0;
  private witnesses: { step: number; chain: { id: number; born: number | null }[] }[] = [];

  constructor(readonly finalStep: number, readonly censusEvery: number) {
    if (!int(finalStep) || finalStep <= 0 || !int(censusEvery) || censusEvery <= 0) throw new Error("invalid observation window");
  }

  push(raw: unknown): void {
    if (this.finished) throw new Error("audit already finished");
    if (!this.initialized) throw new Error("initial census required");
    const e = parseSavedLifeEvent(raw);
    if (e.step <= this.censusEvery || e.step <= this.lastReconciledStep || e.step > this.finalStep || (e.step % this.censusEvery !== 0 && e.step !== this.finalStep) || e.step < this.lastStep) throw new Error("event outside ordered census schedule");
    if (this.pendingStep !== null && e.step !== this.pendingStep) this.flush();
    this.pendingStep = e.step;
    this.lastStep = e.step;
    this.pending.push(e);
  }

  private settle(p: Live, outcome: Outcome, step: number): void {
    if (p.settled) return;
    p.settled = true;
    this.outcomes[p.origin][outcome]++;
    if (outcome === "nextFission" && p.born !== null) this.outcomes[p.origin].summedStepsToFission += step - p.born;
  }

  private flush(): void {
    const events = this.pending;
    const step = this.pendingStep!;
    const born = new Map<number, { origin: Origin; parent?: number }>();
    const introduce = (n: number, origin: Origin, parent?: number) => {
      if (born.has(n) || this.live.has(n) || n <= this.maxIntroduced) throw new Error(`reused or duplicate identity ${n}`);
      born.set(n, { origin, parent });
    };
    for (const e of events) {
      this.counts[e.kind]++;
      if (e.kind === "birth") introduce(e.id, "birth");
      if (e.kind === "budding") introduce(e.child, "budding", e.parent);
      if (e.kind === "fission") for (const child of e.children) introduce(child, "fission", e.parent);
    }
    const allocated = [...born.keys()].sort((a, b) => a - b);
    if (allocated.some((n, i) => n !== this.maxIntroduced + i + 1)) throw new Error("missing allocated identity: event log has a gap");
    for (const b of born.values()) if (b.parent !== undefined && born.has(b.parent)) throw new Error("missing or ended parent: same-census ancestry");
    const get = (n: number): Live => {
      const p = this.live.get(n);
      if (!p) throw new Error(`missing or ended identity ${n}`);
      return p;
    };
    const fused = new Set<number>();
    for (const e of events) if (e.kind === "fusion") for (const n of [...e.parents, e.child]) fused.add(n);
    for (const n of fused) {
      if (born.has(n)) continue;
      const p = get(n);
      this.settle(p, "fusionBeforeFission", step);
      p.chain = [{ id: n, born: p.born }];
    }
    for (const e of events) if (e.kind === "fission") {
      const p = get(e.parent);
      if (!fused.has(p.id)) this.settle(p, "nextFission", step);
    }
    for (const [n, b] of born) {
      const parent = b.parent === undefined ? undefined : get(b.parent);
      const linkable = b.origin === "fission" && parent && !fused.has(parent.id) && !fused.has(n);
      const chain = [...(linkable ? parent.chain : []), { id: n, born: step }].slice(-3);
      const p: Live = { id: n, born: step, origin: b.origin, chain, settled: false };
      this.live.set(n, p);
      this.outcomes[b.origin].introduced++;
      if (fused.has(n)) this.settle(p, "fusionBeforeFission", step);
      if (chain.length === 3) {
        this.threeIdentityChains++;
        if (this.witnesses.length < 5) this.witnesses.push({ step, chain: structuredClone(chain) });
      }
    }
    for (const e of events) {
      if (e.kind === "death") {
        const p = get(e.id);
        this.settle(p, "deathBeforeFission", step);
        this.live.delete(e.id);
      }
      // Tracker keeps the main parent alive, even when the fusion's child is
      // a newly split piece and the parent continues as a different component.
      if (e.kind === "fusion") {
        get(e.child);
        for (const n of e.parents.slice(1)) this.live.delete(n);
      }
    }
    for (const n of born.keys()) this.maxIntroduced = Math.max(this.maxIntroduced, n);
    this.pending = [];
    this.pendingStep = null;
  }

  /** The original runner's first census allocates IDs 1..N without birth rows. */
  seedInitialIndividuals(count: number): void {
    if (!int(count) || this.lastStep !== -1 || this.initialized) throw new Error("initial census must be seeded before events");
    this.initialized = true;
    for (let n = 1; n <= count; n++) {
      this.live.set(n, { id: n, born: null, origin: "unrecorded-initial", chain: [{ id: n, born: null }], settled: false });
      this.outcomes["unrecorded-initial"].introduced++;
    }
    this.maxIntroduced = count;
    this.lastReconciledStep = Math.min(this.censusEvery, this.finalStep);
  }

  /** Compare the deduplicated live-ID set to one saved census, including event-free censuses. */
  reconcileCensus(step: number, individuals: number): void {
    if (this.finished || !this.initialized) throw new Error("initial census required before reconciliation");
    const expected = Math.min(this.lastReconciledStep + this.censusEvery, this.finalStep);
    if (this.lastReconciledStep >= this.finalStep || step !== expected || !int(individuals))
      throw new Error("census reconciliation outside ordered schedule");
    if (this.pendingStep !== null) {
      if (this.pendingStep !== step) throw new Error("unreconciled event census before current series row");
      this.flush();
    }
    if (this.live.size !== individuals)
      throw new Error(`individual count at step ${step}: event graph ${this.live.size} != series ${individuals}`);
    this.lastReconciledStep = step;
    this.hasReconciled = true;
  }

  finish() {
    if (this.finished) throw new Error("audit already finished");
    if (!this.initialized) throw new Error("initial census required");
    if (this.hasReconciled && this.lastReconciledStep !== this.finalStep) throw new Error("series reconciliation incomplete");
    if (this.pendingStep !== null) this.flush();
    for (const p of this.live.values()) this.settle(p, "rightCensored", this.finalStep);
    this.finished = true;
    return {
      scope: "saved-observer-event-graph-only" as const,
      biologicalReproductionEstablished: false,
      counts: { ...this.counts }, outcomes: structuredClone(this.outcomes),
      threeIdentityFissionChains: this.threeIdentityChains,
      chainWitnesses: this.witnesses,
      finalTrackedIndividuals: this.live.size,
      finalStep: this.finalStep, censusEvery: this.censusEvery,
      limitations: [
        "Three linked identities are inferred fission edges, not three validated life cycles.",
        "Budding starts a new chain because nearest same-lineage attribution is not a verified parent.",
        "Fusion resets chain continuity and competes with time to first fission; same-census fusion takes precedence.",
        "No paired morphology, genome inheritance, common garden or independent descendant viability is measured.",
        "Initial identities have unknown birth ages. Event-free censuses are absent from life.jsonl.",
      ],
    };
  }
}
