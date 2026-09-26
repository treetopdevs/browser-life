// Bedau–Packard evolutionary activity statistics over lineage (genotype)
// abundance time series. A component's activity is its cumulative abundance;
// components whose activity exceeds what neutral drift produces are taken as
// adaptively significant. The threshold comes from neutral-shadow runs.

export interface ActivitySnapshot {
  step: number;
  /** Components present (diversity). */
  diversity: number;
  /** Total cumulative activity of present components. */
  totalActivity: number;
  /** Mean cumulative activity of present components. */
  meanActivity: number;
  /** Present components whose activity exceeds the threshold. */
  significant: number;
  /** Components that crossed the threshold since the previous snapshot (new activity). */
  newActivity: number;
  /** Cumulative count of components that ever crossed the threshold. */
  cumulativeNew: number;
}

export interface ActivityState {
  threshold: number | null;
  comps: [string, Comp][];
  cumulativeNew: number;
  extinct: number[];
}

interface Comp {
  activity: number;
  born: number;
  crossed: boolean;
  lastSeen: number;
}

export class ActivityTracker {
  private comps = new Map<string, Comp>();
  private cumulativeNew = 0;
  /** Final activity of components that went extinct (for neutral thresholds). */
  readonly extinctActivity: number[] = [];

  /**
   * @param threshold activity (abundance × censuses) above which a component
   *   counts as adaptively significant; Infinity to only collect distributions.
   */
  constructor(public threshold = Infinity) {}

  update(step: number, abundance: Iterable<[string, number]>): ActivitySnapshot {
    let diversity = 0;
    let total = 0;
    let significant = 0;
    let fresh = 0;
    const seen = new Set<string>();
    for (const [key, a] of abundance) {
      if (a <= 0) continue;
      seen.add(key);
      let c = this.comps.get(key);
      if (!c) this.comps.set(key, (c = { activity: 0, born: step, crossed: false, lastSeen: step }));
      c.activity += a;
      c.lastSeen = step;
      diversity++;
      total += c.activity;
      // Strictly above the neutral threshold: ties with neutral activity are not adaptive.
      if (c.activity > this.threshold) {
        significant++;
        if (!c.crossed) {
          c.crossed = true;
          fresh++;
          this.cumulativeNew++;
        }
      }
    }
    for (const [key, c] of this.comps) {
      if (seen.has(key)) continue;
      this.extinctActivity.push(c.activity);
      this.comps.delete(key);
    }
    return {
      step,
      diversity,
      totalActivity: total,
      meanActivity: diversity ? total / diversity : 0,
      significant,
      newActivity: fresh,
      cumulativeNew: this.cumulativeNew,
    };
  }

  /** Deep-copied snapshot: later updates never alter a saved state. */
  toJSON(): ActivityState {
    return structuredClone({
      threshold: Number.isFinite(this.threshold) ? this.threshold : null,
      comps: [...this.comps.entries()],
      cumulativeNew: this.cumulativeNew,
      extinct: this.extinctActivity,
    });
  }

  static fromJSON(saved: ActivityState): ActivityTracker {
    const s = structuredClone(saved);
    const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;
    const ok =
      s && typeof s === "object" && (s.threshold === null || typeof s.threshold === "number") &&
      Array.isArray(s.comps) &&
      s.comps.every((e) => Array.isArray(e) && typeof e[0] === "string" && e[1] && num(e[1].activity) && num(e[1].born) && typeof e[1].crossed === "boolean") &&
      Number.isSafeInteger(s.cumulativeNew) && s.cumulativeNew >= 0 && Array.isArray(s.extinct) && s.extinct.every(num);
    if (!ok) throw new Error("malformed activity state");
    const t = new ActivityTracker(s.threshold ?? Infinity);
    t.comps = new Map(s.comps);
    t.cumulativeNew = s.cumulativeNew;
    for (const a of s.extinct) t.extinctActivity.push(a);
    return t;
  }

  /** Activities of all components ever observed (present and extinct). */
  allActivities(): number[] {
    return [...this.extinctActivity, ...[...this.comps.values()].map((c) => c.activity)];
  }

  /** Present components sorted by activity, for activity-wave plots. */
  top(k = 20): { key: string; activity: number; born: number }[] {
    return [...this.comps.entries()]
      .map(([key, c]) => ({ key, activity: c.activity, born: c.born }))
      .sort((a, b) => b.activity - a.activity)
      .slice(0, k);
  }
}

/** Upper quantile of a sample (used to set a neutral threshold). */
export function quantile(xs: number[], q: number): number {
  if (!xs.length) return Infinity;
  const s = [...xs].sort((a, b) => a - b);
  const pos = Math.min(s.length - 1, Math.max(0, q * (s.length - 1)));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
