# Amendment 4: rare immune-clone invasion (2026-10-25)

Status: prospective positive-control assay, not spontaneous evolution. User authorized the recommendation to prove one selectable inherited advantage before more persistence or mutation campaigns. Gate 0 stays STOP; prior ecology results are not pooled.

Prior art: original plan section 4.4 predicts that a type-0 clone relabelled to unused type 3, retaining mask 2 (prey type 1), escapes all founding predators. The original mutation arms have not run. We test that specific existing prediction, not another recovery mutant screen or longer-cycle criterion. No kernel changes or ongoing mutation.

## Fixed assay

- Native kernel from c62032dc. S0, 256x256x4, spread 8, K=5, min=4, vacancy rate 64, mutation 0. Founding remains three types, original column founding. Burn in 6000 steps at rate 0.
- Independent seeds 1101,1102,1103,1104, not the A2 pilot seeds. From each burned state choose exactly floor(1% of living type-0 cells), minimum 1, deterministically by hash(seed, cell). A living cell has a nonzero lineage and B+P>0. Require at least 100 eligible parent cells; otherwise SETUP-STOP for the entire batch, no substitute seed. Also require at least 100 living cells of each founding type and at least one selected donor with a face neighbour whose B reaches rpsMin and whose mask attacks type 0. This is a census-time exposure proxy, not an exact post-transport kill counter. Record exposed marked cells at every census; an unchallenged setup is not a biological null.
- Same selected sites, state and matter in both arms. Immune arm changes only type 0 to 3 and marks the selected lineage; neutral arm only marks it, keeping type 0. Mask stays 2. No genome/controller changes beyond that one type byte and the marker. Check exact input differences.
- Each pair is repeated with immigrant lineage IDs (0,4) and (0,5), leaving resident IDs untouched. These are identifier robustness checks, not independent samples: four independent seeds, sixteen runs total. Mutation remains disabled. No deliberate forcing of reproductive success.
- Horizon 10000 post-inoculation steps, census every 1000, including initial census. Run all arms to the fixed horizon. Read every genome and cell; conserve exact matter and energy and reject invariant/event failures. Record input/output/checkpoint and source hashes. Original sources and results stay read-only.

## Endpoint and decision

Primary frequency is marked living cells / (marked living cells + resident type-0 living cells), measuring competitive replacement of its ancestor. Also report marked biomass, global living share, all type counts and their persistence; those do not replace the primary endpoint. Counts track inherited lineage, not merely the immune label.

For each run use the mean primary frequency of the last three censuses (8000,9000,10000). A marker pair passes only when the immigrant has at least one living cell at step 10000 AND the immune mean is at least twice its own initial frequency AND at least twice the neutral mean. A zero parent-plus-immigrant denominator has frequency zero; extinction cannot pass. A seed passes only if both marker IDs pass. At least 3/4 seeds gives SELECTION-LEAD; otherwise NO-SELECTION-LEAD at this horizon. This is a prespecified small positive-control screen, not a significance claim or proof of mutation-driven evolution. Print all denominators and outcomes, including failures.

## Validation before the first assay run

Check construction, inheritance and endpoint arithmetic with deterministic fixtures. Validate one-step protection with a victim whose predator is guaranteed to kill the original type but cannot attack type 3; compare CPU and GPU. Validate matched neutral/immune physics at rate zero (same marker): cells, lineage and accounting must match, with type metadata the only allowed difference. A deliberately copied neutral-vs-neutral pair must yield identical endpoints and fail the improvement criterion. Test marker IDs separately. These engineering seeds are >=9100 and are not assay seeds.

## Stops and limits

- Any source/config/checkpoint mismatch, conservation residual, invalid state, mutation event/overflow, malformed data or failed engineering control: TECHNICAL-STOP. Preserve failure and partial artifacts; no unattended retries or reseeding. Repair requires a recorded version before new execution.
- Freeze this plan and implementation manifest before assay data are observed. Independent read-only plan/code review before execution and review before commit.
- Retain four burn checkpoints and sixteen final checkpoints, not intermediate full states (about 1.1 GiB); keep intermediate census counts and hashes.
- Budget: sixteen 10000-step assay runs plus four 6000-step burns (184000 steps), at most 90 minutes and 2 GiB of assay output. Exceeding either is INCOMPLETE, never a biological negative. No automatic extension, tuning, or mutation campaign.
- A lead licenses proposing fresh confirmation and a separately amended minimal mutation experiment. A null directs investigation of competition/placement/heritability; it does not imply evolution is impossible. Ecosystem collapse is reported separately and does not erase a lineage advantage.

Plan review: both P2 findings accepted before assay execution: explicit final persistence and a prespecified predator/exposure setup gate. Storage retention is explicit.
