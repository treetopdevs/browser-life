/** How a run is cut into resumable segments. Pure, so it can be unit-tested. */

export interface Segment {
  readonly from: number;
  readonly to: number;
  readonly tracked: boolean;
}

/** Untracked stretches are cut every `chunk` steps so a stopped job loses little. */
export function buildSegments(steps: number, track: readonly (readonly [number, number])[], census: number, chunk = 20_000): Segment[] {
  const windows = [...track].sort((a, b) => a[0] - b[0]);
  let at = 0;
  for (const [a, b] of windows) {
    if (!(a >= at && b > a && b <= steps) || a % census !== 0 || b % census !== 0) throw new Error(`bad tracked window ${a}-${b}`);
    at = b;
  }
  const out: Segment[] = [];
  const untracked = (from: number, to: number) => {
    for (let a = from; a < to;) {
      const b = Math.min(to, (Math.floor(a / chunk) + 1) * chunk);
      out.push({ from: a, to: b, tracked: false });
      a = b;
    }
  };
  at = 0;
  for (const [a, b] of windows) {
    untracked(at, a);
    out.push({ from: a, to: b, tracked: true });
    at = b;
  }
  untracked(at, steps);
  return out;
}
