import sys,os,colorsys
import numpy as np
from PIL import Image
from an import load,comps,circ,shift
from basin import basins as _b
W=H=96;N=W*H
def basin_labels(cell,kin,d,tol,sig):
    live=np.where(cell==1)[0];order=live[np.argsort(d[live],kind='stable')];lab=-np.ones(N,int);idx=np.arange(N);NB=np.stack([shift(idx,k) for k in range(8)])
    for i in order:
        if d[i]==0: lab[i]=i;continue
        best=d[i];nx=-1
        for k in range(8):
            p=NB[k][i]
            if cell[p]==1 and d[p]<best and (not sig or circ(np.array([kin[i]]),np.array([kin[p]]))[0]<=tol): best=d[p];nx=p
        lab[i]=lab[nx] if nx>=0 else -1
    return lab
def col(h,s=0.75,v=0.95): return tuple(int(255*c) for c in colorsys.hsv_to_rgb(h%1,s,v))
def hashcol(x): 
    r=(x*2654435761)&0xffffffff;return col((r%1000)/1000.0,0.55+0.4*((r>>10)%2),0.7+0.25*((r>>11)%2))
def render(d,t,out,scale=5):
    m,raw=load(d);ti=m['times'].index(t);cell,kin,dd=raw[ti,0],raw[ti,1],raw[ti,2];tol=m['rules']['TAG_TOL'];sig=m['rules']['GATE_SIGNAL']>0 and '--tag-blind' not in m['args']
    lab,_=comps(cell,kin,tol);bl=basin_labels(cell,kin,dd,tol,sig)
    imgs=[]
    for mode in range(3):
        a=np.zeros((N,3),np.uint8);a[:]=(16,24,30)
        for i in np.where(cell==1)[0]:
            if mode==0: a[i]=col(kin[i]/256.0)
            elif mode==1: a[i]=hashcol(int(lab[i])+7)
            else: a[i]=hashcol(int(bl[i])+13) if bl[i]>=0 else (255,255,255)
            if dd[i]==0 and mode in (0,2): a[i]=(255,255,255) if mode==0 else (0,0,0)
        im=Image.fromarray(a.reshape(H,W,3)).resize((W*scale,H*scale),Image.NEAREST);imgs.append(im)
    g=8;canvas=Image.new('RGB',(3*W*scale+2*g,H*scale),(40,40,40))
    for k,im in enumerate(imgs): canvas.paste(im,(k*(W*scale+g),0))
    canvas.save(out)
if __name__=='__main__':
    render(sys.argv[1],int(sys.argv[2]),sys.argv[3])
