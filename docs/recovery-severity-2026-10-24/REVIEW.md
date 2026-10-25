# Independent planning review

Read-only Sol 6.1 High; no GPU experiments.

Sol 6.1 High review found **three P2 issues to fix before freezing**:

- **Define sham success separately — [PLAN.md:73](PLAN.md#stop-rules-and-permitted-conclusions).** V1 clean recovery requires a lesion and 20–50% destruction ([observer.ts:159](../../experiments/recovery-accessibility/observer.ts#L159)), so reusing it makes every sham fail. Define sham success as ≥90% original target mass at step 2000, with retained continuity and no incoming fusion in both cadence views, excluding injury checks.

- **Fix the rescue denominator — [PLAN.md:76](PLAN.md#stop-rules-and-permitted-conclusions).** The wording selects cases already rescued before asking whether two-thirds were rescued, making that fraction automatically 100%. Use all severe legacy failures as the denominator and their controlled-wound successes as the numerator. Specify whether “at least two” means eligible cases or rescues.

- **Make cadence agreement executable — [PLAN.md:62](PLAN.md#endpoints-fixed-before-launch).** Existing code combines two recovery booleans; after splitting, both trackers can recover while following different daughters. Require equal retained component labels at every shared observation. Prespecify disagreement as disqualifying clean recovery and receiving the T failure penalty.

Otherwise, no scientific blocker found: the bounded three-arm diagnostic addresses the question without another mutation search, and its severity/placement and statistical limitations are appropriately qualified.

The audit reproduces exactly, and saved checkpoint hashes matched their records. No files edited or GPU experiments run.

## Disposition

All three P2 findings accepted and fixed before proposal delivery: sham success now explicitly omits injury requirements; the rescue denominator D includes every severe legacy failure and requires D≥2, A≥2 and 3A≥2D; cadence agreement requires identical retained component labels at every shared observation, with disagreement scored as failure. Engineering schedule checks compare shared physical states and component identities rather than requiring identical times on different observation grids. The reviewer reproduced the audit and verified saved checkpoint hashes.

## PR 72 follow-up: frozen-v1 cadence audit

Both [portable-link feedback](https://github.com/treetopdevs/browser-life/pull/72#discussion_r4368800563) and [cadence-identity feedback](https://github.com/treetopdevs/browser-life/pull/72#discussion_r4368800566) are valid. The citations above now use repository-relative destinations. The cadence issue is an endpoint limitation in the frozen v1 observer: independently successful 25-step and 50-step tracks do not prove that they retained the same daughter after a split.

The [saved-record audit](CADENCE-AUDIT.md) checks every shared observation, including initialization, in all 78 retained v1 cases. Two scientific mutant failures disagree transiently; both already have `R = R_clean = 0`. All 56 scientific clean successes, all calibration controls/replays and all scientific replays agree. Adding an agreement requirement would disqualify **zero** recorded v1 successes, leave both scores at 28/32 per genotype, and preserve `NO-LEAD-IN-FIRST-32`. This retrospective diagnostic does not amend the frozen endpoint or supply fresh scientific evidence.

No v1 observer, protocol, manifest, checkpoint, case record or summary was edited. The severity proposal already requires equal retained labels at every shared observation, plus separate continuity/loss checks; its future runtime and reader must both enforce that guard and test a split where independently recovered tracks select different daughters. That implementation must use its own protocol/observer version before any new scientific launch.
