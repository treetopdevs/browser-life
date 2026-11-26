# Independent adversarial implementation review

Reviewer: independent Codex Sol 6.1, High effort, read-only subagent. User explicitly authorized replacement of Claude/Argon on 27 October 2026. Scope: all 14 files in d82bdd5d..98832904, frozen plan and updated workflow documentation. No simulations, tests, edits or commits by reviewer.

Blockers:

- P1: Browser tick-row validation lacks population transitions, lineage events and sampled census binding. A rehashed non-sample zero-population row can falsely appear as a trough followed by living rows. Mirror runner consistency checks and add rehashed rejection coverage.
- P2: Browser frame validation enforces 32 cells but omits genome.maxCells and intermediate living-lineage ID/genome binding. Mirror core validateFrame and validateFrameLineage, with rehashed rejection tests.
- P2: Two schedule/accounting tests each advance real alternating seed1202 biology through505 before scheduled regression. Replace with pure helper/accounting fixtures and disclose earlier partial simulations. This is a pre-attempt assay-test deviation, not a consumed scheduled attempt or biological screen outcome.

Otherwise frozen model identity, PR109 reference schema/identities, exact regression ordering, sticky reservation, core gates and early-extinction handling are consistent with the plan. Reviewer substitution is appropriately recorded. Subsequent fixes require closure review.
