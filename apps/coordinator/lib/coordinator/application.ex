defmodule Coordinator.Application do
  # See https://hexdocs.pm/elixir/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    children = [
      CoordinatorWeb.Telemetry,
      {DNSCluster, query: Application.get_env(:coordinator, :dns_cluster_query) || :ignore},
      {Phoenix.PubSub, name: Coordinator.PubSub},
      Application.get_env(:coordinator, :start_queue, true) &&
        {Coordinator.Queue, data_dir: Application.get_env(:coordinator, :data_dir, "data")},
      Application.get_env(:coordinator, :start_discovery, true) &&
        {Coordinator.Discovery,
         data_dir: Application.get_env(:coordinator, :discovery_data_dir, "data-discovery"),
         queue_data_dir: Application.get_env(:coordinator, :data_dir, "data"),
         lease_ms: Application.get_env(:coordinator, :discovery_lease_ms, 120_000)},
      # Start to serve requests, typically the last entry
      CoordinatorWeb.Endpoint
    ]

    # See https://hexdocs.pm/elixir/Supervisor.html
    # for other strategies and supported options
    children = Enum.filter(children, & &1)
    opts = [strategy: :one_for_one, name: Coordinator.Supervisor]
    Supervisor.start_link(children, opts)
  end

  # Tell Phoenix to update the endpoint configuration
  # whenever the application is updated.
  @impl true
  def config_change(changed, _new, removed) do
    CoordinatorWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
