// Browser-life issue: the archipelago island page (apps/lab/island.html)
// reloaded (Vite HMR full reloads after source edits) and silently dropped
// back to the Join screen for ~100 minutes, stalling cross-island
// verification. This module is the DOM-independent core of that page's
// auto-rejoin/lifecycle logic, factored out so the hazards review found in
// the DOM-coupled version can be unit tested without a DOM or a real GPU:
//
//   1. Token disclosure: the coordinator URL is a live, user-editable input.
//      Reading it more than once during a single join/probe/persist
//      operation lets an edit mid-operation send one coordinator's token to
//      another, or persist it under the wrong coordinator's URL. Every
//      operation below captures the coordinator exactly once and threads
//      that same value through the probe, the run attempt and the saved
//      identity -- it never calls `deps.getUrl()` a second time.
//   2. Double runner: a manual Join must not be able to start a second,
//      independent run while an auto-rejoin/resume attempt below is still
//      deciding whether to resume a remembered identity. `state` is set to
//      "probing" or "starting" (and the button's meaning changes via
//      `deps.setState`) synchronously, before the first `await`, in every
//      entry point below -- so by the time any of them yields to the event
//      loop, no other entry point can start a second operation; only one
//      `AbortController` (`ctrl`) ever exists at a time.
//   3. Stop resurrected by a late join: if Stop fires while a fresh join's
//      `POST /api/islands` is still in flight, the response's `onJoined`
//      must not resurrect the identity Stop just told the page to forget.
//      `onJoined` checks `signal.aborted` (the same signal Stop aborts)
//      before saving, so a join that resolves after a Stop never persists.
//   4. "Press Join to retry" discarding a still-good identity: once
//      `resolveRejoin` gives up as `"wait"` (see below), the remembered
//      identity is deliberately left in storage, not cleared -- it might
//      still be perfectly valid; the coordinator was just unreachable for a
//      few attempts. A later Join click (`clickJoin`, while idle) re-checks
//      storage and, if a remembered identity is still there, re-probes it
//      through the same `attemptResume` path an auto-rejoin uses, rather
//      than assuming it's dead and minting a fresh island that overwrites
//      it. Only an explicit Cancel (see next) or a confirmed 401 gives up
//      on it.
//   5. A probe with no bound on its own duration traps the page in a
//      disabled "starting" state forever if the coordinator never answers.
//      `resolveRejoin`'s `signal` bounds this from the outside (see
//      `island.ts`); this module also makes the probing/backoff phase
//      cancellable from the button itself (`state === "probing"`), and a
//      cancel clears the remembered identity too -- same contract as Stop,
//      since cancelling an auto-resume is a decision not to come back to it
//      automatically next time either.
import { resolveRejoin, type ResolveRejoinOptions } from "./island.ts";

export interface Remembered {
  coordinator: string;
  id: string;
  token: string;
}

export interface IdentityStorage {
  load(): Remembered | null;
  save(v: Remembered | null): void;
}

/** "probing": checking (and possibly retrying/backing off) a remembered
 * identity before deciding whether to reuse it -- cancellable. "starting":
 * acquiring a GPU device for a decided (fresh or reused) attempt -- brief,
 * matches the original page's non-cancellable "Joining…". */
export type PageState = "idle" | "probing" | "starting" | "running" | "stopping";

export interface IslandPageDeps {
  /** The coordinator URL field's current value. Called at most once per
   * operation (see the module doc above) -- never mid-operation. */
  getUrl(): string;
  /** Reflects a resumed coordinator back into the URL field for display. */
  setUrl(url: string): void;
  say(msg: string): void;
  setState(state: PageState): void;
  storage: IdentityStorage;
  /** One authenticated `GET /api/islands/me` attempt; resolves to the HTTP
   * status, or `null` if the request itself failed -- including a timeout.
   * `signal` is this operation's cancellation signal: the implementation
   * must fold it into the underlying request (e.g. `AbortSignal.any([signal,
   * AbortSignal.timeout(...)])`) so a Cancel actually aborts an in-flight
   * probe instead of merely having its result ignored once it settles. */
  probe(coordinator: string, id: string, token: string, signal: AbortSignal): Promise<number | null>;
  /**
   * Runs one island attempt against `coordinator` (a fresh join, or a reuse
   * of `identity`) until it ends (Stop, error, or the coordinator running
   * dry with `maxTasks` set). Must call `onRunning` once a device is ready
   * and the run loop is about to start, and `onJoined` as soon as an
   * id/token are known (reused or freshly issued) -- both may fire zero or
   * one times, and `onJoined` may fire after this promise's operation has
   * already been superseded by a Stop, which is exactly what `signal`
   * (passed through unchanged) is for.
   */
  runAttempt(opts: {
    coordinator: string;
    identity?: { id: string; token: string };
    signal: AbortSignal;
    onRunning(): void;
    onJoined(identity: { id: string; token: string }): void;
  }): Promise<void>;
  /** Forwarded to `resolveRejoin`'s backoff; overridable in tests. */
  sleep?: ResolveRejoinOptions["sleep"];
  retries?: number;
}

export interface IslandPage {
  clickJoin(): void;
  autoRejoin(): Promise<void>;
  readonly state: PageState;
}

export function createIslandPage(deps: IslandPageDeps): IslandPage {
  let state: PageState = "idle";
  let ctrl: AbortController | null = null;

  const setState = (s: PageState) => {
    state = s;
    deps.setState(s);
  };

  async function runOperation(coordinator: string, identity?: { id: string; token: string }) {
    setState("starting");
    const mine = new AbortController();
    ctrl = mine;
    try {
      await deps.runAttempt({
        coordinator,
        identity,
        signal: mine.signal,
        onRunning: () => setState("running"),
        onJoined: (id) => {
          if (!mine.signal.aborted) deps.storage.save({ coordinator, id: id.id, token: id.token });
        },
      });
      deps.say("island stopped");
    } catch (e) {
      deps.say(`error: ${e instanceof Error ? e.message : e}`);
    } finally {
      if (ctrl === mine) {
        ctrl = null;
        setState("idle");
      }
    }
  }

  // Probes `remembered` (with retry/backoff, cancellable) and either resumes
  // it, falls back to a fresh join, or -- if every attempt was inconclusive
  // -- leaves it in storage and returns to idle so a later Join click tries
  // again (see module doc point 4). Shared by `autoRejoin` (on page load)
  // and `clickJoin` (a later manual retry), so both behave identically.
  async function attemptResume(remembered: Remembered) {
    // Reserve the lifecycle *before* the probe starts (module doc point 2):
    // this runs synchronously, so a `clickJoin()` that happens while the
    // probe is in flight sees `state !== "idle"` (it's "probing") and either
    // no-ops or cancels, instead of starting a second run.
    setState("probing");
    deps.setUrl(remembered.coordinator);
    const coordinator = remembered.coordinator; // captured once; deps.getUrl() is never consulted again this operation
    const mine = new AbortController();
    ctrl = mine;

    const decision = await resolveRejoin({
      probe: () => deps.probe(coordinator, remembered.id, remembered.token, mine.signal),
      sleep: deps.sleep,
      retries: deps.retries,
      signal: mine.signal,
    });

    if (decision === "cancelled") return; // cancelProbe() already handled state, storage and messaging

    switch (decision) {
      case "reuse":
        deps.say(`auto-resumed as ${remembered.id}`);
        await runOperation(coordinator, { id: remembered.id, token: remembered.token });
        break;
      case "fresh":
        deps.say("auto-rejoining (previous island no longer known to the coordinator)");
        await runOperation(coordinator);
        break;
      case "wait":
        deps.say("could not reach the coordinator to auto-rejoin; press Join to retry");
        setState("idle");
        break;
    }
  }

  function stop() {
    setState("stopping");
    ctrl?.abort();
    deps.say("stopping after the current task");
    deps.storage.save(null); // a stopped island must stay stopped after a reload
  }

  function cancelProbe() {
    ctrl?.abort(); // aborts the in-flight probe fetch and any pending backoff wait
    deps.say("cancelled");
    // Matches Stop's contract: cancelling a resume attempt is a decision not
    // to auto-resume again next time either, so it must not stay remembered.
    deps.storage.save(null);
    setState("idle");
  }

  function clickJoin() {
    if (state === "running") return stop();
    if (state === "probing") return cancelProbe();
    if (state !== "idle") return; // "starting"/"stopping": no-op, as before
    const remembered = deps.storage.load();
    if (remembered) {
      void attemptResume(remembered);
      return;
    }
    const coordinator = deps.getUrl(); // captured once for this whole operation
    void runOperation(coordinator);
  }

  async function autoRejoin() {
    const remembered = deps.storage.load();
    if (!remembered || state !== "idle") return;
    await attemptResume(remembered);
  }

  return {
    clickJoin,
    autoRejoin,
    get state() {
      return state;
    },
  };
}
