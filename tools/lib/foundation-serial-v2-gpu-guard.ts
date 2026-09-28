/** Bounded process check for other known browser-life GPU assay runners. */
const GPU_SCRIPT = /\btools\/(?:foundations\.ts|foundation-(?:role-cohort|replay|competition|serial-transfer(?:-v2)?|serial-v2-continuation|copy-diagnostic|transplant-pilot)\.ts)\b/;
const PLAN_FIRST = /\btools\/foundation-(?:competition|serial-transfer(?:-v2)?|serial-v2-continuation|copy-diagnostic|transplant-pilot)\.ts\b/;

export function competingGpuPids(psOutput: string, selfPid: number): number[] {
  const found: number[] = [];
  for (const line of psOutput.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(\S+)\s+(.+)$/);
    if (!match) continue;
    const pid = Number(match[1]), executable = match[2].split("/").at(-1);
    if (pid === selfPid || executable !== "deno" ||
        !/^(?:\S*\/)?deno\s+run\b/.test(match[3]) ||
        !GPU_SCRIPT.test(match[3])) continue;
    if (PLAN_FIRST.test(match[3]) && !/(?:^|\s)--execute(?:\s|$)/.test(match[3])) continue;
    if (/\btools\/foundation-role-cohort\.ts\b/.test(match[3]) &&
        !/(?:^|\s)--(?:execute|smoke)(?:\s|$)/.test(match[3])) continue;
    if (/\btools\/foundation-replay\.ts\b/.test(match[3]) &&
        !/\btools\/foundation-replay\.ts\s+build(?:\s|$)/.test(match[3])) continue;
    found.push(pid);
  }
  return found;
}

export function assertNoCompetingGpuRun(): void {
  const output = new Deno.Command("ps", { args: ["-Ao", "pid=,comm=,args="],
    stdout: "piped", stderr: "piped" }).outputSync();
  if (!output.success) throw new Error("A2 cannot verify current GPU runner occupancy");
  const pids = competingGpuPids(new TextDecoder().decode(output.stdout), Deno.pid);
  if (pids.length) throw new Error(`A2 competing browser-life GPU runner process(es): ${pids.join(",")}`);
}
