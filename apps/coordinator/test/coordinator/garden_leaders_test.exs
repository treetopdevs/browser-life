defmodule Coordinator.GardenLeadersTest do
  @moduledoc """
  Who held the field (rule `lines-v1`, docs/garden-predictions-2026-10-18.md
  sections 3 and 4): the day's census from the end step's rows, the labels, the
  defensive parsing, and the walk of the lines into a day.
  """
  use ExUnit.Case, async: true
  alias Coordinator.GardenLeaders, as: L

  @lin "step\tlineage\tcells"
  @mut "childHi\tchildLo\tparentHi\tparentLo"
  # A 10 by 10 world.
  @w 10
  @cells 100

  defp tsv(header, rows), do: [header <> "\n" | Enum.map(rows, &(Enum.join(&1, "\t") <> "\n"))]
  defp lineages(rows), do: tsv(@lin, rows)
  defp mutations(rows), do: tsv(@mut, rows)
  defp keys(census), do: Enum.map(census.top, & &1.key)

  describe "the day's census" do
    test "keeps only the end step's rows" do
      lines =
        lineages([
          [10, "0:1", 5],
          [10, "0:2", 6],
          [10, "0:3", 7],
          [10, "4:9", 1],
          [20, "0:2", 8],
          [20, "12:4", 3]
        ])

      assert {:ok, rows} = L.end_rows(lines, 20, @cells)
      assert rows == [{0, 2, 8}, {12, 4, 3}]
      census = L.census(rows, 20, @w, @cells)
      assert %{step: 20, livingCells: 11, lineages: 2} = census
      assert keys(census) == ["0:2", "12:4"]
      assert hd(census.top) == %{key: "0:2", label: "founder 2", cells: 8, share: 0.7273}
    end

    test "tie order is birth step then cell" do
      rows = [{5, 2, 10}, {3, 9, 10}, {3, 1, 10}, {0, 4, 5}]
      assert keys(L.census(rows, 20, @w, @cells)) == ["3:1", "3:9", "5:2"]
    end

    test "clear leader at exactly 10% and not one cell below; a tie for the top is none" do
      # 10 of 100 living cells, the rest in keys of 5.
      exactly = [{0, 1, 10} | for(i <- 2..19, do: {0, i, 5})]
      assert L.census(exactly, 20, @w, 1000).clearLeader == "0:1"
      assert L.census(exactly, 20, @w, 1000).livingCells == 100

      # 10 of 101.
      below = [{0, 1, 10} | for(i <- 2..14, do: {0, i, 7})]
      assert L.census(below, 20, @w, 1000).livingCells == 101
      assert L.census(below, 20, @w, 1000).clearLeader == nil

      assert L.census([{0, 1, 50}, {0, 2, 50}], 20, @w, @cells).clearLeader == nil
      assert L.census([{0, 1, 50}, {0, 2, 49}], 20, @w, @cells).clearLeader == "0:1"
      # Alone, it holds everything.
      assert L.census([{7, 3, 1}], 20, @w, @cells).clearLeader == "7:3"
    end

    test "nothing living" do
      assert {:ok, []} = L.end_rows(lineages([[10, "0:1", 4]]), 20, @cells)

      assert L.census([], 20, @w, @cells) == %{
               step: 20,
               livingCells: 0,
               lineages: 0,
               top: [],
               clearLeader: nil
             }
    end

    test "labels: a founder, a cell, and a lo that is not a cell" do
      assert L.label({0, 3}, @w, @cells) == "founder 3"
      assert L.label({21, 25}, @w, @cells) == "born step 20 at 5,2"
      assert L.label({21, 150}, @w, @cells) == "born step 20, cell 150"
    end

    test "each malformed input is unreadable" do
      bad = fn lines -> L.end_rows(lines, 20, @cells) end
      assert bad.(["step\tlineage\tcell\n", "20\t0:1\t3\n"]) == {:error, :unreadable}
      assert bad.([]) == {:error, :unreadable}
      assert bad.(lineages([[20, "0:1", "x"]])) == {:error, :unreadable}
      assert bad.(lineages([[20, "0:1", "-3"]])) == {:error, :unreadable}
      assert bad.(lineages([[20, "0:1", 0]])) == {:error, :unreadable}
      assert bad.(lineages([["2x", "0:1", 3]])) == {:error, :unreadable}
      assert bad.(lineages([[20, "0-1", 3]])) == {:error, :unreadable}
      assert bad.(lineages([[20, "4294967296:1", 3]])) == {:error, :unreadable}
      assert bad.(lineages([[20, "0:1", 3, 4]])) == {:error, :unreadable}
      assert bad.(lineages([[20, "0:1", 3], [20, "0:1", 4]])) == {:error, :unreadable}
      assert bad.(lineages([[20, "0:1", 60], [20, "0:2", 41]])) == {:error, :unreadable}
      # At a step other than the end the same key may appear again (another census).
      assert {:ok, [{0, 1, 4}]} = bad.(lineages([[10, "0:1", 3], [20, "0:1", 4]]))

      assert L.parents(["childHi\tchildLo\n"]) == {:error, :unreadable}
      assert L.parents(mutations([[5, 1, 5, 2]])) == {:error, :unreadable}
      assert L.parents(mutations([[5, 1, 0, "y"]])) == {:error, :unreadable}
      assert L.parents(mutations([[5, 1, 0, 2], [5, 1, 0, 3]])) == {:error, :unreadable}
      assert {:ok, %{{5, 1} => {0, 2}}} = L.parents(mutations([[5, 1, 0, 2], [5, 1, 0, 2]]))
    end
  end

  describe "the lines into a day" do
    # Day B = 0 (steps 1..10), day T = 1 (steps 11..20). B's top three: 0:1, then
    # 5:3 (a mutant of 0:1 born on B), then 0:2.
    @top_b ["0:1", "5:3", "0:2"]

    defp parents_bt do
      {:ok, pb} = L.parents(mutations([[5, 3, 0, 1], [8, 4, 0, 1]]))
      {:ok, pt} = L.parents(mutations([[12, 7, 5, 3], [15, 9, 8, 4]]), pb)
      pt
    end

    test "walks both days' mutations to the nearest top key" do
      rows = [{0, 1, 4}, {5, 3, 6}, {12, 7, 5}, {8, 4, 3}, {15, 9, 2}, {0, 5, 7}]
      assert {:ok, lines} = L.lines(rows, parents_bt(), 0, 0, @top_b, @w, @cells)
      assert lines.fromDay == 0
      # 5:3 descends from 0:1 and keeps its own cells and its mutant's.
      assert Enum.map(lines.groups, &{&1.key, &1.cells}) == [{"0:1", 9}, {"5:3", 11}, {"0:2", 0}]
      assert hd(lines.groups).label == "founder 1"
      assert Enum.at(lines.groups, 1) |> Map.get(:share) == 0.4074
      assert lines.rest == %{cells: 7, share: 0.2593}
      assert lines.winner == "5:3"
    end

    test "a key born before B stops the walk" do
      # B = day 1 (steps 11..20): a key born at step 9 needs no parent; one born at 11 does.
      assert {:ok, %{rest: %{cells: 4}, winner: "rest"}} =
               L.lines([{10, 3, 4}], %{}, 1, 10, ["0:1"], @w, @cells)

      assert {:ok, %{rest: %{cells: 4}}} = L.lines([{0, 9, 4}], %{}, 1, 10, ["0:1"], @w, @cells)
    end

    test "an orphan child is unreadable" do
      assert L.lines([{11, 3, 4}], %{}, 1, 10, ["0:1"], @w, @cells) == {:error, :unreadable}
      assert L.lines([{12, 7, 1}], %{}, 0, 0, @top_b, @w, @cells) == {:error, :unreadable}
    end

    test "the rest wins" do
      rows = [{0, 1, 4}, {0, 5, 7}, {0, 6, 2}]

      assert {:ok, %{winner: "rest", rest: %{cells: 9}}} =
               L.lines(rows, %{}, 0, 0, @top_b, @w, @cells)
    end

    test "a tie has no winner, and nothing living has none" do
      assert {:ok, %{winner: nil}} =
               L.lines([{0, 1, 4}, {0, 5, 4}], %{}, 0, 0, @top_b, @w, @cells)

      assert {:ok, %{winner: nil}} =
               L.lines([{0, 1, 4}, {0, 2, 4}], %{}, 0, 0, @top_b, @w, @cells)

      assert {:ok, %{winner: nil, rest: %{cells: 0, share: +0.0}, groups: groups}} =
               L.lines([], %{}, 0, 0, @top_b, @w, @cells)

      assert Enum.all?(groups, &(&1.cells == 0 and &1.share == 0.0))
    end

    test "fewer than three in B" do
      assert {:ok, %{groups: [%{key: "0:2", cells: 3}], rest: %{cells: 1}, winner: "0:2"}} =
               L.lines([{0, 2, 3}, {0, 1, 1}], %{}, 0, 0, ["0:2"], @w, @cells)
    end
  end

  describe "compute/2 from files" do
    setup do
      dir = Path.join(System.tmp_dir!(), "bl-leaders-#{System.unique_integer([:positive])}")
      File.mkdir_p!(dir)
      on_exit(fn -> File.rm_rf!(dir) end)
      write = fn name, lines -> Path.join(dir, name) |> tap(&File.write!(&1, lines)) end
      %{write: write}
    end

    test "a day with and without the lines from the day before; a missing file is unreadable", %{
      write: write
    } do
      lin = write.("lin.tsv", lineages([[20, "0:1", 4], [20, "12:7", 5], [20, "0:5", 7]]))
      mut_t = write.("mut_t.tsv", mutations([[12, 7, 5, 3]]))
      mut_b = write.("mut_b.tsv", mutations([[5, 3, 0, 1]]))
      ctx = %{day: 1, end_step: 20, width: @w, cells: @cells, start_b: 0, top_b: @top_b}

      assert {:ok, census, nil} =
               L.compute(%{lineages: lin, mutations: mut_t, mutations_b: nil}, ctx)

      assert keys(census) == ["0:5", "12:7", "0:1"]

      assert {:ok, ^census, lines} =
               L.compute(%{lineages: lin, mutations: mut_t, mutations_b: mut_b}, ctx)

      assert lines.winner == "rest" and lines.rest.cells == 7

      assert L.compute(%{lineages: lin <> ".gone", mutations: mut_t, mutations_b: nil}, ctx) ==
               {:error, :unreadable}

      assert L.compute(%{lineages: lin, mutations: nil, mutations_b: mut_b}, ctx) ==
               {:error, :unreadable}

      assert L.compute(%{lineages: nil}, ctx) == {:error, :unreadable}

      # Without the day before there are no lines, yet the day's own mutations must still parse.
      torn = write.("torn.tsv", "childHi\tchildLo\n")

      assert L.compute(%{lineages: lin, mutations: torn, mutations_b: nil}, ctx) ==
               {:error, :unreadable}

      assert L.compute(%{lineages: lin, mutations: lin <> ".gone", mutations_b: nil}, ctx) ==
               {:error, :unreadable}
    end
  end

  describe "a task's lifetime (spawn_owned/2)" do
    defp blocked, do: fn -> receive(do: (:never -> :ok)) end

    test "the caller monitors the task, and the task never takes its owner down" do
      owner = spawn(fn -> receive(do: (:never -> :ok)) end)
      {pid, ref} = L.spawn_owned(owner, blocked())
      Process.exit(pid, :kill)
      assert_receive {:DOWN, ^ref, :process, ^pid, :killed}
      assert Process.alive?(owner)
      Process.exit(owner, :kill)
    end

    test "the task is killed when its owner goes down first" do
      owner = spawn(fn -> receive(do: (:never -> :ok)) end)
      {pid, ref} = L.spawn_owned(owner, blocked())
      Process.exit(owner, :shutdown)
      assert_receive {:DOWN, ^ref, :process, ^pid, :killed}, 5_000
    end

    test "a task whose owner is already gone is killed at once" do
      owner = spawn(fn -> :ok end)
      mref = Process.monitor(owner)
      assert_receive {:DOWN, ^mref, :process, ^owner, _}
      {pid, ref} = L.spawn_owned(owner, blocked())
      assert_receive {:DOWN, ^ref, :process, ^pid, :killed}, 5_000
    end
  end
end
