I couldn't write the plan file because the Write tool is disabled here, so the review is below. I read about 10 files and edited and ran nothing.

**Verdict:** I found no blocker on the numbers, claim limits, receipt order, source preservation or media bindings. Two items need fixing before the PR (A and B).

**Fix before the PR**
- **A. Digits are glued to the preceding word in the new prose.**
  - Examples are `stationary1201 and1203`, `Bodies at3000`, `In1201`, `total3/3` and `to6,000`. The validation hashes read `SHA74dc…`.
  - It appears in `new-decision-section.txt`, `-results.md`, `-validation.md` and the string fields of `summary.json`.
  - The decision section becomes visible HTML on the decisions page.
  - `stationary-food-replication.html` is clean ("seed 1201", "3,000").
- **B. `reviews/stationary-food-replication-final-claude.md` is untracked and 0 bytes.** Fill it with this review or delete it. Don't commit it empty.

**Should-fix and nits**
- **C. `runs/stationary-food-replication/delivery.log` is a failed run, not a smoke report.**
  - It shows `ERR_CONNECTION_REFUSED` on :5433 at 20:57:48.
  - `delivery-final.log` (20:58:21) failed with the axe error "Please use browser.newContext()".
  - The passing report is `delivery-fixed.log` (20:58:38): "both videos play; desktop/phone axe and overflow pass; no page errors." It ran after `verify-delivery.mjs` was edited at 20:58:34. Cite that file in the PR.
- **D. The videos are silent.** They have no `<track>`, no poster and no transcript, only `aria-label` plus the nearby paragraph. That is a gap against WCAG 1.2.1 (video-only media). A one-line description per clip would cover it.
- **E. The `<img alt>` text is thin.** It reads "at 1500,2500,3000 ticks". Add spaces and a clause on what the image shows.
- **F. Receipt order is consistent but only provable to the second.**
  - Receipt `reviewedAtUTC` is 00:54:38Z (20:54:38 local), commit c05a8acc is 20:56:49, and the diagnostics files are 20:56:49 and 20:56:50.
  - So the order is receipt, then commit, then diagnostics. State in the PR that the helper refuses to run until the receipt is committed.
- **G. A Python process is listening on :5433.** It is probably the capture server. Stop it if it's yours.

**Checked and clean**
- **Numbers.** All four arms in `results.md` match `summary.json`:
  - Bodies, family counts (each sums to the population), distinct programs, maximum-ever generation and accepted food all match.
  - Stationary accepts less food in both pairs (280518 vs 283182, 288634 vs 292017).
  - "Ten frozen payload fields" matches the ten fields `validation.md` lists.
  - "Half the torus" is plausible (4608 targets = 48 wide × 96 tall) but I didn't read the grid size.
- **Hash bindings.** The plan SHA `74dc…` is identical in `summary.json`, `validation.md` and the media metadata. The metadata pins model, runner, plan, viewer JS and CSS, manifest, receipt, the historical reference, the index and both arms' raw and data hashes. The manifest and receipt hashes match `summary.json`. This was a compact comparison only.
- **Claim limits.**
  - The text says 2/2 new stationary passes, with historical 1202 separate (3/3 descriptive only).
  - Moving is a regression, not independent evidence (`movingReferenceIsIndependentEvidence: false`).
  - It makes no superiority or equality claim and says the rejudgments were nonblind.
  - It says minority persistence is unproven and the 6,000-tick longevity slice is not authorized or run.
  - The HTML aggregate, the decision section and `results.md` agree.
- **Decisions append.** `decisions.html` differs from HEAD only by an inserted `<section id="stationary-food-replication">` before the final `</html>`. Every byte before that is unchanged.
- **E2E additions.** They use the real 1201 and 1203 artifacts and cover jumps to ticks 1500, 2500 and 3000, play and pause, and seed switching. They also run axe on a 390 px viewport, check overflow and assert the exact JSON request list.

**Not verified**
- I didn't re-check the mp4 decode (151 frames, 10 fps, 15.1 s) or the comparison PNGs.
- I took the test, typecheck, build and focused-test results from your report rather than running them.
- I didn't re-diff the historical byte-identity claim.
- I only read the seed-1201 media JSON, not the 1203 one.

After fixing A, grep the new text for `[A-Za-z](1[0-9]{3}|3000|2500|6,000)` and expect no hits. Also confirm the `decisions.html` prefix is still byte-identical to HEAD.
