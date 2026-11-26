#!/usr/bin/env node
// Saved-data media only. This module never imports or advances a biological model.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';
const hash=b=>createHash('sha256').update(b).digest('hex');
const [mode,input,output,...rest]=process.argv.slice(2);
if(mode!=='bodies'||!input||!output)throw Error('Usage: capture.mjs bodies RAW_JSON OUTPUT_PNG [1500,2000,2500,3000]');
const raw=readFileSync(resolve(input)),d=JSON.parse(raw),unhashed=Object.fromEntries(Object.entries(d).filter(([k])=>k!=='dataSha256'));
if(hash(JSON.stringify(unhashed))!==d.dataSha256||d.run.seed!==1202||d.kind!=='hungry-shapes-food-schedule-769-arm')throw Error('Invalid saved artifact identity/digest');
const ages=(rest[0]||'1500,2000,2500,3000').split(',').map(Number);
if(ages.length!==4||ages.some(n=>!Number.isSafeInteger(n)||n<0))throw Error('Exactly four integer requested ages required');
const frames=ages.map(t=>d.frames.find(f=>f.tick===t)||null);
for(const f of frames.filter(Boolean)){if(hash(JSON.stringify(Object.fromEntries(Object.entries(f).filter(([k])=>k!=='frameSha256'))))!==f.frameSha256)throw Error('Frame digest mismatch');}
const png=resolve(output),meta=png.replace(/\.png$/,'.json');
if(png===meta||existsSync(png)||existsSync(meta))throw Error('Refusing media overwrite');
mkdirSync(dirname(png),{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{const page=await browser.newPage({viewport:{width:1024,height:1180},deviceScaleFactor:1});
await page.setContent('<!doctype html><html><head><style>body{margin:0;padding:20px;background:#101b21;color:#edf5f0;font:16px system-ui}h1{font-size:22px;margin:0 0 10px}p{font-size:13px;margin:0 0 14px}.grid{display:grid;grid-template-columns:480px 480px;gap:18px 24px}figure{margin:0}figcaption{height:38px;font-size:13px}canvas{display:block;background:#09151a}</style></head><body><h1>Seed 1202 · 769 schedule · body-only observations</h1><p>No food, band outlines, identifiers or family colors. Missing ages are explicitly unavailable.</p><div class="grid"></div></body></html>');
await page.evaluate(({frames,ages})=>{const grid=document.querySelector('.grid');for(let i=0;i<4;i++){const f=frames[i],figure=document.createElement('figure'),caption=document.createElement('figcaption'),c=document.createElement('canvas');c.width=c.height=480;caption.textContent=`Tick ${ages[i].toLocaleString('en-US')}${f?' · exact saved frame':' · unavailable (not observed)'}`;figure.append(caption,c);grid.append(figure);const g=c.getContext('2d');g.fillStyle='#09151a';g.fillRect(0,0,480,480);g.fillStyle='#e4ece8';if(f)for(const[t]of f.cells)g.fillRect(t%96*5+.1,Math.floor(t/96)*5+.1,4.8,4.8);else{g.font='20px system-ui';g.fillText('Not observed',160,245);}}},{frames,ages});
await page.screenshot({path:png,fullPage:true});
const dims=await page.evaluate(()=>({width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}));
writeFileSync(meta,JSON.stringify({schemaVersion:1,kind:'saved-body-only-food-schedule-769-comparison',seed:1202,artifact:{path:input,rawSha256:hash(raw),dataSha256:d.dataSha256},planSha256:d.provenance.planSha256,sourceSha256:d.provenance.sourceSha256,requestedAges:ages,exactSavedAges:frames.map(f=>f?.tick??null),frameSha256:frames.map(f=>f?.frameSha256??null),bodyOnly:true,familyColors:false,food:false,bandOutlines:false,noSimulation:true,viewport:{width:1024,height:1180},png:{path:output,sha256:hash(readFileSync(png)),...dims}},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({png,metadata:meta}));
}finally{await browser.close();}
