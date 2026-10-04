// Deterministic SVG figure for the renewal report: per main case, source B
// beside cumulative local synthesis (Q), cumulative reaction balance (R) and
// cumulative net bound-B import at the source, plus total off-source B.
export interface Series {
  id: string;
  steps: number[];
  B: number[];
  Q: number[];
  R: number[];
  imp: number[];
  fieldB: number[];
}

const LINES: { key: keyof Omit<Series, "id" | "steps">; label: string; color: string }[] = [
  { key: "B", label: "source B", color: "#1f6feb" },
  { key: "fieldB", label: "off-source B", color: "#2da44e" },
  { key: "Q", label: "cum. PHOTO+GROW at source", color: "#bf8700" },
  { key: "R", label: "cum. reaction change of B at source", color: "#cf222e" },
  { key: "imp", label: "cum. net bound-B import at source", color: "#8250df" },
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

export function renderFigure(series: Series[]): string {
  const cols = 4, pw = 300, ph = 170, pad = 46, top = 60;
  const rows = Math.max(1, Math.ceil(series.length / cols));
  const width = cols * (pw + pad) + pad, height = top + rows * (ph + pad + 18) + 20;
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Helvetica, Arial, sans-serif" font-size="10">`,
    `<rect width="100%" height="100%" fill="#ffffff"/>`,
    `<text x="${pad}" y="20" font-size="14">construction-renewal-v1: source B, local synthesis, reaction balance and bound-B imports (each panel on its own symmetric scale)</text>`,
  ];
  LINES.forEach((l, k) => {
    const x = pad + k * 230;
    out.push(`<line x1="${x}" y1="40" x2="${x + 18}" y2="40" stroke="${l.color}" stroke-width="2"/>`);
    out.push(`<text x="${x + 22}" y="44">${esc(l.label)}</text>`);
  });
  series.forEach((s, idx) => {
    const ox = pad + (idx % cols) * (pw + pad), oy = top + Math.floor(idx / cols) * (ph + pad + 18);
    const maxStep = Math.max(1, ...s.steps);
    let lim = 1;
    for (const l of LINES) for (const v of s[l.key]) lim = Math.max(lim, Math.abs(v));
    const X = (t: number) => ox + (t / maxStep) * pw;
    const Y = (v: number) => oy + ph / 2 - (v / lim) * (ph / 2);
    out.push(`<text x="${ox}" y="${oy - 6}" font-size="11">${esc(s.id)}</text>`);
    out.push(`<rect x="${ox}" y="${oy}" width="${pw}" height="${ph}" fill="none" stroke="#d0d7de"/>`);
    out.push(`<line x1="${ox}" y1="${Y(0)}" x2="${ox + pw}" y2="${Y(0)}" stroke="#d0d7de" stroke-dasharray="3,3"/>`);
    out.push(`<text x="${ox - 4}" y="${oy + 8}" text-anchor="end">${lim}</text>`);
    out.push(`<text x="${ox - 4}" y="${oy + ph}" text-anchor="end">-${lim}</text>`);
    out.push(`<text x="${ox + pw}" y="${oy + ph + 12}" text-anchor="end">step ${maxStep}</text>`);
    for (const l of LINES) {
      const pts = s.steps.map((t, i) => `${X(t).toFixed(1)},${Y(s[l.key][i]).toFixed(1)}`).join(" ");
      out.push(`<polyline fill="none" stroke="${l.color}" stroke-width="1.2" points="${pts}"/>`);
    }
  });
  out.push("</svg>");
  return out.join("\n") + "\n";
}
