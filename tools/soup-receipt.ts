// Read-only snapshot measurement. Redirect stdout to a NEW receipt file.
// deno run -A tools/soup-receipt.ts path/to/soup-12609.bin noheads
// A receipt authenticates measured bytes, not their claimed run provenance.
import { selfRep, TAPE } from "./soup/bff.ts";
import { census, stats } from "./soup/stats.ts";
const [path, lang = "noheads"] = Deno.args;
if (!path || !["heads", "noheads"].includes(lang)) throw new Error("usage: soup-receipt.ts SNAPSHOT [noheads|heads]");
const bytes = await Deno.readFile(path);
if (!bytes.length || bytes.length % TAPE) throw new Error("snapshot must contain whole 64-byte programs");
const hex = (b: Uint8Array) => Array.from(b, v => v.toString(16).padStart(2, "0")).join("");
const c = census(bytes);
console.log(JSON.stringify({
  schema: 1, path, lang, bytes: bytes.length, num: bytes.length / TAPE,
  sha256: hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))),
  measurements: await stats(bytes), distinct: c.distinct, topCount: c.topCount,
  topHex: hex(c.top), topSelfRep: selfRep(c.top, lang as "heads" | "noheads"),
  runtime: Deno.version,
  caveat: "Record source revision and compressor identity separately; this receipt does not establish ancestry or population replication.",
}, null, 2));
