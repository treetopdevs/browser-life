# Soft Roam chunk 4: speeds that differ, and eating told apart from attacking

2026-11-26. Asked by the user after watching the bodies start: "everything seems to move at the same speed if it's moving. Why is
that, and what can we do to have that be variable? Also ... demarcate eating from attacking ... subtly ... graphically."

## Why every moving body goes at one speed (measured before any change)

`experiments/softroam/speed.ts`, bodies start, seeds 1 and 2, looks at 6000, 7500 and 9000 steps, speed over 10 steps:

| seed | stopped | moving p10 / p50 / p90 (tiles a step) | p90/p10 | by size 1, 2-5, 6-12, 13+ (p50) | herds / groves / packs (p50) |
| --- | --- | --- | --- | --- | --- |
| 1 | 23% | 0.019 / 0.029 / 0.048 | 2.5 | 0.029, 0.029, 0.029, 0.027 | 0.028 / 0.027 / 0.043 |
| 2 | 27% | 0.022 / 0.040 / 0.059 | 2.7 | 0.042, 0.039, 0.040, 0.029 | 0.029 / 0.028 / 0.042 |

Two thirds of the moving bodies sit in one band, 0.025 to 0.05 tiles a step. The arithmetic says why:

1. **Speed is the drive gene and nothing else.** A cell's thrust is its drive gene along the body's heading (u = 2 x drive), and with
   velocity keeping 192/256 of itself the steady speed is u x thrustMax / 1024 units a step: drive 64 gives 0.029 tiles a step (seed 1's
   median), drive 96 gives 0.044 (seed 2's). The founders' drives are 64 (herds, groves) and 96 (packs), and copy errors are rare and
   coarse (step 64), so the world holds two or three drive values.
2. **Size does not matter.** Every cell is its own engine with its own drag, so a 25-cell body goes exactly as fast as one cell.
3. **Nothing about what a body is doing changes its speed.** A body crossing open water, sitting on a full patch or carrying ten shells
   thrusts the same. Only a hunt (the steer aim adds twice the chase gene) lifts a body, and then straight to the thrust cap (0.233).

So a body is stopped (cannot pay, or a leaf-only body), cruising at its founder's speed, or hunting at the cap: three speeds, nothing between.

## The changes (all optional; absent, every earlier world runs the old path and keeps its digest)

1. **`pace`** (share 0 to 1, kernel): a fed body slows down. Its thrust share runs from 1 when its cells' mean store is at minStore to
   `pace` when it is ready to divide (2 birthStore), in proportion between; with `steer`, a body with an aim (hunting or fleeing) never
   slows. Move cost follows the thrust, so resting is cheap. Order-free: a per-body sum of stores, read before anything moves.
   *Changed during the build:* the first plan was `graze` (slow while an eating cell stands on a tile with four bites or more). The probe
   found 3 to 6 bodies in about 250 on such a tile at any look, so it could not change what is seen; bodies' fullness, by contrast, runs
   from about a quarter to full at every look (mean store / 4 birthStore, p10 0.18 to p90 0.51), so a fed-slows rule acts on everyone.
2. **`shellThrust`** (share 0 to 1, kernel): a shell cell thrusts at this share (armour is heavy). A body's speed is the mean of its
   cells' thrust, so a herd with ten shells in 25 is slower than a grove, and a cracked shell (now plain) speeds its body up.
3. **Founder drive spread** (bodies start, not a kernel key): each founder's drive gene is its type's drive times 0.5 to 2 (a draw on
   the seed and the founder's number, rounded to a whole gene), so there is heritable speed for selection to act on from the start.

The bodies start turns on `pace 0.25` and `shellThrust 0.5` and the spread (values to be set by looking; this changes the bodies start's
histories, so NOTE-3's numbers no longer describe the page default). Dials "Speed when well fed", "Shell swimming" and "Founder speeds vary" on the page.

Pass bar (seen seeds 1 and 2 only, same probe, same looks): the moving p90/p10 above 4, the three families' medians apart by more than
a quarter of the smallest. (The third bar, grazing bodies below half the others' median, went with `graze`.) Alarms stay 0 (no cell at the speed clamp for 50 steps).

## The picture: eating against attacking

Attacks are already drawn (a mouth's core brightens and pulses, a red thread to the prey, the prey dims), but every mouth glows red all the
time, so red reads as "this is a mouth", not "this is attacking". Eating from the ground is not drawn at all.

1. **An idle mouth is muted**: a dusky rose membrane, a third of the old core and glow; the full warm red is kept for feeding.
2. **Attack**: beads of matter run along the thread from the prey to the mouth (so the direction shows who eats whom), and a small bite mark,
   a warm crescent, flickers on the prey's rim facing the mouth.
3. **Grazing**: a cell that took food from the ground this step draws in three pale blue motes, the colour of the food haze, spiralling
   in from about 1.2 tiles out and fading as they reach its rim, about 0.45 tiles out (on the dark ground, where they show; drawn into
   the centre they vanished on pale bodies). Cool and inward for eating; warm and along a line for attacking.

The kernel gives the picture what it ate (`ateFromGround(c)`, the matter each cell took from its tile in the last step), picture only:
zeroed when a slot is reused, never in the digest, never read by the rules.

## Checks

- Digests of every pinned start unchanged (softroam-pins); the garden and seasons starts take none of the new keys.
- Unit tests: each key changes nothing when absent or at 1; `pace` follows the mean store and spares a body with an aim; `shellThrust` 1 equals absent;
  slot order does not matter (reverse scan); the config refuses values outside 0 to 1; `ateFromGround` matches the food taken.
- View: the picture is a function of the world and memory; a grazing cell paints differently from the same world with the motes off.
- Probe before and after, ablations (each change alone), a short movie at the page's scale to judge the picture by eye.
- Codex Sol 6.1 High review of the diff; findings fixed or answered in NOTE-4.md.
