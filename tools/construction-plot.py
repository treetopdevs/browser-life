"""Plot saved raw witness traces; no simulation or reclassification."""
import json
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
root=Path(__file__).resolve().parents[1]
raw=root/'runs/construction'
out=root/'experiments/construction'
fig,axes=plt.subplots(1,3,figsize=(14,4.4),layout='constrained')
colors={'builder-on':'#227c66','builder-off':'#c35b40','nonbuilder-on':'#344c76'}
labels={'builder-on':'Builder, transport active','builder-off':'Builder, transport ablated','nonbuilder-on':'Matched non-builder'}
for case,color in colors.items():
 traces=[json.loads((raw/'core-v1'/f'{case}-seed-{seed}.json').read_text())['trace'] for seed in range(101,106)]
 t=[r['step'] for r in traces[0]]; b=np.array([[int(r['totals']['B']) for r in trace] for trace in traces])
 axes[0].plot(t,b.mean(axis=0),label=labels[case],color=color,lw=2)
 axes[0].fill_between(t,b.min(axis=0),b.max(axis=0),color=color,alpha=.15)
axes[0].set(title='A constructed retention function',xlabel='Simulation steps',ylabel='Active biomass B (polymer excluded)')
axes[0].legend(fontsize=8,frameon=False)
rows=json.loads((raw/'access-v1'/'summary.json').read_text()); builds=sorted(set(int(r['case'].split('-')[1]) for r in rows))
for seed in range(101,106):
 rr=[next(r for r in rows if r['seed']==seed and r['case']==f'build-{b}') for b in builds]
 axes[1].plot(builds,[int(r['final']['totals']['B']) for r in rr],marker='o',ms=3,lw=1,alpha=.65,color='#227c66')
axes[1].set(title='Partial forms remain functional',xlabel='One genome byte: BUILD bias',ylabel='Active biomass at step 3,000')
rows=json.loads((raw/'spread-v1'/'summary.json').read_text())
for build,color,label in [(0,'#344c76','Non-builder'),(16,'#227c66','Builder')]:
 values=[np.mean([r['biomassArea'] for r in rows if r['case']==f'spread-{s}-build-{build}-on'])/1e6 for s in [1,2,4]]
 axes[2].plot([1,2,4],values,marker='o',color=color,label=label)
axes[2].set(title='Spreading removes the net advantage',xlabel='Spreading parameter',ylabel='Integrated biomass (million B-steps)',xticks=[1,2,4])
axes[2].text(.04,.08,'All 60 spreading runs extinct by step 3,000',transform=axes[2].transAxes,fontsize=8)
axes[2].legend(fontsize=8,frameon=False)
for ax in axes:
 ax.spines[['top','right']].set_visible(False);ax.grid(alpha=.15);ax.set_ylim(bottom=0)
fig.suptitle('Designed genome · mutation disabled · five fresh seeds · equal initial resources',fontsize=13)
fig.savefig(out/'witness-v1.png',dpi=180)
fig.savefig(out/'witness-v1.svg')
