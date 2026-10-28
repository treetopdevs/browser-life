import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
it('keeps the hungry-shapes world and chunks local-only', () => {
  const vite = read('apps/lab/vite.config.ts');
  expect(vite).toContain('hungryShapes: r("./hungry-shapes/index.html")');
  expect(vite).toContain('return "hungry-shapes-model"');
  const docker = read('Dockerfile.site');
  for (const path of ['apps/lab/dist/hungry-shapes', 'apps/lab/dist/assets/hungryShapes*.js', 'apps/lab/dist/assets/hungryShapes*.css', 'apps/lab/dist/assets/hungry-shapes*.js', 'apps/lab/dist/assets/hungry-shapes*.css']) expect(docker).toContain(path);
  const caddy = read('deploy/Caddyfile');
  const pattern = caddy.match(/@private_hungry path_regexp private_hungry (.+)/)?.[1];
  expect(pattern).toBe('(?i)^/hungry-shapes(?:/|$)');
  const matcher = new RegExp(pattern!.replace('(?i)', ''), 'i');
  for (const path of ['/hungry-shapes', '/hungry-shapes/', '/HUNGRY-SHAPES/index.html']) expect(matcher.test(path)).toBe(true);
  expect(matcher.test('/hungry-shapes-other')).toBe(false);
});
