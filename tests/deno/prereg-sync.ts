// experiments/preregistration.md's generated sections (primary endpoints and
// held-out observables) must match what tools/gen-prereg.ts would currently
// produce from experiments/endpoints.ts -- "a test that fails if the doc is
// stale" (Part C, refactor-v3 workflow).
import { HELD_OUT_SPECS, HELD_OUT_SUMMARY, PRIMARY_ENDPOINTS } from "../../experiments/endpoints.ts";
import { applyGeneratedSection, applyHeldOutSection } from "../../tools/gen-prereg.ts";

const path = new URL("../../experiments/preregistration.md", import.meta.url);
const doc = await Deno.readTextFile(path);
const fresh = applyHeldOutSection(applyGeneratedSection(doc, PRIMARY_ENDPOINTS), HELD_OUT_SPECS, HELD_OUT_SUMMARY);
const ok = fresh === doc;
console.log(`${ok ? "PASS" : "FAIL"} preregistration.md's generated sections match experiments/endpoints.ts`);
if (!ok) console.log("run: deno task gen-prereg  (or: pnpm gen:prereg)");
Deno.exit(ok ? 0 : 1);
