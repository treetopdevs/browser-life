defmodule Coordinator.Queue do
  @moduledoc """
  Experiment queue for the archipelago.

  Each run (experiment/preset/condition/seed) is split into segments of a
  fixed number of steps. Segment *k* starts from the end checkpoint (and
  embedded observer state, one artifact — see `Coordinator.Checkpoint`) of
  segment *k - 1* (segment 0 starts from the deterministic initial world), so
  any island can continue any run.

  Integrity:

    * A run completion is bound to the artifact uploaded under *that*
      island's own attempt: `Coordinator.Segment.complete_run/5` requires the
      reported end hash to equal the digest that same attempt itself
      published (`Coordinator.Checkpoint.artifact_digest/1`), never a digest
      left over from a different attempt.
    * A deterministic fraction of segments, and the final segment of every
      run, is replayed by a *different* island (a `:verify` attempt on the
      already-`"done"` segment); physics and observations must both match. A
      mismatch marks the segment `"diverged"` and blocks every later segment
      of the run, `"done"`/`"verified"` ones included.
    * An island (running or verifying) that finds its start checkpoint
      inconsistent rejects it, which invalidates and requeues the producing
      segment (see `handle_call({:reject, ...})`).
    * Metrics-version compatibility (`packages/schema`'s `METRICS_VERSION`,
      e.g. `compressionRatio`'s compressor definition): an island declares
      its own at `join/1` (`:metricsVersion`, missing ⇒ version 1 — an old
      island that predates the field); an experiment records its *required*
      version at creation (`:metrics_version` config, default current);
      `pick_task/4` only offers an experiment's segments (run or verify) to
      an island whose declared version matches (others go idle *for that
      experiment*, not necessarily idle overall). That alone cannot stop an
      island lying about — or simply predating — the concept, so a run
      attempt's completion is bound to the *actual* version of the
      `manifest.json` it uploaded (ground truth: what the runner code that
      produced it actually computed), extracted and size-bounded once,
      *outside* this GenServer, when that file is `PUT`
      (`CoordinatorWeb.ApiController.put_file/2`) — parsing an
      island-controlled upload inside the single serialized queue process
      that every island's joins, heartbeats and assignments share would let
      one slow or oversized manifest stall all of them; see
      `Coordinator.Attempt`'s `manifest_metrics_version` field. A `"run"`
      completion then only compares that already-recorded integer against
      the experiment's required version — no file I/O, no JSON parsing —
      and only after confirming the attempt uploaded its checkpoint at all.

  A `spec["metapopulation"]` groups one preset/condition's seeds into a ring
  (see `build_segments/2`): segment `k + 1` of run *i* additionally imports a
  small cross-run exchange packet from run *i*'s ring-predecessor's segment
  `k` (`Coordinator.Segment.t`'s `import_from`, packages/schema/src/exchange.ts),
  and is only offered once that predecessor segment is itself done or verified
  (the barrier — see `pick_task/4`'s `import_ready?`). `"no-migration"` runs
  within a metapopulation experiment get no `import_from` wiring at all: that
  condition is the metapopulation-level control (same seeds, scheduled with no
  barrier, exactly as if there were no metapopulation). A divergence or reject
  propagates across both same-run and cross-run edges (`Coordinator.Segment`'s
  `dependents_graph/1` + `reachable/2`), not just along one run's own chain.

  Pond experiments (a `presetId` in the `:pond_presets` config, whose worlds
  run the pond cycle — packages/schema/src/presets.ts) are gated by island
  capability. An island lists what its code can run in the body of every
  `/api/next` (`capabilities`, e.g. `["ponds-v1"]`, see
  packages/runner/src/island.ts's `ISLAND_CAPABILITIES`; gating reads the list
  in each request, never a stored one), and `pick_task/4` offers a pond
  experiment's segments, run or verify, only to an island whose request
  carries `"ponds-v1"`. An island
  built before the pond cycle cannot run them, and on a continuation would
  report a valid predecessor as invalid (its runner throws on the unknown
  preset inside the predecessor check). Every other experiment's work still
  flows to every island, and a pond segment waiting for a capable island never
  blocks it. A pond preset also refuses a `metapopulation` at creation: its
  ponds each keep their own matter, which cross-run exchange would break.

  The transition hunt's arms (`WorldConfig.pondArm` `nat` or `shuf`, set by the
  conditions `pond-nat` and `pond-shuf`) need `"ponds-v2"` as well: an island
  that advertises only `"ponds-v1"` cannot run them (its runner throws on the
  arm). The gate is per segment, on its condition, so an experiment that mixes
  them with other conditions still hands those to every `"ponds-v1"` island.
  `"ponds-v2"` is asked for in addition to `"ponds-v1"`, never instead of it
  (`ISLAND_CAPABILITIES` lists both); a `ponds-v1` rule is otherwise unchanged.

  The breeder (`WorldConfig.pondScore`, docs/sandbox-wild.md and
  docs/archipelago-breed-2026-10-18.md) needs `"breed-v1"` as well, again in
  addition to `"ponds-v1"`: a segment, run or verify, whose condition is one of
  the breeder's (`pond-breed-<score>`, `pond-mass-<score>`, `pond-drift-<score>`,
  `@breed_condition_prefixes`), on any pond preset, and every segment of an
  experiment on a preset in config's `:breed_presets` (`breeder`, whose
  `treatment` is the breed arm). Older code has neither the conditions nor the
  score columns and throws on them, and on a continuation would report a valid
  predecessor as invalid, so the controls are gated as well as the arm. Only
  the rule's own donors are distributed: a spec never carries `picked`,
  `pressures` or `branch` (`validate/1` keeps none of them), and an island
  refuses a task that does. A breeder condition on a preset without the pond
  cycle is refused at creation (`incompatible/3`). picks.jsonl is in no
  verified file list and a standard island never writes it for a distributed
  run. The donors the rule chose are in the checkpoint the verifier must
  reproduce; their record, ponds.tsv's `donor` and score columns, is compared
  like any observation file (informational here: a mismatch never changes a
  segment's status), and tools/stitch.ts refuses to export a bred run whose
  record mismatches.

  Scheduled interventions (`spec["interventions"]`, the runner's
  `RunSpec.interventions` -- packages/runner/src/interventions.ts): a list of
  lesions and feeds at absolute steps, the wounds and feedings a lab history
  logs, so that a wounded or fed history can be run and verified by the
  archipelago. `validate/1` holds it to the runner's own shape rules
  (`validateInterventions`: non-empty, exact keys per kind, non-decreasing
  steps, non-negative integers, a feed's amount non-zero within ±4096), and to
  what the runner refuses before the GPU (`interventionsError`): a centre
  inside the preset's world (`:world_size` in config.exs, kept in sync with
  packages/schema's presets by packages/runner/test/coordinator-presets.test.ts)
  and no feed in a pond preset, where each pond's matter is fixed by its cycle.
  An entry after the run's last step is refused too, as tools/run.ts refuses
  it: no segment would apply it. A feed's `matter` (the lab's replay
  assertion: the quanta a logged feed must move again) is refused as well: a
  value the world does not reproduce would throw on every island, and the
  archipelago's own check is the second island's replay. What no creation can
  see is a feed that would take the world past MATTER_MAX, which depends on
  the world's matter at that step; an island that meets one reports the
  segment failed (`fail/4`, `POST /api/segments/:id/fail` with its lease and
  the runner's reason -- packages/runner/src/island.ts) instead of crashing or
  leaving the task to be offered again: `Coordinator.Segment.fail/5` makes
  the segment `"failed"`, a terminal status that records the reason and the
  reporting island, its later segments are blocked as after a divergence, no
  island is offered it again, and `status/0` lists it under `failures`. The
  experiment stops there, visibly, rather than cycling the same failure from
  island to island. The whole list rides unchanged in every
  segment's task spec; the runner applies only the entries a segment owns (an
  entry at step s belongs to the segment that stepped to s, `ownedInterventions`)
  and logs them to interventions.jsonl, a verified file (see
  `Coordinator.Segment`'s `@optional_observation_files`) that tools/stitch.ts
  joins in segment order. Such an experiment's work, run or verify, goes only
  to an island whose request carries `"interventions-v1"`: an older island
  would run the segment clean (its runner knows no such field) and report a
  digest that disagrees with every capable island's, a divergence with no
  real disagreement in it.

  A sun (`"kind": "sun"`, `{step, kind, percent, span}`: packages/schema's
  sun.ts, docs/garden-sun-2026-10-18.md) is a scheduled entry too: the light
  is `percent` of the world's own (one of 50, 75, 125, 150) for `span` steps
  (1..2^24), suns do not overlap, and a sun must end by the run's last step.
  The world rule is `sunError`'s, from the preset's light (`:world_light` in
  config.exs, held to packages/schema's presets by the same test as
  `:world_size`): a percent whose scaled base, amplitude or season would
  exceed 255, or whose sum would, is refused, and a preset missing from the
  map takes no sun. An experiment whose schedule holds a sun goes only to an
  island that also advertises `"sun-v1"`: an island without it would refuse
  the kind, or (older still) run the segment under the world's own light.

  Gardens (`Coordinator.Garden`, README "The garden"): a garden is an ordinary
  one-run experiment (`treatment`, one seed, `segmentSteps` = one day,
  `verifyFraction` 1, `"garden" => true` on its stored spec) plus a record in
  `state.gardens` that this module keeps in step with it. `create_garden/1`
  builds both through the same `validate/1` and `add_experiment/3` an
  experiment uses, so the founding schedule gets the full interventions
  validation. Three things differ from an experiment:

    * Pace. Segments exist for every day from creation, but `pick_task/4`
      offers a garden's segment only once its day is *released*
      (`released?/2`), and `{:next, ...}` is where the release rule runs
      (`release_gardens/2`, right after `Segment.reclaim_stale/3`): a day is
      released when the day before is done or verified and a dawn has passed
      since that day was released, at most one day per ask. Verify tasks are
      never held back (a day can only be done once it was released).
    * Letters. `post_letter/2` and `drop_letter/2` rewrite the experiment's
      `spec["interventions"]` to `Garden.schedule/1` after every change. That is
      the one place an experiment's spec is mutated after creation, and it is
      sound only because of the frontier rule in `Coordinator.Garden`'s
      moduledoc: a task carries the whole list read at assignment time, a
      letter is only ever added to or removed from a day no island has ever
      held, and so the slice of the list that any assigned (or ever-assigned)
      day owns is the same for its run, its replay and a redo.
    * Time. Release times and the view read `Coordinator.Clock`, the same clock
      leases use, so a test that moves it moves both.
    * Food (only in a garden founded with `"food": true`,
      docs/garden-food-2026-10-18.md). `ask_food/3` adds a visitor's hand
      (`Garden.add_hand/5`); the K-th hand of a dawn period calls a food,
      which is stored and scheduled exactly as a letter is. The hands
      themselves (salted hashes, from `Coordinator.LetterLimiter.hand_key/1`)
      live in `s.food_hands`, in memory only: `persist/1` never writes them and
      the view shows only their count, so a restart forgets them (toward no
      food) while a food already called survives in the garden's record. A hand
      that only counts is not persisted at all; a call is.
    * Meteor (only in a garden founded with `"meteor": true`,
      docs/garden-meteor-2026-10-18.md), exactly as food: `ask_meteor/3` adds a
      hand (`Garden.add_hand/6` with `:meteor`), the K-th hand of a dawn period
      calls a meteor (a large lesion at `Garden.meteor_place/2`'s place), and
      the hands live apart from the food hands in `s.meteor_hands`, in memory
      only, dropped, redacted and swept as the food hands are.

  A garden is public, and islands join without credentials, so by default any
  visitor can run, replay, fail or reject a day. Three things bound that. With
  `:garden_island_token` set, `join/1` marks an island `garden: true` only when
  its join body carries `"gardenToken"` equal to it (the token itself is never
  stored, and `join/1` checks it in its caller, so it never reaches this
  process's mailbox or crash reports), and `pick_task/4` then offers a garden's days, to run or to replay,
  only to such islands, which also closes the "second island id replays a forged
  day" path. A failed or diverged day is recoverable: `requeue_garden_day/2`
  (keeper only) sends it and the days it blocked back to the queue. And the
  reject handler refuses to reject a *verified* garden day, so a single
  volunteer cannot roll back history two islands agreed on.

  Each `/api/next` also records, on the asking island's record, a cleaned
  copy of that request's capabilities (`:capabilities`; names matching
  `[a-z][a-z0-9]*(-[a-z0-9]+)*` within 32 bytes, deduplicated and sorted:
  every name the Queue gates on and at most four others; the key is removed
  when nothing is storable, docs/coordinator-hardening-2026-10-18.md). Only
  `status/0` (admin `/api/status`, for the operator page) shows it;
  `island_info/1` drops it. It never grants a task: an island that once
  advertised `"ponds-v1"` and then asks without it is not offered pond work.

  Islands authenticate with a private token issued at join; every assignment
  carries a lease (`Coordinator.Attempt.id`) that must accompany uploads,
  heartbeats and completion. The end checkpoint of every accepted run attempt
  is kept once, content-addressed by its own digest, under
  `data_dir/objects/` (see `Coordinator.Store`) — segment ids never key
  storage themselves. State is persisted to `data_dir/state.bin` after every
  change; see `init/1` for the version tag that refuses to load
  incompatible (pre-v3) data.

  The island table is bounded by `:max_islands` (20,000 by default). At the
  bound a join first reclaims expired leases, then forgets every island that
  never ran or verified anything, holds no pending attempt and was last seen
  more than `:island_prune_after_ms` ago (a day); if there is none, the
  least recently seen such islands last seen more than
  `:island_prune_grace_ms` ago (ten minutes), a twentieth of the bound at once
  (an island waiting for work asks every few seconds, so a flood of joins that
  never ask forgets itself first, and an island that has just joined, or is
  waiting for work, is never forgotten to make room for another). Only when no
  island qualifies is the join refused (`{:error, :full}`, the controller's
  503), and then nothing is persisted. An island holds at most `:island_max_pending`
  pending attempts (4); past that `{:next, ...}` answers idle, so one island
  cannot squat on the queue's work. How often an address may join, and how
  often an island may ask for work or touch a segment, is limited before this
  process is called (`Coordinator.IslandLimiter`).
  """
  use GenServer
  require Logger
  alias Coordinator.{Attempt, Garden, GardenLeaders, Segment, Store}

  # Leases expire after this long without a heartbeat (configurable for tests).
  # Public because the garden's view must know when a lease it finds is dead
  # (the queue only reclaims when an island asks for work).
  @doc "How long a lease lives without a heartbeat, in ms."
  def lease_ms, do: Application.get_env(:coordinator, :lease_ms, 10 * 60 * 1000)
  @max_segments 100_000
  # An island that hasn't called `/api/next` or sent a valid heartbeat in
  # this long is flagged `stale` in `status/0` -- e.g. a browser tab whose
  # page reloaded and dropped back to the Join screen without anyone
  # noticing (see the auto-rejoin in apps/lab). Purely a status-page hint: it
  # doesn't affect scheduling. Public so tests can assert against the actual
  # threshold instead of a copy of the literal.
  @stale_ms 2 * 60 * 1000
  def stale_ms, do: @stale_ms

  @doc "Whether `last_seen` (ms since epoch) is stale as of `now` (defaults to the real clock). A pure function of both timestamps (rather than reading the clock internally) so tests can pin the exact threshold -- exclusive, `>` not `>=` -- without a wall-clock race."
  def stale?(last_seen, now \\ now()), do: now - last_seen > @stale_ms
  # Bumped whenever `state.bin`'s shape changes incompatibly (see `init/1`).
  # A failed segment (`Coordinator.Segment.fail/5`) extends the v3 shape the
  # way `import_from`, `observations` and `manifest_metrics_version` did: a
  # new status value and two keys (`:reason`, `:failed_at`) put only on the
  # failed attempt, so a file without one is byte-identical to before and a
  # file from before loads unchanged. The other direction is not supported,
  # as it was not for those keys: a coordinator from before this change,
  # whose modules name neither atom, refuses a state.bin holding a failed
  # attempt (`[:safe]` decoding, see `init/1`), so rolling the code back
  # after a failure was persisted means starting from a fresh data dir.
  #
  # Gardens extend it the same way: a top-level `:gardens` key
  # (`Coordinator.Garden`'s records), put on load when a file from before has
  # none (`init/1`) and left out of the file again while there are no gardens
  # (`persist/1`), so a coordinator that never founded one writes byte-for-byte
  # the file it always did. The other direction is not supported either: a
  # pre-garden coordinator refuses a state.bin holding a garden (its modules
  # name none of the garden's atoms, `[:safe]` decoding), so rolling the code
  # back after one was founded means starting from a fresh data dir.
  #
  # An island's recorded capabilities extend it the same way: an island key
  # (`:capabilities`, a list of strings) put only while the island's last
  # `/api/next` advertised something storable, so a coordinator whose islands
  # never did writes the file it always did, and a file from before loads
  # unchanged. The other direction is not supported either: a coordinator from
  # before this change, decoding a file that holds one, either refuses it
  # (`[:safe]` decoding, if no loaded module names `:capabilities` yet) or
  # loads it and passes the stale list through its `/api/status` and
  # `/api/islands/me`, so rolling the code back after an island advertised a
  # capability means starting from a fresh data dir.
  @state_version 3
  # The longest failure reason stored and shown: 500 graphemes
  # (packages/runner/src/island.ts sends at most 500 characters, as it does
  # for a reject's reason) and, since a grapheme can be one base character
  # under any number of combining marks, 2000 bytes (four per codepoint at
  # most) -- the bound a persisted and listed string actually needs.
  @max_failure_reason 500
  # Leaders tasks running at once (`start_leaders/4`).
  @leaders_max 2
  @max_failure_reason_bytes 2000

  # ---- client API ----

  def start_link(opts),
    do: GenServer.start_link(__MODULE__, opts, name: Keyword.get(opts, :name, __MODULE__))

  # The garden token is checked here, in the caller, and taken out of `info`
  # before the call: the Queue's mailbox, its crash reports (which print the
  # last message) and its state never see it, only whether it matched.
  def join(info) do
    garden = garden_token_ok?(info)
    info = if is_map(info), do: Map.delete(info, "gardenToken"), else: info
    GenServer.call(__MODULE__, {:join, info, garden})
  end

  def authenticate(island, token), do: GenServer.call(__MODULE__, {:auth, island, token})

  @doc "Public info for an already-authenticated island (never the token/token_hash); a read, not a claim -- see ApiController.me/2. Doesn't touch last_seen: authenticate/2 doesn't either, and this shouldn't add state a bare probe wouldn't otherwise have."
  def island_info(id), do: GenServer.call(__MODULE__, {:island_info, id})
  def create_experiment(spec), do: GenServer.call(__MODULE__, {:create, spec})

  @doc """
  Founds a garden (admin; `params` as `POST /api/gardens` takes them, string
  keys): validates the garden's own parameters, builds the one-run experiment
  underneath and runs it through `validate/1`, then creates both. `{:ok, days}`
  or `{:error, why}`; a name that is already an experiment or a garden is an error.
  """
  def create_garden(params), do: GenServer.call(__MODULE__, {:create_garden, params})

  @doc """
  Posts a letter (`%{x:, y:, r:}`, a stone; the shape is `Garden.parse_letter/1`'s
  and is re-checked here) to garden `name`, at the queue's own clock. `{:ok,
  letter_view}`, `{:error, :not_found}`, `{:error, {:invalid, msg}}` (a centre
  outside the world, 422) or `{:error, {:refused, msg}}` (the garden takes no
  letters now, 409).
  """
  def post_letter(name, letter), do: GenServer.call(__MODULE__, {:post_letter, name, letter})

  @doc """
  A visitor's hand on garden `name`'s food ask, at the queue's own clock. `key`
  is `Coordinator.LetterLimiter.hand_key/1`'s `{incarnation, hash}`.

    * `{:ok, :counted, nil | food_view, food_block}`: counted (and, on the K-th
      hand, the food it called);
    * `{:ok, :repeat, food_block}`: this network's hand is already in;
    * `{:error, {:closed, code, opens_at_day, words}}`: the ask is closed;
    * `{:error, :stale}`: `key` is of a limiter incarnation that is gone (the
      limiter restarted while the call waited); nothing was counted;
    * `{:error, :not_found}`: no such garden.

  The call exits after `timeout` ms like any `GenServer.call/3`; its exit
  reason holds `key`, so the caller catches it (`CoordinatorWeb.GardenController`).
  """
  def ask_food(name, key, timeout \\ 5_000),
    do: GenServer.call(__MODULE__, {:ask_food, name, key}, timeout)

  @doc """
  A visitor's hand on garden `name`'s meteor ask, as `ask_food/3` is for food
  (the same answers, with the meteor's view and the meteor block in place of
  the food's). The meteor hands are kept apart from the food hands.
  """
  def ask_meteor(name, key, timeout \\ 5_000),
    do: GenServer.call(__MODULE__, {:ask_meteor, name, key}, timeout)

  @doc "The keeper's veto: drops letter or food `id` of garden `name` if its day was never assigned. `{:ok, view}` (a letter's or a food's), `{:error, :not_found}` or `{:error, {:refused, msg}}`."
  def drop_letter(name, id), do: GenServer.call(__MODULE__, {:drop_letter, name, id})

  @doc "The garden's public view (`garden-v1`, see `Coordinator.Garden.view/5`) as an atom-key map, or `nil` for an unknown garden. Built inside this process in O(days + letters); callers serving the public hold their own short-lived cache (`Coordinator.LetterLimiter`)."
  def garden_view(name), do: GenServer.call(__MODULE__, {:garden_view, name})

  @doc "The path of the stored checkpoint with this digest, only if it is the accepted digest of a *verified* day of garden `name` (and a 16-hex digest, and on disk); else `nil`."
  def garden_checkpoint(name, digest),
    do: GenServer.call(__MODULE__, {:garden_checkpoint, name, digest})

  @doc "Every servable checkpoint of garden `name` as `%{digest => path}` (the verified prefix's end checkpoints that are on disk), or `%{}` for an unknown garden. One call serves a whole cache period of requests (`Coordinator.LetterLimiter`)."
  def garden_checkpoints(name), do: GenServer.call(__MODULE__, {:garden_checkpoints, name})

  @doc """
  The keeper's recovery: puts a *failed* or *diverged* day of garden `name` back
  in the queue (`Segment.redo/2`: the days it blocked return to waiting). The
  day's attempts are kept, so the slice of the schedule it owns stays frozen.
  `{:ok, "pending"}`, `{:error, :not_found}` or `{:error, {:refused, msg}}`.
  """
  def requeue_garden_day(name, index),
    do: GenServer.call(__MODULE__, {:requeue_garden_day, name, index})

  @doc "Claims the next task for `island`. `capabilities` is the list the island sent with this request (see the moduledoc); it gates pond work for this request alone, and a cleaned copy is recorded on the island for `status/0`, never read by gating."
  def next_task(island, capabilities \\ []) when is_list(capabilities),
    do: GenServer.call(__MODULE__, {:next, island, capabilities})

  def heartbeat(seg_id, island, lease),
    do: GenServer.call(__MODULE__, {:heartbeat, seg_id, island, lease})

  @doc """
  kind is "run" or "verify"; `end_hash` is `artifactDigest` (physics +
  observer), the same digest a run attempt's checkpoint was published under.
  `observation_digests` (optional; only meaningful for a `"verify"`
  completion) is the `{name => SHA-256}` of the observation files the
  verifying island regenerated — see `Coordinator.Segment.complete_verify/5`.
  """
  def complete(seg_id, island, lease, kind, end_hash, summary, observation_digests \\ nil),
    do:
      GenServer.call(
        __MODULE__,
        {:complete, seg_id, island, lease, kind, end_hash, summary, observation_digests}
      )

  @doc "`predecessor` is \"own\" (the same run's prior segment — the default) or \"import\" (this segment's cross-run `import_from` source, for a metapopulation) — which one this island found inconsistent."
  def reject(seg_id, island, lease, reason, predecessor \\ "own"),
    do: GenServer.call(__MODULE__, {:reject, seg_id, island, lease, reason, predecessor})

  @doc """
  The island holding `seg_id`'s current run or verify lease cannot run the
  task as given (see the moduledoc on scheduled interventions): the segment
  becomes `"failed"` with `reason` (a string; stored bounded to
  #{@max_failure_reason} graphemes and #{@max_failure_reason_bytes} bytes,
  anything else counting as none) and the reporting island recorded, and
  every segment reachable from it is blocked, as after a divergence. Refused,
  like a reject, unless `lease` is the segment's current attempt under
  `island`.
  """
  def fail(seg_id, island, lease, reason),
    do: GenServer.call(__MODULE__, {:fail, seg_id, island, lease, reason})

  @doc "Publishes a validated checkpoint into the content-addressed store, if `lease` is still the segment's current run attempt."
  def publish_checkpoint(seg_id, island, lease, staged, digest, state_hash),
    do:
      GenServer.call(
        __MODULE__,
        {:publish_checkpoint, seg_id, island, lease, staged, digest, state_hash}
      )

  @doc """
  Publishes a bundle file (content-addressed by `sha`, its SHA-256) and
  records it on `seg_id`'s run attempt, if `lease` is still current.
  `metrics_version` (optional; meaningful only for `name == "manifest.json"`)
  is that manifest's own already-extracted, already-validated
  `metricsVersion` field — the caller (`CoordinatorWeb.ApiController.put_file/2`)
  parses it outside this GenServer under a manifest-specific size limit, so
  this call never itself reads or decodes the upload.
  """
  def publish_file(seg_id, island, lease, staged, name, sha, metrics_version \\ nil),
    do:
      GenServer.call(
        __MODULE__,
        {:publish_file, seg_id, island, lease, staged, name, sha, metrics_version}
      )

  def status, do: GenServer.call(__MODULE__, :status)

  @doc "Aggregate counts for the public status page without building detailed run or island records."
  def public_status, do: GenServer.call(__MODULE__, :public_status)

  @doc "An experiment's spec and every segment in run order, with its accepted digest and producing/verifying hosts (`nil` if unknown)."
  def experiment(name), do: GenServer.call(__MODULE__, {:experiment, name})
  def segment(seg_id), do: GenServer.call(__MODULE__, {:segment, seg_id})
  def data_dir, do: GenServer.call(__MODULE__, :data_dir)

  @doc "Directory for a segment's bundle files (server-generated id only; not content-addressed)."

  # ---- server ----

  @impl true
  def init(opts) do
    dir = Path.expand(Keyword.fetch!(opts, :data_dir))
    File.mkdir_p!(dir)

    # `:erlang.binary_to_term(_, [:safe])` refuses to create atoms it hasn't
    # already seen — safe only for atoms some *already-loaded* module's own
    # compiled code happens to mention. `Coordinator.Queue` (this module) is
    # trivially loaded already (its own `init/1` is what's running), so its
    # own literal atoms (`:version`, `:experiments`, `:segments`, ...) are
    # fine either way; `Attempt`/`Segment`'s atoms (`:uploaded_digest`,
    # `:heartbeat_at`, ...) live only in *their* modules, which nothing has
    # forced the code server to load yet on a cold boot — ensure they are,
    # before the decode below, or a fresh process (unlike a warm `mix test`
    # VM where some earlier test already touched these modules) refuses to
    # load a state.bin containing any in-flight attempt.
    Code.ensure_loaded!(Coordinator.Attempt)
    Code.ensure_loaded!(Coordinator.Segment)
    # The garden's persisted atoms (`:steps_per_day`, `:letters`, `:dropped_at`,
    # ...) live only in this module: same reason.
    Code.ensure_loaded!(Coordinator.Garden)
    # And the leaders blocks' (`:livingCells`, `:clearLeader`, ...): theirs.
    Code.ensure_loaded!(Coordinator.GardenLeaders)

    state =
      case File.read(Path.join(dir, "state.bin")) do
        {:ok, bin} ->
          case :erlang.binary_to_term(bin, [:safe]) do
            %{version: @state_version} = s ->
              s |> Map.put_new(:gardens, %{}) |> clean_recorded_capabilities()

            _ ->
              raise """
              coordinator: #{Path.join(dir, "state.bin")} is not v#{@state_version} state.
              This is pre-launch infrastructure with no production data to migrate: \
              delete #{dir} to start fresh against this branch.
              """
          end

        _ ->
          %{
            version: @state_version,
            experiments: %{},
            segments: %{},
            islands: %{},
            next_seg: 1,
            gardens: %{}
          }
      end

    # Tell the web layer which gardens exist and how big their worlds are, so
    # it can answer an unknown name or an out-of-world letter without a call
    # into this process (`Coordinator.LetterLimiter`).
    Coordinator.LetterLimiter.set_gardens(
      Map.new(state.gardens, fn {name, g} -> {name, {g.width, g.height}} end)
    )

    # The food hands are never persisted (`persist_drops/1`): a restart starts
    # every garden's ask from zero. Hands of a past dawn period are forgotten
    # by a sweep, not only when the next hand comes.
    schedule_hands_sweep()
    # A verified day whose leaders block was never counted, or whose task died
    # with the last Queue, is counted now (docs/garden-predictions-2026-10-18.md).
    {:ok,
     state
     |> Map.put(:dir, dir)
     |> Map.put(:food_hands, %{})
     |> Map.put(:meteor_hands, %{})
     |> Map.put(:leaders_tasks, %{})
     |> Map.put(:leaders_waiting, wait_new())
     |> reindex()
     |> start_leaders_at_boot()}
  end

  # The food hands are salted hashes kept in memory only (docs/garden-food-2026-10-18.md,
  # section 5): no crash report, `:sys.get_status/1` or debug log shows them, only
  # each garden's count. (`:sys.get_state/1` still returns the raw state.)
  @impl true
  def format_status(status) do
    status
    |> redact_status(:state, fn
      %{food_hands: hands} = s ->
        s = %{s | food_hands: Map.new(hands, fn {n, h} -> {n, hands_summary(h)} end)}

        case s do
          %{meteor_hands: m} ->
            %{s | meteor_hands: Map.new(m, fn {n, h} -> {n, hands_summary(h)} end)}

          _ ->
            s
        end

      other ->
        other
    end)
    |> redact_status(:message, fn
      {:ask_food, name, _key} -> {:ask_food, name, :redacted}
      {:ask_meteor, name, _key} -> {:ask_meteor, name, :redacted}
      other -> other
    end)
    |> redact_status(:log, fn _log -> [] end)
  end

  defp redact_status(status, key, fun) when is_map_key(status, key),
    do: Map.update!(status, key, fun)

  defp redact_status(status, _key, _fun), do: status

  # A leaders task's answer (`start_leaders/3`): kept only if its token is still
  # the day's and the day's accepted run attempt is the one it read
  # (`Garden.accept_leaders/6`); a late one is dropped. A day that arrives `ok`
  # may let the next day's lines be counted (`Garden.leaders_followups/3`).
  # The task's slot is freed by its `:DOWN`, never here, so a dropped answer
  # cannot leak one.
  @impl true
  def handle_cast({:garden_leaders, name, day, token, attempt, result}, s) do
    case take_leaders(s, name, day, token, attempt, result) do
      {:ok, s} -> {:noreply, persist(s)}
      :stale -> {:noreply, s}
    end
  end

  # Every garden's hands of a past dawn period, or of another limiter
  # incarnation, are dropped (so the hashes are forgotten within a sweep of the
  # dawn, whether or not anyone asks again).
  @impl true
  def handle_info(:expire_hands, s) do
    schedule_hands_sweep()
    now = now()
    epoch = Coordinator.LetterLimiter.hand_epoch()

    keep = fn all ->
      for {name, h} <- all,
          g = s.gardens[name],
          g != nil and h.epoch == epoch and h.dawn == Garden.dawn_index(g, now),
          into: %{},
          do: {name, h}
    end

    {:noreply, %{s | food_hands: keep.(s.food_hands), meteor_hands: keep.(s.meteor_hands)}}
  end

  # A leaders task ended (`start_leaders/4`): its slot is free, and the next
  # waiting day starts. A task always casts its answer before it exits, so an
  # answer is never behind its own `:DOWN`; a task that died without answering
  # (killed, say for memory) makes its day `unreadable` if the day still waits
  # on it, and a later start counts it again (`Garden.leaders_to_start/2`).
  def handle_info({:DOWN, mref, :process, _pid, reason}, s)
      when is_map_key(s.leaders_tasks, mref) do
    {{name, day, token, attempt}, tasks} = Map.pop(s.leaders_tasks, mref)
    s = %{s | leaders_tasks: tasks}

    s =
      with true <- reason != :normal,
           _ =
             Logger.warning(
               "queue: leaders task for #{name} day #{day} died: #{inspect(reason, limit: 5)}"
             ),
           {:ok, s} <- take_leaders(s, name, day, token, attempt, {:error, :task_died}) do
        s
      else
        _ -> s
      end

    {:noreply, s |> drain_leaders() |> persist()}
  end

  # As GenServer's default does, an unexpected message is worth a warning (a
  # late reply, a stray monitor). No hand key travels in a message to this
  # process except inside `{:ask_food, ...}` and `{:ask_meteor, ...}` calls,
  # which never land here.
  def handle_info(other, s) do
    Logger.warning("queue: ignoring an unexpected message #{inspect(other, limit: 5)}")
    {:noreply, s}
  end

  defp schedule_hands_sweep,
    do:
      Process.send_after(
        self(),
        :expire_hands,
        Application.get_env(:coordinator, :garden_hands_sweep_ms, 60_000)
      )

  @impl true
  def handle_call({:join, info, garden}, _from, s) do
    case make_room(s) do
      {:ok, s} -> join_island(info, garden, s)
      :full -> {:reply, {:error, :full}, s}
    end
  end

  def handle_call({:auth, id, token}, _from, s) do
    ok =
      case s.islands[id] do
        %{token_hash: h} when is_binary(token) ->
          Plug.Crypto.secure_compare(h, :crypto.hash(:sha256, token))

        _ ->
          false
      end

    {:reply, ok, s}
  end

  def handle_call({:island_info, id}, _from, s) do
    # The recorded capabilities are the operator's (`status/0`) alone.
    info = s.islands[id] && Map.drop(s.islands[id], [:token_hash, :capabilities])
    {:reply, info, s}
  end

  def handle_call({:create, spec}, _from, s) do
    with {:ok, spec} <- validate(spec),
         {:ok, s, count} <- add_experiment(s, spec, now()) do
      {:reply, {:ok, count}, persist(s)}
    else
      {:error, why} -> {:reply, {:error, why}, s}
    end
  end

  def handle_call({:create_garden, params}, _from, s) do
    now = now()

    with {:ok, spec, gparams} <- garden_spec(params),
         :ok <- garden_name_free(s, spec["experiment"]),
         {:ok, s, count} <- add_experiment(s, spec, now) do
      s = put_in(s, [:gardens, spec["experiment"]], Garden.new(gparams, now))
      Coordinator.LetterLimiter.register_garden(spec["experiment"], gparams.width, gparams.height)
      {:reply, {:ok, count}, persist(s)}
    else
      {:error, why} -> {:reply, {:error, why}, s}
    end
  end

  def handle_call({:post_letter, name, letter}, _from, s) do
    with %{} = g <- s.gardens[name],
         {:ok, letter} <- garden_letter(letter),
         segs = garden_segs(s, g),
         {:ok, g, record} <- Garden.post_letter(g, letter, segs, now()) do
      s = store_garden(s, g)
      {:reply, {:ok, Garden.letter_view(g, record, segs)}, persist(s)}
    else
      nil -> {:reply, {:error, :not_found}, s}
      {:error, _} = error -> {:reply, error, s}
    end
  end

  def handle_call({:drop_letter, name, id}, _from, s) do
    with %{} = g <- s.gardens[name],
         segs = garden_segs(s, g),
         {:ok, g, record} <- Garden.drop_letter(g, id, segs, now()) do
      s = store_garden(s, g)
      {:reply, {:ok, Garden.record_view(g, record, segs)}, persist(s)}
    else
      nil -> {:reply, {:error, :not_found}, s}
      {:error, _} = error -> {:reply, error, s}
    end
  end

  def handle_call({:ask_food, name, {epoch, hash} = key}, _from, s) when is_binary(hash) do
    case s.gardens[name] do
      nil ->
        {:reply, {:error, :not_found}, s}

      # A key made before a limiter restart (a call that waited in this
      # process's mailbox meanwhile) is of a salt that is gone: counting it
      # could add a network twice, so the caller is told to retry.
      g ->
        if epoch == Coordinator.LetterLimiter.hand_epoch(),
          do: ask_act(s, g, name, key, :food),
          else: {:reply, {:error, :stale}, s}
    end
  end

  # A direct caller's malformed key is no hand at all.
  def handle_call({:ask_food, _name, _key}, _from, s), do: {:reply, {:error, :not_found}, s}

  # A meteor hand, as a food hand (above).
  def handle_call({:ask_meteor, name, {epoch, hash} = key}, _from, s) when is_binary(hash) do
    case s.gardens[name] do
      nil ->
        {:reply, {:error, :not_found}, s}

      g ->
        if epoch == Coordinator.LetterLimiter.hand_epoch(),
          do: ask_act(s, g, name, key, :meteor),
          else: {:reply, {:error, :stale}, s}
    end
  end

  def handle_call({:ask_meteor, _name, _key}, _from, s), do: {:reply, {:error, :not_found}, s}

  def handle_call({:garden_view, name}, _from, s) do
    view =
      case s.gardens[name] do
        nil ->
          nil

        g ->
          env = %{
            lease_ms: lease_ms(),
            stale_ms: @stale_ms,
            letters_per_address:
              Application.get_env(:coordinator, :garden_letters_per_address, 3),
            food_hands: s.food_hands |> Map.get(name) |> hands_summary(),
            meteor_hands: s.meteor_hands |> Map.get(name) |> hands_summary(),
            food_epoch: Coordinator.LetterLimiter.hand_epoch(),
            shared_address: shared_address?()
          }

          Garden.view(g, garden_segs(s, g), s.islands, now(), env)
      end

    {:reply, view, s}
  end

  # Only the accepted digest of a day that was verified by a matching replay,
  # and only a 16-hex digest (an island chooses the digest it publishes under,
  # and it becomes a path component here).
  def handle_call({:garden_checkpoint, name, digest}, _from, s) do
    path =
      with %{} = g <- s.gardens[name],
           true <- is_binary(digest) and Regex.match?(~r/^[0-9a-f]{16}$/, digest),
           true <- Garden.verified_digest?(g, garden_segs(s, g), digest),
           true <- Store.exists?(s.dir, digest) do
        Store.path(s.dir, digest)
      else
        _ -> nil
      end

    {:reply, path, s}
  end

  def handle_call({:garden_checkpoints, name}, _from, s) do
    checkpoints =
      case s.gardens[name] do
        nil ->
          %{}

        g ->
          for digest <- Garden.verified_digests(garden_segs(s, g)),
              is_binary(digest),
              Regex.match?(~r/^[0-9a-f]{16}$/, digest),
              Store.exists?(s.dir, digest),
              into: %{},
              do: {digest, Store.path(s.dir, digest)}
      end

    {:reply, checkpoints, s}
  end

  def handle_call({:requeue_garden_day, name, index}, _from, s) do
    with %{} = g <- s.gardens[name],
         id when not is_nil(id) <- s.index[{Garden.run_id(g), index}],
         %{status: status} when status in ["failed", "diverged"] <- s.segments[id] do
      Logger.warning("garden #{name} day #{index} (#{status}) requeued by the keeper")
      s = %{s | segments: Segment.redo(s.segments, id)}
      {:reply, {:ok, "pending"}, persist(s)}
    else
      %{status: status} ->
        {:reply,
         {:error,
          {:refused, "day #{index} is #{status}; only a failed or diverged day is requeued"}}, s}

      _ ->
        {:reply, {:error, :not_found}, s}
    end
  end

  # An island forgotten at the island bound (`make_room/1`) between the
  # controller's authentication and this call: nothing to record it against,
  # so it is idle (its next request fails authentication).
  def handle_call({:next, island_id, _capabilities}, _from, %{islands: islands} = s)
      when not is_map_key(islands, island_id),
      do: {:reply, {:ok, %{kind: "idle"}}, s}

  def handle_call({:next, island_id, capabilities}, _from, s) do
    now = now()

    s =
      %{s | segments: Segment.reclaim_stale(s.segments, now, lease_ms())}
      |> put_in([:islands, island_id, :last_seen], now)
      # For the operator page only (`status/0`): gating below reads the
      # request's own list, never this copy.
      |> update_in([:islands, island_id], &record_capabilities(&1, capabilities))
      |> release_gardens(now)

    {task, s} =
      if at_pending_cap?(s, island_id),
        do: {%{kind: "idle"}, s},
        else: pick_task(s, island_id, capabilities, now)

    {:reply, {:ok, task}, persist(s)}
  end

  def handle_call({:heartbeat, seg_id, island, lease}, _from, s) do
    now = now()

    with seg when not is_nil(seg) <- s.segments[seg_id],
         kind = if(seg.status == "done", do: "verify", else: "run"),
         {:ok, seg} <- Segment.heartbeat(seg, kind, island, lease, now) do
      # A valid (lease-current) heartbeat is as much evidence the island is
      # alive as `/api/next` -- a long-running task's island otherwise looks
      # `stale` in `status/0` the whole time it's busy, between `/next` calls.
      s =
        s
        |> put_in([:segments, seg_id], seg)
        |> put_in([:islands, island, :last_seen], now)

      {:reply, :ok, persist(s)}
    else
      nil -> {:reply, {:error, "unknown segment"}, s}
      {:error, why} -> {:reply, {:error, why}, s}
    end
  end

  def handle_call(
        {:publish_checkpoint, seg_id, island, lease, staged, digest, state_hash},
        _from,
        s
      ) do
    with seg when not is_nil(seg) <- s.segments[seg_id],
         {:ok, seg} <- Segment.publish(seg, island, lease, digest, state_hash) do
      :ok = Store.put(s.dir, digest, staged)
      {:reply, :ok, persist(put_in(s, [:segments, seg_id], seg))}
    else
      nil ->
        File.rm(staged)
        {:reply, {:error, "unknown segment"}, s}

      {:error, why} ->
        File.rm(staged)
        {:reply, {:error, why}, s}
    end
  end

  # Only a `:run` attempt ever uploads anything — a bundle file included: a
  # verify attempt replays and reports a digest, nothing else (see
  # `Coordinator.Attempt`'s moduledoc). Authorizing a verify attempt's lease
  # here too would let a verifier silently rewrite the accepted producer's
  # `series.jsonl`/`manifest.json`/etc. while still reporting a matching
  # digest and leaving the segment `"verified"`.
  def handle_call(
        {:publish_file, seg_id, island, lease, staged, name, sha, metrics_version},
        _from,
        s
      ) do
    with seg when not is_nil(seg) <- s.segments[seg_id],
         {:ok, seg} <- Segment.publish_file(seg, island, lease, name, sha, metrics_version) do
      :ok = Store.put_blob(s.dir, sha, staged)
      {:reply, :ok, persist(put_in(s, [:segments, seg_id], seg))}
    else
      nil ->
        File.rm(staged)
        {:reply, {:error, "unknown segment"}, s}

      {:error, why} ->
        File.rm(staged)
        {:reply, {:error, why}, s}
    end
  end

  def handle_call(
        {:complete, seg_id, island_id, lease, kind, end_hash, summary, observation_digests},
        _from,
        s
      ) do
    seg = s.segments[seg_id]

    result =
      case {seg, kind} do
        {nil, _} ->
          {:error, "unknown segment"}

        {seg, "run"} ->
          # Checkpoint-uploaded is checked first (by deferring to
          # `Segment.complete_run/5` for its own "upload the end checkpoint"
          # error whenever there's no active, checkpoint-bearing attempt to
          # compare a metrics version against) — cheaper, and the more
          # fundamental defect, ahead of a metrics-version mismatch. Both
          # checks read only in-memory attempt state: no file I/O or JSON
          # parsing happens in this GenServer (see the moduledoc).
          case current_run_attempt(seg, island_id, lease) do
            %{uploaded_digest: digest} = attempt when not is_nil(digest) ->
              required = experiment_metrics_version(s, seg.experiment)
              got = Map.get(attempt, :manifest_metrics_version) || 1

              if got == required do
                Segment.complete_run(seg, island_id, lease, end_hash, summary)
              else
                {:error,
                 "uploaded manifest's metrics version #{got} does not match this experiment's required #{required}"}
              end

            _ ->
              Segment.complete_run(seg, island_id, lease, end_hash, summary)
          end

        {seg, "verify"} ->
          Segment.complete_verify(seg, island_id, lease, end_hash, observation_digests)
      end

    case result do
      {:error, why} ->
        {:reply, {:error, why}, s}

      {:ok, seg} ->
        s = put_in(s, [:segments, seg_id], seg)

        s =
          case {kind, seg.status} do
            {"run", "done"} ->
              update_in(s, [:islands, island_id, :runs], &(&1 + 1))

            {"verify", status} when status in ["verified", "diverged"] ->
              update_in(s, [:islands, island_id, :verifies], &(&1 + 1))

            _ ->
              s
          end

        s = record_garden_day(s, seg, kind)

        s =
          if kind == "verify" and seg.status == "diverged" do
            Logger.error(
              "segment #{seg.id} (#{seg.run}##{seg.index}) diverged: #{Segment.accepted_digest(seg)} (#{Segment.accepted_island(seg)}) vs #{end_hash} (#{island_id})"
            )

            %{s | segments: Segment.block_descendants(s.segments, seg.id)}
          else
            s
          end

        {:reply, {:ok, seg.status}, persist(s)}
    end
  end

  # The island assigned `seg_id` (to run it or to verify it) found one of its
  # two possible predecessors inconsistent with what was reported: invalidate
  # that predecessor, requeue it, and reset everything reachable from it.
  # `predecessor` picks which one -- "own" (the same run's prior segment,
  # `prev_seg/2`) or "import" (this segment's cross-run `import_from` source,
  # a different run's segment at the same index — see the moduledoc). `seg_id`
  # itself is left as-is (its own lease simply runs out and is reclaimed in
  # due course); only the predecessor is acted on here.
  def handle_call({:reject, seg_id, island_id, lease, reason, predecessor}, _from, s) do
    seg = s.segments[seg_id]

    assigned? =
      seg &&
        (Attempt.active?(current_run(seg), island_id, lease) ||
           Attempt.active?(current_verify(seg), island_id, lease))

    target =
      case predecessor do
        "import" -> seg && Map.get(seg, :import_from) && s.segments[Map.get(seg, :import_from)]
        _ -> seg && prev_seg(s, seg)
      end

    with true <- assigned?,
         prev when not is_nil(prev) <- target,
         false <- garden_verified?(s, prev) do
      Logger.error(
        "segment #{prev.id} rejected by #{island_id} (#{predecessor}): #{clip(reason)}"
      )

      # Nothing to clean up: the rejected attempt's checkpoint and bundle
      # files are content-addressed (and possibly shared), and files are only
      # ever served through a segment's accepted attempt's own record.
      #
      # `Segment.redo/2` does the block-requeue-unblock transition in one
      # call, building `dependents_graph/1` once and scoped to `prev`'s own
      # experiment rather than the whole coordinator's segments (review P2 --
      # the previous block_descendants/requeue/unblock_after chain built it
      # twice, unscoped).
      s = %{s | segments: Segment.redo(s.segments, prev.id)}

      {:reply, :ok, persist(s)}
    else
      true ->
        {:reply,
         {:error,
          "the predecessor is a verified day of a garden; a verified day is not rejected"}, s}

      _ ->
        {:reply, {:error, "segment not assigned to this island/lease, or no such predecessor"}, s}
    end
  end

  # The island assigned `seg_id` cannot run the task as given (see the
  # moduledoc): the segment is failed under its current lease and everything
  # reachable from it is blocked, as after a divergence. The reason is bounded
  # here, once, before it is stored and shown; the lease rule is `Segment.fail/5`'s.
  def handle_call({:fail, seg_id, island_id, lease, reason}, _from, s) do
    reason = bound_reason(reason)

    with seg when not is_nil(seg) <- s.segments[seg_id],
         {:ok, seg} <- Segment.fail(seg, island_id, lease, reason, now()) do
      Logger.error(
        "segment #{seg.id} (#{seg.run}##{seg.index}) failed on #{island_id}: #{if reason == "", do: "(no reason given)", else: clip(reason)}"
      )

      s = put_in(s, [:segments, seg_id], seg)
      s = %{s | segments: Segment.block_descendants(s.segments, seg.id)}
      {:reply, :ok, persist(s)}
    else
      nil -> {:reply, {:error, "unknown segment"}, s}
      {:error, why} -> {:reply, {:error, why}, s}
    end
  end

  def handle_call(:public_status, _from, s) do
    counts =
      Enum.reduce(s.segments, %{}, fn {_, seg}, acc ->
        Map.update(acc, seg.status, 1, &(&1 + 1))
      end)

    now = now()

    {active_islands, devices} =
      Enum.reduce(s.islands, {0, MapSet.new()}, fn {_, island}, {active, adapters} ->
        active = if stale?(island.last_seen, now), do: active, else: active + 1

        adapters =
          if island.runs + island.verifies > 0,
            do: MapSet.put(adapters, island.adapter),
            else: adapters

        {active, adapters}
      end)

    {:reply, %{counts: counts, activeIslands: active_islands, deviceTypes: MapSet.size(devices)},
     s}
  end

  def handle_call(:status, _from, s) do
    by = Enum.group_by(Map.values(s.segments), & &1.status)
    counts = Map.new(by, fn {k, v} -> {k, length(v)} end)

    runs =
      s.segments
      |> Map.values()
      |> Enum.group_by(& &1.run)
      |> Enum.map(fn {run, segs} ->
        %{
          run: run,
          segments: length(segs),
          done: Enum.count(segs, &(&1.status in ["done", "verified"])),
          verified: Enum.count(segs, &(&1.status == "verified")),
          diverged: Enum.count(segs, &(&1.status == "diverged")),
          failed: Enum.count(segs, &(&1.status == "failed")),
          blocked: Enum.count(segs, &(&1.status == "blocked"))
        }
      end)
      |> Enum.sort_by(& &1.run)

    # A segment an island reported it could not run as given (`fail/4`): the
    # attempt that failed it says which kind of task, who reported it and why.
    failures =
      for seg <- Map.values(s.segments), seg.status == "failed" do
        Map.merge(%{segment: seg.id, run: seg.run, index: seg.index}, failure_of(s, seg))
      end

    divergences =
      for seg <- Map.values(s.segments), seg.status == "diverged" do
        verify = Segment.last_verify_attempt(seg)

        %{
          segment: seg.id,
          run: seg.run,
          index: seg.index,
          a: host(s, Segment.accepted_island(seg)),
          b: host(s, verify && verify.island),
          hash_a: Segment.accepted_digest(seg),
          hash_b: verify && verify.reported_digest
        }
      end

    now = now()

    islands =
      for i <- Map.values(s.islands) do
        i |> Map.drop([:token_hash]) |> Map.put(:stale, stale?(i.last_seen, now))
      end

    # A segment whose verify attempt's regenerated observation files disagree
    # with the accepted run attempt's — independent of `divergences` above,
    # which is about the physics+observer digest: a segment can be "verified"
    # (matching digest) and still show up here (mismatching observations), or
    # vice versa. Purely informational (see `Coordinator.Segment.complete_verify/5`).
    # `current_observations/1` (not raw `Map.get(verify, :observations)`)
    # so a requeue-and-redo can't attribute a stale comparison, made against
    # a since-superseded run attempt, to whichever attempt is accepted now.
    observation_mismatches =
      for seg <- Map.values(s.segments),
          Segment.current_observations(seg) == "mismatch" do
        verify = Segment.last_verify_attempt(seg)

        %{
          segment: seg.id,
          run: seg.run,
          index: seg.index,
          producer: host(s, Segment.accepted_island(seg)),
          verifier: host(s, verify.island)
        }
      end

    {:reply,
     %{
       experiments: Map.new(s.experiments, fn {k, v} -> {k, v.spec} end),
       counts: counts,
       runs: runs,
       islands: islands,
       divergences: divergences,
       failures: failures,
       observationMismatches: observation_mismatches,
       devices:
         islands
         |> Enum.filter(&(&1.runs + &1.verifies > 0))
         |> Enum.map(& &1.adapter)
         |> Enum.uniq()
     }, s}
  end

  def handle_call({:experiment, name}, _from, s) do
    case s.experiments[name] do
      nil ->
        {:reply, nil, s}

      exp ->
        segments =
          for seg <- Map.values(s.segments),
              seg.experiment == name do
            digest = Segment.accepted_digest(seg)
            verify = Segment.last_verify_attempt(seg)

            # Requeueing keeps old verify attempts: only a match against the
            # *current* accepted digest vouches for it.
            verified =
              seg.status == "verified" and verify != nil and verify.outcome == "done" and
                verify.reported_digest == digest

            # true only when the segment is verified (above) AND that same
            # verifying attempt's regenerated observation files also matched
            # *the segment's currently accepted run attempt* — nil (not
            # false) when verified but the observation comparison was never
            # made (old attempt or island, see `Coordinator.Attempt`) or was
            # made against a run attempt since superseded by a redo
            # (`Segment.current_observations/1` catches that; a same-content
            # redo can keep the same accepted digest, so `verified` above
            # alone would not).
            observationsVerified =
              if verified do
                case Segment.current_observations(seg) do
                  "match" -> true
                  "mismatch" -> false
                  nil -> nil
                end
              end

            %{
              id: seg.id,
              run: seg.run,
              condition: seg.condition,
              seed: seg.seed,
              index: seg.index,
              last: seg.last,
              startStep: seg.start_step,
              steps: seg.steps,
              status: seg.status,
              digest: digest,
              files: Segment.accepted_files(seg),
              producedBy: if(a = Segment.accepted_island(seg), do: host(s, a)),
              verifiedBy: if(verified, do: host(s, verify.island)),
              observationsVerified: observationsVerified
            }
            # Only a failed segment carries it (see `fail/4`): every other
            # entry keeps its shape from before the status existed.
            |> maybe_put(:failure, failure_of(s, seg))
          end

        {:reply, %{spec: exp.spec, segments: Enum.sort_by(segments, &{&1.run, &1.index})}, s}
    end
  end

  def handle_call({:segment, id}, _from, s), do: {:reply, s.segments[id], s}
  def handle_call(:data_dir, _from, s), do: {:reply, s.dir, s}

  # ---- gardens (see the moduledoc) ----

  # The keys `POST /api/gardens` takes. An unknown one is refused rather than
  # ignored: a keeper's typo ("dawnPeriod") should not found a daily garden.
  @garden_keys ~w(name presetId seed founding days stepsPerDay censusEvery deepEvery lettersPerDay queueMax dawnPeriodMs dawnOffsetMs food foodAsks foodEveryDays meteor meteorAsks meteorEveryDays)
  # packages/schema's MATTER_MAX (2^26 quanta of world matter), and the start
  # matter allowed per cell for a garden preset (the real figure is about 35;
  # apps/lab/test/garden.test.ts checks every garden preset against both).
  @matter_max 67_108_864
  @start_matter_per_cell 128
  @default_garden_preset "wild-storm-large"
  @max_dawn_period_ms 7 * 86_400_000

  # The garden's parameters (README "Keeper endpoints"), validated in the
  # garden's own words, then the experiment underneath built and run through
  # `validate/1` (so the founding schedule gets the runner's interventions
  # rules, `steps <= 1e9` and the segment cap for free). `{:ok, spec, params}`:
  # the spec to store (marked `"garden" => true`) and `Garden.new/2`'s params.
  defp garden_spec(params) when is_map(params) do
    presets = Application.get_env(:coordinator, :garden_presets, [])
    world = Map.get(Application.get_env(:coordinator, :world_size, %{}), preset_of(params))
    int_in? = fn v, lo, hi -> is_integer(v) and v >= lo and v <= hi end

    name = params["name"]
    preset = Map.get(params, "presetId", @default_garden_preset)
    seed = params["seed"]
    founding = params["founding"]
    per_day = Map.get(params, "stepsPerDay", 131_072)
    census = Map.get(params, "censusEvery", 1024)
    days = Map.get(params, "days", 365)
    deep = Map.get(params, "deepEvery", 10)
    letters = Map.get(params, "lettersPerDay", 8)
    queue_max = Map.get(params, "queueMax", 64)
    period = Map.get(params, "dawnPeriodMs", 86_400_000)
    offset = Map.get(params, "dawnOffsetMs", 0)
    food = Map.get(params, "food", false)

    food_asks =
      Map.get(params, "foodAsks", Application.get_env(:coordinator, :garden_food_asks, 5))

    food_every =
      Map.get(
        params,
        "foodEveryDays",
        Application.get_env(:coordinator, :garden_food_every_days, 7)
      )

    food_amount = Application.get_env(:coordinator, :garden_food_amount, 16)
    food_r = Application.get_env(:coordinator, :garden_food_radius, 32)
    # The food ranges are ConfigCheck's, the one table the boot check also uses.
    asks_r = Coordinator.ConfigCheck.food_range(:garden_food_asks)
    every_r = Coordinator.ConfigCheck.food_range(:garden_food_every_days)
    amount_r = Coordinator.ConfigCheck.food_range(:garden_food_amount)
    radius_r = Coordinator.ConfigCheck.food_range(:garden_food_radius)
    meteor = Map.get(params, "meteor", false)

    meteor_asks =
      Map.get(params, "meteorAsks", Application.get_env(:coordinator, :garden_meteor_asks, 5))

    meteor_every =
      Map.get(
        params,
        "meteorEveryDays",
        Application.get_env(:coordinator, :garden_meteor_every_days, 7)
      )

    meteor_r = Application.get_env(:coordinator, :garden_meteor_radius, 64)
    # The meteor ranges are ConfigCheck's too (docs/garden-meteor-2026-10-18.md).
    m_asks_r = Coordinator.ConfigCheck.range(:garden_meteor_asks)
    m_every_r = Coordinator.ConfigCheck.range(:garden_meteor_every_days)
    m_radius_r = Coordinator.ConfigCheck.range(:garden_meteor_radius)

    error =
      cond do
        (extra = Enum.reject(Map.keys(params), &(is_binary(&1) and &1 in @garden_keys))) != [] ->
          "a garden has no key #{key_name(hd(extra))} (its keys are #{Enum.join(@garden_keys, ", ")})"

        not (is_binary(name) and Regex.match?(~r/^[a-z0-9][a-z0-9_-]{0,63}$/, name)) ->
          "name must match [a-z0-9][a-z0-9_-]{0,63}"

        preset not in presets ->
          "presetId must be one of #{Enum.join(presets, ", ")}"

        world == nil ->
          "no world size is configured for preset #{preset}"

        not int_in?.(seed, 0, 4_294_967_295) ->
          "seed must be a u32 integer"

        not (is_list(founding) and founding != []) ->
          "founding must be a non-empty array of step-0 lesions and feeds"

        not int_in?.(per_day, 1, 10_000_000) ->
          "stepsPerDay must be an integer in 1..1e7"

        not (is_integer(census) and census >= 1 and census <= per_day and
                 rem(per_day, census) == 0) ->
          "censusEvery must be an integer in 1..stepsPerDay that divides stepsPerDay"

        not int_in?.(days, 1, div(1_000_000_000, per_day)) ->
          "days must be an integer in 1..#{div(1_000_000_000, per_day)} (days * stepsPerDay is at most 1e9)"

        not int_in?.(deep, 1, 1000) ->
          "deepEvery must be an integer in 1..1000"

        not int_in?.(letters, 1, 64) ->
          "lettersPerDay must be an integer in 1..64"

        not int_in?.(queue_max, 1, 1000) ->
          "queueMax must be an integer in 1..1000"

        not int_in?.(period, 1000, @max_dawn_period_ms) ->
          "dawnPeriodMs must be an integer in 1000..#{@max_dawn_period_ms}"

        not int_in?.(offset, 0, if(is_integer(period), do: period - 1, else: 0)) ->
          "dawnOffsetMs must be an integer in 0..dawnPeriodMs-1"

        not is_boolean(food) ->
          "food must be true or false"

        food != true and
            (Map.has_key?(params, "foodAsks") or Map.has_key?(params, "foodEveryDays")) ->
          "foodAsks and foodEveryDays are for a garden founded with food: true"

        food and not int_in?.(food_asks, asks_r.first, asks_r.last) ->
          "foodAsks must be an integer in #{inspect(asks_r)} (one person is not a collective)"

        food and not int_in?.(food_every, every_r.first, every_r.last) ->
          "foodEveryDays must be an integer in #{inspect(every_r)}"

        food and not int_in?.(food_amount, amount_r.first, amount_r.last) ->
          "the coordinator's garden_food_amount must be an integer in #{inspect(amount_r)}"

        food and not int_in?.(food_r, radius_r.first, radius_r.last) ->
          "the coordinator's garden_food_radius must be an integer in #{inspect(radius_r)}"

        food and pond_preset?(preset) ->
          "food is not defined for pond worlds: the pond cycle fixes each pond's matter"

        not is_boolean(meteor) ->
          "meteor must be true or false"

        meteor != true and
            (Map.has_key?(params, "meteorAsks") or Map.has_key?(params, "meteorEveryDays")) ->
          "meteorAsks and meteorEveryDays are for a garden founded with meteor: true"

        meteor and not int_in?.(meteor_asks, m_asks_r.first, m_asks_r.last) ->
          "meteorAsks must be an integer in #{inspect(m_asks_r)} (one person is not a collective)"

        meteor and not int_in?.(meteor_every, m_every_r.first, m_every_r.last) ->
          "meteorEveryDays must be an integer in #{inspect(m_every_r)}"

        meteor and not int_in?.(meteor_r, m_radius_r.first, m_radius_r.last) ->
          "the coordinator's garden_meteor_radius must be an integer in #{inspect(m_radius_r)}"

        meteor and pond_preset?(preset) ->
          "meteor is not defined for pond worlds: a pond world is many tiles, and a lesion's disc is bounded by one"

        meteor and meteor_r > max_world_radius(world) ->
          "meteor: the coordinator's garden_meteor_radius #{meteor_r} is past the largest lesion this " <>
            "#{elem(world, 0)} x #{elem(world, 1)} world takes without its disc wrapping onto itself, " <>
            "#{max_world_radius(world)}"

        true ->
          nil
      end

    with nil <- error,
         {:ok, spec} <-
           validate(%{
             "experiment" => name,
             "presetId" => preset,
             "conditions" => ["treatment"],
             "seeds" => [seed],
             "steps" => days * per_day,
             "segmentSteps" => per_day,
             "censusEvery" => census,
             "deepEvery" => deep,
             "verifyFraction" => 1.0,
             "interventions" => founding
           })
           |> founding_error(),
         :ok <- founding_at_step_zero(spec["interventions"]),
         :ok <- founding_without_sun(spec["interventions"]),
         :ok <-
           food_matter_bound(
             food,
             world,
             spec["interventions"],
             days,
             food_every,
             food_amount,
             food_r
           ) do
      gparams = %{
        name: name,
        preset_id: preset,
        seed: seed,
        steps_per_day: per_day,
        days_total: days,
        letters_per_day: letters,
        queue_max: queue_max,
        dawn_period_ms: period,
        dawn_offset_ms: offset,
        founding: spec["interventions"],
        width: elem(world, 0),
        height: elem(world, 1),
        food:
          if(food,
            do: %{asks: food_asks, every_days: food_every, amount: food_amount, r: food_r}
          ),
        meteor: if(meteor, do: %{asks: meteor_asks, every_days: meteor_every, r: meteor_r})
      }

      {:ok, Map.put(spec, "garden", true), gparams}
    else
      why when is_binary(why) -> {:error, why}
      {:error, why} -> {:error, why}
    end
  end

  defp garden_spec(_), do: {:error, "a garden must be an object"}

  # The largest lesion radius a one-tile world of this size takes without its
  # disc wrapping onto itself (packages/schema's `maxLesionRadius`, for a world
  # of one tile; apps/lab/test/garden.test.ts pins every garden preset as one).
  defp max_world_radius({w, h}), do: div(min(w, h) - 1, 2)

  # The runner refuses a feed that would take the world past MATTER_MAX, and a
  # refused scheduled feed fails its day for good (the day's slice is frozen),
  # so a garden with food is founded only if the worst case over its whole
  # horizon fits (docs/garden-food-2026-10-18.md, section 3): the start
  # allowance, every founding feed that adds matter, and the most foods the
  # horizon can carry at spacing N, each disc bounded by its square (a disc
  # never wraps onto itself: `maxLesionRadius`). Lesions conserve matter and
  # drains only remove it.
  defp food_matter_bound(false, _world, _founding, _days, _every, _amount, _r), do: :ok

  defp food_matter_bound(true, {w, h}, founding, days, every, amount, r) do
    cells = w * h
    disc = fn r -> min((2 * r + 1) * (2 * r + 1), cells) end
    start = cells * @start_matter_per_cell

    fed =
      for %{"kind" => "feed", "amount" => a, "r" => fr} <- founding, a > 0, reduce: 0 do
        acc -> acc + a * disc.(fr)
      end

    foods = div(days + every - 1, every)
    per_food = amount * disc.(r)
    total = start + fed + foods * per_food

    if total <= @matter_max do
      :ok
    else
      {:error,
       "food: the worst case is #{total} quanta of matter (start allowance #{start} + founding feeds #{fed} + " <>
         "#{foods} foods of at most #{per_food}), past MATTER_MAX #{@matter_max}; space the foods further " <>
         "apart (foodEveryDays), shorten the horizon (days) or feed less at founding"}
    end
  end

  defp preset_of(params) do
    case Map.get(params, "presetId", @default_garden_preset) do
      p when is_binary(p) -> p
      _ -> nil
    end
  end

  # `validate/1` words an interventions error for the experiment's own key; a
  # garden's keeper wrote `founding`.
  defp founding_error({:error, "interventions" <> rest}), do: {:error, "founding" <> rest}
  defp founding_error(other), do: other

  # A garden's founding schedule is the world's first act: day 0 owns step 0
  # and nothing before the first dawn is the keeper's to place later. (Letters
  # land on day ends, never at step 0.)
  defp founding_at_step_zero(entries) do
    case Enum.find_index(entries, &(&1["step"] != 0)) do
      nil ->
        :ok

      i ->
        {:error, "founding[#{i}]: step must be 0 (the founding schedule is applied at the start)"}
    end
  end

  # A garden's suns are its letters (Coordinator.Garden): one founded with one
  # could overlap the first sun letter, which every island would then refuse.
  defp founding_without_sun(entries) do
    case Enum.find_index(entries, &(&1["kind"] == "sun")) do
      nil ->
        :ok

      i ->
        {:error,
         "founding[#{i}]: a sun is not a founding entry (a garden's suns are its letters)"}
    end
  end

  defp garden_name_free(s, name) do
    cond do
      Map.has_key?(s.gardens, name) -> {:error, "garden exists"}
      Map.has_key?(s.experiments, name) -> {:error, "experiment exists"}
      true -> :ok
    end
  end

  # An experiment (validated spec) and its segments, into the state. Shared by
  # `{:create, ...}` and `{:create_garden, ...}`; `{:ok, state, segment_count}`.
  # Re-indexes: `s.index` finds a run's segments by `{run, index}`.
  defp add_experiment(s, spec, now) do
    if Map.has_key?(s.experiments, spec["experiment"]) do
      {:error, "experiment exists"}
    else
      {segments, next} = build_segments(spec, s.next_seg)
      s = reindex(%{s | segments: Map.merge(s.segments, segments), next_seg: next})
      s = put_in(s, [:experiments, spec["experiment"]], %{spec: spec, created_at: now})
      {:ok, s, map_size(segments)}
    end
  end

  # `%{day_index => segment}` for the garden's days that exist (all of them
  # once created), through the `{run, index}` index: O(days), not O(segments).
  defp garden_segs(s, g) do
    run = Garden.run_id(g)

    for i <- 0..(g.days_total - 1)//1, id = s.index[{run, i}], into: %{} do
      {i, s.segments[id]}
    end
  end

  # A letter as the Queue accepts it from a caller: `%{x:, y:, r:}`, re-run
  # through the pure shape check so a direct caller cannot crash this process
  # with a float or an out-of-range radius.
  defp garden_letter(%{x: x, y: y, r: r}) do
    case Garden.parse_letter(%{"kind" => "stone", "x" => x, "y" => y, "r" => r}) do
      {:ok, letter} -> {:ok, letter}
      {:error, msg} -> {:error, {:invalid, msg}}
    end
  end

  defp garden_letter(%{kind: "sun", percent: p}) do
    case Garden.parse_letter(%{"kind" => "sun", "percent" => p}) do
      {:ok, letter} -> {:ok, letter}
      {:error, msg} -> {:error, {:invalid, msg}}
    end
  end

  defp garden_letter(_), do: {:error, {:invalid, "a letter needs integer x, y and r"}}

  # Keeps the experiment's spec in step with the garden's letters: the whole
  # schedule rides in every task read from here (see the moduledoc).
  defp store_garden(s, g) do
    s
    |> put_in([:gardens, g.name], g)
    |> put_in([:experiments, g.name, :spec, "interventions"], Garden.schedule(g))
  end

  # A hand on garden `g` (the `{:ask_food, ...}` or `{:ask_meteor, ...}` call's
  # work), each kind against its own hands.
  defp ask_act(s, g, name, key, kind) do
    now = now()
    segs = garden_segs(s, g)
    field = hands_field(kind)

    block = fn g, hands ->
      case kind do
        :food -> Garden.food_view(g, segs, hands.count, now, shared_address?())
        :meteor -> Garden.meteor_view(g, segs, hands.count, now, shared_address?())
      end
    end

    case Garden.add_hand(g, kind, s |> Map.fetch!(field) |> Map.get(name), key, segs, now) do
      {:error, {:refused, {code, opens}}} ->
        {:reply, {:error, {:closed, code, opens, closed_words(code, opens, g, kind)}}, s}

      {:repeat, hands} ->
        {:reply, {:ok, :repeat, block.(g, hands)}, put_hands(s, field, name, hands)}

      {:counted, hands} ->
        # Only a count changed, and counts are never persisted.
        {:reply, {:ok, :counted, nil, block.(g, hands)}, put_hands(s, field, name, hands)}

      {:called, g, hands, record} ->
        Logger.info("garden #{name}: #{record.id} called onto day #{record.day}")
        s = s |> store_garden(g) |> put_hands(field, name, hands)

        {:reply, {:ok, :counted, Garden.record_view(g, record, segs), block.(g, hands)},
         persist(s)}
    end
  end

  defp hands_field(:food), do: :food_hands
  defp hands_field(:meteor), do: :meteor_hands

  # Every visitor reaches this coordinator as one address (production until the
  # proxy passes client addresses, D-17): the food block says so.
  defp shared_address?,
    do: Application.get_env(:coordinator, :garden_shared_address, false) == true

  # A garden's food or meteor hands, in memory only (never persisted, never in a view).
  defp put_hands(s, field, name, hands), do: put_in(s, [field, name], hands)

  # What the view needs of the hands: the count and whose period it is, not the hashes.
  defp hands_summary(nil), do: nil
  defp hands_summary(hands), do: Map.take(hands, [:dawn, :epoch, :count])

  # A closed food or meteor ask in words (the 409's `error`).
  defp closed_words(code, opens, g, :food), do: closed_words(code, opens, g)
  defp closed_words("off", _opens, _g, :meteor), do: "this garden takes no meteor"

  defp closed_words("horizon", _opens, _g, :meteor),
    do: "no day is left before the horizon for a meteor"

  defp closed_words("cooldown", opens, g, :meteor),
    do:
      "a meteor lands at most once every #{g.meteor.every_days} days; the next can land on day #{opens} at the earliest"

  defp closed_words(code, opens, g, :meteor), do: closed_words(code, opens, g)

  defp closed_words("off", _opens, _g), do: "this garden takes no food"

  defp closed_words("stopped", _opens, _g),
    do: "the garden has stopped; nothing after the stopped day runs"

  defp closed_words("finished", _opens, _g), do: "the garden has finished"
  defp closed_words("horizon", _opens, _g), do: "no day is left before the horizon for a food"
  defp closed_words("log-full", _opens, _g), do: "the garden's log is full"

  defp closed_words("cooldown", opens, g),
    do:
      "a food lands at most once every #{g.food.every_days} days; the next can land on day #{opens} at the earliest"

  # The release rule for every garden (`Garden.maybe_release/3`), at most one
  # day each: it needs only the newest released day's segment status.
  defp release_gardens(%{gardens: gardens} = s, _now) when map_size(gardens) == 0, do: s

  defp release_gardens(s, now) do
    gardens =
      Map.new(s.gardens, fn {name, g} ->
        newest = Garden.newest_released(g)

        status =
          case s.index[{Garden.run_id(g), newest}] do
            nil -> nil
            id -> s.segments[id].status
          end

        case Garden.maybe_release(g, status, now) do
          {:released, g} -> {name, g}
          :none -> {name, g}
        end
      end)

    %{s | gardens: gardens}
  end

  # With `:garden_island_token` configured, a garden's days (to run or to
  # replay) go only to islands that joined showing it; anything else is open.
  defp garden_island?(s, seg, island) do
    case {s.gardens[seg.experiment], Application.get_env(:coordinator, :garden_island_token)} do
      {nil, _} -> true
      {_g, token} when not is_binary(token) or token == "" -> true
      {_g, _token} -> get_in(s, [:islands, island, :garden]) == true
    end
  end

  # Whether the join body carries the configured garden token (constant-time);
  # run in the caller of `join/1`, never in this process.
  defp garden_token_ok?(info) do
    configured = Application.get_env(:coordinator, :garden_island_token)
    given = is_map(info) && info["gardenToken"]

    is_binary(configured) and configured != "" and is_binary(given) and
      Plug.Crypto.secure_compare(given, configured)
  end

  # A garden's verified day: the one predecessor a reject may not roll back.
  defp garden_verified?(s, seg),
    do: s.gardens[seg.experiment] != nil and seg.status == "verified"

  # A segment of an ordinary experiment is always released; a garden's only
  # once its day is.
  defp released?(s, seg) do
    case s.gardens[seg.experiment] do
      nil -> true
      g -> Garden.released?(g, seg.index)
    end
  end

  # A garden's day carrying a food or a meteor called less than a dawn period
  # ago is not run yet: the keeper's veto has that long (`Garden.hold?/3`).
  defp food_hold?(s, seg, now) do
    case s.gardens[seg.experiment] do
      nil -> false
      g -> Garden.hold?(g, seg.index, now)
    end
  end

  # When a garden's day completes (a run) or is verified, stamp it.
  #
  # A day becoming verified may advance the verified prefix, and so the fork
  # the public view names and the checkpoints the public route serves: the
  # garden's cache (`Coordinator.LetterLimiter`) is invalidated here, before
  # this call replies, so no view naming the new fork can be followed by a
  # cached 404 for its checkpoint (docs/garden-hardening-2026-10-18.md, item
  # 2). `invalidate/1` is ETS work only and never calls back into this
  # process. The servable set only ever grows on this transition: a verified
  # day cannot be rejected, divergence and failure stop the prefix without
  # shrinking it, and a requeue, a letter and a drop invalidate from the
  # controller.
  defp record_garden_day(s, seg, kind) do
    case s.gardens[seg.experiment] do
      nil ->
        s

      g ->
        g =
          case {kind, seg.status} do
            {"run", "done"} ->
              Garden.record_done(g, seg.index, now())

            {"verify", "verified"} ->
              Coordinator.LetterLimiter.invalidate(seg.experiment)
              Garden.record_verified(g, seg.index, now())

            _ ->
              g
          end

        s = put_in(s, [:gardens, seg.experiment], g)

        if {kind, seg.status} == {"verify", "verified"},
          do: start_leaders(s, seg.experiment, seg.index),
          else: s
    end
  end

  # Who held the field at a verified day's end (docs/garden-predictions-2026-10-18.md):
  # counted from the day's own files, only behind `Garden.leaders_job/4`'s gate,
  # in an unlinked, monitored process so parsing never holds up this one. The
  # task reads only what it is handed here and answers with a cast to this pid
  # (a Queue that is gone never hears it), carrying a token the day's block
  # keeps. At most `@leaders_max` run at once (a first start onto a garden with
  # many verified days, each holding a day's mutation map): a day beyond that
  # shows `pending` with no token and waits in `leaders_waiting`, in order, and
  # is started afresh when a slot frees. `segs` may be passed by a caller that
  # starts many days of one garden.
  defp start_leaders(s, name, day, segs \\ nil) do
    case s.gardens[name] do
      nil -> s
      g -> start_leaders(s, name, g, day, segs || garden_segs(s, g))
    end
  end

  defp start_leaders(s, name, g, day, segs) do
    case Garden.leaders_job(g, segs, day, &Store.blob_path(s.dir, &1)) do
      :skip ->
        s

      {:unchecked, attempt} ->
        put_in(s, [:gardens, name], Garden.unchecked_leaders(g, day, attempt))

      {:start, job} when map_size(s.leaders_tasks) >= @leaders_max ->
        s
        |> put_in([:gardens, name], Garden.pending_leaders(g, day, nil, job.for))
        |> Map.update!(:leaders_waiting, &wait_push(&1, {name, day}))

      {:start, job} ->
        token = System.unique_integer([:positive, :monotonic])
        queue = self()

        {_pid, mref} =
          GardenLeaders.spawn_owned(queue, fn ->
            result = GardenLeaders.compute(job.paths, job.ctx)
            GenServer.cast(queue, {:garden_leaders, name, day, token, job.for, result})
          end)

        s
        |> put_in([:gardens, name], Garden.pending_leaders(g, day, token, job.for))
        |> put_in([:leaders_tasks, mref], {name, day, token, job.for})
        |> Map.update!(:leaders_waiting, &unwait(&1, {name, day}))
    end
  end

  # The waiting days: a FIFO of `{name, day}` and the set of those still
  # waiting, so queueing, starting and taking the next are each O(log n) (a
  # first start onto a garden with many verified days queues them all). A day
  # started out of turn leaves its entry in the FIFO; it is skipped when
  # reached, being out of the set.
  defp wait_new, do: {:queue.new(), MapSet.new()}

  defp wait_push({q, set} = w, item),
    do: if(MapSet.member?(set, item), do: w, else: {:queue.in(item, q), MapSet.put(set, item)})

  defp unwait({q, set}, item), do: {q, MapSet.delete(set, item)}

  defp wait_pop({q, set}) do
    case :queue.out(q) do
      {{:value, item}, q} ->
        if MapSet.member?(set, item),
          do: {item, {q, MapSet.delete(set, item)}},
          else: wait_pop({q, set})

      {:empty, q} ->
        {nil, {q, set}}
    end
  end

  # An answer for `day` (a task's, or a died task's `{:error, _}`), through
  # `Garden.accept_leaders/6`; then the days it lets be counted.
  defp take_leaders(s, name, day, token, attempt, result) do
    with %{} = g <- s.gardens[name],
         segs = garden_segs(s, g),
         {:ok, g} <- Garden.accept_leaders(g, segs, day, token, attempt, result) do
      s = put_in(s, [:gardens, name], g)
      s = Enum.reduce(Garden.leaders_followups(g, segs, day), s, &start_leaders(&2, name, &1))
      Coordinator.LetterLimiter.invalidate(name)
      {:ok, s}
    else
      _ -> :stale
    end
  end

  # Starts waiting days while a slot is free.
  defp drain_leaders(s) when map_size(s.leaders_tasks) >= @leaders_max, do: s

  defp drain_leaders(s) do
    case wait_pop(s.leaders_waiting) do
      {{name, day}, rest} ->
        %{s | leaders_waiting: rest} |> start_leaders(name, day) |> drain_leaders()

      {nil, rest} ->
        %{s | leaders_waiting: rest}
    end
  end

  defp start_leaders_at_boot(s) do
    Enum.reduce(s.gardens, s, fn {name, g}, s ->
      segs = garden_segs(s, g)

      g
      |> Garden.leaders_to_start(segs)
      |> Enum.reduce(s, &start_leaders(&2, name, &1, segs))
    end)
  end

  # ---- validation ----

  defp validate(spec) when is_map(spec) do
    presets = Application.get_env(:coordinator, :presets)
    conditions = Application.get_env(:coordinator, :conditions)
    int_in? = fn v, lo, hi -> is_integer(v) and v >= lo and v <= hi end
    frac = Map.get(spec, "verifyFraction", 0.1)

    cond do
      not (is_binary(spec["experiment"]) and
               Regex.match?(~r/^[a-z0-9][a-z0-9_-]{0,63}$/, spec["experiment"])) ->
        {:error, "experiment must match [a-z0-9][a-z0-9_-]{0,63}"}

      spec["presetId"] not in presets ->
        {:error, "presetId must be one of #{Enum.join(presets, ", ")}"}

      not unique_list?(spec["conditions"], 16, &(&1 in conditions)) ->
        {:error, "conditions must be 1..16 unique values from #{Enum.join(conditions, ", ")}"}

      # Each pond keeps its own matter (WorldConfig.pondPeriod), which a
      # metapopulation's cross-run exchange would break; the runner refuses it
      # too (packages/runner/src/runner.ts's specConfig), on every island.
      pond_preset?(spec["presetId"]) and spec["metapopulation"] != nil ->
        {:error,
         "preset #{spec["presetId"]} cannot have a metapopulation: cross-run exchange would move matter into and out of its ponds"}

      (bad = incompatible(spec["presetId"], spec["conditions"], spec)) != nil ->
        {:error, "condition #{bad} does not apply to preset #{spec["presetId"]}"}

      not unique_list?(spec["seeds"], 1000, &int_in?.(&1, 0, 4_294_967_295)) ->
        {:error, "seeds must be 1..1000 unique u32 integers"}

      not int_in?.(spec["steps"], 1, 1_000_000_000) ->
        {:error, "steps must be an integer in 1..1e9"}

      not int_in?.(spec["censusEvery"], 1, 1_000_000) ->
        {:error, "censusEvery must be an integer in 1..1e6"}

      not int_in?.(spec["segmentSteps"], spec["censusEvery"], 10_000_000) or
          rem(spec["segmentSteps"], spec["censusEvery"]) != 0 ->
        {:error, "segmentSteps must be a multiple of censusEvery, at most 1e7"}

      # Cadence the runner will actually reject at runtime (packages/runner/src/runner.ts
      # requires migrationPeriod to be a multiple of censusEvery), checked here so a whole
      # experiment's islands don't get assigned segments they can only fail. Checked per
      # *condition*, not once for the whole spec: each condition in `spec["conditions"]`
      # becomes its own separate run (build_segments/2 below), and only "no-migration"
      # (packages/runner/src/conditions.ts) disables migration for the run it produces --
      # every other condition (including "treatment") runs the preset's migrationPeriod
      # unchanged. Exempting the whole spec because *any* of its conditions was
      # "no-migration" would silently let an incompatible cadence through for the
      # *other* conditions' runs, which still migrate. This can't read packages/schema
      # itself (a separate app), so `:migration_period` in config.exs is a duplicated
      # fact that must be kept in sync with the preset it names -- like `:presets`/
      # `:conditions`/`:incompatible` above already are. A pond preset's pondPeriod
      # (`:pond_period`, the same kind of fact) takes the same two rules (the runner
      # refuses one that is not a multiple of censusEvery too); no condition disables
      # it ("pond-cont" keeps the period and only stops the transform).
      (bad =
         incompatible_cadence(
           spec["presetId"],
           spec["conditions"],
           spec["censusEvery"],
           spec["segmentSteps"]
         )) !=
          nil ->
        {:error, bad}

      (bad = invalid_metapopulation(spec)) != nil ->
        {:error, bad}

      # Scheduled lesions and feeds (see the moduledoc): the runner's shape
      # rules, a centre inside the world, no feed in a pond world, nothing
      # after the last step. After `steps` and `presetId` are known good.
      (bad = invalid_interventions(spec)) != nil ->
        {:error, bad}

      not int_in?.(Map.get(spec, "deepEvery", 10), 1, 1000) ->
        {:error, "deepEvery must be an integer in 1..1000"}

      not (is_number(frac) and frac >= 0 and frac <= 1) ->
        {:error, "verifyFraction must be in 0..1"}

      length(spec["conditions"]) * length(spec["seeds"]) *
        div(spec["steps"] + spec["segmentSteps"] - 1, spec["segmentSteps"]) > @max_segments ->
        {:error, "too many segments (max #{@max_segments})"}

      true ->
        keep =
          ~w(experiment presetId conditions seeds steps segmentSteps censusEvery deepEvery verifyFraction interventions)

        # "metricsVersion" is deliberately not in `keep`: it is the
        # coordinator's own required version at creation time (like
        # `:rule_version`), never client-supplied — `Map.take/2` above drops
        # any value the client tried to set, and the default below always wins.
        base =
          Map.merge(
            %{
              "deepEvery" => 10,
              "verifyFraction" => 0.1,
              "metricsVersion" => Application.get_env(:coordinator, :metrics_version, 1)
            },
            Map.take(spec, keep)
          )

        # An explicit `"interventions": null` is no schedule (invalid_interventions/1
        # reads it so), and must leave no key behind: every segment's task
        # spec, and the stored spec, keep their shape from before the field.
        base = if base["interventions"] == nil, do: Map.delete(base, "interventions"), else: base

        {:ok, put_metapopulation(base, spec)}
    end
  end

  defp validate(_), do: {:error, "spec must be an object"}

  # Conditions that remove something the preset does not have (see
  # packages/runner/src/conditions.ts) would fail on every island.
  # "no-migration" is not looked up in the static `:incompatible` table (unlike
  # every other condition): it is meaningful whenever *either* mechanism it
  # could remove is present -- tile migration configured for this preset
  # (`:migration_period`), or this spec has a `:metapopulation` -- so its
  # compatibility depends on the *spec*, not just the preset. A pond preset has
  # neither (no migration, and `validate/1` refuses its metapopulation before
  # this), so "no-migration" is always refused there.
  #
  # The breeder's conditions are not in the static table either: each needs the
  # pond cycle (packages/runner/src/conditions.ts throws without it), so one is
  # refused on every preset outside `:pond_presets`, by its prefix.
  defp incompatible(preset, conditions, spec) do
    table = Application.get_env(:coordinator, :incompatible, %{})
    has_metapop = is_map(spec["metapopulation"])

    Enum.find(conditions, fn
      "no-migration" ->
        effective_migration_period(preset, "treatment") == 0 and not has_metapop

      c ->
        preset in Map.get(table, c, []) or (breed_condition?(c) and not pond_preset?(preset))
    end)
  end

  # The migrationPeriod one (preset, condition) run will actually run with: 0
  # if the preset has none configured, or if `condition` is "no-migration" --
  # every other condition (packages/runner/src/conditions.ts) leaves
  # migrationPeriod/migrantCount untouched, since only "no-migration" itself
  # overrides them. See config.exs's `:migration_period` doc.
  defp effective_migration_period(_preset, "no-migration"), do: 0

  defp effective_migration_period(preset, _condition),
    do: Map.get(Application.get_env(:coordinator, :migration_period, %{}), preset, 0)

  # The pondPeriod one (preset, condition) run will actually run with: 0 if
  # the preset has no pond cycle. Every condition keeps it, "pond-cont"
  # included (that arm still measures at every boundary; it only skips the
  # transform). See config.exs's `:pond_period` doc.
  defp effective_pond_period(preset, _condition),
    do: Map.get(Application.get_env(:coordinator, :pond_period, %{}), preset, 0)

  defp pond_preset?(preset), do: preset in Application.get_env(:coordinator, :pond_presets, [])

  # A preset whose config sets pondScore (config's `:breed_presets`): every
  # segment of its experiments needs `@breed_capability` (see the moduledoc).
  defp breed_preset?(preset),
    do: preset in Application.get_env(:coordinator, :breed_presets, [])

  # The first cadence error among `conditions`' own runs (each condition is a
  # separate run against `preset`, at the same censusEvery/segmentSteps -- see
  # build_segments/2), or nil if every one of them is compatible. Defensive
  # against a malformed `conditions` (not yet known to be a list at every call
  # site: this is also used by the `cond` clause that establishes that), so it
  # never raises on bad input -- it just reports no incompatibility, and an
  # earlier/later clause rejects the spec on its own terms.
  defp incompatible_cadence(preset, conditions, census_every, segment_steps) do
    if is_list(conditions) do
      Enum.find_value(conditions, fn condition ->
        Enum.find_value(
          [
            {"migrationPeriod", effective_migration_period(preset, condition)},
            {"pondPeriod", effective_pond_period(preset, condition)}
          ],
          fn {name, period} ->
            cond do
              period == 0 ->
                nil

              rem(period, census_every) != 0 ->
                "#{name} #{period} (condition #{condition}) must be a multiple of censusEvery"

              rem(segment_steps, period) != 0 ->
                "segmentSteps must be a multiple of #{name} #{period} (condition #{condition})"

              true ->
                nil
            end
          end
        )
      end)
    end
  end

  defp unique_list?(v, max, ok?) do
    is_list(v) and v != [] and length(v) <= max and Enum.all?(v, ok?) and
      length(Enum.uniq(v)) == length(v)
  end

  @max_migrant_count 4096

  # Shape of `spec["metapopulation"]`, if given: `nil` is valid (no
  # metapopulation at all). At least 2 seeds -- a 1-seed "ring" would import
  # from itself, which is meaningless -- and `migrantCount` bounded the same
  # way packages/schema/src/config.ts bounds tile migration's own
  # `migrantCount` (a positive count, capped well under a world's cell count).
  # `salt`, if the caller supplies one, must be a valid u32 (it becomes the
  # metapopulation's seed for cross-run position selection -- see
  # packages/schema/src/exchange.ts); left absent, `put_metapopulation/2`
  # resolves and stores one deterministically.
  defp invalid_metapopulation(%{"metapopulation" => m} = spec) when is_map(m) do
    cond do
      m["topology"] != "ring" ->
        "metapopulation.topology must be \"ring\""

      not (is_integer(m["migrantCount"]) and m["migrantCount"] >= 1 and
               m["migrantCount"] <= @max_migrant_count) ->
        "metapopulation.migrantCount must be an integer in 1..#{@max_migrant_count}"

      not (m["salt"] == nil or
               (is_integer(m["salt"]) and m["salt"] >= 0 and m["salt"] <= 4_294_967_295)) ->
        "metapopulation.salt must be a u32 integer"

      not (is_list(spec["seeds"]) and length(spec["seeds"]) >= 2) ->
        "metapopulation requires at least 2 seeds (a 1-seed ring would import from itself)"

      true ->
        nil
    end
  end

  defp invalid_metapopulation(%{"metapopulation" => nil}), do: nil
  defp invalid_metapopulation(%{"metapopulation" => _}), do: "metapopulation must be an object"
  defp invalid_metapopulation(_spec), do: nil

  # Resolves and stores the metapopulation's salt (deterministically, from the
  # experiment's own name, if the caller didn't supply one) into the
  # persisted spec, so a later replay/verify never depends on recomputing it
  # -- every segment's task carries the resolved value directly (see task/4).
  defp put_metapopulation(base, %{"metapopulation" => m}) when is_map(m) do
    salt = m["salt"] || :erlang.phash2(base["experiment"], 4_294_967_296)

    Map.put(base, "metapopulation", %{
      "topology" => "ring",
      "migrantCount" => m["migrantCount"],
      "salt" => salt
    })
  end

  defp put_metapopulation(base, _spec), do: base

  # ---- scheduled interventions (see the moduledoc) ----

  # Bounds the list that rides in every task payload and in state.bin, and
  # the work `validate/1` does inside this serialized process.
  @max_interventions 10_000
  # packages/schema/src/feed.ts's FEED_MAX: the largest per-cell amount one feed may add or drain.
  @feed_max 4096
  # The largest integer JSON hands JavaScript exactly (Number.MAX_SAFE_INTEGER):
  # a larger one would pass here as an Erlang integer and fail the runner's
  # `validateInterventions` on every island.
  @max_safe_int 9_007_199_254_740_991
  @lesion_keys ~w(step kind x y r)
  @feed_keys ~w(step kind x y r amount)
  @sun_keys ~w(step kind percent span)
  # packages/schema/src/sun.ts's SUN_PERCENTS and SUN_SPAN_MAX.
  @sun_percents [50, 75, 125, 150]
  @sun_span_max 16_777_216

  # Why `spec["interventions"]` cannot be scheduled, or nil (absent, or nil,
  # is no schedule at all). The shape rules are packages/runner/src/interventions.ts's
  # `validateInterventions` (minus a feed's `matter`, see the moduledoc), so a
  # list accepted here passes `validateSpec` on every island; the world rules
  # are `interventionsError`'s, checked here so that no island is handed a
  # segment it can only throw on. Called after `validate/1` has established
  # `presetId` and `steps`.
  defp invalid_interventions(%{"interventions" => nil}), do: nil

  defp invalid_interventions(%{"interventions" => list} = spec) when is_list(list) do
    cond do
      list == [] ->
        "interventions must be a non-empty array of lesions, feeds and suns"

      length(list) > @max_interventions ->
        "interventions must hold at most #{@max_interventions} entries"

      true ->
        world = Map.get(Application.get_env(:coordinator, :world_size, %{}), spec["presetId"])
        # The preset's own light, which a condition in `:light_conditions` changes: then no sun.
        light =
          if Enum.any?(
               spec["conditions"] || [],
               &(&1 in Application.get_env(:coordinator, :light_conditions, []))
             ),
             do: :changed,
             else: Map.get(Application.get_env(:coordinator, :world_light, %{}), spec["presetId"])

        pond? = pond_preset?(spec["presetId"])

        list
        |> Enum.with_index()
        |> Enum.reduce_while({{0, 0}, nil}, fn {e, i}, {{last, sun_end}, nil} ->
          case invalid_intervention(e, i, last, spec["steps"], world, pond?) do
            {:ok, step} ->
              case invalid_sun(e, i, sun_end, spec["steps"], light) do
                {:ok, sun_end} -> {:cont, {{step, sun_end}, nil}}
                {:error, why} -> {:halt, {{last, sun_end}, why}}
              end

            {:error, why} ->
              {:halt, {{last, sun_end}, why}}
          end
        end)
        |> elem(1)
    end
  end

  defp invalid_interventions(%{"interventions" => _}),
    do: "interventions must be a non-empty array of lesions, feeds and suns"

  defp invalid_interventions(_spec), do: nil

  # One entry: `{:ok, step}` (its step, for the next entry's ordering check)
  # or `{:error, why}`, in the runner's own words (`validateInterventions`,
  # then `interventionsError` and tools/run.ts for the world and the last
  # step). `world` is the preset's `{width, height}` from config.exs, or nil
  # for a preset without one (then no centre check, as the runner's would be
  # the first to see it).
  defp invalid_intervention(e, i, last, steps, world, pond?) do
    where = "interventions[#{i}]"
    kind = is_map(e) and e["kind"]

    allowed =
      case kind do
        "feed" -> @feed_keys
        "sun" -> @sun_keys
        _ -> @lesion_keys
      end

    # Erlang integers only: an integer-valued float (`2.0`, which JSON clients
    # never send for a cell) is refused although the runner would take it, so
    # the stored spec and every task payload carry integers.
    nonneg? = fn k -> is_integer(e[k]) and e[k] >= 0 and e[k] <= @max_safe_int end

    cond do
      not is_map(e) ->
        {:error, "#{where} must be an object"}

      kind not in ["lesion", "feed", "sun"] ->
        {:error,
         "#{where}: kind must be \"lesion\", \"feed\" or \"sun\", got #{Jason.encode!(kind)}"}

      # See the moduledoc: a replay assertion the archipelago cannot honour.
      kind == "feed" and Map.has_key?(e, "matter") ->
        {:error,
         "#{where}: a feed's matter is not scheduled on the archipelago (the second island's replay is its check; a matter the world does not reproduce would throw on every island)"}

      # Not `Enum.find(...) != nil`: a direct caller's nil key would pass as "none".
      (extra = Enum.reject(Map.keys(e), &(is_binary(&1) and &1 in allowed))) != [] ->
        {:error,
         "#{where}: a #{kind} has no key #{key_name(hd(extra))} (its keys are #{Enum.join(allowed, ", ")})"}

      (missing = Enum.find(allowed, &(not Map.has_key?(e, &1)))) != nil ->
        {:error, "#{where}: a #{kind} needs the key #{Jason.encode!(missing)}"}

      not nonneg?.("step") ->
        {:error, "#{where}: step must be a non-negative integer"}

      e["step"] < last ->
        {:error, "#{where}: step #{e["step"]} follows step #{last} (steps must not decrease)"}

      e["step"] > steps ->
        {:error,
         "#{where}: step #{e["step"]} is after the run's last step (steps #{steps}), so no segment would apply it"}

      # A sun's own rules are `invalid_sun/5`'s.
      kind == "sun" ->
        {:ok, e["step"]}

      (bad = Enum.find(~w(x y r), &(not nonneg?.(&1)))) != nil ->
        {:error, "#{where}: #{bad} must be a non-negative integer"}

      world != nil and e["x"] >= elem(world, 0) ->
        {:error, "#{where}: x #{e["x"]} is outside the world (#{elem(world, 0)} wide)"}

      world != nil and e["y"] >= elem(world, 1) ->
        {:error, "#{where}: y #{e["y"]} is outside the world (#{elem(world, 1)} high)"}

      kind == "feed" and
          not (is_integer(e["amount"]) and e["amount"] != 0 and abs(e["amount"]) <= @feed_max) ->
        {:error, "#{where}: amount must be a non-zero integer within ±#{@feed_max} per cell"}

      # packages/schema/src/feed.ts's feedError, which the runner would raise on every island.
      kind == "feed" and pond? ->
        {:error,
         "#{where}: feeding is not defined for pond worlds: the pond cycle fixes each pond's matter"}

      true ->
        {:ok, e["step"]}
    end
  end

  # A sun's own rules, after `invalid_intervention/6` has checked its keys and
  # step: `{:ok, sun_end}` (the end of the latest sun so far, for the overlap
  # rule) or `{:error, why}`, in the runner's words (`validateInterventions`,
  # `sunError`, tools/run.ts for the last step). `light` is the preset's
  # `{lightBase, lightAmp, seasonAmp}` from config.exs, or nil: then no sun.
  defp invalid_sun(%{"kind" => "sun"} = e, i, sun_end, steps, light) do
    where = "interventions[#{i}]"
    step = e["step"]
    span = e["span"]

    cond do
      e["percent"] not in @sun_percents or not is_integer(e["percent"]) ->
        {:error, "#{where}: a sun's percent must be one of #{Enum.join(@sun_percents, ", ")}"}

      not (is_integer(span) and span >= 1 and span <= @sun_span_max) ->
        {:error, "#{where}: a sun's span must be an integer in 1..#{@sun_span_max}"}

      step < sun_end ->
        {:error,
         "#{where}: a sun at t=#{step} starts before the previous sun ends (t=#{sun_end}); suns do not overlap"}

      step + span > steps ->
        {:error,
         "#{where}: a sun at t=#{step} for #{span} steps ends at t=#{step + span}, after the run's last step (steps #{steps}): a sun sets inside its run"}

      light == nil ->
        {:error, "#{where}: this preset's light is not known here, so it takes no sun"}

      light == :changed ->
        {:error,
         "#{where}: a sun is checked against the preset's own light, and one of this experiment's conditions changes it"}

      (why = sun_light_error(light, e["percent"])) != nil ->
        {:error, "#{where}: #{why}"}

      true ->
        {:ok, step + span}
    end
  end

  defp invalid_sun(_e, _i, sun_end, _steps, _light), do: {:ok, sun_end}

  @doc """
  Why a world of light `{lightBase, lightAmp, seasonAmp}` cannot take a sun of
  `percent`, or nil: packages/schema's `sunError` (each value floored at
  `percent`/100 must stay within 255, and so must their sum).
  """
  @spec sun_light_error({integer, integer, integer}, integer) :: String.t() | nil
  def sun_light_error({base, amp, season}, percent) do
    [b, a, s] = for v <- [base, amp, season], do: div(v * percent, 100)

    if b > 255 or a > 255 or s > 255 or b + a + s > 255,
      do: "this world's light cannot take a sun of #{percent}%: it would be #{b} + #{a} + #{s}",
      else: nil
  end

  @doc "The percents a preset's light (`:world_light`) takes, or [] for a preset without one."
  @spec sun_percents(String.t()) :: [integer]
  def sun_percents(preset_id) do
    case Map.get(Application.get_env(:coordinator, :world_light, %{}), preset_id) do
      nil -> []
      light -> Enum.filter(@sun_percents, &(sun_light_error(light, &1) == nil))
    end
  end

  # A key as the message quotes it: JSON for a string (what a request carries),
  # `inspect` for anything a direct caller might pass (nil, an atom, a tuple),
  # which Jason could not encode, and this process must not raise on.
  defp key_name(key) when is_binary(key), do: Jason.encode!(key)
  defp key_name(key), do: inspect(key)

  # ---- segments ----

  defp build_segments(spec, next) do
    per = spec["segmentSteps"]
    count = div(spec["steps"] + per - 1, per)

    {segments, next} =
      for cond <- spec["conditions"],
          seed <- spec["seeds"],
          k <- 0..(count - 1),
          reduce: {%{}, next} do
        {acc, n} ->
          id = "seg-#{n}"
          run = "#{spec["experiment"]}/#{spec["presetId"]}/#{cond}/seed-#{seed}"
          steps = min(per, spec["steps"] - k * per)

          seg =
            Segment.new(
              id,
              run,
              spec["experiment"],
              cond,
              seed,
              k,
              k == count - 1,
              k * per,
              steps
            )

          {Map.put(acc, id, seg), n + 1}
      end

    segments = if spec["metapopulation"], do: wire_imports(segments, spec), else: segments
    {segments, next}
  end

  # Segment k of (condition, seed) imports from the ring-predecessor seed's
  # segment k - 1 (same condition), for k >= 1 -- segment 0 never imports (see
  # the moduledoc): the ring is `spec["seeds"]`'s own order, wrapping, shared
  # by every condition except "no-migration" (that condition's runs are the
  # metapopulation-level control -- see conditions.ts's own "no-migration").
  defp wire_imports(segments, spec) do
    seeds = spec["seeds"]
    by_run_index = Map.new(segments, fn {id, s} -> {{s.run, s.index}, id} end)

    ring_predecessor = fn seed ->
      i = Enum.find_index(seeds, &(&1 == seed))
      Enum.at(seeds, rem(i - 1 + length(seeds), length(seeds)))
    end

    Map.new(segments, fn {id, s} ->
      import_from =
        if s.index > 0 and s.condition != "no-migration" and length(seeds) > 1 do
          partner_run =
            "#{spec["experiment"]}/#{spec["presetId"]}/#{s.condition}/seed-#{ring_predecessor.(s.seed)}"

          Map.get(by_run_index, {partner_run, s.index - 1})
        end

      # Only set the key when there's an actual predecessor: an ordinary run
      # (or a "no-migration" run's segments) must stay byte-identical to a
      # segment that never had `import_from` at all (review P2) -- `%{s |
      # import_from: ...}` update syntax would raise since `Segment.new`
      # itself now omits the key when absent (see its own doc).
      {id, if(import_from, do: Map.put(s, :import_from, import_from), else: s)}
    end)
  end

  # {run, index} -> segment id, so predecessor lookups are O(1).
  defp reindex(s),
    do: Map.put(s, :index, Map.new(s.segments, fn {id, seg} -> {{seg.run, seg.index}, id} end))

  # Verification first (by a different island), then runnable segments in run
  # order; segment k is runnable once k - 1 is done or verified. A segment this
  # island's `capabilities` cannot run (see the moduledoc) is skipped, not
  # waited for: later segments of other experiments are still offered.
  defp pick_task(s, island, capabilities, now) do
    segs = s.segments |> Map.values() |> Enum.sort_by(&{&1.run, &1.index})
    gated = gated_experiments(s, capabilities)

    verify =
      Enum.find(segs, fn seg ->
        seg.status == "done" and maybe_verify?(seg, s) and
          not Segment.pending_or_assigned_verify?(seg) and
          Segment.accepted_island(seg) != island and
          metrics_version_compatible?(s, seg, island) and
          not gated?(gated, capabilities, seg) and garden_island?(s, seg, island)
      end)

    runnable =
      Enum.find(segs, fn seg ->
        seg.status == "pending" and released?(s, seg) and not food_hold?(s, seg, now) and
          (seg.index == 0 or prev_done?(s, seg)) and
          metrics_version_compatible?(s, seg, island) and import_ready?(s, seg) and
          not gated?(gated, capabilities, seg) and garden_island?(s, seg, island)
      end)

    lease = rand(12)

    cond do
      verify ->
        {:ok, seg} = Segment.assign_verify(verify, island, lease, now)
        {task("verify", seg, lease, s), put_in(s, [:segments, seg.id], seg)}

      runnable ->
        {:ok, seg} = Segment.assign_run(runnable, island, lease, now)
        {task("run", seg, lease, s), put_in(s, [:segments, seg.id], seg)}

      true ->
        {%{kind: "idle"}, s}
    end
  end

  defp prev_seg(s, seg) do
    case s.index[{seg.run, seg.index - 1}] do
      nil -> nil
      id -> s.segments[id]
    end
  end

  defp prev_done?(s, seg) do
    case prev_seg(s, seg) do
      %{status: st} when st in ["done", "verified"] -> true
      _ -> false
    end
  end

  # The barrier: a segment with a cross-run `import_from` is runnable only
  # once that predecessor (a different run's same-index segment) is itself
  # done or verified. No `import_from` (a plain run, or a "no-migration"
  # run within a metapopulation experiment) is trivially ready. This doesn't
  # need any island-liveness handling of its own: if the predecessor's
  # producing island vanishes, the existing stale-lease reclaim
  # (`Segment.reclaim_stale/3`, already run at the top of `{:next, ...}`)
  # requeues its segment like any other, and any island can pick it up --
  # once redone, this barrier clears on the next `pick_task/4` call.
  defp import_ready?(s, seg) do
    case Map.get(seg, :import_from) do
      nil -> true
      id -> (imp = s.segments[id]) && imp.status in ["done", "verified"]
    end
  end

  defp task(kind, seg, lease, s) do
    spec = s.experiments[seg.experiment].spec
    prev = if seg.index == 0, do: nil, else: prev_seg(s, seg)
    import_from = Map.get(seg, :import_from)
    import_seg = import_from && s.segments[import_from]

    # Whether *this experiment* has a metapopulation, not whether this
    # particular segment gets an import: a "no-migration" run's segments
    # never get `import_from` wiring, but RunSpec.metapopulation still
    # needs to be present for them (see runner.ts's specConfig), which
    # checks metapopulation presence, not import_from, to accept
    # "no-migration" as *meaningful* -- the control is exempted from the
    # exchange itself, not from belonging to the metapopulation.
    #
    # For an ordinary (non-metapopulation) experiment, `metapopulation`,
    # `importFrom` and `importHash` are omitted entirely rather than set to
    # `nil` -- so an ordinary run's task payload is byte-identical to its
    # shape before metapopulation existed (review P2 -- see runner.ts's
    # manifest and stitch.ts's stitched segments for the same discipline).
    spec_map =
      %{
        experiment: spec["experiment"],
        presetId: spec["presetId"],
        condition: seg.condition,
        seed: seg.seed,
        steps: seg.steps,
        censusEvery: spec["censusEvery"],
        deepEvery: spec["deepEvery"],
        checkpointEvery: 0
      }
      |> maybe_put(:metapopulation, task_metapopulation(spec, seg))
      # The whole schedule, to every segment (see the moduledoc): the runner
      # keeps the entries this segment owns. Absent from every other payload.
      |> maybe_put(:interventions, spec["interventions"])

    %{
      kind: kind,
      lease: lease,
      segment: %{
        id: seg.id,
        run: seg.run,
        index: seg.index,
        startStep: seg.start_step,
        steps: seg.steps
      },
      spec: spec_map,
      startFrom: prev && prev.id,
      startHash: prev && Segment.accepted_state_hash(prev)
    }
    |> maybe_put(:importFrom, import_from)
    |> maybe_put(:importHash, import_seg && Segment.accepted_state_hash(import_seg))
  end

  # Sets `key` only when `value` is present -- an absent (opt-in) field must
  # be omitted from the payload entirely, not set to `nil`, so ordinary
  # (non-metapopulation) task payloads stay byte-identical to their
  # pre-metapopulation shape (review P2).
  defp maybe_put(map, _key, nil), do: map
  defp maybe_put(map, key, value), do: Map.put(map, key, value)

  # `spec["metapopulation"]` (topology/migrantCount/salt, shared by the whole
  # experiment) widened with this *segment's own* `ringNamespace`: its 1-based
  # position in the ring's `seeds` list (review P1 -- WorldConfig.ringNamespace,
  # mixed into every founder/mutation id at birth so ids stay unique across the
  # ring's runs; see runner.ts's specConfig). Every run in a metapopulation
  # experiment gets one, including "no-migration" runs (uniformity; see
  # RunSpec.metapopulation's own doc on why that's fine even though such a
  # run's ids never actually get exchanged).
  defp task_metapopulation(spec, seg) do
    case spec["metapopulation"] do
      nil -> nil
      m -> Map.put(m, "ringNamespace", Enum.find_index(spec["seeds"], &(&1 == seg.seed)) + 1)
    end
  end

  # A deterministic fraction of segments is replayed, and the final segment of
  # every run always is. Purely a function of the segment id (hashed) and the
  # run's `verifyFraction`, so it is safe to recompute on every `pick_task/4`
  # call instead of deciding it once at completion time and storing the
  # answer — same result either way, one fewer thing to persist.
  defp maybe_verify?(seg, s) do
    frac = s.experiments[seg.experiment].spec["verifyFraction"]
    <<h::32, _::binary>> = :crypto.hash(:sha256, seg.id)
    seg.last or h / 4_294_967_296 < frac
  end

  defp current_run(seg), do: Enum.find(seg.attempts, &(&1.kind == "run" and Attempt.pending?(&1)))

  defp current_verify(seg),
    do: Enum.find(seg.attempts, &(&1.kind == "verify" and Attempt.pending?(&1)))

  # ---- capability gating (see moduledoc) ----

  @pond_capability "ponds-v1"
  # The hunt's arms nat and shuf (WorldConfig.pondArm), set by these conditions
  # (packages/runner/src/conditions.ts); kept in sync with it by hand, like
  # `:presets`/`:conditions` in config.exs.
  @current_capability "ponds-v2"
  @current_conditions ~w(pond-nat pond-shuf)

  # Scheduled interventions (`spec["interventions"]`, see the moduledoc): an
  # island that cannot apply them would run the segment clean.
  @interventions_capability "interventions-v1"

  # A schedule holding a sun (see the moduledoc): asked for besides
  # `@interventions_capability`.
  @sun_capability "sun-v1"

  # The breeder (WorldConfig.pondScore, see the moduledoc): its conditions, by
  # prefix (packages/runner/src/conditions.ts's pond-breed-<score>,
  # pond-mass-<score> and pond-drift-<score>, held to it by
  # packages/runner/test/coordinator-conditions.test.ts), and every experiment
  # on a `:breed_presets` preset.
  @breed_capability "breed-v1"
  @breed_condition_prefixes ~w(pond-breed- pond-mass- pond-drift-)

  defp breed_condition?(condition),
    do: is_binary(condition) and String.starts_with?(condition, @breed_condition_prefixes)

  # ---- recorded capabilities (see the moduledoc; never read by gating) ----

  @known_capabilities [
    @pond_capability,
    @current_capability,
    @interventions_capability,
    @breed_capability,
    @sun_capability
  ]
  @stored_capability ~r/\A[a-z][a-z0-9]*(-[a-z0-9]+)*\z/
  @stored_capability_bytes 32
  @stored_unknown_max 4

  # The copy of a request's capabilities kept on the island record: names that
  # match `@stored_capability` within `@stored_capability_bytes`, deduplicated
  # and sorted; every name the Queue gates on, and the first
  # `@stored_unknown_max` other names in sorted order (not by recency: an
  # island advertising four names that sort early has a fifth, later one left
  # out of its own record; display only). At most 8 names.
  defp stored_capabilities(capabilities) do
    names =
      capabilities
      |> Enum.filter(
        &(is_binary(&1) and byte_size(&1) <= @stored_capability_bytes and
            Regex.match?(@stored_capability, &1))
      )
      |> Enum.uniq()
      |> Enum.sort()

    {known, unknown} = Enum.split_with(names, &(&1 in @known_capabilities))
    Enum.sort(known ++ Enum.take(unknown, @stored_unknown_max))
  end

  @doc "The capability names the Queue gates on (`gated_experiments/2`, `gated?/3`); every one is always kept in a recorded copy."
  @spec known_capabilities() :: [String.t()]
  def known_capabilities, do: @known_capabilities

  # On load, every island's recorded `:capabilities` goes through the same
  # cleaning as a request's (`record_capabilities/2`): a state.bin is trusted
  # as written by this code, but a list it never could have written (not a
  # proper list, non-strings, too many names, too long) is cleaned or dropped
  # rather than breaking `/api/status` later.
  defp clean_recorded_capabilities(%{islands: islands} = s) when is_map(islands) do
    islands =
      Map.new(islands, fn
        {id, %{capabilities: caps} = island} ->
          caps = if proper_list?(caps), do: caps, else: []
          {id, record_capabilities(island, caps)}

        other ->
          other
      end)

    %{s | islands: islands}
  end

  defp clean_recorded_capabilities(s), do: s

  defp proper_list?([]), do: true
  defp proper_list?([_ | rest]), do: proper_list?(rest)
  defp proper_list?(_), do: false

  # Sets the island's `:capabilities` to the stored copy, or removes the key
  # when nothing is storable, so a record that never advertised anything keeps
  # its shape from before.
  defp record_capabilities(island, capabilities) do
    case stored_capabilities(capabilities) do
      [] -> Map.delete(island, :capabilities)
      names -> Map.put(island, :capabilities, names)
    end
  end

  # The experiments whose work an island with `capabilities` must not be
  # offered: every pond experiment, unless it advertises `@pond_capability`;
  # every experiment on a breed preset, unless it advertises
  # `@breed_capability`; and every experiment with scheduled interventions,
  # unless it advertises `@interventions_capability`, and every one whose
  # schedule holds a sun, unless it advertises `@sun_capability`. Computed once per
  # `pick_task/4` call rather than per segment, so a large queue costs one
  # pass over the experiments, not one config lookup per segment.
  defp gated_experiments(s, capabilities) do
    ponds? = @pond_capability in capabilities
    breed? = @breed_capability in capabilities
    scheduled? = @interventions_capability in capabilities
    sun? = @sun_capability in capabilities

    if ponds? and breed? and scheduled? and sun? do
      MapSet.new()
    else
      for {name, exp} <- s.experiments,
          (not ponds? and pond_preset?(exp.spec["presetId"])) or
            (not breed? and breed_preset?(exp.spec["presetId"])) or
            (not scheduled? and exp.spec["interventions"] != nil) or
            (not sun? and sun_schedule?(exp.spec["interventions"])),
          into: MapSet.new(),
          do: name
    end
  end

  defp sun_schedule?(list) when is_list(list),
    do: Enum.any?(list, &(is_map(&1) and &1["kind"] == "sun"))

  defp sun_schedule?(_), do: false

  # Whether `seg` is withheld from an island with `capabilities`: its experiment
  # is in `gated` (above), or its condition runs one of the hunt's arms and the
  # island lacks `@current_capability`, or it is one of the breeder's and the
  # island lacks `@breed_capability`.
  defp gated?(gated, capabilities, seg),
    do:
      MapSet.member?(gated, seg.experiment) or
        (seg.condition in @current_conditions and @current_capability not in capabilities) or
        (breed_condition?(seg.condition) and @breed_capability not in capabilities)

  # ---- metrics-version gating (see moduledoc) ----

  # A join's self-declared metrics version; missing/malformed ⇒ 1 (an island
  # that predates the field can only ever have computed version 1's metrics).
  defp metrics_version_of(info) do
    case info["metricsVersion"] do
      v when is_integer(v) and v > 0 -> v
      _ -> 1
    end
  end

  # An already-registered island's declared version; absent (registered by
  # server code before this field existed) ⇒ 1, same fallback as `metrics_version_of/1`.
  defp island_metrics_version(s, island_id),
    do: Map.get(s.islands[island_id] || %{}, :metrics_version, 1)

  # An experiment's required version, as recorded on its spec at creation
  # (`validate/1`); an experiment created before this field existed ⇒ 1.
  defp experiment_metrics_version(s, experiment) do
    case s.experiments[experiment] do
      nil -> Application.get_env(:coordinator, :metrics_version, 1)
      exp -> exp.spec["metricsVersion"] || 1
    end
  end

  defp metrics_version_compatible?(s, seg, island_id),
    do: island_metrics_version(s, island_id) == experiment_metrics_version(s, seg.experiment)

  # The active run attempt this island/lease currently owns, if any — no
  # file I/O, just the in-memory attempt record (which, for `manifest.json`,
  # already carries whatever `metrics_version` `publish_file/7` was given —
  # see `Coordinator.Attempt`'s moduledoc for where that comes from).
  defp current_run_attempt(seg, island_id, lease),
    do: Enum.find(seg.attempts, &(&1.kind == "run" and Attempt.active?(&1, island_id, lease)))

  # A failure reason as stored and shown (see `@max_failure_reason`): a
  # string, at most that many bytes, cut between codepoints, valid UTF-8 (a
  # direct caller's invalid bytes would make every later `/api/status` fail
  # to encode), and at most that many graphemes. Anything else counts as no
  # reason. The byte prefix is taken first, by `binary_part/3`, so the work
  # done inside this process is bounded by the prefix and never by what a
  # caller sent (Sol pass 2: walking the codepoints of a many-megabyte string
  # here would stall every island's calls for seconds).
  defp bound_reason(reason) when is_binary(reason) do
    prefix = binary_part(reason, 0, min(byte_size(reason), @max_failure_reason_bytes))

    case whole_codepoints(prefix, 3) do
      nil -> ""
      valid -> String.slice(valid, 0, @max_failure_reason)
    end
  end

  defp bound_reason(_), do: ""

  # `prefix` as valid UTF-8, dropping up to `tries` trailing bytes of a
  # codepoint the cut split (four bytes at most, so three to drop); nil when
  # it is invalid anyway.
  defp whole_codepoints(prefix, tries) do
    cond do
      String.valid?(prefix) ->
        prefix

      tries > 0 and byte_size(prefix) > 0 ->
        whole_codepoints(binary_part(prefix, 0, byte_size(prefix) - 1), tries - 1)

      true ->
        nil
    end
  end

  # The listing's `failure` of a `"failed"` segment (the reporting attempt's
  # kind, island, host and reason, and when it was reported -- see `fail/4`),
  # nil for every other segment.
  defp failure_of(s, %{status: "failed"} = seg) do
    a = Segment.failed_attempt(seg)

    %{
      kind: a && a.kind,
      island: a && a.island,
      by: host(s, a && a.island),
      reason: Segment.failure_reason(seg),
      failedAt: a && Map.get(a, :failed_at)
    }
  end

  defp failure_of(_s, _seg), do: nil

  # ---- joining, and the bound on the island table ----

  defp join_island(info, garden, s) do
    id = "isl-" <> rand(9)
    token = rand(32)
    now = now()

    island = %{
      id: id,
      token_hash: :crypto.hash(:sha256, token),
      adapter: clip(info["adapter"]),
      user_agent: clip(info["userAgent"]),
      # The metrics version this island's runner code computes (see the
      # moduledoc); an island that doesn't declare one predates the concept.
      metrics_version: metrics_version_of(info),
      joined_at: now,
      last_seen: now,
      runs: 0,
      verifies: 0
    }

    # Whether this island may tend gardens (see the moduledoc): the key is put
    # only on an island that showed the configured token (the token itself is
    # not kept), so every other island record, and `/api/status`, keeps its
    # shape from before gardens.
    island = if garden == true, do: Map.put(island, :garden, true), else: island

    s = put_in(s, [:islands, id], island)
    {:reply, {:ok, %{id: id, token: token}}, persist(s)}
  end

  # The island table is bounded (`max_islands`): every join adds a record that
  # is never otherwise removed, and every record is rewritten into state.bin
  # on every persist. Below the bound nothing happens. At it, expired leases
  # are reclaimed first (a vanished island's attempt otherwise protects it
  # until some island asks for work), then the candidates are the islands that
  # never ran or verified anything and hold no pending attempt. Every candidate
  # last seen more than `island_prune_after_ms` ago is forgotten, all at once
  # (so the next joins do not scan again); if none is that old, the least
  # recently seen candidates not seen within `island_prune_grace_ms`, a
  # twentieth of the bound: an island that just joined (and has not asked for
  # work yet) or is polling for work is never evicted by somebody else's join,
  # so a join flood at the bound costs new joiners a 503, not existing islands
  # their credentials. `:full` if there is no such candidate. Forgetting such an island is safe for every reader:
  # `host/2` and the garden's view already treat an island id they cannot find
  # as unknown, and its token stops authenticating.
  defp make_room(s) do
    bound = Application.get_env(:coordinator, :max_islands, 20_000)

    if map_size(s.islands) < bound do
      {:ok, s}
    else
      now = now()
      cutoff = now - Application.get_env(:coordinator, :island_prune_after_ms, 86_400_000)
      grace = now - Application.get_env(:coordinator, :island_prune_grace_ms, 600_000)
      reclaimed = %{s | segments: Segment.reclaim_stale(s.segments, now, lease_ms())}
      holding = islands_holding_attempts(reclaimed)

      candidates =
        for {id, i} <- reclaimed.islands,
            i.runs + i.verifies == 0,
            not MapSet.member?(holding, id),
            do: {id, i.last_seen}

      forget =
        case for({id, seen} <- candidates, seen < cutoff, do: id) do
          [] ->
            candidates
            |> Enum.filter(fn {_, seen} -> seen < grace end)
            |> Enum.sort_by(&elem(&1, 1))
            |> Enum.take(max(div(bound, 20), 1))
            |> Enum.map(&elem(&1, 0))

          stale ->
            stale
        end

      if forget == [] do
        :full
      else
        Logger.info("coordinator: forgot #{length(forget)} idle islands at the island bound")
        {:ok, %{reclaimed | islands: Map.drop(reclaimed.islands, forget)}}
      end
    end
  end

  # Whether `island` already holds `island_max_pending` pending attempts
  # (nil: no cap).
  defp at_pending_cap?(s, island) do
    case Application.get_env(:coordinator, :island_max_pending, 4) do
      nil ->
        false

      cap ->
        held =
          for {_, seg} <- s.segments,
              a <- seg.attempts,
              a.outcome == "pending" and a.island == island,
              reduce: 0,
              do: (n -> n + 1)

        held >= cap
    end
  end

  # Islands with a pending (assigned, not completed) attempt, in one pass.
  defp islands_holding_attempts(s) do
    for {_, seg} <- s.segments,
        a <- seg.attempts,
        a.outcome == "pending",
        into: MapSet.new(),
        do: a.island
  end

  defp host(_s, nil), do: "?"
  defp host(s, id), do: (s.islands[id] || %{adapter: "?"}).adapter
  defp now, do: Coordinator.Clock.now()
  defp rand(n), do: Base.url_encode64(:crypto.strong_rand_bytes(n), padding: false)
  defp clip(v) when is_binary(v), do: String.slice(v, 0, 200)
  defp clip(_), do: "?"

  # Never `:dir`, `:index`, `:food_hands` or `:meteor_hands` (the hands live in
  # memory only); `:gardens` only while empty (see `@state_version`).
  defp persist_drops(%{gardens: gardens}) when map_size(gardens) == 0,
    do: [:dir, :index, :food_hands, :meteor_hands, :leaders_tasks, :leaders_waiting, :gardens]

  defp persist_drops(_s),
    do: [:dir, :index, :food_hands, :meteor_hands, :leaders_tasks, :leaders_waiting]

  defp persist(s) do
    path = Path.join(s.dir, "state.bin")
    tmp = path <> ".tmp"
    File.write!(tmp, :erlang.term_to_binary(Map.drop(s, persist_drops(s))))
    File.rename!(tmp, path)
    s
  end
end
