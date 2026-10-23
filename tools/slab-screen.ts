// Runs the rung 1b depth check's histories (docs/3d-rung1b-plan-2026-10-23.md section 5; docs/3d-rung1b-m5-plan.md section 6).
// Running only: tools/slab-readout.ts reads the bundles.
//
//   deno run -A --no-lock tools/slab-screen.ts --out runs/3d-slab/check1 --mu M --sigma S --light-k K \
//     [--arms evolving,neutral] [--seeds 1-3] [--steps 300000] [--experiment slab-check] [--census 1000] [--checkpoint 0] [--dry-run]
//
// --mu, --sigma and --light-k have no default: the M4 pick is typed in, never assumed. They go to tools/run.ts as
// `--override defaultMu=M,defaultSigma=S,lightK=K`, so every manifest records them in spec.overrides and cfg.
// Arms: evolving = condition treatment, neutral = condition neutral. Preset slab-spots, --deep 1 always.
// Seeds outer, arms inner, so an interrupted queue leaves matched pairs. --seeds takes lists and ranges ("1-3", "4-6", "2,5"):
// two machines take disjoint subsets, and the extension is the same command with --seeds 4-6.
// A bundle is <out>/<experiment>/slab-spots/<condition>/seed-<n>/. Per run: a manifest with a summary and the same spec
// (sameCompletedRun) whose activity-final.json and layers.tsv are whole (every census, 8 layers each) is skipped; a complete one with a different spec or config stops the queue (exit 2), never overwritten;
// an incomplete directory (including a summary with a missing or cut-off file) is removed and the run starts again from step 0 ("resumable" means exactly this: re-running the
// command picks up at the first unfinished run). The first failure stops the queue with exit 1.
// --dry-run lists each run, its state (complete, incomplete, absent) and a minutes estimate (200 steps/s), and runs nothing.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { parseOverrides, sameCompletedRun, specConfig, type RunSpec } from "@bl/runner";
import { validateConfig } from "@bl/schema";
import { layersIncomplete } from "./lib/slab-readout.ts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const PRESET = "slab-spots";
const ARMS: Record<string, string> = { evolving: "treatment", neutral: "neutral" };
const STEPS_PER_SECOND = 200; // the M3 timing gate's measure, rounded down

const a = parseArgs(Deno.args, {
  string: ["out", "mu", "sigma", "light-k", "arms", "seeds", "steps", "experiment", "census", "checkpoint"],
  boolean: ["dry-run"],
  default: { arms: "evolving,neutral", seeds: "1-3", steps: "300000", experiment: "slab-check", census: "1000", checkpoint: "0" },
});
const die = (msg: string, code = 2): never => {
  console.error(msg);
  Deno.exit(code);
};

function seedList(s: string): number[] {
  const out = s.split(",").flatMap((part) => {
    if (!/^\d+(-\d+)?$/.test(part.trim())) die(`--seeds ${JSON.stringify(s)}: expected a list or range of integers such as 1-3 or 2,5`);
    const [lo, hi] = part.trim().split("-").map(Number);
    return hi === undefined ? [lo] : Array.from({ length: Math.max(0, hi - lo + 1) }, (_, k) => lo + k);
  });
  if (out.length === 0 || new Set(out).size !== out.length) die(`--seeds ${JSON.stringify(s)}: empty or repeated seeds`);
  return out;
}
function intArg(name: string, v: string | undefined, min: number): number {
  if (v === undefined) die(`--${name} is required (the M4 pick, typed in: it has no default)`);
  if (!/^\d+$/.test(v!) || Number(v) < min) die(`--${name} ${JSON.stringify(v)}: expected an integer >= ${min}`);
  return Number(v);
}

const out = a.out ?? die("--out DIR is required");
const mu = intArg("mu", a.mu, 0), sigma = intArg("sigma", a.sigma, 1), lightK = intArg("light-k", a["light-k"], 1);
const steps = intArg("steps", a.steps, 1), census = intArg("census", a.census, 1), checkpoint = intArg("checkpoint", a.checkpoint, 0);
const arms = a.arms.split(",").map((x) => x.trim()).filter(Boolean);
for (const arm of arms) if (!(arm in ARMS)) die(`--arms: unknown arm ${JSON.stringify(arm)} (the arms are ${Object.keys(ARMS).join(", ")})`);
if (arms.length === 0 || new Set(arms).size !== arms.length) die("--arms: expected evolving, neutral or both, each once");
if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(a.experiment)) die("--experiment must match [a-z0-9_-]{1,64}");
const seeds = seedList(a.seeds);
const outAbs = out.startsWith("/") ? out : `${ROOT}/${out}`;
const overrideText = `defaultMu=${mu},defaultSigma=${sigma},lightK=${lightK}`;
const overrides = parseOverrides(overrideText);

function specFor(arm: string, seed: number): RunSpec {
  return { experiment: a.experiment, presetId: PRESET, condition: ARMS[arm], seed, steps, censusEvery: census, deepEvery: 1, checkpointEvery: checkpoint, overrides };
}
const dirOf = (spec: RunSpec) => `${outAbs}/${a.experiment}/${PRESET}/${spec.condition}/seed-${spec.seed}`;

// The same config check tools/run.ts makes, so a bad --mu/--sigma/--light-k fails here and not an hour in.
const cfgErrs = validateConfig(specConfig(specFor(arms[0], seeds[0])));
if (cfgErrs.length) die(`invalid slab config: ${cfgErrs.join("; ")}`);

type State = "complete" | "incomplete" | "absent";
async function stateOf(spec: RunSpec): Promise<State> {
  const dir = dirOf(spec);
  let done: Record<string, unknown>;
  try {
    done = JSON.parse(await Deno.readTextFile(`${dir}/manifest.json`));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      try {
        await Deno.stat(dir);
        return "incomplete";
      } catch {
        return "absent";
      }
    }
    return "incomplete"; // a manifest cut off mid-write
  }
  if (!done.summary) return "incomplete";
  if (!sameCompletedRun(done, spec)) die(`refusing to touch ${dir}: it holds a complete run with a different spec, config or rule version; choose a new --out or --experiment`);
  // The runner writes the summary before its last file, and layers.tsv grows census by census: a summary alone does not make
  // a whole bundle. Complete means activity-final.json (the last write) exists and layers.tsv holds every census.
  try {
    JSON.parse(await Deno.readTextFile(`${dir}/activity-final.json`)); // present and whole (an interrupted last write is empty or cut off)
    const why = layersIncomplete(await Deno.readTextFile(`${dir}/layers.tsv`), spec.steps, spec.censusEvery);
    if (why) {
      console.log(`${dir}: ${why}`);
      return "incomplete";
    }
  } catch {
    return "incomplete";
  }
  return "complete";
}

const queue: { arm: string; spec: RunSpec }[] = [];
for (const seed of seeds) for (const arm of arms) queue.push({ arm, spec: specFor(arm, seed) });

if (a["dry-run"]) {
  let total = 0;
  for (const { arm, spec } of queue) {
    const state = await stateOf(spec);
    const minutes = state === "complete" ? 0 : spec.steps / STEPS_PER_SECOND / 60;
    total += minutes;
    console.log(`${arm.padEnd(8)} seed ${String(spec.seed).padEnd(3)} ${state.padEnd(10)} ${state === "complete" ? "-" : `~${minutes.toFixed(0)} min`}  ${dirOf(spec)}`);
  }
  console.log(`${queue.length} runs, ~${total.toFixed(0)} min to go at ${STEPS_PER_SECOND} steps/s; overrides ${overrideText}`);
  Deno.exit(0);
}

for (const { arm, spec } of queue) {
  const state = await stateOf(spec);
  if (state === "complete") {
    console.log(`skip ${arm} seed ${spec.seed} (complete)`);
    continue;
  }
  if (state === "incomplete") {
    console.log(`removing the incomplete ${dirOf(spec)} and starting from step 0`);
    await Deno.remove(dirOf(spec), { recursive: true });
  }
  const t0 = performance.now();
  const child = new Deno.Command(Deno.execPath(), {
    args: [
      "run", "-A", "--no-lock", "tools/run.ts",
      "--experiment", a.experiment, "--preset", PRESET, "--conditions", spec.condition, "--seeds", String(spec.seed),
      "--steps", String(steps), "--census", String(census), "--deep", "1", "--checkpoint", String(checkpoint),
      "--override", overrideText, "--out", outAbs,
    ],
    cwd: ROOT,
    stdout: "piped",
    stderr: "inherit",
  }).spawn();
  // Tee the run's progress lines, keeping the last "done:" line for the st/s figure.
  let doneLine = "";
  const dec = new TextDecoder();
  let buf = "";
  for await (const chunk of child.stdout) {
    buf += dec.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      console.log(line);
      if (/done: \d+ st\/s/.test(line)) doneLine = line;
    }
  }
  if (buf) console.log(buf);
  const status = await child.status;
  const wall = (performance.now() - t0) / 1000;
  if (!status.success) die(`FAIL ${arm} seed ${spec.seed} after ${wall.toFixed(0)}s (exit ${status.code}); fix it and re-run this command to continue`, 1);
  const m = doneLine.match(/done: (\d+) st\/s/);
  console.log(`${arm} seed ${spec.seed}: ${(wall / 60).toFixed(1)} min wall, ${(steps / wall).toFixed(0)} steps/s wall${m ? `, ${m[1]} st/s in run` : ""}`);
}
console.log("queue complete");
