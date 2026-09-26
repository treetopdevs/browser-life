defmodule Coordinator.Checkpoint do
  @moduledoc """
  Server-side checks of uploaded artifacts (format of
  packages/schema/src/checkpoint.ts):

    * structure: magic, schema and rule versions, end step, section sizes
      consistent with the embedded config, trailing checksum, ledger headroom;
    * config sanity (tile geometry, seed of the assigned run);
    * `state_digest/1`: the canonical state digest (`stateHash` in
      packages/schema/src/accounting.ts) computed from the checkpoint itself,
      so a completion can be bound to the artifact actually uploaded;
    * `bytes_digest/1`: digest of an artifact's exact bytes (`bytesDigest` in
      packages/runner/src/runner.ts), used for observer state.

  Semantic validity of the state (pools, lineages) is checked by the next
  island's decoder, which rejects the predecessor on any defect, and by replay
  verification, which is mandatory for the final segment of every run.
  """
  import Bitwise

  @magic 0x4B434C42
  @schema 2
  @flux_count 10
  @cell_channels 7
  @genome_channels 44
  @header 10 + 2 * @flux_count
  @m32 0xFFFFFFFF

  @doc "Validates structure and returns `{:ok, info}` with the parsed config and section offsets."
  def validate(bin, expected_step, expected_seed \\ nil) when is_binary(bin) do
    words = div(byte_size(bin), 4)
    rule = Application.get_env(:coordinator, :rule_version, 1)

    if rem(byte_size(bin), 4) != 0 or words < @header + 4 do
      {:error, "bad length"}
    else
      <<body::binary-size((words - 2) * 4), c1::little-32, c2::little-32>> = bin

      <<magic::little-32, schema::little-32, rule_v::little-32, step::little-32, _::binary>> =
        body

      cond do
        magic != @magic -> {:error, "bad magic"}
        schema != @schema -> {:error, "schema #{schema} != #{@schema}"}
        rule_v != rule -> {:error, "rule version #{rule_v} != #{rule}"}
        step != expected_step -> {:error, "end step #{step} != #{expected_step}"}
        digest(body) != {c1, c2} -> {:error, "checksum mismatch"}
        not ledger_headroom?(body) -> {:error, "ledger values must be below 2^63"}
        true -> sections(body, words - 2, expected_seed)
      end
    end
  end

  defp sections(body, total, expected_seed) do
    cfg_len = word(body, @header - 1)
    cfg_words = div(cfg_len + 3, 4)
    cells_at = @header + cfg_words

    with true <- cells_at + 1 <= total || {:error, "truncated"},
         {:ok, cfg} when is_map(cfg) <- Jason.decode(binary_part(body, @header * 4, cfg_len)),
         {:ok, n} <- geometry(cfg),
         true <-
           (expected_seed == nil or cfg["seed"] == expected_seed) ||
             {:error, "config seed differs from the assigned run"},
         cells_len = word(body, cells_at),
         true <- cells_len == n * @cell_channels || {:error, "cell size mismatch"},
         genome_at = cells_at + 1 + cells_len,
         true <- genome_at + 1 <= total || {:error, "truncated"},
         true <- word(body, genome_at) == n * @genome_channels || {:error, "genome size mismatch"},
         true <- genome_at + 1 + n * @genome_channels == total || {:error, "trailing data"} do
      {:ok,
       %{
         cfg: cfg,
         cells_at: cells_at + 1,
         cells_len: cells_len,
         genome_at: genome_at + 1,
         genome_len: n * @genome_channels,
         body: body
       }}
    else
      {:error, _} = e -> e
      _ -> {:error, "bad config"}
    end
  end

  # Light, heat and flux totals are u64 (lo, hi) pairs from word 4; each must
  # stay below 2^63 so the next segment can continue exactly.
  defp ledger_headroom?(body),
    do: Enum.all?(0..(2 + @flux_count - 1), fn k -> word(body, 5 + 2 * k) < 0x80000000 end)

  defp geometry(%{"tileW" => w, "tileH" => h, "tilesX" => x, "tilesY" => y})
       when is_integer(w) and is_integer(h) and is_integer(x) and is_integer(y) and
              w >= 8 and h >= 8 and w <= 4096 and h <= 4096 and rem(w, 8) == 0 and rem(h, 8) == 0 and
              x >= 1 and y >= 1 and x <= 256 and y <= 256 and w * h * x * y <= 16_777_216,
       do: {:ok, w * h * x * y}

  defp geometry(_), do: {:error, "bad tile geometry"}

  @doc """
  Canonical state digest of a validated checkpoint, identical to `stateHash`:
  digest(cfg length + canonical config JSON) then (step, light, heat, fluxes),
  cells and the (already canonical) genome, each chained with a fresh index.
  """
  def state_digest(%{cfg: cfg, body: body} = info) do
    json = canonical_json(cfg)
    pad = rem(4 - rem(byte_size(json), 4), 4)
    cfg_words = <<byte_size(json)::little-32>> <> json <> :binary.copy(<<0>>, pad)
    acc = digest(cfg_words)
    acc = digest_from(binary_part(body, 3 * 4, (@header - 3 - 2) * 4), acc)
    acc = digest_from(binary_part(body, info.cells_at * 4, info.cells_len * 4), acc)
    {h1, h2} = digest_from(binary_part(body, info.genome_at * 4, info.genome_len * 4), acc)
    hex(h1) <> hex(h2)
  end

  @doc "Digest of exact bytes: [byte length, bytes zero-padded to words]."
  def bytes_digest(bin) do
    pad = rem(4 - rem(byte_size(bin), 4), 4)
    {h1, h2} = digest(<<byte_size(bin)::little-32>> <> bin <> :binary.copy(<<0>>, pad))
    hex(h1) <> hex(h2)
  end

  # JSON.stringify of an object with sorted keys; config values are integers,
  # booleans and plain strings, which Jason encodes identically.
  defp canonical_json(cfg) do
    inner =
      cfg
      |> Map.keys()
      |> Enum.sort()
      |> Enum.map_join(",", fn k -> Jason.encode!(k) <> ":" <> Jason.encode!(cfg[k]) end)

    "{" <> inner <> "}"
  end

  defp hex(v), do: v |> Integer.to_string(16) |> String.downcase() |> String.pad_leading(8, "0")

  defp word(bin, i), do: :binary.decode_unsigned(binary_part(bin, i * 4, 4), :little)

  @doc "Port of `digestWords` from packages/schema/src/accounting.ts."
  def digest(bin), do: digest_from(bin, {0x811C9DC5, 0x01000193})

  @doc "Continue a digest from `{h1, h2}` with the word index restarting at 0 (as `digestWords(words, h1, h2)`)."
  def digest_from(bin, {h1, h2}), do: step(bin, 0, h1, h2)

  defp step(<<w::little-32, rest::binary>>, i, h1, h2) do
    h1 = bxor(h1, w) * 0x85EBCA6B &&& @m32
    h1 = (h1 <<< 13 ||| h1 >>> 19) &&& @m32
    h2 = (h2 + w + i &&& @m32) * 0xC2B2AE35 &&& @m32
    h2 = bxor(h2, h2 >>> 16)
    step(rest, i + 1, h1, h2)
  end

  defp step(<<>>, _, h1, h2), do: {h1, h2}
end
