import { describe, expect, it } from "vitest";
import { createWorkspaceMutationTracker } from "../../../../electron/main/workspace-mutation-tracker.mjs";

describe("workspace mutation tracker", () => {
  it("guards active writes and advances the epoch after success", async () => {
    const tracker = createWorkspaceMutationTracker();
    let finish;
    const pending = tracker.run("/workspace", () => new Promise((resolve) => { finish = resolve; }));
    const captured = tracker.capture("/workspace");
    expect(captured).toEqual({ epoch: 0, idle: false });
    expect(tracker.isCurrentAndIdle("/workspace", captured.epoch)).toBe(false);

    finish("done");
    await expect(pending).resolves.toBe("done");
    expect(tracker.capture("/workspace")).toEqual({ epoch: 1, idle: true });
  });

  it("invalidates the epoch after a failed mutation attempt", async () => {
    const tracker = createWorkspaceMutationTracker();
    const before = tracker.capture("/workspace");
    await expect(tracker.run("/workspace", async () => {
      throw new Error("partial write");
    })).rejects.toThrow("partial write");
    expect(tracker.isCurrentAndIdle("/workspace", before.epoch)).toBe(false);
    expect(tracker.capture("/workspace")).toEqual({ epoch: 1, idle: true });
  });
});
