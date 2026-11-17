defmodule Coordinator.PickLogTest do
  # Picked breeder runs on islands (docs/archipelago-breed-2026-10-18.md, amendment 2026-11-02): the content-addressed pick
  # log (context-free validation), its in-context re-validation at experiment creation, the task payload and `picks-v1` gating.
  use ExUnit.Case, async: false
  alias Coordinator.{PickLog, Queue, Store}

  setup do
    dir = Path.join(System.tmp_dir!(), "bl-picklog-#{System.unique_integer([:positive])}")
    start_supervised!({Queue, data_dir: dir})
    on_exit(fn -> File.rm_rf!(dir) end)
    %{dir: dir}
  end

  # The canonical text packages/runner/src/picks.ts's canonicalPickLog writes.
  defp text(entries),
    do:
      Enum.map_join(entries, fn {step, cycle, donors} ->
        ~s({"step":#{step},"kind":"pick","cycle":#{cycle},"donors":[#{Enum.join(donors, ",")}]}\n)
      end)

  defp store(dir, bin) do
    sha = PickLog.sha256(bin)
    staged = Path.join(dir, "staged-#{sha}")
    File.mkdir_p!(dir)
    File.write!(staged, bin)
    :ok = Store.put_blob(dir, sha, staged)
    sha
  end

  defp spec(sha, changes \\ %{}) do
    Map.merge(
      %{
        "experiment" => "picked",
        "presetId" => "breeder",
        "conditions" => ["treatment"],
        "seeds" => [1],
        "steps" => 15_000,
        "segmentSteps" => 5_000,
        "censusEvery" => 100,
        "verifyFraction" => 1.0,
        "pickLog" => sha
      },
      changes
    )
  end

  @full [{5_000, 1, [2, 0]}, {10_000, 2, [1]}, {15_000, 3, [3]}]

  describe "context-free validation" do
    test "accepts the canonical text, empty included, and names the entries" do
      bin = text(@full)

      assert {:ok, [%{step: 5_000, cycle: 1, donors: [2, 0]}, _, _]} =
               PickLog.validate_bytes(bin, PickLog.sha256(bin))

      assert {:ok, []} = PickLog.validate_bytes("", PickLog.sha256(""))
    end

    test "a wrong digest, an unsorted, repeated, non-canonical or oversize log is refused" do
      bin = text(@full)

      assert {:error, "pick log hashes to" <> _} =
               PickLog.validate_bytes(bin, String.duplicate("a", 64))

      for {why, bad} <- [
            unsorted: text([{10_000, 2, [1]}, {5_000, 1, [0]}]),
            repeated: text([{5_000, 1, [1]}, {5_000, 1, [1]}]),
            keys: ~s({"kind":"pick","step":5000,"cycle":1,"donors":[0]}\n),
            extra_key: ~s({"step":5000,"kind":"pick","cycle":1,"donors":[0],"by":"hand"}\n),
            spaces: ~s({"step": 5000,"kind":"pick","cycle":1,"donors":[0]}\n),
            float: ~s({"step":5000.0,"kind":"pick","cycle":1,"donors":[0]}\n),
            dup_donor: text([{5_000, 1, [1, 1]}]),
            negative: text([{5_000, 1, [-1]}]),
            cycle0: text([{5_000, 0, [1]}]),
            failed_line: ~s({"step":5000,"kind":"failed","cycle":1,"donors":[0]}\n),
            no_newline: String.trim_trailing(text(@full)),
            not_json: "nope\n"
          ] do
        assert {:error, _} = PickLog.validate_bytes(bad, PickLog.sha256(bad)), inspect(why)
      end

      big = String.duplicate("x", PickLog.max_bytes() + 1)
      assert {:error, "pick log is over" <> _} = PickLog.validate_bytes(big, PickLog.sha256(big))
      bin = <<0xFF, 0xFE, ?\n>>
      assert {:error, "pick log is not UTF-8"} = PickLog.validate_bytes(bin, PickLog.sha256(bin))
    end
  end

  describe "creation" do
    test "needs a stored blob, and re-validates the stored bytes", %{dir: dir} do
      sha = PickLog.sha256(text(@full))
      assert {:error, "pick log " <> rest} = Queue.create_experiment(spec(sha))
      assert rest =~ "is not stored"

      # A blob stored under a digest it does not have (damaged or planted out of band) is refused, not trusted.
      path = Store.blob_path(dir, sha)
      File.mkdir_p!(Path.dirname(path))
      File.write!(path, "tampered\n")
      assert {:error, "pick log hashes to" <> _} = Queue.create_experiment(spec(sha))

      File.rm!(path)
      ^sha = store(dir, text(@full))
      assert {:ok, 3} = Queue.create_experiment(spec(sha))
    end

    test "off-boundary, beyond-steps and wrong-cycle entries are refused", %{dir: dir} do
      off = store(dir, text([{5_100, 1, [0]}]))

      assert {:error, "pick at t=5100 is not on a pond boundary" <> _} =
               Queue.create_experiment(spec(off, %{"pickImplicit" => true}))

      beyond = store(dir, text([{20_000, 4, [0]}]))

      assert {:error, "pick at t=20000 is beyond the run's 15000 steps"} =
               Queue.create_experiment(spec(beyond, %{"pickImplicit" => true}))

      period = store(dir, text([{5_000, 2, [0]}]))

      assert {:error, "pick at t=5000 says cycle 2, not 1"} =
               Queue.create_experiment(spec(period, %{"pickImplicit" => true}))
    end

    test "a strict log must cover every boundary; the same log with pickImplicit is accepted", %{
      dir: dir
    } do
      empty = store(dir, "")

      assert {:error,
              "a strict pick log needs an entry at every pond boundary (3 in 15000 steps), this one has 0" <>
                _} = Queue.create_experiment(spec(empty))

      gappy = store(dir, text([{5_000, 1, [0]}, {15_000, 3, [3]}]))

      assert {:error, "a strict pick log needs an entry at every pond boundary" <> _} =
               Queue.create_experiment(spec(gappy))

      assert {:ok, 3} = Queue.create_experiment(spec(gappy, %{"pickImplicit" => true}))
    end

    test "steps must be a multiple of the pond period", %{dir: dir} do
      sha = store(dir, text([{5_000, 1, [0]}]))

      assert {:error, "steps must be a multiple of the pond period 5000 for a picked run"} =
               Queue.create_experiment(
                 spec(sha, %{"steps" => 7_500, "segmentSteps" => 5_000, "pickImplicit" => true})
               )
    end

    test "refuses overrides, a non-breed preset or condition, several conditions or seeds, a bad digest, a bad pickImplicit",
         %{dir: dir} do
      sha = store(dir, text(@full))

      assert {:error, "a picked experiment takes no overrides"} =
               Queue.create_experiment(spec(sha, %{"overrides" => %{"mutRate" => 1}}))

      assert {:error, "a picked experiment needs the condition treatment" <> _} =
               Queue.create_experiment(
                 spec(sha, %{"presetId" => "ponds", "steps" => 10_000, "segmentSteps" => 10_000})
               )

      assert {:error, "a picked experiment needs the condition treatment" <> _} =
               Queue.create_experiment(spec(sha, %{"conditions" => ["pond-rand"]}))

      assert {:error, "a picked experiment is one condition and one seed" <> _} =
               Queue.create_experiment(spec(sha, %{"conditions" => ["treatment", "pond-rand"]}))

      assert {:error, "a picked experiment is one condition and one seed" <> _} =
               Queue.create_experiment(spec(sha, %{"seeds" => [1, 2]}))

      assert {:error, "pickLog must be 64 lowercase hex digits" <> _} =
               Queue.create_experiment(spec("ABC"))

      assert {:error, "pickImplicit must be true or absent"} =
               Queue.create_experiment(spec(sha, %{"pickImplicit" => false}))

      assert {:error, "pickImplicit needs pickLog"} =
               Queue.create_experiment(
                 spec(sha)
                 |> Map.delete("pickLog")
                 |> Map.put("pickImplicit", true)
               )
    end

    test "a pond-breed condition on a plain pond preset is accepted", %{dir: dir} do
      sha = store(dir, text([{1_000, 1, [0]}]))

      assert {:ok, 1} =
               Queue.create_experiment(
                 spec(sha, %{
                   "presetId" => "ponds-small",
                   "conditions" => ["pond-breed-mass"],
                   "steps" => 1_000,
                   "segmentSteps" => 1_000,
                   "pickImplicit" => true
                 })
               )
    end
  end

  describe "task payload and gate" do
    test "the task carries picked, pickLog and pickImplicit only for such an experiment", %{
      dir: dir
    } do
      sha = store(dir, text([{5_000, 1, [0]}]))
      assert {:ok, 3} = Queue.create_experiment(spec(sha, %{"pickImplicit" => true}))

      assert {:ok, 1} =
               Queue.create_experiment(%{
                 "experiment" => "plain",
                 "presetId" => "breeder",
                 "conditions" => ["treatment"],
                 "seeds" => [1],
                 "steps" => 5_000,
                 "segmentSteps" => 5_000,
                 "censusEvery" => 100
               })

      {:ok, %{id: island}} = Queue.join(%{"adapter" => "A"})
      caps = ["ponds-v1", "breed-v1", "picks-v1"]

      tasks = for _ <- 1..2, do: elem(Queue.next_task(island, caps), 1)
      picked = Enum.find(tasks, &(&1.spec.experiment == "picked"))
      assert %{picked: true, pickLog: ^sha, pickImplicit: true} = picked.spec

      plain =
        Enum.find(tasks, &(&1.spec.experiment == "plain")) ||
          elem(Queue.next_task(island, caps), 1)

      assert plain.spec.experiment == "plain"

      refute Map.has_key?(plain.spec, :picked) or Map.has_key?(plain.spec, :pickLog) or
               Map.has_key?(plain.spec, :pickImplicit)

      # The stored spec carries the digest, and strict creation leaves pickImplicit out.
      assert Queue.experiment("picked").spec["pickLog"] == sha
    end

    test "an island without picks-v1 gets nothing of it, with it gets the run and the verify", %{
      dir: dir
    } do
      sha = store(dir, text([{5_000, 1, [0]}]))

      assert {:ok, 1} =
               Queue.create_experiment(spec(sha, %{"steps" => 5_000, "pickImplicit" => true}))

      {:ok, %{id: a}} = Queue.join(%{"adapter" => "A"})
      {:ok, %{id: b}} = Queue.join(%{"adapter" => "B"})

      assert {:ok, %{kind: "idle"}} =
               Queue.next_task(a, ["ponds-v1", "breed-v1", "interventions-v1", "sun-v1"])

      assert {:ok, %{kind: "run", lease: lease} = run} =
               Queue.next_task(b, ["ponds-v1", "breed-v1", "picks-v1"])

      assert run.spec.pickLog == sha

      staged = Path.join(dir, "cp")
      File.write!(staged, "x")
      :ok = Queue.publish_checkpoint(run.segment.id, b, lease, staged, "h0", "0000000000000000")
      assert {:ok, "done"} = Queue.complete(run.segment.id, b, lease, "run", "h0", %{})

      # The verify of that segment (verifyFraction 1) is gated the same way: A is never offered it, B is, and it verifies.
      assert {:ok, %{kind: "idle"}} =
               Queue.next_task(a, ["ponds-v1", "breed-v1", "interventions-v1", "sun-v1"])

      assert {:ok, %{kind: "verify", spec: %{pickLog: ^sha}} = v} =
               Queue.next_task(a, ["ponds-v1", "breed-v1", "picks-v1"])

      assert {:ok, "verified"} = Queue.complete(v.segment.id, a, v.lease, "verify", "h0", %{})
    end
  end
end
