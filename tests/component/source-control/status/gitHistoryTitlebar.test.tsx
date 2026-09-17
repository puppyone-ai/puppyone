/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopTitlebarActions } from "../../../../src/features/app-shell/DesktopTitlebarActions";
import { DEFAULT_TITLEBAR_ACTIONS_SETTINGS } from "../../../../src/preferences";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("Git right-sidebar titlebar entries", () => {
  it("keeps the high-frequency Changes entry and removes standalone History", () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const onToggleGitChanges = vi.fn();

    act(() => root?.render(withTestLocalization(
      <DesktopTitlebarActions
        titlebarActionsSettings={{
          ...DEFAULT_TITLEBAR_ACTIONS_SETTINGS,
          order: ["terminal", "changes"],
        }}
        terminalSidebarOpen={false}
        terminalToolEnabled
        gitChangesAvailable
        gitChangesOpen
        gitChangesStatus={{ conflicts: 0, incoming: 4, localChanges: 12, outgoing: 2 }}
        onToggleTerminal={vi.fn()}
        onToggleGitChanges={onToggleGitChanges}
      />,
    )));

    const history = container.querySelector<HTMLButtonElement>(".desktop-titlebar-history");
    const changes = container.querySelector<HTMLButtonElement>(".desktop-titlebar-changes");
    expect(history).toBeNull();
    expect(changes?.getAttribute("aria-label")).toContain("Changes, 12 files");
    expect(changes?.getAttribute("aria-label")).toContain("Pull 4 commits");
    expect(changes?.getAttribute("aria-label")).toContain("2 local commits waiting");
    expect(changes?.getAttribute("aria-pressed")).toBe("true");
    expect(Array.from(changes?.children ?? []).some((child) => child.tagName === "svg"))
      .toBe(false);
    expect(changes?.querySelector(".desktop-titlebar-git-indicator.local")?.textContent).toBe("12");
    expect(changes?.querySelector(".desktop-titlebar-git-indicator.local .lucide-asterisk"))
      .not.toBeNull();
    expect(changes?.querySelector(".desktop-titlebar-git-indicator.incoming")?.textContent).toBe("4");
    expect(changes?.querySelector(".desktop-titlebar-git-indicator.incoming .lucide-arrow-down"))
      .not.toBeNull();
    expect(changes?.querySelector(".desktop-titlebar-git-indicator.outgoing")?.textContent).toBe("2");
    expect(changes?.querySelector(".desktop-titlebar-git-indicator.outgoing .lucide-arrow-up"))
      .not.toBeNull();
    expect(Array.from(changes?.querySelectorAll(".desktop-titlebar-git-indicator") ?? []).map(
      (indicator) => Array.from(indicator.classList).at(-1),
    )).toEqual(["incoming", "outgoing", "local"]);
    expect(Array.from(container.querySelectorAll(".desktop-titlebar-action")).map(
      (button) => button.getAttribute("aria-label"),
    )).toEqual([
      "Changes, 12 files, Pull 4 commits, 2 local commits waiting.",
      "Show Agent",
    ]);
    const dividers = container.querySelectorAll(".desktop-titlebar-action-divider");
    expect(dividers).toHaveLength(1);
    expect(changes?.nextElementSibling).toBe(dividers[0]);

    act(() => {
      changes?.click();
    });
    expect(onToggleGitChanges).toHaveBeenCalledOnce();
  });

  it("keeps Changes discoverable without restoring the standalone Git mark", () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => root?.render(withTestLocalization(
      <DesktopTitlebarActions
        titlebarActionsSettings={DEFAULT_TITLEBAR_ACTIONS_SETTINGS}
        terminalSidebarOpen={false}
        terminalToolEnabled={false}
        gitChangesAvailable
        onToggleTerminal={vi.fn()}
      />,
    )));

    const changes = container.querySelector<HTMLButtonElement>(".desktop-titlebar-changes");
    expect(changes?.getAttribute("aria-label")).toBe("Changes");
    expect(changes?.querySelector(".desktop-titlebar-git-indicator.local.idle .lucide-asterisk"))
      .not.toBeNull();
    expect(changes?.querySelector(".desktop-titlebar-git-indicator.local.idle")?.textContent)
      .toBe("0");
    expect(Array.from(changes?.children ?? []).some((child) => child.tagName === "svg"))
      .toBe(false);
  });
});
