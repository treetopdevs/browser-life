// What "a public page" means for the packaging tests: a Vite input, not removed by Dockerfile.site, not answered 404
// by Caddy, open to search engines (no noindex), with a canonical link, listed in the sitemap and redirected to its slash.
// The shared garden is the one page still held back; its own tests say so.
import { readFileSync } from 'node:fs';
import { expect } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8');

/** The tokens of the Dockerfile.site `rm -rf` that follows the build. */
export function removedByImage(): string[] {
  const rm = read('Dockerfile.site').match(/&& rm -rf (.+)/)?.[1];
  expect(rm, 'Dockerfile.site has an rm -rf after the build').toBeTruthy();
  return rm!.trim().split(/\s+/);
}

/**
 * `dir` is the page's path under apps/lab ("particles/bonds"), `viteEntry` its line in vite.config.ts, `chunks` the
 * asset name prefixes its build emits ("movingLight-"), none of which the image may delete.
 */
export function expectPublicPage(dir: string, viteEntry: string, chunks: string[] = []): void {
  expect(read('apps/lab/vite.config.ts')).toContain(viteEntry);

  const tokens = removedByImage();
  expect(tokens.filter((t) => t.startsWith(`apps/lab/dist/${dir}`)), `the image removes ${dir}`).toEqual([]);
  for (const chunk of chunks) expect(tokens.filter((t) => t.startsWith(`apps/lab/dist/assets/${chunk}`)), `the image removes ${chunk}*`).toEqual([]);

  const caddy = read('deploy/Caddyfile');
  const escaped = dir.replace(/[.+?^${}()|[\]\\/-]/g, '\\$&');
  expect(caddy, `Caddy answers 404 for ${dir}`).not.toMatch(new RegExp(`\\^/${escaped}\\(\\?:`));
  expect(caddy.match(/@private_\w+/g)?.filter((m) => m !== '@private_garden') ?? [], 'only the garden is held back').toEqual([]);
  expect(caddy).toContain(`redir /${dir} /${dir}/{?query} 308`);

  const html = read(`apps/lab/${dir}/index.html`);
  expect(html).not.toMatch(/<meta[^>]+name="robots"[^>]*noindex/i);
  expect(html).toContain(`<link rel="canonical" href="https://cadence.garden/${dir}/" />`);
  expect(read('apps/lab/public/sitemap.xml')).toContain(`<loc>https://cadence.garden/${dir}/</loc>`);
}
