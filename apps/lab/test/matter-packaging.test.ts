import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
it('keeps the matter aquarium and chunks local-only', () => {
  const vite = read('apps/lab/vite.config.ts');
  expect(vite).toContain('matter: r("./matter/index.html")');
  expect(vite).toContain('return "matter-model"');
  const docker = read('Dockerfile.site');
  for (const path of ['apps/lab/dist/matter', 'apps/lab/dist/assets/matter-*.js', 'apps/lab/dist/assets/matter-*.css']) expect(docker).toContain(path);
  const pattern = read('deploy/Caddyfile').match(/@private_matter path_regexp private_matter (.+)/)?.[1];
  expect(pattern).toBe('(?i)^/matter(?:/|$)');
  const matcher = new RegExp(pattern!.replace('(?i)', ''), 'i');
  for (const path of ['/matter', '/matter/', '/MATTER/index.html']) expect(matcher.test(path)).toBe(true);
  expect(matcher.test('/matter-other')).toBe(false);
});
