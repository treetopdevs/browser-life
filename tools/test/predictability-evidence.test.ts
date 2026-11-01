import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { RULE_VERSION, defaultConfig, stateHash, initWorld } from '@bl/schema';
import { RefSim } from '@bl/sim-ref';
import { checkSaved, EVIDENCE, MANIFEST, REPO, replayCheck, sourceFiles } from '../predictability/atlas.ts';
import { relabel, verifySeal, canonical, sha256, type Payload } from '../../packages/metrics/src/predictability/atlas.ts';
import { ECOLOGY, ecologyClip, ecologyConfig, ecologyInit } from '../../packages/metrics/src/predictability/ecology.ts';

const saved = (): Payload => JSON.parse(readFileSync(EVIDENCE, 'utf8'));

describe('predictability evidence', () => {
  it('evidence seal and manifest verify', () => {
    expect(checkSaved()).toEqual([]);
    const p = saved();
    expect(verifySeal(p)).toBe(true);
    expect(p.statements).toEqual(['CPU only', 'no GPU evidence', 'no score here selected anything']);
    expect(p.deferredGaps.some((g) => g.includes('false-alarm'))).toBe(true);
    expect(JSON.stringify(p)).not.toMatch(/generatedAt|platform|darwin|linux/);
    expect(p.fixtures).toHaveLength(10);
  });

  it('a tampered payload, manifest or source is rejected', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pred-'));
    const ev = join(dir, 'evidence.json'), mf = join(dir, 'manifest.json');
    const p = saved();
    p.labels['random-bits'].label = 'exact';
    writeFileSync(ev, JSON.stringify(p, null, 1) + '\n');
    copyFileSync(MANIFEST, mf);
    const problems = checkSaved(ev, mf);
    expect(problems.some((x) => x.includes('integritySha256'))).toBe(true);
    // a source tree with one changed file
    const root = join(dir, 'root') + '/';
    for (const f of sourceFiles()) { mkdirSync(dirname(root + f), { recursive: true }); copyFileSync(REPO + f, root + f); }
    writeFileSync(root + 'tools/predictability/atlas.ts', readFileSync(REPO + 'tools/predictability/atlas.ts', 'utf8') + '\n// edit\n');
    expect(checkSaved(EVIDENCE, MANIFEST, root).some((x) => x.includes('changed since'))).toBe(true);
    // an upstream input the ecology clip reads (here the presets) is covered by the source hashes too
    copyFileSync(REPO + 'tools/predictability/atlas.ts', root + 'tools/predictability/atlas.ts');
    expect(checkSaved(EVIDENCE, MANIFEST, root)).toEqual([]);
    expect(sourceFiles()).toContain('packages/schema/src/presets.ts');
    expect(sourceFiles()).toContain('packages/sim-ref/src/step.ts');
    writeFileSync(root + 'packages/schema/src/presets.ts', readFileSync(REPO + 'packages/schema/src/presets.ts', 'utf8').replace('biomass: 64', 'biomass: 65') + '\n// edit\n');
    expect(checkSaved(EVIDENCE, MANIFEST, root).some((x) => x.includes('presets.ts changed since'))).toBe(true);
    copyFileSync(REPO + 'packages/schema/src/presets.ts', root + 'packages/schema/src/presets.ts');
    // a source file added after the evidence was written is reported
    writeFileSync(root + 'packages/metrics/src/predictability/extra.ts', 'export const x = 1;\n');
    expect(checkSaved(EVIDENCE, MANIFEST, root).some((x) => x.includes('extra.ts is not in the manifest'))).toBe(true);
  });

  it('labels follow stated rules only', () => {
    const p = saved();
    const again = relabel(p);
    for (const [id, rec] of Object.entries(p.labels)) expect(again[id]).toBe(rec.label);
  });

  it('replay reproduces byte for byte', async () => {
    expect(await replayCheck()).toEqual([]);
  }, 180_000);

  it('the CLI check runs as a subprocess', () => {
    const out = execFileSync(process.execPath, ['--no-warnings', 'tools/predictability/atlas.ts', '--check'], { cwd: REPO, encoding: 'utf8' });
    expect(out).toContain('--check ok');
  }, 60_000);

  it('ecology clip is a plain RefSim read', () => {
    const hashes: string[] = [];
    let cellsBuffer: ArrayBufferLike | undefined;
    const clip = ecologyClip((sim) => { hashes.push(stateHash(sim.state)); cellsBuffer = sim.state.cells.buffer; });
    // an independent twin: separate cfg object and buffers, stepped with no observation at all
    const cfg = ecologyConfig();
    const twin = new RefSim(initWorld(cfg, ecologyInit()));
    const plain: string[] = [stateHash(twin.state)];
    for (let k = 1; k < ECOLOGY.frames; k++) { twin.run(ECOLOGY.stride); plain.push(stateHash(twin.state)); }
    expect(hashes).toEqual(plain);
    for (const f of clip.frames) expect(f.buffer).not.toBe(cellsBuffer);
    // copied frames match a fresh clip after the sim has moved on
    const again = ecologyClip();
    for (let k = 0; k < clip.frames.length; k++) expect(clip.frames[k]).toEqual(again.frames[k]);
  }, 120_000);

  it('no physics pin touched', () => {
    expect(RULE_VERSION).toBe(1);
    expect(createHash('sha256').update(JSON.stringify(defaultConfig())).digest('hex')).toBe('f1b7cbe54e81cbc463f8b5400ffd754b413570bc18283c0920a9719c1287bfc2');
    expect(canonical({ b: 1, a: [2] })).toBe('{"a":[2],"b":1}');
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
