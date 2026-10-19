# Garden meteor: rules written before the code (2026-10-18)

Slice 40 of the backlog run builds the meteor from the shared garden brainstorm's table of parts
(`docs/shared-garden-brainstorm-2026-10-09.md` §4: "Stone | a lesion at a chosen place, landing at dawn | radius as a
choice, a meteor as the rare large one"). Today a visitor's stone is a lesion of radius 1..32 (contract `garden-v1`,
PR #21). The stone horizon (`docs/garden-stone-horizon-2026-10-18.md`, PR #55, and its slice-34 amendment, PR #59) ran
radius-64 stones on the big storm, and its rules read R = 64 as a stone effect against a one-cell kick at the coarse
grain (with caveats, below). This note fixes the meteor's rule, its place, its bounds and its limits before any code.
A change to anything below is a dated amendment at the end, never a silent edit.

The meteor is built the way food was (`docs/garden-food-2026-10-18.md`, PR #41, with all four of its amendments):
a collective, rare act called by hands. Where this note says "as food", the food note's rule, with its amendments,
applies word for word with "food" read as "meteor"; only what differs is spelled out. It adds no physics, no rule
change and no golden pin: a meteor is the existing scheduled `lesion` intervention (the same entry a stone becomes,
`{"step","kind":"lesion","x","y","r"}`), only larger, and islands already apply lesions inside segments.

## 0. What this does not decide

The meteor is **off** unless a keeper founds a garden with it on (`"meteor": true`), independently of food. A garden
founded without it, including any existing commons, behaves exactly as today: its record has no meteor keys and its
schedule is unchanged. Turning meteors on for the commons is the user's decision, not this slice's.

## 1. The ask

- **A hand**, as food: `POST /api/public/garden/meteor/hands` (and `/api/public/gardens/:name/meteor/hands`), the JSON
  body exactly `{}` (`content-type: application/json`, else 415; a zero-byte body 422), carrying nothing: no place,
  no name, no text.
- **One hand per network per dawn period**, as food: the network is the food hand's (an IPv4 address whole, an IPv6
  address as its /48, an IPv4-mapped address as its IPv4 address), keyed by the same `LetterLimiter.hand_key/1`
  (the limiter's boot salt, tagged with its incarnation). A repeat is answered 200 `counted: false` before the ask's
  state, so also after the K-th hand closed it.
- **The meteor ask and the food ask are separate.** Each keeps its own set of this period's hands. One network may give
  one hand to each in the same period; each hand costs a letter. A food (waiting or not) never opens or closes the
  meteor ask, and a meteor never the food ask.
- **The threshold K** (`meteorAsks`): the hand that brings the period's count to K calls the meteor at once, as food;
  the period's count goes back to zero and the networks seen stay remembered until the dawn. Hands that do not reach K
  expire at the next dawn of the garden's own grid.

## 2. Where and when it lands

- **When:** the frontier day at its end step `(d + 1) * D`, as food. **One meteor per N days** (`meteorEveryDays`):
  the food spacing rule (`|d - m| >= N` for every live meteor's day `m`, whatever its status; while a live meteor waits,
  the search starts N days past it; a cooldown that would open past the horizon is `"horizon"`). The rule counts
  meteors only: a food on a day does not block a meteor there, and both may land on one day.
- **The veto window**, as food: every meteor carries `notice_until = called_at + dawnPeriodMs`, and the Queue does not
  hand its day to an island to run before then. A reject that reopens the day does not restart it.
- **Where: a fixed rule, not a vote.** The *n*-th meteor of a garden (`meteor-<n>`) lands at
  `x = u32be(H[0..3]) mod width`, `y = u32be(H[4..7]) mod height`, where `H = SHA-256("<name>/seed-<seed>/meteor-<n>")`
  (UTF-8, the garden's name and seed, `n` in decimal). Both garden presets' sizes are powers of two, so the reduction
  has no bias. The place is computed when the meteor is called and stored on its record (`x`, `y`), so a later change to
  this formula never moves a called meteor; the view shows the place of the *next* meteor (`meteor.place`) before anyone
  asks. Why this rule:
  - *A vote is ruled out by the hands themselves.* A hand carries nothing and is kept only as a salted hash; a place
    vote needs each hand to carry a place, which is personal data held beside the hash, a second contest (the median
    is steered by whoever holds the most networks) and a body that is no longer `{}`.
  - *Not the centre.* Food already lands at the centre. A meteor there would clear, every N days, the disc every food
    feeds (r 64 covers the r 32 food disc whole), and make one place of the jar a standing wound site. The sun wanders,
    but the same 12,853 cells would always be the ones struck.
  - *Not the last stone's place, or a stone's*: one visitor could choose it.
  - *Not chosen at landing.* A place drawn from the world at the landing step would be unknown when people ask, so the
    ask would not be a yes or no to one known act.
  - The hash rule is fixed in advance, public before the ask, different for each meteor, and no visitor can move it.
    **The keeper's drop re-rolls it:** a dropped meteor keeps its number, so the next one called is `meteor-<n+1>` at
    the next place. That is a keeper's power, public as a dropped meteor in the view.
- **Order at a step.** The schedule lists, per step, the stones by sequence number, then the foods by theirs, then the
  meteors by theirs. Appending meteors last keeps every schedule without meteors exactly what it was (tags are internal;
  food stays "after the stones"). A meteor at the same step as a food at an overlapping place clears bodies after the
  feed has added its nutrient; either order is deterministic, and this one is additive.
- **The schedule entry** is exactly `{"step", "kind": "lesion", "x", "y", "r"}`, a stone's shape. The runner logs a
  lesion with its effective radius and no `matter`.

## 3. The radius, and why a meteor needs no matter bound

- **The radius** is `garden_meteor_radius`, default **64**, allowed 33..255 (a meteor is larger than any stone, whose
  limit is 32; 255 is the big storm's `maxLesionRadius`). It is copied into the garden's record at founding with K and N,
  so a later config change never changes a live garden's rule. Why 64: it is the largest radius the stone horizon ran,
  the only size above a stone that has any reading at all, and §6.2 of the brainstorm names a meteor "radius 32 or more".
- **Bounded by the world.** The founding refuses (422, naming the numbers) a meteor radius past
  `div(min(width, height) - 1, 2)`, the largest lesion a one-tile world takes without its disc wrapping onto itself.
  The coordinator knows the world's size, not its tiles, so this equals `maxLesionRadius` only for one-tile presets. The
  vitest therefore pins, for every listed garden preset (prod, dev and test config): it is one tile (`worldW == tileW`, height the
  same) and `maxLesionRadius(cfg) >= garden_meteor_radius` (and `> 32`). This matters beyond the picture: the runner
  clamps a lesion's radius, and `tools/stitch.ts` compares a logged lesion with `clampLesionRadius` of the scheduled one,
  so a clamped meteor would make the view's `r` a lie. Today: `wild-storm-large` (512 x 512, one tile) allows 255,
  `spots` (256 x 256, one tile) 127.
- **The disc.** A lesion clears the cells with `dx^2 + dy^2 <= r^2` (`applyLesion`): 12,853 cells at r 64, 4.9% of the
  big jar (262,144 cells) and 19.6% of `spots` (65,536). Every body there turns to waste and its stored energy leaves as
  heat.
- **No MATTER_MAX term.** Food has a founding bound because a feed adds matter and a refused feed fails its day. A lesion
  conserves matter: it moves biomass and polymer into waste in place and books the energy as heat. It cannot take the
  world past MATTER_MAX, and the runner never refuses one, so a meteor adds nothing to food's bound (which is unchanged
  for a garden with both) and needs none of its own. R = 64 lesions ran headless on the big storm in #55 and #59.

## 4. Anti-stuffing and per-address limits

- K defaults to 5 (`garden_meteor_asks`), a keeper's `meteorAsks` in 2..1000; N defaults to 7 (`garden_meteor_every_days`),
  a keeper's `meteorEveryDays` in 1..365; both only with `"meteor": true`. Dev and the end-to-end test found with K 2,
  N 1. Why 7: rare beside the stones (a day takes up to 8 letters, so up to 56 stones per meteor at the default), and
  equal to food's spacing, so a keeper reads one rhythm. The readings in §7 put a radius-64 mark at about a quarter of a
  day, so the spacing is not there to let marks clear; it keeps the large act rare.
- A hand costs one letter of the shared hourly budget (stones, food hands and meteor hands together); a repeat or a 409
  gives its letter back and is charged as a refusal; 503s as food's (the limiter restarting: `counted: false`, letter
  back; the Queue not answering: `counted: null`, letter kept).
- **Worst case.** K networks call one meteor per N days, each at a place fixed in advance, public for at least a dawn
  period before its day can run. The keeper's veto: `POST /api/gardens/:name/letters/meteor-<n>/drop` while its day was
  never assigned (`{"meteor": <meteor>}`); a dropped meteor counts toward nothing, so the ask can open again (at the next
  place).
- **Log size.** Live meteors count toward `logMax` (founding plus live letters, foods and meteors).
- **Until the proxy passes visitors' own addresses** (D-17, D-24), as food: every visitor is one network, the ask can
  hold one hand, K >= 2 is never reached. The meteor block carries `sharedAddress` (the same config,
  `garden_shared_address`), and the page says so beside the button.

## 5. Privacy

As food (section 5 and its amendments): the Queue keeps each garden's meteor hands this period as salted hashes **in
memory only**, in their own map beside the food hands (`meteor_hands`): dropped before every persist, never logged, never
in a view (only the count), replaced by counts in `format_status/1` (a `{:ask_meteor, name, key}` message is redacted
like `{:ask_food, ...}`), forgotten by the same sweep at the dawn, and discarded on a limiter incarnation change. A
restart forgets the period's hands (toward no meteor); a called meteor is in the record and survives.

## 6. The contract stays `garden-v1`

Additive only. A meteor is in no `letters` list, in no `days[].letters`, and no letter gains a kind. Added:

- `meteor` (always present), an object shaped as `food` without `amount`: `enabled`; `asks`, `everyDays`, `r`,
  `place` `{x, y}` (the next meteor's place; each `null` when off); `hands` (0 when off); `expiresAt`; `sharedAddress`;
  `open`; `closed` (`null` when open, else food's codes: `"off"`, `"stopped"`, `"finished"`, `"horizon"`, `"log-full"`,
  `"cooldown"`); `opensAtDay`; `landing` (`{day, step}` or `null`); `meteors` (the newest 32, newest first, live and
  dropped).
- a meteor: `id` (`"meteor-<n>"`), `x`, `y`, `r`, `calledAt`, `noticeUntil`, `hands`, `landsAtStep`, `day`, `status`
  (the letter statuses), `landedIn`, `droppedAt`.
- `days[].meteor`: the id of the live meteor the day carries, or `null`.
- The founding body gains `meteor` (bool, default false), and only with it `meteorAsks` and `meteorEveryDays`.
- Answers of the meteor hands route: 201 `{counted: true, called: null | <meteor>, meteor: <block>}`, 200
  `{counted: false, called: null, meteor: <block>}`, 409 `{error, closed, opensAtDay}`, and food's other codes.

The fixture `priv/static/garden-contract.example.json` gains a `meteor` block with a meteor landed on day 2 (the done,
unverified day) and the ask closed for cooldown, a timeline the scheduler can produce, and `days[].meteor`. The page
reads a view without `meteor` (a coordinator from before) as meteors off.

## 7. The page

Under the food ask: the meteor ask, shown only when `meteor.enabled`, with food's parts (the count and threshold, the
time left, where and when it would land, "Add my hand" with the same answers in words, a closed reason with a disabled
button, `sharedAddress` words, the list of meteors with day, step, status and notice). Its plain words:

- **What it is.** "A meteor is a stone of radius r: where it lands, every body in a disc of N cells (P% of this world)
  turns to waste and its stored energy to heat. It lands at a place fixed before anyone asks, (x, y) for the next one,
  never one a visitor picks, and chosen without looking at what lives there, so its disc may hold many bodies, few or
  none. “Meteor” is only this letter's name for a large stone; it promises no lasting change." N and P from `meteor.r`
  and `world`.
- **What a stone this size did, as far as anyone has looked**, shown only when `presetId` is `wild-storm-large` and
  `meteor.r` is 64; otherwise "Nobody has yet measured what a stone of this size does in this world." The words, all
  from #55 and #59 as recorded (amended after review, below): in twin worlds of the big storm founded as the commons
  was (one feed at the centre at step 0, radius 255, 16 quanta per cell; then "as this garden was too" when the view's
  `founding` is exactly that feed, "not as this garden was" otherwise), forked early, at steps 131,072 to 393,216, a
  radius-64 stone's neighbourhood stayed more different from its undisturbed twin than the rest of the jar for a median
  of about 35,800 steps (from about 2,000 to about 68,600 over nine pairs), about Q of a day here (Q from
  `pace.stepsPerDay`, "under 1% of a day" below half a percent); by the rule written before that run that is "a mark
  with no lasting effect", not a lasting change. Those stones were each aimed at a living cell; a meteor's place is not,
  so it may clear less. A one-cell nudge in the same checkpoint worlds, at a separately chosen cell, stayed
  distinguishable for a median of about 9,200 steps, so by that rule the stone read as a stone effect: its mark
  outlasted a one-cell change's, which the size of the change alone could explain. Pair by pair the nudge lasted at
  least half as long as the stone in five of nine, and in the worlds forked at step 262,144 it outlasted the stone in all
  three histories. In the first 8,192 steps after the stones in the worlds forked at step 131,072, the stone's summed
  excess of difference near it over the rest of the jar (the fine pilot's gap area) was more than twice the nudge's in
  two of three histories, not all three. Three histories, one of them a carpet; one founding; the measure saturates; and
  no null stone of this size could be placed. "These are what rules written before the runs said, not settled facts
  about this garden."
- **Why it is rare**: a meteor is the one large act a visitor can ask for; it comes only when K networks ask within one
  dawn, at most once every N days, and waits a whole dawn period before its day runs so the keeper can set it aside.
  Hands per network, not per person, as food's words.

The button is not called "meteor" on its own: the heading is "Ask for a meteor (a large stone)", and the first words of
the section end "“Meteor” is only this letter's name for a large stone; it promises no lasting change", so the word does
not promise a lasting change the readings did not find. "Meteor" stays the letter's name (the brainstorm's letters table
calls it that) in the aside label, the list and the answers.

## 8. Pass criteria (each a named test)

- ExUnit, pure (`garden_test.exs`, describe "meteor"): K distinct hands call a meteor on the frontier day at `(d+1) * D`
  at the rule's place with the record's r; the place formula's values for a named garden (`meteor_place/2` against
  SHA-256 computed in the test), different for n 1 and 2, and a drop's successor at n + 1's place; a repeat is not counted
  (also after the call); hands expire at the dawn (offset grid); a new limiter incarnation resets; one meteor per N days
  (`"cooldown"` with `opensAtDay = m + N`, past the horizon `"horizon"`, a waiting meteor closes the ask after a big
  retreat); closed `"off"`, `"stopped"`, `"finished"`, `"log-full"`; the schedule entry's exact shape and order stones,
  foods, meteors at one step; food and meteor independent (separate counts, one network in both, a waiting food does not
  close the meteor ask, both on one day); a dropped meteor reopens the ask and a seen network is still a repeat; an
  assigned day's meteor is not droppable; `hold?/3` holds a meteor's day until `noticeUntil`, its own day only, nothing
  once dropped; live meteors count toward `logMax`; a garden founded without meteor has no meteor keys and an unchanged
  schedule (with food or without); the view's `meteor` block in each state and `days[].meteor`.
- ExUnit, Queue (`garden_queue_test.exs`): founding keys and ranges (`meteor` not a bool, `meteorAsks` 1 or 1001,
  `meteorEveryDays` 0 or 366, either without `meteor: true`: 422s); a configured radius past the world is a 422 naming the
  numbers (`spots` with radius 128) and the commons' founding passes with 64; `state.bin` never holds meteor hands; a
  restart zeroes the count and keeps a called meteor; a meteor's day idle until `noticeUntil`, then assigned with the
  lesion in the task's `interventions`; a reject that reopens it (back to `"waiting"`, still scheduled, droppable);
  `format_status/1` redacts meteor hands and `{:ask_meteor, ...}`; the sweep forgets a past period's meteor hands.
- ExUnit, HTTP (`garden_api_test.exs`): the meteor route's codes (201 counted and calling, 200 repeat, 409 per closed
  reason, 415 without JSON, 422 for any body but `{}` and for zero bytes, 404, 413, 429, 503 both kinds); one budget for
  stones, food hands and meteor hands; the /48 key; the CORS preflight; the view after a hand (cache invalidated);
  `sharedAddress`; the keeper drops `meteor-<n>` (`{"meteor": ...}`, 409 once assigned).
- ExUnit, config (`config_check_test.exs`, `release_config_test.exs`): the three meteor keys are checked in their ranges
  (`ConfigCheck.range/1`, with `food_range/1` unchanged); prod defaults 5, 7, 64 and no runtime override.
- ExUnit, contract (`garden_contract_test.exs`): the driven garden (food and meteor, K 2, N 1) and the fixture have the
  same keys; `@nullable` gains the meteor paths; `closed` and status enumerations; every fixture meteor's `noticeUntil` is
  `calledAt` plus one dawn period and a done day carrying one is done after it.
- vitest (`apps/lab/test/garden.test.ts`): the fixture parses with `meteor`; a view without it parses as off; a malformed
  block is refused with its path; the words in each state, with and without the readings; the hand's answer per status
  for a meteor; the disc count (12,853 at r 64); every garden preset is one tile with `maxLesionRadius` at least
  `garden_meteor_radius` and above 32.
- Playwright (`tests/e2e/public-garden.spec.ts`, mocked): the meteor ask with count, threshold, time left, landing and
  place at 1280 and 375; each answer in words; a closed ask's reason and disabled button; the readings paragraph on the
  big storm at r 64 and the "nobody has measured" line otherwise; a view without `meteor` shows no meteor section.
- Deno (`tests/deno/garden_e2e.ts`, extended): the garden is founded with meteor too (K 2, N 1); after A runs day 1, the
  view's `meteor.place` equals the script's own SHA-256 of `e2e/seed-1/meteor-1`; two fresh networks call `meteor-1`
  onto day 2 at 3D at that place with r 64 (retried with fresh networks if a one-second dawn falls between them); a third
  hand is a 409 `"cooldown"` with `opensAtDay` 3; day 2 is run after its notice, replayed and verified; day 2's
  `interventions.jsonl` holds the meteor's lesion at 3D with r 64 and no `matter`, and its census keeps conservation
  exact; after the restart the meteor is still there and verified; the stitched schedule is the founding plus the
  verified letters, the food and the meteor, equal to the view's, and equals the unsegmented `tools/run.ts` run byte for
  byte.

## 9. Known limits

- Hands are per network, not per person (as food).
- A restart forgets the period's hands (as food).
- A garden founded with meteor writes new atoms (`:meteor`, `:meteors`, `:next_meteor`) into `state.bin`; a coordinator
  from before refuses that file, as with food. Gardens without meteor are unaffected.
- The place is a rule, not a choice: visitors decide only whether, not where. The keeper's drop re-rolls it.
- The readings cover one radius on one jar with one founding; a garden on another preset, founding or radius has none.

## Amendment 2026-10-18: what the build settled

Written after the code, for what the sections above left open or the build found. Nothing above changes except where
this says so.

- **A pond preset is refused.** Founding with `"meteor": true` on a preset in `:pond_presets` is a 422 ("meteor is not
  defined for pond worlds"), as food is. Section 3 bounds the radius by the world's size because the coordinator does not
  know the tiles; a pond world is many tiles, so that bound is not the runner's `maxLesionRadius` there and a meteor would
  be clamped (and the stitch check would then compare a clamped log with an unclamped schedule). No pond preset is a
  garden preset today; this closes the case rather than relying on the vitest's preset list.
- **The radius refusal's words** name the configured radius, the world's size and the largest lesion it takes, in that
  order ("meteor: the coordinator's garden_meteor_radius 128 is past the largest lesion this 256 x 256 world takes
  without its disc wrapping onto itself, 127"). The Queue's `max_world_radius/1` is `div(min(w, h) - 1, 2)`, and the vitest
  checks that it equals `maxLesionRadius` for every garden preset (each one tile).
- **The order at a step is internal and additive.** In `Garden.schedule/1` the sort tag of a meteor is 3 (stones 0,
  foods 1), so a kind added later between foods and meteors at the same step does not reorder either; a schedule without
  meteors is unchanged. The end-to-end test reads the order from the view (stones, foods, meteors) and matches.
- **`meteor.place` is the next meteor's place in every state** of an enabled ask (open, cooldown, horizon, stopped), since
  it depends only on the next number: a visitor can see where the next one lands while the ask waits.
- **One incarnation for both kinds of hand.** The view's meteor count is read against the same limiter incarnation as
  food's (`food_epoch` in the view's env); the two kinds of hand are kept in separate maps (`food_hands`,
  `meteor_hands`), dropped from `state.bin`, redacted by `format_status/1` and swept at the dawn by the same sweep.
- **Functions.** `Garden.add_hand/6` takes the kind (`:food` or `:meteor`); `add_hand/5` is food's, unchanged.
  `Garden.hold?/3` holds a day for a live food or meteor within its notice; `food_hold?/3` is unchanged (food only). The
  Queue's task picker reads `hold?/3`. `ConfigCheck.range/1` ranges the food and the meteor keys; `food_range/1` still
  takes only the four food keys.
- **A Queue call that does not answer** is logged as "a meteor hand's queue call timed out" (or "is not running",
  "exited"), without the hand's key, as food's.
- **The page.** The meteor block has `sharedAddress` and each meteor `noticeUntil` from the start, so the page requires
  both (no fallback, unlike food's later keys); a view without the block, or with it off, shows no meteor section. The
  readings paragraph's "about Q of a day here" is a whole percent of `pace.stepsPerDay` under a day (about 27% at
  131,072 steps), "about a day" near one, and whole days above. The disc's share of the world is given to a tenth of a
  percent (4.9% of the big jar, 19.6% of `spots`). The paragraph is shown only for `presetId` `wild-storm-large` and
  `meteor.r` 64, otherwise the "Nobody has yet measured" line; it sits under the meteor ask with the reason it is rare.
- **The fixture** shows `meteor-1` on day 2 (the done, unverified day), called at 1792564800000 (after day 1 was released,
  so day 2 was the frontier) with its notice ending at 1792651200000, before day 2 was released; the ask is closed for
  `"cooldown"` with `opensAtDay` 9 (2 + N 7), and `meteor.place` is `commons/seed-1/meteor-2`'s place on 512 x 512,
  (337, 440); `meteor-1` is at (497, 403). The contract test checks this timeline.
- **The end-to-end test**: `e2e/seed-1/meteor-1` is (89, 16) on `spots`, `meteor-2` (108, 58). The meteor is called right
  after A runs day 1 and the keeper drops L3, so day 2 carries the meteor alone and its log holds exactly one line.

## Amendment 2026-10-18 (review): the readings paragraph and the page

Four read-only reviews (three lenses and Codex Sol 6.1) checked the page's words against
`docs/garden-stone-horizon-2026-10-18.md`. Section 7's words above are the corrected ones; what changed and why:

- **"Founded as this one was"** was never checked: any big-storm garden got it. The page now names the founding the runs
  used (the commons' centre feed) and compares it with the view's `founding`, saying "as this garden was too" or "not
  as this garden was". The readings still show on a big storm founded otherwise, since the preset and radius are the
  ones measured; the words say how it differs. The checkpoints (steps 131,072 to 393,216) are named, since a meteor late
  in a garden's life is further from anything measured.
- **The placement.** Each horizon stone was put on a living cell ("a stone on bare ground leaves nothing to see"); a
  meteor's place is a hash that ignores what lives there. The paragraph says so, and "what it is" says the disc may hold
  many bodies, few or none.
- **"Rather than ordinary drift"** overstated the rule: a "stone effect" says only that the stone's horizon is much longer
  than a one-cell change's, which the size of the change alone could explain (horizon note, section N6). It is replaced by
  that. **"In the same places"** was wrong: the kick was at a separately chosen stale cell (N3). **"Local difference"**
  is now the summed excess of near over far difference (N5's gap area), with the day-1 checkpoint named. **"On some
  later days"** is now the source's numbers: five of nine pairs at least half, and at step 262,144 the nudge outlasted
  the stone in all three histories.
- **The share of a day** is "under 1% of a day" below half a percent, not rounded up to 1%.
- **The word "meteor"** stays the letter's name; the section's first words now say it promises no lasting change.
- **The state line** names both when a food and a meteor hold one day, with the later notice end (the island hold is the
  later of the two); a view that says `open` without a `landing` is said as closed ("The meteor ask is closed just now."),
  and food's words do the same.
- **Tests added**: a called meteor keeps the radius copied at founding when config changes later (Queue); the place on a
  256 x 128 world (width takes x); the fixture's meteor places are the rule's (contract); founding with meteor keys over
  HTTP; the vitest's preset list reads `test.exs` too and refuses an empty list.

## Amendment 2026-10-18 (merge): the merged order

Written when this slice was merged with the sun letter (PR #62, docs/garden-sun-2026-10-18.md), which also adds a kind
to `Garden.schedule/1`. Neither feature is on a real garden yet, so no garden's schedule changes.

- **The merged order at one step** is stones (sort tag 0), then foods (1), then suns (2), then meteors (3), each by its
  own sequence number; the founding schedule comes first, as before. Steps sort before tags, so a meteor on a later step
  still comes after everything at earlier steps.
- **Both notes' orders hold.** The sun note's "stones, then foods, then suns" and this note's "stones, foods, meteors"
  are both subsequences of the merged order, and the tags were already chosen for this (the sun's 2, the meteor's 3),
  so neither side's code needed a new tag. A schedule without suns is the one this slice produced; a schedule without
  meteors is the one #62 produced; a schedule with neither is the one before both. Every existing schedule, and so
  every hash a test or fixture holds, is unchanged.
- **Why meteors last, after suns.** A sun sets the light from that step on and moves no matter; a meteor converts
  matter in place and books its heat, as any lesion does. Neither entry's effect depends on the other's; the order
  fixes only the log's line order, which the stitch check compares. Putting meteors last is the additive choice the
  section above already made.
- **Where it is said.** `Garden.schedule/1`'s doc, the coordinator README ("The order at one step" under the garden
  rules, and the `meteor` row of the view table), and a Garden test that posts the four kinds in reverse order at one
  step and reads `lesion, feed, sun, lesion (r 64)`.
