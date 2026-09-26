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

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

if (import.meta.main) {
  const docUrl = new URL("../experiments/preregistration.md", import.meta.url);
  const frozenUrl = new URL("../experiments/FROZEN", import.meta.url);
  const doc = await Deno.readTextFile(docUrl);

  // Freeze policy: experiments/preregistration.md's own note freezes *this
  // file*, generated section included, once its whole-file SHA-256 is
  // recorded in experiments/FROZEN. Post-freeze, the generator must refuse
  // to overwrite in place and point at a dated amendment instead -- same as
  // any other change to a frozen pre-registration would require.
  const digest = await sha256Hex(doc);
  let frozen: string[] = [];
  try {
    frozen = (await Deno.readTextFile(frozenUrl)).split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    // No experiments/FROZEN yet: nothing has been frozen (pre-registration is still a draft).
  }
  if (frozen.includes(digest)) {
    console.error(
      "experiments/preregistration.md's current text is recorded in experiments/FROZEN " +
        `(sha256 ${digest}): the generated section may not be overwritten in place. ` +
        "Add a dated amendment section instead, per the doc's own freeze note.",
    );
    Deno.exit(1);
  }

  const next = applyGeneratedSection(doc, PRIMARY_ENDPOINTS);
  if (next === doc) {
    console.log("experiments/preregistration.md's generated section is already up to date.");
  } else {
    await Deno.writeTextFile(docUrl, next);
    console.log("wrote experiments/preregistration.md");
  }
}
