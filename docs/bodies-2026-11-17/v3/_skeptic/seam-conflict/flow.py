import sys,os
import numpy as np
from collections import Counter
from an import load,circ
def flow(d,stride=2,t0=0):
    m,raw=load(d);tol=m['rules']['TAG_TOL'];times=m['times'][:len(raw)]
    idx=[i for i,t in enumerate(times) if t>=t0][::stride]
    M=Counter();dead_mid=0;tot=0
    for a,b in zip(idx[:-1],idx[1:]):
        c0,k0,c1,k1=raw[a,0],raw[a,1],raw[b,0],raw[b,1]
        both=(c0==1)&(c1==1);rep=np.where(both&(circ(k0,k1)>tol))[0]
        for i in rep: M[(int(k0[i]),int(k1[i]))]+=1
        tot+=len(rep)
    # net territory change t0 -> end in tiles by mark
    a,b=idx[0],idx[-1];k0=raw[a,1][raw[a,0]==1];k1=raw[b,1][raw[b,0]==1]
    A=Counter(k0.tolist());B=Counter(k1.tolist())
    return tot,M,A,B
if __name__=='__main__':
    for d in sys.argv[1:]:
        tot,M,A,B=flow(d,2,10000)
        print(os.path.basename(d),'replaced t>=10000 @200:',tot)
        print(' flows (old->new):',sorted(M.items(),key=lambda x:-x[1])[:8])
        print(' cells by mark t=10000:',dict(A.most_common(6)),' t=20000:',dict(B.most_common(6)))
