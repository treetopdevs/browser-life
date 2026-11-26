I'm reviewing the plan against the 1201 longevity plan and results and the PR #105/#106 1202 and 1203 artifacts. I read six files, ran no simulations and edited nothing.

**Verdict: no hard blockers.** The schedule, wrapper separation, prefix contract, gates and capacity checks hold up. I'd fix the six points below before freezing, because each leaves a run-time judgment call open.

**What I checked and found sound**
- **Gates and model:** The model hash `7bd5af02…` matches the file on disk. Gates and windows are copied faithfully from the 1201 plan.
- **Prefix contract:** All four historical arms have 151 samples and snapshots indexed 0–4. Keeping the tick-3,000 sample and frame in the prefix compare is right.
- **Capacity:** The four byte counts in the plan match the files on disk exactly. Three times the largest is 14.57 MB, against the 24 MiB limit. I did not verify the node counts or the "about 10 MB" figure for PR #107.
- **Wrappers:** The PR #105 and PR #106 wrappers really are distinct.
  - The kinds are `hungry-shapes-stationary-food-arm` and `hungry-shapes-stationary-food-replication-arm`.
  - The PR #105 runner hard-codes seed 1202 and its own file paths.
  - The 1202 stationary arm records its prefix proof as `not-applicable`, while the moving arm carries a baseline pin to `moving-food-replication-moving-band-seed-1202.json`. The plan's "own frozen check-only runners" wording covers both.

**Fixes before freeze (none block)**
1. **Visual order versus 1203.** The workflow commits visual receipts only after both pairs run. Disclosure of 1202 outcomes happens before 1203, but the plan doesn't say whether the parent's 1202 visual judgment is recorded before 1203 launches. If it comes after, the judgment is made knowing 1203's numbers. State which: record the 1202 receipt before launching 1203, or accept it after and disclose that.
2. **Check-only validation before outcomes.** The 1201 plan said to validate historical records with the check-only path "before new writes". This plan only requires check-only validation before diagnostics. Restore the "before any outcome run" gate. It should also pin the old runner SHAs and their transitive baselines (the `moving-food-replication` 1202 file and the 1203 equivalent).
3. **Partial pairs in the aggregate.** "Each mode's pass count out of two" is undefined when a pair is invalid. Say that completed arms from an invalid pair are disclosed but not tallied, and that pass counts are reported over valid pairs only, as "x of n valid".
4. **Extinction exactly at tick 6,000.** The terminal tick equals the horizon and the terminal flag is true. Say explicitly that this fails "alive at 6,000" and is handled as extinction, not as an on-cadence survivor.
5. **Retry after a limit failure.** A byte or node limit failure is an invalid pair, but the plan also bans raising limits. Say whether a reviewed assay-only repair may change a limit with a disclosed amendment. If not, say the pair closes inconclusive.
6. **Moving-arm confound.** The plan names the stationary coverage confound but not the moving one. The moving band laps at 4,800 and then revisits territory by design. Add one line saying a moving failure after 4,800 mixes revisit effects, so it isn't read as a motion deficit.

`reviews/food-band-longevity-replication-plan-claude.md` is an empty untracked file. I didn't write the review into it because this session is read-only.
