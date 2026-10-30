// Soup measurements. higherEntropy follows cubff: Shannon entropy of the byte
// histogram (bits/byte) minus brotli quality-2, window-24 compressed bits per
// byte. A jump in it marks the arrival of self-replicators. The program census
// (distinct programs, most common program) is a second signal that does not
// depend on the compressor.
import { brotliCompressSync, constants } from "node:zlib";
import { TAPE } from "./bff.ts";

// Under Deno, node:zlib's brotli is a different encoder from the C library
// cubff links, and sizes differ by about 0.02%. Use the C `brotli` CLI when
// present (brotliSizeC); node:zlib under Node is the C library.

const BROTLI_CLI = ["/opt/homebrew/bin/brotli", "/usr/local/bin/brotli", "/usr/bin/brotli"];

/** C brotli size via the CLI (quality 2, window 24, as cubff), or null when no CLI is installed. */
export async function brotliSizeC(data: Uint8Array): Promise<number | null> {
  // deno-lint-ignore no-explicit-any
  const D = (globalThis as any).Deno;
  if (!D) return brotliSize(data);
  const bin = BROTLI_CLI.find((p) => { try { return D.statSync(p).isFile; } catch { return false; } });
  if (!bin) return null;
  const child = new D.Command(bin, { args: ["-q", "2", "-w", "24", "-c"], stdin: "piped", stdout: "piped" }).spawn();
  const pending = child.output(); // read while writing, or the pipe fills and deadlocks
  const w = child.stdin.getWriter();
  await w.write(data);
  await w.close();
  const out = await pending;
  if (!out.success) throw new Error("brotli CLI failed");
  return out.stdout.length;
}

export function brotliSize(data: Uint8Array): number {
  return brotliCompressSync(data, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 2,
      [constants.BROTLI_PARAM_LGWIN]: 24,
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_GENERIC,
      [constants.BROTLI_PARAM_SIZE_HINT]: data.length,
    },
  }).length;
}

export function byteEntropy(data: Uint8Array): number {
  const counts = new Float64Array(256);
  for (const b of data) counts[b]++;
  let h = 0;
  for (const c of counts) if (c) { const f = c / data.length; h -= f * Math.log2(f); }
  return h;
}

export interface Census { distinct: number; top: Uint8Array; topCount: number }

export function census(programs: Uint8Array): Census {
  const n = programs.length / TAPE;
  const counts = new Map<string, number>();
  let best = "", bestN = 0;
  for (let i = 0; i < n; i++) {
    let key = "";
    for (let k = i * TAPE; k < (i + 1) * TAPE; k++) key += String.fromCharCode(programs[k]);
    const c = (counts.get(key) ?? 0) + 1;
    counts.set(key, c);
    if (c > bestN) { bestN = c; best = key; }
  }
  return { distinct: counts.size, top: Uint8Array.from(best, (ch) => ch.charCodeAt(0)), topCount: bestN };
}

export interface Stats { brotli: number; h0: number; higherEntropy: number }

export async function stats(programs: Uint8Array): Promise<Stats> {
  const brotli = (await brotliSizeC(programs)) ?? brotliSize(programs);
  const h0 = byteEntropy(programs);
  return { brotli, h0, higherEntropy: h0 - (brotli * 8) / programs.length };
}
