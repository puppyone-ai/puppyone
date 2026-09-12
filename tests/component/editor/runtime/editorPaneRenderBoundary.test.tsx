/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorPaneRenderBoundary } from "../../../../src/features/editor-workbench/runtime/EditorPaneRenderBoundary";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("EditorPaneRenderBoundary", () => {
  it("contains one pane failure and recovers when the editor resource changes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const Broken = () => {
      throw new Error("viewer exploded");
    };

    await act(async () => root.render(
      <EditorPaneRenderBoundary failureTitle="Preview failed" resetKey="first.md">
        <Broken />
      </EditorPaneRenderBoundary>,
    ));

    expect(container.querySelector("[role=alert]")?.textContent).toContain("Preview failed");
    expect(container.textContent).toContain("viewer exploded");

    await act(async () => root.render(
      <EditorPaneRenderBoundary failureTitle="Preview failed" resetKey="second.md">
        <div data-testid="healthy">healthy</div>
      </EditorPaneRenderBoundary>,
    ));

    expect(container.querySelector("[role=alert]")).toBeNull();
    expect(container.querySelector("[data-testid=healthy]")?.textContent).toBe("healthy");
    await act(async () => root.unmount());
  });
});
