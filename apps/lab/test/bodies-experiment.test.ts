import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { writePng, upscale } from '../../../experiments/bodies/png.ts';
import { runGrowth, runLone, woundRunV2 } from '../../../experiments/bodies/run.ts';

it('writes a parseable PNG', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bodies-')); const p = join(dir, 'a.png');
  const rgba = new Uint8Array(4 * 4 * 4).map((_, i) => (i * 7) & 255);
  writePng(p, 4, 4, rgba);
  const b = readFileSync(p);
  expect([...b.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(b.readUInt32BE(16)).toBe(4); expect(b.readUInt32BE(20)).toBe(4);
  const at = b.indexOf('IDAT'); const len = b.readUInt32BE(at - 4);
  const raw = inflateSync(b.subarray(at + 4, at + 4 + len));
  expect(raw.length).toBe(4 * (4 * 4 + 1)); expect(raw[0]).toBe(0); expect([...raw.subarray(1, 17)]).toEqual([...rgba.subarray(0, 16)]);
});
it('upscales by integer factor', () => {
  const u = upscale(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), 2, 1, 3);
  expect(u.width).toBe(6); expect(u.height).toBe(3); expect([...u.rgba.subarray(0, 4)]).toEqual([1, 2, 3, 4]); expect([...u.rgba.subarray(12, 16)]).toEqual([5, 6, 7, 8]);
});
it('runGrowth smoke is deterministic and conserves matter', () => {
  const a = runGrowth(1, 60), b = runGrowth(1, 60);
  expect(a).toEqual(b); expect(a.residual).toBe(0); expect(a.series.at(-1)!.cells).toBeGreaterThan(100);
});
it('v2 lone and wound runs are deterministic, conserve matter and keep the body single-rooted', () => {
  const a = runLone(1, [16, 60, 0, 0], 800, undefined, 'shape'), b = runLone(1, [16, 60, 0, 0], 800, undefined, 'shape');
  expect(a).toEqual(b); expect(a.residual).toBe(0); expect(a.validate).toEqual([]);
  const last = a.series.at(-1)!; expect(last.roots).toBe(1); expect(last.cells).toBeGreaterThan(120); expect(last.domains.n).toBe(1);
  const w = woundRunV2([16, 60, 0, 0], 1, 'spared', 6, undefined, 800, 200);
  expect(w.residual).toBe(0); expect(w.killed).toBeGreaterThan(20); expect(w.recoveredPermille).toBeGreaterThan(900);
});
