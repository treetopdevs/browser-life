import Config

# Force using SSL in production. This also sets the "strict-security-transport" header,
# known as HSTS. If you have a health check endpoint, you may want to exclude it below.
# Note `:force_ssl` is required to be set at compile-time.
config :coordinator, CoordinatorWeb.Endpoint,
  force_ssl: [
    rewrite_on: [:x_forwarded_proto],
    exclude: [
      # paths: ["/health"],
      hosts: ["localhost", "127.0.0.1"]
    ]
  ]

# Do not print debug messages in production
config :logger, level: :info

# Production is same-origin (Caddy serves the site and proxies /api), so no
# cross-origin caller is allowed unless BL_CORS_ORIGINS names one
# (config/runtime.exs refuses a wildcard or a non-https origin there).
config :coordinator, cors_origins: []

# The join budget is per client address, and through Traefik -> Caddy every
# visitor is expected to arrive as one address (deploy/README.md), which would
# make it one global cap that a single script can spend for everyone. It is off
# here until the proxy passes on client addresses; then set
# BL_ISLAND_JOINS_PER_ADDRESS (20 is the intended number) together with
# BL_TRUST_FORWARDED_FOR=1. The per-island budgets, the pending cap and the
# island-table bound hold regardless.
config :coordinator, island_joins_per_address: nil

# For the same reason every visitor is one address to the garden's food ask, so
# it can hold one hand at most: the food block says so (`sharedAddress`) and the
# page tells visitors. config/runtime.exs clears it when BL_TRUST_FORWARDED_FOR=1
# is set, which deploy/README.md's fix sets together with the Caddy change.
config :coordinator, garden_shared_address: true

# Runtime production configuration, including reading
# of environment variables, is done on config/runtime.exs.
