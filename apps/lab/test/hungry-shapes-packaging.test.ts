import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { expectPublicPage } from './support/public-page.ts';
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
it('ships the hungry-shapes page with the site: built, kept by the image, served, indexable and in the sitemap', () => {
  expectPublicPage('hungry-shapes', 'hungryShapes: r("./hungry-shapes/index.html")', ['hungryShapes', 'hungry-shapes']);
  expect(read('apps/lab/vite.config.ts')).toContain('return "hungry-shapes-model"');
});
