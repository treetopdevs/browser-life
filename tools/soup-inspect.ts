// Lists the most common programs in a soup snapshot written by tools/soup.ts,
// with how many copies each has and its copyScore (tools/soup/bff.ts: the
// share of a random partner it overwrites with itself; near 1 = replicator).
//
//   deno run -A tools/soup-inspect.ts runs/soup/noheads/seed-2/soup-12609.bin [--top 10] [--lang noheads]
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { copyScore, type Lang, show, TAPE } from "./soup/bff.ts";
import { byteEntropy } from "./soup/stats.ts";

const a = parseArgs(Deno.args, { string: ["top", "lang"], default: { top: "10", lang: "noheads" } });
const path = String(a._[0] ?? "");
if (!path) throw new Error("usage: soup-inspect.ts <soup-N.bin> [--top 10] [--lang noheads|heads]");
const soup = await Deno.readFile(path);
const n = soup.length / TAPE;
const counts = new Map<string, number>();
for (let i = 0; i < n; i++) {
  let key = "";
  for (let k = i * TAPE; k < (i + 1) * TAPE; k++) key += String.fromCharCode(soup[k]);
  counts.set(key, (counts.get(key) ?? 0) + 1);
}
const top = [...counts].sort((x, y) => y[1] - x[1]).slice(0, Number(a.top));
console.log(`${path}: ${n} programs, ${counts.size} distinct, byte entropy ${byteEntropy(soup).toFixed(3)} bits`);
console.log("copies  copyScore  program");
for (const [key, c] of top) {
  const prog = Uint8Array.from(key, (ch) => ch.charCodeAt(0));
  console.log(`${String(c).padStart(6)}  ${copyScore(prog, a.lang as Lang).toFixed(2).padStart(9)}  ${show(prog)}`);
}
