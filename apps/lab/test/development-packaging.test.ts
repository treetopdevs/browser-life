import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
it('keeps the developmental world and chunks local-only', () => {
  const vite = read('apps/lab/vite.config.ts');
  expect(vite).toContain('development: r("./development/index.html")');
  expect(vite).toContain('return "development-model"');
  const docker = read('Dockerfile.site');
  for (const path of ['apps/lab/dist/development', 'apps/lab/dist/assets/development-*.js', 'apps/lab/dist/assets/development-*.css']) expect(docker).toContain(path);
  const caddy = read('deploy/Caddyfile');
  const pattern = caddy.match(/@private_development path_regexp private_development (.+)/)?.[1];
  expect(pattern).toBe('(?i)^/development(?:/|$)');
  const matcher = new RegExp(pattern!.replace('(?i)', ''), 'i');
  for (const path of ['/development', '/development/', '/DEVELOPMENT/index.html']) expect(matcher.test(path)).toBe(true);
  expect(matcher.test('/development-other')).toBe(false);
});
