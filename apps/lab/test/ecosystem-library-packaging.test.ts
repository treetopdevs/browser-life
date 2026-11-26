import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { expectPublicPage } from './support/public-page.ts';
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
it('ships the ecosystem, its archive and the library with the site, media included', () => {
  expectPublicPage('ecosystem', 'ecosystem: r("./ecosystem/index.html")', ['ecosystem-', 'ecosystemArchive']);
  expectPublicPage('ecosystem/archive', 'ecosystemArchive: r("./ecosystem/archive/index.html")', ['ecosystemArchive']);
  expectPublicPage('playground', 'playground: r("./playground/index.html")', ['playground-']);
  const docker = read('Dockerfile.site');
  for (const pattern of ['assets/ecosystem-*.mp4', 'assets/ecosystem-*.json', 'assets/ecosystemArchive*.json']) expect(docker).not.toContain(pattern);
});
