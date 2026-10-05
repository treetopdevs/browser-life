// Deno CLI support: refuse output reuse and bind an assay to its executable sources.
import { dirname } from "node:path";
export async function newConstructionOutput(out: string): Promise<void> {
  await Deno.mkdir(dirname(out), { recursive: true });
  // Atomic directory creation: even an interrupted run without a manifest is protected.
  await Deno.mkdir(out);
}
export async function constructionProvenance(extraPaths: string[] = []): Promise<
  Record<string, string>
> {
  const sources = [
    "tools/construction-search.ts",
    "tools/construction-witness.ts",
    "tools/lib/construction.ts",
    "tools/lib/construction-transport.ts",
    "tools/lib/construction-provenance.ts",
    "packages/schema/src/config.ts",
    "packages/schema/src/world.ts",
    "packages/schema/src/genome.ts",
    "packages/schema/src/layout.ts",
    "packages/schema/src/int.ts",
    "packages/schema/src/kernel.ts",
    "packages/sim-ref/src/step.ts",
  ];
  const hashes: Record<string, string> = {};
  for (const path of [...sources, ...extraPaths]) {
    const bytes = await Deno.readFile(path);
    hashes[path] = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      (x) => x.toString(16).padStart(2, "0"),
    ).join("");
  }
  return hashes;
}
