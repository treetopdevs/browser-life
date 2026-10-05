// Renders one research track's report.json (and, for anticipation/
// biogeography, a second input file) into a self-contained HTML fragment
// meant to be published as a claude.ai Artifact (design rules: tools/lib/report-html/page.ts;
// enforced by tools/test/report-html/contract.ts). This file is only the CLI: argument parsing,
// SHA-256 hashing of the input file(s), and dispatch through the track
// registry below to a pure `render(data, meta)` in
// tools/lib/report-html/<track>.ts. All page-layout/CSS/SVG logic lives in
// tools/lib/report-html/{page,svg}.ts and the per-track renderer files, not
// here.
//
//   deno run -A tools/report-html.ts <track> <input...> --out <file.html> [--force] [--status REAL|PILOT|SMOKE]
//
// `<input...>` is one file for nullcal/individuality (report.json) and lineage
// (a dossier written by tools/lineage.ts --out), and two for anticipation
// (results.json manifest.json) / biogeography (report.json experiment.json),
// in that order -- see each track's `argNames` below.
// `--out` must not already exist unless `--force` is given (same
// refuse-to-overwrite convention as tools/nullcal.ts/tools/individuality.ts's
// `--out` guard). `--status` overrides the track's default DATA STATUS
// (nullcal/individuality default REAL, anticipation PILOT, biogeography
// SMOKE) -- present for a future rerun that changes a track's data maturity,
// not because today's four runs are ambiguous.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { writeAll } from "./lib/report-html/write-all.ts";

export type DataStatus = "REAL" | "PILOT" | "SMOKE";
const DATA_STATUSES: readonly DataStatus[] = ["REAL", "PILOT", "SMOKE"];

export interface SourceRef {
  path: string;
  sha256: string;
}

export interface RenderMeta {
  /** One entry per input file, in the same order as the track's `argNames`. */
  sources: SourceRef[];
  status: DataStatus;
}

/**
 * The interface every `tools/lib/report-html/<track>.ts` renderer module
 * exports (as two top-level functions, `validate` and `render` -- not as an
 * object implementing this interface; this type documents their combined
 * shape, and is also the type of `notImplemented`'s stub below and of the
 * value each track's `load()` resolves to).
 *
 *   export function validate(data: unknown): asserts data is XReport { ... }
 *   export function render(data: XReport, meta: RenderMeta): string { ... }
 *
 * `validate` throws a clear, specific error naming the missing/malformed
 * field on bad input; `render` is a pure function of `(data, meta)` (no
 * Date/Math.random) building the page via tools/lib/report-html/page.ts and
 * svg.ts helpers.
 */
export interface TrackRenderer<T> {
  validate(data: unknown): asserts data is T;
  render(data: T, meta: RenderMeta): string;
}

type Track = "nullcal" | "individuality" | "anticipation" | "biogeography" | "lineage";
const TRACK_NAMES: readonly Track[] = ["nullcal", "individuality", "anticipation", "biogeography", "lineage"];

function notImplemented(track: Track): TrackRenderer<unknown> {
  const msg = `${track}: renderer not implemented yet -- tools/lib/report-html/${track}.ts does not exist. ` +
    `Add it (exporting validate/render per TrackRenderer<T> above) and change this track's ` +
    `"load" line in tools/report-html.ts's TRACKS registry to load it.`;
  return {
    validate(_data: unknown): asserts _data is unknown {
      throw new Error(msg);
    },
    render(_data: unknown, _meta: RenderMeta): string {
      throw new Error(msg);
    },
  };
}

interface TrackSpec {
  /** Names of this track's positional input files, in CLI order. Used only
   * for usage/error messages and to check the CLI got the right number of
   * input paths -- not a schema. */
  argNames: readonly string[];
  /** Default DATA STATUS chip, overridable per invocation with `--status`. */
  defaultStatus: DataStatus;
  /** Combines this track's parsed JSON input file(s) (in `argNames` order)
   * into the single `data` value passed to `validate`/`render`. */
  combine(files: unknown[]): unknown;
  /**
   * Loads this track's renderer module. A stub (throws "not implemented")
   * until tools/lib/report-html/<track>.ts exists. THE ONE LINE a future
   * agent changes to wire up a real renderer -- replace the stub with:
   *
   *   load: () => import("./lib/report-html/<track>.ts") as unknown as Promise<TrackRenderer<unknown>>,
   *
   * (the `as unknown as` cast is the one sanctioned type-eraser in this
   * file: it drops the renderer module's own concrete report type down to
   * `TrackRenderer<unknown>` so all four tracks can share one registry type;
   * every renderer module itself stays fully typed against its own report
   * shape internally.)
   */
  load(): Promise<TrackRenderer<unknown>>;
}

const TRACKS: Record<Track, TrackSpec> = {
  nullcal: {
    argNames: ["report"],
    defaultStatus: "REAL",
    combine: ([report]) => report,
    load: () => import("./lib/report-html/nullcal.ts") as unknown as Promise<TrackRenderer<unknown>>,
  },
  individuality: {
    argNames: ["report"],
    defaultStatus: "REAL",
    combine: ([report]) => report,
    load: () => import("./lib/report-html/individuality.ts") as unknown as Promise<TrackRenderer<unknown>>,
  },
  anticipation: {
    argNames: ["results", "manifest"],
    defaultStatus: "PILOT",
    combine: ([results, manifest]) => ({ results, manifest }),
    load: () => import("./lib/report-html/anticipation.ts") as unknown as Promise<TrackRenderer<unknown>>,
  },
  biogeography: {
    argNames: ["report", "experiment"],
    defaultStatus: "SMOKE",
    combine: ([report, experiment]) => ({ report, experiment }),
    load: () => import("./lib/report-html/biogeography.ts") as unknown as Promise<TrackRenderer<unknown>>,
  },
  // One genotype or pond lineage (docs/lineage-inspector.md): descriptive, so REAL marks real-run data,
  // and --status SMOKE suits a dossier of a test history.
  lineage: {
    argNames: ["dossier"],
    defaultStatus: "REAL",
    combine: ([dossier]) => dossier,
    load: () => import("./lib/report-html/lineage.ts") as unknown as Promise<TrackRenderer<unknown>>,
  },
};

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function usage(): string {
  return `usage: deno run -A tools/report-html.ts <track> <input...> --out <file.html> [--force] [--status REAL|PILOT|SMOKE]\nknown tracks: ${TRACK_NAMES.join(", ")}`;
}

async function main() {
  const a = parseArgs(Deno.args, {
    string: ["out", "status"],
    boolean: ["force"],
    default: { force: false },
  });

  const positionals = a._.map(String);
  const [trackArg, ...inputPaths] = positionals;
  if (!trackArg) throw new Error(usage());
  if (!(TRACK_NAMES as readonly string[]).includes(trackArg)) {
    throw new Error(`unknown track "${trackArg}" -- known tracks: ${TRACK_NAMES.join(", ")}\n${usage()}`);
  }
  const track = trackArg as Track;
  const spec = TRACKS[track];

  if (inputPaths.length !== spec.argNames.length) {
    throw new Error(
      `${track} takes ${spec.argNames.length} input file(s) (${spec.argNames.join(", ")}), got ${inputPaths.length}: [${inputPaths.join(", ")}]\n${usage()}`,
    );
  }

  if (!a.out) throw new Error(`--out <file.html> is required\n${usage()}`);
  const out = String(a.out);

  if (!a.force) {
    try {
      await Deno.stat(out);
      throw new Error(`--out ${out} already exists -- pass --force to overwrite it`);
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
  }

  const sources: SourceRef[] = [];
  const parsed: unknown[] = [];
  for (const p of inputPaths) {
    const bytes = await Deno.readFile(p);
    const sha256 = await sha256Hex(bytes);
    sources.push({ path: p, sha256 });
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
      throw new Error(`${p}: not valid JSON (${(e as Error).message})`);
    }
    parsed.push(json);
  }

  let status: DataStatus = spec.defaultStatus;
  if (a.status !== undefined) {
    const upper = String(a.status).toUpperCase();
    if (!(DATA_STATUSES as readonly string[]).includes(upper)) {
      throw new Error(`--status must be one of ${DATA_STATUSES.join(", ")}, got "${a.status}"`);
    }
    status = upper as DataStatus;
  }

  const meta: RenderMeta = { sources, status };
  const data = spec.combine(parsed);
  const renderer: TrackRenderer<unknown> = await spec.load();
  renderer.validate(data);
  const html = renderer.render(data, meta);

  // The early `Deno.stat` guard above is a fast, cheap fail before doing any
  // of the read/parse/validate/render work above -- but by itself it leaves
  // a TOCTOU race: two concurrent invocations targeting the same not-yet-
  // existing `--out` could both pass that stat check before either writes,
  // and a plain `Deno.writeTextFile` here (create-or-truncate, not an
  // exclusive create) would let the second one silently clobber the first
  // even though neither passed `--force`. Closing that race requires the
  // actual write itself to be a `createNew` open when `--force` was not
  // given, so a second writer loses atomically at the OS level instead of
  // truncating the first writer's file.
  // `html.length` is a UTF-16 CODE-UNIT count, not a byte count -- any
  // non-ASCII character (a stray "--" typeset as an em dash, say) makes it
  // diverge from the actual file size on disk. Encode once up front and log
  // that buffer's own length, so the printed byte count always matches
  // `shasum`/`wc -c` on the written file, regardless of what a track renderer
  // puts in its HTML.
  const encoded = new TextEncoder().encode(html);
  if (a.force) {
    await Deno.writeFile(out, encoded);
  } else {
    let file: Deno.FsFile;
    try {
      file = await Deno.open(out, { createNew: true, write: true });
    } catch (e) {
      if (e instanceof Deno.errors.AlreadyExists) {
        throw new Error(`--out ${out} already exists -- pass --force to overwrite it`);
      }
      throw e;
    }
    try {
      await writeAll((chunk) => file.write(chunk), encoded);
    } finally {
      file.close();
    }
  }
  const sourceList = sources.map((s) => `${s.path}@${s.sha256.slice(0, 12)}`).join(", ");
  console.log(`wrote ${out} (${encoded.length} bytes) from ${sourceList}`);
}

await main();
