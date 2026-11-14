import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { expectPublicPage } from './support/public-page.ts';
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
it('ships the controller-locality page with the site: built, kept by the image, served, indexable and in the sitemap', () => {
  expectPublicPage('controller-locality', 'controllerLocality: r("./controller-locality/index.html")', ['controllerLocality-']);
});
it('page text carries the CPU-only, exploratory and bounded-to-tested-genomes statements', () => {
  const html = read('apps/lab/controller-locality/index.html');
  expect(html).toContain('CPU only');
  expect(html).toContain('no GPU evidence');
  expect(html).toContain('Exploratory');
  expect(html).toContain('bounded to the tested genomes');
  expect(html).not.toContain('noindex');
  expect(html).toMatch(/<table id="matrix"><caption>/);
  expect(html).toContain('What this does not show');
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
    expect([...removed].some((f) => f.startsWith('controller-locality/'))).toBe(false);
    expect(all).toContain('controller-locality/index.html');
    expect([...removed].some((f) => /^assets\/controllerLocality-.*\.js$/.test(f))).toBe(false);
    const kept = new Set(all.filter((f) => !removed.has(f)));
    const dangling: string[] = [];
    for (const f of kept) {
      if (!/\.(html|js|css)$/.test(f)) continue;
      const text = readFileSync(join(dir, f), 'utf8');
      for (const m of text.matchAll(/(?:\.\/|\/?assets\/)([A-Za-z0-9_.-]+\.(?:js|css))/g)) {
        const target = `assets/${m[1]}`;
        if (!kept.has(target) && (all.includes(target) || f.endsWith('.html'))) dangling.push(`${f} -> ${target}`);
      }
    }
    expect(dangling).toEqual([]);
    expect(kept.has('lab/index.html')).toBe(true);
    expect(kept.has('controller-locality/index.html')).toBe(true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 180_000);
