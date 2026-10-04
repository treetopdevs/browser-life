import { SCHEMA_VERSION, isSupportedRuleVersion, defaultConfig, validateConfig, cellCount, type WorldConfig } from "./config.ts";
import { CELL_CHANNELS, FLUX_COUNT, GENOME_CHANNELS } from "./layout.ts";
import { canonicalGenome, digestWords } from "./accounting.ts";
import { validateState, type WorldState } from "./world.ts";

const MAGIC = 0x4b434c42; // "BLCK" little-endian

const lo = (x: bigint) => Number(x & 0xffffffffn);
const hi = (x: bigint) => Number((x >> 32n) & 0xffffffffn);

/**
 * A checkpoint is one artifact with two sections: the physics state (cells +
 * genome, byte-for-byte the same layout as schema v2) and an observer
 * section — the tracker/activity/counters/settings a run's observers need to
 * continue exactly, carried alongside the state instead of as a second,
 * separately-uploaded file. The observer section is opaque to this module:
 * it is whatever JSON-serialisable value the caller passes, length-prefixed
 * and word-padded the same way the config section already is. This keeps the
 * wire format simple enough to port to Elixir (`Jason.decode/1`) without this
 * module needing to know the observer's actual shape — semantic validation of
 * that shape (tracker referential integrity, settings, counters, ...) is the
 * caller's job (see `decodeArtifact` in `@bl/runner`), not this codec's.
 */
export function encodeCheckpoint(s: WorldState, observer: unknown = {}): Uint8Array {
  const errs = validateState(s);
  if (errs.length) throw new Error(`checkpoint: refusing to encode invalid state: ${errs.join("; ")}`);
  const cfgBytes = new TextEncoder().encode(JSON.stringify(s.cfg));
  const cfgWords = Math.ceil(cfgBytes.length / 4);
  const obsBytes = new TextEncoder().encode(JSON.stringify(observer));
  const obsWords = Math.ceil(obsBytes.length / 4);
  const headerWords = 10 + 2 * FLUX_COUNT;
  const total = headerWords + cfgWords + 1 + s.cells.length + 1 + s.genome.length + 1 + obsWords + 2;
  const out = new Uint32Array(total);
  let p = 0;
  out[p++] = MAGIC;
  out[p++] = SCHEMA_VERSION;
  out[p++] = s.cfg.ruleVersion;
  out[p++] = s.step;
  out[p++] = lo(s.lightIn);
  out[p++] = hi(s.lightIn);
  out[p++] = lo(s.heatOut);
  out[p++] = hi(s.heatOut);
  for (const f of s.flux) {
    out[p++] = lo(f);
    out[p++] = hi(f);
  }
  out[p++] = 0;
  out[p++] = cfgBytes.length;
  new Uint8Array(out.buffer, p * 4, cfgBytes.length).set(cfgBytes);
  p += cfgWords;
  out[p++] = s.cells.length;
  out.set(s.cells, p);
  p += s.cells.length;
  out[p++] = s.genome.length;
  out.set(canonicalGenome(s.genome), p);
  p += s.genome.length;
  out[p++] = obsBytes.length;
  new Uint8Array(out.buffer, p * 4, obsBytes.length).set(obsBytes);
  p += obsWords;
  const [a, b] = digestWords(out.subarray(0, p));
  out[p++] = a;
  out[p++] = b;
  return new Uint8Array(out.buffer);
}

/**
 * The wire-format decode: every check that depends only on the bytes
 * (magic, schema/rule version, section bounds, checksum, trailing data, JSON
 * syntax) or on the physics state alone (`validateState`, which includes the
 * ledger's `< 2^63` headroom check). The observer section is returned
 * unvalidated JSON — callers that need a fully-validated `ObserverState`
 * (tracker referential integrity, settings shape, counter types, ...) use
 * `decodeArtifact` from `@bl/runner`, the single loader for that.
 */
export function decodeCheckpoint(bytes: Uint8Array): { state: WorldState; observer: unknown } {
  if (bytes.byteLength % 4 !== 0) throw new Error("checkpoint: bad length");
  const buf = bytes.byteOffset % 4 === 0 ? bytes : bytes.slice();
  const w = new Uint32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const [a, b] = digestWords(w.subarray(0, w.length - 2));
  if (a !== w[w.length - 2] || b !== w[w.length - 1]) throw new Error("checkpoint: checksum mismatch");
  // Every read is bounds-checked against the payload (the last two words are the checksum).
  const end = w.length - 2;
  let p = 0;
  const take = (k: number) => {
    if (p + k > end) throw new Error("checkpoint: truncated");
    const at = p;
    p += k;
    return at;
  };
  const word = () => w[take(1)];
  if (word() !== MAGIC) throw new Error("checkpoint: bad magic");
  const schema = word();
  if (schema !== SCHEMA_VERSION) throw new Error(`checkpoint: schema ${schema} != ${SCHEMA_VERSION}`);
  const rule = word();
  if (!isSupportedRuleVersion(rule)) throw new Error(`checkpoint: unsupported rule version ${rule}`);
  const step = word();
  const u64 = () => BigInt(word()) | (BigInt(word()) << 32n);
  const lightIn = u64();
  const heatOut = u64();
  const flux: bigint[] = [];
  for (let k = 0; k < FLUX_COUNT; k++) flux.push(u64());
  word();
  const cfgLen = word();
  const cfgAt = take(Math.ceil(cfgLen / 4));
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(new Uint8Array(w.buffer, w.byteOffset + cfgAt * 4, cfgLen)));
  } catch {
    throw new Error("checkpoint: config is not valid JSON");
  }
  const cfg = { ...defaultConfig(), ...(parsed as object) } as WorldConfig;
  if (cfg.ruleVersion !== rule) throw new Error(`checkpoint: header rule version ${rule} != config ${cfg.ruleVersion}`);
  const errs = validateConfig(cfg);
  if (errs.length) throw new Error(`checkpoint: invalid config: ${errs.join("; ")}`);
  const n = cellCount(cfg);
  const cellsLen = word();
  if (cellsLen !== n * CELL_CHANNELS) throw new Error("checkpoint: cell size mismatch");
  const cells = w.slice(take(cellsLen), p);
  const genomeLen = word();
  if (genomeLen !== n * GENOME_CHANNELS) throw new Error("checkpoint: genome size mismatch");
  const genome = w.slice(take(genomeLen), p);
  const obsLen = word();
  const obsAt = take(Math.ceil(obsLen / 4));
  let observer: unknown;
  try {
    observer = JSON.parse(new TextDecoder().decode(new Uint8Array(w.buffer, w.byteOffset + obsAt * 4, obsLen)));
  } catch {
    throw new Error("checkpoint: observer section is not valid JSON");
  }
  if (p !== end) throw new Error("checkpoint: trailing data");
  const state = { cfg, step, cells, genome, lightIn, heatOut, flux };
  const serr = validateState(state);
  if (serr.length) throw new Error(`checkpoint: ${serr.join("; ")}`);
  return { state, observer };
}
