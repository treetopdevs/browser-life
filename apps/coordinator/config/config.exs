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

# Archipelago: accepted presets and conditions (must match packages/schema and
# packages/runner), browser origins allowed to act as islands, and the admin
# token required to create experiments (unset: loopback clients only).
config :coordinator,
  data_dir: "data",
  presets:
    ~w(spots gradient spots-m3 gradient-m3 soup seasons large archipelago ponds ponds-small),
  conditions:
    ~w(treatment no-mutation neutral uniform-light fixed-env replenished no-signal-motility no-migration pond-rand pond-cont),
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
  # need a preset with the pond cycle.
  incompatible: %{
    "uniform-light" => ~w(spots spots-m3 soup ponds ponds-small),
    "fixed-env" =>
      ~w(spots gradient spots-m3 gradient-m3 soup large archipelago ponds ponds-small),
    "pond-rand" => ~w(spots gradient spots-m3 gradient-m3 soup seasons large archipelago),
    "pond-cont" => ~w(spots gradient spots-m3 gradient-m3 soup seasons large archipelago)
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
  pond_presets: ~w(ponds ponds-small),
  # preset => its pondPeriod (the same presets.ts presets; every condition
  # keeps it, pond-cont included). Used only to validate cadence at experiment
  # creation, like `:migration_period`: pondPeriod must be a multiple of
  # censusEvery (packages/runner/src/runner.ts refuses it otherwise), and
  # segmentSteps a multiple of pondPeriod. Must be kept in sync with the TS
  # presets by hand.
  pond_period: %{"ponds" => 10_000, "ponds-small" => 1_000}

# Import environment specific config. This must remain at the bottom
# of this file so it overrides the configuration defined above.
import_config "#{config_env()}.exs"
