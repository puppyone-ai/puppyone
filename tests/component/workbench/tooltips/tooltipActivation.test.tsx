/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Tooltip, disableTooltipHints, isTooltipSuppressed } from "../../../../packages/shared-ui/src/primitives/Tooltip";

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
      <Tooltip content="Explicit help" overflowOnly placement="top" shortcut="⌘K" trigger="hover">
        <button aria-label="Visible accessibility name">Visible label</button>
      </Tooltip>,
    ));
    const button = host.querySelector("button");
    expect(button?.dataset.tooltip).toBe("Explicit help");
    expect(button?.dataset.tooltipWhen).toBe("overflow");
    expect(button?.dataset.tooltipPlacement).toBe("top");
    expect(button?.dataset.tooltipShortcut).toBe("⌘K");
    expect(button?.dataset.tooltipTrigger).toBe("hover");
  });

  it("disables nested hints without removing accessible names or explicit content", () => {
    const scope = document.createElement("div");
    document.body.append(scope);
    root = createRoot(scope);
    act(() => root?.render(<Tooltip content="Nested hint">
      <button aria-label="Accessible command">Command</button>
    </Tooltip>));
    const button = scope.querySelector("button")!;
    expect(isTooltipSuppressed(button)).toBe(false);

    disableTooltipHints(scope);
    disableTooltipHints(scope);
    expect(isTooltipSuppressed(button)).toBe(true);
    expect(isTooltipSuppressed(scope)).toBe(true);
    expect(button.dataset.tooltip).toBe("Nested hint");
    expect(button.getAttribute("aria-label")).toBe("Accessible command");
    expect(scope.hasAttribute("title")).toBe(false);
  });
});
