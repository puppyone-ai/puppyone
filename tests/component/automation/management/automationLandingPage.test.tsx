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
import type { AutomationTemplate } from "../../../../src/features/automation/automationTemplates";
import { withTestLocalization } from "../../../support/react/localization";

vi.mock("../../../../src/features/automation/AutomationDialogs", () => ({
  CloudNewAutomationDialog: ({ template }: { template: AutomationTemplate | null }) => (
    <div data-testid="new-automation-provider">{template?.provider ?? "unselected"}</div>
  ),
  CloudManageAutomationDialog: () => null,
}));

import { CloudAutomationPage } from "../../../../src/features/automation/AutomationPage";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

const PROVIDERS: DesktopCloudAutomationProviderSpec[] = [
  provider("gmail", "Gmail", "oauth"),
  provider("google_calendar", "Google Calendar", "oauth"),
  provider("google_docs", "Google Docs", "oauth"),
  provider("google_search_console", "Google Search Console", "oauth"),
  provider("google_sheets", "Google Sheets", "oauth"),
  provider("url", "Web Page", "none"),
];

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function renderAutomationPage(rows: CloudAutomationRow[] = []) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(withTestLocalization(
    <CloudAutomationPage
      projectId="project-1"
      cloudSession={{} as DesktopCloudSession}
      apiBaseUrl={null}
      rows={rows}
      totalCount={rows.length}
      hasAnyAutomation={rows.length > 0}
      loading={false}
      providerSpecs={PROVIDERS}
      providerSpecsLoading={false}
      providerSpecsError={null}
      detailRow={null}
      onOpenRow={vi.fn()}
      onCloseDetail={vi.fn()}
      onCloudSessionChange={vi.fn()}
      onRefresh={vi.fn(async () => undefined)}
      onOpenAutomation={vi.fn()}
    />,
  )));
  return container;
}

describe("Automation landing page", () => {
  it("opens with the four popular source-to-project templates", () => {
    const container = renderAutomationPage();

    expect(container.querySelector("h1")?.textContent).toBe("Automations");
    expect(container.querySelectorAll(".desktop-cloud-automation-template-card")).toHaveLength(4);
    expect(
      Array.from(container.querySelectorAll(".desktop-cloud-automation-template-card h2"), (node) => node.textContent),
    ).toEqual([
      "Collect Google Docs",
      "Import Google Sheets",
      "Capture Gmail updates",
      "Track a web source",
    ]);
    expect(container.querySelectorAll(".desktop-cloud-automation-template-route")).toHaveLength(4);
  });

  it("filters categories and carries the selected provider into the creation flow", () => {
    const container = renderAutomationPage();
    const documentsTab = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      .find((button) => button.textContent === "Documents");

    act(() => documentsTab?.click());
    expect(
      Array.from(container.querySelectorAll(".desktop-cloud-automation-template-card h2"), (node) => node.textContent),
    ).toEqual(["Collect Google Docs", "Import Google Sheets"]);

    const firstAdd = container.querySelector<HTMLButtonElement>(".desktop-cloud-automation-template-add");
    act(() => firstAdd?.click());
    expect(container.querySelector('[data-testid="new-automation-provider"]')?.textContent).toBe("google_docs");
  });

  it("promotes owned Automations above the secondary source catalog", () => {
    const container = renderAutomationPage([automationRow()]);
    const owned = container.querySelector(".desktop-cloud-automation-existing-section");
    const addMore = container.querySelector(".desktop-cloud-automation-add-more");

    expect(owned?.querySelector("h2")?.textContent).toBe("Your automations");
    expect(addMore?.querySelector("h2")?.textContent).toBe("Add more sources");
    expect(((owned?.compareDocumentPosition(addMore as Node) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true);
  });
});

function automationRow(): CloudAutomationRow {
  return {
    id: "automation:scope-1:connection-1",
    scope: {
      id: "scope-1",
      target: { kind: "scope", project_id: "project-1", scope_id: "scope-1" },
      project_id: "project-1",
      name: "Docs",
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
      config: {},
    },
  };
}

function provider(
  providerId: string,
  displayName: string,
  auth: DesktopCloudAutomationProviderSpec["auth"],
): DesktopCloudAutomationProviderSpec {
  return {
    provider: providerId,
    display_name: displayName,
    description: `${displayName} source`,
    auth,
    creation_mode: "direct",
    category: "datasource",
    icon: null,
    supported_sync_modes: ["manual", "scheduled"],
    default_sync_mode: "scheduled",
    config_fields: [],
  };
}
