// The lab's log of firsts and the session card (docs/pond-keeper-v0-2026-10-17.md). The panel in the evidence
// rail lists what a detector with rules written in advance has seen the world do for the first time; the card
// sums the session up and hands out the session file. Every number comes from the worker's FirstsMsg and the
// world's manifest; nothing here counts, scores or interprets.
import type { FirstsEntry, FirstsRule, NextUpItem } from "@bl/metrics";
import type { WorldConfig } from "@bl/schema";
import type { FirstsMsg, RunManifest, SessionFacts, ToWorker } from "./protocol.ts";
import { pressureWords, scoreWords } from "./rank-labels.ts";

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

/** Ten minutes of wall time with the world growing and no pond cycle waiting: the card is offered, in the sun. */
const OFFER_AFTER_MS = 10 * 60 * 1000;

/** A run and its forks (`<runId>-b<time>`, sim.worker.ts forkRunId) are one history for the offer's clock. */
const historyRoot = (runId: string) => runId.replace(/(-b[0-9a-z]{6,})+$/, "");

/** The rows of a log of firsts, newest first (the detector lists them in the order they fired). Shared by the panel and the card. */
function firstsList(entries: readonly FirstsEntry[], label: string): HTMLOListElement {
  const ol = el("ol", undefined, "firsts-list");
  ol.setAttribute("aria-label", label);
  for (const e of [...entries].sort((a, b) => b.step - a.step)) {
    const li = el("li", undefined, e.already ? "first already" : "first");
    li.append(el("span", at(e.step), "first-step mono"), el("span", e.name, "first-name"));
    li.append(el("span", e.already ? `Already there when watching began · ${e.detail}` : e.detail, "first-detail"));
    ol.append(li);
  }
  return ol;
}

/** A rung's unit for one of it: the detector names units for many ("cells", "splits", "censuses", "cells moved"). */
const oneOf = (unit: string) => (unit === "censuses" ? "census" : unit.replace(/^(\w+)s\b/, "$1"));

/** The wound rung's hint while nothing has been tried: a rung that reads 0 does not say how to move it. */
export const WOUND_HINT = "Not tried yet: pick the Wound tool and brush a pond that holds a body.";

/** A number as the rung shows it: whole, or with the one decimal the rung asks for (`decimals`, already floored by the detector). */
const rungNumber = (v: number, decimals?: 1) => (decimals === 1 ? (Math.round(v * 10) / 10).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : n(v));

/**
 * A rung's progress in words, with "seen so far" or "now" after it. The counter is a best-so-far for most rungs and a reading at the
 * latest census for the others, and the line says which. Pure, so the lab's tests can hold the wording.
 */
export function rungWords(item: NextUpItem): string {
  // A share is a percentage of something ("% of a body’s cells"); the rung needs more than its target, not the target.
  const pct = item.unit.startsWith("%");
  const unit = pct ? item.unit.slice(1).trim() : item.unit, mark = pct ? "%" : "";
  const value = rungNumber(item.value, item.decimals), target = Number.isInteger(item.target) ? n(item.target) : rungNumber(item.target, item.decimals);
  const said = item.above
    ? `${value}${mark} ${unit}, needs more than ${target}${mark}`
    : pct ? `${value}% ${unit}, needs ${target}%`
    : `${value} of ${item.decimals === 1 ? `${target} ${unit}` : plural(item.target, oneOf(unit), unit)}`;
  return `${said} · ${item.kind === "best" ? "seen so far" : "now"}`;
}

/**
 * One rung of Next up: its name, a bar of the detector's own progress counter, and the numbers in words. The bar is a
 * picture of the line beside it, hidden from assistive technology: the words carry the numbers.
 */
function nextUpRow(item: NextUpItem): HTMLLIElement {
  const li = el("li", undefined, "rung");
  const name = el("span", item.name, "rung-name");
  const bar = el("progress", undefined, "rung-bar");
  // A rung that needs more than its target is unreached at the target itself: its bar fills only past it.
  bar.max = item.above ? item.target + 1 : item.target;
  bar.value = Math.min(item.value, item.target);
  bar.setAttribute("aria-hidden", "true");
  li.append(name, bar, el("span", rungWords(item), "rung-says mono"));
  if (item.id === "outlive-wound" && item.value === 0) li.append(el("span", WOUND_HINT, "rung-hint"));
  return li;
}

function rulesList(rules: readonly FirstsRule[]): HTMLElement {
  const dl = el("dl", undefined, "firsts-rules-list");
  for (const r of rules) dl.append(el("dt", r.name), el("dd", `Fires at the first census where ${r.text.replace(/'/g, "’")}.`));
  return dl;
}

/**
 * The card's account of the family tree: how many families were named, how many are in a body, on film or gone. Counts only,
 * from the card's facts; the tree itself, with names and purity, is in its own panel.
 */
export function familyCardRows(f: SessionFacts["families"]): [string, string][] {
  if (f.named === 0) return [["Families named", "None yet"]];
  const kinds = [f.starting > 0 ? `${n(f.starting)} starting` : "", f.split > 0 ? `${n(f.split)} split off` : ""].filter(Boolean);
  const later = f.named - f.starting - f.split;
  if (later > 0) kinds.push(`${n(later)} found later`);
  return [
    ["Families named", `${n(f.named)}${kinds.length ? ` (${kinds.join(", ")})` : ""}`],
    ["Living", n(f.living)],
    ["Gone to film", n(f.film)],
    ["Extinct", n(f.extinct)],
  ];
}

export interface FirstsPanel {
  /** A world was adopted: forget the last one's log, its timer and its file. */
  onLoaded(manifest: RunManifest): void;
  onFirsts(m: FirstsMsg): void;
  onSessionFile(m: { world: number; id: number; text: string; name: string }): void;
  /** The worker refused the export (`id`: the request it answers, when it says): say why on the card. */
  onRefused(message: string, id?: number): void;
  /** The world is growing (playing, not held at a pond cycle). */
  setGrowing(growing: boolean): void;
  /** A pond cycle is waiting for its donors. */
  setWaiting(waiting: boolean): void;
}

export function createFirstsPanel(send: (m: ToWorker) => void): FirstsPanel {
  const dialog = $<HTMLDialogElement>("session-card");
  const cardBody = $("card-body");
  const cardButton = $<HTMLButtonElement>("btn-card");
  const fileButton = $<HTMLButtonElement>("btn-session-file");
  const fileNote = $("card-file-note");

  let cfg: WorldConfig | null = null;
  let last: FirstsMsg | null = null;
  let waiting = false;
  let growing = false;
  /** Wall time spent growing with no cycle waiting, and when it was last counted. */
  let grownMs = 0;
  let countedAt: number | null = null;
  let offered = false;
  let history: string | null = null;
  /** The export in flight: the world it was asked for (`FirstsMsg.world`) and its request id, or null. */
  let exporting: { world: number; id: number } | null = null;
  let nextExport = 1;
  /** The panel's and the card's last paint, so a census that changes neither repaints neither. */
  let panelKey = "", cardKey = "";

  function setFileNote(text: string, kind: string, command?: string) {
    fileNote.replaceChildren(document.createTextNode(text));
    if (command) fileNote.append(" ", el("code", command, "card-command"));
    fileNote.dataset.kind = kind;
  }
  /** What the button does, said before it is pressed. */
  const resetFileNote = () => setFileNote("Saves this world’s history from step 0, its firsts and this card as one file, which tools/run.ts replays and checks against this world’s final state.", "ready");

  /** What the Download button can do now, and if it cannot, why, beside it. */
  function syncFile() {
    const refusal = last?.refusal ?? null;
    const why = waiting ? "The file waits for the pond cycle: breed first."
      : refusal ? refusal
      : last !== null && last.summary.step === null ? "The world hasn’t reached its first census yet: let it run a little first."
      : null;
    fileButton.disabled = why !== null || exporting !== null || last === null;
    if (why) setFileNote(why, "wait");
    else if (fileNote.dataset.kind === "wait") resetFileNote();
  }

  function syncOffer() {
    const lit = !offered && grownMs >= OFFER_AFTER_MS;
    cardButton.classList.toggle("lit", lit);
    $("card-hint").textContent = lit
      ? "Ten minutes of growing: the card sums it up and the file replays it."
      : "Sums the session up: what was bred, how far it got, what died, and a file that replays it.";
  }

  function tick() {
    const now = performance.now();
    if (countedAt !== null) grownMs += now - countedAt;
    // A hidden tab's worker is throttled, so its wall time is not growing time.
    countedAt = growing && !waiting && !document.hidden ? now : null;
    syncOffer();
  }
  // One second is plenty for a ten-minute offer; the timestamps, not the interval, keep the time.
  window.setInterval(() => { if (countedAt !== null) tick(); }, 1000);
  document.addEventListener("visibilitychange", tick);

  function paintPanel(m: FirstsMsg) {
    const watchedFrom = m.summary.watchedFrom;
    const key = JSON.stringify([m.entries, m.fromStart, watchedFrom, m.stopped, m.summary.step === null, m.nextUp]);
    if (key === panelKey) return;
    panelKey = key;
    $("firsts-stopped").hidden = m.stopped === null;
    if (m.stopped !== null) $("firsts-stopped-badge").textContent = `The log stopped at ${m.summary.step === null ? "its start" : at(m.summary.step)}`;
    const late = watchedFrom !== null && !m.fromStart;
    $("firsts-watch").hidden = !late;
    if (late) $("firsts-watch-badge").textContent = `Watching since ${at(watchedFrom)}`;
    $("nextup-list").replaceChildren(...m.nextUp.map(nextUpRow));
    $("nextup-done").hidden = m.nextUp.length > 0;
    // The heading names rows or the note that none are left; the hint explains the rows' last words.
    $("nextup-heading").hidden = false;
    $("nextup-hint").hidden = m.nextUp.length === 0;
    $("firsts-empty").hidden = m.entries.length > 0;
    const list = $("firsts-list");
    list.replaceChildren(...firstsList(m.entries, "Firsts so far, newest first").children);
    list.hidden = m.entries.length === 0;
    $("firsts-rules-body").replaceChildren(rulesList(m.rules));
  }

  function section(title: string): HTMLElement {
    const s = el("section", undefined, "card-section");
    s.append(el("h3", title));
    return s;
  }
  function kv(rows: [string, string | Node][]): HTMLElement {
    const dl = el("dl", undefined, "kv");
    for (const [k, v] of rows) {
      const dd = el("dd");
      dd.append(v);
      dl.append(el("dt", k), dd);
    }
    return dl;
  }
  const hint = (text: string) => el("p", text, "hint");

  function familiesSection(f: SessionFacts["families"]): HTMLElement {
    const fam = section("Families");
    fam.append(kv(familyCardRows(f)));
    fam.append(hint(f.named === 0
      ? "The family tree starts naming families at the first census. Families are told apart by descent, seen, not measured."
      : `Families are told apart by descent, seen, not measured. Gone to film means no cell in any body for five censuses in a row; extinct means no living cell left. The names and purity are in the Family tree panel.`));
    return fam;
  }

  function paintCard(m: FirstsMsg, world: WorldConfig | null) {
    const key = JSON.stringify([m.entries, m.summary, m.facts, m.stopped, m.fromStart]);
    if (key === cardKey) return;
    // A reader selecting text on the card keeps it: the next census after the selection ends repaints.
    const sel = document.getSelection();
    if (sel && !sel.isCollapsed && sel.anchorNode && cardBody.contains(sel.anchorNode)) return;
    cardKey = key;
    const { summary: s, facts: f } = m;
    const pond = world !== null && world.pondPeriod !== undefined;
    const sections: HTMLElement[] = [];

    // What was bred.
    const bred = section("What was bred");
    const pressure = world ? pressureWords(world) : null;
    if (!pond || pressure === null) bred.append(kv([["Pressure", "No pond cycles in this world"]]));
    else {
      const picks = f.picks;
      // Only the cycles the Breeder stopped at are in the log as picks; the rest ran on the rule without asking.
      const ran = Math.max(f.cycles, picks.total);
      const unasked = ran - picks.total;
      const cycles = world.pondArm === "cont"
        ? (ran === 0 ? "None yet" : `${plural(ran, "cycle")} measured; this world never reseeds its ponds`)
        : ran === 0
        ? "None yet"
        : `${plural(ran, "cycle")}: ${n(picks.byHand)} with your donors, ${n(picks.byRule)} the rule’s own${picks.unknown > 0 ? `, ${n(picks.unknown)} not recorded here` : ""}${unasked > 0 ? `, ${n(unasked)} ran without stopping for you` : ""}`;
      const before = f.cyclesBefore > 0 ? `; ${plural(f.cyclesBefore, "earlier cycle")} before this copy was opened, not in its log` : "";
      const rows: [string, string][] = [["The world’s pressure", pressure]];
      // A version 1 file's facts have no pressures; the page only shows the live world's, which always do.
      const dial = f.pressures;
      if (dial && dial.changes > 0) rows.push(["Dial", `Set ${plural(dial.changes, "time")}; latest: ${scoreWords(dial.latest ?? undefined)?.toLowerCase() ?? "none"}`]);
      rows.push(["Pond cycles", cycles + before]);
      bred.append(kv(rows));
      bred.append(hint("A cycle counts as yours when your donors differ from the order the rule would have chosen; picks that match it count as the rule’s own."));
    }
    sections.push(bred);

    // How far.
    const far = section("How far");
    if (s.baseline === null || s.latest === null || s.watchedFrom === null || s.step === null) far.append(hint("Nothing watched yet: the first census comes soon after the world starts."));
    else {
      const table = el("table", undefined, "card-table mono");
      const head = el("tr");
      const col = (text: string, cls?: string) => { const th = el("th", text, cls); th.scope = "col"; return th; };
      head.append(col("Measure", "sr-only"), col(`At ${at(s.watchedFrom)}`), col(`Now, ${at(s.step)}`));
      const thead = el("thead");
      thead.append(head);
      const body = el("tbody");
      const rows: [string, number, number][] = [
        ["Bodies", s.baseline.bodies, s.latest.bodies],
        ["Largest body, in cells", s.baseline.largestBody, s.latest.largestBody],
        ["Deepest generation", s.baseline.maxGeneration, s.latest.maxGeneration],
        ["Lineages", s.baseline.lineages, s.latest.lineages],
      ];
      for (const [label, before, now] of rows) {
        const tr = el("tr");
        const th = el("th", label);
        th.scope = "row";
        tr.append(th, el("td", n(before)), el("td", n(now)));
        body.append(tr);
      }
      table.append(thead, body);
      const wrap = el("div", undefined, "card-table-wrap");
      wrap.append(table);
      far.append(wrap);
      if (!m.fromStart) far.append(hint(`The first column is the first census this page watched, ${at(s.watchedFrom)}, not the start of the world.`));
    }
    sections.push(far);

    // The family tree's counts (families-v1), from the same census as the rest.
    sections.push(familiesSection(f.families));

    // What died.
    const died = section("What died");
    const lost = s.bodiesLost === 0 ? "none" : pond && world.pondArm !== "cont" ? `${n(s.bodiesLost)}, ${n(s.bodiesLostAtCycle)} of them at pond cycles` : n(s.bodiesLost);
    const gone = s.startingLineages - s.startingLineagesPresent;
    died.append(kv([
      ["Bodies lost", lost],
      ["Starting lineages gone", s.startingLineages === 0 ? "none to start with" : `${n(gone)} of ${n(s.startingLineages)}`],
      ["The jar", s.emptiedAt === null ? "never emptied" : `emptied at ${at(s.emptiedAt)}`],
      ["Last seen with a body", s.lastBodyStep === null ? "no body seen yet" : at(s.lastBodyStep)],
    ]));
    died.append(hint(pond && world.pondArm !== "cont"
      ? "Bodies lost are individuals the census could no longer match from one census to the next. A pond cycle clears every pond, so many losses fall at those steps."
      : "Bodies lost are individuals the census could no longer match from one census to the next."));
    sections.push(died);

    // The firsts, as in the panel.
    const firsts = section("Firsts");
    firsts.append(m.entries.length ? firstsList(m.entries, "Firsts so far, newest first") : hint("Nothing yet."));
    sections.push(firsts);

    // By hand.
    const hand = section("By hand");
    hand.append(kv([["Wounds", n(f.wounds)], ["Feeds", n(f.feeds)], ["Drains", n(f.drains)]]));
    sections.push(hand);

    // The latest replay check.
    const check = section("Latest replay check");
    const r = f.replay;
    if (r === null) check.append(kv([["Replay", el("span", "not checked", "badge")]]));
    else {
      // The same test as the replay panel: a check that stops short of the world now, or a hand edit logged at its last step, covers an earlier stretch.
      const earlier = r.to < f.step || r.handAtEnd;
      const badge = el("span", r.ok ? (earlier ? "matched, earlier stretch" : "matched") : "did not match", `badge ${r.ok ? (earlier ? "note" : "ok") : "bad"}`);
      check.append(kv([["Replay", badge], ["Steps", `${at(r.from)} to ${at(r.to)}`]]));
      if (r.handAtEnd) check.append(hint("A hand edit was logged at the last of those steps."));
    }
    sections.push(check);

    const honesty = el("p", "A first is a detector’s verdict on a census, not proof that your picks caused it. Reordering four donors changes a whole history, so a first reached here and missed in another session says little about the pressure. Nothing on this card is a score.", "hint card-honesty");
    sections.push(honesty);
    cardBody.replaceChildren(...sections);
  }

  const paintOpenCard = () => { if (dialog.open && last) paintCard(last, cfg); syncFile(); };

  cardButton.onclick = () => {
    offered = true;
    syncOffer();
    cardKey = "";
    if (last) paintCard(last, cfg);
    else cardBody.replaceChildren(hint("Nothing watched yet."));
    syncFile();
    dialog.showModal();
    $("card-heading").focus();
  };
  dialog.querySelector<HTMLButtonElement>(".card-close")!.onclick = () => dialog.close();
  // A click on the backdrop closes it; the dialog's own box is a child, so a click inside lands on a descendant.
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });

  let exportTimer = 0;
  const endExport = () => { exporting = null; clearTimeout(exportTimer); syncFile(); };
  fileButton.onclick = () => {
    if (fileButton.disabled || last === null) return;
    exporting = { world: last.world, id: nextExport++ };
    setFileNote("Asking the world for its file. It may run on to the next census first.", "busy");
    syncFile();
    send({ type: "sessionExport", world: exporting.world, id: exporting.id });
    // The worker answers with a file or a refusal; a failure elsewhere should not leave the button waiting for ever.
    exportTimer = window.setTimeout(() => { endExport(); setFileNote("The world hasn’t answered. Try again.", "refused"); }, 180_000);
  };

  return {
    onLoaded(manifest) {
      cfg = manifest.cfg;
      last = null;
      panelKey = cardKey = "";
      // A jump or a restore within the same history (its runId, or a fork of it) keeps the growing time and the offer.
      const root = historyRoot(manifest.runId);
      if (root !== history) { grownMs = 0; offered = false; }
      history = root;
      countedAt = null;
      endExport();
      resetFileNote();
      $("firsts-watch").hidden = true;
      $("firsts-empty").hidden = false;
      $("nextup-list").replaceChildren();
      $("nextup-done").hidden = true;
      $("nextup-heading").hidden = true;
      $("nextup-hint").hidden = true;
      $("firsts-list").replaceChildren();
      $("firsts-list").hidden = true;
      $("firsts-rules-body").replaceChildren();
      if (dialog.open) dialog.close();
      tick();
    },
    onFirsts(m) {
      last = m;
      paintPanel(m);
      paintOpenCard();
    },
    onSessionFile(m) {
      // A file for a request already given up on (or for a world since replaced) is not saved unasked.
      if (exporting === null || m.id !== exporting.id || m.world !== exporting.world) return;
      const url = URL.createObjectURL(new Blob([m.text], { type: "application/json" }));
      const a = el("a");
      a.href = url;
      a.download = m.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      let command: string | undefined;
      try { command = (JSON.parse(m.text) as { replay?: string }).replay; } catch { /* the file is still saved */ }
      endExport();
      setFileNote(`Saved ${m.name}. To replay it, run this from the repository root, with the file’s path after --picks-from:`, "saved", command);
    },
    onRefused(message, id) {
      // A refusal for a request given up on, or for another request than the one in flight, says nothing about this one.
      if (exporting === null || (id !== undefined && id !== exporting.id)) return;
      endExport();
      setFileNote(message, "refused");
    },
    setGrowing(g) {
      growing = g;
      tick();
    },
    setWaiting(w) {
      waiting = w;
      tick();
      syncFile();
    },
  };
}
