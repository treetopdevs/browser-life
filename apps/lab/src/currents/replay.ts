import { CURRENT_CONDITIONS, MATTER_HEIGHT, MATTER_SIZE, MATTER_WIDTH } from './model.ts';

export const REPLAY_TICK_LIMIT = 6000;
export const REPLAY_SEEDS = [1201, 1202, 1203] as const;
export const REPLAY_CONDITION_IDS = CURRENT_CONDITIONS.map(condition => condition.id);
export const REPLAY_TICKS = Object.freeze([...new Set([
  ...Array.from({ length: 51 }, (_, index) => index * 4),
  ...Array.from({ length: 61 }, (_, index) => index * 100),
])].sort((a, b) => a - b));
export const REPLAY_DENSE_TICK_END = 200;
export const REPLAY_SCHEMA_VERSION = 1;

export type ReplayConditionId = typeof CURRENT_CONDITIONS[number]['id'];
export type ReplayCondition = { id: ReplayConditionId; mode: 'closed' | 'rain'; current: 'off' | 'circulating' };
export type ReplayFrame = { tick: number; nutrient: Uint32Array; biomass: Uint32Array; detritus: Uint32Array };
export type ReplaySeedEntry = {
  seed: number;
  file: string;
  compressedBytes: number;
  uncompressedBytes: number;
  sha256: string;
  compressedSha256: string;
};
export type ReplayManifest = {
  schemaVersion: 1;
  width: 64;
  height: 48;
  conditions: readonly ReplayCondition[];
  ticks: readonly number[];
  seeds: readonly ReplaySeedEntry[];
};
export type ReplayCensusRow = { tick: number; biomass: number } & Record<string, unknown>;
export type ReplayPilotArtifact = {
  conditions: readonly ReplayCondition[];
  runs: readonly { seed: number; conditionId: ReplayConditionId; replayCensus: readonly ReplayCensusRow[] }[];
  replay: ReplayManifest;
};
export type ReplaySeedData = ReadonlyMap<ReplayConditionId, readonly ReplayFrame[]>;

export function expectedReplayBytes(conditionCount = 4, tickCount = REPLAY_TICKS.length): number {
  return conditionCount * tickCount * 3 * MATTER_SIZE * 4;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isHash(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function isExpectedConditions(value: unknown): value is ReplayCondition[] {
  return Array.isArray(value) && value.length === CURRENT_CONDITIONS.length && value.every((raw, index) => {
    const expected = CURRENT_CONDITIONS[index]!;
    return isRecord(raw) && raw.id === expected.id && raw.mode === expected.mode && raw.current === expected.current;
  });
}
function assertReplayManifest(value: unknown): asserts value is ReplayManifest {
  if (!isRecord(value) || value.schemaVersion !== REPLAY_SCHEMA_VERSION || value.width !== MATTER_WIDTH || value.height !== MATTER_HEIGHT) throw new Error('Replay manifest has unsupported schema or dimensions');
  if (!isExpectedConditions(value.conditions)) throw new Error('Replay manifest conditions are not in the required order');
  if (!Array.isArray(value.ticks) || value.ticks.length !== REPLAY_TICKS.length || value.ticks.some((tick, i) => tick !== REPLAY_TICKS[i])) throw new Error('Replay manifest ticks are not the exact sampled timeline');
  if (!Array.isArray(value.seeds) || value.seeds.length !== REPLAY_SEEDS.length) throw new Error('Replay manifest must contain all three seeds');
  for (const [index, raw] of value.seeds.entries()) {
    if (!isRecord(raw) || raw.seed !== REPLAY_SEEDS[index] || typeof raw.file !== 'string' || !/^currents-replay-\d+\.replay$/.test(raw.file)) throw new Error('Replay seed entry is malformed or out of order');
    if (!Number.isSafeInteger(raw.compressedBytes) || (raw.compressedBytes as number) < 1 || (raw.compressedBytes as number) > 64 * 1024 * 1024 || !Number.isSafeInteger(raw.uncompressedBytes) || raw.uncompressedBytes !== expectedReplayBytes()) throw new Error('Replay seed byte lengths are invalid');
    if (!isHash(raw.sha256) || !isHash(raw.compressedSha256)) throw new Error('Replay seed hash is invalid');
  }
}

export function assertReplayPilotArtifact(value: unknown): asserts value is ReplayPilotArtifact {
  if (!isRecord(value) || !isExpectedConditions(value.conditions)) throw new Error('Pilot artifact conditions are not in the required order');
  assertReplayManifest(value.replay);
  const expected = new Set(REPLAY_SEEDS.flatMap(seed => REPLAY_CONDITION_IDS.map(conditionId => `${seed}:${conditionId}`)));
  if (!Array.isArray(value.runs) || value.runs.length !== expected.size) throw new Error('Pilot artifact must contain all twelve condition runs');
  for (const raw of value.runs) {
    if (!isRecord(raw) || !REPLAY_SEEDS.includes(raw.seed as typeof REPLAY_SEEDS[number]) || !REPLAY_CONDITION_IDS.includes(raw.conditionId as ReplayConditionId) || !Array.isArray(raw.replayCensus) || raw.replayCensus.length !== REPLAY_TICKS.length) throw new Error('Pilot replay census rows are missing or malformed');
    const key = `${raw.seed}:${raw.conditionId}`;
    if (!expected.delete(key)) throw new Error('Pilot artifact contains a duplicate or unexpected condition run');
    for (const [rowIndex, census] of raw.replayCensus.entries()) {
      if (!isRecord(census) || census.tick !== REPLAY_TICKS[rowIndex] || !Number.isSafeInteger(census.biomass) || (census.biomass as number) < 0) throw new Error('Pilot replay census row is malformed');
    }
  }
  if (expected.size) throw new Error('Pilot artifact is missing one or more condition runs');
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength); copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Decode one actual manifest-listed gzip stream; raw SHA-256 is checked before any frame is exposed. */
export async function decodeReplaySeed(manifestValue: unknown, seed: number, compressed: ArrayBuffer | Uint8Array): Promise<ReplaySeedData> {
  assertReplayPilotArtifact(manifestValue);
  const manifest = manifestValue.replay;
  const entry = manifest.seeds.find(item => item.seed === seed);
  if (!entry) throw new Error(`Seed ${seed} is not in the replay manifest`);
  const compressedBytes = compressed instanceof Uint8Array ? compressed : new Uint8Array(compressed);
  if (compressedBytes.byteLength !== entry.compressedBytes) throw new Error('Compressed replay size does not match its manifest');
  if (await sha256(compressedBytes) !== entry.compressedSha256) throw new Error('Compressed replay SHA-256 does not match its manifest');
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser does not support gzip replay');
  const compressedCopy = new Uint8Array(compressedBytes.byteLength); compressedCopy.set(compressedBytes);
  const stream = new Blob([compressedCopy.buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  const raw = new Uint8Array(await new Response(stream).arrayBuffer());
  if (raw.byteLength !== entry.uncompressedBytes || raw.byteLength !== expectedReplayBytes(manifest.conditions.length, manifest.ticks.length)) throw new Error('Decompressed replay size does not match its manifest');
  if (await sha256(raw) !== entry.sha256) throw new Error('Replay SHA-256 does not match its manifest');

  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const output = new Map<ReplayConditionId, ReplayFrame[]>();
  let offset = 0;
  for (const condition of manifest.conditions) {
    const conditionId = condition.id;
    const frames: ReplayFrame[] = [];
    for (const tick of manifest.ticks) {
      const fields = [new Uint32Array(MATTER_SIZE), new Uint32Array(MATTER_SIZE), new Uint32Array(MATTER_SIZE)] as const;
      for (const field of fields) {
        for (let cell = 0; cell < MATTER_SIZE; cell++, offset += 4) field[cell] = view.getUint32(offset, true);
      }
      frames.push({ tick, nutrient: fields[0], biomass: fields[1], detritus: fields[2] });
    }
    output.set(conditionId, frames);
  }
  if (offset !== raw.byteLength) throw new Error('Replay stream contains trailing data');
  return output;
}

export function replayWindowForTick(tick: number): 'dense' | 'coarse' { return tick <= REPLAY_DENSE_TICK_END ? 'dense' : 'coarse'; }
export function replayWindowIndices(ticks: readonly number[], window: 'dense' | 'coarse'): number[] {
  return ticks.flatMap((tick, index) => window === 'dense' ? tick <= REPLAY_DENSE_TICK_END ? [index] : [] : tick % 100 === 0 ? [index] : []);
}
export function replayWindowBounds(ticks: readonly number[], window: 'dense' | 'coarse'): { start: number; end: number } {
  const indexes = replayWindowIndices(ticks, window);
  if (!indexes.length) throw new RangeError(`Replay has no ${window} frames`);
  return { start: indexes[0]!, end: indexes.at(-1)! };
}
export function replayNextIndex(ticks: readonly number[], index: number, direction: -1 | 1, window = replayWindowForTick(ticks[index] ?? 0)): number {
  if (!Number.isInteger(index) || index < 0 || index >= ticks.length) throw new RangeError('Replay frame index is out of range');
  const indexes = replayWindowIndices(ticks, window);
  if (!indexes.length) throw new RangeError(`Replay has no ${window} frames`);
  const current = indexes.indexOf(index);
  let position = current;
  if (position < 0) position = indexes.findIndex(candidate => direction === 1 ? candidate > index : candidate >= index);
  if (position < 0) position = indexes.length - 1;
  return indexes[Math.max(0, Math.min(indexes.length - 1, position + (current < 0 ? 0 : direction)))]!;
}

/** Loader supplied by the page keeps seed files lazy and stale-response-safe. */
export async function loadReplaySeed(manifestUrl: string, seedUrl: string, seed: number, signal?: AbortSignal): Promise<ReplaySeedData> {
  const manifestResponse = await fetch(manifestUrl, { signal });
  if (!manifestResponse.ok) throw new Error(`Replay manifest request failed (${manifestResponse.status})`);
  const manifest: unknown = await manifestResponse.json();
  const compressedResponse = await fetch(seedUrl, { signal });
  if (!compressedResponse.ok) throw new Error(`Replay seed request failed (${compressedResponse.status})`);
  return decodeReplaySeed(manifest, seed, await compressedResponse.arrayBuffer());
}

export async function loadReplayPilot(manifestUrl: string, signal?: AbortSignal): Promise<ReplayPilotArtifact> {
  const response = await fetch(manifestUrl, { signal });
  if (!response.ok) throw new Error(`Pilot artifact request failed (${response.status})`);
  const artifact: unknown = await response.json();
  assertReplayPilotArtifact(artifact);
  return artifact;
}
