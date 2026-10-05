import { useRef, useState } from "react";
import { type Workspace } from "@puppyone/shared-ui";
import type { DesktopPlatform, GitStatusSnapshot } from "../../types/electron";
import { DesktopOverlayPortal } from "./DesktopOverlayPortal";
import { DesktopWorkspaceSwitcher, type DesktopProjectLocation } from "./DesktopWorkspaceSwitcher";
import { resetDesktopPlatformCapabilitiesForTests } from "../../platform/desktopPlatformClient";
import "./workspace-menu-visual-smoke.css";
import { desktopPreferencesStore, initializeDesktopPreferences } from "../../preferencesStore";

initializeDesktopPreferences();
desktopPreferencesStore.getState().setExperimentalSettings(s => ({
  ...s,
  enableProjectLocationIconsInHeader: new URLSearchParams(window.location.search).get("location-presentation") === "header-icons",
}));

const currentWorkspace = workspace("todo", "To-Do-List", "/Users/demo/Desktop/To-Do-List");

const requestedPlatform = new URLSearchParams(window.location.search).get("platform");
const platform: DesktopPlatform = requestedPlatform === "windows" || requestedPlatform === "linux"
  ? requestedPlatform : "macos";
window.puppyoneDesktop = {
  ...window.puppyoneDesktop,
  getPlatformCapabilities: async () => ({
    schemaVersion: 1, platform, arch: "x64", primaryModifier: platform === "macos" ? "meta" : "control",
    windowChrome: { mode: "custom" },
    credentialStorage: { available: false, locked: false, strength: "unavailable", backend: null },
    documentConversion: { supportedInputs: [] },
    updater: { supported: false, installMode: "manual" },
  }),
} as NonNullable<typeof window.puppyoneDesktop>;
// Bootstrap reads capabilities before loading this isolated visual fixture.
resetDesktopPlatformCapabilitiesForTests();

/** Deterministic browser fixture for reviewing the Workspace menu hierarchy. */
export function WorkspaceMenuVisualSmokeHarness() {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(true);
  const state = new URLSearchParams(window.location.search).get("project-state") ?? "local-only";
  const linked = state === "local-cloud" || state === "cloud-only" || state === "local-cloud-no-github" || state === "signed-out";
  const githubLinked = state === "local-cloud" || state === "cloud-only" || state === "local-github" || state === "signed-out";
  const current = state === "cloud-only" ? "cloud" : "local";
  let cloudState: DesktopProjectLocation["cloudState"] = linked ? "available" : "unavailable";
  if (state === "signed-out") cloudState = "signed-out";
  if (state === "resolving") cloudState = "resolving";
  const theme = new URLSearchParams(window.location.search).get("theme") === "light" ? "light" : "dark";

  return (
    <main className={`app-shell ${theme} workspace-menu-visual-smoke`}
      data-po-appearance-root="true"
      data-workspace-menu-visual-ready="true" data-project-state={state} data-device-platform={platform}>
      <DesktopOverlayPortal theme={theme}>{null}</DesktopOverlayPortal>
      <header className="desktop-titlebar workspace-menu-visual-titlebar">
        <div className="desktop-titlebar-context">
          <DesktopWorkspaceSwitcher
            open={open}
            refObject={anchorRef}
            titlebarLabel={currentWorkspace.name}
            menuAlignment="center"
            workspace={currentWorkspace}
            workspaceFolders={[]}
            multiRootWorkspacesEnabled={false}
            projectLocation={{
              current,
              localAvailable: current === "local",
              cloudState,
            }}
            cloudProject={linked ? { id: "project-1" } : undefined}
            backupProviders={githubLinked ? ["github"] : []}
            backupStatus={githubLinked ? versionStatus : null}
            onOpenFolder={() => undefined}
            onClose={() => setOpen(false)}
            onViewLocal={() => undefined}
            onViewCloud={() => undefined}
            onToggle={() => setOpen(current => !current)}
          />
        </div>
      </header>
      <section className="workspace-menu-visual-body" aria-hidden="true">
        <aside />
        <div>
          <span />
          <span />
          <span />
        </div>
      </section>
    </main>
  );
}

const versionStatus: GitStatusSnapshot = {
  isRepo: true, branch: "main", headCommitId: "fixture-head", totalCommits: 1,
  entries: [], stagedEntries: [], unstagedEntries: [], untrackedEntries: [],
  branches: ["puppyone/main", "origin/main"].map((name) => ({
    name, current: false, remote: true, upstream: null, ahead: 0, behind: 0,
    lastCommitId: "fixture-head", lastCommitMessage: "Fixture version",
    lastCommitDate: "2026-10-01T14:32:00Z",
  })),
  remotes: [
    { name: "puppyone", fetchUrl: "https://cloud.example/git/project-1.git",
      pushUrl: "https://cloud.example/git/project-1.git", branches: ["main"] },
    { name: "origin", fetchUrl: "https://github.com/example/project.git", pushUrl: null, branches: ["main"] },
  ],
  syncTarget: null,
  effectiveHosting: { kind: "local-only", remoteName: null, branchName: "main", ref: null,
    ready: false, reason: "local-only", identity: null },
  sourceControl: {
    input: { placeholder: "", defaultMessage: "" }, groups: [],
    remote: { target: null, currentBranch: "main", upstream: null, ahead: 0, behind: 0,
      incomingPreview: [], outgoingPreview: [], canPull: false, canPush: false,
      canSync: false, canPublish: false, state: "no-remote" },
    actions: { canStageAll: false, canUnstageAll: false, canDiscardAll: false, canCommit: false },
  },
  commits: [], allCommits: [], statusLimit: 10_000, didHitStatusLimit: false,
};

function workspace(id: string, name: string, path: string): Workspace {
  return { id, name, path, status: "recording", workspaceInstanceId: `${id}-instance` };
}
