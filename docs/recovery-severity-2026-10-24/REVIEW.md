# Independent planning review

Read-only Sol 6.1 High; no GPU experiments.

Sol 6.1 High review found **three P2 issues to fix before freezing**:

- **Define sham success separately — [PLAN.md:73](/Users/nicholas/develop/browser-life/docs/recovery-severity-2026-10-24/PLAN.md:73).** V1 clean recovery requires a lesion and 20–50% destruction ([observer.ts:159](/Users/nicholas/develop/browser-life/experiments/recovery-accessibility/observer.ts:159)), so reusing it makes every sham fail. Define sham success as ≥90% original target mass at step 2000, with retained continuity and no incoming fusion in both cadence views, excluding injury checks.

- **Fix the rescue denominator — [PLAN.md:76](/Users/nicholas/develop/browser-life/docs/recovery-severity-2026-10-24/PLAN.md:76).** The wording selects cases already rescued before asking whether two-thirds were rescued, making that fraction automatically 100%. Use all severe legacy failures as the denominator and their controlled-wound successes as the numerator. Specify whether “at least two” means eligible cases or rescues.

- **Make cadence agreement executable — [PLAN.md:62](/Users/nicholas/develop/browser-life/docs/recovery-severity-2026-10-24/PLAN.md:62).** Existing code combines two recovery booleans; after splitting, both trackers can recover while following different daughters. Require equal retained component labels at every shared observation. Prespecify disagreement as disqualifying clean recovery and receiving the T failure penalty.

Otherwise, no scientific blocker found: the bounded three-arm diagnostic addresses the question without another mutation search, and its severity/placement and statistical limitations are appropriately qualified.

The audit reproduces exactly, and saved checkpoint hashes matched their records. No files edited or GPU experiments run.

## Disposition

All three P2 findings accepted and fixed before proposal delivery: sham success now explicitly omits injury requirements; the rescue denominator D includes every severe legacy failure and requires D≥2, A≥2 and 3A≥2D; cadence agreement requires identical retained component labels at every shared observation, with disagreement scored as failure. Engineering schedule checks compare shared physical states and component identities rather than requiring identical times on different observation grids. The reviewer reproduced the audit and verified saved checkpoint hashes.
