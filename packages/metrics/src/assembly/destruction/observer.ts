// Evidence assembly for the I07b destruction/reconstruction assay. Node-only (node:crypto). Deterministic payload: no clock,
// platform or repo SHA. Not re-exported from any barrel.
import { createHash } from "node:crypto";
import { METRICS_VERSION, RULE_VERSION } from "../../../../schema/src/config.ts";
import { ASSEMBLY_VERSION } from "../version.ts";
import type { Conn } from "../grammar.ts";
import { DESTRUCTION_VERSION, DPROTOCOL, type ProcessId, type SeedNs } from "./protocol.ts";
import { Measurer, highAssembly, identityReturn, levelReturn, persistent } from "./readouts.ts";
import { KIND_OF, original, runProcess, type RunResult } from "./processes.ts";
import { occupiedOf } from "./damage.ts";
import { deriveTables, validateRows, type Arm, type ConnArm, type Row, type Tables } from "./verdict.ts";

export const sha256 = (v: string | Uint8Array): string => createHash("sha256").update(v).digest("hex");
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export const STATEMENTS = [
  "CPU only",
  "no GPU evidence",
  "damage is a synthetic occupancy deletion on binary patches, not applyLesion and not a physics rule; matter and energy conservation are not modelled, mass is counted and removals recorded",
  "processes and their truth labels are authored by this protocol; the result shows what the observer can and cannot tell apart in a known-history toy",
  "heritable transmission is untestable in this assay (no transmission step); the property tested is recipe-dependent reconstruction, and it cannot tell a stored recipe from a stored image",
  "no evolving-world positive case exists in the committed fixtures (gene v1/v2, polymer-shell and breeder shell tests closed confounded or negative; the first-rung clips are segmentation-dominated), so none is run or invented",
  "page and real-sim clip arm are deferred to a later stage",
  "no life-detection claim is made at any outcome",
] as const;

export interface Payload {
  kind: "assembly-destruction-evidence";
  namespace: SeedNs;
  versions: { assembly: number; destruction: number; rule: number; metrics: number };
  protocol: typeof DPROTOCOL;
  statements: readonly string[];
  hierReferenceCw: number;
  rows: (Row & { sha256: string })[];
  tables: Tables;
  integritySha256?: string;
}

const CONNS: { v: "c4" | "c8" | "d4"; conn: Conn; d4: boolean }[] = [{ v: "c4", conn: 4, d4: false }, { v: "c8", conn: 8, d4: false }, { v: "d4", conn: 4, d4: true }];

function armOf(m: Measurer, run: RunResult, origCw: Record<Conn, number>, refCw: number): Arm {
  const orig = run.original, d = run.damaged!, g = run.regrown!;
  const finalFrame = g.roundFrames[g.roundFrames.length - 1];
  const occupiedFinal = occupiedOf(finalFrame);
  const out: Partial<Arm> = {
    removedMass: d.removedMass, sweptMass: d.sweptMass, regrownMass: g.regrownMass,
    occupiedAfterDamage: occupiedOf(d.frame), occupiedFinal, residual: DPROTOCOL.patch.mass - occupiedFinal,
  };
  for (const { v, conn, d4 } of CONNS) {
    const n0 = m.copiesOf(orig.frame, conn, orig.targetKey, d4);
    const n1 = m.copiesOf(d.frame, conn, orig.targetKey, d4);
    const roundCounts = g.roundFrames.map((f) => m.copiesOf(f, conn, orig.targetKey, d4));
    const n2 = roundCounts[roundCounts.length - 1];
    const fin = m.measure(finalFrame, conn);
    const a: ConnArm = {
      n1, n2, roundCounts, identity: identityReturn(n0, n1, n2), persistence: persistent(roundCounts, n0),
      cw: fin.cw, level: levelReturn(origCw[conn], fin.cw, occupiedFinal), high: highAssembly(fin, refCw),
    };
    out[v] = a;
  }
  return out as Arm;
}

export function buildRow(m: Measurer, process: ProcessId, rep: number, ns: SeedNs, refCw: number): Row {
  const partialRun = runProcess(process, rep, ns, "lesion-partial");
  const totalRun = runProcess(process, rep, ns, "lesion-total");
  const scrRun = runProcess(process, rep, ns, "scramble");
  const orig = partialRun.original;
  const o4 = m.measure(orig.frame, 4), o8 = m.measure(orig.frame, 8);
  const origCw: Record<Conn, number> = { 4: o4.cw, 8: o8.cw };
  const n0c4 = m.copiesOf(orig.frame, 4, orig.targetKey), n0c8 = m.copiesOf(orig.frame, 8, orig.targetKey), n0d4 = m.copiesOf(orig.frame, 4, orig.targetKey, true);
  let nostore: Row["nostore"] = null;
  if ((DPROTOCOL.storeProcesses as readonly string[]).includes(process)) {
    const ab = runProcess(process, rep, ns, "lesion-total", true);
    const f = ab.regrown!.roundFrames[ab.regrown!.roundFrames.length - 1];
    const n2 = m.copiesOf(f, 4, orig.targetKey);
    nostore = { identity: identityReturn(n0c4, m.copiesOf(ab.damaged!.frame, 4, orig.targetKey), n2), n2 };
  }
  const sm = m.measure(scrRun.scrambled!, 4);
  return {
    process, replicate: rep, kind: KIND_OF[process], targetKey: orig.targetKey, objectSize: orig.objectSize,
    n0: { c4: n0c4, c8: n0c8, d4: n0d4 },
    original: { cw: o4.cw, sharedBound: o4.sharedBound, reuseRatio: o4.reuseRatio, objects: o4.objects },
    partial: armOf(m, partialRun, origCw, refCw), total: armOf(m, totalRun, origCw, refCw),
    nostore,
    scramble: { targetCopies: m.copiesOf(scrRun.scrambled!, 4, orig.targetKey), sharedBound: sm.sharedBound, reuseRatio: sm.reuseRatio, dagKeys: sm.dagKeys, objects: sm.objects },
  };
}

export function sealPayload(p: Payload): Payload {
  const body = { ...p } as Partial<Payload>;
  delete body.integritySha256;
  return { ...p, integritySha256: sha256(canonical(body)) };
}
export function verifySeal(p: Payload): boolean {
  const body = { ...p } as Partial<Payload>;
  delete body.integritySha256;
  return p.integritySha256 === sha256(canonical(body));
}

export interface BuildOptions { ns?: SeedNs; replicates?: number; processes?: readonly ProcessId[]; log?: (s: string) => void }

export function buildPayload(opt: BuildOptions = {}): Payload {
  const ns = opt.ns ?? "score";
  const reps = opt.replicates ?? DPROTOCOL.replicates;
  const m = new Measurer();
  // pre-damage hier-12 reference: the first rung's copy-weighted construction of the original hier-12 patch (replicate 0)
  const hierReferenceCw = m.measure(original("hier", 0, ns).frame, 4).cw;
  const rows: (Row & { sha256: string })[] = [];
  for (const p of opt.processes ?? DPROTOCOL.processes) {
    for (let r = 0; r < reps; r++) {
      const row = buildRow(m, p, r, ns, hierReferenceCw);
      rows.push({ ...row, sha256: sha256(canonical(row)) });
      opt.log?.(`${p} r${r}`);
    }
  }
  const problems = (opt.processes || opt.replicates) ? [] : validateRows(rows);
  if (problems.length) throw new Error(`run rejected:\n${problems.join("\n")}`);
  return sealPayload({
    kind: "assembly-destruction-evidence", namespace: ns,
    versions: { assembly: ASSEMBLY_VERSION, destruction: DESTRUCTION_VERSION, rule: RULE_VERSION, metrics: METRICS_VERSION },
    protocol: DPROTOCOL, statements: STATEMENTS, hierReferenceCw, rows,
    tables: deriveTables(rows),
  });
}
