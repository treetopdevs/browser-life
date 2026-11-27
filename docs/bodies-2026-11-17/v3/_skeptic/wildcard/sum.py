import json,sys,statistics as st,glob,os
def load(n): return json.load(open(f'runs/{n}/skeptic.json'))
def late(rows,k,t0): 
    v=[r[k] for r in rows if r['t']>=t0]; return round(st.mean(v),2) if v else None
names=sys.argv[1:]
keys=['cells','comps8','comps4','big8','medBig','exPatches','exBig','exMed','distinctMarks','mixedComps','rootsTotal','rootsPerBigComp','compactMed','seam8','births','deaths','tilesFlipped','markChangedOfLive']
print('name', *keys, 'finalComps8','final sizes top',sep=' | ')
for n in names:
    r=load(n); rows=r['rows']; T=r['args']['steps']; t0=T//2
    print(n, *[late(rows,k,t0) for k in keys], rows[-1]['comps8'], rows[-1]['sizes8top'][:6], 'res', max(abs(x['residual']) for x in rows),sep=' | ')
