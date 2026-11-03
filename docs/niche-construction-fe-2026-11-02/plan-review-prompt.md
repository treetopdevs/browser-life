You are an adversarial reviewer. Repo: browser-life (checkout is your cwd). Read-only review.

Target: docs/niche-construction-fe-2026-11-02/PLAN.md (slice I06b, second rung of niche construction).
Compare it against:
- Planning source: docs/simulation-research-2026-11-01/report.md, section "I06 - Construction that opens another niche".
- First rung: docs/niche-construction-2026-11-01/ (PLAN.md, EVIDENCE.md, REVIEW.md, evidence.json, protocol.lock.json).
- Code it claims to reuse: packages/runner/src/niche/*, tools/niche/niche.ts, apps/lab/src/niche/*, experiments/discovery/seed-registry.json, tools/test and packages/runner/test niche tests.
- Repo rules: CLAUDE.md (no physics change, golden pins and RULE_VERSION untouched, new optional WorldConfig keys absent from defaultConfig(), exact integer arithmetic, exact zero conservation residual, streaming analysis).

Find flaws. Be concrete and verify claims against the real code (file:line). Specifically attack:
1. Wrong reuse: does the plan assume functions, protocol fields, extension points, LATER_SLICE_OWNERS, seed digest binding, --check/--replay-check behaviours that do not exist or work differently? Would extending protocol/arms/assay/decision/evidence really leave rung-1 evidence byte-identical?
2. Metrics a null fixture would pass: can the gate, the positive control, G-NOISE, the far-field-energy fixture or the survival rule be passed by a null/no-effect or a pure free-energy-gift world? Is the far-field-energy fixture actually able to fool the rung-1 comparators as claimed? Is the freeEnergyCredit booking sound (is a credit a conservation fudge that hides energy creation)? Is the "max over comparators" direction rule coherent (conservative vs not-conservative flag, can matching free energy at equal matter even be done)?
3. Leakage between past and future windows: dev-set tuning of delta/dose/R vs fresh seeds, replicate seed offsets shared with Stage 1, shared Stage-1 histories across replicates (independence for the sign test and sum-of-R), absolute clock T1, reuse of dev seeds, anything that lets fresh outcomes influence frozen rules, or R changing after dev.
4. Scope too big for ~2 hours local: the number of new modules, tests, page section, builder dose-response knob, fixtures; step budget arithmetic (is 2*T1 + 13 arms*R*T2 right? 16 blocks x 3 candidates?), CPU-only assumption versus the scope that allows local GPU.
5. Untestable or circular gates: G3/G-NOISE definitions (realistic dose rule with 2x median builder P and ladder {120,240,600,1200} - is it self-consistent?), statistical power of an exact sign test with 16 blocks and Holm, "median >= delta" semantics with sum over R, delta formula units, survival R-1 of R then 15 of 16.
6. Physics or hash risk: the "founder biomass scaled" knob, any touching of WorldConfig, defaultConfig, golden hashes, seed registry digest (does adding a reservation invalidate rung-1 or other slices' evidence?), the freeze-before-run commit ordering.
7. Seed registry: check 8,601,001-8,601,999 and the sub-ranges for collisions with existing reservations.

Output: a ranked list of findings, each tagged P1 (blocks correctness/validity), P2 (material), or P3 (minor), with the evidence (file:line), why it matters, and a concrete fix. End with a short verdict. Do not edit files.
