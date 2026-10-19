// Field notes: the naturalist in the lab (docs/naturalist-field-notes-v0-2026-10-18.md). The DOM side of naturalist.ts: fetches a
// preset's published baseline when the model asks (once, when a matching world is loaded; again on a later matching world if it
// failed), checks it (header against the lab's fixed rule, size, SHA-256), and draws the model's view, coalesced to one draw per
// frame. Nothing here decides a ring. Beside each note it draws the proposer's suggestion (naturalist-suggest.ts, loaded when the
// first note is filed; docs/naturalist-lab-suggestions-v0-2026-10-18.md); its Try it here button is the only path from a suggestion
// to the world, and only a person's click on it takes that path.
import type { NaturalistMsg, RunManifest } from "./protocol.ts";
import { NaturalistModel, type Asset, type HandEntry, type NaturalistView, type NoteView, type Standing, type SuggestionView } from "./naturalist.ts";
import { NATURALIST_BASELINES, decodeEnvelope, headerProblem, type EnvelopeHeader } from "./naturalist-score.ts";

/** Where the baselines are served (apps/lab/public/naturalist/), under the build's base URL (Vite serves public/ there). */
export const assetRoot = (base: string | undefined): string => `${base ? (base.endsWith("/") ? base : `${base}/`) : "/"}naturalist/`;
/** The baselines' root under this build's base URL, read when asked (so a test can set the base). */
export const assetRootNow = (): string => assetRoot(import.meta.env?.BASE_URL);

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Fetches and checks one preset's baseline. Never throws: a failure is an Asset saying why. The header is revalidated with the
 * server on every fetch; the numbers are asked for by their SHA-256 (a query the static server ignores), so a rebuilt baseline is
 * never read from a cached older file under the same name.
 */
export async function fetchBaseline(preset: string, get: typeof fetch = fetch, subtle: SubtleCrypto | null = globalThis.crypto?.subtle ?? null, root: string = assetRootNow()): Promise<Asset> {
  const spec = NATURALIST_BASELINES[preset];
  if (!spec) return { kind: "failed", reason: `no baseline is published for ${preset}` };
  // crypto.subtle exists only in a secure context (https, or localhost): without it the numbers cannot be checked, so they are not read.
  if (!subtle) return { kind: "failed", reason: "this page is not served over a secure connection, so the browser cannot check the baseline’s SHA-256" };
  try {
    const hr = await get(`${root}${spec.file}.json`, { cache: "no-cache" });
    if (!hr.ok) return { kind: "failed", reason: `its header answered ${hr.status}` };
    const header = (await hr.json()) as EnvelopeHeader;
    const problem = headerProblem(header, preset, spec);
    if (problem) return { kind: "failed", reason: problem };
    if (!/^[\w.-]+\.bin$/.test(header.bin.file) || !/^[0-9a-f]{64}$/.test(header.bin.sha256)) return { kind: "failed", reason: "its header names an odd file" };
    const br = await get(`${root}${header.bin.file}?sha256=${header.bin.sha256}`);
    if (!br.ok) return { kind: "failed", reason: `its numbers answered ${br.status}` };
    const buf = await br.arrayBuffer();
    if (buf.byteLength !== header.bin.bytes) return { kind: "failed", reason: `its numbers are ${buf.byteLength} bytes, the header says ${header.bin.bytes}` };
    const sha = hex(await subtle.digest("SHA-256", buf));
    if (sha !== header.bin.sha256) return { kind: "failed", reason: "its numbers do not match the SHA-256 in its header" };
    return { kind: "ready", header, data: decodeEnvelope(new Uint8Array(buf)) };
  } catch (e) {
    return { kind: "failed", reason: `it could not be fetched or read (${e instanceof Error ? e.message : String(e)})` };
  }
}

const CHIP_CLASS: Record<string, string> = { Measured: "badge chip-measured", Unclear: "badge", "Not yet measured": "badge" };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
const chip = (c: string) => el("span", CHIP_CLASS[c] ?? "badge", c);

const standingLine = (s: Standing) => {
  const p = el("p", "naturalist-suggestion-line");
  if (s.chip) p.append(chip(s.chip), " ");
  p.append(s.text);
  return p;
};
const pre = (lines: string[]) => el("pre", "mono naturalist-command", lines.join("\n"));

/** A note's suggestion, built once per suggestion; its offer (the button, or why not) is the part redrawn in place. */
function suggestionBlock(sv: SuggestionView): { box: HTMLElement; offer: HTMLElement | null; same: HTMLElement | null } {
  const box = el("div", "naturalist-suggestion");
  if (sv.kind !== "ready") {
    box.dataset.state = sv.kind;
    box.append(el("p", "hint", sv.text));
    return { box, offer: null, same: null };
  }
  const s = sv.s;
  box.dataset.action = s.action;
  box.append(el("p", "naturalist-suggestion-head", "The proposer’s suggestion"), el("p", "naturalist-suggestion-facts", s.facts), el("p", "hint naturalist-suggestion-reason", s.reason));
  const pred = el("p", "naturalist-suggestion-line naturalist-prediction");
  pred.append(chip("Not yet measured"), " ", el("span", undefined, `Prediction, for the offline fork: ${s.prediction.statement}`));
  box.append(pred);
  const same = el("p", "hint naturalist-same");
  box.append(same, standingLine(sv.bench));
  if (s.tryLabel && !s.refused) box.append(el("p", "hint naturalist-before", sv.before));
  // The offer persists while its lines and button are redrawn, so it is the live region (what a click led to is announced) and
  // where focus goes after a click removes the button.
  const offer = el("div", "naturalist-offer");
  offer.setAttribute("role", "status");
  offer.tabIndex = -1;
  box.append(offer);
  const cmds = el("details", "firsts-rules naturalist-commands");
  cmds.append(
    el("summary", undefined, "Run it offline"),
    el("p", undefined, "This page runs nothing. From the repository root, a person could run these. Everything they write stays under naturalist-lab/, outside runs/: each command writes under its own --out, except approve, which rewrites the proposal file in place."),
    el("p", undefined, s.action === "control" ? "1. The source, and a second run of it (the replay control):" : "1. The source, and the fork with the suggested intervention:"),
    pre([s.source.line, s.fork.line]),
    el("p", "hint", "The prediction is decided between those two bundles, never on the world on screen. No command decides it in v0; predictionHolds in tools/lib/propose.ts is the function the bench will call."),
    el("p", undefined, `2. Through the proposer. tools/notebook.ts reads only a run as long as the bell corpus’s, ${s.proposerSource.spec.steps.toLocaleString("en-US")} steps, and needs that corpus under --base (runs/ in the main checkout), so this path starts with a source that long:`),
    el("p", "hint", s.proposerCaveat),
    pre([s.proposerSource.line, ...s.proposerCommands]),
    el("p", "hint", "Only a person approves: approve takes your name, never an agent’s. propose prints the proposal’s file name, which <id> stands for."),
    el("p", "hint", `Everything runs on your own machine. The tools/run.ts lines and propose.ts run are GPU runs (the long source alone is ${s.proposerSource.spec.steps.toLocaleString("en-US")} steps); tools/notebook.ts reads the bundle on the CPU, and propose and approve only check and write files. Their --out directories are under naturalist-lab/ at the repository root, which git does not ignore: delete them, or keep them out of commits.`),
    ...s.caveats.map((c) => el("p", "hint", c)),
  );
  box.append(cmds);
  return { box, offer, same };
}

interface Drawn {
  li: HTMLLIElement;
  stretch: HTMLElement;
  filed: HTMLElement;
  sugKey: string;
  sug: HTMLElement;
  offer: HTMLElement | null;
  offerKey: string;
  same: HTMLElement | null;
}

export function createNaturalistPanel(opts: { fetch?: typeof fetch; apply?: (entries: HandEntry[], world: number) => void; loading?: () => boolean } = {}) {
  const root = document.getElementById("naturalist");
  const $ = (id: string) => document.getElementById(id);
  // The model asks once per preset, and again only after a failure (NaturalistModel.onLoaded).
  const model = new NaturalistModel(
    (preset) => {
      void fetchBaseline(preset, opts.fetch ?? fetch).then((asset) => {
        model.setAsset(preset, asset);
        schedule();
      });
    },
    { apply: opts.apply, loading: opts.loading },
  );
  let pending = false;
  let staticKey = "", hedgeKey = "";
  let suggesterAsked = false;
  const drawn = new Map<string, Drawn>();
  // One listener for every note's button: a click names its note, and the model checks everything again before applying.
  $("naturalist-notes")?.addEventListener("click", (ev) => {
    const b = (ev.target as Element | null)?.closest?.<HTMLButtonElement>("button[data-try]");
    if (!b || b.disabled) return;
    b.disabled = true;
    // The redraw replaces the button with what happened: focus moves to the offer, not to the page's body.
    b.closest<HTMLElement>(".naturalist-offer")?.focus();
    model.tryHere(b.dataset.try!);
    schedule();
  });
  /** The proposer's rules, asked for when the first note is filed (they bring the runner's validators with them). */
  const askSuggester = () => {
    if (suggesterAsked) return;
    suggesterAsked = true;
    import("./naturalist-suggest.ts").then(
      (mod) => {
        model.setSuggester(mod.suggestFor);
        schedule();
      },
      (e) => {
        model.setSuggester({ failed: e instanceof Error ? e.message : String(e) });
        schedule();
      },
    );
  };

  function drawOffer(d: Drawn, n: NoteView) {
    const sv = n.suggestion;
    if (!d.offer || sv?.kind !== "ready") return;
    const key = JSON.stringify(sv.offer);
    if (key === d.offerKey) return;
    d.offerKey = key;
    d.li.dataset.offer = sv.offer.state;
    const parts: Node[] = sv.offer.lines.map((t) => el("p", "hint naturalist-offer-line", t));
    if (sv.offer.button) {
      const b = el("button", "naturalist-try", sv.offer.button);
      b.type = "button";
      b.dataset.try = n.key;
      parts.push(b);
    }
    d.offer.replaceChildren(...parts);
  }

  function drawNote(n: NoteView): HTMLLIElement {
    let d = drawn.get(n.key);
    if (!d) {
      const li = el("li", "naturalist-note");
      li.dataset.signal = n.signal;
      li.dataset.side = n.side;
      const head = el("div", "naturalist-note-head");
      head.append(el("b", "naturalist-note-label", n.label), ...n.chips.map(chip));
      const stretch = el("p", "hint naturalist-stretch");
      const filed = el("p", "hint naturalist-filed");
      li.append(head, el("p", "naturalist-sentence", n.sentence), stretch, el("p", "mono small naturalist-receipt", n.receiptLine), filed);
      d = { li, stretch, filed, sugKey: "", sug: el("div"), offer: null, offerKey: "", same: null };
      li.append(d.sug);
      drawn.set(n.key, d);
    }
    if (d.stretch.textContent !== n.stretch) d.stretch.textContent = n.stretch;
    const filed = n.filedBefore !== null ? `Filed before the world was changed by hand at step ${n.filedBefore.toLocaleString("en-US")}.` : "";
    d.filed.hidden = !filed;
    if (d.filed.textContent !== filed) d.filed.textContent = filed;
    const sk = !n.suggestion ? "none" : n.suggestion.kind === "ready" ? `ready:${n.suggestion.s.key}` : `${n.suggestion.kind}:${n.suggestion.text}`;
    if (sk !== d.sugKey) {
      d.sugKey = sk;
      d.offerKey = "";
      if (!n.suggestion) {
        const empty = el("div");
        d.sug.replaceWith(empty);
        d.sug = empty;
        d.offer = null;
        d.same = null;
      } else {
        const { box, offer, same } = suggestionBlock(n.suggestion);
        d.sug.replaceWith(box);
        d.sug = box;
        d.offer = offer;
        d.same = same;
      }
    }
    if (d.same) {
      const t = n.suggestion?.kind === "ready" ? (n.suggestion.sameAs ?? "") : "";
      d.same.hidden = !t;
      if (d.same.textContent !== t) d.same.textContent = t;
    }
    drawOffer(d, n);
    return d.li;
  }
  const schedule = () => {
    if (pending || !root) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      draw(model.view());
    });
  };

  function draw(v: NaturalistView) {
    if (!root) return;
    root.dataset.state = v.state;
    $("naturalist-badge")!.textContent = v.badge;
    const status = $("naturalist-status")!;
    if (status.textContent !== v.status) status.textContent = v.status;
    const detail = $("naturalist-detail")!;
    detail.hidden = !v.detail;
    detail.textContent = v.detail ?? "";
    const read = $("naturalist-read")!;
    read.hidden = !v.readLine;
    read.textContent = v.readLine ?? "";
    const filing = $("naturalist-filing")!;
    filing.hidden = !v.filing;
    filing.textContent = v.filing ?? "";

    // Notes are drawn by key and updated in place, so a live stretch never replaces a button under the pointer or the focus.
    const list = $("naturalist-notes")!;
    const want = v.notes.map(drawNote);
    const keep = new Set(v.notes.map((n) => n.key));
    for (const k of [...drawn.keys()]) if (!keep.has(k)) drawn.delete(k);
    want.forEach((li, i) => {
      if (list.children[i] !== li) list.insertBefore(li, list.children[i] ?? null);
    });
    while (list.children.length > want.length) list.lastElementChild!.remove();
    list.hidden = !v.notes.length;
    if (model.wantsSuggester()) askSuggester();

    const lines = (id: string, xs: NaturalistView["standing"]) => {
      const list = $(id)!;
      list.replaceChildren(...xs.map((s) => {
        const li = el("li");
        if (s.chip) li.append(chip(s.chip), " ");
        li.append(el("span", undefined, s.text));
        return li;
      }));
      list.hidden = !xs.length;
    };
    const hk = JSON.stringify(v.hedge);
    if (hk !== hedgeKey) {
      hedgeKey = hk;
      lines("naturalist-hedge", v.hedge);
    }
    const sk = JSON.stringify([v.standing, v.cannot, v.rule]);
    if (sk !== staticKey) {
      staticKey = sk;
      lines("naturalist-standing", v.standing);
      $("naturalist-cannot")!.replaceChildren(...v.cannot.map((t) => el("li", undefined, t)));
      const rule = $("naturalist-rule")!;
      if (!v.rule) rule.replaceChildren(el("p", undefined, "Each preset with a baseline has its rule, fixed before the code: docs/naturalist-field-notes-v0-2026-10-18.md."));
      else {
        const recs = el("ul", "naturalist-records");
        for (const r of v.rule.records) {
          const li = el("li");
          li.append(el("span", "mono", r.path), " ", el("span", "mono sha", `SHA-256 ${r.sha256}`));
          recs.append(li);
        }
        const base = el("p");
        base.append(`The baseline: the median and spread of ${v.rule.baseline.runs} neutral runs at every census, `, el("span", "mono", `${assetRootNow()}${v.rule.baseline.file}`), " ", el("span", "mono sha", `SHA-256 ${v.rule.baseline.sha256}`), ". Built from those runs’ bundles by tools/naturalist-envelope.ts, which checks it against the records below.");
        rule.replaceChildren(el("p", undefined, v.rule.name), el("p", undefined, v.rule.threshold), base, el("p", undefined, "The records:"), recs, el("p", undefined, "Rules fixed before the code: docs/naturalist-field-notes-v0-2026-10-18.md."));
      }
    }
  }

  draw(model.view());
  return {
    onLoaded(manifest: RunManifest, step: number, world: number | undefined) {
      model.onLoaded(manifest, step, world ?? -1);
      schedule();
    },
    onCensus(m: NaturalistMsg) {
      model.onCensus(m);
      schedule();
    },
    onTouched(world: number, runId: string, step: number) {
      model.onTouched(world, runId, step);
      schedule();
    },
    /** The lab refused or failed the hand edit a Try sent (the model ignores this unless a Try is waiting). */
    onApplyRefused(reason: string, certain = true) {
      model.onApplyRefused(reason, certain);
      schedule();
    },
    /** The world on screen has failed (a lost GPU, a failed execution), or the worker reported an error it did not handle. */
    onFailed(by: "world" | "worker" = "world") {
      model.onFailed(by);
      schedule();
    },
  };
}
