// The WebGPU device for Deno soup tools, behind a machine-wide lock.
//
// Two GPU soup processes running at once silently drop work (fewer instructions
// run, no error; found 2026-11-01, docs/soup-evolution-rerun-2026-10-31.md), while
// several soups inside one process are exact. So a process takes this lock
// before it gets a device, and waits while another live process holds it.
// Deno only; the lab page (tools/soup/gpu.ts in the browser) gets its device itself.
// An OS file lock (flock), held for the life of the process and released by the
// OS when it exits, however it exits; the file itself stays.
let held: Deno.FsFile | null = null;
async function gpuLock(): Promise<void> {
  if (held) return;
  const path = `${Deno.env.get("HOME") ?? "/tmp"}/.cache/bl-soup-gpu.lock`;
  await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  const f = await Deno.open(path, { create: true, read: true, write: true });
  if (!(await f.tryLock(true))) {
    console.error(`soup GPU: waiting for another GPU soup process (${path})`);
    await f.lock(true);
  }
  held = f;
}

export async function soupDevice(): Promise<GPUDevice> {
  await gpuLock();
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("WebGPU: no adapter");
  return adapter.requestDevice();
}
