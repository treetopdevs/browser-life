import { requestDevice, runGolden, type GoldenResult } from "@bl/sim-gpu";

declare global {
  interface Window { __golden?: { done: boolean; results?: GoldenResult[]; error?: string; adapter?: string } }
}

const out = document.getElementById("out")!;
window.__golden = { done: false };

async function main() {
  if (!navigator.gpu) throw new Error("WebGPU not available");
  const adapter = await navigator.gpu.requestAdapter();
  const info = adapter?.info;
  const desc = info ? `${info.vendor} ${info.architecture} ${info.description}`.trim() : "unknown";
  const device = await requestDevice(navigator.gpu);
  out.textContent = `adapter: ${desc}\n`;
  const results = await runGolden(device, (s) => {
    const line = document.createElement("div");
    line.className = s.slice(0, 4);
    line.textContent = s;
    out.appendChild(line);
  });
  window.__golden = { done: true, results, adapter: desc };
}

main().catch((e) => {
  out.textContent += `\nERROR ${e?.message ?? e}`;
  window.__golden = { done: true, error: String(e?.message ?? e) };
});
