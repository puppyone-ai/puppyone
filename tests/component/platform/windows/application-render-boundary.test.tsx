/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { ApplicationRenderBoundary } from "../../../../src/components/ApplicationRenderBoundary";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function BrokenSurface(): React.ReactElement {
  throw new Error("fixture application failure");
}

describe("ApplicationRenderBoundary", () => {
  it("keeps a recoverable shell visible when an uncaught feature render fails", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => root.render(withTestLocalization(
      <ApplicationRenderBoundary><BrokenSurface /></ApplicationRenderBoundary>,
    )));

    expect(container.querySelector(".application-render-fallback")).not.toBeNull();
    expect(container.textContent).toContain("PuppyOne could not display this window");
    expect(container.querySelector("button")?.textContent).toContain("Refresh");
    expect(error).toHaveBeenCalled();
    act(() => root.unmount());
    error.mockRestore();
    container.remove();
  });
});
