import json,sys,os
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
W=H=96;N=W*H
DX=[1,1,0,-1,-1,-1,0,1];DY=[0,1,1,1,0,-1,-1,-1]
def load(d):
    m=json.load(open(d+'/meta.json'));raw=np.fromfile(d+'/snaps.bin',dtype=np.uint8)
    n=len(raw)//(4*N);raw=raw[:n*4*N].reshape(n,4,N)
    return m,raw
def circ(a,b):
    x=np.abs(a.astype(int)-b.astype(int));return np.where(x>128,256-x,x)
def shift(a,k):  # value of neighbour k for each tile
    A=a.reshape(H,W);return np.roll(np.roll(A,-DY[k],axis=0),-DX[k],axis=1).reshape(N)
def comps(cell,kin,tol,match=False):
    idx=np.arange(N);rows=[];cols=[]
    for k in range(8):
        nb=shift(cell,k);nidx=shift(idx,k)
        ok=(cell==1)&(nb==1)
        if match: ok&=circ(kin,shift(kin,k))<=tol
        rows.append(idx[ok]);cols.append(nidx[ok])
    r=np.concatenate(rows);c=np.concatenate(cols)
    g=coo_matrix((np.ones(len(r)),(r,c)),shape=(N,N))
    nc,lab=connected_components(g,directed=False)
    lab=np.where(cell==1,lab,-1)
    sizes=np.bincount(lab[lab>=0]);return lab,sorted([z for z in sizes.tolist() if z>0],reverse=True)
def classes(cell,kin,tol):
    vals=np.unique(kin[cell==1]);cls={}
    # chain-link mark values within tol
    par={v:v for v in vals}
    def f(x):
        while par[x]!=x: par[x]=par[par[x]];x=par[x]
        return x
    for a in vals:
        for b in vals:
            if a<b and circ(np.array([a]),np.array([b]))[0]<=tol: par[f(a)]=f(b)
    return {int(v):int(f(v)) for v in vals}
def seams4(cell,kin,tol):
    s=0;p=0
    for k in (0,2):
        nb=shift(cell,k);ok=(cell==1)&(nb==1);p+=ok.sum()
        s+=(ok&(circ(kin,shift(kin,k))>tol)).sum()
    return int(s),int(p)
def stats(d,t_list=None,tol=None):
    m,raw=load(d);tol=m['rules']['TAG_TOL'] if tol is None else tol
    times=m['times'][:len(raw)];out=[]
    for ti,t in enumerate(times):
        if t_list is not None and t not in t_list: continue
        cell,kin,dd=raw[ti,0],raw[ti,1],raw[ti,2]
        lab,sz=comps(cell,kin,tol,False);plab,psz=comps(cell,kin,tol,True)
        cl=classes(cell,kin,tol);cc={}
        for v,c in cl.items(): cc.setdefault(c,0)
        for v in np.unique(kin[cell==1]):
            cc[cl[int(v)]]+=int(((kin==v)&(cell==1)).sum())
        s,p=seams4(cell,kin,tol)
        out.append(dict(t=t,cells=int(cell.sum()),comps=len(sz),top=sz[:5],patches=len(psz),ptop=psz[:5],bigpatch=sum(1 for z in psz if z>=10),classes=sorted(cc.values(),reverse=True),seam=s,pairs=p,roots=int(((dd==0)&(cell==1)).sum())))
    return m,out
def turnover(d,stride=1,tol=None):
    """tiles live at both consecutive (stride) snapshots with marks not matching; plus by class pair"""
    m,raw=load(d);tol=m['rules']['TAG_TOL'] if tol is None else tol
    tot=0;per=[];near=0;toward_dom=0;away=0
    prev=None
    for ti in range(0,len(raw),stride):
        cell,kin=raw[ti,0],raw[ti,1]
        if prev is not None:
            pc,pk=prev;both=(cell==1)&(pc==1);rep=both&(circ(kin,pk)>tol)
            r=int(rep.sum());tot+=r;per.append(r)
        prev=(cell,kin)
    return tot,per
if __name__=='__main__':
    d=sys.argv[1];ts=[int(x) for x in sys.argv[2:]] or None
    m,o=stats(d,ts)
    print(os.path.basename(d),'hash',m['hashFull'],'resid',m['residual'])
    for r in o: print(r)
