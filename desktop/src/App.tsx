import { useMemo, useState } from "react";
import { DataWorkspace } from "./components/DataWorkspace";
import { MinimalOnboarding } from "./components/MinimalOnboarding";
import type { Workspace } from "./lib/localFiles";

export function App() {
  const [folderPath, setFolderPath] = useState<string | null>(null);

  const workspace = useMemo<Workspace | null>(() => {
    if (!folderPath) return null;
    const segments = folderPath.split(/[\\/]/).filter(Boolean);
    return {
      id: "local-folder",
      name: segments[segments.length - 1] ?? "Local folder",
      path: folderPath,
      status: "protected",
      commitCount: 0,
      cloudState: "local",
    };
  }, [folderPath]);

  if (!workspace) {
    return <MinimalOnboarding onOpenFolder={setFolderPath} />;
  }

  return (
    <div className="app-shell minimal">
      <main className="main-pane">
        <DataWorkspace workspace={workspace} />
      </main>
    </div>
  );
}
