import { describe, expect, it } from "vitest";
import {
  axis,
  dotMatrix,
  forestPlot,
  lineSeries,
  linearScale,
  logScale,
  niceTicks,
  num,
  referenceLine,
  scatterWithFit,
  slopegraph,
} from "../../lib/report-html/svg.ts";

describe("num", () => {
  it("rounds to 3 decimal places", () => {
    expect(num(1.23456)).toBe("1.235");
    expect(num(2)).toBe("2");
    expect(num(0)).toBe("0");
  });

  it("throws on NaN or Infinity rather than emitting them", () => {
    expect(() => num(NaN)).toThrow(/non-finite/);
    expect(() => num(Infinity)).toThrow(/non-finite/);
    expect(() => num(-Infinity)).toThrow(/non-finite/);
  });
});

describe("linearScale", () => {
  it("maps domain min/max to range edges exactly, by hand", () => {
    const s = linearScale([0, 100], [10, 310]);
    expect(s(0)).toBe(10);
    expect(s(100)).toBe(310);
    expect(s(50)).toBe(160);
    expect(s(25)).toBe(85);
  });

  it("handles a reversed pixel range (e.g. a y-axis, larger value = smaller pixel)", () => {
    const s = linearScale([0, 10], [200, 0]);
    expect(s(0)).toBe(200);
    expect(s(10)).toBe(0);
    expect(s(5)).toBe(100);
  });

  it("two equal input values produce identical pixel positions", () => {
    const s = linearScale([0, 100], [0, 500]);
    expect(s(42)).toBe(s(42));
    expect(s(0.1 + 0.2 * 0)).toBe(s(0.1));
  });

  it("a degenerate domain (min === max) does not divide by zero and returns the range midpoint", () => {
    const s = linearScale([5, 5], [10, 310]);
    expect(s(5)).toBe(160);
    expect(s(999)).toBe(160); // constant regardless of input
    expect(Number.isFinite(s(5))).toBe(true);
  });
});

describe("logScale", () => {
  it("maps domain min/max to range edges, and the geometric midpoint to the range midpoint", () => {
    const s = logScale([1, 100], [0, 200]);
    expect(s(1)).toBeCloseTo(0, 9);
    expect(s(100)).toBeCloseTo(200, 9);
    expect(s(10)).toBeCloseTo(100, 9); // sqrt(1*100) = 10, the geometric mean
  });

  it("throws on a non-positive domain bound instead of producing NaN/Infinity", () => {
    expect(() => logScale([0, 100], [0, 200])).toThrow(/positive/);
    expect(() => logScale([-1, 100], [0, 200])).toThrow(/positive/);
  });

  it("a degenerate domain does not divide by zero", () => {
    const s = logScale([10, 10], [0, 200]);
    expect(s(10)).toBe(100);
    expect(Number.isFinite(s(10))).toBe(true);
  });
});

describe("niceTicks", () => {
  it("produces the hand-computed nice ticks for [0, 100] at count=5", () => {
    // niceNum(100, false) = 100; step = niceNum(100/4=25, true) = 20;
    // floor(0/20)*20=0, ceil(100/20)*20=100 -> [0,20,40,60,80,100].
    expect(niceTicks([0, 100], 5)).toEqual([0, 20, 40, 60, 80, 100]);
  });

  it("produces the hand-computed nice ticks for [1, 9] at count=5", () => {
    // niceNum(8, false) = 10; step = niceNum(10/4=2.5, true) = 2;
    // floor(1/2)*2=0, ceil(9/2)*2=10 -> [0,2,4,6,8,10].
    expect(niceTicks([1, 9], 5)).toEqual([0, 2, 4, 6, 8, 10]);
  });

  it("a degenerate domain (min === max) returns that single value, not NaN or an empty/infinite loop", () => {
    expect(niceTicks([5, 5], 5)).toEqual([5]);
  });

  it("every tick is finite and covers the requested domain", () => {
    const ticks = niceTicks([3, 97], 6);
    expect(ticks.every(Number.isFinite)).toBe(true);
    expect(Math.min(...ticks)).toBeLessThanOrEqual(3);
    expect(Math.max(...ticks)).toBeGreaterThanOrEqual(97);
  });

  it("throws when the domain is inverted", () => {
    expect(() => niceTicks([10, 0])).toThrow(/min .* max/);
  });
});

describe("axis", () => {
  it("renders a tick line and label per value, with no NaN in any coordinate", () => {
    const scale = linearScale([0, 10], [20, 220]);
    const svg = axis({ orientation: "bottom", scale, ticks: [0, 5, 10], at: 100, gridTo: 10, viewBox: { width: 240, height: 120 } });
    expect(svg).not.toMatch(/NaN|Infinity/);
    expect((svg.match(/<text/g) ?? []).length).toBe(3);
  });

  it("uses only var(--token) colours, never a literal hex", () => {
    const scale = linearScale([0, 1], [0, 100]);
    const svg = axis({ orientation: "left", scale, ticks: [0, 0.5, 1], at: 10, viewBox: { width: 100, height: 100 } });
    expect(svg).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(svg).toContain("var(--rule)");
    expect(svg).toContain("var(--muted)");
  });
});

describe("referenceLine", () => {
  it("renders a dashed line and label with no non-finite coordinates", () => {
    const svg = referenceLine("bottom", 50, 0, 100, "alpha = 0.05");
    expect(svg).not.toMatch(/NaN|Infinity/);
    expect(svg).toContain("stroke-dasharray");
    expect(svg).toContain("alpha = 0.05");
  });
});

describe("forestPlot", () => {
  const xScale = linearScale([0, 1], [40, 300]);
  const xTicks = [0, 0.5, 1];

  it("draws a point + whisker for a normal row and an unavailable glyph (no fill) for an unavailable row", () => {
    const svg = forestPlot({
      viewBox: { width: 320, height: 120 },
      margin: { top: 10, right: 10, bottom: 30, left: 140 },
      rows: [
        { label: "adaptive-activity", point: 0, lower: 0, upper: 0.1 },
        { label: "ecological-closure-coexistence", point: null, unavailable: true },
      ],
      xScale,
      xTicks,
    });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).not.toMatch(/NaN|Infinity/);
    expect(svg).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(svg).toContain("adaptive-activity");
    expect(svg).toContain("ecological-closure-coexistence");
    // the unavailable row's glyph is unfilled
    expect(svg).toMatch(/fill="none" stroke="var\(--muted\)" stroke-width="1.5" stroke-dasharray="2,2"/);
  });

  it("draws a labelled reference line when given one", () => {
    const svg = forestPlot({
      viewBox: { width: 320, height: 80 },
      margin: { top: 10, right: 10, bottom: 30, left: 140 },
      rows: [{ label: "row", point: 0.5, lower: 0.4, upper: 0.6 }],
      xScale,
      xTicks,
      referenceLines: [{ value: 0, label: "0" }],
    });
    expect(svg).toContain("stroke-dasharray");
  });
});

describe("dotMatrix", () => {
  it("scales dot radius by sqrt(value) so area is proportional to the rate, and marks unavailable cells distinctly", () => {
    const svg = dotMatrix({
      viewBox: { width: 300, height: 200 },
      margin: { top: 30, right: 10, bottom: 10, left: 160 },
      rowLabels: ["adaptive-activity", "unbounded-growth"],
      colLabels: ["longPeriodLoop", "neutralDrift"],
      cells: [
        [{ value: 0 }, { value: 1 }],
        [{ value: null, unavailable: true }, { value: 0.09375, ciLower: 0.02, ciUpper: 0.25 }],
      ],
      maxRadius: 20,
    });
    expect(svg).not.toMatch(/NaN|Infinity/);
    expect(svg).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    // value=1 cell should have a radius equal to maxRadius (sqrt(1) = 1)
    expect(svg).toMatch(/r="20"/);
    // unavailable cell renders the hatched glyph, not a filled circle
    expect(svg).toMatch(/fill="none" stroke="var\(--muted\)"/);
  });
});

describe("scatterWithFit", () => {
  it("draws points and a single fitted curve with no CI band", () => {
    const xScale = logScale([1, 100], [40, 300]);
    const yScale = logScale([1, 100], [200, 20]);
    const svg = scatterWithFit({
      viewBox: { width: 320, height: 220 },
      margin: { top: 10, right: 10, bottom: 30, left: 40 },
      points: [{ x: 4, y: 8 }, { x: 16, y: 20 }],
      xScale,
      yScale,
      xTicks: [1, 10, 100],
      yTicks: [1, 10, 100],
      fit: { fn: (x) => 2 * Math.pow(x, 0.4), domain: [1, 100] },
    });
    expect(svg).not.toMatch(/NaN|Infinity/);
    expect((svg.match(/<circle/g) ?? []).length).toBe(2);
    expect((svg.match(/<polyline/g) ?? []).length).toBe(1);
  });
});

describe("lineSeries", () => {
  it("spaces points by their actual numeric x value, not by evenly-spaced categorical index", () => {
    const xScale = linearScale([0, 0.2], [0, 200]);
    const yScale = linearScale([0, 10], [200, 0]);
    const svg = lineSeries({
      viewBox: { width: 220, height: 220 },
      margin: { top: 10, right: 10, bottom: 30, left: 20 },
      lines: [{ id: "seed-1", points: [{ x: 0, y: 5 }, { x: 0.2, y: 8 }] }],
      xScale,
      yScale,
      xTicks: [0, 0.1, 0.2],
      yTicks: [0, 5, 10],
    });
    // x=0 -> pixel 0, x=0.2 -> pixel 200 (y=5 -> pixel 100, y=8 -> pixel 40):
    // the two points must NOT be evenly spaced at, say, 0 and 100 (which a
    // categorical/index layout would do regardless of the x values).
    expect(svg).toContain("0,100");
    expect(svg).toContain("200,40");
  });
});

describe("slopegraph", () => {
  it("preserves sign: a negative value plots below the zero line, not mirrored to a magnitude", () => {
    const yScale = linearScale([-1, 1], [200, 0]);
    const svg = slopegraph({
      viewBox: { width: 200, height: 220 },
      margin: { top: 20, right: 20, bottom: 10, left: 40 },
      pairs: [{ label: "seed-1", left: -0.5, right: 0.5 }],
      yScale,
      yTicks: [-1, 0, 1],
      leftLabel: "shorter",
      rightLabel: "longer",
      referenceLines: [{ value: 0, label: "0" }],
    });
    expect(svg).not.toMatch(/NaN|Infinity/);
    // left value -0.5 -> pixel 150 (below the y=100 zero line); right +0.5 -> pixel 50.
    expect(svg).toContain('cy="150"');
    expect(svg).toContain('cy="50"');
  });

  it("draws an unavailable glyph on a side with a null value instead of a point", () => {
    const yScale = linearScale([-1, 1], [200, 0]);
    const svg = slopegraph({
      viewBox: { width: 200, height: 220 },
      margin: { top: 20, right: 20, bottom: 10, left: 40 },
      pairs: [{ label: "seed-2", left: null, right: 0.1 }],
      yScale,
      yTicks: [-1, 0, 1],
      leftLabel: "shorter",
      rightLabel: "longer",
    });
    expect(svg).toMatch(/fill="none" stroke="var\(--muted\)" stroke-width="1.5" stroke-dasharray="2,2"/);
  });
});
