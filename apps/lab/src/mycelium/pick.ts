// Which particle a click means. Positions are fixed-point (POS_SHIFT = 8 bits). The picture does not wrap at the edges
// of the world, so neither does the pick: the nearest particle is the one that looks nearest on screen, not the one
// that is nearest on the torus.
export function nearestParticle(n: number, X: ArrayLike<number>, Y: ArrayLike<number>, wx: number, wy: number, max: number): number {
  let best = -1, bd = max * max;
  for (let i = 0; i < n; i++) {
    const dx = X[i] / 256 - wx, dy = Y[i] / 256 - wy;
    const d = dx * dx + dy * dy;
    if (d <= bd) { bd = d; best = i; }
  }
  return best;
}
