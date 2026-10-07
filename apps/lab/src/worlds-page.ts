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

const openInLab = (p: Preset) => {
  const a = document.createElement("a");
  a.className = "button primary";
  a.href = `/lab/?world=${encodeURIComponent(p.id)}`;
  a.textContent = "Open in the lab →";
  return a;
};
const grid = (ids: string[], picks?: Map<string, string>) => {
  const g = document.createElement("div");
  g.className = "world-grid";
  for (const id of ids) {
    const p = byId(id);
    if (p) g.append(worldCard(p, { action: openInLab, level: "h3", pick: picks?.get(id) }));
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
