import { it } from 'vitest';
import { expectPublicPage } from './support/public-page.ts';
it('ships the spatial page with the site: built, kept by the image, served, indexable and in the sitemap', () => {
  expectPublicPage('spatial', 'spatial: r("./spatial/index.html")', ['spatial-']);
});
