# Naturalist Try receipts — 24 October 2026

## Scope

The existing Field notes panel can mistake an unrelated brush success or refusal for the outcome of a pending Try. Correlate that outcome to its command, retaining world/run guards and the rule that every hand edit stops baseline reading. This closes the limitation documented in `naturalist-lab-suggestions-v0-2026-10-18.md`; it does not change the proposer or measure whether its suggestion worked.

## Contract

- Each accepted Try gets a monotonically increasing numeric request id. Loads and retries never reuse an id during the page model's lifetime.
- The current proposer supplies exactly one actionable entry per suggestion. Multi-entry suggestions are refused locally, with an offline alternative, rather than treating a partial receipt as completion.
- The page includes the id with its lesion/feed request. The worker echoes it only on that command's logged touch or definite refusal, including stale-world, waiting-donor and feed-validation refusals.
- The model resolves a success only for matching id, generation and run. A definite refusal resolves only the matching active attempt. Untagged brush or replay touches still stop baseline reading, but never claim Try landed. Late receipts cannot settle a retry or a replacement world's Try.
- Generic errors remain uncertain. A subsequent matching success or definite refusal can resolve that uncertainty; an unrelated receipt cannot.
- Ids are ephemeral message metadata. They never enter manifests, checkpoints, physics, observations, or replay records. Replay emits an untagged touch.

## Implementation and validation

The model, panel and page forward request identity; worker protocol and receipt paths echo it. No `execution.ts` change is needed. Existing brush accounting and notifications are unchanged.

Model tests cover unrelated brushes/refusals, errors followed by matching or unrelated receipts, retries, replacement worlds, duplicate receipts, and refusal of multi-entry suggestions. The existing all-signal test pins zero entries for controls and one for every supported intervention. Direct worker browser tests cover success/refusal identity and replay omission; the live panel test retains its one-click/one-intervention assertion.

Local results so far: 55 tests passed across `naturalist-suggest.test.ts` and `naturalist.test.ts`; `pnpm typecheck` and the production build passed. All 9 Chrome naturalist/receipt/feed checks passed in 45.6 seconds, including the actual Try button flow, request-local refusal paths, tagged acceptance outside baseline presets, replay omission and existing feed regressions. Argon 4 High source review returned **NO BLOCKERS**. Its low-priority wording finding is fixed: only an actual control is labelled a replay control; unsupported or empty non-control suggestions, including a missing Try label, are refused as unsupported. A focused model test covers all three cases. The review packet predated the final worker/browser tests and D-46; both were already complete in the final implementation, with the browser results recorded above.
