// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_MARKDOWN_WORKSPACE_ENVIRONMENT, FilePreview } from "@puppyone/shared-ui";
import { desktopPreferencesStore as store, initializeDesktopPreferences } from "../../../../src/preferencesStore";
import { EditorPaneDocumentRuntime } from "../../../../src/features/editor-workbench/runtime/EditorPaneDocumentRuntime";
import { GitHistorySidebar } from "../../../../src/features/source-control/GitHistorySidebar";
import { DesktopCreateEntryDialog, DesktopCreateEntryMenu, DesktopNodeActionMenu, type DesktopCreateEntryDraft } from "../../../../src/features/data-workspace/nodeActions";
import { gitStatus } from "../../../support/source-control/gitFixtures";
import { unavailableDocumentNavigation } from "../../../support/editor/documentFixtures";
import { withTestLocalization } from "../../../support/react/localization";

// Observe the existing application-to-shared-UI boundary; desktop leaves and glyphs stay real.
vi.mock("@puppyone/shared-ui", async (original) => ({
  ...await original<typeof import("@puppyone/shared-ui")>(),
  FilePreview: (props: ComponentProps<typeof FilePreview>) => <output data-preview-icons={props.fileIconTheme} />,
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
const noop = () => {};
const draft: DesktopCreateEntryDraft = { parentPath: null, anchor: { left: 20, top: 20, right: 44, bottom: 44, width: 24, height: 24 },
  error: null, creatingKind: null, selectedKind: null, name: "" };
beforeEach(() => {
  localStorage.clear(); initializeDesktopPreferences();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.replaceChildren(); });

function icon(selector: string) {
  const element = document.querySelector(selector);
  expect(element).not.toBeNull();
  expect(element!.querySelector("svg")).not.toBeNull();
  return element!.innerHTML;
}

describe("desktop icon preference consumers", () => {
  it("updates Git history glyphs without new parent props", () => {
    const commit = { commit_id: "fixture", parent_ids: [], author_name: "Fixture", author_email: "fixture@example.invalid",
      created_at: "2026-10-04T00:00:00Z", message: "Fixture", changes: [{ path: "README.md", oldPath: null,
        status: "modified" as const, additions: 1, deletions: 0 }] };
    act(() => root.render(withTestLocalization(<>
      <GitHistorySidebar status={gitStatus({ commits: [commit], allCommits: [commit], totalCommits: 1 })} statusLoading={false}
        statusError={null} selectedCommitId={null} commitDetail={null} commitDetailLoading={false} commitDetailError={null}
        historyLoading={false} initializing={false} onInitialize={async () => true} onSelectCommit={noop} onBack={noop} />
    </>)));
    const history = icon(".desktop-history-row-file-icon");
    act(() => store.getState().setFileIconTheme("semantic"));
    expect(icon(".desktop-history-row-file-icon")).not.toBe(history);
    expect(JSON.parse(localStorage.getItem("puppyone.desktop.appearance")!).shared.fileIconTheme).toBe("semantic");
  });
  it("updates the create menu and dialog glyphs from their own subscriptions", () => {
    act(() => root.render(withTestLocalization(<DesktopCreateEntryMenu draft={draft} mainEntries={["markdown"]}
      submenuItemKinds={[]} onCancel={noop} onSelectKind={noop} />)));
    const menu = icon('.desktop-menu-item-icon');
    act(() => store.getState().setFileIconTheme("semantic"));
    expect(icon('.desktop-menu-item-icon')).not.toBe(menu);
    act(() => root.render(withTestLocalization(<DesktopCreateEntryDialog draft={{ ...draft, selectedKind: "markdown" }}
      onChange={noop} onCancel={noop} onCreate={noop} />)));
    const dialog = icon('.desktop-dialog-title-row');
    act(() => store.getState().setFileIconTheme("default"));
    expect(icon('.desktop-dialog-title-row')).not.toBe(dialog);
  });
  it("updates the real rename dialog's experimental file types without parent preference props", () => {
    const node = { id: "note.txt", name: "note.txt", path: "note.txt", type: "text" as const };
    act(() => root.render(withTestLocalization(<DesktopNodeActionMenu draft={{ node, nodes: [node], anchor: draft.anchor,
      mode: "rename", renameNameValue: "note", renameExtensionValue: ".txt", renameFocus: "type", error: null, operation: null }}
      onChange={noop} onCancel={noop} onCopy={noop} onCut={noop} onPaste={noop} onDuplicate={noop} onCreateInside={noop}
      onRename={noop} onDelete={noop} onOpenInDefaultApp={noop} onRevealInFinder={noop} />)));
    expect(document.querySelector('option[value=".puppyflow"]')).toBeNull();
    act(() => store.getState().setExperimentalSettings(current => ({ ...current, enablePuppyFlowFiles: true })));
    expect(document.querySelector('option[value=".puppyflow"]')).not.toBeNull();
  });
  it("updates the standalone shared-UI preview through the memoized desktop adapter", async () => {
    await act(async () => root.render(withTestLocalization(<EditorPaneDocumentRuntime aiEditFile={null}
      dataPort={{ listChildren: async () => [] }} editor={null} editorInteractionPreferences={{ showSaveStatus: false, markdownBlockDragEnabled: false }}
      markdownEnvironment={EMPTY_MARKDOWN_WORKSPACE_ENVIRONMENT} documentNavigation={unavailableDocumentNavigation}
      treeNode={null} workspaceId="fixture" workspaceRoot="/fixture" markdownDialect="puppy-gfm" />)));
    expect(host.querySelector("output")?.dataset.previewIcons).toBe("default");
    act(() => store.getState().setFileIconTheme("semantic"));
    expect(host.querySelector("output")?.dataset.previewIcons).toBe("semantic");
  });
});
