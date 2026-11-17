You are an adversarial reviewer. Read-only. Repo: /Users/nicholas/develop/browser-life-i07-destruction (branch claude/i07-destruction).

Review docs/assembly-destruction-2026-11-02/PLAN.md against:
- the planning source docs/simulation-research-2026-11-01/report.md, section "I07 - Construction grammar and copy number";
- the first rung docs/assembly-observer-2026-11-02/ (PLAN, PROTOCOL, GRAMMAR, EVIDENCE, REVIEW) and its code (packages/metrics/src/assembly/**, tools/assembly/observer.ts);
- the repo: packages/sim-ref (applyLesion, RefSim), packages/runner/src/interventions.ts, apps/lab/vite.config.ts, Caddy/Dockerfile.site privacy rules, tests.

Find flaws. Specifically hunt for:
1. Wrong or fictional reuse: functions, files, exports, constants (segment, ConstructionService, patchReadouts, canonicalKey, PROTOCOL.patch, rnd, clips.ts, applyLesion semantics, sharedBound/reuseRatio, ASSEMBLY_VERSION, the 64x64 torus / M=240 / site pitch 8 claims) that do not exist or behave differently than the plan says. Verify each by reading the code.
2. Metrics a null fixture would pass: circular design (the authored builder is "heritable" by construction so C1 is right by construction), gates that cannot fail, truth labels that make the expected outcome tautological, ablation that trivially zeroes identity, scramble gate defined without a numeric criterion.
3. Leakage between past and future windows: protocol constants or the highAssembly ceiling derived from outcomes; regrown objects scored against keys from the pre-damage state (is that leakage or legitimate?); seeds shared between freeze and scoring; frozen-before-run ordering.
4. Scope too big for one slice under about 2 hours with machine load 60-90; files and tests count; what to cut.
5. Untestable or ambiguous gates: verdict rules whose thresholds are unspecified, quantifiers ("every replicate") with degenerate cases, 4/8 connectivity handling, process verdict vs classifier accuracy arithmetic (6 processes x 16 replicates), the clip arm's "no verdict" rule.
6. Physics or hash risk: anything touching sim-ref, schema, RULE_VERSION, golden pins, defaultConfig, barrel exports, vite input collisions, privacy of the new page.
7. Internal contradictions (e.g. template processes under 'partial' vs 'total'; 'fresh random' statements; process count vs listed processes; test names vs rules).

Output: a numbered list of findings, each tagged P1 (blocks / invalidates the result), P2 (should fix before freeze), or P3 (nice), with the plan section, evidence (file:line), and a concrete fix. Be terse. End with a one-paragraph verdict.
