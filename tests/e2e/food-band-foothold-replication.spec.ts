import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,extname} from 'node:path';
declare global { interface Window { replayReady:boolean;setReplayTick:(tick:number)=>void } }
const url='/docs/creative-prototypes/food-band-foothold-replication.html';
// Prototype docs are intentionally outside Vite's lab root, as in the existing saved-replay tests.
test.beforeEach(async({page})=>{
 await page.route('**/docs/creative-prototypes/**',async route=>{
  const relative=new URL(route.request().url()).pathname.split('/docs/creative-prototypes/')[1];
  const root=resolve('docs/creative-prototypes'),path=resolve(root,relative??'');
  if(!path.startsWith(root+'/'))return route.fulfill({status:404});
  let bytes:Buffer;try{bytes=readFileSync(path);}catch{return route.fulfill({status:404});}
  const types:Record<string,string>={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.mp4':'video/mp4'};
  const contentType=types[extname(path)]??'text/plain',range=route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
  if(extname(path)==='.mp4'&&range){const start=Number(range[1]),end=Math.min(range[2]?Number(range[2]):bytes.length-1,bytes.length-1);return route.fulfill({status:206,headers:{'Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${bytes.length}`,'Content-Length':String(end-start+1),'Content-Type':contentType},body:bytes.subarray(start,end+1)});}
  return route.fulfill({contentType,body:bytes});
 });
});
test('fails closed when evidence bytes disagree with the frozen index',async({page})=>{
 await page.route('**/food-band-foothold-replication-index-1203.json',r=>r.fulfill({body:'{}',contentType:'application/json'}));await page.goto(url);
 await expect(page.locator('#status')).toContainText('Unavailable:');await expect(page.locator('#play')).toBeDisabled();
});
test('actual saved replay binds exact evidence and all late ages',async({page})=>{
 const root='docs/creative-prototypes/';const index=JSON.parse(readFileSync(root+'food-band-foothold-replication-index-1203.json','utf8'));
 const raw=readFileSync(root+index.arms.foothold.url),data=JSON.parse(raw.toString('utf8'));
 expect(createHash('sha256').update(raw).digest('hex')).toBe(index.arms.foothold.rawSha256);
 await page.goto(url);await page.waitForFunction(()=>window.replayReady===true);await expect(page.locator('#play')).toHaveText('Play');
 for(const tick of [1500,2000,2500,3000]){await page.evaluate(t=>window.setReplayTick(t),tick);const sample=data.samples.find((s:{tick:number})=>s.tick===tick);await expect(page.locator('#new-metrics')).toContainText(`${sample.census.population} bodies · families ${sample.census.familyCounts.join('/')}`);await expect(page.locator('#tick')).toHaveText(`Tick ${tick}`);}
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const video=page.locator('video');await video.evaluate((v:HTMLVideoElement)=>v.play());await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeGreaterThan(0);await video.evaluate((v:HTMLVideoElement)=>v.pause());expect(await video.evaluate((v:HTMLVideoElement)=>v.duration)).toBeCloseTo(15.1,1);
});
