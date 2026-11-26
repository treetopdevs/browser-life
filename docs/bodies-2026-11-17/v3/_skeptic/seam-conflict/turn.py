import sys,os,glob
import numpy as np
from an import load,circ,shift,classes
W=H=96;N=W*H
def near_foreign(cell,kin,tol,rad=2):
    """True where tile has a live foreign-mark cell within chebyshev rad of a live cell... (tile itself live)"""
    out=np.zeros(N,bool)
    live=cell==1
    for dy in range(-rad,rad+1):
        for dx in range(-rad,rad+1):
            if dx==0 and dy==0: continue
            nb=np.roll(np.roll(cell.reshape(H,W),-dy,0),-dx,1).reshape(N);nk=np.roll(np.roll(kin.reshape(H,W),-dy,0),-dx,1).reshape(N)
            out|=live&(nb==1)&(circ(kin,nk)>tol)
    return out
def run(d,stride=2,t0=0):
    m,raw=load(d);tol=m['rules']['TAG_TOL'];times=m['times'][:len(raw)]
    idx=[i for i,t in enumerate(times) if t>=t0][::stride]
    tot=0;nearc=0;flicker=0;mutual=0
    changed_hist=np.zeros(N,int)
    per=[]
    for a,b in zip(idx[:-1],idx[1:]):
        c0,k0,c1,k1=raw[a,0],raw[a,1],raw[b,0],raw[b,1]
        both=(c0==1)&(c1==1);rep=both&(circ(k0,k1)>tol)
        r=int(rep.sum());tot+=r;per.append(r)
        if r:
            nf=near_foreign(c1,k1,tol)|near_foreign(c0,k0,tol)
            nearc+=int((rep&nf).sum())
        changed_hist+=rep
    # final vs initial net: tiles live at both t0 and end with different class
    a,b=idx[0],idx[-1]
    both=(raw[a,0]==1)&(raw[b,0]==1);net=int((both&(circ(raw[a,1],raw[b,1])>tol)).sum())
    # share of largest mark class at start and end
    def topshare(i):
        cell,kin=raw[i,0],raw[i,1];cl=classes(cell,kin,tol);cc={}
        for v in np.unique(kin[cell==1]): cc[cl[int(v)]]=cc.get(cl[int(v)],0)+int(((kin==v)&(cell==1)).sum())
        s=sorted(cc.values(),reverse=True);return s[:4],int(cell.sum())
    return dict(name=os.path.basename(d),stride=stride*m['every'],total_replaced=tot,near_seam_frac=round(nearc/tot,3) if tot else None,net_changed_tiles_start_to_end=net,tiles_changed_gt1=int((changed_hist>1).sum()),top_start=topshare(a),top_end=topshare(b),per_max=max(per) if per else 0)
if __name__=='__main__':
    for d in sys.argv[1:]:
        for st in (2,1):
            print(run(d,st))
