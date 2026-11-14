import { allocState3, applyFeed, defaultConfig, cellCount, CH, totalsOf, validateState } from "@bl/schema";
const cfg = defaultConfig({ tileW: 8, tileH: 8, tileD: 4, kernelRadius: 3, lightK: 1024, lightMode: "uniform" });
const s = allocState3(cfg);
const n = cellCount(cfg);
// cy = 20 is outside the 8x8 layer but inside n / W = 32 "rows": feed treats the slab as a 8 x 32 plane
try { applyFeed(s, 3, 20, 1, 5); } catch (e) { console.log('refused (expected since the review):', (e as Error).message); Deno.exit(0); }
const r = applyFeed(s, 3, 20, 1, 5);
const idx: number[] = [];
for (let i = 0; i < n; i++) if (s.cells[CH.A * n + i]) idx.push(i);
console.log("fed", JSON.stringify(r, (_, v) => typeof v === "bigint" ? v.toString() : v), "cells", idx.map((i) => `z${Math.floor(i / 64)}y${Math.floor((i % 64) / 8)}x${i % 8}`).join(","), "valid", validateState(s).length === 0, "matter", totalsOf(cfg, s.cells).matter);
