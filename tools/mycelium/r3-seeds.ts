// Mycelium rung R3: the registered slots, the arm seed offsets and the embargo, in a leaf module (no imports)
// (docs/mycelium-r3-2026-11-13/PROTOCOL.md section 2).
//
// A "slot" is the registered label of a run (dev 2001-2010, confirmation 6001-6016); the WORLD seed that goes into the config is slot + the
// arm's offset. Every offset is 60,000 or more, so every R3 world seed is above 9001: tools/mycelium/run.ts (seeds below 9001 only) and
// r2.ts (its confirm gate takes 9001-9005 only) refuse them without being edited (both are in R2's FROZEN list). The offsets also keep
// R3's worlds clear of every R2b world seed (at most 55,016), of R2's seeds (101-105, 9001-9005) and of the other exploration's slots
// 8001-8099, which are not R3's and are never used here.

/** World seed = slot + offset. Multiples of 10,000, from 60,000. */
export const R3_ARM_OFFSET = {
  inherit: 60_000,
  blocked: 70_000,
  frozen: 80_000,
  "inherit-c1": 90_000,
  "inherit-c4": 100_000,
  "blocked-c1": 110_000,
  "blocked-c4": 120_000,
} as const;
export type R3Arm = keyof typeof R3_ARM_OFFSET;

const range = (a: number, b: number): number[] => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** Arms R3 runs itself in dev. inherit and blocked at the default cost reuse R2b's dev series on slots 2001-2020 (their R2b world seeds). */
export const R3_DEV_ARMS: readonly R3Arm[] = ["frozen", "inherit-c1", "inherit-c4", "blocked-c1", "blocked-c4"];
export const R3_DEV_SLOTS: readonly number[] = range(2001, 2010);
/** The R2b dev slots whose inherit and blocked series R3 reads (read-only, dev data only). */
export const R2B_REUSED_SLOTS: readonly number[] = range(2001, 2020);
export const R3_CONFIRM_ARMS: readonly R3Arm[] = ["inherit", "blocked", "frozen", "inherit-c1", "inherit-c4", "blocked-c1", "blocked-c4"];
export const R3_CONFIRM_SLOTS: readonly number[] = range(6001, 6016);
/** Smoke slots (unlogged, never analysed): 1-100, world seed = slot + offset (60,001 and up, not a registered world). */
export const R3_SMOKE_SLOTS: readonly number[] = range(1, 100);
/** R2b's embargoed confirmation slots: left unused and unrun. */
export const R2B_EMBARGOED_SLOTS: readonly number[] = range(5001, 5016);
/** Not R3's: another exploration's seeds. */
export const NOT_R3_SLOTS: readonly number[] = range(8001, 8099);

export const worldSeed = (arm: R3Arm, slot: number): number => slot + R3_ARM_OFFSET[arm];

/** Every registered world seed of R3 (dev arms on dev slots, every arm on confirmation slots). */
export const R3_WORLD_SEEDS: readonly number[] = [
  ...R3_DEV_ARMS.flatMap((a) => R3_DEV_SLOTS.map((s) => worldSeed(a, s))),
  ...R3_CONFIRM_ARMS.flatMap((a) => R3_CONFIRM_SLOTS.map((s) => worldSeed(a, s))),
];

/** Why an ad-hoc tool may not run this world seed (null = allowed): R3's registered worlds run only through r3.ts, which logs them. */
export function r3EmbargoReason(seed: number): string | null {
  return R3_WORLD_SEEDS.includes(seed) ? `world seed ${seed} belongs to R3 (slots 2001-2010 and 6001-6016 plus the arm offsets); it runs only through tools/mycelium/r3.ts, which logs it` : null;
}
