defmodule CoordinatorWeb.PageController do
  use CoordinatorWeb, :controller

  def index(conn, _params), do: redirect(conn, to: "/index.html")
end
