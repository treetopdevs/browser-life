defmodule CoordinatorWeb.GardenHelpers do
  @moduledoc """
  Shared steps for the garden's web tests: islands joining and taking tasks
  from the real `Coordinator.Queue` on a hand-moved clock (`Coordinator.TestClock`),
  finishing a day with a staged checkpoint and replaying it, and saving and
  restoring the application environment a test overrides.
  """
  alias Coordinator.Queue

  @caps ["interventions-v1"]
  @summary %{
    "finalIndividuals" => 5,
    "finalLineages" => 2,
    "maxGeneration" => 3,
    "mutations" => 4,
    "extinct" => false,
    "conservationOk" => true
  }

  def day_ms, do: 86_400_000

  @doc "Joins an island advertising `adapter`; returns its id."
  def join(adapter) do
    {:ok, %{id: id}} = Queue.join(%{"adapter" => adapter})
    id
  end

  @doc "The island's next task (it advertises `interventions-v1`, which a garden needs)."
  def next(island, caps \\ @caps) do
    {:ok, task} = Queue.next_task(island, caps)
    task
  end

  @doc "A 16-hex digest per day (the checkpoint route only serves those)."
  def dg(day),
    do: (0xA0 + day) |> Integer.to_string(16) |> String.downcase() |> String.pad_leading(16, "0")

  @doc "Uploads a staged one-byte checkpoint for the task's day and completes the run."
  def finish(dir, island, task, summary \\ @summary) do
    staged = Path.join(dir, "cp-#{System.unique_integer([:positive])}")
    File.write!(staged, "x")
    digest = dg(task.segment.index)

    :ok =
      Queue.publish_checkpoint(
        task.segment.id,
        island,
        task.lease,
        staged,
        digest,
        "0000000000000000"
      )

    {:ok, "done"} = Queue.complete(task.segment.id, island, task.lease, "run", digest, summary)
    :ok
  end

  @doc "Completes a verify task with the digest its day's run produced."
  def verify(task, island) do
    Queue.complete(
      task.segment.id,
      island,
      task.lease,
      "verify",
      dg(task.segment.index),
      %{}
    )
  end

  @doc "Runs and replays day `d` (by `a`, then `b`): ends verified."
  def run_and_verify(dir, a, b) do
    t = next(a)
    finish(dir, a, t)
    v = next(b)
    {:ok, "verified"} = verify(v, b)
    t.segment.index
  end

  @doc "The current values of application env `keys`, to hand to `restore_env/1`."
  def snapshot_env(keys),
    do: for(k <- keys, do: {k, Application.fetch_env(:coordinator, k)})

  @doc "Puts back what `snapshot_env/1` saw."
  def restore_env(snapshot) do
    for {k, saved} <- snapshot do
      case saved do
        {:ok, v} -> Application.put_env(:coordinator, k, v)
        :error -> Application.delete_env(:coordinator, k)
      end
    end

    :ok
  end
end
