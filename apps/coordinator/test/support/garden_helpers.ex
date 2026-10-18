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

  # The six files a replay regenerates (`Coordinator.Segment`'s `@observation_files`).
  @observation_files ~w(series.jsonl lineages.tsv mutations.tsv heredity.tsv life.jsonl activity-final.json)

  @doc """
  Hand-built `lineages.tsv` and `mutations.tsv` for days 0 and 1 of a 20-step
  garden day on a 256-wide world (docs/garden-predictions-2026-10-18.md):

    * day 0 ends (step 20) with 0:1 50, 0:2 30, 3:7 20 (a mutant of 0:2) and
      0:3 5: top 0:1, 0:2, 3:7, a clear leader 0:1;
    * day 1 ends (step 40) with 0:1 10, 25:9 40 (a mutant of 3:7), 3:7 5 and
      30:2 30 (a mutant of 22:1, a mutant of 0:3): the lines from day 0 are
      0:1 10, 0:2 0, 3:7 45 and the rest 30, so 3:7's line held the field.
  """
  def leaders_files(0) do
    %{
      "lineages.tsv" =>
        "step\tlineage\tcells\n10\t0:1\t40\n10\t0:2\t40\n10\t0:3\t25\n" <>
          "20\t0:1\t50\n20\t0:2\t30\n20\t3:7\t20\n20\t0:3\t5\n",
      "mutations.tsv" => "childHi\tchildLo\tparentHi\tparentLo\n3\t7\t0\t2\n"
    }
  end

  def leaders_files(1) do
    %{
      "lineages.tsv" =>
        "step\tlineage\tcells\n30\t0:1\t30\n30\t3:7\t20\n" <>
          "40\t0:1\t10\n40\t25:9\t40\n40\t3:7\t5\n40\t30:2\t30\n",
      "mutations.tsv" =>
        "childHi\tchildLo\tparentHi\tparentLo\n22\t1\t0\t3\n25\t9\t3\t7\n30\t2\t22\t1\n"
    }
  end

  @doc """
  Like `finish/4`, but first uploads all six observation files (`files`, name =>
  content, over a placeholder for each name it leaves out) with their real
  SHA-256s. Returns those digests, for `verify_with_digests/3`.
  """
  def finish_with_files(dir, island, task, files, summary \\ @summary) do
    digests =
      for name <- @observation_files, into: %{} do
        content = Map.get(files, name, "#{name} of day #{task.segment.index}\n")
        staged = Path.join(dir, "file-#{System.unique_integer([:positive])}")
        File.write!(staged, content)
        sha = :crypto.hash(:sha256, content) |> Base.encode16(case: :lower)
        :ok = Queue.publish_file(task.segment.id, island, task.lease, staged, name, sha)
        {name, sha}
      end

    :ok = finish(dir, island, task, summary)
    digests
  end

  @doc "Completes a verify task reporting `digests` as its regenerated observation files."
  def verify_with_digests(task, island, digests) do
    Queue.complete(
      task.segment.id,
      island,
      task.lease,
      "verify",
      dg(task.segment.index),
      %{},
      digests
    )
  end

  @doc """
  Day `day`'s leaders block in the Queue's view of garden `name` once it is no
  longer `pending` (and, with `lines: true`, once it has lines), polled for up
  to `timeout` ms (the block is counted in a task of its own).
  """
  def await_leaders(name, day, opts \\ []) do
    timeout = Keyword.get(opts, :timeout, 30_000)
    lines = Keyword.get(opts, :lines, false)
    deadline = System.monotonic_time(:millisecond) + timeout

    Stream.repeatedly(fn ->
      leaders = name |> Queue.garden_view() |> Map.fetch!(:days) |> Enum.find(&(&1.day == day))
      leaders = leaders && leaders.leaders

      cond do
        leaders != nil and leaders.status != "pending" and (not lines or leaders.lines != nil) ->
          {:done, leaders}

        System.monotonic_time(:millisecond) > deadline ->
          {:done, {:timeout, leaders}}

        true ->
          Process.sleep(20)
          :wait
      end
    end)
    |> Enum.find_value(fn
      {:done, v} -> v
      :wait -> nil
    end)
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
