// The lab's family tree (docs/pond-keeper-v2-2026-10-17.md, section 3). One row per family in tree order, indented by depth, and the
// tree's own log under it. Every number comes from the worker's FamiliesMsg; nothing here counts, scores or interprets. The helpers
// that decide what is shown (words for a status, the fold of extinct families, the log's window) are pure and exported for the tests.
import type { FamilyEvent, FamilyStatus, FamilySummary, FamilyView } from "@bl/metrics";
import type { FamiliesMsg } from "./protocol.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}
const n = (v: number) => v.toLocaleString("en-US");
const at = (step: number) => `t=${n(step)}`;
const plural = (count: number, one: string, many = `${one}s`) => `${n(count)} ${count === 1 ? one : many}`;

/** Extinct families are folded behind a toggle once there are more than this many. */
export const EXTINCT_FOLD = 4;
/** The tree's log shows this many events, newest first, until "show all". */
export const LOG_SHOWN = 8;
/** Rows drawn at most: a tree this large is still said in full by its summary. */
export const MAX_ROWS = 120;
/** Indentation stops growing at this depth (the row still names its parent). */
export const MAX_INDENT = 5;

/** A status in the player's words: film is the cells that lie outside any body. */
export const STATUS_WORDS: Record<FamilyStatus, string> = { living: "Living", film: "Gone to film", extinct: "Extinct" };

/** What a status means, for the chip's title and the rule beside the tree. */
export const STATUS_MEANS: Record<FamilyStatus, string> = {
  living: "At least one of its cells is in a body.",
  film: "No cell in any body for five censuses in a row. It still has living cells, outside bodies.",
  extinct: "No living cell left. Final.",
};

/** A fraction as a whole percent, floored (100% only when it is exactly everything); "—" when there is none (a family with no body has no purity). */
export const percentWords = (f: number | null): string => (f === null ? "—" : `${Math.floor(f * 100 + 1e-9)}%`);

/** A share of the jar: as a whole percent, with "<1%" for a family that has cells but under one percent of the jar's. */
export const shareWords = (f: number, cells: number): string => (cells > 0 && f * 100 < 1 ? "<1%" : percentWords(f));

/** The family's own line: its cells, its share of the jar, its bodies and its purity. */
export function statsLine(f: FamilyView): string {
  return `${plural(f.cells, "cell")} · ${shareWords(f.share, f.cells)} of the jar · ${plural(f.bodies, "body", "bodies")} · purity ${percentWords(f.purity)}`;
}

/** Where a family came from: its parent, or how a root was found. */
export function originLine(f: FamilyView): string {
  const when = `founded ${at(f.founded)}`;
  if (f.parentName !== null) return `${when} · from ${f.parentName}`;
  return f.unknownDescent ? `${when} · of unknown descent` : `${when} · a starting family`;
}

/**
 * The rows to draw, in tree order. Extinct families fold behind a toggle when there are more than `EXTINCT_FOLD` of them and the
 * player has not opened it; `hidden` is how many are folded. Rows past `MAX_ROWS` are cut (`cut`), never silently: the panel says so.
 */
export function visibleFamilies(families: readonly FamilyView[], showExtinct: boolean): { rows: FamilyView[]; extinct: number; folded: number; cut: number } {
  const extinct = families.reduce((c, f) => c + (f.status === "extinct" ? 1 : 0), 0);
  const fold = extinct > EXTINCT_FOLD && !showExtinct;
  const all = fold ? families.filter((f) => f.status !== "extinct") : [...families];
  return { rows: all.slice(0, MAX_ROWS), extinct, folded: fold ? extinct : 0, cut: Math.max(0, all.length - MAX_ROWS) };
}

/** The log, newest first: the last `LOG_SHOWN` events unless `all`, and how many are left out. */
export function logWindow(events: readonly FamilyEvent[], all: boolean): { rows: FamilyEvent[]; hidden: number } {
  const newest = [...events].reverse();
  const rows = all ? newest : newest.slice(0, LOG_SHOWN);
  return { rows, hidden: newest.length - rows.length };
}

/** The log's event kinds in words. */
export const EVENT_WORDS: Record<FamilyEvent["kind"], string> = { split: "Split", film: "Gone to film", back: "Back from film", extinct: "Extinct", found: "Found" };

/** The counts line over the tree. */
export function summaryWords(s: FamilySummary): string {
  if (s.named === 0) return "No families named yet";
  return `${n(s.named)} named · ${n(s.living)} living · ${n(s.film)} gone to film · ${n(s.extinct)} extinct`;
}

export interface FamilyPanel {
  /** A world was adopted: forget the last one's tree. */
  onLoaded(): void;
  onFamilies(m: FamiliesMsg): void;
}

/** `colourOf` is the lab's own lineage colouring for a founding key, or undefined when that lineage is not among the colours it has drawn. */
export function createFamilyPanel(colourOf: (key: string) => string | undefined): FamilyPanel {
  let showExtinct = false;
  let showAllLog = false;
  let last: FamiliesMsg | null = null;
  let paintKey = "";

  function row(f: FamilyView): HTMLLIElement {
    const li = el("li", undefined, `family ${f.status}`);
    li.style.setProperty("--depth", String(Math.min(f.depth, MAX_INDENT)));
    if (f.depth > 0) li.classList.add("nested");
    li.title = `lineage ${f.founder}`;
    const swatch = el("i", undefined, "family-swatch");
    swatch.setAttribute("aria-hidden", "true");
    const colour = colourOf(f.founder);
    if (colour) swatch.style.background = colour;
    else swatch.classList.add("none");
    const head = el("span", undefined, "family-head");
    const chip = el("span", STATUS_WORDS[f.status], f.status === "living" ? "badge note" : "badge");
    chip.title = STATUS_MEANS[f.status];
    head.append(el("span", f.name, "family-name"), chip);
    const body = el("span", undefined, "family-body");
    body.append(head, el("span", statsLine(f), "family-stats mono"), el("span", originLine(f), "family-origin"));
    li.append(swatch, body);
    return li;
  }

  function logRow(e: FamilyEvent): HTMLLIElement {
    const li = el("li", undefined, `first family-event ${e.kind}`);
    li.append(el("span", at(e.step), "first-step mono"), el("span", EVENT_WORDS[e.kind], "first-name"), el("span", e.detail, "first-detail"));
    return li;
  }

  function paint() {
    const m = last;
    if (m === null) return;
    const { rows, extinct, folded, cut } = visibleFamilies(m.families, showExtinct);
    const log = logWindow(m.events, showAllLog);
    // The colours are read now, not cached in the message: a lineage drawn since the last census may have a colour by this one.
    const colours = rows.map((f) => colourOf(f.founder) ?? "");
    const key = JSON.stringify([m.families, m.events, m.summary, m.fromStart, m.stopped, showExtinct, showAllLog, colours]);
    if (key === paintKey) return;
    paintKey = key;

    const late = m.summary.watchedFrom !== null && !m.fromStart;
    $("families-watch").hidden = !late;
    if (late) $("families-watch-badge").textContent = `Watching since ${at(m.summary.watchedFrom!)}`;
    $("families-stopped").hidden = m.stopped === null;
    if (m.stopped !== null) $("families-stopped-text").textContent = `${m.stopped}. The families shown are the last it saw, and no session file is offered.`;
    $("families-empty").hidden = m.families.length > 0;
    $("families-summary").textContent = summaryWords(m.summary);
    $("families-summary").hidden = m.families.length === 0;
    $("families-tree-block").hidden = m.families.length === 0;
    $("family-tree").replaceChildren(...rows.map(row));

    const toggle = $<HTMLButtonElement>("families-extinct-toggle");
    toggle.hidden = extinct <= EXTINCT_FOLD;
    toggle.setAttribute("aria-expanded", String(showExtinct));
    toggle.textContent = showExtinct ? "Hide extinct" : `Show ${n(folded || extinct)} extinct`;
    $("families-cut").hidden = cut === 0;
    if (cut > 0) $("families-cut").textContent = `${n(cut)} more families are not drawn here; the counts above include them.`;

    $("family-log").replaceChildren(...log.rows.map(logRow));
    $("family-log-block").hidden = m.events.length === 0;
    const more = $<HTMLButtonElement>("family-log-more");
    more.hidden = m.events.length <= LOG_SHOWN;
    more.setAttribute("aria-expanded", String(showAllLog));
    more.textContent = showAllLog ? "Show fewer" : `Show all ${n(m.events.length)}`;
  }

  $("families-extinct-toggle").onclick = () => { showExtinct = !showExtinct; paint(); };
  $("family-log-more").onclick = () => { showAllLog = !showAllLog; paint(); };

  return {
    onLoaded() {
      last = null;
      paintKey = "";
      showExtinct = false;
      showAllLog = false;
      $("families-watch").hidden = true;
      $("families-stopped").hidden = true;
      $("families-empty").hidden = false;
      $("families-summary").hidden = true;
      $("families-tree-block").hidden = true;
      $("family-tree").replaceChildren();
      $("families-extinct-toggle").hidden = true;
      $("families-cut").hidden = true;
      $("family-log-block").hidden = true;
      $("family-log").replaceChildren();
      $("family-log-more").hidden = true;
    },
    onFamilies(m) {
      last = m;
      paint();
    },
  };
}
