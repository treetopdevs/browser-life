defmodule Coordinator.Attempt do
  @moduledoc """
  One (segment, lease) assignment.

  `id` is the lease itself (`Queue`'s existing `rand(12)`, distinct from the
  island's own `rand(32)` bearer token: the token authenticates the island
  across many tasks, the lease/attempt id identifies this one assignment).

  Only a `:run` attempt (`kind == "run"`) ever uploads an artifact —
  `uploaded_digest`/`state_hash` are set by `Coordinator.Queue.publish_checkpoint/6`
  once the island PUTs its checkpoint. A `:verify` attempt uploads nothing: it
  replays the segment locally and reports the digest it computed
  (`reported_digest`), which is compared against the segment's *accepted run
  attempt's* `uploaded_digest` — never against anything the verify attempt
  itself uploaded, since there is nothing to check that against (see
  `Coordinator.Segment.complete_verify/5`).

  A `:verify` attempt may also report the SHA-256 of each observation file it
  regenerated; `observations` (`"match" | "mismatch" | nil`) is
  `Coordinator.Segment.complete_verify/5`'s comparison of those against the
  segment's accepted files, kept separately from the physics/observer
  `reported_digest` comparison and from the segment's status (see that
  function's moduledoc) — a correctness signal for humans, not a gate.
  `observations_for` is the `id` of the run attempt that comparison was made
  against — `requeue/1` keeps a completed verify attempt's record even after
  its run attempt is superseded by a redo, so `observations` alone is not
  enough to trust; always read both through `Coordinator.Segment.current_observations/1`,
  which checks `observations_for` against the segment's *currently* accepted
  run attempt, never `observations` directly.

  `manifest_metrics_version` is a *run* attempt's own manifest.json's
  `metricsVersion` field, extracted and validated once, outside this
  (serialized, singleton) GenServer, when the island `PUT`s that file
  (`CoordinatorWeb.ApiController.put_file/2`'s manifest-specific size limit
  and JSON parse — never inside `Coordinator.Queue`'s `handle_call`, which
  must stay cheap and I/O-free: every island's heartbeats, joins and
  assignments share it). `Coordinator.Queue`'s `\"run\"` completion compares
  only this already-recorded integer against the experiment's required
  version; `nil` (no manifest uploaded yet, or one predating this field) is
  read as version 1, same as everywhere else in this feature.

  Attempts persisted before any of these fields existed lack the keys
  entirely; read them with `Map.get/3`, never dot-access, which raises on a
  missing key.
  """

  @type kind :: String.t()
  @type outcome :: String.t()

  @type t :: %{
          id: String.t(),
          kind: kind,
          island: String.t(),
          assigned_at: integer,
          heartbeat_at: integer,
          uploaded_digest: String.t() | nil,
          state_hash: String.t() | nil,
          reported_digest: String.t() | nil,
          files: %{String.t() => String.t()},
          outcome: outcome,
          summary: map | nil,
          observations: String.t() | nil,
          observations_for: String.t() | nil,
          manifest_metrics_version: integer | nil
        }

  @doc "A freshly assigned attempt; `outcome` is `\"pending\"` until it completes, is rejected, diverges or is abandoned."
  @spec new(kind, String.t(), String.t(), integer) :: t
  def new(kind, lease, island, now) when kind in ["run", "verify"] do
    %{
      id: lease,
      kind: kind,
      island: island,
      assigned_at: now,
      heartbeat_at: now,
      uploaded_digest: nil,
      state_hash: nil,
      reported_digest: nil,
      files: %{},
      outcome: "pending",
      summary: nil,
      observations: nil,
      observations_for: nil,
      manifest_metrics_version: nil
    }
  end

  def pending?(%{outcome: "pending"}), do: true
  def pending?(_), do: false

  @doc "Whether `attempt` is the live one this island/lease still owns."
  def active?(%{outcome: "pending"} = a, island, lease), do: a.island == island and a.id == lease
  def active?(_, _, _), do: false
end
