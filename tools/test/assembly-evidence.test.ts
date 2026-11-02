import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { RULE_VERSION, defaultConfig, stateHash, initWorld } from '@bl/schema';
import { RefSim } from '@bl/sim-ref';
import { BASE_COMMIT, checkFreeze, checkPins, checkSaved, EVIDENCE, MANIFEST, REPO, replayCheck, sourceFiles } from '../assembly/observer.ts';
import { canonical, verifySeal, type Payload } from '../../packages/metrics/src/assembly/observer.ts';
import { PROTOCOL } from '../../packages/metrics/src/assembly/protocol.ts';
import { clipFrames, clipConfig } from '../../packages/metrics/src/assembly/clips.ts';
import { ecologyClip } from '../../packages/metrics/src/predictability/ecology.ts';

const saved = (): Payload => JSON.parse(readFileSync(EVIDENCE, 'utf8'));
const sha = (b: string | Uint8Array) => createHash('sha256').update(b).digest('hex');
const DOCS = 'docs/assembly-observer-2026-11-02/';
const BASE_COMMIT_FULL = () => execFileSync('git', ['rev-parse', BASE_COMMIT], { cwd: REPO, encoding: 'utf8' }).trim();

describe('assembly evidence', () => {
  it('evidence seal and manifest verify', () => {
    expect(checkSaved()).toEqual([]);
    const p = saved();
    expect(verifySeal(p)).toBe(true);
    expect(p.calibration).toHaveLength(13);
    for (const c of p.calibration) {
      expect(c.replicates).toHaveLength(PROTOCOL.replicates);
      for (const r of c.replicates) expect(r.meta.occupied + r.meta.padding).toBe(PROTOCOL.patch.mass);
    }
    expect(p.fixtures).toHaveLength(9);
    expect(p.clips).toHaveLength(3);
  });

  it('a tampered payload, manifest or source is rejected', () => {
    const dir = mkdtempSync(join(tmpdir(), 'asm-'));
    const ev = join(dir, 'evidence.json'), mf = join(dir, 'manifest.json');
    const p = saved();
    p.verdicts.sharedBound.verdict = 'fails to separate';
    writeFileSync(ev, JSON.stringify(p, null, 1) + '\n');
    copyFileSync(MANIFEST, mf);
    expect(checkSaved(ev, mf).some((x) => x.includes('integritySha256'))).toBe(true);
    const root = join(dir, 'root') + '/';
    for (const f of sourceFiles()) { mkdirSync(dirname(root + f), { recursive: true }); copyFileSync(REPO + f, root + f); }
    writeFileSync(root + 'tools/assembly/observer.ts', readFileSync(REPO + 'tools/assembly/observer.ts', 'utf8') + '\n// edit\n');
    expect(checkSaved(EVIDENCE, MANIFEST, root).some((x) => x.includes('changed since'))).toBe(true);
    copyFileSync(REPO + 'tools/assembly/observer.ts', root + 'tools/assembly/observer.ts');
    expect(checkSaved(EVIDENCE, MANIFEST, root)).toEqual([]);
    expect(sourceFiles()).toContain('packages/schema/src/presets.ts');
    expect(sourceFiles()).toContain('packages/sim-ref/src/step.ts');
    writeFileSync(root + 'packages/metrics/src/assembly/extra.ts', 'export const x = 1;\n');
    expect(checkSaved(EVIDENCE, MANIFEST, root).some((x) => x.includes('extra.ts is not in the manifest'))).toBe(true);
    // a verdict that does not follow from the rows is caught even with a re-sealed payload
    const forged = saved();
    forged.verdicts.sharedBound.verdict = 'fails to separate';
    const sealedBody = { ...forged }; delete sealedBody.integritySha256;
    forged.integritySha256 = sha(canonical(sealedBody));
    const ev2 = join(dir, 'evidence2.json');
    writeFileSync(ev2, JSON.stringify(forged, null, 1) + '\n');
    if (forged.verdicts.sharedBound.verdict !== saved().verdicts.sharedBound.verdict) {
      expect(checkSaved(ev2, mf).some((x) => x.includes('frozen rule'))).toBe(true);
    }
  });

  it('replay reproduces byte for byte', async () => {
    expect(await replayCheck()).toEqual([]);
  }, 900_000);

  it('subprocess smoke: --check', () => {
    const out = execFileSync('node', ['tools/assembly/observer.ts', '--check'], { cwd: REPO, encoding: 'utf8' });
    expect(out).toContain('--check ok');
  }, 60_000);

  it('protocol constants equal PROTOCOL.md', () => {
    const md = readFileSync(`${REPO}${DOCS}PROTOCOL.md`, 'utf8');
    const block = /```json\n([\s\S]*?)\n```/.exec(md)![1];
    expect(JSON.parse(block)).toEqual(JSON.parse(JSON.stringify(PROTOCOL)));
  });

  it('pinned source files match PROTOCOL.md or an outcomeExposed amendment pin', () => {
    const md = readFileSync(`${REPO}${DOCS}PROTOCOL.md`, 'utf8');
    const rows = [...md.matchAll(/\| `(packages\/metrics\/src\/assembly\/[a-z]+\.ts)` \| `([0-9a-f]{64})` \|/g)];
    expect(rows.length).toBe(7);
    expect(checkPins()).toEqual([]);
    // a pinned file edited after the fact, with no amendment, is caught
    const dir = mkdtempSync(join(tmpdir(), 'asm-pin-'));
    const root = join(dir, 'root') + '/';
    for (const f of sourceFiles()) { mkdirSync(dirname(root + f), { recursive: true }); copyFileSync(REPO + f, root + f); }
    for (const f of readdirSync(`${REPO}${DOCS}`)) if (/^amendment-.*\.json$/.test(f)) rmSync(`${root}${DOCS}${f}`);
    writeFileSync(root + 'packages/metrics/src/assembly/grammar.ts', readFileSync(REPO + 'packages/metrics/src/assembly/grammar.ts', 'utf8') + '\n// edit\n');
    expect(checkPins(root).some((x) => x.includes('grammar.ts'))).toBe(true);
  });

  it('freeze commit: well-formed, an ancestor, holds exactly the frozen documents, precedes outcomes', () => {
    const freeze = (JSON.parse(readFileSync(MANIFEST, 'utf8')) as { freezeCommit: string }).freezeCommit;
    expect(checkFreeze(freeze)).toEqual([]);
    // malformed or unrelated provenance fails instead of being skipped
    expect(checkFreeze('0'.repeat(40)).join()).toContain('not a 40-hex');
    expect(checkFreeze('abc').join()).toContain('not a 40-hex');
    let shallow = true;
    try { shallow = execFileSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: REPO, encoding: 'utf8' }).trim() === 'true'; } catch { return; }
    if (shallow) return; // history is genuinely unavailable: only the format checks above apply
    expect(checkFreeze('1234567890123456789012345678901234567890').join()).toContain('does not exist');
    expect(checkFreeze(BASE_COMMIT_FULL()).join()).toContain('expected only');
  });

  it('a re-sealed payload with a removed negative class or emptied replicates is rejected', () => {
    const dir = mkdtempSync(join(tmpdir(), 'asm-empty-'));
    const mf = join(dir, 'manifest.json');
    copyFileSync(MANIFEST, mf);
    const forged = saved();
    forged.calibration.find((c) => c.id === 'random-dup-12')!.replicates = [];
    const body = { ...forged }; delete body.integritySha256;
    forged.integritySha256 = sha(canonical(body));
    const ev = join(dir, 'evidence.json');
    writeFileSync(ev, JSON.stringify(forged, null, 1) + '\n');
    expect(checkSaved(ev, mf).join('\n')).toContain('random-dup-12 has 0 replicates');
    const removed = saved();
    removed.calibration = removed.calibration.filter((c) => c.id !== 'random-dup-12');
    const body2 = { ...removed }; delete body2.integritySha256;
    removed.integritySha256 = sha(canonical(body2));
    const ev2 = join(dir, 'evidence2.json');
    writeFileSync(ev2, JSON.stringify(removed, null, 1) + '\n');
    expect(checkSaved(ev2, mf).join('\n')).toContain('required class random-dup-12 is missing');
  });

  it('plain twin equals observed twin; rules untouched', () => {
    // the clip frames come from a read-only look at the sim: the same sim run plainly has the same state hash at every frame
    const { cfg, init } = clipConfig('spots');
    const plain = new RefSim(initWorld(cfg, init));
    const hashes: string[] = [];
    for (let k = 0; k < PROTOCOL.clips.frames; k++) { if (k > 0) plain.run(PROTOCOL.clips.stride); hashes.push(stateHash(plain.state)); }
    const seen: string[] = [];
    let frames = 0;
    for (const _f of clipFrames('spots', (sim) => { seen.push(stateHash(sim.state)); })) frames++;
    expect(frames).toBe(PROTOCOL.clips.frames);
    expect(seen).toEqual(hashes);
    // the spots clip is the I14 ecology clip
    const eco = ecologyClip();
    let k = 0;
    for (const f of clipFrames('spots')) { expect(Buffer.compare(Buffer.from(f), Buffer.from(eco.frames[k]))).toBe(0); k++; }
    expect(RULE_VERSION).toBe(1);
    expect(sha(JSON.stringify(defaultConfig()))).toBe('f1b7cbe54e81cbc463f8b5400ffd754b413570bc18283c0920a9719c1287bfc2');
  }, 120_000);

  it('statements: CPU only, interventions not done, no claim; no platform or timing keys', () => {
    const p = saved();
    expect(p.statements).toContain('CPU only');
    expect(p.statements).toContain('destruction/reconstruction interventions: not done (later rung)');
    expect(p.statements).toContain('no life-detection claim is made at any outcome');
    expect(p.statements).toContain('no evolving-world positive case');
    expect(p.statements.join('|')).toContain('negative-class motifs are selected by construction-length score');
    expect(p.statements.join('|')).not.toContain('no score here selected anything');
    expect(JSON.stringify(p)).not.toMatch(/generatedAt|platform|darwin|linux/);
    expect(existsSync(`${REPO}${DOCS}evidence.json`)).toBe(true);
  });
});
