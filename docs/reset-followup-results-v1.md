# Bounded observer follow-up: results and decision

2026-09-29. Final: independently reviewed measurement-stop decision. This follow-up preserves the original reset and Claude's historical results. Execution design: [follow-up plan](reset-followup-plan-v1.md).

## Consolidated decision

The historical Variation verdict remains recorded and **does not select the next mechanism**. Main `docs/plan.md` now contains the reviewed reset conclusion beside the founder diagnostic and extension results. Their pre-update records are copied and hashed in `experiments/foundations/followup-v1/input-manifest.json`. The two workspaces remain separate; no merge, push, or cleanup was performed.

Founder dependence of role change is evidence about that diagnostic. It is not proof of richer organizational evolution. The extension time-shift remains incomplete under its frozen rule; its descriptive gains and neutral extinction floor cannot validate M4 endpoint 2. The original reset remains a measurement-limitation result, not evidence that reproduction is impossible.

## What was implemented and executed

The new observer propagates conservative intervals for material initially in B/P that remains in B/P throughout tracing. B-to-P conversion preserves membership; loss to C ends it. Later synthesis is newly bound material even if it reuses earlier atoms. Literal atom ancestry through recycling is unavailable. Newly bound material is not, by itself, newly constructed organization.

Transport uses integer source shares and arbitrary feasible allocation of cohort material within each pool. Ordered reactions use exact per-site reaction amounts. Joint world bounds persist through steps and tighten regional bounds using the complementary region. These checks prevent interval projections from inventing cohort mass or forgetting global conservation.

A generated diagnostic copy of the pinned reference simulator captures displacement, transported state and local reaction amounts. Four checked insertions add passive observations; the physical implementation remains untouched. Each executed step is compared with an ordinary reference twin, including cells, genome, step, energy/flux ledgers and mutation events. The active and passive controls each span 1,100 steps. A separate forced-mutation smoke control spans 20 steps; normal mutation remains enabled in the other fixtures.

Known-history tests use exhaustive small allocations and explicit conservation-respecting token histories. Those histories are possible allocations consistent with the simulation's quantities, not a claim that the rules secretly define individual molecules. They also distinguish genuine ambiguity from an overly loose interval algorithm.

## Interpretation and stopping decision

The active control's fixed region admits [0,100%] retained material after recovery, despite exact physical parity and exact local reaction amounts. Whole-world conservation does not resolve that regional interval. Region-directed token histories exhibit opposite retention explanations during the 100-step contact horizon under the same physical evolution.

| Executed control and total step | Current regional bound mass | Conservative old-material interval | Explicit compatible allocations |
|---|---:|---:|---:|
| Active, 100 | 79 | 0–78 | 0 versus 78 (0% versus 98.73%) |
| Active, 1,000 | 85 | 0–85 | 0 versus 70 (0% versus 82.35%) |
| Active, 1,100 | 88 | 0–88 | 0 versus 66 (0% versus 75%) |
| Passive, 1,100 | 11 | 0–11 | 0 versus 11 (0% versus 100%) |

The active 1,100-step witnesses establish substantial attribution ambiguity but do not demonstrate both the prespecified 80%/20% extremes. Its remaining interval width may include algorithmic looseness. The 1,000-step result cannot substitute for the planned 1,100-step horizon. The passive control does witness both extremes at that full horizon; it has no active synthesis and is not a functioning-organism positive control. All rows are retained rather than selecting the convenient horizon or fixture.

This fixed region is a technical control, not a moving organism. A broad interval there does not prove every entity support is unmeasurable, nor does it establish a universal impossibility of sharper observers. It does show why this observer cannot yet license a general contact-to-inheritance inference. Neither shortening the horizon nor treating an allocation convention as an observation would fix that evidential gap.

Gate O is **not passed for the proposed 1,100-step use**. Biological contact/recovery, fresh-case evaluation, founder search and rule changes remain unexecuted. This is the plan's measurement stop, not a resource-exhaustion claim. Historical natural candidates are catalogued for development in `experiments/foundations/followup-v1/natural-development-candidates.json`: the first flag in each of histories 1 and 2, without filtering on persistence. These are two locators among 592 raw flags, not two verified births. No candidate replay or fresh evaluation was performed by this follow-up.

## Reconsidering the entity definition

Keep the genome-copy lineage as an observable replicating unit. Treat a spatial body as a candidate unit requiring additional causal evidence. Material retention should describe that candidate's history, not define whether it reproduced: growth, turnover and recycling can replace matter in an otherwise continuous process.

For a future organizational claim, define the candidate as a spatially resolved, self-maintaining process and specify what counts as producing another independently functioning instance. Require a supported origin relationship, separation, recovery of function and a subsequent supported production event, while recording ambiguous fusion and identity. Choose the physical support before reading genome replacement. A fixed-pixel region and a tracker ID are both insufficient substitutes.

Before another assay, specify a causal test of this proposed unit—for example, whether a separated candidate maintains and reconstructs its organization under matched recovery, and whether that capability depends on the transmitted organization rather than only its genome. A genome-only comparison must start in a demonstrably viable, matched context; making that comparison trivially nonviable would not identify an organizational contribution. This is a proposed next operational definition, not a demonstrated life cycle or an authorization to modify physics. RULE_VERSION 1 remains the baseline. Neither inheritance engineering nor duplication/predation nor founder selection is selected by the current limitation.

## Validation and provenance

The focused suite passes **12/12**, including exhaustive small allocations, pure retention, complete replacement at equal mass, partial mixing, B-to-P conversion, recycling, loss, complement bounds and invalid inputs. TypeScript and Deno checks pass. The independent reviewer reran the 12 tests and checked all 13 final source/fixture/test/result hashes. The active and passive worlds each pass 1,100 exact twin comparisons; the 20-step forced-mutation control includes **77 actual mutation events**. The two normal-rate controls had zero mutation events; mutation was enabled, not removed. Root independently reran the active fixture with byte-identical output.

The authoritative executable record is `experiments/foundations/followup-v1/results/receipt-v5.json`. Earlier development receipts and outputs remain preserved; v5 supersedes them for current-source reproduction. Exact current execution sources, including the generated diagnostic simulator, are copied into the tracked evidence directory and bound by `execution-source-manifest.json`. This follow-up archive supplements, and does not replace, the earlier reset's ignored run evidence.

Validation commands from the reset workspace:

```sh
deno run --allow-read --allow-write tools/reset-material-bounds-instrument-v1.ts
pnpm exec vitest run tools/test/reset-material-bounds-v1.test.ts
pnpm exec tsc -p tsconfig.json --noEmit
deno check tools/reset-material-bounds-feasibility-v1.ts
deno run --allow-read tools/reset-material-bounds-feasibility-v1.ts
deno run --allow-read tools/reset-material-bounds-feasibility-v1.ts passive
deno run --allow-read tools/reset-material-bounds-feasibility-v1.ts mutation
```

Recorded command wall time across receipts and root's rerun is **64.33 seconds**. The resource ledger conservatively charges **180 seconds** including exploratory commands and checks without precise receipts, below the 600-second local-control ceiling. These are elapsed command durations, not CPU-core measurements. GPU time and cloud spending are both zero. All **172 frozen original reset execution files** still match their hashes.

Review challenged missing local reaction diagnostics, loss of aggregate conservation constraints, ordinary-growth dilution, fixed regions versus entity identity, omitted positive/negative controls, invalid interval inputs and source drift. Those issues were either repaired and verified or retained explicitly as interpretation limits. A preflight against the superseded v4 receipt rejected changing source before any simulation ran; v5 and the root rerun passed. The independent review found no blocking issue in the final observer, feasible-history controls or scoped stop decision.

The frozen plan retains its historical in-progress label; this final report is the authoritative execution disposition. Stages 1 and 2 were performed, stage 3 was stopped at its stated prerequisite, and stage 4 selected the measurement-limitation branch. The entity-definition reconsideration above is a proposal, not a validated replacement definition. Design hashes were captured before root's first outcome inspection but may postdate implementer execution. The plan and fixture identities were communicated before those runs; exact UTC timestamps in the durable receipts apply to repeated runs. This distinction is preserved rather than represented as a timestamped pre-execution registration. These are development controls, not confirmatory biological evidence.
