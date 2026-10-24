# Prototype status — 24 October 2026

Seven surfaces, one bounded snapshot. Main means `b3fab90605401c9cf61822ea4e79839950948d45`; open PR means implemented on a separate branch, not merged. PR states were read from GitHub on 24 October. This audit and the new PR work are local-only: no deployment was performed or verified here. The repository's release configuration keeps the shared garden private.

[HTML edition](prototypes-2026-10-24.html) · [Previous snapshot](prototypes-2026-10-18.md)

## 1. Lab

**On main:** WebGPU worlds, interventions, checkpoints and replay; Pond keeper weather and whole-world shell share; Field notes and suggestions. Firsts now survive rewind through checkpoint sidecars, and refused Feed/Drain requests are nonfatal. [Pond keeper v3](pond-keeper-v3-2026-10-22.md) and [Field notes](naturalist-field-notes-v0-2026-10-18.md) describe the contracts and their recorded checks.

**Open PRs:** [#73 shell-based donor ranking](https://github.com/treetopdevs/browser-life/pull/73), [#76 dedicated membrane view](https://github.com/treetopdevs/browser-life/pull/76), and [#77 matching Try receipts to requests](https://github.com/treetopdevs/browser-life/pull/77). Each has focused validation recorded in its PR. A separate [local integration report](prototype-integration-2026-10-24.md) records checks of the exact combined revisions; they remain unmerged.

**Try locally:** `pnpm dev`, then `http://localhost:5173/lab/?world=breeder&seed=1` for Pond keeper or `http://localhost:5173/lab/?world=gradient-m3&seed=1` for Field notes. Open `http://localhost:5173/selftest.html` for GPU/reference checks.

**Remaining:** Page-level wound/drain suggestion clicks and a 375px open-suggestion check are still verification gaps; worker-level receipts do not substitute for those interactions. A Field notes entry in DESIGN.md remains a documentation follow-up. Hail, shell-respecting Wound, new firsts, and additional weather controls are explicitly deferred in v3, each needing its own rule or replay design.

## 2. Public site

**On main:** Home, Worlds, research journal, explanations, participation, privacy, status and the 404 page. Local accessibility and route checks are recorded in [release checks](release-checks-2026-10-18.md). Journal updates after 18 October already landed; the older prototype snapshot's missing-journal list is stale.

**Try locally:** With `pnpm dev`, open `http://localhost:5173/`, `/worlds/`, `/research/` or `/no-such-page/`. For the built site use `pnpm build`, then `pnpm --filter @bl/lab preview` and the address Vite prints.

**Remaining:** Normalize 404 analytics to a fixed `/404` rather than arbitrary missing paths, and refresh stale sitemap dates. Live-domain behavior, real devices and screen readers require separate external verification. This page makes no claim about the current production version.

## 3. Archipelago

**On main:** Coordinator scheduling, islands, verification and stitched bundles; rule-picked bred worlds and authenticated operator views. [Bred runs](archipelago-breed-2026-10-18.md) records the supported distributed contract.

**Open PRs:** [#74 graceful island leave](https://github.com/treetopdevs/browser-life/pull/74) returns leases and unregisters a stopped island; [#75 operator counters](https://github.com/treetopdevs/browser-life/pull/75) shows refusals/pruning with a reset epoch. These address the corresponding old backlog rows.

**Try locally:** `bin/dev` starts lab and coordinator; open `http://localhost:4000/index.html` for operations and `http://localhost:5173/island.html` for an island. Joining an island is an explicit action; it does not start from the homepage. Headless alternative: `deno run -A --no-lock tools/island.ts --coordinator http://localhost:4000`.

**Open PR:** [#78 configurable lease duration](https://github.com/treetopdevs/browser-life/pull/78) adds `BL_LEASE_MS`; its focused validation is recorded in the PR, and independent review is pending. Distributed branch runs and hand/model pickers remain explicitly deferred; the existing rule-picker prototype does not promise them.

**Remaining:** The runner still stops on `429`/`503` join, next or upload responses; backoff that honours `Retry-After` remains unimplemented. The [deployment notes](../deploy/README.md) also leave client-address proxy forwarding, Compose environment additions and the per-address join budget pending a live-host change and verification. These are separate from the open PRs above.

## 4. Shared garden

**On main, private:** The local garden has stones, collective food when enabled at founding, sun letters, prediction receipts and verified checkpoint forks. The null-stone control and sun implementation have landed; the older snapshot's corresponding “not built” rows are stale. [Sun letters](garden-sun-2026-10-18.md), [food](garden-food-2026-10-18.md) and [opening checklist](garden-opening-2026-10-18.md) describe the scope.

**Try locally:** `bin/garden-dev`, then `http://localhost:5173/garden/` (or the `LAB_PORT` address the launcher prints). It starts its own lab, coordinator and GPU islands; stop competing local servers first or set PORT/LAB_PORT. Its scratch garden is not a public commons.

**Remaining local follow-up:** The launcher has no food configuration option. The mechanism exists, but launcher-created gardens do not enable it.

**External decision:** Public opening and founding remain separate. The [release configuration](../deploy/README.md) removes garden files, returns 404 for garden routes and disables scheduling. Opening requires deliberate changes and the checklist, not merely switching on one environment variable.

## 5. AI naturalist

**On main:** Rule-based bell, notebook, proposal generation/approval tools, bench tooling, and the lab Field notes UI. [Bell v2](naturalist-bell-v2-2026-10-18.md) is complete with a Negative readout: the post-hoc rule did not replicate. A ring is not proof of emergence.

**Try locally:** Use the lab route above or open the [committed field notebook](examples/field-notebook-2026-10-17-gradient-m3-neutral-seed-15.html). Offline tooling and its data prerequisites are documented in the [proposer note](naturalist-proposer-v0-2026-10-18.md).

**Separate decision/research:** The [bench](naturalist-bench-v0-2026-10-18.md) remains unapproved/unrun in the committed record; paid model part C also needs authorization. A fresh v3 bell is a new scientific protocol, not a missing implementation of v2. Exact-step Try, on-page twins and prediction adjudication are explicitly outside the [suggestion UI v0](naturalist-lab-suggestions-v0-2026-10-18.md).

## 6. Evolution game

**On main:** Pond keeper v3's weather choices, shell-share display, breeding choices, firsts and family tree. Gene v2 and the polymer-world screens have landed; their conclusions remain Unclear/no pass at their stated scope in the [game research record](evolution-game-brainstorm-2026-10-16.md). They are no longer missing code.

**Try locally:** `http://localhost:5173/lab/?world=breeder&seed=1` with `pnpm dev`; the shell-rank and membrane additions require PR73/76 branches until merged.

**Separate decision:** The [three-person playtest kit](playtest-kit-2026-10-18.md) uses its own pinned revision and frozen protocol. Human sessions are not replaced by automated browser checks. Hail and new breeding scores are deferred ideas, not silently added completion requirements.

## 7. Research instruments

**On main:** Lineage/pond-route inspection and reports, clade measures, reproducible experiment tools. Clade measures did not pass their pre-stated eligibility rules; that is a recorded result, not a broken app. The [instrument plans](../plans/README.md) mark plans 001–006 done.

**Open PR:** [#72 recovery evidence and mass-matched feasibility](https://github.com/treetopdevs/browser-life/pull/72). This is a bounded diagnostic with an explicit gate, not a new mutation search or proof of improved recovery. Its evidence and limitations live with that PR.

**Try locally:** The previous snapshot's [research-instrument instructions](prototypes-2026-10-18.html#research-instruments) show the committed lineage fixture and HTML report commands. Large scientific corpora under `runs/` are not included in a fresh clone.

**Deferred research:** Genotype-keyed activity, matched nulls and further recovery experiments need their own protocols. They are not necessary to call the existing instrument implementation complete.

## What remains in this bounded backlog

The exact PR72–78 revisions in the [local integration report](prototype-integration-2026-10-24.md) passed 247 focused unit tests, 573 coordinator tests and 41 Chrome checks, plus typecheck and build. They still need repository integration through their open PRs; this local combination did not merge GitHub main. Beyond those PRs, the small concrete follow-ups identified here are local garden food configuration, fixed-path 404 analytics and runner `429`/`503` backoff. Live-host proxy forwarding and join-budget configuration remain a separate deployment follow-up. Documentation/verification follow-ups are sitemap dates, Field notes design documentation, and the two naturalist UI coverage gaps. Explicitly deferred features and external decisions stay visible without becoming automatic new scope. The overall backlog is not declared complete.

## Evidence and command checks

This is a read-only source/PR audit at the named main revision, followed by writing these two status files and updating the README pointer and decision log. The seven launch paths and commands above were **read** from existing repository instructions and entry points; no simulation, coordinator, GPU workload or deployment was run for this snapshot. A fresh checkout needs `pnpm install` and, for coordinator paths, `(cd apps/coordinator && mix deps.get)`. Native GPU commands need a compatible device. Run `pnpm install` before Deno; `--no-lock` in the direct `deno run` command above avoids rewriting its lockfile. The `bin/garden-dev` launcher currently invokes Deno without that flag; check for lockfile changes after using it.

Recorded test results belong to their source notes or PRs. The separate integration report supplies combined-branch verification only for its pinned inputs; later public-page, garden-food and UI-coverage work is outside that run. Validation performed for this snapshot: all relative Markdown and HTML link targets exist, HTML fragment targets resolve, and every HTML section has a unique heading anchor; HTML is generated from the same content. Headless Chrome at 1280px and 375px in both day and night modes showed no horizontal overflow, script errors or external requests; the theme button worked in each case. Axe, including the optional `label-content-name-mismatch` rule, reported zero violations at all four viewport/theme combinations. The theme control exposes its night-mode state with `aria-pressed`. The 375px night screenshot was visually inspected. `git diff --check` passed. These checks validate the status document, not the seven apps. Remote PR state is a point-in-time snapshot and can change.

Argon 4 High source review found no P0/P1 blockers. Its nonblocking findings were addressed: HTML edition/section links, accessible theme state, the omitted runner backoff and live-host proxy follow-ups, port/lockfile wording, and the complete changeset description.
