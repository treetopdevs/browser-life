# Garden food: rules written before the code (2026-10-18)

Slice 18 of the backlog run builds food as a rare, collective act in a garden. The shared garden
brainstorm (`docs/shared-garden-brainstorm-2026-10-09.md`) says stones are daily, the sun is the
scarcity dial, and food is the founding ritual and after that "rare and collective, or absent"; the
user's sighting behind it is that the dangerous letter is food, not stones. Today a garden takes only
stones (contract `garden-v1`, `apps/coordinator/README.md`). This note fixes the rule, the bounds and
the limits before any code. A change to anything below is a dated amendment at the end, never a silent
edit.

It adds no physics, no rule change and no golden pin: a food is the existing `feed` intervention
(`packages/schema/src/feed.ts`), scheduled the way stones are, and islands already apply feeds inside
segments (the commons' founding feed is one).

## 0. What this does not decide

The brainstorm's decision 6 ("No food after founding. The first garden is closed in matter from its
founding on. A feast by vote is a later garden's question") stands. Food is **off** unless a keeper
founds a garden with it on (`"food": true`). A garden founded without it, including any existing
commons, behaves exactly as today, its record and its schedule unchanged. Turning food on for the
commons is the user's decision, not this slice's.

## 1. The ask

- **A hand.** A visitor adds a hand to the garden's food ask: `POST /api/public/garden/food/hands`
  (and `/api/public/gardens/:name/food/hands`), body exactly `{}`. A hand carries nothing: no place,
  no name, no text.
- **One hand per network per dawn period.** Hands are counted per network the way the letter budget
  counts letters (`Coordinator.LetterLimiter`: an IPv4 address whole, an IPv6 address as its /64, an
  IPv4-mapped address as its IPv4 address), salted with the limiter's boot salt and hashed. The second
  hand from the same network in the same dawn period is not counted (answered 200 with
  `counted: false`, never an error, so a visitor who reloads learns their hand is in).
- **The period is the garden's own dawn grid** (`dawnOffsetMs + n * dawnPeriodMs`): the hands of
  period *n* are the hands added at times in `[dawn n, dawn n+1)`.
- **The threshold K** (`foodAsks`). The hand that brings the period's count to K *calls* the food at
  once (not at the next dawn): the food is written to the garden then, public as `"waiting"`, with the
  day that carries it and the step it lands at, and the period's count goes back to zero.
  The networks that already gave a hand this period stay remembered until the dawn, so if the keeper
  drops the food the same period needs K *other* networks to call another: one hand per network per
  period holds across a call.
- **Expiry.** Hands that do not reach K by the next dawn expire at it: the count shown is the current
  period's only, and the first hand after a dawn starts from zero.
- **Why at once and not at dawn.** It needs no settlement process and no timer: the call is one pure
  function inside the hand's own Queue call, so the visitor who completes the ask sees the food's day
  and step in their answer, and the frontier rule (below) applies to it exactly as to a stone.

## 2. Where and when it lands

- **When: the next free day.** A called food is carried by the *landing day*: the frontier day
  (`Garden.frontier_day/2`, the first day that holds no attempt), and lands at that day's end step
  `(d + 1) * D`, like a stone. Asks are **open** only when the frontier day may carry a food (rules
  below), so the landing day shown while the ask is open is the day the food will take.
- **One food per N days** (`foodEveryDays`). A day *d* may carry a food only if every live (not
  dropped) food's day *f* satisfies `|d - f| >= N`. Measured in garden days, not calendar days,
  because what the brainstorm fears is food density in the world's own time; since at most one day is
  released per dawn, N garden days are also at least N dawn periods. A day carries at most one food.
  While a food is waiting its day is at or beyond the frontier, so asks are closed until the frontier
  reaches that day plus N: at most one food is ever waiting.
- **Frontier retreat.** An upstream reject that reopens a day reopens its food as it reopens its
  stones (status back to `"waiting"`, droppable). The spacing rule is checked against every live food
  whatever its status, so a retreat never lets a second food in closer than N.
- **Where: a fixed place, the world's centre** `(width div 2, height div 2)`, not the median of asked
  places. Why: the ask is then a yes or no to one act, and "where it would land" is a constant the
  page shows before anyone asks; nothing about a hand beyond its count is kept; a median is steered by
  whoever holds the most networks, which makes placement a second contest on top of the threshold;
  and on the storm the sun wanders across the whole jar, so no fixed place is privileged for long. The
  commons' founding feed is centred there too.
- **Order at a step.** A food lands at the same end step as that day's stones. The schedule lists,
  per step, the stones by their sequence number and then the foods by theirs. Each garden's schedule
  without food is unchanged by this.
- **The schedule entry** is exactly `{"step", "kind": "feed", "x", "y", "r", "amount"}`, no `matter`
  (the runner logs the matter it moved, and a replay must reproduce it).

## 3. The amount, and why it can never pass MATTER_MAX

The runner refuses a feed that would take the world past `MATTER_MAX` (2^26 = 67,108,864 quanta of
total world matter), and a refused scheduled feed fails the day, which would stop a garden for a
reason no keeper can requeue away (the day's slice is frozen). So the coordinator refuses to found a
garden with food unless the worst case over its whole horizon fits.

- **The food:** `amount` 16 quanta per cell (config `garden_food_amount`, allowed 1..64) over a disc
  of radius `r` 32 (config `garden_food_radius`, allowed 1..32, which is within every garden preset's
  lesion radius limit, so the logged radius equals the scheduled one). The r 32 disc is 3,209 cells,
  so one food adds 51,344 quanta: half a start nutrient (32 per cell) over about 1.2% of the big
  jar, and about 0.6% of the jar's start nutrient. A snack in one place, not a feast.
- **The coordinator's bound** (at founding, with integers, upper bounds only):

      cells * 128                                   start matter allowance
      + sum over founding feeds with amount > 0 of  amount * min((2r+1)^2, cells)
      + ceil(days / N) * amount_food * min((2 r_food + 1)^2, cells)
      <= MATTER_MAX

  Lesions conserve matter, drains only remove it, and food is the only other source, so the world's
  matter at any step is at most this sum. `ceil(days / N)` is the most foods a horizon can carry at
  spacing N. `(2r+1)^2` bounds any disc's cell count.
- **The start allowance, 128 per cell,** is an assumption about the garden presets, so a test checks
  it: every preset in config's `garden_presets` (prod and dev lists) starts with total matter at most
  `cells * 128`, and with a lesion radius limit of at least 32 (vitest, `apps/lab/test/garden.test.ts`,
  reading `config.exs` and `dev.exs` as `packages/runner/test/coordinator-presets.test.ts` does). Both
  start at nutrient 32 everywhere plus biomass 64 on founder cells, at most 96 per cell.
- **The numbers.** The commons (`wild-storm-large`, 512 x 512 = 262,144 cells, founding feed r 255
  amount 16, 365 days): 33,554,432 + 4,177,936 + ceil(365/7) 53 * 67,600 = 3,582,800, total
  41,315,168, 62% of MATTER_MAX (the real worst case, at 96 per cell and exact discs, is about 31.2 million, 46%).
  Even at N = 1 the food term is 24,674,000 and the total 62,406,368 still fits. On `spots` (65,536
  cells) the start allowance is 8,388,608; with the contract test's founding feed (r 50, amount 16)
  even N = 1 fits any horizon up to 866 days.
- A founding that fails the bound is a 422 that says so, with the numbers.

## 4. Anti-stuffing and per-address limits

- **K distinct networks** in one dawn period, defaults K = 5 (`garden_food_asks`). A keeper may set
  `foodAsks` per garden at founding in 2..1000 (never 1: one person is not a collective); dev and the
  end-to-end test found with 2.
- **N** defaults to 7 (`garden_food_every_days`); `foodEveryDays` per garden in 1..365.
- K, N, amount, radius and place are copied into the garden's record at founding, so a later config
  change never changes a live garden's public rule.
- **A hand costs one letter** of the network's hourly letter budget (`lettersPerAddressPerHour`, 3 by
  default): hands and stones share it, so a network cannot hammer the ask route. A hand that is not
  counted (a repeat) or refused (asks closed: 409) is given back and charged as a refusal, exactly as a
  refused stone is (`garden_refusals_per_address`).
- **Worst case.** Someone holding K networks (K /64s, or K IPv4 addresses) can call one food per N
  days, each a fixed snack at the centre, public for a whole day before it lands. The keeper's veto
  covers it: `POST /api/gardens/:name/letters/food-<n>/drop` drops a food whose day has never been
  assigned, as for stones; a dropped food counts toward nothing, so the ask can open again.
- **Log size.** Live foods count toward `logMax` (founding plus live letters plus live foods).

## 5. Privacy

- The Queue keeps, per garden, the current period's hands as a set of salted hashes **in memory
  only**: never written to `state.bin` (dropped before every persist), never logged, never in the
  view (only their count is). The salt is the limiter's boot salt; each hash is tagged with the
  limiter's incarnation, and hands of another incarnation are discarded, so a limiter restart cannot
  count one network twice.
- Consequence, stated on the page: a coordinator restart forgets the period's hands. It fails toward
  no food, never toward food. A food already called is in the garden's record and survives.
- The hashes held per garden are bounded by the distinct networks that gave a hand this period, which
  the limiter's table cap (`garden_letter_table_max`) bounds; all are forgotten at the dawn.

## 6. The contract stays `garden-v1`

The README's rule is "a change that removes or retypes a key bumps it; added keys do not". Food adds
keys only, and keeps out of every existing list: a food is never in `letters.waiting`,
`letters.recent` or `days[].letters`, and no letter has a new `kind`. Added:

- `food` (always present), an object:
  `enabled` (bool); `asks` (K), `everyDays` (N), `amount`, `r`, `place` `{x, y}` (each `null` when
  food is off); `hands` (this period's count, 0 when off); `expiresAt` (the next dawn, when this
  period's hands expire); `open` (a hand can be added now); `closed` (`null` when open, else one of
  `"off"`, `"stopped"`, `"finished"`, `"horizon"` (no day left before it), `"log-full"`,
  `"cooldown"`); `opensAtDay` (with `"cooldown"`, the first day a food could land, else `null`);
  `landing` (`{day, step}` where a food called now would land, `null` when closed); `foods` (the
  newest 32 foods, newest first, live and dropped).
- a food: `id` (`"food-<n>"`), `x`, `y`, `r`, `amount`, `calledAt`, `hands` (K when called),
  `landsAtStep`, `day`, `status` (the letter statuses: `"waiting"`, `"sealed"`, `"landed"`,
  `"verified"`, `"dropped"`, `"stalled"`), `landedIn`, `droppedAt`.
- `days[].food`: the id of the live food the day carries, or `null`.
- The founding body gains `food` (bool, default false), `foodAsks` and `foodEveryDays` (only with
  `food: true`).

The fixture `priv/static/garden-contract.example.json` gains a food that has landed and an ask in
progress, and `garden_contract_test.exs` drives a garden into that state; the page reads a view with
or without `food` (a coordinator from before is a garden with food off).

## 7. The page

Under the stones: the food ask, shown only when `food.enabled`. The count and the threshold ("2 of 5
networks have asked today"), the time left until the hands expire, where and when the food would land,
and an "Add my hand" button with the stones' status handling (201, 200 already in, 409 with the reason
in words, 422, 429 with the wait, 413/415, 404, 503, no answer). When closed the button is disabled and
the reason is in words (cooldown: "the next food can land on day N at the earliest"). Plain words on
why food is rare: food is the one thing that adds matter to this closed world; a garden fed at will gets
fat and dull, and hunger is what makes it build; so food comes only when many people ask on the same
day, at most once every N days, as one modest feed at the centre. A called food appears with its day,
landing step and status like a stone.

## 8. Pass criteria (each a named test)

- ExUnit, pure (`garden_test.exs`): K distinct hands call a food on the frontier day at `(d+1) * D`,
  centre, record r and amount; a repeat hand is not counted; hands expire at dawn (K - 1 hands, the
  clock past the next dawn, one hand: count 1, no food); a hand of a new limiter incarnation resets the
  count; one food per N days (closed `"cooldown"` with `opensAtDay = f + N`, open again when the
  frontier reaches it, and `|d - f| >= N` after a frontier retreat); closed `"off"`, `"stopped"`,
  `"finished"`, `"horizon"`, `"log-full"`; the schedule entry's exact shape and its order after stones
  at one step; a dropped food reopens the ask, yet a network that gave a hand before the call is still a
  repeat, and a food whose day is assigned is not droppable; a garden
  founded without food has no food keys in its record and an unchanged schedule; the view's `food`
  block in each state (off, open with hands, called and waiting, cooldown, landed with `landedIn`).
- ExUnit, Queue (`garden_queue_test.exs`): founding keys and their ranges (422s), the matter bound
  (a founding that fails it is a 422 naming the numbers; the commons' founding passes); `state.bin`
  never holds hands; a Queue restart zeroes the count and keeps a called food.
- ExUnit, HTTP (`garden_api_test.exs`): the hands route's codes (201 counted and calling, 200 repeat,
  409 per closed reason, 422 for any body but `{}`, 404, 413, 415, 429); two networks are distinct
  by `remote_ip` and, with `trust_forwarded_for`, by `X-Forwarded-For`; a hand spends a letter of the
  shared budget and a repeat or refusal is charged as a refusal; the view after a hand shows the new
  count (cache invalidated); the keeper drops `food-<n>`.
- ExUnit, limiter (`letter_limiter_test.exs`): a hand key is the same across one /64, differs across
  networks, and changes incarnation after a limiter restart.
- ExUnit, contract (`garden_contract_test.exs`): the real view of the driven state and the fixture
  have the same keys; the new nullable paths and the `closed` and food `status` enumerations are
  checked.
- vitest (`apps/lab/test/garden.test.ts`): the fixture parses with food; a view without `food` parses
  as food off; a malformed `food` is refused with its path; the ask's words in each state; the hand's
  answer per status; the start-matter allowance and lesion radius of every garden preset.
- Playwright (`tests/e2e/public-garden.spec.ts`, mocked contract): the ask shows count, threshold,
  time left and landing at 1280 and 375; each answer in words; a closed ask shows its reason and a
  disabled button; a view without `food` shows no ask.
- Deno (`tests/deno/garden_e2e.ts`, extended): the coordinator trusts `X-Forwarded-For`
  (`BL_TRUST_FORWARDED_FOR=1`, set after the `BL_*` scrub); the garden is founded with food, K 2,
  N 1; right after L2, a hand from `10.0.0.1`, its repeat (200, not counted) and a hand from
  `10.0.0.2` call a food on L2's day at L2's step (retried whole, up to three times, if a one-second
  dawn falls between them); a third hand is a 409 `"cooldown"`; the day is run and replayed and
  verified; the food's day's `interventions.jsonl` holds the stone then the feed with `r` 32 and
  `matter` exactly 51,344 (the r 32 disc is 3,209 cells on `spots`, times 16); after the
  restart the food is still there and the count is 0; the stitched schedule is the founding plus the
  verified letters plus the food, and equals the unsegmented `tools/run.ts` run byte for byte.

## 9. Known limits

- Hands are per network, not per person: K people behind one NAT are one hand, and one person with K
  networks is K hands (section 4 bounds what that buys).
- A restart forgets the period's hands (section 5).
- A garden founded with food writes new atoms (`:food`, `:foods`, ...) into `state.bin`; a coordinator
  from before this change refuses to load that file (`[:safe]` decoding), as a pre-garden coordinator
  refuses a garden. Gardens without food are unaffected.
- The fixed centre is not a choice visitors make. A median or a vote on places is a later question.

## Amendment 2026-10-18: what the build settled

Written after the code, for what the sections above left open or the build found. Nothing above changes
except where this says so.

- **A hand must be sent as JSON** (`content-type: application/json`, body `{}`); without a content type
  it is a 415, like a form or text (which `LetterBodyLimit` already refuses). Section 1 said "body exactly
  `{}`" only. Why: a POST with no body and no content type is a "simple" cross-site request, so any other
  page could make each of its visitors' browsers add a hand from that visitor's own network, which is
  K distinct networks for free. The JSON content type forces a CORS preflight, which the coordinator
  refuses for origins it does not list.
- **Answers.** 201 `{counted: true, called: null | <food>, food: <block>}`; 200 `{counted: false, called:
  null, food: <block>}`; 409 `{error, closed: <code>, opensAtDay}`; 503 (with `Retry-After: 1`) when the
  limiter has no salt to key the hand (it is restarting): the letter is given back and nothing is counted.
  The keeper's drop route answers `{"food": <food>}` for `food-<n>` (`{"letter": ...}` as before for a stone).
- **A cooldown that would open past the horizon is `"horizon"`**, never `"cooldown"` with an
  `opensAtDay` no day reaches.
- **The start allowance, measured**: both garden presets start at about 34.6 quanta per cell
  (`wild-storm-large` 9,066,037 over 262,144 cells; `spots` 2,266,364 over 65,536), well under 128. The
  vitest that holds this also checks the coordinator's `@matter_max` literal equals `MATTER_MAX` and that
  every garden preset's `maxLesionRadius` is at least the food radius.
- **Persistence.** A hand that only counts is not written to `state.bin` at all (counts are never
  persisted); a hand that calls a food persists the garden like a letter does.
- **The fixture** shows `everyDays` 2 (not the default 7) so it can hold a verified food on day 1 and an
  open ask for day 3 at once.
- **The page** keeps "my hand is in" in memory only, until the dawn the hand belongs to (the button is
  disabled meanwhile, so a reload is the only way to spend a refusal on a repeat). A `.garden-row[hidden]`
  rule was needed: `display: grid` otherwise shows a hidden row.
- **The end-to-end test** starts each try of its three hands just past a one-second dawn and uses fresh
  networks per try (at most three). If a dawn still falls inside a try, a food called by any of the three
  is taken as the call and the repeat's 200 is noted as not exercised there; ExUnit holds that rule on a
  clock it moves.

## Amendment 2026-10-18: after the read-only review (Codex Sol 6.1 High)

Six points from the review before any commit, all taken:

- **A waiting food closes the ask even after a big retreat.** Section 2 said "at most one food is ever
  waiting", but the spacing rule alone did not hold that: with N 7, a food waiting on day 10 and the
  frontier reset back to day 1, `|1 - 10| >= 7` would have let a second food in on day 1. Now the search
  for a day starts N days past every live food at or beyond the frontier (closed `"cooldown"`, opening
  then). The spacing rule is unchanged.
- **One network cannot count twice across a limiter restart.** The hand's salt and incarnation are read
  from one table instance (a restart between the two reads is an error, a 503), and the Queue refuses a
  key whose incarnation is not the limiter's current one (`{:error, :stale}`, a 503 with the letter given
  back), so a hand that waited in the Queue's mailbox across a restart is not counted under a salt that
  is gone.
- **Hands are forgotten at the dawn, not only at the next hand.** A sweep in the Queue (every
  `garden_hands_sweep_ms`, a minute by default) drops every garden's hands of a past dawn period or
  another incarnation.
- **No status or crash report shows a hash.** The Queue's `format_status/1` replaces each garden's hands
  by their count and redacts a hand's key in the last message; the debug log is dropped.
- **The page remembers the hand's own period**: a hand that crossed a dawn on its way is "in" until the
  answer's `food.expiresAt`, not the earlier reading's.

## Amendment 2026-10-18: after the second review (three lenses and Codex Sol 6.1 xhigh)

Written before the fixes. Where this contradicts a section above, this wins.

- **The veto window is a whole dawn period, enforced.** Section 4 said a called food is "public for a whole
  day before it lands", but the landing day is the frontier day, which may already be released and idle: an
  island could take it seconds after the call, and the keeper's drop would then be a 409. Now every food
  carries `notice_until = called_at + dawnPeriodMs` (persisted with it), and the Queue does not hand the
  food's day to an island to run before that time. The landing rule is unchanged (still the frontier day,
  shown before anyone asks); what changes is that the day waits. The view shows it as the food's
  `noticeUntil` (an added key). A reject that reopens a food's day does not restart the notice: the food was
  already public for a whole period, and the keeper's drop works again on the reopened day until it is
  assigned. The cost: a garden whose frontier day was ready when a food was called runs that day up to one
  dawn period later, once every N days at most.
- **A repeat is answered before the ask's state.** A network that already gave a hand this period gets 200
  `counted: false` even when the ask has closed since (the K-th hand called a food, or a cooldown began), not
  a 409 charged as a refusal. A network new to the period still gets the 409.
- **Hands are keyed on the IPv6 /48, not the /64.** Section 1 keyed a hand on the letter budget's network
  (an IPv6 /64). A /48 tunnel or a cloud block holds 65,536 /64s, so one person could be K networks with
  one script. A hand is now keyed on the IPv6 /48 (an IPv4 address whole, an IPv4-mapped address as its
  IPv4 address, as before); the letter budget still counts by /64. This fails toward no food: several
  households inside one provider /48 count as one hand. It does not make "networks" people: one person
  with several /48s or several IPv4 addresses is still several hands, and the page says so.
- **Until the proxy passes visitors' own addresses, every visitor is one address (D-17, D-24).** In
  production today every visitor reaches the coordinator as the proxy's address (deploy/README.md), so the
  ask can hold one hand at most, K >= 2 is never reached, an "already in" answer may be another visitor's
  hand, and each click draws on the one budget that stones share (a counted hand spends a letter; a repeat
  is given its letter back and charged as a refusal, section 4). The food block gains
  `sharedAddress` (an added key; config `garden_shared_address`, true in `config/prod.exs`, false when
  `BL_TRUST_FORWARDED_FOR=1` is set, which the deploy README's fix sets together with the Caddy change),
  and while it is true the page says this in plain words beside the button. The button stays: the server
  rule is the same either way, and a dev or a fixed host needs it. Not done: letting a repeat go
  uncharged (section 4 gives its letter back but charges it as a refusal, as a refused stone is, on purpose,
  so the route cannot be hammered for free).
- **The page's tab latch is cleared when the hand is forgotten.** "My hand is in" now belongs to one
  garden name and is cleared when the view's count is 0 and no food was called since the hand (a Queue or
  limiter restart forgot it), as well as at the hand's own dawn.
- **The page's words.** "unless 3 more networks ask", not the threshold again; "today" only for a garden
  whose dawn period is 24 hours, else "this dawn period"; a closed ask with a food waiting says so rather
  than "0 of 5 networks have asked"; and the line on why food is rare gives the keeper's guess that a
  garden fed at will grows fat and dull as a guess nobody has tested (section 7 stated it as a fact; the
  brainstorm calls it a hypothesis that a fed arm beside a hungry one would test).
- **A Queue call that does not answer** (a 5 s timeout or a crash while persisting) is caught in the
  controller: a 503 with `counted: null` (the hand may still count when the Queue catches up, so neither
  the letter is given back nor the page told "not counted"), logged without the hand's key. The limiter's
  restart 503 says `counted: false`.
- **A zero-byte JSON body** (`content-length: 0`) is a 422 like any body but `{}`. A chunked empty body
  cannot be told from `{}` after the parser and stays accepted; it carries nothing either way.
- **The page's state line during the hold.** The coordinator's `state` stays `"waiting-for-island"` (and may
  read as asleep) while a food's day is held; the page says "Holding: day d carries the food ..., so no island
  is given it before T" from the food's `noticeUntil`, instead of "no island has come for it".
- **Tests added for these** (section 8 gains them): Garden `food_hold?` (the window, its own day only, nothing
  once dropped); repeat before closed; hand expiry on an offset dawn grid; the 32-foods cap and order; Queue:
  a food's day idle until `noticeUntil` and then assigned with the feed, a reject that reopens a food's day
  (back to `"waiting"`, the ask still `"cooldown"`, the schedule still carrying it, droppable again), the
  pond-preset and config-range refusals; HTTP: the /48 hand, the zero-byte body, the CORS preflight on the
  hands route (listed origin echoed, other origins not), the Queue timeout 503 (`counted: null`, the log
  without the key), `sharedAddress`; release config: `garden_shared_address` in prod and its clearing by
  `BL_TRUST_FORWARDED_FOR=1`; vitest and Playwright: the words above, the latch, the held state line; the
  end-to-end test's repeat 200 is now a hard check (one network per try, so a dawn can only delay it).
- **Not changed:** the lesion radius limit of a custom `garden_presets` entry is not checked against
  `garden_food_radius` at founding (the coordinator does not load preset rules; the vitest pins every listed
  preset); the view cache may show a past period's count for up to `garden_cache_ms` (2 s) after a dawn,
  the same window every view field has.

## Amendment 2026-10-18: after the third review (Codex Sol 6.1 xhigh, second pass)

Where this contradicts a section above, this wins.

- **The tab's hand holds through its own answer.** The latch's "forgotten" rule (count 0, no food called since)
  is applied only to a view read after the hand was answered. The view the hand was sent from, or a poll already
  on its way, may count 0 because it was read before the hand counted; judged by it, a first hand was dropped at
  once and the button came back. The garden name and the hand's dawn still drop the latch on any view.
- **A food record without `notice_until`** (written before foods carried it) is held and shown with the rule's
  own value, one dawn period from its call, rather than not held at all.
- **The page reads a food block without `sharedAddress` or a food without `noticeUntil`** (keys added after the
  block was first written), as false and as one dawn period from the call; a present key of the wrong type is
  still refused.
- **Wording only:** the shared-address bullet above said a repeat "spends" a letter; it is given its letter back
  and charged as a refusal (section 4, the README and the HTTP test all say so, and the code does it).

## Amendment 2026-10-18: after the fourth review (Codex Sol 6.1 xhigh, third pass)

No rule changes; two consistency fixes.

- **The contract example's food keeps a timeline the scheduler can produce:** `food-1` is called after day 0 is
  done and its `noticeUntil` ends before day 1 is released, so its day was never run inside the notice. The
  contract test now checks every example food: `noticeUntil` is `calledAt` plus one dawn period, and a done day
  carrying a food is done after its notice.
- **Wording only:** the README's `food.sharedAddress` row and the page's shared-address note said every hand
  spends a letter; only a counted hand does (a repeat or a 409 gives its letter back and is charged as a refusal).
