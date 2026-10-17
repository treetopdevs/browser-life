# Coordinator

To start your Phoenix server:

* Run `mix setup` to install and setup dependencies
* Start Phoenix endpoint with `mix phx.server` or inside IEx with `iex -S mix phx.server`

Now you can visit [`localhost:4000`](http://localhost:4000) from your browser.

## API notes

The JSON API under `/api` is documented where it is implemented: `Coordinator.Queue`'s
moduledoc (scheduling, verification, metrics-version and capability gating, the
experiment spec), `CoordinatorWeb.Router` (the routes) and `CoordinatorWeb.ApiController`
(bodies, uploads, status codes). The repository README has the operator's walk-through.

* `POST /api/experiments` takes the spec: `experiment`, `presetId`, `conditions`, `seeds`,
  `steps`, `segmentSteps`, `censusEvery`, and optionally `deepEvery`, `verifyFraction`,
  `metapopulation` and `interventions`. `interventions` is the headless runner's
  `RunSpec.interventions` (packages/runner/src/interventions.ts): a non-empty array of
  lesions `{"step","kind":"lesion","x","y","r"}` and feeds
  `{"step","kind":"feed","x","y","r","amount"}` by absolute step, steps non-decreasing,
  integers non-negative, a feed's `amount` non-zero within ±4096. A centre outside the
  preset's world (`:world_size` in config.exs), a feed in a pond preset, a feed's
  `matter` (the lab's replay assertion, which the archipelago cannot honour: a value
  the world does not reproduce would throw on every island, and the second island's
  replay is its check), an entry after `steps` and more than 10,000 entries are
  refused with 422, as are the shape errors, each with the runner's own wording. The
  list is stored as given and rides whole in every segment's task spec. A feed that
  would take the world past MATTER_MAX at its step cannot be checked at creation: an
  island that meets one logs it and leaves the task (the lease lapses, the segment is
  offered again), so the experiment waits there rather than crashing islands.
* `POST /api/next` takes `{"capabilities": [...]}`, read per request and never stored:
  `ponds-v1` for a pond preset's experiments, `ponds-v2` as well for the hunt's arms
  (`pond-nat`, `pond-shuf`), `interventions-v1` for an experiment with `interventions`.
  Work an island's list cannot run is skipped, never waited for.
* A verify completion's `observationDigests` may name `interventions.jsonl` beside the
  other optional files (`migrations.tsv`, `exchanges.tsv`, `species.tsv`, `ponds.tsv`);
  the lists in `Coordinator.Segment` and `CoordinatorWeb.ApiController` are pinned to
  `packages/runner/src/stitch.ts`'s `VERIFIED_FILES` by
  `packages/runner/test/coordinator-files.test.ts`, and the preset facts in config.exs
  (`:world_size`, `:pond_presets`, `:pond_period`, `:migration_period`) to
  `packages/schema`'s presets by `packages/runner/test/coordinator-presets.test.ts`.

Ready to run in production? Please [check our deployment guides](https://hexdocs.pm/phoenix/deployment.html).

## Learn more

* Official website: https://www.phoenixframework.org/
* Guides: https://hexdocs.pm/phoenix/overview.html
* Docs: https://hexdocs.pm/phoenix
* Forum: https://elixirforum.com/c/phoenix-forum
* Source: https://github.com/phoenixframework/phoenix
