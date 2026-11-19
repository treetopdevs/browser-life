import json,sys,glob,statistics as st
def row(r):
    k=r['kin'];p=r['patches'];s=r['seams'];g=r['genes']['meansX10']
    return f"t={r['t']:>5} cells={r['cells']:>5} comps={r['comps']:>3} lcc={r['largestSharePermille']:>4} basins={r['basins']['n']:>3} medB={r['basins']['q'][1]:>4} patches={p['n']}/{p['nBig']} top={p['sizesTop8'][:4]} seam={s['seamPermille']} dist={k['distinct']} dom={k['dominantSharePermille']} pb={p['births']} pd={p['deaths']} rep={p['replacedTiles']} genes={[x/10 for x in g]} tol={k['tolMeanX10']/10} tm={r['counters']['tagMutations']}"
for d in sys.argv[1:]:
    j=json.load(open(d+'/readout.json'));S=j['series']
    print('==',d)
    idx=[0,1,5,10,25,50,len(S)-1] if len(S)>51 else range(len(S))
    for i in sorted(set(i for i in idx if i<len(S))): print(row(S[i]))
