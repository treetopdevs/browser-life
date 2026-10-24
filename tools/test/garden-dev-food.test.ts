import { afterEach, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const scratch: string[] = [];
afterEach(() => { for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true }); });
function setup(food?: string, existing = false) {
  const dir = mkdtempSync(join(tmpdir(), "garden-food-test-")); scratch.push(dir);
  for (const path of ["bin", "stubs", "apps/coordinator/deps", "node_modules"]) mkdirSync(join(dir, path), { recursive: true });
  const script = join(dir, "bin/garden-dev");
  writeFileSync(script, readFileSync(new URL("../../bin/garden-dev", import.meta.url)));
  const stub = (name: string, body: string) => writeFileSync(join(dir, "stubs", name), `#!/bin/sh\nprintf '%s\\n' '${name}' >> "$HARNESS/calls"\n${body}\n`, { mode: 0o755 });
  stub("mix", 'echo "$$" > "$HARNESS/pid"; exec sleep 30');
  stub("deno", 'if [ "$1" = eval ]; then cat >/dev/null; echo "256 256 spots"; else exit 99; fi'); // No island or real GPU can run.
  stub("lsof", 'if [ -f "$HARNESS/pid" ]; then cat "$HARNESS/pid"; else exit 1; fi');
  stub("curl", `data=""; out=""
while [ "$#" -gt 0 ]; do
  case "$1" in --data) data=$2; shift ;; -o) out=$2; shift ;; esac
  shift
done
if [ -n "$data" ]; then
  printf '%s' "$data" > "$HARNESS/payload.json"
  if [ "$HARNESS_EXISTING" = 1 ]; then
    printf '%s' '{"error":"garden exists"}' > "$out"; printf '422'
  else
    printf '%s' '{}' > "$out"; printf '200'
  fi
else
  [ -f "$HARNESS/pid" ]
fi`);
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GARDEN_") && key !== "PORT" && key !== "LAB_PORT"));
  const env = { ...inherited, HARNESS_EXISTING: existing ? "1" : "0", PATH: `${dir}/stubs:${process.env.PATH}`, HARNESS: dir, GARDEN_LAB: "0", GARDEN_ISLANDS: "0", GARDEN_DATA_DIR: join(dir, "data") };
  delete env.GARDEN_FOOD;
  if (food !== undefined) env.GARDEN_FOOD = food;
  return { dir, script, env, stub };
}

for (const [food, existing] of [[undefined, false], ["0", false], ["1", false], ["1", true]] as const) {
  it(`launches with food=${food ?? "default"}, existing=${existing} in the actual founding payload`, async () => {
    const h = setup(food, existing);
    let output = "";
    const child = spawn("/bin/sh", [h.script], { env: h.env });
    const timer = setTimeout(() => child.kill("SIGTERM"), 10_000);
    const finished = new Promise<number | null>((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", resolve);
      child.stdout.on("data", (bytes) => {
        output += bytes.toString();
        if (output.includes("Press Ctrl-C")) child.kill("SIGTERM");
      });
      child.stderr.on("data", (bytes) => { output += bytes.toString(); });
    });
    try {
      expect(await finished, output).toBe(143);
      expect(output).toContain("Press Ctrl-C");
      const payload = JSON.parse(readFileSync(join(h.dir, "payload.json"), "utf8"));
      expect(payload.food).toBe(food === "1");
      expect(payload.founding).toEqual([{ step: 0, kind: "feed", x: 128, y: 128, r: 64, amount: 16 }]);
      expect(payload).not.toHaveProperty("foodAsks");
      expect(payload).not.toHaveProperty("foodEveryDays");
      if (existing) {
        expect(output).toContain("existing garden's food rule is unchanged");
        expect(output).not.toContain("Collective food: enabled");
      } else {
        expect(output).toContain(food === "1" ? "5 distinct networks" : "Collective food: off");
        expect(output).toContain(food === "1" ? "do not bypass" : "GARDEN_FOOD=1");
      }
    } finally { clearTimeout(timer); child.kill("SIGTERM"); }
  });
}

it("rejects invalid values before even directory/environment helper processes run", () => {
  for (const food of ["", "true", "false", "2", "01", " 1", "1 ", "1\n"]) {
    const h = setup(food);
    for (const name of ["dirname", "env", "sed"]) h.stub(name, "exit 99");
    const result = spawnSync("/bin/sh", [h.script], { env: h.env, encoding: "utf8", timeout: 2_000 });
    expect(result.status, food).toBe(1);
    expect(result.stderr).toContain("GARDEN_FOOD must be exactly 0 or 1");
    expect(existsSync(join(h.dir, "calls")), food).toBe(false);
    expect(existsSync(join(h.dir, "data")), food).toBe(false);
  }
});
