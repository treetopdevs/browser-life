// Renders the ladder (ladder.ts) and the counts of how the garden was made into the HTML kept between GENERATED
// markers on /story/. Pure string functions, used by experiments/render.ts, so the sync test covers them.
import { ENTRIES } from "../experiments/ledger.ts";
import { HERE, LADDER_WORLD, MADE, REACHES, RUNGS, type RungState } from "./ladder.ts";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The chip for a rung: grey for seen and for not yet (neither is a measurement), sun for the one being built. */
const RUNG_CHIP: Record<RungState, string> = { Seen: "pending", "A first version": "measured", "Not yet": "pending" };

/** The rungs, bottom first, in the world we are working in now. */
export function renderLadder(pad = "          "): string {
  const rows = RUNGS.map((r) => {
    const held = r.n < HERE;
    const cls = ["rung", held ? "held" : "", r.n === HERE ? "here" : ""].filter(Boolean).join(" ");
    const chip = r.state === "Seen" ? `Seen · ${LADDER_WORLD.seeds}` : r.state;
    return [
      `${pad}  <li class="${cls}">`,
      `${pad}    <span class="rung-rail" aria-hidden="true"></span>`,
      `${pad}    <span class="rung-n" aria-hidden="true">${r.n}</span>`,
      `${pad}    <div class="rung-body">`,
      `${pad}      <div class="rung-head"><strong>${esc(r.name)}</strong><span class="state ${RUNG_CHIP[r.state]}">${esc(chip)}</span>${r.n === HERE ? `<span class="rung-here">We are here</span>` : ""}</div>`,
      `${pad}      <p class="rung-means">${esc(r.means)}</p>`,
      `${pad}      <p>${esc(r.stands)}</p>`,
      `${pad}    </div>`,
      `${pad}  </li>`,
    ].join("\n");
  });
  return [
    `${pad}<ol class="ladder-list">`,
    ...rows,
    `${pad}</ol>`,
    `${pad}<p class="ladder-note">The rungs as they stand in ${esc(LADDER_WORLD.name)}, the world we are working in, on ${esc(LADDER_WORLD.asOf)}. “Seen” means watched on ${esc(LADDER_WORLD.seeds)}, the ones every setting was tuned on. Nothing on this ladder has been confirmed on seeds we have not looked at.</p>`,
  ].join("\n");
}

/** Each world we tried, with the rung it stopped on drawn as pips and said in words. */
export function renderReach(pad = "          "): string {
  const top = RUNGS.length;
  const rows = REACHES.map((w) => {
    const pips = RUNGS.map((r) => `<i${r.n < w.rung ? ` class="on"` : r.n === w.rung ? ` class="at"` : ""}></i>`).join("");
    const name = w.href ? `<a href="${w.href}">${esc(w.world)}</a>` : `<strong>${esc(w.world)}</strong>`;
    const words = w.now ? `on rung ${w.rung} of ${top}` : `stopped on rung ${w.rung} of ${top}`;
    return [
      `${pad}  <li>`,
      `${pad}    <div class="reach-world">${name}<span class="reach-when">${esc(w.when)}</span><span class="reach-rung"><span class="pips" aria-hidden="true">${pips}</span>${words}</span></div>`,
      `${pad}    <div class="reach-what"><p><b>Had:</b> ${esc(w.had)}</p><p><b>${w.now ? "Now" : "Stopped"}:</b> ${esc(w.stopped)}</p></div>`,
      `${pad}  </li>`,
    ].join("\n");
  });
  return [`${pad}<ul class="reach" role="list">`, ...rows, `${pad}</ul>`].join("\n");
}

/** How much work this has been, counted from the ledger and from dated figures in ladder.ts. */
export function renderCounts(pad = "          "): string {
  const n = (label: string) => ENTRIES.filter((e) => e.label === label).length;
  const cannotTell = n("Open") + n("Unclear") + n("Not yet measured");
  const items: [string, string][] = [
    [String(MADE.days), `days since the first commit, on ${MADE.first}`],
    [MADE.commits.toLocaleString("en-GB"), `commits on the main branch by ${MADE.asOf}`],
    [String(ENTRIES.length), "results written up in the journal"],
    [String(n("Confirmed")), "of them confirmed, with rules frozen before the data"],
    [String(n("Negative")), "came back a plain no"],
    [String(cannotTell), "could not tell, or have not run"],
  ];
  return [`${pad}<ul class="counts" role="list">`, ...items.map(([b, t]) => `${pad}  <li><b>${esc(b)}</b>${esc(t)}</li>`), `${pad}</ul>`].join("\n");
}
