import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
it('keeps the niche prototype outside the deployed site', () => {
  expect(read('apps/lab/vite.config.ts')).toContain('niche: r("./niche/index.html")');
  const docker = read('Dockerfile.site');
  for (const path of ['apps/lab/dist/niche', 'apps/lab/dist/assets/niche-*.js', 'apps/lab/dist/assets/niche-*.css']) expect(docker).toContain(path);
  const source = read('deploy/Caddyfile').match(/@private_niche path_regexp private_niche (.+)/)?.[1];
  expect(source).toBe('(?i)^/niche(?:/|$)');
  expect(read('deploy/Caddyfile')).toMatch(/respond @private_niche 404/);
  const route = new RegExp(source!.replace('(?i)', ''), 'i');
  for (const path of ['/niche', '/niche/', '/NICHE/index.html']) expect(route.test(path)).toBe(true);
  expect(route.test('/niche-other')).toBe(false);
  expect(route.test('/nichebox')).toBe(false);
});
it('page text carries the caption, the CPU-only statement and noindex', () => {
  const html = read('apps/lab/niche/index.html');
  expect(html).toContain('Exploratory, CPU only, no GPU evidence');
  expect(html).toContain('noindex');
  expect(html).toContain('no causal benefit detected');
  expect(html).toMatch(/<table>[\s\S]*<caption>/);
});
it('the site image keeps a self-contained asset graph after the Dockerfile deletions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bl-site-niche-'));
  try {
    execFileSync('npx', ['vite', 'build', '--outDir', dir, '--emptyOutDir', '--logLevel', 'error'], { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'pipe' });
    const rm = read('Dockerfile.site').match(/&& rm -rf (.+)/)?.[1];
    expect(rm).toBeTruthy();
    const files = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)]);
    const all = files(dir).map((f) => relative(dir, f));
    const removed = new Set<string>();
    for (const token of rm!.split(/\s+/)) {
      const rel = token.replace(/^apps\/lab\/dist\//, '');
      const re = new RegExp(`^${rel.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}(/.*)?$`);
      for (const f of all) if (re.test(f)) removed.add(f);
    }
    expect([...removed].some((f) => f.startsWith('niche/'))).toBe(true);
    expect([...removed].some((f) => /^assets\/niche-.*\.js$/.test(f))).toBe(true);
    const kept = new Set(all.filter((f) => !removed.has(f)));
    const dangling: string[] = [];
    for (const f of kept) {
      if (!/\.(html|js|css)$/.test(f)) continue;
      const text = readFileSync(join(dir, f), 'utf8');
      for (const m of text.matchAll(/(?:\.\/|\/?assets\/)([A-Za-z0-9_.-]+\.(?:js|css))/g)) {
        const target = `assets/${m[1]}`;
        if (all.includes(target) && !kept.has(target)) dangling.push(`${f} -> ${target}`);
      }
    }
    expect(dangling).toEqual([]);
    expect(kept.has('lab/index.html')).toBe(true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
