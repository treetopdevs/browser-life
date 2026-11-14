// Pond keeper v2 readout (docs/pond-keeper-v2-readout-2026-10-30.md): do the firsts-v2 rungs and the families-v1 tree fire in
// realistic play? A world is played headless in the lab's own traversal, as sim.worker.ts plays it: LabExecution over a real GpuSim,
// the census every 100 steps, the ledger drained before each census, and every census fed to the log of firsts and the family tree
// through apps/lab/src/firsts-log.ts (openFirstsLog, feedCensus), the worker's own calls. Breeder mode is off, so every pond boundary
// takes the arm's own donors at once: auto-breed with the dial at the world's own score and nothing kept.
//
// Wounds: at each step `k * 5000 + offset` (k = 0, 1, ...), right after that census settles, one lesion of radius 10 (the v2 spec's)
// is made on the pond with the most body cells at that census, centred on its largest body, and logged as the worker logs it
// (step, x, y, the effective radius). A wound is placed only when some pond holds a body.
//
// Observer only: nothing here changes the physics or a pin. Writes, under --out:
//   <run>.censuses.jsonl  one line per census: step, edges, dropped, v2 progress, tree summary, timings (ms)
//   <run>.summary.json    the entries of the log, the tree's families and events, wounds, timings
//
//   deno run -A --no-lock tests/deno/pond_keeper_v2_readout.ts --preset breeder --seed 1 --steps 30000 --offset 2500 --out DIR
import { PRESETS, cloneState, initWorld, presetConfig, type Intervention } from "@bl/schema";
import { GpuSim, requestDevice } from "@bl/sim-gpu";
import { LabExecution, type CensusFamilies } from "../../apps/lab/src/execution.ts";
import { feedCensus, openFirstsLog } from "../../apps/lab/src/firsts-log.ts";
import type { FirstsBody } from "@bl/metrics";

const arg = (name: string, dflt?: string): string => {
  const i = Deno.args.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < Deno.args.length) return Deno.args[i + 1];
  if (dflt === undefined) throw new Error(`--${name} is required`);
  return dflt;
};
const presetId = arg("preset");
const seed = Number(arg("seed", "1"));
const steps = Number(arg("steps", "30000"));
const offset = Number(arg("offset", "2500"));
const every = Number(arg("wound-every", "5000"));
const radius = Number(arg("radius", "10"));
const outDir = arg("out");
// --fixed "STEP:X,Y,R;..." makes exactly these lesions (each right after its step's census) instead of the placed ones.
const fixed = arg("fixed", "").split(";").filter(Boolean).map((t) => {
  const [st, rest] = t.split(":");
  const [x, y, r] = rest.split(",").map(Number);
  return { step: Number(st), x, y, r };
});
const name = `${presetId}-seed${seed}${fixed.length ? "-fixed" : ""}`;
await Deno.mkdir(outDir, { recursive: true });

const preset = PRESETS.find((p) => p.id === presetId);
if (!preset) throw new Error(`no preset ${presetId}`);
const cfg = presetConfig(preset, seed);
const init = initWorld(cfg, preset.init);
const settings = { censusEvery: 100, deepEvery: 5, activityThreshold: null };
// Wounds follow a census (the placement reads its bodies), so the schedule must land on the census grid.
if (!(offset % settings.censusEvery === 0 && every % settings.censusEvery === 0 && every > 0)) {
  throw new Error(`--offset ${offset} and --wound-every ${every} must be positive multiples of censusEvery (${settings.censusEvery})`);
}
const V2 = ["moving-pond", "long-body", "pond-change", "outlive-wound", "new-family"];

const device = await requestDevice(navigator.gpu, cfg);
const sim = await GpuSim.create(device, cloneState(init));
const interventions: Intervention[] = [];
const log = openFirstsLog(init, settings.censusEvery, { edgesFrom: 0, edges: 0, dropped: 0 });
const lines: string[] = [];
const timing = { input: [] as number[], observe: [] as number[], feed: [] as number[] };
let lastBodies: FirstsBody[] = [];
let totalDropped = 0;
const notices: string[] = [];
// The tree's own observe, timed (its input is read first, by feedCensus, and timed apart: it includes the per-cell lineage read the
// log of firsts shares).
const treeObserve = log.tree.observe.bind(log.tree);
let observeMs = 0;
log.tree.observe = (input, parentOf) => {
  const t0 = performance.now();
  try {
    return treeObserve(input, parentOf);
  } finally {
    observeMs = performance.now() - t0;
  }
};

let exec: LabExecution;
exec = new LabExecution(sim, settings, {
  start: cloneState(init),
  waitForIdle: () => device.queue.onSubmittedWorkDone(),
  isCurrent: () => true,
  onObservation: (c, dropped, firsts, families) => {
    totalDropped += dropped;
    let inputMs = 0;
    observeMs = 0;
    const fam: CensusFamilies | undefined = families && {
      parentOf: families.parentOf,
      input: () => {
        const t0 = performance.now();
        try {
          return families.input();
        } finally {
          inputMs = performance.now() - t0;
        }
      },
    };
    const t0 = performance.now();
    feedCensus(log, { census: c, dropped, firsts, families: fam, cfg: sim.cfg, interventions }, (m) => notices.push(`t=${c.step}: ${m}`));
    const feedMs = performance.now() - t0;
    if (!log.treeStopped && fam) {
      timing.input.push(inputMs);
      timing.observe.push(observeMs);
    }
    timing.feed.push(feedMs);
    // Bodies for the wound placement, read only at a wound's census (outside the timings above).
    // The longest body of 40 cells or more (the long-body rung's ratio), whether or not the rung has fired, and the bodies for the
    // wound placement: a second read of the census, outside the timings above.
    const bodies = firsts ? firsts().bodies : [];
    if (c.step % every === offset % every) lastBodies = [...bodies];
    const longest = bodies.reduce((m, b) => (b.cells >= 40 && b.elongation > m.ratio ? { ratio: +b.elongation.toFixed(2), cells: b.cells } : m), { ratio: 0, cells: 0 });
    const progress = Object.fromEntries(log.detector.nextUp(Infinity).filter((x) => V2.includes(x.id)).map((x) => [x.id, x.value]));
    lines.push(JSON.stringify({
      step: c.step, edges: exec.edges.length, dropped, progress, tree: log.tree.summary(), treeStopped: log.treeStopped, stopped: log.stopped,
      longest, bodies: c.components.length, living: c.livingCells, ms: { input: +inputMs.toFixed(3), observe: +observeMs.toFixed(3), feed: +feedMs.toFixed(3) },
    }));
  },
});

const wounds: { step: number; tile: number; x: number; y: number; r: number; bodyCells: number }[] = [];
const reach = async (step: number) => {
  while (sim.step < step) await exec.advanceFrame(step - sim.step);
};
const t0 = performance.now();
const worldW = cfg.tilesX * cfg.tileW, worldH = cfg.tilesY * cfg.tileH;
for (const f of fixed) {
  await reach(f.step);
  // Floored and wrapped onto the world, as the worker does before a lesion, so the GPU and the log name the same cell.
  f.x = ((Math.floor(f.x) % worldW) + worldW) % worldW;
  f.y = ((Math.floor(f.y) % worldH) + worldH) % worldH;
  const r = sim.lesion(f.x, f.y, f.r);
  interventions.push({ step: sim.step, kind: "lesion", x: f.x, y: f.y, r });
  wounds.push({ step: sim.step, tile: Math.floor(f.y / cfg.tileH) * cfg.tilesX + Math.floor(f.x / cfg.tileW), x: f.x, y: f.y, r, bodyCells: -1 });
}
for (let w = offset; !fixed.length && w <= steps; w += every) {
  await reach(w);
  const perTile = new Map<number, number>();
  for (const b of lastBodies) perTile.set(b.tile, (perTile.get(b.tile) ?? 0) + b.cells);
  const best = [...perTile].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  if (best) {
    const body = lastBodies.filter((b) => b.tile === best[0]).sort((a, b) => b.cells - a.cells || a.id - b.id)[0];
    const x = Math.floor(body.cx), y = Math.floor(body.cy);
    const r = sim.lesion(x, y, radius);
    interventions.push({ step: sim.step, kind: "lesion", x, y, r });
    wounds.push({ step: sim.step, tile: best[0], x, y, r, bodyCells: best[1] });
    // A centroid is a world coordinate; the wound's pond, as the log reads it, must be the pond chosen.
    const tile = Math.floor(y / cfg.tileH) * cfg.tilesX + Math.floor(x / cfg.tileW);
    if (tile !== best[0]) notices.push(`t=${sim.step}: wound centre (${x},${y}) lies in pond ${tile}, not the chosen pond ${best[0]}`);
  }
  console.log(`${name}: t=${sim.step} (${((performance.now() - t0) / 1000).toFixed(0)} s)`);
}
await reach(steps);
const wallS = (performance.now() - t0) / 1000;

const stats = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, median: +q(0.5).toFixed(3), p95: +q(0.95).toFixed(3), max: +s[s.length - 1].toFixed(3), mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(3) };
};
const fired = Object.fromEntries(V2.map((id) => [id, log.detector.entries().find((e) => e.id === id)?.step ?? null]));
const summary = {
  preset: presetId, seed, steps, offset, every, radius, wallS: +wallS.toFixed(1), edges: exec.edges.length, dropped: totalDropped,
  stopped: log.stopped, treeStopped: log.treeStopped, notices,
  fired, entries: log.detector.entries(), nextUp: log.detector.nextUp(Infinity),
  tree: log.tree.summary(), families: log.tree.families(), events: log.tree.events(),
  wounds, timing: { input: stats(timing.input), observe: stats(timing.observe), feed: stats(timing.feed) },
};
await Deno.writeTextFile(`${outDir}/${name}.censuses.jsonl`, lines.join("\n") + "\n");
await Deno.writeTextFile(`${outDir}/${name}.summary.json`, JSON.stringify(summary, null, 1));
console.log(JSON.stringify({ name, fired, tree: summary.tree, dropped: totalDropped, treeStopped: log.treeStopped, timing: summary.timing, wallS: summary.wallS }));
sim.destroy();
