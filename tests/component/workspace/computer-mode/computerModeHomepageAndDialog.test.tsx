/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalComputerRecord, LocalComputerSnapshot } from "../../../../shared/local-computers/types";
import {
  ComputerModeEntryDialog,
  LocalComputerScreenView,
  resetLocalComputersCacheForTests,
} from "../../../../src/features/computer-mode";
import type { CloudSpace, ProjectHomeItem } from "../../../../src/lib/workspaceHomeModel";
import type { WorkspaceCreateProjectRequest, WorkspaceCreateProjectResult } from "../../../../src/types/electron";
import { desktopPreferencesStore as store, initializeDesktopPreferences } from "../../../../src/preferencesStore";
import { HomeWithEntryFlow } from "../../../support/react/homeWithEntryFlow";
import { withTestLocalization } from "../../../support/react/localization";
import { getByRole, queryByRole } from "../../../support/react/queries";
import { createTestSurfaceAppearance } from "../../../support/react/surfaceAppearance";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let snapshotListeners: Array<(snapshot: LocalComputerSnapshot) => void> = [];

const RUNTIME = {
  available: true,
  engine: "lima" as const,
  limactlPath: "/opt/mock/limactl",
  architecture: "arm64",
  platform: "darwin",
};

function installMockLocalComputersBridge(initialComputers: LocalComputerRecord[] = []) {
  let current: LocalComputerSnapshot = {
    experimentalEnabled: true,
    runtime: RUNTIME,
    computers: initialComputers,
  };
  snapshotListeners = [];

  const emit = (next: LocalComputerSnapshot) => {
    current = next;
    for (const listener of snapshotListeners) listener(current);
    return current;
  };

  const bridge = {
    getSnapshot: vi.fn(async () => current),
    setExperimentalOptIn: vi.fn(async ({ enabled }: { enabled: boolean }) => emit({
      ...current,
      experimentalEnabled: enabled,
    })),
    register: vi.fn(async ({ workspacePath, name }: { workspacePath: string; name?: string }) => {
      const record: LocalComputerRecord = {
        id: "comp-new",
        name: name ?? "Created Computer",
        workspacePath,
        instanceName: "p1-compnew",
        engine: "lima",
        status: "running",
        desktopReady: false,
        vncPort: null,
        statusDetail: null,
        createdAt: "2026-11-15T00:00:00.000Z",
        updatedAt: "2026-11-15T00:00:00.000Z",
      };
      return emit({
        ...current,
        computers: [record, ...current.computers],
      });
    }),
    wake: vi.fn(async ({ id }: { id: string }) => emit({
      ...current,
      computers: current.computers.map((item) => (
        item.id === id ? { ...item, status: "running" as const } : item
      )),
    })),
    sleep: vi.fn(async ({ id }: { id: string }) => emit({
      ...current,
      computers: current.computers.map((item) => (
        item.id === id ? { ...item, status: "asleep" as const } : item
      )),
    })),
    provisionDesktop: vi.fn(async ({ id }: { id: string }) => emit({
      ...current,
      computers: current.computers.map((item) => (
        item.id === id ? { ...item, status: "provisioning" as const } : item
      )),
    })),
    remove: vi.fn(async () => current),
    connectScreen: vi.fn(async () => ({
      transport: "managed-preview" as const,
      url: "",
      width: 1280,
      height: 800,
    })),
    onChanged: (callback: (snapshot: LocalComputerSnapshot) => void) => {
      snapshotListeners.push(callback);
      return () => {
        snapshotListeners = snapshotListeners.filter((entry) => entry !== callback);
      };
    },
  };

  (window as { puppyoneDesktop?: unknown }).puppyoneDesktop = {
    localComputers: bridge,
  };
  return bridge;
}

beforeEach(() => {
  localStorage.clear();
  initializeDesktopPreferences();
  resetLocalComputersCacheForTests();
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  document.body.replaceChildren();
  delete (window as { puppyoneDesktop?: unknown }).puppyoneDesktop;
  resetLocalComputersCacheForTests();
});

describe("Computer Mode Homepage, Entry Dialog, and Screen", () => {
  const spaces: CloudSpace[] = [
    { id: "team", name: "Design", kind: "space", canCreateProjects: true },
  ];

  const items: ProjectHomeItem[] = [
    { id: "plain-1", label: "Legacy Notes", localPath: "/fixture/legacy-notes" },
    { id: "comp-1", label: "Studio Box", localPath: "/fixture/studio-box" },
    { id: "cloud-1", label: "Cloud Sandbox", localPath: "", cloudProjectId: "cloud-1", cloudOrganizationId: "team" },
  ];

  it("reverses Homepage hierarchy to Cloud -> On-device Computers -> Muted Plain Folders when enabled", async () => {
    installMockLocalComputersBridge([
      {
        id: "c1",
        name: "Studio Box",
        workspacePath: "/fixture/studio-box",
        instanceName: "p1-c1",
        engine: "lima",
        status: "asleep",
        desktopReady: false,
        vncPort: null,
        statusDetail: null,
        createdAt: "2026-11-15T00:00:00.000Z",
        updatedAt: "2026-11-15T00:00:00.000Z",
      },
    ]);

    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(withTestLocalization(
        <HomeWithEntryFlow
          appearance={createTestSurfaceAppearance()}
          projectItems={items}
          cloudSpaces={spaces}
          cloudSpacesStatus="ready"
          onChooseWorkspace={async () => {}}
          onOpenWorkspacePath={async () => {}}
          onOpenDroppedWorkspace={async () => {}}
        />,
      ));
    });

    // Default OFF: ordinary Projects heading, folder glyphs, local-only group first.
    expect(host.querySelector(".onboarding-projects-title")?.textContent).toBe("Projects");
    expect([...host.querySelectorAll("[data-project-group]")].map((el) => el.getAttribute("data-project-group")))
      .toEqual(["local-only", "space:team"]);
    expect(host.querySelector(".project-computer-stage")).toBeNull();

    // Flip Computer Mode ON:
    await act(async () => {
      store.getState().setExperimentalSettings((prev) => ({ ...prev, enableComputerMode: true }));
    });

    await vi.waitFor(() => {
      expect(host.querySelector(".onboarding-projects-title")?.textContent).toBe("Computers");
    });

    expect(getByRole(host, "button", { name: "New computer" })).toBeTruthy();
    expect([...host.querySelectorAll("[data-project-group]")].map((el) => el.getAttribute("data-project-group")))
      .toEqual(["space:team", "local-computers", "plain-folders"]);

    // Cloud project and registered on-device computer render as miniature monitors:
    expect(host.querySelector('[data-project-group="space:team"] [data-computer-kind="cloud"]')).not.toBeNull();
    const onDeviceStage = host.querySelector('[data-project-group="local-computers"] [data-computer-kind="on-device"]');
    expect(onDeviceStage).not.toBeNull();
    expect(onDeviceStage?.getAttribute("data-computer-power")).toBe("asleep");

    // Plain folder stays accessible at the bottom and renders as a folder, not a computer, and can collapse:
    const plainSection = host.querySelector('[data-project-group="plain-folders"]')!;
    expect(plainSection.textContent).toContain("Legacy Notes");
    expect(plainSection.querySelector(".project-computer-stage")).toBeNull();
    const collapseButton = plainSection.querySelector<HTMLButtonElement>(".computer-mode-muted-folders-toggle")!;
    await act(async () => {
      collapseButton.click();
    });
    expect(plainSection.textContent).not.toContain("Legacy Notes");
  });

  it("creates either a Cloud Computer or an on-device Computer from ComputerModeEntryDialog", async () => {
    const bridge = installMockLocalComputersBridge();
    const onCreateCloudProject = vi.fn(async () => {});
    const onSubmit = vi.fn(async (request: WorkspaceCreateProjectRequest) => ({
      initialization: {
        operationId: request.operationId,
        outcome: "committed",
        path: "/fixture/new-box",
        name: request.name,
        createdPaths: [],
        initialOpenPath: null,
        template: null,
      },
      opening: {
        status: "opened",
        result: { status: "opened-current", workspaceId: "w1", path: "/fixture/new-box", workspace: { id: "w1", name: request.name, path: "/fixture/new-box" } },
      },
    }) as unknown as WorkspaceCreateProjectResult);
    const onClose = vi.fn();

    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(withTestLocalization(
        <ComputerModeEntryDialog
          cloudSpaces={spaces}
          onCreateCloudProject={onCreateCloudProject}
          onClose={onClose}
          onDefaultLocation={async () => ({ grantId: "grant-1", path: "/fixture" })}
          onChooseLocation={async () => ({ grantId: "grant-2", path: "/fixture/custom" })}
          onSubmit={onSubmit}
        />,
      ));
    });

    await vi.waitFor(() => {
      expect(getByRole(host, "dialog", { name: "Create a computer" })).toBeTruthy();
    });

    // Switch destination to "On this computer" and submit:
    const onDeviceCard = host.querySelector<HTMLButtonElement>('[data-destination="on-device"]')!;
    await act(async () => {
      onDeviceCard.click();
    });
    await vi.waitFor(() => {
      expect(host.textContent).toContain("/fixture");
    });

    const input = getByRole(host, "textbox", { name: "Computer name" }) as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Dev Machine");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      getByRole(host, "button", { name: "Create computer" }).click();
    });

    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledOnce();
      expect(bridge.register).toHaveBeenCalledWith({
        workspacePath: "/fixture/new-box",
        name: "Dev Machine",
        startNow: true,
      });
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  it("wakes and sleeps an on-device computer from LocalComputerScreenView", async () => {
    const onWake = vi.fn(async () => {});
    const onSleep = vi.fn(async () => {});
    const onProvisionDesktop = vi.fn(async () => {});
    const asleepComputer: LocalComputerRecord = {
      id: "c-sleep",
      name: "Quiet Box",
      workspacePath: "/fixture/quiet-box",
      instanceName: "p1-quiet",
      engine: "lima",
      status: "asleep",
      desktopReady: false,
      vncPort: null,
      statusDetail: null,
      createdAt: "2026-11-15T00:00:00.000Z",
      updatedAt: "2026-11-15T00:00:00.000Z",
    };

    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(withTestLocalization(
        <LocalComputerScreenView
          computer={asleepComputer}
          runtime={RUNTIME}
          connect={async () => ({ transport: "managed-preview", url: "", width: 1280, height: 800 })}
          onWake={onWake}
          onSleep={onSleep}
          onProvisionDesktop={onProvisionDesktop}
        />,
      ));
    });

    await act(async () => {
      getByRole(host, "button", { name: "Wake computer" }).click();
    });
    expect(onWake).toHaveBeenCalledWith("c-sleep");

    await act(async () => {
      root?.render(withTestLocalization(
        <LocalComputerScreenView
          computer={{ ...asleepComputer, status: "running" }}
          runtime={RUNTIME}
          connect={async () => ({ transport: "managed-preview", url: "", width: 1280, height: 800 })}
          onWake={onWake}
          onSleep={onSleep}
          onProvisionDesktop={onProvisionDesktop}
        />,
      ));
    });

    expect(queryByRole(host, "button", { name: "Start desktop screen" })).not.toBeNull();
    await act(async () => {
      getByRole(host, "button", { name: "Put to sleep" }).click();
    });
    expect(onSleep).toHaveBeenCalledWith("c-sleep");
  });
});
