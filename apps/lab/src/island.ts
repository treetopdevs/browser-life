import { requestDevice } from "@bl/sim-gpu";
import { createIslandPage, probeIslandIdentity, runIsland, type IdentityStorage, type PageState, type Remembered } from "@bl/runner";

const log = document.getElementById("log")!;
const go = document.getElementById("go") as HTMLButtonElement;
const url = document.getElementById("url") as HTMLInputElement;
const say = (m: string) => {
  log.textContent = `${new Date().toLocaleTimeString()} ${m}\n${log.textContent}`.slice(0, 20_000);
};
const show = (state: PageState) => {
  go.textContent = { idle: "Join", probing: "Cancel", starting: "Joining…", running: "Stop", stopping: "Stopping…" }[state];
  go.className = state === "running" || state === "probing" ? "stop" : "";
  // "probing" (checking a remembered identity, with retry/backoff) stays
  // clickable so it can be cancelled; "starting" (GPU device acquisition for
  // a decided attempt) is brief and, as before, isn't user-cancellable.
  go.disabled = state === "starting" || state === "stopping";
};

// Remembering "joined" across a reload (Vite HMR does a full reload on some
// source edits, and this island otherwise silently falls back to the Join
// screen -- see the ~100 minute gap that stalled cross-island verification).
// sessionStorage rather than localStorage: the token is a private bearer
// credential, and sessionStorage is scoped to this tab and cleared when the
// tab closes, matching this page's own "close the tab to stop" contract
// (localStorage would keep the credential around indefinitely and share it
// with every other tab on this origin). It does survive a same-tab reload,
// which is exactly the case we need to recover from.
const STORAGE_KEY = "bl-island";
const storage: IdentityStorage = {
  load() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Remembered) : null;
    } catch {
      return null; // storage unavailable (private mode, disabled, quota): just skip auto-rejoin
    }
  },
  save(v) {
    try {
      if (v) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(v));
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore: worst case is losing auto-rejoin, not the run itself
    }
  },
};

// The actual lifecycle rules (one operation at a time, the coordinator URL
// captured once per operation, a late join never resurrecting a Stop) live
// in `createIslandPage`, DOM-free and unit tested there. This page only
// wires it to the real DOM, GPU and network.
const page = createIslandPage({
  getUrl: () => url.value,
  setUrl: (v) => (url.value = v),
  say,
  setState: show,
  storage,
  // `probeIslandIdentity` bounds this with a timeout (folded together with
  // `signal`, this operation's own cancellation) via a feature-detected
  // fallback for engines with WebGPU but not yet `AbortSignal.any` -- see
  // its doc comment in packages/runner/src/island.ts.
  probe: probeIslandIdentity,
  runAttempt: async ({ coordinator, identity, signal, onRunning, onJoined }) => {
    if (!navigator.gpu) throw new Error("WebGPU is not available in this browser.");
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    const info = adapter?.info;
    const desc = [info?.vendor, info?.architecture, info?.description].filter(Boolean).join(" ") || "unknown";
    const ua = navigator.userAgent;
    const engine = /Firefox\//.test(ua) ? "Firefox" : /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "browser";
    const device = await requestDevice(navigator.gpu);
    onRunning();
    await runIsland(device, { coordinator, host: { host: ua, adapter: `${engine} ${desc}` }, log: say, signal, idleMs: 8000, identity, onJoined });
  },
});

go.onclick = () => page.clickJoin();
void page.autoRejoin();
