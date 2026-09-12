/**
 * @vitest-environment happy-dom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { resolveFileFormat } from "@puppyone/shared-ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GitFileDiff, GitRevisionPair } from "../src/types/electron";
import { createAsyncDiffContribution } from "../../../../src/features/source-control/diff/core/createAsyncDiffContribution";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("format-aware async diff lifecycle", () => {
  it("aborts superseded work and commits zero models from the previous identity", async () => {
    const deferred = new Map<string, (model: string) => void>();
    const observedSignals = new Map<string, AbortSignal>();
    const contribution = testContribution((props, signal) => new Promise((resolve) => {
      const identity = props.file.revisionPair!.selectionIdentity;
      observedSignals.set(identity, signal);
      deferred.set(identity, resolve);
    }));
    const container = renderContribution(contribution.render, fileDiff("selection:old"));
    expect(container.textContent).toBe("Loading");
    await flushEffects();
    expect(observedSignals.has("selection:old")).toBe(true);

    act(() => {
      root?.render(React.createElement(contribution.render, rendererProps(fileDiff("selection:new"))));
    });
    expect(observedSignals.get("selection:old")?.aborted).toBe(true);

    await act(async () => {
      deferred.get("selection:old")?.("OLD MODEL");
      await Promise.resolve();
    });
    expect(container.textContent).not.toContain("OLD MODEL");

    await act(async () => {
      deferred.get("selection:new")?.("NEW MODEL");
      await Promise.resolve();
    });
    expect(container.textContent).toBe("NEW MODEL");
  });

  it("exposes loading, error, and retry through one reusable lifecycle", async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error("Malformed package"))
      .mockResolvedValueOnce("RECOVERED");
    const contribution = testContribution(load);
    const container = renderContribution(contribution.render, fileDiff("selection:retry"));
    expect(container.textContent).toBe("Loading");
    await flushEffects();
    expect(container.textContent).toContain("Malformed package");

    await act(async () => {
      (container.querySelector("button") as HTMLButtonElement).click();
      await Promise.resolve();
    });
    await flushEffects();
    expect(container.textContent).toBe("RECOVERED");
    expect(load).toHaveBeenCalledTimes(2);
  });
});

function testContribution(
  load: Parameters<typeof createAsyncDiffContribution<string>>[0]["load"],
) {
  return createAsyncDiffContribution<string>({
    id: "docx-redline",
    version: "test",
    source: "resource-pair",
    match: () => true,
    loadIdentity: ({ file }) => file.revisionPair!.selectionIdentity,
    load,
    renderModel: ({ model }) => <div>{model}</div>,
    renderLoading: () => <div>Loading</div>,
    renderError: ({ message, onRetry }) => <button type="button" onClick={onRetry}>{message}</button>,
  });
}

function renderContribution(Renderer: ReturnType<typeof testContribution>["render"], file: GitFileDiff) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(React.createElement(Renderer, rendererProps(file))));
  return container;
}

function rendererProps(file: GitFileDiff) {
  return {
    file,
    format: resolveFileFormat({ name: file.path }),
  };
}

async function flushEffects() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function fileDiff(selectionIdentity: string): GitFileDiff {
  return {
    path: "report.docx",
    oldPath: null,
    status: "modified",
    additions: null,
    deletions: null,
    binary: true,
    lines: [],
    revisionPair: revisionPair(selectionIdentity),
  };
}

function revisionPair(selectionIdentity: string): GitRevisionPair {
  return {
    repositoryIdentity: "repo:1",
    selectionIdentity,
    sessionId: `git-diff-session:${selectionIdentity}`,
    scope: "unstaged",
    path: "report.docx",
    oldPath: null,
    status: "modified",
    before: { kind: "missing", identity: "missing:before", size: 0, mimeType: null, reason: "test" },
    after: { kind: "missing", identity: "missing:after", size: 0, mimeType: null, reason: "test" },
  };
}
