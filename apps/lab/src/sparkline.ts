/** A small auto-scaled line chart for a rolling series. */
export class Series {
  private values: number[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly color: () => string,
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
    if (v.length < 2) return;
    let lo = Infinity, hi = -Infinity;
    for (const x of v) {
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    }
    if (hi === lo) hi = lo + 1;
    ctx.beginPath();
    v.forEach((x, i) => {
      const px = (i / (v.length - 1)) * (w - 2) + 1;
      const py = h - 2 - ((x - lo) / (hi - lo)) * (h - 4);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.strokeStyle = this.color();
    ctx.lineWidth = 1.5 * dpr;
    ctx.stroke();
    ctx.fillStyle = this.color();
    ctx.font = `${10 * dpr}px ui-monospace, Menlo, monospace`;
    ctx.textAlign = "right";
    ctx.fillText(fmtShort(v[v.length - 1]), w - 2, 10 * dpr);
  }
}

function fmtShort(x: number): string {
  return Math.abs(x) >= 1e6 ? `${(x / 1e6).toFixed(1)}M` : Math.abs(x) >= 1e3 ? `${(x / 1e3).toFixed(1)}k` : String(Math.round(x));
}
