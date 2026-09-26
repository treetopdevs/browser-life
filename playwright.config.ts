import { defineConfig } from "@playwright/test";

// WebGPU in headless Chromium needs the GPU enabled explicitly.
const gpuArgs = ["--enable-unsafe-webgpu", "--enable-gpu", "--use-angle=metal", "--ignore-gpu-blocklist"];

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 180_000,
  reporter: "list",
  webServer: {
    command: "pnpm --filter @bl/lab exec vite --port 5174 --strictPort",
    url: "http://localhost:5174/selftest.html",
    reuseExistingServer: false,
    timeout: 60_000,
  },
  use: { baseURL: "http://localhost:5174" },
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
