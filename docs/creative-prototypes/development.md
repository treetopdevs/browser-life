# Growing families

This world deliberately supplies bodies, growth, food, reproduction and aging. A short inherited program controls how each connected body develops: when it turns, when it branches, and how many segments it can build. This makes the link between a genome and a visible shape explicit.

Open `/development/` locally. The two panels begin with the same twelve founders. One keeps their programs unchanged; the other allows small changes when offspring are born. Family colors identify the founding family, while subtle shade changes distinguish programs. Select a body to inspect its actual genes, age, parent and generation. Program variants include changes that may not alter shape, such as a turning interval when turning is disabled.

Every six ticks, a body can add a segment using its queued growth instructions. Once sufficiently large, it can spend stored energy to seed an offspring nearby every eighty ticks. The parent remains alive. Each offspring starts growing its own body from the inherited program. Whole bodies die of starvation or at age 600. These are engineered rules, not organisms discovered inside a general physics simulation.

Food replenishes slowly across the grid. A body absorbs food from its occupied tiles, pays upkeep, builds segments and supplies its offspring. The integer account includes food, stored energy and structural energy; energy lost to upkeep and death is counted. Space, the 48-body ceiling, and processing older IDs first all affect competition. Smaller body limits can reach reproduction age earlier by construction; observing that advantage is not evidence of open-ended evolution.

Pause or step both worlds together, reset with a new seed, toggle the food view, or download both observations. A download records state and history; it is not a resumable checkpoint. Empty worlds remain empty. Hidden tabs pause and stay paused.

[Plan and review resolutions](development-plan.md) · [Fixed outcomes and growth assays](development-pilot.md) · [Decision log](decisions.html#development)

Earlier heritable-ring experiments changed kernel weights without clearly distinguishing bodies. This prototype uses explicit development instead, and leaves that research code and evidence untouched. No merge or deployment belongs to this slice.

The first fixed batch kept all six worlds alive through tick 3,000, with 229–234 births and seven generations. Mutation produced 20–25 living program variants, compared with three in the fixed worlds. Almost every death came from the supplied age limit; the population ceiling blocked 931–977 birth opportunities per run. This is a growing, renewing garden, with competition strongly shaped by those rules. The baseline is retained unchanged.
