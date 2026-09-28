/** Streaming physical parity transcript for the A2 colored/uncolored garden pair. */
import { createHash } from "node:crypto";
import { assertColorSnapshotParity, type ColorSnapshot } from "./foundation-copy-ancestry.ts";

export class V2ParityTranscript {
  private nextStep = 0;
  private readonly hash = createHash("sha256");
  private lastDigest: string | null = null;

  observe(original: ColorSnapshot, colored: ColorSnapshot): void {
    if (this.lastDigest !== null || original.step !== this.nextStep)
      throw new Error(`A2 parity expected exact step ${this.nextStep}`);
    assertColorSnapshotParity(original, colored);
    this.hash.update(String(original.step)).update("\n");
    for (const snapshot of [original, colored]) {
      this.hash.update(new Uint8Array(snapshot.cells.buffer, snapshot.cells.byteOffset,
        snapshot.cells.byteLength));
      this.hash.update(new Uint8Array(snapshot.genomeHead.buffer, snapshot.genomeHead.byteOffset,
        snapshot.genomeHead.byteLength));
      this.hash.update(snapshot.flux.map(String).join(",")).update("\n");
    }
    this.nextStep++;
  }

  finish(): { throughStep: number; parityTranscriptSha256: string } {
    if (this.nextStep < 1) throw new Error("A2 parity transcript has no step-0 snapshot");
    this.lastDigest ??= this.hash.digest("hex");
    return { throughStep: this.nextStep - 1, parityTranscriptSha256: this.lastDigest };
  }

  snapshot(): { throughStep: number; parityTranscriptSha256: string } {
    if (this.nextStep < 1) throw new Error("A2 parity transcript has no step-0 snapshot");
    return { throughStep: this.nextStep - 1,
      parityTranscriptSha256: this.lastDigest ?? this.hash.copy().digest("hex") };
  }
}
