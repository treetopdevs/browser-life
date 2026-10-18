// Field notes: the naturalist in the lab (docs/naturalist-field-notes-v0-2026-10-18.md). The DOM side of naturalist.ts: fetches a
// preset's published baseline when the model asks (once, when a matching world is loaded; again on a later matching world if it
// failed), checks it (header against the lab's fixed rule, size, SHA-256), and draws the model's view, coalesced to one draw per
// frame. Nothing here decides a ring.
import type { NaturalistMsg, RunManifest } from "./protocol.ts";
import { NaturalistModel, type Asset, type NaturalistView } from "./naturalist.ts";
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

export function createNaturalistPanel(opts: { fetch?: typeof fetch } = {}) {
  const root = document.getElementById("naturalist");
  const $ = (id: string) => document.getElementById(id);
  // The model asks once per preset, and again only after a failure (NaturalistModel.onLoaded).
  const model = new NaturalistModel((preset) => {
    void fetchBaseline(preset, opts.fetch ?? fetch).then((asset) => {
      model.setAsset(preset, asset);
      schedule();
    });
  });
  let pending = false;
  let notesKey = "", staticKey = "", hedgeKey = "";
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

    const key = JSON.stringify(v.notes);
    if (key !== notesKey) {
      notesKey = key;
      const list = $("naturalist-notes")!;
      list.replaceChildren(...v.notes.map((n) => {
        const li = el("li", "naturalist-note");
        li.dataset.signal = n.signal;
        li.dataset.side = n.side;
        const head = el("div", "naturalist-note-head");
        head.append(el("b", "naturalist-note-label", n.label), ...n.chips.map(chip));
        li.append(head, el("p", "naturalist-sentence", n.sentence), el("p", "hint naturalist-stretch", n.stretch), el("p", "mono small naturalist-receipt", n.receiptLine));
        if (n.filedBefore !== null) li.append(el("p", "hint", `Filed before the world was changed by hand at step ${n.filedBefore.toLocaleString("en-US")}.`));
        return li;
      }));
      list.hidden = !v.notes.length;
    }

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
    /** The world on screen has failed (a lost GPU, a failed execution), or the worker reported an error it did not handle. */
    onFailed(by: "world" | "worker" = "world") {
      model.onFailed(by);
      schedule();
    },
  };
}
