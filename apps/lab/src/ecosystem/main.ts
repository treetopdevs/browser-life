import { COLORS, Ecosystem, FAMILIES, REFUGES } from "./model.ts";
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const world = el<HTMLCanvasElement>("world"), ctx = world.getContext("2d")!;
const chart = el<HTMLCanvasElement>("chart"), plot = chart.getContext("2d")!;
let sim = new Ecosystem(), paused = true;
let debt = 0, last = performance.now(), lastDraw = 0, lastSummary = 0;
const pause = el<HTMLButtonElement>("pause"), step = el<HTMLButtonElement>("step");
function controls(): void { pause.textContent = paused ? "Resume" : "Pause"; step.disabled = !paused; }
function render(): void {
  const scale = world.width / sim.size;
  ctx.fillStyle = "#0b1411"; ctx.fillRect(0, 0, world.width, world.height);
  for (let i = 0; i < sim.cells.length; i++) {
    const x = i % sim.size * scale, y = Math.floor(i / sim.size) * scale, c = sim.cells[i];
    ctx.globalAlpha = c ? 0.5 + c.defense * 0.125 : 0.08 + sim.food[i] / 40;
    ctx.fillStyle = c ? COLORS[c.family] : "#537d56"; ctx.fillRect(x, y, c ? scale - 0.6 : scale, c ? scale - 0.6 : scale);
  }
  ctx.globalAlpha = 1; ctx.strokeStyle = "#afcba47f"; ctx.lineWidth = 1;
  for (const [x, y, radius] of REFUGES) { ctx.beginPath(); ctx.arc(x * world.width, y * world.height, world.width * radius, 0, Math.PI * 2); ctx.stroke(); }
  if (sim.drought) {
    ctx.strokeStyle = "#efb75c"; ctx.setLineDash([5, 5]);
    // Draw wrapped copies because the simulation's geography is toroidal.
    for (const dx of [-sim.size, 0, sim.size]) for (const dy of [-sim.size, 0, sim.size]) { ctx.beginPath(); ctx.arc((sim.drought.x + dx) * scale, (sim.drought.y + dy) * scale, sim.drought.radius * scale, 0, Math.PI * 2); ctx.stroke(); }
    ctx.setLineDash([]);
  }
  const s = sim.census();
  el("clock").textContent = `Tick ${sim.tick.toLocaleString()} · seed ${sim.seed}`;
  el("climate").textContent = sim.drought ? `Dry patch · ${sim.drought.until - sim.tick} ticks left` : "Gentle weather";
  el("families").innerHTML = FAMILIES.map((name, f) => `<div class="family"><span><i class="swatch" style="background:${COLORS[f]}"></i>${name}</span><span>${s.counts[f].toLocaleString()} <span style="color:#92a695">· ${s.population ? (s.counts[f] / s.population * 100).toFixed(1) : 0}%</span></span></div>`).join("");
  if (performance.now() - lastSummary > 1500 || paused) {
    el("summary").textContent = `${s.population.toLocaleString()} living cells · ${s.counts.filter(Boolean).length} families · ${s.classes} inherited strategies. Census at tick ${s.tick}.`;
    lastSummary = performance.now();
  }
  el("traits").textContent = `Population-wide average attack ${s.attack.toFixed(2)} / defense ${s.defense.toFixed(2)}. ${s.mutations.toLocaleString()} mutated births out of ${s.births.toLocaleString()} births; ${s.deaths.toLocaleString()} deaths. Traits range from 0 to 4. Shannon diversity: ${s.diversity.toFixed(2)}.`;
  el("range").textContent = `Ticks ${sim.history[0].tick}–${s.tick} (up to 300 samples).`;
  const bins = Array.from({ length: 5 }, () => Array<number>(5).fill(0));
  for (const c of sim.cells) if (c) bins[c.attack][c.defense]++;
  el("histogram").innerHTML = `<table><caption>Living traits now · attack ↓ / defense →</caption><thead><tr><th scope="col">A / D</th>${[0,1,2,3,4].map(n => `<th scope="col">${n}</th>`).join("")}</tr></thead><tbody>${bins.map((row, a) => `<tr><th scope="row">${a}</th>${row.map(n => `<td>${n || "·"}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  plot.clearRect(0, 0, chart.width, chart.height);
  for (let f = 0; f < 5; f++) {
    plot.strokeStyle = COLORS[f]; plot.lineWidth = 2; plot.beginPath();
    [...sim.history.filter(p => p.tick < s.tick), s].forEach((p, i) => { const x = (p.tick - sim.history[0].tick) / Math.max(1, s.tick - sim.history[0].tick) * chart.width, y = chart.height - p.counts[f] / sim.cells.length * (chart.height - 8); if (i === 0) plot.moveTo(x, y); else plot.lineTo(x, y); }); plot.stroke();
  }
  const list = el("events"); list.replaceChildren();
  for (const event of sim.notices.slice(-15).reverse()) {
    const li = document.createElement("li"), time = document.createElement("time"); time.textContent = `${event.tick}`;
    li.append(time, event.text); list.append(li);
  }
}
pause.onclick = () => { paused = !paused; debt = 0; controls(); render(); };
step.onclick = () => { if (paused) { sim.step(); render(); } };
el("reset").onclick = () => {
  const input = el<HTMLInputElement>("seed");
  if (!input.checkValidity() || !input.value.trim()) { el("error").textContent = "Choose a whole-number seed from 0 to 4294967295."; return; }
  sim = new Ecosystem(Number(input.value)); debt = 0;
  for (const key of ["mutation", "weather"] as const) { const value = el<HTMLInputElement>(key).checked; if (!value) sim.setOption(key, value); }
  el("error").textContent = ""; render();
};
for (const key of ["mutation", "weather"] as const) el<HTMLInputElement>(key).onchange = () => { sim.setOption(key, el<HTMLInputElement>(key).checked); render(); };
for (const [id, family] of [["protected", 3], ["hunter", 4]] as const) el(id).onclick = () => { sim.introduce(family, true); render(); };
el("drought").onclick = () => { sim.dry(); render(); };
el("export").onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(sim.exportSnapshot(), null, 2)], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = `ecosystem-${sim.seed}-${sim.tick}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
document.addEventListener("visibilitychange", () => {
  debt = 0;
  last = performance.now();
  if (document.hidden) {
    paused = true;
    controls();
    render();
  }
});
function frame(now: number): void {
  const elapsed = Math.min(100, now - last); last = now;
  if (!paused && !document.hidden) {
    debt = Math.min(12, debt + elapsed / 1000 * Number(el<HTMLSelectElement>("speed").value));
    const start = performance.now(); while (debt >= 1 && performance.now() - start < 10) { sim.step(); debt--; }
  }
  if (!paused && !document.hidden && now - lastDraw > 100) { render(); lastDraw = now; }
  requestAnimationFrame(frame);
}
el<HTMLInputElement>("seed").value = String(sim.seed);
el<HTMLInputElement>("mutation").checked = sim.mutation;
el<HTMLInputElement>("weather").checked = sim.weather;
controls(); render(); requestAnimationFrame(frame);
