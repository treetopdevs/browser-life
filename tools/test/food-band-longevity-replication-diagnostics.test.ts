import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { diagnostics, overlap } from '../food-band-longevity-replication-diagnostics.mjs';

const PLAN_SHA = '6ae73fea19692f95e50538fecdc4203d89cf7ec5687ee38b6f580a57d94a005a';
const roots: string[] = [];
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const json = (value: unknown) => `${JSON.stringify(value)}\n`;
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

type Options = {
  seed?: 1202 | 1203;
  missingReceipt?: boolean;
  untrackedReceipt?: boolean;
  modifiedReceipt?: boolean;
  receiptSeed?: number;
  receiptPlanSha?: string;
  receiptArmHash?: 'movingBandArtifactSha256' | 'stationaryBandArtifactSha256';
  movingPass?: boolean;
  stationaryPass?: boolean;
  movingExtinctAt?: number;
  stationaryExtinctAt?: number;
  reversedHistoricalPhrase?: boolean;
  omitSeedAwareness?: boolean;
  extraSameAgeField?: boolean;
  missingMovingTick?: 5500 | 6000;
  missingStationaryTick?: 5500 | 6000;
  omitNonBlindObservation?: boolean;
  checkerFails?: boolean;
  manifestSeed?: number;
  manifestPlanSha?: string;
  manifestArmHash?: 'movingBand' | 'stationaryBand';
  wrongArmSeed?: boolean;
  wrongArmMode?: boolean;
  wrongArmPlan?: boolean;
  decisionStatus?: 'pending' | 'both' | 'moving-only' | 'stationary-only' | 'neither';
};

function fixture(options: Options = {}): { root: string; paths: Record<string, string>; receiptText: string } {
  const seed = options.seed ?? 1202;
  const otherSeed = seed === 1202 ? 1203 : 1202;
  const root = mkdtempSync(join(tmpdir(), 'food-band-longevity-replication-diagnostics-')); roots.push(root);
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'codex-tests@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Codex Tests'], { cwd: root });
  const docs = resolve(root, 'docs/creative-prototypes'); mkdirSync(docs, { recursive: true });
  const checkerDir = join(root, 'tools/food-band-longevity-replication'); mkdirSync(checkerDir, { recursive: true });
  writeFileSync(join(checkerDir, 'explore.ts'),
    `import { writeFileSync } from 'node:fs';\nwriteFileSync('check-invocation.json', JSON.stringify({cwd: process.cwd(), args: process.argv.slice(2)}));\n${options.checkerFails ? 'process.exitCode = 1;' : ''}\n`);
  const paths = {
    index: join(docs, `food-band-longevity-replication-index-${seed}.json`),
    movingBand: join(docs, `food-band-longevity-replication-moving-band-seed-${seed}.json`),
    stationaryBand: join(docs, `food-band-longevity-replication-stationary-band-seed-${seed}.json`),
    receipt: join(docs, `food-band-longevity-replication-visual-receipt-${seed}.json`),
  };
  const makeArm = (mode: 'moving-band' | 'stationary-band', extinctAt?: number, missingTick?: 5500 | 6000) => {
    const finalTick = extinctAt ?? 6000;
    const frameTicks = [3000, 5500, 6000].filter((tick) => tick <= finalTick && tick !== missingTick);
    if (extinctAt !== undefined && !frameTicks.includes(extinctAt)) frameTicks.push(extinctAt);
    frameTicks.sort((a, b) => a - b);
    const wrongMode = options.wrongArmMode && mode === 'moving-band' ? 'stationary-band' : mode;
    return {
      schemaVersion: 1,
      kind: 'hungry-shapes-food-band-longevity-replication-arm',
      run: {
        seed: options.wrongArmSeed ? otherSeed : seed, mode: wrongMode, mutation: true,
        maxTick: 6000, finalTick, extinctionTick: extinctAt ?? null,
      },
      provenance: { planSha256: options.wrongArmPlan ? '0'.repeat(64) : PLAN_SHA },
      numericalGate: { numericalPass: extinctAt === undefined },
      frames: frameTicks.map((tick) => ({ tick, cells: [[tick % 997, 1], [(tick + 1) % 997, 2]] })),
    };
  };
  const movingText = json(makeArm('moving-band', options.movingExtinctAt, options.missingMovingTick));
  const stationaryText = json(makeArm('stationary-band', options.stationaryExtinctAt, options.missingStationaryTick));
  const movingSha = hash(movingText), stationarySha = hash(stationaryText);
  writeFileSync(paths.movingBand, movingText); writeFileSync(paths.stationaryBand, stationaryText);
  const receipt: any = {
    seed: options.receiptSeed ?? seed,
    planSha256: options.receiptPlanSha ?? PLAN_SHA,
    movingBandArtifactSha256: movingSha,
    stationaryBandArtifactSha256: stationarySha,
    withinArmChanges: {
      movingBand: { from: 5500, to: 6000, pass: options.movingPass ?? true, observation: 'A body cluster shifted.' },
      stationaryBand: { from: 5500, to: 6000, pass: options.stationaryPass ?? true, observation: 'A gap expanded.' },
    },
    sameAgeComparisons: [3000, 5500, 6000].map((tick) => ({ tick, observation:
      tick === 3000 && !options.omitNonBlindObservation
        ? options.reversedHistoricalPhrase
          ? 'Not blind: media are historical; the reviewer knows both seeds\' numerical outcomes.'
          : options.omitSeedAwareness
            ? 'Not blind: historical moving media already exist; prior prefix outcomes for seeds 1202 and 1203 are known.'
            : 'Not blind: historical moving media already exist; the reviewer knows both seeds\' numerical outcomes.'
        : `Compared saved frames at ${tick}.`,
      ...(options.extraSameAgeField && tick === 3000 ? { reviewerNote: 'extra receipt field' } : {}) })),
    visualReviewedBeforeOverlapDiagnostics: true,
    reviewedAtUTC: '2026-10-26T12:00:00Z',
  };
  if (options.receiptArmHash) receipt[options.receiptArmHash] = 'f'.repeat(64);
  const receiptText = json(receipt);
  const movingPass = (options.movingPass ?? true) && options.movingExtinctAt === undefined;
  const stationaryPass = (options.stationaryPass ?? true) && options.stationaryExtinctAt === undefined;
  const status = options.decisionStatus ?? (movingPass ? (stationaryPass ? 'both' : 'moving-only') : (stationaryPass ? 'stationary-only' : 'neither'));
  const decision: Record<string, unknown> = {
    status, summary: 'Fixture only.', movingBandArtifactSha256: movingSha,
    stationaryBandArtifactSha256: stationarySha,
  };
  if (status !== 'pending') {
    decision.visualReceiptUrl = `food-band-longevity-replication-visual-receipt-${seed}.json`;
    decision.visualReceiptSha256 = hash(receiptText);
  }
  const index: any = {
    schemaVersion: 1, kind: 'hungry-shapes-food-band-longevity-replication-pair', seed: options.manifestSeed ?? seed,
    planSha256: options.manifestPlanSha ?? PLAN_SHA,
    arms: {
      movingBand: { mode: 'moving-band', url: `food-band-longevity-replication-moving-band-seed-${seed}.json`, rawSha256: movingSha },
      stationaryBand: { mode: 'stationary-band', url: `food-band-longevity-replication-stationary-band-seed-${seed}.json`, rawSha256: stationarySha },
    }, decision,
  };
  if (options.manifestArmHash) index.arms[options.manifestArmHash].rawSha256 = 'e'.repeat(64);
  writeFileSync(paths.index, json(index));
  if (!options.missingReceipt && !options.untrackedReceipt) writeFileSync(paths.receipt, receiptText);
  execFileSync('git', ['add', 'docs', 'tools'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'fixture evidence'], { cwd: root });
  if (options.untrackedReceipt) writeFileSync(paths.receipt, receiptText);
  if (options.modifiedReceipt) writeFileSync(paths.receipt, `${receiptText} `);
  return { root, paths, receiptText };
}

describe('saved food-band longevity diagnostics', () => {
  it('computes occupied-tile overlap and handles empty worlds', () => {
    expect(overlap({ cells: [[1, 2], [2, 3]] }, { cells: [[2, 1], [3, 2]] }))
      .toEqual({ occupiedA: 2, occupiedB: 2, sharedTiles: 1, unionTiles: 3, jaccard: 1 / 3 });
    expect(overlap({ cells: [] }, { cells: [] })).toEqual({ occupiedA: 0, occupiedB: 0, sharedTiles: 0, unionTiles: 0, jaccard: 0 });
  });

  it('routes both scheduled seeds and rejects unsupported or cross-seed paths', () => {
    const seed1202 = fixture({ seed: 1202 });
    const seed1203 = fixture({ seed: 1203 });
    expect(diagnostics(1202, seed1202.root).seed).toBe(1202);
    expect(diagnostics(1203, seed1203.root).seed).toBe(1203);
    expect(JSON.parse(readFileSync(join(seed1202.root, 'check-invocation.json'), 'utf8')).args)
      .toEqual(['--check', '--seed', '1202']);
    expect(JSON.parse(readFileSync(join(seed1203.root, 'check-invocation.json'), 'utf8')).args)
      .toEqual(['--check', '--seed', '1203']);
    expect(() => diagnostics(1201)).toThrow(/replication seeds 1202 and 1203/);
    expect(() => diagnostics(1204)).toThrow(/replication seeds 1202 and 1203/);
    expect(() => diagnostics(1203, seed1202.root)).toThrow();
  });

  it('requires a committed receipt and rejects later modification', () => {
    const missing = fixture({ missingReceipt: true });
    expect(() => diagnostics(1202, missing.root)).toThrow();
    const untracked = fixture({ untrackedReceipt: true });
    expect(() => diagnostics(1202, untracked.root)).toThrow(/already be committed unchanged/);
    expect(existsSync(join(untracked.root, 'check-invocation.json'))).toBe(false);
    const modified = fixture({ modifiedReceipt: true });
    expect(() => diagnostics(1202, modified.root)).toThrow(/already be committed unchanged/);
    expect(existsSync(join(modified.root, 'check-invocation.json'))).toBe(false);
  });

  it('rejects mismatched manifest, arm, and receipt identity bindings', () => {
    for (const options of [
      { manifestSeed: 1203 }, { manifestPlanSha: '0'.repeat(64) },
      { manifestArmHash: 'movingBand' as const }, { wrongArmSeed: true },
      { wrongArmMode: true }, { wrongArmPlan: true }, { receiptSeed: 1203 },
      { receiptPlanSha: '0'.repeat(64) }, { receiptArmHash: 'stationaryBandArtifactSha256' as const },
    ]) {
      const { root } = fixture(options);
      expect(() => diagnostics(1202, root)).toThrow();
    }
  });

  it('rejects pending decisions before overlap calculation', () => {
    const { root } = fixture({ decisionStatus: 'pending' });
    expect(() => diagnostics(1202, root)).toThrow(/require a final pair decision/);
  });

  it('requires nonblind historical-media disclosure in receipt observations', () => {
    const { root } = fixture({ omitNonBlindObservation: true });
    expect(() => diagnostics(1202, root)).toThrow(/not blind because historical media exist/);
  });

  it('rejects reversed wording that does not state historical media exist', () => {
    const { root } = fixture({ reversedHistoricalPhrase: true });
    expect(() => diagnostics(1202, root)).toThrow(/not blind because historical media exist/);
  });

  it('requires explicit awareness of both seeds numerical outcomes', () => {
    const { root } = fixture({ omitSeedAwareness: true });
    expect(() => diagnostics(1202, root)).toThrow(/awareness of both seeds.*numerical outcomes/);
  });

  it('rejects same-age receipt entries with fields beyond tick and observation', () => {
    const { root } = fixture({ extraSameAgeField: true });
    expect(() => diagnostics(1202, root)).toThrow(/Visual receipt identity or observations mismatch/);
  });

  it('requires exact 5500 and 6000 endpoints for every passing visual judgment', () => {
    for (const options of [
      { missingMovingTick: 5500 as const }, { missingMovingTick: 6000 as const },
      { missingStationaryTick: 5500 as const }, { missingStationaryTick: 6000 as const },
    ]) {
      const { root } = fixture(options);
      expect(() => diagnostics(1202, root)).toThrow(/must mark unavailable .* within-arm frames as failed/);
    }
  });

  it('allows unavailable late diagnostics only when actual terminal extinction explains them', () => {
    const extinct = fixture({ stationaryExtinctAt: 5800, stationaryPass: false });
    const result = diagnostics(1202, extinct.root).overlapDiagnosticsAfterVisualReview;
    expect(result.find((entry) => entry.comparison === 'stationaryBand-within-arm'))
      .toEqual({ comparison: 'stationaryBand-within-arm', from: 5500, to: 6000, available: false });
    expect(result.find((entry) => entry.comparison === 'moving-band-vs-stationary-band' && entry.tick === 6000))
      .toMatchObject({ tick: 6000, available: false });
  });

  it('rejects a missing endpoint without terminal extinction, even when the visual gate is false', () => {
    const truncated = fixture({ missingStationaryTick: 6000, stationaryPass: false });
    expect(() => diagnostics(1202, truncated.root)).toThrow(/not explained by actual terminal extinction/);
  });

  it('rejects a false extinction marker that ends before the missing frame', () => {
    const malformed = fixture({ stationaryExtinctAt: 5800, missingStationaryTick: 5500, stationaryPass: false });
    expect(() => diagnostics(1202, malformed.root)).toThrow(/not explained by actual terminal extinction/);
  });

  it('accepts a committed final receipt and reports saved-frame comparisons at the planned ticks', () => {
    const { root, receiptText } = fixture();
    const result = diagnostics(1202, root);
    expect(result).toMatchObject({ seed: 1202, planSha256: PLAN_SHA, visualReceiptSha256: hash(receiptText) });
    expect(result.overlapDiagnosticsAfterVisualReview.map((entry) => entry.tick ?? entry.from))
      .toEqual([3000, 5500, 6000, 5500, 5500]);
    expect(JSON.parse(readFileSync(join(root, 'check-invocation.json'), 'utf8'))).toEqual({
      cwd: realpathSync(root), args: ['--check', '--seed', '1202'],
    });
  });

  it('refuses overlap diagnostics when the runner check-only validation fails', () => {
    const { root } = fixture({ checkerFails: true });
    expect(() => diagnostics(1202, root)).toThrow(/runner check-only validation failed/);
    expect(existsSync(join(root, 'check-invocation.json'))).toBe(true);
  });

  it('requires final decisions to bind the canonical receipt and agree with both pass flags', () => {
    const wrongStatus = fixture({ decisionStatus: 'both', movingPass: false, stationaryPass: true });
    expect(() => diagnostics(1202, wrongStatus.root)).toThrow(/expected stationary-only/);
    const { root } = fixture();
    const indexPath = join(root, 'docs/creative-prototypes/food-band-longevity-replication-index-1202.json');
    const index = JSON.parse(readFileSync(indexPath, 'utf8'));
    index.decision.visualReceiptUrl = 'wrong.json';
    writeFileSync(indexPath, json(index));
    expect(() => diagnostics(1202, root)).toThrow(/Replication pair decision/);
  });
});
