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
          summary: map | nil
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
      summary: nil
    }
  end

  def pending?(%{outcome: "pending"}), do: true
  def pending?(_), do: false

  @doc "Whether `attempt` is the live one this island/lease still owns."
  def active?(%{outcome: "pending"} = a, island, lease), do: a.island == island and a.id == lease
  def active?(_, _, _), do: false
end
