// Construction-length service: cached per-class answers, the shared-pool bound, and one deterministic node counter.
import { canonicalKey, keyCells, type Conn } from "./grammar.ts";
import { exactConstruction, type DagEntry } from "./exact.ts";
import { boundConstruction, chainDag } from "./bound.ts";
import { PROTOCOL } from "./protocol.ts";

export type Status = "exact" | "bound" | "limited";
export interface ClassAnswer { a: number; status: Status }
export interface Trace { target: number[]; conn: Conn; free: string[]; dag: DagEntry[] }

export class ConstructionService {
  nodes = 0;
  /** Global node allowance; a constructor argument only so tests can exhaust it. */
  readonly limit: number;
  constructor(limit: number = PROTOCOL.totalNodeLimit) { this.limit = limit; }
  readonly cache = new Map<string, ClassAnswer>();
  trace: Trace[] | null = null;

  /** Class cells are normalised and sorted. */
  solve(cells: readonly number[], conn: Conn): ClassAnswer {
    const n = cells.length;
    if (n <= 1) return { a: 0, status: "exact" };
    const key = `${conn}:${cells.join(",")}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const r = this.solveFree(cells, conn, new Set());
    const ans: ClassAnswer = { a: r.cost, status: r.status };
    this.cache.set(key, ans);
    return ans;
  }

  private solveFree(cells: readonly number[], conn: Conn, free: ReadonlySet<string>): { cost: number; status: Status; dag: DagEntry[] } {
    const n = cells.length;
    const limited = () => ({ cost: n - 1, status: "limited" as const, dag: chainDag(cells, conn) });
    const remaining = () => this.limit - this.nodes;
    if (remaining() <= 0) return limited();
    if (n <= PROTOCOL.exactMaxN) {
      // the search visits at most budget + 1 nodes (the last one is the refusal), so leave room for it
      const budget = Math.min(PROTOCOL.exactNodeBudget, remaining() - 1);
      const r = exactConstruction(cells, { conn, group: "T", budget, free: free as Set<string> });
      this.nodes += r.nodes;
      if (r.exact) return { cost: r.cost, status: "exact", dag: r.dag };
      if (remaining() <= 0) return limited();
    }
    const b = boundConstruction(cells, { conn, beamW: PROTOCOL.beamW, nodeCap: Math.min(PROTOCOL.boundNodeCap, remaining()), maxCand: PROTOCOL.maxCand, free });
    this.nodes += b.nodes;
    return { cost: b.cost, status: b.fallback ? "limited" : "bound", dag: b.dag };
  }

  /**
   * Shared bound over distinct classes: one construction DAG with pool members shared across targets.
   * Classes are built in descending size order (ties by key); pool members already built cost nothing.
   */
  shared(classes: readonly { key: string; cells: readonly number[] }[], conn: Conn): number | null {
    if (classes.length === 0) return null;
    const order = classes.slice().sort((p, q) => q.cells.length - p.cells.length || (p.key < q.key ? -1 : p.key > q.key ? 1 : 0));
    const built = new Set<string>();
    let total = 0;
    for (const c of order) {
      if (built.has(c.key)) continue;
      const before = [...built];
      const r = this.solveFree(c.cells, conn, built);
      total += r.cost;
      if (this.trace) this.trace.push({ target: c.cells.slice(), conn, free: before, dag: r.dag });
      for (const e of r.dag) built.add(e.key);
      built.add(c.key);
    }
    return total;
  }
}

export { canonicalKey, keyCells };
