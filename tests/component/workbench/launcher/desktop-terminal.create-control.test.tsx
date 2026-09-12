/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TerminalWorkbenchHeader } from "../../../../src/features/desktop-terminal/workbench/TerminalWorkbenchHeader";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("Unified Workbench create control", () => {
  it("creates a blank launcher Item directly without opening a choice menu", () => {
    const onCreate = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(withTestLocalization(
      <TerminalWorkbenchHeader
        activeItemId={null}
        groupId="group-a"
        items={[]}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onCreate={onCreate}
      />,
    )));

    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="New tab"]');
    expect(trigger?.getAttribute("aria-haspopup")).toBeNull();
    act(() => trigger?.click());

    expect(onCreate).toHaveBeenCalledOnce();
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
    expect(document.body.querySelector(".desktop-terminal-create-menu")).toBeNull();
  });
});
