import Config

if token = System.get_env("BL_ADMIN_TOKEN"), do: config(:coordinator, admin_token: token)

if config_env() == :prod and System.get_env("BL_ADMIN_TOKEN") in [nil, ""],
  do: raise("BL_ADMIN_TOKEN must be set in production")

# A host spelled exactly as a browser serializes it in `Origin`: an IP literal
# in its canonical form (IPv6 compressed and lowercase, as `:inet.ntoa/1` and
# RFC 5952 write it, with no embedded IPv4, which browsers rewrite to hex), or
# an ASCII lowercase name (no IDN, which browsers send as punycode, no
# wildcard) whose last label is not a number (browsers read such a name as an
# IPv4 address and rewrite it, e.g. 127.1 or 0x7f.1).
browser_host? = fn host ->
  case :inet.parse_address(String.to_charlist(host)) do
    {:ok, ip} ->
      List.to_string(:inet.ntoa(ip)) == host and
        not (tuple_size(ip) == 8 and String.contains?(host, "."))

    _ ->
      Regex.match?(~r/\A[a-z0-9-]+(\.[a-z0-9-]+)*\z/, host) and
        not Regex.match?(~r/(\A|\.)(0x[0-9a-f]*|[0-9]+)\z/, host)
  end
end

# A whole browser origin as a browser sends it in `Origin`: https, a host as
# above, an explicit port only when not 443 and within 1..65535, and nothing
# else (no user, path, query or fragment; "https://a.example/" never matches).
https_origin? = fn o ->
  case URI.new(o) do
    {:ok, %URI{scheme: "https", host: host, port: port, userinfo: nil, path: nil} = u}
    when is_binary(host) and host != "" and port in 1..65_535 ->
      u.query == nil and u.fragment == nil and browser_host?.(host) and
        o == URI.to_string(%URI{scheme: "https", host: host, port: port})

    _ ->
      false
  end
end

if origins = System.get_env("BL_CORS_ORIGINS") do
  origins = origins |> String.split(",", trim: true) |> Enum.map(&String.trim/1)

  # In production an allowed origin may act as an island and read the
  # coordinator's answers in a browser: only named https origins, never "*".
  if config_env() == :prod do
    for o <- origins, not https_origin?.(o) do
      raise "BL_CORS_ORIGINS: #{inspect(o)} is not allowed in production " <>
              "(name whole https:// origins only, like https://example.org, with no path or wildcard)"
    end
  end

  config(:coordinator, cors_origins: origins)
end

# A count from the environment: unset or blank leaves the config as it is;
# "off" (or "0", "none") is nil, a budget switched off, where `off?` allows
# it; a positive whole number is that number; anything else stops the boot
# with the variable's name rather than a bare ArgumentError.
env_count = fn name, off? ->
  raw = System.get_env(name)
  v = raw && raw |> String.trim() |> String.downcase()

  cond do
    v in [nil, ""] ->
      :unset

    off? and v in ["off", "0", "none"] ->
      {:ok, nil}

    match?({n, ""} when n > 0, Integer.parse(v)) ->
      {:ok, v |> Integer.parse() |> elem(0)}

    true ->
      raise "#{name}: #{inspect(raw)} is not a positive whole number" <>
              if(off?, do: " or \"off\"", else: "")
  end
end

# How many islands one client address may join per hour (config.exs, "Island
# abuse controls"; off in production until the proxy passes on client
# addresses, config/prod.exs). "off" switches it off.
with {:ok, n} <- env_count.("BL_ISLAND_JOINS_PER_ADDRESS", true),
     do: config(:coordinator, island_joins_per_address: n)

# The bound on the island table (Coordinator.Queue; default 20,000).
with {:ok, n} <- env_count.("BL_MAX_ISLANDS", false), do: config(:coordinator, max_islands: n)

# Restricts the garden's days to islands that joined with this token in the join
# body's "gardenToken" (unset: any island may tend a garden).
if token = System.get_env("BL_GARDEN_ISLAND_TOKEN"),
  do: config(:coordinator, garden_island_token: token)

# Behind a reverse proxy that appends the peer to X-Forwarded-For, the garden's
# per-address letter budget keys on that header's right-most entry. Only set it
# when the origin port is reachable through that proxy alone (firewalled
# otherwise): a client that can reach the port directly names its own address.
# Without it every visitor behind a loopback proxy shares one budget.
# Setting it also says visitors are no longer one shared address to the
# garden's food ask (`garden_shared_address`, true in prod.exs until then).
if System.get_env("BL_TRUST_FORWARDED_FOR") in ["1", "true"],
  do: config(:coordinator, trust_forwarded_for: true, garden_shared_address: false)

# Lets a test harness (see tests/deno/coordinator_integration.ts) point a real
# server at a scratch directory instead of the default `data/`.
if dir = System.get_env("BL_DATA_DIR"), do: config(:coordinator, data_dir: dir)

if dir = System.get_env("BL_DISCOVERY_DATA_DIR"),
  do: config(:coordinator, discovery_data_dir: dir)

if token = System.get_env("BL_DISCOVERY_JOIN_TOKEN"),
  do: config(:coordinator, discovery_join_token: token)

if ms = System.get_env("BL_DISCOVERY_LEASE_MS"),
  do: config(:coordinator, discovery_lease_ms: String.to_integer(ms))

# The discovery validator: BL_DISCOVERY_VALIDATOR (a command line), else deno
# with the checkout's tools/discovery.ts when both exist.
case System.get_env("BL_DISCOVERY_VALIDATOR") do
  v when is_binary(v) and v != "" ->
    config(:coordinator, discovery_validator: String.split(v, " ", trim: true))

  _ ->
    tool = Path.expand("../../tools/discovery.ts", File.cwd!())
    deno = System.find_executable("deno")

    if deno && File.exists?(tool),
      do: config(:coordinator, discovery_validator: [deno, "run", "-A", tool, "check-attempt"])
end

# config/runtime.exs is executed for all environments, including
# during releases. It is executed after compilation and before the
# system starts, so it is typically used to load production configuration
# and secrets from environment variables or elsewhere. Do not define
# any compile-time configuration in here, as it won't be applied.
# The block below contains prod specific runtime configuration.

# ## Using releases
#
# If you use `mix release`, you need to explicitly enable the server
# by passing the PHX_SERVER=true when you start it:
#
#     PHX_SERVER=true bin/coordinator start
#
# Alternatively, you can use `mix phx.gen.release` to generate a `bin/server`
# script that automatically sets the env var above.
if System.get_env("PHX_SERVER") do
  config :coordinator, CoordinatorWeb.Endpoint, server: true
end

config :coordinator, CoordinatorWeb.Endpoint,
  http: [port: String.to_integer(System.get_env("PORT", "4000"))]

if config_env() == :prod do
  # The secret key base is used to sign/encrypt cookies and other secrets.
  # A default value is used in config/dev.exs and config/test.exs but you
  # want to use a different value for prod and you most likely don't want
  # to check this value into version control, so we use an environment
  # variable instead.
  secret_key_base =
    System.get_env("SECRET_KEY_BASE") ||
      raise """
      environment variable SECRET_KEY_BASE is missing.
      You can generate one by calling: mix phx.gen.secret
      """

  host = System.get_env("PHX_HOST") || "example.com"

  config :coordinator, :dns_cluster_query, System.get_env("DNS_CLUSTER_QUERY")

  config :coordinator, CoordinatorWeb.Endpoint,
    url: [host: host, port: 443, scheme: "https"],
    http: [
      # Enable IPv6 and bind on all interfaces.
      # Set it to  {0, 0, 0, 0, 0, 0, 0, 1} for local network only access.
      # See the documentation on https://hexdocs.pm/bandit/Bandit.html#t:options/0
      # for details about using IPv6 vs IPv4 and loopback vs public addresses.
      ip: {0, 0, 0, 0, 0, 0, 0, 0}
    ],
    secret_key_base: secret_key_base

  # ## SSL Support
  #
  # To get SSL working, you will need to add the `https` key
  # to your endpoint configuration:
  #
  #     config :coordinator, CoordinatorWeb.Endpoint,
  #       https: [
  #         ...,
  #         port: 443,
  #         cipher_suite: :strong,
  #         keyfile: System.get_env("SOME_APP_SSL_KEY_PATH"),
  #         certfile: System.get_env("SOME_APP_SSL_CERT_PATH")
  #       ]
  #
  # The `cipher_suite` is set to `:strong` to support only the
  # latest and more secure SSL ciphers. This means old browsers
  # and clients may not be supported. You can set it to
  # `:compatible` for wider support.
  #
  # `:keyfile` and `:certfile` expect an absolute path to the key
  # and cert in disk or a relative path inside priv, for example
  # "priv/ssl/server.key". For all supported SSL configuration
  # options, see https://hexdocs.pm/plug/Plug.SSL.html#configure/1
  #
  # We also recommend setting `force_ssl` in your config/prod.exs,
  # ensuring no data is ever sent via http, always redirecting to https:
  #
  #     config :coordinator, CoordinatorWeb.Endpoint,
  #       force_ssl: [hsts: true]
  #
  # Check `Plug.SSL` for all available options in `force_ssl`.
end
