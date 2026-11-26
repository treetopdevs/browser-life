import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { diagnostics, overlap } from '../stationary-food-diagnostics.mjs';

const PLAN_SHA = 'ba835f94fddbd48a823fb6264d3e4f9d8a815014c5bc5e4997fec56e6f7aaa51';
const roots: string[] = [];
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const json = (value: unknown) => `${JSON.stringify(value)}\n`;
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

type Options = {
  missingReceipt?: boolean;
  untrackedReceipt?: boolean;
  receiptSeed?: number;
  receiptPlanSha?: string;
  receiptArmHash?: 'movingBandArtifactSha256' | 'stationaryBandArtifactSha256';
  movingPass?: boolean;
  stationaryPass?: boolean;
  missingMovingTick?: number;
  missingStationaryTick?: number;
  manifestSeed?: number;
  manifestPlanSha?: string;
  manifestArmHash?: 'movingBand' | 'stationaryBand';
  wrongArmSeed?: boolean;
  wrongArmPlan?: boolean;
  decisionStatus?: 'pending' | 'both' | 'moving-only' | 'stationary-only' | 'neither';
};

function fixture(options: Options = {}): { root: string; paths: Record<string, string>; receiptText: string } {
  const root = mkdtempSync(join(tmpdir(), 'stationary-food-diagnostics-')); roots.push(root);
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'codex-tests@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Codex Tests'], { cwd: root });
  const docs = resolve(root, 'docs/creative-prototypes'); mkdirSync(docs, { recursive: true });
  const paths = {
    index: join(docs, 'stationary-food-index-1202.json'),
    movingBand: join(docs, 'stationary-food-moving-band-seed-1202.json'),
    stationaryBand: join(docs, 'stationary-food-stationary-band-seed-1202.json'),
    receipt: join(docs, 'stationary-food-visual-receipt-1202.json'),
  };
  const frames = (missingTick?: number) => [1500, 2500, 3000].filter((tick) => tick !== missingTick)
    .map((tick) => ({ tick, cells: [[tick % 997, 1], [(tick + 1) % 997, 2]] }));
  const arm = (mode: 'moving-band' | 'stationary-band', missingTick?: number) => ({
    schemaVersion: 1, kind: 'hungry-shapes-stationary-food-arm',
    run: { seed: options.wrongArmSeed ? 1203 : 1202, mode },
    provenance: { planSha256: options.wrongArmPlan ? '0'.repeat(64) : PLAN_SHA },
    numericalGate: { numericalPass: true },
    frames: frames(missingTick),
  });
  const movingText = json(arm('moving-band', options.missingMovingTick));
  const stationaryText = json(arm('stationary-band', options.missingStationaryTick));
  const movingSha = hash(movingText), stationarySha = hash(stationaryText);
  writeFileSync(paths.movingBand, movingText); writeFileSync(paths.stationaryBand, stationaryText);
  const receipt: any = {
    seed: options.receiptSeed ?? 1202,
    planSha256: options.receiptPlanSha ?? PLAN_SHA,
    movingBandArtifactSha256: movingSha,
    stationaryBandArtifactSha256: stationarySha,
    withinArmChanges: {
      movingBand: { from: 2500, to: 3000, pass: options.movingPass ?? true, observation: 'Body cluster shifted.' },
      stationaryBand: { from: 2500, to: 3000, pass: options.stationaryPass ?? true, observation: 'Gap expanded.' },
    },
    sameAgeComparisons: [1500, 2500, 3000].map((tick) => ({ tick, observation: `Compared saved frames at ${tick}.` })),
    visualReviewedBeforeOverlapDiagnostics: true,
    reviewedAtUTC: '2026-10-26T12:00:00Z',
  };
  if (options.receiptArmHash) receipt[options.receiptArmHash] = 'f'.repeat(64);
  const receiptText = json(receipt);
  const movingPass = (options.movingPass ?? true);
  const stationaryPass = (options.stationaryPass ?? true);
  const status = options.decisionStatus ?? (movingPass ? (stationaryPass ? 'both' : 'moving-only') : (stationaryPass ? 'stationary-only' : 'neither'));
  const decision: Record<string, unknown> = {
    status, summary: 'Fixture only.', movingBandArtifactSha256: movingSha,
    stationaryBandArtifactSha256: stationarySha,
  };
  if (status !== 'pending') {
    decision.visualReceiptUrl = 'stationary-food-visual-receipt-1202.json';
    decision.visualReceiptSha256 = hash(receiptText);
  }
  const index: any = {
    schemaVersion: 1, kind: 'hungry-shapes-stationary-food-pair', seed: options.manifestSeed ?? 1202,
    planSha256: options.manifestPlanSha ?? PLAN_SHA,
    arms: {
      movingBand: { mode: 'moving-band', url: 'stationary-food-moving-band-seed-1202.json', rawSha256: movingSha },
      stationaryBand: { mode: 'stationary-band', url: 'stationary-food-stationary-band-seed-1202.json', rawSha256: stationarySha },
    }, decision,
  };
  if (options.manifestArmHash) index.arms[options.manifestArmHash].rawSha256 = 'e'.repeat(64);
  writeFileSync(paths.index, json(index));
  if (!options.missingReceipt && !options.untrackedReceipt) writeFileSync(paths.receipt, receiptText);
  execFileSync('git', ['add', 'docs'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'fixture evidence'], { cwd: root });
  if (options.untrackedReceipt) writeFileSync(paths.receipt, receiptText);
  return { root, paths, receiptText };
}

describe('saved stationary-food diagnostics', () => {
  it('computes occupied-tile overlap and handles empty worlds', () => {
    expect(overlap({ cells: [[1, 2], [2, 3]] }, { cells: [[2, 1], [3, 2]] }))
      .toEqual({ occupiedA: 2, occupiedB: 2, sharedTiles: 1, unionTiles: 3, jaccard: 1 / 3 });
    expect(overlap({ cells: [] }, { cells: [] })).toEqual({ occupiedA: 0, occupiedB: 0, sharedTiles: 0, unionTiles: 0, jaccard: 0 });
  });

  it('permits only seed 1202', () => {
    expect(() => diagnostics(1201)).toThrow(/Only stationary-food seed 1202/);
    expect(() => diagnostics(1203)).toThrow(/Only stationary-food seed 1202/);
  });

  it('requires the receipt to exist and already be committed', () => {
    const missing = fixture({ missingReceipt: true });
    expect(() => diagnostics(1202, missing.root)).toThrow();
    const untracked = fixture({ untrackedReceipt: true });
    expect(() => diagnostics(1202, untracked.root)).toThrow(/already be committed unchanged/);
  });

  it('rejects a receipt modified after it was committed', () => {
    const { root, paths } = fixture();
    writeFileSync(paths.receipt, `${readFileSync(paths.receipt, 'utf8')} `);
    expect(() => diagnostics(1202, root)).toThrow(/already be committed unchanged/);
  });

  it('checks manifest, arm, and receipt seed, hashes, plan, modes, and paths', () => {
    for (const options of [
      { manifestSeed: 1203 }, { manifestPlanSha: '0'.repeat(64) }, { manifestArmHash: 'movingBand' as const },
      { wrongArmSeed: true }, { wrongArmPlan: true }, { receiptSeed: 1203 },
      { receiptPlanSha: '0'.repeat(64) }, { receiptArmHash: 'stationaryBandArtifactSha256' as const },
    ]) {
      const { root } = fixture(options);
      expect(() => diagnostics(1202, root)).toThrow();
    }
  });

  it('requires both saved endpoints for every passing within-arm visual judgment', () => {
    const movingClaim = fixture({ missingMovingTick: 3000, movingPass: true });
    expect(() => diagnostics(1202, movingClaim.root)).toThrow(/unavailable movingBand within-arm frames/);
    const stationaryClaim = fixture({ missingStationaryTick: 2500, stationaryPass: true });
    expect(() => diagnostics(1202, stationaryClaim.root)).toThrow(/unavailable stationaryBand within-arm frames/);
    const failedJudgments = fixture({ missingMovingTick: 3000, movingPass: false,
      missingStationaryTick: 2500, stationaryPass: false });
    expect(diagnostics(1202, failedJudgments.root).overlapDiagnosticsAfterVisualReview.slice(-2))
      .toEqual([
        { comparison: 'movingBand-within-arm', from: 2500, to: 3000, available: false },
        { comparison: 'stationaryBand-within-arm', from: 2500, to: 3000, available: false },
      ]);
  });

  it('rejects a pending decision before calculating overlap', () => {
    const { root } = fixture({ decisionStatus: 'pending' });
    expect(() => diagnostics(1202, root)).toThrow(/require a final pair decision/);
  });

  it('accepts a committed final receipt and reports only overlaps from saved frames', () => {
    const { root, receiptText } = fixture();
    const result = diagnostics(1202, root);
    expect(result).toMatchObject({ seed: 1202, planSha256: PLAN_SHA, visualReceiptSha256: hash(receiptText) });
    expect(result.overlapDiagnosticsAfterVisualReview).toHaveLength(5);
    expect(result.overlapDiagnosticsAfterVisualReview[0]).toMatchObject({
      comparison: 'moving-band-vs-stationary-band', tick: 1500, occupiedA: 2, occupiedB: 2,
    });
  });

  it('requires final decisions to bind the canonical receipt', () => {
    const { root } = fixture({ decisionStatus: 'both' });
    const indexPath = join(root, 'docs/creative-prototypes/stationary-food-index-1202.json');
    const index = JSON.parse(readFileSync(indexPath, 'utf8'));
    index.decision.visualReceiptUrl = 'wrong.json';
    writeFileSync(indexPath, json(index));
    expect(() => diagnostics(1202, root)).toThrow(/Pair decision/);
  });

  it('requires final status to match numerical and within-arm visual pass flags', () => {
    const { root } = fixture({ decisionStatus: 'both', movingPass: false, stationaryPass: true });
    expect(() => diagnostics(1202, root)).toThrow(/expected stationary-only/);
  });
});
