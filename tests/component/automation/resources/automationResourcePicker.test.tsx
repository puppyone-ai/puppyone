/**
 * @vitest-environment happy-dom
 */
import React, { useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DesktopCloudAutomationProviderSpec,
  DesktopCloudSession,
} from "../../../../src/lib/cloudApi";
import type { AutomationSourceSelection } from "../../../../src/features/automation/automationRequest";
import { stripBidiIsolation, withTestLocalization } from "../../../support/react/localization";

const apiMocks = vi.hoisted(() => ({ resources: vi.fn(), directory: vi.fn() }));

vi.mock("../../../../src/lib/cloudApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../src/lib/cloudApi")>()),
  listCloudAutomationProviderResources: apiMocks.resources,
  listCloudDirectory: apiMocks.directory,
}));

import {
  CloudAutomationDestinationEditor,
  CloudAutomationSourceEditor,
} from "../../../../src/features/automation/AutomationControls";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("Automation resource picker", () => {
  it("selects an enumerated provider resource into the source draft", async () => {
    vi.useFakeTimers();
    apiMocks.resources.mockResolvedValue({
      resources: [{
        id: "doc-1",
        type: "document",
        name: "Product brief",
        url: "https://docs.google.com/document/d/doc-1",
        subtitle: "Shared with me",
        icon: null,
        authorized: true,
        metadata: { owner: "team@example.com" },
      }],
      next_cursor: null,
    });
    const container = renderEditor();
    await act(async () => vi.advanceTimersByTimeAsync(250));

    const select = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("Product brief"));
    act(() => select?.click());

    expect(container.querySelector("output")?.textContent).toBe("doc-1");
    expect(apiMocks.resources).toHaveBeenCalledWith(
      SESSION,
      "google_docs",
      { q: "" },
      expect.any(Function),
      SESSION.api_base_url,
    );
  });

  it("falls back to manual source fields on 401 without blocking configuration", async () => {
    vi.useFakeTimers();
    const error = Object.assign(new Error("Unable to authorize with the provider"), { status: 401 });
    apiMocks.resources.mockRejectedValue(error);
    const container = renderEditor();
    await act(async () => vi.advanceTimersByTimeAsync(250));

    expect(container.querySelector('[aria-label="Manual source details"]')).not.toBeNull();
    expect(container.querySelector<HTMLInputElement>('input[placeholder="Provider resource ID"]')).not.toBeNull();
    expect(container.textContent).toContain("You can still enter its resource details");
  });

  it("selects an existing project folder while preserving free-text normalized preview", async () => {
    apiMocks.directory.mockResolvedValue({
      path: "",
      entries: [{ name: "Research", path: "Research", type: "folder" }],
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(withTestLocalization(<DestinationHarness />)));
    act(() => findButton(container, "Choose from project folders")?.click());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => findButton(container, "Research")?.click());
    expect(container.querySelector("output")?.textContent).toBe("Research");

    const input = container.querySelector<HTMLInputElement>('input[placeholder="New or existing folder"]');
    act(() => {
      if (!input) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "/Research//Drafts/../Docs/",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(stripBidiIsolation(container.textContent)).toContain("Final path: /Research/Docs");
  });
});

function renderEditor() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(withTestLocalization(<EditorHarness />)));
  return container;
}

function EditorHarness() {
  const [source, setSource] = useState<AutomationSourceSelection | null>(null);
  return (
    <>
      <CloudAutomationSourceEditor
        provider={PROVIDER}
        cloudSession={SESSION}
        apiBaseUrl={SESSION.api_base_url}
        configValues={{}}
        source={source}
        onCloudSessionChange={noopSessionChange}
        onConfigValueChange={vi.fn()}
        onSourceChange={setSource}
      />
      <output>{source?.resourceId ?? ""}</output>
    </>
  );
}

function DestinationHarness() {
  const [path, setPath] = useState("Google Docs");
  return (
    <>
      <CloudAutomationDestinationEditor
        projectId="project-1"
        cloudSession={SESSION}
        apiBaseUrl={SESSION.api_base_url}
        targetPath={path}
        onCloudSessionChange={noopSessionChange}
        onChange={setPath}
      />
      <output>{path}</output>
    </>
  );
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
