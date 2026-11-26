# Engineered ecosystem: 20,000-tick follow-up

Three unchanged staged v4 worlds, seeds 1101–1103, replayed from initialization to 20,000 ticks. All three exactly reproduced the previously recorded 3,000-tick census, including births, deaths, mutations and diversity. No manual interventions or tuning. The original staged introductions and seasonal droughts remain enabled. Model source SHA-256 is retained in each run JSON; base commit `f1f98f3966ec36ec50577deec8a5914a20df8c51`.

## Answer

**The worlds remain active, but mostly settle into recurring ecological regimes rather than continually inventing new strategies.** Seeds 1101 and 1102 sustain five-family competition, shifting spatial fronts and substantial late population swings. Seed 1103 settles into a less varied, Protected-heavy three-family regime. None becomes empty, frozen or a single family during this horizon. This is a descriptive reading of three trajectories, not proof that they will persist indefinitely.

| Seed | Families at 20,000 | Final Jade / Amber / Violet / Protected / Hunter | Late behavior (ticks 15,000–20,000) |
| --- | --- | --- | --- |
| 1101 | 5 | 1106 / 1995 / 1437 / 2834 / 887 | Protected ranges 1791–3599; Hunter 254–1065. Strong continuing swings. |
| 1102 | 5 | 1377 / 1954 / 2096 / 2223 / 614 | Protected ranges 1938–4053; Hunter 298–1272. Strong continuing swings. |
| 1103 | 3 | 0 / 672 / 2116 / 5851 / 0 | Hunter gone by census 640, Jade by 1740. Protected ranges 4673–5851 late, with a relatively stable majority. |

## Change versus novelty

- In the final 5,000 ticks, seeds 1101/1102/1103 have 46,674 / 51,604 / 26,978 mutated births. Mutation has not stopped.
- About 53% / 56% / 30% of sites change family-or-trait class between successive 25-tick frames in that window. This includes births, deaths and movement; it is not an adaptation score.
- Yet only 1 / 1 / 2 previously unobserved family/attack/defense combinations appear in the final 5,000 ticks (100-tick census resolution). Most late mutations revisit familiar combinations. Short-lived combinations between censuses may be missed.
- Within-family trait means still shift: seed 1101 Hunter mean attack moves from 1.52 at tick 15,000 to 1.99 at 20,000, while defense moves from 1.54 to 0.97. That is ongoing change, not evidence that it accumulates beneficial improvements.
- The model permits only 25 attack/defense combinations per founding family. These runs cannot demonstrate open-ended novelty. Periodic droughts also continue to drive change; this run does not separate their contribution from endogenous dynamics.

For an entertaining simulation, seeds 1101 and 1102 remain worthwhile. For richer long-term surprises, the next creative extension would need another heritable behavior or a changing ecological opportunity; merely waiting longer has so far mostly produced remixes of the same strategies.

## Animations and evidence

Open [the animation companion](ecosystem-20k.html) locally. It has all three videos, synchronized restart, playback speed, population charts and **within-family** attack/defense charts. Full-resolution videos and a compact three-world GIF are in `runs/ecosystem-20k/` (gitignored local artifacts). The companion references those local videos and is not a deployed page.

- Video capture: every 25 ticks, 20 frames/second, 801 frames, 40.05 seconds each. This is a time-lapse and does not resolve individual events. No refuge/drought outlines in these renders; those rules remain active.
- GIF comparison: seeds 1101, 1102, 1103 from left to right, 10 fps, same time scale. Colors retain the sandbox's family legend; brightness indicates defense.
- Raw history: `runs/ecosystem-20k/seed-1101.json` (and 1102/1103), every 100 ticks, including all 125 family/trait bins, notices and source hash.
- Compact descriptive results: `ecosystem-20k-summary.json`. No p-values or causal claims.
- Reproduce: Node 24 `node tools/ecosystem/long-run.ts`, then `python3 tools/ecosystem/summarize-long-run.py`. Requires local ffmpeg with libx264. No simulation rules were changed.
