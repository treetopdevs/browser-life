import { requestDevice } from "@bl/sim-gpu";
import { createIslandPage, gardenTokenFor, gardenTokenFromHash, probeIslandIdentity, runIsland, type IdentityStorage, type PageState, type Remembered } from "@bl/runner";

const log = document.getElementById("log")!;
const go = document.getElementById("go") as HTMLButtonElement;
const url = document.getElementById("url") as HTMLInputElement;
// Both the deployed site and Vite's local proxy forward /api to the coordinator.
url.value = location.origin;
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

// A coordinator's garden island token (its BL_GARDEN_ISLAND_TOKEN) arrives in
// the URL fragment, `/island.html#garden-token=<t>` (percent-encoded; `+` is a
// literal plus): a fragment never reaches a server or a Referer, so the token
// never lands in a request log. The browser may still keep the link it was
// opened with in its history and address-bar suggestions. It is taken out of
// the address bar at once (whenever the parser saw the key, however spelt) and
// kept in this variable only: never in sessionStorage (the remembered record
// holds the island's own id and token), never anywhere else. It matters only
// at join, so a remembered identity is forgotten when a token is given: the
// next Join is a fresh join that shows it. After that the coordinator
// remembers the island, so a reload resumes it without the token -- while the
// coordinator still knows the island; a fresh join needs the token again, and
// GARDEN_KEY (a flag, never the token) lets this page say so. It is sent only
// to this page's own origin (`gardenTokenFor`), never to a coordinator typed
// into the field. The same happens when the link is opened again in a tab
// that already shows this page: that is a fragment navigation (no reload), so
// `hashchange` takes the token there. An attempt that cannot use it any more
// (its join already sent, or a resume of a remembered identity) goes on as
// before but no longer remembers its identity (`joined` in runAttempt below),
// so after it stops or fails the next Join is the fresh garden join. A fresh
// join that reads the token after it arrived (one still acquiring the GPU, or
// a probe that ends in a fresh join) sends it and is remembered as usual.
let gardenToken: string | undefined;
// Bumped whenever a fragment gives a token; `tokenUnused` stays true until a
// fresh join starts after it.
let tokenGen = 0;
let tokenUnused = false;
const takeGardenToken = (onLoad: boolean) => {
  const fragment = gardenTokenFromHash(location.hash);
  if (fragment.found) {
    try {
      history.replaceState(history.state, "", `${location.pathname}${location.search}${fragment.rest}`);
    } catch {
      // ignore: the token is still never stored or sent anywhere else
    }
  }
  if (!fragment.token) return;
  gardenToken = fragment.token;
  tokenGen += 1;
  tokenUnused = true;
  storage.save(null);
  say(onLoad ? "garden token given: press Join to join as a garden island" : "garden token given: the next Join (press Stop first if this island is running) joins as a garden island");
};
takeGardenToken(true);
addEventListener("hashchange", () => takeGardenToken(false));

// "This tab's island joined with a garden token": a flag, not the token, so a
// later fresh join without one can say it is no longer a garden island.
const GARDEN_KEY = "bl-island-garden";
const gardenFlag = {
  get: () => {
    try {
      return sessionStorage.getItem(GARDEN_KEY) === "1";
    } catch {
      return false;
    }
  },
  set: (on: boolean) => {
    try {
      if (on) sessionStorage.setItem(GARDEN_KEY, "1");
      else sessionStorage.removeItem(GARDEN_KEY);
    } catch {
      // ignore: only the warning below is lost
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
    const token = gardenTokenFor(coordinator, location.origin, gardenToken);
    if (gardenToken && !identity && !token) say(`garden token not sent: ${coordinator} is not this page's own origin`);
    if (!identity && !token && gardenFlag.get()) {
      say("this tab's island was a garden island; a fresh join without the garden token is an ordinary one (open the island link with its #garden-token=… again to tend the garden)");
      gardenFlag.set(false);
    }
    // An identity is remembered only from an attempt that started after the
    // latest fragment token and was not a resume begun before it: a late
    // ordinary join must not undo the forgetting in takeGardenToken.
    const gen = tokenGen;
    if (!identity) tokenUnused = false;
    onRunning();
    const joined = (idn: { id: string; token: string }) => {
      if (gen !== tokenGen || tokenUnused) return;
      if (!identity && token) gardenFlag.set(true);
      onJoined(idn);
    };
    await runIsland(device, { coordinator, host: { host: ua, adapter: `${engine} ${desc}` }, log: say, signal, idleMs: 8000, identity, onJoined: joined, gardenToken: token });
  },
});

go.onclick = () => page.clickJoin();
void page.autoRejoin();
