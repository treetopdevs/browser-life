defmodule Coordinator.SoupTest do
  use ExUnit.Case, async: false
  alias Coordinator.{Soup, Store, TestClock}
  @moduletag :capture_log

  @world %{
    "name" => "tiny",
    "seed" => 3,
    "width" => 4,
    "height" => 4,
    "radius" => 2,
    "epochsPerSegment" => 8,
    "segments" => 4,
    "verifyEvery" => 2
  }

  setup do
    dir = Path.join(System.tmp_dir!(), "bl-soup-#{System.unique_integer([:positive])}")
    TestClock.install(1_000_000)
    start_supervised!(soup_spec(dir))

    on_exit(fn ->
      TestClock.uninstall()
      File.rm_rf!(dir)
    end)

    %{dir: dir}
  end

  defp soup_spec(dir),
    do: {Soup, data_dir: dir, queue_data_dir: dir <> "-queue", lease_ms: 60_000}

  # A snapshot with a valid header for `w` at `epoch`; the program bytes are `fill`.
  defp snapshot(w, epoch, fill \\ 0) do
    lang = if w["lang"] == "heads", do: 1, else: 0

    <<"BLSOUP\0\0", 1::little-32, w["seed"]::little-32, w["num"]::little-32,
      w["width"]::little-32, w["height"]::little-32, w["radius"]::little-32,
      w["mutation"]::little-32, lang::little-32, epoch::little-64, 0::128>> <>
      :binary.copy(<<fill>>, w["num"] * 64)
  end

  defp stage(dir, bin) do
    path = Path.join(dir, "staged-#{System.unique_integer([:positive])}")
    File.write!(path, bin)
    {path, :crypto.hash(:sha256, bin) |> Base.encode16(case: :lower)}
  end

  # Takes the next task for `island`, which must be `kind` of segment `index`.
  defp take(island, kind, index) do
    {:ok, %{kind: ^kind, segment: id, lease: lease} = t} = Soup.next(island)
    assert id == Soup.segment_id("tiny", index)
    {t, lease}
  end

  # Runs a leased segment honestly: uploads `fill` bytes at its end epoch and completes.
  defp run(dir, island, index, fill \\ 0) do
    {t, lease} = take(island, "run", index)
    {:ok, w, epoch} = Soup.upload_target(t.segment, island, lease)
    assert epoch == t.endEpoch
    {path, sha} = stage(dir, snapshot(w, epoch, fill))
    assert :ok = Soup.check_snapshot(path, w, epoch)
    assert :ok = Soup.record_upload(t.segment, island, lease, sha, path)
    assert {:ok, "done"} = Soup.complete(t.segment, island, lease, sha)
    sha
  end

  defp segs, do: hd(Soup.status().worlds)["chain"]

  test "with no world nothing is finished, so an island waits" do
    assert {:ok, %{idle: true, finished: false}} = Soup.next("a")
  end

  test "registers a world once, refuses other parameters under its name and bad shapes" do
    assert {:ok, :registered} = Soup.register(@world)
    assert {:ok, :exists} = Soup.register(@world)
    assert {:error, _} = Soup.register(%{@world | "seed" => 4})

    assert {:error, "width * height must be even"} =
             Soup.register(%{@world | "width" => 3, "height" => 3})

    assert {:error, _} = Soup.register(%{@world | "name" => "Bad.Name"})
    assert {:error, "segments is required"} = Soup.register(Map.delete(@world, "segments"))

    assert {:ok, :registered} =
             Soup.register(%{
               "name" => "mixed",
               "seed" => 1,
               "num" => 128,
               "epochsPerSegment" => 4,
               "segments" => 1
             })

    [w, m] = Soup.status().worlds
    assert w["num"] == 16 and w["mutation"] == 262_144 and w["lang"] == "noheads"
    assert {m["width"], m["height"], m["radius"], m["verifyEvery"]} == {0, 0, 0, 1}
    assert length(w["chain"]) == 4
  end

  test "next leases segment 0 from the seed and gates each segment on its predecessor", %{
    dir: dir
  } do
    {:ok, :registered} = Soup.register(@world)
    {t, _} = take("a", "run", 0)
    assert t.start == nil and t.startEpoch == 0 and t.epochs == 8

    assert t.params == %{
             "seed" => 3,
             "num" => 16,
             "width" => 4,
             "height" => 4,
             "radius" => 2,
             "mutation" => 262_144,
             "lang" => "noheads"
           }

    # Segment 1 waits for segment 0.
    assert {:ok, %{idle: true, finished: false}} = Soup.next("b")
    assert {:error, "segment 0 starts from the seed"} = Soup.start_path(t.segment)
    assert {:error, "no accepted snapshot"} = Soup.start_path(Soup.segment_id("tiny", 1))

    # The first lease expires; "a" takes segment 0 again.
    TestClock.advance(60_001)
    sha0 = run(dir, "a", 0)
    # "a" ran 0, so it is offered segment 1; "b" is offered the verify of 0.
    {t1, _} = take("a", "run", 1)
    assert t1.start == "/api/soup/segments/tiny.1/start" and t1.startSha == sha0
    assert {:ok, path} = Soup.start_path(t1.segment)
    assert Store.sha256_file(path) == sha0
    {v0, _} = take("b", "verify", 0)
    assert v0.start == nil
  end

  test "a run completes only with the hash of its own upload, and verifiers upload nothing", %{
    dir: dir
  } do
    {:ok, :registered} = Soup.register(@world)
    {t, lease} = take("a", "run", 0)
    {:ok, w, 8} = Soup.upload_target(t.segment, "a", lease)

    assert {:error, "no snapshot uploaded on this lease"} =
             Soup.complete(t.segment, "a", lease, String.duplicate("0", 64))

    {path, sha} = stage(dir, snapshot(w, 8, 1))
    assert {:error, "lease is not current"} = Soup.record_upload(t.segment, "b", lease, sha, path)
    assert :ok = Soup.record_upload(t.segment, "a", lease, sha, path)
    assert File.exists?(Store.blob_path(dir, sha))

    assert {:error, "hash does not match this attempt's upload"} =
             Soup.complete(t.segment, "a", lease, String.duplicate("0", 64))

    assert {:error, "lease is not current"} = Soup.complete(t.segment, "b", lease, sha)
    assert {:ok, "done"} = Soup.complete(t.segment, "a", lease, sha)
    # Done; a repeat of the completion is refused, the lease is spent.
    assert {:error, "lease is not current"} = Soup.complete(t.segment, "a", lease, sha)

    {v, vlease} = take("b", "verify", 0)
    assert {:error, "lease is not current"} = Soup.upload_target(v.segment, "b", vlease)
  end

  test "the header check refuses a wrong seed, epoch, grid or length" do
    {:ok, :registered} = Soup.register(@world)
    [w] = Soup.status().worlds
    dir = Soup.data_dir()
    check = fn bin -> bin |> then(&stage(dir, &1)) |> elem(0) |> Soup.check_snapshot(w, 8) end

    assert :ok = check.(snapshot(w, 8))
    assert {:error, "snapshot header does not match the segment: epoch"} = check.(snapshot(w, 9))

    assert {:error, "snapshot header does not match the segment: seed"} =
             check.(snapshot(%{w | "seed" => 4}, 8))

    assert {:error, "snapshot header does not match the segment: radius"} =
             check.(snapshot(%{w | "radius" => 1}, 8))

    assert {:error, "snapshot header does not match the segment: magic"} =
             check.("X" <> binary_part(snapshot(w, 8), 1, 64 + 16 * 64 - 1))

    assert {:error, "snapshot is 1087 bytes, expected 1088"} =
             check.(binary_part(snapshot(w, 8), 0, 1087))
  end

  test "an island never verifies its own run; a match verifies, and the last segment is always checked",
       %{dir: dir} do
    {:ok, :registered} = Soup.register(@world)
    sha0 = run(dir, "a", 0)
    # Segment 1 (not checked: 1 rem 2 != 0) is offered to "a" before any verify it cannot take.
    run(dir, "a", 1)
    {v, lease} = take("b", "verify", 0)
    assert {:ok, "verified"} = Soup.complete(v.segment, "b", lease, sha0)
    run(dir, "b", 2)
    {v2, l2} = take("a", "verify", 2)

    assert {:ok, "verified"} =
             Soup.complete(v2.segment, "a", l2, segs() |> Enum.at(2) |> Map.get(:sha))

    run(dir, "a", 3)
    assert {:ok, %{idle: true, finished: false}} = Soup.next("a")
    {v3, l3} = take("b", "verify", 3)
    assert {:ok, "verified"} = Soup.complete(v3.segment, "b", l3, Enum.at(segs(), 3).sha)

    assert Enum.map(segs(), & &1.status) == ~w(verified done verified verified)
    assert {:ok, %{idle: true, finished: true}} = Soup.next("c")
    [w] = Soup.status().worlds
    assert w["head"] == %{index: 3, sha: Enum.at(segs(), 3).sha}
  end

  test "a mismatch diverges the segment and blocks every later one, leases included", %{dir: dir} do
    {:ok, :registered} = Soup.register(@world)
    run(dir, "a", 0, 7)
    {_, lease1} = take("a", "run", 1)
    {v, lease} = take("b", "verify", 0)
    assert {:ok, "diverged"} = Soup.complete(v.segment, "b", lease, String.duplicate("e", 64))

    [s0, s1, s2, s3] = segs()
    assert s0.status == "diverged" and s0.verifyHash == String.duplicate("e", 64)
    assert {s1.status, s1.blocked, s1.lease} == {"pending", true, nil}
    assert s2.blocked and s3.blocked

    assert {:error, "lease is not current"} =
             Soup.complete(Soup.segment_id("tiny", 1), "a", lease1, String.duplicate("0", 64))

    assert {:error, "no accepted snapshot"} = Soup.start_path(Soup.segment_id("tiny", 1))
    assert {:ok, %{idle: true, finished: true}} = Soup.next("a")
    assert hd(Soup.status().worlds)["counts"] == %{"diverged" => 1, "blocked" => 3}
  end

  test "an expired lease returns the segment to pending and refuses the late completion", %{
    dir: dir
  } do
    {:ok, :registered} = Soup.register(@world)
    {t, lease} = take("a", "run", 0)
    {:ok, w, 8} = Soup.upload_target(t.segment, "a", lease)
    {path, sha} = stage(dir, snapshot(w, 8))
    :ok = Soup.record_upload(t.segment, "a", lease, sha, path)
    TestClock.advance(60_000)
    assert {:error, "lease is not current"} = Soup.complete(t.segment, "a", lease, sha)
    assert hd(segs()).status == "pending"
    {_, lease2} = take("b", "run", 0)
    assert lease2 != lease

    # An expired verify frees the verify, not the run.
    TestClock.advance(60_000)
    sha0 = run(dir, "b", 0)
    {_, vl} = take("a", "verify", 0)
    TestClock.advance(60_000)

    assert {:error, "lease is not current"} =
             Soup.complete(Soup.segment_id("tiny", 0), "a", vl, sha0)

    assert hd(segs()).status == "done"
  end

  test "a lease takes one upload: the same bytes again are a no-op, others are refused", %{
    dir: dir
  } do
    {:ok, :registered} = Soup.register(@world)
    {t, lease} = take("a", "run", 0)
    {:ok, w, 8} = Soup.upload_target(t.segment, "a", lease)
    {p1, sha1} = stage(dir, snapshot(w, 8, 1))
    assert :ok = Soup.record_upload(t.segment, "a", lease, sha1, p1)
    {p1b, ^sha1} = stage(dir, snapshot(w, 8, 1))
    assert :ok = Soup.record_upload(t.segment, "a", lease, sha1, p1b)
    refute File.exists?(p1b)
    {p2, sha2} = stage(dir, snapshot(w, 8, 2))

    assert {:error, "this lease already uploaded a different snapshot"} =
             Soup.record_upload(t.segment, "a", lease, sha2, p2)

    refute File.exists?(Store.blob_path(dir, sha2))
    assert {:ok, "done"} = Soup.complete(t.segment, "a", lease, sha1)
  end

  test "an expired attempt's upload and a diverged segment's snapshot are deleted, shared bytes kept",
       %{dir: dir} do
    {:ok, :registered} = Soup.register(@world)

    # An expired run's upload goes once the expiry is swept.
    {t, lease} = take("a", "run", 0)
    {:ok, w, 8} = Soup.upload_target(t.segment, "a", lease)
    {path, lost} = stage(dir, snapshot(w, 8, 9))
    :ok = Soup.record_upload(t.segment, "a", lease, lost, path)
    assert File.exists?(Store.blob_path(dir, lost))
    TestClock.advance(60_000)
    _ = Soup.status()
    refute File.exists?(Store.blob_path(dir, lost))

    # tiny.0 is accepted. A world with the same parameters under another name
    # has the same segment 0 bytes; its attempt uploads them and expires, and
    # tiny.0's snapshot stays.
    sha0 = run(dir, "b", 0)
    {:ok, :registered} = Soup.register(%{@world | "name" => "twin"})
    {:ok, %{segment: "tiny.0", kind: "verify"}} = Soup.next("c")
    {:ok, %{segment: "tiny.1", kind: "run"}} = Soup.next("c")
    {:ok, %{segment: "twin.0", kind: "run", lease: tl}} = Soup.next("c")
    {p, ^sha0} = stage(dir, snapshot(w, 8, 0))
    :ok = Soup.record_upload("twin.0", "c", tl, sha0, p)
    TestClock.advance(60_000)
    _ = Soup.status()
    assert File.exists?(Store.blob_path(dir, sha0))

    # A diverged segment's snapshot goes; a blocked but accepted one is still served.
    sha1 = run(dir, "b", 1, 5)
    {:ok, %{segment: "tiny.0", kind: "verify", lease: vl}} = Soup.next("a")
    assert {:ok, "diverged"} = Soup.complete("tiny.0", "a", vl, String.duplicate("e", 64))
    refute File.exists?(Store.blob_path(dir, sha0))
    assert File.exists?(Store.blob_path(dir, sha1))
  end

  test "a restart removes snapshots no state names", %{dir: dir} do
    {:ok, :registered} = Soup.register(@world)
    sha0 = run(dir, "a", 0)
    stray = Store.blob_path(dir, String.duplicate("ab", 32))
    File.mkdir_p!(Path.dirname(stray))
    File.write!(stray, "orphan")

    stop_supervised!(Soup)
    start_supervised!(soup_spec(dir))

    refute File.exists?(stray)
    assert File.exists?(Store.blob_path(dir, sha0))
  end

  test "one island holds at most four live leases at once", %{dir: dir} do
    {:ok, _} = Soup.register(%{@world | "segments" => 6, "verifyEvery" => 1})
    for k <- 0..4, do: run(dir, "b", k)

    # Five done segments to verify, plus a runnable one; "a" gets four leases, then idles.
    for k <- 0..3, do: take("a", "verify", k)
    assert {:ok, %{idle: true}} = Soup.next("a")
    # Another island is not held back by "a".
    take("c", "verify", 4)
  end

  test "state survives a restart", %{dir: dir} do
    {:ok, :registered} = Soup.register(@world)
    sha0 = run(dir, "a", 0)
    {_, lease} = take("a", "run", 1)

    stop_supervised!(Soup)
    start_supervised!(soup_spec(dir))

    [s0, s1 | _] = segs()
    assert {s0.status, s0.sha, s0.ranBy} == {"done", sha0, "a"}
    assert s1.status == "leased" and s1.lease["island"] == "a"
    {:ok, w, 16} = Soup.upload_target(Soup.segment_id("tiny", 1), "a", lease)
    assert w["name"] == "tiny"
    assert {:ok, :exists} = Soup.register(@world)
  end

  test "refuses a data directory that overlaps the queue's", %{dir: dir} do
    assert {:error, {%RuntimeError{message: msg}, _}} =
             GenServer.start(Soup, data_dir: Path.join(dir, "x"), queue_data_dir: dir)

    assert msg =~ "overlaps"
  end
end
