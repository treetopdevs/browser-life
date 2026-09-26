// Review found hazards in the browser island page's original, DOM-coupled
// auto-rejoin: a live URL input read more than once per operation could leak
// one coordinator's token to another; a manual Join could race a pending
// auto-rejoin probe and start two concurrent runners (reproduced live: the
// abandoned runner kept requesting work while the button said "Join"); a
// Stop that fired while a fresh join's response was still in flight could be
// silently undone by that late response; a Join click after retries were
// exhausted skipped straight to a fresh join, discarding a remembered
// identity that might still have been perfectly valid; and a held-open probe
// (no timeout on the underlying fetch) trapped the page in a disabled state
// forever, with no way to cancel. These tests exercise `createIslandPage` --
// the DOM-free core those fixes live in -- with fully controllable fakes, so
// the races (and the hang) can be reproduced deterministically instead of
// depending on real timing in a browser.
import { describe, expect, it } from "vitest";
import { createIslandPage, type IdentityStorage } from "../src/index.ts";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

describe("createIslandPage", () => {
  it("captures the coordinator URL once per operation, never re-reading it mid-operation", async () => {
    let currentUrl = "http://coord-a";
    const runCalls: string[] = [];
    const saved: unknown[] = [];
    const storage: IdentityStorage = { load: () => null, save: (v) => saved.push(v) };
    let onJoined!: (id: { id: string; token: string }) => void;
    const run = deferred<void>();
    const done = deferred<void>();

    const page = createIslandPage({
      getUrl: () => currentUrl,
      setUrl: () => {},
      say: (m) => (m === "island stopped" ? done.resolve() : undefined),
      setState: () => {},
      storage,
      probe: async () => 200,
      runAttempt: async (opts) => {
        runCalls.push(opts.coordinator);
        onJoined = opts.onJoined;
        opts.onRunning();
        return run.promise;
      },
    });

    page.clickJoin(); // synchronously captures currentUrl ("http://coord-a")
    currentUrl = "http://coord-b"; // the user edits the field mid-operation

    onJoined({ id: "isl-a", token: "tok-a" }); // the join response for coord-a comes back
    run.resolve();
    await done.promise;

    expect(runCalls).toEqual(["http://coord-a"]);
    expect(saved).toEqual([{ coordinator: "http://coord-a", id: "isl-a", token: "tok-a" }]);
  });

  // Note: since "probing" is now itself cancellable (see the cancel tests
  // below), a click during the *probe* is a deliberate Cancel, not an inert
  // no-op -- and cancelling correctly never starts a second run either. The
  // remaining double-runner window this covers is the *post-decision*
  // "starting" phase (GPU device acquisition), which has no probe of its own
  // and stays non-cancellable, exactly as before.
  it("does not let a manual click start a second run once a decided operation is already starting", async () => {
    const runCalls: string[] = [];
    const storage: IdentityStorage = {
      load: () => ({ coordinator: "http://remembered", id: "isl-r", token: "tok-r" }),
      save: () => {},
    };
    const runStarted = deferred<void>();
    const acquireDevice = deferred<void>();

    const page = createIslandPage({
      getUrl: () => "http://manual", // would be used if a manual join were ever allowed to start here
      setUrl: () => {},
      say: () => {},
      setState: () => {},
      storage,
      probe: async () => 200, // resolves immediately: "reuse", no backoff involved
      runAttempt: async (opts) => {
        runCalls.push(opts.coordinator);
        runStarted.resolve();
        await acquireDevice.promise; // simulates GPU device acquisition still in flight
        opts.onRunning();
      },
    });

    const rejoining = page.autoRejoin();
    await runStarted.promise; // decision made and runAttempt has started, but onRunning hasn't fired yet
    expect(page.state).toBe("starting");

    page.clickJoin(); // must be a no-op: state is neither "idle" nor "probing"
    expect(runCalls).toEqual(["http://remembered"]); // still just the one run

    acquireDevice.resolve();
    await rejoining;

    expect(runCalls).toEqual(["http://remembered"]); // exactly one run, never two
  });

  it("does not let a join that resolves after Stop resurrect the remembered identity", async () => {
    const saved: unknown[] = [];
    const storage: IdentityStorage = { load: () => null, save: (v) => saved.push(v) };
    let onJoined!: (id: { id: string; token: string }) => void;
    const run = deferred<void>();
    const done = deferred<void>();

    const page = createIslandPage({
      getUrl: () => "http://coord",
      setUrl: () => {},
      say: (m) => (m === "island stopped" ? done.resolve() : undefined),
      setState: () => {},
      storage,
      probe: async () => 200,
      runAttempt: async (opts) => {
        onJoined = opts.onJoined;
        opts.onRunning();
        return run.promise;
      },
    });

    page.clickJoin(); // starts the run (onRunning fires synchronously, so state is "running" once this returns)
    expect(page.state).toBe("running");

    page.clickJoin(); // acts as Stop while state is "running"
    expect(saved).toEqual([null]); // Stop clears any remembered identity

    onJoined({ id: "isl-late", token: "tok-late" }); // the coordinator's join response arrives after Stop
    expect(saved).toEqual([null]); // still just the Stop's null -- the late join must not resave

    run.resolve();
    await done.promise;
    expect(page.state).toBe("idle");
  });

  // Round-2 review: once every retry is inconclusive, `attemptResume`
  // deliberately leaves the remembered identity in storage (it might still
  // be fine -- the coordinator was just briefly unreachable) and says "press
  // Join to retry". A naive `clickJoin` that ignored storage and always
  // started a fresh join would silently replace that identity the moment
  // the user acted on that message. It must re-probe the same identity
  // instead.
  it("a Join click after exhausted retries re-probes the remembered identity instead of starting fresh", async () => {
    const probeCalls: number[] = [];
    const runCalls: string[] = [];
    const saved: unknown[] = [];
    const storage: IdentityStorage = {
      load: () => ({ coordinator: "http://remembered", id: "isl-r", token: "tok-r" }),
      save: (v) => saved.push(v),
    };
    let probeStatus = 503; // first round: the coordinator is persistently unreachable
    const ran = deferred<void>();

    const page = createIslandPage({
      getUrl: () => "http://typed-in-the-field", // must never be used while a remembered identity exists
      setUrl: () => {},
      say: () => {},
      setState: () => {},
      storage,
      probe: async () => {
        probeCalls.push(probeStatus);
        return probeStatus;
      },
      runAttempt: async (opts) => {
        runCalls.push(opts.coordinator);
        opts.onRunning();
        ran.resolve();
      },
      sleep: async () => {}, // no real backoff delay in the test
      retries: 1, // 2 probe attempts total before giving up
    });

    await page.autoRejoin(); // both attempts inconclusive -> "wait", back to idle
    expect(page.state).toBe("idle");
    expect(probeCalls).toEqual([503, 503]);
    expect(runCalls).toEqual([]);
    expect(saved).toEqual([]); // NOT cleared -- it might still be valid

    probeStatus = 200; // the coordinator has recovered
    page.clickJoin(); // must re-probe the SAME remembered identity, not jump to a fresh join
    await ran.promise;

    expect(runCalls).toEqual(["http://remembered"]); // reused, not a fresh join against the typed-in URL
  });

  // Round-2 review: the adapter's `/api/islands/me` fetch had no timeout, so
  // a coordinator that never answers trapped the page in a disabled
  // "starting" state forever, with no way to cancel, switch coordinators, or
  // even have a reload help (storage still points at the same identity).
  // `resolveRejoin`'s `signal` is how a bound (from a timeout) or a user
  // Cancel gets in; these two tests exercise the user-Cancel half from the
  // page's own button, during both phases a probe attempt can be stuck in.
  it("cancelling during a held-open probe clears the remembered identity and never proceeds into the runner", async () => {
    const runCalls: string[] = [];
    const saved: unknown[] = [];
    const probe = deferred<number | null>();
    const storage: IdentityStorage = {
      load: () => ({ coordinator: "http://remembered", id: "isl-r", token: "tok-r" }),
      save: (v) => saved.push(v),
    };

    const page = createIslandPage({
      getUrl: () => "http://typed",
      setUrl: () => {},
      say: () => {},
      setState: () => {},
      storage,
      probe: () => probe.promise, // never resolves in this test: a held-open probe
      runAttempt: async (opts) => {
        runCalls.push(opts.coordinator);
        opts.onRunning();
      },
    });

    const rejoining = page.autoRejoin();
    expect(page.state).toBe("probing");

    page.clickJoin(); // acts as Cancel while "probing"
    expect(page.state).toBe("idle");
    expect(saved).toEqual([null]); // cancelling a resume attempt also stops it auto-resuming next time

    probe.resolve(200); // the stalled probe finally answers -- too late to matter
    await rejoining;

    expect(runCalls).toEqual([]); // must never have proceeded into the runner
    expect(page.state).toBe("idle");
  });

  it("cancelling during the backoff wait between probe attempts aborts immediately, without waiting it out", async () => {
    const runCalls: string[] = [];
    const saved: unknown[] = [];
    const sleepStarted = deferred<void>();
    const heldOpenSleep = deferred<void>();
    const storage: IdentityStorage = {
      load: () => ({ coordinator: "http://remembered", id: "isl-r", token: "tok-r" }),
      save: (v) => saved.push(v),
    };

    const page = createIslandPage({
      getUrl: () => "http://typed",
      setUrl: () => {},
      say: () => {},
      setState: () => {},
      storage,
      probe: async () => 503, // persistently inconclusive, so it always falls into backoff
      runAttempt: async (opts) => {
        runCalls.push(opts.coordinator);
        opts.onRunning();
      },
      sleep: async () => {
        sleepStarted.resolve();
        await heldOpenSleep.promise; // held open: simulates being mid-backoff
      },
      retries: 3,
    });

    const rejoining = page.autoRejoin();
    await sleepStarted.promise; // now inside the backoff wait after the first inconclusive probe
    expect(page.state).toBe("probing");

    page.clickJoin(); // Cancel, mid-backoff
    expect(page.state).toBe("idle"); // resolves immediately -- does not wait for heldOpenSleep
    expect(saved).toEqual([null]);

    heldOpenSleep.resolve(); // the held-open backoff sleep finally elapses -- too late to matter
    await rejoining;

    expect(runCalls).toEqual([]);
  });
});
