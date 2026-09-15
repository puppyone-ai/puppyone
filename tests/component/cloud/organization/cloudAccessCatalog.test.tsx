/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DesktopCloudConnector,
  DesktopCloudMcpEndpoint,
  DesktopCloudRepoIdentity,
  DesktopCloudScope,
  DesktopCloudSession,
} from "../../../../src/lib/cloudApi";
import { AccessPointRoutePage } from "../../../../src/features/cloud/access-points";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("AccessPointRoutePage catalog", () => {
  it("filters access points by method, status, and search and opens the selected point", () => {
    const container = renderCatalog();

    expect(container.querySelectorAll(".desktop-cloud-access-point-row")).toHaveLength(5);
    expect(container.textContent).toContain("Access points");
    expect(container.querySelector(".desktop-cloud-access-list-header")).toBeNull();

    act(() => findButton(container, "CLI")?.click());
    expect(container.querySelectorAll(".desktop-cloud-access-point-row")).toHaveLength(2);

    const status = container.querySelector<HTMLSelectElement>(".desktop-cloud-access-status-filter");
    act(() => {
      if (!status) return;
      status.value = "inactive";
      status.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.querySelectorAll(".desktop-cloud-access-point-row")).toHaveLength(1);
    expect(container.textContent).toContain("Documentation");

    act(() => {
      if (!status) return;
      status.value = "all";
      status.dispatchEvent(new Event("change", { bubbles: true }));
      findButton(container, "MCP server")?.click();
    });
    expect(container.querySelectorAll(".desktop-cloud-access-point-row")).toHaveLength(1);
    expect(container.textContent).toContain("Docs MCP");

    const search = container.querySelector<HTMLInputElement>('[aria-label="Search access"]');
    act(() => {
      if (!search) return;
      setInputValue(search, "nothing here");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.querySelectorAll(".desktop-cloud-access-point-row")).toHaveLength(0);
    expect(container.textContent).toContain("No access matches these filters");

    act(() => {
      if (!search) return;
      setInputValue(search, "Docs MCP");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const mcpRow = container.querySelector<HTMLButtonElement>(".desktop-cloud-access-point-row");
    act(() => mcpRow?.click());
    expect(document.body.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("Docs MCP");
  });
});

function renderCatalog() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(withTestLocalization(
    <AccessPointRoutePage
      kind="all"
      projectId="project-1"
      cloudSession={SESSION}
      apiBaseUrl={SESSION.api_base_url}
      identity={IDENTITY}
      scopes={SCOPES}
      connectors={CONNECTORS}
      mcpEndpoints={MCP_ENDPOINTS}
      loading={false}
      canManage
      onCloudSessionChange={vi.fn()}
      onRefresh={vi.fn(async () => undefined)}
      onOpenProject={vi.fn()}
    />,
  )));
  return container;
}

function findButton(container: HTMLElement, label: string) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent?.trim() === label);
}

function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
}

const SESSION = {
  user_id: "user-1",
  user_email: "user@example.com",
  api_base_url: "https://cloud.example/api/v1",
  session_generation: "generation-1",
  expires_in: 3600,
  expires_at: 0,
  status: "authenticated",
} satisfies DesktopCloudSession;

const IDENTITY = {
  project_id: "project-1",
  url: "https://cloud.example/git/project-1.git",
  scopes: [{
    id: "scope-docs",
    name: "Documentation",
    path: "docs",
    git_url: "https://cloud.example/git/project-1/scopes/scope-docs.git",
  }],
} satisfies DesktopCloudRepoIdentity;

const SCOPES = [{
  id: "scope-docs",
  project_id: "project-1",
  name: "Documentation",
  path: "docs",
  exclude: [],
  max_mode: "r",
}] satisfies DesktopCloudScope[];

const CONNECTORS = [{
  id: "root-cli",
  target: { kind: "project_root", project_id: "project-1" },
  provider: "cli",
  name: "Root CLI",
  direction: "bidirectional",
  status: "active",
}, {
  id: "docs-cli",
  target: { kind: "scope", project_id: "project-1", scope_id: "scope-docs" },
  provider: "cli",
  name: "Docs CLI",
  direction: "bidirectional",
  status: "paused",
}] satisfies DesktopCloudConnector[];

const MCP_ENDPOINTS = [{
  id: "mcp-docs",
  project_id: "project-1",
  path: "docs",
  name: "Docs MCP",
  status: "active",
  accesses: [{ path: "docs", readonly: true }],
}] satisfies DesktopCloudMcpEndpoint[];
