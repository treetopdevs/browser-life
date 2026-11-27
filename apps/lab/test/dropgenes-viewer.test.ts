import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { expectPublicPage } from './support/public-page.ts';
import { DG_SCALE, DropGenesKernel, defaultDropGenesConfig } from '../src/dropgenes/kernel.ts';
import { parasiteShare, type Census } from '../src/dropgenes/observe.ts';
import {
  ARENA,
  CENSUS_EVERY,
  COMPLETE,
  DEFAULT_OPTIONS,
  DEFAULT_PACE,
  FADE_MAX,
  FIELD,
  GATE_CHOICE_TEXT,
  GENE_CHOICES,
  GENE_CHOICE_TEXT,
  History,
  LARGE_PHYSICS,
  LOOSE_GENE,
  LOOSE_PARASITE,
  MISSING_ALL,
  MISSING_ONE,
  PACE_CHOICES,
  PACE_CHOICE_TEXT,
  PARASITE_CHOICE_TEXT,
  PARASITE_FADE,
  PARASITE_RATE,
  RateMeter,
  SIZE_CHOICE_TEXT,
  ViewerSession,
  compartmentColour,
  foundWorld,
  geneTint,
  genesHeld,
  legendItems,
  looseAlpha,
  observeFrame,
  paintArena,
  parseSeed,
  readoutsOf,
  recordedHeld,
  recordedSentence,
  viewerConfig,
  type RGB,
  type SizeId,
  type ViewerOptions,
} from '../src/dropgenes/viewer-core.ts';

const lab = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(lab, '..', '..');
const RESULTS = readFileSync(join(repo, 'docs/droplet-genes-2026-11-21/RESULTS.md'), 'utf8');

const opts = (o: Partial<ViewerOptions> = {}): ViewerOptions => ({ ...DEFAULT_OPTIONS, ...o });
const dist = (a: RGB, b: RGB) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The body rows of the first Markdown table after `heading`, as trimmed cells with emphasis and code marks removed. */
function tableAfter(heading: string): string[][] {
  const at = RESULTS.indexOf(heading);
  expect(at, heading).toBeGreaterThanOrEqual(0);
  const lines = RESULTS.slice(at).split('\n');
  const start = lines.findIndex((l) => l.startsWith('|'));
  const rows: string[][] = [];
  for (let i = start + 2; i < lines.length && lines[i].startsWith('|'); i++) {
    rows.push(lines[i].split('|').slice(1, -1).map((c) => c.replace(/[*`]/g, '').trim()));
  }
  return rows;
}

describe('droplet genes viewer: settings', () => {
  it('uses the frozen settings and the LARGE physics that RESULTS.md records', () => {
    expect(RESULTS).toContain('frozen settings\n`diffT 0.1`, `mutPar 1e-4` in the parasite arms');
    expect(RESULTS).toContain('`LARGE` adds `diffW 0.03`,\n`diffF 0.6`, `diffA 0.44`');
    const base = defaultDropGenesConfig();
    for (const size of ['default', 'large'] as SizeId[]) {
      for (const genes of GENE_CHOICES) {
        const cfg = viewerConfig(opts({ size, genes, seed: 7 }));
        expect([cfg.width, cfg.height, cfg.seed, cfg.genes, cfg.capPerTile]).toEqual([64, 64, 7, genes, 16]);
        expect(cfg.diffT).toBe(0.1);
        expect(cfg.mutPar).toBe(1e-4);
        expect(cfg.kRepPar).toBe(2 * cfg.kRep);
        const want = size === 'large' ? { diffW: 0.03, diffF: 0.6, diffA: 0.44 } : { diffW: base.diffW, diffF: base.diffF, diffA: base.diffA };
        expect({ diffW: cfg.diffW, diffF: cfg.diffF, diffA: cfg.diffA }).toEqual(want);
        // Nothing else moves away from the kernel's defaults.
        const rest = { ...cfg, width: 0, height: 0, seed: 0, genes: 0, capPerTile: 0, diffT: 0, mutPar: 0, diffW: 0, diffF: 0, diffA: 0 };
        expect(rest).toEqual({ ...base, width: 0, height: 0, seed: 0, genes: 0, capPerTile: 0, diffT: 0, mutPar: 0, diffW: 0, diffF: 0, diffA: 0 });
      }
    }
    expect(LARGE_PHYSICS).toEqual({ diffW: 2 * base.diffW, diffF: 2 * base.diffF, diffA: 2 * base.diffA });
    expect(viewerConfig(opts({ parasite: false })).mutPar).toBe(0);
    expect(viewerConfig(opts({ gated: false })).gated).toBe(false);
    expect(PARASITE_RATE).toBe(1e-4);
  });

  it('opens on the headline cell: two genes, gate and parasite on, larger compartments, a confirmation seed', () => {
    expect(DEFAULT_OPTIONS).toEqual({ seed: 5, genes: 2, gated: true, parasite: true, size: 'large' });
    expect(RESULTS).toContain('Seeds 5 to 8 (never used in calibration)');
    expect(recordedHeld(DEFAULT_OPTIONS)).toBe(4);
  });

  it('reads a seed as a whole number from 0 to 2147483647, else falls back to the default', () => {
    expect(parseSeed(' 12 ')).toEqual({ seed: 12, replaced: false });
    expect(parseSeed('0')).toEqual({ seed: 0, replaced: false });
    expect(parseSeed('2147483647')).toEqual({ seed: 2147483647, replaced: false });
    for (const bad of ['', 'x', '-1', '1.5', '1e3', '2147483648', '99999999999']) expect(parseSeed(bad), bad).toEqual({ seed: 5, replaced: true });
  });

  it('every choice says what it changes', () => {
    const all = [...GENE_CHOICE_TEXT, ...GATE_CHOICE_TEXT, ...PARASITE_CHOICE_TEXT, ...SIZE_CHOICE_TEXT, ...PACE_CHOICE_TEXT];
    for (const c of all) {
      expect(c.name.length, c.name).toBeGreaterThan(3);
      expect(c.effect.length, c.name).toBeGreaterThan(30);
      expect(c.effect.length, c.name).toBeLessThan(230);
    }
    expect(new Set(all.map((c) => c.effect)).size).toBe(all.length);
    expect(GENE_CHOICE_TEXT.map((c) => c.value)).toEqual([2, 4, 8]);
    expect(GENE_CHOICE_TEXT[2].effect).toContain('about 2 per gene');
    expect(PARASITE_CHOICE_TEXT[0].effect).toContain('1 in 10,000 per tile per step');
    expect(SIZE_CHOICE_TEXT[0].effect).toContain('wall 0.03, food 0.6, leftovers 0.44');
    expect(SIZE_CHOICE_TEXT[1].effect).toContain('wall 0.015, food 0.3, leftovers 0.22');
    expect(RESULTS).toContain('late mean area about 19 to 22 tiles against about 12');
    expect(PACE_CHOICE_TEXT.map((c) => c.value)).toEqual([...PACE_CHOICES]);
    expect(PACE_CHOICES).toContain(DEFAULT_PACE);
  });
});

describe('droplet genes viewer: what the recorded runs found', () => {
  // Columns of both tables: gated with parasite, gated without, ungated with, ungated without.
  const ARMS: [boolean, boolean][] = [[true, true], [true, false], [false, true], [false, false]];

  it('matches the two-gene table of RESULTS.md at 16 sites', () => {
    const rows = tableAfter('Two genes, four sizes:');
    expect(rows.map((r) => r[0])).toEqual(['default, 8 sites', 'default, 16 sites', 'default, 32 sites', 'LARGE, 16 sites']);
    for (const [name, size] of [['default, 16 sites', 'default'], ['LARGE, 16 sites', 'large']] as [string, SizeId][]) {
      const row = rows.find((r) => r[0] === name)!;
      ARMS.forEach(([gated, parasite], i) => expect(recordedHeld({ size, genes: 2, gated, parasite }), `${name} ${i}`).toBe(Number(row[i + 1])));
    }
  });

  it('matches the ladder of RESULTS.md at the larger setting', () => {
    const rows = tableAfter('The ladder at `LARGE`, 16 sites:');
    expect(rows.map((r) => r[0])).toEqual(['2', '4', '8', '16']);
    for (const genes of GENE_CHOICES) {
      const row = rows.find((r) => r[0] === String(genes))!;
      ARMS.forEach(([gated, parasite], i) => expect(recordedHeld({ size: 'large', genes, gated, parasite }), `K ${genes} ${i}`).toBe(Number(row[i + 1])));
    }
  });

  it('says "not run" for four and eight genes at the default setting, and never borrows a result', () => {
    for (const genes of [4, 8] as const) {
      for (const [gated, parasite] of ARMS) {
        const o = { size: 'default' as const, genes, gated, parasite };
        expect(recordedHeld(o)).toBeNull();
        expect(recordedSentence(o)).toContain('not in the recorded runs');
        expect(recordedSentence(o)).not.toMatch(/held on/);
      }
    }
  });

  it('quotes only steps and figures that RESULTS.md states', () => {
    expect(recordedSentence(DEFAULT_OPTIONS)).toContain('held on 4 of 4 seeds');
    expect(recordedSentence(DEFAULT_OPTIONS)).toContain('about 36 compartments, with the parasite at 11 to 16 percent');
    expect(RESULTS).toContain('a late mean of about 36 compartments and the parasite at 11 to 16% of\n  all copies');
    expect(recordedSentence(opts({ gated: false }))).toContain('held on 0 of 4 seeds');
    expect(recordedSentence(opts({ gated: false }))).toContain('between steps 2,500 and 5,100');
    expect(RESULTS).toContain('The ungated world ended at step 2,500 to 5,100');
    expect(recordedSentence(opts({ size: 'default' }))).toContain('held on 1 of 4 seeds');
    expect(recordedSentence(opts({ size: 'default' }))).toContain('13,050, 64,250 and 106,200');
    expect(RESULTS).toContain('ended at steps 13,050, 64,250 and 106,200 on the others');
    expect(recordedSentence(opts({ genes: 4 }))).toContain('between steps 3,750 and 7,850');
    expect(RESULTS).toContain('the gated parasite runs ended at step 3,750\n  to 7,850');
    for (const [gated, parasite] of ARMS) expect(recordedSentence(opts({ genes: 8, gated, parasite }))).toContain('ended by step 400');
    expect(RESULTS).toContain('every run has ended by step 400');
    for (const [gated, parasite] of ARMS) expect(recordedSentence(opts({ gated, parasite }))).toContain('at least 10 compartments on average and at least half of them carried every gene');
  });
});

describe('droplet genes viewer: founding and readouts against experiments/dropgenes/run.ts', () => {
  it('founds sixteen compartments with two copies of each gene on every walled tile, and conserves matter', () => {
    const world = foundWorld(viewerConfig(DEFAULT_OPTIONS));
    expect(world.totalMatter() - world.initTotalMatter).toBe(0n);
    const { census, labels } = observeFrame(world);
    expect(census.compartments.length).toBe((ARENA / 16) ** 2);
    expect(census.compartments.every((c) => c.complete)).toBe(true);
    const S = world.p.species;
    for (let i = 0; i < world.nTiles; i++) {
      const walled = world.W[i] >= 0.125 * DG_SCALE;
      expect(labels[i] > 0).toBe(walled);
      expect([world.T[i * S], world.T[i * S + 1], world.T[i * S + 2]]).toEqual(walled ? [2, 2, 0] : [0, 0, 0]);
    }
  });

  /**
   * Rows printed by the runner itself, 2026-11-21, for example:
   *   deno run -A --no-lock experiments/dropgenes/run.ts --genes 2 --cap 16 --gated 1 --mutPar 1e-4 --size 64 \
   *     --steps 2000 --seed 5 --report 500 --ov '{"diffT":0.1,"diffW":0.03,"diffF":0.6,"diffA":0.44}'
   * Each row: step, compartments, complete, copies per compartment, parasite share, fissions, deaths.
   */
  const PINNED: [string, ViewerOptions, [number, number, number, string, string, number, number][]][] = [
    ['larger, 2 genes, gated, parasite, seed 5', opts(), [[500, 49, 48, '79.3', '0.075', 40, 6], [1000, 45, 44, '86.3', '0.101', 62, 30]]],
    ['larger, 2 genes, ungated, parasite, seed 5', opts({ gated: false }), [[500, 46, 45, '71.5', '0.082', 38, 9], [1000, 31, 31, '92.2', '0.213', 55, 41]]],
    ['default, 4 genes, gated, no parasite, seed 7', opts({ size: 'default', genes: 4, parasite: false, seed: 7 }), [[500, 15, 13, '62.2', '0.000', 19, 16]]],
  ];

  for (const [name, o, rows] of PINNED) {
    it(`steps the same world as the runner: ${name}`, { timeout: 180_000 }, () => {
      const s = new ViewerSession(o);
      // Uneven calls, as a page's ticks are: the census must still fall on every 50th step.
      const chunks = [1, 7, 64, 13, 16, 4];
      let n = 0;
      for (const [step, comps, complete, copies, par, fissions, deaths] of rows) {
        while (s.world.stepCount < step) {
          // A session that stopped early would return 0 for ever and this synchronous loop could not time out.
          const did = s.advance(Math.min(chunks[n++ % chunks.length], step - s.world.stepCount));
          expect(did, `the session stopped advancing at step ${s.world.stepCount}, before ${step}`).toBeGreaterThan(0);
        }
        const f = s.frame();
        expect(f.step).toBe(step);
        expect(f.censusStep).toBe(step);
        expect([f.readouts.compartments, f.readouts.complete, f.readouts.meanCopies!.toFixed(1), (f.readouts.parasiteShare ?? 0).toFixed(3)]).toEqual([comps, complete, copies, par]);
        expect([f.fissions, f.deaths]).toEqual([fissions, deaths]);
        expect(f.residual).toBe('0');
        expect(f.readouts.completeShare).toBe(complete / comps);
        expect(f.rgba.length).toBe(ARENA * ARENA * 4);
      }
      expect(s.history.points.map((p) => p.step)).toEqual(Array.from({ length: s.world.stepCount / CENSUS_EVERY + 1 }, (_, i) => i * CENSUS_EVERY));
      expect(s.history.points.at(-1)).toEqual({ step: rows.at(-1)![0], compartments: rows.at(-1)![1], completeShare: rows.at(-1)![2] / rows.at(-1)![1] });
      expect(s.ended).toBe(false);
      expect(s.emptySince).toBeNull();

      // Label c is compartment c - 1 of the census: the picture colours each tile by the right compartment.
      const view = observeFrame(s.world);
      const S = s.world.p.species;
      const area = new Array<number>(view.census.compartments.length).fill(0);
      const copies = view.census.compartments.map(() => new Array<number>(S).fill(0));
      for (let i = 0; i < s.world.nTiles; i++) {
        const c = view.labels[i];
        if (c === 0) continue;
        area[c - 1]++;
        for (let k = 0; k < S; k++) copies[c - 1][k] += s.world.T[i * S + k];
      }
      expect(area).toEqual(view.census.compartments.map((c) => c.area));
      expect(copies).toEqual(view.census.compartments.map((c) => c.copies));
    });
  }

  it('reading a frame does not disturb the run or the tracker', { timeout: 60_000 }, () => {
    const a = new ViewerSession(opts());
    const b = new ViewerSession(opts());
    for (let i = 0; i < 30; i++) {
      a.advance(10);
      a.frame();
      a.frame();
    }
    b.advance(300);
    expect(a.world.digest()).toBe(b.world.digest());
    const fa = a.frame();
    const fb = b.frame();
    expect([fa.fissions, fa.deaths, fa.readouts]).toEqual([fb.fissions, fb.deaths, fb.readouts]);
    expect(Array.from(fa.rgba)).toEqual(Array.from(fb.rgba));
  });

  it('stops within its time budget and reports the steps it took', () => {
    const s = new ViewerSession(opts());
    let t = 0;
    const now = () => (t += 30);
    // The clock reads 30 ms more at every look: the fourth step is the first to end past the 100 ms budget.
    expect(s.advance(64, 100, now)).toBe(4);
    expect(s.world.stepCount).toBe(4);
    expect(s.advance(2, 100, now)).toBe(2);
    expect(s.advance(1, 0)).toBe(1);
  });

  it('an eight-gene world ends as the recorded runs did, and then stays still', { timeout: 120_000 }, () => {
    expect(RESULTS).toContain('eight genes\n  at 250 to 400');
    const s = new ViewerSession(opts({ genes: 8 }));
    let total = 0;
    while (!s.ended && total < 1000) total += s.advance(50);
    expect(s.ended).toBe(true);
    expect(s.world.stepCount).toBeGreaterThanOrEqual(250);
    expect(s.world.stepCount).toBeLessThanOrEqual(400);
    expect(s.emptySince).not.toBeNull();
    expect(s.emptySince!).toBeLessThanOrEqual(s.world.stepCount);
    const f = s.frame();
    expect(f.ended).toBe(true);
    expect([f.readouts.compartments, f.readouts.completeShare, f.readouts.meanCopies]).toEqual([0, null, null]);
    expect(f.residual).toBe('0');
    const at = s.world.stepCount;
    expect(s.advance(64)).toBe(0);
    expect(s.world.stepCount).toBe(at);
  });

  it('gives no share when there is nothing to take a share of, and counts loose copies in the parasite share', () => {
    const empty: Census = { step: 9, compartments: [], stranded: [0, 0, 0], strandedBare: [0, 0, 0], strandedHalo: [0, 0, 0], strandedSmall: [0, 0, 0] };
    expect(readoutsOf(empty, 2)).toEqual({ step: 9, compartments: 0, complete: 0, completeShare: null, meanCopies: null, parasiteShare: null });
    const comp = (copies: number[], complete: boolean) => ({ uid: 1, parentUid: 0, bornStep: 0, area: 4, wall: 1, cx: 0, cy: 0, copies, complete });
    const c: Census = { ...empty, compartments: [comp([6, 4, 2], true), comp([8, 0, 0], false)], stranded: [1, 1, 8] };
    // 20 copies inside two compartments; 10 parasite copies among 30 in the arena.
    expect(readoutsOf(c, 2)).toEqual({ step: 9, compartments: 2, complete: 1, completeShare: 0.5, meanCopies: 10, parasiteShare: 10 / 30 });
  });
});

describe('droplet genes viewer: the picture', () => {
  it('gives complete compartments one colour and steps incomplete ones toward the warning colour', () => {
    for (const K of GENE_CHOICES) {
      expect(geneTint(K, K)).toEqual(COMPLETE);
      expect(geneTint(K - 1, K)).toEqual(MISSING_ONE);
      expect(geneTint(0, K)).toEqual(MISSING_ALL);
      let last = -1;
      for (let held = K - 1; held >= 0; held--) {
        const d = dist(geneTint(held, K), MISSING_ONE);
        expect(d, `K ${K} held ${held}`).toBeGreaterThan(last);
        last = d;
        // No incomplete step can be taken for the complete colour.
        expect(dist(geneTint(held, K), COMPLETE)).toBeGreaterThan(120);
      }
    }
    expect(genesHeld([3, 0, 1, 7, 9], 4)).toBe(3);
    expect(genesHeld([1, 1, 50], 2)).toBe(2);
  });

  it('fades a compartment toward grey as the parasite takes a larger share of its copies', () => {
    expect(compartmentColour([5, 5, 0], 2)).toEqual(COMPLETE);
    expect(compartmentColour([0, 0, 0], 2)).toEqual(MISSING_ALL);
    // All parasite: most of the way to grey, never all the way.
    expect(FADE_MAX).toBeGreaterThanOrEqual(0.5);
    expect(FADE_MAX).toBeLessThanOrEqual(0.8);
    expect(dist(compartmentColour([0, 0, 9], 2), PARASITE_FADE)).toBeCloseTo((1 - FADE_MAX) * dist(MISSING_ALL, PARASITE_FADE), 6);
    let last = -1;
    for (const par of [0, 2, 5, 10, 30, 90]) {
      const copies = [5, 5, par];
      const d = dist(compartmentColour(copies, 2), COMPLETE);
      expect(d).toBeGreaterThan(last);
      last = d;
      const share = parasiteShare(copies, 2)!;
      expect(dist(compartmentColour(copies, 2), PARASITE_FADE)).toBeCloseTo((1 - FADE_MAX * share) * dist(COMPLETE, PARASITE_FADE), 6);
    }
    // Seen in the ungated world at step 2,045 (seed 5): one gene lost, 97% parasite. It must not pass for a
    // complete compartment with the same load, nor for one missing both genes.
    const lost = compartmentColour([0, 1, 31], 2);
    expect(dist(lost, compartmentColour([1, 1, 31], 2))).toBeGreaterThan(60);
    expect(dist(lost, compartmentColour([0, 0, 33], 2))).toBeGreaterThan(25);
    expect(lost[0]).toBeGreaterThan(lost[2]); // still warm
    const kept = compartmentColour([1, 1, 31], 2);
    expect(kept[2]).toBeGreaterThan(kept[0]); // still cool
  });

  it('paints bare water dark, compartments by their genes, and loose copies faintly', () => {
    const cfg = defaultDropGenesConfig({ width: 12, height: 12, genes: 2 });
    const world = new DropGenesKernel(cfg);
    const S = world.p.species;
    const at = (x: number, y: number) => y * 12 + x;
    const fill = (x0: number, y0: number, genes: [number, number, number]) => {
      for (let y = y0; y < y0 + 2; y++) for (let x = x0; x < x0 + 2; x++) {
        world.W[at(x, y)] = DG_SCALE;
        genes.forEach((n, k) => { world.T[at(x, y) * S + k] = n; });
      }
    };
    fill(1, 1, [2, 2, 0]); // complete
    fill(5, 1, [2, 0, 0]); // missing a gene
    fill(8, 5, [1, 1, 18]); // complete, nine tenths parasite
    world.W[at(1, 8)] = DG_SCALE; // one dense tile alone: too small to be a compartment
    world.T[at(4, 9) * S] = 1; // one loose gene copy on bare water
    world.T[at(6, 9) * S + 2] = 1; // one loose parasite copy
    world.T[at(8, 9) * S] = 30; // a crowd of loose gene copies
    const view = observeFrame(world);
    expect(view.census.compartments.length).toBe(3);
    const out = new Uint8ClampedArray(world.nTiles * 4);
    paintArena(world, view, out);
    const px = (x: number, y: number): RGB => [out[at(x, y) * 4], out[at(x, y) * 4 + 1], out[at(x, y) * 4 + 2]];
    const near = (a: RGB, b: RGB) => expect(dist(a, b)).toBeLessThan(2);
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(255);
    near(px(0, 0), FIELD);
    near(px(1, 1), COMPLETE);
    near(px(6, 2), MISSING_ONE);
    const loaded = px(8, 5);
    expect(dist(loaded, COMPLETE)).toBeGreaterThan(dist(loaded, PARASITE_FADE));
    // The lone dense tile shows as wall, not as a compartment.
    expect(dist(px(1, 8), COMPLETE)).toBeGreaterThan(80);
    expect(dist(px(1, 8), FIELD)).toBeGreaterThan(40);
    // Loose copies are visible, tinted by kind, and never as bright as a compartment.
    const gene = px(4, 9);
    const par = px(6, 9);
    const crowd = px(8, 9);
    expect(dist(gene, FIELD)).toBeGreaterThan(25);
    expect(dist(par, FIELD)).toBeGreaterThan(25);
    expect(gene[2]).toBeGreaterThan(gene[0]);
    expect(par[0]).toBeGreaterThan(par[1]);
    expect(dist(crowd, FIELD)).toBeGreaterThan(dist(gene, FIELD));
    expect(dist(crowd, LOOSE_GENE)).toBeGreaterThan(60);
    expect(dist(par, LOOSE_PARASITE)).toBeGreaterThan(60);
    expect(looseAlpha(0)).toBe(0);
    expect(looseAlpha(1)).toBeGreaterThan(0.2);
    expect(looseAlpha(1000)).toBe(0.5);
    // A crowd of loose copies stays darker than the dimmest tile of any compartment, even a fully faded one.
    const lum = (c: RGB) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    expect(lum(crowd)).toBeLessThan(lum(px(1, 1)));
    expect(lum(crowd)).toBeLessThan(lum(px(6, 2)));
  });

  it('builds the legend from the colours the picture uses', () => {
    for (const K of GENE_CHOICES) {
      const items = legendItems(K);
      expect(items.length).toBe(6);
      expect(items[0]).toEqual({ swatch: 'rgb(62, 196, 222)', text: `Compartment carrying all ${K} genes` });
      expect(items[1].swatch).toContain('rgb(240, 190, 62)');
      expect(items[1].swatch).toContain('rgb(232, 92, 58)');
      expect((items[1].swatch.match(/rgb\(/g) ?? []).length).toBe(K);
      expect(items[2].swatch).toContain('rgb(62, 196, 222), rgb(77, 120, 131)');
      expect(items[2].text).toContain('a missing gene still shows');
    }
  });
});

describe('droplet genes viewer: chart history and speed', () => {
  it('keeps the whole run by halving its detail each time it fills', () => {
    const h = new History(8);
    for (let step = 0; step <= 50 * 40; step += 50) h.push({ step, compartments: step, completeShare: 1 });
    expect(h.points.length).toBeLessThanOrEqual(8);
    expect(h.points[0].step).toBe(0);
    expect(h.interval).toBe(400);
    expect(h.points.map((p) => p.step)).toEqual([0, 400, 800, 1200, 1600, 2000]);
    h.push({ step: 2050, compartments: 1, completeShare: 1 });
    expect(h.points.at(-1)!.step).toBe(2000);
  });

  it('measures steps per second over a short window', () => {
    const m = new RateMeter(2000);
    expect(m.rate()).toBeNull();
    m.push(0, 0);
    m.push(100, 40);
    expect(m.rate()).toBeNull(); // too short to trust
    m.push(1000, 400);
    expect(m.rate()).toBe(400);
    for (let t = 2000; t <= 10000; t += 1000) m.push(t, 400 + (t - 1000) * 0.1);
    expect(m.rate()).toBeCloseTo(100, 6);
    m.push(11000, 1300);
    m.push(12000, 1300);
    m.push(13000, 1300);
    m.push(14000, 1300);
    expect(m.rate()).toBeNull(); // a paused run has no rate
    m.clear();
    expect(m.rate()).toBeNull();
  });
});

describe('droplet genes viewer: the page is public', () => {
  const html = readFileSync(join(lab, 'dropgenes/index.html'), 'utf8');
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  it('ships with the site, carries an icon, and like the other standalone experiment pages counts no page views', () => {
    expectPublicPage('dropgenes', 'dropgenes: r("./dropgenes/index.html"),');
    expect(html).toMatch(/<link rel="icon" href="\/favicon.svg"/);
    expect(html).toContain('src="/src/dropgenes/page.ts"');
    // theme.ts starts the page-view counter; this page keeps its own small theme switch instead.
    expect(html).not.toContain('theme.ts');
    for (const f of ['page.ts', 'viewer-core.ts', 'viewer.worker.ts']) {
      expect(readFileSync(join(lab, 'src/dropgenes', f), 'utf8'), f).not.toMatch(/(?:import|from)\s*\(?\s*['"][^'"]*(?:theme|analytics)/);
    }
  });

  it('is named only where it is meant to be: its result, the story and its jar, the sitemap', () => {
    // Since 27 Nov 2026 the page is reached from its journal result and the story. It is a prototype, not one of the
    // lab's worlds, so nothing else (the home page, the catalogue, the lab) names it.
    const allowed = new Set(['experiments/index.html', 'story/index.html', 'public/sitemap.xml', 'src/experiments/ledger.ts',
      'src/story/jars.ts', 'src/story/jars-spec.ts', 'src/story/ladder.ts', 'src/story/story.css']);
    const skip = new Set(['node_modules', 'dist', 'test', 'dropgenes', 'vite.config.ts']);
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (skip.has(name)) continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(html|ts|css|xml|txt|json|webmanifest)$/.test(name) && readFileSync(path, 'utf8').includes('dropgenes')) hits.push(path.slice(lab.length + 1));
      }
    };
    walk(lab);
    expect(hits.filter((h) => !allowed.has(h))).toEqual([]);
    for (const must of ['story/index.html', 'src/experiments/ledger.ts', 'public/sitemap.xml']) expect(hits, must).toContain(must);
  });

  it('says what it is and claims no more than RESULTS.md', () => {
    expect(text).not.toMatch(/sandbox/i);
    expect(text).not.toContain('not linked from the site');
    expect(text).toContain('Designed world · prototype');
    expect(text).toContain('Nothing in this world evolves yet');
    expect(text).toContain('on all four seeds only at the larger setting and only with the gate');
    expect(text).toContain('on one seed of four');
    // The one other use of the word is the journal's own line for this result, in "What we found".
    expect(text.replace('Nothing evolved here.', '')).not.toMatch(/\bevolv(?:ed|es|ing)\b(?! yet)/);
    expect(RESULTS).toContain('It does not show evolution.');
  });
});
