import { useEffect, useMemo, useState } from "react";
import { DataWorkspace } from "@puppyone/data-ui";
import { DesktopCloudShell, type DesktopView } from "./components/DesktopCloudShell";
import { MinimalOnboarding } from "./components/MinimalOnboarding";
import type { Workspace } from "@puppyone/data-core";
import { createLocalDataPort } from "./lib/localFiles";

export function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<DesktopView>("data");

  const workspace = useMemo(
    () => workspaces.find((item) => item.id === activeWorkspaceId) ?? workspaces[0] ?? null,
    [activeWorkspaceId, workspaces],
  );
  const workspaceKey = useMemo(() => workspace?.path ?? "no-workspace", [workspace?.path]);
  const dataPort = useMemo(
    () => (workspace ? createLocalDataPort(workspace.path) : null),
    [workspace],
  );

  useEffect(() => {
    const preventFileDropNavigation = (event: DragEvent) => {
      event.preventDefault();
    };

    window.addEventListener("dragover", preventFileDropNavigation);
    window.addEventListener("drop", preventFileDropNavigation);
    return () => {
      window.removeEventListener("dragover", preventFileDropNavigation);
      window.removeEventListener("drop", preventFileDropNavigation);
    };
  }, []);

  const openWorkspace = (nextWorkspace: Workspace) => {
    setWorkspaces((current) => {
      const withoutExisting = current.filter((item) => item.id !== nextWorkspace.id);
      return [nextWorkspace, ...withoutExisting];
    });
    setActiveWorkspaceId(nextWorkspace.id);
    setActiveView("data");
  };

  if (!workspace) {
    return <MinimalOnboarding onOpenWorkspace={openWorkspace} />;
  }

  return (
    <div className="app-shell cloud-runtime dark">
      <DesktopCloudShell
        workspaces={workspaces}
        activeWorkspace={workspace}
        activeView={activeView}
        onSelectWorkspace={(workspaceId) => {
          setActiveWorkspaceId(workspaceId);
          setActiveView("data");
        }}
        onOpenWorkspace={openWorkspace}
        onNavigate={setActiveView}
      >
        {activeView === "data" && dataPort ? (
          <DataWorkspace
            key={workspaceKey}
            workspace={workspace}
            dataPort={dataPort}
            capabilities={{
              create: true,
              rename: true,
              delete: true,
              move: true,
              write: true,
              history: true,
              accessPoints: false,
              cloudSync: false,
              localGit: true,
              connectors: false,
            }}
          />
        ) : (
          <div className="desktop-view-placeholder">
            <span>{activeView}</span>
            <strong>{workspace.name}</strong>
          </div>
        )}
      </DesktopCloudShell>
    </div>
  );
}
