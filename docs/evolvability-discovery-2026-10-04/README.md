# Discovering worlds that support cumulative evolution

2026-10-04 · Canonical plan after council · Initial release met with stated limits (see [PLAN, Implementation status](PLAN.md#implementation-status)): Stage 1 renewal tooling frozen; Stage 2 renewal-v1 closed with no qualifying habitat (a valid negative, confirmation not earned); D5 decided as pinned execution; the Stage 3a calibration gate passed on two hosts (benchmark and calibration campaigns); Stage 3b's plane gate passed. Sol 6.1 High reviews of Stage 1, Stage 2, the adapter and calibration are kept raw with follow-ups. No evolvability result: nothing from Stage 4 on has run, and the PRD as a whole is not complete

We want to know which worlds let evolution accumulate, and why the others fail. The work keeps three questions apart: what the physics permits (feasibility), whether inherited variation can reach it (accessibility), and whether one gain opens the way to another (opportunity). It measures them with exact, replayable cases and reports a bounded negative as a real result.

## What we will do, in order

1. **Settle boundaries.** One owner in the construction workstream has the renewal experiment (decided 2026-10-04). What remains is fixing how the unlanded construction code is depended on.
2. **Build and run the renewal experiment** in the construction workspace, under its own frozen protocol. Its result and its accounting decide what the first map is about. It runs in parallel with step 3.
3. **Build the workbench now** (decided 2026-10-04), so that compute fans out for the science. First the core: exact case contracts, a CPU runner, an acceptance validator and a reducer, run as shards over a frozen manifest on two machines. Then the plane: a discovery queue on the Phoenix coordinator with browser and command-line workers, wrapped around the same runner, validator and reducer.
4. **Use it twice**, fanned out across machines: for a bounded diagnostic map of rule-1 parameters, and for a conditioned-field test of whether one strategy creates an opportunity for another.
5. **Test selection** among coexisting variants, in a regime where renewal is demonstrated.
6. **Later, each behind its own gate**: an optional comparison of search methods, and comparisons of whole evolving worlds.

The first scientific deliverable is a capability map. It says what the physics permits for a disclosed founder panel. It is not a demonstration of evolvability, and it does not choose worlds for evolutionary study unless a prospective prediction has been tested and has passed.

## Read in order

1. [Research and reuse decisions](RESEARCH.md): external sources, this project's own evidence, exact rule arithmetic and measured costs.
2. [PRD](PRD.md): scientific and operational requirements, and what counts as complete.
3. [Technical design](DESIGN.md): factors, assays, sampling, data contracts, local execution and the distributed plane.
4. [Plan](PLAN.md): the stages, their gates and their stop rules.
5. [Council record](COUNCIL.md): rulings on every contested point, open questions, and the decisions waiting on the user.

Inputs, kept as written: [Fable's addendum](ADDENDUM.md) with its errata, and [Astra's review of it](REVIEW-ASTRA.md).

## What changed from the first proposal

| Change | Reason |
|---|---|
| The renewal experiment no longer waits behind infrastructure. It stays in the construction workspace under one owner and runs in parallel with the workbench build | Its answer decides whether the map has a subject, and one implementation must own it |
| The workbench is built core first, plane second | The plane wraps the core's runner, validator and reducer, so case identity, validation and isolation are proven before leases, restart recovery and the browser route. The council left the plane for later; the user decided to build it now |
| Sampling is by factorial; the search comparison is optional | The first domains are small. Three paired blocks cannot give a one-sided sign-test result below p = 0.125, so that comparison can only be descriptive |
| A conditioned-field opportunity test is added early | It tests the working hypothesis directly, with conservation-defined controls and an inoculum control |
| A predictive bridge gates any use of the map to choose worlds | Two earlier small-world proxies in this project failed in open worlds |
| A sensitivity analysis gates any selection claim | Occupancy and drift in these small worlds are unmeasured |
| RESEARCH now covers this project's own results, exact transport arithmetic and measured costs | The first draft looked outward and at one workspace |

What did not change: the three layers, the frozen protocols and namespaces, the case and result contracts, exact observation acceptance, the primary renewal endpoint, the design of the distributed plane, TypeScript for compute and Phoenix for coordination, no new chemistry by default, and a cloud allowance of zero.

## Status and boundaries

- **Reviews.** Fable's critique and Astra's review of it are complete and reconciled in the council record. Sol 6.1 High reviewed the design set, Stages 3a and 3b, the renewal Stage 1 tooling and Stage 2 run, the pinned adapter and the Stage 3a calibration; each review is kept raw with its follow-ups (`REVIEW-SOL-*.md`), and the last follow-up confirmed every finding closed.
- **Decisions.** D1 (build the workbench now, plane included), D2 (one owner for the renewal experiment) and D6 (the work Mac as second physical host) were taken 2026-10-04. D5 was decided as pinned execution: the frozen construction tree is vendored byte for byte (see [PLAN](PLAN.md#implementation-status)). The rest stay on their defaults in the council record.
- **Implementation.** Stages 3a and 3b are built and passed their gates on two physical hosts, and the Stage 3a calibration gate passed. Stage 1 is frozen and Stage 2 (renewal-v1) closed with no qualifying habitat. Nothing from Stage 4 on has run: [PLAN, Implementation status](PLAN.md#implementation-status).
- **Boundaries.** These documents do not amend frozen experiments, do not run or replace the construction workspace's renewal protocol, do not touch the transition hunt, and do not certify deployed infrastructure. The cases run are the engineering fixtures, the renewal benchmark and calibration campaigns, and imported renewal-v1 evidence; no scientific discovery case has run. No AWS resource was used, and the demonstration coordinator ran privately and has been stopped.
- **Provenance.** The first proposal is commit `7a96fd7`. Hashes, models and sessions are in the council record.
- **Links.** Links into the construction workspace are relative to a main checkout with that workspace beside it, the convention `docs/plan.md` uses. They do not resolve from a nested worktree.
