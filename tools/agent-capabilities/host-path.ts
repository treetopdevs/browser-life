import { existsSync, realpathSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { check } from './contracts.ts';

/** Host state must live in a private owned directory outside any Git/JJ checkout, including aliases. */
export function hostDirectory(path: string): void {
  let current = realpathSync(path);
  const stat = statSync(current);
  check(stat.isDirectory() && (stat.mode & 0o077) === 0 && stat.uid === process.getuid?.(), 'UNSAFE_JOURNAL');
  while (true) {
    check(!existsSync(join(current, '.git')) && !existsSync(join(current, '.jj')), 'UNSAFE_JOURNAL');
    const parent = dirname(current); if (parent === current) return; current = parent;
  }
}
