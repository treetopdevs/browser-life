import json,glob,sys,os
for d in sorted(glob.glob('r1/*')):
    out=[]
    for s in (1,2,3):
        r=json.load(open(f'{d}/s{s}/readout.json'));S=r['series']
        f=S[-1]
        # patch count history (nBig)
        nb=[x['patches']['nBig'] for x in S]
        rep=sum(x['patches']['replacedTiles'] or 0 for x in S)
        b=sum(x['patches']['births'] for x in S[1:]);dd=sum(x['patches']['deaths'] for x in S[1:])
        out.append(f"s{s}: cells {f['cells']} comps {f['comps']} big {f['patches']['nBig']} (min/max {min(nb)}/{max(nb)}) top {f['patches']['sizesTop8'][:3]} seam‰ {f['seams']['seamPermille']} dist {f['kin']['distinct']} roots {f['roots']} b/d {b}/{dd} repl {rep} burn {f['counters']['seamBurned']} raid {f['counters']['raided']} blk {f['counters']['blockedGrow']}")
    print(d);[print('  ',o) for o in out]
