// Headless island: joins a coordinator and works through segment tasks.
//   deno run -A tools/island.ts [--coordinator http://localhost:4000] [--tasks 0] [--garden-token=<t>]
// A coordinator with a garden island token (its BL_GARDEN_ISLAND_TOKEN) offers a garden's days only to islands that
// showed it at join: give it here with BL_ISLAND_GARDEN_TOKEN (recommended: a flag is visible to other local users in
// `ps`) or --garden-token=<t>, which wins over the variable; an empty value is no token. Write the flag with `=`: a
// token after a space that starts with `-` is read as flags. The island's variable is not the coordinator's, so a
// shell that runs a coordinator does not hand its token to every coordinator an island there joins. The token is sent
// only over https or to a loopback host, in the join body only, and is never printed.
// Ctrl-C (SIGINT) or SIGTERM stops the island (docs/island-cancel-2026-10-18.md): the task in hand stops at its next
// census chunk, nothing more is uploaded or reported, and its lease lapses so the coordinator offers it again; a
// complete already sent is waited for and counts. The island then releases its GPU device and exits 130 (SIGINT) or
// 143 (SIGTERM); a second signal exits at once (the escape from a coordinator that never answers a complete).
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { requestDevice } from "@bl/sim-gpu";
import { gardenTokenForCoordinator, gardenTokenFrom, runIsland, STOP_MESSAGE } from "@bl/runner";

const a = parseArgs(Deno.args, { string: ["coordinator", "tasks", "label", "garden-token"], default: { coordinator: "http://localhost:4000", tasks: "0", label: "" } });
const given = gardenTokenFrom(a["garden-token"], Deno.env.get("BL_ISLAND_GARDEN_TOKEN"));
const gardenToken = gardenTokenForCoordinator(a.coordinator, given);
if (given && !gardenToken) console.log(`garden token: not sent (${a.coordinator} is neither https nor a loopback host)`);
else if (a["garden-token"] === "") console.log("garden token: none (--garden-token was empty; for a token that starts with -, write --garden-token=<t>)");
else console.log(`garden token: ${gardenToken ? "given" : "none"}`);
// The first SIGINT/SIGTERM aborts the island; a second one quits at once.
const stop = new AbortController();
let exitCode = null as number | null; // set by a signal listener, so not narrowed here
const listeners: [Deno.Signal, () => void][] = [];
for (const [sig, code] of [["SIGINT", 130], ["SIGTERM", 143]] as const) {
  const onSignal = () => {
    if (exitCode !== null) Deno.exit(exitCode);
    exitCode = code;
    console.log(`${sig}: ${STOP_MESSAGE} (send it again to quit at once)`);
    stop.abort();
  };
  try {
    Deno.addSignalListener(sig, onSignal);
    listeners.push([sig, onSignal]);
  } catch {
    // SIGTERM cannot be listened for on Windows; Ctrl-C still works there.
  }
}
// GPU startup is inside the guarded lifecycle too: a signal during adapter or device acquisition, followed by that
// acquisition failing, still removes the listeners and exits with the signal's code.
let device: GPUDevice | undefined;
let n = 0;
let failure: unknown = null;
try {
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  const info = adapter?.info;
  const desc = [info?.vendor, info?.architecture, info?.description].filter(Boolean).join(" ") || "unknown";
  device = await requestDevice(navigator.gpu);
  n = await runIsland(device, {
    coordinator: a.coordinator,
    host: { host: `deno ${Deno.version.deno} ${Deno.build.os}-${Deno.build.arch}${a.label ? ` ${a.label}` : ""}`, adapter: `wgpu ${desc}` },
    maxTasks: Number(a.tasks),
    idleMs: 5000,
    gardenToken,
    log: (m) => console.log(m),
    signal: stop.signal,
  });
} catch (e) {
  failure = e;
} finally {
  for (const [sig, fn] of listeners) Deno.removeSignalListener(sig, fn);
  device?.destroy();
}
if (failure !== null) {
  // Stopped by a signal: the signal's exit code wins over what went wrong while stopping. runIsland threw, so the
  // count of tasks it finished is unknown here (its log lines name each completion): none is printed.
  if (exitCode === null) throw failure;
  console.error(`error while stopping: ${failure instanceof Error ? failure.message : String(failure)}`);
} else console.log(`island finished ${n} tasks`);
if (exitCode !== null) Deno.exit(exitCode);
