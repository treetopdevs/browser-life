import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

it('keeps the mycelium world outside the deployed site', () => {
  expect(read('apps/lab/vite.config.ts')).toContain('mycelium: r("./mycelium/index.html")');
  const docker = read('Dockerfile.site');
  for (const path of ['apps/lab/dist/mycelium', 'apps/lab/dist/assets/mycelium-*.js', 'apps/lab/dist/assets/mycelium-*.css']) expect(docker).toContain(path);
  const caddy = read('deploy/Caddyfile');
  const source = caddy.match(/@private_mycelium path_regexp private_mycelium (.+)/)?.[1];
  expect(source).toBe('(?i)^/mycelium(?:/|$)');
  expect(caddy).toMatch(/respond @private_mycelium 404/);
  const route = new RegExp(source!.replace('(?i)', ''), 'i');
  for (const path of ['/mycelium', '/mycelium/', '/MYCELIUM/index.html']) expect(route.test(path)).toBe(true);
  expect(route.test('/mycelium-other')).toBe(false);
});

it('page text carries the caption and the CPU-only statement', () => {
  const html = read('apps/lab/mycelium/index.html');
  expect(html).toContain('Why this is not yet evidence of evolution');
  expect(html).toContain('CPU only');
  expect(html).toContain('does not use the GPU');
  expect(html).toContain('measurement-limited');
  expect(html).toContain('noindex');
  expect(html).toContain('heredity blocked');
});

it('no public page links to the private route', () => {
  for (const page of ['apps/lab/index.html', 'apps/lab/worlds/index.html', 'apps/lab/lab/index.html', 'apps/lab/research/index.html']) {
    expect(read(page)).not.toContain('/mycelium/');
  }
});
