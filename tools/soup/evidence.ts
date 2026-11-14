// Deno-only evidence sidecars. Start and completion are separate create-only
// records: a start without completion means interrupted/failed, never success.
import { brotliExecutable } from "./stats.ts";

async function hash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}
async function command(cmd: string, args: string[], cwd?: string): Promise<string | null> {
  try {
    const r = await new Deno.Command(cmd, { args, cwd, stdout: "piped", stderr: "null" }).output();
    return r.success ? new TextDecoder().decode(r.stdout) : null;
  } catch { return null; }
}

/** Capture the encoder actually used, shared by run and snapshot receipts. */
export async function captureCompressor() {
  const selected = brotliExecutable();
  const bin = selected ? await Deno.realPath(selected) : null;
  const encoderFiles: Record<string, string> = {};
  const encoderLinks: Record<string, string> = {};
  const linkedLibraries = bin && Deno.build.os === "darwin" ? await command("otool", ["-L", bin]) : null;
  // Homebrew's encoder libraries use @loader_path/../lib through LC_RPATH.
  // Record unresolved/system links explicitly rather than claim they were hashed.
  const unresolvedLibraries: string[] = [];
  if (bin) {
    encoderFiles[bin] = await hash(await Deno.readFile(bin));
    const loadCommands = Deno.build.os === "darwin" ? await command("otool", ["-l", bin]) : null;
    for (const line of linkedLibraries?.split("\n").slice(1) ?? []) {
      const library = line.trim().split(" ")[0];
      if (!library) continue;
      let path = library;
      if (library.startsWith("@rpath/") && loadCommands?.includes("path @loader_path/../lib (")) {
        path = `${bin.slice(0, bin.lastIndexOf("/"))}/../lib/${library.slice(7)}`;
      }
      try {
        const target = await Deno.realPath(path);
        encoderFiles[target] = await hash(await Deno.readFile(target));
        encoderLinks[path] = target;
      }
      catch { unresolvedLibraries.push(library); }
    }
  }
  const verifyCompressor = async () => {
    for (const [path, target] of Object.entries(encoderLinks)) {
      if (await Deno.realPath(path) !== target) throw new Error(`compressor library target changed during run: ${path}`);
    }
    for (const [path, expected] of Object.entries(encoderFiles)) {
      if (await hash(await Deno.readFile(path)) !== expected) throw new Error(`compressor changed during run: ${path}`);
    }
  };
  return { executable: bin, verifyCompressor, record: { implementation: bin ?? "node:zlib fallback", version: bin ? (await command(bin, ["--version"]))?.trim() ?? null : null,
      executableSha256: bin ? encoderFiles[bin] : null, encoderFiles, encoderLinks, linkedLibraries, unresolvedLibraries,
      dependencyCaveat: "System libraries and unresolved links are not hashed; version and runtime are recorded. Use a stationary environment.", quality: 2, window: 24 } };
}

export async function startEvidence(
  out: string, params: Record<string, unknown>, programs: Uint8Array, epoch: number,
  adapter: GPUAdapterInfo | null,
) {
  const write = (name: string, value: unknown) => Deno.writeTextFile(`${out}/${name}`, JSON.stringify(value, null, 2) + "\n", { createNew: true });
  // Resolve source paths against this module, not the caller's cwd.
  const root = new URL("../../", import.meta.url);
  const sources: Record<string, string> = {};
  const sourceNames = ["tools/soup.ts", "deno.json", "deno.lock"];
  for await (const entry of Deno.readDir(new URL("tools/soup/", root))) {
    if (entry.isFile && entry.name.endsWith(".ts")) sourceNames.push(`tools/soup/${entry.name}`);
  }
  for (const path of sourceNames.sort()) {
    const bytes = await Deno.readFile(new URL(path, root));
    sources[path] = await hash(bytes);
    const target = `${out}/sources/${path}`;
    await Deno.mkdir(target.slice(0, target.lastIndexOf("/")), { recursive: true });
    await Deno.writeFile(target, bytes, { createNew: true });
  }
  const cwd = decodeURIComponent(root.pathname);
  const patch = await command("git", ["diff", "--binary", "HEAD", "--", "tools/soup.ts", "tools/soup", "deno.json", "deno.lock"], cwd);
  if (patch !== null) await Deno.writeTextFile(`${out}/source.patch`, patch, { createNew: true });
  const { executable: bin, verifyCompressor, record: compressor } = await captureCompressor();
  await write("invocation.json", {
    schema: 1, started: new Date().toISOString(), cwd: Deno.cwd(), args: Deno.args,
    executable: Deno.execPath(),
    launcherCommand: (await command("ps", ["-ww", "-p", String(Deno.pid), "-o", "command="]))?.trim() ?? null,
    runtime: Deno.version, platform: Deno.build,
    revision: (await command("git", ["rev-parse", "HEAD"], cwd))?.trim() ?? null,
    sourceStatus: await command("git", ["status", "--porcelain", "--untracked-files=all", "--", "tools/soup.ts", "tools/soup", "deno.json", "deno.lock"], cwd),
    sourceCopiesAuthoritative: true, patchExcludesUntracked: true,
    sources, patchSha256: patch === null ? null : await hash(new TextEncoder().encode(patch)),
    compressor,
    adapter: adapter ? { vendor: adapter.vendor, architecture: adapter.architecture, device: adapter.device, description: adapter.description } : null,
    params, startingEpoch: epoch, startingStateSha256: await hash(programs),
    caveat: "Source hashes identify this invocation, not historical producers. GPU driver version is unknown. A threshold crossing does not demonstrate replication.",
  });
  return {
    compressorExecutable: bin, verifyCompressor,
    async finish(bytes: Uint8Array, finalEpoch: number, transitionAt: number | null,
      observedCrossingAt: number | null, inheritedBoundary: { epoch: number; source: string } | null, gpuIntegrity: Record<string, number> | null = null) {
      await verifyCompressor();
      await write("completion.json", { schema: 1, finished: new Date().toISOString(), finalEpoch,
        gpuIntegrity, finalStateSha256: await hash(bytes), thresholdCrossingEpoch: observedCrossingAt, inheritedStoppingBoundary: inheritedBoundary,
        stopReason: transitionAt !== null && finalEpoch - transitionAt >= Number(params.after) ? (inheritedBoundary ? "inherited stopping window" : "post-threshold window") : "epoch cap" });
    },
  };
}
