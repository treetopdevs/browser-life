# Seasonal food patches

At `/particles/seasons/`, compare one flock recipe and seed under constant food renewal, short seasons and long seasons. Patches stay in place. Wet, ordinary and dry conditions rotate through three rows, offering 1.75, 1 and 0.25 times the normal renewal rate.

Short phases last 600 ticks; a full cycle takes 1,800 ticks. Long phases last 1,800 ticks; a cycle takes 5,400 ticks. The total offered food is equal in all three worlds. The amount actually added can differ: a full patch cannot accept more food. No reserves are erased, no organisms are moved and no extinct population is rescued.

The UI numbers phases 1–3; machine-readable phase fields and technical report references use 0–2. The display names the regime used in the last completed tick and the absolute tick when the next phase begins. At tick 0, the first phase is ready. An extinct world freezes its local clock and regime while the comparison continues. Histories show the most recent 3,000 ticks, which is shorter than a full long cycle. Download an observation to retain current states; it cannot resume a run.

Food seeking is supplied steering toward the nearest patch regardless of its stock. A group may therefore stay beside a poorly fed patch instead of migrating to a richer row. Mutation affects inherited movement traits; it does not give organisms an engineered seasonal forecast.

This is a deliberately constructed ecology toy. Population rebounds, family survival and interesting motion are observations, not proof of adaptation. All tested outcomes belong in the evidence, including repetitive cycles and extinction.

[Plan and review resolutions](seasons-plan.md) · [Decision log](decisions.html)

## First results

[All nine runs](seasons-pilot.md) stayed populated through 10,800 ticks. Long seasons retained all three founding families in all three seeds, compared with one seed under constant food. Short seasons produced repeated low-count rebounds in seed 1201 while losing Amber in the other two seeds. Realized food intake also differs, so this is descriptive ecology, not evidence that seasonal timing alone improves survival. [Validation](seasons-validation.md).

The changes continue late in the run, but they become **seasonal rhythms rather than endless novelty**. In short-season seed 1201, Mint and Amber repeatedly fall into single digits and recover. Both have a sampled low at tick 9,800 and rebound by 10,400. Over ticks 9,000–10,800, Mint ranges from 3 to 41 and Amber from 4 to 41; under constant food the same families range 36–47 and 17–24. Their rebounds recur roughly one full short cycle apart. This is deliberately driven boom-and-bust behavior, worth keeping as a watchable prototype.

[Visual inspection and local recordings](seasons-visual-check.md) show that groups remain compact. The demographic changes do not imply new body shapes, pursuit strategies or open-ended invention. The next breadth-first slice should introduce a different mechanism—sharp boundaries or bonds—rather than repeatedly tuning this environment.
