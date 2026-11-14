import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

it('keeps the archive tournament page outside the deployed site', () => {
  const vite = read('apps/lab/vite.config.ts');
  expect(vite).toContain('opponentsArchive: r("./opponents/archive/index.html")');
  expect(vite).toContain('return "opponents-archive"');
  const docker = read('Dockerfile.site');
  for (const path of ['apps/lab/dist/opponents', 'apps/lab/dist/assets/opponents-*.js', 'apps/lab/dist/assets/opponents-*.css']) expect(docker).toContain(path);
  const source = read('deploy/Caddyfile').match(/@private_opponents path_regexp private_opponents (.+)/)?.[1];
  const route = new RegExp(source!.replace('(?i)', ''), 'i');
  for (const path of ['/opponents/archive/', '/OPPONENTS/archive/index.html', '/opponents/archive']) expect(route.test(path)).toBe(true);
});
it('page text carries the caption, the CPU-only statement and a captioned table', () => {
  const html = read('apps/lab/opponents/archive/index.html');
  for (const t of ['What this does not show', 'CPU only', 'no GPU evidence', 'noindex', 'synthetic', 'not the M3 environment']) expect(html).toContain(t);
  expect(html).toMatch(/<table id="matrix">[\s\S]*<caption/);
  expect(html).toMatch(/<table id="naive">[\s\S]*<caption/);
  expect(read('apps/lab/opponents/index.html')).toContain('/opponents/archive/');
  expect(html).toContain('href="/opponents/"');
});
it('the built archive page falls under the Dockerfile removal patterns and the site graph stays self-contained', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bl-site-arch-'));
  try {
    execFileSync('npx', ['vite', 'build', '--outDir', dir, '--emptyOutDir', '--logLevel', 'error'], { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'pipe' });
    const rm = read('Dockerfile.site').match(/&& rm -rf (.+)/)?.[1];
    const files = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)]);
    const all = files(dir).map((f) => relative(dir, f));
    const removed = new Set<string>();
    for (const token of rm!.split(/\s+/)) {
      const rel = token.replace(/^apps\/lab\/dist\//, '');
      const re = new RegExp(`^${rel.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}(/.*)?$`);
      for (const f of all) if (re.test(f)) removed.add(f);
    }
    expect(removed.has('opponents/archive/index.html')).toBe(true);
    const chunks = all.filter((f) => /^assets\/opponents-archive-.*\.js$/.test(f));
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) expect(removed.has(c)).toBe(true);
    const kept = all.filter((f) => !removed.has(f) && /\.(html|js|css)$/.test(f));
    const dangling: string[] = [];
    for (const f of kept) for (const m of readFileSync(join(dir, f), 'utf8').matchAll(/(?:\.\/|\/?assets\/)([A-Za-z0-9_.-]+\.(?:js|css))/g)) if (removed.has(`assets/${m[1]}`)) dangling.push(`${f} -> ${m[1]}`);
    expect(dangling).toEqual([]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 240000);
