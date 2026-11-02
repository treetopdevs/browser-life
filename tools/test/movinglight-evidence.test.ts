import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sha256HexJS } from '@bl/schema';
import { CALIBRATION, EVIDENCE, LOCK, MANIFEST, REPO, checkFixtures, checkSaved, registryDigest, replayCheck, writeGuard } from '../movinglight/movinglight.ts';
import { PROTOCOL, protocolHash } from '../../packages/runner/src/movinglight/protocol.ts';
import * as lib from '../../packages/runner/src/movinglight/index.ts';
import * as schema from '../../packages/schema/src/index.ts';
import { sealPayload, verifySeal } from '../../packages/runner/src/movinglight/evidence.ts';

const sha = (b: string | Uint8Array) => sha256HexJS(typeof b === 'string' ? new TextEncoder().encode(b) : b);

describe('movinglight evidence tool', () => {
  it('--check passes on saved artifacts', async () => {
    expect(verifySeal(JSON.parse(readFileSync(EVIDENCE, 'utf8')))).toBe(true);
    expect(await checkSaved()).toEqual([]);
  });

  it('--check fails on a tampered evidence byte', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ml-'));
    try {
      const text = readFileSync(EVIDENCE, 'utf8');
      const i = text.indexOf('"capturePpm": ') + '"capturePpm": '.length;
      const tampered = text.slice(0, i) + (text[i] === '9' ? '8' : '9') + text.slice(i + 1);
      const evidence = join(root, 'e.json');
      writeFileSync(evidence, tampered);
      const problems = await checkSaved({ evidence, manifest: MANIFEST, calibration: CALIBRATION, lock: LOCK });
      expect(problems.join('\n')).toMatch(/integritySha256|payloadFileSha256|decision rules/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('manifest hashes match sources, and an edited source is detected', async () => {
    const m = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    for (const f of Object.keys(m.sources)) expect(m.sources[f], f).toBe(sha(readFileSync(REPO + f)));
    const root = mkdtempSync(join(tmpdir(), 'ml-src-'));
    try {
      for (const d of ['packages/runner/src/movinglight', 'packages/schema/src', 'packages/sim-ref/src', 'tools/movinglight', 'experiments/discovery']) cpSync(REPO + d, join(root, d), { recursive: true });
      writeFileSync(join(root, 'packages/runner/src/movinglight/decision.ts'), readFileSync(REPO + 'packages/runner/src/movinglight/decision.ts', 'utf8') + '\n// edit\n');
      const problems = await checkSaved({ evidence: EVIDENCE, manifest: MANIFEST, calibration: CALIBRATION, lock: LOCK }, root + '/');
      expect(problems.join('\n')).toMatch(/decision\.ts changed since the evidence was written/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('lock before write is required, and the lock precedes the evidence', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ml-lock-'));
    try {
      expect(() => writeGuard({ lock: join(root, 'none.json'), evidence: join(root, 'e.json') }, false)).toThrow(/no protocol.lock.json/);
      expect(() => writeGuard({ lock: LOCK, evidence: EVIDENCE }, false)).toThrow(/written once/);
      const lock = JSON.parse(readFileSync(LOCK, 'utf8'));
      expect(lock.protocolHash).toBe(JSON.parse(readFileSync(EVIDENCE, 'utf8')).protocolHash);
      expect(lock.protocolHash).toBe(protocolHash(await registryDigest(), PROTOCOL));
      expect(lock.calibrationSha256).toBe(sha(readFileSync(CALIBRATION)));
      expect(new Date(lock.frozenAt).getTime()).toBeLessThanOrEqual(new Date(JSON.parse(readFileSync(MANIFEST, 'utf8')).provenance.generatedAt).getTime());
      expect(existsSync(LOCK)).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('fixture inventory and expected outcomes are validated, even with the seals refreshed', async () => {
    const payload = JSON.parse(readFileSync(EVIDENCE, 'utf8'));
    const L = { ...lib, schema };
    expect(checkFixtures(L, payload)).toEqual([]);
    // Flipped physical outcome, flipped synthetic outcome, dropped fixture, flipped planted label: each is a problem.
    const flip = (f: (p: any) => void) => { const q = structuredClone(payload); f(q); return checkFixtures(L, q).join('\n'); };
    expect(flip((q) => { q.fixtures.physical[2].rejected = false; })).toMatch(/stationary-growth/);
    expect(flip((q) => { q.fixtures.physical[0].B[0] = 5; })).toMatch(/blind-drifters-physical/);
    expect(flip((q) => { q.fixtures.coordination[0].rejected = false; q.fixtures.coordination[0].label = 'coordination-detected'; })).toMatch(/common-forcing\/fixed/);
    expect(flip((q) => { q.fixtures.coordination.pop(); })).toMatch(/inventory/);
    expect(flip((q) => { q.fixtures.planted[0].verdict.label = 'inconclusive'; })).toMatch(/planted-benefit/);
    expect(flip((q) => { q.fixtures.physical[2].residual = q.fixtures.physical[2].residual.map(() => -1e12); })).toMatch(/stationary-growth/);
    // checkSaved with the payload reseal and the manifest refreshed still fails.
    const root = mkdtempSync(join(tmpdir(), 'ml-fx-'));
    try {
      const q = structuredClone(payload);
      q.fixtures.physical[1].rejected = false;
      const sealed = sealPayload((({ integritySha256, ...body }) => body)(q));
      const text = `${JSON.stringify(sealed, null, 1)}\n`;
      const evidence = join(root, 'e.json'), manifest = join(root, 'm.json');
      writeFileSync(evidence, text);
      writeFileSync(manifest, JSON.stringify({ ...JSON.parse(readFileSync(MANIFEST, 'utf8')), payloadFileSha256: sha(text), integritySha256: sealed.integritySha256 }));
      const problems = await checkSaved({ evidence, manifest, calibration: CALIBRATION, lock: LOCK });
      expect(problems.join('\n')).toMatch(/crowding-physical/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('--replay-check on the saved panel', async () => {
    expect(await replayCheck()).toEqual([]);
  }, 600_000);
});
