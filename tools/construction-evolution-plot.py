"""Plot the completed bounded assay; source histories, not transfer trials, are replicates."""
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

root = Path('runs/construction/evolution-v1')
summary = json.loads((root / 'summary.json').read_text())
assert summary['complete']
rows = json.loads((root / 'source-rows.json').read_text())
transfers = json.loads((root / 'transfer-readouts.json').read_text())
fig, axes = plt.subplots(1, 2, figsize=(11, 4.6), constrained_layout=True)
colors = ['#536b83', '#d67532']
for j, founder in enumerate([1, 4, 8]):
    off = sorted([r for r in rows if r['founder'] == founder and not r['mutation'] and r['gate']], key=lambda r:r['seed'])
    on = sorted([r for r in rows if r['founder'] == founder and r['mutation'] and r['gate']], key=lambda r:r['seed'])
    for a, b in zip(off, on):
        axes[0].plot([j-.15,j+.15], [a['B'],b['B']], color='#aab3bc', alpha=.65, lw=.9, zorder=1)
    for mut, rs in enumerate([off,on]):
        x=j+(-.15 if mut==0 else .15)
        axes[0].scatter([x]*5, [r['B'] for r in rs], s=28, color=colors[mut], zorder=2,
                        label=['Mutation off','Mutation on'][mut] if j==0 else None)
        axes[0].plot([x-.08,x+.08], [np.mean([r['B'] for r in rs])]*2, color=colors[mut], lw=2.5)
    ts=sorted([r for r in transfers if r['founder']==founder and r['mutation'] and r['gate']],key=lambda r:r['seed'])
    for k, r in enumerate(ts):
        axes[1].scatter(j+(k-2)*.045, r['transferGainOn'], color=colors[1], s=30)
    axes[1].plot([j-.2,j+.2], [np.mean([r['transferGainOn'] for r in ts])]*2, color=colors[1], lw=2.5)
for ax in axes:
    ax.set_xticks(range(3),['BUILD 1','BUILD 4','BUILD 8'])
    ax.spines[['top','right']].set_visible(False)
    ax.grid(axis='y', color='#dddddd', linewidth=.5)
    ax.set_axisbelow(True)
axes[0].set_title('Ecological performance at 3,000 steps', loc='left', fontsize=11)
axes[0].set_ylabel('Active biomass B')
axes[0].legend(frameon=False, fontsize=9)
axes[1].axhline(0, color='#536b83', lw=1)
axes[1].set_title('Equal-resource transfer: descendant − ancestor', loc='left', fontsize=11)
axes[1].set_ylabel('Mean B gain across three fresh transfer seeds')
counts=sum(x['counts'] for x in summary['founderReadouts'])
fig.suptitle(f'Stationary mutation accumulation · {counts}/3 founders pass the fixed screen', fontsize=14)
fig.supxlabel('Five source histories per starting variant; transport gate active. Bars mark means.\nMutations replace site genotypes: this is not selection among reproducing colonies.', fontsize=9)
for suffix in ['png','svg']:
    fig.savefig(f'experiments/construction/evolution-v1.{suffix}', dpi=180)
