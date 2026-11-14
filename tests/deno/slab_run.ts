// The slab runner (rung 1b M5, docs/3d-rung1b-m5-plan.md) on a real native WebGPU device.
//
//  1. runExperiment on GpuSim3 against a lockstep RefSim3: slab-spots shrunk to 32 x 32 x 8, 60 steps, census 20, deep 1, both
//     conditions. layers.tsv, lineages.tsv and the series fields the slab keeps (individuals, living cells, roles) equal, as text,
//     what RefSim3 + census3 + layerRoles give independently; the final state is RefSim3's; conservation exact; no 2D-only keys.
//  2. A rehearsal at full size: 256 x 256 x 8, 3,000 steps, census 1,000, deep 1, one seed per arm through tools/slab-screen.ts,
//     then tools/slab-readout.ts --rehearsal-steps 3000. It exercises the pipeline end to end and prints what the real check
//     needs to know: the census cost per 1,000 steps, the sizes of layers.tsv and lineages.tsv, and the mutation events per
//     census against the event buffer (an overflow stops the run, so a clean run shows none at 1,000-step censuses early on).
//
// Run from the repo root: deno run -A --no-lock tests/deno/slab_run.ts
import { SLAB_PRESETS, cloneState, initWorld, presetConfig, stateHash } from "@bl/schema";
import { requestDeviceFor } from "@bl/sim-gpu";
import { RefSim3 } from "@bl/sim-ref";
import { G, cellCount } from "@bl/schema";
import { individuals, layerRoles, layersRows, census3, lineageProfiles, roleSummary, LAYERS_HEADER } from "@bl/metrics";
import { runExperiment, specConfig, type RunSpec, type Sink } from "@bl/runner";

class Mem implements Sink {
  files = new Map<string, string>();
  bytes = new Map<string, Uint8Array>();
  async writeText(p: string, t: string) { this.files.set(p, t); }
  async appendText(p: string, t: string) { this.files.set(p, (this.files.get(p) ?? "") + t); }
  async writeBytes(p: string, b: Uint8Array) { this.bytes.set(p, b); }
}
let ok = true;
let checks = 0, failures = 0;
const check = (name: string, cond: boolean, detail = "") => {
  checks++;
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail && !cond ? `: ${detail.slice(0, 600)}` : ""}`);
  ok &&= cond;
};
const T0 = performance.now();
const ROOT = new URL("../../", import.meta.url).pathname;
const host = { host: "test", adapter: "test" };
const preset = SLAB_PRESETS[0];

// ---- 1. the real GPU through runExperiment against a lockstep RefSim3
console.log("-- 1. runExperiment on GpuSim3 against RefSim3");
const small: RunSpec = { experiment: "slab-run", presetId: "slab-spots", condition: "treatment", seed: 101, steps: 60, censusEvery: 20, deepEvery: 1, checkpointEvery: 0, overrides: { tileW: 32, tileH: 32 } };
const device = await requestDeviceFor(navigator.gpu, specConfig(small));
for (const condition of ["treatment", "neutral"]) {
  const spec = { ...small, condition };
  const cfg = specConfig(spec);
  const out = new Mem();
  const res = await runExperiment(device, spec, out, host, () => {}, { keepFinal: true });
  const ref = new RefSim3(cloneState(initWorld(cfg, preset.init)));
  const n = cellCount(cfg);
  let layers = LAYERS_HEADER, lineages = "step\tlineage\tcells\n";
  const series: Record<string, unknown>[] = [];
  for (let c = 0; c < 3; c++) {
    ref.run(20);
    const s = ref.state;
    const cen = census3({ cfg, step: s.step, cells: s.cells, genomeHead: s.genome.slice(0, (G.PARAM1 + 1) * n) });
    layers += layersRows(s.step, layerRoles(cfg, ref.roles));
    lineages += cen.lineages.map((l) => `${s.step}\t${l.key}\t${l.cells}`).join("\n") + (cen.lineages.length ? "\n" : "");
    const rs = roleSummary(lineageProfiles(cfg, ref.roles, s.genome.slice(0, (G.PARAM1 + 1) * n)));
    series.push({ individuals: individuals(cen).length, livingCells: cen.livingCells, lineages: cen.lineages.length, roles: rs.share, rolesPresent: rs.present });
  }
  check(`1. ${condition}: layers.tsv equals the lockstep RefSim3's`, out.files.get("layers.tsv") === layers);
  check(`1. ${condition}: lineages.tsv equals the lockstep census3's`, out.files.get("lineages.tsv") === lineages);
  const got = out.files.get("series.jsonl")!.trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
  check(`1. ${condition}: series individuals, livingCells, lineages, roles equal`, got.length === 3 && got.every((r, k) => JSON.stringify([r.individuals, r.livingCells, r.lineages, r.roles, r.rolesPresent]) === JSON.stringify([series[k].individuals, series[k].livingCells, series[k].lineages, series[k].roles, series[k].rolesPresent])));
  check(`1. ${condition}: the 2D-only keys are absent`, got.every((r) => !("patternEntropy" in r) && !("temporalMI" in r) && !("morphology" in r) && !("patternCompression" in r) && r.buddings === 0));
  check(`1. ${condition}: the final state is the RefSim3's, conservation exact`, stateHash(res.final!) === stateHash(ref.state) && res.summary.conservationOk);
  const files = [...out.files.keys()].sort().join(",");
  check(`1. ${condition}: the bundle holds the slab files and none of the refused ones`, files === "activity-final.json,heredity.tsv,layers.tsv,life.jsonl,lineages.tsv,manifest.json,mutations.tsv,series.jsonl", files);
}
device.destroy();

// ---- 2. rehearsal at full size through the CLIs
console.log("-- 2. rehearsal at 256 x 256 x 8");
const tmp = await Deno.makeTempDir({ prefix: "slab-rehearsal-" });
const deno = (args: string[]) =>
  new Deno.Command(Deno.execPath(), { args: ["run", "--no-lock", "-A", ...args], cwd: ROOT, stdout: "piped", stderr: "piped" }).output().then((r) => ({ code: r.code, text: new TextDecoder().decode(r.stdout) + new TextDecoder().decode(r.stderr) }));
try {
  const t0 = performance.now();
  const scr = await deno(["tools/slab-screen.ts", "--out", tmp, "--mu", "60", "--sigma", "20", "--light-k", "1024", "--seeds", "1", "--steps", "3000", "--census", "1000"]);
  const wall = (performance.now() - t0) / 1000;
  check("2. slab-screen runs both arms at full size", scr.code === 0 && /queue complete/.test(scr.text), scr.text.slice(-600));
  const again = await deno(["tools/slab-screen.ts", "--out", tmp, "--mu", "60", "--sigma", "20", "--light-k", "1024", "--seeds", "1", "--steps", "3000", "--census", "1000"]);
  check("2. a second run skips both finished bundles", again.code === 0 && /skip evolving seed 1 \(complete\)/.test(again.text) && /skip neutral seed 1 \(complete\)/.test(again.text));
  for (const cond of ["treatment", "neutral"]) {
    const dir = `${tmp}/slab-check/slab-spots/${cond}/seed-1`;
    const m = JSON.parse(await Deno.readTextFile(`${dir}/manifest.json`));
    const layers = await Deno.stat(`${dir}/layers.tsv`), lin = await Deno.stat(`${dir}/lineages.tsv`);
    const rows = (await Deno.readTextFile(`${dir}/layers.tsv`)).trim().split("\n").length - 1;
    check(`2. ${cond}: 3 censuses x 8 layers in layers.tsv, conservation exact`, rows === 24 && m.summary.conservationOk === true, `rows ${rows}`);
    const inRun = (m.summary.wallSeconds as number) / 3;
    const pure = 1000 / 234.5; // the M3 timing gate's steps/s at 256 x 256 x 8
    console.log(`   ${cond}: ${m.summary.stepsPerSecond.toFixed(0)} st/s in run, ${inRun.toFixed(2)} s per 1,000 steps vs ${pure.toFixed(2)} s of pure stepping (census cost about ${(inRun - pure).toFixed(2)} s per 1,000 steps); ` +
      `layers.tsv ${layers.size} B, lineages.tsv ${lin.size} B; ${m.summary.mutations} mutation events in 3,000 steps (${(m.summary.mutations / 3).toFixed(0)} per census; the event buffer holds ${m.cfg.eventCap}, and an overflow stops a run)`);
  }
  const rd = await deno(["tools/slab-readout.ts", "--out", tmp, "--rehearsal-steps", "3000"]);
  check("2. slab-readout --rehearsal-steps reads the two bundles and writes only the rehearsal page", rd.code === 0 && (await Deno.stat(`${tmp}/readout-rehearsal.md`).then(() => true, () => false)) && !(await Deno.stat(`${tmp}/readout.md`).then(() => true, () => false)), rd.text.slice(-600));
  check("2. ...under the rehearsal banner", /REHEARSAL, not a check result/.test(rd.text));
  const real = await deno(["tools/slab-readout.ts", "--out", tmp]);
  check("2. the real readout refuses the 3,000-step bundles (exit 2)", real.code === 2, `exit ${real.code}: ${real.text.slice(-300)}`);
  console.log(`   rehearsal wall time ${wall.toFixed(0)} s for 2 runs`);
} finally {
  await Deno.remove(tmp, { recursive: true }).catch(() => {});
}

console.log(`${checks - failures} of ${checks} checks passed in ${((performance.now() - T0) / 1000).toFixed(1)} s`);
Deno.exit(ok ? 0 : 1);
