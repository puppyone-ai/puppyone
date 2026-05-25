import { ShieldCheck } from "lucide-react";
import { useState } from "react";

type MinimalOnboardingProps = {
  onOpenFolder: (path: string) => void;
};

export function MinimalOnboarding({ onOpenFolder }: MinimalOnboardingProps) {
  const [folderPath, setFolderPath] = useState("");
  const [error, setError] = useState<string | null>(null);

  const protectFolder = () => {
    const nextPath = folderPath.trim();

    setError(null);
    if (!nextPath.startsWith("/")) {
      setError("Paste an absolute folder path.");
      return;
    }

    onOpenFolder(nextPath);
  };

  return (
    <main className="onboarding-shell">
      <div className="onboarding-panel">
        <img src="/puppyone-logo.svg" alt="" className="onboarding-logo" />
        <h1>PuppyOne Desktop</h1>
        <p className="onboarding-copy">Guard a local folder and record every change agents make.</p>
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
        <button className="open-folder-button" type="button" onClick={protectFolder}>
          <ShieldCheck size={17} />
          <span>Protect folder</span>
        </button>
        <button
          className="sample-folder-button"
          type="button"
          onClick={() => setFolderPath("/Users/puppyoneai/Desktop/project/puppyone")}
        >
          Use PuppyOne repo
        </button>
        {error && <p className="onboarding-error">{error}</p>}
      </div>
    </main>
  );
}
