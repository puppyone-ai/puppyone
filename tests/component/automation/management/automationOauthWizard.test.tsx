/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DesktopCloudAutomationProviderSpec,
  DesktopCloudSession,
} from "../../../../src/lib/cloudApi";
import type { AutomationTemplate } from "../../../../src/features/automation/automationTemplates";
import { stripBidiIsolation, withTestLocalization } from "../../../support/react/localization";

const apiMocks = vi.hoisted(() => ({
  create: vi.fn(),
  authorize: vi.fn(),
  status: vi.fn(),
  openAuthorization: vi.fn(),
  resources: vi.fn(),
}));

vi.mock("../../../../src/lib/cloudApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../src/lib/cloudApi")>()),
  createCloudAutomation: apiMocks.create,
  getCloudAutomationOauthAuthorizeUrl: apiMocks.authorize,
  getCloudAutomationOauthStatus: apiMocks.status,
  openCloudAutomationAuthorizationUrl: apiMocks.openAuthorization,
  listCloudAutomationProviderResources: apiMocks.resources,
}));

import { CloudNewAutomationDialog } from "../../../../src/features/automation/AutomationDialogs";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

beforeEach(() => {
  apiMocks.authorize.mockResolvedValue("https://accounts.example.test/oauth");
  apiMocks.openAuthorization.mockResolvedValue(undefined);
  apiMocks.resources.mockResolvedValue({ resources: [resource()], next_cursor: null });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("Automation OAuth wizard", () => {
  it.each([
    { entry: "template", connected: true, expected: "configure" },
    { entry: "template", connected: false, expected: "connect" },
    { entry: "new", connected: true, expected: "configure" },
    { entry: "new", connected: false, expected: "connect" },
  ])("derives $expected for $entry entry when connected=$connected", async ({ entry, connected, expected }) => {
    apiMocks.status.mockResolvedValue(oauthStatus(connected));
    apiMocks.resources.mockResolvedValue({ resources: [resource()], next_cursor: null });
    const container = renderWizard(entry === "template" ? TEMPLATE : null);
    await flushEffects();

    if (entry === "new") {
      expect(container.textContent).toContain(connected ? "team@example.com" : "Connection required");
      act(() => container.querySelector<HTMLButtonElement>(".desktop-cloud-automation-template-add")?.click());
      act(() => findButton(container, "Continue")?.click());
    }

    if (expected === "configure") {
      expect(container.querySelector(".desktop-cloud-automation-builder")).not.toBeNull();
    } else {
      expect(stripBidiIsolation(container.querySelector("h2")?.textContent)).toBe("Connect Google Docs");
      expect(container.querySelector(".desktop-cloud-automation-builder")).toBeNull();
    }
  });

  it("opens authorization, polls only while connected step is active, and advances automatically", async () => {
    vi.useFakeTimers();
    apiMocks.status
      .mockResolvedValueOnce(oauthStatus(false))
      .mockResolvedValueOnce(oauthStatus(true));
    apiMocks.authorize.mockResolvedValue("https://accounts.example.test/oauth");
    apiMocks.openAuthorization.mockResolvedValue(undefined);
    apiMocks.resources.mockResolvedValue({ resources: [resource()], next_cursor: null });
    const container = renderWizard(TEMPLATE);
    await flushEffects();
    expect(stripBidiIsolation(container.querySelector("h2")?.textContent)).toBe("Connect Google Docs");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(apiMocks.authorize).toHaveBeenCalledTimes(1);
    expect(apiMocks.openAuthorization).toHaveBeenCalledWith("https://accounts.example.test/oauth");
    expect(apiMocks.status).toHaveBeenCalledTimes(2);
    expect(container.querySelector(".desktop-cloud-automation-builder")).not.toBeNull();

    await act(async () => vi.advanceTimersByTimeAsync(6_000));
    expect(apiMocks.status).toHaveBeenCalledTimes(2);
  });

  it("cancels connection waiting without creating an Automation", async () => {
    vi.useFakeTimers();
    apiMocks.status.mockResolvedValue(oauthStatus(false));
    const container = renderWizard(TEMPLATE);
    await flushEffects();
    await act(async () => {
      findButton(container, "Cancel")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector(".desktop-cloud-automation-chooser-grid")).not.toBeNull();
    expect(apiMocks.create).not.toHaveBeenCalled();
  });

  it("treats missing server OAuth configuration as unavailable instead of retryable", async () => {
    vi.useFakeTimers();
    apiMocks.status.mockResolvedValue(oauthStatus(false));
    apiMocks.authorize.mockRejectedValue(Object.assign(
      new Error("Request failed (500): Google Docs OAuth is not configured. Please set the required environment variables."),
      { status: 500 },
    ));
    const container = renderWizard(TEMPLATE);
    await flushEffects();
    await act(async () => vi.advanceTimersByTimeAsync(0));

    const content = stripBidiIsolation(container.textContent);
    expect(content).toContain("Google Docs is not available yet");
    expect(content).toContain("has not configured Google Docs authorization");
    expect(findButton(container, "Try again")).toBeUndefined();

    act(() => findButton(container, "Choose another source")?.click());
    expect(container.querySelector(".desktop-cloud-automation-chooser-grid")).not.toBeNull();
    expect(apiMocks.authorize).toHaveBeenCalledTimes(1);
  });

  it("keeps transient authorization failures retryable and shows progress immediately", async () => {
    vi.useFakeTimers();
    apiMocks.status.mockResolvedValue(oauthStatus(false));
    apiMocks.authorize
      .mockRejectedValueOnce(new Error("Network request failed"))
      .mockResolvedValueOnce("https://accounts.example.test/oauth");
    const container = renderWizard(TEMPLATE);
    await flushEffects();
    await act(async () => vi.advanceTimersByTimeAsync(0));

    expect(container.textContent).toContain("Authorization needs attention");
    act(() => findButton(container, "Try again")?.click());
    expect(container.textContent).toContain("Opening secure authorization");

    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(apiMocks.authorize).toHaveBeenCalledTimes(2);
    expect(apiMocks.openAuthorization).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Waiting for connection");
  });

  it("consumes the initial execution result and emits creation feedback", async () => {
    vi.useFakeTimers();
    apiMocks.status.mockResolvedValue(oauthStatus(true));
    apiMocks.resources.mockResolvedValue({ resources: [resource()], next_cursor: null });
    apiMocks.create.mockResolvedValue({
      sync: {
        id: "connection-1",
        project_id: "project-1",
        path: "Google Docs",
        direction: "inbound",
        provider: "google_docs",
        config: {},
        status: "active",
      },
      execution_result: {
        run_id: "run-1",
        status: "queued",
        summary: "Sync queued",
      },
    });
    const onCreated = vi.fn();
    const container = renderWizard(TEMPLATE, onCreated);
    await flushEffects();
    await act(async () => vi.advanceTimersByTimeAsync(250));
    const resourceButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("Product brief"));
    act(() => resourceButton?.click());

    await act(async () => {
      findButton(container, "Create Automation")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: "connection-1",
      runId: "run-1",
      status: "queued",
      summary: "Sync queued",
    }));
  });

  it.each([
    {
      error: Object.assign(new Error("Sync worker is unavailable"), { status: 503 }),
      expected: "first sync could not be queued",
    },
    { error: new Error("OAuth token expired"), expected: "authorization failed" },
    { error: new Error("Invalid provider configuration"), expected: "Review the source and folder settings" },
  ])("renders actionable creation failure copy for $expected", async ({ error, expected }) => {
    vi.useFakeTimers();
    apiMocks.status.mockResolvedValue(oauthStatus(true));
    apiMocks.resources.mockResolvedValue({ resources: [resource()], next_cursor: null });
    apiMocks.create.mockRejectedValue(error);
    const container = renderWizard(TEMPLATE);
    await flushEffects();
    await act(async () => vi.advanceTimersByTimeAsync(250));
    const resourceButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("Product brief"));
    act(() => resourceButton?.click());
    await act(async () => {
      findButton(container, "Create Automation")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain(expected);
  });
});

function renderWizard(template: AutomationTemplate | null, onCreated = vi.fn()) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(withTestLocalization(
    <CloudNewAutomationDialog
      projectId="project-1"
      cloudSession={SESSION}
      apiBaseUrl={SESSION.api_base_url}
      providers={[PROVIDER]}
      providersLoading={false}
      providersError={null}
      template={template}
      onCloudSessionChange={vi.fn()}
      onRefresh={vi.fn(async () => undefined)}
      onCreated={onCreated}
      onClose={vi.fn()}
    />,
  )));
  const overlayRoot = document.querySelector<HTMLElement>("#desktop-overlay-root");
  if (!overlayRoot) throw new Error("Expected the Automation wizard in the global overlay root");
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

function oauthStatus(connected: boolean) {
  return {
    connected,
    workspace_name: connected ? "team@example.com" : null,
    connected_at: connected ? "2026-07-12T00:00:00Z" : null,
    connection_id: connected ? 42 : null,
  };
}

function resource() {
  return {
    id: "doc-1",
    type: "document",
    name: "Product brief",
    url: "https://docs.google.com/document/d/doc-1",
    subtitle: null,
    icon: null,
    authorized: true,
    metadata: {},
  };
}

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

const TEMPLATE: AutomationTemplate = {
  id: "google-docs",
  provider: "google_docs",
  sourceLabel: "Google Docs",
  presentation: "catalog",
  categories: ["popular", "documents"],
  iconUrl: null,
};
