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
