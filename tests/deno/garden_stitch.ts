// A garden's segments stitched, on a real native WebGPU device: the rule of docs/garden-stitch-rule-2026-10-17.md against
// real runExperiment output. The coordinator rewrites a garden's `interventions` as letters arrive and are dropped, and
// every task carries the list as it stood at assignment, so each day's manifest holds a different list. Here three days of
// a small world are run as a garden's tasks would be (each continued from its predecessor's state and observer, each with
// the list as of its assignment, one letter posted for day 2 and dropped before day 2 was assigned, one of day 1's letters
// a feed), stitched with stitchRun in garden mode as tools/stitch.ts calls it, and compared with one continuous run over
// the same steps with the final list.
//
// Pass: the stitched bundle's every VERIFIED_FILES entry equals the continuous run's byte for byte (interventions.jsonl
// included), the final state hash and artifact digest are equal, the stitched manifest's spec.interventions is the final
// list, interventions.applied counts it and the untimed summary is the continuous run's; the lists really differ between
// days (an ordinary stitch refuses them); a forged day-2 manifest that moves day 1's lesion, or changes its feed's amount,
// is refused ("rewrites history"); and the coordinator's list is accepted when it is the final one and refused when it is
// day 1's (whose dropped letter lies inside the stitched range).
//
// Scope: one seed, one small world, three days, lesions and one feed without a named matter. The refusals of every other
// kind of rewrite (missing, extra, reordered entries, each field, a feed's matter) are packages/runner/test/stitch.test.ts's,
// on hand-built segments; this check is the byte-for-byte equality against real runs.
//
// World: the small spots override of tests/deno/interventions.ts (48 x 48, kernelRadius 6, eA 1), seed 3, days of 100
// steps, censusEvery 100. A few seconds of GPU.
//
// Run from the repo root: deno run -A tests/deno/garden_stitch.ts
import { PRESETS, cellCount, lowbias32, stateHash, worldW, type WorldConfig } from "@bl/schema";
import { requestDevice } from "@bl/sim-gpu";
import { INTERVENTIONS_FILE, VERIFIED_FILES, runExperiment, specConfig, stitchRun, type RunSpec, type ScheduledIntervention, type Sink, type StitchSegment } from "@bl/runner";

class Mem implements Sink {
  files = new Map<string, string>();
  bytes = new Map<string, Uint8Array>();
  async writeText(p: string, t: string) { this.files.set(p, t); }
  async appendText(p: string, t: string) { this.files.set(p, (this.files.get(p) ?? "") + t); }
  async writeBytes(p: string, b: Uint8Array) { this.bytes.set(p, b); }
}

const T0 = performance.now();
try {
  const up = new TextDecoder().decode((await new Deno.Command("uptime").output()).stdout).trim();
  console.log(`uptime: ${up}`);
} catch {
  console.log("uptime: unavailable");
}

let ok = true;
const check = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail && !cond ? `: ${detail.slice(0, 600)}` : ""}`);
  ok &&= cond;
};
const refused = (f: () => unknown, pattern: RegExp): { ok: boolean; message: string } => {
  try {
    f();
    return { ok: false, message: "accepted" };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: pattern.test(message), message };
  }
};
/** A value with its object keys sorted, as JSON: two schedules written with different key orders compare equal. */
const canon = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

/** The founders' centres, as the generalist init places them (world.ts generalistWorld): lesions there destroy something. */
function founderCentres(cfg: WorldConfig, k: number): { x: number; y: number }[] {
  const W = worldW(cfg), H = cellCount(cfg) / W;
  return Array.from({ length: k }, (_, i) => {
    const h = lowbias32(cfg.seed * 31 + i);
    return { x: h % W, y: (h >>> 12) % H };
  });
}

const host = { host: "test", adapter: "test" };
const noop = () => {};
const DAY = 100, DAYS = 3, TOTAL = DAY * DAYS;
const SMALL = { tileW: 48, tileH: 48, kernelRadius: 6, eA: 1 };
const base: RunSpec = { experiment: "garden-stitch", presetId: "spots", condition: "treatment", seed: 3, steps: TOTAL, censusEvery: 100, deepEvery: 5, checkpointEvery: 0, overrides: SMALL };
const cfg = specConfig(base);
if (!PRESETS.some((p) => p.id === base.presetId)) throw new Error("no spots preset");
const c = founderCentres(cfg, 6);
const lesion = (step: number, at: { x: number; y: number }, r = 6): ScheduledIntervention => ({ step, kind: "lesion", x: at.x, y: at.y, r });
// The founding schedule (step 0) and a letter for day 0, as the coordinator has them when day 0 is assigned.
const F = lesion(0, c[0]), X0 = lesion(DAY, c[1]);
// Day 1's assignment: a lesion and a feed for day 1, and a letter for day 2 (Xd) that the keeper drops before day 2 is assigned.
const X1 = lesion(2 * DAY, c[2]), Xd = lesion(3 * DAY, c[3]);
const P1: ScheduledIntervention = { step: 2 * DAY, kind: "feed", x: c[5].x, y: c[5].y, r: 4, amount: 8 };
// Day 2's assignment: Xd dropped, another letter for day 2 in its place.
const X2 = lesion(3 * DAY, c[4], 5);
const L0 = [F, X0], L1 = [F, X0, X1, P1, Xd], L2 = [F, X0, X1, P1, X2];
const lists = [L0, L1, L2];

const dev = await requestDevice(navigator.gpu, cfg);
type RunOpts = NonNullable<Parameters<typeof runExperiment>[5]>;
async function run(spec: RunSpec, opts: RunOpts = {}) {
  const mem = new Mem();
  const r = await runExperiment(dev, spec, mem, host, noop, { keepFinal: true, ...opts });
  return { summary: r.summary, final: r.final!, observer: r.observer, mem, manifest: JSON.parse(mem.files.get("manifest.json")!) };
}

// The garden's days, each continued from its predecessor with the list its task would have carried.
const days: Awaited<ReturnType<typeof run>>[] = [];
for (let d = 0; d < DAYS; d++) {
  const prev = days[d - 1];
  days.push(await run({ ...base, steps: DAY, interventions: lists[d] }, prev ? { start: prev.final, observer: prev.observer } : {}));
}
// One continuous run with the final list; a founding-only run and one with the dropped letter kept (day 1's list) show the
// letters, and the drop, change the history.
const whole = await run({ ...base, interventions: L2 });
const foundingOnly = await run({ ...base, interventions: [F] });
const keptDropped = await run({ ...base, interventions: L1 });
console.log(`   (runs: ${((performance.now() - T0) / 1000).toFixed(1)} s)`);

const segsOf = (manifests: string[] = days.map((r) => r.mem.files.get("manifest.json")!)): StitchSegment[] =>
  days.map((r, d) => ({ index: d, startStep: d * DAY, steps: DAY, digest: r.summary.finalHash, files: { ...Object.fromEntries(r.mem.files), "manifest.json": manifests[d] } }));

check("the letters are not vacuous: a founding-only run ends in another state", stateHash(foundingOnly.final) !== stateHash(whole.final));
check("...nor is the drop: the run that kept the dropped letter (day 1's list) ends in another state", stateHash(keptDropped.final) !== stateHash(whole.final));
const stripped = (m: { spec: Record<string, unknown> }) => {
  const { steps: _s, ...rest } = m.spec;
  return canon(rest);
};
check(
  "each day's manifest carries the list as of its assignment, so the whole-spec comparison of before would refuse them",
  days.every((r, d) => canon(r.manifest.spec.interventions) === canon(lists[d])) && stripped(days[0].manifest) !== stripped(days[2].manifest) && stripped(days[1].manifest) !== stripped(days[2].manifest),
);
const ordinary = refused(() => stitchRun(segsOf(), TOTAL), /segment #1: spec differs from segment #0's/);
check("...and an ordinary stitch (no garden mode) does refuse them", ordinary.ok, ordinary.message);
check("each day logged only what it owned (2, 2, 1)", days.map((r) => r.manifest.interventions?.applied).join(",") === "2,2,1", days.map((r) => r.manifest.interventions?.applied).join(","));
const feedLine = days[1].mem.files.get(INTERVENTIONS_FILE)!.split("\n").find((l) => l.includes('"feed"'));
check("...day 1's feed moved matter (its log line)", feedLine !== undefined && JSON.parse(feedLine).matter !== 0, feedLine ?? "no feed line");
check("day 2's final state hash equals the continuous run's", stateHash(days[2].final) === stateHash(whole.final), `${stateHash(days[2].final)} vs ${stateHash(whole.final)}`);
check("...and the artifact digest (physics + observer)", days[2].summary.finalHash === whole.summary.finalHash, `${days[2].summary.finalHash} vs ${whole.summary.finalHash}`);

let stitched: Record<string, string> | undefined;
try {
  stitched = stitchRun([...segsOf()].reverse(), TOTAL, { garden: { interventions: L2 } });
} catch (e) {
  check("stitchRun accepts the garden's days with the coordinator's final list", false, e instanceof Error ? e.message : String(e));
}
if (stitched) {
  check("stitchRun accepts the garden's days with the coordinator's final list", true);
  const present = VERIFIED_FILES.filter((f) => stitched![f] !== undefined);
  const differing = present.filter((f) => stitched![f] !== whole.mem.files.get(f));
  const missing = VERIFIED_FILES.filter((f) => whole.mem.files.has(f) && stitched![f] === undefined);
  check(`...every verified file equals the continuous run's byte for byte (${present.join(", ")})`, differing.length === 0 && missing.length === 0 && present.includes(INTERVENTIONS_FILE), `differ: ${differing.join(", ")}; missing: ${missing.join(", ")}`);
  const sm = JSON.parse(stitched["manifest.json"]);
  const untimed = (x: Record<string, unknown>) => JSON.stringify({ ...x, wallSeconds: 0, stepsPerSecond: 0 });
  check("...its spec.interventions is the final list and applied counts it (5)", canon(sm.spec.interventions) === canon(L2) && sm.interventions?.applied === 5 && sm.interventions?.file === INTERVENTIONS_FILE, `${canon(sm.spec.interventions)}; ${JSON.stringify(sm.interventions)}`);
  check("...its spec is the continuous run's", canon(sm.spec) === canon(whole.manifest.spec), `${canon(sm.spec)} vs ${canon(whole.manifest.spec)}`);
  check("...and its summary, apart from timing", untimed(sm.summary) === untimed(whole.summary as unknown as Record<string, unknown>), `${untimed(sm.summary)} vs ${untimed(whole.summary as unknown as Record<string, unknown>)}`);
}

const r1 = refused(() => stitchRun(segsOf(), TOTAL, { garden: { interventions: L1 } }), /the stitched schedule is not the coordinator's/);
check("with day 1's list as the coordinator's (the dropped letter inside the range), it is refused", r1.ok, r1.message);
const two = (() => {
  try {
    return stitchRun(segsOf().slice(0, 2), 2 * DAY, { garden: { interventions: L2 } });
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
})();
check("a two-day prefix stitches against the final list, its schedule [F, X0, X1, P1]", typeof two !== "string" && canon(JSON.parse(two["manifest.json"]).spec.interventions) === canon([F, X0, X1, P1]), typeof two === "string" ? two : "");

// A forged day 2: its manifest's list rewrites one of day 1's letters (its own log and everything else unchanged). The
// coordinator's list given is the true final one, so the refusal is the history check's.
const forge = (edit: (e: ScheduledIntervention) => ScheduledIntervention) => {
  const forged = days.map((r) => r.mem.files.get("manifest.json")!);
  const m2 = JSON.parse(forged[2]);
  m2.spec.interventions = m2.spec.interventions.map(edit);
  forged[2] = JSON.stringify(m2);
  return refused(() => stitchRun(segsOf(forged), TOTAL, { garden: { interventions: L2 } }), /segment #2: its schedule rewrites history.*segment #1's window \(100, 200\]/);
};
const r3 = forge((e) => (e.kind === "lesion" && e.step === X1.step && e.x === X1.x ? { ...e, x: (e.x + 1) % worldW(cfg) } : e));
check("a forged day 2 that moves day 1's lesion is refused (rewrites history)", r3.ok, r3.message);
const r4 = forge((e) => (e.kind === "feed" && e.step === P1.step ? { ...e, amount: e.amount + 1 } : e));
check("a forged day 2 that changes day 1's feed amount is refused (rewrites history)", r4.ok, r4.message);

console.log(`[${((performance.now() - T0) / 1000).toFixed(1)} s]`);
console.log(ok ? "ALL PASS" : "SOME FAILED");
dev.destroy();
Deno.exit(ok ? 0 : 1);
