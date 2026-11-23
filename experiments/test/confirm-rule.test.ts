import { describe, expect, it } from 'vitest';
import {
  classify,
  CONFIRM_SEEDS,
  decide,
  DROPLET_CENSUS,
  DROPLET_STEPS,
  type DropletRow,
  headline,
  judgeDroplets,
  judgeReef,
  majorSweeps,
  REEF_CENSUS,
  REEF_STEPS,
  type ReefRow,
  type WorldVerdict,
} from '../confirm/rule.ts';

function dropletRun(over: Partial<DropletRow>, flip = false): DropletRow[] {
  const rows: DropletRow[] = [];
  for (let i = 1; i <= DROPLET_STEPS / DROPLET_CENSUS; i++) {
    rows.push({ t: i * DROPLET_CENSUS, drop: 60, d1: 4, dom: flip ? i % 2 : 0, domShare: 0.4, phage: 100, res: 0, ...over });
  }
  return rows;
}

function reefRun(over: Partial<ReefRow>): ReefRow[] {
  const rows: ReefRow[] = [];
  for (let i = 1; i <= REEF_STEPS / REEF_CENSUS; i++) {
    rows.push({ t: i * REEF_CENSUS, cells: 200, mc: 0.8, meanSz: 5, maxSz: 30, ph: 0.4, gr: 0.3, arm: 0.3, res: 0, ...over });
  }
  return rows;
}

const each = <T>(f: (s: number) => T) => Object.fromEntries(CONFIRM_SEEDS.map((s) => [s, f(s)])) as Record<number, T>;

const dropletWorld = (phage: (s: number) => DropletRow[] = () => dropletRun({}, true)) => ({
  PHAGE: each(phage),
  NO_PHAGE: each(() => dropletRun({ drop: 62, d1: 5, phage: 0 })),
  SINGLE_WALL: each(() => dropletRun({ drop: 20, d1: 1 })),
  NEUTRAL_PHAGE: each(() => dropletRun({ drop: 12, d1: 3 })),
});

const reefWorld = (full: (s: number) => ReefRow[] = () => reefRun({})) => ({
  GRAZE_FULL: each(full),
  SWIM_NO_GRAZE: each(() => reefRun({ arm: 0.2, meanSz: 3, gr: 0 })),
  GRAZE_NO_SWIM: each(() => reefRun({})),
});

describe('confirmation rule', () => {
  it('passes droplets when every endpoint holds', () => {
    expect(judgeDroplets(dropletWorld()).pass).toBe(true);
  });

  it('allows one losing seed and fails on two', () => {
    const lose = (n: number) => (s: number) => dropletRun(s <= 4 + n ? { drop: 5 } : {}, true);
    expect(judgeDroplets(dropletWorld(lose(1))).pass).toBe(true);
    expect(judgeDroplets(dropletWorld(lose(2))).pass).toBe(false);
  });

  it('counts a tie as a loss', () => {
    const v = judgeDroplets({ ...dropletWorld(), NEUTRAL_PHAGE: each(() => dropletRun({})) });
    expect(v.endpoints[0].wins).toBe(0);
  });

  it('fails persistence when phage dies at the last census', () => {
    const run = () => {
      const rows = dropletRun({}, true);
      rows[rows.length - 1] = { ...rows[rows.length - 1], phage: 0 };
      return rows;
    };
    expect(judgeDroplets(dropletWorld(run)).pass).toBe(false);
  });

  it('refuses a nonzero residual and an incomplete run', () => {
    const bad = dropletRun({}, true);
    bad[10] = { ...bad[10], res: 1 };
    expect(() => judgeDroplets(dropletWorld(() => bad))).toThrow(/INVALID/);
    expect(() => judgeDroplets(dropletWorld(() => dropletRun({}, true).slice(0, 10)))).toThrow(/incomplete/);
  });

  it('judges the Reef and fails a dead tank', () => {
    expect(judgeReef(reefWorld()).pass).toBe(true);
    const dead = () => {
      const rows = reefRun({});
      rows[rows.length - 1] = { ...rows[rows.length - 1], cells: 0 };
      return rows;
    };
    expect(judgeReef(reefWorld(dead)).pass).toBe(false);
  });

  it('does not let a dead control or a dead treatment win', () => {
    const deadControl = () => {
      const rows = reefRun({ arm: 0, meanSz: 0, gr: 0 });
      rows[rows.length - 1] = { ...rows[rows.length - 1], cells: 0 };
      return rows;
    };
    expect(judgeReef({ ...reefWorld(), SWIM_NO_GRAZE: each(deadControl) }).pass).toBe(false);
    const deadPhage = () => {
      const rows = dropletRun({}, true);
      rows[rows.length - 1] = { ...rows[rows.length - 1], drop: 0 };
      return rows;
    };
    expect(judgeDroplets(dropletWorld(deadPhage)).pass).toBe(false);
  });

  it('refuses censuses off the expected steps', () => {
    const dup = () => reefRun({}).map((r, i) => ({ ...r, t: i < 100 ? 100_000 : 200_000 }));
    expect(() => judgeReef(reefWorld(dup))).toThrow(/incomplete/);
  });

  it('requires guilds in the same census for coexistence', () => {
    const alternating = () => reefRun({}).map((r, i) => ({ ...r, ph: i % 2 ? 0.8 : 0, gr: i % 2 ? 0 : 0.8 }));
    expect(judgeReef(reefWorld(alternating)).pass).toBe(false);
  });

  it('counts sweeps only among leaders holding 25%', () => {
    const r = (t: number, dom: number, domShare: number): DropletRow => ({ t, drop: 1, d1: 1, dom, domShare, phage: 1, res: 0 });
    expect(majorSweeps([r(1, 0, 0.5), r(2, 1, 0.2), r(3, 0, 0.5), r(4, 1, 0.3)])).toBe(1);
  });

  it('classifies direction with a 10% band and a 5-of-8 headline', () => {
    expect(classify(10, 11)).toBe('climbing');
    expect(classify(10, 10.5)).toBe('sitting');
    expect(classify(10, 9)).toBe('falling');
    expect(headline({ 1: 'climbing', 2: 'climbing', 3: 'climbing', 4: 'climbing', 5: 'climbing', 6: 'sitting', 7: 'falling', 8: 'sitting' })).toBe('climbing');
    expect(headline({ 1: 'climbing', 2: 'climbing', 3: 'climbing', 4: 'climbing', 5: 'sitting', 6: 'sitting', 7: 'falling', 8: 'sitting' })).toBe('mixed');
  });

  it('decides every outcome', () => {
    const v = (world: 'droplets' | 'reef', pass: boolean, dir: 'climbing' | 'sitting' | 'falling'): WorldVerdict => ({
      world,
      pass,
      endpoints: [],
      direction: { diversity: { headline: dir, perSeed: {} }, bodySize: { headline: dir, perSeed: {} } },
    });
    expect(decide(v('droplets', true, 'sitting'), v('reef', false, 'climbing')).winner).toBe('droplets');
    expect(decide(v('droplets', false, 'sitting'), v('reef', true, 'climbing')).winner).toBe('reef');
    expect(decide(v('droplets', false, 'sitting'), v('reef', false, 'climbing')).winner).toBe('neither');
    expect(decide(v('droplets', true, 'falling'), v('reef', true, 'climbing')).winner).toBe('reef');
    expect(decide(v('droplets', true, 'sitting'), v('reef', true, 'climbing')).winner).toBe('droplets');
    expect(decide(v('droplets', true, 'falling'), v('reef', true, 'sitting')).winner).toBe('droplets');
  });
});
