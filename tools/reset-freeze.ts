/** Preserve exact execution sources and reauthenticate the independently pinned inputs.
 * A successful snapshot is evidence, not scientific launch authorization.
 */
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";

const root = "/Users/nicholas/develop/browser-life-foundations";
const base = join(root, "runs/foundational-reset");
const name = Deno.args[0];
if (Deno.args.length !== 1 || !name || !/^[a-z][a-z0-9-]{2,70}$/.test(name))
  throw new Error("usage: reset-freeze.ts <unique-snapshot-name>");
if (resolve(Deno.cwd()) !== root) throw new Error("use the foundations workspace");
const out = join(base, name);
await Deno.mkdir(out); // An existing attempt is never overwritten.

type Identity = { path: string; bytes: number; sha256: string };
const hashBytes = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function identity(path: string): Promise<Identity> {
  const hash = createHash("sha256"); let bytes = 0;
  const f = await Deno.open(path);
  for await (const chunk of f.readable) { hash.update(chunk); bytes += chunk.length; }
  return { path, bytes, sha256: hash.digest("hex") };
}
async function walk(path: string): Promise<string[]> {
  const found: string[] = [];
  for await (const e of Deno.readDir(path)) {
    if (e.isSymlink) throw new Error(`source tree contains a symlink: ${join(path, e.name)}`);
    if (e.isDirectory) {
      if (!["node_modules", "dist", ".git", ".jj"].includes(e.name))
        found.push(...await walk(join(path, e.name)));
    } else if (e.isFile && e.name.endsWith(".ts")) found.push(join(path, e.name));
  }
  return found;
}
async function sourceInventory(): Promise<string[]> {
  const names = new Set<string>([
    ...await walk(join(root, "packages")), ...await walk(join(root, "tools/lib")),
    ...["deno.json", "deno.lock", "package.json", "tsconfig.json",
      "docs/foundational-reset-plan.md", "docs/reset-entity-contract.md",
      "docs/reset-probe-a-protocol.md", "docs/reset-claim-code-map.md"].map(p => join(root, p)),
  ]);
  for (const directory of ["tools", "tools/test"])
    for await (const e of Deno.readDir(join(root, directory)))
      if (e.isFile && e.name.startsWith("reset-") && e.name.endsWith(".ts"))
        names.add(join(root, directory, e.name));
  return [...names].sort();
}
const started = performance.now();
const receipt: Record<string, unknown> = {
  format: 1, status: "pending", createdAt: new Date().toISOString(), workspace: root,
  purpose: "Exact source preservation and historical input authentication; not gate approval",
  sources: [], inputs: [], evidence: [], baselines: [],
};
try {
  const reconciliationPath = join(base, "main-manifest-reconciliation-v1.json");
  const reconciliationBytes = await Deno.readFile(reconciliationPath);
  if (hashBytes(reconciliationBytes) !== "7532b62cae0132f6e9a1fb3cfff2c95370025c04c985498d179dbc2f896baae1")
    throw new Error("independent reconciliation receipt changed");
  const reconciliation = JSON.parse(new TextDecoder().decode(reconciliationBytes));
  if (reconciliation.status !== "complete") throw new Error("independent inputs not reconciled");
  const localInputsPath = join(base, "inputs-v2.json");
  const localInputsBytes = await Deno.readFile(localInputsPath);
  if (hashBytes(localInputsBytes) !== "9e23de81bee51057baadc6ed765c8d3c9eafc0696051f788fd5b93846ec23dec")
    throw new Error("original local input inventory changed");
  const pinnedInputs = new Map<string, Identity>(
    JSON.parse(new TextDecoder().decode(localInputsBytes)).files.map((r: Identity) => [r.path, r]));
  const baselineRoot = join(base, "pinned-source-v1");
  const baselineManifest = JSON.parse(await Deno.readTextFile(join(baselineRoot, "manifest.json")));
  if (!Array.isArray(baselineManifest.files) || baselineManifest.files.length !== 103)
    throw new Error("unexpected baseline source inventory");
  const seenBaselines = new Set<string>();
  for (const row of baselineManifest.files) {
    const rel = relative(baselineRoot, row.snapshot);
    const expected = pinnedInputs.get(row.original);
    if (!rel || rel.startsWith("..") || seenBaselines.has(row.original) ||
        !expected || expected.sha256 !== row.sha256 || expected.bytes !== row.bytes)
      throw new Error("baseline source differs from pinned input inventory");
    seenBaselines.add(row.original);
    const bytes = await Deno.readFile(row.snapshot);
    if (bytes.length !== expected.bytes || hashBytes(bytes) !== expected.sha256)
      throw new Error(`saved baseline source drift: ${row.snapshot}`);
    const savedPath = join(out, "baseline", rel);
    await Deno.mkdir(dirname(savedPath), { recursive: true });
    await Deno.writeFile(savedPath, bytes, { createNew: true });
    (receipt.baselines as unknown[]).push({ path: row.original, savedPath,
      bytes: bytes.length, sha256: expected.sha256 });
  }
  const rows = reconciliation.comparisons as Identity[];
  if (!Array.isArray(rows) || rows.length !== 331 || new Set(rows.map(r => r.path)).size !== rows.length)
    throw new Error("unexpected independently reconciled input inventory");
  for (const row of rows) {
    const rel = relative("/Users/nicholas/develop/browser-life", row.path);
    if (!rel || rel.startsWith("..") || !/^[a-f0-9]{64}$/.test(row.sha256))
      throw new Error("invalid independently reconciled input path or digest");
    const actual = await identity(row.path);
    if (actual.bytes !== row.bytes || actual.sha256 !== row.sha256)
      throw new Error(`historical input drift: ${row.path}`);
    (receipt.inputs as Identity[]).push(actual);
  }
  const names = await sourceInventory();
  for (const path of names) {
    const bytes = await Deno.readFile(path);
    const savedPath = join(out, "source", relative(root, path));
    await Deno.mkdir(dirname(savedPath), { recursive: true });
    await Deno.writeFile(savedPath, bytes, { createNew: true });
    (receipt.sources as unknown[]).push({ path, savedPath, bytes: bytes.length, sha256: hashBytes(bytes) });
  }
  // Detect edits while the inventory was being copied. Launch must also check for later edits.
  if (JSON.stringify(await sourceInventory()) !== JSON.stringify(names))
    throw new Error("source inventory changed during snapshot");
  for (const row of receipt.sources as Identity[]) {
    const actual = await identity(row.path);
    if (actual.bytes !== row.bytes || actual.sha256 !== row.sha256)
      throw new Error(`source changed during snapshot: ${row.path}`);
  }
  for (const path of [reconciliationPath, reconciliation.manifestPath,
    join(base, "inputs-v2.json"), join(base, "input-preflight-v3.json"),
    join(base, "original-replay-reconciliation-v1.json"), join(base, "pinned-source-v1/manifest.json"),
    join(base, "reset-seed-status-v1.json"), join(base, "probe-a-design-v1.json"),
    join(base, "probe-a-design-v2.json"), join(base, "initial-state-preflight-v1.json"),
    join(base, "gpu-original-100k-1790699102958.json"),
    join(base, "gpu-integrated-window-1790700100365.json"),
    join(base, "gpu-passive-control-1790697977544.json"),
    join(base, "gpu-stream-prefix-1790700556542.json")]) {
    const bytes = await Deno.readFile(path);
    const savedPath = join(out, "evidence", (receipt.evidence as unknown[]).length + "-" + path.split("/").at(-1));
    await Deno.mkdir(dirname(savedPath), { recursive: true });
    await Deno.writeFile(savedPath, bytes, { createNew: true });
    (receipt.evidence as unknown[]).push({ path, savedPath, bytes: bytes.length, sha256: hashBytes(bytes) });
  }
  const mainIdentity = await identity(reconciliation.manifestPath);
  if (mainIdentity.sha256 !== reconciliation.manifestIdentity.sha256 ||
      mainIdentity.bytes !== reconciliation.manifestIdentity.bytes)
    throw new Error("main input manifest changed after reconciliation");
  receipt.status = "complete-not-launch-approval";
} catch (error) {
  receipt.status = "failed";
  receipt.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  receipt.elapsedSeconds = (performance.now() - started) / 1000;
  await Deno.writeTextFile(join(out, "manifest.json"), JSON.stringify(receipt, null, 2) + "\n", { createNew: true });
  console.log(JSON.stringify({ out, status: receipt.status,
    sourceCount: (receipt.sources as unknown[]).length,
    inputCount: (receipt.inputs as unknown[]).length, elapsedSeconds: receipt.elapsedSeconds }));
}
