/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Tooltip, activateTooltip } from "../../../../packages/shared-ui/src/primitives/Tooltip";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("Tooltip", () => {
  it("only activates when explicit content is provided", () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    act(() => root?.render(
      <Tooltip content={null}>
        <button aria-label="Visible accessibility name">Visible label</button>
      </Tooltip>,
    ));
    expect(host.querySelector("button")?.hasAttribute("data-tooltip")).toBe(false);

    act(() => root?.render(
      <Tooltip content="Explicit help" overflowOnly placement="top" shortcut="⌘K">
        <button aria-label="Visible accessibility name">Visible label</button>
      </Tooltip>,
    ));
    const button = host.querySelector("button");
    expect(button?.dataset.tooltip).toBe("Explicit help");
    expect(button?.dataset.tooltipWhen).toBe("overflow");
    expect(button?.dataset.tooltipPlacement).toBe("top");
    expect(button?.dataset.tooltipShortcut).toBe("⌘K");
  });

  it("requires the same explicit activation for imperative DOM", () => {
    const button = document.createElement("button");
    button.setAttribute("aria-label", "Accessible name only");
    expect(button.hasAttribute("data-tooltip")).toBe(false);

    activateTooltip(button, "Explicit help", { placement: "right" });
    expect(button.dataset.tooltip).toBe("Explicit help");
    expect(button.dataset.tooltipPlacement).toBe("right");

    activateTooltip(button, null);
    expect(button.hasAttribute("data-tooltip")).toBe(false);
    expect(button.hasAttribute("data-tooltip-placement")).toBe(false);
  });
});
