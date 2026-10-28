// Saved-frame renderer. No simulation code is imported.
const INDEX_HASH = 'bdaf6c4ab1f36281587bf1d5726d0869b0b0b31b686e7af0ea74d9b111670072';
const HISTORICAL_HASH = 'f4f5e28294c4806b2b31b4776dbdd42ab9cf70d4307279787c2649298d34123b';
const $ = (id) => document.getElementById(id);
const sha = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
async function read(path, expected) {
  if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error('Evidence is not yet approved for display.');
  const response=await fetch(path);if(!response.ok)throw new Error(`Cannot read ${path}`);
  const bytes=await response.arrayBuffer();if(await sha(bytes)!==expected)throw new Error(`Evidence digest mismatch: ${path}`);
  return JSON.parse(new TextDecoder().decode(bytes));
}
let historical, outcome, timer;
function frameAt(data,tick){return data.frames.find(f=>f.tick===tick)??(data.run.extinctionTick!==null&&tick>=data.run.extinctionTick?data.frames.at(-1):null);}
function draw(id,data,tick){
  const frame=frameAt(data,tick);if(!frame)throw new Error(`Missing saved frame at ${tick}`);
  const sample=data.samples.find(s=>s.tick===frame.tick);if(!sample)throw new Error('Missing saved census');
  const canvas=$(id),ctx=canvas.getContext('2d'),scale=7,bodyOnly=$('body').checked;
  ctx.fillStyle='#091018';ctx.fillRect(0,0,672,672);
  if(!bodyOnly){const food=atob(frame.foodBase64);for(let tile=0;tile<9216;tile++){const n=food.charCodeAt(tile);ctx.fillStyle=`rgb(${9+Math.round(n*0.45)} ${16+Math.round(n*1.2)} ${24+Math.round(n*.5)})`;ctx.fillRect(tile%96*scale,Math.floor(tile/96)*scale,scale,scale);}ctx.strokeStyle='#abc3d6';ctx.lineWidth=2;for(const x of [0,48])ctx.strokeRect(x*scale+1,1,24*scale-2,670);}
  const family=new Map(frame.organisms.map(o=>[o.id,o.family])),colors=['#a8e8cd','#f5cf6a','#c9adf5'],counts=[0,0];
  for(const [tile,id] of frame.cells){ctx.fillStyle=colors[family.get(id)];ctx.fillRect(tile%96*scale,Math.floor(tile/96)*scale,scale,scale);const x=tile%96;if(x<24)counts[0]++;else if(x>=48&&x<72)counts[1]++;}
  const c=sample.census,e=sample.environment,hold=tick!==frame.tick?` · actual terminal hold at ${frame.tick}`:'';
  $(`${id}-metrics`).textContent=`Tick ${frame.tick}${hold} · ${c.population} bodies · families ${c.familyCounts.join('/') }\nBody tiles in bands: ${counts.join(' / ')} · programs ${c.genomeVariantCount}\n${id==='new'?'Majority':'Fed'} band ${e.activeBand} · ${id==='new'?'minority still fed · ':''}offered ${e.offered}, accepted ${e.accepted}, overflow ${e.overflow}`;
}
function render(){const tick=Number($('age').value)*20;draw('historical',historical,tick);draw('new',outcome,tick);$('tick').textContent=`Tick ${tick}`;window.replayTick=tick;}
function stop(){clearInterval(timer);timer=undefined;$('play').textContent='Play';}
try{
  const index=await read('food-band-foothold-replication-index-1203.json',INDEX_HASH);
  historical=await read(index.arms.historical.url,HISTORICAL_HASH);outcome=await read(index.arms.foothold.url,index.arms.foothold.rawSha256);
  const receipt=await read(index.receipt.url,index.receipt.sha256);
  if(historical.run.seed!==1203||historical.run.mode!=='alternating-band'||outcome.kind!=='hungry-shapes-food-band-foothold-replication-arm'||outcome.run.seed!==1203||outcome.run.mode!=='foothold-band'||receipt.artifactSha256!==index.arms.foothold.rawSha256||receipt.planSha256!==index.planSha256)throw new Error('Evidence identity mismatch');
  $('status').textContent=`${index.decision.status}: ${index.decision.summary}`;
  $('age').disabled=false;$('play').disabled=false;$('media').hidden=false;render();window.replayReady=true;
  $('age').addEventListener('input',()=>{stop();render();});$('body').addEventListener('change',render);
  $('play').addEventListener('click',()=>{if(timer){stop();return;}$('play').textContent='Pause';timer=setInterval(()=>{$('age').value=String((Number($('age').value)+1)%151);render();},100);});
  window.setReplayTick=(tick)=>{if(!Number.isInteger(tick)||tick<0||tick>3000||tick%20)throw new Error('Not a saved age');stop();$('age').value=String(tick/20);render();};
}catch(error){stop();$('status').textContent=`Unavailable: ${error.message}`;window.replayError=error.message;}
