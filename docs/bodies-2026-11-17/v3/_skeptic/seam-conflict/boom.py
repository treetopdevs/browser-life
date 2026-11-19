import sys,glob,os
import numpy as np
from an import load
for d in sorted(glob.glob('runs/*_s[0-9]')):
    if not os.path.exists(d+'/meta.json'): continue
    m,raw=load(d);cells=raw[:,0,:].sum(axis=1);times=m['times'][:len(raw)]
    first=next((t for t,c in zip(times,cells) if c>1000),None)
    print(os.path.basename(d),'first sample >1000 cells:',first,'cells@1000/2000/3000:',[int(cells[times.index(t)]) if t in times else None for t in (1000,2000,3000)])
