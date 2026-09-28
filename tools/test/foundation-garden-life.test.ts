import { describe, expect, it } from "vitest";
import { allocState, cellCount, CH, defaultConfig, G, type WorldState } from "@bl/schema";
import { b64, census, Tracker, unb64 } from "@bl/metrics";
import type { ObserverState } from "@bl/runner";
import { GardenLifeCapture } from "../lib/foundation-garden-life.ts";

const cfg = defaultConfig({ tileW: 16, tileH: 16, tilesX: 1, tilesY: 1, kernelRadius: 2 });
const n = cellCount(cfg);
const left = [[2, 2], [2, 3], [3, 2]];
const right = [[5, 2], [6, 2], [6, 3]];

function state(step: number, bridge: boolean): WorldState {
  const s = allocState(cfg);
  s.step = step;
  for (const [x, y] of [...left, ...right, ...(bridge ? [[4, 2]] : [])]) {
    const i = y * cfg.tileW + x;
    s.cells[CH.B * n + i] = 100;
    s.genome[G.LIN_LO * n + i] = 1;
  }
  return s;
}

function observer(s: WorldState, tracker: Tracker): ObserverState {
  return { step: s.step, settings: { censusEvery: 100, deepEvery: 10, activityThreshold: null },
    tracker: tracker.toJSON(), activity: {} as ObserverState["activity"],
    mutations: 0, buddings: 0, censusIdx: s.step / 100, extinct: false, prevSym: null };
}

describe("solo garden observer capture", () => {
  it("joins real tracker split rows to matched censuses and marks baseline roots left-truncated", () => {
    const tracker = new Tracker({ threshold: 48, minMass: 256 });
    const first = state(100, true);
    expect(tracker.update(census({ cfg, step: 100, cells: first.cells, genomeHead: first.genome }))).toEqual([]);
    const capture = new GardenLifeCapture();
    capture.acceptCheckpoint(first, observer(first, tracker));
    const second = state(200, false);
    const events = tracker.update(census({ cfg, step: 200, cells: second.cells, genomeHead: second.genome }));
    expect(events).toEqual([{ step: 200, kind: "fission", parent: 1, children: [2] }]);
    capture.acceptLifeText(events.map((event) => JSON.stringify(event)).join("\n") + "\n");
    capture.acceptCheckpoint(second, observer(second, tracker));
    const trace = capture.trace();
    expect(trace).toMatchObject({ scope: "one-solo-garden-in-situ-observer-trace", status: "partial",
      analysis: null, lastCapturedStep: 200 });
    expect(trace.window.life).toEqual(events);
    expect(trace.window.censusDigests.map((d) => d.step)).toEqual([100, 200]);
    expect(trace.window.frames.filter((f) => f.step === 100)).toMatchObject([
      { id: 1, born: 100, age: null, leftTruncated: true, cells: 7, mass: 700 },
    ]);
    expect(trace.window.frames.filter((f) => f.step === 200).map((f) => ({ id: f.id, age: f.age,
      leftTruncated: f.leftTruncated, mass: f.mass }))).toEqual([
        { id: 1, age: null, leftTruncated: true, mass: 300 },
        { id: 2, age: 0, leftTruncated: false, mass: 300 },
      ]);
    expect(trace.window.overlapMixing).toEqual([]);
    expect(() => capture.trace(true)).toThrow(/incomplete/);
  });

  it("rejects a saved label map inconsistent with physics and an omitted life event", () => {
    const tracker = new Tracker({ threshold: 48, minMass: 256 });
    const first = state(100, true);
    tracker.update(census({ cfg, step: 100, cells: first.cells, genomeHead: first.genome }));
    const bad = observer(first, tracker);
    const labels = unb64(bad.tracker.prevLabels!);
    labels[0] ^= 1;
    bad.tracker.prevLabels = b64(labels);
    expect(() => new GardenLifeCapture().acceptCheckpoint(first, bad)).toThrow(/labels differ/);

    const capture = new GardenLifeCapture();
    capture.acceptCheckpoint(first, observer(first, tracker));
    const second = state(200, false);
    tracker.update(census({ cfg, step: 200, cells: second.cells, genomeHead: second.genome }));
    expect(() => capture.acceptCheckpoint(second, observer(second, tracker))).toThrow(/counts disagree/);
  });
});
