defmodule CoordinatorWeb.GardenProdPresetsTest do
  @moduledoc """
  Production refuses a `spots` garden (docs/garden-hardening-2026-10-18.md,
  item 3). The test config allows `spots` (config/test.exs), so this sets
  `:garden_presets` to the value production reads (config/config.exs plus
  config/prod.exs, never dev.exs or test.exs; release_config_test.exs pins that
  value) and founds gardens over HTTP under it.
  """
  use CoordinatorWeb.ConnCase, async: false
  import CoordinatorWeb.GardenHelpers
  alias Coordinator.{LetterLimiter, Queue}

  @env [:garden_presets, :allow_local_admin, :admin_token]
  @founding [%{"step" => 0, "kind" => "lesion", "x" => 10, "y" => 10, "r" => 3}]

  setup do
    dir = Path.join(System.tmp_dir!(), "bl-garden-prod-#{System.unique_integer([:positive])}")
    saved = snapshot_env(@env)
    prod = Config.Reader.read!("config/config.exs", env: :prod)[:coordinator][:garden_presets]
    Application.put_env(:coordinator, :garden_presets, prod)
    LetterLimiter.reset()

    on_exit(fn ->
      LetterLimiter.reset()
      LetterLimiter.set_gardens(%{})
      restore_env(saved)
      File.rm_rf!(dir)
    end)

    start_supervised!({Queue, data_dir: dir})
    %{presets: prod}
  end

  defp found(conn, name, preset) do
    conn
    |> put_req_header("content-type", "application/json")
    |> post(
      "/api/gardens",
      Jason.encode!(%{
        "name" => name,
        "presetId" => preset,
        "seed" => 1,
        "founding" => @founding,
        "stepsPerDay" => 20,
        "censusEvery" => 10,
        "days" => 5
      })
    )
  end

  test "under production's garden presets a spots garden is refused 422; the big storm is founded",
       %{conn: conn, presets: presets} do
    assert presets == ["wild-storm-large"]

    assert %{"error" => why} = conn |> found("spotted", "spots") |> json_response(422)
    assert why =~ "presetId"
    assert why =~ "wild-storm-large"
    refute why =~ "spots"
    assert Queue.garden_view("spotted") == nil

    # The same body on the big storm is founded, so the 422 is about the preset.
    assert %{"garden" => "storm", "days" => 5} =
             conn |> found("storm", "wild-storm-large") |> json_response(200)
  end
end
