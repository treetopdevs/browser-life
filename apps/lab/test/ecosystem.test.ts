import { describe, expect, it } from "vitest";
import { Ecosystem, RULES, attackChance, canAttack, upkeep } from "../src/ecosystem/model.ts";
import type { Cell } from "../src/ecosystem/model.ts";
const run = (s: Ecosystem, ticks: number) => { for (let i = 0; i < ticks; i++) s.step(); return s; };
describe("engineered ecosystem", () => {
  it("replays the same seed, choices and interventions", () => {
    const a = new Ecosystem(42, 24), b = new Ecosystem(42, 24);
    for (const s of [a, b]) { run(s, 100); s.setOption("mutation", false); s.dry(); s.introduce(4, true); run(s, 350); }
    expect(a.exportSnapshot()).toEqual(b.exportSnapshot());
    expect(run(new Ecosystem(43, 24), 450).cells).not.toEqual(a.cells);
  });
  it("preserves traits without mutation and produces bounded variants with mutation", () => {
    const off = new Ecosystem(1101, 32, false); off.mutation = false; run(off, 600);
    expect(off.census().population).toBeGreaterThan(0);
    expect(off.mutations).toBe(0); expect(off.births).toBeGreaterThan(0);
    expect(off.cells.filter(Boolean).every(c => c!.attack === 2 && c!.defense === 1)).toBe(true);
    const on = run(new Ecosystem(1101, 32, false), 600);
    expect(on.mutations).toBeGreaterThan(0);
    expect(on.cells.some(c => c && (c.attack !== 2 || c.defense !== 1))).toBe(true);
    for (const c of on.cells) if (c) {
      expect(Number.isFinite(c.energy)).toBe(true); expect(c.energy).toBeGreaterThan(0); expect(c.energy).toBeLessThanOrEqual(24);
      expect(c.attack).toBeGreaterThanOrEqual(0); expect(c.attack).toBeLessThanOrEqual(4);
      expect(c.defense).toBeGreaterThanOrEqual(0); expect(c.defense).toBeLessThanOrEqual(4);
    }
    for (const food of on.food) { expect(food).toBeGreaterThanOrEqual(0); expect(food).toBeLessThanOrEqual(RULES.resourceCap); }
  });
  it("defense helps but costs food; max traits cannot live on uptake alone", () => {
    const a: Cell = { family: 0, attack: 2, defense: 0, energy: 10, age: 0, born: -1 };
    const defended = { ...a, defense: 4 };
    expect(upkeep(defended)).toBeGreaterThan(upkeep(a));
    expect(upkeep({ attack: 4, defense: 4 })).toBeGreaterThan(RULES.uptake);
    expect(attackChance(a, defended, false)).toBeLessThan(attackChance(a, a, false));
    expect(attackChance(a, a, true)).toBe(attackChance(a, a, false) / 4);
    expect(attackChance({ ...a, family: 2 }, { ...defended, family: 3 }, false)).toBe(0);
    expect(attackChance({ ...a, family: 4, attack: 4 }, { ...defended, family: 3 }, false)).toBeGreaterThan(0);
    expect(canAttack(4, 3)).toBe(true); expect(canAttack(1, 4)).toBe(true); expect(canAttack(4, 0)).toBe(false);
  });
  it("does not let newborns act in their birth tick", () => {
    const s = new Ecosystem(9, 16, false); s.cells.fill(null);
    s.cells[100] = { family: 0, attack: 0, defense: 0, energy: 24, age: 0, born: -1 };
    s.mutation = false; s.step();
    expect(s.births).toBe(1); expect(s.cells.filter(Boolean)).toHaveLength(2);
    expect(s.cells.filter(c => c?.age === 0)).toHaveLength(1);
  });
  it("a moved adult remains vulnerable without acting twice", () => {
    const s = new Ecosystem(9, 16, false); s.cells.fill(null); s.mutation = false;
    const victim: Cell = { family: 1, attack: 0, defense: 0, energy: 5, age: 0, born: -1 };
    s.cells[17] = victim;
    s.cells[2] = { ...victim, family: 0 };
    // Fixed two-cell schedule: victim moves 17→1, predator at 2 attacks 1.
    const draws = [0.99, 0.13, 0, 0.4];
    Object.assign(s, { order: Uint32Array.of(17, 2), schedule: () => draws.shift() ?? 0, combat: () => 0 });
    s.step();
    expect(victim.age).toBe(1); expect(victim.born).toBe(-1);
    expect(s.cells[17]).toBeNull(); expect(s.cells[1]?.family).toBe(0);
    expect(s.deaths).toBe(1);
  });
  it("stages each introduction once and does not rescue extinct families", () => {
    const s = run(new Ecosystem(1, 24), 300);
    expect(s.notices.filter(n => n.text.startsWith("Staged introduction"))).toHaveLength(2);
    s.cells.fill(null); run(s, 1000);
    expect(s.cells.every(c => c === null)).toBe(true);
    expect(s.introduced).toEqual([true, true]);
    s.introduce(3, true); expect(s.cells.filter(c => c?.family === 3)).toHaveLength(24);
    expect(s.notices.at(-1)?.text).toContain("Manual introduction");
  });
  it("drought is local, temporary and does not kill directly", () => {
    const s = new Ecosystem(1, 24); s.weather = false;
    s.drought = { x: 0, y: 0, radius: 4, until: 2 };
    expect(s.renewalAt(0)).toBeCloseTo(RULES.renewal * s.fertility[0] * 0.08);
    expect(s.renewalAt(12 * 24 + 12)).toBeCloseTo(RULES.renewal * s.fertility[12 * 24 + 12]);
    run(s, 2); expect(s.drought).toBeNull();
    expect(s.renewalAt(0)).toBeCloseTo(RULES.renewal * s.fertility[0]);
  });
  it("viewing or exporting never changes recorded history or the trajectory", () => {
    const a = new Ecosystem(1101, 24), b = new Ecosystem(1101, 24);
    for (let i = 0; i < 320; i++) { a.step(); a.census(); a.exportSnapshot(); b.step(); }
    expect(a.exportSnapshot()).toEqual(b.exportSnapshot()); expect(a.history).toHaveLength(33);
  });
  it("manual replant clears the old recovery baseline", () => {
    const s = new Ecosystem(1101, 24, false);
    Object.assign(s, { peaks: [0,0,0,1000,0], depleted: [false,false,false,true,false] });
    s.introduce(3, true); s.sample();
    expect((s as unknown as { peaks: number[] }).peaks[3]).toBe(24);
    expect((s as unknown as { depleted: boolean[] }).depleted[3]).toBe(false);
    expect(s.notices.some(n => n.text.includes("recovered"))).toBe(false);
  });
  it("rejects invalid dimensions and seeds", () => {
    expect(() => new Ecosystem(-1)).toThrow(); expect(() => new Ecosystem(1, 0)).toThrow();
    expect(() => new Ecosystem(1.5)).toThrow(); expect(() => new Ecosystem(1, 129)).toThrow();
  });
  it("bounds histories and labels snapshot retention", () => {
    const s = new Ecosystem(1, 16, false); s.cells.fill(null); run(s, 3100);
    for (let i = 0; i < 110; i++) s.note("test notice");
    expect(s.history).toHaveLength(300); expect(s.notices).toHaveLength(100);
    expect(s.exportSnapshot()).toMatchObject({ format: "engineered-ecosystem-observation-v1", retention: { droppedSamples: 11, noticeLimit: 100 } });
  });
});
