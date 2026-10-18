// The pond tool's handling of pond-cycle runner bundles (tools/lineage.ts pond; docs/lineage-inspector.md section 8),
// kept out of the CLI so tests reach it: reading a runner bundle as a pond history, choosing the packet genotype
// `pond --genotype` opens, and whether two bundles start from the same world (the twin note).
// Pure: no Deno API; bundle files arrive parsed.
import { initialWorld } from "./lineage.ts";
import { checkPicks, packetHeld, pondIndex, type PickLine } from "./pond-descent.ts";
import { buildPondHistory, type ParsedPonds, type PondDossier, type PondHistory, type PondPicks } from "./pond-lineage.ts";

/**
 * A pond-cycle run bundle (manifest.json with cfg.pondPeriod) read as a pond history. The arm and period come from
 * the config, the start step and picker from the manifest. The table gets the genotype route's consistency checks
 * (pondIndex), and a pick log is checked against its rows (a disagreement throws). Arms nat and shuf are refused.
 * `picks` null: the bundle has no picks.jsonl.
 */
export function runnerPondHistory(parsed: ParsedPonds, manifest: any, opts: { hasMutations: boolean; picks: { picks: PickLine[]; torn: boolean } | null }): PondHistory {
  const cfg = manifest?.cfg;
  if (cfg?.pondPeriod === undefined) throw new Error("the run has no pond cycle (cfg.pondPeriod)");
  if (cfg.pondArm === "nat" || cfg.pondArm === "shuf") throw new Error(`pond dossiers do not support arms nat/shuf yet (surviving ponds, donor -2); open their lineages as genotype dossiers instead (tools/lineage.ts --dir)`);
  const startStep = manifest.startStep ?? 0;
  const index = pondIndex(parsed, cfg, { startStep });
  let picks: PondPicks | null = null;
  if (opts.picks || manifest.picks) {
    const lines = opts.picks?.picks ?? [];
    const by: Record<string, number> = {};
    for (const p of lines) by[p.by ?? "unnamed"] = (by[p.by ?? "unnamed"] ?? 0) + 1;
    const check = opts.picks ? checkPicks(index, lines) : { checked: 0, partial: 0, unchecked: 0, unlogged: 0 };
    picks = { picker: manifest.picks?.picker ?? null, present: opts.picks !== null, torn: opts.picks?.torn ?? false, lines: lines.length, by, ...check };
  }
  return buildPondHistory(parsed, { arm: cfg.pondArm, period: cfg.pondPeriod, source: "runner", hasMutations: opts.hasMutations, firstStep: startStep, picks, ponds: cfg.tilesX * cfg.tilesY });
}

/** What `pond --genotype` opens: a packet's dominant lineage, the census step where the packet was measured, and its donor node. */
export interface PacketGenotype {
  lineage: string;
  step: number;
  anchor: { pond: number; cycle: number };
}

/**
 * The dominant lineage of the founding packet of the subject's chain node at `cycle` (default: the subject itself),
 * row (cycle - 1, pond). It was alive in the donor's pre-cycle snapshot at boundary cycle - 1, so its genotype dossier
 * is read at that census (step (cycle - 1) x period) and anchored at the donor node. Throws, by name, for a history
 * without mutations.tsv, a cycle outside the chain, a node with no founding packet in the bundle, and a packet row
 * that cannot have carried a dominant (`packetHeld`: 0 lineages, or lineages but no dominant).
 */
export function packetGenotype(d: PondDossier, h: PondHistory, cycle?: number): PacketGenotype {
  if (h.source !== "runner") throw new Error("--genotype needs a pond-cycle run bundle; a scaffold history has no mutations.tsv");
  if (!h.hasMutations) throw new Error("--genotype needs mutations.tsv, which this bundle lacks");
  if (h.period === null) throw new Error("--genotype needs the run's pond period");
  const at = cycle ?? d.subject.cycle;
  const chain = d.ancestry.chain;
  const node = chain.find((n) => n.cycle === at);
  if (!node) throw new Error(`--genotype-cycle ${at}: the subject's chain has no node at that cycle (it spans cycles ${chain[0].cycle}..${d.subject.cycle})`);
  if (!node.packet || !node.parent) {
    const why = d.descent === "none" ? "arm cont moves nothing" : node.cycle === h.firstCycle ? `cycle ${node.cycle} is the bundle's first` : "no transfer";
    throw new Error(`pond ${node.pond} at cycle ${node.cycle} has no founding packet in this bundle (${why}), so there is no packet genotype to open`);
  }
  // The route's packet rule (packetHeld): a packet of 0 lineages carried nothing, whatever it names. The anchor walk
  // starts at the donor node and never passes this packet, so it is checked here.
  const what = `the founding packet of pond ${node.pond} at cycle ${node.cycle} (from pond ${node.packet.donor})`;
  const domKnown = !h.absentColumns.includes("domHi") && !h.absentColumns.includes("domLo");
  packetHeld(node.packet.lineages, node.packet.dominant, domKnown, what);
  if (!node.packet.dominant) throw new Error(`${what} names no dominant lineage (${domKnown ? "the row names none, and the table has no packetLineages column" : "the table lacks domHi/domLo"}), so there is no packet genotype to open`);
  return { lineage: node.packet.dominant, step: node.parent.cycle * h.period, anchor: { pond: node.parent.pond, cycle: node.parent.cycle } };
}

/**
 * Whether two runner bundles start from one world: the same config apart from the pond arm and score (what a
 * scaf/rand twin differs in), initial worlds that both rebuild at their manifests' initHash (which also hashes the
 * config, so it differs between arms) and hold the same cells and genomes, and nothing applied after that world and
 * before the first boundary that differs: the same scheduled interventions (lesions, feeds) at steps before
 * cfg.pondPeriod, in order (step-0 entries change the start itself; an entry at the boundary step comes after its
 * census and cycle), and no import or branch transform (neither is in initHash). Then their states are identical up
 * to the first boundary.
 */
export function sameStart(a: any, b: any): boolean {
  const strip = (cfg: any) => JSON.stringify({ ...cfg, pondArm: undefined, pondScore: undefined });
  if (strip(a.cfg) !== strip(b.cfg)) return false;
  const altered = (m: any) => m.importedStartHash != null || m.spec?.branch !== undefined;
  if (altered(a) || altered(b)) return false;
  const before = (m: any) => JSON.stringify((m.spec?.interventions ?? []).filter((e: any) => !(e?.step >= m.cfg.pondPeriod)));
  if (before(a) !== before(b)) return false;
  const sa = initialWorld(a), sb = initialWorld(b);
  const same = (x: Uint32Array, y: Uint32Array) => x.length === y.length && x.every((v, i) => v === y[i]);
  return sa !== null && sb !== null && same(sa.cells, sb.cells) && same(sa.genome, sb.genome);
}
