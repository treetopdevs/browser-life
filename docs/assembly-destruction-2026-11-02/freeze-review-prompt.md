You are an adversarial reviewer. Read-only. Repo: /Users/nicholas/develop/browser-life-i07-destruction (branch claude/i07-destruction, base f94bb52b). Nothing has been scored in the `score` seed namespace yet; this is the review of the FREEZE files before they are committed.

Freeze files (the decision path):
- docs/assembly-destruction-2026-11-02/PROTOCOL.md
- packages/metrics/src/assembly/destruction/{protocol,damage,regrow,processes,readouts,verdict,observer}.ts
- tools/assembly/destruction.ts
Contract: docs/assembly-destruction-2026-11-02/PLAN.md section 0 (R1-R14, binding) and 5b, plus REVIEW.md. Tests so far: packages/metrics/test/assembly-destruction.test.ts, tools/test/assembly-destruction-evidence.test.ts (the latter needs evidence that does not exist yet). The first rung is docs/assembly-observer-2026-11-02/ and packages/metrics/src/assembly/*.ts (read-only reuse).

Hunt for, verifying each by reading code:
1. Implementation that diverges from PLAN R1-R14 or PROTOCOL.md (identityReturn, persistence, levelReturn, highAssembly, scramble gate, classifiers C1-C3, labels, mass identity, sweep, 2 objects per round, 8 rounds, crystal nucleation, nostore arms).
2. Leakage: does regrow() ever see the pre-damage patch, the reference key, or anything from outcomes? Do seeds in the `score` namespace collide with `dev`? Any constant that was tuned on dev results?
3. Bugs: off-by-one in rounds, torus wrap, fits(), site pitch assumptions (object bbox vs pitch), undefined/null handling that can silently turn into true, an identity or level that can be true vacuously, conn 8 vs conn 4 handling, determinism (any Math.random, Map iteration order, floating point).
4. Verdict arithmetic or table logic that makes an outcome tautological or impossible, or lets a degenerate case pass ("every replicate" on an empty set).
5. Freeze guard in tools/assembly/destruction.ts: can --write run with hashes that differ, with a non-ancestor commit, or with outcome files in the freeze commit? Does --check fully verify the evidence?
6. Anything touching sim-ref, schema, RULE_VERSION, golden pins, defaultConfig, barrels.

Output a numbered list of findings tagged P1 (invalidates the result), P2 (fix before freeze), P3 (nice), each with file:line evidence and a concrete fix. Be terse. End with a one-paragraph verdict.
