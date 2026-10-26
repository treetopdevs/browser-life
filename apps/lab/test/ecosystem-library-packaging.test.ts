import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
it('keeps ecosystem, archive media and library outside production', () => {
 const vite = read('apps/lab/vite.config.ts');
 for (const entry of ['ecosystem: r("./ecosystem/index.html")', 'ecosystemArchive: r("./ecosystem/archive/index.html")', 'playground: r("./playground/index.html")']) expect(vite).toContain(entry);
 const docker = read('Dockerfile.site');
 for (const pattern of ['dist/ecosystem', 'dist/playground', 'assets/ecosystem-*.js', 'assets/ecosystem-*.css', 'assets/ecosystem-*.mp4', 'assets/ecosystemArchive*.js', 'assets/ecosystemArchive*.css', 'assets/playground-*.js', 'assets/playground-*.css']) expect(docker).toContain(pattern);
 for (const route of ['ecosystem','playground']) {
  const source = read('deploy/Caddyfile').match(new RegExp(`@private_${route} path_regexp private_${route} (.+)`))?.[1];
  expect(source).toBe(`(?i)^/${route}(?:/|$)`);
  const re = new RegExp(source!.replace('(?i)', ''), 'i');
  for (const path of [`/${route}`, `/${route}/`, `/${route.toUpperCase()}/archive/`]) expect(re.test(path)).toBe(true);
  expect(re.test(`/${route}-other`)).toBe(false);
 }
});
