// The scaffolding registration's queue (docs/scaffold-registration-v1.md, "Execution order and stopping", and its Amendment 1):
// every command of the three instances, in the frozen order, from tools/lib/pond-assay.ts's own formulas and paths.
//
//   deno run -A tools/reg1-queue.ts --device-ref HASH [--out experiments/scaffold/reg1-queue.json] [--ops DIR]
//
// --device-ref is the device check's `summary.finalHash` on the Mac (tools/run.ts --out runs/scaffold/reg1 --experiment device
// --preset ponds --conditions treatment --seeds 4880301 --steps 20000 --census 1000 --deep 10 --checkpoint 0). The queue
// manifest (--out, committed before any instance starts) lists every command with its id, instance, dependencies and text;
// scaffold-report.ts reg1 --queue reads it. --ops also writes, for the lanes of the R3 replication's tooling:
//   cmds-<n>.txt   instance n's commands, one "id|deps|command" line each, in queue order (lane.sh runs the first ready one);
//   history.sh     a history or ancestor world at census 1,000, rerun at census 100 under <experiment>-c100 only when the
//                  first run stopped on event-buffer overflow (validity step 3);
//   devcheck.sh    the device check: the pinned registration text, then the device spec's finalHash against --device-ref;
//   lane.sh        one lane: runs ops/cmds.txt (instance n's cmds-<n>.txt, copied there) in order, honouring ~ dependencies.
//
// Assay commands name a source by its census-1,000 directory; the assay tool resolves it to whichever of that directory and its
// -c100 rerun holds the one complete bundle (tools/lib/pond-assay.ts, reg1BundleWantsOf), so a rerun needs no queue change.
//
// Order on each instance: the device check; its histories, interleaved by index (scaf_i, rand_i, cont_i); its ancestor worlds;
// its continuations; its competence sets; its S2 sets; its S3 sets. Instance 1 then makes the four negative-control worlds and
// runs the six S3 control sets, after its S3 sets have finished. A dependency written ~id is ordering-only: the lane waits until
// id is done or has failed, and a failure does not propagate (the controls must not be lost to one failed S3 set). Instances take i = 0-7, 8-15 and 16-23. Every command depends on the device check, so a failed
// check runs nothing on that instance; each other command also depends on the commands that produce its inputs.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import {
  REG1_ANCESTOR_STEPS,
  REG1_CAPABILITY_LABELS,
  REG1_COMPETENCE_SETS,
  REG1_CONTINUE_STEPS,
  REG1_DEVICE_SEED,
  REG1_HISTORY_STEPS,
  REG1_PROTOCOL,
  reg1AssayDirOf,
  reg1BundleDirOf,
  reg1ContinuationPathOf,
  reg1ContinueSeed,
  reg1ControlPathOf,
  reg1ExpectedSets,
  reg1H,
  reg1HeredityLabelsOf,
  reg1IdOf,
  reg1HistoryOf,
  reg1NegativeSeed,
  reg1ReplicatesOf,
  reg1SeedsOf,
  reg1SetIdOf,
  reg1WorldSeedOf,
  type Reg1LabelSet,
} from "./lib/pond-assay.ts";

const a = parseArgs(Deno.args, { string: ["device-ref", "out", "ops"], default: { out: "experiments/scaffold/reg1-queue.json" } });
if (!a["device-ref"] || !/^[0-9a-f]{16}$/.test(a["device-ref"])) throw new Error("--device-ref must be the Mac's device-check finalHash (16 hex digits)");

const INSTANCES = [[0, 7], [8, 15], [16, 23]] as const;
const ARMS = ["scaf", "rand", "cont"] as const;
const T = "deno run -A tools/scaffold-assays.ts";
const RG = "--k 8 --period 10000 --ref 103058 --side 8 --census 100";
const bundle = (h: number) => `runs/${reg1BundleDirOf(h)}`;
const assayOut = (l: Reg1LabelSet) => `runs/${reg1AssayDirOf(l)}`;
const runId = (h: number) => `h-${reg1IdOf(reg1HistoryOf(h))}`;
const contId = (h: number) => `c-${reg1IdOf(reg1HistoryOf(h))}`;

interface Command {
  id: string;
  instance: 1 | 2 | 3;
  deps: string[];
  cmd: string;
}
const commands: Command[] = [];
const ids = new Set<string>();
function add(instance: 1 | 2 | 3, id: string, deps: string[], cmd: string): void {
  if (ids.has(id)) throw new Error(`duplicate command id ${id}`);
  for (const d of deps) if (!ids.has(d.replace(/^~/, ""))) throw new Error(`${id} depends on ${d}, which is not earlier in the queue`);
  ids.add(id);
  commands.push({ id, instance, deps, cmd });
}

const conditionOf = { scaf: "treatment", rand: "pond-rand", cont: "pond-cont", ancestor: "pond-cont" } as const;
for (const [n0, [lo, hi]] of INSTANCES.entries()) {
  const n = (n0 + 1) as 1 | 2 | 3;
  const dc = `devcheck-${n}`;
  add(n, dc, [], "bash ops/devcheck.sh");
  const is = Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
  // Histories, interleaved by index; then the ancestor worlds.
  for (const i of is)
    for (const arm of ARMS) {
      const h = reg1H(arm, i);
      add(n, runId(h), [dc], `bash ops/history.sh hist ${conditionOf[arm]} ${reg1WorldSeedOf(h)} ${REG1_HISTORY_STEPS} 34,100`);
    }
  for (const i of is) {
    const h = reg1H("ancestor", i);
    add(n, runId(h), [dc], `bash ops/history.sh anc pond-cont ${reg1WorldSeedOf(h)} ${REG1_ANCESTOR_STEPS} 1`);
  }
  // Continuations (timing b).
  for (const i of is)
    for (const arm of [...ARMS, "ancestor"] as const) {
      const h = reg1H(arm, i);
      add(n, contId(h), [dc, runId(h)], `${T} continue --reg1 --arm ${arm} --history ${i} --source ${bundle(h)} --steps ${REG1_CONTINUE_STEPS} --seed ${reg1ContinueSeed(h)} --census 100 --out runs/${reg1ContinuationPathOf(h)}`);
    }
  // Competence sets.
  const sets = reg1ExpectedSets();
  for (const i of is)
    for (const l of sets.filter((l) => l.history === i && (REG1_COMPETENCE_SETS as readonly string[]).includes(l.set))) {
      const h = l.h!;
      // Ge-on-Fa and Ga-on-Fa read ancestor_i's (a) world (their h is 72 + i); every other set reads its own history.
      const srcH = l.set === "ge-on-fa" || l.set === "ga-on-fa" ? reg1H("ancestor", i) : h;
      const deps = [dc, l.timing === "b" ? contId(srcH) : runId(srcH)];
      let swap = "";
      if (l.set === "ge-on-fa") {
        swap = ` --swap-from ${bundle(reg1H("scaf", i))}`;
        deps.push(runId(reg1H("scaf", i)));
      }
      const src = l.timing === "b" ? `runs/${reg1ContinuationPathOf(srcH)}` : bundle(srcH);
      add(n, `a-${reg1SetIdOf(l)}`, deps, `${T} competence --reg1 --set ${l.set} --arm ${l.arm} --history ${i} --timing ${l.timing} --source ${src}${swap} ${RG} --replicates ${reg1ReplicatesOf(l)} --seed ${reg1SeedsOf(l, 0).physics} --out ${assayOut(l)}`);
    }
  // S2 (garden) sets.
  for (const i of is)
    for (const l of sets.filter((l) => l.history === i && l.set.startsWith("garden"))) {
      const sd = reg1SeedsOf(l, 0);
      const frag = sd.fragment !== sd.physics ? ` --frag-seed ${sd.fragment}` : "";
      add(n, `a-${reg1SetIdOf(l)}`, [dc, runId(l.h!)], `${T} garden --reg1 --arm ${l.arm} --history ${i} --time ${l.time} --inoculum ${l.set === "garden-disc" ? "disc" : "fragment"} --source ${bundle(l.h!)} ${RG} --replicates 2 --seed ${sd.physics}${frag} --out ${assayOut(l)}`);
    }
  // S3 (heredity) sets.
  for (const i of is)
    for (const l of sets.filter((l) => l.set === "heredity" && l.history === i))
      add(n, `a-${reg1SetIdOf(l)}`, [dc, runId(l.h!)], `${T} transmission --reg1 --traits --h ${l.h} --arm ${l.arm} --history ${i} --source ${bundle(l.h!)} --k 8 --period 10000 --side 8 --replicates 2 --census 100 --seed ${reg1SeedsOf(l, 0).physics} --out ${assayOut(l)}`);
  // S3 controls, on instance 1 after its S3 sets (each control command depends on every one of them, so a free lane cannot
  // start the controls early): the negative-control worlds, then the six control sets.
  if (n === 1) {
    const s3 = commands.filter((c) => c.instance === 1 && c.id.startsWith("a-heredity-")).map((c) => `~${c.id}`);
    for (let j = 0; j < 4; j++)
      // tools/scaffold.ts refuses an existing --out without --resume, so a retry resumes (as the R3 replication's queue did);
      // a directory left without its meta.json (killed before writing it) is removed first.
      add(n, `n-j${j}`, [dc, ...s3], `D=runs/scaffold/reg1/neg/j${j}; [ -d $D ] && [ ! -f $D/meta.json ] && rm -rf $D; R=""; [ -f $D/meta.json ] && R=--resume; deno run -A tools/scaffold.ts evolve --arm cont --init clone --mut-off --period 10000 --cycles 1 --side 8 --seed ${reg1NegativeSeed(j)} --out $D $R`);
    for (let h = 48; h < 54; h++) {
      const l = reg1HeredityLabelsOf(h);
      const deps = [dc, ...s3, ...(l.control === "negative" ? [`n-j${h - 50}`] : [])];
      add(n, `a-${reg1SetIdOf(l)}`, deps, `${T} transmission --reg1 --traits --h ${h} --arm control --control ${l.control} --source runs/${reg1ControlPathOf(h)} --k 8 --period 10000 --side 8 --replicates 2 --census 100 --seed ${reg1SeedsOf(l, 0).physics} --out ${assayOut(l)}`);
    }
  }
}

// Every expected set is produced exactly once, and nothing else is (R4 runs on the Mac, after the pull).
const produced = new Set(commands.filter((c) => c.id.startsWith("a-")).map((c) => c.id.slice(2)));
const expected = reg1ExpectedSets().filter((l) => l.set !== "capability").map(reg1SetIdOf);
for (const id of expected) if (!produced.has(id)) throw new Error(`expected set ${id} has no command`);
if (produced.size !== expected.length) throw new Error(`queue produces ${produced.size} sets, the registration expects ${expected.length}`);

const manifest = {
  registration: REG1_PROTOCOL,
  deviceRef: { spec: `tools/run.ts --out runs/scaffold/reg1 --experiment device --preset ponds --conditions treatment --seeds ${REG1_DEVICE_SEED} --steps 20000 --census 1000 --deep 10 --checkpoint 0`, finalHash: a["device-ref"] },
  instances: INSTANCES.map(([lo, hi], k) => ({ instance: k + 1, histories: [lo, hi] })),
  mac: {
    capability: `${T} capability --reg1 --runs runs --seed 1 --out ${assayOut(REG1_CAPABILITY_LABELS)}`,
    reproducibility: "tools/run.ts --out runs/scaffold/reg1 --experiment repro, steps 340,000, census 1,000, --pre-cycle 34, for the two histories the draw selects",
  },
  commands,
};
await Deno.writeTextFile(a.out, JSON.stringify(manifest, null, 1) + "\n");
console.log(`${commands.length} commands (${INSTANCES.map((_, k) => commands.filter((c) => c.instance === k + 1).length).join(" / ")}), ${produced.size} sets -> ${a.out}`);

if (a.ops) {
  await Deno.mkdir(a.ops, { recursive: true });
  for (const n of [1, 2, 3] as const)
    await Deno.writeTextFile(`${a.ops}/cmds-${n}.txt`, commands.filter((c) => c.instance === n).map((c) => `${c.id}|${c.deps.length ? c.deps.join(",") : "-"}|${c.cmd}`).join("\n") + "\n");
  // history.sh, lane.sh, start.sh and watchdog.sh are committed as they are (tools/reg1-ops/); devcheck.sh carries --device-ref.
  for (const f of ["history.sh", "lane.sh", "start.sh", "watchdog.sh"]) await Deno.copyFile(new URL(`./reg1-ops/${f}`, import.meta.url), `${a.ops}/${f}`);
  await Deno.writeTextFile(
    `${a.ops}/devcheck.sh`,
    `#!/bin/bash
# devcheck.sh: the registration's device check (validity step 1), every instance's first command. The instance must run the
# pinned registration text, and the device spec's finalHash must equal the Mac's.
set -u
cd ~/bl || exit 1
export PATH=$HOME/.deno/bin:$PATH
[ "$(head -c ${REG1_PROTOCOL.bytes} ${REG1_PROTOCOL.doc} | sha256sum | cut -c1-64)" = ${REG1_PROTOCOL.sha256} ] || { echo "the registration is not the pinned text"; exit 1; }
rm -rf runs/scaffold/reg1/device
deno run -A tools/run.ts --out runs/scaffold/reg1 --experiment device --preset ponds --conditions treatment --seeds ${REG1_DEVICE_SEED} --steps 20000 --census 1000 --deep 10 --checkpoint 0 || { echo "device run failed"; exit 1; }
got=$(python3 -c "import json,glob; print(json.load(open(glob.glob('runs/scaffold/reg1/device/ponds/treatment/seed-${REG1_DEVICE_SEED}/manifest.json')[0]))['summary']['finalHash'])")
echo "device finalHash $got, Mac ${a["device-ref"]}"
[ "$got" = "${a["device-ref"]}" ] && echo "DEVICE CHECK PASS" || { echo "DEVICE CHECK FAIL"; exit 1; }
`,
  );
  console.log(`ops files -> ${a.ops}`);
}
