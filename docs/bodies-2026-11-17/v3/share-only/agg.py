import json,sys,statistics as st
def m(x): return round(st.mean(x),1) if x else None
for n in sys.argv[1:]:
    j=json.load(open(n+'/readout.json'));S=[r for r in j['series'] if r['t']>=10000]
    f=j['final']
    print(n,f"cells={m([r['cells'] for r in S])} comps={m([r['comps'] for r in S])} lcc={m([r['largestSharePermille'] for r in S])} basins={m([r['basins']['n'] for r in S])} medB={m([r['basins']['q'][1] for r in S])} nBig={m([r['patches']['nBig'] for r in S])} patchesN={m([r['patches']['n'] for r in S])} dist={m([r['kin']['distinct'] for r in S])} seam={m([r['seams']['seamPermille'] for r in S])} births={sum(r['patches']['births'] or 0 for r in S)} deaths={sum(r['patches']['deaths'] or 0 for r in S)} top={f['patches']['sizesTop8'][:5]} dom={f['kin']['dominantSharePermille']} tm={f['counters']['tagMutations']} bG={f['counters']['blockedGrow']} bB={f['counters']['blockedBud']} genes={[x/10 for x in f['genes']['meansX10']]} var={f['genes']['variants']}")
