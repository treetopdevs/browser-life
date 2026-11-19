import json,glob,os,statistics as st
base='/Users/nicholas/develop/browser-life-bodies/docs/bodies-2026-11-17/v3/grow-only'
rows=[]
for d in sorted(glob.glob(base+'/r*-s[0-9]')):
    n=os.path.basename(d)
    try: r=json.load(open(d+'/readout.json'))
    except Exception as e: print(n,'ERR',e); continue
    S=[s for s in r['series']]
    late=[s for s in S if s['t']>=10000]
    last=S[-1]
    def m(f): 
        v=[f(s) for s in late]; return round(st.mean(v),1) if v else None
    # cell-level turnover: births counter delta over t 10000..end
    s10=[s for s in S if s['t']==10000]
    b=(last['counters']['births']-s10[0]['counters']['births']) if s10 else None
    # patch births/deaths sums late
    pb=sum(s['patches']['births'] or 0 for s in late); pdth=sum(s['patches']['deaths'] or 0 for s in late)
    # components >=60 cells at last
    print(f"{n:20s} T={last['t']} cells={last['cells']} comps_last={last['comps']} compsLateMean={m(lambda s:s['comps'])} nBig={last['patches']['nBig']} seamLate={m(lambda s:s['seams']['seamPermille'])} basins={last['basins']['n']} med={last['basins']['q'][1]} pBirths={pb} pDeaths={pdth} cellBirths10k->end={b} blockedGrow={last['counters']['blockedGrow']} blockedBud={last['counters']['blockedBud']} tagMuts={last['counters']['tagMutations']} distinctMarks={last['kin']['distinct']} top={last['patches']['sizesTop8'][:4]} residual={last['final'] if False else ''}")
