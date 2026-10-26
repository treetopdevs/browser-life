# Review: `matter-plan.md` (Matter rain and burial)

I found no conservation or bounds defects. I did find several design decisions that need settling before code, plus some consequences of the current rates that the plan doesn't acknowledge. Nothing was edited, and I ran nothing. Every number below comes from hand arithmetic on the plan text. I ran one grep, to check the seed-parsing pattern in `apps/lab/src/development/page.ts`.

## What checks out

- **Initial total.** 12·3072 + 128 + 32768 = 69760, so the bound is exact. Everything stays far below 2³¹.
- **Mixing budget.** `floor(|ΔN|/4) ≤ floor(N_high/4)`, and with at most 4 edges the outflow is ≤ oldN. Deltas applied together can't go negative, and vertical edges are absent.
- **Extension.**
  - Targets must have old B = 0, so a target receives ≤ 4 × 4 = 16.
  - Donors have B ≥ 24 and are nonempty, so a donor can't be a target.
  - Growth is capped at 64 and runs before extension, so the 64 cap holds.
- **Settling and burial.** Simultaneous deltas conserve. Burial after settling conserves.
- **No resurrection.** Growth needs B ≥ 4 and extension needs B ≥ 24, so it follows.
- **Packaging.** The Caddy pattern matches the existing `(?i)^/particles(?:/|$)` form in `deploy/Caddyfile`.

## Inconsistencies and missing decisions (actionable)

1. **Two of the eight founders die in every run.**
   - The light centre is `floor(tick/10)%64` with half-width 20. Founders sit at x = 8, 24, 40, 56 with B = 16.
   - Mortality takes 1 B per 10 ticks. The tile reaches B = 3 at tick 130, and the sweep then moves it to D.
   - Light reaches x = 40 only when the centre ≥ 20, which is tick 200. Both x = 40 founders (y = 12 and 28) are dead before that, in every mode and seed.
   - x = 24 is dark until tick 40, so it starts at B ≈ 12. x = 8 and x = 56 are lit at the start.
   - "Eight matched founders" is therefore six in practice.
   - Decide whether to offset the initial light centre, move the founders, or state the asymmetry.
   - It also affects the "all rain+burial seeds lose biomass before 500" stop rule and the "growing patches" visual claim.

2. **Rows y ≥ 36 are permanently dark, and extension ignores light.**
   - A colonised tile gets 4 to 16 B. With no light it decays at the next tick%10 and sheds its B to D within about 10 ticks.
   - This is a standing "dark benthos" pathway. It is probably the main supply of detritus to the burial zone (y ≥ 40).
   - Say whether it is intended. The report shouldn't read burial effects as a general ecological result.

3. **Single-unit detritus is mostly recycled before it reaches y ≥ 40.**
   - Settling moves 1 row per tick. Recycling takes `min(1,D)` per tile every 8 ticks, so a lone unit is recycled within 8 ticks and about 8 rows.
   - Only sweeps (3 units at once) and the y ≥ 36 pathway in item 2 survive far enough.
   - Inside the burial zone, recycling (tick%8) runs before burial (tick%4), so at tick%8 == 0 recycling wins.
   - "Falling detritus and sediment accumulation" may therefore be faint, and Burial-only may be near-identical to Closed.
   - This is a plan-level predicted risk. A hand calculation before the batch is not parameter tuning. Add a pre-registered "burial inert" outcome to the stop rules: all burial runs have `buried` near 0, or Burial-only matches Closed.
   - Report the first tick at which each mode's state differs from Closed, per seed. That is cheap and shows whether the switches did anything.

4. **Mixing has a dead zone.**
   - Differences ≤ 3 never move, so the N field is threshold-like (sandpile-like), not diffusive. Quenched staircases with slope up to 3 persist.
   - Nutrient released at the dark bottom needs a slope ≥ 4 per row to climb. That means roughly 40+ units per column before any reaches the lit rows.
   - So the dark bottom is a delayed trap, in Closed as well as Burial. This weakens the Closed vs Burial contrast.
   - Rain's top-row input behaves the same way: it piles up near the surface.
   - Name this "threshold relaxation", not "mixing" or "diffusion", in the UI and report.
   - Checkerboard patterns with amplitude exactly 4k swap forever. The no-overshoot bound holds but the field can oscillate. This is low priority, but worth a line.

5. **Finite rain is never exercised by the batch.**
   - Rain delivers 64 units per 8 ticks to every top-row tile, so the reservoir runs out at tick 4096.
   - The batch stops at 3000, so in it rain is constant and effectively infinite. The UI runs to 6000.
   - The top-row "rotation" only matters for the final partial event, because every tile is visited each time.
   - Run the batch to 6000 (cheap), or state that the pilot doesn't cover exhaustion.
   - Import is a pure function of tick, so `imported` is identical in Rain-only and Rain+burial. The "rain remaining" bar is a clock, not an outcome. Say so in the report.

6. **Extension and mortality collide at tick%60 == 0.**
   - A single-donor colonist (B = 4) is created and then hit by mortality in the same tick. It drops to 3 and becomes D immediately.
   - `spread` and `colonizedTiles` then overcount persistent colonisation.
   - Decide whether to reorder the phases, exempt newly colonised tiles, or label the counters "attempted".

7. **Fixture API contradiction.** The signature includes `phases`, but the text says it "uses the production phases". Pick one: an explicit override, or seed-derived when omitted. Also state which keys are required and what happens to omitted ones.

8. **Census and history.**
   - After every step B is 0 or ≥ 4, so `activeCells` and the nonempty-component count coincide. Say so, or drop one.
   - Fixtures that start with B in 1..3 differ only at tick 0.
   - A history of 121 samples is exactly 6000/50 + 1. The off-cadence extinction sample evicts tick 0, which breaks interval-activity baselines. Use capacity 122 or pin tick 0.
   - "Activity" is net displacement between samples, not gross turnover. Name it so, and define late activity precisely, for example the mean over intervals ending in (2000, 3000].
   - For a fixture that starts at B = 0, `extinctionTick` is undefined. Pick 0, null, or the first step's tick.

9. **"Water continues" can become false.**
   - Without biomass and rain, N is stuck by the dead zone, D ends up buried or recycled, and the tank becomes physically static.
   - No counter tracks mixing, so the UI can't show that water is still moving.
   - Add a mixed-units counter and a quiescent flag, or a per-sample water-movement delta, and word the extinction banner accordingly.

10. **Counter semantics.**
    - `settled` and `spread` count unit-moves (distance travelled), not pool transfers, so they can far exceed total matter.
    - The flow diagram should separate pool-to-pool transfers (imported, growth, mortality, recycled, buried) from within-pool relocations (mixed, spread, settled). Name the latter "unit-moves".
    - Consider splitting `mortality` into routine decay and the sweep of 1 to 3 units, since sweeps likely dominate burial supply.

11. **Add sharper ledger identities to the per-tick checks.** These make "exact ledger" more than residual = 0:
    - `imported = reservoir0 − reservoir`.
    - `buried = sediment`.
    - `B_total = B0 + growth − mortality`.
    - `D_total = D0 + mortality − recycled − buried`.
    - `N_total = N0 + imported − growth + recycled`.
    - Also check B ∉ {1,2,3} after each step.
    - Add tests that aren't currently listed: component seam, `activeCells`, history cadence, extinction dedup, `droppedSamples`, and null-activity endpoints.

12. **UI legibility.**
    - The sediment bar scaled to the fixed initial budget will be sub-pixel if sediment is small. Pick the scale (32768 or initialTotal) and show the number alongside.
    - Label the unused reservoir in Closed and Burial-only as "not connected", not "available".
    - State the clipping scales for N and D, fixed and identical across the four cards. N and D can reach the hundreds at the top and bottom rows.
    - Mark the dark zone (y ≥ 36), the burial rows (y ≥ 40) and the rain inlet row on the canvas, not just the light band.
    - "Square/4:3" is contradictory. The world is exactly 4:3.
    - At 30 ticks/s the rain lasts about 136 s, so reaching the end is slow.

13. **Smaller items.**
    - Pin the Mulberry32 variant (`>>>0` before dividing) with first-draw test vectors, including seed 0. Pin `floor(random()*4)` for phases.
    - Assign to Uint32 arrays only after checking ≥ 0. Silent wrap on a negative delta is the likeliest implementation bug.
    - Seed parsing matches `development/page.ts`: trim, then `Number`, so `"0x10"` and `"1e3"` are accepted. State whether that is intended.
    - The ample-N fixture should name its tile so both tick-12 and tick-24 extension directions are on-grid.
    - Add a light-edge dark-patch decay fixture to the hand checks.

## Toy design vs real-ecology claims

All of these are mathematical toy knobs, not ecological claims:
- light-only growth with 1:1 N→B at up to 1 unit per tile per tick;
- constant per-tile mortality regardless of B;
- 1 row per tick settling;
- the integer dead zone;
- cadence aliasing between tick%8 and tick%4.

I'd avoid "algae" and "fronts" as claimed findings in the generated report numbers. Keep them as imagery in the UI.
