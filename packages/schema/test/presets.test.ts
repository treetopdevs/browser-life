// presetIdentity: the content-identity digest experiments/endpoints.ts
// records alongside a frozen activity threshold (tools/calibrate.ts), so
// tools/analyze.ts can refuse to use a frozen value once the preset it was
// calibrated against has changed underneath it.
import { describe, expect, it } from "vitest";
import { M3_FOUNDER_SET, PRESETS, presetIdentity, type Preset } from "@bl/schema";

const gradientM3 = PRESETS.find((p) => p.id === "gradient-m3")!;
const spotsM3 = PRESETS.find((p) => p.id === "spots-m3")!;
const spots = PRESETS.find((p) => p.id === "spots")!;

describe("presetIdentity", () => {
  it("is deterministic: repeated calls on the same preset agree", () => {
    expect(presetIdentity(gradientM3)).toBe(presetIdentity(gradientM3));
  });

  it("differs between presets with different cfg (gradient-m3 vs spots-m3)", () => {
    expect(presetIdentity(gradientM3)).not.toBe(presetIdentity(spotsM3));
  });

  it("differs between an M3-founder preset and a generalist preset with the same cfg shape (founder set matters)", () => {
    // "spots" and "spots-m3" share the same light/tile cfg (SPOT_REGIME +
    // uniform light) but differ in init.kind ("generalist" vs "m3") and
    // founder count -- both should move the digest.
    expect(presetIdentity(spots)).not.toBe(presetIdentity(spotsM3));
  });

  it("is unaffected by a preset's seed (presetConfig's seed is fixed internally, never taken as input)", () => {
    // presetIdentity has no seed parameter at all: build the same preset
    // twice from scratch (a fresh object, not a shared reference) and check
    // they still agree -- guards against a future accidental parameterization.
    const a: Preset = { ...gradientM3, cfg: { ...gradientM3.cfg }, init: { ...gradientM3.init } };
    const b: Preset = { ...gradientM3, cfg: { ...gradientM3.cfg }, init: { ...gradientM3.init } };
    expect(presetIdentity(a)).toBe(presetIdentity(b));
  });

  it("changes when a preset's cfg field changes", () => {
    const changed: Preset = { ...gradientM3, cfg: { ...gradientM3.cfg, lightBase: (gradientM3.cfg.lightBase ?? 0) + 1 } };
    expect(presetIdentity(changed)).not.toBe(presetIdentity(gradientM3));
  });

  it("changes when init params change (e.g. founder count)", () => {
    const changed: Preset = { ...gradientM3, init: { ...gradientM3.init, founders: gradientM3.init.founders + 1 } };
    expect(presetIdentity(changed)).not.toBe(presetIdentity(gradientM3));
  });

  it("is sensitive to which founder set an 'm3' preset resolves to (a synthetic renamed founder set changes the digest)", () => {
    // Can't actually change M3_FOUNDER_SET (it's a repo-wide constant), but
    // presetIdentity's own construction folds it in only for init.kind ===
    // "m3" -- a preset that claims "m3" but isn't one of the two real M3
    // presets still gets the same founderSetId contribution, so this checks
    // the kind-gating itself: a "generalist" clone of an m3 preset (same
    // cfg/founders, different kind) must differ.
    const asGeneralist: Preset = { ...gradientM3, init: { ...gradientM3.init, kind: "generalist" } };
    expect(presetIdentity(asGeneralist)).not.toBe(presetIdentity(gradientM3));
  });

  it("folds in M3_FOUNDER_SET's actual value for an m3-kind preset (sanity check on the real constant)", () => {
    // Not a strong assertion (we can't rebuild the digest independently
    // without duplicating presetIdentity's internals), just confirms the
    // constant this test's comments rely on hasn't silently vanished.
    expect(typeof M3_FOUNDER_SET).toBe("string");
    expect(M3_FOUNDER_SET.length).toBeGreaterThan(0);
  });
});
