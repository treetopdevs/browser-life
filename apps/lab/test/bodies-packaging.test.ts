import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { expectPublicPage } from './support/public-page.ts';
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

// The bodies page is public since 27 Nov 2026: built, shipped, indexable, in the sitemap, and reached from its result.
it('ships the bodies page with the site', () => {
  expectPublicPage('bodies', 'bodies: r("./bodies/index.html")', ['bodies-model']);
  expect(read('apps/lab/vite.config.ts')).toContain('return "bodies-model"');
  const html = read('apps/lab/bodies/index.html');
  expect(html).toMatch(/<title>[^<]+<\/title>/);
  expect(html).toContain('src="/src/bodies/page.ts"');
});
it('is reached from its result and the story, and stays out of the home page and the world catalogue', () => {
  for (const f of ['apps/lab/src/experiments/ledger.ts', 'apps/lab/story/index.html']) expect(read(f), f).toContain('/bodies/');
  // A prototype, not one of the lab's worlds: the home page and the catalogue do not offer it.
  for (const f of ['apps/lab/index.html', 'apps/lab/worlds/index.html']) expect(read(f), f).not.toContain('/bodies/');
});
