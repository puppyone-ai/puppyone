import { describe, expect, it } from "vitest";
import {
  EXPLORER_RESIZE_GUTTER_WIDTH,
  MAX_EXPLORER_WIDTH,
  MIN_EXPLORER_WIDTH,
  MIN_MAIN_PANE_WIDTH,
  MIN_RIGHT_SIDEBAR_WIDTH,
  resolveDesktopPaneLayout,
} from "../../../../src/features/app-shell/layout/desktopPaneLayout";

describe("desktop three-pane layout", () => {
  it("uses the compact 220px product floor for the left explorer", () => {
    expect(MIN_EXPLORER_WIDTH).toBe(220);
  });

  it("keeps independent preferred side widths while the main pane owns spare space", () => {
    const layout = resolveLayout({ availableWidth: 1440 });

    expect(layout.explorer.width).toBe(320);
    expect(layout.rightSidebar.width).toBe(560);
    expect(layout.main.width).toBe(552);
    expect(layout.main.minWidth).toBe(MIN_MAIN_PANE_WIDTH);
  });

  it("keeps the Explorer cap but lets the auxiliary pane consume safe spare width", () => {
    const layout = resolveLayout({
      availableWidth: 2200,
      explorerWidth: 1200,
      rightSidebarWidth: 1600,
    });

    expect(layout.explorer.width).toBe(MAX_EXPLORER_WIDTH);
    expect(layout.explorer.maxWidth).toBe(MAX_EXPLORER_WIDTH);
    expect(layout.rightSidebar.width).toBe(1352);
    expect(layout.rightSidebar.maxWidth).toBe(1352);
    expect(layout.main.width).toBe(MIN_MAIN_PANE_WIDTH);
  });

  it("derives the auxiliary maximum from the live workbench instead of a pixel cap", () => {
    const compact = resolveLayout({ availableWidth: 1440 });
    const wide = resolveLayout({ availableWidth: 2200 });

    expect(compact.rightSidebar.maxWidth).toBe(792);
    expect(wide.rightSidebar.maxWidth).toBe(1552);
    expect(wide.rightSidebar.maxWidth).toBeGreaterThan(compact.rightSidebar.maxWidth);
  });

  it("still honors an explicit host maximum", () => {
    const layout = resolveDesktopPaneLayout({
      availableWidth: 2200,
      explorer: {
        collapsed: false,
        preferredWidth: 320,
        present: true,
      },
      rightSidebar: {
        maxWidth: 900,
        open: true,
        preferredWidth: 1600,
        present: true,
      },
    });

    expect(layout.rightSidebar.width).toBe(900);
    expect(layout.rightSidebar.maxWidth).toBe(900);
    expect(layout.main.width).toBe(972);
  });

  it("compresses only the main pane before touching either sidebar", () => {
    const wide = resolveLayout({ availableWidth: 1440 });
    const compressed = resolveLayout({ availableWidth: 1240 });

    expect(compressed.explorer.width).toBe(wide.explorer.width);
    expect(compressed.rightSidebar.width).toBe(wide.rightSidebar.width);
    expect(compressed.main.width).toBe(wide.main.width - 200);
  });

  it("shrinks the auxiliary pane alone after the main pane reaches its minimum", () => {
    const layout = resolveLayout({ availableWidth: 1100 });

    expect(layout.main.width).toBe(MIN_MAIN_PANE_WIDTH);
    expect(layout.explorer.width).toBe(320);
    expect(layout.rightSidebar.width).toBe(452);
  });

  it("shrinks the explorer only after the auxiliary pane reaches its own minimum", () => {
    const layout = resolveLayout({ availableWidth: 900 });

    expect(layout.main.width).toBe(MIN_MAIN_PANE_WIDTH);
    expect(layout.rightSidebar.width).toBe(MIN_RIGHT_SIDEBAR_WIDTH);
    expect(layout.explorer.width).toBe(252);
  });

  it("raises the workbench minimum instead of proportionally violating pane minima", () => {
    const layout = resolveLayout({ availableWidth: 640 });
    const expectedMinimum = MIN_EXPLORER_WIDTH
      + EXPLORER_RESIZE_GUTTER_WIDTH
      + MIN_MAIN_PANE_WIDTH
      + MIN_RIGHT_SIDEBAR_WIDTH;

    expect(layout.availableWidth).toBe(640);
    expect(layout.minimumWidth).toBe(expectedMinimum);
    expect(layout.explorer.width).toBe(MIN_EXPLORER_WIDTH);
    expect(layout.main.width).toBe(MIN_MAIN_PANE_WIDTH);
    expect(layout.rightSidebar.width).toBe(MIN_RIGHT_SIDEBAR_WIDTH);
    expect(
      layout.explorer.width
        + EXPLORER_RESIZE_GUTTER_WIDTH
        + layout.main.width
        + layout.rightSidebar.width,
    ).toBe(expectedMinimum);
  });

  it("keeps visibility mapped directly from user state at every width", () => {
    for (const availableWidth of [640, 900, 1440]) {
      const hidden = resolveLayout({
        availableWidth,
        explorerCollapsed: true,
        rightSidebarOpen: false,
      });
      const visible = resolveLayout({ availableWidth });

      expect(hidden.explorer.collapsed).toBe(true);
      expect(hidden.explorer.width).toBe(0);
      expect(hidden.rightSidebar.open).toBe(false);
      expect(hidden.rightSidebar.width).toBe(0);
      expect(visible.explorer.collapsed).toBe(false);
      expect(visible.rightSidebar.open).toBe(true);
    }
  });

  it("restores saved preferred widths without a visibility-state transition", () => {
    const compact = resolveLayout({ availableWidth: 900, explorerWidth: 380 });
    const restored = resolveLayout({ availableWidth: 1600, explorerWidth: 380 });

    expect(compact.explorer.collapsed).toBe(false);
    expect(compact.rightSidebar.open).toBe(true);
    expect(restored.explorer.collapsed).toBe(false);
    expect(restored.rightSidebar.open).toBe(true);
    expect(restored.explorer.width).toBe(380);
    expect(restored.rightSidebar.width).toBe(560);
  });

  it("uses the 640px product floor when only the right sidebar is open", () => {
    const layout = resolveLayout({
      availableWidth: 640,
      explorerCollapsed: true,
      rightSidebarOpen: true,
    });

    expect(layout.minimumWidth).toBe(640);
    expect(layout.main.width).toBe(MIN_MAIN_PANE_WIDTH);
    expect(layout.rightSidebar.width).toBe(MIN_RIGHT_SIDEBAR_WIDTH);
  });

  it.each([640, 888, 900, 968, 1100, 1208, 1440, 1920])(
    "preserves every pane contract at %ipx without automatic visibility changes",
    (availableWidth) => {
      const layout = resolveLayout({ availableWidth });

      expect(layout.explorer.width).toBeGreaterThanOrEqual(layout.explorer.minWidth);
      expect(layout.explorer.width).toBeLessThanOrEqual(layout.explorer.maxWidth);
      expect(layout.main.width).toBeGreaterThanOrEqual(layout.main.minWidth);
      expect(layout.rightSidebar.width).toBeGreaterThanOrEqual(layout.rightSidebar.minWidth);
      expect(layout.rightSidebar.width).toBeLessThanOrEqual(layout.rightSidebar.maxWidth);
      expect(layout.explorer.collapsed).toBe(false);
      expect(layout.rightSidebar.open).toBe(true);
    },
  );
});

function resolveLayout({
  availableWidth,
  explorerCollapsed = false,
  explorerWidth = 320,
  rightSidebarOpen = true,
  rightSidebarWidth = 560,
}: {
  availableWidth: number;
  explorerCollapsed?: boolean;
  explorerWidth?: number;
  rightSidebarOpen?: boolean;
  rightSidebarWidth?: number;
}) {
  return resolveDesktopPaneLayout({
    availableWidth,
    explorer: {
      collapsed: explorerCollapsed,
      preferredWidth: explorerWidth,
      present: true,
    },
    rightSidebar: {
      open: rightSidebarOpen,
      preferredWidth: rightSidebarWidth,
      present: true,
    },
  });
}
