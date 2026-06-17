import { FolderOpen, ShieldCheck, Upload } from "lucide-react";
import type { DragEvent } from "react";
import { useState } from "react";
import type { Workspace } from "@puppyone/data-core";
import { selectWorkspaceFolder, workspaceFromPath } from "../lib/localFiles";

type MinimalOnboardingProps = {
  onOpenWorkspace: (workspace: Workspace) => void;
};

export function MinimalOnboarding({ onOpenWorkspace }: MinimalOnboardingProps) {
  const [folderPath, setFolderPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [opening, setOpening] = useState(false);

  const protectFolder = async (path: string = folderPath) => {
    setError(null);
    if (!path.trim().startsWith("/")) {
      setError("Paste an absolute folder path.");
      return;
    }

    setOpening(true);
    try {
      onOpenWorkspace(await workspaceFromPath(path.trim()));
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

    await protectFolder(droppedPath);
  };

  return (
    <main className="onboarding-shell">
      <div className="onboarding-panel">
        <img src="/puppyone-logo.svg" alt="" className="onboarding-logo" />
        <h1>PuppyOne Desktop</h1>
        <p className="onboarding-copy">Open a local folder to make it readable, versioned, and safe for agents.</p>
        <button
          className={`folder-drop-zone ${dragging ? "dragging" : ""}`}
          type="button"
          onClick={chooseFolder}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <span className="folder-drop-icon">
            {dragging ? <Upload size={24} /> : <FolderOpen size={24} />}
          </span>
          <strong>{opening ? "Opening folder..." : "Choose a local folder"}</strong>
          <span>Click to browse, or drag a folder here</span>
        </button>
        <input
          className="folder-path-input"
          value={folderPath}
          onChange={(event) => setFolderPath(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") protectFolder();
          }}
          placeholder="/Users/you/Documents/workspace"
          spellCheck={false}
        />
        <button className="open-folder-button" type="button" onClick={() => protectFolder()}>
          <ShieldCheck size={17} />
          <span>Open pasted path</span>
        </button>
        <button
          className="sample-folder-button"
          type="button"
          onClick={() => setFolderPath("/Users/supersayajin/Desktop/puppyone")}
        >
          Use PuppyOne repo
        </button>
        {error && <p className="onboarding-error">{error}</p>}
      </div>
    </main>
  );
}
