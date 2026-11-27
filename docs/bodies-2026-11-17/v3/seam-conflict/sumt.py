import json,glob,sys,statistics as st
root=sys.argv[1]
def m(v): return round(st.mean(v),1) if v else None
for d in sorted(glob.glob(root+'/*')):
    print(d)
    for s in (1,2,3):
        try: r=json.load(open(f'{d}/s{s}/readout.json'))
        except Exception: print('  missing');continue
        S=r['series'];f=S[-1]
        L=[x for x in S if x['t']>=10000]
        b=sum(x['patches']['births'] for x in S[1:]);dd=sum(x['patches']['deaths'] for x in S[1:])
        repl=sum((x['patches']['replacedTiles'] or 0) for x in S[1:])
        repl_l=sum((x['patches']['replacedTiles'] or 0) for x in L)
        # dominant-clade share trajectory
        lg=[x['patches']['largestSharePermille'] for x in S[::25]]
        c=f['counters']
        print(f"  s{s}: cells {m([x['cells'] for x in L])} comps {m([x['comps'] for x in L])} basins {m([x['basins']['n'] for x in L])} med {m([x['basins']['q'][1] for x in L])} nBig {m([x['patches']['nBig'] for x in L])} top@end {f['patches']['sizesTop8'][:4]} seam‰ {m([x['seams']['seamPermille'] for x in L])} distinct {f['kin']['distinct']} | all-run b/d {b}/{dd} repl {repl} (t>=10k {repl_l}) lifeMean {f['patches']['deadLifeMean']} | burn {c['seamBurned']} raid {c['raided']} blkG {c['blockedGrow']} tagmut {c['tagMutations']} | genes {f['genes']['meansX10']} | largest‰ every5k {lg}")
