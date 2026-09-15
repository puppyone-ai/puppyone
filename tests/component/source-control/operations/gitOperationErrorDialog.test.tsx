/** @vitest-environment happy-dom */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyGitOperationError,
  GitOperationErrorDialog,
  type GitOperationErrorState,
} from "../../../../src/features/source-control/operationDialogs";
import { withTestLocalization } from "../../../support/react/localization";

const roots: Root[] = [];

afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = "";
});

describe("Git operation recovery dialog", () => {
  it("classifies a paused rebase as a resolvable Pull conflict", () => {
    expect(classifyGitOperationError(
      new Error("CONFLICT (content): Merge conflict in shared.md\nerror: could not apply abc123"),
      "pull",
    )).toEqual({ code: "pull-conflict", detail: null });
  });

  it("recommends Pull after a non-fast-forward Push instead of emphasizing dismissal", () => {
    const onPull = vi.fn();
    const surface = renderDialog(error("push-rejected"), { onPull });
    const pull = button(surface, "Pull");
    const close = button(surface, "Close");

    expect(pull?.classList.contains("primary")).toBe(true);
    expect(close).toBeUndefined();
    act(() => pull?.click());
    expect(onPull).toHaveBeenCalledTimes(1);
  });

  it("keeps ordinary error dismissal visually neutral", () => {
    const surface = renderDialog(error("pull-conflict"));
    const close = button(surface, "Close");

    expect(close?.classList.contains("primary")).toBe(false);
    expect(surface.textContent).toContain("Resolve the conflicted files");
  });
});

function renderDialog(
  operationError: GitOperationErrorState,
  options: { onPull?: () => void } = {},
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(withTestLocalization(
    <GitOperationErrorDialog error={operationError} onClose={vi.fn()} onPull={options.onPull} />,
  )));
  return container;
}

function error(code: GitOperationErrorState["code"]): GitOperationErrorState {
  return {
    operation: code.startsWith("pull") ? "pull" : "push",
    code,
    detail: null,
    raw: null,
    workspacePath: "/workspace",
  };
}

function button(surface: HTMLElement, label: string) {
  return Array.from(surface.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.textContent === label);
}
