**Verdict: no hard blockers on the arithmetic or the scope. Two items need your wording before the plan is frozen, plus some smaller clarifications.** I made no edits and ran no simulations. I used 5 file reads, 2 globs, and 2 read-only shell commands (`ls`/`grep` and `shasum`).

## What holds up

- **Smallest scope.** One seed, 3,000 ticks, one exact repeat, one static regression, and no control or other seeds. That is the minimum for this question.
- **Schedule.**
  - 2053 is coprime to 2304, so the 768 slots in each pulse land on distinct tiles.
  - 300 pulses per band × 768 = 230,400 offered units per band, matching the static split total.
  - Pulses at 5–500 feed band 0, then bands alternate every 100 pulses. The late blocks 1500–2000, 2000–2500 and 2500–3000 are fed bands 1, 0, 1, as the plan says.
- **Static regression.** The old artifact is 4.77 MB against the 24 MiB cap, so saving 7 snapshots instead of 5 is safe. I found no snapshot field that would break the exact comparison, as long as the run uses the same Node 24.2.0 darwin/arm64 build. Its snapshots embed `"runtime":"Node 24.2.0"`, and the old runner enforces that build.

## Fix before freezing

1. **Hashes are not in the plan.** The prior plan pinned the model and artifact hashes in its own text; this one names them without values. Add these, which I just computed from the PR110 tip:

   | Item | SHA-256 |
   |---|---|
   | `split-food-replication-seed-1203.json` (raw bytes) | `edc38df48f5d08d198fe59d18a5eb9af0dbd068e37a30a49de82ab91797b5f14` |
   | its `dataSha256` | `d9e546968191c29d35d4e096cc891d0576d68531870643d6f44e144ced35e343` |
   | `split-food-replication-index-1203.json` | `591ebadc051f55f7d8eeb774b9fab4694b820f814f719696029ad900fcde01f3` |
   | `apps/lab/src/split-food/model.ts` (the copy source) | `c6b5c37f20f8daa73858fd9e437d0b25d029c712c065ab11ef495c281b58b506`, which matches the prior plan |
   | `tools/split-food-replication/explore.ts` | `5f60e71043ee4335ff178ed5521897723adf782bc2e3fb17e15a2bb0884c5baf` |
   | `split-food-replication-validation.md` | `22800cadbd42548600909444065853854fd68062a8a636201f2bc415a43a9461` |

   Also state that accepted runs require Node 24.2.0 on darwin/arm64.

2. **"Promising" may be hard to reach, and the plan doesn't say so.**
   - The spatial gate needs at least 10 body tiles in each band at 2,500 and 3,000.
   - The seasonal screen needs the unfed band to lose at least 20 tiles in a block. A band that retreats completely fails the spatial gate.
   - The two gates are compatible, so this isn't a contradiction. But the stated goal is "growth and retreat". Either say that Promising means retreat without local clearance, or relax the continuity requirement for the unfed band. That is your call.

## Smaller clarifications (not blockers)

- **The seasonal bar is weak.** Twenty tiles is less than one 32-cell organism, and any one of three blocks passes. Add a fixed rule now. When the receipt reports the static split 1203 deltas, any block where the static record also shows the same sign pattern means the screen did not discriminate. Report that as a caveat, not a status change.
- **"One qualifying block"** in the manual screen should mean a block that passed the numerical seasonal screen. Otherwise the reviewer can pick a different block.
- **Band names.** State outright that band 0 is columns 0–23 and band 1 is columns 48–71.
- **Unreached seasonal blocks.** Say they fail without extrapolation, as the activity windows do. The plan currently says this only for activity.
- **Environment shape for the new mode.** Specify the following; the 500/505 boundary tests need exact expected values.
  - `targetCount`: 4,608 for the union of both bands, or 2,304 for one band.
  - `foodTargets`: active band only, or both bands.
  - `activeBand`: `pulses==0 ? 0 : floor((pulses-1)/100)%2`.
  - Per-band offered, accepted and overflow counters.
  - These keys must appear only in the new mode. The split-band environment shape must stay unchanged, because the environment is embedded in every sample and snapshot.
- **Snapshot schedules.** The old runner has one `FIXED_SNAPSHOTS` constant (0, 500, 1500, 2500, 3000). The regression needs five snapshots and the outcome needs seven, so the new runner needs two lists.
- **Byte-for-byte wording.** "Keep all old files byte-for-byte" conflicts with "append HTML decision log". Carve out `decisions.html` and any index or README link.
- **"Do not compare against the older contiguous wrapper"** should be scoped to the new runner's regression target. The inherited `--check` chain still validates that wrapper, and a reviewer could read the two statements as contradicting each other.
- **Offered versus accepted food.** The budget parity holds for offered food only. The alternating band offers about 2× the static per-tile rate during its on-block. With a 40-unit tile cap, accepted food will diverge and overflow will appear. The interpretation section should say so.
- **Seed choice.** Seed 1203 was picked because the static split survived on it. A pass on the activity gate is therefore partly inherited from the seed choice, and the plan should say that.

The plan is clear to freeze once items 1 and 2 are resolved and the clarifications above are folded in.
