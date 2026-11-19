import json,sys
n=sys.argv[1]; d=json.load(open(n+'/readout.json'))
for r in d['series']:
    if r['t']%2000==0: print(r['t'],'cells',r['cells'],'comps',r['comps'],'bas',r['basins']['n'],r['basins']['q'][1],'patch',r['patches']['n'],r['patches']['nBig'],r['patches']['sizesTop8'][:3],'dist',r['kin']['distinct'],'tol',r['kin']['tolMeanX10']/10,'seam',r['seams']['seamPermille'],'tm',r['counters']['tagMutations'],'blk',r['counters']['blockedGrow'],'genes',[x/10 for x in r['genes']['meansX10']])
