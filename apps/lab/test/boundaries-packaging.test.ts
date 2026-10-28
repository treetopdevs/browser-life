import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

describe('local-only field prototype packaging', () => {
  it('denies the standalone namespace, case-insensitively, before public routes', () => {
    const caddy = read('deploy/Caddyfile');
    const pattern = caddy.match(/@private_boundaries path_regexp private_boundaries (.+)/)?.[1];
    expect(pattern).toBe('(?i)^/boundaries(?:/|$)');
    const matcher = new RegExp(pattern!.replace('(?i)', ''), 'i');
    for (const path of ['/boundaries', '/boundaries/', '/BOUNDARIES/index.html', '/boundaries/nested']) expect(matcher.test(path)).toBe(true);
    for (const path of ['/boundaries-other', '/lab/']) expect(matcher.test(path)).toBe(false);
    expect(caddy.indexOf('respond @private_boundaries 404')).toBeLessThan(caddy.indexOf('try_files'));
  });
  it('keeps entry and model chunks inside production removal globs', () => {
    const vite = read('apps/lab/vite.config.ts');
    expect(vite).toContain('boundaries: r("./boundaries/index.html")');
    expect(vite).toContain('if (id.includes("/src/boundaries/model.ts")) return "boundaries-model"');
    const docker = read('Dockerfile.site');
    for (const path of ['apps/lab/dist/boundaries', 'apps/lab/dist/assets/boundaries-*.js', 'apps/lab/dist/assets/boundaries-*.css']) expect(docker).toContain(path);
  });
});
