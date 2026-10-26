// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DataWorkspace, Workspace } from "@puppyone/shared-ui";
import { initializeDesktopPreferences } from "../../../../src/preferencesStore";
import { DesktopDataWorkspaceSurface } from "../../../../src/features/app-shell/DesktopDataWorkspaceSurface";
import { resolveWorkspaceSurface } from "../../../../src/features/app-shell/workspace-surfaces/workspaceSurfaceRegistry";
import { useDesktopEditorWorkbench } from "../../../../src/features/editor-workbench/controller/useDesktopEditorWorkbench";
import { withTestLocalization } from "../../../support/react/localization";

vi.mock("@puppyone/shared-ui", async (original) => ({
  ...await original<typeof import("@puppyone/shared-ui")>(),
  DataWorkspace: (_props: ComponentProps<typeof DataWorkspace>) => <div data-testid="data-workspace" />,
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noop = () => {};
const workspace: Workspace = { id: "notices", name: "Fixture", path: "/fixture/notices", status: "recording" };
const resolvedSurface = resolveWorkspaceSurface({ capabilities: { cloudEnabled: false }, requestedId: "data",
  adapters: { data: () => ({ sidebar: null, main: null }), git: () => ({ sidebar: null, main: null }),
    cloud: () => ({ sidebar: null, main: null }), settings: () => ({ sidebar: null, main: null }) } });

function Surface({ error, onRetry }: { error: string | null; onRetry?: () => void }) {
  const editorWorkbench = useDesktopEditorWorkbench(null, null);
  return <DesktopDataWorkspaceSurface
    workspace={workspace} workspaceFolders={[]} resolveWorkspaceResource={() => null} editorWorkbench={editorWorkbench}
    activeAiEditRequest={null} activeDocumentPath={null} activeExplorerPath={null}
    dataPort={{ listChildren: async () => [] }} externalOpen={{ open: noop }} showSaveStatus={false}
    fileClipboardController={{ clipboard: null, cutPaths: new Set(), operation: null, notice: null, dismissNotice: noop, canCopy: false, canCut: false,
      canDuplicate: false, copyNodes: noop, cutNodes: noop, pasteNodes: async () => {}, duplicateNodes: async () => {}, canPasteInto: () => false }}
    fileOperationNotice={null} viewerExtensionAdapter={null} resolvedSurface={resolvedSurface}
    navigation={{ activeView: "data", availableSurfaceIds: ["data"], gitEnabled: false, gitIncomingCount: 0,
      gitOperationLoading: null, gitStatus: null, workspaceChangeCount: 0, onNavigate: noop, onOpenPlugins: noop,
      onOpenSettings: noop, pluginsOpen: false, settingsOpen: false, showPlugins: false, showSettings: false, showWorkspaceNavigation: false }}
    onActiveDataPathChange={noop} onActiveDataNodeChange={noop} onResourceMove={noop} onRemoveProject={noop}
    openCreateEntryParentPath={undefined} openNodeActionPath={null} onCreateEntryMenu={noop} onDismissCreateEntryMenu={noop} onNodeActionMenu={noop}
    workspaceRefreshToken={{ sequence: 0, entries: [] }} workspaceAtomicRefreshToken={0}
    workspaceSurfaceError={error} onRetryWorkspaceSurface={onRetry} sidebarCreateMenuOpen={false}
  />;
}

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear(); initializeDesktopPreferences();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear(); });
const render = (node: Parameters<typeof withTestLocalization>[0]) => act(() => root.render(withTestLocalization(node)));
const notices = () => [...host.querySelectorAll<HTMLElement>(".desktop-workspace-notice-stack .po-floating-notice")];

describe("workspace surface notices", () => {
  it("presents a reconnectable failure as one top-end notice with Retry and a close control", () => {
    const retry = vi.fn();
    const message = "Cloud workspace connection interrupted. Retry to reconnect.";
    render(<Surface error={message} onRetry={retry} />);

    expect(notices()).toHaveLength(1);
    const [notice] = notices();
    expect(notice!.dataset.tone).toBe("warning");
    expect(notice!.querySelector(".po-floating-notice__message")?.textContent).toBe(message);
    expect([...host.querySelectorAll('[role="alert"], [role="status"]')]
      .filter((element) => element.textContent?.includes(message))).toHaveLength(1);

    act(() => notice!.querySelector<HTMLButtonElement>(".po-floating-notice__action")!.click());
    expect(retry).toHaveBeenCalledOnce();

    act(() => notice!.querySelector<HTMLButtonElement>(".po-floating-notice__dismiss")!.click());
    expect(notices()).toHaveLength(0);

    render(<Surface error={null} onRetry={retry} />);
    render(<Surface error={message} onRetry={retry} />);
    expect(notices()).toHaveLength(1);
  });

  it("offers no Retry when the source cannot reconnect", () => {
    render(<Surface error="Unable to restore the workspace." />);
    expect(notices()).toHaveLength(1);
    expect(host.querySelector(".po-floating-notice__action")).toBeNull();
    expect(host.querySelector(".po-floating-notice__dismiss")).not.toBeNull();
  });
});
