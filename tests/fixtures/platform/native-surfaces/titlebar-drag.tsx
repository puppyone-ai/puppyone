import "../../../../src/styles/cascade.css";
import "../../../../src/cloud-globals.css";
import "../../../../src/styles.css";
import { canonicalizeResourceUri } from "@puppyone/shared-ui";
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { DesktopCloudShell } from "../../../../src/components/DesktopCloudShell";
import { DesktopTitlebarContext } from "../../../../src/features/app-shell/DesktopTitlebarContext";
import { AuxiliaryWorkbenchHeader } from "../../../../src/features/app-shell/auxiliary-workbench/layout/AuxiliaryWorkbenchHeader";
import { TerminalSessionHeader } from "../../../../src/features/desktop-terminal/ui/session-header/TerminalSessionHeader";
import { EditorHeaderTabs } from "../../../../src/features/editor-workbench/header/EditorHeaderTabs";
import { initializeDesktopPreferences } from "../../../../src/preferencesStore";
import { withTestLocalization } from "../../../support/react/localization";

const params = new URLSearchParams(location.search);
const mode = params.get("mode") ?? "empty-host";
const centered = params.get("centered") === "true";
const cloud = params.get("cloud") === "true";
initializeDesktopPreferences();
const workspace = { id: "drag-fixture", name: "Header drag regression", path: "/fixture/header", status: "recording" as const };
const noop = () => {};

function Harness() {
  const anchor = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [clicks, setClicks] = useState(0);
  const activate = () => setClicks(n => n + 1);
  const tabs = mode === "files" || mode === "overflow"
    ? <EditorHeaderTabs activeEditorId="file-0" storageIdentity={null}
        editors={Array.from({ length: mode === "overflow" ? 20 : 1 }, (_, n) => ({
          id: `file-${n}`, resource: `/fixture/header/note-${n}.md`, label: `Note ${n}`,
          resourceUri: canonicalizeResourceUri(`puppyone-local://workspace/fixture/note-${n}.md`), rootUri: null,
        }))}
        onActivate={activate} onClose={activate} onMove={noop} onCreate={activate} />
    : mode === "chat" ? <AuxiliaryWorkbenchHeader groupId="fixture" activeItemId="chat"
        items={[{ id: "chat", kind: "agent-chat", snapshot: { title: "Chat", accessibleLabel: "Chat",
          detail: null, status: "idle", iconKey: null, running: false, resourceId: null } }]}
        onActivate={activate} onClose={activate} onCreate={activate} />
    : mode === "terminal" ? <TerminalSessionHeader workspacePath={workspace.path} activeSessionId={null}
        sessions={[]} onActivate={activate} onClose={activate} onCreate={activate} /> : undefined;
  const context = <DesktopTitlebarContext workspace={workspace} workspaceFolders={[]}
    titlebarLabel={workspace.name} refObject={anchor} open={menuOpen} multiRootWorkspacesEnabled={false}
    availableProjects={[workspace, { ...workspace, id: "other", name: "Another project", path: "/fixture/other" }]}
    onHome={activate} onCreateProject={activate} onSelectProject={activate}
    onToggle={() => setMenuOpen(open => !open)} onClose={() => setMenuOpen(false)} />;
  return <div className="app-shell" data-drag-fixture={mode} style={{ height: "100vh" }}>
    <DesktopCloudShell leftSidebarWidth={220} leftSidebarCollapsed={params.get("collapsed") === "true"}
      titlebarSidebarSlot={centered ? undefined : context} titlebarCenteredSlot={centered ? context : undefined}
      titlebarTabs={tabs} titlebarTabsHostRef={mode === "empty-host" ? host : undefined}
      alignTitlebarTabsToExplorer={mode === "files" || mode === "overflow"}
      titlebarActions={<button onClick={activate}>Action</button>}>
      <main style={{ padding: 24 }}>
        <h1>Header drag regression</h1>
        <p>Mode: {mode}; Cloud: {String(cloud)}</p>
        <p>Drag the empty Header area. Buttons and tabs should remain clickable.</p>
        <nav>{["empty-host", "overflow", "chat", "terminal"].map(value => <a key={value} style={{ marginRight: 12 }} href={`?mode=${value}&cloud=true&centered=${centered}`}>{value}</a>)}<a href={`?mode=${mode}&cloud=true&centered=${!centered}`}>Toggle alignment</a></nav>
        <output id="clicks">{clicks}</output>
        <p id="native-bounds" />
      </main>
    </DesktopCloudShell>
  </div>;
}
createRoot(document.getElementById("root")!).render(withTestLocalization(<Harness />));
