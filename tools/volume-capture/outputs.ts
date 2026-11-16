// Where tools/volume-capture/capture.ts may write and delete: inside --out only. --out itself may be a link (the caller chose
// it), but nothing below it that the tool touches may be: a symlinked frames/ or artifact would send writes, and the stale
// frame clean-up, outside --out. Checked before anything starts; tools/test/volume-capture.test.ts covers it.
import { closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
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

/**
 * Writes an artifact under --out without following a symlink at the file itself: prepareOut checked the path before the capture
 * ran, and this refuses (ELOOP) a link put there since. It does not re-check the directories above the file.
 */
export function writeOutFile(path: string, data: string | Uint8Array): void {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o644);
  try { writeFileSync(fd, data); } finally { closeSync(fd); }
}

function isLink(p: string): boolean {
  try { return lstatSync(p).isSymbolicLink(); } catch { return false; }
}
