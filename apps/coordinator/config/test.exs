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
config :coordinator, start_queue: false

# Tokenless experiment creation from loopback clients (never in production).
config :coordinator, allow_local_admin: true
