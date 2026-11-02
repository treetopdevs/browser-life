import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
it('keeps the controller-locality prototype outside the deployed site', () => {
  expect(read('apps/lab/vite.config.ts')).toContain('controllerLocality: r("./controller-locality/index.html")');
  const docker = read('Dockerfile.site');
  for (const path of ['apps/lab/dist/controller-locality', 'apps/lab/dist/assets/controllerLocality-*.js', 'apps/lab/dist/assets/controllerLocality-*.css']) expect(docker).toContain(path);
  const source = read('deploy/Caddyfile').match(/@private_controller_locality path_regexp private_controller_locality (.+)/)?.[1];
  expect(source).toBe('(?i)^/controller-locality(?:/|$)');
  expect(read('deploy/Caddyfile')).toMatch(/respond @private_controller_locality 404/);
  const route = new RegExp(source!.replace('(?i)', ''), 'i');
  for (const path of ['/controller-locality', '/controller-locality/', '/CONTROLLER-LOCALITY/index.html']) expect(route.test(path)).toBe(true);
  expect(route.test('/controller-locality-other')).toBe(false);
});
it('page text carries the CPU-only, exploratory and bounded-to-tested-genomes statements and noindex', () => {
  const html = read('apps/lab/controller-locality/index.html');
  expect(html).toContain('CPU only');
  expect(html).toContain('no GPU evidence');
  expect(html).toContain('Exploratory');
  expect(html).toContain('bounded to the tested genomes');
  expect(html).toContain('noindex');
  expect(html).toMatch(/<table id="matrix"><caption>/);
  expect(html).toContain('What this does not show');
});
it('the site image keeps a self-contained asset graph after the Dockerfile deletions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bl-site-'));
  try {
    execFileSync('npx', ['vite', 'build', '--outDir', dir, '--emptyOutDir', '--logLevel', 'error'], { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'pipe' });
    const rm = read('Dockerfile.site').match(/&& rm -rf (.+)/)?.[1];
    expect(rm).toBeTruthy();
    const files = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)]);
    const all = files(dir).map((f) => relative(dir, f));
    const removed = new Set<string>();
    for (const token of rm!.split(/\s+/)) {
      const rel = token.replace(/^apps\/lab\/dist\//, '');
      const re = new RegExp(`^${rel.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}(/.*)?$`);
      for (const f of all) if (re.test(f)) removed.add(f);
    }
    expect([...removed].some((f) => f.startsWith('controller-locality/'))).toBe(true);
    expect([...removed].some((f) => /^assets\/controllerLocality-.*\.js$/.test(f))).toBe(true);
    const kept = new Set(all.filter((f) => !removed.has(f)));
    const dangling: string[] = [];
    for (const f of kept) {
      if (!/\.(html|js|css)$/.test(f)) continue;
      const text = readFileSync(join(dir, f), 'utf8');
      for (const m of text.matchAll(/(?:\.\/|\/?assets\/)([A-Za-z0-9_.-]+\.(?:js|css))/g)) {
        const target = `assets/${m[1]}`;
        if (all.includes(target) && !kept.has(target)) dangling.push(`${f} -> ${target}`);
      }
    }
    expect(dangling).toEqual([]);
    expect(kept.has('lab/index.html')).toBe(true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 180_000);
