// The source of tools/run.ts's `--branch-from DIR --branch-boundary B` (the transition hunt's "Branch contract"): the
// pre-cycle checkpoint of boundary B in a run bundle, found through the bundle's own manifest and checked against the
// hash listed there. Kept apart from run.ts (a script that needs a GPU) so the loading and its refusals have tests.
import { decodeArtifact, type BranchSpec } from "@bl/runner";
import { stateHash, type WorldState } from "@bl/schema";

/** File access of `branchSource`: Deno's by default, node's `readFile` in tests. */
export interface BranchSourceIO {
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
}

const denoIO: BranchSourceIO = { readText: (p) => Deno.readTextFile(p), readBytes: (p) => Deno.readFile(p) };

/** Why the two flags do not go together (exactly one of them was given), or null when both or neither were. */
export function branchFlagsError(from: string | undefined, boundary: string | undefined): string | null {
  return (from === undefined) !== (boundary === undefined) ? "--branch-from and --branch-boundary go together" : null;
}

/**
 * The source of `--branch-from`: its pre-cycle checkpoint for `boundary`, found in the bundle's manifest and checked
 * against the hash listed there. `branch.source` is `dir` as given less trailing slashes (the path recorded in every
 * branch run's spec and manifest), `branch.sourceHash` the manifest's hash. Throws, naming the file, when the manifest
 * lists no such checkpoint, the file cannot be read or decoded, or its state hashes to anything but the listed hash.
 */
export async function branchSource(dir: string, boundary: number, io: BranchSourceIO = denoIO): Promise<{ branch: BranchSpec; state: WorldState }> {
  const manifest = JSON.parse(await io.readText(`${dir}/manifest.json`));
  const entry = (manifest.preCycleCheckpoints ?? []).find((e: { boundary: number }) => e.boundary === boundary);
  if (!entry) throw new Error(`${dir}/manifest.json lists no pre-cycle checkpoint for boundary ${boundary} (a complete bundle run with --pre-cycle ${boundary} does)`);
  const { state } = decodeArtifact(await io.readBytes(`${dir}/${entry.file}`));
  if (stateHash(state) !== entry.hash) throw new Error(`${dir}/${entry.file} has state hash ${stateHash(state)}, not the manifest's ${entry.hash}`);
  return { branch: { source: dir.replace(/\/+$/, ""), sourceHash: entry.hash, boundary }, state };
}
