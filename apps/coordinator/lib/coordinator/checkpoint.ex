defmodule Coordinator.Checkpoint do
  @moduledoc """
  Server-side checks of uploaded artifacts (format of
  packages/schema/src/checkpoint.ts, v3: one artifact, two sections after the
  header — physics (cells + genome, unchanged since schema v2) and a new
  observer section):

    * structure: magic, schema and rule versions, end step, section sizes
      consistent with the embedded config, trailing checksum, ledger headroom;
    * config sanity (tile geometry, seed of the assigned run);
    * the observer section's own bounds and JSON-syntax checks — bytes-intrinsic
      only, mirroring `decodeCheckpoint` in `packages/schema/src/checkpoint.ts`,
      never the domain-specific referential-integrity checks
      `decodeArtifact` (`packages/runner/src/runner.ts`) performs; those are
      the next island's job (it rejects the predecessor on any defect) and
      replay verification's, which is mandatory for the final segment of
      every run;
    * `state_digest/1`: the canonical *physics-only* digest (`stateHash` in
      packages/schema/src/accounting.ts), used for the next segment's
      `startHash`/`startFrom` continuity check — unaffected by this refactor;
    * `artifact_digest/1`: `state_digest`'s digest words chained with the
      observer section's canonical (recursively key-sorted) JSON bytes
      (`artifactDigest` in packages/schema/src/accounting.ts) — the digest a
      run's completion and a verify's replay are bound to end-to-end,
      replacing the old, separate `checkpoint_hash`/`observer_hash` pair.
  """
  import Bitwise

  @magic 0x4B434C42
  @schema 3
  @flux_count 10
  @cell_channels 7
  @genome_channels 44
  @header 10 + 2 * @flux_count
  @m32 0xFFFFFFFF

  @doc "Validates structure and returns `{:ok, info}` with the parsed config, section offsets and decoded observer."
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
         genome_len = n * @genome_channels,
         obs_at = genome_at + 1 + genome_len,
         true <- obs_at + 1 <= total || {:error, "truncated"},
         obs_len = word(body, obs_at),
         obs_words = div(obs_len + 3, 4),
         true <- obs_at + 1 + obs_words == total || {:error, "trailing data"},
         {:ok, observer} <- decode_observer(binary_part(body, (obs_at + 1) * 4, obs_len)) do
      {:ok,
       %{
         cfg: cfg,
         cells_at: cells_at + 1,
         cells_len: cells_len,
         genome_at: genome_at + 1,
         genome_len: genome_len,
         observer: observer,
         body: body
       }}
    else
      {:error, _} = e -> e
      _ -> {:error, "bad config"}
    end
  end

  defp decode_observer(bin) do
    case Jason.decode(bin) do
      {:ok, v} when is_map(v) -> {:ok, v}
      {:ok, _} -> {:error, "observer section is not an object"}
      {:error, _} -> {:error, "observer section is not valid JSON"}
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

  @doc "Canonical physics-only digest of a validated artifact, identical to `stateHash`. Used for `startHash`/`startFrom` continuity, unaffected by the observer section."
  def state_digest(info), do: info |> state_digest_words() |> hex_pair()

  @doc """
  Canonical digest of the whole artifact (physics + observer), identical to
  `artifactDigest`: `state_digest`'s digest words chained with the observer
  section's canonical JSON bytes (length-prefixed and word-padded the same
  way the config section is). This is the digest a run's `complete` and a
  verify's replay are compared against — never `state_digest` alone.
  """
  def artifact_digest(%{observer: observer} = info) do
    acc = state_digest_words(info)
    obs = canonical_json(observer)
    pad = rem(4 - rem(byte_size(obs), 4), 4)
    words = <<byte_size(obs)::little-32>> <> obs <> :binary.copy(<<0>>, pad)
    words |> digest_from(acc) |> hex_pair()
  end

  defp state_digest_words(%{cfg: cfg, body: body} = info) do
    json = canonical_json(cfg)
    pad = rem(4 - rem(byte_size(json), 4), 4)
    cfg_words = <<byte_size(json)::little-32>> <> json <> :binary.copy(<<0>>, pad)
    acc = digest(cfg_words)
    acc = digest_from(binary_part(body, 3 * 4, (@header - 3 - 2) * 4), acc)
    acc = digest_from(binary_part(body, info.cells_at * 4, info.cells_len * 4), acc)
    digest_from(binary_part(body, info.genome_at * 4, info.genome_len * 4), acc)
  end

  defp hex_pair({h1, h2}), do: hex(h1) <> hex(h2)

  # JSON.stringify of a value the way `canonicalConfig`/`canonicalObserverJSON`
  # (packages/schema/src/accounting.ts) produce it. Two ECMAScript quirks
  # that a naive "just sort the keys" port misses, both confirmed by a
  # codex-astra review against the actual TS behavior:
  #
  # 1. Key order: `Object.keys(o).sort()` sorts *every* key lexicographically
  #    (mixing array-index-like keys like "2"/"10" in with the rest) before
  #    `Object.fromEntries` builds the object — but a JS object's own
  #    enumerable string keys that are canonical non-negative-integer
  #    strings ("array index" keys) are *always* iterated in ascending
  #    numeric order first, regardless of insertion order, with every other
  #    key following in whatever order it was inserted. So the *final*
  #    order `JSON.stringify` actually emits is: array-index keys ascending
  #    numerically, then the rest in the lexicographic order `.sort()` gave
  #    them — not a single global lexicographic sort. `array_index_key?/1`
  #    below is the same "canonical non-negative integer, no leading zero
  #    except \"0\" itself, ≤ 2^32-2" definition ECMA-262 uses.
  # 2. Number formatting: `JSON.stringify` renders a JS number via
  #    `Number::toString`, whose *choice of digits* matches Erlang's own
  #    shortest round-tripping float format (`float_to_binary(f, [:short])`)
  #    — that shortest decimal is unique — but its *formatting thresholds*
  #    for scientific notation and decimal-point placement differ from
  #    Erlang's (e.g. `(0.00001).toString()` is `"0.00001"`; Erlang's short
  #    format already switches to `"1.0e-5"`). `js_number/1` reuses Erlang's
  #    digits and re-applies ECMA-262's own Number::toString formatting.
  # 3. Key order: `.sort()` compares UTF-16 code units, not code points or
  #    UTF-8 bytes (a supplementary character sorts before U+E000..U+FFFF);
  #    comparing big-endian UTF-16 encodings bytewise is the same order.
  # 4. Strings are escaped exactly as `JSON.stringify` does (`js_string/1`).
  #
  # Integers, booleans and null go through `Jason.encode!`, which agrees
  # with `JSON.stringify` for them.
  defp canonical_json(v) when is_map(v) do
    keys = v |> Map.keys() |> Enum.sort_by(&:unicode.characters_to_binary(&1, :utf8, :utf16))
    {index_keys, other_keys} = Enum.split_with(keys, &array_index_key?/1)
    ordered = Enum.sort_by(index_keys, &String.to_integer/1) ++ other_keys

    inner =
      Enum.map_join(ordered, ",", fn k ->
        js_string(k) <> ":" <> canonical_json(Map.get(v, k))
      end)

    "{" <> inner <> "}"
  end

  defp canonical_json(v) when is_list(v),
    do: "[" <> Enum.map_join(v, ",", &canonical_json/1) <> "]"

  defp canonical_json(v) when is_float(v), do: js_number(v)
  defp canonical_json(v) when is_binary(v), do: js_string(v)
  defp canonical_json(v), do: Jason.encode!(v)

  # JSON.stringify's string escaping (QuoteJSONString): the two-character
  # escapes for \b \t \n \f \r " and \\, lowercase \u00xx for other
  # controls, and every other code point (U+2028 included) verbatim.
  defp js_string(s) do
    body =
      for <<c::utf8 <- s>>, into: "" do
        case c do
          0x08 ->
            "\\b"

          0x09 ->
            "\\t"

          0x0A ->
            "\\n"

          0x0C ->
            "\\f"

          0x0D ->
            "\\r"

          0x22 ->
            "\\\""

          0x5C ->
            "\\\\"

          c when c < 0x20 ->
            "\\u00" <> String.downcase(Integer.to_string(c, 16) |> String.pad_leading(2, "0"))

          c ->
            <<c::utf8>>
        end
      end

    "\"" <> body <> "\""
  end

  @max_array_index 4_294_967_294
  defp array_index_key?(k),
    do: Regex.match?(~r/^(0|[1-9][0-9]*)$/, k) and String.to_integer(k) <= @max_array_index

  # ECMA-262 Number::toString for a finite, non-zero float, given Erlang's
  # own shortest round-tripping decimal (see the moduledoc note on
  # `canonical_json/1` above for why only the *formatting* needs a port).
  defp js_number(f) when is_float(f) do
    cond do
      f == 0.0 -> "0"
      f < 0 -> "-" <> js_number(-f)
      true -> js_format(f)
    end
  end

  defp js_format(f) do
    {mantissa, exp_e} =
      case String.split(:erlang.float_to_binary(f, [:short]), "e") do
        [m, e] -> {m, String.to_integer(e)}
        [m] -> {m, 0}
      end

    [int_part, frac_part] = String.split(mantissa, ".")
    combined = int_part <> frac_part
    frac_len = String.length(frac_part)
    lead_stripped = String.trim_leading(combined, "0")
    digits = String.trim_trailing(lead_stripped, "0")
    digits = if digits == "", do: "0", else: digits
    trailing_zeros = String.length(lead_stripped) - String.length(digits)
    k = String.length(digits)
    n = k + trailing_zeros + exp_e - frac_len

    cond do
      k <= n and n <= 21 ->
        digits <> String.duplicate("0", n - k)

      0 < n and n <= 21 ->
        {a, b} = String.split_at(digits, n)
        a <> "." <> b

      -6 < n and n <= 0 ->
        "0." <> String.duplicate("0", -n) <> digits

      true ->
        exp = n - 1

        mant =
          if k > 1,
            do: String.slice(digits, 0, 1) <> "." <> String.slice(digits, 1, k - 1),
            else: digits

        sign = if exp >= 0, do: "+", else: "-"
        mant <> "e" <> sign <> Integer.to_string(abs(exp))
    end
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
