/**
 * @vitest-environment happy-dom
 */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GitWorkingSelection } from "../../../../src/features/source-control/types";
import { GitChangesSidebar } from "../../../../src/features/source-control/GitChangesSidebar";
import { withTestLocalization } from "../../../support/react/localization";

vi.mock("../../../../src/features/source-control/SourceControlSidebar", () => ({
  GitSidebar: ({ actions }: {
    actions: { selectWorkingFile: (selection: GitWorkingSelection) => void };
  }) => (
    <button
      className="test-change-row"
      type="button"
      onClick={() => actions.selectWorkingFile({
        path: "src/app.ts",
        status: "modified",
        staged: false,
      })}
    >
      app.ts
    </button>
  ),
}));

vi.mock("../../../../src/features/source-control/WorkingFileDetail", () => ({
  WorkingFileDetail: ({ selection }: { selection: GitWorkingSelection }) => (
    <div className="test-change-detail">{selection.path}</div>
  ),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = "";
});

describe("Changes right sidebar", () => {
  it("opens a file diff inside the sidebar and returns without navigating the editor", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    const onSelectWorkingFile = vi.fn();
    const onOpenHistory = vi.fn();

    function Harness() {
      const [selection, setSelection] = useState<GitWorkingSelection | null>(null);
      const succeed = async () => true;
      return (
        <GitChangesSidebar
          repository={{
            status: null,
            puppyoneConfig: null,
            gitDisplayMode: "professional",
            gitSidebarLayout: "cards",
            fileIconTheme: "default",
          }}
          view={{
            selectedWorkingFile: selection,
            operationLoading: null,
            operationError: null,
            loading: false,
            error: null,
          }}
          actions={{
            initialize: succeed,
            selectWorkingFile: (nextSelection) => {
              onSelectWorkingFile(nextSelection);
              setSelection(nextSelection);
            },
            stagePaths: succeed,
            stageAll: succeed,
            unstagePaths: succeed,
            discardPaths: succeed,
            discardAll: succeed,
            stageAndCommit: succeed,
            commit: succeed,
            commitAndPush: succeed,
            continueOperation: succeed,
            abortOperation: succeed,
            pull: succeed,
            push: succeed,
            publish: succeed,
            stash: succeed,
          }}
          workingFileDiff={null}
          workingFileDiffLoading={false}
          workingFileDiffError={null}
          onOpenFile={vi.fn()}
          onOpenHistory={onOpenHistory}
          cloudBackup={{ loading: false, error: null, start: vi.fn() }}
        />
      );
    }

    act(() => root.render(withTestLocalization(<Harness />)));
    expect(container.querySelector(".test-change-row")).not.toBeNull();
    const history = container.querySelector<HTMLButtonElement>('button[aria-label="History"]');
    expect(history?.textContent).toBe("");
    expect(history?.querySelector(".lucide-history")).not.toBeNull();

    act(() => history?.click());
    expect(onOpenHistory).toHaveBeenCalledOnce();

    act(() => container.querySelector<HTMLButtonElement>(".test-change-row")?.click());

    expect(onSelectWorkingFile).toHaveBeenCalledWith({
      path: "src/app.ts",
      status: "modified",
      staged: false,
    });
    expect(container.querySelector(".test-change-detail")?.textContent).toBe("src/app.ts");
    expect(container.querySelector(".test-change-row")).toBeNull();

    act(() => container.querySelector<HTMLButtonElement>(".desktop-history-detail-back")?.click());

    expect(container.querySelector(".test-change-row")).not.toBeNull();
    expect(container.querySelector(".test-change-detail")).toBeNull();
  });
});
