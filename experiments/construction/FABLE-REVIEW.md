# Claude Fable 5 High adversarial review — 2026-10-04

The requested review ran using the actual `claude-fable-5` model with `--effort high`, in read-only mode (Read/Glob/Grep only). It covered the complete construction workspace change from base `03e5ff646a086e886bf1128f964f07f9b1a49292` to reviewed head `4d4f3a4b97963331cde759576f7bc2f99046c368`, including raw experimental evidence. It did not audit unrelated jj workspaces. The same Fable session then discussed the findings and the next scientific direction.

## Findings and disposition

| Finding | Resolution |
|---|---|
| P2: “five improvements” understates shared mutation streams | Independently audited the preserved event lists and terminal genomes. Amended results, README and status: five distinct terminal genomes in two shared seed blocks, with nested event lists across founder backgrounds. All numbers and the negative 0/3 result remain unchanged. |
| P3: ordinary GPU golden entry points omit historical rule 1 | `runGolden()` now checks all supported versions by default, with version-labeled results. Explicit version selection remains available. Standard native and browser commands each execute13 rule-1 + 15 rule-2 cases. |
| P3: experimental rule 2 silently becomes the config default | `RULE_VERSION` remains latest supported = 2; `DEFAULT_RULE_VERSION` is 1. New configs retain rule 1 unless explicitly overridden. Drag requires explicit rule 2. Documented this distinction and adjusted rule-2 test fixtures. No historical hash pin changed. |
| P3 reuse caution: mutation runner's trapezoid starts at hardcoded1024B | Correct for every executed assay. Preserve the executed runner and launch snapshots; any future generalized runner must initialize the integral from initial totals. No current result is affected. |

Fable found no P0/P1 defects. Its audit found the CPU/GPU drag arithmetic, exact conservation, thinned-share genome lottery, checkpoint version checks and artifact tables consistent. This is bounded review evidence, not proof that the ecological design succeeds.

The original review suggested describing the mutation results as “two distinct transferable variants.” In discussion, Fable accepted our correction: there are five distinct terminal genomes driven by two overlapping seed-keyed streams. Shared mutation targets/deltas do not establish which mutations caused the benefit. The [dated amendment](EVOLUTION-RESULTS.md#reporting-amendment--2026-10-04-shared-mutation-streams) quantifies the overlap without changing the prospective protocol or raw evidence.

## Scientific disagreements resolved

Fable withdrew its overbroad statements that the engine has no population and that new transport physics is necessary for reproduction. The demonstrated limitation concerns the construction habitat family tested here. No engine-wide impossibility or success of autonomous reproduction follows from this review. Connected populations may support selection; disconnected organism-like descendants are not a necessary research gate.

We agreed to test a finite initial nutrient reservoir under existing rule 1 before another transport law. The current main witness/negative extensions begin with matter bound in biomass, so they do not isolate whether access to new material would permit source-preserving expansion. This is a hypothesis, not a claim that those initial conditions make colonisation impossible. Fable's proposed packet transport and pressure transport have no comparative evidence yet.

We also agreed that antifragility needs an explicit population-level, time-bounded acceptance test. A perturbation history must improve later performance and inherited capability relative to calm controls, with source costs/extinctions retained. Mutation-off responses can reflect selection on standing variation. Shared seeds can be valid statistical blocks. Withheld challenges test how broadly a benefit transfers; they are not an uncontested definition of antifragility.

The concrete [next-experiment decision note](NEXT-EXPERIMENT.md) separates renewal capability from construction necessity, and capacity controls from claims of impossibility. It proposes a finite pilot and conditional confirmation, not a new ongoing search. It is unexecuted and requires its own frozen protocol before any run. The original negative mutation and drag studies remain closed.

## Validation and provenance

Remediation validation is complete: **1,894/1,894 tests across 80 files passed**, including the 72 previously checked focused regressions. TypeScript and the Deno checks passed. The standard native GPU command and Chrome browser golden test each passed all 28 cases with unchanged pins (13 rule-1, 15 rule-2).

Fable's final follow-up closed A1/A2 and conditioned A3 on the full suite; the final passing run satisfies that condition. It requested a stronger binding for the audit: [the compact audit](mutation-overlap-audit.json) is now tracked, including the five raw input SHA-256 hashes. Its SHA-256 is `093478816c6b689dab648c9302a7c89a9ca8edab936d04c362a74689d793ec0f`. The decision note now explicitly limits capacity-control interpretation to spread zero.

An optional API concern was checked and refuted: an unsupported explicit `runGolden` version already rejects during state allocation, before GPU access. A direct call with version 999 produced `invalid config: unsupported ruleVersion 999; expected 1 or 2`; no extra guard or physics change is needed (`unsupported-golden-version.log`).

The Sol 6.1 High phase-boundary review found no actionable P0–P3 issues in the remediation. The first full regression run passed 1893/1894 tests; its sole failure was the construction-cost test fixture enabling drag without selecting rule 2. That fixture now explicitly opts into rule 2, preserving all assertions. A scoped Sol follow-up approved that correction, and the complete rerun passed all 1,894 tests in 365.26 seconds.

Full reviewer text and reproducible evidence are local, under `runs/construction/fable5-review-20261003/`:

- `session.json`: exact model, effort, session and reviewed revisions. The first authentication attempt failed; the successful review used session `f0c4b2a9-16b5-4afd-8da6-75de03c1068b`.
- `review.md`, `discussion.md`, `closure.md`: original review, same-session discussion and Fable's verification of the remediation. Read the discussion with the original report; it explicitly corrects several initial claims.
- `review-prompt.md`, `discussion-prompt.md`, `input.diff`: scope and questions.
- `mutation-overlap-audit.json`: independently recomputed shared event steps and terminal byte differences; the tracked copy additionally binds its raw inputs by hash.
- `focused-tests.log`, `typecheck-final.log`, `native-golden.log`, `browser-golden.log`, `deno-check.log`, `full-suite-final.log`: passing verification outputs. `full-suite.log` preserves the initial fixture failure.
- `sol-remediation-review.md`, `sol-fixture-review.md`: required Sol phase-boundary reviews; neither found an actionable issue in its scope.
- `closure-validation.json`, `review-provenance.json`: final counts, source revision and reviewer provenance.

No physics law, experiment result, frozen preregistration or executed assay source was changed by this remediation. Nothing was merged or pushed.
