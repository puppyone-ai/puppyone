/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectNavigationFailure } from "../../../../src/features/app-shell/ProjectNavigationFailure";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ""; });

function render(diagnostic?: string | null) {
  act(() => root.render(withTestLocalization(<ProjectNavigationFailure title="Couldn’t open Cloud Computer"
    message="Cloud Computer took too long to start. Try again in a moment." diagnostic={diagnostic}
    onClose={() => undefined} onRetry={() => undefined} />)));
}

describe("A failed opening the user can report", () => {
  it("shows the code and request id beside the message, and copies them", async () => {
    render("Error code: workbench_start_timeout · Request ID: req-7f3a");
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Cloud Computer took too long to start.");
    expect(dialog.textContent).toContain("Request ID: req-7f3a");
    const copy = [...dialog.querySelectorAll("button")].find((button) => button.textContent === "Copy details")!;
    await act(async () => { copy.click(); });
    expect(writeText).toHaveBeenCalledWith("Error code: workbench_start_timeout · Request ID: req-7f3a");
    expect(copy.textContent).toBe("Copied");
  });

  it("shows no diagnostic row when there is nothing to report", () => {
    render(null);
    expect(document.querySelector(".desktop-dialog-diagnostic")).toBeNull();
    expect([...document.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["Close", "Retry"]);
  });
});
