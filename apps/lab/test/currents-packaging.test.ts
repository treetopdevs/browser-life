import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
const read=(p:string)=>readFileSync(new URL(`../../../${p}`,import.meta.url),'utf8');
it('excludes current page, model and saved replay assets from production',()=>{
 const vite=read('apps/lab/vite.config.ts');expect(vite).toContain('currents: r("./currents/index.html")');expect(vite).toContain('return "currents-model"');
 const docker=read('Dockerfile.site');for(const p of ['apps/lab/dist/currents','apps/lab/dist/assets/currents-*.js','apps/lab/dist/assets/currents-*.css','apps/lab/dist/assets/currents-*.gz','apps/lab/dist/assets/currents-*.replay','apps/lab/dist/assets/current-pilot-*.json'])expect(docker).toContain(p);
 const pattern=read('deploy/Caddyfile').match(/@private_currents path_regexp private_currents (.+)/)?.[1];expect(pattern).toBe('(?i)^/currents(?:/|$)');const re=new RegExp(pattern!.replace('(?i)',''),'i');for(const p of ['/currents','/currents/','/CURRENTS/index.html'])expect(re.test(p)).toBe(true);expect(re.test('/currents-other')).toBe(false);
});
