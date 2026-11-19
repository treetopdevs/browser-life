import json,glob,sys,statistics as st
def late(S,key,t0=10000):
    return [key(x) for x in S if x['t']>=t0]
def m(v): return round(st.mean(v),1) if v else None
root=sys.argv[1]
for d in sorted(glob.glob(root+'/*')):
    print(d)
    for s in (1,2,3):
        try: r=json.load(open(f'{d}/s{s}/readout.json'))
        except Exception: print('  s%d missing'%s); continue
        S=r['series'];f=S[-1]
        cells=m(late(S,lambda x:x['cells']));comps=m(late(S,lambda x:x['comps']))
        nbas=m(late(S,lambda x:x['basins']['n']));med=m(late(S,lambda x:x['basins']['q'][1]))
        nb=m(late(S,lambda x:x['patches']['nBig']));seam=m(late(S,lambda x:x['seams']['seamPermille']))
        dist=m(late(S,lambda x:x['kin']['distinct']))
        births=sum(x['patches']['births'] for x in S if x['t']>=10000);deaths=sum(x['patches']['deaths'] for x in S if x['t']>=10000)
        repl=sum((x['patches']['replacedTiles'] or 0) for x in S if x['t']>=10000)
        g=f['genes']['meansX10'];c=f['counters']
        print(f"  s{s}: cells {cells} comps {comps} basins {nbas} med {med} | patches nBig {nb} top3@end {f['patches']['sizesTop8'][:4]} large‰ {f['patches']['largestSharePermille']} seam‰ {seam} dist {dist} b/d(t>=10k) {births}/{deaths} repl {repl} | burn {c['seamBurned']} raid {c['raided']} blkG {c['blockedGrow']} muts {c['mutations']} tagmut {c['tagMutations']} | genes {g} tol {f['kin']['tolMeanX10']} | hash {r['final']['stateHash']}")
