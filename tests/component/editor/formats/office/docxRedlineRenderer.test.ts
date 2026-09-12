/**
 * @vitest-environment happy-dom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveFileFormat } from "@puppyone/shared-ui";
import type { GitFileDiff, GitRevisionPair } from "../src/types/electron";
import type { DocxRedlinePresentation } from "../../../../../src/features/source-control/diff/contributions/docx-redline/model";

vi.mock("../../../../../src/features/source-control/diff/contributions/docx-redline/provider", () => ({
  loadDocxRedline: vi.fn(),
}));

import { docxRedlineContribution } from "../../../../../src/features/source-control/diff/contributions/docx-redline/contribution";
import { loadDocxRedline } from "../../../../../src/features/source-control/diff/contributions/docx-redline/provider";
import { withTestLocalization } from "../../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.mocked(loadDocxRedline).mockReset();
});

describe("DOCX redline renderer states", () => {
  it("shows loading and then an honest empty state", async () => {
    let complete: ((model: DocxRedlinePresentation) => void) | undefined;
    vi.mocked(loadDocxRedline).mockReturnValue(new Promise((resolve) => {
      complete = resolve;
    }));
    const container = renderDiff();
    expect(container.textContent).toContain("Building semantic Word diff");

    await act(async () => {
      complete?.(presentation({ state: "empty", changes: [] }));
      await Promise.resolve();
    });
    expect(container.textContent).toContain("No semantic text changes");
    expect(container.textContent).toContain("No paragraph or table text changes were detected");
  });

  it("shows a retryable provider error", async () => {
    vi.mocked(loadDocxRedline).mockRejectedValue(new Error("The Word package is malformed."));
    const container = renderDiff();
    await flushEffects();
    expect(container.textContent).toContain("Word diff unavailable");
    expect(container.textContent).toContain("malformed");
    expect(container.querySelector("button")?.textContent).toContain("Retry");
  });

  it.each([
    ["added", "Added Word document"],
    ["deleted", "Deleted Word document"],
  ] as const)("labels a one-sided %s document", async (state, label) => {
    vi.mocked(loadDocxRedline).mockResolvedValue(presentation({
      state,
      changes: [{
        id: `${state}:0`,
        kind: state,
        blockKind: "paragraph",
        beforeIndex: state === "deleted" ? 0 : null,
        afterIndex: state === "added" ? 0 : null,
        segments: [{ kind: state === "added" ? "add" : "remove", text: "One-sided content" }],
      }],
    }));
    const container = renderDiff();
    await flushEffects();
    expect(container.textContent).toContain(label);
  });
});

function renderDiff() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const Renderer = docxRedlineContribution.render;
  act(() => root?.render(withTestLocalization(React.createElement(Renderer, {
    file: fileDiff(),
    format: resolveFileFormat({ name: "report.docx" }),
  }))));
  return container;
}

async function flushEffects() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function presentation(overrides: Partial<DocxRedlinePresentation>): DocxRedlinePresentation {
  return {
    kind: "docx-redline",
    rendererVersion: "3",
    state: "ready",
    stats: {
      blocksAdded: 0,
      blocksDeleted: 0,
      blocksModified: 0,
      blocksChanged: 0,
      wordsAdded: 0,
      wordsDeleted: 0,
    },
    changes: [],
    truncated: false,
    fidelity: "body-text-v1",
    ...overrides,
  };
}

function fileDiff(): GitFileDiff {
  return {
    path: "report.docx",
    oldPath: null,
    status: "modified",
    additions: null,
    deletions: null,
    binary: true,
    lines: [],
    revisionPair: revisionPair(),
  };
}

function revisionPair(): GitRevisionPair {
  return {
    repositoryIdentity: "repo:1",
    selectionIdentity: "selection:1",
    sessionId: "git-diff-session:test",
    scope: "unstaged",
    path: "report.docx",
    oldPath: null,
    status: "modified",
    before: {
      kind: "resource",
      identity: "git:before",
      size: 4,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      handle: "before-handle",
    },
    after: {
      kind: "resource",
      identity: "worktree:after",
      size: 4,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      handle: "after-handle",
    },
  };
}
