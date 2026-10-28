// Capture the approved saved replay, with no simulation imports.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {chromium} from '@playwright/test';
const root=resolve('docs/creative-prototypes'),dir=resolve(root,'food-band-foothold-replication-media'),frames=resolve('runs/food-band-foothold-replication/animation-frames');
if(existsSync(`${dir}/seed-1203-paired.mp4`))throw new Error('Refusing media overwrite');mkdirSync(frames,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
const html=readFileSync(`${root}/food-band-foothold-replication.html`),js=readFileSync(`${root}/food-band-foothold-replication-viewer.js`);
writeFileSync(`${dir}/capture-viewer.html`,html,{flag:'wx'});writeFileSync(`${dir}/capture-viewer.js`,js,{flag:'wx'});
const server=createServer((req,res)=>{try{const path=resolve(root,decodeURIComponent(req.url.split('?')[0]).slice(1));if(!path.startsWith(root+'/'))throw new Error('Path');const mime={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.mp4':'video/mp4'};res.setHeader('Content-Type',mime[extname(path)]??'text/plain');res.end(readFileSync(path));}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});
try{
const page=await browser.newPage({viewport:{width:1760,height:1320},deviceScaleFactor:1});
await page.goto(`http://127.0.0.1:${server.address().port}/food-band-foothold-replication.html`);await page.waitForFunction(()=>window.replayReady===true);
// Hide delivery section during capture; exact injected CSS is part of provenance.
const captureCSS='#media{display:none!important}';await page.addStyleTag({content:captureCSS});
await page.locator('#body').uncheck();
for(let i=0;i<151;i++){
 await page.evaluate(tick=>window.setReplayTick(tick),i*20);
 const bounds=await page.locator('#capture').boundingBox();if(!bounds||bounds.y<0||bounds.y+bounds.height>1320)throw new Error(`Incomplete comparison at frame ${i}`);
 for(const id of ['historical','new']){const b=await page.locator(`#${id}`).boundingBox();if(b.width!==672||b.height!==672)throw new Error('Canvas capture dimension drift');}
 await page.screenshot({path:`${frames}/frame-${String(i).padStart(3,'0')}.png`});
}
execFileSync('ffmpeg',['-v','error','-framerate','10','-i',`${frames}/frame-%03d.png`,'-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',`${dir}/seed-1203-paired.mp4`],{stdio:'inherit'});
execFileSync('ffmpeg',['-v','error','-i',`${dir}/seed-1203-paired.mp4`,'-f','null','-'],{stdio:'inherit'});
const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=width,height,nb_read_frames,r_frame_rate,duration','-of','json',`${dir}/seed-1203-paired.mp4`],{encoding:'utf8'}));
const stream=probe.streams[0];if(stream.nb_read_frames!=='151'||stream.r_frame_rate!=='10/1'||Number(stream.duration)!==15.1||stream.width!==1760||stream.height!==1320)throw new Error('Video shape mismatch');
// Comparison image is an atlas of the four exact body-only captures.
const atlas=await browser.newPage({viewport:{width:1400,height:3120},deviceScaleFactor:1});await atlas.setContent('<!doctype html><html lang="en"><title>Four late recorded ages</title><style>body{margin:0;background:#091018}img{display:block;width:1400px;height:780px}</style>'+[1500,2000,2500,3000].map(t=>`<img alt="Tick ${t} historical and foothold bodies" src="data:image/png;base64,${readFileSync(`${dir}/body-${t}.png`).toString('base64')}">`).join(''));await atlas.locator('img').evaluateAll(imgs=>Promise.all(imgs.map(img=>img.decode())));await atlas.screenshot({path:`${dir}/seed-1203-comparison.png`,fullPage:true});
const files=['capture-viewer.html','capture-viewer.js','body-capture.html','body-provenance.json','body-1500.png','body-2000.png','body-2500.png','body-3000.png','seed-1203-comparison.png','seed-1203-paired.mp4'];
writeFileSync(`${dir}/media-provenance.json`,JSON.stringify({schemaVersion:1,noSimulation:true,ages:{from:0,to:3000,every:20},viewport:[1760,1320],frameCount:151,fps:10,probe,fullDecode:'passed',captureCSS,scriptSha256:sha(readFileSync(new URL(import.meta.url))),indexSha256:sha(readFileSync(`${root}/food-band-foothold-replication-index-1203.json`)),files:Object.fromEntries(files.map(f=>[f,sha(readFileSync(`${dir}/${f}`))])),frameHashes:Array.from({length:151},(_,i)=>sha(readFileSync(`${frames}/frame-${String(i).padStart(3,'0')}.png`)))},null,2)+'\n',{flag:'wx'});
}finally{await browser.close();await new Promise(r=>server.close(r));}
