import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTO_SAVE_IDLE_MS,
  AUTO_SAVE_MAX_WAIT_MS,
  createIdleAutoSaveScheduler,
} from "../../../../src/shared-ui/editor/document-session/autoSavePolicy";

describe("idle auto-save scheduler", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("saves once after the quiet period, restarting it on each edit", () => {
    const save = vi.fn();
    const scheduler = createIdleAutoSaveScheduler(save);
    scheduler.schedule();
    vi.advanceTimersByTime(AUTO_SAVE_IDLE_MS - 100);
    scheduler.schedule();
    vi.advanceTimersByTime(AUTO_SAVE_IDLE_MS - 1);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(AUTO_SAVE_MAX_WAIT_MS * 2);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("bounds the wait from the first unsaved edit while edits keep arriving", () => {
    const save = vi.fn();
    const scheduler = createIdleAutoSaveScheduler(save);
    for (let elapsed = 0; elapsed < AUTO_SAVE_MAX_WAIT_MS - 50; elapsed += 50) {
      scheduler.schedule();
      vi.advanceTimersByTime(50);
    }
    expect(save).not.toHaveBeenCalled();
    scheduler.schedule();
    vi.advanceTimersByTime(50);
    expect(save).toHaveBeenCalledTimes(1);
    // The bound restarts after a save: the next burst again waits for a pause.
    scheduler.schedule();
    vi.advanceTimersByTime(AUTO_SAVE_IDLE_MS - 1);
    expect(save).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("honours custom delays", () => {
    const save = vi.fn();
    const scheduler = createIdleAutoSaveScheduler(save, { idleMs: 10, maxWaitMs: 25 });
    for (let index = 0; index < 5; index++) { scheduler.schedule(); vi.advanceTimersByTime(6); }
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("flushes only a pending save, immediately", () => {
    const save = vi.fn();
    const scheduler = createIdleAutoSaveScheduler(save);
    scheduler.flush();
    expect(save).not.toHaveBeenCalled();
    scheduler.schedule();
    scheduler.flush();
    expect(save).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(AUTO_SAVE_MAX_WAIT_MS);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("cancels and disposes without saving later", () => {
    const save = vi.fn();
    const scheduler = createIdleAutoSaveScheduler(save);
    scheduler.schedule();
    scheduler.cancel();
    vi.advanceTimersByTime(AUTO_SAVE_MAX_WAIT_MS);
    expect(save).not.toHaveBeenCalled();
    scheduler.schedule();
    scheduler.dispose();
    scheduler.schedule();
    scheduler.flush();
    vi.advanceTimersByTime(AUTO_SAVE_MAX_WAIT_MS);
    expect(save).not.toHaveBeenCalled();
  });
});
