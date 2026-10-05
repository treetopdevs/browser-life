// Clade roots from mutations.tsv (columns childHi childLo parentHi parentLo, header first).
// Keys are "hi:lo" strings: a numeric hi * 2^32 + lo loses precision once hi > 2^21 (runs past
// ~2.1e6 steps). Pure: takes lines, so vitest can load it.

/** child -> parent; the first row for a child wins (as in tools/recurrence-x.ts). */
export async function parentMap(lines: AsyncIterable<string>): Promise<Map<string, string>> {
  const parents = new Map<string, string>();
  let first = true;
  for await (const l of lines) {
    if (first) {
      first = false;
      continue;
    }
    if (!l) continue;
    const f = l.split("\t");
    const child = `${f[0]}:${f[1]}`;
    if (!parents.has(child)) parents.set(child, `${f[2]}:${f[3]}`);
  }
  return parents;
}

/** Memoised walk to the lineage that is nobody's child. Throws on a cycle. */
export function rootWalker(parents: Map<string, string>): (key: string) => string {
  const memo = new Map<string, string>();
  return (key: string) => {
    const path: string[] = [];
    const seen = new Set<string>();
    let x = key, root: string;
    for (;;) {
      const m = memo.get(x);
      if (m !== undefined) {
        root = m;
        break;
      }
      if (seen.has(x)) throw new Error(`mutations.tsv parent links form a cycle at ${x}`);
      seen.add(x);
      path.push(x);
      const p = parents.get(x);
      if (p === undefined) {
        root = x;
        break;
      }
      x = p;
    }
    for (const y of path) memo.set(y, root);
    return root;
  };
}
