# Mycelium trail use: design note (13 Nov 2026), written before the kernel code

Status: EXPLORATORY rule variant, optional config keys, not a pre-registered test. Worktree `browser-life-mycelium-trail`, branch `claude/mycelium-trail-use` from edc25af9. Nothing here touches the frozen R3 test in the other worktree.

## The problem

In R2b the inherit arm mostly loses its trail by step 50,000 (13 of 20 seeds under 0.01 trail per particle), while blocked, whose controllers are redrawn every birth and so cannot be selected, holds 1.8-2.4. Trail costs `depositCost` energy per unit plus the unit's matter, and its only use is as sensor input (inputs 2, 3, 4). Laying is a pure cost with no return except through a sensor input, so my hypothesis (not a finding: R2b leaves heredity's role unresolved) is that selection in the inherit arm removes it. Blocked redraws controllers at birth, so nothing heritable can hold or lose the trait there, though survival still differs between particles. A mycelium needs its trail to be worth something.

## The rule space, and who gets the benefit

Every candidate below changes the phase-5 movement term. Today it is `(|MX|+|MY|) * moveCost >> 7`. Let `P0` be the trail in the particle's own cell at the START of the step (the same value sensing reads).

**(a) public discount.** The movement term shrinks with `P0`, for every particle in the cell, whether or not it ever laid trail. The benefit is a public good. A non-laying mutant standing on its neighbours' trail gets the same saving and skips the `depositCost`. Whether laying survives depends on relatedness: the depositor's lineage must collect enough of the saving to beat `depositCost` plus the matter. Children are born within half a cell of the parent, so kin cluster, but R0 smoke runs showed about one family per two particles at step 3,000 (inherit 4,413-4,953 particles, 1,929-2,399 families); that is a global count, and I assume from it (not measured) that a cell is mostly shared with non-kin and trail decays at 1% per step while particles walk off. My prior: local births are probably NOT enough to protect (a) against free riders unless the saving per unit of trail is large. (a) is the null for "does a public benefit alone help".

**(b) toll road (privatised/coupled).** The same discount, but only for a particle whose own DEPOSIT request is positive this step. The saving accrues to the layer and only to a layer. A non-laying mutant gets nothing, so the free-rider route is closed by construction. Trail laid by others still helps a layer (that part is public: a layer standing on others' trail saves more), but joining requires paying. The coupling is on the request, not on the realised deposit, because the deposit is capped by the energy left AFTER the movement cost is paid, so gating on it would be circular. Edge, stated honestly after Sol's review: a request that is positive but ends at 0 units (energy under `depositCost` after paying the cost) still gets the discount. At the default `depositCost` 2 that needs a particle with under 2 energy left, so the hole is narrow and short-lived. It is NOT narrow if `depositCost` is large: with `depositCost` 4096 a particle can request a deposit every step, never afford one and take the discount for as long as it lives (Sol measured 50 discounted steps, zero deposits, still alive). So "closed by construction" holds only at small `depositCost`; the screen uses the default 2 and the parity case at 4096 exists to pin the edge, not to bless it. A gate on the realised deposit is possible (an optional branch could compute the discounted cost and require enough energy left for one deposit) but is more code on both sides; gating on the request is a design choice made here for simplicity, and it is the weaker of the two.

**(c) conduit (X3: energy flowing through trail-connected cells).** Deferred. A flow between particles that share connected trail needs a connectivity relation over cells (a flood fill or iterated relaxation), which is not order-free per particle and needs several dispatches per step plus a convergence bound; its conservation is easy, its GPU parity and its bounds are not. It is the right next idea if (a) or (b) shows trail can be kept at all.

**(d) anything better.** Considered and not built: trail digestion (eating from P) would let particles live on their own trail, a closed loop that mints no energy but gives free-riders a way to eat others' trail and starts matter-routing questions (P to M directly); lowering `upkeep` on trail has the same shape as (a) with a larger lever but is no longer about movement. I build two modes of one key, (a) and (b), because they differ in exactly one thing (who is eligible) and that is the quantity of interest.

## The rule

Two optional config keys, absent from `defaultConfig()` and never inserted by `createWorld`:

- `trailMoveDiscount`: integer `td` in 0..256.
- `trailDiscountMode`: `"public"` or `"toll"`, only valid with `trailMoveDiscount`; absent means public.

Per particle, with `req` the DEPOSIT request `(maxDeposit * relu(DEPOSIT)) >> 7` already computed in phase 3:

```
f    = min(min(P0, 256) * td, 256)         // 0..256; saturating P0 first keeps the product below 2^16
f    = 0 if mode is toll and req == 0
raw  = (|MX| + |MY|) * moveCost             // below 254 * 4096 < 2^20
move = (raw * (256 - f)) >> 15             // below 2^28
```

`f = 0` gives `raw >> 7`, today's term, exactly, so `td = 0` reproduces the keyless dynamics (only the config header differs, as for `physarumDeposit 256`). `P0` full reduction takes 256 / td units of trail in the cell (td = 256: one unit makes movement free; td = 16: sixteen units).

Rounding: floor, no new PRNG slot. The discount multiplies the unrounded product at 8 extra bits of resolution and the existing right shift does the only truncation, so rounding is no coarser than the current term. A stochastic draw would add a slot for a quantisation of at most one energy unit per step and a divergence risk for no gain.

## Exactness

The discount only lowers the amount paid. `cost` is paid out of `E` and booked to heat in the same statement, so `sum E + eA * sum A` still changes by exactly `lightIn - heat`. Nothing is minted: the saved energy is simply not removed from the particle. Matter is untouched. No new counters, no change to `totals`, `StepStats` or the encode header. A particle that now affords a step it could not before survives with that energy; that is the point of the rule and it is exact.

Order independence and GPU parity: `P0` is read from the start-of-step field before phase 5 changes it. On the CPU the discount of every particle is computed right after `senseAndThink` (before any `P[ci] += dep`); on the GPU `k_think` writes it into a new scratch plane, because `k_live` adds trail atomically in the same dispatch and a read there would race. Bounds are added to RULES.md.

## Economics: can the benefit beat the cost?

Defaults: `moveCost` 2, so the movement term is at most `254 * 2 >> 7 = 3` energy a step (typically 1-2), against `upkeep` 6, mass upkeep up to 4, and 2 energy plus a matter unit for each deposited unit. So at the default `moveCost` the ceiling of any discount is 3 per step, and a toll payer that lays one unit pays 2: it breaks even only for a fast mover standing on a full cover, and it loses at any ordinary output. **At the default `moveCost` the toll arm is close to null by construction and the public arm's benefit is at most about a quarter to a third of the running cost of a full-speed particle on full cover (3 of 9-13), far less for an ordinary one.** I screen it anyway (the task asks for defaults, and a null there is itself a result) and add a stratum with a higher `moveCost` (12: term up to 23 energy, typically 5-10), where a discount is worth several units of deposit cost. That stratum is a departure from the defaults, labelled as one in the screen table, and has its own no-key baseline at the same `moveCost`; it is a different world (movement is expensive, populations may shrink) and numbers do not compare across strata.

## What the screen can and cannot say

It is exploratory: about 4 seeds per cell, no pre-registration, no multiplicity control. The seeds are 8001-8004 for inherit and 108001-108004 for blocked (arm offset 100,000, so the arms do not share founders), and every variant at a given arm and seed uses the same world seed (paired founders; the dynamics diverge from step 1 once the rule changes, so pairing buys little beyond identical starting positions). Readouts: trail per particle TM, deposit rate `d`, population, median age, ledger exactness, in (50k, 100k] and an early window. A sanity gate comes first: the keyless baseline must show R2b's pattern (inherit trail mostly gone, blocked near 2); if it does not the screen is stopped and said so before any variant is read.
