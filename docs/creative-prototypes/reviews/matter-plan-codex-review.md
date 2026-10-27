The core arithmetic is consistent. I found no conservation or synchronous-update contradiction, but several reporting and assay decisions should be pinned before implementation.

1. **Define “late activity” and “settled” precisely.** The specified activity measures biomass differences between sample endpoints. A tile can repeatedly grow and lose biomass yet have identical B at successive samples. Extinction also inserts an irregular sample interval, so averaging sample values can weight conditions differently. Specify the aggregation over 2000–3000, interval inclusion, and whether exact-extinction samples participate. Label this as sampled biomass change; use transfer-counter differences when discussing turnover. Zero biomass activity must not imply stationary water. [Plan lines 39–53](/Users/nicholas/.codex/worktrees/matter-flow-aquarium/browser-life/docs/creative-prototypes/matter-plan.md:39)

2. **Bound conclusions about finite rain to the pilot horizon.** Rain imports 64 units every eight ticks. At tick 3000 it has imported **24,000**, leaving **8,768**; uninterrupted rain exhausts the reservoir at tick **4096**. Thus the fixed pilot does not observe ordinary source exhaustion or its aftermath. Keep the fixed horizon, but require the report to state this limitation and distinguish biological settling from physical settling. The last-unit fixture verifies exhaustion mechanics, not the standard runs’ response to exhaustion. [Plan lines 21, 53](/Users/nicholas/.codex/worktrees/matter-flow-aquarium/browser-life/docs/creative-prototypes/matter-plan.md:53)

3. **Make the two acceptance fixtures reproducible recipes.** “Ample N,” “initial light,” and “through at least 100 ticks” leave the gate’s inputs and expected outcomes open. Pin the mode, nutrient distribution, founder tile, phases, horizon, and expected growth/spread results. Likewise, the biomass-zero fixture needs specified detritus in a location and quantity that actually exercise burial; rain alone cannot produce sediment when B and D start at zero. State what fixture evidence the runner retains and `--check` validates. [Plan line 51](/Users/nicholas/.codex/worktrees/matter-flow-aquarium/browser-life/docs/creative-prototypes/matter-plan.md:51)

4. **Make stock-to-counter reconciliation explicit.** A zero global residual cannot detect a transfer credited to the wrong pool or a miscounted cumulative transfer. Define these assertions for both fixtures and production initialization:

   - `reservoir = reservoir₀ − imported`
   - `sediment = buried`
   - `N = N₀ + imported − growth + recycled`
   - `B = B₀ + growth − mortality`
   - `D = D₀ + mortality − recycled − buried`

   Spread and settling change locations only. These identities give concrete meaning to the promised “final stock/counter truth.” [Plan lines 39, 53–55](/Users/nicholas/.codex/worktrees/matter-flow-aquarium/browser-life/docs/creative-prototypes/matter-plan.md:55)

5. **Specify comparable color scales and disabled-source labels.** A shared channel selector does not establish shared numerical color scales. Independent normalization could make unequal stocks look equal across tanks. Choose common scales per channel and disclose saturation. In rain-disabled cards, label the retained reservoir as unavailable or disabled rather than simply “rain remaining.” [Plan line 45](/Users/nicholas/.codex/worktrees/matter-flow-aquarium/browser-life/docs/creative-prototypes/matter-plan.md:45)

Two implementation hazards deserve explicit regression coverage:

- The existing [development clock](/Users/nicholas/.codex/worktrees/matter-flow-aquarium/browser-life/apps/lab/src/development/comparison-clock.ts:16) and [pilot runner](/Users/nicholas/.codex/worktrees/matter-flow-aquarium/browser-life/tools/development/explore.ts:593) skip extinct worlds. The matter contract correctly forbids that. Test the browser comparison clock and runner after extinction, including subsequent snapshots and history—not just `MatterWorld.step()`.
- Preserve signed, separate delta buffers. Applying negative deltas through unsigned intermediate arithmetic, or updating neighbors in place, would invalidate the otherwise sound bounds argument.

The mathematical checks hold: `3072×12 + 8×16 + 32768 = 69760`; mixing cannot overdraw a donor; extension targets receive at most 16; existing biomass remains at most 64; and biomass zero is absorbing while material transport continues.

The ecological implications are toy choices, not defects requiring realism amendments. Integer mixing permits persistent differences below four units. Recycling can remove an isolated one-unit detritus pulse before it reaches burial depth. Unlit extension targets receive at most 16 biomass and cannot independently reach the extension threshold of 24. These rules may limit sediment accumulation or growth into darkness; they do not justify survival or real-ecology claims.

Static, read-only review only. No files changed, tests run, external research, or delegated reviews.