"""Build a local animation companion and descriptive late-window report (stdlib only)."""
import json, math, statistics
from pathlib import Path
base = Path('runs/ecosystem-20k')
colors = ['#65d6a0','#efb75c','#ab98ed','#6dd9ed','#f18599']
names = ['Jade','Amber','Violet','Protected','Hunter']
results=[]
def mean(xs): return statistics.mean(xs) if xs else 0
for seed in [1101,1102,1103]:
    r=json.loads((base/f'seed-{seed}.json').read_text()); samples=r['samples']
    for p in samples:
        p['familyAttack']=[];p['familyDefense']=[]
        for f in range(5):
            bins=p['bins'][25*f:25*(f+1)]; n=sum(bins)
            p['familyAttack'].append(sum(v*(i//5) for i,v in enumerate(bins))/n if n else None)
            p['familyDefense'].append(sum(v*(i%5) for i,v in enumerate(bins))/n if n else None)
    windows={}
    for start,end in [(0,3000),(3000,10000),(10000,20000),(15000,20000)]:
        w=[p for p in samples if start<=p['tick']<=end]; a,b=w[0],w[-1]
        families=[]
        for f in range(5):
            vals=[p['counts'][f] for p in w]
            families.append(dict(name=names[f],minimum=min(vals),maximum=max(vals),mean=mean(vals),cv=statistics.pstdev(vals)/mean(vals) if mean(vals) else 0,
                attackStart=a['familyAttack'][f],attackEnd=b['familyAttack'][f],defenseStart=a['familyDefense'][f],defenseEnd=b['familyDefense'][f]))
        windows[f'{start}-{end}']=dict(families=families,births=b['births']-a['births'],deaths=b['deaths']-a['deaths'],mutations=b['mutations']-a['mutations'],
            spatialChangePer25=mean([p['spatialChangePer25'] for p in w[1:]]),newObservedTraits=sum(len(p['newlySeen']) for p in w if p['tick']>start),
            classesMin=min(p['classes'] for p in w),classesMax=max(p['classes'] for p in w))
    results.append(dict(seed=seed,sourceHash=r['sourceHash'],final=samples[-1],windows=windows,notices=r['notices'],samples=samples))
Path('docs/ecosystem-20k-summary.json').write_text(json.dumps([{k:v for k,v in r.items() if k!='samples'} for r in results],indent=2)+'\n')
def chart(samples,key,maximum,title):
    lines=[]
    for f in range(5):
        # Missing families break the curve rather than suggesting zero-valued traits.
        segments=[];segment=[]
        for p in samples:
            val=p[key][f]
            if val is None:
                if segment: segments.append(segment);segment=[]
            else: segment.append(f'{38+p["tick"]/20000*492:.1f},{155-val/maximum*130:.1f}')
        if segment:segments.append(segment)
        lines.extend(f'<polyline fill="none" stroke="{colors[f]}" stroke-width="1.7" points="{" ".join(seg)}"/>' for seg in segments)
    return f'<h3>{title}</h3><svg role="img" aria-label="{title}, ticks 0 to 20000" viewBox="0 0 550 180"><path d="M38 25V155H530" fill="none" stroke="#486053"/><g fill="#a6b8ab" font-size="11"><text x="4" y="30">{maximum}</text><text x="20" y="155">0</text><text x="38" y="175">0</text><text x="265" y="175">10,000</text><text x="493" y="175">20,000</text></g>{"".join(lines)}</svg>'
cards=[]
for r in results:
    seed=r['seed'];f=r['final'];w=r['windows']['15000-20000']
    table=''.join(f'<tr><td style="color:{colors[i]}">{names[i]}</td><td>{f["counts"][i]:,}</td><td>{v["minimum"]:,}–{v["maximum"]:,}</td></tr>' for i,v in enumerate(w['families']))
    events=''.join(f'<li><b>{e["tick"]:,}</b> {e["text"]}</li>' for e in r['notices'] if 'disappeared' in e['text'] or 'recovered' in e['text']) or '<li>No census extinction or defined recovery notices.</li>'
    cards.append(f'''<article><h2>Seed {seed}</h2><video controls loop muted playsinline preload="metadata" src="../runs/ecosystem-20k/seed-{seed}.mp4"></video><p class="tick">Tick 0</p><p>{sum(c>0 for c in f['counts'])} families at 20,000 · {f['classes']} living trait classes</p><table><thead><tr><th>Family</th><th>Final</th><th>Last 5,000 range</th></tr></thead><tbody>{table}</tbody></table>{chart(r['samples'],'counts',9216,'Population')}{chart(r['samples'],'familyAttack',4,'Mean attack within each family')}{chart(r['samples'],'familyDefense',4,'Mean defense within each family')}<p>Last 5,000 ticks: {w['mutations']:,} mutated births; {w['spatialChangePer25']:.1%} of sites change family or traits per 25 ticks on average. This includes births, deaths and movement, not just adaptation.</p><details><summary>Extinctions and recoveries</summary><ul>{events}</ul></details></article>''')
html='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ecosystem · 20,000 ticks</title><style>
:root{color-scheme:dark;font-family:system-ui;background:#101a19;color:#dbe9de}body{max-width:1600px;margin:auto;padding:32px}h1{font:44px Georgia}p{line-height:1.6;color:#afc4b5}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}article{min-width:0;border:1px solid #3e5547;padding:18px;border-radius:12px}video{width:100%;image-rendering:pixelated;background:#0b1411}button,select{background:#294234;border:1px solid #6a866b;color:#e1eddb;padding:10px;border-radius:6px;margin-right:10px}table{width:100%;font-size:12px;text-align:right;border-collapse:collapse}th:first-child,td:first-child{text-align:left}td,th{padding:6px;border-bottom:1px solid #344a3d}h3{font-size:14px;margin-bottom:0}li{font-size:12px;margin:8px 0}.legend{display:flex;gap:18px;flex-wrap:wrap;margin:20px 0}.tick{font-variant-numeric:tabular-nums}svg{width:100%}@media(max-width:950px){.grid{grid-template-columns:1fr}body{padding:16px}}
</style><h1>Does the little world keep changing?</h1><p>Three unchanged v4 worlds, extended to 20,000 ticks. Each exactly reproduces its earlier 3,000-tick census. No tuning, replanting or added interventions. The original staged arrivals and automatic seasons remain enabled.</p><p><strong>Still active, increasingly familiar:</strong> seeds 1101 and 1102 keep five-family competition and large late population swings. Seed 1103 settles into a Protected-heavy three-family community. Mutation continues, but most late trait combinations have appeared before.</p><p>Animations sample every 25 ticks and play at 20 frames/second (500 ticks per second). They show population fronts and turnover, not every individual event. Colors follow founding families; brighter cells have greater defense. Refuges and drought rules are active but their outlines are omitted here.</p><button id="play">Play all from start</button><button id="pause">Pause all</button><label>Playback <select id="speed"><option value="0.5">Half speed</option><option value="1" selected>Normal</option><option value="2">Double speed</option></select></label>'''
html+='<div class="legend">'+''.join(f'<span style="color:{c}">● {n}</span>' for c,n in zip(colors,names))+'</div><div class="grid">'+''.join(cards)+'</div>'
html+='''<p>These are engineered, bounded-trait ecologies, not evidence of open-ended evolution. The animation alone cannot distinguish ecological churn from cumulative adaptation; the within-family trait charts help separate those.</p><script>
const videos=[...document.querySelectorAll('video')];document.querySelector('#play').onclick=()=>videos.forEach(v=>{v.currentTime=0;v.play().catch(()=>{});});document.querySelector('#pause').onclick=()=>videos.forEach(v=>v.pause());document.querySelector('#speed').onchange=e=>videos.forEach(v=>v.playbackRate=Number(e.target.value));videos.forEach(v=>v.addEventListener('timeupdate',()=>v.nextElementSibling.textContent='Tick '+Math.min(20000,Math.floor(v.currentTime*20)*25).toLocaleString()));
</script></html>'''
Path('docs/ecosystem-20k.html').write_text(html)
print(json.dumps([{ 'seed':r['seed'],'final':r['final']['counts'],'late':r['windows']['15000-20000']} for r in results],indent=2))
