/**
 * SPOT6: the pre-listed rate settings and how a world is built from one (docs/six-wall-spot-2026-11-22/PLAN.md).
 *
 * Nothing here edits the frozen kernel. A setting is a set of config overrides laid over the confirmation's own
 * construction (`defaultDropletKernelConfig({ width, height, seed, ...arm.ov })` in experiments/confirm/run-droplets.ts).
 * With the `B2` setting (no overrides) the config is exactly the confirmation's.
 */

import { defaultDropletKernelConfig, type DropletKernelConfig } from '../../apps/lab/src/oligomer/droplets-kernel.ts';
import { PHAGE_RUN_DEFAULTS, phageArms, type DropletArmId, type PhageParams } from '../../apps/lab/src/oligomer/droplet-worlds.ts';

export const SIZE = 128;
export const CENSUS = 500;
/** Seeds this line may run. 5 to 16 were the confirmation's and the compartment check's; 33 to 40 are kept unseen. */
export const ALLOWED_SEEDS: readonly number[] = [1, 2, 3, 4];
export const UNSEEN_SEEDS: readonly number[] = [33, 34, 35, 36, 37, 38, 39, 40];

export interface Rates {
  readonly kDeg: number;
  readonly diffW: number;
  readonly diffF: number;
}

/** The kernel's own defaults (what the confirmation ran) and the sandbox line's spot rates. */
export const B2_RATES: Rates = { kDeg: 0.06, diffW: 0.04, diffF: 0.2 };
export const SPOT_RATES: Rates = { kDeg: 0.085, diffW: 0.015, diffF: 0.3 };

/** A point on the straight line from the B2 rates (t = 0) to the spot rates (t = 1), rounded to 5 decimals. */
export function mixRates(t: number): Rates {
  const mix = (a: number, b: number) => Math.round((a + t * (b - a)) * 1e5) / 1e5;
  return { kDeg: mix(B2_RATES.kDeg, SPOT_RATES.kDeg), diffW: mix(B2_RATES.diffW, SPOT_RATES.diffW), diffF: mix(B2_RATES.diffF, SPOT_RATES.diffF) };
}

export interface Setting {
  readonly name: string;
  /** Rate overrides. Empty for B2: the config is then the confirmation's, key for key. */
  readonly rates: Partial<Rates>;
  /** Phage parameter overrides (only the two labelled phage variants have any). */
  readonly phage: Partial<PhageParams>;
  /** For a phage variant: the rate setting it borrows its rates from is chosen at run time (PLAN.md), so `rates` is filled by `variantAt`. */
  readonly variant: boolean;
  readonly note: string;
}

/** The six rate settings. None may be added after the first six-wall run at a non-default rate. */
export const SETTINGS: readonly Setting[] = [
  { name: 'B2', rates: {}, phage: {}, variant: false, note: 'the confirmation\'s rates (known reference: wave patches)' },
  { name: 'MIX25', rates: mixRates(0.25), phage: {}, variant: false, note: 'a quarter of the way from B2 to the spot rates' },
  { name: 'MIX50', rates: mixRates(0.5), phage: {}, variant: false, note: 'half way' },
  { name: 'MIX75', rates: mixRates(0.75), phage: {}, variant: false, note: 'three quarters of the way' },
  { name: 'SPOT', rates: SPOT_RATES, phage: {}, variant: false, note: 'the pure spot rates' },
  { name: 'DIFF_ONLY', rates: { diffW: SPOT_RATES.diffW, diffF: SPOT_RATES.diffF }, phage: {}, variant: false, note: 'B2 wall decay with the spot diffusion pair (fuel to wall diffusion ratio 20 in place of 5)' },
];

/** The two pre-listed phage variants (PLAN.md says when each may run, and at which rate setting). */
export const PHAGE_VARIANTS: readonly { readonly name: string; readonly phage: Partial<PhageParams>; readonly note: string }[] = [
  { name: 'PH_LONG', phage: { kDecayP: 0.002 }, note: 'phage decays ten times more slowly (for "phage lost")' },
  { name: 'PH_MILD', phage: { kInfect: 0.17 }, note: 'phage infects at half the rate (for "collapse")' },
];

/** Resolves a setting name. A phage variant is written `<VARIANT>@<RATE SETTING>`, for example `PH_LONG@MIX50`. */
export function settingOf(name: string): Setting {
  const at = name.indexOf('@');
  if (at < 0) {
    const s = SETTINGS.find((x) => x.name === name);
    if (!s) throw new Error(`unknown setting: ${name}`);
    return s;
  }
  const v = PHAGE_VARIANTS.find((x) => x.name === name.slice(0, at));
  const base = SETTINGS.find((x) => x.name === name.slice(at + 1));
  if (!v || !base) throw new Error(`unknown phage variant setting: ${name}`);
  return { name, rates: base.rates, phage: v.phage, variant: true, note: `${v.note}, at the ${base.name} rates` };
}

/** The rate setting a name stands on: itself, or for a phage variant the setting after the `@`. */
export function baseSettingOf(name: string): string {
  const at = name.indexOf('@');
  return at < 0 ? name : name.slice(at + 1);
}

export interface WorldSpec {
  readonly size: number;
  readonly cfg: DropletKernelConfig;
  readonly single: boolean;
}

/** One arm of the confirmation at one setting. With `B2` this is exactly run-droplets.ts's construction. */
export function buildSpec(settingName: string, armName: string, seed: number): WorldSpec {
  if (!ALLOWED_SEEDS.includes(seed)) throw new Error(`seed ${seed} is not allowed in this line (only ${ALLOWED_SEEDS.join(', ')})`);
  const setting = settingOf(settingName);
  const arm = phageArms({ ...PHAGE_RUN_DEFAULTS, ...setting.phage }).find((a) => a.name === (armName as DropletArmId));
  if (!arm) throw new Error(`unknown arm: ${armName}`);
  return { size: SIZE, single: arm.single, cfg: defaultDropletKernelConfig({ width: SIZE, height: SIZE, seed, ...arm.ov, ...setting.rates }) };
}

/**
 * The most phage a world could hold, on average, if phage never grew in wall: every tile turns 5 units of wall
 * into phage with probability `mutPhage` per step (the kernel's rule 1e; only tiles whose leading wall is at
 * least 10 units do, so this is an upper bound) and phage decays at `kDecayP` per step.
 */
export function emergenceBound(cfg: DropletKernelConfig): number {
  return cfg.kDecayP > 0 ? (cfg.width * cfg.height * cfg.mutPhage * 5) / cfg.kDecayP : Infinity;
}
