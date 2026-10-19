# This file is responsible for configuring your application
# and its dependencies with the aid of the Config module.
#
# This configuration file is loaded before any dependency and
# is restricted to this project.

# General application configuration
import Config

config :coordinator,
  generators: [timestamp_type: :utc_datetime]

# Configure the endpoint
config :coordinator, CoordinatorWeb.Endpoint,
  url: [host: "localhost"],
  adapter: Bandit.PhoenixAdapter,
  render_errors: [
    formats: [json: CoordinatorWeb.ErrorJSON],
    layout: false
  ],
  pubsub_server: Coordinator.PubSub,
  live_view: [signing_salt: "/JCtZLGW"]

# Configure Elixir's Logger
config :logger, :default_formatter,
  format: "$time $metadata[$level] $message\n",
  metadata: [:request_id]

# Use Jason for JSON parsing in Phoenix
config :phoenix, :json_library, Jason

# Phoenix's default parameter filter is ["password"] alone, and it matches
# substrings case-sensitively, so an island's join-body "gardenToken" would be
# printed in a debug `Parameters:` line. "token" and "Token" are added: every
# key containing either (an island's "token" too) is now filtered, at any depth,
# and so is a map entry's string value containing "token=" or "Token=" (Phoenix
# appends "=" to the patterns it matches against values, and leaves a bare
# string inside a list as it is; deps/phoenix/lib/phoenix/logger.ex).
config :phoenix, :filter_parameters, ["password", "token", "Token"]

# Archipelago: accepted presets and conditions (must match packages/schema and
# packages/runner), browser origins allowed to act as islands, and the admin
# token required to create experiments (unset: loopback clients only).
config :coordinator,
  data_dir: "data",
  presets:
    ~w(spots gradient spots-m3 gradient-m3 soup seasons large archipelago ponds ponds-small wild-storm-large breeder),
  # The last 21 are the breeder's (docs/archipelago-breed-2026-10-18.md):
  # pond-breed-<score>, pond-mass-<score> and pond-drift-<score> for each of
  # packages/schema's POND_SCORES, the score fixed by the id (a coordinator
  # spec takes no overrides). Held to packages/runner/src/conditions.ts by
  # packages/runner/test/coordinator-conditions.test.ts. pond-nat and
  # pond-shuf stay out (the hunt protocol, §13).
  conditions: ~w(
    treatment no-mutation neutral uniform-light fixed-env replenished no-signal-motility no-migration pond-rand pond-cont
    pond-breed-mass pond-mass-mass pond-drift-mass
    pond-breed-drive pond-mass-drive pond-drift-drive
    pond-breed-reach pond-mass-reach pond-drift-reach
    pond-breed-seed pond-mass-seed pond-drift-seed
    pond-breed-body pond-mass-body pond-drift-body
    pond-breed-drive+seed pond-mass-drive+seed pond-drift-drive+seed
    pond-breed-drive+seed+body pond-mass-drive+seed+body pond-drift-drive+seed+body
  ),
  cors_origins: ["http://localhost:5173"],
  admin_token: nil,
  allow_local_admin: false,
  rule_version: 1,
  # Every experiment created from now on requires this metrics version (see
  # Coordinator.Queue's moduledoc); must match packages/schema/src/config.ts's
  # METRICS_VERSION. Bump it there and here together. Deliberately not bumped
  # retroactively on already-persisted experiments (their spec keeps whatever
  # it was created with) — a long-running experiment created under an older
  # value stays pinned to it, so a deploy that bumps this mid-run does not
  # strand its in-flight islands; new experiments pick up the new value.
  metrics_version: 2,
  # condition => presets it cannot be applied to (packages/runner/src/conditions.ts).
  # "no-migration" is not listed here: it is meaningful whenever *either*
  # mechanism it could remove is present (tile migration, via :migration_period
  # below, or a per-experiment :metapopulation), so Queue.incompatible/3 checks
  # it dynamically against the spec instead of this static preset list. The
  # pond presets have uniform light and no seasons, and the pond conditions
  # need a preset with the pond cycle. The breeder's 21 conditions are not
  # listed either: Queue.incompatible/3 refuses them on every preset outside
  # `:pond_presets`, by their prefix. pond-cont is refused on the breeder (an
  # arm cont with a pondScore fails validateConfig). Held to the runner's own
  # refusals, every accepted preset x condition, by
  # packages/runner/test/coordinator-conditions.test.ts.
  incompatible: %{
    "uniform-light" => ~w(spots spots-m3 soup ponds ponds-small breeder),
    "fixed-env" =>
      ~w(spots gradient spots-m3 gradient-m3 soup large archipelago ponds ponds-small breeder),
    "pond-rand" =>
      ~w(spots gradient spots-m3 gradient-m3 soup seasons large archipelago wild-storm-large),
    "pond-cont" =>
      ~w(spots gradient spots-m3 gradient-m3 soup seasons large archipelago wild-storm-large breeder)
  },
  # preset => its migrationPeriod (packages/schema/src/presets.ts's "archipelago"
  # preset; 0/absent for every preset without migration configured). Used only to
  # validate cadence at experiment creation (Queue.effective_migration_period/1) --
  # migrationPeriod must be a multiple of censusEvery, and segmentSteps a multiple
  # of migrationPeriod, or every island assigned to the run fails at runtime
  # (packages/runner/src/runner.ts). Must be kept in sync with the TS preset by hand,
  # like `:presets`/`:conditions`/`:incompatible` above already are.
  migration_period: %{"archipelago" => 200},
  # Presets with the pond cycle (packages/schema/src/presets.ts's "ponds" and
  # "ponds-small": WorldConfig.pondPeriod/pondK/pondArm). Their segments and
  # verify tasks go only to islands that advertise the "ponds-v1" capability
  # (Queue.pick_task/4), and they refuse a :metapopulation, whose cross-run
  # exchange would move matter into and out of their ponds. Kept in sync with
  # the TS presets by hand, like `:presets` above.
  pond_presets: ~w(ponds ponds-small breeder),
  # The pond presets whose config sets pondScore (packages/schema's "breeder",
  # whose `treatment` is the breed arm). Every segment of such an experiment,
  # run or verify, goes only to an island that advertises "breed-v1" as well
  # as "ponds-v1" (Queue.pick_task/4; the breeder's conditions are gated on
  # any pond preset by their prefix). Held to the TS presets by
  # packages/runner/test/coordinator-presets.test.ts.
  breed_presets: ~w(breeder),
  # preset => its pondPeriod (the same presets.ts presets; every condition
  # keeps it, pond-cont included). Used only to validate cadence at experiment
  # creation, like `:migration_period`: pondPeriod must be a multiple of
  # censusEvery (packages/runner/src/runner.ts refuses it otherwise), and
  # segmentSteps a multiple of pondPeriod. Must be kept in sync with the TS
  # presets by hand.
  pond_period: %{"ponds" => 10_000, "ponds-small" => 1_000, "breeder" => 5_000},
  # preset => {width, height} of its world in cells (packages/schema/src/presets.ts:
  # tileW * tilesX by tileH * tilesY). Used only to refuse a scheduled lesion or
  # feed centred outside the world at experiment creation (Queue.invalid_interventions/1),
  # which the runner would otherwise throw on, on every island handed the
  # segment. Kept in sync with the TS presets by
  # packages/runner/test/coordinator-presets.test.ts, which reads this file.
  world_size: %{
    "spots" => {256, 256},
    "gradient" => {256, 256},
    "spots-m3" => {256, 256},
    "gradient-m3" => {256, 256},
    "soup" => {256, 256},
    "seasons" => {256, 256},
    "large" => {512, 512},
    "archipelago" => {128, 128},
    "ponds" => {512, 512},
    "ponds-small" => {128, 128},
    "wild-storm-large" => {512, 512},
    "breeder" => {256, 256}
  }

# The garden (Coordinator.Garden; README "The garden"): the presets a keeper
# may found one on (a subset of :presets), the garden the unnamed public routes
# read, whether the letter rate limiter's address is the right-most
# X-Forwarded-For entry (only behind a reverse proxy that sets it), how many
# letters one address may post per window, and how long a public view may be
# served from the cache held outside the queue process (0 disables the cache).
# Every consumer reads these with Application.get_env at call time, never into
# a module attribute, so tests can override them.
#
# More: `garden_refusals_per_address` is how many letters the queue may refuse an
# address per window before it is answered 429 without reaching the queue;
# `garden_letter_table_max` caps the rows of the letter budget table;
# `garden_island_token` (BL_GARDEN_ISLAND_TOKEN), when set, restricts a garden's
# days to islands that joined showing it (nil: any island may tend a garden).
#
# Food (docs/garden-food-2026-10-18.md), for a garden founded with "food": true
# only: `garden_food_asks` distinct networks (K) in one dawn period call a food,
# at most one every `garden_food_every_days` garden days (N); a keeper may set
# both per garden at founding (foodAsks 2..1000, foodEveryDays 1..365). Each
# food is `garden_food_amount` quanta per cell (1..64) over a disc of
# `garden_food_radius` (1..32) at the world's centre. All four are copied into
# the garden's record when it is founded, so changing them never changes a live
# garden's rule. `garden_hands_sweep_ms` is how often the queue forgets every
# garden's hands of a past dawn period (the hands live in memory only).
# `garden_shared_address` (true in prod.exs until the proxy passes client
# addresses, D-17; runtime.exs clears it with BL_TRUST_FORWARDED_FOR=1) puts
# `sharedAddress` on the food block, so the page says every visitor counts as
# one network. `garden_call_timeout_ms` bounds the hands route's Queue call.
#
# Meteor (docs/garden-meteor-2026-10-18.md), for a garden founded with
# "meteor": true only, independently of food: `garden_meteor_asks` distinct
# networks (K, 2..1000) in one dawn period call a meteor, a lesion of radius
# `garden_meteor_radius` (33..255, and at most the world's largest lesion, else
# founding is refused) at a place fixed by rule, at most one every
# `garden_meteor_every_days` garden days (N, 1..365); a keeper may set K and N
# per garden at founding (meteorAsks, meteorEveryDays). All three are copied
# into the garden's record when it is founded.
config :coordinator,
  garden_shared_address: false,
  garden_call_timeout_ms: 5_000,
  garden_food_asks: 5,
  garden_food_every_days: 7,
  garden_food_amount: 16,
  garden_food_radius: 32,
  garden_meteor_asks: 5,
  garden_meteor_every_days: 7,
  garden_meteor_radius: 64,
  garden_hands_sweep_ms: 60_000,
  garden_presets: ~w(wild-storm-large),
  public_garden: "commons",
  trust_forwarded_for: false,
  garden_letters_per_address: 3,
  garden_letter_window_ms: 3_600_000,
  garden_cache_ms: 2_000,
  garden_refusals_per_address: 20,
  garden_letter_table_max: 200_000,
  garden_island_token: nil

# Island abuse controls (Coordinator.IslandLimiter, Coordinator.Queue; README
# "Island limits"), read with Application.get_env at call time. Any budget may
# be nil (off). Joins are budgeted per client address (the garden's rule: the
# peer, or the right-most X-Forwarded-For entry with trust_forwarded_for);
# production turns that off (config/prod.exs) until the deployed proxy passes
# on the real client address (deploy/README.md), since until then every
# visitor shares one address. Task requests (`next`) and segment requests
# (heartbeat, complete, reject, fail, uploads, checkpoint downloads, and an
# island's file downloads; never the administrator's) are
# budgeted per authenticated island, and an island holds at most
# `island_max_pending` assignments at once (`next` is idle past it). A coarse
# ceiling per address across the island routes (all but file downloads) stays
# off (nil) for the same proxy reason. `island_limit_table_max` caps the
# budget table's rows, island ids included; `max_islands` bounds the island
# table (see Coordinator.Queue's moduledoc for what is forgotten at the bound;
# never an island seen within `island_prune_grace_ms`);
# `public_status_cache_ms` is how long /api/public/status (and /healthz) is
# served from a cache outside the queue process (0 disables it), and
# `public_status_wait_ms` how long a request waits for another's refresh.
config :coordinator,
  island_joins_per_address: 20,
  island_join_window_ms: 3_600_000,
  island_next_per_island: 120,
  island_next_window_ms: 60_000,
  island_segment_requests_per_island: 600,
  island_segment_window_ms: 60_000,
  island_max_pending: 4,
  island_requests_per_address: nil,
  island_requests_window_ms: 60_000,
  island_limit_table_max: 200_000,
  max_islands: 20_000,
  island_prune_after_ms: 86_400_000,
  island_prune_grace_ms: 600_000,
  public_status_cache_ms: 2_000,
  public_status_wait_ms: 2_000

# Discovery plane (Coordinator.Discovery; docs/evolvability-discovery-2026-10-04
# PLAN Stage 3b): its own data directory, never inside :data_dir; the research
# join token workers present (unset: loopback only); the lease length; and the
# cloud launch envelope, absent so that the cloud allowance is zero. The
# validator command is set in runtime.exs when deno and tools/discovery.ts are
# found; without one no discovery result is ever accepted.
config :coordinator,
  discovery_data_dir: "data-discovery",
  discovery_join_token: nil,
  discovery_lease_ms: 120_000,
  discovery_cloud_envelope: nil,
  discovery_validator: nil

# Import environment specific config. This must remain at the bottom
# of this file so it overrides the configuration defined above.
import_config "#{config_env()}.exs"
