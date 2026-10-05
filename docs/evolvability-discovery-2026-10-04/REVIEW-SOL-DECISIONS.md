# Sol review of the decision edits (raw)

2026-10-04 · `gpt-6.1-sol`, reasoning effort high, read-only sandbox, Codex CLI 0.160.0 · session `01a106e7-0e86-7391-b94f-0d261ec08433`

This is the reviewer's final message, unedited. Its input was the working tree after the user's decisions D1 and D2 were applied, an exact diff of those edits, and the two repairs the [follow-up](REVIEW-SOL-FOLLOWUP.md) had left unreviewed. The three findings were repaired afterwards; those repairs are the author's and have not been reviewed again. See the [council record](COUNCIL.md). File links in the text are the reviewer's absolute paths, and line numbers are those at the time of review.

---

VERDICT: READY AFTER REPAIRS — P0: 0; P1: 1; P2: 2; P3: 0.

1. **P1 — The shared Stage 0 gate puts renewal behind workbench preparation.** [PLAN.md:9](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/docs/evolvability-discovery-2026-10-04/PLAN.md:9) now requires the engineering manifest and caps to be reviewed; Stage 1’s Needs column still requires Stage 0. Following the table therefore delays construction-owned renewal until those infrastructure preparations finish, contradicting the stated independence of the workstreams. **Smallest repair:** distinguish Stage 0’s construction prerequisites from its workbench prerequisites. Stage 1 needs the recorded owner/revision and applicable boundaries; engineering-manifest and engineering-cap review gates 3a alone.

2. **P2 — The increments list restores the calibration dependency that 3b explicitly avoids.** [PLAN.md:225](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/docs/evolvability-discovery-2026-10-04/PLAN.md:225) includes the calibration battery in increment 2, before the plane in increment 3. Shipping in that order waits for renewal completion, despite 3b needing only 3a’s engineering gate. The parallelism sentence at line 230 does not distinguish these parts. **Smallest repair:** make increment 2 the engineering core; state that calibration joins separately after Stages 1–2 and does not delay increment 3.

3. **P2 — The council overstates the plane-before-campaigns commitment.** [COUNCIL.md:86](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/docs/evolvability-discovery-2026-10-04/COUNCIL.md:86) says the plane precedes “the first campaigns” and campaigns from Stage 4 are submitted through it. Engineering campaigns necessarily precede it, and PLAN line 22 expressly permits a ready scientific campaign to use shards before 3b qualifies. **Smallest repair:** describe the plane as the intended Stage 4 onward route, explicitly retaining the prequalification shard fallback.

**Checked and sound**

- **A — Fidelity:** The user’s answer is quoted accurately, and the author’s interpretation of “the workbench” is disclosed. D3–D7 remain open/defaulted; no second host, numeric cap, or cloud expenditure is recorded as user-approved. D2 no longer awaits another ownership-policy decision.
- **B — Other consistency:** No remaining operative passage defers the plane to Stage 7 or makes D1 pending. Historical defaults and review references are identifiable as historical. The substantive stage dependencies distinguish engineering from calibration.
- **C — Science:** Apart from finding 1’s scheduling dependency, renewal remains standalone under its original protocol. Engineering timings cannot price science. Both 4a and 4b require 3a’s calibration gate. Imported renewal evidence retains its original coverage and never becomes discovery-replayed. Scientific rulings, queue isolation, and zero cloud allowance remain intact.
- **D — Executability:** All six fixture kinds can be built using `main`’s reference simulator, global accounting, census observers, and checkpoint codec. Relevant inspected code matches local `main`. Reusing existing engineering observers through one interface does not create a second renewal observer. D5 gates renewal integration; D6 explicitly gates cross-host acceptance and therefore 3b’s start. No dependency cycle found.
- **E — Shard fallback:** Compatible with the user’s decision, PRD completion rules, and DESIGN section 7. It preserves identities and acceptance requirements and cannot establish distributed completion.
- **F1 — Hashing repair:** Closed at the documentation level. The core exclusion list is exhaustive; array width/endianness and wide-counter encoding are specified. `canonicalObserverJSON` supplies recursive ordering and compact JSON; typed arrays and wide counters must be encoded before calling it.
- **F2 — Provenance repair:** Closed. The two Sol sessions now have distinct inputs and outputs; subsequent repairs are correctly marked unreviewed.

The entry for this session must record its actual model, effort and session ID; the post-D1/D2 working-tree input, including the two previously unreviewed repairs; this verdict and findings; and the raw review. Any repairs made afterward remain author repairs until checked.

No files changed; no simulations, tests, services, or cloud actions ran.
