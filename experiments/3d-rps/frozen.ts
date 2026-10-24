// The FROZEN file of the cyclic-competition line (rule draft 8.3): which SHA-256 of RULES.md (and later of GATE0-RECORD.md) the main
// session recorded. RULES.md is frozen first, before Gate 0 and the lattice sweep; the Gate-0 record is written at the final GO (or
// GATE-0-STOP), completed with the dense rate of G0.6, and its hash is appended, in a dated line, before any Part B registered run. The
// readout refuses rules whose hash is not recorded (every command) and, for a registered Part B stage, a Gate-0 record whose hash is not
// recorded or that does not exist (an unhashed record is provisional for the Gate-0 table). The registered lattice sweep and the
// registered Gate-0 run refuse to start before the freeze; all use this module, which needs nothing beyond node:crypto and node:path, so
// that the sweep CLI stays light.
import { createHash } from "node:crypto";
import * as path from "node:path";

export interface FrozenEntry {
  hash: string;
  /** The file the line names (`RULES.md`, `GATE0-RECORD.md`), null for a bare hash line. */
  file: string | null;
}

/** A date or a timestamp written beside a hash (`2026-10-26`, `2026-10-26T09:00Z`): not a file name. */
const DATE_WORD = /^\d{4}-\d{2}-\d{2}(?:T\S*)?$/;

/**
 * Reads `experiments/3d-rps/FROZEN`: one SHA-256 per line, bare (like `experiments/FROZEN`) or `<hash>  <file>` / `<file>: <hash>`; `#`
 * starts a comment. A line may be dated, before or after the hash (`2026-10-26  <hash>  GATE0-RECORD.md`), and may carry words of
 * prose: the file is the word that ends in `.md`, and a line with none is a bare hash.
 */
export function parseFrozen(text: string): FrozenEntry[] {
  const out: FrozenEntry[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (line === "") continue;
    const m = /(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])/i.exec(line);
    if (!m) continue;
    const words = (line.slice(0, m.index) + " " + line.slice(m.index + 64))
      .replace(/[*:=()]/g, " ")
      .split(/\s+/)
      .filter((w) => w !== "" && !DATE_WORD.test(w));
    const named = words.find((w) => /\.md$/i.test(w));
    out.push({ hash: m[0].toLowerCase(), file: named === undefined ? null : path.basename(named) });
  }
  return out;
}

export interface RulesCheck {
  ok: boolean;
  /** SHA-256 of the rules file as read. */
  sha256: string;
  message: string;
}

const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

/** The refusal of 8.3: the rules file must have a recorded SHA-256 in FROZEN (any recorded hash of that file, so a dated amendment that re-records a hash does not brick the readout). */
export function checkFrozen(rules: Uint8Array, frozenText: string, file = "RULES.md"): RulesCheck {
  const hash = sha256(rules);
  const entries = parseFrozen(frozenText).filter((e) => e.file === null || e.file === file);
  if (entries.some((e) => e.hash === hash)) return { ok: true, sha256: hash, message: `${file} sha256 ${hash} is recorded in FROZEN` };
  return { ok: false, sha256: hash, message: `${file} has sha256 ${hash}, which FROZEN does not record (${entries.length === 0 ? `FROZEN has no hash for ${file}` : `recorded: ${entries.map((e) => e.hash.slice(0, 12)).join(", ")}`}): a frozen rules file changes only by a dated amendment that records its new hash` };
}

/**
 * Why a registered run may not start, or null: it starts only after the freeze (rule draft header), that is, when
 * `experiments/3d-rps/RULES.md` exists and its SHA-256 is recorded in `experiments/3d-rps/FROZEN` (the check the readout makes).
 * `what` names the run ("a registered sweep") and `instead` says what needs no freeze.
 */
export function freezeRefusal(what: string, instead: string, rules: Uint8Array | null, frozen: string | null): string | null {
  if (rules === null) return `${what} starts only after the freeze, and experiments/3d-rps/RULES.md does not exist (${instead})`;
  if (frozen === null) return `${what} starts only after the freeze, and experiments/3d-rps/FROZEN does not exist (${instead})`;
  const c = checkFrozen(rules, frozen, "RULES.md");
  return c.ok ? null : `${what} starts only after the freeze: ${c.message}`;
}

/**
 * The registered Gate-0 run (`gate0.ts --gate0`, not `--dry-run`): RULES.md is frozen before Gate 0 (rule draft header and 3.0). The
 * Gate-0 record does not exist yet and is hashed into FROZEN afterwards, so only RULES.md is checked here.
 */
export const gate0Refusal = (rules: Uint8Array | null, frozen: string | null): string | null =>
  freezeRefusal("a registered Gate-0 run", "use --rehearsal for plumbing, --dry-run for the wave, --table --draft for a look at jobs on disk", rules, frozen);

/** The heading of RULES.md's Amendment 1 (2026-10-24, after GATE-0-STOP): the exploration of the kill at S0's four mobility levels. */
export const AMENDMENT_1_HEADING = /^## Amendment 1\b/m;

/**
 * Why the exploration of Amendment 1 (`gate0.ts --exploration`, `readout.ts gate0-exploration`) may not run or be read, or null: it
 * needs the frozen RULES.md (its SHA-256 recorded in FROZEN) and that file must contain the Amendment 1 heading. Unlike the registered
 * run there is no dry-run exemption: the exploration exists only by the amendment.
 */
export function explorationRefusal(rules: Uint8Array | null, frozen: string | null): string | null {
  const r = freezeRefusal("the exploration of Amendment 1", "it runs only on the frozen rules that contain Amendment 1", rules, frozen);
  if (r !== null) return r;
  if (!AMENDMENT_1_HEADING.test(new TextDecoder().decode(rules!))) return "the exploration of Amendment 1 needs experiments/3d-rps/RULES.md to contain its heading (\"## Amendment 1 ...\"), and the frozen RULES.md has none: the exploration exists only by that dated amendment (3.0, 8.3)";
  return null;
}

/** The heading of RULES.md's Amendment 2 (2026-10-24, after Amendment 1 read EXPLORATION-NO-HORIZON): persistence at 256 x 256 x 4. */
export const AMENDMENT_2_HEADING = /^## Amendment 2\b/m;

/**
 * Why the exploration of Amendment 2 (`gate0.ts --exploration-2`, `readout.ts gate0-exploration-2`) may not run or be read, or null: the
 * frozen RULES.md (its SHA-256 recorded in FROZEN) must contain the Amendment 2 heading. No dry-run exemption, as for Amendment 1.
 */
export function exploration2Refusal(rules: Uint8Array | null, frozen: string | null): string | null {
  const r = freezeRefusal("the exploration of Amendment 2", "it runs only on the frozen rules that contain Amendment 2", rules, frozen);
  if (r !== null) return r;
  if (!AMENDMENT_2_HEADING.test(new TextDecoder().decode(rules!))) return "the exploration of Amendment 2 needs experiments/3d-rps/RULES.md to contain its heading (\"## Amendment 2 ...\"), and the frozen RULES.md has none: the exploration exists only by that dated amendment (3.0, 8.3)";
  return null;
}
