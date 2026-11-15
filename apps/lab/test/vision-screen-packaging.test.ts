import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import { expectPublicPage } from './support/public-page.ts';
const read=(path:string)=>readFileSync(new URL(`../../../${path}`,import.meta.url),'utf8');
it('ships the vision-screen page with the site: built, kept by the image, served, indexable and in the sitemap', () => {
  expectPublicPage('vision-screen', 'visionScreen: r("./vision-screen/index.html")', ['vision-screen-', 'visionScreen-']);
  expect(read('apps/lab/vite.config.ts')).toContain('return "vision-screen-core"');
});
