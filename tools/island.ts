// Headless island: joins a coordinator and works through segment tasks.
//   deno run -A tools/island.ts [--coordinator http://localhost:4000] [--tasks 0]
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { requestDevice } from "@bl/sim-gpu";
import { runIsland } from "@bl/runner";

const a = parseArgs(Deno.args, { string: ["coordinator", "tasks", "label"], default: { coordinator: "http://localhost:4000", tasks: "0", label: "" } });
const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
const info = adapter?.info;
const desc = [info?.vendor, info?.architecture, info?.description].filter(Boolean).join(" ") || "unknown";
const device = await requestDevice(navigator.gpu);
const n = await runIsland(device, {
  coordinator: a.coordinator,
  host: { host: `deno ${Deno.version.deno} ${Deno.build.os}-${Deno.build.arch}${a.label ? ` ${a.label}` : ""}`, adapter: `wgpu ${desc}` },
  maxTasks: Number(a.tasks),
  idleMs: 5000,
  log: (m) => console.log(m),
});
console.log(`island finished ${n} tasks`);
