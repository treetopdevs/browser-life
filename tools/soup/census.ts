// Byte entropy and the program census, without node:zlib or Deno, so the lab
// page can use them in the browser. stats.ts re-exports both.
import { TAPE } from "./bff.ts";

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
