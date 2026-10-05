/**
 * A small line chart for a rolling series. The vertical scale always starts at zero and its top is printed, so a
 * small change in a large count is drawn small. Line and labels take the canvas's CSS `color`.
 */
export class Series {
  private values: number[] = [];
  /** Indices into `values` where a pond cycle was applied: drawn as dashed rules, so the drop after one reads as the cycle. */
  private marks: number[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly cap = 400,
  ) {}

  push(v: number): void {
    this.values.push(v);
    if (this.values.length > this.cap) {
      const drop = this.values.length - this.cap;
      this.values.splice(0, drop);
      this.marks = this.marks.map((m) => m - drop).filter((m) => m >= 0);
    }
    this.draw();
  }

  /** Marks the next reading as the first after a pond cycle. */
  mark(): void {
    this.marks.push(this.values.length);
  }

  clear(): void {
    this.values = [];
    this.marks = [];
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
    ctx.font = `${11 * dpr}px ui-monospace, Menlo, monospace`;
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
    const xAt = (i: number) => (i / (v.length - 1)) * (w - 2) + 1;
    // Dashed and full height, with a notch at the top: plain enough to find, unlike the solid series line.
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = ink;
    ctx.lineWidth = dpr;
    ctx.setLineDash([3 * dpr, 3 * dpr]);
    for (const m of this.marks) {
      if (m <= 0 || m >= v.length) continue;
      const x = Math.round(xAt(m - 0.5)) + 0.5 * dpr;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 3 * dpr, top - 1 * dpr);
      ctx.lineTo(x + 3 * dpr, top - 1 * dpr);
      ctx.lineTo(x, top + 3 * dpr);
      ctx.fill();
    }
    ctx.restore();
    ctx.beginPath();
    v.forEach((x, i) => {
      const px = xAt(i);
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
