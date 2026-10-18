defmodule Coordinator.Clock do
  @moduledoc """
  The coordinator's one wall clock, in milliseconds since the epoch.

  `Coordinator.Queue` reads it for leases, heartbeats and island liveness, and
  `Coordinator.Garden` for dawns and release times, so a single source answers
  "what time is it" for all of them. With nothing configured it is
  `System.system_time(:millisecond)` and behaves exactly as the Queue's own
  private clock did before this module existed.

  Tests (and only tests) may set `config :coordinator, :clock` to a zero-arity
  function to move time by hand (`Coordinator.TestClock` does it with an
  `:atomics` counter and removes it again in `on_exit`). The function is read at
  every call, never cached, so installing or removing it takes effect at once.
  `Coordinator.Discovery` keeps its own clock on purpose: its leases are a
  separate plane and must not move when a garden test advances a dawn.
  """

  @doc "Milliseconds since the epoch: the configured fake clock if one is installed, else the system clock."
  @spec now() :: integer
  def now do
    case Application.get_env(:coordinator, :clock) do
      fun when is_function(fun, 0) -> fun.()
      _ -> System.system_time(:millisecond)
    end
  end
end
