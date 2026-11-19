import json,sys,glob,os,statistics as st
def late(series,t0):
    return [r for r in series if r['t']>=t0]
def m(x): return sum(x)/len(x) if x else float('nan')
def row(name,t0=None):
    d=json.load(open(f'{name}/readout.json'));S=d['series'];f=d['final']
    t0=t0 if t0 is not None else d['meta']['steps']//2
    L=late(S,t0)
    g=lambda fn:m([fn(r) for r in L])
    gm=f.get('genes') or {}
    return dict(name=name,cells=f['cells'],comps=round(g(lambda r:r['comps']),2),big=round(g(lambda r:r['largestSharePermille']),0),
      basins=round(g(lambda r:r['basins']['n']),1),bmed=round(g(lambda r:r['basins']['q'][1]),0),
      nbigp=round(g(lambda r:r['patches']['nBig']),1),top=f['patches']['sizesTop8'][:4],
      marks=f['kin']['distinct'] if 'distinct' in f['kin'] else f['kin'],
      seam=round(g(lambda r:r['seams'].get('permille',0) if isinstance(r['seams'],dict) else 0),1),
      births=sum((r['patches'].get('births') or 0) for r in L),deaths=sum((r['patches'].get('deaths') or 0) for r in L))
if __name__=='__main__':
    for n in sys.argv[1:]:
        try: print(row(n))
        except Exception as e: print(n,'ERR',e)
