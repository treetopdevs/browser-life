defmodule CoordinatorWeb.PageControllerTest do
  use CoordinatorWeb.ConnCase, async: true

  test "GET / redirects to the status dashboard", %{conn: conn} do
    assert redirected_to(get(conn, "/")) == "/index.html"
  end
end
