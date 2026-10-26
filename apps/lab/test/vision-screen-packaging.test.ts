import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
const read=(path:string)=>readFileSync(new URL(`../../../${path}`,import.meta.url),'utf8');
it('keeps vision gallery and data chunks local-only',()=>{
 const vite=read('apps/lab/vite.config.ts');expect(vite).toContain('visionScreen: r("./vision-screen/index.html")');expect(vite).toContain('return "vision-screen-core"');
 const docker=read('Dockerfile.site');for(const path of ['apps/lab/dist/vision-screen','apps/lab/dist/assets/vision-screen-*.js','apps/lab/dist/assets/vision-screen-*.css','apps/lab/dist/assets/visionScreen-*.js','apps/lab/dist/assets/visionScreen-*.css'])expect(docker).toContain(path);
 const pattern=read('deploy/Caddyfile').match(/@private_vision_screen path_regexp private_vision_screen (.+)/)?.[1];expect(pattern).toBe('(?i)^/vision-screen(?:/|$)');const matcher=new RegExp(pattern!.replace('(?i)',''),'i');for(const path of ['/vision-screen','/vision-screen/','/VISION-SCREEN/index.html'])expect(matcher.test(path)).toBe(true);expect(matcher.test('/vision-screen-other')).toBe(false);
});
