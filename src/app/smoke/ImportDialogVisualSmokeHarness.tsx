import { useEffect } from "react";
import { OnboardingImportDialog } from "../../components/OnboardingImportDialog";
import { ProjectEntryLauncherDialog } from "../../features/app-shell/ProjectEntryLauncherDialog";
import {
  resolveImportPreviewBrands,
  resolveVisibleImportSources,
} from "../../features/project-import/importSourceRegistry";
import type { WorkspaceAppFolder, WorkspaceProjectLocationGrant } from "../../types/electron";

/**
 * New → Import, for visual review: `#import-dialog-visual-smoke`, with
 * `?state=launcher|sources|github|obsidian|cursor|vscode`, and `&apps=1` to show the
 * other-app sources. The theme follows the system. Nothing here reaches Main.
 */
const params = new URLSearchParams(window.location.search);
const state = params.get("state") ?? "sources";
const settings = { enableOtherAppImports: params.get("apps") === "1" || ["obsidian", "cursor", "vscode"].includes(state) };
const APP_FOLDERS: Record<string, WorkspaceAppFolder[]> = {
  obsidian: [
    { path: "/Users/you/Documents/Notes", name: "Notes", lastUsedAt: 1, added: false },
    { path: "/Users/you/Documents/Work Journal", name: "Work Journal", lastUsedAt: 1, added: false },
    { path: "/Users/you/Library/Mobile Documents/iCloud~md~obsidian/Documents/Reading", name: "Reading", lastUsedAt: 1, added: true },
  ],
  cursor: Array.from({ length: 9 }, (_, index) => ({
    path: `/Users/you/code/project-${index + 1}`, name: `project-${index + 1}`, lastUsedAt: null, added: index === 2,
  })),
  vscode: [],
  typora: [],
};
const GRANT = { grantId: "fixture", path: "/Users/you/PuppyOne" } as WorkspaceProjectLocationGrant;
const noop = () => undefined;

export function ImportDialogVisualSmokeHarness() {
  useEffect(() => {
    // The App Shell owns theme classes; the harness only mirrors the system.
    document.documentElement.classList.toggle("dark", window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (state === "launcher" || state === "sources") return;
    // App tiles enable once their folders are known.
    window.setTimeout(() => document.querySelector<HTMLButtonElement>(`button[data-import-source="${state}"]`)?.click(), 50);
  }, []);

  if (state === "launcher") {
    return (
      <ProjectEntryLauncherDialog
        canImport
        canCreateProject
        importPreviewBrands={resolveImportPreviewBrands(settings)}
        onImport={noop}
        onClose={noop}
        onCreateProject={noop}
        onOpenFolder={noop}
      />
    );
  }
  return (
    <OnboardingImportDialog
      onClose={noop}
      onDefaultLocation={async () => GRANT}
      onChooseLocation={async () => GRANT}
      onImportSource={async () => false}
      onConnectSource={async () => ({ connectionId: "fixture" })}
      onListResources={async () => ({
        items: [
          { id: "1", name: "Product Wiki", kind: "folder" },
          { id: "2", name: "Meeting Notes", kind: "database" },
          { id: "3", name: "Roadmap 2027", kind: "document" },
        ],
        nextCursor: null,
      })}
      onCancelImport={async () => ({ cancelled: false })}
      onListAppFolders={async (app) => APP_FOLDERS[app] ?? []}
      onAddAppFolders={async ({ paths }) => ({ added: paths.length })}
      onImportProgress={() => noop}
      visibleSources={resolveVisibleImportSources(settings)}
    />
  );
}
