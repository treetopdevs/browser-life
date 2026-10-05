// Cells sandbox (docs/sandbox-cells.md, "Screen 6"): the readout rule applied per seed, from raw counts.
// `own-screen read` prints an older rule (no depth, arm-mean mass); this is the classifier for screen 6.
//
//   deno run -A tools/own-readout.ts --out runs/cells/screen6 --arms own-cell-injury,own-cell-wall-injury [--seeds 1-3] [--snapshot 1000000] [--need 2] [--control-depths 58,142,102]
//   deno run -A tools/own-readout.ts --out DIR --arms own-cell-injury --replicate      (seeds 4-8, 3 needed)
//   deno run -A tools/own-readout.ts --out runs/cells/screen7 --arms own-cell-wall-injury --seeds 4-8 --need 3 --fail 3   (screen 7: five fresh seeds, majority thresholds)
//
// Per seed, three criteria against the same seed's control (gradient-m3):
//   regeneration  arm - control >= 0.2, on the assays' raw counts (DIR/assays/<arm>-s<seed>-t<snapshot>/result.json)
//   bound mass    arm's B + P at least half the control's (the checkpoint totals in the same files)
//   depth         arm's median lineage depth at least a quarter of the control's (DIR/trace.tsv; where
//                 it has no control row, because the control was copied in without its lineage
//                 tables, --control-depths gives the control's depth per seed, in --seeds order)
// Promising = at least --need seeds meet all three. Dead end = bound mass fails in at least --fail
// seeds (collapse; default 2) or depth is under its bar in at least --fail seeds (frozen). Unclear otherwise.
// A world with no assay replicates does not meet the regeneration criterion. Its bound mass is compared
// as measured (occupancy is not checked). Its depth is its trace row's; a NaN there (no lineage left),
// or no trace row at all, fails depth without counting towards frozen. So a world that died out meets
// no criterion and counts towards collapse only if its measured bound mass is under half the control's,
// which zero is. A control with no assay replicates stops the classifier (no label).
// Defaults: seeds 1-3 with 2 needed; with --replicate, seeds 4-8 with 3 needed. With --replicate the
// verdict is only whether at least --need seeds meet all three.
// Writes DIR/readout.md and prints it.
import { parseArgs } from "jsr:@std/cli@1/parse-args";

const a = parseArgs(Deno.args, { string: ["out", "arms", "seeds", "snapshot", "need", "fail", "control-depths"], boolean: ["replicate"], default: { snapshot: "1000000" } });
const OUT = a.out ?? (() => { throw new Error("--out DIR required"); })();
const CONTROL = "gradient-m3";
const arms = (a.arms ?? "").split(",").filter(Boolean);
if (!arms.length) throw new Error("--arms required");
const seeds = (a.seeds ?? (a.replicate ? "4-8" : "1-3")).split(",").flatMap((part) => { const [lo, hi] = part.split("-").map(Number); return hi === undefined ? [lo] : Array.from({ length: hi - lo + 1 }, (_, k) => lo + k); });
const snap = Number(a.snapshot), need = Number(a.need ?? (a.replicate ? 3 : 2)), fail = Number(a.fail ?? 2);

interface Assay { regen: number; reps: number; surv: number; stats: { B: number; P: number } }
const assay = async (arm: string, seed: number): Promise<Assay> => JSON.parse(await Deno.readTextFile(`${OUT}/assays/${arm}-s${seed}-t${snap}/result.json`));
const trace = (await Deno.readTextFile(`${OUT}/trace.tsv`)).trim().split("\n").map((l) => l.split("\t"));
const col = (name: string) => { const i = trace[0].indexOf(name); if (i < 0) throw new Error(`trace.tsv has no ${name} column`); return i; };
const [cArm, cSeed, cSnap, cDepth] = [col("arm"), col("seed"), col("snapshot"), col("depth_med")];
const extinct = new Set<string>(); // arm:seed with no assay replicates
const given = (a["control-depths"] ?? "").split(",").filter(Boolean).map(Number);
if (given.length && given.length !== seeds.length) throw new Error("--control-depths needs one value per seed");
const depth = (arm: string, seed: number): number => {
  const row = trace.find((r) => r[cArm] === arm && Number(r[cSeed]) === seed && Number(r[cSnap]) === snap);
  if (!row && arm === CONTROL && given.length) return given[seeds.indexOf(seed)];
  if (!row && arm !== CONTROL && extinct.has(`${arm}:${seed}`)) return NaN;
  if (!row) throw new Error(`trace.tsv has no row for ${arm} seed ${seed} at ${snap} (run own-trace.ts with that arm, or pass --control-depths)`);
  return Number(row[cDepth]); // NaN for a world with no lineage left
};

const md: string[] = [`# Readout at step ${snap}`, ``, `Per seed: regeneration at least control + 0.2 (raw counts), bound mass at least half the control's, median depth at least a quarter of the control's. Needed: ${need} of ${seeds.length} seeds on all three.`];
for (const arm of arms) {
  md.push(``, `## ${arm}`, ``, `| seed | regenerated | control | regeneration | bound mass vs control | mass | depth | control depth | depth ok | all three |`, `|---|---|---|---|---|---|---|---|---|---|`);
  let all = 0, massFail = 0, depthFail = 0;
  for (const seed of seeds) {
    const x = await assay(arm, seed), k = await assay(CONTROL, seed);
    if (!k.reps) throw new Error(`no assay replicates for the control, seed ${seed}`);
    if (!x.reps) extinct.add(`${arm}:${seed}`);
    // x.regen / x.reps - k.regen / k.reps >= 1/5, in integers; nothing to assay is not met.
    const regenOk = x.reps > 0 && 5 * (x.regen * k.reps - k.regen * x.reps) >= x.reps * k.reps;
    const bx = x.stats.B + x.stats.P, bk = k.stats.B + k.stats.P, massOk = 2 * bx >= bk;
    const dx = depth(arm, seed), dk = depth(CONTROL, seed), depthOk = 4 * dx >= dk; // false for NaN
    if (!Number.isFinite(dk)) throw new Error(`no control depth for seed ${seed}`);
    const ok = regenOk && massOk && depthOk;
    if (ok) all++;
    if (!massOk) massFail++;
    if (Number.isFinite(dx) && !depthOk) depthFail++;
    md.push(`| ${seed} | ${x.regen}/${x.reps} (${x.reps ? (x.regen / x.reps).toFixed(3) : "nothing to assay"}) | ${k.regen}/${k.reps} (${(k.regen / k.reps).toFixed(3)}) | ${regenOk ? "met" : "no"} | ${(bx / bk).toFixed(3)} | ${massOk ? "met" : "no"} | ${Number.isFinite(dx) ? dx : "-"} | ${dk} | ${depthOk ? "met" : "no"} | ${ok ? "yes" : "no"} |`);
  }
  const verdict = a.replicate
    ? all >= need ? `replicates (${all} of ${seeds.length})` : `does not replicate (${all} of ${seeds.length}, needed ${need})`
    : all >= need ? "Promising" : massFail >= fail ? "Dead end (collapse)" : depthFail >= fail ? "Dead end (frozen)" : "Unclear";
  md.push(``, `**${arm}: ${verdict}.** Seeds meeting all three: ${all} of ${seeds.length}; bound mass failed in ${massFail}, depth under its bar in ${depthFail}.`);
}
await Deno.writeTextFile(`${OUT}/readout.md`, md.join("\n") + "\n");
console.log(md.join("\n"));
