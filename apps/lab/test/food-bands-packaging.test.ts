import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'vite';

const root = new URL('../../../', import.meta.url).pathname;
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('food-bands stays a local-only page: configuration', () => {
  it('has its own Vite input and chunk names, leaving the hungry-shapes chunk contract alone', () => {
    const vite = read('apps/lab/vite.config.ts');
    expect(vite).toContain('foodBands: r("./food-bands/index.html")');
    expect(vite).toContain('hungryShapes: r("./hungry-shapes/index.html")');
    expect(vite).toContain('return "hungry-shapes-model"');
    expect(vite).toContain('return `food-bands-model-${key}`');
    // the replay route exists in dev only
    expect(vite).toMatch(/name: "food-bands-replays",\s+apply: "serve"/);
  });

  it('Dockerfile.site removes the page and every asset glob', () => {
    const docker = read('Dockerfile.site');
    for (const path of ['apps/lab/dist/food-bands', 'apps/lab/dist/assets/foodBands*.js', 'apps/lab/dist/assets/foodBands*.css', 'apps/lab/dist/assets/food-bands*.js', 'apps/lab/dist/assets/food-bands*.css']) expect(docker).toContain(path);
    // the older private pages are still removed
    expect(docker).toContain('apps/lab/dist/hungry-shapes');
  });

  it('Caddy answers 404 for /food-bands in any case, with or without a path, and only for it', () => {
    const caddy = read('deploy/Caddyfile');
    const pattern = caddy.match(/@private_food_bands path_regexp private_food_bands (.+)/)?.[1];
    expect(pattern).toBe('(?i)^/food-bands(?:/|$)');
    expect(caddy).toContain('respond @private_food_bands 404');
    const matcher = new RegExp(pattern!.replace('(?i)', ''), 'i');
    for (const path of ['/food-bands', '/food-bands/', '/FOOD-BANDS/index.html', '/food-bands/x']) expect(matcher.test(path), path).toBe(true);
    for (const path of ['/food-bands-other', '/lab/', '/']) expect(matcher.test(path), path).toBe(false);
  });

  it('the page is noindex and is not linked from the lab list, the playground or the sitemap', () => {
    expect(read('apps/lab/food-bands/index.html')).toMatch(/<meta name="robots" content="noindex, nofollow"/);
    for (const file of ['apps/lab/playground/index.html', 'apps/lab/lab/index.html', 'apps/lab/public/sitemap.xml', 'tests/e2e/playground.spec.ts']) {
      if (existsSync(join(root, file))) expect(read(file), file).not.toContain('food-bands');
    }
    expect(read('tests/e2e/public-routes.spec.ts')).toMatch(/const DIAGNOSTIC = \[[^\]]*"\/food-bands\/"/);
  });

  it('writes no file by itself: the only download is behind a button click', () => {
    const page = read('apps/lab/src/food-bands/page.ts');
    expect(page.match(/createObjectURL/g)?.length).toBe(1);
    expect(page).toMatch(/getElementById\('export'\)|el<HTMLButtonElement>\('export'\)\.addEventListener\('click'/);
    for (const forbidden of ['localStorage', 'sessionStorage', 'indexedDB', 'navigator.storage', 'showSaveFilePicker']) expect(page, forbidden).not.toContain(forbidden);
  });
});

/** Expand a Dockerfile rm path whose only wildcard is `*` in the file name. */
function expand(pattern: string, outDir: string): string[] {
  const relativePath = pattern.replace(/^apps\/lab\/dist\//, '');
  if (!relativePath.includes('*')) return [join(outDir, relativePath)];
  const dir = join(outDir, relativePath.slice(0, relativePath.lastIndexOf('/')));
  const base = relativePath.slice(relativePath.lastIndexOf('/') + 1);
  const re = new RegExp('^' + base.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  return existsSync(dir) ? readdirSync(dir).filter(f => re.test(f)).map(f => join(dir, f)) : [];
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => { const p = join(dir, name); return statSync(p).isDirectory() ? walk(p) : [p]; });
}

describe('food-bands stays a local-only page: the built image', () => {
  let outDir = '';
  const removed = new Set<string>();
  beforeAll(async () => {
    outDir = mkdtempSync(join(tmpdir(), 'fb-scratch-'));
    await build({ root: join(root, 'apps/lab'), configFile: join(root, 'apps/lab/vite.config.ts'), logLevel: 'silent', build: { outDir, emptyOutDir: true } });
    // Apply exactly the Dockerfile.site rm line to the scratch build.
    const docker = read('Dockerfile.site');
    const line = docker.split('\n').find(l => l.includes('rm -rf apps/lab/dist/garden'))!;
    const paths = line.split(/\s+/).filter(p => p.startsWith('apps/lab/dist/'));
    for (const p of paths) for (const target of expand(p, outDir)) { if (existsSync(target)) { removed.add(relative(outDir, target)); rmSync(target, { recursive: true, force: true }); } }
  }, 280_000);
  afterAll(() => { if (outDir) rmSync(outDir, { recursive: true, force: true }); });

  it('the build contains the page and its named chunks before the rm line runs', () => {
    expect([...removed].some(p => p === 'food-bands')).toBe(true);
    expect([...removed].some(p => /^assets\/foodBands.*\.js$/.test(p))).toBe(true);
    expect([...removed].some(p => /^assets\/food-bands-model-food-schedule-769.*\.js$/.test(p))).toBe(true);
  });

  it('nothing food-bands remains after the rm line: no file name, no marker text, no page', () => {
    expect(existsSync(join(outDir, 'food-bands'))).toBe(false);
    const files = walk(outDir);
    expect(files.map(f => relative(outDir, f)).filter(f => /food-?bands/i.test(f))).toEqual([]);
    const marker = /food-bands|foodBands|food-bands-exploration-observation/;
    const offenders = files.filter(f => /\.(js|css|html|json|xml|txt|map)$/.test(f)).filter(f => marker.test(readFileSync(f, 'utf8'))).map(f => relative(outDir, f));
    expect(offenders).toEqual([]);
  });

  it('no remaining file references a removed one (static and dynamic imports, preload lists, stylesheets)', () => {
    const files = walk(outDir).filter(f => /\.(js|css|html)$/.test(f));
    const missing: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/(?:\.\/|\/?assets\/)([A-Za-z0-9_.-]+\.(?:js|css))/g)) {
        const target = m[0].startsWith('./') ? join(file, '..', m[1]!) : join(outDir, 'assets', m[1]!);
        if (!existsSync(target)) missing.push(`${relative(outDir, file)} -> ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
