import json,glob,os,sys
import numpy as np
R='/Users/nicholas/develop/browser-life-bodies/docs/bodies-2026-11-17/v3/seam-conflict'
def load(p):
    try: return json.load(open(p))
    except Exception as e: return None
def late(S,t0=10000): return [x for x in S if x['t']>=t0]
def mean(v): return float(np.mean(v)) if len(v) else float('nan')
print("== rung1 pair (12000 steps): nBig range over all samples, patch deaths, comps, seam range, final cells")
for d in sorted(glob.glob(R+'/r1/*')):
    rows=[]
    for s in (1,2,3):
        r=load(f'{d}/s{s}/readout.json')
        if not r: continue
        S=r['series']
        nbig=set(x['patches']['nBig'] for x in S[1:])
        dead=r['final']['patches']['deadCount']
        sm=[x['seams']['seamPermille'] for x in S]
        rows.append((s,sorted(nbig),dead,max(sm),r['final']['cells'],r['final']['comps'],r['final']['patches']['sizesTop8'][:3]))
    print(os.path.basename(d),rows)
print("== rung3 crowd late means (t>=10000)")
for n in ['A','A_blind','A_same','B','B_blind','B_same','C','C_blind','C_same']:
    out=[]
    for s in (1,2,3):
        r=load(f'{R}/r3/{n}/s{s}/readout.json')
        if not r: out.append(None); continue
        L=late(r['series'])
        out.append((round(mean([x['comps'] for x in L]),1), round(mean([x['patches']['largestSharePermille'] for x in L])), round(mean([x['patches']['nBig'] for x in L]),1), r['final']['kin']['distinct'], round(mean([x['cells'] for x in L])), round(mean([x['seams']['seamPermille'] for x in L]),1)))
    print(n,'(comps,largest‰,nBig,distinct,cells,seam‰):',out)
print("== replacedTiles whole-run sums")
for dd in ['r5/sc8raid0','r5/sc20raid0','r5/sc20raid0_blind','r5/sc8_nogates','r5/sc20_nogates','r3/B','r3/B_blind','r3/C','r3/C_blind']:
    out=[]
    for s in (1,2,3):
        r=load(f'{R}/{dd}/s{s}/readout.json')
        if not r: out.append(None); continue
        out.append(sum((x['patches']['replacedTiles'] or 0) for x in r['series'][1:]))
    print(dd,out)
print("== C frozen? top8 sizes at 2000-step samples, seed 2")
r=load(f'{R}/r3/C/s2/readout.json')
for x in r['series']:
    if x['t']%2000==0: print(x['t'],x['cells'],x['comps'],x['patches']['sizesTop8'],x['patches']['births'],x['patches']['deaths'],x['patches']['replacedTiles'])
