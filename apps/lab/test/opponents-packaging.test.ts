import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { expectPublicPage } from './support/public-page.ts';
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
it('ships the opponents page with the site: built, kept by the image, served, indexable and in the sitemap', () => {
  expectPublicPage('opponents', 'opponents: r("./opponents/index.html")', ['opponents-']);
});
it('page text carries the caption and the CPU-only statement', () => {
  const html = read('apps/lab/opponents/index.html');
  expect(html).toContain('What this does not show');
  expect(html).toContain('CPU only');
  expect(html).toContain('no GPU evidence');
  expect(html).not.toContain('noindex');
  expect(html).toContain('synthetic');
  expect(html).toMatch(/<table id="matrix">[\s\S]*<caption/);
});
it('the site image keeps a self-contained asset graph after the Dockerfile deletions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bl-site-'));
  try {
    execFileSync('npx', ['vite', 'build', '--outDir', dir, '--emptyOutDir', '--logLevel', 'error'], { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'pipe' });
    const rm = read('Dockerfile.site').match(/&& rm -rf (.+)/)?.[1];
    const files = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)]);
    const all = files(dir).map((f) => relative(dir, f));
    const removed = new Set<string>();
    for (const token of (rm ?? '').split(/\s+/).filter(Boolean)) {
      const rel = token.replace(/^apps\/lab\/dist\//, '');
      const re = new RegExp(`^${rel.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}(/.*)?$`);
      for (const f of all) if (re.test(f)) removed.add(f);
    }
    expect([...removed].some((f) => f.startsWith('opponents/'))).toBe(false);
    expect(all).toContain('opponents/index.html');
    expect([...removed].some((f) => /^assets\/opponents-.*\.js$/.test(f))).toBe(false);
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
    expect(kept.has('opponents/index.html')).toBe(true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 180_000);
