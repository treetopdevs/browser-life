# Prototype workflow evidence audit — 24 October 2026

Status: **not yet closed**. The remaining gate is the live Argon 4 High adversarial review of PR83. This document audits the requested workflow and prototype scope; it does not redefine completion as merged or deployed software.

## Requirements and evidence

| Requirement | Inspected evidence | Current conclusion |
|---|---|---|
| Work through planned backlog toward working prototypes of all apps | Seven-surface inventory in [prototype status](prototypes-2026-10-24.md), older inventory, relevant per-surface scope notes and plans001–006 | Concrete missing slices have implementations and validation; explicit research/deployment/human-study boundaries remain separate |
| Plan before each meaningful slice | Per-slice plan/scope notes in each PR; HTML decisions D35–D57 | Decisions describe trigger, chosen scope, validation and limits |
| New worktrees from latest tip | All twelve local source branches contain `b3fab90605401c9cf61822ea4e79839950948d45`; fetched origin/main remains that revision; worktree records identify separate checkouts | Latest remote base verified; unrelated local main/checkouts preserved |
| Implement and validate | Focused source checks plus [exact-head integration report](prototype-integration-2026-10-24.md) | Combined runtime tested; scientific/control fixtures are distinguished from live scientific evidence |
| Commit and open PRs | GitHub PR72–83 OPEN; local heads equal remote heads at audit time | Published; no GitHub merge performed. PR83 explicitly depends on PR74 |
| Adversarial Argon4 High or authorized fallback | Per-slice review dispositions; Argon completed72–82, Sonnet fallback also completed72/73; source-only review83 process still live | **Pending83**; no clean verdict inferred from elapsed time or hosted CodeRabbit status |
| Autofix | Source notes record assessed findings and repairs; PR82 final assertions rerun; PR83 cleanup fixture published in source8d97f03 | Completed findings addressed; await83 review |
| Use subagents | Separate client/server implementation, real-wire smoke, UI-review repairs, integration and independent read-only backlog audits | Delegated results checked against committed source and run evidence |
| Running HTML decision record | [Decision log](decisions-2026-10-17-backlog-run.html), plus integrated D1–D57 exactly once | Source logs preserve their own decisions; integrated history preserves all entries |
| Preserve authorization boundaries | All PRs OPEN; origin/main unchanged; no deployments, public founding, paid work or fresh scientific trials in these slices | Maintained |

## Surfaces and closure evidence

| Surface | Implementation / evidence | Explicit limits |
|---|---|---|
| Lab | Existing WebGPU app plus73 shell donor rank,76 membrane view,77 request receipts,82 wound/drain UI coverage | Labelled supplied suggestions test UI execution, not natural discovery or prediction validity |
| Public site | Existing routes/accessibility;80 fixed404 analytics and sitemap dates;13 combined route/analytics browser checks | Local Caddy/Vite; no live-domain or real screen-reader proof |
| Archipelago | Existing distributed runner/operator app;74 leave,75 counters,78 lease config,83 backoff;148 client,124 targeted backend,3 combined real-wire checks | Lease preservation during throttling best effort; unresolved sent terminal requests retain existing wait semantics |
| Shared garden | Existing local garden;81 food founding option;five launcher tests | Stub-service launcher checks do not establish a collective landing; public opening remains separately gated |
| AI naturalist | Existing bell/notebook/proposer/bench tools and Field notes;77/82 receipt/UI additions | Bellv2 Negative; unapproved bench/model work and v3 science are not silently run |
| Evolution game | Existing Pond keeper v3 plus73/76;combined browser flow | Human three-person playtest remains separate; no autonomous-evolution claim |
| Research instruments | Plans001–006 DONE;72 recovery records and mass-targeted CPU feasibility | V1 stopped after32; feasibility does not authorize or constitute a new severity simulation |

## Exact publication snapshot

GitHub heads were compared with local branches, and all share the fetched remote-main base. These values are point-in-time evidence; later documentation-only updates do not retroactively change run inputs.

| PR | Head at audit | State |
|---|---|---|
|72|`2340d0928d45cac3a3395151e1603a652a85fd1e`|Ready|
|73|`8f28c0156d86cc578e319aca7054fa87b108f2e8`|Ready|
|74|`c572dcd9a2503a8a0d92179c2a299ca40c994a6a`|Ready|
|75|`4a791b105e31638ac3d38be5ca402cc531b04d33`|Ready|
|76|`8f2c200bca7d25a401892a8db182949941a6581a`|Ready|
|77|`95957cbfe9e3aeef1d208232bf31f8c7a985fa1e`|Ready|
|78|`ace5cacab34d07a0f121f0abbb67119dd6ddfc6a`|Ready|
|79|`eba7685799a2770244b13e8fe9f37c2d0eb8ac97`|Ready; hosts this evolving evidence record|
|80|`25f692de0244afd13bdef272fd911c56b543b075`|Ready|
|81|`a2b1f5c84d6443ebf0cdf623bcbba0b106d779bc`|Ready|
|82|`afa9e24aa82171a39fe13cd3bb0c8706048334a1`|Ready|
|83|`8d97f038568549d8d6b80577492061b3205ea22a`|Draft pending Argon; base74|

Local integration is retained at `a89b8a70910cb8287e1dde5fa98bc9d108b87240`, unpushed. Its exact test inputs and incremental scopes are in the report; do not sum test counts into a claim that all suites were rerun on every final documentation commit. The stacked83 runtime and retry assertions match the integrated versions. No remaining prototype implementation slice was identified by the independent source-scope audit, but review closure is still required before claiming this workflow complete.
