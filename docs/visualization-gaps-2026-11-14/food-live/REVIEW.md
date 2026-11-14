# food-live review log

## Plan review dispositions

Reviewer: Codex Sol 6.1, xhigh, read-only, 2026-11-14. Raw review: `/private/tmp/claude-501/-Users-nicholas-develop-browser-life/e28381b7-b46a-475c-85b9-2de9973e0770/scratchpad/food-live/plan-review-final.txt` (full log `plan-review.log` beside it; prompt `review-prompt.md`). No P1. Twelve findings (9 P2, 3 P3), all accepted and applied to PLAN.md.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | P2 | `foodTargets` is the eligible area (9,216 / 4,608 / whole band), not the 768 slots a pulse offers; testing the overlay against the getter would certify the error | Accepted. Overlay split into an eligible-area layer and an offered-slots layer (derived by the mode's slot function), the latter tested against an independent food-byte-delta oracle; "no pulse yet" state; pulse boundary from model semantics (index 100 supplied at tick 505). PLAN Corrections 3 and render tests. |
| 2 | P2 | Snapshot `runtime` label makes raw `stateSha256` unequal across hosts | Accepted. Compare snapshots with `runtime` normalised in both; also verify the recording hashes to its own `stateSha256`; wording "equal after ignoring the runtime label". Corrections 6. |
| 3 | P2 | Vite root `apps/lab` does not serve `/docs/creative-prototypes/`; existing specs fulfil routes from disk | Accepted. Dev-only (`apply: "serve"`), allowlisted, read-only replay route in vite.config.ts; integration test over real HTTP; test that it is absent from the build. |
| 4 | P2 | Replay check on a fresh world does not verify displayed cards or the picture | Accepted. Check runs on the active card configuration, compares frame projections at recorded frame ticks, plus an offscreen render oracle for orientation and family colours. |
| 5 | P2 | Empty or partial recordings could report "identical"; 769 gate artifact has `maxTick` 6000 but `finalTick` 3000 | Accepted. Input validation (seed, mode, rules, terminal tick, cadence, contiguity, snapshots), `invalid` and `partial` results, synthetic negative tests always run, real-file tests skip, acceptance reported INCOMPLETE when a file is absent. |
| 6 | P2 | "Newest matches own" plus unconditional RULES equality cannot hold for uniform-food (maxHistory 301 vs 451) | Accepted. Two named predicates (`dynamics`, `observation`), explicit resolution rule, original and resolved keys kept apart, negative control, same predicate for short and full runs. |
| 7 | P2 | Privacy gates check strings, not emitted assets; `food-bands-model` rename would break the hungry-shapes chunk contract | Accepted. Existing `hungry-shapes-model` untouched; distinct `food-bands-*` chunk names; packaging test builds to a scratch dir, applies the Dockerfile rm to a copy, walks static and dynamic imports, asserts no food-bands file remains and no retained file references a removed one; gate 6 uses `find`/`grep` over the whole dist. |
| 8 | P2 | `git diff --stat` ignores staged and untracked files | Accepted. Gate 7 now uses working-tree and cached diffs, `git status --short`, `git diff --cached --name-only`, and a check that restored artifacts are excluded; coordinator stages exact paths (D6). |
| 9 | P2 | "768 to 769 targets" misdescribes the rule change (budget is 768 in both; the target index advance changes) | Accepted. Wording corrected in Corrections 1. |
| 10 | P3 | A `parity-full` file name does not keep it out of `pnpm test` | Accepted. Either always-on if fast, or `describe.skipIf(!BL_FOOD_PARITY_FULL)` with the command documented. |
| 11 | P3 | Axe at two widths misses keyboard, reduced-motion, hidden-tab and dynamic states | Accepted. Added keyboard-only, reduced-motion, hide/restore cases and axe after the seed warning and the replay result. |
| 12 | P3 | Node stepping time does not prove browser responsiveness | Accepted. Corrections 4 reworded; long-task measurement in e2e with a 200 ms starting budget recorded in EVIDENCE.md; replay compare sliced. |

Checked correct by the reviewer: arms, seeds, horizons and model assignments for all 18 tools; geometry helper names; the eight model hashes match their pins; replay shape; comparison clock supports an explicit horizon and freezes extinct worlds; Caddy matcher, URL-only decision, `DIAGNOSTIC` addition, axe dependency.

## Code review dispositions (implementation)

Reviewer: Codex Sol 6.1, xhigh, read-only, 2026-11-14. Raw: `/private/tmp/claude-501/-Users-nicholas-develop-browser-life/e28381b7-b46a-475c-85b9-2de9973e0770/scratchpad/food-live/code-review-final.txt`. No P1. Five findings, all accepted and fixed.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | P2 | Accounting table kept stale labels and could throw when switching screens | Fixed: table rebuilds when arm labels or row keys change (signature); e2e "switching screens rebuilds the accounting table" |
| 2 | P2 | Replay check could return identical with snapshots missing or never compared | Fixed: a snapshot at the final tick is required, every snapshot must sit on a sample tick, and the compared count must equal the saved count; synthetic negative tests added; the 41 real screen/arm/seed checks (34 distinct files) still 40 identical and 1 partial |
| 3 | P2 | A cancelled compare could certify the previous display | Fixed: `compareDisplayed` takes the cancellation token and generation, rechecks after the fetch and before appending, and bails if the card tick moved |
| 4 | P3 | History render test inspected only the background | Fixed: recording context keeps strokes; test checks the three family colours and each vertex position |
| 5 | P3 | Runtime-normalisation test compared a value with itself | Fixed: runtime-only change equal; changed history, lineage, tick or seed all differ |


## Source review dispositions

Reviewers: sol (Codex Sol 6.1) and claude. All fixed unless stated. Checks after the fixes: `pnpm vitest run apps/lab/test/food-bands` 6 files, 147 tests passed (with the 73 replays restored); `pnpm typecheck` clean; `BL_E2E_PORT=5268 npx playwright test tests/e2e/food-bands.spec.ts` 26 passed, 12 skipped (screenshot block, needs BL_FOOD_SHOTS).

| Finding | Reviewer | Disposition | Evidence |
|---|---|---|---|
| P2 no crypto.subtle reported identical with intact:true | sol | Fixed: new `integrity` field ('verified' / 'failed' / 'unchecked'); a missing or non-matching stateSha256, or no subtle, never counts as verified; `intact` is true only when verified; the summary says the digest could not be checked | test "without crypto.subtle the digest is unchecked" |
| P2 partial results dropped digest failures | sol | Fixed: partial carries `integrity` and the summary warns | test "corrupt or missing stateSha256 ... identical and partial" |
| P2 finalTick not bounded by maxTick or horizon | sol | Fixed: validateRecording rejects finalTick > maxTick and > expected horizon | invalid cases "final tick beyond the recorded horizon", "beyond the expected horizon" |
| P2 displayed-frame check threw on null or frames:{} | sol | Fixed: frames must be an array, entries must be objects, otherwise skipped | code path in compareDisplayed; typecheck |
| P3 accounting rows only from first arm | sol | Fixed: rows are the union of both arms, keyed, with an em dash where an arm has none | e2e "accounting table lists every counter either arm has" |
| P3 REVIEW.md "All 41 ... identical" | sol | Fixed wording: 40 identical, 1 partial | this file |
| P2 other-seed radio set otherSeed without a seed | claude | Fixed: the radio only opens the form (`otherFormOpen`); `otherSeed` is set on a valid submit only | e2e "seed input ..." (radio then Reset keeps the screen seed unlabelled) |
| P2 seed input and ?seed= accepted 0x10, 1e3, empty as 0 | claude | Fixed: both require /^\d{1,10}$/, empty param is absent | e2e "seed input" (empty param, 0x10, 1e3 rejected, 77 accepted) |
| P3 "(wraps east)" always shown | claude | Fixed: shown as "(wraps past the east edge)" only when bandLeft + bandWidth > 96 | EVIDENCE.md quote corrected |
| P3 test gaps: environment compare and extinctionTick mutants survived | claude | Fixed: two negative tests added | "perturbed environment at a sample tick with no snapshot", "recorded extinction tick that the live world does not share" |
| P3 "All 41 recordings" overstated | claude | Fixed wording: 41 checks over 34 distinct files | EVIDENCE.md |
| P3 model note said "exactly" | claude | Fixed: "matched ... at ticks 0, 500 and the final tick (census, food, bodies and counters)" | page.ts renderSummary |
