import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
it('keeps the motif entry and observer chunks within private particle packaging', () => {
  const vite = read('apps/lab/vite.config.ts');
  expect(vite).toContain('particleMotifs: r("./particles/motifs/index.html")');
  expect(vite).toContain('return "particles-motifs-model"');
  const docker = read('Dockerfile.site');
  for (const pattern of ['apps/lab/dist/particles', 'apps/lab/dist/assets/particles-*.js', 'apps/lab/dist/assets/particleMotifs-*.js', 'apps/lab/dist/assets/particleMotifs-*.css']) expect(docker).toContain(pattern);
  const caddy = read('deploy/Caddyfile');
  const pattern = caddy.match(/@private_particles path_regexp private_particles (.+)/)?.[1];
  expect(pattern).toBe('(?i)^/particles(?:/|$)');
  expect(new RegExp(pattern!.replace('(?i)', ''), 'i').test('/PARTICLES/motifs/')).toBe(true);
});
