import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalJSON, seedCollisions, sha256HexJS } from '@bl/schema';
import { CALIBRATION, EVIDENCE, LOCK, MANIFEST, REGISTRY, REPO, checkSaved, registryDigest, sourceFiles } from '../niche/niche.ts';
import { PROTOCOL, protocolHash } from '../../packages/runner/src/niche/protocol.ts';
import { verifySeal, type Payload } from '../../packages/runner/src/niche/evidence.ts';
import { decideCandidates } from '../../packages/runner/src/niche/decision.ts';

const load = () => JSON.parse(readFileSync(EVIDENCE, 'utf8')) as Payload;
const sha = (b: string | Uint8Array) => sha256HexJS(typeof b === 'string' ? new TextEncoder().encode(b) : b);

describe('niche evidence', () => {
  it('evidence.json is sealed and verifies; the saved artifacts check out', async () => {
    expect(verifySeal(load())).toBe(true);
    expect(await checkSaved()).toEqual([]);
  });

  it('a tampered payload fails the seal and the manifest', async () => {
    const root = mkdtempSync(join(tmpdir(), 'niche-'));
    try {
      const paths = { evidence: join(root, 'e.json'), manifest: MANIFEST, calibration: CALIBRATION, lock: LOCK };
      const p = load() as any;
      p.fresh.candidates[0].input.delta = 1;
      writeFileSync(paths.evidence, JSON.stringify(p, null, 1) + '\n');
      const problems = await checkSaved(paths);
      expect(problems.join('\n')).toMatch(/integritySha256|payloadFileSha256|decision rules/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('manifest hashes match sources, and an edited source is detected', async () => {
    const m = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    for (const f of sourceFiles()) expect(m.sources[f], f).toBe(sha(readFileSync(REPO + f)));
    const root = mkdtempSync(join(tmpdir(), 'niche-src-'));
    try {
      for (const d of ['packages/runner/src/niche', 'packages/schema/src', 'packages/sim-ref/src', 'tools/niche', 'experiments/discovery']) cpSync(REPO + d, join(root, d), { recursive: true });
      writeFileSync(join(root, 'packages/runner/src/niche/decision.ts'), readFileSync(REPO + 'packages/runner/src/niche/decision.ts', 'utf8') + '\n// edit\n');
      const problems = await checkSaved({ evidence: EVIDENCE, manifest: MANIFEST, calibration: CALIBRATION, lock: LOCK }, root + '/');
      expect(problems.join('\n')).toMatch(/decision\.ts changed since the evidence was written/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('protocol hash precedes fresh results: the lock carries the hash, seeds and calibration digest', async () => {
    const lock = JSON.parse(readFileSync(LOCK, 'utf8'));
    const p = load();
    expect(lock.protocolHash).toBe(p.protocolHash);
    expect(lock.protocolHash).toBe(protocolHash(await registryDigest(), PROTOCOL));
    expect(lock.calibrationSha256).toBe(sha(readFileSync(CALIBRATION)));
    expect(new Date(lock.frozenAt).getTime()).toBeLessThanOrEqual(new Date(JSON.parse(readFileSync(MANIFEST, 'utf8')).provenance.generatedAt).getTime());
    expect(canonicalJSON(lock.seeds.fresh)).toBe(canonicalJSON(PROTOCOL.freshSeeds));
  });

  it('fresh and dev are reported separately and use disjoint seeds', () => {
    const p = load();
    expect(p.dev.purpose).toBe('calibration');
    expect(p.fresh.purpose).toBe('confirmation');
    const dev = new Set([...PROTOCOL.devSeeds, ...PROTOCOL.devReplicateSeeds, ...PROTOCOL.wallSeeds]);
    for (const s of PROTOCOL.freshSeeds) expect(dev.has(s)).toBe(false);
    for (const c of p.fresh.candidates) expect(c.blocks.map((b) => b.seed)).toEqual([...PROTOCOL.freshSeeds]);
    for (const c of p.dev.candidates) expect(c.blocks.map((b) => b.seed)).toEqual([...PROTOCOL.devSeeds]);
  });

  it('seed ranges do not collide with experiments/discovery/seed-registry.json (digest bound in the protocol)', async () => {
    const reg = JSON.parse(readFileSync(REGISTRY, 'utf8')).reservations as { first: number; last: number; owner: string }[];
    const all = [...PROTOCOL.devSeeds, ...PROTOCOL.devReplicateSeeds, ...PROTOCOL.wallSeeds, ...PROTOCOL.freshSeeds].map((seed, i) => ({ id: `s${i}`, seed }));
    expect(seedCollisions(all, reg.filter((r) => !r.owner.startsWith('i06 niche construction')), 'i06')).toEqual([]);
    const own = reg.find((r) => r.owner.startsWith('i06 niche construction'))!;
    for (const s of all) expect(s.seed >= own.first && s.seed <= own.last).toBe(true);
    expect(load().registryDigest).toBe(await registryDigest());
  });

  it('the decision follows the stated rules and every ledger is exactly zero', () => {
    const p = load();
    expect(decideCandidates(p.fresh.candidates.map((c) => c.input), p.dev.wall.positiveControlPassed)).toEqual(p.fresh.results);
    for (const c of [...p.dev.candidates, ...p.fresh.candidates]) for (const b of c.blocks) {
      expect(b.valid).toBe(true);
      for (const recs of Object.values(b.transfers)) for (const r of recs) expect([r.residual, r.matterResidual]).toEqual(['0', '0']);
    }
    for (const f of p.fixtures.reports) expect(f.id.length).toBeGreaterThan(0);
  });

  it('delta is the dev replicate floor and the payload carries no floats', () => {
    const p = load();
    for (const c of p.dev.candidates) expect(PROTOCOL.delta[String(c.cluster)]).toBe(c.deltaProposed);
    expect(() => canonicalJSON({ ...p, integritySha256: '' })).not.toThrow();
  });

  it('--check does not simulate', () => {
    const t0 = Date.now();
    const out = execFileSync(process.execPath, ['--no-warnings', 'tools/niche/niche.ts', '--check'], { cwd: REPO, encoding: 'utf8', env: { ...process.env, VITEST: '' } });
    expect(out).toContain('--check ok');
    expect(Date.now() - t0).toBeLessThan(40_000);
    void existsSync; void copyFileSync;
  });
});
