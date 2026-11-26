defmodule Coordinator.OperatorEvents do
  @moduledoc """
  Fixed-label, in-memory operator counters. The supervised owner's start opens
  an epoch; restarting it resets all counters and `since`. Queue and limiter
  restarts do not reset this epoch. Nothing is persisted or identifies a caller.

  One ETS row makes reads and increments atomic without routing traffic through
  a mailbox. During an owner restart, recording is best effort and snapshot is
  nil (unavailable), never a fabricated zero epoch. These are operational
  observations, not a durable audit trail or a transaction with Queue persistence.
  """
  use GenServer
  @table __MODULE__

  def start_link(opts), do: GenServer.start_link(__MODULE__, opts, name: __MODULE__)

  @impl true
  def init(_opts) do
    :ets.new(@table, [:named_table, :public, :set, write_concurrency: true])
    :ets.insert(@table, {:events, DateTime.to_iso8601(DateTime.utc_now()), 0, 0, 0, 0, 0, 0})
    {:ok, nil}
  end

  def rate_refusal(kind) when kind in [:join, :next, :segment, :requests] do
    position = %{join: 3, next: 4, segment: 5, requests: 6}[kind]
    increment(position, 1)
  end

  def capacity_refusal, do: increment(7, 1)
  def pruned_islands(n) when is_integer(n) and n >= 0, do: increment(8, n)

  def snapshot do
    case :ets.lookup(@table, :events) do
      [{:events, since, join, next, segment, requests, capacity, pruned}] ->
        %{
          since: since,
          rateRefusals: %{join: join, next: next, segment: segment, requests: requests},
          capacityRefusals: capacity,
          prunedIslands: pruned
        }

      [] ->
        nil
    end
  rescue
    ArgumentError -> nil
  end

  defp increment(position, n) do
    :ets.update_counter(@table, :events, {position, n})
    :ok
  rescue
    ArgumentError -> :ok
  end
end
