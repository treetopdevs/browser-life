import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { expectPublicPage } from './support/public-page.ts';
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
it('ships the motif gallery page with the site: built, kept by the image, served, indexable and in the sitemap', () => {
  expectPublicPage('particles/motifs', 'particleMotifs: r("./particles/motifs/index.html")', ['particleMotifs-', 'particles-']);
  expect(read('apps/lab/vite.config.ts')).toContain('return "particles-motifs-model"');
});
