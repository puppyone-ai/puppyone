import { describe, expect, it, vi } from "vitest";
import { FileOpenRequestCoordinator } from "../../../../packages/shared-ui/src/data/file-open/fileOpenRequestCoordinator";
import { RendererPerformanceTracker } from "../../../../packages/shared-ui/src/performance/rendererPerformance";

describe("revision-bound file opening", () => {
  it("aborts A and prevents every stale A commit after B starts", () => {
    const onStaleCommit = vi.fn();
    const coordinator = new FileOpenRequestCoordinator({ onStaleCommit });
    const requestA = coordinator.begin("A.md");
    const commitA = vi.fn();
    const requestB = coordinator.begin("B.md");
    const commitB = vi.fn();

    expect(requestA.signal.aborted).toBe(true);
    expect(requestA.commit(commitA)).toBe(false);
    expect(commitA).not.toHaveBeenCalled();
    expect(requestB.commit(commitB)).toBe(true);
    expect(commitB).toHaveBeenCalledTimes(1);
    expect(onStaleCommit).toHaveBeenCalledTimes(1);
  });

  it("summarizes at least 30 production-style stage samples with p50/p95", () => {
    const tracker = new RendererPerformanceTracker();
    tracker.reset();
    for (let index = 0; index < 30; index += 1) {
      const trace = tracker.beginFileSelection(`note-${index}.md`);
      tracker.mark(trace, "preview_shell_committed");
      tracker.mark(trace, "content_ready");
      tracker.mark(trace, "editor_base_ready");
      tracker.mark(trace, "preview_ready");
    }

    const summary = tracker.getSummary();
    expect(summary.completedSamples).toBe(30);
    expect(summary.stages.preview_shell_committed?.samples).toBe(30);
    expect(summary.stages.editor_base_ready?.p50).toBeTypeOf("number");
    expect(summary.stages.editor_base_ready?.p95).toBeTypeOf("number");
    expect(summary.staleCommitCount).toBe(0);
    tracker.dispose();
  });
});
