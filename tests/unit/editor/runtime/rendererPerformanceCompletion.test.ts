import { afterEach, describe, expect, it } from "vitest";
import { RendererPerformanceTracker } from "../../../../packages/shared-ui/src/performance/rendererPerformance";

const trackers: RendererPerformanceTracker[] = [];
function createTracker() {
  const tracker = new RendererPerformanceTracker();
  trackers.push(tracker);
  return tracker;
}
afterEach(() => {
  for (const tracker of trackers.splice(0)) tracker.dispose();
});

describe("renderer performance completion boundaries", () => {
  it("keeps the first timing when editing repeats readiness after a completed open", () => {
    const tracker = createTracker();
    const id = tracker.beginFileSelection("note.md");
    tracker.mark(id, "content_ready");
    tracker.mark(id, "preview_ready");
    const before = tracker.getSummary();
    expect(tracker.mark(id, "content_ready")).toBe(true);
    expect(tracker.mark(id, "preview_ready")).toBe(true);
    const after = tracker.getSummary();
    expect(after.traces).toEqual(before.traces);
    expect(after.stages).toEqual(before.stages);
    expect(after.completedSamples).toBe(1);
    expect(after.staleCommitCount).toBe(0);
  });

  it("still rejects a previously unseen stage after completion", () => {
    const tracker = createTracker();
    const id = tracker.beginFileSelection("note.md");
    tracker.mark(id, "preview_ready");
    expect(tracker.mark(id, "content_ready")).toBe(false);
    expect(tracker.getSummary().staleCommitCount).toBe(1);
    expect(tracker.getSummary().traces[0].stages.content_ready).toBeUndefined();
  });

  it("still rejects cancelled, unknown and wrong-document observations", () => {
    const tracker = createTracker();
    const oldId = tracker.beginFileSelection("old.md");
    tracker.mark(oldId, "content_ready");
    tracker.beginFileSelection("next.md");
    expect(tracker.mark(oldId, "content_ready")).toBe(false);
    expect(tracker.mark("unknown", "content_ready")).toBe(false);
    expect(tracker.markActiveDocument("old.md", "preview_ready")).toBe(false);
    expect(tracker.getSummary().staleCommitCount).toBe(3);
    expect(tracker.getSummary().completedSamples).toBe(0);
  });
});
