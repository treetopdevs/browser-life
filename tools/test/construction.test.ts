import { describe, expect, it } from "vitest";
import { b2, CH, genomeHex, OUT, totalsOf, validateState } from "@bl/schema";
import {
  constructionConfig,
  constructionGenome,
  constructionWorld,
  withoutBuilding,
} from "../lib/construction.ts";
import { generalistGenome } from "@bl/schema";
import { controllerForward } from "@bl/sim-ref";

describe("constructed witness starts and controls", () => {
  it("starts matched arms with identical matter, energy and no gifted polymer", () => {
    const states = [0, 16].flatMap((build) =>
      [true, false].map((polymerTransport) =>
        constructionWorld(constructionConfig(101, { polymerTransport }), [{
          x: 16,
          y: 16,
          genome: constructionGenome({ build }),
        }])
      )
    );
    for (const s of states) {
      expect(validateState(s)).toEqual([]);
      expect(totalsOf(s.cfg, s.cells)).toEqual(
        totalsOf(states[0].cfg, states[0].cells),
      );
      expect(totalsOf(s.cfg, s.cells).matter).toBe(1024n);
      expect(totalsOf(s.cfg, s.cells).P).toBe(0n);
      expect(s.cells).toEqual(states[0].cells);
    }
  });
  it("partial builder forms differ in one legal controller byte", () => {
    for (let build = 0; build < 24; build++) {
      const a = constructionGenome({ build }),
        b = constructionGenome({ build: build + 1 });
      const changed = Array.from(a.weights).flatMap((w, i) =>
        w === b.weights[i] ? [] : [i]
      );
      expect(changed).toEqual([b2(OUT.BUILD)]);
      expect(b.weights[changed[0]] - a.weights[changed[0]]).toBe(1);
    }
  });
  it("no-build comparator retains every other expressed output", () => {
    const original = generalistGenome(154, 24), off = withoutBuilding(original);
    for (const p of [0, 20, 127]) {
      for (const e of [0, 30, 127]) {
        const x = new Int32Array([40, 127, 50, p, e, 127, 0, 0, 0, 0]),
          a = new Int32Array(8),
          b = new Int32Array(8);
        controllerForward(original.weights, x, new Int32Array(8), a);
        controllerForward(off.weights, x, new Int32Array(8), b);
        expect(b[OUT.BUILD]).toBe(0);
        a[OUT.BUILD] = 0;
        expect(b).toEqual(a);
      }
    }
    expect(genomeHex(original)).not.toBe(genomeHex(off));
  });
  it("rejects overlapping founder sites and does not share arrays between worlds", () => {
    const cfg = constructionConfig(101),
      placement = { x: 16, y: 16, genome: constructionGenome({ build: 16 }) };
    expect(() => constructionWorld(cfg, [placement, placement])).toThrow(
      "overlapping",
    );
    const a = constructionWorld(cfg, [placement]),
      b = constructionWorld(cfg, [placement]);
    a.cells[CH.B * 1024 + 528] = 1;
    expect(b.cells[CH.B * 1024 + 528]).toBe(1024);
  });
});
