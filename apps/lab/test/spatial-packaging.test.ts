import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
it('keeps the spatial prototype outside the deployed site', () => {
  expect(read('apps/lab/vite.config.ts')).toContain('spatial: r("./spatial/index.html")');
  const docker = read('Dockerfile.site');
  for (const path of ['apps/lab/dist/spatial', 'apps/lab/dist/assets/spatial-*.js', 'apps/lab/dist/assets/spatial-*.css']) expect(docker).toContain(path);
  const source = read('deploy/Caddyfile').match(/@private_spatial path_regexp private_spatial (.+)/)?.[1];
  expect(source).toBe('(?i)^/spatial(?:/|$)');
  const route = new RegExp(source!.replace('(?i)', ''), 'i');
  for (const path of ['/spatial', '/spatial/', '/SPATIAL/index.html']) expect(route.test(path)).toBe(true);
  expect(route.test('/spatial-other')).toBe(false);
});
