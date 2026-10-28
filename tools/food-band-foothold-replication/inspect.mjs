// Render recorded occupied bodies for parent visual review; never imports a model.
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';
const dir='docs/creative-prototypes/food-band-foothold-replication-media';mkdirSync(dir,{recursive:true});
const historicalPath='docs/creative-prototypes/alternating-food-seed-1203.json',newPath='docs/creative-prototypes/food-band-foothold-replication-seed-1203.json';
const bytes=[readFileSync(historicalPath),readFileSync(newPath)],data=bytes.map(b=>JSON.parse(b));
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
const page=await browser.newPage({viewport:{width:1400,height:780},deviceScaleFactor:1});
const html='<!doctype html><html lang="en"><meta charset="utf-8"><title>Recorded bodies only</title><style>body{margin:0;background:#091018;color:#edf3f8;font:20px system-ui}.pair{display:flex;gap:20px;padding:16px}h1{font-size:23px;margin:0 0 10px}canvas{display:block;width:672px;height:672px;image-rendering:pixelated}p{margin:8px 0}</style><div class="pair"><section><h1 id="a-label"></h1><canvas id="a" width="672" height="672"></canvas><p>Mint / gold / lilac founder families</p></section><section><h1 id="b-label"></h1><canvas id="b" width="672" height="672"></canvas><p>Body-only · no food, outlines or IDs</p></section></div></html>';
writeFileSync(`${dir}/body-capture.html`,html,{flag:'wx'});await page.setContent(html);
for(const tick of [1500,2000,2500,3000]){
 await page.evaluate(({data,tick})=>{for(let n=0;n<2;n++){
 const id=n===0?'a':'b',frame=data[n].frames.find(f=>f.tick===tick)??(data[n].run.extinctionTick!==null&&tick>=data[n].run.extinctionTick?data[n].frames.at(-1):null);
 if(!frame)throw new Error('Missing required frame');
 document.getElementById(`${id}-label`).textContent=`${n===0?'Historical alternating':'Unchanged foothold'} · tick ${frame.tick}${frame.tick!==tick?' (terminal hold)':''}`;
 const ctx=document.getElementById(id).getContext('2d');ctx.fillStyle='#091018';ctx.fillRect(0,0,672,672);const families=new Map(frame.organisms.map(o=>[o.id,o.family]));
 for(const [tile,org] of frame.cells){ctx.fillStyle=['#a8e8cd','#f5cf6a','#c9adf5'][families.get(org)];ctx.fillRect(tile%96*7,Math.floor(tile/96)*7,7,7);}
 }},{data,tick});
 await page.screenshot({path:`${dir}/body-${tick}.png`});
}
const hash=b=>createHash('sha256').update(b).digest('hex');
writeFileSync(`${dir}/body-provenance.json`,JSON.stringify({kind:'recorded-body-only-review',historical:{path:historicalPath,sha256:hash(bytes[0])},foothold:{path:newPath,sha256:hash(bytes[1])},ticks:[1500,2000,2500,3000],viewport:[1400,780],scale:7,noSimulation:true,scriptSha256:hash(readFileSync(new URL(import.meta.url)))},null,2)+'\n',{flag:'wx'});
}finally{await browser.close();}
