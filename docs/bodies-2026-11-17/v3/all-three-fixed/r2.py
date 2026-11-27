import json,glob,sys
def m(x): return sum(x)/len(x) if x else float('nan')
def sm(n):
    d=json.load(open(n+'/readout.json'));S=[r for r in d['series'] if r['t']>=10000];f=d['final']
    g=lambda fn:m([fn(r) for r in S])
    return (n,f['cells'],'comps %.2f'%g(lambda r:r['comps']),'big%% %.0f'%(g(lambda r:r['largestSharePermille'])/10),
     'basins %.0f med %.0f'%(g(lambda r:r['basins']['n']),g(lambda r:r['basins']['q'][1])),
     'patchBig %.1f'%g(lambda r:r['patches']['nBig']),'top',f['patches']['sizesTop8'][:4],
     'marks',f['kin']['distinct'],'seamPm %.1f'%g(lambda r:r['seams']['seamPermille']),
     'births',sum(r['patches']['births'] or 0 for r in S),'deaths',sum(r['patches']['deaths'] or 0 for r in S),
     'genes',[x/10 for x in f['genes']['meansX10']],'tol',f['kin']['tolMeanX10']/10,'tagMut',f['counters']['tagMutations'],'blk',f['counters']['blockedGrow'],f['counters']['blockedBud'])
for p in sys.argv[1:]:
    for n in sorted(glob.glob(p)):
        n=n.rstrip('/')
        try: print(*sm(n))
        except Exception as e: print(n,'ERR',e)
