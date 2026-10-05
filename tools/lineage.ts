// Lineage inspector, analysis side (docs/lineage-inspector.md): a JSON dossier for one genotype
// lineage of a run bundle, with its exact ancestry rebuilt from mutations.tsv (no replay, no GPU),
// or for one pond of a scaffold history, with its exact donor-packet descent from ponds.tsv.
//
//   deno run -A tools/lineage.ts --dir runs/<experiment>/<preset>/<condition>/seed-<n> \
//     [--subject HI:LO | --rule top|random|longest] [--step N] [--seed S] [--min-share 0.01] \
//     [--twin <bundle dir>] [--out dossier.json] [--quiet]
//
//   deno run -A tools/lineage.ts pond --dir runs/scaffold/main/scaf/i0 \
//     [--pond P --cycle C | --rule top|random [--cycle C] [--seed S] [--min-trait 1]] \
//     [--twin runs/scaffold/main/rand/i0] [--out pond.json] [--quiet]
//
// The subject is an explicit lineage key or a rule applied at census --step (default: the last
// census): `top` = most cells, `longest` = earliest-minted lineage alive, `random` = seeded uniform
// pick among lineages holding at least --min-share of living cells. --twin applies the same rule to
// a second bundle (usually the same-seed `neutral` run) and adds its summary; with --subject the twin
// uses `top`. Every reconstructed ancestor is checked against genomes.tsv when the run recorded one
// (--lineage-obs), and the tool refuses to report on a mismatch. Bundles stream: lineages.tsv is
// read twice, never held whole; mutations.tsv is held as a child -> parent map.
//
// `pond` reads a scaffold history's ponds.tsv (by header name) and meta.json. A node is a pond's
// pre-cycle state at a boundary; its parent is the donor whose packet reseeded it at the boundary
// before (tools/lib/pond-lineage.ts). Rules: an explicit --pond/--cycle, `top` (highest trait) or
// `random` (seeded, among ponds with trait >= --min-trait) at --cycle (default: the last cycle).
// --twin pairs a scaf history with its rand twin of the same index under the same rule.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { OUTPUTS, buildDossier, twinSummary, type BundleSource, type Dossier, type SubjectRule } from "./lib/lineage.ts";
import { buildPondHistory, pondDossier, pondTwin, readPondRows, type PondArm, type PondDossier, type PondHistory, type PondSubjectRule } from "./lib/pond-lineage.ts";

async function* fileLines(path: string): AsyncGenerator<string> {
  const file = await Deno.open(path);
  let pending: string[] = [];
  for await (const chunk of file.readable.pipeThrough(new TextDecoderStream())) {
    let start = 0, nl: number;
    while ((nl = chunk.indexOf("\n", start)) >= 0) {
      const line = pending.length ? pending.join("") + chunk.slice(start, nl) : chunk.slice(start, nl);
      pending = [];
      yield line.endsWith("\r") ? line.slice(0, -1) : line;
      start = nl + 1;
    }
    if (start < chunk.length) pending.push(chunk.slice(start));
  }
  const last = pending.join("");
  if (last) yield last.endsWith("\r") ? last.slice(0, -1) : last;
}

function isFile(path: string): boolean {
  try {
    return Deno.statSync(path).isFile;
  } catch {
    return false;
  }
}

async function bundle(dir: string): Promise<BundleSource> {
  const manifest = JSON.parse(await Deno.readTextFile(`${dir}/manifest.json`));
  if (!manifest.summary) throw new Error(`${dir}: manifest has no summary (run unfinished?)`);
  // Pond-cycle runs (docs/scaffold-integration-v1.md) are not supported yet: their tracker births
  // link across each cycle's grind and reseeding, which the dossier would read as real births.
  if (manifest.cfg?.pondPeriod !== undefined) throw new Error(`${dir}: a pond-cycle run bundle (cfg.pondPeriod); genotype dossiers do not support pond runs yet`);
  return { dir, manifest, open: (f) => (isFile(`${dir}/${f}`) ? fileLines(`${dir}/${f}`) : null) };
}

function num(v: string | undefined, name: string): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`--${name} must be a number, got ${v}`);
  return n;
}

if (Deno.args[0] === "pond") await pondMain(Deno.args.slice(1));
else await genotypeMain(Deno.args);

async function genotypeMain(args: string[]) {
  const a = parseArgs(args, {
    string: ["dir", "subject", "rule", "step", "seed", "min-share", "twin", "out"],
    boolean: ["quiet"],
    default: { "min-share": "0.01" },
  });
  if (!a.dir) {
    console.error("usage: deno run -A tools/lineage.ts --dir <bundle> [--subject HI:LO | --rule top|random|longest] [--step N] [--seed S] [--twin <bundle>] [--out file.json]");
    Deno.exit(2);
  }
  if (a.subject && a.rule) throw new Error("--subject and --rule are exclusive");
  const step = num(a.step, "step");
  const ruleName = a.rule ?? "top";
  let rule: SubjectRule;
  if (a.subject) rule = { kind: "key", key: a.subject };
  else if (ruleName === "top" || ruleName === "longest") rule = { kind: ruleName, step };
  else if (ruleName === "random") {
    const seed = num(a.seed, "seed");
    if (seed === undefined) throw new Error("--rule random needs --seed");
    rule = { kind: "random", step, seed, minShare: num(a["min-share"], "min-share")! };
  } else throw new Error(`unknown --rule ${ruleName}`);

  const d = await buildDossier(await bundle(a.dir), rule, { step });
  let twin: ReturnType<typeof twinSummary> | null = null;
  if (a.twin) {
    const twinRule: SubjectRule = rule.kind === "key" ? { kind: "top", step } : rule;
    twin = twinSummary(await buildDossier(await bundle(a.twin), twinRule, { step }));
  }
  if (a.out) await Deno.writeTextFile(a.out, JSON.stringify({ ...d, twin }));
  if (!a.quiet) report(d, twin);
}

async function pondHistory(dir: string): Promise<PondHistory> {
  if (!isFile(`${dir}/ponds.tsv`)) throw new Error(`${dir}: ponds.tsv is missing (not a scaffold history?)`);
  // A runner bundle (manifest.json) of a pond run records its arm in cfg and keeps cycling after its
  // history ends; pond dossiers read only tools/scaffold.ts histories (meta.json) for now.
  if (!isFile(`${dir}/meta.json`) && isFile(`${dir}/manifest.json`)) throw new Error(`${dir}: a runner bundle, not a tools/scaffold.ts history; pond dossiers do not support runner bundles yet`);
  const arm = isFile(`${dir}/meta.json`) ? (JSON.parse(await Deno.readTextFile(`${dir}/meta.json`)).arm as PondArm | undefined) : undefined;
  return buildPondHistory(await readPondRows(fileLines(`${dir}/ponds.tsv`)), { arm });
}

async function pondMain(args: string[]) {
  const a = parseArgs(args, {
    string: ["dir", "pond", "cycle", "rule", "seed", "min-trait", "twin", "out"],
    boolean: ["quiet"],
  });
  if (!a.dir) {
    console.error("usage: deno run -A tools/lineage.ts pond --dir <history> [--pond P --cycle C | --rule top|random [--cycle C] [--seed S]] [--twin <rand history>] [--out file.json]");
    Deno.exit(2);
  }
  const cycle = num(a.cycle, "cycle");
  let rule: PondSubjectRule;
  const ruleName = a.rule ?? "top";
  if (a.pond !== undefined) {
    if (a.rule) throw new Error("--pond and --rule are exclusive");
    if (cycle === undefined) throw new Error("--pond needs --cycle");
    rule = { kind: "explicit", pond: num(a.pond, "pond")!, cycle };
  } else if (ruleName === "top") rule = { kind: "top", cycle };
  else if (ruleName === "random") {
    const seed = num(a.seed, "seed");
    if (seed === undefined) throw new Error("--rule random needs --seed");
    rule = { kind: "random", seed, cycle, minTrait: num(a["min-trait"], "min-trait") };
  } else throw new Error(`unknown --rule ${ruleName}`);

  const h = await pondHistory(a.dir);
  if (a.twin) {
    const t = pondTwin(h, await pondHistory(a.twin), rule);
    if (a.out) await Deno.writeTextFile(a.out, JSON.stringify(t));
    if (!a.quiet) {
      pondReport(a.dir, t.scaf);
      console.log("");
      pondReport(a.twin, t.rand);
      for (const n of t.notes) console.log(`twin note: ${n}`);
    }
    return;
  }
  const d = pondDossier(h, rule);
  if (a.out) await Deno.writeTextFile(a.out, JSON.stringify(d));
  if (!a.quiet) pondReport(a.dir, d);
}

function pondReport(dir: string, d: PondDossier) {
  const f = (n: number) => n.toLocaleString("en-US");
  const s = d.subject, an = d.ancestry, h = d.history;
  const out: string[] = [];
  out.push(`${dir}  (arm ${d.arm ?? "unknown"}, ${h.ponds} ponds, cycles ${h.firstCycle}-${h.lastCycle}${h.endedAt !== null ? `, ended at ${h.endedAt}` : ""})`);
  out.push(`subject pond ${s.pond} at cycle ${s.cycle} (step ${f(s.step)}): trait ${f(s.trait)}, rank ${s.rank} of ${s.of}, by rule ${s.rule.kind}`);
  if (d.descent === "none") out.push("no transfers in this history: the pond's ancestry is itself");
  else {
    out.push(`ancestry: ${an.depth} transfers from pond ${an.rootPond} at cycle ${an.rootCycle}, through ${an.distinctDonorPonds} distinct donor ponds`);
    if (an.commonAncestorCycle !== null) out.push(`every pond at cycle ${s.cycle} shares this line up to cycle ${an.commonAncestorCycle}`);
    out.push("");
    out.push("cycle  pond       trait  lineages  founded by (donor, packet dominant lineage, share)");
    for (const n of an.chain.slice(-10)) {
      const p = n.packet;
      out.push(`${String(n.cycle).padStart(5)}  ${String(n.pond).padStart(4)}  ${f(n.trait).padStart(10)}  ${String(n.lineages ?? "-").padStart(8)}  ${p ? `pond ${p.donor}, ${p.dominant ?? "-"}${p.domShare !== null ? ` (${p.domShare.toFixed(2)})` : ""}` : "-"}`);
    }
    if (an.chain.length > 10) out.push(`  (${an.chain.length - 10} earlier nodes in the dossier)`);
    out.push("");
  }
  if (d.offspring) out.push(`offspring (exact): ${d.offspring.count} recipient(s) seeded from the subject${d.offspring.measured ? "" : " at the last boundary, never measured"}`);
  if (d.clade) out.push(`clade: ${d.clade.extinctAt !== null ? `extinct at cycle ${d.clade.extinctAt}` : d.clade.alive ? "alive at the last cycle" : d.clade.extant ? "present at the last cycle, trait 0" : "absent at the last cycle"}; sizes ${d.clade.series.slice(0, 8).map((c) => c.size).join(", ")}${d.clade.series.length > 8 ? ", ..." : ""}`);
  for (const n of d.notes) out.push(`note: ${n}`);
  for (const g of d.gaps) out.push(`gap: ${g}`);
  for (const w of d.warnings) out.push(`warning: ${w}`);
  console.log(out.join("\n"));
}

function report(d: Dossier, twin: ReturnType<typeof twinSummary> | null) {
  const f = (n: number) => n.toLocaleString("en-US");
  const s = d.subject, o = s.origin;
  const out: string[] = [];
  out.push(`${d.provenance.runId}  (${d.provenance.condition}${d.provenance.expressed ? "" : ": genomes not expressed"})`);
  out.push(`subject ${s.key}: ${"founder" in o ? `founder ${o.founder}` : `minted step ${f(o.minted)}, cell (${o.x}, ${o.y}) tile ${o.tile}`}; ${f(s.cellsAtStep)} cells (${(100 * s.shareAtStep).toFixed(1)}%) at step ${f(d.rule.step)} by rule ${d.rule.kind}; ${s.aliveAtEnd ? "alive" : "not alive"} at the final census`);
  out.push(`root ${d.root.key} (${d.root.source}); depth ${d.mutations.length}; ${d.verification.against ? `${d.verification.genomesChecked} of ${d.chain.length} ancestors verified against genomes.tsv` : "not cross-checked (no genomes.tsv)"}`);
  out.push("");
  out.push("step       locus             change      expression    outputs moved (max |Δ|)                    child peak");
  d.mutations.forEach((m, i) => {
    const moved = m.maxDelta.map((v, k) => (v ? `${OUTPUTS[k]} ${v}` : "")).filter(Boolean).join(", ");
    out.push(`${f(m.step).padStart(9)}  ${m.locus.padEnd(16)}  ${`${m.before} → ${m.after}`.padEnd(10)}  ${m.expression.padEnd(12)}  ${(moved || "-").slice(0, 42).padEnd(42)}  ${f(d.chain[i + 1].peakCells).padStart(9)}`);
  });
  out.push("");
  const exact = d.log.complete === true ? "exact" : d.log.complete === false ? "mutations.tsv is incomplete, see gaps" : "log completeness unchecked";
  out.push(`offspring (${exact}): ${d.offspring.childCount} children, ${d.offspring.childrenCensused} reached a census, ${d.offspring.descendants} descendants`);
  if (d.trackerBirths) out.push(`tracker births (inferred): ${d.trackerBirths.fission} fission, ${d.trackerBirths.budding} budding`);
  if (twin) out.push(`twin ${twin.runId}: subject ${twin.subject}, depth ${twin.depth}, median ancestor peak ${f(twin.medianAncestorPeak)} (here ${f(medianPeak(d))}), ${twin.ancestorsNeverCensused} ancestors never censused${twin.expressed ? "" : ", genomes not expressed"}`);
  for (const g of d.gaps) out.push(`gap: ${g}`);
  console.log(out.join("\n"));
}

function medianPeak(d: Dossier): number {
  const p = d.chain.map((c) => c.peakCells).sort((x, y) => x - y);
  return p[Math.floor(p.length / 2)];
}
