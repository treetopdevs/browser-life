// The transition hunt's Stage 1 queue (docs/scaffold-transition-hunt-v1.md, "Arms and histories", "Assay", "Validity", "Seeds" and "Compute and budget", and its
// Amendment 1): every command of the three instances, in a fixed order, from tools/lib/hunt-assay.ts's own seed formulas, set ids and paths.
//
//   deno run -A tools/hunt1-queue.ts --device-ref HASH [--out experiments/scaffold/hunt1-queue.json] [--ops DIR]
//
// --device-ref is the device check's `summary.finalHash` on the Mac (tools/run.ts --out runs/scaffold/hunt1 --experiment device --preset ponds
// --conditions pond-nat --seeds 4905001 --steps 20000 --census 1000 --deep 10 --checkpoint 0). The queue manifest (--out, committed before any instance
// starts) lists every command with its id, instance, dependencies and text, the files each instance needs from the registration (`ship`) and the two
// reproducibility reruns of the Mac; scaffold-report.ts hunt1 --queue reads it (reg1ReportQueueCheck). --ops also writes, for the registration's lanes:
//   cmds-<n>.txt   instance n's commands, one "id|deps|command" line each, in queue order (lane.sh runs the first ready one);
//   ship-<n>.txt   the registration files instance n needs under ~/bl (its -s sources' manifest.json and checkpoints/b100-pre.blck, nothing else);
//   history.sh     a history or ancestor world at census 1,000 (a -s history branching from its source), rerun at census 100 under <experiment>-c100
//                  only when the first run stopped on event-buffer overflow (tools/hunt1-ops/history.sh);
//   devcheck.sh    the device check: the pinned hunt text, then the device spec's finalHash against --device-ref;
//   lane.sh, start.sh, watchdog.sh   the hunt's (tools/hunt1-ops/): lane.sh runs each command in a process group of its own, publishes it in the claim before the command
//                  runs and kills what survives the command before it retries or publishes a status; start.sh takes an OS-held lock (flock; the kernel releases it), starts only the missing lanes and releases a
//                  claim only when its lane and its command's group are both gone (`start.sh sweep` is the watchdog's, under the same lock); watchdog.sh never powers the
//                  instance off (the absolute deadline of launch.sh's user-data, launch + 13 h, bounds the compute).
//
// Instances take the indices i = 0-7, 8-15 and 16-23, all four arms of an index on one instance: -s pair i branches from the registration's scaf history
// 4,850,001 + i at boundary 100 (runs/scaffold/reg1/hist/ponds/treatment/seed-<n>), whose manifest.json and checkpoints/b100-pre.blck the instance is
// shipped. Order on each instance: the device check; its histories, interleaved by index (nat-a, shuf-a, nat-s, shuf-s: the two 2 x 10^6-step histories of an
// index before its two 10^6-step ones); the ancestor worlds (instance 1) or ancestor world 0 again as `anc-copy` (instances 2 and 3: the genome-only sets'
// fragment source, an identical deterministic state, authenticated by the report against instance 1's canonical `anc` bundle); then its assay sets, the -s source
// sets first, then the ancestor sets (instance 1), then each history's sets in index order, then the genome control (instance 1). Every command depends on the
// device check, so a failed check runs nothing on that instance; each assay also depends on the commands producing its inputs.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import {
  HUNT1_HISTORIES,
  HUNT1_HISTORY_ARMS,
  HUNT1_PROTOCOL,
  HUNT1_REGIME,
  hunt1AncestorSeed,
  hunt1AssayDirOf,
  hunt1ExpectedSets,
  hunt1HistorySeed,
  hunt1SeedOf,
  hunt1SourceDirsOf,
  type Hunt1HistoryArm,
  type Hunt1Set,
  type Hunt1Source,
} from "./lib/hunt-assay.ts";
import { reg1PreCycleFileOf } from "./lib/pond-assay.ts";
import { randomKey } from "./lib/ponds.ts";

const a = parseArgs(Deno.args, { string: ["device-ref", "out", "ops"], default: { out: "experiments/scaffold/hunt1-queue.json" } });
if (!a["device-ref"] || !/^[0-9a-f]{16}$/.test(a["device-ref"])) throw new Error("--device-ref must be the Mac's device-check finalHash (16 hex digits)");

type Instance = 1 | 2 | 3;
const INSTANCES = [[0, 7], [8, 15], [16, 23]] as const;
const ARMS = HUNT1_HISTORY_ARMS;
const OUT = "runs/scaffold/hunt1";
const DEVICE_SEED = 4_905_001;
const REPRO_SEED = 4_905_101;
const HISTORY_STEPS = 2_000_000;
const BRANCH_STEPS = 1_000_000;
const BRANCH = 100;
const ANCESTOR_STEPS = 10_000;
const DEVICE_STEPS = 20_000;
const REPRO_STEPS = 340_000;
/** The pre-cycle checkpoints a history writes: boundary 34 (-a) or 134 (-s), the reproducibility check's, and time C, 200. */
const PRE_CYCLE = { a: "34,200", s: "134,200" } as const;
const T = "deno run -A tools/scaffold-assays.ts";
const { k, period, ref, side, censusEvery, export: zone, replicates } = HUNT1_REGIME;
const RG = `--k ${k} --period ${period} --ref ${ref} --side ${side} --census ${censusEvery} --export ${zone} --replicates ${replicates}`;
const DEVICE_SPEC = `tools/run.ts --out ${OUT} --experiment device --preset ponds --conditions pond-nat --seeds ${DEVICE_SEED} --steps ${DEVICE_STEPS} --census 1000 --deep 10 --checkpoint 0`;

const conditionOf = (arm: Hunt1HistoryArm): string => `pond-${arm.startsWith("nat") ? "nat" : "shuf"}`;
const bundleDir = (experiment: string, condition: string, seed: number): string => `${OUT}/${experiment}/ponds/${condition}/seed-${seed}`;
const histSeed = (arm: Hunt1HistoryArm, i: number): number => hunt1HistorySeed(ARMS.indexOf(arm), i);
/** The registration's scaf history i (the -s source i) as an instance finds it, and the two files of it the instance is shipped. */
const sourceDir = (i: number): string => `runs/${hunt1SourceDirsOf(i)[0]}`;
const shipOf = (i: number): string[] => [`${sourceDir(i)}/manifest.json`, `${sourceDir(i)}/${reg1PreCycleFileOf(BRANCH)}`];
const pad2 = (i: number): string => String(i).padStart(2, "0");
const histId = (arm: Hunt1HistoryArm, i: number): string => `h-${arm}-i${pad2(i)}`;
/** Ancestor world j on instance 1; instances 2 and 3 run world 0 again, and queue ids are unique across instances. */
const ancId = (j: number, n: Instance): string => (n === 1 ? `h-anc-j${j}` : `h-anc-copy-${n}`);

interface Command {
  id: string;
  instance: Instance;
  deps: string[];
  cmd: string;
}
const commands: Command[] = [];
const ids = new Set<string>();
const steps = new Map<Instance, number>();
function add(instance: Instance, id: string, deps: string[], cmd: string, work: number): void {
  if (ids.has(id)) throw new Error(`duplicate command id ${id}`);
  for (const d of deps) if (!ids.has(d)) throw new Error(`${id} depends on ${d}, which is not earlier in the queue`);
  ids.add(id);
  commands.push({ id, instance, deps, cmd });
  steps.set(instance, (steps.get(instance) ?? 0) + work);
}

/** The directory of an assay set's source (or genome donor) as instance `n` has it: a history's bundle, an ancestor world (world 0 is `anc-copy` off instance 1), a -s source's registration bundle. */
function pathOf(s: Hunt1Source, n: Instance): string {
  if (s.kind === "hist") return bundleDir("hist", conditionOf(s.arm), histSeed(s.arm, s.i));
  if (s.kind === "anc") return bundleDir(n === 1 ? "anc" : "anc-copy", "pond-cont", hunt1AncestorSeed(s.j));
  if (s.kind === "src") return sourceDir(s.i);
  throw new Error(`no Stage 1 set reads a ${s.kind} source`);
}

/** The command producing a bundle `s` of instance `n`, null for a source that is shipped (the registration's). */
function producerOf(s: Hunt1Source, n: Instance): string | null {
  if (s.kind === "hist") return histId(s.arm, s.i);
  if (s.kind === "anc") return ancId(s.j, n);
  return null;
}

function setCommand(set: Hunt1Set, n: Instance): string {
  const l = set.labels;
  const flags = [`--stage ${l.stage} --set ${l.set} --source ${pathOf(set.source, n)}`, ...(l.variant === "quench" ? ["--quench"] : []), ...(set.donor === null ? [] : [`--genome-from ${pathOf(set.donor, n)}`]), ...(l.variant === "genome-control" ? ["--genome-founder"] : [])];
  return `${T} export --hunt1 ${flags.join(" ")} ${RG} --seed ${hunt1SeedOf(l, 0)} --out runs/${hunt1AssayDirOf(l)}`;
}

const sets = hunt1ExpectedSets("s1");
const setById = new Map(sets.map((s) => [s.labels.set, s]));
/** The sets instance `n` runs, in the order the queue runs them (see the header). */
function orderedSets(n: Instance): Hunt1Set[] {
  const [lo, hi] = INSTANCES[n - 1];
  const is = Array.from({ length: hi - lo + 1 }, (_, d) => lo + d);
  const ids = [
    ...is.map((i) => `s1-src-i${pad2(i)}`),
    ...(n === 1 ? [0, 1, 2, 3].map((j) => `s1-anc-j${j}`) : []),
    ...is.flatMap((i) => ARMS.flatMap((arm) => [`s1-${arm}-i${pad2(i)}`, ...(arm.startsWith("nat") ? [`s1-${arm}-i${pad2(i)}-quench`] : []), `s1-${arm}-i${pad2(i)}-genome`])),
    ...(n === 1 ? ["s1-genome-control"] : []),
  ];
  return ids.map((id) => {
    const set = setById.get(id);
    if (set === undefined) throw new Error(`${id} is no Stage 1 set`);
    return set;
  });
}

for (const [n0, [lo, hi]] of INSTANCES.entries()) {
  const n = (n0 + 1) as Instance;
  const dc = `devcheck-${n}`;
  add(n, dc, [], "bash ops/devcheck.sh", DEVICE_STEPS);
  // Histories, interleaved by index; then the ancestor worlds (instance 1: all four, the others: world 0 again, as anc-copy).
  for (let i = lo; i <= hi; i++)
    for (const arm of ARMS) {
      const s = arm.endsWith("-s");
      add(n, histId(arm, i), [dc], `bash ops/history.sh hist ${conditionOf(arm)} ${histSeed(arm, i)} ${s ? BRANCH_STEPS : HISTORY_STEPS} ${s ? PRE_CYCLE.s : PRE_CYCLE.a}${s ? ` ${sourceDir(i)}` : ""}`, s ? BRANCH_STEPS : HISTORY_STEPS);
    }
  for (let j = 0; j < (n === 1 ? 4 : 1); j++) add(n, ancId(j, n), [dc], `bash ops/history.sh ${n === 1 ? "anc" : "anc-copy"} pond-cont ${hunt1AncestorSeed(j)} ${ANCESTOR_STEPS} 1`, ANCESTOR_STEPS);
  // Assay sets, each after the commands producing its inputs.
  for (const set of orderedSets(n)) {
    const deps = [dc, ...[set.source, ...(set.donor === null ? [] : [set.donor])].map((s) => producerOf(s, n)).filter((d): d is string => d !== null)];
    add(n, `a-${set.labels.set}`, [...new Set(deps)], setCommand(set, n), set.replicates * period);
  }
}

// Every expected set is produced exactly once, and nothing else is.
const produced = commands.filter((c) => c.id.startsWith("a-")).map((c) => c.id.slice(2));
if (new Set(produced).size !== produced.length || produced.length !== sets.length || sets.some((s) => !produced.includes(s.labels.set))) throw new Error(`queue produces ${produced.length} sets, Stage 1 expects ${sets.length}, each once`);

// The reproducibility draw (Validity 7): the first two distinct values of randomKey(4,905,101, 0, k, 0) mod 96 for k = 0, 1, ..., indexing the histories in seed order
// (nat-a 0-23, shuf-a 24-47, nat-s 48-71, shuf-s 72-95); each is rerun on the Mac for 34 boundaries from its start.
const draws: { k: number; value: number }[] = [];
for (let n = 0; new Set(draws.map((d) => d.value)).size < 2; n++) draws.push({ k: n, value: randomKey(REPRO_SEED, 0, n, 0) % (ARMS.length * HUNT1_HISTORIES) });
const reruns = [...new Set(draws.map((d) => d.value))].map((value) => {
  const arm = ARMS[Math.floor(value / HUNT1_HISTORIES)];
  const i = value % HUNT1_HISTORIES;
  const s = arm.endsWith("-s");
  const flags = `--out ${OUT} --experiment repro --preset ponds --conditions ${conditionOf(arm)} --seeds ${histSeed(arm, i)} --steps ${REPRO_STEPS} --census 1000 --deep 10 --checkpoint 0 --pre-cycle ${s ? 134 : 34}`;
  return { value, history: `${arm}-i${pad2(i)}`, seed: histSeed(arm, i), boundary: s ? 134 : 34, cmd: `deno run -A tools/run.ts ${flags}${s ? ` --branch-from ${sourceDir(i)} --branch-boundary ${BRANCH}` : ""}` };
});

const manifest = {
  hunt: HUNT1_PROTOCOL,
  deviceRef: { spec: DEVICE_SPEC, finalHash: a["device-ref"] },
  instances: INSTANCES.map(([lo, hi], q) => ({
    instance: q + 1,
    histories: [lo, hi],
    ship: Array.from({ length: hi - lo + 1 }, (_, d) => shipOf(lo + d)).flat(),
    estimatedSteps: steps.get((q + 1) as Instance),
  })),
  mac: {
    reproducibility: {
      draw: `randomKey(${REPRO_SEED}, 0, k, 0) mod 96, the first two distinct values, histories in seed order`,
      draws,
      reruns,
    },
  },
  commands,
};
await Deno.writeTextFile(a.out, JSON.stringify(manifest, null, 1) + "\n");
console.log(`${commands.length} commands (${INSTANCES.map((_, q) => commands.filter((c) => c.instance === q + 1).length).join(" / ")}), ${produced.length} sets, ${[1, 2, 3].map((n) => steps.get(n as Instance)).join(" / ")} steps -> ${a.out}`);

if (a.ops) {
  await Deno.mkdir(a.ops, { recursive: true });
  for (const n of [1, 2, 3] as const) {
    await Deno.writeTextFile(`${a.ops}/cmds-${n}.txt`, commands.filter((c) => c.instance === n).map((c) => `${c.id}|${c.deps.length ? c.deps.join(",") : "-"}|${c.cmd}`).join("\n") + "\n");
    await Deno.writeTextFile(`${a.ops}/ship-${n}.txt`, manifest.instances[n - 1].ship.join("\n") + "\n");
  }
  // lane.sh, start.sh, watchdog.sh and history.sh are the hunt's (tools/hunt1-ops/); devcheck.sh carries --device-ref.
  for (const f of ["lane.sh", "start.sh", "watchdog.sh", "history.sh"]) await Deno.copyFile(new URL(`./hunt1-ops/${f}`, import.meta.url), `${a.ops}/${f}`);
  await Deno.writeTextFile(
    `${a.ops}/devcheck.sh`,
    `#!/bin/bash
# devcheck.sh: the hunt's device check (Validity 1), every instance's first command. The instance must run the pinned hunt text, and the device spec's
# finalHash must equal the Mac's.
set -u
cd ~/bl || exit 1
export PATH=$HOME/.deno/bin:$PATH
[ "$(head -c ${HUNT1_PROTOCOL.bytes} ${HUNT1_PROTOCOL.doc} | sha256sum | cut -c1-64)" = ${HUNT1_PROTOCOL.sha256} ] || { echo "the hunt is not the pinned text"; exit 1; }
rm -rf ${OUT}/device
deno run -A ${DEVICE_SPEC} || { echo "device run failed"; exit 1; }
got=$(python3 -c "import json,glob; print(json.load(open(glob.glob('${OUT}/device/ponds/pond-nat/seed-${DEVICE_SEED}/manifest.json')[0]))['summary']['finalHash'])")
echo "device finalHash $got, Mac ${a["device-ref"]}"
[ "$got" = "${a["device-ref"]}" ] && echo "DEVICE CHECK PASS" || { echo "DEVICE CHECK FAIL"; exit 1; }
`,
  );
  console.log(`ops files -> ${a.ops}`);
}
