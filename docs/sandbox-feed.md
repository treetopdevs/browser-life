# Sandbox: mid-run feeding as a logged intervention

Exploratory. jj workspace `feed` (`/Users/nicholas/develop/browser-life-feed`), bookmark
`sandbox/feed`, one WIP commit on top of `main` (03e5ff64). Not landed, not pushed. Asked for by
the user on 2026-10-03: "explore allowing mid-run feeding as a logged intervention".

## What it is

Two brushes in the lab beside Lesion: **Feed** adds dissolved nutrient A to every cell of a disc,
**Drain** removes it. Each use is one intervention, written to the run's log with the exact amount
it moved.

This is the one deliberate exception to "closed in matter". A lesion converts matter in place and
books the heat, so the world stays closed. A feed changes the total. So it is never a rule and
never a config key: it is something an experimenter does to a world, the world is closed between
feeds, and the lab says so wherever it shows conservation.

## Rule of the intervention

`packages/schema/src/feed.ts`. The disc is a lesion's: centre, radius clamped the same way,
wrapping inside the centre's tile. Feeding adds `amount` quanta (1 to 4096) to each cell. Draining
removes up to that many from each cell and stops at zero. Nothing else is touched: no bound
matter, no genome, no energy pool, no ledger total.

Refused, changing nothing: an amount of zero or out of range; a feed that would take total matter
past `MATTER_MAX`; any feed in a pond world, whose cycle fixes each pond's matter.

It returns what it did: the effective radius, the cells in the disc, the net quanta added
(negative for a drain), and the chemical energy that came with them (`matter * eA`, zero under
the default energies).

## Accounting

The energy ledger's identity is content + heat exported - light absorbed = baseline, and total
matter = start matter. A feed moves both baselines by exactly what it reports: matter by the
quanta added, the energy baseline by their chemical energy. After that the usual check is exact
again, and stays exact through later steps. The log alone accounts for all matter that entered or
left: start matter + the sum of the logged amounts = matter now.

In the lab the ledger panel gains a row, **Nutrient fed**, with the net amount and the number of
feeds, and its badge reads **exact, fed** instead of **exact** once a world has been fed. "Matter
change" stays the check against the moved baseline and reads 0.

## The log, checkpoints and jumping back

`Intervention` is now `lesion | feed`. A feed entry is `{ step, kind: "feed", x, y, r, amount,
matter }`: the step it was applied before, the disc, the amount asked per cell (negative to
drain) and the net quanta moved. With the state at that step, the first five determine the
result; `matter` is there for the accounting and as a check on a replay.

The log lives in the lab's run manifest, as lesions do. A checkpoint records how many
interventions it has seen, and restoring it restores exactly those.

**Jumping back replays the log.** The lineage panel's jump restores an earlier checkpoint and
advances to the requested step. It now re-applies every intervention logged after that checkpoint
and before the step, lesions and feeds alike, each at its own step. The world reached is the one
that was observed, physics and observer state. Before this, a jump across a lesion silently
showed a world that never existed.

The queue of interventions to re-apply belongs to the lab's execution module, inside the one
traversal that every advance uses. So a frame, a checkpoint's settlement to its census, an
automatic save and the replay-verification twin all stop at an intervention's step and apply it;
none can step past one. If a replayed feed moves a different amount than the log says, or the
world is found past a queued entry, the world is marked failed and goes no further until a
checkpoint is restored. A second jump made during a replay counts what the first had not yet
re-applied. A manual intervention during a replay forks the history, and only if it actually
happened: what was still queued is then dropped, with a notice.

**The total travels with the checkpoint.** The observer state inside a checkpoint artifact gains
an optional `fed: { matter, feeds }`. It is absent for a history that was never fed, so every
existing artifact and digest is unchanged. A fed world exported and imported elsewhere, with no
manifest, still shows the amount it was fed and the "exact, fed" badge. The entry-by-entry log
does not travel, only the total.

## How it runs on the GPU

`GpuSim.feed` reads the nutrient channel back, runs the reference function on it, and writes that
one channel back. No shader changed and no golden pin moved. It equals the reference by
construction, and because the ledger and the event buffer are not rewritten, a feed in the middle
of a census interval loses no mutation event. A dab costs one readback of 4 bytes per cell.

## Verified

- `packages/schema/test/feed.test.ts`: exact amounts; the disc equals a lesion's and stays in its
  tile; drain floors at zero; refusals change nothing; with `eA` above zero the ledger stays exact
  through four feeds and drains and 280 steps once the baselines move by what was reported.
- `tests/deno/feed_gpu.ts`, real GPU: same result and same state hash as the reference after
  every feed and after further steps, no mutation event lost across feeds, refusal past
  `MATTER_MAX`.
- `tests/e2e/lab-feed.spec.ts`, Chrome with WebGPU: the worker's feed equals the reference on the
  exported state; the stats carry the amount fed with matter change and residual at 0; a replay
  verification from a fed state passes; restoring a checkpoint restores its feeds; a refused feed
  reports why and the world steps on; a jump back across a feed, a lesion and a drain reaches the
  observed world, physics and observer; an imported fed file still reports its total. On the
  page: the brushes, the amount slider, the keyboard path, the notice, the ledger row and the
  badge.
- `apps/lab/test/execution.test.ts`: the feed total in the observer state through a checkpoint
  artifact and a restore, and its absence for a never-fed history.

## Codex review (Sol 6.1 High, 2026-10-03)

No arithmetic-bound failure. Its findings, all fixed: a jump back omitted intervening feeds (now
replayed, see above); export and import erased the fact of feeding (the total now travels in the
artifact); a stats readback begun before a feed could be judged against baselines from after it
and flash a false violation (the readback is now discarded when the accounting changed under it);
`GpuSim.feed` could report success across the sim's destruction (it rechecks after each await);
a non-finite radius fed nothing but would replay from its JSON as radius 0 (refused); two tests
were too weak (the GPU refusal test now compares the state hash across each refused call, and
the end-to-end test replays from a checkpoint taken before the feeds).

A second review, of those fixes, found the first version of the jump replay unsafe at its
edges: a save or automatic save during a replay could step past a queued intervention, a second
jump lost what was still queued, a failed replay did not stop the world, and a refused manual
feed dropped the queue. The replay was then moved out of the worker's frame loop into the
execution's traversal, which closes all four by construction, and the `fed` field in an imported
artifact is validated. `apps/lab/test/execution.test.ts` ("replaying logged interventions")
covers each case on the reference physics; the end-to-end test covers the double jump and the
refused feed in Chrome.

A third review, of that structure, found no P1. Its four P2s are fixed: a manual lesion or feed
now refuses a world already marked failed; a jump applies the entries logged at the restored step
before anything can probe the world; and two tests it showed to be too weak now stop short of the
queued entries before settling, and include a lesion made at a census step, which a mutation
check (applying interventions before the census) confirms they catch. These last fixes were not
re-reviewed.

## What this does not do, and what is open

- **An exported file carries the total, not the log.** Entry-by-entry replay needs the manifest,
  which stays in the browser's storage with the run.
- **Headless runs cannot feed.** `tools/run.ts` has no interventions. A scheduled regime (inflow
  and dilution every N steps, a chemostat) would be a rule with config keys and golden pins, a
  different thing from a logged intervention, and the more useful one for experiments. The
  runner does carry the `fed` total through if it continues a fed artifact.
- **Light and starting conditions** are not part of this. The lab's loader already accepts light
  overrides; a starting-nutrient override needs a small addition.
- **A dab costs a readback** of the nutrient channel. Fine for a brush; a compute pass would be
  the way if feeding ever had to be fast.
- Not decided: whether a fed run may count as evidence for anything that assumes a closed world.
  The badge and the artifact make the state visible; they do not settle the policy.
