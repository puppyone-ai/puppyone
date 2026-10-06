import { useRef, useState } from "react";
import { type Workspace } from "@puppyone/shared-ui";
import type { DesktopPlatform } from "../../types/electron";
import { DesktopOverlayPortal } from "./DesktopOverlayPortal";
import { DesktopTitlebarContext } from "./DesktopTitlebarContext";
import type { DesktopProjectLocation } from "./DesktopProjectLocationSwitcher";
import { resetDesktopPlatformCapabilitiesForTests } from "../../platform/desktopPlatformClient";
import "./workspace-menu-visual-smoke.css";
import { desktopPreferencesStore, initializeDesktopPreferences } from "../../preferencesStore";

const inlineLocations = new URLSearchParams(window.location.search).get("location-presentation") === "header-icons";
initializeDesktopPreferences();
desktopPreferencesStore.getState().setExperimentalSettings(s => ({
  ...s,
  enableProjectLocationIconsInHeader: inlineLocations,
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
  const [open, setOpen] = useState(false);
  const [requested, setRequested] = useState<DesktopProjectLocation["requested"]>();
  const state = new URLSearchParams(window.location.search).get("project-state") ?? "local-only";
  const linked = state === "local-cloud" || state === "cloud-only" || state === "local-cloud-no-github" || state === "signed-out";
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
      <header className="desktop-titlebar workspace-menu-visual-titlebar"
        data-workspace-kind={inlineLocations ? (requested ?? current) : undefined}>
        <div className="desktop-titlebar-context">
          <DesktopTitlebarContext
            open={open}
            refObject={anchorRef}
            titlebarLabel={currentWorkspace.name}
            menuAlignment="center"
            workspace={currentWorkspace}
            workspaceFolders={[]}
            multiRootWorkspacesEnabled={false}
            projectLocation={{
              current,
              requested,
              loading: requested !== undefined && requested !== current,
              localAvailable: current === "local",
              cloudState,
            }}
            cloudProject={linked ? { id: "project-1" } : undefined}
            onOpenFolder={() => undefined}
            onClose={() => setOpen(false)}
            onViewLocal={() => setRequested("local")}
            onViewCloud={() => setRequested("cloud")}
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

function workspace(id: string, name: string, path: string): Workspace {
  return { id, name, path, status: "recording", workspaceInstanceId: `${id}-instance` };
}
