// verifyLock / generateFe against malformed or missing freeze artifacts. node:fs is overlaid (reads of the three frozen paths can be
// replaced or hidden per test), so no frozen file is ever touched on disk.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const overlay = vi.hoisted(() => ({ files: new Map<string, string | null>() }));
vi.mock('node:fs', async (orig) => {
  const real = await orig<typeof import('node:fs')>();
  const hit = (p: unknown) => overlay.files.has(String(p));
  const patched = {
    ...real,
    existsSync: (p: any) => (hit(p) ? overlay.files.get(String(p)) !== null : real.existsSync(p)),
    readFileSync: ((p: any, ...rest: any[]) => {
      if (hit(p)) {
        const v = overlay.files.get(String(p));
        if (v === null) throw Object.assign(new Error(`ENOENT ${p}`), { code: 'ENOENT' });
        return rest.length ? v : Buffer.from(v as string);
      }
      return (real.readFileSync as any)(p, ...rest);
    }) as typeof real.readFileSync,
  };
  return { ...patched, default: patched };
});

import { CALIBRATION_FE, LOCK_FE, generateFe, verifyLock, type Git } from '../niche/fe.ts';

const realRead = async () => (await vi.importActual<typeof import('node:fs')>('node:fs')).readFileSync;
const lockText = async () => (await realRead())(LOCK_FE, 'utf8') as string;
const calText = async () => (await realRead())(CALIBRATION_FE, 'utf8') as string;
const mutateLock = async (f: (l: any) => void) => { const l = JSON.parse(await lockText()); f(l); overlay.files.set(LOCK_FE, JSON.stringify(l)); };

beforeEach(() => overlay.files.clear());

describe('verifyLock on the real freeze and on broken ones', () => {
  it('the valid lock verifies with an empty problem list', async () => {
    expect(await verifyLock()).toEqual([]);
  });
  it('a missing protocol.lock.json is refused', async () => {
    overlay.files.set(LOCK_FE, null);
    expect((await verifyLock()).join()).toMatch(/no protocol\.lock\.json/);
  });
  it('a missing calibration.json is refused', async () => {
    overlay.files.set(CALIBRATION_FE, null);
    expect((await verifyLock()).join()).toMatch(/no calibration\.json/);
  });
  it('a corrupt calibration.json is refused (bytes differ from the lock)', async () => {
    overlay.files.set(CALIBRATION_FE, `${await calText()} `);
    expect((await verifyLock()).join()).toMatch(/calibration\.json changed/);
  });
  it('a corrupt protocol.lock.json is refused before anything simulates', async () => {
    overlay.files.set(LOCK_FE, '{not json');
    await expect(verifyLock()).rejects.toThrow();
  });
  it('a lock with a different protocol hash, seed list or registry digest is refused', async () => {
    await mutateLock((l) => { l.protocolHash = '0'.repeat(64); });
    expect((await verifyLock()).join()).toMatch(/protocol in code differs/);
    await mutateLock((l) => { l.seeds = l.seeds.slice(1); });
    expect((await verifyLock()).join()).toMatch(/seed list differs/);
    await mutateLock((l) => { l.registryDigest = '0'.repeat(64); });
    expect((await verifyLock()).join()).toMatch(/registry reservation changed/);
  });
  it('a lock whose source binding differs (one hash changed, one source dropped) is refused naming the source', async () => {
    await mutateLock((l) => { l.sources['tools/niche/fe.ts'] = '0'.repeat(64); });
    expect((await verifyLock()).join()).toMatch(/source tools\/niche\/fe\.ts differs from the freeze/);
    await mutateLock((l) => { delete l.sources['packages/runner/src/niche/dose.ts']; });
    expect((await verifyLock()).join()).toMatch(/source packages\/runner\/src\/niche\/dose\.ts differs/);
  });
  it('generateFe (the only simulating entry) rejects on each broken lock (a git answer cannot rescue it) before any simulation', async () => {
    const git: Git = () => { throw new Error('git unavailable'); };
    overlay.files.set(LOCK_FE, null);
    await expect(generateFe(git)).rejects.toThrow(/refusing to read any fresh seed[\s\S]*no protocol\.lock\.json/);
    overlay.files.clear();
    overlay.files.set(CALIBRATION_FE, `${await calText()} `);
    await expect(generateFe(git)).rejects.toThrow(/calibration\.json changed/);
    overlay.files.clear();
    await mutateLock((l) => { l.sources['tools/niche/fe.ts'] = '0'.repeat(64); });
    await expect(generateFe(git)).rejects.toThrow(/differs from the freeze/);
  });
});
