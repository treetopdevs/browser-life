import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { CURRENT_CONDITIONS, MATTER_SIZE } from '../src/currents/model.ts';
import { decodeReplaySeed, expectedReplayBytes, REPLAY_CONDITION_IDS, REPLAY_DENSE_TICK_END, REPLAY_SEEDS, REPLAY_TICKS, replayNextIndex, replayWindowBounds, replayWindowForTick } from '../src/currents/replay.ts';

function hash(data: Uint8Array): string { return createHash('sha256').update(data).digest('hex'); }
function syntheticManifest(raw: Uint8Array, compressed: Uint8Array) {
  return {
    conditions: CURRENT_CONDITIONS.map(condition => ({ ...condition })),
    runs: REPLAY_SEEDS.flatMap(seed => CURRENT_CONDITIONS.map(condition => ({ seed, conditionId: condition.id, replayCensus: REPLAY_TICKS.map(tick => ({ tick, biomass: 0 })) }))),
    replay: {
      schemaVersion: 1, width: 64, height: 48,
      conditions: CURRENT_CONDITIONS.map(condition => ({ ...condition })), ticks: [...REPLAY_TICKS],
      seeds: REPLAY_SEEDS.map(seed => ({ seed, file: `currents-replay-${seed}.replay`, compressedBytes: compressed.length, uncompressedBytes: raw.length, sha256: hash(raw), compressedSha256: hash(compressed) })),
    },
  };
}

describe('currents replay decoding and timeline', () => {
  it('uses the exact 109 tick union with a dense introduction and coarse remainder', () => {
    expect(REPLAY_TICKS).toHaveLength(109);
    expect(REPLAY_TICKS.slice(0, 3)).toEqual([0, 4, 8]);
    expect(REPLAY_TICKS[50]).toBe(REPLAY_DENSE_TICK_END);
    expect(REPLAY_TICKS[51]).toBe(300);
    expect(REPLAY_TICKS.at(-1)).toBe(6000);
    expect(replayWindowForTick(200)).toBe('dense');
    expect(replayWindowForTick(300)).toBe('coarse');
    expect(replayWindowBounds(REPLAY_TICKS, 'dense')).toEqual({ start: 0, end: 50 });
    expect(replayWindowBounds(REPLAY_TICKS, 'coarse')).toEqual({ start: 0, end: 108 });
    expect(replayNextIndex(REPLAY_TICKS, 50, 1)).toBe(50);
    expect(replayNextIndex(REPLAY_TICKS, 51, -1)).toBe(50);
  });

  it('validates and decodes a synthetic little-endian stream without claiming it as pilot evidence', async () => {
    const raw = new Uint8Array(expectedReplayBytes());
    const data = new DataView(raw.buffer);
    // First N/B/D cell values in each of the four condition-major blocks.
    const frameBytes = MATTER_SIZE * 3 * 4;
    for (let condition = 0; condition < CURRENT_CONDITIONS.length; condition++) {
      const offset = condition * REPLAY_TICKS.length * frameBytes;
      data.setUint32(offset, 10 + condition, true);
      data.setUint32(offset + MATTER_SIZE * 4, 20 + condition, true);
      data.setUint32(offset + MATTER_SIZE * 8, 30 + condition, true);
    }
    const compressed = gzipSync(raw);
    const decoded = await decodeReplaySeed(syntheticManifest(raw, compressed), 1201, compressed);
    expect([...decoded.keys()]).toEqual(REPLAY_CONDITION_IDS);
    const first = decoded.get(CURRENT_CONDITIONS[0]!.id)![0]!;
    expect([first.tick, first.nutrient[0], first.biomass[0], first.detritus[0]]).toEqual([0, 10, 20, 30]);
    const other = decoded.get(CURRENT_CONDITIONS[3]!.id)![0]!;
    expect([other.nutrient[0], other.biomass[0], other.detritus[0]]).toEqual([13, 23, 33]);
  });

  it('rejects a modified compressed stream before exposing fields', async () => {
    const raw = new Uint8Array(expectedReplayBytes()), compressed = gzipSync(raw);
    const altered = new Uint8Array(compressed); altered[altered.length - 1] ^= 1;
    await expect(decodeReplaySeed(syntheticManifest(raw, compressed), 1201, altered)).rejects.toThrow('Compressed replay SHA-256');
  });
});
