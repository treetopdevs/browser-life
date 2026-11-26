import { existsSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { removedByImage } from './support/public-page.ts';
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

// The bodies page is built and shipped but unlisted: not in the sitemap, nav, playthings, worlds or ledger.
it('builds the bodies page and keeps it with the image', () => {
  const vite = read('apps/lab/vite.config.ts');
  expect(vite).toContain('bodies: r("./bodies/index.html")');
  expect(vite).toContain('return "bodies-model"');
  expect(removedByImage().filter((t) => t.startsWith('apps/lab/dist/bodies'))).toEqual([]);
  expect(existsSync(new URL('../../../apps/lab/bodies/index.html', import.meta.url))).toBe(true);
  const html = read('apps/lab/bodies/index.html');
  expect(html).toMatch(/<title>[^<]+<\/title>/);
  expect(html).toContain('<meta name="robots" content="noindex" />');
  expect(html).toContain('src="/src/bodies/page.ts"');
});
it('stays unlisted', () => {
  expect(read('apps/lab/public/sitemap.xml')).not.toContain('/bodies/');
  for (const f of ['apps/lab/index.html', 'apps/lab/src/experiments/ledger.ts', 'apps/lab/worlds/index.html']) expect(read(f), f).not.toContain('/bodies/');
});
