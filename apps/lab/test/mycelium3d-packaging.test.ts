// The 3D mycelium page (/mycelium3d/) is a public exploration page: built, kept by the site image, served with a slash
// redirect, indexable, in the sitemap and in the site image's page list, and reachable from the experiments index.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { PLAYTHINGS } from '../src/experiments/ledger.ts';
import { expectPublicPage } from './support/public-page.ts';

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

it('ships the 3D mycelium page with the site: built, kept by the image, served, indexable and in the sitemap', () => {
  expectPublicPage('mycelium3d', 'mycelium3d: r("./mycelium3d/index.html")', ['mycelium3d-']);
  expect(read('tools/test/site-image.test.ts')).toContain('"/mycelium3d/"');
  expect(PLAYTHINGS.some((p) => p.href === '/mycelium3d/')).toBe(true);
});

it('says it is an exploration with no results claimed', () => {
  const html = read('apps/lab/mycelium3d/index.html');
  expect(html).toContain('Exploration, not a result');
  expect(html).toContain('no results claimed');
  expect(html).toContain('Why this is not a result');
  expect(html).not.toMatch(/noindex|Private page/i);
});
