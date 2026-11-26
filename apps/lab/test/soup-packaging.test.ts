import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
it('ships the program soup page with the site', () => {
  expect(read('apps/lab/vite.config.ts')).toContain('soup: r("./soup/index.html")');
  // The site image keeps the built page and its assets: nothing named soup is removed after the build.
  expect(read('Dockerfile.site')).not.toMatch(/dist\/(?:assets\/)?soup/);
  const caddy = read('deploy/Caddyfile');
  expect(caddy).not.toMatch(/private_soup|\^\/soup/);
  expect(caddy).toContain('redir /soup /soup/{?query} 308');
  const page = read('apps/lab/soup/index.html');
  expect(page).not.toContain('noindex');
  expect(page).toContain('<link rel="canonical" href="https://cadence.garden/soup/" />');
});
