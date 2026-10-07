// The Worlds page: every starting world, family by family, built from the same catalogue the lab's picker uses.
import "./theme.ts";
import { PRESETS, type Preset } from "@bl/schema";
import { FAMILIES, START_HERE, byId } from "./worlds.ts";
import { familyHeader, startHereHeader, worldCard } from "./worlds-ui.ts";

const root = document.getElementById("worlds-root")!;
const count = document.getElementById("worlds-count");
if (count) count.textContent = String(PRESETS.length);
const questions = document.getElementById("worlds-questions");
const words = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
if (questions) questions.textContent = words[FAMILIES.length] ?? String(FAMILIES.length);

// A link can name a world (/worlds/?world=<id>): the page opens on its card, ringed, and a shared link previews as
// that world (the build writes a copy of this page per world, deploy/Caddyfile serves it).
const linked = byId(new URLSearchParams(location.search).get("world"))?.id ?? null;
const worldHref = (id: string) => `/worlds/?world=${encodeURIComponent(id)}`;

/** One polite live region for the page, so what a Copy link did is heard as well as seen. */
const announcer = Object.assign(document.createElement("p"), { className: "visually-hidden" });
announcer.setAttribute("role", "status");
document.body.append(announcer);

/**
 * Copies the address that names this world, and says so on the button and to a screen reader; if the clipboard
 * refuses, says where the link is instead. The button's name stays "Copy link to <world>" whatever it shows.
 */
const copyLink = (p: Preset) => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "button quiet copy-link";
  const label = document.createElement("span");
  label.textContent = "Copy link";
  b.append(label);
  b.setAttribute("aria-label", `Copy link to ${p.name}`);
  let reset = 0;
  b.addEventListener("click", async () => {
    const url = new URL(worldHref(p.id), location.origin).href;
    let said: string;
    try {
      await navigator.clipboard.writeText(url);
      label.textContent = "Link copied";
      said = `Link to ${p.name} copied.`;
    } catch {
      label.textContent = "Could not copy: the world's name is the link";
      said = `Could not copy the link to ${p.name}. The world's name is the link.`;
    }
    announcer.textContent = said;
    clearTimeout(reset);
    reset = window.setTimeout(() => { label.textContent = "Copy link"; }, 2400);
  });
  return b;
};
const actions = (p: Preset) => {
  const span = document.createElement("span");
  span.className = "world-actions";
  const a = document.createElement("a");
  a.className = "button primary";
  a.href = `/lab/?world=${encodeURIComponent(p.id)}`;
  a.textContent = "Open in the lab →";
  span.append(a, copyLink(p));
  return span;
};
/** Start here repeats some worlds; each world's own address (its element id and the ring) is on its family's copy. */
const grid = (ids: string[], picks?: Map<string, string>) => {
  const g = document.createElement("div");
  g.className = "world-grid";
  for (const id of ids) {
    const p = byId(id);
    if (!p) continue;
    const card = worldCard(p, { action: actions, level: "h3", pick: picks?.get(id), href: worldHref(id), linked: !picks && id === linked });
    if (!picks) card.id = `world-${id}`;
    g.append(card);
  }
  return g;
};

const jump = document.getElementById("worlds-jump");
if (jump) {
  for (const f of [{ id: "start-here", name: "Start here" }, ...FAMILIES]) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = `#${f.id}`;
    a.textContent = f.name;
    li.append(a);
    jump.append(li);
  }
}

const start = document.createElement("section");
start.className = "shell family start-here";
start.id = "start-here";
start.append(startHereHeader("h2"), grid(START_HERE.map((s) => s.id), new Map(START_HERE.map((s) => [s.id, s.why]))));
root.append(start);
for (const f of FAMILIES) {
  const section = document.createElement("section");
  section.className = "shell family";
  section.id = f.id;
  section.append(familyHeader(f, "h2"), grid(f.ids));
  root.append(section);
}

// After load, so the browser's own scroll placement for a fresh page does not undo it; a jump, not the smooth
// scroll the site uses for its own anchors, since arriving should not mean watching the page go by.
// The sticky header wraps onto more lines on narrow screens, so the card clears it as it stands, not a fixed guess.
const toLinked = () => requestAnimationFrame(() => {
  const card = document.getElementById(`world-${linked}`);
  if (!card) return;
  card.style.scrollMarginTop = `${(document.querySelector(".site-header")?.getBoundingClientRect().height ?? 0) + 16}px`;
  card.scrollIntoView({ block: "start", behavior: "instant" });
});
if (linked) {
  if (document.readyState === "complete") toLinked();
  else window.addEventListener("load", toLinked, { once: true });
}
