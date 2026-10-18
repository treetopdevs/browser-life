// Headless island: joins a coordinator and works through segment tasks.
//   deno run -A tools/island.ts [--coordinator http://localhost:4000] [--tasks 0] [--garden-token=<t>]
// A coordinator with a garden island token (its BL_GARDEN_ISLAND_TOKEN) offers a garden's days only to islands that
// showed it at join: give it here with BL_ISLAND_GARDEN_TOKEN (recommended: a flag is visible to other local users in
// `ps`) or --garden-token=<t>, which wins over the variable; an empty value is no token. Write the flag with `=`: a
// token after a space that starts with `-` is read as flags. The island's variable is not the coordinator's, so a
// shell that runs a coordinator does not hand its token to every coordinator an island there joins. The token is sent
// only over https or to a loopback host, in the join body only, and is never printed.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { requestDevice } from "@bl/sim-gpu";
import { gardenTokenForCoordinator, gardenTokenFrom, runIsland } from "@bl/runner";

const a = parseArgs(Deno.args, { string: ["coordinator", "tasks", "label", "garden-token"], default: { coordinator: "http://localhost:4000", tasks: "0", label: "" } });
const given = gardenTokenFrom(a["garden-token"], Deno.env.get("BL_ISLAND_GARDEN_TOKEN"));
const gardenToken = gardenTokenForCoordinator(a.coordinator, given);
if (given && !gardenToken) console.log(`garden token: not sent (${a.coordinator} is neither https nor a loopback host)`);
else if (a["garden-token"] === "") console.log("garden token: none (--garden-token was empty; for a token that starts with -, write --garden-token=<t>)");
else console.log(`garden token: ${gardenToken ? "given" : "none"}`);
const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
const info = adapter?.info;
const desc = [info?.vendor, info?.architecture, info?.description].filter(Boolean).join(" ") || "unknown";
const device = await requestDevice(navigator.gpu);
const n = await runIsland(device, {
  coordinator: a.coordinator,
  host: { host: `deno ${Deno.version.deno} ${Deno.build.os}-${Deno.build.arch}${a.label ? ` ${a.label}` : ""}`, adapter: `wgpu ${desc}` },
  maxTasks: Number(a.tasks),
  idleMs: 5000,
  gardenToken,
  log: (m) => console.log(m),
});
console.log(`island finished ${n} tasks`);
