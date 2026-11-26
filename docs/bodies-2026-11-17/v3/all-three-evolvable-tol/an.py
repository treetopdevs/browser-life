import json,sys,statistics as st
def load(n):
    return json.load(open(n+'/readout.json'))
def late(d,k,t0=10000):
    v=[k(r) for r in d['series'] if r['t']>=t0]
    return sum(v)/len(v) if v else None
def row(n):
    d=load(n); S=d['series']
    f=S[-1]
    L=lambda k:late(d,k)
    return dict(n=n,cells=f['cells'],comps=round(L(lambda r:r['comps']),2),largest=round(L(lambda r:r['largestSharePermille']),0),
     basins=round(L(lambda r:r['basins']['n']),1),basMed=round(L(lambda r:r['basins']['q'][1]),0),
     patches=round(L(lambda r:r['patches']['n']),1),nBig=round(L(lambda r:r['patches']['nBig']),1),top=f['patches']['sizesTop8'][:4],
     distinct=f['kin']['distinct'],distinct10k=[r['kin']['distinct'] for r in S if r['t'] in (2000,5000,10000,15000)],
     seam=round(L(lambda r:r['seams']['seamPermille']),1),births=round(L(lambda r:r['patches']['births'] or 0),2),deaths=round(L(lambda r:r['patches']['deaths'] or 0),2),
     tol=[r['kin']['tolMeanX10']/10 for r in S if r['t'] in (0,2000,5000,10000,15000,20000)],
     genes=[x/10 for x in f['genes']['meansX10']],tagmut=f['counters']['tagMutations'],blocked=f['counters']['blockedGrow'],hash=d['final']['stateHashFull'])
if __name__=='__main__':
    for n in sys.argv[1:]:
        try: print(json.dumps(row(n)))
        except Exception as e: print(n,'ERR',e)
