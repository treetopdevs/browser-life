// The reference physics under a sun (@bl/schema's sun.ts; docs/garden-sun-2026-10-18.md): `SunRefSim` is a `RefSim` whose
// light, while a sun is set, is the spec's own `RefSim.prototype.light` run with the sun's config as its `this.cfg`. That
// method reads nothing of `this` but `cfg` (and module-level helpers), so the light formula is not copied, step.ts is not
// edited, and the world's own `cfg` (and `state.cfg`, the same object) never changes: a checkpoint of a sunned world
// carries the world's config, and the sun travels in its observer state.
import { withLight, type LightParams, type WorldConfig, type WorldState } from "@bl/schema";
import { RefSim } from "./step.ts";

export class SunRefSim extends RefSim {
  /** The light the physics uses now, or null for the world's own. */
  private sun: LightParams | null = null;
  /** `cfg` with the sun's light, as `RefSim.light` reads it. */
  private sunCfg: { cfg: WorldConfig } | null = null;

  constructor(state: WorldState) {
    super(state);
  }

  /** The sun's three values while a sun is set, else null (the world's own light, `cfg`'s). */
  get activeLight(): LightParams | null {
    return this.sun;
  }

  /**
   * Sets the light the following steps use (`sunLight(cfg, percent)` of a sun), or the world's own (null). Async to match
   * `GpuSim.setLight`, and effective at once. `cfg` is never touched.
   */
  async setLight(light: LightParams | null): Promise<void> {
    this.setLightNow(light);
  }

  /** `setLight`, synchronously (CPU hosts that step without awaiting). */
  setLightNow(light: LightParams | null): void {
    this.sun = light === null ? null : { ...light };
    this.sunCfg = light === null ? null : { cfg: withLight(this.cfg, light) };
  }

  override light(x: number, y: number, step: number): number {
    return this.sunCfg ? RefSim.prototype.light.call(this.sunCfg as unknown as RefSim, x, y, step) : super.light(x, y, step);
  }
}
