import { ChevronRight, FolderOpen, Upload } from "lucide-react";
import type { DragEvent } from "react";
import { useEffect, useState } from "react";
import type { Workspace } from "@puppyone/shared-ui";
import { selectWorkspaceFolder, workspaceFromPath } from "../lib/localFiles";

const puppyoneLogoUrl = new URL("../../public/puppyone-logo.svg", import.meta.url).href;

type MinimalOnboardingProps = {
  onOpenWorkspace: (workspace: Workspace) => void;
  initialError?: string | null;
};

export function MinimalOnboarding({ onOpenWorkspace, initialError = null }: MinimalOnboardingProps) {
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

  const handleDrop = async (event: DragEvent<HTMLButtonElement>) => {
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
    <main className="onboarding-shell">
      <div className="onboarding-panel">
        <div className="onboarding-brand">
          <img src={puppyoneLogoUrl} alt="" className="onboarding-logo" />
          <h1>puppyone</h1>
        </div>
        <button
          className={`folder-drop-zone ${dragging ? "dragging" : ""}`}
          type="button"
          disabled={opening}
          aria-busy={opening}
          onClick={chooseFolder}
          onDragEnter={() => setDragging(true)}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <span className="folder-drop-icon">
            {dragging ? <Upload size={21} /> : <FolderOpen size={21} />}
          </span>
          <span className="folder-drop-copy">
            <strong>{opening ? "Opening folder..." : dragging ? "Drop folder to open" : "Open local folder"}</strong>
            <span>{dragging ? "Release to continue" : "Browse or drag a folder here"}</span>
          </span>
          <ChevronRight className="folder-drop-arrow" size={18} />
        </button>
        {error && <p className="onboarding-error">{error}</p>}
      </div>
    </main>
  );
}
