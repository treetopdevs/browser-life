import { describe, expect, it } from 'vitest';
import { VesicleWorld, sinCos } from '../src/vesicle/model.ts';
import { assign, census, check, countCrossings, loops } from '../src/vesicle/observe.ts';
import { HEREDITY, METABOLISM, WALL_GENES, feedWorld, garden, theftWorld } from '../src/vesicle/worlds.ts';
import { inflate, pinch, theft } from '../../../experiments/vesicle/scenes.ts';

const run = (w: VesicleWorld, steps: number) => { for (let t = 0; t < steps; t++) w.tick(); return w; };

describe('vesicle world', () => {
  it('builds circles without the host trig functions', () => {
    for (const a of [0, 0.3, 1.5707963267948966, 3, 4.5, 6.2]) {
      const [s, c] = sinCos(a);
      expect(s).toBeCloseTo(Math.sin(a), 12);
      expect(c).toBeCloseTo(Math.cos(a), 12);
    }
  });

  it('keeps matter exact and rings whole in a living garden with heredity', () => {
    const w = garden(3, { params: HEREDITY }), m0 = w.matter();
    for (let k = 0; k < 6; k++) {
      run(w, 500);
      expect(w.matter()).toBe(m0);
      expect(check(w)).toEqual([]);
    }
    expect(w.events.birth).toBeGreaterThan(100);
    expect(w.events.insert).toBeGreaterThan(10);
  });

  it('walls never cross, checked every step where a review found crossings', () => {
    const w = garden(2, { params: HEREDITY });
    let worst = 0;
    for (let t = 0; t < 2500; t++) { w.tick(); const x = countCrossings(w); if (x > worst) worst = x; }
    expect(w.events.pinch).toBeGreaterThan(0);
    expect(worst).toBe(0);
  });

  it('counts each particle once however often the observer is asked', () => {
    const w = run(theftWorld(1), 50), ls = loops(w);
    const first = ls.map((l) => l.solute);
    assign(w, ls);
    expect(ls.map((l) => l.solute)).toEqual(first);
    expect(first.reduce((a, b) => a + b, 0)).toBe(300);
  });

  it('repeats exactly from a seed and differs between seeds', () => {
    const a = run(garden(5, { params: HEREDITY }), 800).digest(), b = run(garden(5, { params: HEREDITY }), 800).digest();
    expect(a).toBe(b);
    expect(run(garden(6, { params: HEREDITY }), 800).digest()).not.toBe(a);
  });

  it('matches the pinned state after 2,000 steps (any change to the rules or their order moves this)', () => {
    const w = run(garden(1, { params: HEREDITY }), 2000);
    expect([w.digest(), w.matter(), w.n, w.beadCount]).toEqual(['d0d875d2', 5694, 800, 371]);
  });

  it('leaves every gene at the founder value when mutation is off', () => {
    const w = run(garden(2), 1500);
    expect(w.events.birth).toBeGreaterThan(50);
    for (let k = 0; k < w.n; k++) { expect(w.gene[k]).toBe(128); expect(w.mark[k]).toBe(128); }
  });

  it('a wound returns a ring to free lipid without changing matter', () => {
    const w = run(theftWorld(1), 200), m0 = w.matter(), before = loops(w, false);
    const beads = w.dissolveLoop(before[0].first);
    expect(beads).toBe(before[0].beads);
    expect(loops(w, false).length).toBe(before.length - 1);
    expect(w.matter()).toBe(m0);
    expect(check(w)).toEqual([]);
  });

  it('inflate: more solute inside means more area', () => {
    const r = inflate(1);
    expect(r.pass).toBe(true);
    expect(r.rows[3].area).toBeGreaterThan(4 * r.rows[0].area);
  });

  it('theft: with lipid fixed, the crowded vesicle gains wall and the slack one loses it', () => {
    const r = theft(1);
    expect(r.end.rich).toBeGreaterThan(r.start.rich);
    expect(r.end.poor).toBeLessThan(r.start.poor);
    expect(r.end.rich + r.end.poor + r.end.free).toBe(r.lipid);
  });

  it('pinch: a vesicle fed lipid closes a neck into daughters that keep the solute', () => {
    const r = pinch(1);
    expect(r.pinches).toBeGreaterThan(0);
    expect(r.holding.filter((n) => n >= 12).length).toBeGreaterThanOrEqual(2);
    expect(r.soluteTotal).toBe(120);
  });

  it('the page demo worlds are sound at the start', () => {
    for (const w of [feedWorld(1), theftWorld(1), garden(1)]) {
      expect(check(w)).toEqual([]);
      expect(census(w).loops.every((l) => l.solute > 0)).toBe(true);
    }
  });

  // ---- the three findings of the second review: each of these fails on the kernel before the fixes ----------

  /** Reshape a ring into a counter-clockwise rectangle with `nx` bonds along each long side and `ny` up each short side. */
  const rect = (w: VesicleWorld, x0: number, y0: number, x1: number, y1: number, nx: number, ny: number): number[] => {
    const first = w.addLoop(50, 50, 5, 2 * (nx + ny)), ids: number[] = [];
    let i = first;
    const put = (x: number, y: number) => { w.bx[i] = x; w.by[i] = y; ids.push(i); i = w.next[i]; };
    for (let k = 0; k < nx; k++) put(x0 + ((x1 - x0) * k) / nx, y0);
    for (let k = 0; k < ny; k++) put(x1, y0 + ((y1 - y0) * k) / ny);
    for (let k = 0; k < nx; k++) put(x1 - ((x1 - x0) * k) / nx, y1);
    for (let k = 0; k < ny; k++) put(x0, y1 - ((y1 - y0) * k) / ny);
    return ids;
  };
  const still = { kIn: 0, kOut: 0, sBurst: 0 };

  it('a particle in a thin slit between two walls is not pushed through the far wall', () => {
    // one step, no noise: 0.05 from the upper wall and 0.25 from the lower, the push (capped at 0.5) points through the lower wall
    const w = new VesicleWorld(1, { ...still, partNoise: 0 });
    rect(w, 10, 10, 30, 20, 10, 5); rect(w, 10, 20.3, 30, 30, 10, 5);
    w.addParticle(20, 20.25);
    w.tick();
    expect(loops(w).map((l) => l.solute)).toEqual([0, 0]);
    expect(w.py[0]).toBe(20.25);
    // with noise, over many steps, from many places along the slit
    const v = new VesicleWorld(2, still);
    rect(v, 10, 10, 30, 20, 10, 5); rect(v, 10, 20.3, 30, 30, 10, 5);
    for (let k = 0; k < 16; k++) v.addParticle(11.5 + k, 20.05 + 0.2 * v.rand());
    for (let t = 0; t < 400; t++) { v.tick(); expect(loops(v).reduce((n, l) => n + l.solute, 0)).toBe(0); }
  });

  it('a particle exactly on a wall is pushed to the wall\'s interior side', () => {
    const w = new VesicleWorld(1, { ...still, partNoise: 0 });
    rect(w, 10, 10, 30, 20, 10, 5);
    w.addParticle(21, 10);
    w.tick();
    expect(w.px[0]).toBe(21);
    expect(w.py[0]).toBe(10.5);
  });

  it('the crossing check sees a wall anywhere along a long new bond', () => {
    const w = new VesicleWorld(1, still);
    const big = rect(w, 4, 40.5, 60, 80, 14, 10);
    w.addLoop(20, 40, 3);
    const k = w as unknown as { buildHash(): void; wouldCross(u: number, v: number): boolean };
    k.buildHash();
    // from the big ring's lower left corner to its lower right: 56 long, and the small ring sits a quarter of the way along
    expect(k.wouldCross(big[0], big[14])).toBe(true);
    expect(k.wouldCross(big[14], big[24])).toBe(false);
  });

  it('a particle on a wall is not pushed out through it by a stronger push from the wall behind', () => {
    // a sliver 0.3 high: the particle sits on the lower wall, and the upper wall pushes down harder than the lower pushes up
    const w = new VesicleWorld(1, { ...still, beadCap: 0, partNoise: 0 });
    rect(w, 10, 10, 30, 10.3, 4, 2);
    w.addParticle(22.5, 10);
    run(w, 3);
    expect(w.py[0]).toBeGreaterThanOrEqual(10);
  });

  it('after a bead leaves, the crossing check and direct insertion see the shortcut bond wherever it lies', () => {
    // eight beads with two long sides: when the corner (30, 10) leaves, the shortcut (10,10) -> (30,30) runs
    // through hash cells that list neither of the bonds it replaced
    type K = { buildHash(): void; hashStale: boolean; segHit(x0: number, y0: number, x1: number, y1: number, u: number, v: number): boolean; nearBond(x: number, y: number, c: number): number; freeBead(i: number): void };
    const at = [[10, 10], [30, 10], [30, 30], [25, 30], [20, 30], [15, 30], [10, 30], [10, 20]];
    const make = () => {
      const w = new VesicleWorld(1, still), first = w.addLoop(50, 50, 5, 8), ids: number[] = [];
      for (let i = first, n = 0; n < 8; n++, i = w.next[i]) { w.bx[i] = at[n][0]; w.by[i] = at[n][1]; ids.push(i); }
      const k = w as unknown as K;
      k.buildHash();
      expect(k.nearBond(20, 20, w.cellOf(20, 20))).toBe(-1);
      w.next[ids[0]] = ids[2]; w.prev[ids[2]] = ids[0]; k.freeBead(ids[1]); k.hashStale = true;
      return { w, k, ids };
    };
    // each lookup is the first after the bead left, in a world of its own
    const one = make();
    expect(one.k.segHit(19, 21, 21, 19, -1, -1)).toBe(true);
    const { w, k, ids } = make();
    expect(k.nearBond(20, 20, w.cellOf(20, 20))).toBe(ids[0]);
    // a slot freed this step is not handed out again within the step
    const hi = w.beadHi;
    expect(w.addLoop(100, 100, 5)).toBeGreaterThanOrEqual(hi);
  });

  it('the kernel marks the hash stale when a bead leaves', () => {
    const w = new VesicleWorld(3, { sBurst: 0, kIn: 0, kOut: 1 });
    w.addLoop(50, 50, 12);
    const k = w as unknown as { hashStale: boolean };
    w.tick(); w.tick();
    expect(w.events.desorb).toBeGreaterThan(0);
    expect(k.hashStale).toBe(true);
    expect(check(w)).toEqual([]);
  });

  it('direct insertion finds the nearest bond however often one bond was split in the step', () => {
    const w = new VesicleWorld(1, { ...still, rIns: 3 });
    const first = w.addLoop(50, 50, 10);
    const k = w as unknown as { buildHash(): void; insertNear(x: number, y: number, c: number): boolean };
    w.tick();
    k.buildHash();
    const j = w.next[first], x = w.bx[first] + 0.9 * (w.bx[j] - w.bx[first]) - 0.3, y = w.by[first] + 0.9 * (w.by[j] - w.by[first]);
    const nearest = () => {
      let best = -1, bd = Infinity;
      for (let a = 0; a < w.beadHi; a++) {
        if (!w.alive[a]) continue;
        const b = w.next[a], ex = w.bx[b] - w.bx[a], ey = w.by[b] - w.by[a], rx = x - w.bx[a], ry = y - w.by[a];
        const t = Math.min(1, Math.max(0, (rx * ex + ry * ey) / (ex * ex + ey * ey))), d2 = (rx - t * ex) ** 2 + (ry - t * ey) ** 2;
        if (d2 < bd) { bd = d2; best = a; }
      }
      return best;
    };
    for (let n = 0; n < 24; n++) {
      const a = nearest(), b = w.next[a];
      expect(k.insertNear(x, y, w.cellOf(x, y))).toBe(true);
      expect([n, w.next[w.next[a]]]).toEqual([n, b]);
    }
    expect(check(w)).toEqual([]);
  });

  it('after a pinch, every bead is pushed by the rings as they now are', () => {
    // (a wounded garden made a crossing here: a bead 0.12 from a bond the pinch had just made got no push from it)
    const w = garden(2, { params: HEREDITY });
    const k = w as unknown as { wallContact(): void; fx: Float64Array; fy: Float64Array };
    const inner = k.wallContact.bind(w);
    let seen = 0;
    k.wallContact = () => {
      const before = w.events.pinch;
      inner();
      if (w.events.pinch === before) return;
      const fx = Float64Array.from(k.fx.subarray(0, w.beadHi)), fy = Float64Array.from(k.fy.subarray(0, w.beadHi)), after = w.events.pinch;
      inner();
      if (w.events.pinch !== after) return;
      seen++;
      expect(Array.from(k.fx.subarray(0, w.beadHi))).toEqual(Array.from(fx));
      expect(Array.from(k.fy.subarray(0, w.beadHi))).toEqual(Array.from(fy));
    };
    run(w, 2500);
    expect(seen).toBeGreaterThan(3);
  });

  it('two walls pressed together by the crowds behind them do not pass through each other', () => {
    // particles a thousandth from each wall push the two walls (0.2 apart) together far harder than the walls push back
    const w = new VesicleWorld(1, { ...still, partNoise: 0, beadNoise: 0 });
    rect(w, 10, 10, 30, 20, 4, 2); rect(w, 10.5, 20.2, 30.5, 30, 4, 2);
    for (const x of [15, 20, 25]) { w.addParticle(x, 19.999); w.addParticle(x + 0.5, 20.201); }
    for (let t = 0; t < 300; t++) { w.tick(); expect([t, countCrossings(w)]).toEqual([t, 0]); }
  });

  it('refuses a ring seeded outside the dish inset', () => {
    expect(() => new VesicleWorld(1).addLoop(5, 50, 6)).toThrow(/inset/);
    expect(() => new VesicleWorld(1).addLoop(8.5, 50, 6)).not.toThrow();
  });

  it('a sealed cell keeps every particle', () => {
    for (const [extra, n] of [[{}, 200], [{ pOut: 0.03 }, 200]] as const) {
      const w = new VesicleWorld(4, { W: 96, H: 96, ...still, ...extra });
      w.addLoop(48, 48, 10); w.addSolute(48, 48, 8, n, 128, 1);
      run(w, 6000);
      expect(loops(w)[0].solute).toBe(n);
    }
  });

  // ---- rung 3: heredity in the wall ---------------------------------------------------------------------

  it('wall genes: matter stays exact, rings stay whole, and a seed repeats', () => {
    const w = garden(3, { params: WALL_GENES }), m0 = w.matter();
    run(w, 3000);
    expect(w.matter()).toBe(m0);
    expect(check(w)).toEqual([]);
    expect(w.events.birth).toBeGreaterThan(100);
    expect(run(garden(3, { params: WALL_GENES }), 3000).digest()).toBe(w.digest());
    // the wall bytes are part of the state: two worlds that differ only there do not share a digest
    const a = garden(3, { params: WALL_GENES }), b = garden(3, { params: WALL_GENES });
    b.wgene[0] = 7;
    expect(a.digest()).not.toBe(b.digest());
  });

  it('wall genes: with shifts off every wall keeps its founder byte and solute carries the byte of its own wall', () => {
    const w = garden(2, { params: { ...WALL_GENES, mut: 0 }, founderGene: [64, 192] });
    run(w, 6000);
    expect(w.events.pinch).toBeGreaterThan(0);
    expect(w.events.insert).toBeGreaterThan(1000);
    const ls = loops(w), where = assign(w, ls);
    for (const l of ls) { expect([64, 192]).toContain(l.wallGene); expect(l.wallGeneSd).toBe(0); }
    let inside = 0;
    for (let k = 0; k < w.n; k++) if (where[k] >= 0) { inside++; expect(w.gene[k]).toBe(ls[where[k]].wallGene); }
    expect(inside).toBeGreaterThan(200);
  });

  it('wall genes: solute is only made against the inner face of a wall', () => {
    // loose solute and food, no wall anywhere: nothing copies. The same crowd without wall genes does.
    const loose = (params: object) => {
      const w = new VesicleWorld(1, { W: 64, H: 64, ...METABOLISM, kDecay: 0, ...params });
      w.addSolute(32, 32, 6, 200); w.scatter(w.food, 4000);
      return run(w, 400);
    };
    expect(loose({ wallGenes: true }).events.birth).toBe(0);
    expect(loose({}).events.birth).toBeGreaterThan(50);
    // solute outside a ring, against its outer face, does not copy either
    const w = new VesicleWorld(1, { W: 64, H: 64, ...METABOLISM, kDecay: 0, kIn: 0, kOut: 0, sBurst: 0, wallGenes: true });
    w.addLoop(32, 32, 8);
    for (let k = 0; k < 150; k++) { const [s, c] = sinCos(k * 0.0419); w.addParticle(32 + 10.5 * c, 32 + 10.5 * s); }
    w.scatter(w.food, 4000);
    run(w, 300);
    expect(w.events.birth).toBe(0);
  });

  it('wall genes: a copy takes the wall\'s bytes, not its parent\'s', () => {
    const w = new VesicleWorld(1, { W: 64, H: 64, ...METABOLISM, kDecay: 0, kIn: 0, kOut: 0, sBurst: 0, kLip: 0, wallGenes: true });
    w.addLoop(32, 32, 8, undefined, 200, 77);
    for (let k = 0; k < 60; k++) { const [s, c] = sinCos(k * 0.1047); w.addParticle(32 + 6 * c, 32 + 6 * s, 10, 1, 20); }
    w.scatter(w.food, 4000);
    run(w, 400);
    expect(w.events.birth).toBeGreaterThan(20);
    for (let k = 0; k < 60; k++) expect([w.gene[k], w.mark[k]]).toEqual([10, 20]);
    for (let k = 60; k < w.n; k++) expect([w.gene[k], w.mark[k]]).toEqual([200, 77]);
  });

  it('wall genes: a new bead takes the bytes of either end of its bond, shifted only when shifts are on', () => {
    const grow = (mut: number) => {
      const w = new VesicleWorld(5, { W: 64, H: 64, kOut: 0, sBurst: 0, wallGenes: true, mut, mutStep: 4 });
      const first = w.addLoop(32, 32, 8);
      for (let i = first, k = 0; k < 25; k++, i = w.next[i]) { w.wgene[i] = k % 2 ? 40 : 200; w.wmark[i] = k % 2 ? 3 : 9; }
      w.addSolute(32, 32, 6, 300); w.scatter(w.lipid, 600);
      const old = w.beadHi;
      run(w, 600);
      expect(w.beadHi - old).toBeGreaterThan(20);
      return { w, old };
    };
    const { w, old } = grow(0), seen = new Set<string>();
    for (let i = old; i < w.beadHi; i++) seen.add(`${w.wgene[i]}/${w.wmark[i]}`);
    expect([...seen].sort()).toEqual(['200/9', '40/3']);
    // one bond, ends 40 and 200, asked many times: both ends are used, about evenly
    const one = new VesicleWorld(9, { wallGenes: true }), f = one.addLoop(50, 50, 8), j = one.next[f], spare = one.next[j];
    one.wgene[f] = 40; one.wgene[j] = 200;
    const pick = one as unknown as { inherit(m: number, i: number, j: number): void };
    let low = 0;
    for (let t = 0; t < 400; t++) { pick.inherit(spare, f, j); expect([40, 200]).toContain(one.wgene[spare]); if (one.wgene[spare] === 40) low++; }
    expect(low).toBeGreaterThan(150);
    expect(low).toBeLessThan(250);
    const m = grow(1);
    let shifted = 0;
    for (let i = m.old; i < m.w.beadHi; i++) if (m.w.wgene[i] !== 40 && m.w.wgene[i] !== 200) shifted++;
    expect(shifted).toBeGreaterThan(10);
  });

  it('wall genes: inside and outside are told apart at corners that bulge and corners that fold', () => {
    // an L-shaped ring (counter-clockwise): the corner at (20, 20) folds inward, the others bulge
    const w = new VesicleWorld(1, { ...still, wallGenes: true });
    const first = w.addLoop(50, 50, 5, 12), at = [[10, 10], [20, 10], [30, 10], [30, 15], [30, 20], [25, 20], [20, 20], [20, 25], [20, 30], [15, 30], [10, 30], [10, 20]];
    for (let i = first, k = 0; k < 12; k++, i = w.next[i]) { w.bx[i] = at[k][0]; w.by[i] = at[k][1]; }
    const k = w as unknown as { buildHash(): void; innerBead(x: number, y: number, c: number): number };
    k.buildHash();
    const inside = (x: number, y: number) => k.innerBead(x, y, w.cellOf(x, y)) >= 0;
    expect([inside(11, 11), inside(29, 11), inside(11, 29), inside(19, 19), inside(15, 11), inside(21, 19.5)]).toEqual([true, true, true, true, true, true]);
    expect([inside(9, 9), inside(9.5, 9.9), inside(31, 9.5), inside(30.5, 20.9), inside(21, 21), inside(20.5, 22), inside(15, 9), inside(25, 21)]).toEqual([false, false, false, false, false, false, false, false]);
    expect(inside(15, 20)).toBe(false);
  });

  it('wall genes: a chimera start gives each founder two halves and its own marker', () => {
    const w = garden(1, { params: { ...WALL_GENES, mut: 0 }, chimera: [64, 192] }), ls = loops(w);
    expect(ls.length).toBe(6);
    const marks = new Set<number>();
    for (const l of ls) {
      let lo = 0, hi = 0;
      for (let i = l.first, k = 0; k < l.beads; k++, i = w.next[i]) { if (w.wgene[i] === 64) lo++; else if (w.wgene[i] === 192) hi++; expect(w.wmark[i]).toBe(w.wmark[l.first]); }
      expect([lo + hi, Math.abs(lo - hi)]).toEqual([l.beads, l.beads % 2]);
      marks.add(w.wmark[l.first]);
    }
    expect(marks.size).toBe(6);
    run(w, 1500);
    // shifts are off: every bead still names a founder and carries one of the two shares
    for (let i = 0; i < w.beadHi; i++) if (w.alive[i]) { expect(marks.has(w.wmark[i])).toBe(true); expect([64, 192]).toContain(w.wgene[i]); }
  });

  it('wall genes: matches the pinned state after 2,000 steps', () => {
    const w = run(garden(1, { params: WALL_GENES }), 2000);
    expect([w.digest(), w.matter(), w.n, w.beadCount]).toEqual(['48c2db7d', 5694, 443, 365]);
  });
});
