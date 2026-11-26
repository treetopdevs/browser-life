/** Saved-evidence only: no world construction or simulation. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PLAN_SHA256 = '6ae73fea19692f95e50538fecdc4203d89cf7ec5687ee38b6f580a57d94a005a';
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

function requireSuccessfulCheckOnly(root, seed) {
  const runner = resolve(root, 'tools/food-band-longevity-replication/explore.ts');
  try {
    execFileSync(process.execPath,
      ['--experimental-strip-types', runner, '--check', '--seed', String(seed)],
      { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    const detail = error?.stderr?.toString('utf8').trim() || error?.stdout?.toString('utf8').trim();
    throw new Error(`Food-band longevity replication runner check-only validation failed${detail ? `: ${detail}` : ''}`);
  }
}

function validateReceipt(receipt, seed, index) {
  const keys = ['seed', 'planSha256', 'movingBandArtifactSha256', 'stationaryBandArtifactSha256',
    'withinArmChanges', 'sameAgeComparisons', 'visualReviewedBeforeOverlapDiagnostics', 'reviewedAtUTC'];
  const withinKeys = ['from', 'to', 'pass', 'observation'];
  const expectedComparisons = [3000, 5500, 6000];
  if (!receipt || Object.keys(receipt).some((key) => !keys.includes(key)) ||
    !same(Object.keys(receipt).sort(), [...keys].sort()) || receipt.seed !== seed ||
    receipt.planSha256 !== PLAN_SHA256 ||
    receipt.movingBandArtifactSha256 !== index.arms.movingBand.rawSha256 ||
    receipt.stationaryBandArtifactSha256 !== index.arms.stationaryBand.rawSha256 ||
    receipt.visualReviewedBeforeOverlapDiagnostics !== true ||
    typeof receipt.reviewedAtUTC !== 'string' || !receipt.reviewedAtUTC.trim() ||
    !receipt.withinArmChanges || Object.keys(receipt.withinArmChanges).sort().join('|') !== 'movingBand|stationaryBand' ||
    !Array.isArray(receipt.sameAgeComparisons) || !same(receipt.sameAgeComparisons.map((x) => x?.tick), expectedComparisons) ||
    receipt.sameAgeComparisons.some((x) => !x || !same(Object.keys(x).sort(), ['observation', 'tick']) ||
      typeof x.observation !== 'string' || !x.observation.trim())) {
    throw new Error('Visual receipt identity or observations mismatch');
  }
  const observations = [
    ...Object.values(receipt.withinArmChanges).map((entry) => entry?.observation),
    ...receipt.sameAgeComparisons.map((entry) => entry?.observation),
  ].join(' ');
  if (!/not blind|non.?blind/i.test(observations) || !/historical (?:moving )?media/i.test(observations)) {
    throw new Error('Visual receipt observations must state that the rejudgment is not blind because historical media exist');
  }
  if (!/knows both seeds['’]? numerical outcomes/i.test(observations)) {
    throw new Error('Visual receipt observations must state awareness of both seeds’ numerical outcomes');
  }
  for (const arm of ['movingBand', 'stationaryBand']) {
    const entry = receipt.withinArmChanges[arm];
    if (!entry || Object.keys(entry).some((key) => !withinKeys.includes(key)) ||
      !same(Object.keys(entry).sort(), [...withinKeys].sort()) || entry.from !== 5500 || entry.to !== 6000 ||
      typeof entry.pass !== 'boolean' || typeof entry.observation !== 'string' || !entry.observation.trim()) {
      throw new Error(`Visual receipt ${arm} within-arm change mismatch`);
    }
  }
}

function validateIndex(index, seed, arms, receiptRaw) {
  const receiptUrl = `food-band-longevity-replication-visual-receipt-${seed}.json`;
  if (!index || index.schemaVersion !== 1 || index.kind !== 'hungry-shapes-food-band-longevity-replication-pair' ||
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
    const file = `food-band-longevity-replication-${mode}-seed-${seed}.json`;
    if (!entry || !same(Object.keys(entry).sort(), ['mode', 'rawSha256', 'url']) ||
      entry.mode !== mode || entry.url !== file || entry.rawSha256 !== sha256(bytes)) {
      throw new Error(`${mode} pair-manifest binding mismatch`);
    }
    const data = JSON.parse(bytes.toString('utf8'));
    if (data.kind !== 'hungry-shapes-food-band-longevity-replication-arm' || data.run?.seed !== seed ||
      data.run?.mode !== mode || data.run?.maxTick !== 6000 ||
      !Number.isSafeInteger(data.run?.finalTick) || data.run.finalTick < 3000 || data.run.finalTick > 6000 ||
      !(data.run?.extinctionTick === null || (Number.isSafeInteger(data.run.extinctionTick) && data.run.extinctionTick === data.run.finalTick)) ||
      (data.run.extinctionTick === null && data.run.finalTick !== 6000) ||
      typeof data.numericalGate?.numericalPass !== 'boolean' || data.provenance?.planSha256 !== PLAN_SHA256 ||
      !Array.isArray(data.frames) || data.frames.some((saved) => !Number.isSafeInteger(saved.tick) || saved.tick > data.run.finalTick)) {
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
    throw new Error('Replication pair decision must bind both arms and, when accepted, the canonical committed visual receipt');
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
  if (seed !== 1202 && seed !== 1203) throw new Error('Only food-band-longevity-replication seeds 1202 and 1203 are permitted');
  const docs = resolve(root, 'docs/creative-prototypes');
  const indexPath = resolve(docs, `food-band-longevity-replication-index-${seed}.json`);
  const { value: index } = jsonFile(indexPath, 'Stationary-food pair manifest');
  const armBytes = {
    movingBand: readFileSync(resolve(docs, `food-band-longevity-replication-moving-band-seed-${seed}.json`)),
    stationaryBand: readFileSync(resolve(docs, `food-band-longevity-replication-stationary-band-seed-${seed}.json`)),
  };
  const receiptPath = resolve(docs, `food-band-longevity-replication-visual-receipt-${seed}.json`);
  const { raw: receiptRaw, value: receipt } = jsonFile(receiptPath, 'Visual receipt');
  requireCommittedReceipt(root, receiptPath, receiptRaw);
  validateIndex(index, seed, armBytes, receiptRaw);
  validateReceipt(receipt, seed, index);
  validateFinalDecision(index, armBytes, receipt, receiptRaw);
  requireSuccessfulCheckOnly(root, seed);
  const [movingBand, stationaryBand] = [
    JSON.parse(armBytes.movingBand.toString('utf8')),
    JSON.parse(armBytes.stationaryBand.toString('utf8')),
  ];
  const lateTicks = [5500, 6000];
  for (const armName of ['movingBand', 'stationaryBand']) {
    const arm = armName === 'movingBand' ? movingBand : stationaryBand;
    const change = receipt.withinArmChanges[armName];
    for (const tick of lateTicks) {
      const saved = frame(arm, tick);
      if (change.pass && !saved) {
        throw new Error(`Visual receipt must mark unavailable ${armName} within-arm frames as failed`);
      }
      if (!saved && (arm.run.extinctionTick === null || tick <= arm.run.finalTick)) {
        throw new Error(`Missing ${armName} frame at ${tick} is not explained by actual terminal extinction`);
      }
    }
  }
  const sameAge = [3000, 5500, 6000].map((tick) => {
    const a = frame(movingBand, tick), b = frame(stationaryBand, tick);
    for (const [name, arm, saved] of [['movingBand', movingBand, a], ['stationaryBand', stationaryBand, b]]) {
      if (!saved && (arm.run.extinctionTick === null || tick <= arm.run.finalTick)) {
        throw new Error(`Missing ${name} frame at ${tick} is not explained by actual terminal extinction`);
      }
    }
    if (!a || !b) return { comparison: 'moving-band-vs-stationary-band', tick, available: false };
    return { comparison: 'moving-band-vs-stationary-band', tick, ...overlap(a, b) };
  });
  const withinArm = ['movingBand', 'stationaryBand'].map((armName) => {
    const arm = armName === 'movingBand' ? movingBand : stationaryBand;
    const a = frame(arm, 5500), b = frame(arm, 6000);
    if (!a || !b) return { comparison: `${armName}-within-arm`, from: 5500, to: 6000, available: false };
    return { comparison: `${armName}-within-arm`, from: 5500, to: 6000, ...overlap(a, b) };
  });
  return { seed, planSha256: PLAN_SHA256, visualReceiptSha256: sha256(receiptRaw),
    overlapDiagnosticsAfterVisualReview: [...sameAge, ...withinArm] };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3) throw new Error('Usage: node tools/food-band-longevity-replication-diagnostics.mjs 1202|1203');
  process.stdout.write(`${JSON.stringify(diagnostics(Number(process.argv[2])), null, 2)}\n`);
}
