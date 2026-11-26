// Pins the rules: any change to the dynamics changes these hashes. If a change
// is intended, bump RULE_VERSION and update the table deliberately.
import { describe, expect, it } from "vitest";
import { RULE_VERSION, cloneState } from "@bl/schema";
import { goldenCases } from "@bl/sim-gpu";
import { RefSim, applyLesion, createSim } from "@bl/sim-ref";
import { stateHash } from "@bl/schema";

// Digests cover config, step, cells, canonical genome and the full ledger
// (re-pinned 2026-09-26 when the digest was widened; the rules did not change).
// Version 1 is pre-release: the mutation saturation boundary (newB > mutCap)
// was corrected on 2026-09-26 before the first commit, without changing any
// earlier pin; "mutation-boundary" pins the corrected rule.
//
// WorldConfig's `adhesion`/`kAdhesion` (the adhesion actuator) are optional
// and deliberately absent from defaultConfig()'s own defaults (see
// WorldConfig in packages/schema/src/config.ts): the digest hashes the whole
// config object, so a config that never sets either key must serialise --
// and hash -- exactly as it did before this actuator existed. Only the
// "adhesion"/"adhesion-extremes"/"adhesion-default-gain" cases (which do set
// at least `adhesion`) get new pins below; the 8 original pins are untouched.
const PINNED: Record<number, Record<string, string>> = {
  1: {
    soup: "b3d47d070e6c6cea",
    "tiled+mutation-heavy": "117d8fd3b1e77f42",
    "patches+seasons": "3e4f084e6301f052",
    "lesion+stats": "d43796023aab7ee8",
    "blocked-affinity": "5305b74b343ada3a",
    extremes: "4ab5f8cae369f055",
    "neutral-shadow": "be5cf2be45d6a153",
    adhesion: "50eddcb6828ecddd",
    "adhesion-extremes": "00c9ffa767290ed9",
    "adhesion-default-gain": "16b879ff174bb74c",
    "mutation-boundary": "0966e96ab1306e8f",
    "ring-namespace": "e277953f6ebc2ea2",
    // Lossy takeover (WorldConfig.takeover, optional, ownership sandbox): new
    // cases only; every pin above is unchanged.
    "takeover-lineage": "b73f19659cf78e51",
    "takeover-growth": "e01f6f014554e875",
    "takeover-genome": "dfb56d29a4d59f7a",
    // Recurring injury (WorldConfig.injuryPeriod, optional, ownership sandbox).
    injury: "1fd51d2042631706",
    "injury-extremes": "a007c064a2346ee8",
    // Polymer shell (WorldConfig.injuryShell, optional, polymer-world line): a new case with its own pin.
    "injury-shell": "df7319e10feb7d7a",
    // Heritable kernel shape (WorldConfig.shapeReach, optional, cells sandbox).
    "shape-far": "2f9a2c0e000f2330",
    "shape-near": "01fbc54dc408e1e1",
    // Sandbox "sweep" light mode (optional dayPeriod, absent elsewhere): a new
    // case with its own pin; every pin above is untouched.
    sweep: "e69b229777d809cf",
    // Sandbox optional signalGain (absent elsewhere): its own new pin.
    "signal-gain": "950301275043e2fa",
    // Sandbox optional wanderPeriod/wanderAmp (absent elsewhere): its own new pin.
    "sweep-wander": "dcfbb10ffe638f13",
    // Wild sandbox: every optional lever at once (see the case in golden.ts).
    "wild-stack": "ba3c41c46b14c035",
    // Capability genes (WorldConfig.genes, the game kernel line; optional,
    // absent elsewhere): new cases with their own pins; every pin above is
    // untouched.
    "genes-decomp": "207f6b0053a52d07",
    "genes-bounds": "73e320eb8a5cacf7",
    // The "ladder" gene set (decomposition and polymer building): two more
    // new cases with their own pins; every pin above is untouched.
    "genes-ladder": "c8d0270e732bad02",
    "genes-ladder-bounds": "1cc368ef05021263",
    // Gene v2 (WorldConfig.geneDrive, a floor on build carriers' BUILD
    // output; optional, absent elsewhere): two more new cases with their own
    // pins; every pin above is untouched.
    "genes-drive": "b6b4127aa58f0771",
    "genes-drive-bounds": "6b4fe0eb8c8c68a2",
    // The slab (rung 1b, WorldConfig.tileD, RefSim3 / GpuSim3): new cases only, each with its own pin; every
    // pin above is untouched. Hashes are the GPU and CPU runs, which match bit for bit.
    "slab-default-32x32x8": "2a30968587fd834c",
    "slab-neutral-32x32x8": "57413fc0fa8dd2a0",
    "slab-shaded-column-32x32x8": "976a549cdd9ede48",
    "slab-motility-signal-32x32x8": "5db7e3fad79fe8cd",
    "slab-seasons-32x32x8": "0959c4baa0f3e8c3",
    "slab-default-64x64x8": "8343718f53adddf0",
    "slab-neutral-64x64x8": "68791d1c000eca7b",
    "slab-shaded-column-64x64x8": "a711f528cd2dc7fb",
    "slab-motility-signal-64x64x8": "aafe9e56c79358b7",
    "slab-seasons-64x64x8": "39951e02ad5a9ca6",
    // Review of M1+M2: arithmetic-boundary cases (E at 27 * 2^27 after transport with the per-cell heat carry, S past cap24
    // in all six directions, nested-share rounding at each D1, motility off). New cases only; no pin above changed.
    "slab-e-saturation-16x16x8": "a63ca8f1d1bb4d68",
    "slab-signal-limit-16x16x8": "828b2911bcbdfd54",
    "slab-rounding-spread8-16x16x8": "e3f05bae8a221f40",
    "slab-rounding-spread0-16x16x8": "fee86a6c0f8a01c5",
    "slab-rounding-spread32-16x16x8": "ac142dd61f152157",
    "slab-motility-off-16x16x8": "9c1e01eabbd0195f",
    // The jar (tileD 64, step A1 of docs/3d-expansion-plan-2026-11-15.md): new cases only, GPU and CPU bit for bit;
    // every pin above is untouched.
    "jar-default-16x16x64": "b3519c74e2454395",
    "jar-neutral-16x16x64": "b764ca79ae90a85d",
    "jar-shaded-column-16x16x64": "94f867816a461eaf",
    "jar-motility-seasons-16x16x64": "08a566625482c55e",
    "jar-cube-64x64x64": "132a5c1edbaa40ff",
    // Slab levers (sinkShift, floorDecay, upwellPeriod/upwellShift, rpsMutate; step A2 of docs/3d-expansion-plan-2026-11-15.md,
    // docs/3d-rung1b-step-spec.md section 17): optional keys, new cases only, GPU and CPU bit for bit; every pin above is untouched.
    "jar-sink-16x16x64": "b0396a3e23a2516d",
    "jar-floor-decay-16x16x64": "bf4e2771f06a08b1",
    "jar-upwell-16x16x64": "310c955992bb1300",
    "jar-upwell-only-16x16x64": "8dfa1c19f17e90ac",
    "jar-levers-16x16x64": "04f377cc1fbdb78d",
    "jar-levers-cube-64x64x64": "a3b9440445cfc35a",
    "slab-rps-mutate-16x16x8": "9a639aea70e8a000",
    "slab-rps-mutate-k5-16x16x8": "0f61883eaa5a3644",
  },
};

// The 64x64x8 slab cases cost minutes of CPU on a loaded machine and run bit for bit against the GPU in
// tests/deno/gpu_golden.ts and the Chrome golden anyway: vitest checks their pins only on request
// (BL_SLAB_BIG=1 pnpm vitest run packages/sim-ref/test/golden-hashes.test.ts). The 32x32x8 and 16x16x8 pins always run.
// The jar's 64-cubes (jar-cube, jar-levers-cube) are gated the same way; their 16x16x64 pins always run.
const big = process.env.BL_SLAB_BIG === "1";
const heavy = (name: string) => (name.startsWith("slab-") && name.includes("64x64x8")) || name === "jar-cube-64x64x64" || name === "jar-levers-cube-64x64x64";

describe(`rule version ${RULE_VERSION}`, () => {
  for (const gc of goldenCases()) {
    (heavy(gc.name) && !big ? it.skip : it)(`${gc.name} matches its pinned hash`, () => {
      const sim = createSim(cloneState(gc.init(gc.cfg)));
      for (let s = 0; s < gc.steps; s += gc.every) {
        sim.run(gc.every);
        if (gc.lesion && s === 0 && sim instanceof RefSim) applyLesion(sim, ...gc.lesion);
      }
      expect(stateHash(sim.state)).toBe(PINNED[RULE_VERSION]?.[gc.name]);
    }, heavy(gc.name) ? 600_000 : undefined);
  }
});
