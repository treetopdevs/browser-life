// Node 24. Replays v4 staged seeds unchanged, verifies tick 3000, captures every 25 ticks.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { Ecosystem, RULES, COLORS } from "../../apps/lab/src/ecosystem/model.ts";
const out = "runs/ecosystem-20k";
mkdirSync(out, { recursive: true });
const prior = JSON.parse(readFileSync("docs/ecosystem-sandbox-exploration.json", "utf8"));
const colors = COLORS.map(c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)));
const sourceHash = createHash("sha256").update(readFileSync("apps/lab/src/ecosystem/model.ts")).digest("hex");
for (const seed of [1101, 1102, 1103]) {
  const sim = new Ecosystem(seed, 96, true), samples = [], notices = [], seenNotices = new Set<string>(), seenTraits = new Set<number>();
  let previous = new Int16Array(96 * 96).fill(-1), changes = 0;
  const video = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "rawvideo", "-pixel_format", "rgb24", "-video_size", "96x96", "-framerate", "20", "-i", "pipe:0", "-vf", "scale=576:576:flags=neighbor", "-c:v", "libx264", "-preset", "fast", "-crf", "19", "-pix_fmt", "yuv420p", "-movflags", "+faststart", `${out}/seed-${seed}.mp4`], { stdio: ["pipe", "ignore", "inherit"] });
  const finished = once(video, "close");
  for (let tick = 0; tick <= 20000; tick++) {
    if (tick > 0) sim.step();
    if (tick === 3000) {
      const expected = prior.results.find((r: any) => r.seed === seed && r.staged).final;
      if (JSON.stringify(sim.census()) !== JSON.stringify(expected)) throw new Error(`3000-tick replay mismatch: ${seed}`);
      console.log(`seed ${seed}: exact 3000-tick census replay verified`);
    }
    if (tick % 25 !== 0) continue;
    const pixels = Buffer.alloc(96 * 96 * 3), bins = Array<number>(125).fill(0);
    let changed = 0;
    sim.cells.forEach((c, i) => {
      const key = c ? c.family * 25 + c.attack * 5 + c.defense : -1;
      if (key !== previous[i]) changed++; previous[i] = key;
      if (c) bins[key]++;
      const rgb = c ? colors[c.family].map(v => Math.round(v * (0.5 + c.defense * 0.125))) : [11 + sim.food[i] * 3, 20 + sim.food[i] * 5, 17 + sim.food[i] * 3];
      for (let k = 0; k < 3; k++) pixels[i * 3 + k] = rgb[k];
    });
    changes += tick ? changed : 0;
    if (!video.stdin.write(pixels)) await once(video.stdin, "drain");
    for (const n of sim.notices) { const key = JSON.stringify(n); if (!seenNotices.has(key)) { seenNotices.add(key); notices.push(n); } }
    if (tick % 100 === 0) {
      const newlySeen = bins.flatMap((n, i) => n && !seenTraits.has(i) ? [i] : []);
      for (const i of newlySeen) seenTraits.add(i);
      samples.push({ ...sim.census(), bins, spatialChangePer25: tick ? changes / (4 * sim.cells.length) : 0, newlySeen }); changes = 0;
    }
    if (tick && tick % 5000 === 0) console.log(`seed ${seed}: ${tick} ticks, ${sim.census().counts.join("/")}`);
  }
  video.stdin.end(); const [code] = await finished; if (code !== 0) throw new Error(`ffmpeg exit ${code}`);
  writeFileSync(`${out}/seed-${seed}.json`, JSON.stringify({ seed, rules: RULES, sourceHash, ticks: 20000, captureEvery: 25, fps: 20, replay3000: true, samples, notices }, null, 2));
  console.log(`seed ${seed}: saved animation and full census history`);
}
