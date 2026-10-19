defmodule CoordinatorWeb.Router do
  use CoordinatorWeb, :router

  pipeline :api do
    plug :accepts, ["json"]
  end

  # Raw-body uploads and downloads (no content negotiation).
  pipeline :raw do
  end

  # The status dashboard is the static priv/static/index.html; the bare
  # origin (where a browser lands by default) redirects to it.
  scope "/", CoordinatorWeb do
    get "/", PageController, :index
  end

  scope "/api", CoordinatorWeb do
    pipe_through :api
    get "/status", ApiController, :status
    get "/public/status", ApiController, :public_status
    get "/experiments/:name", ApiController, :experiment
    post "/islands", ApiController, :join
    get "/islands/me", ApiController, :me
    post "/experiments", ApiController, :create_experiment
    post "/next", ApiController, :next
    post "/segments/:id/heartbeat", ApiController, :heartbeat
    post "/segments/:id/complete", ApiController, :complete
    post "/segments/:id/reject", ApiController, :reject
    post "/segments/:id/fail", ApiController, :fail

    # The garden (CoordinatorWeb.GardenController; README "The garden").
    get "/public/garden", GardenController, :show
    get "/public/gardens/:name", GardenController, :show
    post "/public/garden/letters", GardenController, :post_letter
    post "/public/gardens/:name/letters", GardenController, :post_letter
    post "/public/garden/food/hands", GardenController, :add_hand
    post "/public/gardens/:name/food/hands", GardenController, :add_hand
    post "/public/garden/meteor/hands", GardenController, :add_meteor_hand
    post "/public/gardens/:name/meteor/hands", GardenController, :add_meteor_hand
    post "/gardens", GardenController, :create
    post "/gardens/:name/letters/:id/drop", GardenController, :drop
    post "/gardens/:name/days/:index/requeue", GardenController, :requeue
  end

  # The discovery plane (Coordinator.Discovery): its own routes, tokens and data directory.
  scope "/api/discovery", CoordinatorWeb do
    pipe_through :api
    post "/campaigns", DiscoveryController, :register
    get "/campaigns/:md", DiscoveryController, :index
    get "/status", DiscoveryController, :status
    post "/workers", DiscoveryController, :join
    post "/next", DiscoveryController, :next
    post "/leases/:id/heartbeat", DiscoveryController, :heartbeat
    post "/leases/:id/complete", DiscoveryController, :complete
  end

  scope "/api/discovery", CoordinatorWeb do
    pipe_through :raw
    put "/blobs/:sha", DiscoveryController, :put_blob
    get "/blobs/:sha", DiscoveryController, :get_blob
    put "/leases/:id/files/:name", DiscoveryController, :put_file
  end

  scope "/api", CoordinatorWeb do
    pipe_through :raw
    put "/segments/:id/checkpoint", ApiController, :put_checkpoint
    get "/segments/:id/start", ApiController, :get_checkpoint
    put "/segments/:id/files/:name", ApiController, :put_file
    get "/segments/:id/files/:name", ApiController, :get_file
    get "/public/gardens/:name/checkpoints/:digest", GardenController, :checkpoint
  end
end
