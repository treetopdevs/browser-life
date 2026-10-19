# The stone horizon: rules written before the run (2026-10-18)

Slice 26 of the backlog run carries out the shared garden brainstorm's second test (§6.2 of
`docs/shared-garden-brainstorm-2026-10-09.md`): how long a stone stays legible in the big storm, which
is meant to set the garden's pace. Headless lesions exist (`tools/run.ts --lesion`, PR #16), and so do
forks from a checkpoint (`--start-from`/`--start-step`, PR #34). This note fixes the world, the
measure, the horizon rule, the grid, the GPU-time cap and what each reading means before any twin is
run. A change to anything below is a dated amendment at the end, never a silent edit. The readout is
appended after the run, whatever it says.

It adds no physics, no rule change, no golden pin and no garden config. A stone here is the runner's
scheduled lesion (`{"step","kind":"lesion","x","y","r"}`), the same entry a garden letter becomes.
This is a catalogue test, not an experiment: nothing here is registered evidence.

## 0. The prediction under test (copied from §6.2, written 2026-10-09)

The storm already wounds every cell about once per 13,000 steps with a radius-3 disc, so one wander is
about ten wounds per cell. A radius-3 or radius-8 stone is one more wound among them, and its horizon
should be under one wound period. If so, a visitor's stone is a meteor (radius 32 or more) or it is a
mark with a receipt and no lasting effect, and the sun is the letter that carries. The garden's day is
then the horizon, with a floor of one sun wander (131,072 steps), and until it is measured the day is
one wander (decision 5).

## 1. The world: the commons as founded

- **Preset `wild-storm-large`** (512 x 512, one tile, so the world is one torus), condition
  `treatment`, `censusEvery` 1,024 and `deepEvery` 10 (the garden's defaults, `apps/coordinator/README.md`).
- **Founding: the commons' own feed at step 0**, `{"step":0,"kind":"feed","x":256,"y":256,"r":255,"amount":16}`
  (README, "The commons"), through `tools/run.ts --feed 0:256,256,255,16`. Why not nutrient 48: the
  runner's `--override` takes `mutRate` and `pondDeath` only, so a uniform start nutrient of 48 is not
  available headless, and the commons is founded with this feed, which the README says "stands in for the
  start nutrient §6.1 found missing". The §6.1 nutrient-48 checkpoints in `runs/garden-storm/` do fork
  (checked 2026-10-18: their config equals `wild-storm-large`'s, the 250,000 checkpoints of seeds 1 and
  3 hash to their entries and `continuationError` passes), but only seeds 1 and 3 survive, seed 2's
  manifest lists no checkpoint, and neither is the garden as founded. They are not used.
- **Seeds 1, 2 and 3** (the commons is seed 1).
- **Sources.** One `tools/run.ts` history per seed from step 0 with the feed above, checkpoints every
  131,072 steps, into a scratch directory outside the repo (never `runs/`):

      deno run -A tools/run.ts --experiment horizon-src --preset wild-storm-large --conditions treatment \
        --seeds <s> --steps <d * 131072> --census 1024 --deep 10 --checkpoint 131072 \
        --feed 0:256,256,255,16 --out <scratch>/src

- **The checkpoints are the ends of garden days 0, 1 and 2**: steps 131,072, 262,144 and 393,216 ("day
  1, 2, 3" below). A garden's stones land at a day's end step, so these are the first three moments a
  visitor's stone can land, and all three are past the first full wander, before which §6.1's arms died.
- **Extinction.** A seed whose source has no living cell (`B > 0` nowhere) at the day-1 checkpoint is
  replaced by the next seed (4, then 5; at most two replacements, recorded). A source alive at day 1 and
  extinct at a later checkpoint is not replaced: those groups are reported as `extinct source`. How many
  seeds of the commons are alive at each checkpoint is recorded as a side reading.

## 2. Twins and the stone

For each (seed, checkpoint step N) a **group** of twins is forked from the source's checkpoint at N:
decoded, its `stateHash` checked against the manifest entry, `continuationError` passed, as
`tools/run.ts --start-from` does. Every twin runs through `runExperiment` from `@bl/runner` (the code
path of `tools/run.ts`) with the source's observer, the same spec fields as the source (experiment
`horizon`), and `checkpointEvery` 1,024.

- **U0**, undisturbed: no schedule.
- **U1**, the control: a second undisturbed twin, run for the first 16 censuses only.
- **S8, S32, S64**: one stone each, `{"step": N + 1, "kind": "lesion", "x": cx, "y": cy, "r": R}` for R =
  8, 32, 64 (effective radius checked equal to R; the big jar's lesion limit is 255). The stone lands
  one step after the checkpoint because a fork owns only entries in (N, N + steps]; the garden's stone
  lands at the checkpoint step itself, after that step's census, so the twins differ from the garden by
  one step of physics without the stone.
- **The centre (cx, cy)** is the same for the three radii and the control: a living cell of the
  checkpoint state, drawn without looking at anything else. The living cells (`B > 0`) are taken in
  index order (index = y * 512 + x) and the one at position `fmix32((seed * 0x9E3779B1 + N) mod 2^32)
  mod living` is the centre, `fmix32` being MurmurHash3's 32-bit finaliser. Why a living cell and not a
  fixed place: a stone on bare ground leaves nothing to see, and a visitor aims at something alive. The
  living fraction inside the stone's disc and inside the near disc (below) at N is recorded per radius.

**The twins are deterministic.** The storm's wounds, the sun and every random draw are functions of
seed, step and cell, so U0 and U1 are identical bit for bit, and every difference between U0 and a
stone twin is caused by the stone. "Far" is therefore not fork drift: it is the stone's own disturbance
after it has spread beyond the near disc. The horizon is when the stone's neighbourhood is no more
changed than the rest of the jar, which is the brainstorm's "near is no larger than far".

## 3. The measure

At every census step t = N + k * 1,024 (k = 1, 2, ...) the twins' full states are read through the
runner's checkpoint write (intercepted in memory, never written to disk) and reduced, per cell i, to

- `label(i)` = `EMPTY` if `B(i) = 0`, else the lineage id (`LIN_HI(i)`, `LIN_LO(i)`), and
- `bp(i)` = `B(i) + P(i)`.

For a region R of cells, comparing twin X with U0 at the same step:

- `union(R)` = cells of R where `B > 0` in X or in U0;
- `diff(R)` = cells of R where `label` differs between X and U0;
- **the primary measure** `m(R) = diff(R) / union(R)`, and 0 when `union(R)` is 0.

Why union-normalised: a fraction over all cells stays high wherever life is dense, so it could read a
dense near disc as a lasting mark; over the union, density mostly cancels. It does not cancel fully:
two unrelated arrangements agree on `label` where one lineage holds the same cells in both, so the
ceiling `m` approaches depends on local lineage diversity (small where thousands of lineages live, as
in §6.1's nutrient-48 arm; large on a carpet). The secondaries exist partly for that. Two are recorded
with the same rule and decide nothing: `m_all(R)` = `diff(R) / cells(R)`, and the light-cone measure
`m_bp(R)` = cells where `label` or `bp` differs, over cells where `B + P > 0` in either twin, whose
ceiling is close to 1 whatever the diversity (exact quanta rarely agree by chance).

## 4. Near and far on the torus

The near region is the disc of radius 2R around (cx, cy): every cell whose wrapped offsets
`dx = ((x - cx + 768) mod 512) - 256` and the same for `dy` satisfy `dx^2 + dy^2 <= (2R)^2`. This is the
lesion's own disc test (`dx * dx + dy * dy <= r * r` through the torus neighbour) at twice the radius.
Far is every other cell. At R = 64 the near disc has radius 128 and is about a fifth of the jar; 4R is
always under 512, so the disc never meets itself across the torus.

## 5. The horizon rule

Let `near_k = m(near)` and `far_k = m(far)` at census k for a stone twin, compared exactly as integers
(`diff_near * union_far <= diff_far * union_near`, with an empty union counting as 0).

- **No mark**: at k = 1 both `diff_near` and `diff_far` are 0. The stone changed nothing a census could
  see; the pair has no horizon and is reported as such.
- **The horizon** is the first k in 1..128 such that `near_j <= far_j` for j = k, k + 1, k + 2 and k + 3
  (the census and the next three: one noisy census never decides). It is reported as the steps since
  the stone, `k * 1,024 - 1`.
- **Censored**: no such k up to 128 (that is, within 131,071 steps of the stone, one wander). Reported
  as `> 131,071`. A stone twin runs to k = 131 at most.
- **Extinct**: either twin has no living cell at some census before the horizon is decided. Reported
  with that step; not counted in any median. (The runner observes through extinction, so the censuses
  keep coming; the rule, not the runner, ends the pair.)
- **Stopping.** The comparison runs inside the twin's checkpoint write, census by census. When a stone
  twin's outcome is decided, its run is aborted through `RunOptions.signal` (the runner stops before
  its next census chunk, so at most one census later), the rejection is caught, and the census reached
  is recorded. U0 runs until every stone twin of its group has stopped.

## 6. The control and the cross-check

- **Control.** In every group, U1 against U0 at each of its 16 censuses must give `diff = 0` and
  light-cone differences 0 in the whole jar, and both final states must hash equal. Prediction: exactly
  zero. Anything else is a tooling or determinism fault, not drift: the group is void and the run stops.
- **Cross-check of the code path** (pilot, below): the pilot's S8 twin, run by `tools/horizon.ts` as
  two chunks of two censuses (so the hand-off of final state and observer between chunks is exercised),
  ends with the same `summary.finalHash` as one continuous `tools/run.ts --start-from <pilot source>
  --start-step 4096 --lesion 4097:cx,cy,8 --steps 4096 --census 1024 --deep 10 --checkpoint 0` from the
  same checkpoint. A mismatch stops the run.

## 7. Grid, order and the GPU-time cap

- **Grid**: 3 seeds x 3 checkpoints x radii 8, 32 and 64, nine groups of five twins.
- **Cadence**: twins run in lockstep chunks of 16 censuses (16,384 steps), each chunk a `runExperiment`
  call continuing the previous one's final state and observer (a segmented run equals a continuous one
  byte for byte). In a chunk U0 runs first and its 16 reduced censuses (3 MB each) are held in memory;
  then U1 (first chunk only) and each live stone twin run their chunk and are compared census by census.
  The GPU runs one twin at a time; nothing runs while another heavy GPU process of this slice runs.
- **Cap: 6 hours of wall time** for all of this slice's GPU work (pilot, sources, groups), counted from
  the start of the pilot. Before each GPU step `ps` is checked for other heavy deno or vite processes
  and `uptime` is recorded; other sessions' GPU use is not stopped, only noted.
- **Pilot (timing only).** A source of seed 1 for 8,192 steps with a checkpoint at 4,096; from it U0 and
  S8 for 4 censuses each, in two chunks of two; and the run.ts cross-check above. It prints wall time and steps
  per second per stage (source, twin chunk, reduction and comparison). No measure value is printed or
  written. Rates used below are the pilot's, times 0.75 (a full jar runs slower than an early one; §6.1
  saw 290 to 350 steps a second against 500 for its smoke run).
- **Worst cases**: a source to day d costs `3 * d * 131,072 / rate_src` seconds; a group costs at most
  `(4 * 131 + 16) * 1,024 / rate_twin` seconds (U0 and three censored stone twins, plus U1).
- **Scale-down rule, fixed now.** The sources go to the largest d in 3, 2, 1 for which
  `pilot + sources(d) + 3 * group_worst <= 6 h` (room for all of day 1 at its worst); if even d = 1 does
  not fit, the window drops from 128 to 64 censuses for every pair and d = 1. Groups then run in the
  order day 1 seeds 1, 2, 3; day 2 seeds 1, 2, 3; day 3 seeds 1, 2, 3, and a group starts only if its
  worst case fits in what is left of the cap. A group that is not started is recorded `not run (cap)`.
  If a running group reaches the cap, it stops at the end of its chunk and its undecided stone twins are
  recorded `stopped (cap)` with the last census reached. Whatever applies is recorded in the record.

## 8. What the readings mean

Per radius, the horizons of the valid pairs (not extinct, not void, not no-mark, not stopped by the
cap) are listed with their median; a censored pair sorts above every measured one. With n valid pairs
sorted ascending, the median is element `floor((n - 1) / 2)` (zero-based: the middle one for odd n, the
lower middle for even n), and a radius with no valid pair has no reading. "The median is censored"
means that element is censored.

- **The prediction at R = 8** *holds* if every valid R = 8 horizon is under 13,000 steps, *holds in the
  median* if the median is under 13,000 and some are not, and *fails* if the median is 13,000 or more.
- **R = 32 and R = 64**: a *meteor* if the median is censored (the stone is still legible a whole wander
  later, so it outlasts the provisional day); a *mark with no lasting effect* if the median is under
  131,071, with whether it is also under 13,000 said.
- **The garden's pace.** A visitor's stone is at most radius 32 (`limits.stoneRadius` 1..32), so R = 32
  is the largest letter and the pace reading keys on it; R = 64 is a keeper's meteor and only informs.
  If the R = 32 median is under one wander, the day stays one wander (decision 5's floor) and the
  brainstorm's branch applies: stones are too small to be letters that carry, and the sun is the first
  letter instead. If it is censored, a stone outlasts one wander, the day should be the horizon, and
  this window cannot say how long that is: the next test is a longer window on R = 32. This slice changes
  no garden setting either way; the pace is the user's to move.
- **Under the fallback window** (64 censuses, §7), censored means legible beyond 65,535 steps, half a
  wander: the meteor call and the pace question are then deferred, and only the R = 8 prediction and
  "mark" readings under 65,535 are called.
- **Limits.** One jar size, one founding, three seeds, three early checkpoints and one centre rule; a
  stone on bare ground was excluded by construction, so this says how long a stone on life stays
  legible, not a stone anywhere. The label measure reads identity and occupancy, not how a frame looks.

## 9. The record

`experiments/garden/stone-horizon-2026-10-18.json`, compact: the rules' version (this note's date), git
commit, `RULE_VERSION`, host and adapter, `uptime` at each stage, the pilot's rates, the cap and every
scale-down applied, each source's seed and final hash and its living cells at each checkpoint, and per
group: seed, N, centre, control result and both hashes, and per radius: effective radius, living
fractions, the outcome (horizon in steps, censored, no mark, extinct, not run or stopped), twins' final
hashes and steps reached, and the per-census `near` and `far` of the primary measure rounded to four
decimals. The full integer counts per census (all three measures) go to the scratch directory, not the
repo. The readings of §8 are computed from the record by the tool and appended below.

## Readout

*Revised 2026-10-18, after review (three review lenses and Codex Sol 6.1). The run, its outcomes and its medians are
unchanged. The record was rebuilt from the run's group files with integer counts. The verdicts below carry the saturation
caveat. The side readings are now computed by `tools/horizon.ts readout` instead of written by hand. The post-hoc
"plain for 5,000 to 20,000 steps" reading is withdrawn. The light-cone question is answered by arithmetic. The rule
changes are in the Amendments at the end. A second Codex pass withdrew the "far catching up" reading and corrected §3's
ceiling direction (Amendments, pass 2).*

The run went from 10:00:19Z (the pilot's start) to 13:47:57Z, 3 h 48 min of the 6 h cap. It ran on the local Apple M1 Max
(deno 2.9.7), one twin at a time, on a shared and very loaded machine. The 1-minute load averages were 130 and 158 in the
pilot, 125 to 557 at the nine group starts, and 15 at the run's end. `uptime` at each stage is in the record.

The record is `experiments/garden/stone-horizon-2026-10-18.json`. It carries, per census, the integer counts the horizon
rule compares (`nearDiff`, `nearUnion`, `farDiff`, `farUnion`, and the living cells of both twins).
`tools/horizon.ts readout` recomputes every outcome and the readout from those counts and fails if they differ from what the
record stores. The secondary measures' counts are still only in the scratch group files.

**Provenance.** The record's `commit` is the slice's base (`ba2741e`). This note and the tools were untracked when the run
ran, so git alone cannot show that §1 to §9 were written before the run. The rebuilt record's `rebuilt.digests` hash the
files as they are after review, not as they were before the run.

**How it ran against §1-§7.**

- **Pilot and cap.** The source ran at 466 steps a second and a twin at 360 (each times 0.75 in the plan), so a group's worst
  case was 2,050 s. The rule chose depth 3 and the full 128-census window, so there was no scale-down. Nothing was skipped
  or stopped by the cap.
- **Cross-check.** The pilot's S8, run by `tools/horizon.ts` as two chunks of two censuses, ended on finalHash
  `92b973bc4ff08e9a`. One continuous `tools/run.ts --start-from` fork with the same stone ended on the same hash. Both
  apply the stone through the same runner, so this checks the chunk hand-off, not the intervention machinery (see the
  Amendments).
- **Sources.** Seed 2 had no living cell at 131,072, 262,144 or 393,216. Its source log says "extinct at step 31744" and
  shows no individuals from step 40,960 on. As §1 says, seed 4 replaced it. Seed 2 is now in the record's `sources` with
  `replaced: true` and its living cells (0, 0, 0). Seed 4's extra source run took about 23 minutes. That time was not in the
  pilot's budget and came out of the cap. So two of the first three seeds of the commons as founded are alive at day 1.

  Living cells (of 262,144) at the three checkpoints:

  | Seed | Day 1 | Day 2 | Day 3 |
  |---|---|---|---|
  | 1 | 151,425 | 170,356 | 198,758 |
  | 2 (replaced) | 0 | 0 | 0 |
  | 3 | 125,639 | 214,118 | 195,224 |
  | 4 | 253,831 | 255,413 | 260,123 |

  Seed 4 is a carpet: 97 to 99% of the jar is living at the checkpoints, and its source log counts 311 to 398 lineages over its last three
  log lines. The lineage counts are in the scratch log, not in the record. So one of the three seeds measured is a carpet,
  and §3 says the measure's ceiling differs there.
- **Controls.** In all nine groups, U1 against U0 gave exactly zero over 16 censuses, by label and by light cone, and the
  final hashes were equal. No group was void.
- **Pairs.** All 27 pairs are valid: none extinct, none with no mark, none stopped by the cap. Every effective radius equals
  R. That was recorded but not enforced during this run; it is enforced now.
- **Conservation.** Every completed segment (every U0 and U1 chunk, and every stone chunk that ran to its end) passed the
  runner's conservation check. Each of the 27 stone twins was stopped by its decision in its last chunk, and the tool did not
  read that chunk's census lines. So the up to 16 censuses of each stone twin's deciding chunk were not
  conservation-checked. They are now (Amendments).
- **Stop path.** The pilot's stop-path check (a stone twin decided at census 1 stops there, then the device runs a normal
  segment) was added after the run, at about 15:10Z, inside the cap window. It passed once, on a fresh 8,192-step pilot
  source, in about 50 s of GPU time by the session's own account. Its output was printed only and that pilot's files and
  timings were not kept, so there is no receipt. The groups of the run had already used the stop path, all 27 stone twins included. The pilot now writes the
  check's result into `pilot.json` (`stopPath`).

**The readings (§8, recomputed by `tools/horizon.ts readout` from the record's integer counts).**

- **R = 8**: 9 valid: 3,071 (seed 1, N 131,072); 5,119 (seed 4, N 262,144); 8,191 (seed 3, N 262,144); 18,431 (seed 3, N 131,072); 97,279 (seed 1, N 393,216); >131,071 (seed 4, N 131,072); >131,071 (seed 1, N 262,144); >131,071 (seed 3, N 393,216); >131,071 (seed 4, N 393,216).
  R = 8: the prediction fails: the median is 97,279 steps, not under 13,000.
- **R = 32**: 9 valid: 3,071 (seed 4, N 262,144); 5,119 (seed 1, N 393,216); 14,335 (seed 3, N 262,144); 22,527 (seed 1, N 131,072); 26,623 (seed 1, N 262,144); 51,199 (seed 3, N 393,216); 67,583 (seed 4, N 393,216); 114,687 (seed 3, N 131,072); 120,831 (seed 4, N 131,072).
  R = 32: a mark with no lasting effect: median 26,623 steps, not under one wound period (13,000).
- **R = 64**: 9 valid: 2,047 (seed 4, N 262,144); 11,263 (seed 1, N 393,216); 18,431 (seed 3, N 262,144); 31,743 (seed 4, N 131,072); 35,839 (seed 1, N 262,144); 50,175 (seed 1, N 131,072); 63,487 (seed 3, N 131,072); 67,583 (seed 4, N 393,216); 68,607 (seed 3, N 393,216).
  R = 64: a mark with no lasting effect: median 35,839 steps, not under one wound period (13,000).
- Pace: the R = 32 median (26,623 steps) is under one wander, so the day stays one wander (decision 5's floor) and the brainstorm's branch applies: stones are too small to be letters that carry, and the sun is the first letter.

So, by the rules as written. These are the rule's outcomes (Measured); what they say about legibility is Unclear:

- **By the rule, the §0 prediction fails at R = 8.** The median is 97,279 steps, and four of nine R = 8 pairs are censored.
  But the measure saturates (below), and a small near disc reaches exactly 1 more easily than the far region. That is why
  R = 8 runs longer than R = 32 and R = 64, which no physical reading explains. So this does not show that a radius-8
  stone stays legible. Whether the prediction holds is not resolved by this measure.
- **By the rule, no radius is a meteor.** R = 32 and R = 64 are marks with no lasting effect, with medians of about two to
  three wound periods. The R = 32 median is under one wander, and the integer counts reproduce it. That direction is the
  reading least exposed to saturation, because no R = 32 pair is censored. Even so, 7 of its 9 horizons start after
  census 10, where both values are near the ceiling (below).
- **The pace reading keeps the day at one wander** by the rule. That is also the provisional day it started from, so
  nothing moves. "The sun is the first letter" is the rule's branch, not something this measure showed. This slice changes
  no garden setting.
- **The medians pool a carpet with two populated seeds.** One of the three seeds is a carpet, and §3 says the measure means
  something different there. Nine pairs per radius come from three histories, so the medians describe this census grid. They
  are not estimates for the commons.

**Side readings (computed by `tools/horizon.ts readout` from the record's counts; not in the rules; they change no verdict).**

- **The whole jar diverges fast.** At the first census (1,023 steps after the stone), far is 0.1603 to 0.5763. Far first
  reaches 0.9 at census 5 to 20 (median 7) in 23 of 27 pairs.
- **The measure saturates.** After census 16, near and far are both at or above 0.99 in 759 of 1,089 censuses.
- **Many horizons compare two values near the ceiling.** There are 23 measured horizons. 17 start after census 10, and 9 of
  those 17 start with near and far both at or above 0.99. The other 8 do not: seed 1, N 393,216, R 8, for example, starts
  at near 0.9492 and far 0.9989, and seed 4, N 131,072, R 64 at near 0.8565 and far 0.8971. So "every late horizon compares
  saturated values" is false. A late horizon mostly compares two values close to the ceiling, but not always both at it.
- **What a crossing is made of.** At the horizon's first census k, near is below its own census-1 value in 1 of 23
  horizons, and far is still under 0.9 in 5 of 23. Those are levels. Into the crossing itself (census k - 1, where near was
  above far, to census k), near fell in 19 of 23 and far rose in 18 of 23: both moved in 14, so only near in 5 and only far in 4 (all three counts
  printed by `readout`).
  So a horizon is not simply far catching up, and not simply the stone fading. Near falling from one census to the next
  near the ceiling is not the same as the near disc returning towards U0. These one-census moves do not say what caused a
  crossing, and the four-census window does not separate the two.
- **Withdrawn (review pass 2):** the first revision read the 1-of-23 and 5-of-23 levels as "horizons come from far catching
  up, not from the stone fading". A level at k cannot say which side moved into the crossing, and the one-census moves above
  show near falling into most of them.
- **Withdrawn:** the first readout read the far-reaches-0.9 times as "the stone's distinct mark is plain for about 5,000 to
  20,000 steps (median about 7,000), half a wound period at the median". Far reaching 0.9 measures background divergence,
  and far excludes the stone. It says nothing about when the stone's mark is plain, so that reading and its conversion to
  wound periods are withdrawn.

**What spreads the difference so fast, answered by arithmetic.** The first readout called this an open question. It is not
one. Under `wild-storm-large` a step can carry a difference up to about 16 cells:

- 13 cells through the heritable kernel's outer ring (`shapeReach` 13);
- 1 cell each through flow, transport and reaction.

The farthest cell of the 512 torus is 256 cells away along each axis. So about 20 steps after the stone, no cell of the jar is
outside its light cone. The first census, at 1,023 steps, comes some fifty times later. No jar-wide coupling is needed to
explain far at 16 to 58% on census 1. That only says where a difference may go, not where it does go: the realised spread is
chaotic and slower, and is not measured here.

This is a limit of the rules' design, not of the run. A 1,024-step cadence cannot resolve the spread of the stone's own
disturbance from near to far. "Far" here is the stone's own disturbance long after it filled the jar, not an independent
baseline.

**What a next test needs.** It needs a measure that stays under its ceiling for longer than ten censuses, and a cadence that
can see the first few hundred steps after a stone. One measure would use a coarser grain than the identity of single cells.
Another would compare equal-area regions instead of a small disc with the rest of the jar, so that sampling alone does not
put the small region at 1 first. The next test should also have a null-stone twin (see the Amendments). Neither the measure
nor the cadence is settled here.

## Amendments (2026-10-18, after review; written after the run, so they did not govern it)

- **§2, the causal claim.** "Every difference between U0 and a stone twin is caused by the stone" rests on three things:
  U1 equals U0 bit for bit in every group, a segmented twin equals a continuous `tools/run.ts` fork, and the physics is
  deterministic. No null-stone twin was run, meaning a twin whose schedule carries an intervention that changes nothing.
  So nothing separates the stone's disturbance from an effect of running with a schedule. A lesion on dead ground is not
  automatically such a twin: `applyLesion` also clears `MOT` and the lineage words. The physics treats a cell with non-zero
  lineage words as living (`living()` in `step.ts` reads the genome, not `B`), so stale words on a dead cell can matter. A
  next test should carry a null-stone twin and require its far difference to be exactly 0. Not run here: it would be a
  post-hoc GPU run with about 30 minutes of the cap left on a shared GPU.
- **§2, the effective radius.** It is now enforced. `runGroup` throws if the lesion at N + 1 applied with any radius other
  than R, or not at all. In this run all 27 were R.
- **§6, conservation.** It is now checked at every census. The tool reads each census's `series.jsonl` line, which the runner
  writes before that census's checkpoint, and throws if `conservationOk` is false, before the census can decide and stop the
  twin (`censusGate` in `tools/lib/horizon.ts`). This run did not have that check for each stone twin's deciding chunk (see
  the Readout).
- **§7, the pilot.** The pilot also runs the stop-path check and writes its result into `pilot.json`. A smoke run of the
  amended pilot ran at 15:45Z, inside the cap, on the run's own 8,192-step pilot source (36.5 s, 1-minute load 57). It
  exercised the census gate on the runner's real writes. Its S8 ended on the run's pilot hash `92b973bc4ff08e9a`, the same as
  `tools/run.ts`, and its stop path passed. The `pilot.json` is in the scratch directory and only this sentence records it.
  It measured nothing.
- **§8, the window's edge.** "A mark with no lasting effect if the median is under 131,071" now reads "at or under 131,071".
  Likewise "at or under 65,535" under the fallback window. A horizon at k = 128 is 131,071 steps, and the code always called
  it a mark. No pair of this run is at the edge.
- **§9, the record.** It carries per census the integer counts of the primary measure (`nearDiff`, `nearUnion`, `farDiff`,
  `farUnion`), the stone twin's living cells, and U0's living cells per group. The rounded `near` and `far` are no longer in
  it. Rerunning the rule on the rounded series gave a different outcome for 3 of 27 pairs, because of ties at four
  decimals:
  - seed 3, N 131,072, R 32: census 47 (48,127 steps) instead of 112 (114,687);
  - seed 3, N 131,072, R 64: census 58 (59,391 steps) instead of 62 (63,487);
  - seed 4, N 131,072, R 8: a horizon at census 110 (112,639 steps) instead of censored.

  The medians are the same either way.

  `tools/horizon.ts rebuild` re-derived this run's record from its group files. It carried the run's provenance and
  required every outcome and the readout to reproduce exactly. They did. The run's group files carry no binding and no
  checkpoint hash of their own, so what `rebuild` checks for each is weaker than a binding: the source checkpoint still
  hashes to its manifest entry, the file's centre is the one §2's rule draws from that checkpoint, and its radii and
  censuses fit the window. That is consistent with each file having come from its checkpoint; it does not prove it, and
  their provenance is otherwise unverified. A replaced seed is recorded under `sources` with `replaced: true`.
- **Resume.** A group file is reused only when its binding matches the run's exactly: seed, N, checkpoint hash, radii, K,
  window, cadence, chunk, stone step and centre. A group file without a binding is refused by `run`. `rebuild` accepts one
  only after the weaker checks above.

### Amendments, review pass 2 (2026-10-18, after the run)

- **§3, the ceiling's direction was written backwards.** §3 says the ceiling `m` approaches is "small where thousands of
  lineages live ... large on a carpet". It is the other way round. Two unrelated arrangements agree on `label` only where the
  same lineage holds the same cell in both, which is rarer the more lineages there are, so with many lineages `m` runs up
  close to 1, and where few lineages hold much of the jar (a carpet) chance agreement keeps `m` further below 1. §3's
  point stands (the ceiling depends on local diversity, which is why a carpet seed reads differently); its direction does
  not. No rule or outcome used the direction.
- **§1, the sources' founding is now checked.** `tools/horizon.ts` refuses a source whose schedule is not exactly the
  commons' feed at step 0 (`0:256,256,255,16`) alone, or that carries overrides. Before this it checked the preset, condition
  and cadence only. All four sources of this run and the pilot's source carry exactly that feed and no overrides, so the run
  is unaffected.
- **§9, the record and its tools.** The record now stores its radius grid (`radii`), so a record whose every group is
  excluded still reads. `rebuild` keeps the old record's replaced seeds (re-read and checked) instead of needing them passed
  again. A record whose counts do not give its stored outcomes now exits 3 from `readout` and 2 from `rebuild`, as the
  header says, instead of an uncaught error. The record's compact layout no longer touches strings: before, a number array
  written inside a string (a path such as `run [ 1 ]`) was rewritten. The run's record has no such string, and its bytes
  were unchanged by the new layout.

### Amendments, review pass 3 (2026-10-18, after the run)

None of these changes a rule, an outcome or the readout; the record was rebuilt with the final code and reproduced both.

- **§1, the founding check, corrected.** Pass 2's check compared the schedule's keys one by one, which refused a source whose
  founding feed carries the runner's optional `matter` assertion (the quanta its log says the feed moved) and let an
  array-like object hide a second entry. The schedule must now pass the runner's own shape checks (`validateInterventions`)
  and hold exactly one entry with every field of `0:256,256,255,16`; `matter` is the one extra key allowed. The run's four
  sources and the pilot's source still pass.
- **§9, replaced seeds.** A replaced seed's checkpoints are now checked as a run source's are (inside the bundle, the step
  they claim, the hash their manifest entry gives) before their living cells are recorded, so a living count is never read
  from the wrong file. `rebuild --replaced` naming a seed the record already holds under another directory or as a run
  source is refused.
- **§9, exit codes.** `readout` exits 3 and `rebuild` 2 on any malformed record, group file or source manifest (a missing
  field, a failed shape check), not only on a count mismatch; an I/O error (a missing or unreadable file) still exits 1. A
  record with no census at all prints "no observations" for far at census 1 instead of an impossible range.

## Amendment, slice 34 (2026-10-18): the null stone and a finer cadence, rules written before the run

The readout above leaves two caveats open. (a) No null-stone twin was run, so nothing separates the stone's material
effect from the act of intervening, or from a generic divergence clock: any difference in a chaotic jar spreads, and the
horizon may time that spread rather than the stone. (b) The 1,024-step census is coarse: far reaches 0.9 within 5 to 20
censuses, so late horizons compare two values near the ceiling. This amendment fixes, before any twin of slice 34 is run,
two null twins, a finer-cadence pilot, the GPU cap and what each outcome means. §1 to §9 and their amendments are not
changed: the stone twins of the run above are not rerun, and its outcomes are what the null twins are read against. A
change to anything below is a further dated amendment. The readout is appended after this amendment, whatever it says.

It adds no physics, no rule change, no golden pin and no garden config. Like §1 to §9, it is a catalogue test, not an
experiment.

### N1. What was looked at before these rules

One scan, on the CPU, of the nine source checkpoints the run above used (seeds 1, 3 and 4 at 131,072, 262,144 and
393,216; every one hashes to its manifest entry). It read checkpoint state only, no twin and no outcome. A cell is
**lesion-null** when `applyLesion` would write nothing to it: `B = P = E = 0`, `MOT` at rest (`MOT_ZERO`) and both lineage
words 0. A disc is lesion-null when every cell in it is. What the scan found:

- Lesion-null discs exist at R = 8 in 5 of the 9 checkpoints (not seed 3 at 393,216, not seed 4 at any), at R = 32 in 2
  (seeds 1 and 3 at 131,072), and at R = 64 in none.
- A dead cell (`B = 0`, both lineage words 0) is almost always lesion-null: no dead cell holds `P`, and 67 to 1,183 hold
  `E` and 2 to 37 a moving `MOT` per checkpoint.
- The least-living R = 64 disc still holds 487 to 11,820 living cells (of 12,853). A lesion there is a smaller stone, not a
  null. So "a stone of the same radius on dead ground" does not exist for most of the grid. That is a finding of the
  search, not a fallback, and the divergence question goes to the kick (N3) instead.
- 789 to 17,812 cells per checkpoint have `B = 0` and lineage words that are not 0 ("stale" cells). §3's measure reads
  them as EMPTY; the physics reads them as living (`living()` in `step.ts` reads the lineage words, and the affinity and
  motility passes use that genome). This gap between the measure and the dynamics is recorded as a side reading.
- Then, still on the CPU and before any twin, N2 and N3 were applied to the nine checkpoints (`tools/horizon.ts
  nullprep`), which also re-verified N4's hashes, living cells and centres. The scan's counts reproduce exactly (R = 32:
  11 null-disc centres for seed 1 and 338 for seed 3 at 131,072). No stale cell holds `P = 0`: every kick cell holds
  `P = 1`, `E = 0` and `MOT` at rest, so each kick moves one quantum of `P` to waste and clears one cell's lineage words.

### N2. The null stone (N0): a lesion that writes nothing

For each group (seed, N) of the run above and each R in 8, 32 and 64 at which the checkpoint has a lesion-null disc of
radius R, one twin **N0-R** carries `{"step": N + 1, "kind": "lesion", "x": zx, "y": zy, "r": R}`. Its centre: the cells
whose radius-R torus disc (the lesion's own disc test) is lesion-null, in index order, and the one at position
`centreDraw(seed, N + 1) mod count` (§2's draw at N + 1, so it differs from the stone's draw at N). Where no such disc
exists, the group records "no null disc at R" and the largest radius that has one (`r0`).

N0-R runs the first chunk, 16 censuses, like U1. **Prediction: exactly U0.** At every census its `stateHash` equals U0's
at that census, and the whole jar gives label difference 0 and light-cone difference 0; its final `stateHash` equals U0's.
`stateHash` (physics state), not the artifact digest, is compared: the twin's spec carries a schedule and U0's does not.
Anything else is a fault in the intervention machinery (the chunk split at the scheduled step, the readback after an
intervention), not drift: the group is void, the run stops, and the causal claim of §2 above is open again.

### N3. The kick (K): the smallest change that removes no biomass

Each group carries one twin **K** with `{"step": N + 1, "kind": "lesion", "x": kx, "y": ky, "r": 0}`: a radius-0 lesion
on one stale cell. It removes no biomass (`B = 0` there) and no living cell by §2's `B > 0`, yet it changes the physics,
because it clears that cell's lineage words. Its cell: the stale cells of the checkpoint (`B = 0`, `LIN_HI` or `LIN_LO`
not 0), ranked by `P` (the matter the lesion moves to waste), then `E` (the energy it sends to heat), then whether `MOT`
is off rest, all ascending; among the cells tied at the minimum, in index order, the one at position
`centreDraw(seed, N + 2) mod ties`. The kick's cell values (`P`, `E`, `MOT`, lineage words) are recorded. Its effective
radius must be 0.

K is compared with U0 exactly as a stone twin is (§3, §5), under three near regions: the torus discs of radius 16, 64 and
128 around the kick's cell, written **K|8**, **K|32** and **K|64** (the near discs of R = 8, 32 and 64). Each is a pair
with its own outcome under §5's rule (K = 4, the window of §7), and K stops once all three are decided. K runs in the
group's chunks after the N0 twins, so a group whose N0 fails never runs K. A kick that leaves the jar unchanged by census
1 (both diffs 0) is no mark for all three, as §5 says, and whether its `stateHash` at census 1 equals U0's is recorded.

Why a kick and not the stone's own centre: an r = 0 lesion on a living cell removes biomass, and a feed adds matter and is
not a lesion. Why not the least-living disc: N1.

### N4. The groups

The nine groups of the run above, same sources, same checkpoints. Each group's twins: U0 and U1 (§2, §6, unchanged), the
N0 twins that exist, and K. No stone twin is rerun.

**Re-verification (CPU, before any twin):** each source checkpoint hashes to its manifest entry (as `loadCheckpoint`
does); each source's `summary.finalHash` and living cells equal the record's `sources` entries (seed 1
`c36dadcd9fb6b211`, seed 3 `3dc10d1726dc8d47`, seed 4 `f9d11a2de1bebece`); §2's centre drawn from each checkpoint equals the record's `centre`. During the run: U0's living cells at every
census equal the record's `u0.living` over the censuses both have, and where U0 ends a chunk at a census the record's U0
also ended on, the final hashes are equal. Any mismatch is a determinism fault and the run stops. If the scratch bundles
are gone, each source is regenerated with §1's command (seeds 1, 3 and 4 only), counted in the cap, and its final hash and
checkpoint hashes must equal the record's.

### N5. The finer cadence (the fine pilot)

- **Groups:** day 1 (N = 131,072), seeds 1, 3 and 4. **Twins:** U0, S8, S32 and S64 (the run's stones, at the record's
  centres) and K. **Cadence:** 64 steps. **Window:** 8,192 steps, readings j = 1 .. 128 at step N + 64j, which is 64j - 1
  steps after the stone (reading 16j falls on census j).
- **Path.** The runner's census is fixed by the checkpoint's observer (`continuationError` requires the observer's
  `censusEvery`), so a 64-step census cannot continue it. The fine twins drive `GpuSim` directly, in the runner's order:
  from the checkpoint state, one step, wait for the device, the lesion (if any), then steps to each multiple of 64 after N,
  reading the cells and the genome head at each. One twin at a time; U0's 128 readings are held.
- **Gates (a mismatch voids the fine pilot, nothing of it reads):** each fine twin's `stateHash` at N + 8,192 equals the
  same twin run through `runExperiment` for 8 censuses; U0's living cells at reading 16j equal the record's `u0.living` at
  census j; the fine S8 of seed 1 at N + 6,144 hashes to the record's `stopStateHash` `3067b35b80d9177f`; and a fine S64
  from seed 4's checkpoint at 262,144, run to N + 5,120 only, hashes to the record's `dd6f3f27cbfc6e70`. The radius-0
  lesion is also checked once on the day-1 seed-1 checkpoint before any twin: applied on `GpuSim` and by `applyLesion` on
  the CPU, with no step, the two states hash equal.
- **The readings, per pair** (S-R with its near disc, K|R with the kick's), from §3's primary measure at every reading:
  `far50` and `far90`, the first reading with far at least 1/2 and at least 9/10; `cross`, the first reading with
  near <= far; the **gap area** `G`, the sum over the 128 readings of max(0, near - far) times 64, in steps; and the
  **fine horizon**, the first reading j <= 113 with near <= far at j .. j + 15 (1,024 steps), reported as 64j - 1 steps,
  censored (> 7,231) otherwise. All comparisons are exact (cross-multiplied), and `G` is computed from the integer counts
  and rounded to a step only for display.
- **The fine verdict, per radius over the three groups:** the stone's early mark is **material** if `G(S-R) > 2 G(K|R)`
  in all three groups, **like a kick** if `G(S-R) <= 2 G(K|R)` in all three, and **mixed** otherwise.

### N6. What the readings mean

- **N0.** All N0 twins equal to U0: a scheduled lesion that writes nothing leaves no trace, so the machinery half of
  caveat (a) is closed at every radius that had a null disc (R = 8 and 32 where found; R = 64 had none). Any N0 fault:
  nothing below reads, and the run above is in question until it is explained.
- **K against the stones, per radius** (the coarse reading). Over the groups where both ran, the K|R pairs that are a
  horizon, censored or no mark, sorted with no mark below every horizon and censored above (this ordering is for this
  reading only; §8's medians are unchanged), against the record's S-R horizons. Median by §8's rule (element
  floor((n - 1) / 2)).
  - **Divergence clock at R** if the K|R median is at least half the S-R median (a censored median counts as above
    everything): a change that removes no biomass stays "legible" by §5 about as long as the stone, so the horizon times
    the spread of any difference, not the stone.
  - **Stone effect at R** if the K|R median is under half the S-R median: the stone's horizon is longer than a kick's, so
    it carries the stone's own disturbance. If most K pairs are no mark, a dead-cell change is invisible at the 1,024-step
    grain, and the stone horizons are stone effects at that grain.
  - The paired count (groups with K|R at least half S-R) is recorded beside each verdict and decides nothing.
- **The garden's pace keys on R = 32**, as §8 does:
  - stone effect at R = 32: #55's R = 32 reading stands as a stone effect, with its saturation caveat;
  - divergence clock at R = 32: #55's R = 32 horizons time divergence, and the pace reading rests on how legible a stone
    is in its first censuses, which is the fine pilot's: if the fine verdict at R = 32 is material, a stone is a mark
    legible for about its fine horizon; if like a kick, no measure here separates a stone from any perturbation at either
    grain;
  - either way the day stays one wander (decision 5's floor): under a stone effect the R = 32 median is the run's
    26,623 steps, and under a divergence clock the legibility this slice can see is at most the fine window, 8,192 steps,
    both under one wander. A censored fine horizon means "legible past the fine window", and is reported as such. This
    slice changes no garden setting.
- **Limits.** The kick is one cell on one stale cell; the K regions are centred on that cell, not on the stone's, so K and
  S are compared as medians per radius, not region for region. The factors of 2 and 1/2 are fixed here and are not tuned
  afterwards. Nine groups from three histories, as in §8.

### N7. The GPU cap and the order

- **Cap: 4 hours of wall time** for all of slice 34's GPU work, counted from the start of the timing pilot. Before each
  GPU step `ps` is checked for other heavy deno, vite or browser GPU processes and `uptime` is recorded; other sessions'
  GPU use is not stopped, only noted. One twin on the GPU at a time.
- **Timing pilot:** the run's own `pilot` (U0 and S8 for four censuses from the 8,192-step pilot source, the `tools/run.ts`
  cross-check and the stop path), whose final hash must again be `92b973bc4ff08e9a`; then the radius-0 check (N5). Rates
  are the pilot's times 0.75.
- **Worst cases:** a group costs at most `(2 * 131 + 16 + 16 * n0) * 1,024 / rate` seconds (U0 and K to census 131, U1,
  and its n0 N0 twins); the fine pilot at most `3 * 5 * 2 * 8,192 * 1.3 / rate` (five twins, the fine path and its
  `runExperiment` gate, 30% for the readings) plus the S64 anchor.
- **Scale-down, fixed now:** if the pilot, the three day-1 groups and the fine pilot do not fit the cap at their worst, the
  fine window drops to 4,096 steps (readings 1 .. 64, fine horizon starts j <= 49); if that still does not fit, the window
  of the K pairs drops to 64 censuses (§7's fallback, and §8's fallback readings apply). **Order:** day-1 groups (seeds 1,
  3, 4), the fine pilot, day-2 groups, day-3 groups. Each group and the fine pilot starts only if its worst case fits what
  is left; one that does not is recorded `not run (cap)`. A group that reaches the cap stops at the end of its chunk with
  its undecided pairs `stopped (cap)`. Whatever applies is recorded.

### N8. The record

`experiments/garden/stone-null-2026-10-18.json`, compact, next to the run's record (which is not changed): this
amendment's heading and the SHA-256 of this note at the run's start (the readout is appended strictly after this
amendment, so the note up to the slice-34 readout's heading must hash to it), git commit and dirty flag, `RULE_VERSION`,
host and adapter, `uptime` and the `ps` note at each stage, the pilot's rates and cross-checks, the cap and every
scale-down, the sources' re-verification, and per group: the stone centre check, `r0`, the stale-cell count, each N0
(R, centre, identity at each census, hashes) or "no null disc", the kick's cell and values, the control, U0's
reproduction against the record, and per K pair the outcome, the final or stop hash and, per census, the integer counts
`nearDiff`, `nearUnion`, `farDiff`, `farUnion` and the living cells of K and U0. The fine pilot's gates and, per pair and
reading, the same four counts, with the derived readings. Full counts (all three measures) stay in the scratch
directory, which is session-scoped and may vanish; the record says where it was. The readings of N6 are computed from the
record by the tool, which fails if they differ from what the record stores, and appended below.

## Readout, slice 34 (2026-10-18)

Run on 2026-10-18 from 17:58:34Z (the timing pilot) to 19:33:16Z: 1 h 35 min of the 4-hour cap, no scale-down (fine
window 8,192 steps, K window 128 censuses). Serial: one of this slice's deno processes on the GPU at a time. Another
session's `tests/deno/garden_found_smoke.ts` was running beside group seed 3 at 131,072 (in that stage's `ps`), noted and
not stopped; every result below is bit-exact against #55 or `runExperiment` all the same. Apple M1 Max; 1-minute load
averages 19.93 to 341.65 over the GPU stages (346.92 at the run script's own nullrecord step, 5-minute up to 355.48); other
sessions' vitest and vite runs were noted, not stopped. Every gate passed: the timing pilot hashed `92b973bc4ff08e9a`
again; the radius-0 and N0 R = 8 lesions hashed equal on the GPU and the CPU; all 9 groups re-verified against #55's
record (sources, checkpoints, centres) and U0 reproduced #55's living cells at every census both have, its chunk-1 hash in
all 9 groups and its end hash in the 4 where it ended on the same census; every N0 twin (7, at R = 8 and 32) was identical
to U0 at all 16 censuses; every fine twin equalled the same twin through `runExperiment`, and both #55 anchors reproduced.

The amendment above was not committed before the run (the record says `dirty: true`), so that the rules came first rests on
hashes this session took, not on a commit: the run script hashed the whole note before the pilot started
(`note-sha256-before-pilot` `75458dae...` in its status file, which the record now carries as `runStatus`, with the
`uptime` and `ps` of every stage, the pilot, `lesioncheck` and `nullplan` included), `nullplan` hashed it again a minute
later (`rulesDigestAtStart`), the script hashed it once more at the end, and the note before this heading still hashes to
it. As N1 says, `nullprep` (which chose the kick cells and the null centres, on the CPU, from the checkpoints alone) ran
before the rules were fixed. Record: `experiments/garden/stone-null-2026-10-18.json` (integer counts per census and per
fine reading; full counts in the session scratch directory named there, which may vanish). Recomputed from the record by
`tools/horizon.ts nullreadout`, which also re-derives the stone pairs from #55's record:

- **Rules digest**: the note before this heading hashes to `75458dae7ffbbf96...`, the SHA-256 stored at the run's start.
- seed 1 N 131,072: done; N0-8 identical over 16, N0-32 identical over 16; no null disc at R = 64 (r0 33); kick (490, 371) P 1 E 0; U0 reproduces #55 (16 censuses, chunk-1 hash checked, end hash not reached).
- seed 3 N 131,072: done; N0-8 identical over 16, N0-32 identical over 16; no null disc at R = 64 (r0 37); kick (268, 255) P 1 E 0; U0 reproduces #55 (16 censuses, chunk-1 hash checked, end hash not reached).
- seed 4 N 131,072: done; no N0 twin; no null disc at R = 8, 32, 64 (r0 4); kick (273, 189) P 1 E 0; U0 reproduces #55 (16 censuses, chunk-1 hash checked, end hash not reached).
- seed 1 N 262,144: done; N0-8 identical over 16; no null disc at R = 32, 64 (r0 11); kick (390, 7) P 1 E 0; U0 reproduces #55 (64 censuses, chunk-1 hash checked, end hash not reached).
- seed 3 N 262,144: done; N0-8 identical over 16; no null disc at R = 32, 64 (r0 12); kick (391, 234) P 1 E 0; U0 reproduces #55 (21 censuses, chunk-1 hash checked, end hash checked).
- seed 4 N 262,144: done; no N0 twin; no null disc at R = 8, 32, 64 (r0 3); kick (282, 495) P 1 E 0; U0 reproduces #55 (8 censuses, chunk-1 hash checked, end hash checked).
- seed 1 N 393,216: done; N0-8 identical over 16; no null disc at R = 32, 64 (r0 17); kick (218, 378) P 1 E 0; U0 reproduces #55 (98 censuses, chunk-1 hash checked, end hash checked).
- seed 3 N 393,216: done; no N0 twin; no null disc at R = 8, 32, 64 (r0 4); kick (412, 424) P 1 E 0; U0 reproduces #55 (16 censuses, chunk-1 hash checked, end hash not reached).
- seed 4 N 393,216: done; no N0 twin; no null disc at R = 8, 32, 64 (r0 2); kick (198, 68) P 1 E 0; U0 reproduces #55 (128 censuses, chunk-1 hash checked, end hash checked).
  - K|8 seed 1 N 131,072: horizon 1,023
  - K|32 seed 1 N 131,072: horizon 1,023
  - K|64 seed 1 N 131,072: horizon 1,023
  - K|8 seed 3 N 131,072: no-mark
  - K|32 seed 3 N 131,072: no-mark
  - K|64 seed 3 N 131,072: no-mark
  - K|8 seed 4 N 131,072: horizon 1,023
  - K|32 seed 4 N 131,072: horizon 5,119
  - K|64 seed 4 N 131,072: horizon 9,215
  - K|8 seed 1 N 262,144: horizon 1,023
  - K|32 seed 1 N 262,144: horizon 53,247
  - K|64 seed 1 N 262,144: horizon 60,415
  - K|8 seed 3 N 262,144: censored
  - K|32 seed 3 N 262,144: horizon 30,719
  - K|64 seed 3 N 262,144: horizon 23,551
  - K|8 seed 4 N 262,144: horizon 16,383
  - K|32 seed 4 N 262,144: horizon 59,391
  - K|64 seed 4 N 262,144: horizon 56,319
  - K|8 seed 1 N 393,216: censored
  - K|32 seed 1 N 393,216: horizon 100,351
  - K|64 seed 1 N 393,216: horizon 8,191
  - K|8 seed 3 N 393,216: horizon 1,023
  - K|32 seed 3 N 393,216: horizon 1,023
  - K|64 seed 3 N 393,216: horizon 1,023
  - K|8 seed 4 N 393,216: censored
  - K|32 seed 4 N 393,216: horizon 74,751
  - K|64 seed 4 N 393,216: horizon 53,247
- **R = 8**: K|8: 9 valid (no mark 1, horizons 5, censored 3); median 1,023 steps against the S-8 median 97,279 steps: stone effect at R = 8 (the K median is under half the stone's); paired: 4 of 9 groups with K|8 at least half S-8.
- **R = 32**: K|32: 9 valid (no mark 1, horizons 8, censored 0); median 30,719 steps against the S-32 median 26,623 steps: divergence clock at R = 32 (the K median is at least half the stone's); paired: 5 of 9 groups with K|32 at least half S-32.
- **R = 64**: K|64: 9 valid (no mark 1, horizons 8, censored 0); median 9,215 steps against the S-64 median 35,839 steps: stone effect at R = 64 (the K median is under half the stone's); paired: 5 of 9 groups with K|64 at least half S-64.
- **Fine pilot** (every 64 steps, window 8,192; gates: S8 seed 1 +6,144 ok, S64 seed 4 +5,120 ok; every twin equal to runExperiment):
  - seed 1 S8: far50 30, far90 109, cross 41, G 461 steps, fine horizon 2,623.
  - seed 1 S32: far50 28, far90 111, cross never, G 914 steps, fine horizon censored (> 7,231).
  - seed 1 S64: far50 25, far90 105, cross never, G 873 steps, fine horizon censored (> 7,231).
  - seed 1 K|8: far50 28, far90 107, cross 1, G 1 steps, fine horizon 255.
  - seed 1 K|32: far50 28, far90 104, cross 7, G 6 steps, fine horizon 447.
  - seed 1 K|64: far50 27, far90 99, cross 9, G 13 steps, fine horizon 575.
  - seed 3 S8: far50 39, far90 124, cross never, G 1,808 steps, fine horizon censored (> 7,231).
  - seed 3 S32: far50 40, far90 125, cross never, G 2,225 steps, fine horizon censored (> 7,231).
  - seed 3 S64: far50 38, far90 128, cross never, G 1,455 steps, fine horizon censored (> 7,231).
  - seed 3 K|8: far50 62, far90 never, cross 1, G 306 steps, fine horizon 63.
  - seed 3 K|32: far50 62, far90 never, cross 1, G 478 steps, fine horizon 63.
  - seed 3 K|64: far50 64, far90 never, cross 1, G 776 steps, fine horizon 63.
  - seed 4 S8: far50 16, far90 never, cross 44, G 930 steps, fine horizon censored (> 7,231).
  - seed 4 S32: far50 15, far90 never, cross never, G 1,074 steps, fine horizon censored (> 7,231).
  - seed 4 S64: far50 15, far90 never, cross never, G 820 steps, fine horizon censored (> 7,231).
  - seed 4 K|8: far50 18, far90 never, cross 15, G 90 steps, fine horizon 959.
  - seed 4 K|32: far50 18, far90 never, cross 20, G 164 steps, fine horizon 1,279.
  - seed 4 K|64: far50 18, far90 never, cross 23, G 218 steps, fine horizon 5,119.
  - R = 8: material (seed 1 G(S) 461 vs G(K) 1; seed 3 G(S) 1,808 vs G(K) 306; seed 4 G(S) 930 vs G(K) 90).
  - R = 32: material (seed 1 G(S) 914 vs G(K) 6; seed 3 G(S) 2,225 vs G(K) 478; seed 4 G(S) 1,074 vs G(K) 164).
  - R = 64: mixed (seed 1 G(S) 873 vs G(K) 13; seed 3 G(S) 1,455 vs G(K) 776; seed 4 G(S) 820 vs G(K) 218).
- Pace: a divergence clock at R = 32 (paired 5 of 9; R = 8 stone effect, R = 64 stone effect): #55's R = 32 horizons time divergence, and the pace reading rests on the first censuses: the fine verdict at R = 32 is material (on the fine pilot's groups only, N = 131,072): a stone is a mark legible for about its fine horizon (S-32: > 7,231, > 7,231, > 7,231 steps). The day stays one wander (the legibility seen here is at most the fine window, 8,192 steps), and no garden setting changes.

Side readings computed by the tool (not in the rules; they decide nothing):

- **By day**, K|R against S-R on the matched groups, with N6's median rule (values per seed, K then S):
  - R = 8, N 131,072: seed 1 1,023 / 3,071; seed 3 no mark / 18,431; seed 4 1,023 / censored; medians K 1,023, S 18,431 (K under half S); paired 0 of 3.
  - R = 8, N 262,144: seed 1 1,023 / censored; seed 3 censored / 8,191; seed 4 16,383 / 5,119; medians K 16,383, S 8,191 (K at least half S); paired 2 of 3.
  - R = 8, N 393,216: seed 1 censored / 97,279; seed 3 1,023 / censored; seed 4 censored / censored; medians K censored, S censored (K at least half S); paired 2 of 3.
  - R = 32, N 131,072: seed 1 1,023 / 22,527; seed 3 no mark / 114,687; seed 4 5,119 / 120,831; medians K 1,023, S 114,687 (K under half S); paired 0 of 3.
  - R = 32, N 262,144: seed 1 53,247 / 26,623; seed 3 30,719 / 14,335; seed 4 59,391 / 3,071; medians K 53,247, S 14,335 (K at least half S); paired 3 of 3.
  - R = 32, N 393,216: seed 1 100,351 / 5,119; seed 3 1,023 / 51,199; seed 4 74,751 / 67,583; medians K 74,751, S 51,199 (K at least half S); paired 2 of 3.
  - R = 64, N 131,072: seed 1 1,023 / 50,175; seed 3 no mark / 63,487; seed 4 9,215 / 31,743; medians K 1,023, S 50,175 (K under half S); paired 0 of 3.
  - R = 64, N 262,144: seed 1 60,415 / 35,839; seed 3 23,551 / 18,431; seed 4 56,319 / 2,047; medians K 56,319, S 18,431 (K at least half S); paired 3 of 3.
  - R = 64, N 393,216: seed 1 8,191 / 11,263; seed 3 1,023 / 68,607; seed 4 53,247 / 67,583; medians K 8,191, S 67,583 (K under half S); paired 2 of 3.
- **Fine pairs, first difference** (the first reading where near or far differs at all): reading 1 in 15 of 18 pairs; seed 3 K|8 26, seed 3 K|32 26, seed 3 K|64 26.
  - fine horizons that start before the first difference (vacuous: nothing had happened yet; N5 has no "no mark" class): seed 3 K|8, seed 3 K|32, seed 3 K|64.
  - readings with an empty near union: seed 3 K|8 85 of 128.

What this says, within N6's rules:

- **N0 closes the plumbing half of caveat (a), and only that.** A scheduled lesion that by construction writes nothing
  left every state hash equal to U0's for 16 censuses: 7 twins, at R = 8 in 5 groups and at R = 32 in the 2 day-1 groups
  that had a null disc; none at R = 64 (r0 2 to 37). That checks the chunk split at the scheduled step and the readback
  after an intervention. It is no control for "the act of intervening" in the brief's sense: a lesion that writes nothing
  intervenes in nothing.
- **There is no same-radius null for most of the grid, and the kick that stands in for it is weaker.** At R = 32, 7 of 9
  groups have no lesion-null disc, and at R = 64 all 9 (N1). N1 calls this a finding of the search; it is also the
  fallback the brief asked to have named, and what it weakens is this. K is a perturbation-size floor, not a same-radius
  null: an r = 0 lesion on one stale cell. It removes no biomass (`B = 0` there), but it does remove a cell the physics
  treats as living (`living()` reads the lineage words, which K clears), and it moves one quantum of `P`. Its near regions
  are centred on the kick's cell, not the stone's. So "stone effect at R" says only that a stone's horizon is much longer
  than a one-cell change's, which the size of the change alone could explain, and "divergence clock at R" says that a
  one-cell change reads as legible about as long as the stone does.
- **The coarse verdict at R = 32 is a divergence clock, weakly, and it comes from days 2 and 3.** By N6's rule K|32's
  median (30,719 steps, the 5th of nine values from 1,023 to 100,351) is at least half S-32's (26,623). But the same rule
  reads R = 8 and R = 64 as stone effects, the paired counts are 4, 5 and 5 of 9, and the by-day side reading splits
  cleanly. On day 1 (N = 131,072) K is under half S in all three groups at every radius (K|32 1,023 / no mark / 5,119
  steps against S-32 22,527 / 114,687 / 120,831). On days 2 and 3, K|32 is at least half S-32 in 5 of 6 groups: a
  one-cell change stays "legible" by §5 for 30,719 to 100,351 steps, longer than the stone in each of the five. The clock
  reading is a day-2 and day-3 reading; on day 1 the coarse grain does separate a stone from a kick.
- **The fine pilot covers day 1 only, where the kick is already weakest.** In the first 8,192 steps of the three day-1
  groups, each stone's gap area is more than twice the kick's at R = 8 and 32 (material), and in two of three at R = 64
  (mixed: seed 3's kick ran a gap of 776 against the stone's 1,455; from reading 72 on, seed 3's kick gap at R = 64 is
  the larger of the two at every reading, and at R = 32 from reading 113 on). Two cautions. A stone deletes the biomass of its own
  disc, inside its near region, so near exceeds far by construction until the hole heals: "material" says that a stone's
  removed disc is a larger local difference than a one-cell change, which is close to what a stone is. And seed 3's kick
  changed nothing at all until reading 26 (both diffs 0; K|8's near union empty in 85 of 128 readings, a kick on a dying
  fringe): its three fine horizons of 63 steps are vacuous, since N5, unlike §5, has no "no mark" class. Its gap areas,
  which come from reading 26 on, are not vacuous.
- **How long a stone's near stays above its own far at the fine grain (day 1).** This compares each stone with its own
  far region, not with the kick; the comparison with the kick is the gap-area verdict above. S-32 and S-64: near stayed
  above far for the whole window in all three groups (cross never; fine horizons censored, > 7,231 steps, the last step
  a fine horizon can start at). S-8: seed 1's near fell to its far at 2,623 steps (reading 41) and stayed there for the
  16 readings N5 asks for, but rose above far again at readings 106 to 114 and 126 to 128 (at the last reading near is
  729 of 777 cells against far's 188,516 of 204,209), so the fine horizon is the first sustained crossing, not a
  disappearance; seed 4's crossed at reading 44 (2,815 steps) without a sustained run; seed 3's stayed above. Where the
  kick marked anything (seeds 1 and 4), its sustained fine horizons were 255 to 5,119 steps and its first crossings
  readings 1 to 23 (63 to 1,471 steps); seed 4's K|32 and K|64 also rose above far again later in the window.
- **Pace.** By N6 (a divergence clock at R = 32) the pace reading rests on the first censuses. There, on day 1 only, a
  stone of radius 32 or 64 keeps its near region above its own far for the whole fine window (more than 7,231 steps), and
  its gap area against the kick's reads material at R = 32 and mixed at R = 64 (seed 3's kick catches up late). A
  radius-8 stone's near first meets its far within about 2,600 to 2,800 steps in two of three groups, and in seed 1
  rises above it again later. This slice cannot see past 8,192 steps,
  and it has no fine reading on days 2 and 3, where a one-cell change reads as legible by §5 for 30,000 steps or more at
  R = 32: in a day-2 or day-3 jar a stone is not shown here to be more legible than any other change. The day stays one
  wander; no garden setting changes.

Side readings (not in the rules; they decide nothing): the kick's mark is global within one census. At census 1 the far
region of K|8 already differs in 15,615 to 123,138 cells (6% to 57% of the living union) in 8 of 9 groups, from one cell;
in seed 3 at 131,072 it left no label or `B + P` difference at census 1 (no mark) though its `stateHash` differed. So the
1,024-step measure saturates from a one-cell change about as fast as from a stone, which is what makes the coarse
horizons time divergence once the jar is past day 1; the fine readings are where a stone's own disturbance shows.

### Amendments, slice 34 review pass (2026-10-18, after the run)

No rule above changes, and no outcome: the record was rebuilt with the final code from the same scratch files, and every
K outcome, fine reading and verdict reproduced. The text from this heading's readout down was revised; the note before
the readout heading is untouched and still hashes to the rules digest.

- **N6, matched groups.** Both medians are now taken over the groups where K|R and S-R both have a value ("over the groups
  where both ran"); the code had taken the S median over every valid stone pair, so a group whose K was skipped for the
  cap or went extinct could have moved it. Here both sets are the same 9 groups, so nothing moved.
- **N5, the complete grid and the counts.** A done fine pilot must hold exactly the day-1 groups, each with one S and one
  K pair at every radius, and every count array must have 128 entries of non-negative integers with diff at most union
  (an empty union is allowed). The coarse K counts are checked the same way. Before, a missing pair was skipped, which
  could have read "in all three groups" off two.
- **Receipts.** The GPU stages now check each checkpoint's manifest hash and the source's final hash against what
  `nullprep` recorded before loading it, and `nullreadout` re-derives the stone pairs from #55's record (its SHA-256
  checked) instead of trusting the copy in this record.
- **The fine binding.** Fine group files now carry a binding (checkpoint hash, stone centre, kick, window, cadence) that
  `nullrecord` checks against the plan and the prep. This run's files predate it; they are checked on the fields they
  carry (window, cadence, every twin's lesion against the prep's centres; `bindingChecked` in the record says so). Their
  checkpoint identity rests on the gates: U0 reproduced #55's living cells at every census, and both anchors reproduced.
- **The cap inside the fine pilot.** The deadline is now checked before every twin, gate, anchor and reading; a pilot it
  overtakes is recorded `stopped (cap)` and reads as nothing. This run's pilot took 14 minutes, so this changes nothing
  here.
- **The run script's status file** is imported into the record (`runStatus`: per stage the start, `uptime`, `ps` and exit
  code, and the note's hash before the pilot and at the end), so the receipts above can be checked from the record.
- **The pace line** now carries the R = 32 paired count and the neighbouring radii's verdicts, and names the days the fine
  verdict covers. **Side readings** by day and the fine pairs' first difference are computed by the tool; they decide
  nothing.
- **§2 and #55's readout, a pointer.** §2 says that every difference between a stone twin and U0 is caused by the stone,
  and that far is not fork drift. That still holds, since the twins are deterministic and identical but for the lesion.
  But the kick shows that a one-cell change reaches the far region within one census, so "caused by the stone" does not
  mean "specific to a stone": far's rise is the spread of any difference. §2 and #55's readout are not edited, because
  the note before the slice-34 readout heading is bound by its hash (N8).
- **Second review pass (Codex).** Two readout sentences claimed more than N5 measures and were rewritten: seed 1's S-8
  "fell to its far for good" (it rises above far again at readings 106 to 114 and 126 to 128), and "distinct from a kick
  for the whole fine window" (the whole-window statement is about a stone against its own far; against the kick N5 gives
  only the gap-area verdicts, material at R = 32 and mixed at R = 64). Five tool fixes, none of which changes a reading
  here: the status file must carry exactly one well-formed pre-pilot hash (a missing, malformed or repeated one is
  refused, not passed); the fine gates through `runExperiment` now stop on the deadline at each census and record
  `stopped (cap)`; `nullrecord` refuses a fine pilot whose files show a failed gate, a lesion at the wrong radius, a short
  U0 check, a listed failure or a missing anchor; the record's groups must be #55's nine (taken from #55's own record, its
  hash checked), so dropping groups cannot shrink "all three groups"; and the near/far comparison is exact for any
  integer counts, with the gap's numerator taken exactly (BigInt past 2^53, which no jar reaches). The record was rebuilt again; only `recordedAt`
  changed.
- **Third review pass (Codex).** No prose finding; three tool fixes, none of which changes a reading here. `nullreadout`
  now applies the same gate checks to the record that `nullrecord` applies to the files (no listed failure, both anchors
  reproduced, every fine twin's gate passed with equal hashes, every lesion at its radius, U0 checked at every census the
  window reaches), so a record edited afterwards to show failed fine evidence no longer reads. `nullrecord` now
  recomputes the stone pairs from #55's own record and refuses a prep whose pairs differ, and the reader requires stone
  pairs for exactly #55's nine groups at every radius (before, only R = 8 was checked, so dropping R = 32 or 64 pairs
  could change a verdict at build time). A fine gate or the last anchor that finishes past the cap's deadline is now
  discarded and recorded `stopped (cap)` too, not only one the deadline overtakes between censuses. The record was
  rebuilt again; only `recordedAt` changed.
- `recordedAt.digests` in the record are the files at the rebuild; the note's entry there is the note as it was when the
  record was rebuilt, since this readout is pasted from the record afterwards.
