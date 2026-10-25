/** Bounded manifest inventory; never read large per-census tables. */
export async function seedInventory(reserved: number[]) {
  const wanted = new Set(reserved);
  const checked: string[] = [], collisions: { path: string; key: string; value: number }[] = [], oversized: string[] = [];
  function inspect(value: unknown, path: string, key = "") {
    if (typeof value === "number") {
      if (/seed/i.test(key) && wanted.has(value)) collisions.push({ path, key, value });
    } else if (Array.isArray(value)) value.forEach(v => inspect(v, path, key));
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) inspect(v, path, /seed/i.test(key) ? `${key}.${k}` : k);
  }
  async function walk(path: string) {
    for await (const e of Deno.readDir(path)) {
      if (e.isSymlink || ["node_modules", ".git", ".jj", "_build", "deps", "vendor"].includes(e.name)) continue;
      const p = `${path}/${e.name}`;
      if (e.isDirectory) { await walk(p); continue; }
      if (!e.isFile || !/\.json$/.test(e.name) || !/(manifest|plan|config|rule|seed|result|summary|acceptance|case|job|^r\d+)/i.test(e.name)) continue;
      const stat = await Deno.stat(p);
      if (stat.size > 5 * 1024 ** 2) { oversized.push(p); continue; }
      const data = JSON.parse(await Deno.readTextFile(p));
      checked.push(p); inspect(data, p);
    }
  }
  for (const root of ["runs", "experiments", ".claude/worktrees"]) {
    try { await walk(root); } catch (e) { if (!(e instanceof Deno.errors.NotFound)) throw e; }
  }
  if (collisions.length) throw new Error(`seed collision: ${JSON.stringify(collisions)}`);
  // A too-large candidate manifest is uncertainty, not evidence of fresh seeds.
  const largeManifests = oversized.filter(p => /\/(manifest|.*plan|.*config|.*rule|.*seed)\.json$/i.test(p));
  if (largeManifests.length) throw new Error(`seed manifest exceeds audit bound: ${largeManifests.join(",")}`);
  return { checked: checked.sort(), oversizedNonManifestFiles: oversized.sort(), collisions,
    scope: "accessible JSON manifest/plan/config/rule/seed/result/summary/acceptance/case/job/rN names under runs, experiments, and local .claude/worktrees; numeric seed fields; symlinks/dependencies skipped" };
}
