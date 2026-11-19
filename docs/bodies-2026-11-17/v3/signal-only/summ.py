import json,sys,glob,os
def row(r,t=None):
    s=r['series']; 
    return s[-1] if t is None else [x for x in s if x['t']==t][0]
for d in sys.argv[1:]:
    r=json.load(open(d+'/readout.json')); 
    ser=r['series']
    late=[x for x in ser if x['t']>=ser[-1]['t']//2]
    f=ser[-1]
    m=lambda g:sum(g(x) for x in late)/len(late)
    print(os.path.basename(d),'cells',f['cells'],'comps',f['comps'],'largest‰',f['largestSharePermille'],'basins',f['basins']['n'],f['basins']['q'],'patches',f['patches']['n'],f['patches']['sizesTop8'][:5],'kin',f['kin']['distinct'],'seam‰',f['seams']['seamPermille'],'| late mean: comps %.2f basins %.1f seam %.1f nBig %.2f'%(m(lambda x:x['comps']),m(lambda x:x['basins']['n']),m(lambda x:x['seams']['seamPermille']),m(lambda x:x['patches']['nBig'])),'hash',r['final']['stateHash'])
