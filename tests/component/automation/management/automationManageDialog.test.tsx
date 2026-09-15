/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DesktopCloudAutomationProviderSpec,
  DesktopCloudSession,
} from "../../../../src/lib/cloudApi";
import type { CloudAutomationRow } from "../../../../src/features/automation/automationDomain";
import { withTestLocalization } from "../../../support/react/localization";

const apiMocks = vi.hoisted(() => ({
  runs: vi.fn(),
  resources: vi.fn(),
  updateConnection: vi.fn(),
  updateTrigger: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("../../../../src/lib/cloudApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../src/lib/cloudApi")>()),
  listCloudAutomationConnectionRuns: apiMocks.runs,
  listCloudAutomationProviderResources: apiMocks.resources,
  updateCloudAutomationConnection: apiMocks.updateConnection,
  updateCloudAutomationTrigger: apiMocks.updateTrigger,
  deleteCloudAutomationConnection: apiMocks.remove,
}));

import { CloudManageAutomationDialog } from "../../../../src/features/automation/AutomationDialogs";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("CloudManageAutomationDialog", () => {
  it("lazily shows run history and saves source, destination, and trigger edits", async () => {
    apiMocks.runs.mockResolvedValue([{
      id: "run-1",
      access_point_id: "connection-1",
      status: "failed",
      started_at: "2026-07-12T01:00:00Z",
      error: "Provider quota exceeded",
      result_summary: null,
      trigger_type: "schedule",
    }]);
    apiMocks.resources.mockResolvedValue({ resources: [], next_cursor: null });
    apiMocks.updateConnection.mockResolvedValue({});
    apiMocks.updateTrigger.mockResolvedValue({});
    const onRefresh = vi.fn(async () => undefined);
    const container = renderManage({ onRefresh });
    await flushEffects();

    expect(apiMocks.runs).toHaveBeenCalledWith(
      SESSION,
      "connection-1",
      10,
      expect.any(Function),
      SESSION.api_base_url,
    );
    expect(container.textContent).toContain("Provider quota exceeded");

    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Edit Automation trigger"]')?.click());
    const triggerSelect = container.querySelector<HTMLSelectElement>('[aria-label="Run trigger"]');
    act(() => {
      if (!triggerSelect) return;
      triggerSelect.value = "daily";
      triggerSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      findButton(container, "Save changes")?.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(apiMocks.updateConnection).toHaveBeenCalledWith(
      SESSION,
      "connection-1",
      expect.objectContaining({
        target_path: "Research/Docs",
        direction: "inbound",
        config: expect.objectContaining({
          source: expect.objectContaining({ resource_id: "doc-1" }),
        }),
      }),
      expect.any(Function),
      SESSION.api_base_url,
    );
    expect(apiMocks.updateTrigger).toHaveBeenCalledWith(
      SESSION,
      "connection-1",
      expect.objectContaining({
        sync_mode: "scheduled",
        trigger: expect.objectContaining({ schedule: "0 9 * * *" }),
      }),
      expect.any(Function),
      SESSION.api_base_url,
    );
    expect(onRefresh).toHaveBeenCalled();
  });

  it("uses an in-app destructive confirmation and labels icon-only actions", async () => {
    apiMocks.runs.mockResolvedValue([]);
    apiMocks.remove.mockResolvedValue(undefined);
    const confirmSpy = vi.fn();
    (window as unknown as { confirm: typeof confirmSpy }).confirm = confirmSpy;
    const onClose = vi.fn();
    const container = renderManage({ onClose });
    await flushEffects();

    const openCloud = container.querySelector<HTMLButtonElement>('[aria-label="Open Automation in Cloud"]');
    const remove = container.querySelector<HTMLButtonElement>('[aria-label="Delete Automation"]');
    expect(openCloud?.title).toBe("Open Automation in Cloud");
    expect(remove?.title).toBe("Delete Automation");
    act(() => remove?.click());
    expect(container.textContent).toContain("Files already imported into the project will stay in place");
    expect(confirmSpy).not.toHaveBeenCalled();

    await act(async () => {
      findButton(container, "Delete Automation")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(apiMocks.remove).toHaveBeenCalledWith(
      SESSION,
      "connection-1",
      expect.any(Function),
      SESSION.api_base_url,
    );
    expect(onClose).toHaveBeenCalled();
  });
});

function renderManage({
  onRefresh = vi.fn(async () => undefined),
  onClose = vi.fn(),
}: {
  onRefresh?: () => Promise<void>;
  onClose?: () => void;
} = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(withTestLocalization(
    <CloudManageAutomationDialog
      projectId="project-1"
      row={ROW}
      providerSpec={PROVIDER}
      cloudSession={SESSION}
      apiBaseUrl={SESSION.api_base_url}
      onCloudSessionChange={noopSessionChange}
      onRefresh={onRefresh}
      onOpenAutomation={vi.fn()}
      onClose={onClose}
    />,
  )));
  const overlayRoot = document.querySelector<HTMLElement>("#desktop-overlay-root");
  if (!overlayRoot) throw new Error("Expected the Automation dialog in the global overlay root");
  return overlayRoot;
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function findButton(container: HTMLElement, label: string) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent?.trim() === label);
}

function noopSessionChange() {}

const SESSION: DesktopCloudSession = {
  expires_in: 3600,
  expires_at: Date.now() + 3600_000,
  user_id: "user-1",
  user_email: "user@example.com",
  api_base_url: "https://api.example.test/api/v1",
  session_generation: "generation-1",
  status: "authenticated",
};

const PROVIDER: DesktopCloudAutomationProviderSpec = {
  provider: "google_docs",
  display_name: "Google Docs",
  description: "Sync documents",
  auth: "oauth",
  creation_mode: "direct",
  category: "datasource",
  icon: null,
  supported_sync_modes: ["manual", "scheduled"],
  default_sync_mode: "manual",
  config_fields: [],
};

const ROW: CloudAutomationRow = {
  id: "automation:scope-1:connection-1",
  scope: {
    id: "scope-1",
    target: { kind: "scope", project_id: "project-1", scope_id: "scope-1" },
    project_id: "project-1",
    name: "Research Docs",
    path: "Research/Docs",
    exclude: [],
    max_mode: "rw",
  },
  connector: {
    id: "connection-1",
    target: { kind: "scope", project_id: "project-1", scope_id: "scope-1" },
    provider: "google_docs",
    name: "Product brief",
    direction: "inbound",
    status: "active",
    trigger: { type: "manual" },
    config: {
      target_path: "Research/Docs",
      source: {
        provider: "google_docs",
        resource_id: "doc-1",
        resource_name: "Product brief",
        resource_type: "document",
      },
      options: {},
    },
  },
};
