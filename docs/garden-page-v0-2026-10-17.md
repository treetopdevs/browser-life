# The garden page v0: rules written before the code (2026-10-17)

Slice 5 of the backlog run: the shared garden's public page (`/garden/`), item 3 of §6.3 in
`docs/shared-garden-brainstorm-2026-10-09.md`. It reads the frozen `garden-v1` contract
(`apps/coordinator/README.md`, "The garden"; fixture `apps/coordinator/priv/static/garden-contract.example.json`)
and posts the one letter kind that exists, a stone. It is site work only: no physics, no
coordinator change, no golden pin, no new lever. It never draws the world, never calls a
number a result, and keeps nothing about a visitor on any server.

This note was written before any code for the page. The words below are the contract the page's
pure logic (`apps/lab/garden/garden.ts`) implements; a change to them is a dated amendment here.

## Where it lives, and who can find it

- `/garden/` is a hidden route: no canonical link, `noindex`, not in the sitemap, not in the
  header or footer, linked from no public page. The status and Join in pages keep calling the
  persistent garden "a future direction" until the commons is founded on the real coordinator
  and tended; then the page gains a canonical link, a sitemap entry and a nav link in one change, and the privacy
  page's "not open yet" section is reworded to match.
- The coordinator is reached the way the status page reaches it: relative `/api` (Caddy in
  production, Vite's proxy in dev). `?coordinator=<http(s) origin>` reads another coordinator
  directly (it must list this page's origin in `BL_CORS_ORIGINS`); the page then says which
  coordinator it is reading. `?garden=<name>` reads `/api/public/gardens/<name>`; without it,
  `/api/public/garden`. Anything else in those parameters is ignored with a line saying so.
- `?mock=1` shows the contract's fixture instead of a live garden, in the dev server only (the
  production build drops it), under a note: "The example garden from the contract, not a live
  one." Posting a letter in mock mode is refused in words; nothing is sent.

## Times

Every relative time (slept, until the next dawn, release due) is computed from the response's
`now`, never from the visitor's clock; `clock.sleptMs` is shown as given. Absolute times are
shown in the visitor's local time, and the dawn grid is stated once in UTC ("dawn is midnight
UTC"). Durations: under a minute, minutes, hours, then days and hours.

## The garden's state, in words

| `state` | Words |
| --- | --- |
| `growing` | Growing: an island is tending day *d* now. |
| `waiting-for-island`, `asleep` | Asleep: day *d* is ready and no island has come for it. It has slept *T*. |
| `waiting-for-island`, not asleep | Waiting for an island to take day *d*. |
| `resting` | Resting: today’s day is done; the next can open at dawn, *time*. |
| `stopped` | Stopped: day *d* did not replay the same (or could not run). Nothing after it runs until the keeper looks. |
| `finished` | Finished: every day to the horizon is done. |
| anything else | The word as given, marked "new to this page". |

*d* is the newest released day when growing or waiting, the first diverged or failed day when
stopped. A garden that has never moved says "It has not moved yet" instead of a sleep time.

## Verification, and who tends it

- A day verified by a different device type: **Verified elsewhere** (green; the one clean pass).
- A day verified by the same device type: **Replayed here, not yet verified elsewhere** (neutral).
- Done and not yet replayed: **Done, waiting for a replay** (grey).
- Growing: **Growing** (sun). Waiting: **Ready, no island yet** (grey).
- Diverged: **Replay disagreed** (red). Failed: **Could not run** (red). Blocked: **Blocked by
  an earlier day** (red).
- Every chip carries its words; colour is never the only signal.
- Who tends it: `tending.deviceTypesEver` of 1 reads "Kept by one computer so far" (decision 8 of
  the brainstorm), with the caveat that a device type is a kind of GPU, a lower bound on
  computers and never an identity; more reads "Tended by at least *n* kinds of computer". Two
  tabs on one computer are two islands, and the page says so beside the islands count.
- The census is "reported by the island that ran the day; the replay checks the state, not these
  numbers", and is marked unverified until its day is.
- The fork is offered only as the contract offers it: the newest checkpoint of the verified
  prefix, as a download link and its digest.

## Letters, in words

| `status` | Words |
| --- | --- |
| `waiting` | Waiting: public, and the keeper may still set it aside. |
| `sealed` | Sealed: its day has started; it will land. |
| `landed` | Landed at step *s*, not yet replayed. |
| `verified` | Landed at step *s* and replayed. |
| `dropped` | Set aside by the keeper. |
| `stalled` | Stalled: its day did not replay or could not run. |

Letters carry a place and a size and nothing else, so the page names no author. A letter this
device posted is marked "yours" from the device's own list.

## The letter form

- Today's letter is a stone: a wound at a place, radius `limits.stoneRadius` (1 to 32). The page
  checks what the server checks before sending: integers, `0 ≤ x < width`, `0 ≤ y < height`,
  `r` in range. The map beside the form is geometry (the world's square, the waiting stones and
  yours), not a picture of the world, and says so.
- Preview, from `letters.nextLanding` only: "Your stone would land at step *S*, the end of day
  *d*; *n* of the day's *perDay* places are left." When the day is not yet released, the
  earliest it can open follows the README's release rule (one day per dawn, and only when an
  island asks), so the page says "not before *time*, and only if an island tends it", never a
  promise. `nextLanding` null disables Send with the reason beside it ("The garden takes no
  letters now: …", from `state`, `queued`/`queueMax` and the log).
- A courtesy, not a rule (brainstorm §4): if this device posted since the last dawn, the form
  says the garden asks one letter per device per dawn; Send stays enabled.

| Answer | Words |
| --- | --- |
| 201 | Posted as *id*. It is public now, lands at step *s* (end of day *d*), and counts once a second island replays that day. |
| 422 | The garden refused the stone: *server's words*. |
| 409 | The garden takes no letters now: *server's words*. |
| 429 | That is the limit of *n* letters an hour from one network; try again in *T*. |
| 413, 415 | The page sent something the garden could not read. Reload the page and try again. |
| 404 | There is no garden by that name here. |
| 503 | The garden is busy; try again in a moment. |
| no answer | The garden could not be reached. Your stone was not sent. |
| anything else | The garden answered *code*; your stone was probably not sent. Reload to check the queue. |

After a 201 the page reads the garden again, so the new letter appears in the queue.

## Reading the garden

- 200 with `contract` `"garden-v1"` and every documented key of the documented type: shown. Added
  keys are ignored. A different contract, or a key missing or of the wrong type: "The garden
  answered in a shape this page does not know (*what*)", and nothing else is shown.
- 404: "No garden is planted here yet." 503: one retry after `Retry-After` (at most 5 s), then
  the busy line. No answer: "The garden could not be reached." The page reads again every 60
  seconds while visible, never with a request in flight.

## Since your last visit

The device keeps, under `cadence-garden-visit:<coordinator>:<garden>`, the tip step and the
coordinator time it was seen, and the ids of letters posted from it (at most 32). Nothing about
it is sent. It is written only after a good read. With no record: "First visit from this
device." Otherwise: days done and steps grown since (from `clock.step` and `pace.stepsPerDay`),
days newly verified, letters landed since (`landsAtStep` after the old tip, status landed or
verified), and "No change" when the tip has not moved. Storage that throws or is missing is
skipped silently, and the page works without it.

## Privacy

The privacy page gains a short section: letters are public and carry only a place and a size;
to keep the per-hour limit the coordinator holds a salted hash of the network address in memory
for at most the hour and never writes it down; the step last seen and the letters posted from
the device stay on the device.

## Amendment (2026-10-17, while building)

Details the rules above left open, settled in the code and its tests:

- The storage key's `<garden>` is the `name` in the response (`commons` for `/api/public/garden`), and its
  `<coordinator>` is the origin the page reads (this site's own for relative `/api`; `mock` in mock mode).
- With no usable storage, the "since your last visit" panel says one plain line ("Nothing to compare: this
  device keeps no record of earlier visits.") instead of staying empty; no error reaches the visitor.
- Stopped names the reason of the first bad day: "did not replay the same" for a diverged day, "could not run"
  for a failed one.
- A letter's chip reads Waiting, Sealed, Landed, Replayed, Set aside or Stalled beside the words in the table;
  a replayed letter is green only when its day was verified on a different kind of computer.
- A replayed-here day takes a neutral chip (`.state.note`, page CSS, the site's version of the lab's
  `.badge.note`).
- The founding schedule is said in the site's words: feeds and wounds at step 0, set by the keeper.

## Amendment 2 (2026-10-17, after review)

Four reviews (three lenses and Codex Sol) found words that promised more than the contract shows. These
replace the rows above where they differ:

- **Landing preview.** `pace.nextReleaseAt` null with a landing offered means the newest released day R is
  not done, so day R+1 is never "as soon as an island asks": it reads "Day *L* opens only after day *R* is
  done and a dawn has passed since it was released" (later days: "then one day a dawn"), with "not before
  *time*" only when that time is still ahead, and "only if an island tends it".
- **Sealed** reads "Sealed: fixed to day *d*, which an island has taken; it lands when that day is done."
  (README: sealed means assigned and fixed; a day can still fail or be run again.)
- **Replayed letters** say which replay in words, not only in colour: "Verified elsewhere" ("its day was
  verified elsewhere") or "Replayed here" ("its day was replayed here, not yet verified elsewhere").
- **Kinds of computer.** The adapter string an island reports names the browser as well as the GPU
  (`apps/lab/src/island.ts`), so two browsers on one computer are two kinds. The caveat says so ("neither a
  count of computers nor an identity") instead of "a lower bound on computers", and "verified elsewhere"
  lines add "a different browser or GPU, perhaps the same computer". The chip words stay (decision 8 and
  the README's wording).
- **The share** is computed from the counts and never reads 100% short of every day, nor 0% above none
  ("99%", "under 1%"). Diverged and failed days are said even before any day is done.
- **Answers.** The coordinator keeps a letter before it answers 201, so no answer (including none within the
  20-second deadline) and an unexpected code read "…so this page cannot tell whether your stone arrived. The
  queue below is read again: look for it there before sending another." and read the queue. 429 names the
  limit without saying the network sent that many (the limiter also answers 429 after too many refusals or
  while its table is full): "The garden is not taking letters from this network just now: it takes at most
  *n* letters an hour from one network, and fewer when many are refused. Try again in *T*."
- **Reading.** Every time in a response must be an integer a Date can hold, or the shape is refused; a
  render that throws falls back to the shape line. A missing `Retry-After` waits the default second. A
  failed reading after a good one keeps the numbers, dated ("The numbers below were read at *time*"); a 404
  hides them. Each request, body included, has a 20-second deadline. Reading and sending are separate: a
  background read never disables Send, and a 201 during a read queues one more read.
- **Since your last visit.** The record is `{createdAt, step, seenAt, daysVerified, mine}`: `createdAt`
  names the planting (a garden planted again under the same name says so, compares nothing and forgets
  "Yours"), and `daysVerified` is the aggregate count, since the day list holds only the newest 14. The
  record from before the page opened is the baseline for the whole visit; the comparison is recomputed on
  every reading, so a garden that moves while the tab is open is never "No change". Landed letters say "at
  least these" when the newest-32 list may hide older ones. Two tabs merge their letter ids. Storage that
  reads but will not write says there will be nothing to compare next time.
- **Other coordinators.** `?coordinator=` stays (the brief asks for it, and it only reads a bare http(s)
  origin), but its note is a visible banner: the numbers and the queue come from there, and a stone is sent
  there. `?mock=1` outside the dev server is named as ignored.
- **Not changed:** the shape still requires `x`, `y` and `r` on every letter and founding entry. The README
  bumps the contract when a key is removed, so a letter kind without them is a new contract; a letter of a
  kind other than stone that has them is shown generically, not as a stone.
- **Deployment prerequisite (no code here):** the per-network limit and the privacy page's line about it
  depend on the coordinator seeing the visitor's address, so production behind Caddy needs
  `:trust_forwarded_for` set (README, POST letters), or every visitor shares one address.

## Amendment 3 (2026-10-17, second review)

- **Which day the state names.** The state table's *d* ("the newest released day when growing or
  waiting") is replaced: *d* is the oldest listed day that is growing (or waiting, or diverged or failed
  when stopped), and only when the list can say so. `days` holds the newest 14, so a requeued early day
  rerun under a long garden is not in it. The page names a day only when the list starts at day 0 or every
  day older than the list is done or verified (`clock.daysDone` less the listed done and verified days
  equals the oldest listed day); otherwise it says "a day" ("Growing: an island is tending a day now").
- **"At least these."** The newest-32 list is ordered by posting, not by landing, so whenever it is full
  the landed letters read "at least these", and a full list with no landing shown says some may have
  landed unlisted.
- **"Yours" across tabs.** Letter ids are kept once each in posting order (`ltr-<n>`), and the cap of 32
  keeps the newest whichever tab wrote them. A stone confirmed while the page had lost its view (a failed
  read) is still recorded as this device's, for the planting it was sent to.
