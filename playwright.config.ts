import { defineConfig } from "@playwright/test";

// WebGPU in headless Chromium needs the GPU enabled explicitly.
const gpuArgs = ["--enable-unsafe-webgpu", "--enable-gpu", "--use-angle=metal", "--ignore-gpu-blocklist"];

// Worktrees run e2e side by side, each on its own port: BL_E2E_PORT (default 5174, also when empty). A port held by
// another worktree's server fails the run instead of testing that server: --strictPort makes our Vite exit, and
// readiness is our own Vite's banner, never a `url` probe (Playwright races a probe against the child's exit, so a
// foreign server could answer while our Vite is still starting). Vite binds one address family for localhost, so a
// server bound only to the other family is not detected: give each worktree its own port (another worktree's Vite on
// the same port is caught unless the two run with different Node DNS orders, --dns-result-order). Specs derive every
// origin from baseURL (testInfo.project.use.baseURL), so none is written down.
const PORT = Number(process.env.BL_E2E_PORT || 5174);
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) {
  throw new Error(`BL_E2E_PORT must be an integer port from 1024 to 65535, got ${JSON.stringify(process.env.BL_E2E_PORT)}`);
}
const BASE = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 180_000,
  reporter: "list",
  webServer: {
    command: `node node_modules/vite/bin/vite.js apps/lab --port ${PORT} --strictPort`,
    // Vite prints "Local:   http://<host>:<port>/" after listen() (Playwright strips the colours before matching). The host
    // is localhost, or 127.0.0.1 / [::1] when Node's DNS order differs (--dns-result-order); only our own child prints here.
    wait: { stdout: new RegExp(`Local:\\s+http://(?:localhost|127\\.0\\.0\\.1|\\[::1\\]):${PORT}/`) },
    reuseExistingServer: false,
    timeout: 60_000,
  },
  use: { baseURL: BASE },
  // Extra engines need `npx playwright install firefox webkit`; enable with BL_ALL_ENGINES=1.
  projects: [
    { name: "chrome", use: { channel: "chrome", launchOptions: { args: gpuArgs } } },
    ...(process.env.BL_ALL_ENGINES
      ? [
          { name: "firefox", use: { browserName: "firefox" as const, launchOptions: { firefoxUserPrefs: { "dom.webgpu.enabled": true, "gfx.webgpu.ignore-blocklist": true } } } },
          { name: "webkit", use: { browserName: "webkit" as const } },
        ]
      : []),
  ],
});
