// A run split into segments (one checkpoint artifact carrying physics and
// observer state together) must equal the continuous run: same physics
// digest, same artifact digest (physics + observer), same observations.
import { stateHash } from "@bl/schema";
import { requestDevice } from "@bl/sim-gpu";
import { runExperiment, specConfig, type RunSpec, type Sink } from "@bl/runner";

class Mem implements Sink {
  files = new Map<string, string>();
  async writeText(p: string, t: string) { this.files.set(p, t); }
  async appendText(p: string, t: string) { this.files.set(p, (this.files.get(p) ?? "") + t); }
  async writeBytes() {}
}
const base: RunSpec = { experiment: "seg", presetId: "spots", condition: "treatment", seed: 3, steps: 1000, censusEvery: 100, deepEvery: 5, checkpointEvery: 0, activityThreshold: 7 };
const device = await requestDevice(navigator.gpu, specConfig(base));
const host = { host: "test", adapter: "test" };
const whole = await runExperiment(device, base, new Mem(), host, () => {}, { keepFinal: true });
const a = await runExperiment(device, { ...base, steps: 500 }, new Mem(), host, () => {}, { keepFinal: true });
const b = await runExperiment(device, { ...base, steps: 500 }, new Mem(), host, () => {}, { keepFinal: true, start: a.final, observer: a.observer });
const strip = (o: object) => JSON.stringify({ ...o, step: 0 });
const checks: [string, unknown, unknown][] = [
  ["physics digest", stateHash(whole.final!), stateHash(b.final!)],
  ["artifact digest (physics + observer)", whole.summary.finalHash, b.summary.finalHash],
  ["activity", JSON.stringify(whole.observer.activity), JSON.stringify(b.observer.activity)],
  ["tracker", JSON.stringify(whole.observer.tracker), JSON.stringify(b.observer.tracker)],
  ["counters", strip({ ...whole.observer, tracker: 0, activity: 0 }), strip({ ...b.observer, tracker: 0, activity: 0 })],
  ["fissions", whole.summary.fissions, b.summary.fissions],
  ["mutations", whole.summary.mutations, b.summary.mutations],
];
let ok = true;
for (const [name, x, y] of checks) {
  const same = x === y;
  ok &&= same;
  console.log(`${same ? "PASS" : "FAIL"} ${name}${same ? "" : `: ${String(x).slice(0, 120)} vs ${String(y).slice(0, 120)}`}`);
}
Deno.exit(ok ? 0 : 1);
