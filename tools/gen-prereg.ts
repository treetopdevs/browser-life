// Generates the "## Primary endpoints" section of experiments/preregistration.md
// from experiments/endpoints.ts, between GENERATED markers, so the doc cannot
// silently drift from the endpoint spec `tools/analyze.ts` actually executes.
//
//   deno run -A tools/gen-prereg.ts        # or: deno task gen-prereg / pnpm gen:prereg
//
// The pure `renderEndpointsSection`/`applyGeneratedSection` functions below
// have no Deno (or Node) dependency -- they are reused as-is by
// tests/deno/prereg-sync.ts and experiments/test/prereg-sync.test.ts (under
// vitest/Node) to check the committed doc for staleness. Only the
// `import.meta.main` CLI block below touches the filesystem.
import { PRIMARY_ENDPOINTS, type Endpoint } from "../experiments/endpoints.ts";

export const MARK_START = "<!-- GENERATED:endpoints:start -->";
export const MARK_END = "<!-- GENERATED:endpoints:end -->";

/** Renders the numbered endpoint list, markers included, from `description` fields. */
export function renderEndpointsSection(endpoints: Endpoint[]): string {
  const items = endpoints.map((e, i) => `${i + 1}. ${e.description}`);
  return `${MARK_START}\n${items.join("\n")}\n${MARK_END}`;
}

/**
 * Replaces the text between the markers in `doc` with a freshly rendered
 * section. Throws if the markers are missing, duplicated in the wrong order,
 * or absent -- a doc without markers cannot be generated into, by design (it
 * must be added once, by hand, alongside the first `deno task gen-prereg`).
 */
export function applyGeneratedSection(doc: string, endpoints: Endpoint[]): string {
  const startIdx = doc.indexOf(MARK_START);
  const endIdx = doc.indexOf(MARK_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(
      `experiments/preregistration.md is missing the ${MARK_START} / ${MARK_END} markers around its endpoint list`,
    );
  }
  const before = doc.slice(0, startIdx);
  const after = doc.slice(endIdx + MARK_END.length);
  return `${before}${renderEndpointsSection(endpoints)}${after}`;
}

export type GenPlan =
  | { action: "noop" }
  | { action: "write"; next: string }
  | { action: "refuse"; reason: string };

/**
 * Pure decision of what `gen-prereg` should do, given the doc, the endpoint
 * spec and the (possibly empty) list of hashes ever recorded in
 * `experiments/FROZEN` -- factored out so the freeze-permanence policy is
 * unit-testable without touching the filesystem.
 *
 * Freeze policy: experiments/preregistration.md's own note freezes *this
 * file*, generated section included, once its whole-file SHA-256 is recorded
 * in `FROZEN`. Freezing is a one-way ratchet: it must survive every later
 * dated amendment, which by design changes the whole-file hash (the
 * amendment's own text is appended to the frozen original). Checking "is the
 * *current* hash in FROZEN" would only catch the exact moment of freezing --
 * the very next amendment changes the hash, drops out of FROZEN, and
 * silently un-freezes the generator against the doc's own stated policy. So
 * once `frozenHashes` has *ever* recorded a hash, this refuses to change the
 * generated section in place forever after, regardless of the doc's current
 * hash -- unless there is nothing to change (`next === doc`), which is
 * always safe to report as a no-op.
 */
export function planGeneration(doc: string, endpoints: Endpoint[], frozenHashes: string[]): GenPlan {
  const next = applyGeneratedSection(doc, endpoints);
  if (next === doc) return { action: "noop" };
  if (frozenHashes.length > 0) {
    return {
      action: "refuse",
      reason:
        "experiments/preregistration.md was frozen (experiments/FROZEN records " +
        `${frozenHashes.length} hash(es), most recently ${frozenHashes[frozenHashes.length - 1]}): freezing is ` +
        "permanent, even across later dated amendments, so the generator refuses to change the " +
        "generated section in place. Add a dated amendment section instead, per the doc's own freeze note.",
    };
  }
  return { action: "write", next };
}

if (import.meta.main) {
  const docUrl = new URL("../experiments/preregistration.md", import.meta.url);
  const frozenUrl = new URL("../experiments/FROZEN", import.meta.url);
  const doc = await Deno.readTextFile(docUrl);

  let frozen: string[] = [];
  try {
    frozen = (await Deno.readTextFile(frozenUrl)).split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    // No experiments/FROZEN yet: nothing has been frozen (pre-registration is still a draft).
  }

  const plan = planGeneration(doc, PRIMARY_ENDPOINTS, frozen);
  if (plan.action === "noop") {
    console.log("experiments/preregistration.md's generated section is already up to date.");
  } else if (plan.action === "refuse") {
    console.error(plan.reason);
    Deno.exit(1);
  } else {
    await Deno.writeTextFile(docUrl, plan.next);
    console.log("wrote experiments/preregistration.md");
  }
}
