import { useRef, useState } from "react";
import { type Workspace } from "@puppyone/shared-ui";
import type { DesktopPlatform } from "../../types/electron";
import { DesktopOverlayPortal } from "./DesktopOverlayPortal";
import { DesktopTitlebarContext } from "./DesktopTitlebarContext";
import { DesktopProjectLocationControls, type DesktopProjectLocation } from "./DesktopProjectLocationSwitcher";
import { resetDesktopPlatformCapabilitiesForTests } from "../../platform/desktopPlatformClient";
import "./workspace-menu-visual-smoke.css";
import { desktopPreferencesStore, initializeDesktopPreferences } from "../../preferencesStore";
import { ProjectSwitcherRail } from "./ProjectSwitcherRail";
import { resolveProjectReachState } from "./project-reach";

const inlineLocations = new URLSearchParams(window.location.search).get("location-presentation") === "header-icons";
initializeDesktopPreferences();
desktopPreferencesStore.getState().setExperimentalSettings(s => ({
  ...s,
  enableProjectLocationIconsInHeader: inlineLocations,
}));

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

/** Deterministic browser fixture for reviewing the Workspace menu hierarchy. */
export function WorkspaceMenuVisualSmokeHarness() {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [requested, setRequested] = useState<DesktopProjectLocation["requested"]>();
  const state = new URLSearchParams(window.location.search).get("project-state") ?? "local-only";
  const linked = state === "local-cloud" || state === "cloud-only" || state === "local-cloud-no-github" || state === "signed-out";
  const current = state === "cloud-only" ? "cloud" : "local";
  let cloudState: DesktopProjectLocation["cloudState"] = linked ? "available" : "unavailable";
  if (state === "signed-out") cloudState = "signed-out";
  if (state === "resolving") cloudState = "resolving";
  const theme = new URLSearchParams(window.location.search).get("theme") === "light" ? "light" : "dark";
  const projectActions = new URLSearchParams(window.location.search).get("menu") === "project-actions";
  const projectList = new URLSearchParams(window.location.search).get("menu") === "project-list";
  const reach = new URLSearchParams(window.location.search).get("menu") === "reach";
  const previewWorkspace = workspace("desktop", "puppyone-qubits",
    new URLSearchParams(window.location.search).get("path") === "long"
      ? "/Users/demo/Projects/Research and development/Interface experiments/puppyone-qubits"
      : "/Users/demo/Projects/puppyone-qubits");

  return (
    <main className={`app-shell ${theme} workspace-menu-visual-smoke`}
      data-po-appearance-root="true"
      data-workspace-menu-visual-ready="true" data-project-state={state} data-device-platform={platform}>
      <DesktopOverlayPortal theme={theme}>{null}</DesktopOverlayPortal>
      <header className="desktop-titlebar workspace-menu-visual-titlebar"
        data-workspace-kind={inlineLocations ? (requested ?? current) : undefined}>
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
            projectLocation={{
              current,
              requested,
              loading: requested !== undefined && requested !== current,
              localAvailable: current === "local",
              cloudState,
            }}
            projectReach={reach ? {
              state: resolveProjectReachState({ share: "local", shares: [], destinations: [],
                place: current === "cloud" ? "cloud" : "this-device" }),
              onInvitePerson: () => undefined, onConnectAgent: () => undefined,
            } : undefined}
            cloudProject={linked ? { id: "project-1" } : undefined}
            onOpenFolder={() => undefined}
            onClose={() => setOpen(false)}
            onViewLocal={() => setRequested("local")}
            onViewCloud={() => setRequested("cloud")}
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
            // The three Project kinds together: only the Cloud ones carry a
            // place mark, and only the open Project's menu carries the switch.
            projectItems={[
              { id: previewWorkspace.id, label: previewWorkspace.name, localPath: previewWorkspace.path },
              { id: "local:linked", label: "puppy-issues", localPath: "/Users/demo/Projects/puppy-issues", cloudProjectId: "linked" },
              { id: "cloud:hosted", label: "VC pitch", localPath: "", cloudProjectId: "hosted" },
              // A name no rail width can hold: the row ends in an ellipsis
              // instead of widening or clipping the rail.
              { id: "local:payments", label: "puppyone-payments-experiment-sandbox",
                localPath: "/Users/demo/Projects/puppyone-payments-experiment-sandbox" },
            ]}
            activeProjectLocationControls={<DesktopProjectLocationControls
              projectLocation={{ current, localAvailable: true, cloudState }}
              onViewLocal={() => setRequested("local")}
              onViewCloud={() => setRequested("cloud")}
            />}
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
