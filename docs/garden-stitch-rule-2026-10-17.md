# Stitching a garden: the rule (2026-10-17)

Slice 6 of the backlog run. PR #21 (shared garden coordinator, main f178aca)
left `tools/stitch.ts` unable to export a garden: the coordinator rewrites a
garden's `interventions` (founding schedule plus live letters) as letters
arrive and are dropped, so each segment's manifest carries the list as it
stood when that segment was assigned, and `stitchRun` refuses any spec that
differs from segment #0's. This note states the acceptance rule and the
pass/fail criteria of its proof. Nothing here changes physics, the runner's
ownership rule, or a golden pin.

The rule applies only in `stitchRun`'s garden mode
(`stitchRun(segments, totalSteps, { garden: { interventions } })`), which
`tools/stitch.ts` uses for an experiment whose stored spec has
`"garden": true`. Every other run is stitched exactly as before: one schedule
on every segment (the whole spec but `steps` the same), each log checked
against it, the stitched spec carrying it whole, entries after the last step
included.

## Words

* `L_k`: the `spec.interventions` in segment *k*'s own `manifest.json` (the
  list its task carried; the file is the accepted upload, checked by SHA-256).
* Segment *k*'s window: steps in `(start_k, end_k]`, plus step 0 when
  `start_k = 0` (`ownedInterventions`, the runner's ownership rule).
* `owned_k = ownedInterventions(L_k, start_k, steps_k)`: what segment *k* says
  it applied.
* Two entries are *the same* when their fields are equal (`step`, `kind`,
  `x`, `y`, `r`, and for a feed `amount` and `matter`, an absent `matter`
  equal only to an absent one); key order never matters.

## The rule

A run's segments stitch only if, for every segment *k*:

1. `L_k` passes `validateInterventions` (it is producer-written data).
2. Its `interventions.jsonl` is exactly `owned_k` as logged (the existing
   `checkInterventionLog`, now given `L_k` rather than segment #0's list).
3. **No rewriting history.** For every earlier segment *j < k*, the entries of
   `L_k` in *j*'s window are the same, in the same order, as `owned_j`.
   Entries of `L_k` in its own window are checked only against its own log
   (rule 2), which the same producer wrote, so a segment could log an entry
   it invented and later segments, repeating it, would not contradict it.
   The coordinator's list (below) is the only outside check on a segment's
   own window, which is why garden mode requires it.
4. Entries of `L_k` after `end_k` are speculative and unconstrained: a letter
   the keeper dropped before its day was assigned appears in an earlier
   segment's list and in no later one, and that is not an error.
5. Every other part of the spec (all keys but `steps` and `interventions`)
   is the same across segments, as today; a run has a schedule in every
   segment or in none.

The stitched bundle's `spec.interventions` is the concatenation of `owned_k`
in segment order (the union of owned entries), its `interventions.applied` is
that list's length, and that length equals the stitched log's line count.

The caller must pass the coordinator's current list (`tools/stitch.ts` reads
it from the experiment listing, under the run's lock), and the union must be
the same, entry for entry, as `ownedInterventions(current, 0, totalSteps)`:
the live list over `[0, totalSteps]`. A day that holds an attempt carries a
frozen slice (the coordinator's frontier rule), so a verified prefix agrees
with it.

## What is exported

Only a garden's verified prefix: the longest run of days from day 0 whose
status is `verified` (with `--allow-unverified`, `done` or `verified`),
stitched over `(0, end of the last such day]`. A garden with no such day is
skipped. Days after the prefix are not exported. "Verified" means two
islands agreed on a day's state hash, not that either is trusted, and the
observation files are only as trustworthy as the island that produced them
(apps/coordinator README, "The garden").

`tools/stitch.ts` exports a garden's run under an exclusive lock on the hidden
file `.seed-<n>.lock` beside `seed-<n>` (an OS file lock, released when the
process exits), and reads the listing and the schedule again once it holds the
lock. When the prefix has grown, the shorter export is replaced in place: it is
renamed aside, the new one renamed in, the old one removed, so for a moment no
`seed-<n>` exists. An export whose days run past the prefix exportable now
(a day reset, or an export made with `--allow-unverified` and this one
without) is moved aside as stale. A cached export is kept only if its range
matches the days the coordinator lists and its schedule and log pass the
checks above against the coordinator's list.

## Pass/fail criteria of the proof

Vitest, `packages/runner/test/stitch.test.ts`, hand-built segments, no GPU.
Each must hold as stated; any other outcome is a failure of the rule or its
code, not a reason to loosen the test.

* Letters added between days: day 0 carries the founding entry and one
  letter; day 1's list adds letters at day 1's and day 2's end; day 2's list
  carries those too. Accepted; the stitched log is the three logs
  concatenated; `spec.interventions` is the union; `applied` counts it.
* A dropped letter: day 1's list carries a letter at day 2's end that day 2's
  list does not (and day 2's carries another instead). Accepted; the union
  holds day 2's letter and not the dropped one.
* A forged history rewrite is refused, naming the later segment and the
  earlier window: day 2's list with day 1's letter moved (another `x`), with
  an extra entry in day 1's window, with day 1's letter missing, and with the
  founding step-0 entry missing or changed.
* A segment that logs a speculative entry (one after its own end) is refused.
* With the coordinator's list given: a union that differs from it in the
  stitched range is refused; a list with a live letter after the stitched end
  (a garden prefix) is accepted.
* An ordinary scheduled run with one list everywhere stitches exactly as it
  did before: every existing test in the file passes unchanged,
  `spec.interventions` equals that list, entries after the last step
  included; a run owning no entry stitches with an empty log; lists that
  differ between segments are refused.
* Feeds are compared field by field: a later list that changes a feed's
  `amount`, adds or removes its `matter`, or changes an entry's `kind` or
  `y` is refused.
* A day 0 that invents an entry in its own window (in its list and its log,
  repeated by every later day) is refused only by the coordinator's list.
* Any other spec difference between segments is still refused.

Deno, `tests/deno/garden_stitch.ts`, native WebGPU, a small world (the
48 x 48 `spots` override of `tests/deno/interventions.ts`), short: three
segments, each run with the list a garden task would have carried at its
assignment (one speculative letter later dropped), continued from its
predecessor's state and observer, stitched, against one continuous run with
the final list over the same steps. Pass: every `VERIFIED_FILES` entry of
the stitched bundle equals the continuous run's byte for byte, the final
state hash and artifact digest equal, the stitched `spec.interventions` is
the final list, `applied` equals; and the same segments with day 2's manifest
forged to rewrite day 1's lesion or its feed's amount are refused. One seed,
one small world, lesions and one feed: the Deno check proves equality with a
continuous run, and the vitest cases carry the breadth of refusals.

Deno, `tests/deno/garden_export.ts`, no GPU: `tools/stitch.ts` as a
subprocess against a fake coordinator serving hand-built days. Pass: the
verified prefix is written and kept on a rerun; a grown prefix replaces the
shorter export in place with nothing moved aside; an edited cached schedule
or log is moved aside and rewritten; a listing that is stale on the
process's first read does not move a longer export aside; an export longer
than the verified prefix is moved aside; of two exporters, sequenced by the
fake coordinator (the first held at its first download, the second started
with a stale listing), the second makes no further listing read while the
first holds the lock, then keeps what the first wrote; and a
coordinator list that rewrites an exported day is refused.
