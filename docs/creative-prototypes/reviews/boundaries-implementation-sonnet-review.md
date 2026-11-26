# Review: boundary field prototype

**No blockers.** I read everything in scope and found no defect in the model, clock, runner or integration changes. The items below are minor.

## Checked and found sound
- **Diffusion:** each periodic east/south edge is visited once, with equal and opposite deltas for density and nutrient. The gate reads `old.wall` at both endpoints (`model.ts:144`), and nutrient is never gated. The per-cell flux arrays are summed after the fact (`model.ts:172-173`), so the residuals are independent of the total ledger.
- **Timing:** reaction, wall reinforcement and contrast all read old B, N and W (`model.ts:161-182`). A new wall first gates flux on the next tick. This is tested at `boundaries-model.test.ts:58`.
- **Ledger:** the signed clamp adjustment and positive floor loss reconcile with the density total (`model.ts:174-184, 303-306`).
- **Immutability:** getters, history, snapshot and census all return copies, and `stepFields` clones its input.
- **Sampled change:** `finishSample` computes the delta before replacing the previous-sample copy, and duplicate timestamps are suppressed (`model.ts:316-325`). Extinction closes a shorter interval.
- **Extinction:** `step()` stops at extinction, so tick, N and W freeze with no resurrection (`model.ts:287`). The CLI checks frozen fields on every tick, records the exact extinction row once, and labels extinct runs rather than scoring them as zero activity.
- **Initial conditions:** the Mulberry32 draw order is fixed and the same for every mode. The runner asserts the four modes start bit-identical (`explore.ts:90-102`).
- **Clock:** `comparison-clock.ts` advances living worlds once, then the shared age, and holds at the cap.
- **Interpretation:** the guide, page copy, legend, export description and pilot report all disclaim organisms, division, heredity and evolution. I found no inflation.
- **Integration:** the Vite chunk and input key, the Caddy deny before `try_files` and the redirects, and the Dockerfile `rm` globs are consistent with each other.

## Findings, all non-blocking
1. **E2E test can flake.** `tests/e2e/boundaries.spec.ts:55-64` clicks Play, then dispatches the hidden event. The animation loop can tick once in that window, since a tick lands about every 42 ms at 1×. The final `toHaveText('1')` assumes zero ticks happened. Read the tick before ArrowRight and expect +1.
2. **Seed error is overwritten.** `page.ts:184` sets the invalid-seed message, but the next `update()` overwrites it (`page.ts:142-144`). That happens on any view or overlay toggle, or any animation frame while running. The e2e passes only because reduced motion starts the page paused.
3. **Play after all fields are extinct shows "Running".** `page.ts:191` calls `setPaused(false)` without `update()`, so the status stays "Running" while nothing advances. The cap case self-corrects through `advanceOne`.
4. **Hidden-at-load tab is not paused.** `page.ts:198` pauses only on a `visibilitychange` event. A page opened in a background tab starts un-paused (unless reduced motion is set) and begins running when shown. The plan says hidden stays paused.
5. **Packaging test is string matching only.** `boundaries-packaging.test.ts:16-22` checks that the config contains the right strings. The plan resolution (`boundaries-plan.md:44`) also promised a smoke scan for leftovers after a temporary-build removal, and that scan isn't there. The Caddy test's `indexOf` ordering (`:14`) is textual, not Caddy's directive order. The deny still works, because `try_files` rewrites stay under `/boundaries`.
6. **The pilot report doesn't name its outcome bucket.** In `boundaries-pilot.md`, smooth, walls and threshold all fill to about 100% active with one region. Both mode freezes at 3–6 regions with late change around 3e-6. That matches the plan's pre-stated "all modes spread/freeze → negative/illustrative" case (`boundaries-plan.md:22`), but only the both-mode extinction rule is stated (`explore.ts:185-188`). `maskFlipFraction` was added to separate shape change from intensity, yet the late-change aggregate uses only `meanAbsDelta` (`explore.ts:158`), and the Markdown never shows it.
7. **`--check` skips the Markdown.** `explore.ts:192-202` checks the JSON against source and rule hashes. It never checks that `boundaries-pilot.md` matches `renderReport(saved)`, which would need no simulation. The Markdown can go stale unnoticed.

## Nits
- `assertSize` admits size 2, where `(x+1)%2` makes each edge get visited twice (`model.ts:112, 143`). It is irrelevant at 64.
- The nutrient supply pattern divides by `BOUNDARY_RULES.size` rather than `size` (`model.ts:168`). Small test fields therefore aren't periodic in F. This matches the hand-calc test.
- The wall overlay hard-codes `0.55` (`page.ts:69`) instead of reading `BOUNDARY_RULES.wallThreshold`.

## One observation about the tools
`apps/lab/src/boundaries/style.css` appeared in my first Glob. Later Glob and Grep calls missed it, but a direct Read succeeded, so the file exists and `index.html:11` resolves. It looks like a transient tool inconsistency, but it may also mean a peer session was touching the working copy during the review.

I ran no tests and made no edits or commits. I invoked no other reviewers.

## Coordinator verification against files after review completion

The reviewer ran while peers finalized the UI and runner. Subsequent read-only inspection found findings 1–4 and 7 still applicable at review completion. Finding 6 is partly stale: the final runner already computes and renders interval mask-flip summaries and explains the observed persistence/spreading patterns. An explicit negative/illustrative outcome label remains a useful clarity edit. Finding 5 identifies the static test's scope; separate manual production-removal smoke evidence may satisfy the plan without embedding it in Vitest.

The complete restored stylesheet was independently verified in recaptured desktop screenshots; see `boundaries-visual-review.md`. No model defects were identified. This note does not claim that this reviewer re-read files after subsequent fixes.
