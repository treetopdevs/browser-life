// What "a public page" means for the packaging tests: a Vite input, not removed by Dockerfile.site, not answered 404
// by Caddy, open to search engines (no noindex), with a canonical link, listed in the sitemap and redirected to its slash.
// No page is held back. The one private matcher left is the shared garden's API, which stays closed until it opens.
import { readFileSync } from 'node:fs';
import { expect } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8');

/** The tokens of any `rm -rf` that follows the build in Dockerfile.site. Today there is none: the image ships the whole build. */
export function removedByImage(): string[] {
  const rm = read('Dockerfile.site').match(/&& rm -rf (.+)/)?.[1];
  return (rm ?? '').trim().split(/\s+/).filter(Boolean);
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
  // Opening day (#60) lifted the last hold, the garden API's, so the proxy holds nothing back.
  expect([...new Set(caddy.match(/@private_\w+/g) ?? [])], 'no page and no garden API is held back').toEqual([]);
  expect(caddy).toContain(`redir /${dir} /${dir}/{?query} 308`);

  const html = read(`apps/lab/${dir}/index.html`);
  expect(html).not.toMatch(/<meta[^>]+name="robots"[^>]*noindex/i);
  expect(html).toContain(`<link rel="canonical" href="https://cadence.garden/${dir}/" />`);
  expect(read('apps/lab/public/sitemap.xml')).toContain(`<loc>https://cadence.garden/${dir}/</loc>`);
}
