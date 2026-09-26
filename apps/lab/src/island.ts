import { requestDevice } from "@bl/sim-gpu";
import { runIsland } from "@bl/runner";

const log = document.getElementById("log")!;
const go = document.getElementById("go") as HTMLButtonElement;
const url = document.getElementById("url") as HTMLInputElement;
// One island at a time: Join is available again only once the previous run
// (including a task still finishing after Stop) has fully ended.
let state: "idle" | "starting" | "running" | "stopping" = "idle";
let ctrl: AbortController | null = null;
const say = (m: string) => {
  log.textContent = `${new Date().toLocaleTimeString()} ${m}\n${log.textContent}`.slice(0, 20_000);
};
const show = () => {
  go.textContent = { idle: "Join", starting: "Joining…", running: "Stop", stopping: "Stopping…" }[state];
  go.className = state === "running" ? "stop" : "";
  go.disabled = state === "starting" || state === "stopping";
};

go.onclick = async () => {
  if (state === "running") {
    state = "stopping";
    ctrl?.abort();
    show();
    say("stopping after the current task");
    return;
  }
  if (state !== "idle") return;
  if (!navigator.gpu) return say("WebGPU is not available in this browser.");
  state = "starting";
  show();
  const mine = new AbortController();
  ctrl = mine;
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    const info = adapter?.info;
    const desc = [info?.vendor, info?.architecture, info?.description].filter(Boolean).join(" ") || "unknown";
    const ua = navigator.userAgent;
    const engine = /Firefox\//.test(ua) ? "Firefox" : /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "browser";
    const device = await requestDevice(navigator.gpu);
    state = "running";
    show();
    await runIsland(device, { coordinator: url.value, host: { host: ua, adapter: `${engine} ${desc}` }, log: say, signal: mine.signal, idleMs: 8000 });
    say("island stopped");
  } catch (e) {
    say(`error: ${e instanceof Error ? e.message : e}`);
  } finally {
    if (ctrl === mine) {
      ctrl = null;
      state = "idle";
      show();
    }
  }
};
