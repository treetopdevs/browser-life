import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RULES } from '../../apps/lab/src/stationary-food/model.ts';
import {
  FIXED_SNAPSHOTS, LOADED_SOURCE_SHA256, assertPinnedInputs, baselineData, parseArgs,
  STATIONARY_FOOD_REPLICATION_PLAN_SHA256, validateEvidenceStructure, validateHistoricalIndexBinding, validatePrefixRecord,
} from '../stationary-food-replication/explore.ts';

type R = Record<string, any>;
const artifactPath = (seed: 1201 | 1203) => seed === 1201
  ? '../../docs/creative-prototypes/moving-food-moving-band-seed-1201.json'
  : '../../docs/creative-prototypes/moving-food-replication-moving-band-seed-1203.json';
const indexPath = (seed: 1201 | 1203) => seed === 1201
  ? '../../docs/creative-prototypes/moving-food-index.json'
  : '../../docs/creative-prototypes/moving-food-replication-index-1203.json';
function reference(seed: 1201 | 1203): R { return baselineData(seed); }
function proof(reference: R): R {
  return {
    status: 'verified', seed: reference.run.seed,
    normalization: 'none; exact historical moving-band payload; no normalization',
    comparedSamples: 151, comparedFrames: 151, comparedTickRows: 3_000, comparedSnapshots: 5,
    checkpoints: reference.snapshots.map((snapshot: R) => ({ tick: snapshot.tick, stateSha256: snapshot.stateSha256, compared: true })),
  };
}
function regressionRecord(prior: R): R {
  return {
    run: structuredClone(prior.run), rules: structuredClone(prior.rules),
    samples: structuredClone(prior.samples), tickRows: structuredClone(prior.tickRows),
    frames: structuredClone(prior.frames), snapshots: structuredClone(prior.snapshots),
    windows: structuredClone(prior.windows), final: structuredClone(prior.final),
    repeat: structuredClone(prior.repeat), numericalGate: structuredClone(prior.numericalGate),
    provenance: { prefix: proof(prior) },
  };
}
function seal<T extends R>(data: T): T {
  const copy = structuredClone(data); delete copy.dataSha256;
  data.dataSha256 = createHash('sha256').update(JSON.stringify(copy)).digest('hex');
  return data;
}
function validFullRecord(seed: 1201 | 1203): R {
  const prior = reference(seed);
  const baseline = seed === 1201
    ? { artifact: '46017d1db1eaf1ff85b8cc51d92533d928aeac18b3e7cf261a82bb9d0d0816bf', data: 'd72aca82bdce496b59fcc8f6e10d1576a3b91b6e3931a209c1af0640c93f61c8' }
    : { artifact: '8ce7be228812002e2d03a2f68a15b9d1107e6fff022006ae9059003bb66e0c9b', data: 'eb8a0985950d5de4450b1a911bd602761644a3adb96a9bd8265c5fd1e5af572e' };
  const result = structuredClone(prior);
  result.kind = 'hungry-shapes-stationary-food-replication-arm';
  result.provenance = {
    sourceSha256: LOADED_SOURCE_SHA256,
    planSha256: STATIONARY_FOOD_REPLICATION_PLAN_SHA256,
    baselineArtifactSha256: baseline.artifact,
    baselineDataSha256: baseline.data,
    prefix: proof(prior),
  };
  return seal(result);
}

describe('stationary-food replication evidence primitives', () => {
  it('pins both frozen historical generations and accepts only seeds 1201 and 1203', () => {
    expect(() => assertPinnedInputs()).not.toThrow();
    expect(LOADED_SOURCE_SHA256['apps/lab/src/stationary-food/model.ts']).toBe('7bd5af02243cb0629547a20d889a05cd904246a16227f58df4e420edc84a859f');
    expect(LOADED_SOURCE_SHA256['tools/stationary-food/explore.ts']).toBe('ab692de5ede5ece9cfdc1af8d0e44c651a0bc30ff8aa6493b35e6a02672250f6');
    expect(LOADED_SOURCE_SHA256['docs/creative-prototypes/stationary-food-replication-plan.md']).toBe('74dc68201c7fb51ed9a87ba75d13e0ad79b171ff0d73d7929af4ba4f03fa114a');
    expect(parseArgs(['--write', '--seed', '1201'])).toEqual({ mode: '--write', seed: 1201 });
    expect(parseArgs(['--check', '--seed', '1203'])).toEqual({ mode: '--check', seed: 1203 });
    for (const seed of ['1202', '1204']) expect(() => parseArgs(['--check', '--seed', seed])).toThrow(/frozen to seeds 1201 and 1203/);
    expect(() => parseArgs(['--check', '--replay-check', '--seed', '1201'])).toThrow(/exactly one/);
  });

  it.each([1201, 1203] as const)('loads seed %i through its own historical arm and index schema', (seed) => {
    const data = reference(seed);
    const index = JSON.parse(readFileSync(new URL(indexPath(seed), import.meta.url), 'utf8')) as R;
    const bytes = readFileSync(new URL(artifactPath(seed), import.meta.url));
    expect(data.run.seed).toBe(seed);
    expect(data.run.mode).toBe('moving-band');
    expect(data.samples).toHaveLength(151);
    expect(data.frames).toHaveLength(151);
    expect(data.tickRows).toHaveLength(3_000);
    expect(data.snapshots.map((snapshot: R) => snapshot.tick)).toEqual(FIXED_SNAPSHOTS);
    expect(index.seed).toBe(seed);
    expect(index.arms.movingBand.rawSha256).toBe(data.dataSha256 === 'd72aca82bdce496b59fcc8f6e10d1576a3b91b6e3931a209c1af0640c93f61c8'
      ? '46017d1db1eaf1ff85b8cc51d92533d928aeac18b3e7cf261a82bb9d0d0816bf'
      : '8ce7be228812002e2d03a2f68a15b9d1107e6fff022006ae9059003bb66e0c9b');
    if (seed === 1201) expect(data.provenance).not.toHaveProperty('planSha256');
    else expect(data.provenance.planSha256).toBe('72f651acc7f221991b0ce89f7264eed9dd47df54e955d3d164406b4d0a17cc47');
    expect(bytes.length).toBeGreaterThan(0);
  });

  it.each([1201, 1203] as const)('fully validates a correctly pinned seed %i historical wrapper and rejects resealed identity/provenance/gate contradictions', (seed) => {
    const valid = validFullRecord(seed);
    expect(() => validateEvidenceStructure(valid)).not.toThrow();

    const wrongSeed = structuredClone(valid);
    wrongSeed.run.seed = seed === 1201 ? 1203 : 1201;
    seal(wrongSeed);
    expect(() => validateEvidenceStructure(wrongSeed)).toThrow(/plan\/baseline identity mismatch|historical moving-band regression mismatch|prefix proof/);

    const wrongReference = structuredClone(valid);
    wrongReference.provenance.baselineArtifactSha256 = '0'.repeat(64);
    seal(wrongReference);
    expect(() => validateEvidenceStructure(wrongReference)).toThrow(/plan\/baseline identity mismatch/);

    const wrongSource = structuredClone(valid);
    wrongSource.provenance.sourceSha256['apps/lab/src/moving-food/model.ts'] = '0'.repeat(64);
    seal(wrongSource);
    expect(() => validateEvidenceStructure(wrongSource)).toThrow(/stale source hash|source pin mismatch/);

    const wrongGate = structuredClone(valid);
    wrongGate.numericalGate.numericalPass = !wrongGate.numericalGate.numericalPass;
    seal(wrongGate);
    expect(() => validateEvidenceStructure(wrongGate)).toThrow(/numerical gate mismatch/);
  });

  it('validates accepted raw-arm bindings and rejects wrong historical index seed or arm hash', () => {
    for (const seed of [1201, 1203] as const) {
      const index = JSON.parse(readFileSync(new URL(indexPath(seed), import.meta.url), 'utf8')) as R;
      const raw = reference(seed).provenance.sourceSha256; // source map remains evidence-only; index binding checks the arm SHA.
      expect(raw['apps/lab/src/moving-food/model.ts']).toBe(LOADED_SOURCE_SHA256['apps/lab/src/moving-food/model.ts']);
      expect(() => validateHistoricalIndexBinding(seed, index, index.arms.movingBand.rawSha256)).not.toThrow();
      const wrongSeed = structuredClone(index); wrongSeed.seed = seed === 1201 ? 1203 : 1201;
      expect(() => validateHistoricalIndexBinding(seed, wrongSeed, index.arms.movingBand.rawSha256)).toThrow(/identity mismatch/);
      const wrongArm = structuredClone(index); wrongArm.arms.movingBand.rawSha256 = '0'.repeat(64);
      expect(() => validateHistoricalIndexBinding(seed, wrongArm, index.arms.movingBand.rawSha256)).toThrow(/binding mismatch/);
    }
  });

  it.each([1201, 1203] as const)('compares every historical payload field exactly for seed %i', (seed) => {
    const prior = reference(seed); const record = regressionRecord(prior);
    expect(() => validatePrefixRecord(record, prior)).not.toThrow();
    const fields = ['run', 'rules', 'samples', 'tickRows', 'frames', 'snapshots', 'windows', 'final', 'repeat', 'numericalGate'] as const;
    for (const field of fields) {
      const changed = structuredClone(record);
      switch (field) {
        case 'run': changed.run.finalTick--; break;
        case 'rules': changed.rules.maxHistory++; break;
        case 'samples': changed.samples[50].environment.offered++; break;
        case 'tickRows': changed.tickRows[2_999].cells++; break;
        case 'frames': changed.frames[50].foodBase64 = 'AA=='; break;
        case 'snapshots': changed.snapshots.find((s: R) => s.tick === 2_500).state.food[0]++; break;
        case 'windows': changed.windows[0].births++; break;
        case 'final': changed.final.census.population++; break;
        case 'repeat': changed.repeat.frameChecks++; break;
        case 'numericalGate': changed.numericalGate.numericalPass = !changed.numericalGate.numericalPass; break;
      }
      expect(() => validatePrefixRecord(changed, prior), `field ${field}`).toThrow(`historical moving-band regression mismatch in ${field}`);
    }
    const falseProof = structuredClone(record);
    falseProof.provenance.prefix.comparedSamples = 150;
    expect(() => validatePrefixRecord(falseProof, prior)).toThrow(/historical prefix proof missing/);
  });

  it('requires the stationary arm to declare no moving-reference prefix', () => {
    const record = { run: { mode: 'stationary-band' }, provenance: { prefix: {
      status: 'not-applicable', seed: null, normalization: 'none; stationary-band has no moving-reference prefix',
      comparedSamples: 0, comparedFrames: 0, comparedTickRows: 0, comparedSnapshots: 0, checkpoints: [],
    } } };
    expect(() => validatePrefixRecord(record as R, {})).not.toThrow();
    const wrong = structuredClone(record); wrong.provenance.prefix.comparedFrames = 151;
    expect(() => validatePrefixRecord(wrong as R, {})).toThrow(/stationary-band prefix must be not-applicable/);
  });

  it('keeps the copied rules frozen at the historical history capacity', () => {
    expect(RULES.maxHistory).toBe(451);
    expect(reference(1201).rules).toEqual(reference(1203).rules);
  });
});
