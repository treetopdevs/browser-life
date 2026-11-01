// Draws the readout of tools/soup-evo.ts analyze as one self-contained HTML page.
//
//   deno run -A tools/soup-evo-report.ts [runs/soup/evo/results.json] [--out runs/soup/evo/report.html]
import { parseArgs } from "jsr:@std/cli@1/parse-args";

const a = parseArgs(Deno.args, { string: ["out"] });
const src = String(a._[0] ?? "runs/soup/evo/results.json");
const out = a.out ?? src.replace(/results\.json$/, "report.html");
const data = await Deno.readTextFile(src);

const html = /* html */ `<title>After the Copiers</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=JetBrains+Mono:wght@400;600&display=swap">
<style>
/* Layout: a lab notebook, one column of findings, each lineage a page with its population chart, tournament and trends. */
:root{
  --paper:#eef2ef; --ink:#14201e; --muted:#566663; --rule:#cdd6d2; --panel:#f8faf8;
  --accent:#1d5fa8; --win:#2f7d4f; --loss:#b4462f; --even:#9a8a3a; --none:#c6ceca; --debris:#dfe5e2;
  --display:"Bricolage Grotesque",ui-sans-serif,system-ui,sans-serif;
  --body:"Source Serif 4",Georgia,serif;
  --mono:"JetBrains Mono",ui-monospace,Menlo,monospace;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--paper:#0f1615;--ink:#e3ebe8;--muted:#93a39f;--rule:#2a3836;--panel:#152120;--accent:#6ea8e8;--win:#5fbf86;--loss:#e17a62;--even:#c9b65c;--none:#3b4a47;--debris:#1d2a28;color-scheme:dark}}
:root[data-theme="dark"]{--paper:#0f1615;--ink:#e3ebe8;--muted:#93a39f;--rule:#2a3836;--panel:#152120;--accent:#6ea8e8;--win:#5fbf86;--loss:#e17a62;--even:#c9b65c;--none:#3b4a47;--debris:#1d2a28;color-scheme:dark}
body{background:var(--paper);color:var(--ink);font:17px/1.6 var(--body);padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));padding-block:32px 64px}
main{max-width:980px;margin:0 auto;display:grid;gap:44px}
h1,h2,h3{font-family:var(--display);font-weight:700;line-height:1.15;text-wrap:balance;margin:0}
h1{font-size:clamp(30px,5vw,46px);letter-spacing:-.01em}
h2{font-size:26px}h3{font-size:17px;font-weight:500;color:var(--muted)}
p{margin:0;max-width:68ch}
.eyebrow{font:600 12px/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}
.lede{display:grid;gap:14px}
.headline{font-family:var(--display);font-size:clamp(21px,3vw,28px);font-weight:500;border-left:4px solid var(--accent);padding:4px 0 4px 16px}
.mono,code,td.num{font-family:var(--mono);font-size:13px}
.tablewrap{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{padding:8px 10px;border-bottom:1px solid var(--rule);text-align:left;vertical-align:top}
th{font:600 12px/1.3 var(--mono);letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
.pill{display:inline-block;padding:2px 8px;border-radius:999px;font:600 12px/1.5 var(--mono);border:1px solid currentColor}
.v-ADAPTIVE{color:var(--win)}.v-REVERSED{color:var(--loss)}.v-weak{color:var(--even)}.v-none{color:var(--muted)}
section.lineage{display:grid;gap:18px;padding-top:28px;border-top:1px solid var(--rule)}
.facts{display:flex;flex-wrap:wrap;gap:8px 22px;color:var(--muted);font:13px/1.4 var(--mono)}
.facts b{color:var(--ink);font-weight:600}
figure{margin:0;display:grid;gap:8px;min-width:0}
figcaption{color:var(--muted);font-size:14px;max-width:72ch}
svg{display:block;width:100%;height:auto;max-width:100%}
svg text{fill:var(--muted);font:11px var(--mono)}
.two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:24px}
@media (max-width:760px){.two{grid-template-columns:1fr}}
.matrix{width:auto}.matrix td{min-width:52px;text-align:center;font:12px var(--mono);padding:6px;border:1px solid var(--rule)}
.matrix th{font-size:11px;text-transform:none;letter-spacing:0;padding:6px}
.o-later{background:color-mix(in srgb,var(--win) 28%,transparent)}.o-earlier{background:color-mix(in srgb,var(--loss) 28%,transparent)}
.o-coexist{background:color-mix(in srgb,var(--even) 26%,transparent)}.o-unresolved{background:transparent}.o-failed{background:var(--none)}
.legend{display:flex;flex-wrap:wrap;gap:6px 16px;font:12px var(--mono);color:var(--muted)}
.legend i{display:inline-block;width:12px;height:12px;border-radius:2px;margin-right:6px;vertical-align:-2px}
.note{font-size:14px;color:var(--muted)}
details{border:1px solid var(--rule);border-radius:6px;padding:10px 14px;background:var(--panel)}
summary{cursor:pointer;font-family:var(--display)}
.prog{font:12px/1.5 var(--mono);white-space:pre;overflow-x:auto;display:block;padding:6px 0}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
</style>
<main>
  <header class="lede">
    <p class="eyebrow">BFF program soup · post-takeover test</p>
    <h1>After the copiers take over, does evolution keep going?</h1>
    <p id="headline" class="headline"></p>
    <p id="intro"></p>
  </header>
  <section class="tablewrap" aria-labelledby="sum-h"><h2 id="sum-h" style="margin-bottom:12px">The four lineages</h2><table id="summary"></table><p class="note" id="sumnote" style="margin-top:10px"></p></section>
  <section id="neutral" aria-labelledby="neu-h" style="display:grid;gap:12px"></section>
  <div id="lineages" style="display:grid;gap:44px"></div>
  <section aria-labelledby="m-h" style="display:grid;gap:10px">
    <h2 id="m-h">How this was decided</h2>
    <p>The rules were written down before any result came in, in <code>docs/soup-evolution-2026-10-31.md</code>. A <b>type</b> is a program's instruction pattern (zero bytes kept, other data bytes ignored), counted together with its rotated and reversed copies, because these copiers write their copy back to front. The <b>leader</b> is the largest type that passes cubff's copy test. A <b>sustained change</b> is a new leader that holds for two snapshots in a row. Each pair of leaders then competes in a fresh soup of 16,384 programs, each starting rare (12.5%) in turn, 3 runs each way. A pair is resolved only when the gap between the two "rare" results is beyond what a neutral marker control drifts by chance.</p>
  </section>
</main>
<script type="application/json" id="data">${data.replace(/</g, "\\u003c")}</script>
<script>
const R = JSON.parse(document.getElementById("data").textContent);
const S = R.summary;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmt = (x, d = 2) => x === null || x === undefined || Number.isNaN(x) ? "–" : Number(x).toFixed(d);
const pct = (x) => (x * 100).toFixed(1) + "%";
const NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
const hue = (id) => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; };
const cladeColor = (id) => id ? "hsl(" + hue(id) + " 55% 52%)" : "var(--none)";
const vclass = (v) => v === "ADAPTIVE" ? "v-ADAPTIVE" : v === "REVERSED" ? "v-REVERSED" : v === "ADAPTIVE (weak)" ? "v-weak" : "v-none";
const NAMES = { wm2: "Well-mixed, seed 2", wm6: "Well-mixed, seed 6", wm8: "Well-mixed, seed 8", g1: "Grid 240 × 135, seed 1" };
const show = (hex) => hex.match(/../g).map((h) => { const b = parseInt(h, 16), c = String.fromCharCode(b); return b === 0 ? "0" : "[]+-.,<>{}".includes(c) ? c : "·"; }).join("");

$("headline").textContent = S.headline;
$("intro").textContent = "Four soups grew self-copying programs out of random bytes. Each was run about 32,000 more epochs after the copiers took over, to see whether copiers keep replacing each other, and whether the later ones are actually better at taking over than the earlier ones.";

// Summary table
const st = $("summary");
st.innerHTML = "<thead><tr><th>Lineage</th><th>Leader changes</th><th>Competitors</th><th>Verdict</th><th>Later wins</th><th>Permutation p</th><th>Exploratory</th><th>Grid assays</th></tr></thead>";
const tb = document.createElement("tbody");
for (const l of S.lineages) {
  const tr = document.createElement("tr");
  tr.innerHTML = "<td><b>" + esc(NAMES[l.key] ?? l.key) + "</b><br><span class='mono'>" + esc(l.key) + "</span></td>" +
    "<td class='num'>" + l.changes + " · " + esc(l.turnover) + "</td><td class='num'>" + l.competitors + "</td>" +
    "<td><span class='pill " + vclass(l.verdict) + "'>" + esc(l.verdict) + "</span></td>" +
    "<td class='num'>" + l.laterWins + " of " + l.resolved + " resolved</td><td class='num'>" + fmt(l.p, 3) + "</td>" +
    "<td class='num'>" + esc(String(l.explore).replace(/[0-9][.][0-9]{4,}/g, (x) => Number(x).toFixed(2))) + "</td><td class='num'>" + esc(l.grid ?? "–") + "</td>";
  tb.appendChild(tr);
}
st.appendChild(tb);
$("sumnote").textContent = "Parasites found in " + S.parasiteLineages + " of 4 lineages. " + (S.missingAssays ? S.missingAssays + " assays still missing. " : "") + (S.missingExploratory ? S.missingExploratory + " exploratory assays still missing." : "");

// Neutral control
{
  const n = $("neutral");
  n.innerHTML = "<h2 id='neu-h'>How much a rare type drifts by chance</h2>" +
    "<p>Each lineage's first leader was raced against a copy of itself that differs in one inert byte. Whatever happens to that marked copy is chance. Its spread sets the bar every real pair must clear: <b>σ0 = " + fmt(S.sigma0, 3) + "</b> over " + S.neutralCalibrationRuns + " runs, mean final share " + fmt(S.neutralMeanF, 3) + " against a start of 0.125.</p>" +
    "<p class='note'>Validation batch (fresh seeds, each should come out unresolved): " + S.validation.map((v) => esc(v.lineage) + " " + esc(v.outcome) + (v.D !== null ? " (D " + fmt(v.D, 3) + ", bar " + fmt(v.theta, 3) + ")" : "")).join(" · ") + (S.calibrationFailed ? " — calibration failed, so verdicts are provisional." : ".") + "</p>";
}

// Per-lineage pages
const host = $("lineages");
for (const L of R.lineages) {
  const sec = document.createElement("section");
  sec.className = "lineage";
  sec.setAttribute("aria-labelledby", "h-" + L.key);
  const first = L.muller[0], last = L.muller[L.muller.length - 1];
  sec.innerHTML = "<div style='display:grid;gap:6px'><p class='eyebrow'>" + esc(L.key) + "</p><h2 id='h-" + L.key + "'>" + esc(NAMES[L.key] ?? L.key) + "</h2></div>" +
    "<div class='facts'><span>epochs <b>" + first.epoch + "–" + last.epoch + "</b></span><span>leader changes <b>" + L.changes + "</b></span><span>distinct leaders seen <b>" + L.chain.length + "</b></span><span>copier share <b>" + pct(first.copierShare) + " → " + pct(last.copierShare) + "</b></span><span>types ≥ 0.1% <b>" + first.typesAbove + " → " + last.typesAbove + "</b></span></div>";
  // Muller plot
  const fig = document.createElement("figure");
  const W = 940, H = 260, padL = 34, padB = 22, padT = 6;
  const svg = el("svg", { viewBox: "0 0 " + W + " " + (H + padB + padT), role: "img", "aria-label": "Share of the soup held by each type over time, coloured by clade" });
  const x0 = first.epoch, x1 = last.epoch;
  const X = (e) => padL + (W - padL - 4) * (e - x0) / Math.max(1, x1 - x0);
  const Y = (f) => padT + H * (1 - f);
  for (const g of [0, 0.25, 0.5, 0.75, 1]) { el("line", { x1: padL, x2: W - 4, y1: Y(g), y2: Y(g), stroke: "var(--rule)", "stroke-width": 1 }, svg); el("text", { x: padL - 6, y: Y(g) + 4, "text-anchor": "end" }, svg).textContent = (g * 100) + "%"; }
  // stack: clades (in competitor order), other copiers, non-copier types; the rest of the soup (small types and debris) is left blank
  const anchorOrder = L.competitors.concat(L.timePoints).map((c) => c.id);
  const order = [...new Set(L.muller.flatMap((m) => Object.keys(m.clades)))].sort((p, q) => anchorOrder.indexOf(p) - anchorOrder.indexOf(q));
  const series = [...order.map((cid) => ({ fill: cladeColor(cid), op: 0.88, v: L.muller.map((m) => m.clades[cid] ?? 0) })),
    { fill: "var(--muted)", op: 0.35, v: L.muller.map((m) => m.otherCopier) },
    { fill: "var(--none)", op: 0.55, v: L.muller.map((m) => m.nonCopier) }];
  const base = L.muller.map(() => 0);
  for (const ser of series) {
    const top = ser.v.map((v, i) => base[i] + v);
    let d = "M" + L.muller.map((m, i) => X(m.epoch) + "," + Y(top[i])).join(" L");
    d += " L" + L.muller.map((m, i) => X(m.epoch) + "," + Y(base[i])).reverse().join(" L") + " Z";
    el("path", { d, fill: ser.fill, "fill-opacity": ser.op, stroke: "var(--paper)", "stroke-width": 0.5 }, svg);
    top.forEach((v, i) => base[i] = v);
  }
  // leader-change ticks
  for (const c of L.chain) { el("line", { x1: X(c.epoch), x2: X(c.epoch), y1: Y(1) , y2: Y(1) + 6, stroke: "var(--ink)", "stroke-width": 1 }, svg); }
  const ticks = 6;
  for (let i = 0; i <= ticks; i++) { const e = Math.round(x0 + (x1 - x0) * i / ticks); el("text", { x: X(e), y: H + padT + 16, "text-anchor": i === 0 ? "start" : i === ticks ? "end" : "middle" }, svg).textContent = e.toLocaleString(); }
  fig.appendChild(svg);
  const cap = document.createElement("figcaption");
  cap.innerHTML = "How the soup is made up at each snapshot, over every type holding at least 0.1%. Each colour is a clade of copiers (types near one of the raced leaders); <span style='opacity:.7'>mid-grey</span> is other copiers, light grey is types that cannot copy themselves, and the blank space above is small types and debris. Ticks along the top mark each change of leader.";
  fig.appendChild(cap);
  sec.appendChild(fig);

  // Tournament + trends
  const two = document.createElement("div"); two.className = "two";
  const mat = (title, sc, comp) => {
    const f = document.createElement("figure");
    if (!sc || comp.length < 2) { f.innerHTML = "<h3>" + esc(title) + "</h3><p class='note'>Fewer than two competitors, so nothing to race.</p>"; return f; }
    const idx = Object.fromEntries(comp.map((c, i) => [c.id, i]));
    let t = "<h3>" + esc(title) + " · <span class='" + vclass(sc.verdict) + "'>" + esc(sc.verdict) + "</span></h3><div class='tablewrap'><table class='matrix'><tr><th></th>" + comp.map((c, i) => "<th title='" + esc(c.id) + "'>" + (i + 1) + "</th>").join("") + "</tr>";
    for (let r = 0; r < comp.length; r++) {
      t += "<tr><th style='text-align:right' title='" + esc(comp[r].id) + "'>" + (r + 1) + " · " + comp[r].epoch + "</th>";
      for (let c = 0; c < comp.length; c++) {
        if (r === c) { t += "<td class='o-failed' style='opacity:.4'></td>"; continue; }
        const p = sc.pairs.find((p) => (idx[p.a] === r && idx[p.b] === c) || (idx[p.a] === c && idx[p.b] === r));
        if (!p) { t += "<td>?</td>"; continue; }
        // row r vs col c, from row's point of view: D for row rare minus col rare
        const sign = idx[p.a] === r ? 1 : -1;
        const D = p.D === null ? null : sign * p.D;
        let cls = "o-unresolved";
        if (p.outcome === "failed") cls = "o-failed"; else if (p.outcome === "coexist") cls = "o-coexist";
        else if (p.outcome === "a" || p.outcome === "b") { const winner = p.outcome === "a" ? idx[p.a] : idx[p.b]; const loser = winner === idx[p.a] ? idx[p.b] : idx[p.a]; cls = winner > loser ? "o-later" : "o-earlier"; }
        t += "<td class='" + cls + "' title='D " + fmt(D, 3) + ", bar " + fmt(p.theta, 3) + "'>" + fmt(D, 2) + "</td>";
      }
      t += "</tr>";
    }
    t += "</table></div><p class='note'>Rows and columns are competitors in order of their first lead (epoch shown). Each cell is D: the row's mean final share when it starts rare, minus the column's when the column starts rare. Resolved: " + sc.resolved + " pairs, later type won " + sc.laterWins + ", permutation p " + fmt(sc.p, 3) + (sc.cyclic.length ? ", " + sc.cyclic.length + " rock-paper-scissors triples" : "") + ".</p>";
    f.innerHTML = t;
    return f;
  };
  two.appendChild(mat("Sustained leaders raced", L.wellMixed, L.competitors));
  two.appendChild(mat("Exploratory: leaders at 5 time points", L.explore, L.timePoints));
  sec.appendChild(two);
  if (L.grid) sec.appendChild(mat("Grid assays (secondary, σ0 " + fmt(L.grid.sigma0, 3) + ")", L.grid, L.competitors));
  const legend = document.createElement("div"); legend.className = "legend";
  legend.innerHTML = "<span><i class='o-later' style='background:color-mix(in srgb,var(--win) 50%,transparent)'></i>later type won</span><span><i style='background:color-mix(in srgb,var(--loss) 50%,transparent)'></i>earlier type won</span><span><i style='background:color-mix(in srgb,var(--even) 50%,transparent)'></i>coexist</span><span><i style='border:1px solid var(--rule)'></i>unresolved</span><span><i style='background:var(--none)'></i>failed</span>";
  sec.appendChild(legend);

  // Trends
  const tr = document.createElement("figure");
  const metrics = [["instructions", "Instructions in the leader"], ["ops", "Instructions run per pairing"], ["robustness", "Copy test after one mutation"]];
  const tw = 300, th = 110;
  const grid = document.createElement("div"); grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px";
  for (const [m, label] of metrics) {
    const box = document.createElement("div");
    const vals = L.trends.map((t) => t[m]);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const s2 = el("svg", { viewBox: "0 0 " + tw + " " + (th + 18), role: "img", "aria-label": label + " over time" });
    const Xt = (e) => 4 + (tw - 8) * (e - x0) / Math.max(1, x1 - x0);
    const Yt = (v) => 6 + (th - 12) * (1 - (v - lo) / Math.max(1e-9, hi - lo));
    el("line", { x1: 4, x2: tw - 4, y1: th - 6, y2: th - 6, stroke: "var(--rule)" }, s2);
    el("polyline", { points: L.trends.map((t) => Xt(t.epoch) + "," + Yt(t[m])).join(" "), fill: "none", stroke: "var(--accent)", "stroke-width": 1.6 }, s2);
    const e = L.trends[L.trends.length - 1]; if (e) el("circle", { cx: Xt(e.epoch), cy: Yt(e[m]), r: 3, fill: "var(--accent)" }, s2);
    el("text", { x: 4, y: th + 14 }, s2).textContent = fmt(lo, 0) + " – " + fmt(hi, 0);
    box.innerHTML = "<p class='mono' style='font-size:12px'>" + esc(label) + " · ρ " + fmt(L.trendCorr[m], 2) + "</p>";
    box.appendChild(s2);
    grid.appendChild(box);
  }
  tr.appendChild(grid);
  const tcap = document.createElement("figcaption"); tcap.textContent = "The leader at each snapshot, measured against 13 fixed random partners. ρ is the Spearman correlation with time (descriptive, no verdict).";
  tr.appendChild(tcap);
  sec.appendChild(tr);

  // Parasites and competitors
  const det = document.createElement("details");
  const par = L.probes.flatMap((p) => p.parasites.map((q) => "epoch " + p.epoch + ": " + q.parasite + " rides on " + q.host + " (" + q.order + ")"));
  det.innerHTML = "<summary>Competitors, parasites and the leader chain</summary>" +
    "<p class='note' style='margin:8px 0'>Parasites (types that cannot copy themselves but spread for three rounds on a host's copying): " + (par.length ? esc(par.join("; ")) : "none found at the three probed snapshots") + ".</p>" +
    L.competitors.map((c, i) => "<p class='mono'>" + (i + 1) + " · " + esc(c.id) + " · first led at " + c.epoch + " · " + c.instructions + " instructions · copy test " + c.selfRep + "</p><code class='prog'>" + esc(show(c.rep)) + "</code>").join("") +
    "<p class='note' style='margin-top:8px'>Leader chain (epoch: type, key differences from the previous leader): " + esc(L.chain.map((c) => c.epoch + ": " + c.id + (c.distance !== null ? " (" + c.distance + ")" : "")).join(", ")) + "</p>";
  sec.appendChild(det);
  host.appendChild(sec);
}
</script>
`;
await Deno.writeTextFile(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
