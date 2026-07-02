import { AlertTriangle } from "lucide-react";
import type { DragEvent } from "react";
import { useEffect, useState } from "react";
import type { Workspace } from "@puppyone/shared-ui";
import { selectWorkspaceFolder, workspaceFromPath } from "../lib/localFiles";
import type { ThemeMode } from "../preferences";

type MinimalOnboardingProps = {
  onOpenWorkspace: (workspace: Workspace) => void;
  initialError?: string | null;
  themeMode: ThemeMode;
  resolvedTheme: "light" | "dark";
};

export function MinimalOnboarding({
  onOpenWorkspace,
  initialError = null,
  themeMode,
  resolvedTheme,
}: MinimalOnboardingProps) {
  const [error, setError] = useState<string | null>(initialError);
  const [dragging, setDragging] = useState(false);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    setError(initialError);
  }, [initialError]);

  const openDroppedFolder = async (path: string) => {
    setError(null);
    const nextPath = path.trim();
    if (!nextPath.startsWith("/")) {
      setError("Drop a local folder or click to choose one.");
      return;
    }

    setOpening(true);
    try {
      onOpenWorkspace(await workspaceFromPath(nextPath));
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setOpening(false);
    }
  };

  const chooseFolder = async () => {
    setError(null);
    setOpening(true);
    try {
      const workspace = await selectWorkspaceFolder();
      if (workspace) onOpenWorkspace(workspace);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setOpening(false);
    }
  };

  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setDragging(false);
  };

  const handleDrop = async (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);

    const file = event.dataTransfer.files.item(0);
    const droppedPath = file
      ? window.puppyoneDesktop?.getPathForFile(file) || (file as File & { path?: string }).path
      : null;

    if (!droppedPath) {
      setError("Could not read that folder path. Click the folder box to choose it instead.");
      return;
    }

    await openDroppedFolder(droppedPath);
  };

  return (
    <main
      className={`onboarding-shell ${resolvedTheme === "dark" ? "dark" : ""} ${dragging ? "dragging" : ""}`}
      data-theme-mode={themeMode}
      onDragEnter={() => setDragging(true)}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="onboarding-titlebar" aria-hidden="true" />
      <section className="onboarding-panel" aria-label="Open workspace">
        <div className="onboarding-action-stack">
          <button
            className={`folder-drop-zone ${dragging ? "dragging" : ""}`}
            type="button"
            disabled={opening}
            aria-busy={opening}
            onClick={chooseFolder}
          >
            <span className="folder-drop-tab" aria-hidden="true" />
            <span className="folder-drop-body">
              <svg
                width="30"
                height="30"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                aria-hidden="true"
                className="folder-drop-plus"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span className="folder-drop-copy">
                <strong>Open local folder</strong>
              </span>
            </span>
          </button>

          {error && (
            <div className="onboarding-error" role="alert">
              <AlertTriangle size={15} />
              <span>{error}</span>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
