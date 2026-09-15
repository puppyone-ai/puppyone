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
import { CloudNewAutomationDialog } from "../../../../src/features/automation/AutomationDialogs";
import type { AutomationTemplate } from "../../../../src/features/automation/automationTemplates";
import { stripBidiIsolation, withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("CloudNewAutomationDialog", () => {
  it("opens a template directly in its provider-specific builder", () => {
    const container = renderDialog({
      template: {
        id: "google-docs",
        provider: "google_docs",
        sourceLabel: "Google Docs",
        presentation: "catalog",
        categories: ["popular", "documents"],
        iconUrl: null,
      },
    });

    expect(container.querySelector("h2")?.textContent).toBe("Collect Google Docs");
    expect(container.querySelector(".desktop-cloud-automation-chooser-grid")).toBeNull();
    expect(container.querySelector(".desktop-cloud-automation-builder")).not.toBeNull();
    expect(container.querySelector<HTMLElement>("[role='dialog']")?.style.getPropertyValue("--desktop-dialog-width")).toBe("920px");
    expect(container.querySelector<HTMLSelectElement>('[aria-label="Run trigger"]')?.value).toBe("daily");
    expect(
      Array.from(container.querySelectorAll("button"), (button) => button.textContent?.trim()),
    ).toContain("Create Automation");
    expect(
      Array.from(container.querySelectorAll("button"), (button) => button.textContent?.trim()),
    ).toContain("Back");

    act(() => Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.trim() === "Back")?.click());
    const chooseButtons = container.querySelectorAll<HTMLButtonElement>(".desktop-cloud-automation-template-add");
    act(() => chooseButtons[1]?.click());
    act(() => Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.trim() === "Continue")?.click());
    expect(stripBidiIsolation(container.querySelector("h2")?.textContent)).toBe("Configure Web Page");
  });

  it("uses source selection only for the generic New action", () => {
    const container = renderDialog({ template: null });

    expect(container.querySelector("h2")?.textContent).toBe("Choose an Automation source");
    expect(container.querySelectorAll(".desktop-cloud-automation-chooser-grid .desktop-cloud-automation-template-card")).toHaveLength(2);
    expect(container.querySelector(".desktop-cloud-automation-builder")).toBeNull();
    expect(
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.trim() === "Continue")?.disabled,
    ).toBe(true);
  });
});

function renderDialog({ template }: { template: AutomationTemplate | null }) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(withTestLocalization(
    <CloudNewAutomationDialog
      projectId="project-1"
      cloudSession={{} as DesktopCloudSession}
      apiBaseUrl={null}
      providers={[
        provider("google_docs", "Google Docs"),
        provider("url", "Web Page"),
      ]}
      providersLoading={false}
      providersError={null}
      template={template}
      onCloudSessionChange={vi.fn()}
      onRefresh={vi.fn(async () => undefined)}
      onCreated={vi.fn()}
      onClose={vi.fn()}
    />,
  )));
  const overlayRoot = document.querySelector<HTMLElement>("#desktop-overlay-root");
  if (!overlayRoot) throw new Error("Expected the Automation dialog in the global overlay root");
  return overlayRoot;
}

function provider(providerId: string, displayName: string): DesktopCloudAutomationProviderSpec {
  return {
    provider: providerId,
    display_name: displayName,
    description: `${displayName} source`,
    auth: "none",
    creation_mode: "direct",
    category: "datasource",
    icon: null,
    default_sync_mode: "scheduled",
    supported_sync_modes: ["manual", "scheduled"],
    config_fields: [],
  };
}
