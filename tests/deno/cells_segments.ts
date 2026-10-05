// Declared cells (WorldConfig.cellPeriod; docs/sandbox-cells.md) on the real GPU path.
//  1. A run split at a pass boundary equals the continuous run: same physics digest, same artifact
//     digest, same observer counters, same birth rows. The checkpoint at a pass step must therefore
//     carry the post-pass state, and the resumed run must not repeat or skip that pass.
//  2. GpuSim stepped with cellsAtBoundary (readback, pass, upload) equals RefSim stepped with
//     applyCellPass, state hash for state hash, so the upload after a pass loses nothing.
import { M3_FOUNDERS, buildWorld, cloneState, defaultConfig, founderGenome, stateHash, type WorldConfig } from "@bl/schema";
import { GpuSim, requestDevice } from "@bl/sim-gpu";
import { RefSim, applyCellPass } from "@bl/sim-ref";
import { cellsAtBoundary, runExperiment, specConfig, type RunSpec, type Sink } from "@bl/runner";

class Mem implements Sink {
  files = new Map<string, string>();
  async writeText(p: string, t: string) { this.files.set(p, t); }
  async appendText(p: string, t: string) { this.files.set(p, (this.files.get(p) ?? "") + t); }
  async writeBytes() {}
}
const checks: [string, unknown, unknown][] = [];

const base: RunSpec = { experiment: "cellseg", presetId: "own-cell", condition: "treatment", seed: 3, steps: 6000, censusEvery: 1000, deepEvery: 5, checkpointEvery: 0, activityThreshold: 7 };
const device = await requestDevice(navigator.gpu, specConfig(base));
const host = { host: "test", adapter: "test" };
const mw = new Mem(), ma = new Mem(), mb = new Mem();
const whole = await runExperiment(device, base, mw, host, () => {}, { keepFinal: true });
const a = await runExperiment(device, { ...base, steps: 3000 }, ma, host, () => {}, { keepFinal: true });
const b = await runExperiment(device, { ...base, steps: 3000 }, mb, host, () => {}, { keepFinal: true, start: a.final, observer: a.observer });
const strip = (o: object) => JSON.stringify({ ...o, step: 0 });
const rows = (m: Mem, f: string) => (m.files.get(f) ?? "").split("\n").slice(1).filter(Boolean);
const births = rows(mw, "cells.tsv");
checks.push(
  ["segments: physics digest", stateHash(whole.final!), stateHash(b.final!)],
  ["segments: artifact digest (physics + observer)", whole.summary.finalHash, b.summary.finalHash],
  ["segments: counters", strip({ ...whole.observer, tracker: 0, activity: 0 }), strip({ ...b.observer, tracker: 0, activity: 0 })],
  ["segments: tracker", JSON.stringify(whole.observer.tracker), JSON.stringify(b.observer.tracker)],
  ["segments: cells.tsv rows", births.join("\n"), [...rows(ma, "cells.tsv"), ...rows(mb, "cells.tsv")].join("\n")],
  ["segments: mutations.tsv rows", rows(mw, "mutations.tsv").join("\n"), [...rows(ma, "mutations.tsv"), ...rows(mb, "mutations.tsv")].join("\n")],
  ["segments: births happened, some at the split step", births.length > 0 && births.some((r) => r.startsWith("3000\t")), true],
  ["segments: every birth is a mutations.tsv row", rows(mw, "mutations.tsv").length, births.length],
);

// 2. GPU with the boundary helper against the reference with the pure pass: plain cells, then the
//    wall with recurring wounds (own-cell-wall-injury's rules), where a wound can cut a body in two.
const founders = [0, 1, 2, 5, 0, 1].map((f, k) => ({ x: 8 + 16 * (k % 3), y: 12 + 24 * Math.floor(k / 3), radius: 6, genome: founderGenome(M3_FOUNDERS[f]), biomass: 64, energy: 128 }));
async function againstReference(extra: Partial<WorldConfig>) {
  const cfg = defaultConfig({ tileW: 48, tileH: 48, kernelRadius: 5, seed: 83, mutRate: 0, cellPeriod: 200, cellMutProb: 2 ** 32, ...extra });
  const start = buildWorld(cfg, { nutrient: 32, founders });
  const ref = new RefSim(cloneState(start));
  const gpu = await GpuSim.create(await requestDevice(navigator.gpu, cfg), cloneState(start));
  let born = 0, same = true;
  for (let step = 200; step <= 1600; step += 200) {
    ref.run(200);
    gpu.run(200);
    const want = applyCellPass(ref.state);
    const got = await cellsAtBoundary(gpu, step);
    born += want.length;
    same &&= JSON.stringify(want) === JSON.stringify(got.births) && stateHash(ref.state) === stateHash(await gpu.readState());
  }
  return { born, same, hash: stateHash(ref.state) };
}
const plain = await againstReference({});
const walled = await againstReference({ takeover: "lossy", takeoverKin: "lineage" });
// A radius-3 disc is 29 cells; each cell is hit about once per 400 steps.
const wounded = await againstReference({ takeover: "lossy", takeoverKin: "lineage", injuryPeriod: 13, injuryRadius: 3, injuryProb: Math.round((2 ** 32 * 13) / (29 * 400)) });
const born = plain.born;
checks.push(
  ["gpu vs reference: births and state hash at every pass", plain.same, true],
  ["gpu vs reference: births happened", plain.born > 0, true],
  ["gpu vs reference, wall and wounds: births and state hash at every pass", wounded.same, true],
  ["gpu vs reference, wall and wounds: births happened", wounded.born > 0, true],
  ["gpu vs reference, wall and wounds: the wounds changed the world", wounded.hash !== walled.hash && walled.same, true],
);

let ok = true;
for (const [name, x, y] of checks) {
  const eq = x === y;
  ok &&= eq;
  console.log(`${eq ? "PASS" : "FAIL"} ${name}${eq ? "" : `: ${String(x).slice(0, 160)} vs ${String(y).slice(0, 160)}`}`);
}
console.log(`${births.length} births in the continuous run, ${born} in the reference comparison, ${wounded.born} with wall and wounds`);
Deno.exit(ok ? 0 : 1);
