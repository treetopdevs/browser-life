# Matter aquarium

Four tanks start with the same material and the same moving light. One keeps its active pool closed; one receives nutrient rain; one buries detritus; the fourth does both. Rain comes from a finite, visible reservoir. Buried material stays in the sediment account.

The green patches are supplied algae-like growth, not discovered organisms. Lit biomass converts nutrient into more biomass and can move a small amount into an empty neighbor. Decay makes detritus, which falls, recycles or is buried. The moving light, permanently dark bottom and sediment zone are designed features. There are no genes in this prototype.

Every material unit stays in the account: nutrient, biomass, detritus, unused reservoir or sediment. Pool transfers are different from movement within a pool. A nutrient unit can move repeatedly, so cumulative unit-moves can exceed the total material in the tank.

The nutrient rule is threshold relaxation: small differences do not move. This can leave gradients or oscillations. It is not a fluid simulation. Use the separate nutrient, biomass and detritus views to read each field; all tanks share the same color scales, with saturation disclosed.

If biomass disappears, the simulation keeps updating material. That allows rain, recycling and burial to continue where the remaining state permits; it does not guarantee that a dead tank will keep moving. There is no hidden reseeding.

At the fixed 3,000-tick pilot horizon, a standard rain tank still has 8,768 of its original 32,768 reservoir units. The source is scheduled to empty at tick 4,096. The pilot therefore does not show what happens after ordinary source exhaustion. The viewer runs to 6,000 ticks, and its controls stop there.

Open `/matter/` locally. Compare the four modes at the same tick, pause and inspect their stocks and histories, or export all four observations. Exports are records, not resumable checkpoints. This slice is private and undeployed.

[Plan and review resolutions](matter-plan.md) · [Decision log](decisions.html#matter-next)

## First fixed outcomes

All twelve tanks lost biomass: at tick790 for seed1201, tick1000 for seed1202, and tick790 for seed1203. Within each seed, all four modes have identical sampled biomass totals and identical biomass fields at the four saved milestones. Their sampled peaks were792,927 and834 units respectively. This does not establish equality at every unrecorded tick.

Burial still moved material: the three burial-enabled pairs accumulated534,964 and548 sediment units, first differing from their matched controls at tick32. Rain first changed physical state at tick8. The rain tanks continued nutrient relocation after biomass disappeared, but adding and removing material did not sustain the green patches in this slice. All outcomes are retained, and the before-tick500 stop rule was not triggered.

The next creative direction is to test a deliberately supplied recirculating current against this preserved baseline. The current should carry nutrient through the growth region while keeping the same counted-matter rules. This is a proposed mechanism to try, not an established explanation or result.
