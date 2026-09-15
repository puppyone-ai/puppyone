/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GitStatusView } from "../../../../src/features/source-control/GitStatusView";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = "";
});

describe("Git main preview", () => {
  it("shows the neutral preview prompt instead of a main-panel loader", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    const succeed = async () => true;

    act(() => root.render(withTestLocalization(
      <GitStatusView
        status={null}
        selectedWorkingFile={null}
        workingFileDiff={null}
        workingFileDiffLoading={false}
        workingFileDiffError={null}
        operationLoading={null}
        operationError={null}
        loading
        error={null}
        onRefresh={vi.fn()}
        onStagePaths={succeed}
        onUnstagePaths={succeed}
        onDiscardPaths={succeed}
        onOpenWorkingFile={vi.fn()}
        onInitializeRepository={succeed}
      />,
    )));

    expect(container.querySelector(".empty-preview")).not.toBeNull();
    expect(container.textContent).toContain("Select a change to preview");
    expect(container.textContent).not.toContain("Reading Git");
    expect(container.querySelector('[data-puppy-loader="dots"]')).toBeNull();
  });
});
