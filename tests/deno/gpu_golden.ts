// Golden test on Deno's native WebGPU (wgpu/naga -> Metal/Vulkan/DX12).
import { requestDevice, runGolden } from "@bl/sim-gpu";

const device = await requestDevice(navigator.gpu);
device.addEventListener?.("uncapturederror", (e) => console.error("uncaptured:", (e as GPUUncapturedErrorEvent).error.message));
const results = await runGolden(device, (s) => console.log(s));
const failed = results.filter((r) => !r.ok);
Deno.exit(failed.length ? 1 : 0);
