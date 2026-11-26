import sys,os,glob
import numpy as np
from an import load,circ,shift
W=H=96;N=W*H
def basins(cell,kin,d,tol,sig):
    live=np.where(cell==1)[0]
    order=live[np.argsort(d[live],kind='stable')]
    lab=-np.ones(N,int);nbr_idx=[]
    idx=np.arange(N)
    NB=np.stack([shift(idx,k) for k in range(8)])
    for i in order:
        if d[i]==0: lab[i]=i;continue
        best=d[i];nx=-1
        for k in range(8):
            p=NB[k][i]
            if cell[p]==1 and d[p]<best and (not sig or circ(np.array([kin[i]]),np.array([kin[p]]))[0]<=tol): best=d[p];nx=p
        lab[i]=lab[nx] if nx>=0 else -1
    c=np.bincount(lab[lab>=0],minlength=N);sizes=sorted([z for z in c.tolist() if z>0],reverse=True)
    return sizes,int((lab==-1)[live].sum())
if __name__=='__main__':
    for d in sys.argv[1:]:
        m,raw=load(d);tol=m['rules']['TAG_TOL'];sig=m['rules']['GATE_SIGNAL']>0 and '--tag-blind' not in m['args']
        res=[]
        for ti in (len(raw)-1,len(raw)-1-50):
            cell,kin,dd=raw[ti,0],raw[ti,1],raw[ti,2]
            s,un=basins(cell,kin,dd,tol,sig)
            w=sum(z for z in s if 85<=z<=340)
            res.append((m['times'][ti],len(s),s[len(s)//2],round(1000*w/cell.sum()),un))
        print(os.path.basename(d),'(t,n basins,median,within2x‰,unrooted)',res)
