defmodule Coordinator.GardenLeaders do
  @moduledoc """
  Who held the field at a garden day's end (rule `lines-v1`, pre-stated in
  docs/garden-predictions-2026-10-18.md): the day's three biggest lineage keys
  from its `lineages.tsv`, and the *lines* into the day, each of the previous
  day's three biggest keys counted together with its descendants born on the
  two days (both days' `mutations.tsv`).

  The numbers are read from files only once the day is verified and its
  replaying island regenerated every observation file byte for byte
  (`Coordinator.Segment.current_observations/1` is `"match"`): the bytes parsed
  here are then bytes a second island produced independently. The Queue decides
  that gate and runs `compute/2` in a task of its own; everything here but
  `compute/2` is pure, and `compute/2` never raises: any file or parse error is
  `{:error, :unreadable}`.

  The maps built here are what the Queue persists inside the garden record and
  what the view shows, so every atom in them is a literal of this module (the
  Queue loads it before decoding `state.bin` with `[:safe]`).
  """

  @rule %{name: "lines-v1", top: 3, clearLeaderPercent: 10}
  @top 3
  @clear_percent 10
  @u32 4_294_967_296
  @lineages_header "step\tlineage\tcells"
  @mutations_header "childHi\tchildLo\tparentHi\tparentLo"

  @typedoc "A census row at the day's end step: `{hi, lo, cells}`."
  @type row :: {non_neg_integer, non_neg_integer, pos_integer}
  @type key :: {non_neg_integer, non_neg_integer}

  @doc "The view's `leadersRule`."
  @spec rule() :: map
  def rule, do: @rule

  # ---- lineages.tsv ----

  @doc """
  The rows of a `lineages.tsv` (an enumerable of lines, each with or without
  its newline) at exactly `end_step`. The header must match exactly; every row
  must be three tab-separated fields, a step and cells that are integers and a
  key `hi:lo` with both parts below 2^32, cells positive; no key twice at the
  end step, and the end step's cells at most `max_cells`. Anything else is
  `{:error, :unreadable}`. Only the end step's rows are kept.
  """
  @spec end_rows(Enumerable.t(), non_neg_integer, non_neg_integer) ::
          {:ok, [row]} | {:error, :unreadable}
  def end_rows(lines, end_step, max_cells) do
    {header, rest} = split_header(lines)

    if header != @lineages_header do
      {:error, :unreadable}
    else
      rest
      |> Enum.reduce_while({:ok, [], MapSet.new(), 0}, fn line, {:ok, acc, seen, sum} ->
        with [step_s, key_s, cells_s] <- String.split(chomp(line), "\t"),
             {:ok, step} <- int(step_s),
             {:ok, {hi, lo} = key} <- parse_key(key_s),
             {:ok, cells} <- int(cells_s),
             true <- cells > 0 do
          cond do
            step != end_step -> {:cont, {:ok, acc, seen, sum}}
            MapSet.member?(seen, key) -> {:halt, {:error, :unreadable}}
            sum + cells > max_cells -> {:halt, {:error, :unreadable}}
            true -> {:cont, {:ok, [{hi, lo, cells} | acc], MapSet.put(seen, key), sum + cells}}
          end
        else
          _ -> {:halt, {:error, :unreadable}}
        end
      end)
      |> case do
        {:ok, rows, _seen, _sum} -> {:ok, Enum.reverse(rows)}
        error -> error
      end
    end
  end

  # ---- the day's census ----

  @doc """
  The day's census block from its end-step rows: `step`, `livingCells` (their
  cells), `lineages` (their count), `top` (the three biggest keys by cells, ties
  by smaller `hi`, then smaller `lo`, each with a label, cells and share of the
  living cells rounded to 4 places) and `clearLeader` (the biggest key's
  string, if it holds at least 10% of the living cells and strictly more than
  the second; else `nil`). `width` and `cells` are the world's.
  """
  @spec census([row], non_neg_integer, pos_integer, pos_integer) :: map
  def census(rows, step, width, cells) do
    living = rows |> Enum.map(&elem(&1, 2)) |> Enum.sum()
    ordered = Enum.sort_by(rows, fn {hi, lo, c} -> {-c, hi, lo} end)
    top = Enum.take(ordered, @top)

    clear =
      case top do
        [{hi, lo, c} | more] ->
          second = match?([{_, _, c2} | _] when c2 >= c, more)
          if c * 100 >= @clear_percent * living and not second, do: key_string({hi, lo})

        [] ->
          nil
      end

    %{
      step: step,
      livingCells: living,
      lineages: length(rows),
      top:
        Enum.map(top, fn {hi, lo, c} ->
          %{
            key: key_string({hi, lo}),
            label: label({hi, lo}, width, cells),
            cells: c,
            share: share(c, living)
          }
        end),
      clearLeader: clear
    }
  end

  @doc """
  A key's label, a pure function of the key and the world: `founder <lo>` for
  `hi` 0; else `born step <hi - 1> at <x>,<y>` when `lo` is a cell of the world,
  or `born step <hi - 1>, cell <lo>` when it is not.
  """
  @spec label(key, pos_integer, pos_integer) :: String.t()
  def label({0, lo}, _width, _cells), do: "founder #{lo}"

  def label({hi, lo}, width, cells) when lo < cells,
    do: "born step #{hi - 1} at #{rem(lo, width)},#{div(lo, width)}"

  def label({hi, lo}, _width, _cells), do: "born step #{hi - 1}, cell #{lo}"

  # ---- mutations.tsv ----

  @doc """
  A `mutations.tsv` (an enumerable of lines) as a child -> parent map, merged
  into `into`. The header must match exactly, every row is four integers below
  2^32, a parent is born strictly before its child (`parentHi < childHi`, so a
  walk always ends), and a child listed twice must name one parent.
  """
  @spec parents(Enumerable.t(), %{key => key}) :: {:ok, %{key => key}} | {:error, :unreadable}
  def parents(lines, into \\ %{}) do
    {header, rest} = split_header(lines)

    if header != @mutations_header do
      {:error, :unreadable}
    else
      Enum.reduce_while(rest, {:ok, into}, fn line, {:ok, acc} ->
        with [a, b, c, d] <- String.split(chomp(line), "\t"),
             {:ok, ch} <- u32(a),
             {:ok, cl} <- u32(b),
             {:ok, ph} <- u32(c),
             {:ok, pl} <- u32(d),
             true <- ph < ch,
             true <- Map.get(acc, {ch, cl}, {ph, pl}) == {ph, pl} do
          {:cont, {:ok, Map.put(acc, {ch, cl}, {ph, pl})}}
        else
          _ -> {:halt, {:error, :unreadable}}
        end
      end)
    end
  end

  # ---- the lines into a day ----

  @doc """
  The lines into day *T* from day *B = T - 1*: each key alive at *T*'s end
  (`rows`) is walked to its parents (`parents`, both days' mutations) until it
  meets one of *B*'s top keys (`top_b`, key strings in *B*'s order; the nearest
  one, since a walk stops at the first it meets) or a key born before *B* began
  (`hi <= start_b`); a key that needs a parent `parents` lacks makes the lines
  `{:error, :unreadable}`. Each of *B*'s top keys gets the cells of the keys
  whose walk stopped at it; every other cell is the rest. `winner` is the group
  with strictly the most cells (a key string, or `"rest"`), else `nil`.
  """
  @spec lines(
          [row],
          %{key => key},
          non_neg_integer,
          non_neg_integer,
          [String.t()],
          pos_integer,
          pos_integer
        ) :: {:ok, map} | {:error, :unreadable}
  def lines(rows, parents, from_day, start_b, top_b, width, cells) do
    tops = Map.new(top_b, fn k -> {parse_key!(k), k} end)

    result =
      Enum.reduce_while(rows, {%{}, %{}}, fn {hi, lo, c}, {memo, sums} ->
        case resolve({hi, lo}, tops, parents, start_b, memo) do
          {:ok, owner, memo} -> {:cont, {memo, Map.update(sums, owner, c, &(&1 + c))}}
          :error -> {:halt, :error}
        end
      end)

    case result do
      :error ->
        {:error, :unreadable}

      {_memo, sums} ->
        living = rows |> Enum.map(&elem(&1, 2)) |> Enum.sum()
        rest = Map.get(sums, :rest, 0)

        groups =
          for k <- top_b do
            c = Map.get(sums, k, 0)

            %{
              key: k,
              label: label(parse_key!(k), width, cells),
              cells: c,
              share: share(c, living)
            }
          end

        {:ok,
         %{
           fromDay: from_day,
           groups: groups,
           rest: %{cells: rest, share: share(rest, living)},
           winner: winner([{"rest", rest} | Enum.map(groups, &{&1.key, &1.cells})])
         }}
    end
  end

  # Walks `key` up to its owner (a top key's string, or `:rest`), remembering
  # every key on the way so a later walk through them stops at once.
  defp resolve(key, tops, parents, start_b, memo),
    do: resolve(key, tops, parents, start_b, memo, [])

  defp resolve({hi, _lo} = key, tops, parents, start_b, memo, path) do
    owner =
      cond do
        Map.has_key?(memo, key) -> {:found, memo[key]}
        Map.has_key?(tops, key) -> {:found, tops[key]}
        hi <= start_b -> {:found, :rest}
        true -> {:up, Map.get(parents, key)}
      end

    case owner do
      {:found, o} -> {:ok, o, Enum.reduce([key | path], memo, &Map.put(&2, &1, o))}
      {:up, nil} -> :error
      {:up, parent} -> resolve(parent, tops, parents, start_b, memo, [key | path])
    end
  end

  # Strictly the most cells; a tie, or nothing living, is no winner.
  defp winner(candidates) do
    case Enum.sort_by(candidates, &elem(&1, 1), :desc) do
      [{k, c} | more] when c > 0 ->
        if Enum.any?(more, fn {_, c2} -> c2 == c end), do: nil, else: k

      _ ->
        nil
    end
  end

  # ---- the IO wrapper ----

  @doc """
  Runs `fun` in a new process, as `spawn_monitor/1` does (the caller holds the
  monitor and gets `{pid, ref}`), that is also killed when `owner` goes down
  first: a task outlives neither its Queue nor a restart of it, so the Queue's
  bound on tasks running at once holds across restarts. Unlinked, so a task
  that dies never takes `owner` down. A small watcher, ended with the task,
  does the killing (the task itself is busy parsing and reads no messages).
  """
  @spec spawn_owned(pid, (-> any)) :: {pid, reference}
  def spawn_owned(owner, fun) when is_pid(owner) and is_function(fun, 0) do
    spawn_monitor(fn ->
      task = self()

      spawn(fn ->
        o = Process.monitor(owner)
        t = Process.monitor(task)

        receive do
          {:DOWN, ^o, :process, _, _} -> Process.exit(task, :kill)
          {:DOWN, ^t, :process, _, _} -> :ok
        end
      end)

      fun.()
    end)
  end

  @doc """
  The day's block from files on disk, as the Queue's task runs it. `paths`:
  `lineages` and `mutations` (day *T*'s), and `mutations_b` (day *B*'s, or
  `nil` when *B* has no `ok` block: then no lines). `ctx`: `day`, `end_step`,
  `width`, `cells`, and with `mutations_b`, `start_b` and `top_b` (*B*'s top key
  strings). `{:ok, census, lines | nil}` or `{:error, :unreadable}`; never
  raises.
  """
  @spec compute(map, map) :: {:ok, map, map | nil} | {:error, :unreadable}
  def compute(paths, ctx) do
    with {:ok, rows} <- read(paths.lineages, &end_rows(&1, ctx.end_step, ctx.cells)),
         census = census(rows, ctx.end_step, ctx.width, ctx.cells),
         {:ok, lines} <- day_lines(rows, paths, ctx) do
      {:ok, census, lines}
    else
      _ -> {:error, :unreadable}
    end
  rescue
    _ -> {:error, :unreadable}
  catch
    _, _ -> {:error, :unreadable}
  end

  # Without the day before there are no lines, but the day's own
  # `mutations.tsv` is still read: a block is `ok` only when both of its files
  # parse (docs/garden-predictions-2026-10-18.md, amendment 1).
  defp day_lines(_rows, %{mutations_b: nil} = paths, _ctx) do
    with {:ok, _} <- read(paths.mutations, &parents(&1)), do: {:ok, nil}
  end

  defp day_lines(rows, paths, ctx) do
    with {:ok, pb} <- read(paths.mutations_b, &parents(&1)),
         {:ok, pt} <- read(paths.mutations, &parents(&1, pb)) do
      lines(rows, pt, ctx.day - 1, ctx.start_b, ctx.top_b, ctx.width, ctx.cells)
    end
  end

  defp read(path, fun) when is_binary(path) do
    if File.regular?(path), do: fun.(File.stream!(path, :line)), else: {:error, :unreadable}
  end

  defp read(_path, _fun), do: {:error, :unreadable}

  # ---- small parts ----

  defp split_header(lines) do
    case Enum.take(lines, 1) do
      [first] -> {chomp(first), Stream.drop(lines, 1)}
      [] -> {nil, []}
    end
  end

  defp chomp(line), do: String.trim_trailing(line, "\n")

  defp int(s) do
    if Regex.match?(~r/^\d{1,16}$/, s), do: {:ok, String.to_integer(s)}, else: :error
  end

  defp u32(s) do
    case int(s) do
      {:ok, n} when n < @u32 -> {:ok, n}
      _ -> :error
    end
  end

  @doc "Parses a key string `hi:lo` (both parts integers below 2^32)."
  @spec parse_key(String.t()) :: {:ok, key} | :error
  def parse_key(s) when is_binary(s) do
    with [a, b] <- String.split(s, ":"),
         {:ok, hi} <- u32(a),
         {:ok, lo} <- u32(b) do
      {:ok, {hi, lo}}
    else
      _ -> :error
    end
  end

  def parse_key(_), do: :error

  defp parse_key!(s) do
    {:ok, key} = parse_key(s)
    key
  end

  defp key_string({hi, lo}), do: "#{hi}:#{lo}"

  defp share(_c, 0), do: 0.0
  defp share(c, living), do: Float.round(c / living, 4)
end
