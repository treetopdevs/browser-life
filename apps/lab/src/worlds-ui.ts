/**
 * The world catalogue on screen: trait chips and cards built from `worlds.ts`, the summary under the lab's
 * Starting world select, and the picker dialog the lab opens over the bench. The site's Worlds page uses the
 * same cards with a link where the lab has a Choose button, so the two can never disagree about a world.
 */
import { PRESETS, type Preset } from "@bl/schema";
import { FAMILIES, LEVER_NAMES, SEEN_LABELS, SEEN_TONE, START_HERE, STATUS_LABELS, byId, familyOf, noteOf, worldDiff, worldStatus, worldTraits, type Family } from "./worlds.ts";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** Registered, base world or sandbox, with the meaning in the tooltip. */
export function statusChip(id: string): HTMLSpanElement {
  const status = worldStatus(id);
  const [label, meaning] = STATUS_LABELS[status];
  const chip = el("span", `world-status ${status}`, label);
  chip.title = meaning;
  return chip;
}

/** What has been seen so far, in the journal's colours: green only for a confirmed result. */
export function seenChip(id: string): HTMLSpanElement | null {
  const note = noteOf(id);
  if (!note) return null;
  return el("span", `world-state ${SEEN_TONE[note.seen.state]}`, SEEN_LABELS[note.seen.state]);
}

/** The traits as chips, the numbers in each chip's tooltip. */
export function traitChips(p: Preset, max = Infinity): HTMLUListElement {
  const ul = el("ul", "traits");
  ul.setAttribute("aria-label", "What this world is");
  for (const t of worldTraits(p).slice(0, max)) {
    const li = el("li");
    li.append(el("span", "lever", LEVER_NAMES[t.lever]), ` ${t.label}`);
    if (t.detail) li.title = t.detail;
    ul.append(li);
  }
  return ul;
}

/** The traits in full, lever by lever, with the numbers under each. */
export function traitTable(p: Preset): HTMLDListElement {
  const dl = el("dl", "trait-table");
  for (const t of worldTraits(p)) {
    dl.append(el("dt", undefined, LEVER_NAMES[t.lever]));
    const dd = el("dd", undefined, t.label);
    if (t.detail) dd.append(el("small", undefined, t.detail));
    dl.append(dd);
  }
  return dl;
}

/** "Like <base>, except …", computed from the two configs; null when the world has no base or differs in nothing. */
export function diffLine(p: Preset): HTMLParagraphElement | null {
  const base = byId(noteOf(p.id)?.base);
  if (!base) return null;
  const { added, changed, removed } = worldDiff(p, base);
  // Labels start a chip with a capital; in a sentence they run on in lower case (none names a proper noun).
  const lower = (label: string) => label[0].toLowerCase() + label.slice(1);
  const parts = [
    ...added.map((t) => lower(t.label)),
    ...changed.map(({ trait }) => `${lower(trait.label)}${trait.detail ? ` (${trait.detail})` : ""}`),
    ...removed.map((t) => `no ${lower(t.label).replace(/^(a|an|the) /, "")}`),
  ];
  if (!parts.length) return null;
  const line = el("p", "world-diff");
  line.append("Like ", el("b", undefined, base.name), `, except: ${parts.join("; ")}.`);
  return line;
}

export interface CardOptions {
  /** The card's action: a Choose button in the lab, a link on the site. */
  action: (p: Preset) => HTMLElement;
  /** Heading level for the world's name. */
  level?: "h3" | "h4";
  /** The world on screen in the lab, marked on its card. */
  onScreen?: string | null;
  /** A Start-here reason, shown on the card when given. */
  pick?: string;
}

/** One world: what it asks, what it is, how it differs from its base, what to look for, what has been seen, and the technical note. */
export function worldCard(p: Preset, opts: CardOptions): HTMLElement {
  const note = noteOf(p.id);
  const card = el("article", "world-card");
  card.dataset.id = p.id;
  if (opts.onScreen === p.id) card.classList.add("current");
  const head = el("div", "world-card-head");
  head.append(el(opts.level ?? "h4", undefined, p.name), statusChip(p.id));
  const seen = seenChip(p.id);
  if (seen) head.append(seen);
  card.append(head);
  if (opts.pick) card.append(el("p", "world-pick", opts.pick));
  if (note) card.append(el("p", "world-asks", note.asks));
  card.append(traitTable(p));
  const diff = diffLine(p);
  if (diff) card.append(diff);
  if (note) {
    const look = el("p", "world-look");
    look.append(el("b", undefined, "Look for "), note.look);
    const seenLine = el("p", "world-seen");
    seenLine.append(el("b", undefined, "So far "), note.seen.text);
    card.append(look, seenLine);
  }
  const details = el("details");
  details.append(el("summary", undefined, "For researchers: the technical description"), el("p", undefined, p.description));
  card.append(details);
  const foot = el("div", "world-card-foot");
  foot.append(opts.action(p));
  if (opts.onScreen === p.id) foot.append(el("span", "on-screen", "On screen now"));
  card.append(foot);
  return card;
}

/** A family's name, the property it plays with, why, and where it stands. */
export function familyHeader(f: Family, level: "h2" | "h3" = "h3"): HTMLElement {
  const head = el("header", "family-head");
  const lever = el("p", "family-lever");
  lever.append(el("span", undefined, "Plays with"), ` ${f.lever}`);
  const seen = el("p", "family-seen");
  seen.append(el("b", undefined, "So far "), f.seen);
  head.append(lever, el(level, undefined, f.name), el("p", undefined, f.why), seen);
  return head;
}

/** The Start-here list as a family-like header. */
export function startHereHeader(level: "h2" | "h3" = "h3"): HTMLElement {
  const head = el("header", "family-head");
  const lever = el("p", "family-lever");
  lever.append(el("span", undefined, "Start here"), ` five worlds, and why`);
  head.append(lever, el(level, undefined, "Where to begin"), el("p", undefined, "Every jar shares one chemistry. What changes between worlds is how the light falls, who is planted, how the jar is divided, and in the sandboxes a rule or two. These five show the range. Pick one, press Play, and press 2 for the Lineages view to see who is who."));
  return head;
}

/** Under the lab's Starting world select: the question, every trait as a chip, and whether it is registered. */
export function describeWorld(p: Preset | undefined, host: HTMLElement): void {
  host.replaceChildren();
  if (!p) return;
  const note = noteOf(p.id);
  if (note) host.append(el("p", "world-asks", note.asks));
  host.append(traitChips(p));
  const status = el("p", "preset-status");
  status.append(statusChip(p.id));
  const seen = seenChip(p.id);
  if (seen) status.append(seen);
  host.append(status);
}

export interface PickerState {
  /** The world chosen in the select. */
  chosen: string | null;
  /** The world on screen, if one is planted. */
  onScreen: string | null;
}

/** The lab's catalogue dialog. `onChoose` receives the id picked; the dialog closes itself. */
export function createWorldPicker(dialog: HTMLDialogElement, onChoose: (id: string) => void) {
  const nav = dialog.querySelector<HTMLElement>(".worlds-nav")!;
  const main = dialog.querySelector<HTMLElement>(".worlds-main")!;
  const closeButton = dialog.querySelector<HTMLButtonElement>(".worlds-close")!;
  let state: PickerState = { chosen: null, onScreen: null };

  const chooseButton = (p: Preset) => {
    const b = el("button", undefined, p.id === state.chosen ? "Chosen" : "Choose this world");
    b.type = "button";
    if (p.id === state.chosen) b.disabled = true;
    else {
      b.classList.add("primary");
      b.onclick = () => { dialog.close(); onChoose(p.id); };
    }
    return b;
  };

  const cards = (ids: string[], picks?: Map<string, string>) => {
    const grid = el("div", "world-grid");
    for (const id of ids) {
      const p = byId(id);
      if (p) grid.append(worldCard(p, { action: chooseButton, onScreen: state.onScreen, pick: picks?.get(id) }));
    }
    return grid;
  };

  /** Shows one family; `focusHeading` (a nav click) moves focus to its heading, so the change is announced and read from the top. */
  function show(id: string, focusHeading = false) {
    for (const b of nav.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.family === id));
    main.replaceChildren();
    if (id === "start") {
      main.append(startHereHeader(), cards(START_HERE.map((s) => s.id), new Map(START_HERE.map((s) => [s.id, s.why]))));
    } else {
      const f = FAMILIES.find((x) => x.id === id);
      if (f) main.append(familyHeader(f), cards(f.ids));
      else main.append(familyHeader({ id: "other", name: "Other worlds", lever: "whatever they were built for", why: "Worlds not yet placed in a family.", seen: "", ids: [] }), cards(PRESETS.filter((p) => !familyOf(p.id)).map((p) => p.id)));
    }
    main.scrollTop = 0;
    const heading = main.querySelector<HTMLElement>(".family-head h3");
    if (heading) {
      heading.tabIndex = -1;
      if (focusHeading) heading.focus({ preventScroll: true });
    }
  }

  const navButton = (id: string, name: string, sub: string) => {
    const b = el("button");
    b.type = "button";
    b.dataset.family = id;
    b.setAttribute("aria-pressed", "false");
    b.append(name, el("small", undefined, sub));
    b.onclick = () => show(id, true);
    return b;
  };
  nav.replaceChildren(navButton("start", "Start here", "five picks"));
  for (const f of FAMILIES) nav.append(navButton(f.id, f.name, `${f.ids.length} worlds · ${f.lever}`));
  const orphans = PRESETS.filter((p) => !familyOf(p.id));
  if (orphans.length) nav.append(navButton("other", "Other worlds", `${orphans.length} worlds`));

  closeButton.onclick = () => dialog.close();
  // A click on the backdrop closes it; the dialog's own box is a child, so a click inside lands on a descendant.
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });

  return {
    open(next: PickerState) {
      state = next;
      const home = (next.chosen && familyOf(next.chosen)?.id) ?? "start";
      show(home);
      dialog.showModal();
      const current = next.chosen ? main.querySelector<HTMLElement>(`.world-card[data-id="${CSS.escape(next.chosen)}"]`) : null;
      current?.scrollIntoView({ block: "start" });
      dialog.querySelector<HTMLElement>("h2")?.focus();
    },
  };
}
