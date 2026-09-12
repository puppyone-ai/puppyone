/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  EXPLORER_WIDTH_STORAGE_KEY,
  RIGHT_SIDEBAR_WIDTH_STORAGE_KEY,
  readInitialExplorerWidth,
  readInitialRightSidebarWidth,
} from "../../../../src/features/app-shell/preferences";
import {
  DEFAULT_EXPLORER_WIDTH,
  DEFAULT_RIGHT_SIDEBAR_WIDTH,
  MIN_EXPLORER_WIDTH,
  MIN_RIGHT_SIDEBAR_WIDTH,
} from "../../../../src/features/app-shell/layout/desktopPaneLayout";

afterEach(() => window.localStorage.clear());

describe("desktop pane width preferences", () => {
  it("uses product defaults when no pane widths were stored", () => {
    expect(readInitialExplorerWidth()).toBe(DEFAULT_EXPLORER_WIDTH);
    expect(readInitialRightSidebarWidth()).toBe(DEFAULT_RIGHT_SIDEBAR_WIDTH);
  });

  it("sanitizes values below each pane minimum", () => {
    window.localStorage.setItem(EXPLORER_WIDTH_STORAGE_KEY, "10");
    window.localStorage.setItem(RIGHT_SIDEBAR_WIDTH_STORAGE_KEY, "20");

    expect(readInitialExplorerWidth()).toBe(MIN_EXPLORER_WIDTH);
    expect(readInitialRightSidebarWidth()).toBe(MIN_RIGHT_SIDEBAR_WIDTH);
  });

  it("preserves large preferred widths for the dynamic shell constraint", () => {
    window.localStorage.setItem(EXPLORER_WIDTH_STORAGE_KEY, "900");
    window.localStorage.setItem(RIGHT_SIDEBAR_WIDTH_STORAGE_KEY, "1400");

    expect(readInitialExplorerWidth()).toBe(900);
    expect(readInitialRightSidebarWidth()).toBe(1400);
  });
});
