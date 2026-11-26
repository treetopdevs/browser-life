# Soft Roam chunk 4: what changed and what it did

2026-11-26. Spec: CONTRACT-4.md. Probe: `experiments/softroam/speed.ts`; outputs in `runs/softroam/c4/` (`speed-off-s*.txt`,
`speed-on-s*.txt`, 24,000-step looks `base-s1|2` and `all-s1|2`, movie `movie-s1/movie.mp4`, steps 6000 to 6240 at page scale).
Seeds 1 to 4 looked at, so everything here is on seen seeds only.

## Why every moving body went at one speed

A body's cruising speed was its founder's drive gene and nothing else: every cell carries its own engine and drag, so size does not
matter, and nothing a body does (eating, carrying shells) changes its push. The founders have drive 64 or 96 and copy errors are rare and
coarse, so there were two cruising speeds (0.029 and 0.044 tiles a step), plus stopped and the hunting cap (0.233).

## What was built (bodies start only; every earlier start's digest unchanged)

- `pace 0.25` (kernel): a body slows as it fills, to a quarter of its speed when ready to divide; hungry bodies go full speed. A body
  chasing prey or fleeing never slows. Replaced the planned `graze` (slow on a full food tile), which the probe showed would touch
  3 to 6 bodies in about 250 at any moment.
- `shellThrust 0.5` (kernel): shell cells push at half strength.
- Founder drive spread 2 (start option `driveSpread`): each founder's drive is its type's times 0.5 to 2, inherited.
- Dials "Speed when well fed", "Shell swimming", "Founder speeds vary".
- Picture: idle mouths are a dusky rose with a faint glow; a feeding mouth turns hot orange-red and pulses, with beads running from
  prey to mouth along the thread and a flickering bite mark on the prey. Cells that took food from the ground draw in three pale
  motes from about a tile out. The garden picture pins in softroam-view were re-pinned on purpose; the plain picture is unchanged.

## Numbers (moving bodies, three looks at 6000, 7500, 9000)

| seed | p90/p10 off -> on | median off -> on (tiles a step) | herds / groves / packs median, on |
| --- | --- | --- | --- |
| 1 | 2.5 -> 4.6 | 0.029 -> 0.026 | 0.025 / 0.032 / 0.025 |
| 2 | 2.7 -> 4.4 | 0.040 -> 0.020 | 0.014 / 0.020 / 0.024 |
| 3 | 2.8 -> 3.2 | 0.041 -> 0.026 | 0.025 / 0.026 / 0.027 |
| 4 | 5.3 -> 5.5 | 0.039 -> 0.022 | 0.021 / 0.021 / 0.022 |

Against the bar set beforehand: the spread (p90/p10 above 4) passes on seeds 1 and 2, fails on seed 3, and seed 4 was already above 4 with
everything off. **Family medians apart: fails.** With the founder spread, speed now varies inside each family rather than between them; the
packs' edge (0.043 against 0.028 with everything off) is gone. Separately by rule: pace alone took p90/p10 to 4.2 and 2.7 (seeds 1, 2), the
founder spread alone to 3.8 and 3.1, armour alone to 3.4 and 2.2. The whole world is slower: the median moving body goes about two thirds as
fast. Over 24,000 steps (seeds 1, 2) the population runs about 15% thinner (cells 380 to 630 against 515 to 820) and the largest body is a
little smaller (12 to 19 cells against 17 to 22); no alarms.

## Not done / open

- The family separation the bar asked for: a per-type speed would need the spread to keep the type's mean, or a bigger type gap.
- If the world now feels slow, the "Top thrust" dial (thrustMax) puts the median back; not tuned.
- The picture was judged on still crops of the movie at page scale (seed 1, steps 6000 to 6240). Seen: idle mouths dusky rose against
  a hot orange-red spot where a mouth feeds, and faint pale sparkles at the rims of grazing cells. Not seen at that scale: the beads and
  the bite mark (a feeding mouth and its prey sit less than a cell apart, so the thread is a few pixels long); they show only zoomed in.
  Eating from the ground is rare in this start (about 6 of 438 cells a step at step 6000, against about 2 feedings by touch), so the
  grazing cue is sparse.

## Review (Codex Sol 6.1 High, runs/softroam/c4/review1.txt)

No kernel defect found: it re-checked the six pins and 250 per-step digests against HEAD for every start (chunk 4 off for bodies), the
Q8 arithmetic, `gotCell` lifecycle and the overlays across both torus seams. It rated the failed family-separation bar a blocker; that is
left failed and reported above rather than tuned to pass. Fixed: the mean-store test now puts a hungry and a full cell in one body; new
tests that `ateFromGround` stays out of the digest, falls to 0 on a bare tile and clears on slot reuse, and that grazing changes the
picture; the probe bins bodies by their size at the look; the contract's mote path matches the code (from about 1.2 tiles in to the rim).
