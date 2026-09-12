/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GitFileDiff } from "../src/types/electron";
import { GitFileDiffSurface } from "../../../../src/features/source-control/diff/GitFileDiffSurface";
import { WorkingFileDetail } from "../../../../src/features/source-control/WorkingFileDetail";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = "";
});

describe("local Git diff presentation", () => {
  it("uses the exact same file surface in focused Changes and embedded History contexts", () => {
    const file = textFile();
    const focused = render(
      <WorkingFileDetail
        selection={{ path: file.path, status: "added", staged: false, origin: "committed" }}
        detail={{ commit_id: "local-commits", files: [file] }}
        loading={false}
        error={null}
        operationLoading={null}
        operationError={null}
        onStagePaths={async () => true}
        onUnstagePaths={async () => true}
        onDiscardPaths={async () => true}
        onOpenFile={vi.fn()}
      />,
    );
    const embedded = render(<GitFileDiffSurface file={file} />);

    expect(focused.querySelector(".desktop-file-diff")?.outerHTML)
      .toBe(embedded.querySelector(".desktop-file-diff")?.outerHTML);
    expect(focused.querySelector(".desktop-working-file-toolbar")).toBeNull();
    expect(focused.querySelector(".desktop-working-diff-context")).toBeNull();
    expect(focused.querySelector(".desktop-file-format-label")?.textContent).toBe("Markdown");
    expect(focused.querySelector(".desktop-change-badge")?.textContent).toBe("Added");
    expect(focused.querySelector(".desktop-file-diff-stat")?.textContent).toBe("+2−0");
    expect(focused.querySelector(".desktop-file-diff-name")?.textContent).toBe("ISSUE-030.md");
    expect(focused.querySelector(".desktop-file-diff-directory")?.textContent).toBe("dev issues/3-done");
    expect(focused.textContent).not.toContain("OUTGOING");
    expect(focused.textContent).not.toContain("Net changes");
    expect(focused.querySelector(".without-header")).toBeNull();
  });

  it("orders canonical format, status and totals before the path identity", () => {
    const file: GitFileDiff = {
      ...textFile(),
      path: "src/current/new.ts",
      oldPath: "src/legacy/old.ts",
      status: "renamed",
      additions: 7,
      deletions: 3,
    };
    const surface = render(<GitFileDiffSurface file={file} />);
    const header = surface.querySelector(".desktop-file-diff-header");
    const facts = header?.children.item(0);
    const identity = header?.children.item(1);

    expect(header?.getAttribute("data-file-format")).toBe("typescript");
    expect(Array.from(facts?.children ?? []).map((element) => element.className)).toEqual([
      "desktop-file-format-label",
      "desktop-change-badge renamed",
      "desktop-file-diff-stat",
    ]);
    expect(facts?.textContent).toBe("TypeScriptRenamed+7−3");
    expect(identity?.className).toBe("desktop-file-diff-identity");
    expect(identity?.textContent).toBe("old.ts → new.tssrc/legacy → src/current");
    expect(identity?.getAttribute("title")).toBe("src/legacy/old.ts → src/current/new.ts");
    expect(identity?.getAttribute("aria-label")).toBe("src/legacy/old.ts → src/current/new.ts");
  });

  it("keeps local mutations in a separate low-emphasis toolbar without restoring scope copy", () => {
    const file = textFile();
    const surface = render(
      <WorkingFileDetail
        selection={{ path: file.path, status: "added", staged: false, origin: "local" }}
        detail={{ commit_id: "working-tree", files: [file] }}
        loading={false}
        error={null}
        operationLoading={null}
        operationError={null}
        onStagePaths={async () => true}
        onUnstagePaths={async () => true}
        onDiscardPaths={async () => true}
        onOpenFile={vi.fn()}
      />,
    );

    expect(Array.from(surface.querySelectorAll(".desktop-working-file-toolbar button"))
      .map((button) => button.textContent)).toEqual(["Open file", "Stage", "Discard"]);
    expect(surface.querySelector(".desktop-working-diff-context")).toBeNull();
    expect(surface.querySelector(".desktop-file-diff-facts")?.textContent).toBe("MarkdownAdded+2−0");
  });
});

function render(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(withTestLocalization(<>{node}</>)));
  return container;
}

function textFile(): GitFileDiff {
  return {
    path: "dev issues/3-done/ISSUE-030.md",
    oldPath: null,
    status: "added",
    additions: 2,
    deletions: 0,
    binary: false,
    lines: [
      { kind: "hunk", text: "@@ -0,0 +1,2 @@" },
      { kind: "add", text: "# ISSUE-030", newLine: 1 },
      { kind: "add", text: "Done", newLine: 2 },
    ],
  };
}
