/** Saved-evidence only: no world construction or simulation. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PLAN_SHA256 = 'ba835f94fddbd48a823fb6264d3e4f9d8a815014c5bc5e4997fec56e6f7aaa51';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function overlap(a, b) {
  const occupiedA = new Set(a.cells.map((cell) => cell[0]));
  const occupiedB = new Set(b.cells.map((cell) => cell[0]));
  const sharedTiles = [...occupiedA].filter((tile) => occupiedB.has(tile)).length;
  const unionTiles = occupiedA.size + occupiedB.size - sharedTiles;
  return { occupiedA: occupiedA.size, occupiedB: occupiedB.size, sharedTiles, unionTiles,
    jaccard: sharedTiles / (unionTiles || 1) };
}

function jsonFile(path, label) {
  const raw = readFileSync(path);
  let value;
  try { value = JSON.parse(raw.toString('utf8')); }
  catch { throw new Error(`${label} is not valid JSON`); }
  return { raw, value };
}

function requireCommittedReceipt(root, path, raw) {
  let committed;
  try {
    committed = execFileSync('git', ['show', `HEAD:${relative(root, path)}`],
      { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    throw new Error('Visual receipt must already be committed unchanged');
  }
  if (!Buffer.from(raw).equals(committed)) throw new Error('Visual receipt must already be committed unchanged');
}

function validateReceipt(receipt, seed, index) {
  const keys = ['seed', 'planSha256', 'movingBandArtifactSha256', 'stationaryBandArtifactSha256',
    'withinArmChanges', 'sameAgeComparisons', 'visualReviewedBeforeOverlapDiagnostics', 'reviewedAtUTC'];
  const withinKeys = ['from', 'to', 'pass', 'observation'];
  const expectedComparisons = [1500, 2500, 3000];
  if (!receipt || Object.keys(receipt).some((key) => !keys.includes(key)) ||
    !same(Object.keys(receipt).sort(), [...keys].sort()) || receipt.seed !== seed ||
    receipt.planSha256 !== PLAN_SHA256 ||
    receipt.movingBandArtifactSha256 !== index.arms.movingBand.rawSha256 ||
    receipt.stationaryBandArtifactSha256 !== index.arms.stationaryBand.rawSha256 ||
    receipt.visualReviewedBeforeOverlapDiagnostics !== true ||
    typeof receipt.reviewedAtUTC !== 'string' || !receipt.reviewedAtUTC.trim() ||
    !receipt.withinArmChanges || Object.keys(receipt.withinArmChanges).sort().join('|') !== 'movingBand|stationaryBand' ||
    !Array.isArray(receipt.sameAgeComparisons) || !same(receipt.sameAgeComparisons.map((x) => x?.tick), expectedComparisons) ||
    receipt.sameAgeComparisons.some((x) => typeof x.observation !== 'string' || !x.observation.trim())) {
    throw new Error('Visual receipt identity or observations mismatch');
  }
  for (const arm of ['movingBand', 'stationaryBand']) {
    const entry = receipt.withinArmChanges[arm];
    if (!entry || Object.keys(entry).some((key) => !withinKeys.includes(key)) ||
      !same(Object.keys(entry).sort(), [...withinKeys].sort()) || entry.from !== 2500 || entry.to !== 3000 ||
      typeof entry.pass !== 'boolean' || typeof entry.observation !== 'string' || !entry.observation.trim()) {
      throw new Error(`Visual receipt ${arm} within-arm change mismatch`);
    }
  }
}

function validateIndex(index, seed, arms, receiptRaw) {
  const receiptUrl = `stationary-food-visual-receipt-${seed}.json`;
  if (!index || index.schemaVersion !== 1 || index.kind !== 'hungry-shapes-stationary-food-pair' ||
    index.seed !== seed || index.planSha256 !== PLAN_SHA256 ||
    !same(Object.keys(index).sort(), ['arms', 'decision', 'kind', 'planSha256', 'schemaVersion', 'seed']) ||
    !index.arms || Object.keys(index.arms).sort().join('|') !== 'movingBand|stationaryBand') {
    throw new Error('Stationary-food pair manifest identity mismatch');
  }
  const expected = [
    ['movingBand', index.arms.movingBand, 'moving-band'],
    ['stationaryBand', index.arms.stationaryBand, 'stationary-band'],
  ];
  for (const [key, entry, mode] of expected) {
    const bytes = arms[key];
    const file = `stationary-food-${mode}-seed-${seed}.json`;
    if (!entry || !same(Object.keys(entry).sort(), ['mode', 'rawSha256', 'url']) ||
      entry.mode !== mode || entry.url !== file || entry.rawSha256 !== sha256(bytes)) {
      throw new Error(`${mode} pair-manifest binding mismatch`);
    }
    const data = JSON.parse(bytes.toString('utf8'));
    if (data.run?.seed !== seed || data.run?.mode !== mode || data.provenance?.planSha256 !== PLAN_SHA256) {
      throw new Error(`${mode} arm seed, mode, or plan binding mismatch`);
    }
  }
  const decision = index.decision;
  const common = ['status', 'summary', 'movingBandArtifactSha256', 'stationaryBandArtifactSha256'];
  const final = ['visualReceiptUrl', 'visualReceiptSha256'];
  const status = decision?.status;
  const expectedKeys = status === 'pending' ? common : [...common, ...final];
  if (!decision || !['pending', 'both', 'moving-only', 'stationary-only', 'neither'].includes(status) ||
    !same(Object.keys(decision).sort(), [...expectedKeys].sort()) ||
    typeof decision.summary !== 'string' || !decision.summary.trim() ||
    decision.movingBandArtifactSha256 !== index.arms.movingBand.rawSha256 ||
    decision.stationaryBandArtifactSha256 !== index.arms.stationaryBand.rawSha256 ||
    (status !== 'pending' && (decision.visualReceiptUrl !== receiptUrl || decision.visualReceiptSha256 !== sha256(receiptRaw)))) {
    throw new Error('Pair decision must bind both arms and, when accepted, the canonical committed visual receipt');
  }
}

function validateFinalDecision(index, arms, receipt, receiptRaw) {
  const decision = index.decision;
  if (decision.status === 'pending') throw new Error('Overlap diagnostics require a final pair decision');
  const moving = JSON.parse(arms.movingBand.toString('utf8'));
  const stationary = JSON.parse(arms.stationaryBand.toString('utf8'));
  const movingPass = moving.numericalGate?.numericalPass === true && receipt.withinArmChanges.movingBand.pass;
  const stationaryPass = stationary.numericalGate?.numericalPass === true && receipt.withinArmChanges.stationaryBand.pass;
  const expectedStatus = movingPass ? (stationaryPass ? 'both' : 'moving-only') : (stationaryPass ? 'stationary-only' : 'neither');
  if (decision.status !== expectedStatus) {
    throw new Error(`Pair decision status mismatch: expected ${expectedStatus} from arm numerical and visual pass flags`);
  }
}

function frame(arm, tick) {
  const matches = arm.frames.filter((item) => item.tick === tick);
  return matches.length === 1 ? matches[0] : undefined;
}

export function diagnostics(seed, root = ROOT) {
  if (seed !== 1202) throw new Error('Only stationary-food seed 1202 is permitted');
  const docs = resolve(root, 'docs/creative-prototypes');
  const indexPath = resolve(docs, 'stationary-food-index-1202.json');
  const { value: index } = jsonFile(indexPath, 'Stationary-food pair manifest');
  const armBytes = {
    movingBand: readFileSync(resolve(docs, 'stationary-food-moving-band-seed-1202.json')),
    stationaryBand: readFileSync(resolve(docs, 'stationary-food-stationary-band-seed-1202.json')),
  };
  const receiptPath = resolve(docs, 'stationary-food-visual-receipt-1202.json');
  const { raw: receiptRaw, value: receipt } = jsonFile(receiptPath, 'Visual receipt');
  requireCommittedReceipt(root, receiptPath, receiptRaw);
  validateIndex(index, seed, armBytes, receiptRaw);
  validateReceipt(receipt, seed, index);
  validateFinalDecision(index, armBytes, receipt, receiptRaw);
  const [movingBand, stationaryBand] = [
    JSON.parse(armBytes.movingBand.toString('utf8')),
    JSON.parse(armBytes.stationaryBand.toString('utf8')),
  ];
  for (const armName of ['movingBand', 'stationaryBand']) {
    const arm = armName === 'movingBand' ? movingBand : stationaryBand;
    const change = receipt.withinArmChanges[armName];
    if (change.pass && (!frame(arm, 2500) || !frame(arm, 3000))) {
      throw new Error(`Visual receipt must mark unavailable ${armName} within-arm frames as failed`);
    }
  }
  const sameAge = [1500, 2500, 3000].map((tick) => {
    const a = frame(movingBand, tick), b = frame(stationaryBand, tick);
    if (!a || !b) return { comparison: 'moving-band-vs-stationary-band', tick, available: false };
    return { comparison: 'moving-band-vs-stationary-band', tick, ...overlap(a, b) };
  });
  const withinArm = ['movingBand', 'stationaryBand'].map((armName) => {
    const arm = armName === 'movingBand' ? movingBand : stationaryBand;
    const a = frame(arm, 2500), b = frame(arm, 3000);
    if (!a || !b) return { comparison: `${armName}-within-arm`, from: 2500, to: 3000, available: false };
    return { comparison: `${armName}-within-arm`, from: 2500, to: 3000, ...overlap(a, b) };
  });
  return { seed, planSha256: PLAN_SHA256, visualReceiptSha256: sha256(receiptRaw),
    overlapDiagnosticsAfterVisualReview: [...sameAge, ...withinArm] };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3) throw new Error('Usage: node tools/stationary-food-diagnostics.mjs 1202');
  process.stdout.write(`${JSON.stringify(diagnostics(Number(process.argv[2])), null, 2)}\n`);
}
