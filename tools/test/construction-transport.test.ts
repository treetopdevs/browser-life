import { describe, expect, it } from "vitest";
import {
  allocState,
  cellCount,
  CH,
  cloneState,
  defaultConfig,
  stateHash,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";
import { RefSim } from "@bl/sim-ref";
import { patchTransport } from "../lib/construction-transport.ts";

function diffusionWorld(overrides: Partial<WorldConfig> = {}): WorldState {
  return allocState(defaultConfig({
    tileW: 8,
    tileH: 8,
    tilesX: 2,
    tilesY: 2,
    kernelRadius: 2,
    dtQ: 0,
    spread: 0,
    motility: false,
    mutRate: 0,
    kPhoto: 0,
    kResp: 0,
    kDecomp: 0,
    kGrow: 0,
    kBuild: 0,
    kEmit: 0,
    kCost: 0,
    kMaint: 0,
    kPDecay: 0,
    kBDecay: 0,
    kELeak: 0,
    kSDecay: 0,
    kAbio: 0,
    diffA: 231,
    diffC: 173,
    ...overrides,
  }));
}

function patchSum(
  s: WorldState,
  mask: ArrayLike<boolean | number>,
  ch: number,
): number {
  const n = cellCount(s.cfg);
  let total = 0;
  for (let i = 0; i < n; i++) if (mask[i]) total += s.cells[ch * n + i];
  return total;
}

describe("construction transport diagnostic", () => {
  for (const polymerTransport of [undefined, true, false]) {
    for (const seed of [1, 7, 42, 9001]) {
      it(`matches observed diffusion-only patch changes: seed ${seed}, gate ${polymerTransport}`, () => {
        const s = diffusionWorld({
          seed,
          ...(polymerTransport === undefined ? {} : { polymerTransport }),
        });
        s.step = 123; // Random draws must use the current step, not zero.
        const n = cellCount(s.cfg);
        const mask = Uint8Array.from(
          { length: n },
          (_, i) => Number((i * 17 + Math.floor(i / 16)) % 7 < 3),
        );
        for (let i = 0; i < n; i++) {
          s.cells[CH.A * n + i] = (i * 137 + 3) % 1027;
          s.cells[CH.C * n + i] = (i * 73 + 1) % 521;
          s.cells[CH.P * n + i] = (i * 31) % 257;
        }
        const before = stateHash(s);
        const flux = patchTransport(s, mask);
        expect(stateHash(s)).toBe(before);
        const sim = new RefSim(cloneState(s));
        sim.step();
        for (const [name, ch] of [["A", CH.A], ["C", CH.C]] as const) {
          expect(flux[name].grossIn).toBeGreaterThan(0);
          expect(flux[name].grossOut).toBeGreaterThan(0);
          expect(patchSum(sim.state, mask, ch) - patchSum(s, mask, ch)).toBe(
            flux[name].netIn,
          );
          expect(flux[name].netIn).toBe(
            flux[name].grossIn - flux[name].grossOut,
          );
        }
        const complement = Uint8Array.from(mask, (v) => 1 - v);
        const reverse = patchTransport(s, complement);
        for (const name of ["A", "C"] as const) {
          expect(reverse[name].grossIn).toBe(flux[name].grossOut);
          expect(reverse[name].grossOut).toBe(flux[name].grossIn);
        }
      });
    }
  }

  it("counts stochastic gross crossings independently and wraps both axes inside each tile", () => {
    const s = diffusionWorld({ seed: 37, diffA: 127, diffC: 219 });
    const n = cellCount(s.cfg), W = 16;
    // The source is at the bottom-right corner of tile (1, 1). Its four
    // receivers include the wrapped left and top edges of that same tile.
    const source = 15 * W + 15;
    s.cells[CH.A * n + source] = 1027;
    s.cells[CH.C * n + source] = 1031;
    const mask = new Uint8Array(n);
    mask[source] = 1;
    const flux = patchTransport(s, mask);
    const sim = new RefSim(cloneState(s));
    sim.step();
    const receivers = [15 * W + 8, 15 * W + 14, 8 * W + 15, 14 * W + 15];
    for (const [name, ch] of [["A", CH.A], ["C", CH.C]] as const) {
      const received = receivers.reduce(
        (sum, i) => sum + sim.state.cells[ch * n + i],
        0,
      );
      expect(received).toBeGreaterThan(0);
      expect(flux[name]).toEqual({
        grossIn: 0,
        grossOut: received,
        netIn: -received,
        internal: 0,
      });
      expect(sim.state.cells[ch * n + source]).toBe(
        s.cells[ch * n + source] - received,
      );
      for (let i = 0; i < n; i++) {
        if (i !== source && !receivers.includes(i)) {
          expect(sim.state.cells[ch * n + i]).toBe(0);
        }
      }
    }
  });

  it("keeps polymer in the state while disabling only its transport effect", () => {
    const s = diffusionWorld({ tilesX: 1, tilesY: 1 });
    const n = cellCount(s.cfg);
    s.cells[CH.A * n + 10] = 4099;
    s.cells[CH.C * n + 10] = 4097;
    s.cells[CH.P * n + 10] = 2048;
    const mask = new Uint8Array(n);
    mask[10] = 1;
    const gated = patchTransport(s, mask);
    const ungatedState = { ...s, cfg: { ...s.cfg, polymerTransport: false } };
    const ungated = patchTransport(ungatedState, mask);
    for (const name of ["A", "C"] as const) {
      expect(ungated[name].grossOut).toBeGreaterThan(gated[name].grossOut * 10);
    }
    expect(ungatedState.cells).toBe(s.cells);
    expect(s.cells[CH.P * n + 10]).toBe(2048);
  });

  it("counts every directed internal transfer once and none as boundary flux", () => {
    const s = diffusionWorld({ tilesX: 1, tilesY: 1, diffA: 256, diffC: 256 });
    const n = cellCount(s.cfg);
    s.cells[CH.A * n + 10] = 1027;
    s.cells[CH.C * n + 10] = 1031;
    expect(patchTransport(s, new Uint8Array(n).fill(1))).toEqual({
      A: { grossIn: 0, grossOut: 0, netIn: 0, internal: 1027 },
      C: { grossIn: 0, grossOut: 0, netIn: 0, internal: 1031 },
    });
    expect(patchTransport(s, new Uint8Array(n))).toEqual({
      A: { grossIn: 0, grossOut: 0, netIn: 0, internal: 0 },
      C: { grossIn: 0, grossOut: 0, netIn: 0, internal: 0 },
    });
  });

  it("rejects a mask whose indexing or values could silently change the region", () => {
    const s = diffusionWorld();
    expect(() => patchTransport(s, [true])).toThrow(/mask length/);
    const mask = new Uint8Array(cellCount(s.cfg));
    mask[17] = 2;
    expect(() => patchTransport(s, mask)).toThrow(/at 17/);
  });
});
