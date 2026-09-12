import { describe, expect, it } from "vitest";
import { RendererPerformanceTracker } from "../../../../packages/shared-ui/src/performance/rendererPerformance";

describe("bounded renderer performance telemetry", () => {
  it("retains fixed-size metric samples and operation names", () => {
    const tracker = new RendererPerformanceTracker();
    for (let index = 0; index < 600; index += 1) {
      tracker.recordInputTransaction(index);
    }
    for (let index = 0; index < 70; index += 1) {
      tracker.recordOperation(`operation-${index}`, index);
    }

    const summary = tracker.getSummary();
    expect(summary.inputTransactions.samples).toBe(512);
    expect(Object.keys(summary.operations)).toHaveLength(64);
    expect(summary.operations["operation-0"]).toBeUndefined();
    expect(summary.operations["operation-69"]?.samples).toBe(1);
    tracker.dispose();
  });
});
