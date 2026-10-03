import { describe, expect, it } from "vitest";
import { decodeCheckpoint, defaultConfig, digestWords, encodeCheckpoint, soupWorld, stateHash } from "@bl/schema";

function withHeaderVersion(bytes: Uint8Array, version: number): Uint8Array {
  const words = new Uint32Array(bytes.slice().buffer);
  words[2] = version;
  const [a, b] = digestWords(words.subarray(0, words.length - 2));
  words[words.length - 2] = a;
  words[words.length - 1] = b;
  return new Uint8Array(words.buffer);
}

describe("checkpoint physics version", () => {
  for (const ruleVersion of [1, 2]) {
    it(`round-trips rule ${ruleVersion} without upgrading its config or digest`, () => {
      const cfg = defaultConfig({ ruleVersion, tileW: 32, tileH: 32, kernelRadius: 2,
        ...(ruleVersion === 2 ? { polymerDrag: true } : {}) });
      const original = soupWorld(cfg, 1, 32, 64);
      const bytes = encodeCheckpoint(original, { witness: "versioned" });
      const { state, observer } = decodeCheckpoint(bytes);
      expect(state.cfg).toEqual(cfg);
      expect(stateHash(state)).toBe(stateHash(original));
      expect(encodeCheckpoint(state, observer)).toEqual(bytes);
    });
  }

  it("rejects a supported but inconsistent header even with a valid checksum", () => {
    const state = soupWorld(defaultConfig({ ruleVersion: 1, tileW: 32, tileH: 32, kernelRadius: 2 }), 1, 32, 64);
    expect(() => decodeCheckpoint(withHeaderVersion(encodeCheckpoint(state), 2))).toThrow(/header rule version 2 != config 1/);
  });

  it("rejects an unknown version even with a valid checksum", () => {
    const state = soupWorld(defaultConfig({ tileW: 32, tileH: 32, kernelRadius: 2 }), 1, 32, 64);
    expect(() => decodeCheckpoint(withHeaderVersion(encodeCheckpoint(state), 999))).toThrow(/unsupported rule version 999/);
  });
});
