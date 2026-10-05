// The lineage inspector's lab panel (docs/lineage-inspector.md, section 3): a drawer over the evidence rail
// showing one lineage's replayed ancestry, its controller's response to light, and where to jump back to.
// Every number comes from the worker's LineageView; nothing here interprets it.
import { OUTPUTS, type LineageView, type LineageViewMutation } from "@bl/lineage";
import type { LineageMsg, ToWorker } from "./protocol.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;


function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}
const n = (v: number) => v.toLocaleString("en-US");

type Evidence = "exact" | "computed" | "context" | "not recorded";
/** "exact" is for what was observed or replayed; "computed" for what is derived from it on inputs the lineage never met. */
function chip(word: Evidence): HTMLElement {
  return el("span", word, `badge ${word === "exact" ? "ok" : word === "context" ? "busy" : word === "computed" ? "note" : ""}`.trim());
}

function heading(text: string, evidence?: Evidence): HTMLElement {
  const h = el("h3", text);
  if (evidence) h.append(chip(evidence));
  return h;
}

function effect(m: LineageViewMutation): string {
  // The class column already says what physics, clamped and probe-silent mean; only output moves need listing.
  if (m.expression !== "controller") return m.before === null ? "parent unknown" : "—";
  const moved = OUTPUTS.map((name, k) => ({ name, d: m.maxDelta![k] })).filter((o) => o.d > 0).sort((a, b) => b.d - a.d);
  return moved.slice(0, 2).map((o) => `${o.name} ${o.d}`).join(", ") + (moved.length > 2 ? ` +${moved.length - 2}` : "");
}

/**
 * Response to light, one small chart per output, laid out by CSS: the subject solid and the earliest ancestor
 * with a known genome dashed (omitted when that is the subject). Each chart's own range runs from 0 (or its
 * minimum) to its maximum, printed at its top right.
 */
function curves(view: LineageView): { grid: HTMLElement; earliest: string | null } | null {
  const first = view.chain.find((c) => c.probe !== null);
  const subject = view.chain[view.chain.length - 1];
  if (!first?.probe || !subject.probe) return null;
  const NS = "http://www.w3.org/2000/svg";
  const W = 120, H = 70;
  const rows = first === subject ? [subject.probe.lightCurve] : [first.probe.lightCurve, subject.probe.lightCurve];
  const grid = el("div", undefined, "curves");
  OUTPUTS.forEach((name, k) => {
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("role", "img");
    const vals = rows.flatMap((r) => r.map((p) => p[k + 1]));
    const lo = Math.min(0, ...vals), hi = Math.max(1, ...vals);
    svg.setAttribute("aria-label", `${name} against light, from ${lo} to ${hi}`);
    const x = (v: number) => 6 + (v / 120) * (W - 12), y = (v: number) => H - 8 - ((v - lo) / (hi - lo)) * (H - 24);
    const text = (tx: number, label: string, anchor: string) => {
      const t = document.createElementNS(NS, "text");
      t.setAttribute("x", String(tx));
      t.setAttribute("y", "12");
      t.setAttribute("text-anchor", anchor);
      t.setAttribute("class", "curve-label");
      t.textContent = label;
      svg.append(t);
    };
    text(6, name, "start");
    text(W - 6, String(hi), "end");
    const base = document.createElementNS(NS, "line");
    base.setAttribute("x1", "6");
    base.setAttribute("x2", String(W - 6));
    base.setAttribute("y1", y(lo).toFixed(1));
    base.setAttribute("y2", y(lo).toFixed(1));
    base.setAttribute("class", "curve-base");
    svg.append(base);
    rows.forEach((r, j) => {
      const line = document.createElementNS(NS, "polyline");
      line.setAttribute("points", r.map((p) => `${x(p[0]).toFixed(1)},${y(p[k + 1]).toFixed(1)}`).join(" "));
      line.setAttribute("class", j === rows.length - 1 ? "curve-subject" : "curve-root");
      svg.append(line);
    });
    grid.append(svg);
  });
  return { grid, earliest: first === subject ? null : first.key };
}

export interface LineagePanel {
  /** Opens the drawer on `key` and asks the worker for its view. */
  open(key: string): void;
  onLineage(m: LineageMsg): void;
  onHighlight(key: string | null): void;
  /** A world was adopted: keep the panel through a jump, close it otherwise. */
  onLoaded(): void;
  onError(): void;
}

export function createLineagePanel(send: (m: ToWorker) => void): LineagePanel {
  const drawer = $("lineage-drawer");
  const body = $("lineage-body");
  const status = $("lineage-status");
  const title = $("lineage-heading");
  let key: string | null = null;
  let highlighted: string | null = null;
  let jumping = false;
  let opener: HTMLElement | null = null;

  const close = () => {
    drawer.hidden = true;
    key = null;
    opener?.focus();
  };
  $("lineage-close").onclick = close;
  drawer.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  const syncHighlight = () => {
    for (const b of body.querySelectorAll<HTMLButtonElement>("button[data-highlight]")) {
      const on = b.dataset.highlight === highlighted;
      b.setAttribute("aria-pressed", String(on));
      b.textContent = on ? "Highlighted on field" : "Highlight on field";
    }
    $("lineage-highlight-state").textContent = highlighted ? `Field highlight: ${highlighted}` : "";
  };
  const setHighlight = (k: string | null) => {
    highlighted = k;
    send({ type: "highlight", key: k });
    syncHighlight();
  };
  $("lineage-clear-highlight").onclick = () => setHighlight(null);

  function render(m: LineageMsg) {
    const v = m.view;
    const subject = v.chain[v.chain.length - 1];
    const root = v.chain[0];
    const o = v.origin;
    title.textContent = `Lineage ${v.subject}`;
    status.textContent = v.censusStep === null ? "" : `Census at t = ${n(v.censusStep)}. Ancestry replayed exactly from the mutation ledger.`;

    const summary = el("section");
    summary.append(heading("Subject", "exact"));
    const dl = el("dl", undefined, "kv mono");
    const rows: [string, string][] = [
      ["Origin", "founder" in o ? `founder ${o.founder}` : `minted t = ${n(o.minted)}, cell (${o.x}, ${o.y})`],
      [`Cells at t = ${v.censusStep === null ? "—" : n(v.censusStep)}`, `${n(v.cells)} (${(100 * v.share).toFixed(1)}%)`],
      ["Depth", `${v.mutations.length} mutation${v.mutations.length === 1 ? "" : "s"} from ${root.key}`],
      ["Root genome", root.genomeFrom ?? "unknown"],
      ["Subject genome", subject.checkedBy.length ? `${subject.genomeFrom}, matches ${subject.checkedBy.join(", ")}` : (subject.genomeFrom ?? "unknown")],
      ["Descendants", `${n(v.descendants)} (${n(v.cladeCells)} cells in the clade)`],
      ["μ, σ, motility gain", subject.mu === null ? "unknown" : `${subject.mu}, ${subject.sigma}, ${subject.motGain}`],
    ];
    for (const [k, val] of rows) dl.append(el("dt", k), el("dd", val));
    const hl = el("button", "Highlight on field");
    hl.type = "button";
    hl.dataset.highlight = v.subject;
    hl.onclick = () => setHighlight(highlighted === v.subject ? null : v.subject);
    const actions = el("div", undefined, "row lineage-actions");
    actions.append(hl);
    summary.append(dl, actions);

    const strategy = el("section");
    strategy.append(heading("Response to light", "computed"));
    const drawn = curves(v);
    if (drawn) {
      const who = drawn.earliest ? `Solid: ${subject.key}. Dashed: ${drawn.earliest}, its earliest ancestor with a known genome.` : `Line: ${subject.key}.`;
      strategy.append(drawn.grid, el("p", `Controller output against light (0 to 120), other sensors fixed, computed from the genomes. ${who} Each chart runs from 0 to the value at its top right.`, "hint"));
    } else strategy.append(el("p", "No genome on this ancestry is known exactly.", "hint"));

    const ancestry = el("section");
    ancestry.append(heading("Ancestry and mutations", "exact"));
    const table = el("table", undefined, "lineage-table");
    const head = el("tr");
    for (const h of ["lineage", "minted", "mutation", "expression", "outputs moved", "cells", "children", ""]) head.append(el("th", h));
    table.append(el("thead"));
    table.tHead!.append(head);
    const tbody = el("tbody");
    const now = v.censusStep ?? Infinity;
    v.chain.forEach((c, i) => {
      const mu = i > 0 ? v.mutations[i - 1] : null;
      const tr = el("tr");
      // A drawn marker (shape differs by class) and the class's name, so colour never carries the class alone.
      const cls = mu ? (mu.expression ?? "unknown") : "root";
      const exprCell = el("td", undefined, `expr expr-${cls}`);
      const mark = el("span", undefined, "expr-mark");
      mark.setAttribute("aria-hidden", "true");
      exprCell.append(mark, document.createTextNode(cls));
      tr.append(
        el("td", c.key),
        el("td", c.minted === null ? "founder" : n(c.minted)),
        el("td", mu ? `${mu.locus} ${mu.before === null ? "?" : `${mu.before} → ${mu.after}`}` : "—"),
        exprCell,
        el("td", mu ? effect(mu) : "—"),
        el("td", n(c.cells)),
        el("td", n(c.children)),
      );
      // Jump to just after the minting step, where the lineage first exists.
      const target = c.minted === null ? null : c.minted + 1;
      const from = target === null ? undefined : [...m.checkpoints].reverse().find((s) => s <= target);
      const jumpCell = el("td");
      if (target !== null && target < now && from !== undefined) {
        const b = el("button", "Jump");
        b.type = "button";
        b.title = `Save the present, restore the checkpoint at t = ${n(from)} and advance to t = ${n(target)}; highlights ${c.key}`;
        b.onclick = () => {
          jumping = true;
          status.textContent = `Jumping to t = ${n(target)}…`;
          send({ type: "jump", step: target, key: c.key });
        };
        jumpCell.append(b);
      }
      tr.append(jumpCell);
      tbody.append(tr);
    });
    table.append(tbody);
    const tw = el("div", undefined, "lineage-table-wrap");
    tw.append(table);
    ancestry.append(
      tw,
      el("p", "Expression is measured on a fixed grid of sensor values, not the inputs the lineage met; outputs moved lists each output's largest change on that grid. Jump restores the latest checkpoint at or before a row's minting and replays forward; lesions made after that checkpoint are not re-applied.", "hint"),
    );

    const gaps = el("section");
    gaps.append(heading("Not recorded", "not recorded"));
    const ul = el("ul", undefined, "lineage-gaps");
    for (const g of [
      ...v.gaps,
      "Tracker births are not kept across checkpoints in the lab: descent here is genotype descent from the mutation ledger.",
      "Per-lineage energy, mass history and experienced environment are not observed.",
    ])
      ul.append(el("li", g));
    gaps.append(ul);

    body.replaceChildren(summary, strategy, ancestry, gaps);
    syncHighlight();
  }

  return {
    open(k: string) {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      key = k;
      drawer.hidden = false;
      title.textContent = `Lineage ${k}`;
      status.textContent = "Settling at the next census and replaying the ancestry…";
      body.replaceChildren();
      send({ type: "lineage", key: k });
      title.focus();
    },
    onLineage(m) {
      // Only the lineage this panel last asked for.
      if (key === null || m.view.subject !== key) return;
      render(m);
    },
    onHighlight(k) {
      highlighted = k;
      syncHighlight();
    },
    onLoaded() {
      if (jumping) {
        jumping = false;
        status.textContent = "Restored a checkpoint; this panel still shows the lineage as inspected before the jump.";
        return;
      }
      highlighted = null;
      syncHighlight();
      if (!drawer.hidden) close();
    },
    onError() {
      if (!drawer.hidden && !body.childElementCount) status.textContent = "Could not inspect this lineage; see the message above.";
      jumping = false;
    },
  };
}
