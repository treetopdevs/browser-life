// BLSOUP snapshots (docs/soup-garden-2026-10-31.md, "Snapshot format"): a 64-byte
// little-endian header (magic "BLSOUP\0\0", version 1, seed, num, width, height,
// radius, mutation, lang, epoch as two u32 halves, 16 reserved zero bytes), then
// num * 64 program bytes, exactly Soup.programs. A snapshot's identity is the
// SHA-256 of the whole file, so the hash pins the parameters and the epoch too.
//
// All randomness is keyed on (seed, epoch, ...), so a soup resumed from a
// snapshot at epoch E equals a continuous run at E. The coordinator
// (Coordinator.Soup) checks the same header on every upload.
import { DEFAULT_MUTATION, type Lang, type SoupParams, Soup, TAPE } from "./bff.ts";
import { GpuSoup } from "./gpu.ts";

export const SNAPSHOT_MAGIC = "BLSOUP\0\0";
export const SNAPSHOT_VERSION = 1;
export const HEADER_BYTES = 64;
const LANGS: Lang[] = ["noheads", "heads"];

export interface Snapshot { params: SoupParams; epoch: number; programs: Uint8Array }

/**
 * Encodes a snapshot. `Soup` keeps its seed private, so the caller passes the
 * parameters it built the soup with; `programs` must be num * 64 bytes.
 */
export function encodeSnapshot(params: SoupParams, programs: Uint8Array, epoch: number): Uint8Array<ArrayBuffer> {
  const { num, seed } = params;
  if (programs.length !== num * TAPE) throw new Error(`programs must be num * ${TAPE} bytes`);
  if (!Number.isSafeInteger(epoch) || epoch < 0) throw new Error("epoch must be a non-negative safe integer");
  const out = new Uint8Array(HEADER_BYTES + programs.length);
  const v = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) out[i] = SNAPSHOT_MAGIC.charCodeAt(i);
  const g = params.grid;
  const fields = [
    SNAPSHOT_VERSION, seed, num,
    g?.width ?? 0, g?.height ?? 0, g ? (g.radius ?? 2) : 0,
    params.mutation ?? DEFAULT_MUTATION, LANGS.indexOf(params.lang ?? "noheads"),
    epoch % 2 ** 32, Math.floor(epoch / 2 ** 32),
  ];
  fields.forEach((x, i) => v.setUint32(8 + 4 * i, x, true));
  out.set(programs, HEADER_BYTES);
  return out;
}

/** Encodes a CPU soup built with `params` at its current epoch. */
export function snapshotOf(params: SoupParams, soup: Soup): Uint8Array<ArrayBuffer> {
  return encodeSnapshot(params, soup.programs, soup.epoch);
}

/** Decodes and checks a snapshot (magic, version, lang, reserved bytes, grid shape, exact length). */
export function decodeSnapshot(bytes: Uint8Array): Snapshot {
  if (bytes.length < HEADER_BYTES) throw new Error("snapshot shorter than its header");
  for (let i = 0; i < 8; i++) if (bytes[i] !== SNAPSHOT_MAGIC.charCodeAt(i)) throw new Error("not a BLSOUP snapshot");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u = (off: number) => v.getUint32(off, true);
  if (u(8) !== SNAPSHOT_VERSION) throw new Error(`unsupported snapshot version ${u(8)}`);
  const [seed, num, width, height, radius, mutation, langId] = [12, 16, 20, 24, 28, 32, 36].map(u);
  const epoch = u(40) + u(44) * 2 ** 32;
  if (!Number.isSafeInteger(epoch)) throw new Error("snapshot epoch exceeds 2^53");
  if (langId >= LANGS.length) throw new Error(`unknown lang ${langId}`);
  for (let i = 48; i < HEADER_BYTES; i++) if (bytes[i] !== 0) throw new Error("reserved header bytes must be zero");
  if (num < 2 || num % 2 !== 0) throw new Error("num must be even and at least 2");
  if (bytes.length !== HEADER_BYTES + num * TAPE) throw new Error(`snapshot length ${bytes.length} != ${HEADER_BYTES + num * TAPE}`);
  const params: SoupParams = { num, seed, mutation, lang: LANGS[langId] };
  if (width || height || radius) {
    if (width * height !== num || radius < 1) throw new Error("grid width * height must equal num, radius at least 1");
    params.grid = { width, height, radius };
  }
  return { params, epoch, programs: bytes.subarray(HEADER_BYTES) };
}

/** A CPU soup resumed from a snapshot, with the parameters it was built with. */
export function resumeSoup(bytes: Uint8Array): { soup: Soup; params: SoupParams } {
  const { params, epoch, programs } = decodeSnapshot(bytes);
  const soup = new Soup(params);
  soup.programs.set(programs);
  soup.epoch = epoch;
  return { soup, params };
}

/** A GPU soup resumed from a snapshot. Call `read()` after stepping, before encoding `g.cpu`. */
export async function resumeGpuSoup(device: GPUDevice, bytes: Uint8Array): Promise<{ soup: GpuSoup; params: SoupParams }> {
  const { params, epoch, programs } = decodeSnapshot(bytes);
  const soup = await GpuSoup.create(device, params);
  soup.cpu.programs.set(programs);
  soup.cpu.epoch = epoch;
  soup.upload();
  return { soup, params };
}

/** Lowercase hex SHA-256 (crypto.subtle: Deno, Node and browsers). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes); // digest wants an ArrayBuffer-backed view
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", copy));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}
