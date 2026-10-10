import { describe, expect, it } from "vitest";
import { createLabSession } from "../src/session.ts";
import type { CheckpointMeta } from "../src/protocol.ts";

const world = { runId: "spots-s1", presetId: "spots", seed: 1, step: 0, ruleVersion: 1 };

const file = (name: string, step: number, auto = false): CheckpointMeta => ({
  file: name,
  runId: world.runId,
  step,
  bytes: 10,
  savedAt: "2026-10-07T00:00:00.000Z",
  ...(auto ? { auto } : {}),
});

describe("Lab session", () => {
  it("holds a plant while steps past the last Checkpoint are uncovered, and proceeds once keep is set", () => {
    const session = createLabSession();
    session.adopt(world);
    session.noteStep(40);
    expect(session.replace("plant")).toBe("held");
    expect(session.view().held).toBe("plant");
    expect(session.view().loss?.text).toContain("Nothing from this run is saved yet");
    expect(session.replace("plant", "discard")).toBe("proceed");
    expect(session.replace("plant", "save")).toBe("save-then");
  });

  it("covers the step with an automatic Checkpoint and leaves a hand edit uncovered", () => {
    const session = createLabSession();
    session.adopt({ ...world, step: 10 });
    session.noteShelf([]);
    session.noteHand(10);
    session.noteShelf([file("auto.blck", 10, true)]);
    const view = session.view();
    expect(view.hand).toBe(1);
    expect(view.loss?.text).toContain("changes made by hand");
    session.noteManual("hand.blck");
    session.noteShelf([file("auto.blck", 0, true), file("hand.blck", 0)]);
    expect(session.view().hand).toBe(0);
    expect(session.view().loss).toBeNull();
  });

  it("uncovers those hand edits again when that Checkpoint is deleted", () => {
    const session = createLabSession();
    session.adopt({ ...world, step: 10 });
    session.noteHand(10);
    session.noteManual("hand.blck");
    session.noteShelf([file("hand.blck", 10)]);
    expect(session.view().loss).toBeNull();
    session.noteShelf([]);
    expect(session.view().hand).toBe(1);
    expect(session.view().loss?.coveredStep).toBe(10);
  });

  it("records a refused save without replacing the Lab world", () => {
    const session = createLabSession();
    session.adopt(world);
    session.noteStep(5);
    session.noteRefusal("save", "Pond cycle 1 is waiting for its donors: choose them, then save");
    const view = session.view();
    expect(view.refusal?.command).toBe("save");
    expect(view.world?.step).toBe(5);
    expect(view.loss).not.toBeNull();
  });

  it("names the Checkpoint a jump wrote, on the restored Lab world", () => {
    const session = createLabSession();
    session.adopt(world);
    session.noteStep(40);
    session.noteManual("present.blck");
    session.adopt({ ...world, runId: "spots-s1-b", step: 10 });
    session.noteKeptPresent("present.blck", 40);
    const view = session.view();
    expect(view.keptPresent).toEqual({ file: "present.blck", step: 40 });
    expect(view.world?.step).toBe(10);
    expect(view.hand).toBe(0);
    expect(view.loss).toBeNull();
  });

  it("stamps a Replay twin reading when a hand edit is logged at its end step", () => {
    const session = createLabSession();
    session.adopt(world);
    session.noteStep(20);
    session.beginCheck();
    expect(session.view().checking).toBe(true);
    expect(session.view().replay).toBeNull();
    session.noteReplay({ ok: true, from: 0, to: 20, live: "aa", twin: "aa" });
    session.noteHand(4);
    expect(session.view().replay?.handAtEnd).toBe(false);
    session.noteHand(20);
    expect(session.view().replay).toMatchObject({ ok: true, to: 20, handAtEnd: true });
  });

  it("does not treat a Checkpoint from an earlier life of the same run id as covering this Lab world", () => {
    const session = createLabSession();
    session.adopt(world);
    session.noteShelf([file("prior.blck", 100)]);
    session.noteStep(50);
    expect(session.view().loss?.text).toContain("Nothing from this run is saved yet");
    expect(session.replace("plant")).toBe("held");
    session.noteManual("now.blck");
    session.noteShelf([file("prior.blck", 100), file("now.blck", 50)]);
    expect(session.view().loss).toBeNull();
  });

  it("does not ask to keep a Lab world a Checkpoint already covers", () => {
    const session = createLabSession();
    session.adopt({ ...world, step: 40 });
    session.noteShelf([file("t40.blck", 40)]);
    expect(session.view().loss).toBeNull();
    expect(session.replace("restore")).toBe("proceed");
  });

  it("after a shelf it could not list at adoption, counts only the copies this world saved", () => {
    const session = createLabSession();
    // A file opened again under a run id whose older copies are still on the shelf; the listing failed.
    session.adopt({ ...world, step: 50 });
    session.noteStep(100);
    session.noteManual("now.blck");
    session.noteShelf([file("older-life.blck", 150), file("now.blck", 100)]);
    expect(session.view().loss).toBeNull();
    // The older life's copy at t=150 does not cover steps this world has taken since its own save.
    session.noteStep(120);
    expect(session.view().loss?.text).toContain("Its last saved copy is at t=100");
    // An automatic copy counts too, and a copy that may be gone stops counting at once.
    session.noteSaved("auto.blck");
    session.noteShelf([file("older-life.blck", 150), file("now.blck", 100), file("auto.blck", 120, true)]);
    expect(session.view().loss).toBeNull();
    session.noteRemoved("auto.blck");
    expect(session.view().loss?.text).toContain("Its last saved copy is at t=100");
  });

  it("holds a manual copy's hand edits while it may be gone, and gives them back when a listing names it", () => {
    const session = createLabSession();
    session.adopt(world);
    session.noteShelf([]);
    session.noteHand(0);
    session.noteManual("hand.blck");
    session.noteShelf([file("hand.blck", 0)]);
    expect(session.view().hand).toBe(0);
    session.noteRemoved("hand.blck");
    expect(session.view().hand).toBe(1);
    session.noteShelf([file("hand.blck", 0)]);
    expect(session.view().hand).toBe(0);
    // Once a listing leaves it out, it is gone for good.
    session.noteRemoved("hand.blck");
    session.noteShelf([]);
    session.noteShelf([file("hand.blck", 0)]);
    expect(session.view().hand).toBe(1);
  });

  it("downloads the present before a replace when asked, which covers nothing on the shelf", () => {
    const session = createLabSession();
    session.adopt(world);
    session.noteShelf([]);
    session.noteStep(40);
    session.noteHand(40);
    expect(session.replace("import", "download")).toBe("download-then");
    expect(session.view().held).toBeNull();
    // A file handed to the page is no Checkpoint: until the replace lands, the account still counts the loss.
    expect(session.view().loss?.text).toContain("Nothing from this run is saved yet");
    expect(session.view().hand).toBe(1);
    // Nothing to lose, nothing to download.
    session.adopt(world);
    expect(session.replace("plant", "download")).toBe("proceed");
  });
});
