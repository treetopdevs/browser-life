import sys,os,glob
import numpy as np
from an import load,comps,classes,circ,seams4
from basin import basins
names=sys.argv[1:]
print('run | steps | comps(8conn) mean t>=10k | largest-comp share‰ | classes(mark clades) | largest clade share‰ | cells | roots | basins n/median/within2x‰(t=end) | seam4 ‰')
for d in names:
    if not os.path.exists(d+'/meta.json'): print(d,'missing');continue
    m,raw=load(d);tol=m['rules']['TAG_TOL'];times=m['times'][:len(raw)]
    sig=m['rules']['GATE_SIGNAL']>0 and '--tag-blind' not in m['args']
    sel=[i for i,t in enumerate(times) if t>=10000 and t%1000==0]
    C=[];LS=[];CL=[];LC=[];CE=[];RT=[];SM=[]
    for i in sel:
        cell,kin,dd=raw[i,0],raw[i,1],raw[i,2]
        lab,sz=comps(cell,kin,tol);C.append(len(sz));LS.append(1000*sz[0]/cell.sum());CE.append(cell.sum());RT.append(int(((dd==0)&(cell==1)).sum()))
        cl=classes(cell,kin,tol);cc={}
        for v in np.unique(kin[cell==1]): cc[cl[int(v)]]=cc.get(cl[int(v)],0)+int(((kin==v)&(cell==1)).sum())
        s=sorted(cc.values(),reverse=True);CL.append(len(s));LC.append(1000*s[0]/cell.sum())
        a,b=seams4(cell,kin,tol);SM.append(1000*a/max(b,1))
    i=len(raw)-1;s,un=basins(raw[i,0],raw[i,1],raw[i,2],tol,sig)
    w=sum(z for z in s if 85<=z<=340)
    print(f"{os.path.basename(d)} | {m['times'][-1]} | {np.mean(C):.1f} | {np.mean(LS):.0f} | {np.mean(CL):.1f} | {np.mean(LC):.0f} | {np.mean(CE):.0f} | {np.mean(RT):.0f} | {len(s)}/{s[len(s)//2]}/{round(1000*w/raw[i,0].sum())} | {np.mean(SM):.1f}")
