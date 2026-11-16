// Ported from the 3D volume sandbox. Tracks GPU resources so unmount() provably frees them. `Disposer.live` counts every
// tracked resource that has not been destroyed yet, across all disposers; the slab e2e spec checks it stays flat over
// repeated renderer switches.

type Destroyable = { destroy(): void };

export class Disposer {
  static live = 0;
  private items: Destroyable[] = [];

  add<T extends Destroyable>(resource: T): T {
    this.items.push(resource);
    Disposer.live++;
    return resource;
  }

  get size(): number {
    return this.items.length;
  }

  /** Destroys everything added since the last call, newest first. Safe to call twice. */
  disposeAll(): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      try { this.items[i]!.destroy(); } catch { /* already lost with the device */ }
      Disposer.live--;
    }
    this.items = [];
  }
}
