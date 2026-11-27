/**
 * MOVING6: the rate settings of the follow-up to the six-wall spot-rate screen, and how a world is built from
 * one (docs/six-wall-moving-2026-11-22/PLAN.md).
 *
 * Nothing here edits the frozen kernel or the earlier screen. The line from the confirmation's rates to the
 * spot rates (`mixRates`), the two phage variants, the size, the census spacing and the allowed seeds are
 * imported from experiments/spot6/settings.ts. Copied from that file: the body of `buildSpec` (six lines),
 * because the earlier `buildSpec` resolves names through its own list of six settings and refuses `MIX12`
 * and `MIX37`. experiments/test/moving6-rule.test.ts checks that for `MIX25` and its two variants the copy
 * gives the earlier function's config key for key.
 */

import { defaultDropletKernelConfig } from '../../apps/lab/src/oligomer/droplets-kernel.ts';
import { PHAGE_RUN_DEFAULTS, phageArms, type DropletArmId } from '../../apps/lab/src/oligomer/droplet-worlds.ts';
import { mixRates, PHAGE_VARIANTS, type Setting, SIZE, type WorldSpec } from '../spot6/settings.ts';

export { CENSUS, emergenceBound, SIZE, UNSEEN_SEEDS } from '../spot6/settings.ts';

/**
 * Seeds this line may run: the earlier screen's list (a unit test checks the two are equal). 33 to 40 are kept
 * unseen. A later confirmation changes this one line (PLAN.md); nothing in this line does.
 */
export const ALLOWED_SEEDS: readonly number[] = [1, 2, 3, 4];

/** The primary setting. The question is asked of it. */
export const PRIMARY = 'MIX25';
/** The two neighbours on the same line, secondary. */
export const NEIGHBOURS: readonly string[] = ['MIX12', 'MIX37'];

/** The three rate settings. None may be added after the first new run. */
export const SETTINGS: readonly Setting[] = [
  { name: 'MIX25', rates: mixRates(0.25), phage: {}, variant: false, note: 'a quarter of the way from the confirmation\'s rates to the spot rates (the earlier screen\'s MIX25)' },
  { name: 'MIX12', rates: mixRates(0.125), phage: {}, variant: false, note: 'an eighth of the way: between the wave world and MIX25' },
  { name: 'MIX37', rates: mixRates(0.375), phage: {}, variant: false, note: 'three eighths of the way: between MIX25 and the frozen lattice of MIX50' },
];

/** The two phage variants carry over at the primary setting only. */
export const VARIANT_BASE = PRIMARY;

/** Resolves a setting name of this line. A phage variant is written `<VARIANT>@MIX25`. */
export function settingOf(name: string): Setting {
  const at = name.indexOf('@');
  if (at < 0) {
    const s = SETTINGS.find((x) => x.name === name);
    if (!s) throw new Error(`unknown setting in this line: ${name} (only ${SETTINGS.map((x) => x.name).join(', ')} and the two phage variants at ${VARIANT_BASE})`);
    return s;
  }
  const v = PHAGE_VARIANTS.find((x) => x.name === name.slice(0, at));
  const baseName = name.slice(at + 1);
  const base = SETTINGS.find((x) => x.name === baseName);
  if (!v || !base || baseName !== VARIANT_BASE) throw new Error(`unknown phage variant setting in this line: ${name} (variants run at ${VARIANT_BASE} only)`);
  return { name, rates: base.rates, phage: v.phage, variant: true, note: `${v.note}, at the ${base.name} rates` };
}

/** The rate setting a name stands on: itself, or for a phage variant the setting after the `@`. */
export function baseSettingOf(name: string): string {
  const at = name.indexOf('@');
  return at < 0 ? name : name.slice(at + 1);
}

/** One arm of the confirmation at one setting of this line (the earlier `buildSpec`, with this line's names). */
export function buildSpec(settingName: string, armName: string, seed: number): WorldSpec {
  if (!ALLOWED_SEEDS.includes(seed)) throw new Error(`seed ${seed} is not allowed in this line (only ${ALLOWED_SEEDS.join(', ')})`);
  const setting = settingOf(settingName);
  const arm = phageArms({ ...PHAGE_RUN_DEFAULTS, ...setting.phage }).find((a) => a.name === (armName as DropletArmId));
  if (!arm) throw new Error(`unknown arm: ${armName}`);
  return { size: SIZE, single: arm.single, cfg: defaultDropletKernelConfig({ width: SIZE, height: SIZE, seed, ...arm.ov, ...setting.rates }) };
}
