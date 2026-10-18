defmodule CoordinatorWeb.StatusPageTest do
  @moduledoc """
  The operator page's source rules (docs/ops-dashboard-2026-10-18.md): one static
  file with one inline script, nothing loaded from elsewhere, no storage, and
  every server value put on the page as text. Its behaviour is checked in a
  browser by tests/e2e/coordinator-ops.spec.ts.
  """
  use ExUnit.Case, async: true

  @page Path.expand("../../priv/static/index.html", __DIR__)

  test "the operator page puts server data on the page as text and loads nothing external" do
    html = File.read!(@page)

    for banned <- [
          "innerHTML",
          "outerHTML",
          "insertAdjacentHTML",
          "document.write",
          "new Function",
          "Function(",
          "srcdoc",
          ".src =",
          ".href =",
          ".src=",
          ".href=",
          "localStorage",
          "sessionStorage",
          "<link",
          "<iframe",
          "<img"
        ] do
      refute html =~ banned, "the page must not contain #{banned}"
    end

    refute html =~ ~r/\beval\s*\(/, "no eval"
    refute html =~ ~r/setAttribute\(\s*["'`]on/i, "no event-handler attribute"
    refute html =~ ~r/set(Timeout|Interval)\(\s*["'`]/, "no string-argument timer"
    refute html =~ ~r/\.on[a-z]+\s*=/, "no event-handler property"
    refute html =~ ~r/<script[^>]*\ssrc\s*=/i, "no external script"
    refute html =~ ~r/\b(src|href)\s*=\s*["']?\s*(https?:)?\/\//i, "no external src or href"
    assert length(Regex.scan(~r/<script\b/i, html)) == 1, "exactly one <script>"
  end
end
