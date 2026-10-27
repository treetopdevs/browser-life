# Field notes: wound/drain clicks and narrow-screen coverage

This slice closes the page-level wound/drain suggestion and 375px open-command
verification gaps left by the earlier Field notes notes, and records the existing
panel in DESIGN.md. It adds no runtime behavior, model call or scientific outcome.

## Fixture boundary

`tests/e2e/lab-naturalist-actions.spec.ts` grows the real gradient-m3 seed-1 world
until its existing low-living-cells bell files a note. In the test browser only,
a Playwright route wraps the lazy proposer export: it maps that note through the
actual lineages-high wound rule or livingCells-high drain rule, preserving its
original note identity. Thus the wound/drain suggestions are supplied action
fixtures, not claimed naturally occurring high-side bells. Their predictions are
not evaluated. The fixture is named in the test title, source and screenshot names, and an
explicit test-only label appears inside full-note captures. The label is inserted
only around screenshots and removed immediately; layout, accessibility and click
assertions see the unmodified production DOM. Full-note screenshots include the
receipt and both expanded command blocks. Screenshot-only styling hides the
unrelated fixed skip-navigation link, which Chromium can otherwise overlay on
its tall-element capture; no assertion runs with that styling.

The production panel, actual button click, worker, GPU simulation, ledger and
session export remain real. There is no product test hook or fake worker success.
The existing unwrapped naturalist test remains the natural feed/bell proof.

## Checks

For each supplied action: nothing is applied while reading; both command blocks
are open at 375px and wrap without internal/document overflow; command type stays
at least 11px; the Try button fits horizontally; axe checks the populated panel in
day and night. The actual click moves focus to its persistent status region,
confirms one hand change, removes further Try buttons and stops baseline reading.
The downloaded session must validate and contain exactly the wound or negative
feed with the displayed position/radius/dose. A wound leaves the jar sealed; a
drain reports removed matter and exactly one feed operation.

The behavior run passed all three page tests in 41.3 seconds: both supplied
wound/drain cases and the unchanged natural feed/bell page test. The wound also
reduced the displayed biomass share while the ledger stayed sealed. Typecheck
passed. Day/night contrast is audited after finite theme transitions finish,
not halfway through a button's foreground/background transition; the initial
unstabilized audit caught that transient and the test was corrected.

The final layout/action run with visible fixture labels passed both tests in
41.2 seconds; typecheck and diff check passed. Inspected the labelled wound/night
and drain/day 375px captures: readable, clearly marked as test suggestions, with
no horizontal overflow. Screenshots under `test-results/` are local evidence only,
not fixtures committed to the repository.

## Adversarial review disposition

The four source-review findings were checked against the current branch:

1. The unfinished-validation report was stale: the final labelled run was already
   recorded when review arrived. Fresh validation below supersedes both older runs.
2. Accepted the narrow-layout assertion gap. Tests now check the panel's own
   viewport bounds and overflow, containment of suggestions and every command,
   and multiline command height in addition to document overflow and font size.
3. Accepted the fixture/screenshot gap. Tests explicitly await Paused, keep fixture
   labels out of behavioral/layout/accessibility checks, and capture the entire
   labelled note instead of an accidentally cropped viewport.
4. Accepted the post-click contract gaps. Tests retain and compare the status
   region DOM identity, audit the touched state in both settled themes, retain
   the unmeasured prediction and no-pass-badge assertions, check the filed-before
   receipt, and match the displayed applied step and removed matter exactly to
   the validated downloaded session.

No production code or scientific claims changed. The supplied wound/drain rules
remain UI fixtures; these checks do not establish natural high-side bells or
prediction success.

Review-closure validation (2026-10-24):

- `BL_E2E_PORT=5207 pnpm exec playwright test tests/e2e/lab-naturalist-actions.spec.ts tests/e2e/lab-naturalist.spec.ts --workers=1`: all 7 tests passed in 1.4 minutes, including the unchanged natural bell/worker regressions.
- After the final explicit theme assertion and screenshot-only skip-navigation
  exclusion, reran the complete changed action spec: both tests passed in 58.1
  seconds. Inspected wound/night and drain/day full-note captures: fixture labels,
  original receipts and both command blocks are present with no overlay or clipping.
- `pnpm typecheck` and `git diff --check` pass.

These results close the source-review assertion gaps; they are not a new
scientific experiment or an independent second review of the follow-up changes.
