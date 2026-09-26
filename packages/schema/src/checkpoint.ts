import { SCHEMA_VERSION, RULE_VERSION, defaultConfig, validateConfig, cellCount, type WorldConfig } from "./config.ts";
import { CELL_CHANNELS, FLUX_COUNT, GENOME_CHANNELS } from "./layout.ts";
import { canonicalGenome, digestWords } from "./accounting.ts";
import { validateState, type WorldState } from "./world.ts";

const MAGIC = 0x4b434c42; // "BLCK" little-endian

const lo = (x: bigint) => Number(x & 0xffffffffn);
const hi = (x: bigint) => Number((x >> 32n) & 0xffffffffn);

/** Versioned, checksummed binary snapshot. */
export function encodeCheckpoint(s: WorldState): Uint8Array {
  const errs = validateState(s);
  if (errs.length) throw new Error(`checkpoint: refusing to encode invalid state: ${errs.join("; ")}`);
  const cfgBytes = new TextEncoder().encode(JSON.stringify(s.cfg));
  const cfgWords = Math.ceil(cfgBytes.length / 4);
  const headerWords = 10 + 2 * FLUX_COUNT;
  const total = headerWords + cfgWords + 1 + s.cells.length + 1 + s.genome.length + 2;
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
  const [a, b] = digestWords(out.subarray(0, p));
  out[p++] = a;
  out[p++] = b;
  return new Uint8Array(out.buffer);
}

export function decodeCheckpoint(bytes: Uint8Array): WorldState {
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
  if (rule !== RULE_VERSION) throw new Error(`checkpoint: rule version ${rule} != ${RULE_VERSION}`);
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
  const errs = validateConfig(cfg);
  if (errs.length) throw new Error(`checkpoint: invalid config: ${errs.join("; ")}`);
  const n = cellCount(cfg);
  const cellsLen = word();
  if (cellsLen !== n * CELL_CHANNELS) throw new Error("checkpoint: cell size mismatch");
  const cells = w.slice(take(cellsLen), p);
  const genomeLen = word();
  if (genomeLen !== n * GENOME_CHANNELS) throw new Error("checkpoint: genome size mismatch");
  const genome = w.slice(take(genomeLen), p);
  if (p !== end) throw new Error("checkpoint: trailing data");
  const state = { cfg, step, cells, genome, lightIn, heatOut, flux };
  const serr = validateState(state);
  if (serr.length) throw new Error(`checkpoint: ${serr.join("; ")}`);
  return state;
}
