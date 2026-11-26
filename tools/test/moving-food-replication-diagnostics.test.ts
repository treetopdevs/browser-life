import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { diagnostics, overlap } from '../moving-food-replication-diagnostics.mjs';

const PLAN_SHA = '72f651acc7f221991b0ce89f7264eed9dd47df54e955d3d164406b4d0a17cc47';
const roots: string[] = [];
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const json = (value: unknown) => `${JSON.stringify(value)}\n`;
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

type Options = {
  seed?: number;
  missingReceipt?: boolean;
  leaveReceiptUntracked?: boolean;
  receiptSeed?: number;
  receiptArmHash?: 'uniformArtifactSha256' | 'movingBandArtifactSha256';
  receiptPass?: boolean;
  latePass?: boolean;
  missingUniformTick?: number;
  missingMovingTick?: number;
  manifestSeed?: number;
  manifestPlanSha?: string;
  manifestArmHash?: 'uniform' | 'movingBand';
  decisionArmHash?: 'uniformArtifactSha256' | 'movingBandArtifactSha256';
  receiptUrl?: string;
  commit?: boolean;
};
function fixture(options: Options = {}): { root: string; receiptText: string; paths: Record<string, string> } {
  const seed = options.seed ?? 1202;
  const root = mkdtempSync(join(tmpdir(), 'moving-food-diagnostics-')); roots.push(root);
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'codex-tests@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Codex Tests'], { cwd: root });
  const docs = resolve(root, 'docs/creative-prototypes'); mkdirSync(docs, { recursive: true });
  const paths = {
    manifest: join(docs, `moving-food-replication-index-${seed}.json`),
    uniform: join(docs, `moving-food-replication-uniform-seed-${seed}.json`),
    movingBand: join(docs, `moving-food-replication-moving-band-seed-${seed}.json`),
    receipt: join(docs, `moving-food-replication-visual-receipt-${seed}.json`),
  };
  const frames = (missingTick?: number) => [1500, 2500, 3000].filter((tick) => tick !== missingTick).map((tick) => ({ tick, cells: [[tick % 997, 1], [(tick + 1) % 997, 2]] }));
  const arms = {
    uniform: { schemaVersion: 1, kind: 'hungry-shapes-moving-food-arm', run: { seed, mode: 'uniform' }, provenance: { planSha256: PLAN_SHA }, frames: frames(options.missingUniformTick) },
    movingBand: { schemaVersion: 1, kind: 'hungry-shapes-moving-food-arm', run: { seed, mode: 'moving-band' }, provenance: { planSha256: PLAN_SHA }, frames: frames(options.missingMovingTick) },
  };
  const uniformText = json(arms.uniform), movingText = json(arms.movingBand);
  const uniformSha = hash(uniformText), movingSha = hash(movingText);
  writeFileSync(paths.uniform, uniformText); writeFileSync(paths.movingBand, movingText);
  const receipt = {
    seed: options.receiptSeed ?? seed, uniformArtifactSha256: uniformSha, movingBandArtifactSha256: movingSha,
    visualComparisons: [1500, 2500, 3000].map((tick) => ({ tick, pass: options.receiptPass ?? true, observation: `Recorded visual review at ${tick}.` })),
    lateWithinMoving: { from: 2500, to: 3000, pass: options.latePass ?? true, observation: 'Recorded late moving-world review.' },
    visualReviewedBeforeOverlapDiagnostics: true,
  };
  if (options.receiptArmHash) receipt[options.receiptArmHash] = 'f'.repeat(64);
  const receiptText = json(receipt);
  const index = {
    schemaVersion: 1, kind: 'hungry-shapes-moving-food-pair', seed: options.manifestSeed ?? seed, planSha256: options.manifestPlanSha ?? PLAN_SHA,
    arms: {
      uniform: { mode: 'uniform', url: `moving-food-replication-uniform-seed-${seed}.json`, rawSha256: uniformSha },
      movingBand: { mode: 'moving-band', url: `moving-food-replication-moving-band-seed-${seed}.json`, rawSha256: movingSha },
    },
    decision: { status: 'promising', summary: 'Fixture only.', uniformArtifactSha256: uniformSha, movingBandArtifactSha256: movingSha,
      visualReceiptUrl: options.receiptUrl ?? `moving-food-replication-visual-receipt-${seed}.json`, visualReceiptSha256: hash(receiptText) },
  };
  if (options.manifestArmHash) index.arms[options.manifestArmHash].rawSha256 = 'e'.repeat(64);
  if (options.decisionArmHash) index.decision[options.decisionArmHash] = 'd'.repeat(64);
  writeFileSync(paths.manifest, json(index));
  if (!options.missingReceipt && !options.leaveReceiptUntracked) writeFileSync(paths.receipt, receiptText);
  if (options.commit !== false) {
    execFileSync('git', ['add', 'docs'], { cwd: root });
    execFileSync('git', ['commit', '-qm', 'fixture evidence'], { cwd: root });
  }
  if (options.leaveReceiptUntracked) writeFileSync(paths.receipt, receiptText);
  return { root, receiptText, paths };
}

describe('saved-frame diagnostics', () => {
  it('counts occupied tiles independently of family labels', () => {
    expect(overlap({ cells: [[1, 2], [2, 3]] }, { cells: [[2, 1], [3, 2]] })).toEqual({ occupiedA: 2, occupiedB: 2, sharedTiles: 1, unionTiles: 3, jaccard: 1 / 3 });
  });
  it('does not fabricate overlap for empty worlds', () => {
    expect(overlap({ cells: [] }, { cells: [] })).toEqual({ occupiedA: 0, occupiedB: 0, sharedTiles: 0, unionTiles: 0, jaccard: 0 });
  });
  it('rejects historical and unscheduled seed identities before reading files', () => {
    expect(() => diagnostics(1201)).toThrow('replication seed');
    expect(() => diagnostics(1204)).toThrow('replication seed');
  });
  it('requires the canonical receipt file to exist', () => {
    const { root } = fixture({ missingReceipt: true });
    expect(() => diagnostics(1202, root)).toThrow();
  });
  it('requires the canonical visual receipt to be committed', () => {
    const { root } = fixture({ leaveReceiptUntracked: true });
    expect(() => diagnostics(1202, root)).toThrow(/already be committed unchanged/);
  });
  it('rejects a receipt changed after it was committed', () => {
    const { root, paths } = fixture(); writeFileSync(paths.receipt, `${readFileSync(paths.receipt, 'utf8')} `);
    expect(() => diagnostics(1202, root)).toThrow(/already be committed unchanged/);
  });
  it('requires pair manifest seed, plan, paths, arm hashes and decision to match', () => {
    for (const opts of [
      { manifestSeed: 1203 },
      { manifestPlanSha: '0'.repeat(64) },
      { manifestArmHash: 'uniform' },
      { decisionArmHash: 'uniformArtifactSha256' },
      { receiptUrl: 'moving-food-replication-visual-1202.json' },
    ]) {
      const { root } = fixture(opts);
      expect(() => diagnostics(1202, root)).toThrow(/manifest|decision|receipt/i);
    }
  });
  it('rejects receipt arm hashes that do not match the listed raw artifacts', () => {
    const { root } = fixture({ receiptArmHash: 'uniformArtifactSha256' });
    expect(() => diagnostics(1202, root)).toThrow(/receipt identity|observations mismatch/i);
  });
  it('rejects a receipt for a different seed even when all file hashes are resealed', () => {
    const { root } = fixture({ receiptSeed: 1203 });
    expect(() => diagnostics(1202, root)).toThrow(/receipt identity|observations mismatch/i);
  });
  it('requires visual receipt failures when matched-age frames are unavailable', () => {
    const truePass = fixture({ missingUniformTick: 1500 });
    expect(() => diagnostics(1202, truePass.root)).toThrow(/mark unavailable frame comparison at 1500 as failed/);
    const falsePass = fixture({ missingUniformTick: 1500, receiptPass: false });
    expect(diagnostics(1202, falsePass.root).overlapDiagnosticsAfterVisualReview[0]).toMatchObject({ tick: 1500, available: false });
  });
  it('requires a failed late-moving visual receipt when either endpoint frame is unavailable', () => {
    const truePass = fixture({ missingMovingTick: 3000 });
    expect(() => diagnostics(1202, truePass.root)).toThrow(/mark unavailable frame comparison at 3000 as failed/);
    const lateClaim = fixture({ missingMovingTick: 3000, receiptPass: false, latePass: true });
    expect(() => diagnostics(1202, lateClaim.root)).toThrow(/mark unavailable late moving comparison as failed/);
    const falsePass = fixture({ missingMovingTick: 3000, receiptPass: false, latePass: false });
    expect(diagnostics(1202, falsePass.root).overlapDiagnosticsAfterVisualReview[3]).toMatchObject({ comparison: 'moving-band-late', available: false });
  });
  it('accepts a committed SHA-bound receipt and emits diagnostics only from saved frames', () => {
    const { root, receiptText } = fixture();
    const result = diagnostics(1202, root);
    expect(result).toMatchObject({ seed: 1202, planSha256: PLAN_SHA, visualReceiptSha256: hash(receiptText) });
    expect(result.overlapDiagnosticsAfterVisualReview).toHaveLength(4);
    expect(result.overlapDiagnosticsAfterVisualReview[0]).toMatchObject({ comparison: 'uniform-vs-moving-band', tick: 1500, occupiedA: 2, occupiedB: 2 });
  });
});
