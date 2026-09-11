import { describe, expect, it, vi } from "vitest";
import { createNativeSurfaceResizeCursor } from "../electron/main/native-surfaces/resize-cursor.mjs";

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
describe("native resize cursor lifetime", () => {
  it("restores the content cursor and removes an insertion that completes after leave", async () => {
    let resolve;
    const contents = { insertCSS: vi.fn(() => new Promise(done => { resolve = done; })), removeInsertedCSS: vi.fn() };
    const cursor = createNativeSurfaceResizeCursor(contents);
    cursor.set("col-resize"); await flush();
    cursor.set(null); resolve("late-sheet"); await flush();
    expect(contents.removeInsertedCSS).toHaveBeenCalledWith("late-sheet");
    expect(contents.insertCSS).toHaveBeenCalledWith(expect.stringContaining("col-resize"), { cssOrigin: "author" });
  });
  it("deduplicates moves, rejects unsupported values and restores on disposal", async () => {
    const contents = { insertCSS: vi.fn(async () => "sheet"), removeInsertedCSS: vi.fn() };
    const cursor = createNativeSurfaceResizeCursor(contents);
    cursor.set("row-resize"); await flush(); cursor.set("row-resize"); cursor.set("text");
    expect(contents.insertCSS).toHaveBeenCalledTimes(1);
    cursor.dispose(); await flush();
    expect(contents.removeInsertedCSS).toHaveBeenCalledExactlyOnceWith("sheet");
  });
});
