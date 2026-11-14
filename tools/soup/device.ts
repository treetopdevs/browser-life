// The WebGPU device for Deno soup tools, behind a per-user lock shared by cooperating Deno processes.
//
// Two GPU soup processes running at once silently drop work (fewer instructions
// run, no error; found 2026-11-01, docs/soup-evolution-rerun-2026-10-31.md), while
// several soups inside one process are exact. So a process takes this lock
// before it gets a device, and waits while another cooperating process holds it.
// Browsers, other users and unrelated GPU applications do not honor this lock.
// Deno only; the lab page (tools/soup/gpu.ts in the browser) gets its device itself.
// An OS file lock (flock), held for the life of the process and released by the
// OS when it exits, however it exits; the file itself stays.
let held: Deno.FsFile | null = null;
let acquiring: Promise<void> | null = null;
let requests = 0;
let initialized = false;
async function gpuLock(): Promise<void> {
  if (held) return;
  const path = `${Deno.env.get("HOME") ?? "/tmp"}/.cache/bl-soup-gpu.lock`;
  await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  const f = await Deno.open(path, { create: true, read: true, write: true });
  try {
  if (!(await f.tryLock(true))) {
    console.error(`soup GPU: waiting for another GPU soup process (${path})`);
    await f.lock(true);
  }
  held = f;
  } catch (error) { f.close(); throw error; }
}

export async function soupDevice(): Promise<GPUDevice> {
  requests++;
  try {
    await (acquiring ??= gpuLock());
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) throw new Error("WebGPU: no adapter");
    const device = await adapter.requestDevice();
    initialized = true;
    return device;
  } finally {
    requests--;
    // No successful or pending GPU caller: a CPU fallback must not hold the lock.
    if (!initialized && requests === 0) {
      held?.close(); held = null; acquiring = null;
    }
  }
}
