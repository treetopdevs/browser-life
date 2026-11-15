# Owner conduit sizing record (15 Nov 2026), written before any main run

EXPLORATION. Dev slots 8209 to 8212 only; nothing here enters a table. Rules O1 to O3 of `DESIGN.md` (sections 2 and 7) applied by `bootstrap-screen.ts --size-owner`. The result is `runs/mycelium-owner/sizing-owner-frozen.json` (gitignored): the first screen's frozen sizing plus `gOwner`, `gPassive`, `gCpub`. Every main command passes that file. All 16 pilot runs closed both ledgers at every read.

## What the pilots showed

**The gated world has two states.** With the eating gate on (theta 4, toll substrate), a world ends up either in clan territories or with almost no shared ownership, and it is still there at 100,000 steps:

| pilot | seed | same-owner share of directed edges | median owned `x` on them |
|---|---|---|---|
| S5, 20,000 steps | 8209, 8210, 8211, 8212 | 0.04, 0.72, 0.07, 0.61 | 1, 12, 1, 7 |
| S5L, 100,000 steps | 8209, 8210, 8211, 8212 | 0.02, 0.98, 0.03, 0.58 | 1, 15, 1, 17 |

Passive worlds (no gate) never form territories: same-owner share 0.02 to 0.05, median `x` 1, at both lengths.

## What the rules gave

- **O1, owner strength.** Territorial runs: 2 of 4 (8210, 8212). Median `x` over them 16, so `gOwner` lo / mid / hi = **7 / 30 / 120**. The extra rate at the median edge is 30 of 88 headroom (34 percent, inside the 9 to 53 band).
- **O2, passive-sized strength.** Median `x` 1, so `gPassive` = **255** (extra rate 15 on a median owned edge).
- **O3, matched public strength.** Mean owner extra rate at `g` 30 on the two territorial runs: 29.2 and 20.5. Median ratio public / owner by `g'`: 24 gives 0.854, 32 gives 1.137. **No grid value is within 10 percent, so the C-pub control is VOID by rule.** `gCpub` = 32 (the closest) is still run; (g) fails by rule; PAY against the public conduit is reported only.

## Deviations, in order

1. **Pilot lengthened to 100,000 steps.** The addendum said 20,000. The 20,000-step pilot gave median `x` 4 over all four runs (`g` 120) with two runs at `x` 1 and two at 7 and 12: territories were still forming. The pilot was rerun at the main run length on the same dev slots. Decided on sizing readouts only.
2. **Sized on the territorial runs.** The median over all four 100,000-step runs is `x` 8, `g` 60: too weak to matter in the worlds with no shared ownership (extra rate 3) and above the band in the territorial ones (extra rate 60). The strength is sized where the conduit has edges, and slots that end without territories are flagged CONDUIT-IDLE. The hi dose arm (120) and lo dose arm (7) bracket it, and both now carry branches, so PAY is read at 7, 30 and 120. The stand-in run of the first screen was at 16 (0 of 8 PAY).
3. **C-pub void** (above): the design's grid has no value between 24 and 32. The grid is not changed.
4. **Run length projection.** Core and extras together: 176 runs, 17.88 million planned steps. At the first screen's measured O rate (0.44 wall seconds per 1,000 planned steps, 164 finished lines) that is 2.2 hours, under the 3.0 hour gate. The rate is passed as `--rate 0.44` because this folder's log has no O lines yet.

## What to expect from the main slots

In the first screen's stand-in runs 7 of 8 T-EC slots and 7 of 8 T-E slots were territorial, more than the 2 of 4 dev seeds here. Slots that stay without territories will show an idle conduit; the label counts them as the design says and the qualifier names them.
