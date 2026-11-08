/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { CloudWorkspaceLoadingState } from "../../../../src/features/cloud/components/shared";
import { renderWithTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("Cloud loading state", () => {
  it("uses the neutral loader tone", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => renderWithTestLocalization(root,
      <CloudWorkspaceLoadingState label="Loading project" />,
    ));

    const mark = container.querySelector<HTMLElement>("[data-puppy-loader]");
    const ink = mark?.style.getPropertyValue("--po-loading-mark-ink");
    expect(ink).toBe("var(--po-text-muted)");
    expect(ink).not.toContain("--po-accent");
  });

});
