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
  presets: ~w(spots gradient soup seasons large),
  conditions:
    ~w(treatment no-mutation neutral uniform-light fixed-env replenished no-signal-motility),
  cors_origins: ["http://localhost:5173"],
  admin_token: nil,
  allow_local_admin: false,
  rule_version: 1,
  # condition => presets it cannot be applied to (packages/runner/src/conditions.ts)
  incompatible: %{
    "uniform-light" => ~w(spots soup),
    "fixed-env" => ~w(spots gradient soup large)
  }

# Import environment specific config. This must remain at the bottom
# of this file so it overrides the configuration defined above.
import_config "#{config_env()}.exs"
