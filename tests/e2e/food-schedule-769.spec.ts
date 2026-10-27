import {test,expect,type Page,type Route} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {summarizeRecovery,evaluateGate,evaluateSpatialGate,evaluateSeasonalGate,occupiedTilesByBand,regressionProof,LOADED_SOURCE_SHA256} from '../../tools/food-schedule-769/explore';
type Rec=Record<string,any>;
const DOCS=resolve('docs/creative-prototypes'),ORIGIN=`http://localhost:${process.env.BL_E2E_PORT||'5174'}`,BASE=`${ORIGIN}/docs/creative-prototypes/`,NAME='food-schedule-769',PLAN='c5ab72408c514280360e67e2ef0fab75475663da52be799e8aa2836eab67661d';
const HIST='food-floor-longevity-replication-seed-1202.json',HIST_RAW='14565a78528152556140b68bedbd6d074e5f5dca556ecf0439094e945d5cef60',HIST_DATA='89479f5352fe09628fd2314d785e67ca540873c0f766c0a7d0206f5127975315';
const hash=(x:string|Buffer)=>createHash('sha256').update(x).digest('hex'),jhash=(x:unknown)=>hash(JSON.stringify(x));
const prior=JSON.parse(readFileSync(resolve(DOCS,'food-band-foothold-seed-1202.json'),'utf8')) as Rec;
// Synthetic relabeling of saved historical states only: no biological construction or stepping.
function fixture(mutate?:(d:Rec)=>void){const d=structuredClone(prior);d.kind='hungry-shapes-food-schedule-769-arm';delete d.baselineSeasonalReference;d.run={...d.run,mode:'schedule-769',maxTick:6000,gateHorizon:3000};d.stage='gate3000';d.gate3000=null;
 d.provenance={sourceSha256:LOADED_SOURCE_SHA256,planSha256:PLAN,historicalArtifactSha256:HIST_RAW,historicalDataSha256:HIST_DATA,historicalIndexSha256:'666fe0dce4b094eef3f5498c0204f2321db2df1469c8f59df8e25520db41fe19',regression:regressionProof(),runId:'synthetic-no-biology',intentSha256:'a'.repeat(64)};
 const env=(x:Rec)=>({...x,mode:'schedule-769',pulseAdvance:769});
 for(const s of d.samples)s.environment=env(s.environment);
 for(const s of d.snapshots){s.environment=env(s.environment);s.stateSha256=jhash({state:s.state,environment:s.environment});d.samples.find((x:Rec)=>x.tick===s.tick).stateSha256=s.stateSha256;const f=d.frames.find((x:Rec)=>x.tick===s.tick);f.stateSha256=s.stateSha256;delete f.frameSha256;f.frameSha256=jhash(f);d.samples.find((x:Rec)=>x.tick===s.tick).frameSha256=f.frameSha256;}
 d.final.environment=env(d.final.environment);d.final.stateSha256=d.snapshots.at(-1).stateSha256;
 d.recoverySummary=summarizeRecovery(d.tickRows,d.samples,d.frames,d.final.lineage);d.windows=d.recoverySummary.windows.slice(3,6);d.numericalGate=evaluateGate(3000,d.final.census,d.windows,3000);d.spatialGate=evaluateSpatialGate([2500,3000].map(t=>({tick:t,occupiedTilesByBand:occupiedTilesByBand(d.frames.find((f:Rec)=>f.tick===t))})),3000);d.seasonalGate=evaluateSeasonalGate([1500,2000,2500].map(t=>({fromOccupiedTilesByBand:occupiedTilesByBand(d.frames.find((f:Rec)=>f.tick===t)),toOccupiedTilesByBand:occupiedTilesByBand(d.frames.find((f:Rec)=>f.tick===t+500))})),3000);
 mutate?.(d);delete d.dataSha256;d.dataSha256=jhash(d);return d;}
function manifest(d:Rec){const raw=JSON.stringify(d);return{schemaVersion:1,kind:'hungry-shapes-food-schedule-769-manifest',seed:1202,planSha256:PLAN,arm:{kind:d.kind,mode:d.run.mode,url:`${NAME}-seed-1202.json`,rawSha256:hash(raw),dataSha256:d.dataSha256},historical:{url:HIST,rawSha256:HIST_RAW,dataSha256:HIST_DATA},decision:{status:'pending',summary:'Synthetic fixture only, awaiting parent review.',artifactSha256:hash(raw),visualReceiptUrl:null,visualReceiptSha256:null}};}
async function install(page:Page,d?:Rec,actual=false,indexMutate?:(index:Rec)=>void){await page.route('**/docs/creative-prototypes/**',async(route:Route)=>{const name=new URL(route.request().url()).pathname.split('/').at(-1)!;if(!actual&&name===`${NAME}-index-1202.json`){if(!d)return route.fulfill({status:404,body:'absent'});const index=manifest(d);indexMutate?.(index);return route.fulfill({contentType:'application/json',body:JSON.stringify(index)});}if(!actual&&d&&name===`${NAME}-seed-1202.json`)return route.fulfill({contentType:'application/json',body:JSON.stringify(d)});const file=resolve(DOCS,name);if(existsSync(file)&&!name.includes('..'))return route.fulfill({contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.html')?'text/html':'application/json',body:readFileSync(file)});return route.continue();});
 // Source verification fetches the actual tracked source bytes, never executes them.
 await page.route('**/tools/**',async route=>{const rel=new URL(route.request().url()).pathname.slice(1);const file=resolve(rel);return existsSync(file)?route.fulfill({body:readFileSync(file)}):route.continue();});
 await page.route('**/apps/**',async route=>{const rel=new URL(route.request().url()).pathname.slice(1);const file=resolve(rel);return existsSync(file)?route.fulfill({body:readFileSync(file)}):route.continue();});
 await page.route('**/{package.json,pnpm-lock.yaml}',async route=>{const rel=new URL(route.request().url()).pathname.slice(1);return route.fulfill({body:readFileSync(resolve(rel))});});
 await page.goto(`${BASE}${NAME}.html`);}
async function ready(page:Page){await expect(page.locator('#source-status')).toHaveAttribute('data-kind',/ready|error/);if(await page.locator('#source-status').getAttribute('data-kind')==='error')throw new Error(await page.locator('#error-detail').textContent()||'Unknown viewer error');await expect(page.locator('#source-status')).toHaveAttribute('data-kind','ready');await expect(page.locator('#replay')).toBeVisible();}
test('missing outcome does not invent a trial',async({page})=>{await install(page);await expect(page.locator('#empty-state')).toBeVisible();await expect(page.locator('#replay')).toBeHidden();});
test('pending 3000 gate stops timeline and labels every new-rule tick novel',async({page})=>{await install(page,fixture());await ready(page);await page.getByRole('button',{name:'3,000',exact:true}).click();await expect(page.locator('#alternating-population')).toHaveText('34');await expect(page.locator('#baseline-population')).toHaveText('34');await expect(page.getByRole('button',{name:'6,000',exact:true})).toBeDisabled();await expect(page.locator('#phase-label')).toContainText('New-rule observations');await expect(page.locator('#recovery-rows')).toContainText('not-reached');await expect(page.locator('#visual-gate')).toHaveText('Pending parent review');});
for(const[name,mutate]of Object.entries({
 'wrong food schedule':(d:Rec)=>{d.samples[0].environment.pulseAdvance=768;},
 'wrong source pin':(d:Rec)=>{d.provenance.sourceSha256={...d.provenance.sourceSha256,'tools/food-schedule-769/explore.ts':'0'.repeat(64)};},
 'invented population minimum':(d:Rec)=>{d.recoverySummary.minimum.population=0;},
 'invented late food count':(d:Rec)=>{d.recoverySummary.windows[5].food.accepted++;},
 'invented 6000 gate horizon':(d:Rec)=>{d.run.gateHorizon=6000;},
 'invented continuation authorization':(d:Rec)=>{d.stage='final';d.gate3000={status:'passed',artifactSha256:'a'.repeat(64),receiptSha256:'b'.repeat(64),receiptCommit:'c'.repeat(40)};},
 'invented family gate':(d:Rec)=>{d.numericalGate.atLeastTwoFamiliesAtHorizon=false;},
 'invented occupied band':(d:Rec)=>{d.spatialGate.checkpoints[0].occupiedTilesByBand[0]++;},
 'invented seasonal pass':(d:Rec)=>{d.seasonalGate.blocks[0].pass=false;},
 'changed rules':(d:Rec)=>{d.rules.storeCap++;},
 'invented lineage maximum':(d:Rec)=>{d.final.maxEverGeneration++;},
 'changed known comparison':(d:Rec)=>{d.provenance.historicalArtifactSha256='0'.repeat(64);},
}))test(`rejects rehashed ${name}`,async({page})=>{await install(page,fixture(mutate));await expect(page.locator('#error-state')).toBeVisible();await expect(page.locator('#replay')).toBeHidden();});
test('paired replay is accessible on mobile',async({page})=>{await page.setViewportSize({width:390,height:844});await install(page,fixture());await ready(page);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);});
test('actual saved outcome and parent decision load',async({page})=>{test.skip(process.env.BL_SCHEDULE_769_ACTUAL!=='1','Requires recorded outcome');const d=JSON.parse(readFileSync(resolve(DOCS,`${NAME}-seed-1202.json`),'utf8'));await install(page,undefined,true);await ready(page);await page.getByRole('button',{name:d.run.gateHorizon.toLocaleString('en-US'),exact:true}).click();await expect(page.locator('#alternating-population')).toHaveText(String(d.final.census.population));});
test('actual animation plays and final mobile page passes axe',async({page})=>{test.skip(process.env.BL_SCHEDULE_769_MEDIA!=='1','Requires recorded media');await install(page,undefined,true);await ready(page);await page.locator('video').evaluate((v:HTMLVideoElement)=>v.play());await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeGreaterThan(0);await page.setViewportSize({width:390,height:844});expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);});

test('rejects a 3000 gate mislabeled as a final Promising outcome',async({page})=>{await install(page,fixture(),false,index=>{index.decision.status='promising';index.decision.visualReceiptUrl='synthetic-final-receipt.json';index.decision.visualReceiptSha256='a'.repeat(64);});await expect(page.locator('#error-detail')).toContainText('Promising requires a completed earned 6,000-tick outcome');await expect(page.locator('#replay')).toBeHidden();});
