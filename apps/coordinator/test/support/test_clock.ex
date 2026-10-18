defmodule Coordinator.TestClock do
  @moduledoc """
  A hand-moved clock for tests: installs a zero-arity function as
  `config :coordinator, :clock` (see `Coordinator.Clock`) that reads an
  `:atomics` cell, so a test decides what "now" is and when a dawn passes.

      setup do
        TestClock.install(100 * 86_400_000 + 3_600_000)
        on_exit(&TestClock.uninstall/0)
      end

  The test environment's configuration is global, so every test that installs a
  clock is `async: false` and must uninstall it in `on_exit`.
  """

  @key {__MODULE__, :ref}

  @doc "Installs the fake clock reading `ms` and returns `ms`."
  def install(ms) when is_integer(ms) do
    ref = :atomics.new(1, signed: true)
    :atomics.put(ref, 1, ms)
    :persistent_term.put(@key, ref)
    Application.put_env(:coordinator, :clock, fn -> :atomics.get(ref, 1) end)
    ms
  end

  @doc "Sets the fake clock to `ms`."
  def set(ms) when is_integer(ms), do: :atomics.put(:persistent_term.get(@key), 1, ms)

  @doc "Moves the fake clock forward (or back, if negative) by `delta` ms and returns the new reading."
  def advance(delta) when is_integer(delta),
    do: :atomics.add_get(:persistent_term.get(@key), 1, delta)

  @doc "The fake clock's current reading."
  def now, do: :atomics.get(:persistent_term.get(@key), 1)

  @doc "Removes the fake clock; time is the system clock again."
  def uninstall do
    Application.delete_env(:coordinator, :clock)
    :persistent_term.erase(@key)
    :ok
  end
end
