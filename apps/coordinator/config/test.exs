import Config

# We don't run a server during test. If one is required,
# you can enable the server option below.
config :coordinator, CoordinatorWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4002],
  secret_key_base: "0AMxU+iF3yD2qJo1Y23suLkNhmiaiP+gNKtuM5f++hNnMA0ktqI1RYurXp5KkYup",
  server: false

# Print only warnings and errors during test
config :logger, level: :warning

# Initialize plugs at runtime for faster test compilation
config :phoenix, :plug_init_mode, :runtime

# Sort query params output of verified routes for robust url comparisons
config :phoenix,
  sort_verified_routes_query_params: true

# Tests start their own isolated queue with start_supervised!/1.
config :coordinator, start_queue: false, start_discovery: false

# Tokenless experiment creation from loopback clients (never in production).
config :coordinator, allow_local_admin: true

# Pinned independently of config.exs's production default (which mirrors
# packages/schema's current METRICS_VERSION and will keep changing): most
# tests neither declare a join-time metrics version nor care about the
# concept at all, so both an island (undeclared ⇒ 1) and an experiment
# (this config's value) must default to the *same* number, or every one of
# them would suddenly go idle instead of being offered work. Tests that
# specifically exercise version gating override this with `Application.put_env/3`.
config :coordinator, metrics_version: 1
