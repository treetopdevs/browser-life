// CLI for the tape-vs-weights mutation probe (Deno, native; the only file here that uses Deno.*).
//   deno run --no-lock -A experiments/tape-probe/run.ts smoke
//   deno run --no-lock -A experiments/tape-probe/run.ts calibrate        # real 16x16 biomass assay vs the proxy (weights only)
//   deno run --no-lock -A experiments/tape-probe/run.ts match            # hill-climb tapes to the 11 M3 founders
//   deno run --no-lock -A experiments/tape-probe/run.ts cell <nn|tape|bff-uniform|bff-dense> <raw|func|founders|founders-matched|matched> [--parents N --mutants M --shard name]
//   deno run --no-lock -A experiments/tape-probe/run.ts report           # merge shards -> docs/tape-probe-2026-11-17/result.json (+ runs/tape-probe/tables.md)
// Shard outputs go to runs/tape-probe/ (gitignored). Always pass --no-lock (a plain run rewrites deno.lock).
import { M3_FOUNDERS, encodeGenome, founderGenome } from "@bl/schema";
import { ASSAY, AssayCache, SCENARIO_IDS, responses, sum, withWeights } from "@bl/lineage";
import { GRID_POINTS, NO, SALT, assertIntegers, nnOuts, permille, keyedWith, strId } from "./common.ts";
import { NN_ARM, TAPE_ARM, bffArm, buildPanelFunc, buildPanelRaw, classifyOuts, parentInfo, runCell, type Arm, type Panel, type CellRecord } from "./probe.ts";
import { MATCH, hillClimb, sampleIdx, verdict, type MatchRecord } from "./match.ts";
import { TAPE_BYTES, nonNopCount } from "./tape.ts";

const OUT = "runs/tape-probe";
const DOC = "docs/tape-probe-2026-11-17";
const mkdir = (d: string) => Deno.mkdirSync(d, { recursive: true });
const writeJson = (p: string, o: unknown) => Deno.writeTextFileSync(p, JSON.stringify(o, null, 1) + "\n");
const readJson = (p: string) => JSON.parse(Deno.readTextFileSync(p));
const exists = (p: string) => { try { Deno.statSync(p); return true; } catch { return false; } };
const flag = (args: string[], name: string, dflt: number): number => { const i = args.indexOf(`--${name}`); return i >= 0 ? parseInt(args[i + 1], 10) : dflt; };
const sflag = (args: string[], name: string, dflt: string): string => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const now = () => performance.now();

const hexBytes = (h: string): Uint8Array => { const b = new Uint8Array(h.length / 2); for (let i = 0; i < b.length; i++) b[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16); return b; };
const founderBytes = (f: (typeof M3_FOUNDERS)[number]): Uint8Array => new Uint8Array(founderGenome(f).weights.buffer.slice(0));

function armOf(rep: string): Arm {
  if (rep === "nn") return NN_ARM;
  if (rep === "tape") return TAPE_ARM;
  if (rep === "bff-uniform") return bffArm("uniform");
  if (rep === "bff-dense") return bffArm("dense");
  throw new Error(`unknown rep ${rep}`);
}
const KINDS: Record<string, string[]> = {
  nn: ["W-step", "W-resample"],
  tape: ["T-byte-step", "T-byte-resample", "T-instr-resample", "T-insert", "T-delete", "T-dup"],
  "bff-uniform": ["B-byte-resample"], "bff-dense": ["B-byte-resample"],
};

function matchedClusters(): { cluster: number; tape: Uint8Array }[] {
  const p = `${OUT}/match.json`;
  if (!exists(p)) throw new Error("run `match` first");
  return (readJson(p).records as MatchRecord[]).filter((r) => r.matched).map((r) => ({ cluster: r.cluster, tape: hexBytes(r.tapeHex) }));
}

// founders / founders-matched are weight genomes (160 int8 weights) and "matched" is a set of tapes: running either as the other
// representation would silently reinterpret bytes, so refuse the combination.
const VALID_PANELS: Record<string, string[]> = {
  nn: ["raw", "func", "founders", "founders-matched"],
  tape: ["raw", "func", "matched"],
  "bff-uniform": ["raw", "func"], "bff-dense": ["raw", "func"],
};
export function checkCombo(rep: string, name: string): void {
  const ok = VALID_PANELS[rep];
  if (!ok) throw new Error(`unknown rep ${rep}`);
  if (!ok.includes(name)) throw new Error(`panel "${name}" is not valid for rep "${rep}" (valid: ${ok.join(", ")}); its genome bytes would be misread`);
}

function panelFor(rep: string, name: string, parents: number): Panel {
  checkCombo(rep, name);
  const arm = armOf(rep);
  if (name === "raw") return buildPanelRaw(arm, parents);
  if (name === "func") return buildPanelFunc(arm, parents, rep.startsWith("bff") ? 100 : 2000);
  if (name === "founders") return { id: "founders", parents: M3_FOUNDERS.map((f) => ({ id: `c${f.cluster}`, g: founderBytes(f) })) };
  if (name === "founders-matched") {
    const ok = new Set(matchedClusters().map((m) => m.cluster));
    return { id: "founders-matched", parents: M3_FOUNDERS.filter((f) => ok.has(f.cluster)).map((f) => ({ id: `c${f.cluster}`, g: founderBytes(f) })) };
  }
  if (name === "matched") return { id: "matched", parents: matchedClusters().map((m) => ({ id: `c${m.cluster}`, g: m.tape })) };
  throw new Error(`unknown panel ${name}`);
}

function cmdCell(args: string[]) {
  const [rep, panelName] = args;
  const isFounder = panelName.startsWith("founders") || panelName === "matched";
  const parents = flag(args, "parents", 40), mutants = flag(args, "mutants", isFounder ? 400 : 200);
  const shard = sflag(args, "shard", `${rep}-${panelName}`);
  const arm = armOf(rep);
  const t0 = now();
  const panel = panelFor(rep, panelName, parents);
  if (panel.parents.length === 0) { console.log(`no parents for ${rep}/${panelName}; nothing written`); return; }
  const cells: CellRecord[] = [];
  for (const kind of KINDS[rep]) {
    const t = now();
    cells.push(runCell({ arm, panel, kind, mutantsPerParent: mutants }));
    console.log(`${rep} ${panelName} ${kind}: n=${cells[cells.length - 1].n} in ${((now() - t) / 1000).toFixed(1)}s`);
  }
  mkdir(OUT);
  const rec = { shard, rep, panel: panelName, parentsN: panel.parents.length, mutantsPerParent: mutants, acceptance: panel.acceptance ?? null, cells };
  assertIntegers(rec);
  writeJson(`${OUT}/cells-${shard}.json`, rec);
  console.log(`wrote ${OUT}/cells-${shard}.json in ${((now() - t0) / 1000).toFixed(0)}s`);
}

function cmdSmoke() {
  for (const rep of ["nn", "tape", "bff-uniform", "bff-dense"]) {
    const arm = armOf(rep);
    const t = now();
    const panel = buildPanelRaw(arm, 4);
    const tp = now();
    const cells = KINDS[rep].map((k) => runCell({ arm, panel, kind: k, mutantsPerParent: 5 }));
    const probes = 4 + cells.reduce((a, c) => a + c.n, 0);
    console.log(`${rep}: ${probes} probes in ${(now() - tp).toFixed(0)} ms => ${((now() - tp) / probes).toFixed(1)} ms/probe (panel ${(tp - t).toFixed(0)} ms)`);
    for (const c of cells) console.log(`  ${c.kind}: n=${c.n} neutral=${c.neutral} changed=${c.changed}`);
    assertIntegers(cells);
  }
  const p = buildPanelFunc(TAPE_ARM, 3, 300);
  console.log(`tape func acceptance in smoke: ${p.acceptance!.accepted}/${p.acceptance!.tried}`);
}

function cmdMatch(args: string[]) {
  mkdir(OUT);
  const idx = sampleIdx();
  const records: MatchRecord[] = [];
  const only = flag(args, "cluster", -1);
  for (const f of M3_FOUNDERS) {
    if (only >= 0 && f.cluster !== only) continue;
    const t = now();
    const w = new Int8Array(founderBytes(f).buffer);
    const target = nnOuts(w);
    const tsub = subOuts_nn(w, idx);
    const hc = hillClimb(tsub, idx, keyedWith(SALT, strId("match"), f.cluster));
    const rec = verdict(f.cluster, hc.tape, target, hc.subError);
    records.push(rec);
    console.log(`cluster ${f.cluster}: full err ${rec.fullErrorMilli / 1000} vs zero ${rec.zeroErrorMilli / 1000} functional=${rec.functionalTape} matched=${rec.matched} (${((now() - t) / 1000).toFixed(0)}s, nonNop ${nonNopCount(hexBytes(rec.tapeHex))})`);
  }
  const outp = only >= 0 ? `${OUT}/match-${only}.json` : `${OUT}/match.json`;
  const out = { sampleN: MATCH.sub, restarts: MATCH.restarts, evals: MATCH.evals, maxMeanErr: MATCH.maxMeanErr, records };
  assertIntegers(out);
  writeJson(outp, out);
}
function subOuts_nn(w: Int8Array, idx: number[]): Int16Array {
  const full = nnOuts(w), out = new Int16Array(idx.length * NO);
  for (let j = 0; j < idx.length; j++) for (let k = 0; k < NO; k++) out[j * NO + k] = full[idx[j] * NO + k];
  return out;
}

function cmdCalibrate(args: string[]) {
  const perParent = flag(args, "mutants", 20);
  const kind = sflag(args, "kind", "W-step"), outName = sflag(args, "out", "calibration");
  const cache = new AssayCache();
  const real = (words: Uint32Array): boolean => SCENARIO_IDS.every((s) => sum(responses(cache, words, s)) >= ASSAY.viableFloor * ASSAY.seeds.length);
  const conf: Record<string, { realViable: number; realNot: number }> = { neutral: { realViable: 0, realNot: 0 }, viable: { realViable: 0, realNot: 0 }, lethal: { realViable: 0, realNot: 0 } };
  const sweepConf: Record<string, Record<string, { realViable: number; realNot: number }>> = {};
  for (const nm of ["quarter", "half", "threeQuarter"]) sweepConf[nm] = { neutral: { realViable: 0, realNot: 0 }, viable: { realViable: 0, realNot: 0 }, lethal: { realViable: 0, realNot: 0 } };
  const parentsUsed: number[] = [], parentsSkipped: number[] = [];
  const t0 = now();
  for (const f of M3_FOUNDERS) {
    const words = encodeGenome(founderGenome(f), 0, 0);
    if (!real(words)) { parentsSkipped.push(f.cluster); continue; }
    parentsUsed.push(f.cluster);
    const P = parentInfo(nnOuts(founderGenome(f).weights));
    const base = keyedWith(SALT, strId("calib"), f.cluster);
    for (let m = 0; m < perParent; m++) {
      let mw = founderBytes(f), got = false;
      for (let a = 0; a < 8 && !got; a++) {
        const t = NN_ARM.operators[kind](founderBytes(f), keyedWith(base, m, a));
        if (t.some((b, i) => b !== mw[i])) { mw = t; got = true; }
      }
      if (!got) continue;
      const mw8 = new Int8Array(mw.buffer);
      const mWords = withWeights(words, mw8);
      const rv = real(mWords);
      const mOuts = nnOuts(mw8);
      const changed = mOuts.some((v, i) => v !== P.outs[i]);
      for (const [nm, nu, de] of [["quarter", 1, 4], ["half", 1, 2], ["threeQuarter", 3, 4]] as [string, number, number][]) {
        const cls = classifyOuts(P, mOuts, changed, nu, de);
        const c = sweepConf[nm][cls === "na-changed" ? "viable" : cls];
        if (rv) c.realViable++; else c.realNot++;
        if (nm === "half") { const c2 = conf[cls === "na-changed" ? "viable" : cls]; if (rv) c2.realViable++; else c2.realNot++; }
      }
    }
    console.log(`calibrate cluster ${f.cluster} done (${((now() - t0) / 1000).toFixed(0)}s, assay runs ${cache.runs})`);
  }
  const n = Object.values(conf).reduce((a, c) => a + c.realViable + c.realNot, 0);
  // agreement: proxy neutral/viable <-> real viable, proxy lethal <-> real not viable
  const agree = (c: typeof conf) => c.neutral.realViable + c.viable.realViable + c.lethal.realNot;
  const gridBlind = conf.neutral.realNot;
  const out = {
    kind, mutantsPerParent: perParent, parentsUsed, parentsSkipped, n, confusion: conf, sweepConfusion: sweepConf,
    agreementPermille: permille(agree(conf), n), agreementPermilleSweep: Object.fromEntries(Object.entries(sweepConf).map(([k, v]) => [k, permille(agree(v as typeof conf), n)])),
    gridBlind, assayRuns: cache.runs,
  };
  assertIntegers(out);
  mkdir(OUT);
  writeJson(`${OUT}/${outName}.json`, out);
  console.log(JSON.stringify(out, null, 1));
}

function cmdReport() {
  const files = [...Deno.readDirSync(OUT)].filter((e) => e.name.startsWith("cells-") && e.name.endsWith(".json")).map((e) => e.name).sort();
  const shards = files.map((f) => readJson(`${OUT}/${f}`));
  const cells: CellRecord[] = shards.flatMap((s) => s.cells);
  const acceptance: Record<string, unknown> = {};
  for (const s of shards) if (s.acceptance) acceptance[`${s.rep}/${s.panel}`] = s.acceptance;
  const match = exists(`${OUT}/match.json`) ? readJson(`${OUT}/match.json`) : null;
  const calibration = exists(`${OUT}/calibration.json`) ? readJson(`${OUT}/calibration.json`) : null;
  const calibration2 = exists(`${OUT}/calibration-resample.json`) ? readJson(`${OUT}/calibration-resample.json`) : null;
  const matchedN = match ? (match.records as MatchRecord[]).filter((r) => r.matched).length : 0;
  const result = {
    version: 1, salt: SALT, rule: "exploratory, no gate",
    config: { grid: { points: GRID_POINTS }, mutantsRule: "see shards", viableProxy: "L1 half / L2 2x+32, functional parents only" },
    arms: { weights: { genomeBytes: 160 }, tapeR: { genomeBytes: TAPE_BYTES, instructions: 40 }, bff: { genomeBytes: 100, fuel: 1024 } },
    shards: shards.map((s) => ({ shard: s.shard, rep: s.rep, panel: s.panel, parents: s.parentsN, mutantsPerParent: s.mutantsPerParent })),
    matching: match ? { achieved: matchedN >= 3, matchedCount: matchedN, ...match } : null,
    acceptance, calibration, calibrationResample: calibration2, cells,
  };
  assertIntegers(result);
  mkdir(DOC);
  writeJson(`${DOC}/result.json`, result);
  const lines = ["| rep | panel | kind | n | neutral (permille, Wilson) | viable | lethal | n/a | decode-changing neutral | parent spread | boot |", "|---|---|---|---|---|---|---|---|---|---|---|"];
  for (const c of cells) lines.push(`| ${c.rep} | ${c.panel} | ${c.kind} | ${c.n} | ${c.neutral} (${c.permille.neutral}; ${c.wilson.neutral[0]}-${c.wilson.neutral[1]}) | ${c.changedViable} (${c.permille.changedViable}) | ${c.lethal} (${c.permille.lethal}) | ${c.viableNA} | ${c.neutralDecodeChanging.neutral}/${c.neutralDecodeChanging.n} | ${c.parentSpread.min}/${c.parentSpread.median}/${c.parentSpread.max} | ${c.parentBoot[0]}-${c.parentBoot[1]} |`);
  Deno.writeTextFileSync(`${OUT}/tables.md`, lines.join("\n") + "\n");
  console.log(lines.join("\n"));
  console.log(`wrote ${DOC}/result.json (${cells.length} cells)`);
}

const [cmd, ...rest] = Deno.args;
if (cmd === "smoke") cmdSmoke();
else if (cmd === "calibrate") cmdCalibrate(rest);
else if (cmd === "match") cmdMatch(rest);
else if (cmd === "cell") cmdCell(rest);
else if (cmd === "report") cmdReport();
else console.log("usage: smoke | calibrate | match | cell <rep> <panel> | report");
