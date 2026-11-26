import json,glob,os,sys,statistics as st
R='/Users/nicholas/develop/browser-life-bodies/docs/bodies-2026-11-17/v3/_skeptic/grow-only (GATE_GROW only)/runs'
pat=sys.argv[1] if len(sys.argv)>1 else '*'
for f in sorted(glob.glob(R+'/'+pat+'.json')):
    n=os.path.basename(f)[:-5]
    if n=='smoke': continue
    r=json.load(open(f))
    if 'rows' not in r: continue
    rows=r['rows']; late=[x for x in rows if x['t']>=10000]
    if not late: continue
    mean=lambda k: round(st.mean(x[k] for x in late),1)
    last=rows[-1]
    ch=[x['churn'] for x in late if 'churn' in x]
    died=sum(c['died'] for c in ch); gen=sum(c['genChanged'] for c in ch); tk=sum(c['kinTakeover'] for c in ch); both=sum(c['tilesBoth'] for c in ch)
    p=last.get('persist')
    print(f"{n:18s} T={last['t']} cells={last['cells']} comps8(last/lateMean)={last['comps8']}/{mean('comps8')} comps4={last['comps4']} big>=30={last['big8_ge30']} fragCells={last['fragCells']} medBig={last['medianBig']} clades={last['clades']} cladesBig={last['cladesBig']} foreignPairs(mean)={mean('foreignPairs')} gapTiles(mean)={mean('gapTiles')} top={last['top8'][:3]} | late churn per sample: died={died} genChanged={gen} kinTakeover={tk} of tilesBoth={both} | persist(vs t10000)={p} basins={last.get('basins')} roots={last.get('rootsNow')} resid={r['residual']}")
