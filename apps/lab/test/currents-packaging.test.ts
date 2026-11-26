import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import { expectPublicPage } from './support/public-page.ts';
const read=(p:string)=>readFileSync(new URL(`../../../${p}`,import.meta.url),'utf8');
it('ships the currents page with the site: built, kept by the image, served, indexable and in the sitemap', () => {
  expectPublicPage('currents', 'currents: r("./currents/index.html")', ['currents-', 'current-pilot-']);
  expect(read('apps/lab/vite.config.ts')).toContain('return "currents-model"');
});
