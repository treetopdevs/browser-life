/**
 * A small line chart for a rolling series. The vertical scale always starts at zero and its top is printed, so a
 * small change in a large count is drawn small. Line and labels take the canvas's CSS `color`.
 */
export class Series {
  private values: number[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly cap = 400,
  ) {}

  push(v: number): void {
    this.values.push(v);
    if (this.values.length > this.cap) this.values.splice(0, this.values.length - this.cap);
    this.draw();
  }

  clear(): void {
    this.values = [];
    this.draw();
  }

  redraw(): void {
    this.draw();
  }

  private draw(): void {
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(c.clientWidth * dpr));
    const h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, w, h);
    const v = this.values;
    const ink = getComputedStyle(c).color;
    ctx.fillStyle = ink;
    ctx.font = `${10 * dpr}px ui-monospace, Menlo, monospace`;
    if (v.length < 2) {
      ctx.globalAlpha = 0.6;
      ctx.textAlign = "center";
      ctx.fillText(v.length ? "One reading so far" : "No readings yet", w / 2, h / 2 + 3 * dpr);
      ctx.globalAlpha = 1;
      return;
    }
    let hi = 1;
    for (const x of v) hi = Math.max(hi, x);
    const top = 13 * dpr;
    ctx.beginPath();
    v.forEach((x, i) => {
      const px = (i / (v.length - 1)) * (w - 2) + 1;
      const py = h - 2 - (Math.max(0, x) / hi) * (h - 2 - top);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.5 * dpr;
    ctx.stroke();
    // Scale top at the left (muted), latest value at the right.
    ctx.textAlign = "right";
    ctx.fillText(fmtShort(v[v.length - 1]), w - 3 * dpr, 10 * dpr);
    ctx.globalAlpha = 0.6;
    ctx.textAlign = "left";
    ctx.fillText(fmtShort(hi), 3 * dpr, 10 * dpr);
    ctx.globalAlpha = 1;
  }
}

function fmtShort(x: number): string {
  return Math.abs(x) >= 1e6 ? `${(x / 1e6).toFixed(1)}M` : Math.abs(x) >= 1e3 ? `${(x / 1e3).toFixed(1)}k` : String(Math.round(x));
}
