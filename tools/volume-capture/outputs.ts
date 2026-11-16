// Where tools/volume-capture/capture.ts may write and delete: inside --out only. --out itself may be a link (the caller chose
// it), but nothing below it that the tool touches may be: a symlinked frames/ or artifact would send writes, and the stale
// frame clean-up, outside --out. Checked before anything starts; tools/test/volume-capture.test.ts covers it.
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

export class OutputError extends Error {}

export const FRAME_FILE = /^frame-\d{4}\.png$/;

/**
 * Creates --out and `dirs` under it, and checks every directory and file the capture will create, overwrite or delete
 * (`files`, plus any stale frame-NNNN.png in `dirs`): each relative path stays under --out's real path and no existing
 * component is a symlink. Returns --out's real path, which the caller then writes under.
 */
export function prepareOut(out: string, dirs: readonly string[], files: readonly string[]): string {
  if (existsSync(out) && !statSync(out).isDirectory()) throw new OutputError(`--out ${out} exists and is not a directory`);
  mkdirSync(out, { recursive: true });
  const root = realpathSync(out);
  const check = (rel: string) => {
    if (isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) throw new OutputError(`output path ${rel} is not under --out`);
    let p = root;
    for (const part of rel.split(/[\\/]/).filter(Boolean)) {
      p = join(p, part);
      if (!existsSync(p) && !isLink(p)) return;
      if (isLink(p)) throw new OutputError(`refusing to write through a symlink: ${p}`);
      const real = realpathSync(p);
      const r = relative(root, real);
      if (r.startsWith("..") || isAbsolute(r) || r.split(sep)[0] === "..") throw new OutputError(`${p} resolves outside --out (${real})`);
    }
  };
  for (const d of dirs) {
    check(d);
    mkdirSync(join(root, d), { recursive: true });
    for (const f of readdirSync(join(root, d))) if (FRAME_FILE.test(f)) check(join(d, f)); // the stale frames the capture deletes
  }
  for (const f of files) check(f);
  return root;
}

function isLink(p: string): boolean {
  try { return lstatSync(p).isSymbolicLink(); } catch { return false; }
}
