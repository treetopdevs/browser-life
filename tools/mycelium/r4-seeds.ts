// Mycelium rung R4: the registered slots, the arm seed offsets and the embargo, in a leaf module (no imports)
// (docs/mycelium-r4-2026-11-14/PROTOCOL.md section 2).
//
// A "slot" is the registered label of a run (dev 8001-8020, confirmation 7001-7016); the WORLD seed that goes into the config is slot + the arm's
// offset. Every offset is 130,000 or more, so every R4 world seed is above 9001: tools/mycelium/run.ts (seeds below 9001 only), r2.ts (its confirm
// gate takes 9001-9005 only) and the R3 runner's gate already refuse them without being edited (all are frozen-listed). The offsets also keep R4's
// worlds clear of every R2b world seed (at most 55,016), of R2's (101-105, 9001-9005), of R3's (60,001-126,016), of the trail-use screen's
// (8001-8004 and 108001-108004: those are the screen's WORLD seeds, R4 slots 8001-8004 are different worlds) and of the shaping scratch worlds
// (200,011-240,013). Shaping runs (smoke slots 1-100) take world seeds slot + offset.

/** World seed = slot + offset. Multiples of 10,000, from 130,000. */
export const R4_ARM_OFFSET = {
  inherit: 130_000,
  blocked: 140_000,
  physarum: 150_000,
  blind: 160_000,
  keyless: 170_000,
} as const;
export type R4Arm = keyof typeof R4_ARM_OFFSET;

const range = (a: number, b: number): number[] => Array.from({ length: b - a + 1 }, (_, i) => a + i);

export const R4_ARMS: readonly R4Arm[] = ["inherit", "blocked", "physarum", "blind", "keyless"];
/** Dev slots: 8001-8004 are the screen's slots (exploration), so they are dev data here, together with 8005-8020 (never run before). */
export const R4_DEV_SLOTS: readonly number[] = range(8001, 8020);
export const R4_CONFIRM_SLOTS: readonly number[] = range(7001, 7016);
/** Smoke slots (unlogged shaping runs, never analysed): 1-100. */
export const R4_SMOKE_SLOTS: readonly number[] = range(1, 100);

export const worldSeed = (arm: R4Arm, slot: number): number => slot + R4_ARM_OFFSET[arm];

/** Every registered world seed of R4 (every arm on dev and confirmation slots). */
export const R4_WORLD_SEEDS: readonly number[] = R4_ARMS.flatMap((a) => [...R4_DEV_SLOTS, ...R4_CONFIRM_SLOTS].map((s) => worldSeed(a, s)));

/** Why an ad-hoc tool may not run this world seed (null = allowed): R4's registered worlds run only through r4.ts, which logs them. */
export function r4EmbargoReason(seed: number): string | null {
  return R4_WORLD_SEEDS.includes(seed) ? `world seed ${seed} belongs to R4 (slots 8001-8020 and 7001-7016 plus the arm offsets); it runs only through tools/mycelium/r4.ts, which logs it` : null;
}
