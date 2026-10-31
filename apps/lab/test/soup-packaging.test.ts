import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
it('keeps the soup prototype outside the deployed site', () => {
  expect(read('apps/lab/vite.config.ts')).toContain('soup: r("./soup/index.html")');
  const docker = read('Dockerfile.site');
  for (const path of ['apps/lab/dist/soup', 'apps/lab/dist/assets/soup-*.js', 'apps/lab/dist/assets/soup-*.css']) expect(docker).toContain(path);
  const source = read('deploy/Caddyfile').match(/@private_soup path_regexp private_soup (.+)/)?.[1];
  expect(source).toBe('(?i)^/soup(?:/|$)');
  const route = new RegExp(source!.replace('(?i)', ''), 'i');
  for (const path of ['/soup', '/soup/', '/SOUP/index.html']) expect(route.test(path)).toBe(true);
  expect(route.test('/soup-other')).toBe(false);
});
