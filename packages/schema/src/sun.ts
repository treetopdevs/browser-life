// The sun: an experimenter intervention that dims or brightens a world's light for a span of steps, then lets the world's
// own light return (docs/garden-sun-2026-10-18.md). Like a lesion or a feed it is never part of the rules or of a config:
// a host applies it, logs it (Intervention, kind "sun") and replays it from the log. Unlike a feed it moves no matter and
// no baseline: the light it changes is booked in the ledger's `lightIn` as all light is.
//
// The rule: under a sun of `percent` p, the physics runs with the world's config except for its three brightness values,
//   lightBase = floor(lightBase * p / 100), lightAmp = floor(lightAmp * p / 100), seasonAmp = floor(seasonAmp * p / 100)
// (`sunLight`), so the sun keeps its mode, position, day, wander and season's phase. The integers are computed here, once,
// in TypeScript, and both kernels receive the same three: the CPU through `SunRefSim` (@bl/sim-ref), the GPU through a
// react pipeline compiled from `sunConfig` (`GpuSim.setLight`). A sun whose scaled config would not be a valid config
// (each value in 0..255 and their sum at most 255, `validateConfig`'s light rules) is refused (`sunError`), never clamped,
// so every config a kernel sees under a sun is one the arithmetic bounds of docs/rules.md already cover.
import { validateConfig, type WorldConfig } from "./config.ts";

/** The percents a sun may take: half, three quarters, a quarter more, half more. 100 changes nothing; 0 is a death, not a dial. */
export const SUN_PERCENTS: readonly number[] = [50, 75, 125, 150];

/** The longest span a sun may last, in steps. */
export const SUN_SPAN_MAX = 2 ** 24;

/** The three brightness values of a config, which a sun scales. */
export interface LightParams {
  lightBase: number;
  lightAmp: number;
  seasonAmp: number;
}

/** A world's own light: its config's three brightness values. */
export function worldLight(cfg: Pick<WorldConfig, "lightBase" | "lightAmp" | "seasonAmp">): LightParams {
  return { lightBase: cfg.lightBase, lightAmp: cfg.lightAmp, seasonAmp: cfg.seasonAmp };
}

/** The light under a sun of `percent`: each brightness value of `cfg` times `percent` / 100, floored. Not checked: see `sunError`. */
export function sunLight(cfg: Pick<WorldConfig, "lightBase" | "lightAmp" | "seasonAmp">, percent: number): LightParams {
  const f = (v: number) => Math.floor((v * percent) / 100);
  return { lightBase: f(cfg.lightBase), lightAmp: f(cfg.lightAmp), seasonAmp: f(cfg.seasonAmp) };
}

/** `cfg` with its light replaced by `light` (a new object; `cfg` is not touched). */
export function withLight(cfg: WorldConfig, light: LightParams): WorldConfig {
  return { ...cfg, lightBase: light.lightBase, lightAmp: light.lightAmp, seasonAmp: light.seasonAmp };
}

/** The config the physics runs under during a sun of `percent`: `cfg` with `sunLight(cfg, percent)`. Not checked: see `sunError`. */
export function sunConfig(cfg: WorldConfig, percent: number): WorldConfig {
  return withLight(cfg, sunLight(cfg, percent));
}

/** Whether two lights are the same three values (null is the world's own light, equal only to null). */
export function sameLight(a: LightParams | null, b: LightParams | null): boolean {
  if (a === null || b === null) return a === b;
  return a.lightBase === b.lightBase && a.lightAmp === b.lightAmp && a.seasonAmp === b.seasonAmp;
}

/**
 * Why a world of config `cfg` cannot take a sun of `percent`, or null when it can: a percent outside `SUN_PERCENTS`, or a
 * scaled light that is not a valid config's (a value above 255, or a sum above 255), in words that say what the sun would
 * have made of the world's light.
 */
export function sunError(cfg: WorldConfig, percent: number): string | null {
  if (!SUN_PERCENTS.includes(percent)) return `a sun's percent is one of ${SUN_PERCENTS.join(", ")}, got ${JSON.stringify(percent)}`;
  const l = sunLight(cfg, percent);
  const sum = l.lightBase + l.lightAmp + l.seasonAmp;
  const bad = [
    ...(["lightBase", "lightAmp", "seasonAmp"] as const).filter((k) => l[k] > 255).map((k) => `${k} would be ${l[k]}, above 255`),
    ...(sum > 255 ? [`base, amplitude and season would add up to ${sum}, above 255`] : []),
  ];
  if (bad.length) return `this world's light cannot take a sun of ${percent}%: ${bad.join("; ")}`;
  // Defence in depth: whatever validateConfig says of the light it would say of every sun config, so say it here first.
  const errs = validateConfig(sunConfig(cfg, percent));
  return errs.length ? `this world's light cannot take a sun of ${percent}%: ${errs[0]}` : null;
}
