// The live jars on /story/. Each `<figure class="story-jar" data-jar="…">` holds a still picture until its Grow it
// button is pressed; then the world is made in a worker (the same worker its own page uses) and drawn here. Nothing
// runs until asked, one jar grows at a time, and a jar scrolled out of sight waits until it is back.
import type { RoamFromWorker, RoamToWorker } from "../roam/view.ts";
import type { SoftRoamFromWorker, SoftRoamToWorker } from "../softroam/view.ts";
import { JARS, roamLine, roamOptions, softRoamOptions, softRoamSeed, type JarId, type JarSpec } from "./jars-spec.ts";

/** What a world's worker is asked, and what the host needs back from a frame. */
interface Driver {
  start(choice: string): void;
  /** Ask for up to `steps` more steps and a picture. */
  tick(steps: number): void;
  /** Draws an answer and returns the line to show under it (null for an answer of a world since replaced), or throws with the worker's message. */
  show(data: unknown, ctx: CanvasRenderingContext2D): string | null;
  stop(): void;
}

function blit(ctx: CanvasRenderingContext2D, pixels: Uint8ClampedArray, side: number): void {
  const canvas = ctx.canvas;
  if (canvas.width !== side) { canvas.width = side; canvas.height = side; }
  ctx.putImageData(new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, side, side), 0, 0);
}

function softRoamDriver(spec: JarSpec, wire: Wire, say: (text: string) => void): Driver {
  let worker: Worker | null = null;
  let gen = 0;
  const post = (m: SoftRoamToWorker, transfer: Transferable[] = []) => worker?.postMessage(m, transfer);
  return {
    start(choice) {
      worker?.terminate();
      worker = wire(new Worker(new URL("../softroam/softroam.worker.ts", import.meta.url), { type: "module" }));
      gen++;
      const seed = softRoamSeed(choice, Math.random());
      if (choice === "fresh") say(`Seed ${seed}, drawn now. We have not run it.`);
      post({ type: "reset", gen, opts: softRoamOptions(seed), scale: spec.side / 128, paint: "garden" });
    },
    tick(steps) { post({ type: "advance", gen, steps, alpha: 1, paint: "garden", budgetMs: 40 }); },
    show(data, ctx) {
      const m = data as SoftRoamFromWorker;
      if (m.gen !== gen) return null;
      if (m.type === "error") throw new Error(m.message);
      const { pixels, side, census } = m.frame;
      blit(ctx, pixels, side);
      // The pixels have been copied onto the canvas: the worker paints the next frame into the same memory.
      post({ type: "recycle", gen, buffer: pixels.buffer as ArrayBuffer }, [pixels.buffer as ArrayBuffer]);
      return roamLine(census, true);
    },
    stop() { worker?.terminate(); worker = null; },
  };
}

function roamDriver(spec: JarSpec, wire: Wire): Driver {
  let worker: Worker | null = null;
  let gen = 0;
  let kinds = true;
  const post = (m: RoamToWorker) => worker?.postMessage(m);
  return {
    start(choice) {
      worker?.terminate();
      worker = wire(new Worker(new URL("../roam/roam.worker.ts", import.meta.url), { type: "module" }));
      gen++;
      kinds = choice !== "alike";
      post({ type: "reset", gen, opts: roamOptions(choice), scale: spec.side / 128, paint: "garden" });
    },
    tick(steps) { post({ type: "tick", gen, steps, paint: "garden" }); },
    show(data, ctx) {
      const m = data as RoamFromWorker;
      if (m.gen !== gen) return null;
      if (m.type === "error") throw new Error(m.message);
      blit(ctx, m.frame.pixels, m.frame.side);
      return roamLine(m.frame.census, kinds);
    },
    stop() { worker?.terminate(); worker = null; },
  };
}

/** Sends a new worker's answers and failures to the jar that made it. */
type Wire = (worker: Worker) => Worker;

/** The jar that is growing, if any: starting another pauses it. */
let growing: Jar | null = null;

class Jar {
  private readonly spec: JarSpec;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly play: HTMLButtonElement;
  private readonly again: HTMLButtonElement;
  private readonly line: HTMLElement;
  private readonly says: HTMLElement;
  private readonly note: HTMLElement;
  private readonly driver: Driver;
  private choice: string;
  private started = false;
  private playing = false;
  private waiting = false;
  private inView = true;
  private owed = 0;
  private last = 0;
  private raf = 0;
  /** The worker of the world on screen. */
  private current: Worker | null = null;

  constructor(private readonly root: HTMLElement, id: JarId) {
    this.spec = JARS[id];
    this.choice = this.spec.choices[0].id;
    this.canvas = root.querySelector("canvas")!;
    this.ctx = this.canvas.getContext("2d")!;
    this.play = root.querySelector(".jar-play")!;
    this.again = root.querySelector(".jar-again")!;
    this.line = root.querySelector(".jar-line")!;
    this.says = root.querySelector(".jar-says")!;
    this.note = root.querySelector(".jar-note")!;
    // A start replaces the worker. Anything a replaced worker still says, an answer or a failure, is dropped: it
    // must never stop the world that took its place.
    const wire: Wire = (worker) => {
      this.current = worker;
      worker.addEventListener("message", (event) => { if (this.current === worker) this.onAnswer(event.data); });
      worker.addEventListener("error", (event) => { if (this.current === worker) this.fail(new Error(event.message || "the worker stopped")); });
      return worker;
    };
    this.driver = id === "softroam" ? softRoamDriver(this.spec, wire, (t) => this.announce(t)) : roamDriver(this.spec, wire);
    this.buildChoices();
    this.play.disabled = false;
    this.play.addEventListener("click", () => this.toggle());
    this.again.addEventListener("click", () => this.restart());
    new IntersectionObserver((entries) => {
      this.inView = entries.some((e) => e.isIntersecting);
      this.pump();
    }, { threshold: 0.05 }).observe(root);
  }

  private buildChoices(): void {
    const box = this.root.querySelector<HTMLElement>(".jar-choices")!;
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", this.spec.choiceLabel);
    for (const c of this.spec.choices) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "button seg";
      b.textContent = c.label;
      b.dataset.choice = c.id;
      b.setAttribute("aria-pressed", String(c.id === this.choice));
      b.addEventListener("click", () => this.choose(c.id));
      box.append(b);
    }
    this.sayChoice();
  }

  private sayChoice(): void {
    const c = this.spec.choices.find((x) => x.id === this.choice)!;
    this.says.textContent = c.says;
  }

  private choose(id: string): void {
    // The fresh seed is drawn again on every press; any other choice already in force changes nothing.
    if (id === this.choice && id !== "fresh") return;
    this.choice = id;
    for (const b of this.root.querySelectorAll<HTMLButtonElement>(".jar-choices button")) b.setAttribute("aria-pressed", String(b.dataset.choice === id));
    this.sayChoice();
    if (this.started) this.restart();
  }

  private announce(text: string): void { this.note.textContent = text; }

  private toggle(): void {
    if (!this.started) { this.restart(); return; }
    this.setPlaying(!this.playing);
    this.announce(this.playing ? "Growing." : "Paused.");
  }

  private restart(): void {
    this.root.classList.add("live");
    this.started = true;
    this.owed = 0;
    this.waiting = true;
    this.again.hidden = false;
    try {
      this.driver.start(this.choice);
    } catch (error) {
      this.fail(error);
      return;
    }
    this.setPlaying(true);
    if (this.choice !== "fresh") this.announce("Growing.");
  }

  private onAnswer(data: unknown): void {
    let line: string | null;
    try {
      line = this.driver.show(data, this.ctx);
    } catch (error) {
      this.fail(error);
      return;
    }
    if (line === null) return;
    this.waiting = false;
    this.line.textContent = line;
    this.pump();
  }

  private fail(error: unknown): void {
    this.current = null;
    this.driver.stop();
    this.started = false;
    this.waiting = false;
    this.setPlaying(false);
    this.play.textContent = "Grow it";
    this.announce(`This jar could not grow here: ${error instanceof Error ? error.message : String(error)}`);
  }

  setPlaying(on: boolean): void {
    if (on && growing && growing !== this) {
      const other = growing;
      other.setPlaying(false);
      other.announce("Paused while another jar grows.");
    }
    this.playing = on;
    if (on) growing = this;
    else if (growing === this) growing = null;
    this.play.textContent = on ? "Pause" : this.started ? "Grow on" : "Grow it";
    this.play.classList.toggle("growing", on);
    this.last = performance.now();
    this.pump();
  }

  /** Ask for the next frame when one is due: at most one request is out, and none while paused or out of sight. */
  private pump(): void {
    if (this.raf || !this.playing || !this.inView || this.waiting) return;
    this.raf = requestAnimationFrame((now) => {
      this.raf = 0;
      if (!this.playing || !this.inView || this.waiting) return;
      // Time away (another tab, a long pause) is not owed: at most a tenth of a second is made up.
      const dt = Math.min(100, Math.max(0, now - this.last));
      this.last = now;
      this.owed = Math.min(this.owed + (this.spec.pace * dt) / 1000, this.spec.pace / 4);
      const steps = Math.floor(this.owed);
      if (steps < 1) { this.pump(); return; }
      this.owed -= steps;
      this.waiting = true;
      this.driver.tick(steps);
    });
  }
}

export function startJars(doc: Document = document): void {
  for (const root of doc.querySelectorAll<HTMLElement>("figure.story-jar[data-jar]")) {
    const id = root.dataset.jar as JarId;
    if (!(id in JARS)) continue;
    new Jar(root, id);
  }
}

startJars();
