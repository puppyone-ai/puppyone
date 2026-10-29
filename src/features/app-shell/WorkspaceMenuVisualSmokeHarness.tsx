import { useRef, useState } from "react";
import { type Workspace } from "@puppyone/shared-ui";
import type { DesktopPlatform } from "../../types/electron";
import { DesktopOverlayPortal } from "../../components/DesktopOverlayPortal";
import { DesktopTitlebarContext } from "./DesktopTitlebarContext";
import { resetDesktopPlatformCapabilitiesForTests } from "../../platform/desktopPlatformClient";
import "./workspace-menu-visual-smoke.css";
import { initializeDesktopPreferences } from "../../preferencesStore";
import { ProjectSwitcherRail } from "./ProjectSwitcherRail";
import { resolveProjectReachState } from "./project-reach";

initializeDesktopPreferences();

const currentWorkspace = workspace("todo", "To-Do-List", "/Users/demo/Desktop/To-Do-List");
const menuProjects = [
  // A name no menu width can hold: the row must end in an ellipsis instead of
  // widening the menu or scrolling it sideways.
  workspace("payments", "puppyone-payments-experiment-sandbox", "/Users/demo/Projects/puppyone-payments-experiment-sandbox"),
  workspace("vault", "puppyone Vault", "/Users/demo/Projects/puppyone Vault"),
  workspace("issues", "puppy-issues", "/Users/demo/Projects/puppy-issues"),
  workspace("pitch", "VC pitch", "/Users/demo/Projects/VC pitch"),
  workspace("demo", "独立站demo", "/Users/demo/Projects/独立站demo"),
  currentWorkspace,
  workspace("marketing", "marketing-pitch", "/Users/demo/Projects/marketing-pitch"),
  workspace("contracts", "合同合集", "/Users/demo/Projects/合同合集"),
  workspace("ontology", "ontology demo", "/Users/demo/Projects/ontology demo"),
];

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

/** The fixture scenario requested by the visual smoke URL. */
function readWorkspaceMenuScenario(search: string) {
  const params = new URLSearchParams(search);
  const state = params.get("project-state") ?? "local-only";
  const menu = params.get("menu");
  return {
    state,
    current: state === "cloud-only" ? "cloud" as const : "local" as const,
    theme: params.get("theme") === "light" ? "light" as const : "dark" as const,
    projectActions: menu === "project-actions",
    projectList: menu === "project-list",
    reach: menu === "reach",
    previewPath: params.get("path") === "long"
      ? "/Users/demo/Projects/Research and development/Interface experiments/puppyone-qubits"
      : "/Users/demo/Projects/puppyone-qubits",
  };
}

/** Deterministic browser fixture for reviewing the Workspace menu hierarchy. */
export function WorkspaceMenuVisualSmokeHarness() {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const { state, current, theme, projectActions, projectList, reach, previewPath } =
    readWorkspaceMenuScenario(window.location.search);
  const previewWorkspace = workspace("desktop", "puppyone-qubits", previewPath);

  return (
    <main className={`app-shell ${theme} workspace-menu-visual-smoke`}
      data-po-appearance-root="true"
      data-workspace-menu-visual-ready="true" data-project-state={state} data-device-platform={platform}>
      <DesktopOverlayPortal theme={theme}>{null}</DesktopOverlayPortal>
      <header className="desktop-titlebar workspace-menu-visual-titlebar">
        <div className="desktop-titlebar-context">
          <DesktopTitlebarContext
            open={open}
            refObject={anchorRef}
            titlebarLabel={currentWorkspace.name}
            menuAlignment="center"
            workspace={currentWorkspace}
            availableProjects={projectList ? menuProjects : [currentWorkspace]}
            workspaceFolders={[]}
            multiRootWorkspacesEnabled={false}
            projectReach={reach ? {
              state: resolveProjectReachState({ share: "local", shares: [], destinations: [],
                place: current === "cloud" ? "cloud" : "this-device" }),
              onInvitePerson: () => undefined, onConnectAgent: () => undefined,
            } : undefined}
            onOpenFolder={() => undefined}
            onClose={() => setOpen(false)}
            onToggle={() => setOpen(current => !current)}
            {...(projectList ? {
              onHome: () => setOpen(false),
              onCreateProject: () => setOpen(false),
            } : {})}
          />
        </div>
      </header>
      <section className="workspace-menu-visual-body" aria-hidden={projectActions ? undefined : true}
        data-project-actions={projectActions || undefined}>
        <aside>
          {projectActions && <ProjectSwitcherRail
            activeWorkspace={previewWorkspace}
            expanded
            recentWorkspaces={[]}
            // The three Project kinds together: a local folder, a local folder
            // that has its own Cloud project, and a Cloud project.
            projectItems={[
              { id: previewWorkspace.id, label: previewWorkspace.name, localPath: previewWorkspace.path },
              { id: "local:linked", label: "puppy-issues", localPath: "/Users/demo/Projects/puppy-issues",
                linkedCloudProject: { id: "linked", name: "puppy-issues" } },
              { id: "cloud:linked", label: "puppy-issues", localPath: "", cloudProjectId: "linked" },
              { id: "cloud:hosted", label: "VC pitch", localPath: "", cloudProjectId: "hosted" },
              // A name no rail width can hold: the row ends in an ellipsis
              // instead of widening or clipping the rail.
              { id: "local:payments", label: "puppyone-payments-experiment-sandbox",
                localPath: "/Users/demo/Projects/puppyone-payments-experiment-sandbox" },
            ]}
            onCreateNew={() => undefined}
            onSelectProject={() => undefined}
            onRenameProject={async () => undefined}
            onUnlinkProject={async () => undefined}
          />}
        </aside>
        <div>
          <span />
          <span />
          <span />
        </div>
      </section>
    </main>
  );
}

function workspace(id: string, name: string, path: string): Workspace {
  return { id, name, path, status: "recording", workspaceInstanceId: `${id}-instance` };
}
