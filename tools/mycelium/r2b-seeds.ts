// Mycelium rung R2b: the registered seed sets and the arm seed offsets, in a leaf module (no imports) so that run.ts and r2.ts can refuse
// the embargoed worlds without importing the protocol (docs/mycelium-r2b-2026-11-13/PROTOCOL.md sections 2 and 5).
//
// A "slot" is the registered seed label of a run (dev 2001-2020, confirmation 5001-5016, matching 2001-2008); the WORLD seed that goes
// into the config is slot + the arm's offset, so no two arms share founders or a PRNG stream and the unpaired tests of section 8 rest
// on independent worlds, not on a claim that a shared seed has no effect.

/** World seed = slot + offset. Offsets are multiples of 10,000, above every slot (the largest is 5016) and below nothing else registered. */
export const ARM_SEED_OFFSET = {
  inherit: 0,
  blocked: 10_000,
  physarum: 20_000,
  "pc-light": 30_000,
  "pc-upkeep": 40_000,
  "pc-blind": 50_000,
} as const;

export const worldSeed = (arm: keyof typeof ARM_SEED_OFFSET, slot: number): number => slot + ARM_SEED_OFFSET[arm];

const range = (a: number, b: number): number[] => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** Every slot R2b registers (dev, matching and confirmation, full plan). */
export const R2B_SLOTS: readonly number[] = [...range(2001, 2020), ...range(5001, 5016)];
/** R2's seeds, never run by R2b (R2 stays restartable). */
export const R2_SEEDS: readonly number[] = [...range(101, 105), ...range(9001, 9005)];

/** The world seeds of every R2b slot under every arm: embargoed outside the R2b runner. */
export const R2B_WORLD_SEEDS: readonly number[] = Object.values(ARM_SEED_OFFSET).flatMap((o) => R2B_SLOTS.map((s) => s + o));

/**
 * Why an ad-hoc tool (run.ts, r2.ts) may not run this world seed (null = allowed). `r2b` covers R2b's dev, matching and confirmation worlds
 * under every arm; `r2` covers R2's own seeds (refused to R2b only, so R2's tools still run them under their own gates).
 */
export function embargoReason(seed: number, which: { r2b: boolean; r2: boolean }): string | null {
  if (which.r2b && R2B_WORLD_SEEDS.includes(seed)) return `world seed ${seed} belongs to R2b (slots 2001-2020 and 5001-5016 plus the arm offsets); it runs only through tools/mycelium/r2b.ts, which logs it`;
  if (which.r2 && R2_SEEDS.includes(seed)) return `seed ${seed} belongs to R2 (101-105, 9001-9005)`;
  return null;
}
