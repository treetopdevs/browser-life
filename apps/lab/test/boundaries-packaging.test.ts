import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { expectPublicPage } from './support/public-page.ts';

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

describe('field prototype packaging', () => {
  it('is public: built, kept by the image, served, indexable and in the sitemap', () => {
    expectPublicPage('boundaries', 'boundaries: r("./boundaries/index.html")', ['boundaries-']);
    const caddy = read('deploy/Caddyfile');
    expect(caddy).not.toContain('respond @private_boundaries 404');
    expect(caddy).toContain('redir /boundaries /boundaries/{?query} 308');
  });
  it('keeps the entry and model chunks, and the model chunk name', () => {
    const vite = read('apps/lab/vite.config.ts');
    expect(vite).toContain('if (id.includes("/src/boundaries/model.ts")) return "boundaries-model"');
    const docker = read('Dockerfile.site');
    for (const path of ['apps/lab/dist/boundaries', 'apps/lab/dist/assets/boundaries-*.js', 'apps/lab/dist/assets/boundaries-*.css']) expect(docker).not.toContain(path);
  });
});
