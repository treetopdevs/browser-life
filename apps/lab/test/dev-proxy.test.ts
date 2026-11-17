import { createServer as httpServer, get as httpGet, type Server } from "node:http";
import { createServer as netServer } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { createServer } from "vite";
import { coordinatorUnavailable } from "../dev-proxy";

const fakeRes = (over: Record<string, unknown> = {}) => {
  const res = { statusCode: 200, headersSent: false, writableEnded: false, headers: {} as Record<string, string>, body: "",
    setHeader(k: string, v: string) { this.headers[k] = v; }, end(b: string) { this.body = b; this.writableEnded = true; }, ...over };
  return res;
};

describe("coordinatorUnavailable", () => {
  it("answers 503 JSON for ECONNREFUSED", () => {
    const res = fakeRes();
    expect(coordinatorUnavailable({ code: "ECONNREFUSED" }, res)).toBe(true);
    expect(res.statusCode).toBe(503);
    expect(res.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(res.body).error).toBe("coordinator_unavailable");
  });
  it("leaves ECONNRESET and other errors alone", () => {
    for (const code of ["ECONNRESET", "ETIMEDOUT", "EPIPE", undefined]) {
      const res = fakeRes();
      expect(coordinatorUnavailable({ code }, res), String(code)).toBe(false);
      expect(res.writableEnded).toBe(false);
    }
    expect(coordinatorUnavailable(null, fakeRes())).toBe(false);
  });
  it("does nothing when headers are already sent", () => {
    const res = fakeRes({ headersSent: true });
    expect(coordinatorUnavailable({ code: "ECONNREFUSED" }, res)).toBe(false);
    expect(res.body).toBe("");
  });
  it("does nothing for a websocket socket (no setHeader)", () => {
    expect(coordinatorUnavailable({ code: "ECONNREFUSED" }, { end() {} })).toBe(false);
  });
});

async function closedPort(): Promise<number> {
  const s = netServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const { port } = s.address() as { port: number };
  await new Promise((r) => s.close(r));
  return port;
}

describe("vite config wiring", () => {
  const port = closedPort();
  let http: Server | undefined; let vite: Awaited<ReturnType<typeof createServer>> | undefined;
  afterAll(async () => { http?.close(); await vite?.close(); });

  it("vite config wires the helper into server and preview proxies", async () => {
    process.env.COORDINATOR_PORT = String(await port);
    const { default: config } = await import("../vite.config");
    for (const side of [config.server!.proxy!, config.preview!.proxy!]) {
      const entry = side["/api"] as { target: string; configure: unknown };
      expect(typeof entry.configure).toBe("function");
      expect(entry.target).toBe(`http://localhost:${process.env.COORDINATOR_PORT}`);
    }
  });

  it("a real Vite proxy to a closed port answers 503 JSON,", async () => {
    process.env.COORDINATOR_PORT = String(await port);
    vite = await createServer({ root: new URL("..", import.meta.url).pathname, configFile: new URL("../vite.config.ts", import.meta.url).pathname,
      logLevel: "silent", server: { middlewareMode: true } });
    http = httpServer(vite.middlewares);
    await new Promise<void>((r) => http!.listen(0, "127.0.0.1", r));
    const origin = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
    // node:http, not fetch: undici's fixed 10 s connect timeout fails this test on a heavily loaded machine.
    const res = await new Promise<{ status: number; type: string | undefined; body: string }>((resolve, reject) => {
      httpGet(`${origin}/api/status`, (r) => { let body = ""; r.on("data", (b) => { body += b; }); r.on("end", () => resolve({ status: r.statusCode!, type: r.headers["content-type"], body })); }).on("error", reject);
    });
    expect(res.status).toBe(503);
    expect(res.type).toBe("application/json");
    expect(JSON.parse(res.body)).toMatchObject({ error: "coordinator_unavailable" });
  }, 30_000);
});
