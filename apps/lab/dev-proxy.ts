import type { ServerResponse } from "node:http";

const BODY = JSON.stringify({
  error: "coordinator_unavailable",
  detail: "no coordinator is listening on the dev proxy target; run bin/dev",
});

/**
 * Answers a refused connection to the coordinator with a clean 503 JSON body instead of Vite's empty 502.
 *
 * Only ECONNREFUSED qualifies: the connection never opened, so nothing was sent upstream. Resets and timeouts may
 * have delivered the request, so those stay with Vite's default handling (a page that posts a letter or a hand must
 * not read them as "refused"). A websocket upgrade hands the error listener a socket, not a ServerResponse, and a
 * response whose headers went out cannot be answered again; both are left alone. Returns whether it answered.
 *
 * Vite installs its own error listener after `configure`; it writes its 502 only while the response is still open,
 * so answering here first replaces it (it still logs its line).
 */
export function coordinatorUnavailable(err: unknown, res: unknown): boolean {
  if ((err as { code?: unknown } | null)?.code !== "ECONNREFUSED") return false;
  const r = res as Partial<ServerResponse> | null;
  if (!r || typeof r.setHeader !== "function" || typeof r.end !== "function") return false;
  if (r.headersSent || r.writableEnded) return false;
  r.statusCode = 503;
  r.setHeader("content-type", "application/json");
  r.setHeader("cache-control", "no-store");
  r.end(BODY);
  return true;
}

/** The Vite proxy entry for /api: Vite's string form (`changeOrigin`) plus the refused-connection answer. */
export function apiProxy(target: string) {
  return {
    target,
    changeOrigin: true,
    configure(proxy: { on(event: "error", listener: (err: unknown, req: unknown, res: unknown) => void): unknown }) {
      proxy.on("error", (err, _req, res) => { coordinatorUnavailable(err, res); });
    },
  };
}
