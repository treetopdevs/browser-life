defmodule CoordinatorWeb.Router do
  use CoordinatorWeb, :router

  pipeline :api do
    plug :accepts, ["json"]
  end

  # Raw-body uploads and downloads (no content negotiation).
  pipeline :raw do
  end

  scope "/api", CoordinatorWeb do
    pipe_through :api
    get "/status", ApiController, :status
    get "/experiments/:name", ApiController, :experiment
    post "/islands", ApiController, :join
    get "/islands/me", ApiController, :me
    post "/experiments", ApiController, :create_experiment
    post "/next", ApiController, :next
    post "/segments/:id/heartbeat", ApiController, :heartbeat
    post "/segments/:id/complete", ApiController, :complete
    post "/segments/:id/reject", ApiController, :reject
  end

  scope "/api", CoordinatorWeb do
    pipe_through :raw
    put "/segments/:id/checkpoint", ApiController, :put_checkpoint
    get "/segments/:id/start", ApiController, :get_checkpoint
    put "/segments/:id/files/:name", ApiController, :put_file
    get "/segments/:id/files/:name", ApiController, :get_file
  end
end
