import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { expectPublicPage } from './support/public-page.ts';
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

it('ships the archive tournament page with the site: built, kept by the image, served, indexable and in the sitemap', () => {
  expectPublicPage('opponents/archive', 'opponentsArchive: r("./opponents/archive/index.html")', ['opponents-']);
  expect(read('apps/lab/vite.config.ts')).toContain('return "opponents-archive"');
});
it('page text carries the caption, the CPU-only statement and a captioned table', () => {
  const html = read('apps/lab/opponents/archive/index.html');
  for (const t of ['What this does not show', 'CPU only', 'no GPU evidence', 'synthetic', 'not the M3 environment']) expect(html).toContain(t);
  expect(html).not.toContain('noindex');
  expect(html).toMatch(/<table id="matrix">[\s\S]*<caption/);
  expect(html).toMatch(/<table id="naive">[\s\S]*<caption/);
  expect(read('apps/lab/opponents/index.html')).toContain('/opponents/archive/');
  expect(html).toContain('href="/opponents/"');
});
it('the built archive page and its chunks are kept by the Dockerfile removal line and the site graph stays self-contained', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bl-site-arch-'));
  try {
    execFileSync('npx', ['vite', 'build', '--outDir', dir, '--emptyOutDir', '--logLevel', 'error'], { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'pipe' });
    const rm = read('Dockerfile.site').match(/&& rm -rf (.+)/)?.[1];
    const files = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)]);
    const all = files(dir).map((f) => relative(dir, f));
    const removed = new Set<string>();
    for (const token of rm!.split(/\s+/)) {
      const rel = token.replace(/^apps\/lab\/dist\//, '');
      const re = new RegExp(`^${rel.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}(/.*)?$`);
      for (const f of all) if (re.test(f)) removed.add(f);
    }
    expect(removed.has('opponents/archive/index.html')).toBe(false);
    expect(all).toContain('opponents/archive/index.html');
    const chunks = all.filter((f) => /^assets\/opponents-archive-.*\.js$/.test(f));
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) expect(removed.has(c)).toBe(false);
    const kept = all.filter((f) => !removed.has(f) && /\.(html|js|css)$/.test(f));
    const dangling: string[] = [];
    for (const f of kept) for (const m of readFileSync(join(dir, f), 'utf8').matchAll(/(?:\.\/|\/?assets\/)([A-Za-z0-9_.-]+\.(?:js|css))/g)) if (removed.has(`assets/${m[1]}`)) dangling.push(`${f} -> ${m[1]}`);
    expect(dangling).toEqual([]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 240000);
