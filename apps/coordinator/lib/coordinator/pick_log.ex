defmodule Coordinator.PickLog do
  @moduledoc """
  Fixed, content-addressed pick logs: the donors of a picked breeder run
  (`RunSpec.picked`, packages/runner/src/picks.ts), kept by the coordinator so
  islands can fetch them and apply the picks at the right pond boundaries
  (docs/archipelago-breed-2026-10-18.md, amendment 2026-11-02).

  A pick log is a blob in `Coordinator.Store` (under its SHA-256, like a bundle
  file) in one canonical text form, the exact bytes
  `packages/runner/src/picks.ts`'s `canonicalPickLog` writes: one
  `{"step":S,"kind":"pick","cycle":C,"donors":[...]}` line per entry, steps
  strictly ascending, each line ending in a newline. Because the form is
  canonical, a digest names exactly one history.

  Two checks, apart on purpose:

    * `validate_bytes/2` is *context-free* (what `PUT /api/pick-logs/:sha` can
      know): size cap, UTF-8, the canonical shape, ascending steps, digest =
      path. It says nothing about any preset.
    * `validate_in_context/2` is what experiment creation adds, on the stored
      bytes (never trusting that a blob's existence means it was validated for
      this experiment): the entries must fit the run's preset, steps and
      period, and a strict log must cover every pond boundary.

  Donor validity against the world (occupied, distinct ponds) is checked by the
  island that runs the boundary, which fails the segment terminally.
  """

  @max_bytes 1_048_576
  @max_int 9_007_199_254_740_991
  @max_pond 4_294_967_295

  @doc "The most bytes of a pick log; the same cap as packages/runner/src/picks.ts's `PICK_LOG_MAX_BYTES`."
  def max_bytes, do: @max_bytes

  @doc "Whether `sha` is 64 lowercase hex digits (checked before it names a path)."
  def sha?(sha), do: is_binary(sha) and Regex.match?(~r/\A[0-9a-f]{64}\z/, sha)

  @doc "Lowercase hex SHA-256 of `bin`."
  def sha256(bin), do: :crypto.hash(:sha256, bin) |> Base.encode16(case: :lower)

  @doc """
  The entries of the canonical pick log `bin`, which must hash to `sha`:
  `{:ok, [%{step:, cycle:, donors:}]}` or `{:error, why}`. Context-free.
  """
  def validate_bytes(bin, sha) when is_binary(bin) do
    cond do
      not sha?(sha) -> {:error, "pick log digest must be 64 lowercase hex digits"}
      byte_size(bin) > @max_bytes -> {:error, "pick log is over #{@max_bytes} bytes"}
      not String.valid?(bin) -> {:error, "pick log is not UTF-8"}
      sha256(bin) != sha -> {:error, "pick log hashes to #{sha256(bin)}, not #{sha}"}
      true -> parse(bin)
    end
  end

  defp parse(""), do: {:ok, []}

  defp parse(bin) do
    if String.ends_with?(bin, "\n") do
      bin
      |> String.split("\n", trim: false)
      |> Enum.drop(-1)
      |> Enum.with_index(1)
      |> Enum.reduce_while({:ok, []}, fn {line, n}, {:ok, acc} ->
        case entry(line, n, acc) do
          {:ok, e} -> {:cont, {:ok, [e | acc]}}
          {:error, _} = err -> {:halt, err}
        end
      end)
      |> case do
        {:ok, rev} -> {:ok, Enum.reverse(rev)}
        err -> err
      end
    else
      {:error, "pick log must end in a newline"}
    end
  end

  defp entry(line, n, acc) do
    with {:ok, %{} = m} <- Jason.decode(line),
         true <- Enum.sort(Map.keys(m)) == ~w(cycle donors kind step),
         "pick" <- m["kind"],
         step when is_integer(step) and step > 0 and step <= @max_int <- m["step"],
         cycle when is_integer(cycle) and cycle > 0 and cycle <= @max_int <- m["cycle"],
         donors when is_list(donors) <- m["donors"],
         true <- Enum.all?(donors, &(is_integer(&1) and &1 >= 0 and &1 <= @max_pond)),
         true <- length(Enum.uniq(donors)) == length(donors) do
      canonical =
        ~s({"step":#{step},"kind":"pick","cycle":#{cycle},"donors":[#{Enum.join(donors, ",")}]})

      cond do
        line != canonical ->
          {:error, "pick log line #{n} is not in canonical form"}

        match?([%{step: last} | _] when last >= step, acc) ->
          {:error,
           "pick log line #{n}: step #{step} does not follow the previous step (ascending, one per boundary)"}

        true ->
          {:ok, %{step: step, cycle: cycle, donors: donors}}
      end
    else
      _ ->
        {:error,
         "pick log line #{n} is not a pick {step, kind, cycle, donors} with distinct pond indices"}
    end
  end

  @doc """
  Whether `entries` fit an experiment of `preset` and `condition` running `steps`
  steps, with `implicit` (the spec's `pickImplicit`): every entry on a pond
  boundary of the preset's period, cycle = step / period, inside `(0, steps]`;
  and, unless `implicit`, an entry at every boundary in `(0, steps]`. `:ok` or
  `{:error, why}`.
  """
  def validate_in_context(entries, %{preset: preset, steps: steps, implicit: implicit}) do
    period = Map.get(Application.get_env(:coordinator, :pond_period, %{}), preset, 0)
    boundaries = if period > 0, do: div(steps, period), else: 0

    cond do
      period == 0 ->
        {:error, "preset #{preset} has no pond cycle, so it has no picks to fix"}

      rem(steps, period) != 0 ->
        {:error, "steps must be a multiple of the pond period #{period} for a picked run"}

      bad = Enum.find(entries, &(rem(&1.step, period) != 0)) ->
        {:error, "pick at t=#{bad.step} is not on a pond boundary (every #{period} steps)"}

      bad = Enum.find(entries, &(&1.step > steps)) ->
        {:error, "pick at t=#{bad.step} is beyond the run's #{steps} steps"}

      bad = Enum.find(entries, &(&1.cycle != div(&1.step, period))) ->
        {:error, "pick at t=#{bad.step} says cycle #{bad.cycle}, not #{div(bad.step, period)}"}

      not implicit and length(entries) != boundaries ->
        {:error,
         "a strict pick log needs an entry at every pond boundary (#{boundaries} in #{steps} steps), " <>
           "this one has #{length(entries)}; set pickImplicit for a sparse log"}

      true ->
        :ok
    end
  end
end
