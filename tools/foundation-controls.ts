// Deterministic controls for existing observer metrics. Uses constructed
// readback arrays only; no simulator stepping or GPU is performed.
//
//   deno run -A tools/foundation-controls.ts
import { buildFoundationControlReport } from "./lib/foundation-controls.ts";

const report = buildFoundationControlReport();
console.log(JSON.stringify(report, null, 2));
if (report.controls.some((row) => Object.values(row.asserted).some((value) => value !== "supported"))) Deno.exitCode = 1;
