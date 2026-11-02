defmodule CoordinatorWeb.SoupOffTest do
  # Production starts the shared soup only when BL_SOUP_DATA_DIR is set
  # (config/runtime.exs). With the plane off, every soup route is a plain 404,
  # before authentication or any budget, never a crash.
  use CoordinatorWeb.ConnCase, async: false

  test "every soup route answers 404 while the plane is not running", %{conn: conn} do
    refute Process.whereis(Coordinator.Soup)

    for {method, path} <- [
          {:post, "/api/soup/worlds"},
          {:get, "/api/soup/status"},
          {:post, "/api/soup/next"},
          {:get, "/api/soup/segments/w.0/start"},
          {:get, "/api/soup/segments/w.0/snapshot"},
          {:put, "/api/soup/segments/w.0/snapshot"},
          {:post, "/api/soup/segments/w.0/complete"}
        ] do
      res = dispatch(conn, @endpoint, method, path, nil)
      assert res.status == 404, "#{method} #{path}: #{res.status}"
      assert %{"error" => "the shared soup is not enabled here"} = Jason.decode!(res.resp_body)
    end
  end
end
