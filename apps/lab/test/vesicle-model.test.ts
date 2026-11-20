import { describe, expect, it } from 'vitest';
import { VesicleWorld, scaleJobs, sinCos } from '../src/vesicle/model.ts';
import { LineageObserver, assign, cellHeader, cellLine, census, check, countCrossings, eventHeader, eventLine, jobHueLight, loops } from '../src/vesicle/observe.ts';
import { HEREDITY, JOBS, JOBS_FOUNDER, JOBS_INERT, METABOLISM, THREAD, WALL_GATE, WALL_GENES, Weather, feedWorld, garden, theftWorld, wild } from '../src/vesicle/worlds.ts';
import { inflate, pinch, theft } from '../../../experiments/vesicle/scenes.ts';

// digest, matter, solute, beads, units harvested and units digested after 2,000 steps of the JOBS garden (founders 200/55, seed 1)
const PIN_JOBS: [string, number, number, number, number, number] = ['8941c6a4', 5694, 484, 252, 209, 2870];
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

  it('gate-only control: copies need the inner face of a wall but take their parent\'s bytes', () => {
    const loose = new VesicleWorld(1, { W: 64, H: 64, ...METABOLISM, kDecay: 0, wallGate: true });
    loose.addSolute(32, 32, 6, 200); loose.scatter(loose.food, 4000);
    expect(run(loose, 400).events.birth).toBe(0);
    const w = new VesicleWorld(1, { W: 64, H: 64, ...METABOLISM, kDecay: 0, kIn: 0, kOut: 0, sBurst: 0, kLip: 0, wallGate: true });
    w.addLoop(32, 32, 8, undefined, 200, 77);
    for (let k = 0; k < 60; k++) { const [s, c] = sinCos(k * 0.1047); w.addParticle(32 + 6 * c, 32 + 6 * s, 10, 1, 20); }
    w.scatter(w.food, 4000);
    run(w, 400);
    expect(w.events.birth).toBeGreaterThan(20);
    for (let k = 0; k < w.n; k++) expect([w.gene[k], w.mark[k]]).toEqual([10, 20]);
    // with shifts on, the bytes ride on solute and move
    const g = run(garden(2, { params: WALL_GATE }), 3000);
    let moved = 0;
    for (let k = 0; k < g.n; k++) if (g.gene[k] !== 128) moved++;
    expect(moved).toBeGreaterThan(5);
    expect(check(g)).toEqual([]);
  });

  it('wall genes: matches the pinned state after 2,000 steps', () => {
    const w = run(garden(1, { params: WALL_GENES }), 2000);
    expect([w.digest(), w.matter(), w.n, w.beadCount]).toEqual(['48c2db7d', 5694, 443, 365]);
  });

  // ---- stage 1: the thread ------------------------------------------------------------------------------

  describe('thread', () => {
    /** A bare dish for one rule at a time: no wall growth, no solute decay, threads fast to feed. */
    const bare = (extra: object = {}) => new VesicleWorld(1, { W: 64, H: 64, ...METABOLISM, ...still, thread: true, kLip: 0, kDecay: 0, kTDecay: 0, kTFood: 1, kLight: 0, kLipDecay: 0, ...extra });

    it('keeps matter exact and rings whole, and a seed repeats', () => {
      for (const params of [THREAD]) {
        const w = garden(3, { params }), m0 = w.matter();
        for (let k = 0; k < 6; k++) { run(w, 500); expect(w.matter()).toBe(m0); expect(check(w)).toEqual([]); }
        expect(w.events.tcopy).toBeGreaterThan(0);
        expect(w.events.birth).toBeGreaterThan(100);
        expect(run(garden(3, { params }), 3000).digest()).toBe(w.digest());
      }
      // a thread's bytes, its store and its place are part of the state
      const a = garden(3, { params: THREAD }), b = garden(3, { params: THREAD });
      b.tgene[1] = 7;
      expect(a.digest()).not.toBe(b.digest());
    });

    it('free thread: matches the pinned state after 3,000 steps', () => {
      const w = run(garden(1, { params: THREAD }), 3000);
      expect([w.digest(), w.matter(), w.n, w.beadCount, w.nt]).toEqual(['9f878938', 5700, 645, 447, 12]);
    });

    it('with the option off, the pinned states and the world are untouched', () => {
      const w = run(garden(1, { params: { ...HEREDITY, thread: false } }), 2000);
      expect([w.digest(), w.nt]).toEqual(['d0d875d2', 0]);
      const g = run(garden(1, { params: { ...WALL_GENES, thread: false } }), 2000);
      expect(g.digest()).toBe('48c2db7d');
      expect(() => new VesicleWorld(1).addThread(10, 10, [1, 2])).toThrow(/off/);
    });

    it('a thread stays on its side of a wall: inside a sealed cell, and outside it', () => {
      // rInhib 4 lets each side fill up with copies; nothing decays, so a thread that crossed would show as one
      // side's count falling (copies are made where their parent is, so they cannot change a side's count downward)
      const w = bare({ pOut: 0.03, rInhib: 4 });
      w.addLoop(32, 32, 10); w.addSolute(32, 32, 8, 150, 128, 1);
      w.addThread(32, 32, [128, 128]); w.addThread(31, 32, [128, 128]);
      w.addThread(32 + 12.5, 32, [128, 128]); w.addThread(32 - 12.5, 32 + 4, [128, 128]); // outside, against the outer face
      w.scatter(w.food, 3000);
      let inside = 2, outside = 2;
      for (let t = 0; t < 8000; t++) {
        w.tick();
        if (t % 20 === 19) {
          const l = loops(w), i = l[0].threads, o = w.nt - i;
          expect(l.length).toBe(1);
          expect(i).toBeGreaterThanOrEqual(inside); expect(o).toBeGreaterThanOrEqual(outside);
          inside = i; outside = o;
        }
      }
      expect(inside).toBeGreaterThan(4); expect(outside).toBeGreaterThan(4);
      expect(census(w).freeThreads).toBe(outside);
      expect(check(w)).toEqual([]);
    });

    it('the side of a thread does not change without a pinch (per thread, every step)', () => {
      const w = bare({ pOut: 0.03 });
      w.addLoop(32, 32, 10); w.addSolute(32, 32, 8, 150, 128, 1);
      w.addThread(30, 32, [128, 128]); w.addThread(32 + 13, 32, [128, 128]);
      w.scatter(w.food, 3000);
      const side = () => { const l = loops(w)[0]; return Array.from({ length: w.nt }, (_, k) => { let c = false; const { xs, ys } = l; for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) if ((ys[i] > w.ty[k]) !== (ys[j] > w.ty[k]) && w.tx[k] < ((xs[j] - xs[i]) * (w.ty[k] - ys[i])) / (ys[j] - ys[i]) + xs[i]) c = !c; return c; }); };
      let prev = side();
      for (let t = 0; t < 1500; t++) {
        w.tick();
        const now = side();
        // a copy appears where its parent is; the old threads keep their side
        for (let k = 0; k < prev.length; k++) if (k < w.nt) expect(now[k]).toBe(prev[k]);
        prev = now;
      }
      expect(w.events.tcopy).toBeGreaterThan(0);
    });

    it('solute does not copy in a ring with no thread, nor with a thread on the other side of the wall', () => {
      const make = (threads: [number, number][]) => {
        const w = bare();
        w.addLoop(32, 32, 10); w.addSolute(32, 32, 8, 120, 128, 1);
        for (const [x, y] of threads) w.addThread(x, y, [90, 77]);
        w.scatter(w.food, 4000);
        return run(w, 400);
      };
      expect(make([]).events.birth).toBe(0);
      expect(make([[32 + 12.5, 32]]).events.birth).toBe(0); // 2.5 outside the wall: well inside rShare of solute, but behind the wall
      const w = make([[32, 32]]);
      expect(w.events.birth).toBeGreaterThan(50);
      // and a copy takes its bytes from the thread, not from its parent
      for (let k = 0; k < w.n; k++) if (w.events.birth && k >= 120) { expect(w.gene[k]).toBe(90); expect(w.mark[k]).toBe(77); }
    });

    it('a thread copies only with enough food stored and no other thread near on its side of the walls', () => {
      // no food: it never copies
      const hungry = bare(); hungry.addThread(32, 32, [128, 128]);
      run(hungry, 600);
      expect(hungry.events.tcopy).toBe(0); expect(hungry.nt).toBe(1);
      // food, but a neighbour within rInhib on its side: one copy is made (it was alone), then both are held
      const w = bare({ rInhib: 1000 }); w.addThread(32, 32, [128, 128]); w.scatter(w.food, 4000);
      let first = -1;
      for (let t = 0; t < 4000; t++) { w.tick(); if (first < 0 && w.events.tcopy === 1) { first = t; expect(w.nt).toBe(2); } }
      expect(w.events.tcopy).toBe(1); expect(w.nt).toBe(2);
      expect(first).toBeGreaterThan(5); // it had to take up tCost units first
      // the same without the inhibition keeps copying
      const free = bare({ rInhib: 0.001 }); free.addThread(32, 32, [128, 128]); free.scatter(free.food, 4000);
      run(free, 4000);
      expect(free.events.tcopy).toBeGreaterThan(3);
      // a wall between two threads removes the inhibition: one copy on each side
      const sealed = bare({ rInhib: 1000 }); sealed.addLoop(32, 32, 10); sealed.addSolute(32, 32, 8, 100, 128, 1);
      sealed.addThread(32, 32, [128, 128]); sealed.addThread(32 + 14, 32, [128, 128]); sealed.scatter(sealed.food, 4000);
      run(sealed, 3000);
      expect(sealed.events.tcopy).toBe(2); expect(sealed.nt).toBe(4);
    });

    it('a copy costs tCost of food and matter stays exact; bytes shift only when shifts are on', () => {
      const off = bare({ mut: 0 }); off.addThread(32, 32, [40, 200]); off.scatter(off.food, 4000);
      const m0 = off.matter();
      run(off, 3000);
      expect(off.matter()).toBe(m0);
      for (let k = 0; k < off.nt; k++) { expect(off.tgene[2 * k]).toBe(40); expect(off.tgene[2 * k + 1]).toBe(200); }
      const on = bare({ mut: 1, mutStep: 4, rInhib: 0.001 }); on.addThread(32, 32, [128, 128]); on.scatter(on.food, 4000);
      run(on, 3000);
      let moved = 0;
      for (let k = 0; k < on.nt; k++) if (on.tgene[2 * k] !== 128) moved++;
      expect(on.nt).toBeGreaterThan(5); expect(moved).toBeGreaterThan(3);
    });

    it('a thread with too little solute around it decays to waste; one with enough does not', () => {
      const w = bare({ kTDecay: 0.2 });
      w.addLoop(32, 32, 10); w.addSolute(32, 32, 8, 100, 128, 1);
      w.addThread(32, 32, [128, 128]); w.addThread(10, 10, [128, 128]); // the second is alone in the open
      const m0 = w.matter();
      run(w, 300);
      expect(w.matter()).toBe(m0);
      expect(w.events.tdecay).toBeGreaterThanOrEqual(1);
      expect(census(w).freeThreads).toBe(0);
      expect(loops(w)[0].threads).toBeGreaterThanOrEqual(1);
    });

    it('threads need a whole-number cost of at least 1, so matter cannot be lost in a split (review P1)', () => {
      for (const tCost of [6.5, 0, -1, NaN]) expect(() => new VesicleWorld(1, { thread: true, tCost })).toThrow();
      const w = new VesicleWorld(1, { thread: true, tCost: 6, kTFood: 8, kTDecay: 0, kIn: 0, kOut: 0, sBurst: 0, partNoise: 0, dFood: 0, dWaste: 0, dLipid: 0 });
      w.addThread(32, 32, [128, 128]);
      w.food[w.cellOf(32, 32)] = 20;
      const m = w.matter();
      for (let i = 0; i < 9; i++) w.tick();
      expect(w.matter()).toBe(m);
      expect(w.events.tcopy).toBeGreaterThan(0);
    });

    it('the pinch log counts threads: daughters hold no more than the mother, and the digest does not change', () => {
      for (const params of [THREAD]) {
        const w = garden(2, { params }), ev: import('../src/vesicle/observe.ts').LineageEvent[] = [];
        const o = new LineageObserver(w, (e) => ev.push(e));
        for (let t = 0; t < 4000; t++) { w.tick(); o.afterTick(); }
        const pinches = ev.flatMap((e) => (e.ev === 'pinch' ? [e] : []));
        expect(pinches.length).toBeGreaterThan(5);
        let mother = 0, kept = 0;
        for (const e of pinches) {
          expect(e.a.threads + e.b.threads).toBeLessThanOrEqual(e.m.threads);
          mother += e.m.threads; kept += e.a.threads + e.b.threads;
          if (e.a.threads) { expect(Math.abs(e.a.t0 - 128)).toBeLessThanOrEqual(64); expect(Math.abs(e.a.t1 - 128)).toBeLessThanOrEqual(64); } // copies may have shifted (mut 0.1)
        }
        expect(mother).toBeGreaterThan(5);
        expect(kept).toBeGreaterThanOrEqual(0.9 * mother); // neck losses only
        expect(run(garden(2, { params }), 4000).digest()).toBe(w.digest());
        const c = census(w);
        expect(c.threads).toBe(w.nt);
        expect(c.loops.reduce((a, l) => a + l.threads, 0) + c.freeThreads).toBe(w.nt);
      }
    });
  });

  describe('lineage observer', () => {
    const watched = (w: VesicleWorld, steps: number, each?: (o: LineageObserver) => void) => {
      const ev: import('../src/vesicle/observe.ts').LineageEvent[] = [], o = new LineageObserver(w, (e) => ev.push(e));
      for (let t = 0; t < steps; t++) { w.tick(); o.afterTick(); each?.(o); }
      return { o, ev };
    };

    it('leaves the state digest unchanged: default garden and wall-genes garden, observer on vs off', () => {
      const a = watched(garden(1, { params: HEREDITY }), 2000).o.w, b = run(garden(1, { params: HEREDITY }), 2000);
      expect(a.digest()).toBe(b.digest());
      expect(a.digest()).toBe('d0d875d2');
      const c = watched(garden(1, { params: WALL_GENES }), 2000).o.w, d = run(garden(1, { params: WALL_GENES }), 2000);
      expect(c.digest()).toBe(d.digest());
      expect(c.digest()).toBe('48c2db7d');
    });

    it('records pinches, and every bead of a ring carries one id at every step', () => {
      const w = garden(2, { params: HEREDITY });
      const { ev } = watched(w, 2500, (o) => {
        const seen = new Uint8Array(w.beadHi), ids = new Set<number>();
        for (let s = 0; s < w.beadHi; s++) {
          if (!w.alive[s] || seen[s]) continue;
          const id = o.cid[s]; expect(id).toBeGreaterThan(0);
          expect(ids.has(id)).toBe(false); ids.add(id);
          for (let i = s; !seen[i]; i = w.next[i]) { seen[i] = 1; if (o.cid[i] !== id) throw new Error(`step ${w.step}: ring of bead ${s} carries ids ${id} and ${o.cid[i]}`); }
        }
        for (let i = 0; i < w.beadHi; i++) if (!w.alive[i]) expect(o.cid[i]).toBe(0);
      });
      const pinches = ev.filter((e) => e.ev === 'pinch');
      expect(pinches.length).toBe(w.events.pinch);
      expect(pinches.length).toBeGreaterThan(0);
      for (const e of pinches) if (e.ev === 'pinch') {
        expect(e.d1).not.toBe(e.d2); expect(e.d1).not.toBe(e.id); expect(e.d2).not.toBe(e.id);
        expect(e.a.beads + e.b.beads).toBe(e.m.beads);
      }
    });

    it('logs a wound as the end of an id', () => {
      const w = garden(2, { params: HEREDITY }), ev: import('../src/vesicle/observe.ts').LineageEvent[] = [];
      const o = new LineageObserver(w, (e) => ev.push(e));
      for (let t = 0; t < 300; t++) { w.tick(); o.afterTick(); }
      const first = loops(w, false)[0].first, id = o.cid[first];
      w.dissolveLoop(first); o.afterTick();
      const end = ev.find((e) => e.ev === 'end');
      expect(end && end.ev === 'end' && end.kind === 'wound' && end.id === id).toBe(true);
    });

    it('under the runner sequence with wounds: ids stay one per ring, nonzero, and each id ends once', () => {
      for (const params of [HEREDITY, WALL_GENES]) {
        const w = garden(2, { params }), ev: import('../src/vesicle/observe.ts').LineageEvent[] = [];
        const o = new LineageObserver(w, (e) => {
          ev.push(e);
          if (e.ev === 'pinch') { // the daughters' ids sit on rings of the recorded sizes
            const n = (id: number) => { let k = 0; for (let i = 0; i < w.beadHi; i++) if (w.alive[i] && o.cid[i] === id) k++; return k; };
            expect(n(e.d1)).toBe(e.a.beads); expect(n(e.d2)).toBe(e.b.beads);
          }
        });
        let wseed = 12345;
        for (let t = 1; t <= 3500; t++) {
          w.tick(); o.afterTick();
          if (t % 250 === 0) { const ls = loops(w, false); wseed = (Math.imul(wseed, 1664525) + 1013904223) >>> 0; if (ls.length) w.dissolveLoop(ls[wseed % ls.length].first); }
          const seen = new Uint8Array(w.beadHi), ids = new Set<number>();
          for (let s = 0; s < w.beadHi; s++) {
            if (!w.alive[s] || seen[s]) continue;
            const id = o.cid[s]; expect(id).toBeGreaterThan(0); expect(ids.has(id)).toBe(false); ids.add(id);
            for (let i = s; !seen[i]; i = w.next[i]) { seen[i] = 1; if (o.cid[i] !== id) throw new Error(`step ${w.step}: ring carries ${id} and ${o.cid[i]}`); }
          }
        }
        const ended = new Set<number>();
        for (const e of ev) { expect(e.id).toBeGreaterThan(0); expect(ended.has(e.id)).toBe(false); ended.add(e.id); }
        expect(ev.some((e) => e.ev === 'end' && e.kind === 'wound')).toBe(true);
      }
    });
  });

  // ---- stage 2: jobs for genes -------------------------------------------------------------------------------

  describe('jobs', () => {
    const jobsGarden = (seed: number, params: Partial<import('../src/vesicle/model.ts').Params> = JOBS, founderJobs: [number, number] | [number, number][] = JOBS_FOUNDER) => garden(seed, { founderJobs, params });
    /** A bare dish: no solute chemistry, no wall growth, no diffusion, so only the enzymes move food, waste and lipid. */
    const bare = (extra: object = {}) => new VesicleWorld(1, { W: 64, H: 64, ...JOBS, kIn: 0, kOut: 0, sBurst: 0, kRep: 0, kDecay: 0, kLip: 0, dLipid: 0, dFood: 0, dWaste: 0, kHarvest: 0.2, kDigest: 0.2, ...extra });

    it('scales a bead whose two enzymes ask for more than 255 down to a sum of exactly 255, and leaves a smaller sum alone', () => {
      expect(scaleJobs(100, 100)).toEqual([100, 100]); expect(scaleJobs(255, 0)).toEqual([255, 0]); expect(scaleJobs(0, 255)).toEqual([0, 255]); expect(scaleJobs(200, 55)).toEqual([200, 55]);
      expect(scaleJobs(200, 200)).toEqual([127, 128]); expect(scaleJobs(255, 255)).toEqual([127, 128]); expect(scaleJobs(255, 85)).toEqual([191, 64]);
      for (let h = 0; h <= 255; h += 5) for (let d = 0; d <= 255; d += 5) { const [a, b] = scaleJobs(h, d); if (h + d > 255) expect(a + b).toBe(255); else expect([a, b]).toEqual([h, d]); }
      // the colour sees the scaled bytes: a bead asking for (255, 255) looks like (127, 128)
      expect(jobHueLight(255, 255)).toEqual(jobHueLight(127, 128));
      expect(jobHueLight(255, 0).hue).toBe(120); expect(jobHueLight(0, 255).hue).toBe(300); expect(jobHueLight(0, 0).light).toBe(0);
    });

    it('a bead asking for more than the budget acts like its scaled bytes (the fields come out identical)', () => {
      const mk = (h: number, d: number) => {
        const w = bare({ kHarvest: 0.05, kDigest: 0.05 }), f = w.addLoop(32, 32, 8, undefined, 128, 128, h, d);
        void f; w.scatter(w.waste, 3000); w.scatter(w.lipid, 3000); w.scatter(w.food, 100); return run(w, 60);
      };
      const a = mk(255, 255), b = mk(127, 128);
      expect(Array.from(a.food)).toEqual(Array.from(b.food)); expect(Array.from(a.waste)).toEqual(Array.from(b.waste)); expect(Array.from(a.lipid)).toEqual(Array.from(b.lipid));
      expect(a.events.harvest).toBeGreaterThan(0); expect(a.events.digest).toBeGreaterThan(0);
      // and a pure harvester does no digesting, a pure digester no harvesting
      const ph = mk(255, 0), pd = mk(0, 255);
      expect(ph.events.digest).toBe(0); expect(ph.events.harvest).toBeGreaterThan(0); expect(pd.events.harvest).toBe(0); expect(pd.events.digest).toBeGreaterThan(0);
    });

    it('activity is convex: a half-and-half bead does a quarter of each job', () => {
      const mk = (h: number, d: number) => { const w = bare({ kHarvest: 0.004, kDigest: 0.004 }); w.addLoop(32, 32, 8, undefined, 128, 128, h, d); w.scatter(w.waste, 200000); w.scatter(w.lipid, 200000); run(w, 40); return w.events; };
      const full = mk(255, 0), half = mk(127, 128), dfull = mk(0, 255);
      // expected counts scale as (x / 255)^2: harvest by 127/255 squared = 0.248; digest by 128/255 squared = 0.252
      expect(half.harvest / full.harvest).toBeGreaterThan(0.2); expect(half.harvest / full.harvest).toBeLessThan(0.3);
      expect(half.digest / dfull.digest).toBeGreaterThan(0.2); expect(half.digest / dfull.digest).toBeLessThan(0.3);
    });

    it('keeps matter exact and rings whole with jobs on, in the uniform dish and the wild dish', () => {
      const wl = wild(1), mkU = () => jobsGarden(3), mkW = () => garden(3, { founders: wl.founders, founderJobs: [JOBS_FOUNDER, [160, 95], [255, 0]], params: { ...wl.params, ...JOBS } });
      for (const mk of [mkU, mkW]) {
        const w = mk(), m0 = w.matter(), we = new Weather(3, 900);
        for (let k = 1; k <= 4; k++) { for (let t = 0; t < 750; t++) { w.tick(); we.after(w, w.step); } expect(w.matter()).toBe(m0); expect(check(w)).toEqual([]); }
        expect(w.events.harvest).toBeGreaterThan(0); expect(w.events.digest).toBeGreaterThan(0);
        const again = mk(), we2 = new Weather(3, 900);
        for (let t = 0; t < 3000; t++) { again.tick(); we2.after(again, again.step); }
        expect(again.digest()).toBe(w.digest());
      }
    });

    it('with every option off, the four pinned states are untouched even with the job rates set', () => {
      const off = { jobs: false, jobsInert: false, kHarvest: 0.3, kDigest: 0.3 };
      expect(run(garden(1, { params: { ...HEREDITY, ...off } }), 2000).digest()).toBe('d0d875d2');
      expect(run(garden(1, { params: { ...WALL_GENES, ...off } }), 2000).digest()).toBe('48c2db7d');
      expect(run(garden(1, { params: { ...THREAD, ...off } }), 3000).digest()).toBe('9f878938');
      const wl = wild(4), w = garden(1, { founders: wl.founders, params: { ...wl.params, ...WALL_GENES, ...off } }), we = new Weather(1, 0, wl.weatherRings ?? 0);
      for (let t = 1; t <= 5000; t++) { w.tick(); we.after(w, t); }
      expect(w.digest()).toBe('995afe1e');
      // and the new bytes are not state when the option is off
      const a = garden(1, { params: WALL_GENES }), b = garden(1, { params: WALL_GENES });
      b.wh[0] = 3; b.wd[0] = 9;
      expect(a.digest()).toBe(b.digest());
      const c = jobsGarden(1), d = jobsGarden(1);
      d.wd[0] = 9;
      expect(c.digest()).not.toBe(d.digest());
    });

    it('needs wall genes, and the inert twin needs jobs', () => {
      expect(() => new VesicleWorld(1, { jobs: true, kHarvest: 0.1, kDigest: 0.1 })).toThrow(/wallGenes/);
      expect(() => new VesicleWorld(1, { ...WALL_GENES, jobsInert: true })).toThrow(/jobs/);
      expect(() => new VesicleWorld(1, { ...JOBS, kHarvest: 2 })).toThrow(/probabilities/);
    });

    it('harvest never turns waste to food outside the light in the wild dish, and digest works in the dark', () => {
      const wl = wild(4), w = new VesicleWorld(1, { ...wl.params, ...JOBS, kIn: 0, kOut: 0, sBurst: 0, kRep: 0, kDecay: 0, kLip: 0, dLipid: 0, dFood: 0, dWaste: 0, kHarvest: 0.3, kDigest: 0.3 });
      // rings spread over the dish (some in light, some not), all kinds of job: pure harvesters and pure digesters alternate
      for (let k = 0; k < 40; k++) w.addLoop(20 + (k % 8) * 44, 20 + Math.floor(k / 8) * 70, 6, undefined, 128, 128, k % 2 ? 255 : 0, k % 2 ? 0 : 255);
      w.scatter(w.waste, 60000); w.scatter(w.lipid, 60000);
      let lit = 0, darkHarvest = 0, darkDigest = 0, litDigest = 0;
      const cellOfBead = (i: number) => w.cellOf(w.bx[i], w.by[i]);
      w.hooks.harvest = (i, n) => { if (w.litMask[cellOfBead(i)] === 1) lit += n; else darkHarvest += n; };
      w.hooks.digest = (i, n) => { if (w.litMask[cellOfBead(i)] === 1) litDigest += n; else darkDigest += n; };
      const m0 = w.matter();
      run(w, 30);
      expect(w.matter()).toBe(m0);
      expect(lit).toBeGreaterThan(0); expect(darkHarvest).toBe(0);
      expect(darkDigest).toBeGreaterThan(0); expect(litDigest).toBeGreaterThan(0);
      expect(lit + darkHarvest).toBe(w.events.harvest); expect(litDigest + darkDigest).toBe(w.events.digest);
      // under uniform light, with nothing else but a pure harvester, harvest happens everywhere the bead is
      const u = bare({ kHarvest: 0.5 }); u.addLoop(32, 32, 8, undefined, 128, 128, 255, 0); u.scatter(u.waste, 5000); run(u, 20);
      expect(u.events.harvest).toBeGreaterThan(0);
    });

    it('the free conversions are off with jobs on: no light, no lipid decay, whatever kLight and kLipDecay say', () => {
      const w = new VesicleWorld(1, { ...JOBS, kLight: 0.5, kLipDecay: 0.5, kHarvest: 0, kDigest: 0, kIn: 0, kOut: 0, sBurst: 0, kRep: 0, kDecay: 0, kLip: 0 });
      w.addLoop(32, 32, 8); w.scatter(w.waste, 500); w.scatter(w.lipid, 500);
      const waste = Array.from(w.waste), lipid = Array.from(w.lipid);
      run(w, 20);
      // fields only move by diffusion: totals unchanged, nothing became food
      expect(w.food.reduce((a, v) => a + v, 0)).toBe(0);
      expect(w.waste.reduce((a, v) => a + v, 0)).toBe(waste.reduce((a, v) => a + v, 0)); expect(w.lipid.reduce((a, v) => a + v, 0)).toBe(lipid.reduce((a, v) => a + v, 0));
    });

    it('a new bead copies all four bytes from one neighbour (never a mix), and from either neighbour', () => {
      const w = new VesicleWorld(5, { W: 64, H: 64, ...JOBS, mut: 0, kOut: 0, sBurst: 0, kRep: 0, kDecay: 0, kLip: 0 });
      const first = w.addLoop(32, 32, 8), n0: string[] = [];
      for (let i = first, k = 0; k < 25; k++, i = w.next[i]) { w.wgene[i] = 10 + k; w.wmark[i] = 60 + k; w.wh[i] = 100 + k; w.wd[i] = 130 + k; n0.push(`${w.wgene[i]}/${w.wmark[i]}/${w.wh[i]}/${w.wd[i]}`); }
      w.addSolute(32, 32, 6, 300); w.scatter(w.lipid, 800);
      const old = w.beadHi;
      run(w, 600);
      expect(w.beadHi - old).toBeGreaterThan(10);
      let born = 0;
      for (let i = 0; i < w.beadHi; i++) { if (!w.alive[i]) continue; born++; expect(n0).toContain(`${w.wgene[i]}/${w.wmark[i]}/${w.wh[i]}/${w.wd[i]}`); }
      expect(born).toBeGreaterThan(25);
      // a bond with different ends: the copy is one end or the other, in all four bytes, about evenly
      const one = new VesicleWorld(9, { ...JOBS, mut: 0 }), f = one.addLoop(50, 50, 8), j = one.next[f], spare = one.next[j];
      one.wgene[f] = 40; one.wmark[f] = 41; one.wh[f] = 42; one.wd[f] = 43; one.wgene[j] = 200; one.wmark[j] = 201; one.wh[j] = 202; one.wd[j] = 203;
      const pick = one as unknown as { inherit(m: number, i: number, j: number): void };
      let low = 0;
      for (let t = 0; t < 400; t++) {
        pick.inherit(spare, f, j);
        const got = [one.wgene[spare], one.wmark[spare], one.wh[spare], one.wd[spare]].join('/');
        expect(['40/41/42/43', '200/201/202/203']).toContain(got); if (got === '40/41/42/43') low++;
      }
      expect(low).toBeGreaterThan(150); expect(low).toBeLessThan(250);
    });

    it('--founder-mark sets the wall marker bytes (and the solute inside), cycled over founders, and founder jobs are cycled too', () => {
      const w = garden(1, { founders: 4, founderMark: [11, 22, 33], founderJobs: [[255, 0], [0, 255], [128, 127]], params: JOBS });
      const marks = new Map<string, number>(), jobsSeen = new Map<number, string>();
      for (const l of loops(w, false)) {
        const key = `${w.wmark[l.first]}`; marks.set(key, (marks.get(key) ?? 0) + 1);
        let same = true; for (let i = l.first; ;) { if (w.wmark[i] !== w.wmark[l.first] || w.wh[i] !== w.wh[l.first] || w.wd[i] !== w.wd[l.first]) same = false; i = w.next[i]; if (i === l.first) break; }
        expect(same).toBe(true); jobsSeen.set(w.wmark[l.first], `${w.wh[l.first]}/${w.wd[l.first]}`);
      }
      expect([...marks.keys()].sort()).toEqual(['11', '22', '33']);
      expect(jobsSeen.get(11)).toBe('255/0'); expect(jobsSeen.get(22)).toBe('0/255'); expect(jobsSeen.get(33)).toBe('128/127');
      const seenSolute = new Set<number>(); for (let k = 0; k < w.n; k++) seenSolute.add(w.mark[k]);
      expect([...seenSolute].sort()).toEqual([11, 22, 33]);
      // without wall genes, a thread-less garden ignores founderMark (marker stays 128)
      const g = garden(1, { founders: 2, founderMark: [11, 22] });
      for (let i = 0; i < g.beadHi; i++) if (g.alive[i]) expect(g.wmark[i]).toBe(128);
    });

    it('the job bytes shift like the others when mutation is on, and not otherwise', () => {
      const shifted = (mut: number) => {
        const w = jobsGarden(2, { ...JOBS, mut, mutStep: 16 }); run(w, 1500);
        let n = 0; for (let i = 0; i < w.beadHi; i++) if (w.alive[i] && (w.wh[i] !== 200 || w.wd[i] !== 55)) n++;
        return n;
      };
      expect(shifted(0)).toBe(0); expect(shifted(0.1)).toBeGreaterThan(20);
    });

    it('blind copying: the job bytes do not steer where beads come from or go (same state with the bytes swapped when the enzymes cannot act)', () => {
      // with the enzymes silenced (rates 0) the bytes are inert: two worlds that differ only in the job bytes of one founder
      // build the same walls, solute and fields (the job bytes are the only thing the digest sees differing)
      const mk = (h: number, d: number) => garden(4, { founderJobs: [h, d], params: { ...JOBS, kHarvest: 0, kDigest: 0, kLight: 0, kLipDecay: 0 } });
      const a = run(mk(255, 0), 1500), b = run(mk(0, 255), 1500);
      for (const k of ['bx', 'by', 'next', 'prev', 'alive', 'wgene', 'wmark', 'food', 'waste', 'lipid'] as const) expect(Array.from(a[k] as ArrayLike<number>)).toEqual(Array.from(b[k] as ArrayLike<number>));
      expect(a.beadCount).toBe(b.beadCount); expect(a.n).toBe(b.n);
    });

    it('never wraps the Int32 food field: a full food cell takes no more units, and the ledger holds (harvest and digest)', () => {
      for (const kind of ['harvest', 'digest'] as const) {
        const w = bare({ beadCap: 0, kHarvest: 1, kDigest: 1 }), i = w.addLoop(32, 32, 8, 8, 128, 128, kind === 'harvest' ? 255 : 0, kind === 'digest' ? 255 : 0), c = w.cellOf(w.bx[i], w.by[i]);
        w.food[c] = 2147483647; w[kind === 'harvest' ? 'waste' : 'lipid'][c] = 1;
        const before = w.matter(); w.tick();
        expect(w.food[c]).toBe(2147483647); expect(w.matter()).toBe(before); expect(w.events[kind]).toBe(0);
      }
    });

    it('failed enzyme rolls do not move the main random stream: active and inert twins pick the same neighbours while nothing converts', () => {
      const mk = (inert: boolean) => {
        const w = new VesicleWorld(4, { ...JOBS, jobsInert: inert, mut: 0, kHarvest: 0.01, kDigest: 0, kLight: 0, kLipDecay: 0, kIn: 0, kOut: 0, sBurst: 0, kRep: 0, kDecay: 0, kLip: 0, dLipid: 0, dFood: 0, dWaste: 0 });
        const i = w.addLoop(32, 32, 7, 8, 128, 128, 0, 0); w.wh[i] = 1; w.waste[w.cellOf(w.bx[i], w.by[i])] = 1;
        for (let q = 0; q < 8; q++) { w.wgene[q] = 10 + q; w.wmark[q] = 40 + q; }
        return w;
      };
      const a = mk(false), b = mk(true);
      for (let s = 0; s < 3; s++) { a.tick(); b.tick(); }
      expect(Array.from(a.bx)).toEqual(Array.from(b.bx)); expect(Array.from(a.by)).toEqual(Array.from(b.by));
      const c = mk(false), d = mk(true);
      const ca = c as any, da = d as any; ca.enzymes(); ca.inherit(7, 0, 1); da.inherit(7, 0, 1);
      expect(c.wgene[7]).toBe(d.wgene[7]);
    });

    it('jobsInert converts nothing by enzyme, keeps the free conversions on, and carries and shifts the genome', () => {
      const w = jobsGarden(2, { ...JOBS_INERT, mut: 0.1, mutStep: 16 }), m0 = w.matter();
      run(w, 1500);
      expect(w.matter()).toBe(m0); expect(check(w)).toEqual([]);
      expect(w.events.harvest).toBe(0); expect(w.events.digest).toBe(0);
      // the free conversions ran: lipid decayed to waste and waste to food (with no solute decay and no uptake, nothing else could)
      let moved = 0; for (let i = 0; i < w.beadHi; i++) if (w.alive[i] && (w.wh[i] !== 200 || w.wd[i] !== 55)) moved++;
      expect(moved).toBeGreaterThan(10);
      const bare2 = new VesicleWorld(1, { ...JOBS_INERT, kIn: 0, kOut: 0, sBurst: 0, kRep: 0, kDecay: 0, kLip: 0, kLight: 0.2, kLipDecay: 0.2, dLipid: 0, dFood: 0, dWaste: 0, kHarvest: 0.5, kDigest: 0.5 });
      bare2.addLoop(32, 32, 8, undefined, 128, 128, 255, 255); bare2.scatter(bare2.waste, 400); bare2.scatter(bare2.lipid, 400);
      run(bare2, 10);
      expect(bare2.events.harvest + bare2.events.digest).toBe(0);
      expect(bare2.food.reduce((a, v) => a + v, 0)).toBeGreaterThan(0); expect(bare2.waste.reduce((a, v) => a + v, 0)).toBeGreaterThan(0);
      // the genome is state
      const x = jobsGarden(1, JOBS_INERT), y = jobsGarden(1, JOBS_INERT); y.wd[0] = 9;
      expect(x.digest()).not.toBe(y.digest());
    });

    it('observer: credits each conversion to the id of the bead that did it, and changes nothing in the world', () => {
      const watched = (steps: number) => {
        const w = jobsGarden(1), ev: import('../src/vesicle/observe.ts').LineageEvent[] = [], o = new LineageObserver(w, (e) => ev.push(e));
        for (let t = 0; t < steps; t++) { w.tick(); o.afterTick(); }
        return { w, o, ev };
      };
      const a = watched(6000), b = run(jobsGarden(1), 6000);
      expect(a.w.digest()).toBe(b.digest());
      // credits: in a world where no ring ever ends or pinches, every unit is credited to a living id and the sweep sums to the totals
      const w = bare({ kHarvest: 0.05, kDigest: 0.05 });
      w.addLoop(20, 20, 8, undefined, 128, 128, 255, 0); w.addLoop(44, 44, 8, undefined, 128, 128, 0, 255);
      w.scatter(w.waste, 2000); w.scatter(w.lipid, 2000);
      const o = new LineageObserver(w, () => {});
      for (let t = 0; t < 200; t++) { w.tick(); o.afterTick(); }
      const got: Record<number, { harvests: number; digests: number }> = {}, lines: string[] = [];
      o.forEachCell((id, s, j) => { got[id] = j; lines.push(cellLine(w.step, id, s, false, j)); });
      const ids = Object.keys(got).map(Number);
      expect(ids.length).toBe(2);
      expect(ids.reduce((a, id) => a + got[id].harvests, 0)).toBe(w.events.harvest); expect(ids.reduce((a, id) => a + got[id].digests, 0)).toBe(w.events.digest);
      // the harvester ring did all the harvesting, the digester ring all the digesting
      const [x, y] = ids.sort((p, q) => p - q);
      expect(got[x].harvests).toBeGreaterThan(0); expect(got[x].digests).toBe(0); expect(got[y].digests).toBeGreaterThan(0); expect(got[y].harvests).toBe(0);
      // columns line up with the header, and the counts reset after a sweep
      for (const l of lines) expect(l.split('\t').length).toBe(cellHeader(false, true).split('\t').length);
      const again: number[] = []; o.forEachCell((_id, _s, j) => again.push(j.harvests + j.digests));
      expect(again).toEqual([0, 0]);
      const first = lines.find((l) => l.split('\t')[1] === String(x))!.split('\t'), hd = cellHeader(false, true).split('\t');
      expect(Number(first[hd.indexOf('hMean')])).toBe(255); expect(Number(first[hd.indexOf('dMean')])).toBe(0); expect(Number(first[hd.indexOf('hSd')])).toBe(0);
      // pinch rows carry mean h and d for mother and both daughters, and the header agrees
      const p = a.ev.find((e) => e.ev === 'pinch');
      expect(p).toBeTruthy();
      if (p) {
        const cols = eventLine(p, false, true).split('\t');
        expect(cols.length).toBe(eventHeader(false, true).split('\t').length);
        const h = eventHeader(false, true).split('\t');
        expect(h.slice(-2)).toEqual(['m_harvests', 'm_digests']); expect(Number(cols[h.length - 1])).toBeGreaterThanOrEqual(0);
        expect(Number(cols[h.indexOf('m_hMean')])).toBeGreaterThan(0); expect(Number(cols[h.indexOf('a_dMean')])).toBeGreaterThan(0);
      }
      // nothing is lost to pinches or ends: the tallies on those rows plus the last sweep add up to the dish totals
      let hv = 0, dg = 0;
      for (const e of a.ev) { hv += e.jobs?.harvests ?? 0; dg += e.jobs?.digests ?? 0; }
      a.o.forEachCell((_id, _s, j) => { hv += j.harvests; dg += j.digests; });
      expect(hv).toBe(a.w.events.harvest); expect(dg).toBe(a.w.events.digest);
      expect(a.w.events.harvest).toBeGreaterThan(0);
      // the old row formats are unchanged when jobs are off
      expect(eventHeader(false)).toBe(eventHeader(false, false)); expect(cellHeader(true)).toBe(cellHeader(true, false));
    });

    it('matches the pinned state after 2,000 steps (a JOBS garden, founders 200/55)', () => {
      const w = run(jobsGarden(1), 2000);
      expect([w.digest(), w.matter(), w.n, w.beadCount, w.events.harvest, w.events.digest]).toEqual(PIN_JOBS);
    });
  });

  describe('wild', () => {
    const wildOpts = (area: number, arm: object = {}) => { const wl = wild(area); return { founders: wl.founders, params: { ...wl.params, ...arm } }; };

    it('sizes the dish and the founders together, and refuses a non-square area', () => {
      expect(wild(16).params.W).toBe(768); expect(wild(16).founders).toBe(96); expect(wild(4).params.H).toBe(384); expect(wild(1).founders).toBe(6);
      expect(() => wild(5)).toThrow();
      expect(wild(16).weatherRings).toBe(100000); expect(wild(4, { weather: false }).weatherRings).toBe(undefined);
    });

    it('lights about a quarter of the dish, moves the patches and wraps them', () => {
      const w = new VesicleWorld(1, wild(16).params);
      const frac = w.lightMask() / (w.gw * w.gh);
      expect(frac).toBeGreaterThan(0.15); expect(frac).toBeLessThan(0.3);
      const c0 = w.patchCentre(0, 0), c1 = w.patchCentre(0, 100000);
      expect(c1[0] === c0[0] && c1[1] === c0[1]).toBe(false);
      for (const t of [0, 1, 777777, 5e6]) for (let k = 0; k < w.p.lightPatches; k++) { const [x, y] = w.patchCentre(k, t); expect(x >= 0 && x < w.p.W && y >= 0 && y < w.p.H).toBe(true); }
    });

    it('turns waste to food only in lit cells and keeps matter exact', () => {
      const w = new VesicleWorld(1, { ...wild(4).params, kLight: 0.05, dFood: 0, dWaste: 0, dLipid: 0 });
      for (let c = 0; c < w.waste.length; c++) w.waste[c] = 50;
      const m0 = w.matter();
      run(w, 3);
      let litFood = 0, darkFood = 0;
      w.lightMask();
      for (let c = 0; c < w.food.length; c++) { if (w.litMask[c]) litFood += w.food[c]; else darkFood += w.food[c]; }
      // the patches move a few thousandths per step: the edge cells may differ, nothing else
      expect(litFood).toBeGreaterThan(0); expect(darkFood).toBeLessThan(litFood * 0.02);
      expect(w.matter()).toBe(m0);
    });

    it('keeps matter exact, rings whole and repeats from a seed, with every heredity arm and weather on', () => {
      for (const arm of [{}, WALL_GENES, WALL_GATE, THREAD, HEREDITY]) {
        const mk = () => garden(2, wildOpts(1, arm));
        const a = mk(), b = mk(), m0 = a.matter(), wa = new Weather(2, 700), wb = new Weather(2, 700);
        for (let t = 1; t <= 2100; t++) { a.tick(); wa.after(a, t); b.tick(); wb.after(b, t); if (t % 700 === 0) { expect(a.matter()).toBe(m0); expect(check(a)).toEqual([]); } }
        expect(a.digest()).toBe(b.digest()); expect(wa.wounds).toBeGreaterThan(0);
      }
    });

    it('wild dish with wall genes and weather: matches the pinned state after 5,000 steps', () => {
      // runner sequence (tick, then weather) on the 4x dish. Re-pinned 2026-11-20 when the weather changed on purpose from a fixed
      // interval (100,000 / founders steps: e40389c5, 22776, 1645, 1737, 1 wound) to one wound per 100,000 ring-steps (two wounds here)
      const wl = wild(4), w = garden(1, { founders: wl.founders, params: { ...wl.params, ...WALL_GENES } }), we = new Weather(1, 0, wl.weatherRings ?? 0);
      for (let t = 1; t <= 5000; t++) { w.tick(); we.after(w, t); }
      expect([w.digest(), w.matter(), w.n, w.beadCount, we.wounds]).toEqual(['995afe1e', 22776, 1721, 1802, 2]);
    }, 120000);

    it('weather in proportion to the rings: a wound each time the ring-steps reach the mark; a fixed interval when given', () => {
      // two rings, mark 1,000: the first wound at step 500, then one ring is left and the next comes 1,000 steps later
      const w = theftWorld(1), x = new Weather(1, 0, 1000), at: number[] = [];
      for (let t = 1; t <= 2000; t++) { w.tick(); const k = x.wounds; x.after(w, t); if (x.wounds > k) at.push(t); }
      expect(at).toEqual([500, 1500]);
      // a fixed interval wins over the rate, and wounds every `every` steps whatever the rings
      const v = theftWorld(1), y = new Weather(1, 300, 1000), got: number[] = [];
      for (let t = 1; t <= 700; t++) { v.tick(); const k = y.wounds; y.after(v, t); if (y.wounds > k) got.push(t); }
      expect(got).toEqual([300, 600]);
      // nothing set: no weather
      const u = theftWorld(1), z = new Weather(1, 0);
      for (let t = 1; t <= 700; t++) { u.tick(); z.after(u, t); }
      expect(z.wounds).toBe(0);
    });

    it('leaves the world alone when the light is uniform whatever the patch numbers say', () => {
      const a = run(garden(1, { params: HEREDITY }), 300).digest(), b = run(garden(1, { params: { ...HEREDITY, lightPatches: 0, patchR: 10, patchSpeed: 1 } }), 300).digest();
      expect(a).toBe(b);
    });
  });
});
