# Prototype status — 24 October 2026

Seven surfaces, updated after the authorized feature merges on 24 October. Main includes PR72–78 and PR80–83 at `7d91e09fa508ab9407b2c856e7b24c84a8f41b04`; PR79 publishes this status and the final decision record last. The [merge record](prototype-merge-2026-10-24.md) pins the merge commits and fresh checks. No deployment was performed or verified. The release configuration keeps the shared garden private.

[HTML edition](prototypes-2026-10-24.html) · [Previous snapshot](prototypes-2026-10-18.md)

## 1. Lab

**On main:** WebGPU worlds, interventions, checkpoints and replay; Pond keeper weather and whole-world shell share; Field notes and suggestions. Firsts now survive rewind through checkpoint sidecars, and refused Feed/Drain requests are nonfatal. [Pond keeper v3](pond-keeper-v3-2026-10-22.md) and [Field notes](naturalist-field-notes-v0-2026-10-18.md) describe the contracts and their recorded checks.

**Merged PRs:** [#73 shell-based donor ranking](https://github.com/treetopdevs/browser-life/pull/73), [#76 dedicated membrane view](https://github.com/treetopdevs/browser-life/pull/76), and [#77 matching Try receipts to requests](https://github.com/treetopdevs/browser-life/pull/77). Each has focused validation recorded in its PR. A separate [local integration report](prototype-integration-2026-10-24.md) records checks of the exact combined revisions; the corresponding feature changes are now on main.

**Try locally:** `pnpm dev`, then `http://localhost:5173/lab/?world=breeder&seed=1` for Pond keeper or `http://localhost:5173/lab/?world=gradient-m3&seed=1` for Field notes. Open `http://localhost:5173/selftest.html` for GPU/reference checks.

**Merged verification PR:** [#82 naturalist UI coverage](https://github.com/treetopdevs/browser-life/pull/82) adds the Field notes design entry and real wound/drain clicks with visibly labelled test suggestions, narrow-screen checks and session receipts. Adversarial review identified assertion gaps; the fixes passed seven browser checks and a final two-case action-spec rerun. The PR is merged. These fixtures do not establish naturally discovered wound/drain predictions. Hail, shell-respecting Wound, new firsts, and additional weather controls are explicitly deferred in v3, each needing its own rule or replay design.

## 2. Public site

**On main:** Home, Worlds, research journal, explanations, participation, privacy, status and the 404 page. Local accessibility and route checks are recorded in [release checks](release-checks-2026-10-18.md). Journal updates after 18 October already landed; the older prototype snapshot's missing-journal list is stale.

**Try locally:** With `pnpm dev`, open `http://localhost:5173/`, `/worlds/`, `/research/` or `/no-such-page/`. For the built site use `pnpm build`, then `pnpm --filter @bl/lab preview` and the address Vite prints.

**Merged PR:** [#80 public follow-ups](https://github.com/treetopdevs/browser-life/pull/80) normalizes missing-page analytics to `/404` and refreshes sitemap dates. Review is complete. Combined local validation passed all 13 analytics/not-found browser checks, including local Caddy and Vite preview. Live-domain behavior, real devices and screen readers require separate external verification. This page makes no claim about the current production version.

## 3. Archipelago

**On main:** Coordinator scheduling, islands, verification and stitched bundles; rule-picked bred worlds and authenticated operator views. [Bred runs](archipelago-breed-2026-10-18.md) records the supported distributed contract.

**Merged PRs:** [#74 graceful island leave](https://github.com/treetopdevs/browser-life/pull/74) returns leases and unregisters a stopped island; [#75 operator counters](https://github.com/treetopdevs/browser-life/pull/75) shows refusals/pruning with a reset epoch. These address the corresponding old backlog rows.

**Try locally:** `bin/dev` starts lab and coordinator; open `http://localhost:4000/index.html` for operations and `http://localhost:5173/island.html` for an island. Joining an island is an explicit action; it does not start from the homepage. Headless alternative: `deno run -A --no-lock tools/island.ts --coordinator http://localhost:4000`.

**Merged PR:** [#78 configurable lease duration](https://github.com/treetopdevs/browser-life/pull/78) adds `BL_LEASE_MS`; its focused validation and completed independent review are recorded in the PR. Distributed branch runs and hand/model pickers remain explicitly deferred; the existing rule-picker prototype does not promise them.

**Merged PR:** [#83 island backoff](https://github.com/treetopdevs/browser-life/pull/83) retries only explicitly unapplied `429`/`503` responses, with shared cooldown, retained request bytes and cancellable waits. Its initial 138 client tests, 556 backend tests and three real browser/coordinator checks passed. Combined leave validation passed 148 client tests, 124 targeted backend tests and three real wire checks. PR74 merged before PR83, so these cleanup assertions ship together. Argon review is complete and all four findings are addressed. The final source passed 152 client tests and 21 HTTP tests; the combined tree passed 52 affected client tests, 21 HTTP tests and typecheck. The [deployment notes](../deploy/README.md) also leave client-address proxy forwarding, Compose environment additions and the per-address join budget pending a live-host change and verification. These deployment tasks are separate from the merged features above.

## 4. Shared garden

**On main, private:** The local garden has stones, collective food when enabled at founding, sun letters, prediction receipts and verified checkpoint forks. The null-stone control and sun implementation have landed; the older snapshot's corresponding “not built” rows are stale. [Sun letters](garden-sun-2026-10-18.md), [food](garden-food-2026-10-18.md) and [opening checklist](garden-opening-2026-10-18.md) describe the scope.

**Try locally:** `bin/garden-dev`, then `http://localhost:5173/garden/` (or the `LAB_PORT` address the launcher prints). It starts its own lab, coordinator and GPU islands; stop competing local servers first or set PORT/LAB_PORT. Its scratch garden is not a public commons.

**Merged PR:** [#81 local food option](https://github.com/treetopdevs/browser-life/pull/81) adds `GARDEN_FOOD=1` for newly founded local gardens. Review and five launcher tests pass. Existing gardens retain their founding rule; the collective threshold is unchanged. Launcher tests use stub services and do not prove a real collective landing.

**External decision:** Public opening and founding remain separate. The [release configuration](../deploy/README.md) removes garden files, returns 404 for garden routes and disables scheduling. Opening requires deliberate changes and the checklist, not merely switching on one environment variable.

## 5. AI naturalist

**On main:** Rule-based bell, notebook, proposal generation/approval tools, bench tooling, and the lab Field notes UI. [Bell v2](naturalist-bell-v2-2026-10-18.md) is complete with a Negative readout: the post-hoc rule did not replicate. A ring is not proof of emergence.

**Try locally:** Use the lab route above or open the [committed field notebook](examples/field-notebook-2026-10-17-gradient-m3-neutral-seed-15.html). Offline tooling and its data prerequisites are documented in the [proposer note](naturalist-proposer-v0-2026-10-18.md).

**Separate decision/research:** The [bench](naturalist-bench-v0-2026-10-18.md) remains unapproved/unrun in the committed record; paid model part C also needs authorization. A fresh v3 bell is a new scientific protocol, not a missing implementation of v2. Exact-step Try, on-page twins and prediction adjudication are explicitly outside the [suggestion UI v0](naturalist-lab-suggestions-v0-2026-10-18.md).

## 6. Evolution game

**On main:** Pond keeper v3's weather choices, shell-share display, breeding choices, firsts and family tree. Gene v2 and the polymer-world screens have landed; their conclusions remain Unclear/no pass at their stated scope in the [game research record](evolution-game-brainstorm-2026-10-16.md). They are no longer missing code.

**Try locally:** `http://localhost:5173/lab/?world=breeder&seed=1` with `pnpm dev`; the shell-rank and membrane additions are now included on main through PR73/76.

**Separate decision:** The [three-person playtest kit](playtest-kit-2026-10-18.md) uses its own pinned revision and frozen protocol. Human sessions are not replaced by automated browser checks. Hail and new breeding scores are deferred ideas, not silently added completion requirements.

## 7. Research instruments

**On main:** Lineage/pond-route inspection and reports, clade measures, reproducible experiment tools. Clade measures did not pass their pre-stated eligibility rules; that is a recorded result, not a broken app. The [instrument plans](../plans/README.md) mark plans 001–006 done.

**Merged PR:** [#72 recovery evidence and mass-matched feasibility](https://github.com/treetopdevs/browser-life/pull/72). This is a bounded diagnostic with an explicit gate, not a new mutation search or proof of improved recovery. Its evidence and limitations live with that PR.

**Try locally:** The previous snapshot's [research-instrument instructions](prototypes-2026-10-18.html#research-instruments) show the committed lineage fixture and HTML report commands. Large scientific corpora under `runs/` are not included in a fresh clone.

**Deferred research:** Genotype-keyed activity, matched nulls and further recovery experiments need their own protocols. They are not necessary to call the existing instrument implementation complete.

## What remains in this bounded backlog

The planned prototype changes are merged. Fresh verification of the complete feature tree passed 306 unit tests, 575 backend tests, 59 Chrome checks, typecheck and build; the [merge record](prototype-merge-2026-10-24.md) includes exact revisions and the two initial timing failures that passed on quiet rerun. The earlier [integration report](prototype-integration-2026-10-24.md) retains the development-stage evidence. Live-host proxy forwarding, join-budget configuration and deployment remain separate follow-ups. Explicitly deferred features, public opening, human validation and new scientific work remain separate decisions; merging does not establish successful evolution.

The [workflow completion audit](prototype-workflow-audit-2026-10-24.md) maps each requested deliverable to its evidence and remaining external boundaries.

## Evidence and command checks

The original snapshot was a source/PR audit at `b3fab906`, followed by the documented implementation, review, integration and authorized merge workflow. The seven launch paths and commands above were **read** from existing repository instructions and entry points; they are not a claim that every launch command was newly executed. The merge validation did run the bounded engineering tests recorded above; it ran no new scientific experiment or deployment. A fresh checkout needs `pnpm install` and, for coordinator paths, `(cd apps/coordinator && mix deps.get)`. Native GPU commands need a compatible device. Run `pnpm install` before Deno; `--no-lock` in the direct `deno run` command above avoids rewriting its lockfile. The `bin/garden-dev` launcher currently invokes Deno without that flag; check for lockfile changes after using it.

Recorded test results belong to their source notes or PRs. The separate integration report supplies combined-branch verification only for its pinned inputs; its incremental section includes public-page and garden-food work, and later sections include UI-coverage and backoff/leave integration at exact recorded revisions. Validation performed for this snapshot: all relative Markdown and HTML link targets exist, HTML fragment targets resolve, and every HTML section has a unique heading anchor; HTML is generated from the same content. Headless Chrome at 1280px and 375px in both day and night modes showed no horizontal overflow, script errors or external requests; the theme button worked in each case. Axe, including the optional `label-content-name-mismatch` rule, reported zero violations at all four viewport/theme combinations. The theme control exposes its night-mode state with `aria-pressed`. The 375px night screenshot was visually inspected. `git diff --check` passed. These checks validate the status document, not the seven apps. Remote PR state is a point-in-time snapshot and can change.

Argon 4 High source review found no P0/P1 blockers. Its nonblocking findings were addressed: HTML edition/section links, accessible theme state, the omitted runner backoff and live-host proxy follow-ups, port/lockfile wording, and the complete changeset description.
