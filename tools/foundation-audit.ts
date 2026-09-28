// Read-only audit of committed M4 report summaries. It intentionally reads
// the compact report JSON files only, never the much larger run bundles.
//
//   deno run -A tools/foundation-audit.ts [experiments/m4/gradient-m3.json ...]
import { renderFoundationAuditMarkdown, summarizeFoundationReport } from "./lib/foundation-audit.ts";

const paths = Deno.args.length
  ? Deno.args
  : ["experiments/m4/gradient-m3.json", "experiments/m4/spots-m3.json"];
const sections: string[] = [];
for (const path of paths) {
  const parsed: unknown = JSON.parse(await Deno.readTextFile(path));
  sections.push(renderFoundationAuditMarkdown(path, summarizeFoundationReport(parsed)));
}
console.log(sections.join("\n"));
