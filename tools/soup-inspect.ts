// Lists the most common programs in a soup snapshot written by tools/soup.ts
// (bare program bytes) or a BLSOUP snapshot (tools/soup/snapshot.ts: the
// coordinator's and tools/soup_island.ts's, header and all),
// with how many copies each has and its selfRep (tools/soup/bff.ts: cubff's
// CheckSelfRep, 0..64; high = self-replicator).
//
//   deno run -A tools/soup-inspect.ts runs/soup/noheads/seed-2/soup-12609.bin [--top 10] [--lang noheads]
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { selfRep, type Lang, show, TAPE } from "./soup/bff.ts";
import { decodeSnapshot, SNAPSHOT_MAGIC } from "./soup/snapshot.ts";
import { byteEntropy } from "./soup/stats.ts";

const a = parseArgs(Deno.args, { string: ["top", "lang"], default: { top: "10" } });
const path = String(a._[0] ?? "");
if (!path) throw new Error("usage: soup-inspect.ts <soup-N.bin> [--top 10] [--lang noheads|heads]");
if (a.lang !== undefined && a.lang !== "noheads" && a.lang !== "heads") throw new Error("--lang must be noheads or heads");
const raw = await Deno.readFile(path);
// A BLSOUP header is 64 bytes, one program's worth, so it must be stripped or it would count as a program.
const blsoup = raw.length >= 8 && new TextDecoder().decode(raw.subarray(0, 8)) === SNAPSHOT_MAGIC;
const decoded = blsoup ? decodeSnapshot(raw) : null;
const soup = decoded ? decoded.programs : raw;
// A BLSOUP header names its language; a bare snapshot does not, so it defaults to noheads.
const fromHeader = decoded?.params.lang ?? "noheads";
if (decoded && a.lang !== undefined && a.lang !== fromHeader) throw new Error(`--lang ${a.lang} contradicts the snapshot's ${fromHeader}`);
const lang: Lang = (a.lang as Lang | undefined) ?? fromHeader;
if (soup.length === 0 || soup.length % TAPE !== 0) throw new Error(`${path}: ${soup.length} bytes is not a whole number of ${TAPE}-byte programs`);
const n = soup.length / TAPE;
const counts = new Map<string, number>();
for (let i = 0; i < n; i++) {
  let key = "";
  for (let k = i * TAPE; k < (i + 1) * TAPE; k++) key += String.fromCharCode(soup[k]);
  counts.set(key, (counts.get(key) ?? 0) + 1);
}
const limit = Number(a.top);
if (String(a.top).trim() === "" || !Number.isInteger(limit) || limit < 0) throw new Error("--top must be a non-negative integer");
const top = [...counts].sort((x, y) => y[1] - x[1]).slice(0, limit);
console.log(`${path}: ${n} programs, ${counts.size} distinct, byte entropy ${byteEntropy(soup).toFixed(3)} bits`);
console.log("copies  selfRep  program");
for (const [key, c] of top) {
  const prog = Uint8Array.from(key, (ch) => ch.charCodeAt(0));
  console.log(`${String(c).padStart(6)}  ${String(selfRep(prog, lang)).padStart(7)}  ${show(prog)}`);
}
