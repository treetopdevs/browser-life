// A run split into segments and stitched back together (tools/stitch.ts) must
// yield the bundle a continuous run writes: every observation file byte for
// byte, and the same summary apart from timing.
import { requestDevice } from "@bl/sim-gpu";
import { BUNDLE_FILES, runExperiment, specConfig, stitchRun, type RunSpec, type Sink, type StitchSegment } from "@bl/runner";

class Mem implements Sink {
  files = new Map<string, string>();
  async writeText(p: string, t: string) { this.files.set(p, t); }
  async appendText(p: string, t: string) { this.files.set(p, (this.files.get(p) ?? "") + t); }
  async writeBytes() {}
}
// 1300 steps in segments of 500, 500 and 300: exercises a short final segment.
const base: RunSpec = { experiment: "stitch", presetId: "spots", condition: "treatment", seed: 5, steps: 1300, censusEvery: 100, deepEvery: 4, checkpointEvery: 0 };
const device = await requestDevice(navigator.gpu, specConfig(base));
const host = { host: "test", adapter: "test" };
const wholeSink = new Mem();
const whole = await runExperiment(device, base, wholeSink, host, () => {});

const segs: StitchSegment[] = [];
let prev: Awaited<ReturnType<typeof runExperiment>> | null = null;
for (const [index, [startStep, steps]] of [[0, 500], [500, 500], [1000, 300]].entries()) {
  const sink = new Mem();
  const r = await runExperiment(device, { ...base, steps }, sink, host, () => {}, { keepFinal: true, start: prev?.final, observer: prev?.observer });
  segs.push({ index, startStep, steps, digest: r.summary.finalHash, files: Object.fromEntries(sink.files) });
  prev = r;
}
// Out of order on purpose: stitchRun orders by index.
const stitched = stitchRun([segs[2], segs[0], segs[1]], base.steps);

let ok = true;
const check = (name: string, same: boolean, detail = "") => {
  ok &&= same;
  console.log(`${same ? "PASS" : "FAIL"} ${name}${same ? "" : `: ${detail}`}`);
};
for (const f of BUNDLE_FILES) {
  if (f === "manifest.json") continue;
  const x = wholeSink.files.get(f) ?? "", y = stitched[f];
  check(f, x === y, `${x.length} vs ${y.length} bytes`);
}
const m = JSON.parse(stitched["manifest.json"]), w = JSON.parse(wholeSink.files.get("manifest.json")!);
const untimed = (s: object) => JSON.stringify({ ...s, wallSeconds: 0, stepsPerSecond: 0 });
check("summary", untimed(m.summary) === untimed(whole.summary), `${untimed(m.summary)} vs ${untimed(whole.summary)}`);
check("spec", JSON.stringify(m.spec) === JSON.stringify(w.spec));
check("covers the whole history", m.startStep === 0 && m.segments.length === 3);

const expectThrow = (name: string, f: () => unknown) => {
  try {
    f();
    check(name, false, "accepted");
  } catch {
    check(name, true);
  }
};
expectThrow("rejects a missing segment", () => stitchRun([segs[0], segs[2]], base.steps));
expectThrow("rejects a digest other than the accepted one", () => stitchRun([segs[0], { ...segs[1], digest: "0000000000000000" }, segs[2]], base.steps));
expectThrow("rejects a short history", () => stitchRun(segs.slice(0, 2), base.steps));
const retail = (seg: StitchSegment, f: (row: Record<string, unknown>) => void): StitchSegment => {
  const rows = seg.files["series.jsonl"].trim().split("\n").map((l) => JSON.parse(l));
  f(rows[rows.length - 1]);
  return { ...seg, files: { ...seg.files, "series.jsonl": rows.map((r) => JSON.stringify(r) + "\n").join("") } };
};
expectThrow("rejects a final census that contradicts the summary", () => stitchRun([segs[0], retail(segs[1], (r) => (r.individuals = 987654)), segs[2]], base.steps));

// A conservation failure in one segment stays failed for the rest of the run.
const failedFirst = retail(segs[0], (r) => (r.conservationOk = false));
const fm = JSON.parse(failedFirst.files["manifest.json"]);
fm.summary.conservationOk = false;
failedFirst.files["manifest.json"] = JSON.stringify(fm);
const sticky = stitchRun([failedFirst, segs[1], segs[2]], base.steps);
const rows = sticky["series.jsonl"].trim().split("\n").map((l) => JSON.parse(l));
check(
  "a conservation failure is carried into later segments' rows and the summary",
  rows.slice(4).every((r) => r.conservationOk === false) && JSON.parse(sticky["manifest.json"]).summary.conservationOk === false,
);
Deno.exit(ok ? 0 : 1);
